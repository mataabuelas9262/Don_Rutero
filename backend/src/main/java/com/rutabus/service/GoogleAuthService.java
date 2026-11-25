package com.rutabus.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Set;

/**
 * Verifies Google Identity Services ID tokens via Spring Security NimbusJwtDecoder (Google JWKS).
 */
@Service
public class GoogleAuthService {

    private static final String GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
    private static final Set<String> VALID_ISSUERS = Set.of("https://accounts.google.com", "accounts.google.com");

    public record VerifiedGoogleUser(String email, String name, String subject) {}

    @Value("${app.auth.google-client-id:}")
    private String googleClientId;

    private volatile JwtDecoder cachedDecoder;

    public boolean isEnabled() {
        return googleClientId != null && !googleClientId.trim().isEmpty();
    }

    public String getClientId() {
        return googleClientId != null ? googleClientId.trim() : "";
    }

    void setJwtDecoderForTests(JwtDecoder decoder) {
        this.cachedDecoder = decoder;
    }

    private JwtDecoder getOrBuildDecoder() {
        JwtDecoder current = this.cachedDecoder;
        if (current != null) {
            return current;
        }
        synchronized (this) {
            if (this.cachedDecoder == null) {
                NimbusJwtDecoder nimbus = NimbusJwtDecoder.withJwkSetUri(GOOGLE_JWKS_URI).build();
                nimbus.setJwtValidator(buildValidator(getClientId()));
                this.cachedDecoder = nimbus;
            }
            return this.cachedDecoder;
        }
    }

    private OAuth2TokenValidator<Jwt> buildValidator(String expectedClientId) {
        OAuth2TokenValidator<Jwt> issuerAndAudience = jwt -> {
            String iss = jwt.getIssuer() != null ? jwt.getIssuer().toString() : jwt.getClaimAsString("iss");
            if (iss == null || !VALID_ISSUERS.contains(iss)) {
                return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "Issuer de Google inválido.", null));
            }
            List<String> aud = jwt.getAudience();
            if (aud == null || expectedClientId.isEmpty() || !aud.contains(expectedClientId)) {
                return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "Audiencia de Google inválida.", null));
            }
            return OAuth2TokenValidatorResult.success();
        };
        return new DelegatingOAuth2TokenValidator<>(new JwtTimestampValidator(), issuerAndAudience);
    }

    public VerifiedGoogleUser verifyIdToken(String idToken) {
        if (!isEnabled()) {
            throw new IllegalStateException("El acceso con Google no está habilitado en este servidor.");
        }
        if (idToken == null || idToken.trim().isEmpty()) {
            throw new IllegalArgumentException("Token de Google faltante.");
        }
        try {
            Jwt jwt = getOrBuildDecoder().decode(idToken.trim());
            Object verifiedClaim = jwt.getClaim("email_verified");
            boolean emailVerified = Boolean.TRUE.equals(verifiedClaim)
                    || "true".equalsIgnoreCase(String.valueOf(verifiedClaim));
            if (!emailVerified) {
                throw new IllegalArgumentException("Tu cuenta de Google no tiene el correo verificado.");
            }
            String email = jwt.getClaimAsString("email");
            if (email == null || email.trim().isEmpty()) {
                throw new IllegalArgumentException("Google no proporcionó un correo electrónico válido.");
            }
            String name = jwt.getClaimAsString("name");
            if (name == null || name.isBlank()) {
                name = jwt.getClaimAsString("given_name");
            }
            String sub = jwt.getSubject() != null ? jwt.getSubject() : email;
            return new VerifiedGoogleUser(email.trim().toLowerCase(), name != null ? name.trim() : "", sub);
        } catch (JwtException e) {
            throw new IllegalArgumentException("La credencial de Google es inválida o expiró. Intenta nuevamente.");
        }
    }
}
