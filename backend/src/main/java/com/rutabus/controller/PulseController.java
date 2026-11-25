package com.rutabus.controller;

import com.rutabus.service.CommunityPulseService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/pulse")
public class PulseController {

    @Autowired
    private CommunityPulseService communityPulseService;

    private final Map<String, long[]> writeRateLimits = new ConcurrentHashMap<>();

    private boolean isWriteRateLimited(HttpServletRequest req) {
        String ip = req != null && req.getRemoteAddr() != null ? req.getRemoteAddr() : "unknown";
        long now = System.currentTimeMillis();
        long[] bucket = writeRateLimits.compute(ip, (k, existing) -> {
            if (existing == null || now - existing[0] >= 60_000L) {
                return new long[]{now, 1L};
            }
            existing[1]++;
            return existing;
        });
        if (writeRateLimits.size() > 2000) {
            writeRateLimits.entrySet().removeIf(e -> now - e.getValue()[0] >= 60_000L);
        }
        return bucket[1] > 18;
    }

    private String resolveReporterKey(HttpServletRequest req) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getPrincipal())) {
            return "user:" + auth.getName();
        }
        String ip = req != null && req.getRemoteAddr() != null ? req.getRemoteAddr() : "unknown";
        return "ip:" + ip;
    }

    private boolean isCurrentAdmin() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.isAuthenticated()
                && auth.getAuthorities().stream().anyMatch(a -> "ROLE_ADMIN".equals(a.getAuthority()));
    }

    @GetMapping("/live")
    public ResponseEntity<Map<String, Object>> getLivePulse() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(10, TimeUnit.SECONDS).cachePublic())
                .body(communityPulseService.getLivePulseSnapshot());
    }

    @PostMapping("/sightings")
    public ResponseEntity<?> postBusSighting(
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest req) {
        if (isWriteRateLimited(req)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiados reportes seguidos. Espera un momento."));
        }
        if (body == null || body.get("routeId") == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "routeId es requerido."));
        }
        try {
            Long routeId = ((Number) body.get("routeId")).longValue();
            String routeName = body.get("routeName") != null ? String.valueOf(body.get("routeName")) : null;
            String direction = body.get("direction") != null ? String.valueOf(body.get("direction")) : "IDA";
            String stopName = body.get("stopName") != null ? String.valueOf(body.get("stopName")) : "";

            Map<String, Object> res = communityPulseService.recordBusSighting(
                    routeId, routeName, direction, stopName, resolveReporterKey(req));
            if (Boolean.TRUE.equals(res.get("rateLimited"))) {
                return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(res);
            }
            return ResponseEntity.status(HttpStatus.CREATED).body(res);
        } catch (ClassCastException | IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/incidents")
    public ResponseEntity<?> postIncident(
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest req) {
        if (isWriteRateLimited(req)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiados reportes seguidos. Espera un momento."));
        }
        if (body == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Datos requeridos."));
        }
        try {
            String type = body.get("type") != null ? String.valueOf(body.get("type")) : "bloqueo";
            String zoneKey = body.get("zoneKey") != null ? String.valueOf(body.get("zoneKey")) : "";
            String zoneLabel = body.get("zoneLabel") != null ? String.valueOf(body.get("zoneLabel")) : "";
            String description = body.get("description") != null ? String.valueOf(body.get("description")) : "";
            Double lat = (body.get("latitude") instanceof Number n) ? n.doubleValue() : null;
            Double lng = (body.get("longitude") instanceof Number n) ? n.doubleValue() : null;

            Map<String, Object> res = communityPulseService.reportIncident(
                    type, zoneKey, zoneLabel, description, lat, lng, resolveReporterKey(req));
            return ResponseEntity.status(HttpStatus.CREATED).body(res);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/incidents/{zoneKey}/clear")
    public ResponseEntity<?> confirmZoneClear(@PathVariable String zoneKey, HttpServletRequest req) {
        if (isWriteRateLimited(req)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiadas solicitudes. Espera un momento."));
        }
        try {
            return ResponseEntity.ok(communityPulseService.confirmZoneClear(
                    zoneKey, resolveReporterKey(req), isCurrentAdmin()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/notices/{id}/clear")
    public ResponseEntity<?> confirmNoticeClear(@PathVariable Long id, HttpServletRequest req) {
        if (isWriteRateLimited(req)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiadas solicitudes. Espera un momento."));
        }
        try {
            Map<String, Object> res = communityPulseService.confirmNoticeClear(
                    id, resolveReporterKey(req), isCurrentAdmin());
            if (!Boolean.TRUE.equals(res.get("found"))) {
                return ResponseEntity.notFound().build();
            }
            return ResponseEntity.ok(res);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
