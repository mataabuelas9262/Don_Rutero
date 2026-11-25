package com.rutabus.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:rutabus_auth_test;MODE=MySQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.sql.init.mode=never",
        "spring.mail.host=",
        "app.auth.require-email-verification=true",
        "app.auth.expose-demo-codes=true",
        "app.auth.verify-email-mx=true"
})
class AuthControllerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void rejectsNonExistentMailDomainWithBadRequest() throws Exception {
        mockMvc.perform(post("/api/auth/send-verification")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("email", "usuario@dominionoexiste998877.com"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", containsString("dominio")));
    }

    @Test
    void fullAuthLifecycleStrongPasswordEmailLoginAndReset() throws Exception {
        String email = "tester_v1_" + System.nanoTime() + "@gmail.com";
        String username = "user_" + Math.abs(email.hashCode());

        // 1. Auth config
        mockMvc.perform(get("/api/auth/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requireEmailVerification").value(true))
                .andExpect(jsonPath("$.smtpConfigured").value(false));

        // 2. Send verification code
        MvcResult sendRes = mockMvc.perform(post("/api/auth/send-verification")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("email", email))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code", matchesPattern("\\d{6}")))
                .andReturn();

        JsonNode sendJson = objectMapper.readTree(sendRes.getResponse().getContentAsString());
        String code = sendJson.get("code").asText();

        // 3. Reject weak password (missing uppercase & symbol)
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "email", email,
                                "username", username,
                                "password", "password123",
                                "verificationCode", code))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", containsString("símbolo")));

        // 4. Register with strong password
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "email", email,
                                "username", username,
                                "password", "RutaMzt#2026",
                                "verificationCode", code))))
                .andExpect(status().isCreated());

        // 5. Login by EMAIL (not only username)
        MvcResult loginRes = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "username", email,
                                "password", "RutaMzt#2026"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(username))
                .andExpect(jsonPath("$.token", not(emptyOrNullString())))
                .andReturn();

        String token = objectMapper.readTree(loginRes.getResponse().getContentAsString()).get("token").asText();

        // 6. Change password rejects weak password & accepts strong password
        mockMvc.perform(post("/api/auth/change-password")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "currentPassword", "RutaMzt#2026",
                                "newPassword", "debil123"))))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/api/auth/change-password")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "currentPassword", "RutaMzt#2026",
                                "newPassword", "CambioSeg$77"))))
                .andExpect(status().isOk());

        // Old token issued before password change must be invalidated immediately
        mockMvc.perform(get("/api/auth/verify")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());

        // 7. Forgot password rejects unregistered email & succeeds for registered email
        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("email", "noregistrado_999@gmail.com"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error", containsString("No encontramos")));

        MvcResult forgotRes = mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("email", email))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code", matchesPattern("\\d{6}")))
                .andReturn();

        String resetCode = objectMapper.readTree(forgotRes.getResponse().getContentAsString()).get("code").asText();

        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "email", email,
                                "code", resetCode,
                                "newPassword", "Recupera!88"))))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "username", email,
                                "password", "Recupera!88"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(username));

        // 8. Brute-force protection per account returns 429 after 11 failed logins
        for (int i = 0; i < 11; i++) {
            mockMvc.perform(post("/api/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of(
                                    "username", "bruteforce_target_acct",
                                    "password", "Wrong#1234"))))
                    .andExpect(status().isUnauthorized());
        }
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "username", "bruteforce_target_acct",
                                "password", "Wrong#1234"))))
                .andExpect(status().isTooManyRequests());
    }
}
