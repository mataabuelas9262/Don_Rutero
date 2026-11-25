package com.rutabus.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:rutabus_auth_beta_test;MODE=MySQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.sql.init.mode=never",
        "app.auth.require-email-verification=false",
        "app.auth.verify-email-mx=true"
})
class AuthControllerBetaRegisterTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void blocksFakeDomainsAndEnforcesStrictRegisterRateLimit() throws Exception {
        mockMvc.perform(post("/api/auth/register")
                        .with(req -> { req.setRemoteAddr("10.10.0.1"); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "username", "bot_example_01",
                                "email", "prueba_carga_001@example.com",
                                "password", "ClaveBeta123!"
                        ))))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/api/auth/register")
                        .with(req -> { req.setRemoteAddr("10.10.0.2"); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "username", "bot_typo_01",
                                "email", "ndkej.dksne@upsin.edu.mxx",
                                "password", "ClaveBeta123!"
                        ))))
                .andExpect(status().isBadRequest());

        // Tope estricto de 3 registros cada 10 minutos por IP (4to debe responder 429)
        String rateIp = "10.10.0.99";
        for (int i = 1; i <= 3; i++) {
            mockMvc.perform(post("/api/auth/register")
                            .with(req -> { req.setRemoteAddr(rateIp); return req; })
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of(
                                    "username", "pasajero_beta_" + i,
                                    "email", "pasajero_beta_" + i + "@gmail.com",
                                    "password", "ClaveBeta123!"
                            ))))
                    .andExpect(status().isCreated());
        }

        mockMvc.perform(post("/api/auth/register")
                        .with(req -> { req.setRemoteAddr(rateIp); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "username", "pasajero_beta_4",
                                "email", "pasajero_beta_4@gmail.com",
                                "password", "ClaveBeta123!"
                        ))))
                .andExpect(status().isTooManyRequests());
    }
}
