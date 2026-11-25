package com.rutabus.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.security.Keys;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

@Component
public class JwtTokenProvider {

    @Value("${jwt.secret:}")
    private String jwtSecret;

    @Value("${jwt.expiration}")
    private long jwtExpirationInMs;

    private Key signingKey;
    private final Map<String, Long> invalidatedBeforeMs = new ConcurrentHashMap<>();

    @PostConstruct
    public void initKey() {
        if (StringUtils.hasText(this.jwtSecret)) {
            byte[] keyBytes = this.jwtSecret.getBytes(StandardCharsets.UTF_8);
            if (keyBytes.length < 32) {
                throw new IllegalStateException("JWT_SECRET debe tener al menos 32 bytes (256 bits).");
            }
            this.signingKey = Keys.hmacShaKeyFor(keyBytes);
        } else {
            // En desarrollo local sin variable JWT_SECRET, generar clave aleatoria efímera por arranque
            byte[] randomBytes = new byte[48];
            new SecureRandom().nextBytes(randomBytes);
            this.jwtSecret = Base64.getEncoder().encodeToString(randomBytes);
            this.signingKey = Keys.hmacShaKeyFor(this.jwtSecret.getBytes(StandardCharsets.UTF_8));
            System.out.println("⚠️ [JwtTokenProvider] JWT_SECRET no definido: usando clave efímera aleatoria para esta sesión.");
        }
    }

    private Key getSigningKey() {
        return this.signingKey;
    }

    public String generateToken(String username, String role) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("role", role);
        return createToken(claims, username);
    }

    private String createToken(Map<String, Object> claims, String subject) {
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + jwtExpirationInMs);
        claims.put("iatMs", now.getTime());

        return Jwts.builder()
                .setClaims(claims)
                .setSubject(subject)
                .setIssuedAt(now)
                .setExpiration(expiryDate)
                .signWith(getSigningKey(), SignatureAlgorithm.HS256)
                .compact();
    }

    public String getUsernameFromToken(String token) {
        return getClaimFromToken(token, Claims::getSubject);
    }

    public String getRoleFromToken(String token) {
        Claims claims = getAllClaimsFromToken(token);
        return claims.get("role", String.class);
    }

    public Date getExpirationDateFromToken(String token) {
        return getClaimFromToken(token, Claims::getExpiration);
    }

    public <T> T getClaimFromToken(String token, Function<Claims, T> claimsResolver) {
        final Claims claims = getAllClaimsFromToken(token);
        return claimsResolver.apply(claims);
    }

    private Claims getAllClaimsFromToken(String token) {
        return Jwts.parserBuilder()
                .setSigningKey(getSigningKey())
                .build()
                .parseClaimsJws(token)
                .getBody();
    }

    private Boolean isTokenExpired(String token) {
        final Date expiration = getExpirationDateFromToken(token);
        return expiration.before(new Date());
    }

    public void invalidateUserTokens(String username) {
        if (StringUtils.hasText(username)) {
            invalidatedBeforeMs.put(username, System.currentTimeMillis());
        }
    }

    public boolean isTokenRevoked(String token, String username) {
        Long cutoff = username != null ? invalidatedBeforeMs.get(username) : null;
        if (cutoff == null) {
            return false;
        }
        Claims claims = getAllClaimsFromToken(token);
        Number iatMsNum = claims.get("iatMs", Number.class);
        long issuedMs = iatMsNum != null
                ? iatMsNum.longValue()
                : (claims.getIssuedAt() != null ? claims.getIssuedAt().getTime() : 0L);
        return issuedMs < cutoff;
    }

    public Boolean validateToken(String token, UserDetails userDetails) {
        final String username = getUsernameFromToken(token);
        return (username.equals(userDetails.getUsername()) && !isTokenExpired(token) && !isTokenRevoked(token, username));
    }
}
