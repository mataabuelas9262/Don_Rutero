package com.rutabus.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rutabus.security.JwtTokenProvider;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:rutabus_pulse_test;MODE=MySQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.sql.init.mode=never",
        "spring.mail.host="
})
class PulseControllerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Test
    void sightingIncidentAutoEscalateAndCommunityClearFlow() throws Exception {
        // 1. Avistamiento de camión ("¡Vi pasar este camión!")
        mockMvc.perform(post("/api/pulse/sightings")
                        .with(req -> { req.setRemoteAddr("10.0.0.10"); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "routeId", 1,
                                "routeName", "Sábalo Centro",
                                "direction", "IDA",
                                "stopName", "Acuario"
                        ))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.summary.count", is(1)))
                .andExpect(jsonPath("$.summary.stopName", is("Acuario")));

        mockMvc.perform(get("/api/pulse/live"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sightingsByRoute['1'].count", is(1)));

        // 2. Anti-spam: 3 reportes de bloqueo de la MISMA persona/IP no deben auto-escalar (se queda en 1/3)
        String incidentPayload = objectMapper.writeValueAsString(Map.of(
                "type", "bloqueo",
                "zoneKey", "malecon",
                "zoneLabel", "Av. Del Mar (Malecón)",
                "description", "Cierre frente al Acuario",
                "latitude", 23.2279,
                "longitude", -106.4275
        ));
        for (int i = 0; i < 3; i++) {
            mockMvc.perform(post("/api/pulse/incidents")
                            .with(req -> { req.setRemoteAddr("10.0.1.1"); return req; })
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(incidentPayload))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.distinctReporters", is(1)))
                    .andExpect(jsonPath("$.escalated", is(false)));
        }

        // 3. Reporte #2 y #3 de personas distintas -> al #3 auto-escala a Notificaciones de Don Rutero
        mockMvc.perform(post("/api/pulse/incidents")
                        .with(req -> { req.setRemoteAddr("10.0.1.2"); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(incidentPayload))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.distinctReporters", is(2)))
                .andExpect(jsonPath("$.escalated", is(false)));

        MvcResult escalatedRes = mockMvc.perform(post("/api/pulse/incidents")
                        .with(req -> { req.setRemoteAddr("10.0.1.3"); return req; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(incidentPayload))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.distinctReporters", is(3)))
                .andExpect(jsonPath("$.escalated", is(true)))
                .andExpect(jsonPath("$.escalatedNow", is(true)))
                .andExpect(jsonPath("$.noticeId", notNullValue()))
                .andReturn();

        long noticeId = objectMapper.readTree(escalatedRes.getResponse().getContentAsString())
                .get("noticeId").asLong();

        mockMvc.perform(get("/api/pulse/live"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activeNotices[?(@.id == " + noticeId + ")]", hasSize(1)));

        // 4. Confirmación ciudadana de "Ya está todo bien": 1ra confirmación mantiene aviso; 2da lo quita
        mockMvc.perform(post("/api/pulse/notices/" + noticeId + "/clear")
                        .with(req -> { req.setRemoteAddr("10.0.2.1"); return req; }))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cleared", is(false)));

        mockMvc.perform(post("/api/pulse/notices/" + noticeId + "/clear")
                        .with(req -> { req.setRemoteAddr("10.0.2.2"); return req; }))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cleared", is(true)));

        mockMvc.perform(get("/api/pulse/live"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activeNotices[?(@.id == " + noticeId + ")]", hasSize(0)));
    }

    @Test
    void adminCanPublishAndDismissFalsePositiveNotices() throws Exception {
        String adminToken = jwtTokenProvider.generateToken("admin", "ROLE_ADMIN");

        // Bloquear acceso anónimo al endpoint admin
        mockMvc.perform(get("/api/admin/notices"))
                .andExpect(status().isForbidden());

        // Admin publica aviso manual con banner
        MvcResult created = mockMvc.perform(post("/api/admin/notices")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "title", "Carnaval Mazatlán",
                                "body", "Malecón cerrado por desfile, baja por Av. Ejército Mexicano.",
                                "severity", "warning",
                                "zoneLabel", "Malecón",
                                "pinBanner", true,
                                "durationHours", 12
                        ))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title", is("Carnaval Mazatlán")))
                .andExpect(jsonPath("$.origin", is("admin")))
                .andReturn();

        long adminNoticeId = objectMapper.readTree(created.getResponse().getContentAsString()).get("id").asLong();

        mockMvc.perform(get("/api/admin/notices")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == " + adminNoticeId + ")]", hasSize(1)));

        // Un ciudadano NO puede quitar un aviso oficial creado por admin
        mockMvc.perform(post("/api/pulse/notices/" + adminNoticeId + "/clear")
                        .with(req -> { req.setRemoteAddr("10.0.8.8"); return req; }))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cleared", is(false)));

        // Simular otro bloqueo falso escalado por 3 reportes y verificar que admin lo quita al instante
        for (int i = 1; i <= 3; i++) {
            final String ip = "10.0.9." + i;
            mockMvc.perform(post("/api/pulse/incidents")
                            .with(req -> { req.setRemoteAddr(ip); return req; })
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of(
                                    "type", "bloqueo",
                                    "zoneKey", "buelna_test",
                                    "zoneLabel", "Av. Rafael Buelna",
                                    "description", "Reporte falso"
                            ))))
                    .andExpect(status().isCreated());
        }

        MvcResult liveBefore = mockMvc.perform(get("/api/pulse/live")).andExpect(status().isOk()).andReturn();
        JsonNode active = objectMapper.readTree(liveBefore.getResponse().getContentAsString()).get("activeNotices");
        long falseNoticeId = -1;
        for (JsonNode n : active) {
            if ("buelna_test".equals(n.path("zoneKey").asText())) {
                falseNoticeId = n.path("id").asLong();
            }
        }
        org.junit.jupiter.api.Assertions.assertTrue(falseNoticeId > 0);

        mockMvc.perform(patch("/api/admin/notices/" + falseNoticeId + "/dismiss")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/pulse/live"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activeNotices[?(@.id == " + falseNoticeId + ")]", hasSize(0)));
    }
}
