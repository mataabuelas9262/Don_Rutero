package com.rutabus.controller;

import com.rutabus.entity.Route;
import com.rutabus.entity.RouteCoordinate;
import com.rutabus.entity.RouteReport;
import com.rutabus.entity.RouteStop;
import com.rutabus.entity.Stop;
import com.rutabus.repository.RouteCoordinateRepository;
import com.rutabus.repository.RouteReportRepository;
import com.rutabus.repository.RouteRepository;
import com.rutabus.repository.RouteStopRepository;
import com.rutabus.repository.StopRepository;
import com.rutabus.service.PublicCatalogService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api/routes")
public class RouteController {

    @Autowired
    private RouteRepository routeRepository;

    @Autowired
    private StopRepository stopRepository;

    @Autowired
    private RouteStopRepository routeStopRepository;

    @Autowired
    private RouteCoordinateRepository routeCoordinateRepository;

    @Autowired
    private PublicCatalogService publicCatalogService;

    @Autowired
    private RouteReportRepository routeReportRepository;

    private static final Set<String> VALID_REPORT_TYPES = Set.of(
            "desvio", "nueva_parada", "falta_ruta", "correccion", "general"
    );
    private final Map<String, long[]> reportRateLimits = new ConcurrentHashMap<>();

    private boolean isReportRateLimited(HttpServletRequest req) {
        String ip = req != null ? req.getRemoteAddr() : "unknown";
        long now = System.currentTimeMillis();
        long[] bucket = reportRateLimits.compute(ip, (k, existing) -> {
            if (existing == null || now - existing[0] >= 60_000L) {
                return new long[]{now, 1L};
            }
            existing[1]++;
            return existing;
        });
        if (reportRateLimits.size() > 2000) {
            reportRateLimits.entrySet().removeIf(e -> now - e.getValue()[0] >= 60_000L);
        }
        return bucket[1] > 6;
    }

    // Carga inicial consolidada en una sola respuesta gzippeada (rutas activas, paradas, coordenadas y secuencias)
    @GetMapping("/bootstrap")
    public Map<String, Object> getPublicBootstrap() {
        return publicCatalogService.getBootstrapPayload();
    }

    // Obtener todas las rutas activas
    @GetMapping
    public List<Route> getAllRoutes() {
        return routeRepository.findByActiveTrue();
    }

    // Obtener detalles de una ruta activa específica
    @GetMapping("/{id}")
    public ResponseEntity<Route> getRouteById(@PathVariable Long id) {
        return routeRepository.findById(id)
                .filter(r -> Boolean.TRUE.equals(r.getActive()))
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    // Obtener las paradas asociadas a una ruta activa, en orden
    @GetMapping("/{id}/stops")
    public ResponseEntity<List<RouteStop>> getRouteStops(@PathVariable Long id) {
        return routeRepository.findById(id)
                .filter(r -> Boolean.TRUE.equals(r.getActive()))
                .map(r -> ResponseEntity.ok(routeStopRepository.findByRouteIdOrderByStopOrderAsc(id)))
                .orElse(ResponseEntity.notFound().build());
    }

    // Obtener el trazado de coordenadas de una ruta activa, en orden
    @GetMapping("/{id}/coordinates")
    public ResponseEntity<List<RouteCoordinate>> getRouteCoordinates(@PathVariable Long id) {
        return routeRepository.findById(id)
                .filter(r -> Boolean.TRUE.equals(r.getActive()))
                .map(r -> ResponseEntity.ok(routeCoordinateRepository.findByRouteIdOrderBySequenceOrderAsc(id)))
                .orElse(ResponseEntity.notFound().build());
    }

    // Obtener todas las paradas físicas registradas (útil para mostrarlas en el mapa o buscador)
    @GetMapping("/stops")
    public List<Stop> getAllStops() {
        return stopRepository.findAll();
    }

    // Recibir reportes ciudadanos / sugerencias de rutas o paradas
    @PostMapping("/reports")
    public ResponseEntity<?> submitCitizenReport(@RequestBody Map<String, String> body, HttpServletRequest req) {
        if (isReportRateLimited(req)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Demasiados reportes seguidos. Espera un minuto e inténtalo de nuevo."));
        }

        String rawType = body != null && body.get("type") != null ? body.get("type").trim().toLowerCase() : "general";
        String type = VALID_REPORT_TYPES.contains(rawType) ? rawType : "general";
        String routeOrPlace = body != null && body.get("route") != null ? body.get("route").trim() : "";
        String description = body != null && body.get("description") != null ? body.get("description").trim() : "";

        if (routeOrPlace.length() < 2 || routeOrPlace.length() > 160) {
            return ResponseEntity.badRequest().body(Map.of("error", "Indica la ruta, colonia o lugar (2 a 160 caracteres)."));
        }
        if (description.length() < 5 || description.length() > 1500) {
            return ResponseEntity.badRequest().body(Map.of("error", "Describe tu reporte o sugerencia (5 a 1500 caracteres)."));
        }

        RouteReport report = new RouteReport();
        report.setType(type);
        report.setRouteOrPlace(routeOrPlace);
        report.setDescription(description);
        report.setStatus("pendiente");
        report.setCreatedAt(LocalDateTime.now());

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getPrincipal())) {
            String uname = auth.getName();
            if (uname != null && uname.length() <= 60) {
                report.setReporterUsername(uname);
            }
        }

        RouteReport saved = routeReportRepository.save(report);
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                "id", saved.getId(),
                "message", "Reporte recibido correctamente. Gracias por ayudar a mejorar Don Rutero."
        ));
    }
}
