package com.rutabus.controller;

import com.rutabus.entity.User;
import com.rutabus.repository.UserRepository;
import com.rutabus.security.JwtTokenProvider;
import com.rutabus.service.EmailService;
import com.rutabus.service.GoogleAuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.Normalizer;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final Pattern USERNAME_PATTERN = Pattern.compile("^[a-zA-Z0-9_.-]{3,30}$");
    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$");
    private static final long CODE_TTL_MS = 10 * 60 * 1000L; // 10 minutos
    private static final int MAX_CODE_ATTEMPTS = 5;
    private static final long RATE_WINDOW_MS = 60 * 1000L; // 1 minuto
    private static final int MAX_AUTH_REQUESTS_PER_MIN = 15;
    private static final long REGISTER_SHORT_WINDOW_MS = 10 * 60 * 1000L;
    private static final int MAX_REGISTER_PER_10_MIN = 3;
    private static final long REGISTER_DAY_WINDOW_MS = 24 * 60 * 60 * 1000L;
    private static final int MAX_REGISTER_PER_DAY = 6;
    private static final Set<String> BLOCKED_EMAIL_DOMAINS = Set.of(
            "example.com", "example.org", "example.net", "test.com", "localhost",
            "mailinator.com", "guerrillamail.com", "yopmail.com", "tempmail.com",
            "10minutemail.com", "trashmail.com", "sharklasers.com"
    );
    private static final Set<String> BLOCKED_TLDS = Set.of(
            "local", "internal", "invalid", "test", "example", "localhost", "mxx", "con", "cpm"
    );

    private final SecureRandom secureRandom = new SecureRandom();
    private final Map<String, VerificationEntry> pendingCodes = new ConcurrentHashMap<>();
    private final Map<String, VerificationEntry> pendingResetCodes = new ConcurrentHashMap<>();
    private final Map<String, RateLimitEntry> rateLimits = new ConcurrentHashMap<>();
    private final Map<String, RateLimitEntry> registerShortLimits = new ConcurrentHashMap<>();
    private final Map<String, RateLimitEntry> registerDayLimits = new ConcurrentHashMap<>();

    @Value("${app.auth.expose-demo-codes:false}")
    private boolean exposeDemoCodes;

    @Value("${app.auth.require-email-verification:true}")
    private boolean requireEmailVerification;

    @Autowired
    private AuthenticationManager authenticationManager;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JwtTokenProvider tokenProvider;

    @Autowired
    private EmailService emailService;

    @Autowired
    private GoogleAuthService googleAuthService;

    private static class VerificationEntry {
        final String code;
        final long expiresAt;
        int attempts;

        VerificationEntry(String code, long expiresAt) {
            this.code = code;
            this.expiresAt = expiresAt;
        }
    }

    private static class RateLimitEntry {
        long windowStart;
        int count;

        RateLimitEntry(long windowStart) {
            this.windowStart = windowStart;
        }
    }

    private boolean isKeyRateLimitedInStore(Map<String, RateLimitEntry> store, String key, long windowMs, int maxRequests, boolean increment) {
        long now = System.currentTimeMillis();
        RateLimitEntry entry = store.compute(key, (k, existing) -> {
            if (existing == null || now - existing.windowStart >= windowMs) {
                RateLimitEntry fresh = new RateLimitEntry(now);
                fresh.count = increment ? 1 : 0;
                return fresh;
            }
            if (increment) {
                existing.count++;
            }
            return existing;
        });
        if (store.size() > 5000) {
            store.entrySet().removeIf(e -> now - e.getValue().windowStart >= windowMs);
        }
        return entry.count > maxRequests;
    }

    private boolean isKeyRateLimited(String key, long windowMs, int maxRequests, boolean increment) {
        return isKeyRateLimitedInStore(rateLimits, key, windowMs, maxRequests, increment);
    }

    private boolean isRateLimited(HttpServletRequest req, String bucket) {
        String ip = req != null ? req.getRemoteAddr() : "unknown";
        return isKeyRateLimited(bucket + ":" + ip, RATE_WINDOW_MS, MAX_AUTH_REQUESTS_PER_MIN, true);
    }

    private boolean isRegisterRateLimited(HttpServletRequest req) {
        String ip = req != null ? req.getRemoteAddr() : "unknown";
        return isKeyRateLimitedInStore(registerShortLimits, ip, REGISTER_SHORT_WINDOW_MS, MAX_REGISTER_PER_10_MIN, true)
                || isKeyRateLimitedInStore(registerDayLimits, ip, REGISTER_DAY_WINDOW_MS, MAX_REGISTER_PER_DAY, true);
    }

    private boolean isDisallowedTestDomain(String emailStr) {
        int atIdx = emailStr.lastIndexOf('@');
        if (atIdx <= 0 || atIdx >= emailStr.length() - 1) return true;
        String domain = emailStr.substring(atIdx + 1).trim().toLowerCase();
        if (domain.isEmpty() || !domain.contains(".") || BLOCKED_EMAIL_DOMAINS.contains(domain)) {
            return true;
        }
        int lastDot = domain.lastIndexOf('.');
        String tld = domain.substring(lastDot + 1);
        return tld.length() < 2 || BLOCKED_TLDS.contains(tld);
    }

    private String validatePasswordStrength(String password) {
        if (password == null || password.length() < 8 || password.length() > 128) {
            return "La contraseña debe tener entre 8 y 128 caracteres.";
        }
        boolean hasUpper = false;
        boolean hasLower = false;
        boolean hasDigit = false;
        boolean hasSymbol = false;
        for (int i = 0; i < password.length(); i++) {
            char ch = password.charAt(i);
            if (Character.isUpperCase(ch)) hasUpper = true;
            else if (Character.isLowerCase(ch)) hasLower = true;
            else if (Character.isDigit(ch)) hasDigit = true;
            else if (!Character.isWhitespace(ch)) hasSymbol = true;
        }
        if (!hasUpper || !hasLower || !hasDigit || !hasSymbol) {
            return "La contraseña debe incluir al menos 1 mayúscula, 1 minúscula, 1 número y 1 símbolo.";
        }
        return null;
    }

    private ResponseEntity<?> validateVerificationEntry(Map<String, VerificationEntry> store, String emailKey, String codeInput, boolean consumeOnSuccess) {
        VerificationEntry pending = store.get(emailKey);
        long now = System.currentTimeMillis();
        if (pending == null || now > pending.expiresAt) {
            store.remove(emailKey);
            return ResponseEntity.badRequest().body(Map.of("error", "El código de verificación expiró o no ha sido solicitado."));
        }
        synchronized (pending) {
            if (now > pending.expiresAt) {
                store.remove(emailKey, pending);
                return ResponseEntity.badRequest().body(Map.of("error", "El código de verificación expiró o no ha sido solicitado."));
            }
            pending.attempts++;
            if (pending.attempts > MAX_CODE_ATTEMPTS) {
                store.remove(emailKey, pending);
                return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                        .body(Map.of("error", "Demasiados intentos fallidos de código. Solicita uno nuevo."));
            }
            byte[] expectedBytes = pending.code.getBytes(StandardCharsets.UTF_8);
            byte[] providedBytes = (codeInput != null ? codeInput : "").getBytes(StandardCharsets.UTF_8);
            if (!MessageDigest.isEqual(expectedBytes, providedBytes)) {
                return ResponseEntity.badRequest().body(Map.of("error", "Código de verificación incorrecto."));
            }
            if (consumeOnSuccess) {
                store.remove(emailKey, pending);
            }
        }
        return null;
    }

    private void storeVerificationCode(Map<String, VerificationEntry> store, String email, String code) {
        store.put(email, new VerificationEntry(code, System.currentTimeMillis() + CODE_TTL_MS));
        if (store.size() > 5000) {
            long now = System.currentTimeMillis();
            store.entrySet().removeIf(e -> now > e.getValue().expiresAt);
        }
    }

    @PostMapping("/register")
    public ResponseEntity<?> registerUser(@RequestBody AuthRequest registerRequest, HttpServletRequest httpReq) {
        if (isRegisterRateLimited(httpReq)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiados registros recientes desde esta red. Intenta más tarde."));
        }

        String username = registerRequest.getUsername() != null ? registerRequest.getUsername().trim() : "";
        String emailStr = registerRequest.getEmail() != null ? registerRequest.getEmail().trim().toLowerCase() : "";
        String password = registerRequest.getPassword() != null ? registerRequest.getPassword() : "";
        String codeInput = registerRequest.getVerificationCode() != null ? registerRequest.getVerificationCode().trim() : "";

        if (!USERNAME_PATTERN.matcher(username).matches()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "El usuario debe tener entre 3 y 30 caracteres (solo letras, números, . _ o -, sin espacios ni acentos)."));
        }
        if (emailStr.isEmpty() || emailStr.length() > 100 || !EMAIL_PATTERN.matcher(emailStr).matches()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Ingresa un correo electrónico válido."));
        }
        if (isDisallowedTestDomain(emailStr) || !emailService.hasValidMailDomain(emailStr)) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "El dominio de ese correo no existe o no recibe mensajes. Revisa que esté bien escrito."));
        }
        String pwdError = validatePasswordStrength(password);
        if (pwdError != null) {
            return ResponseEntity.badRequest().body(Map.of("error", pwdError));
        }

        if (requireEmailVerification) {
            ResponseEntity<?> codeErr = validateVerificationEntry(pendingCodes, emailStr, codeInput, false);
            if (codeErr != null) {
                return codeErr;
            }
        }

        if (userRepository.existsByUsername(username)) {
            return ResponseEntity.badRequest().body(Map.of("error", "El nombre de usuario ya está registrado."));
        }
        if (userRepository.existsByEmail(emailStr)) {
            return ResponseEntity.badRequest().body(Map.of("error", "El correo electrónico ya está registrado en otra cuenta."));
        }

        pendingCodes.remove(emailStr);

        User user = new User();
        user.setUsername(username);
        user.setEmail(emailStr);
        user.setPassword(passwordEncoder.encode(password));
        // Registro público SIEMPRE asigna usuario estándar; nunca privilegios administrativos por dominio
        user.setRole("ROLE_USER");

        userRepository.save(user);

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(Map.of("message", "Usuario registrado exitosamente."));
    }

    @GetMapping("/config")
    public ResponseEntity<?> getAuthConfig() {
        return ResponseEntity.ok(Map.of(
                "requireEmailVerification", requireEmailVerification,
                "smtpConfigured", emailService.isSmtpConfigured(),
                "googleEnabled", googleAuthService.isEnabled(),
                "googleClientId", googleAuthService.isEnabled() ? googleAuthService.getClientId() : ""
        ));
    }

    @PostMapping("/google")
    public ResponseEntity<?> authenticateWithGoogle(
            @RequestBody(required = false) Map<String, String> request,
            HttpServletRequest httpReq) {
        if (isRateLimited(httpReq, "google")) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiados intentos con Google. Espera un minuto."));
        }
        String credential = request != null ? request.get("credential") : null;
        try {
            GoogleAuthService.VerifiedGoogleUser gUser = googleAuthService.verifyIdToken(credential);
            if (isDisallowedTestDomain(gUser.email())) {
                return ResponseEntity.badRequest().body(Map.of("error", "Dominio de correo no permitido."));
            }

            User user = userRepository.findByEmail(gUser.email()).orElse(null);
            boolean isNewUser = false;
            if (user == null) {
                isNewUser = true;
                user = new User();
                user.setUsername(buildUniqueUsername(gUser.name(), gUser.email()));
                user.setEmail(gUser.email());
                byte[] randomBytes = new byte[32];
                secureRandom.nextBytes(randomBytes);
                user.setPassword(passwordEncoder.encode(Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes)));
                user.setRole("ROLE_USER");
                user = userRepository.save(user);
            }

            String jwt = tokenProvider.generateToken(user.getUsername(), user.getRole());
            Map<String, Object> res = new HashMap<>();
            res.put("token", jwt);
            res.put("username", user.getUsername());
            res.put("role", user.getRole());
            res.put("googleNewUser", isNewUser);
            return ResponseEntity.ok(res);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", e.getMessage()));
        }
    }

    private String buildUniqueUsername(String fullName, String email) {
        String source = (fullName != null && !fullName.isBlank())
                ? fullName
                : email.substring(0, Math.max(1, email.indexOf('@')));
        String ascii = Normalizer.normalize(source, Normalizer.Form.NFD)
                .replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
                .toLowerCase()
                .replaceAll("[^a-z0-9_.-]+", "_")
                .replaceAll("^[_.-]+|[_.-]+$", "");
        if (ascii.length() < 3) {
            ascii = "pasajero_" + ascii;
        }
        String base = ascii.length() > 22 ? ascii.substring(0, 22) : ascii;
        String candidate = base;
        int attempt = 0;
        while (userRepository.existsByUsername(candidate)) {
            attempt++;
            String suffix = "_" + (secureRandom.nextInt(900) + 100);
            int maxPrefix = Math.min(base.length(), 30 - suffix.length());
            candidate = base.substring(0, maxPrefix) + suffix;
            if (attempt > 12) {
                candidate = "user_" + Math.abs(secureRandom.nextInt(999999));
            }
        }
        return candidate;
    }

    @PostMapping("/send-verification")
    public ResponseEntity<?> sendVerificationCode(@RequestBody Map<String, String> request, HttpServletRequest httpReq) {
        if (isRateLimited(httpReq, "send-verification")) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiadas solicitudes. Espera un minuto e inténtalo de nuevo."));
        }

        String rawEmail = request != null ? request.get("email") : null;
        String email = rawEmail != null ? rawEmail.trim().toLowerCase() : "";
        if (email.isEmpty() || email.length() > 100 || !EMAIL_PATTERN.matcher(email).matches()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Por favor ingresa un correo electrónico válido."));
        }
        if (isDisallowedTestDomain(email) || !emailService.hasValidMailDomain(email)) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "El dominio de ese correo no existe o no puede recibir mensajes. Verifica que no tenga errores (ej. @gmail.com o @upsin.edu.mx)."));
        }
        if (userRepository.existsByEmail(email)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Ya existe una cuenta registrada con ese correo."));
        }

        if (!requireEmailVerification) {
            return ResponseEntity.ok(Map.of(
                    "skipVerification", true,
                    "message", "Registro directo habilitado en modo beta."
            ));
        }

        String code = String.valueOf(secureRandom.nextInt(900000) + 100000);
        storeVerificationCode(pendingCodes, email, code);

        boolean sentBySmtp;
        try {
            sentBySmtp = emailService.sendVerificationCodeEmail(email, code);
        } catch (IllegalStateException ex) {
            pendingCodes.remove(email);
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", ex.getMessage()));
        }

        Map<String, Object> body = new HashMap<>();
        body.put("message", sentBySmtp
                ? "Código de verificación enviado a tu correo."
                : "Código de verificación generado en modo local.");
        body.put("smtpSent", sentBySmtp);
        if (!sentBySmtp && exposeDemoCodes) {
            body.put("code", code);
        }
        return ResponseEntity.ok(body);
    }

    @PostMapping("/forgot-password")
    public ResponseEntity<?> forgotPassword(@RequestBody Map<String, String> request, HttpServletRequest httpReq) {
        if (isRateLimited(httpReq, "forgot-password")) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiadas solicitudes. Espera un minuto."));
        }

        String rawEmail = request != null ? request.get("email") : null;
        String email = rawEmail != null ? rawEmail.trim().toLowerCase() : "";
        if (email.isEmpty() || email.length() > 100 || !EMAIL_PATTERN.matcher(email).matches()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Por favor ingresa un correo electrónico válido."));
        }

        User user = userRepository.findByEmail(email).orElse(null);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "No encontramos ninguna cuenta registrada con ese correo en Don Rutero."));
        }

        String code = String.valueOf(secureRandom.nextInt(900000) + 100000);
        storeVerificationCode(pendingResetCodes, email, code);
        boolean sentBySmtp;
        try {
            sentBySmtp = emailService.sendPasswordResetEmail(email, code);
        } catch (IllegalStateException ex) {
            pendingResetCodes.remove(email);
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", ex.getMessage()));
        }

        Map<String, Object> body = new HashMap<>();
        body.put("message", sentBySmtp
                ? "Enviamos un código de 6 dígitos a tu correo para restablecer tu contraseña."
                : "Código de recuperación generado en modo local.");
        body.put("smtpSent", sentBySmtp);
        if (!sentBySmtp && exposeDemoCodes) {
            body.put("code", code);
        }
        return ResponseEntity.ok(body);
    }

    @PostMapping("/reset-password")
    public ResponseEntity<?> resetPassword(@RequestBody Map<String, String> request, HttpServletRequest httpReq) {
        if (isRateLimited(httpReq, "reset-password")) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiados intentos. Espera un minuto."));
        }

        String rawEmail = request != null ? request.get("email") : null;
        String email = rawEmail != null ? rawEmail.trim().toLowerCase() : "";
        String codeInput = request != null && request.get("code") != null ? request.get("code").trim() : "";
        String newPassword = request != null ? request.get("newPassword") : null;

        if (email.isEmpty() || email.length() > 100 || !EMAIL_PATTERN.matcher(email).matches()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Correo electrónico inválido."));
        }
        String pwdError = validatePasswordStrength(newPassword);
        if (pwdError != null) {
            return ResponseEntity.badRequest().body(Map.of("error", pwdError));
        }

        ResponseEntity<?> codeErr = validateVerificationEntry(pendingResetCodes, email, codeInput, true);
        if (codeErr != null) {
            return codeErr;
        }

        User user = userRepository.findByEmail(email).orElse(null);
        if (user == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "No se encontró la cuenta asociada a ese correo."));
        }

        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);
        tokenProvider.invalidateUserTokens(user.getUsername());
        return ResponseEntity.ok(Map.of("message", "Contraseña restablecida correctamente. Ya puedes iniciar sesión."));
    }

    @PostMapping("/login")
    public ResponseEntity<?> authenticateUser(@RequestBody AuthRequest loginRequest, HttpServletRequest httpReq) {
        if (isRateLimited(httpReq, "login")) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiados intentos de inicio de sesión. Espera un minuto."));
        }

        String loginInput = loginRequest != null && loginRequest.getUsername() != null ? loginRequest.getUsername().trim() : "";
        String password = loginRequest != null && loginRequest.getPassword() != null ? loginRequest.getPassword() : "";
        if (loginInput.isEmpty() || password.isEmpty()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Usuario o contraseña incorrectos."));
        }

        String accountKey = "login-fail:" + loginInput.toLowerCase();
        if (isKeyRateLimited(accountKey, 5 * 60_000L, 10, false)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiados intentos fallidos en esta cuenta. Espera unos minutos."));
        }

        try {
            Authentication authentication = authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(loginInput, password)
            );

            SecurityContextHolder.getContext().setAuthentication(authentication);
            rateLimits.remove(accountKey);

            User user = userRepository.findByUsername(authentication.getName()).orElseThrow();
            rateLimits.remove("login-fail:" + user.getUsername().toLowerCase());
            if (user.getEmail() != null) {
                rateLimits.remove("login-fail:" + user.getEmail().toLowerCase());
            }
            String jwt = tokenProvider.generateToken(user.getUsername(), user.getRole());

            Map<String, Object> response = new HashMap<>();
            response.put("token", jwt);
            response.put("username", user.getUsername());
            response.put("role", user.getRole());

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            isKeyRateLimited(accountKey, 5 * 60_000L, 10, true);
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Usuario o contraseña incorrectos."));
        }
    }

    @GetMapping("/verify")
    public ResponseEntity<?> verifyToken(@RequestHeader(value = "Authorization", required = false) String tokenHeader) {
        if (tokenHeader == null || !tokenHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Token faltante o inválido"));
        }

        String token = tokenHeader.substring(7);
        try {
            String username = tokenProvider.getUsernameFromToken(token);
            User user = userRepository.findByUsername(username).orElseThrow();
            if (tokenProvider.isTokenRevoked(token, user.getUsername())) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Sesión revocada. Inicia sesión nuevamente."));
            }

            Map<String, Object> response = new HashMap<>();
            response.put("username", user.getUsername());
            response.put("role", user.getRole());

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Token inválido o expirado"));
        }
    }

    @PostMapping("/change-password")
    public ResponseEntity<?> changePassword(@RequestBody Map<String, String> request, HttpServletRequest httpReq) {
        if (isRateLimited(httpReq, "change-password")) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiados intentos. Espera un minuto."));
        }

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || "anonymousUser".equals(auth.getPrincipal())) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Sesión requerida."));
        }

        String currentPassword = request != null ? request.get("currentPassword") : null;
        String newPassword = request != null ? request.get("newPassword") : null;
        if (currentPassword == null || currentPassword.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Ingresa tu contraseña actual."));
        }
        String pwdError = validatePasswordStrength(newPassword);
        if (pwdError != null) {
            return ResponseEntity.badRequest().body(Map.of("error", pwdError));
        }

        User user = userRepository.findByUsername(auth.getName()).orElse(null);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Usuario no encontrado."));
        }
        if (!passwordEncoder.matches(currentPassword, user.getPassword())) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", "La contraseña actual es incorrecta."));
        }

        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);
        tokenProvider.invalidateUserTokens(user.getUsername());
        return ResponseEntity.ok(Map.of("message", "Contraseña actualizada correctamente."));
    }

    // DTO para la petición de Auth
    public static class AuthRequest {
        private String username;
        private String email;
        private String password;
        private String verificationCode;

        public String getUsername() {
            return username;
        }

        public void setUsername(String username) {
            this.username = username;
        }

        public String getEmail() {
            return email;
        }

        public void setEmail(String email) {
            this.email = email;
        }

        public String getPassword() {
            return password;
        }

        public void setPassword(String password) {
            this.password = password;
        }

        public String getVerificationCode() {
            return verificationCode;
        }

        public void setVerificationCode(String verificationCode) {
            this.verificationCode = verificationCode;
        }
    }
}
