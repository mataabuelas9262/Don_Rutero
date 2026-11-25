package com.rutabus.controller;

import com.rutabus.entity.User;
import com.rutabus.repository.UserRepository;
import com.rutabus.security.JwtTokenProvider;
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

import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Hashtable;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import javax.naming.Context;
import javax.naming.NameNotFoundException;
import javax.naming.NamingException;
import javax.naming.directory.Attribute;
import javax.naming.directory.Attributes;
import javax.naming.directory.DirContext;
import javax.naming.directory.InitialDirContext;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final Pattern USERNAME_PATTERN = Pattern.compile("^[a-zA-Z0-9_.-]{3,30}$");
    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    private static final long CODE_TTL_MS = 10 * 60 * 1000L; // 10 minutos
    private static final int MAX_CODE_ATTEMPTS = 5;
    private static final long RATE_WINDOW_MS = 60 * 1000L; // 1 minuto
    private static final int MAX_AUTH_REQUESTS_PER_MIN = 15;
    private static final long REGISTER_SHORT_WINDOW_MS = 10 * 60 * 1000L; // 10 minutos
    private static final int MAX_REGISTER_PER_10_MIN = 3;
    private static final long REGISTER_DAY_WINDOW_MS = 24 * 60 * 60 * 1000L; // 24 horas
    private static final int MAX_REGISTER_PER_DAY = 6;
    private static final long MX_CACHE_TTL_MS = 60 * 60 * 1000L; // 1 hora
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
    private final Map<String, RateLimitEntry> rateLimits = new ConcurrentHashMap<>();
    private final Map<String, RateLimitEntry> registerShortLimits = new ConcurrentHashMap<>();
    private final Map<String, RateLimitEntry> registerDayLimits = new ConcurrentHashMap<>();
    private final Map<String, long[]> mxCache = new ConcurrentHashMap<>();

    @Value("${app.auth.expose-demo-codes:false}")
    private boolean exposeDemoCodes;

    @Value("${app.auth.require-email-verification:true}")
    private boolean requireEmailVerification;

    @Value("${app.auth.verify-email-mx:true}")
    private boolean verifyEmailMx;

    @Autowired
    private AuthenticationManager authenticationManager;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JwtTokenProvider tokenProvider;

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

    private boolean checkWindowLimit(Map<String, RateLimitEntry> store, String key, long windowMs, int maxAllowed) {
        long now = System.currentTimeMillis();
        RateLimitEntry entry = store.compute(key, (k, existing) -> {
            if (existing == null || now - existing.windowStart >= windowMs) {
                RateLimitEntry fresh = new RateLimitEntry(now);
                fresh.count = 1;
                return fresh;
            }
            existing.count++;
            return existing;
        });
        if (store.size() > 5000) {
            store.entrySet().removeIf(e -> now - e.getValue().windowStart >= windowMs);
        }
        return entry.count > maxAllowed;
    }

    private boolean isRateLimited(HttpServletRequest req, String bucket) {
        String ip = req != null ? req.getRemoteAddr() : "unknown";
        return checkWindowLimit(rateLimits, bucket + ":" + ip, RATE_WINDOW_MS, MAX_AUTH_REQUESTS_PER_MIN);
    }

    private boolean isRegisterRateLimited(HttpServletRequest req) {
        String ip = req != null ? req.getRemoteAddr() : "unknown";
        return checkWindowLimit(registerShortLimits, ip, REGISTER_SHORT_WINDOW_MS, MAX_REGISTER_PER_10_MIN)
                || checkWindowLimit(registerDayLimits, ip, REGISTER_DAY_WINDOW_MS, MAX_REGISTER_PER_DAY);
    }

    private boolean isEmailDomainAllowed(String emailStr) {
        int atIdx = emailStr.lastIndexOf('@');
        if (atIdx <= 0 || atIdx >= emailStr.length() - 1) return false;
        String domain = emailStr.substring(atIdx + 1).trim().toLowerCase();
        if (domain.isEmpty() || !domain.contains(".") || BLOCKED_EMAIL_DOMAINS.contains(domain)) {
            return false;
        }
        int lastDot = domain.lastIndexOf('.');
        String tld = domain.substring(lastDot + 1);
        if (tld.length() < 2 || BLOCKED_TLDS.contains(tld)) {
            return false;
        }
        if (!verifyEmailMx) {
            return true;
        }
        long now = System.currentTimeMillis();
        long[] cached = mxCache.get(domain);
        if (cached != null && now - cached[0] < MX_CACHE_TTL_MS) {
            return cached[1] == 1L;
        }
        boolean valid = lookupDomainHasMx(domain);
        if (mxCache.size() > 3000) {
            mxCache.entrySet().removeIf(e -> now - e.getValue()[0] >= MX_CACHE_TTL_MS);
        }
        mxCache.put(domain, new long[]{now, valid ? 1L : 0L});
        return valid;
    }

    private boolean lookupDomainHasMx(String domain) {
        try {
            Hashtable<String, String> env = new Hashtable<>();
            env.put(Context.INITIAL_CONTEXT_FACTORY, "com.sun.jndi.dns.DnsContextFactory");
            env.put("com.sun.jndi.dns.timeout.initial", "2500");
            env.put("com.sun.jndi.dns.timeout.retries", "1");
            DirContext ctx = new InitialDirContext(env);
            try {
                Attributes attrs = ctx.getAttributes(domain, new String[]{"MX"});
                Attribute mx = attrs != null ? attrs.get("MX") : null;
                if (mx == null || mx.size() == 0) return false;
                for (int i = 0; i < mx.size(); i++) {
                    String rec = String.valueOf(mx.get(i)).trim();
                    if (!rec.endsWith(" .") && !rec.equals(".")) {
                        return true;
                    }
                }
                return false;
            } finally {
                ctx.close();
            }
        } catch (NameNotFoundException e) {
            return false;
        } catch (NamingException e) {
            // Si el DNS no está disponible temporalmente, evita falsos negativos en registros reales
            return e.getMessage() == null || !e.getMessage().toLowerCase().contains("name not found");
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
                    "error", "El usuario debe tener entre 3 y 30 caracteres (solo letras, números, ., _ o -)."));
        }
        if (emailStr.isEmpty() || emailStr.length() > 100 || !EMAIL_PATTERN.matcher(emailStr).matches()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Ingresa un correo electrónico válido."));
        }
        if (!isEmailDomainAllowed(emailStr)) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "El dominio del correo no es válido o no recibe correos. Revisa cómo está escrito."));
        }
        if (password.length() < 8 || password.length() > 128) {
            return ResponseEntity.badRequest().body(Map.of("error", "La contraseña debe tener entre 8 y 128 caracteres."));
        }

        if (requireEmailVerification) {
            VerificationEntry pending = pendingCodes.get(emailStr);
            long now = System.currentTimeMillis();
            if (pending == null || now > pending.expiresAt) {
                pendingCodes.remove(emailStr);
                return ResponseEntity.badRequest().body(Map.of("error", "El código de verificación expiró o no ha sido solicitado."));
            }
            pending.attempts++;
            if (pending.attempts > MAX_CODE_ATTEMPTS) {
                pendingCodes.remove(emailStr);
                return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                        .body(Map.of("error", "Demasiados intentos fallidos de código. Solicita uno nuevo."));
            }
            if (!pending.code.equals(codeInput)) {
                return ResponseEntity.badRequest().body(Map.of("error", "Código de verificación incorrecto."));
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
        return ResponseEntity.ok(Map.of("requireEmailVerification", requireEmailVerification));
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
        if (userRepository.existsByEmail(email)) {
            return ResponseEntity.badRequest().body(Map.of("error", "No fue posible procesar el registro con ese correo."));
        }

        if (!requireEmailVerification) {
            return ResponseEntity.ok(Map.of(
                    "skipVerification", true,
                    "message", "Registro directo habilitado en modo beta."
            ));
        }

        String code = String.valueOf(secureRandom.nextInt(900000) + 100000);
        pendingCodes.put(email, new VerificationEntry(code, System.currentTimeMillis() + CODE_TTL_MS));
        if (pendingCodes.size() > 5000) {
            long now = System.currentTimeMillis();
            pendingCodes.entrySet().removeIf(e -> now > e.getValue().expiresAt);
        }

        Map<String, Object> body = new HashMap<>();
        body.put("message", "Código de verificación generado.");
        if (exposeDemoCodes) {
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

        // Respuesta uniforme sin enumerar si la cuenta existe
        return ResponseEntity.ok(Map.of(
                "message", "Si el correo está registrado en el sistema, recibirás instrucciones para recuperar tu acceso."
        ));
    }

    @PostMapping("/login")
    public ResponseEntity<?> authenticateUser(@RequestBody AuthRequest loginRequest, HttpServletRequest httpReq) {
        if (isRateLimited(httpReq, "login")) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiados intentos de inicio de sesión. Espera un minuto."));
        }

        String username = loginRequest != null && loginRequest.getUsername() != null ? loginRequest.getUsername().trim() : "";
        String password = loginRequest != null && loginRequest.getPassword() != null ? loginRequest.getPassword() : "";
        if (username.isEmpty() || password.isEmpty()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Usuario o contraseña incorrectos."));
        }

        try {
            Authentication authentication = authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(username, password)
            );

            SecurityContextHolder.getContext().setAuthentication(authentication);

            User user = userRepository.findByUsername(username).orElseThrow();
            String jwt = tokenProvider.generateToken(user.getUsername(), user.getRole());

            Map<String, Object> response = new HashMap<>();
            response.put("token", jwt);
            response.put("username", user.getUsername());
            response.put("role", user.getRole());

            return ResponseEntity.ok(response);
        } catch (Exception e) {
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
        if (currentPassword == null || currentPassword.isEmpty() || newPassword == null || newPassword.length() < 8 || newPassword.length() > 128) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Ingresa tu contraseña actual y una nueva contraseña de 8 a 128 caracteres."));
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
