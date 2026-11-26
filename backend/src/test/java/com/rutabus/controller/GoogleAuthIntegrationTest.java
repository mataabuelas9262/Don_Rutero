package com.rutabus.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rutabus.entity.User;
import com.rutabus.repository.UserRepository;
import com.rutabus.service.GoogleAuthService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:rutabus_google_auth_test;MODE=MySQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.sql.init.mode=never",
        "app.auth.google-client-id=test-google-client-id.apps.googleusercontent.com"
})
class GoogleAuthIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private GoogleAuthService googleAuthService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private void installStubDecoder() {
        JwtDecoder stub = token -> {
            if ("valid-new-user".equals(token)) {
                return Jwt.withTokenValue(token)
                        .header("alg", "RS256")
                        .subject("google-sub-1")
                        .issuer("https://accounts.google.com")
                        .audience(List.of("test-google-client-id.apps.googleusercontent.com"))
                        .issuedAt(Instant.now())
                        .expiresAt(Instant.now().plusSeconds(300))
                        .claim("email", "estudiante.mzt@gmail.com")
                        .claim("email_verified", true)
                        .claim("name", "José Luis Pérez")
                        .build();
            }
            if ("valid-admin-user".equals(token)) {
                return Jwt.withTokenValue(token)
                        .header("alg", "RS256")
                        .subject("google-sub-admin")
                        .issuer("https://accounts.google.com")
                        .audience(List.of("test-google-client-id.apps.googleusercontent.com"))
                        .issuedAt(Instant.now())
                        .expiresAt(Instant.now().plusSeconds(300))
                        .claim("email", "admin_mzt@gmail.com")
                        .claim("email_verified", true)
                        .claim("name", "Admin MZT")
                        .build();
            }
            if ("unverified-email".equals(token)) {
                return Jwt.withTokenValue(token)
                        .header("alg", "RS256")
                        .subject("google-sub-unv")
                        .issuer("https://accounts.google.com")
                        .audience(List.of("test-google-client-id.apps.googleusercontent.com"))
                        .issuedAt(Instant.now())
                        .expiresAt(Instant.now().plusSeconds(300))
                        .claim("email", "unverified@gmail.com")
                        .claim("email_verified", false)
                        .build();
            }
            throw new JwtException("Invalid token");
        };
        try {
            var m = GoogleAuthService.class.getDeclaredMethod("setJwtDecoderForTests", JwtDecoder.class);
            m.setAccessible(true);
            m.invoke(googleAuthService, stub);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @Test
    void googleSignInCreatesUserReusesExistingAccountAndRejectsInvalidTokens() throws Exception {
        installStubDecoder();

        mockMvc.perform(get("/api/auth/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.googleEnabled", is(true)))
                .andExpect(jsonPath("$.googleClientId", is("test-google-client-id.apps.googleusercontent.com")));

        MvcResult firstRes = mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("credential", "valid-new-user"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token", notNullValue()))
                .andExpect(jsonPath("$.role", is("ROLE_USER")))
                .andExpect(jsonPath("$.googleNewUser", is(true)))
                .andReturn();

        JsonNode firstJson = objectMapper.readTree(firstRes.getResponse().getContentAsString());
        String createdUsername = firstJson.get("username").asText();
        User savedGoogleUser = userRepository.findByEmail("estudiante.mzt@gmail.com").orElseThrow();
        assertNotNull(savedGoogleUser.getCreatedAt());

        // Segundo acceso con el mismo correo reutiliza exactamente la misma cuenta sin duplicar
        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("credential", "valid-new-user"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username", is(createdUsername)))
                .andExpect(jsonPath("$.googleNewUser", is(false)));

        // Si un correo existente es ROLE_ADMIN, conserva su rol al iniciar sesión con Google
        User admin = new User();
        admin.setUsername("admin_google_ok");
        admin.setEmail("admin_mzt@gmail.com");
        admin.setPassword(passwordEncoder.encode("AdminStrong!99"));
        admin.setRole("ROLE_ADMIN");
        userRepository.save(admin);

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("credential", "valid-admin-user"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username", is("admin_google_ok")))
                .andExpect(jsonPath("$.role", is("ROLE_ADMIN")));

        // Rechazar correo no verificado y credencial inválida
        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("credential", "unverified-email"))))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("credential", "tampered-jwt"))))
                .andExpect(status().isUnauthorized());
    }
}
