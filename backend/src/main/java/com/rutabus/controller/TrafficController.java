package com.rutabus.controller;

import com.rutabus.service.TrafficService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/traffic")
public class TrafficController {

    private final Map<String, long[]> telemetryRateLimits = new ConcurrentHashMap<>();

    @Autowired
    private TrafficService trafficService;

    private boolean isTelemetryRateLimited(HttpServletRequest req) {
        String ip = req != null ? req.getRemoteAddr() : "unknown";
        long now = System.currentTimeMillis();
        long[] bucket = telemetryRateLimits.compute(ip, (k, existing) -> {
            if (existing == null || now - existing[0] >= 60_000L) {
                return new long[]{now, 1L};
            }
            existing[1]++;
            return existing;
        });
        if (telemetryRateLimits.size() > 3000) {
            telemetryRateLimits.entrySet().removeIf(e -> now - e.getValue()[0] >= 60_000L);
        }
        return bucket[1] > 15;
    }

    @GetMapping("/live")
    public ResponseEntity<Map<String, Object>> getLiveTraffic() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(30, TimeUnit.SECONDS).cachePublic())
                .body(trafficService.getLiveTrafficSummary());
    }

    @PostMapping("/telemetry")
    public ResponseEntity<?> submitTelemetryPing(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        if (isTelemetryRateLimited(req)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiados reportes de telemetría seguidos."));
        }
        if (body == null || !(body.get("lat") instanceof Number latN)
                || !(body.get("lng") instanceof Number lngN)
                || !(body.get("speedKmh") instanceof Number spdN)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Datos de telemetría incompletos."));
        }

        boolean accepted = trafficService.recordTelemetryPing(
                latN.doubleValue(), lngN.doubleValue(), spdN.doubleValue()
        );
        if (!accepted) {
            return ResponseEntity.badRequest().body(Map.of("error", "Lectura fuera de Mazatlán o velocidad inválida."));
        }
        return ResponseEntity.accepted().body(Map.of("ok", true));
    }

    @GetMapping("/tiles/{z}/{x}/{y}.png")
    public ResponseEntity<byte[]> getTrafficTile(@PathVariable int z, @PathVariable int x, @PathVariable int y) {
        if (!trafficService.isTomTomEnabled()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
        if (!trafficService.isTileInMazatlan(z, x, y)) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).build();
        }
        byte[] png = trafficService.getTrafficFlowTile(z, x, y);
        if (png == null || png.length == 0) {
            return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
        }
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_PNG)
                .cacheControl(CacheControl.maxAge(60, TimeUnit.SECONDS).cachePublic())
                .body(png);
    }
}
