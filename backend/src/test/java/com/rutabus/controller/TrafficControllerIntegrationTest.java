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

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:rutabus_traffic_test;MODE=MySQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.sql.init.mode=never",
        "spring.mail.host=",
        "app.traffic.tomtom-api-key="
})
class TrafficControllerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void returnsLiveCorridorsAndBlendsAnonymousTelemetrySafely() throws Exception {
        mockMvc.perform(get("/api/traffic/live"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.corridors", hasSize(8)))
                .andExpect(jsonPath("$.avgBusSpeedKmh", greaterThan(5.0)));

        // Reject out-of-bounds Mazatlan coordinates
        mockMvc.perform(post("/api/traffic/telemetry")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "lat", 19.4326, "lng", -99.1332, "speedKmh", 20.0))))
                .andExpect(status().isBadRequest());

        // Reject bogus speed
        mockMvc.perform(post("/api/traffic/telemetry")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "lat", 23.2448, "lng", -106.4367, "speedKmh", 180.0))))
                .andExpect(status().isBadRequest());

        // Accept valid Mazatlan telemetry near Av. Rafael Buelna
        mockMvc.perform(post("/api/traffic/telemetry")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "lat", 23.2448, "lng", -106.4367, "speedKmh", 9.5))))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.ok").value(true));

        // Live endpoint should now reflect community telemetry
        mockMvc.perform(get("/api/traffic/live"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.source", containsString("gps_comunitario")))
                .andExpect(jsonPath("$.communityCells", hasSize(greaterThanOrEqualTo(1))));
    }

    @Test
    void tileProxyReturnsNotFoundWithoutKeyAndNeverLeaksOutsideMazatlan() throws Exception {
        mockMvc.perform(get("/api/traffic/tiles/13/1672/3554.png"))
                .andExpect(status().isNotFound());
    }
}
