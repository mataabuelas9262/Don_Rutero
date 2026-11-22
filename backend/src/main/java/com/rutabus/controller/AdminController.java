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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private static final Pattern HEX_COLOR_PATTERN = Pattern.compile("^#[0-9A-Fa-f]{6}$");
    private static final int MAX_GEOMETRY_COORDS = 10000;
    private static final int MAX_ROUTE_STOPS = 500;

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

    private static final Set<String> VALID_REPORT_STATUSES = Set.of(
            "pendiente", "en_revision", "resuelto", "descartado"
    );

    private String validateAndSanitizeRoute(Route route) {
        if (route == null) return "Datos de ruta requeridos.";
        String name = route.getName() != null ? route.getName().trim() : "";
        if (name.isEmpty() || name.length() > 100) {
            return "El nombre de la ruta es obligatorio (1 a 100 caracteres).";
        }
        route.setName(name);
        if (route.getDescription() != null) {
            String desc = route.getDescription().trim();
            if (desc.length() > 2000) return "La descripción excede 2000 caracteres.";
            route.setDescription(desc);
        }
        String color = route.getColor() != null ? route.getColor().trim() : "#E63E21";
        if (!HEX_COLOR_PATTERN.matcher(color).matches()) {
            return "Color hexadecimal inválido (formato esperado #RRGGBB).";
        }
        route.setColor(color);
        if (route.getPrice() != null && (route.getPrice().isNaN() || route.getPrice() < 0 || route.getPrice() > 500)) {
            return "Tarifa normal fuera de rango permitido (0 a 500).";
        }
        if (route.getStudentPrice() == null) {
            route.setStudentPrice(3.5);
        } else if (route.getStudentPrice().isNaN() || route.getStudentPrice() < 0 || route.getStudentPrice() > 500) {
            return "Tarifa estudiantil fuera de rango permitido (0 a 500).";
        }
        if (route.getFrequencyMinutes() != null && (route.getFrequencyMinutes() < 1 || route.getFrequencyMinutes() > 300)) {
            return "Frecuencia en minutos debe estar entre 1 y 300.";
        }
        if (route.getActive() == null) {
            route.setActive(true);
        }
        return null;
    }

    private String validateAndSanitizeStop(Stop stop) {
        if (stop == null) return "Datos de parada requeridos.";
        String name = stop.getName() != null ? stop.getName().trim() : "";
        if (name.isEmpty() || name.length() > 100) {
            return "El nombre de la parada es obligatorio (1 a 100 caracteres).";
        }
        stop.setName(name);
        if (stop.getLatitude() == null || stop.getLatitude().isNaN() || stop.getLatitude() < -90.0 || stop.getLatitude() > 90.0) {
            return "Latitud inválida (-90 a 90).";
        }
        if (stop.getLongitude() == null || stop.getLongitude().isNaN() || stop.getLongitude() < -180.0 || stop.getLongitude() > 180.0) {
            return "Longitud inválida (-180 a 180).";
        }
        if (stop.getType() != null) {
            String t = stop.getType().trim();
            if (t.length() > 50) return "Tipo de parada excede 50 caracteres.";
            stop.setType(t);
        }
        if (stop.getAddress() != null) {
            String addr = stop.getAddress().trim();
            if (addr.length() > 255) return "Dirección de parada excede 255 caracteres.";
            stop.setAddress(addr);
        }
        return null;
    }

    private Map<String, Object> toAdminRouteMap(Route r, long coordCount, long stopCount) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", r.getId());
        item.put("name", r.getName());
        item.put("description", r.getDescription());
        item.put("color", r.getColor());
        item.put("active", Boolean.TRUE.equals(r.getActive()));
        item.put("price", r.getPrice());
        item.put("studentPrice", r.getStudentPrice());
        item.put("frequencyMinutes", r.getFrequencyMinutes());
        item.put("coordCount", coordCount);
        item.put("stopCount", stopCount);
        return item;
    }

    // -----------------------------------------------------
    // CONSULTA ENRIQUECIDA PARA PANEL ADMIN Y RESPALDO
    // -----------------------------------------------------

    @GetMapping("/routes")
    public List<Map<String, Object>> getAllAdminRoutes() {
        List<Route> routes = routeRepository.findAll(Sort.by(Sort.Direction.ASC, "id"));
        Map<Long, Long> coordCounts = new HashMap<>();
        for (Object[] row : routeCoordinateRepository.countCoordinatesByRoute()) {
            coordCounts.put(((Number) row[0]).longValue(), ((Number) row[1]).longValue());
        }
        Map<Long, Long> stopCounts = new HashMap<>();
        for (Object[] row : routeStopRepository.countStopsByRoute()) {
            stopCounts.put(((Number) row[0]).longValue(), ((Number) row[1]).longValue());
        }

        List<Map<String, Object>> result = new ArrayList<>(routes.size());
        for (Route r : routes) {
            result.add(toAdminRouteMap(
                    r,
                    coordCounts.getOrDefault(r.getId(), 0L),
                    stopCounts.getOrDefault(r.getId(), 0L)
            ));
        }
        return result;
    }

    @GetMapping("/routes/{id}/stops")
    public ResponseEntity<List<RouteStop>> getAdminRouteStops(@PathVariable Long id) {
        if (!routeRepository.existsById(id)) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(routeStopRepository.findByRouteIdOrderByStopOrderAsc(id));
    }

    @GetMapping("/routes/{id}/coordinates")
    public ResponseEntity<List<RouteCoordinate>> getAdminRouteCoordinates(@PathVariable Long id) {
        if (!routeRepository.existsById(id)) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(routeCoordinateRepository.findByRouteIdOrderBySequenceOrderAsc(id));
    }

    @GetMapping("/stops")
    public List<Map<String, Object>> getAllAdminStops() {
        List<Stop> stops = stopRepository.findAll(Sort.by(Sort.Direction.ASC, "name", "id"));
        Map<Long, List<String>> routesByStop = new HashMap<>();
        for (Object[] row : routeStopRepository.findStopRouteMappings()) {
            Long stopId = ((Number) row[0]).longValue();
            String routeName = String.valueOf(row[2]);
            routesByStop.computeIfAbsent(stopId, k -> new ArrayList<>());
            List<String> list = routesByStop.get(stopId);
            if (!list.contains(routeName)) {
                list.add(routeName);
            }
        }

        List<Map<String, Object>> result = new ArrayList<>(stops.size());
        for (Stop s : stops) {
            List<String> routeNames = routesByStop.getOrDefault(s.getId(), List.of());
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", s.getId());
            item.put("name", s.getName());
            item.put("latitude", s.getLatitude());
            item.put("longitude", s.getLongitude());
            item.put("type", s.getType());
            item.put("address", s.getAddress());
            item.put("routeCount", routeNames.size());
            item.put("routeNames", routeNames);
            result.add(item);
        }
        return result;
    }

    @GetMapping("/export")
    public Map<String, Object> exportFullCatalog() {
        List<Route> routes = routeRepository.findAll(Sort.by(Sort.Direction.ASC, "id"));
        List<Stop> stops = stopRepository.findAll(Sort.by(Sort.Direction.ASC, "id"));
        List<RouteCoordinate> allCoords = routeCoordinateRepository.findAllByOrderByRouteIdAscSequenceOrderAsc();
        List<RouteStop> allRouteStops = routeStopRepository.findAllByOrderByRouteIdAscStopOrderAsc();

        Map<Long, List<Map<String, Object>>> coordsByRoute = new HashMap<>();
        for (RouteCoordinate rc : allCoords) {
            Long rid = rc.getRoute().getId();
            Map<String, Object> pt = new LinkedHashMap<>();
            pt.put("latitude", rc.getLatitude());
            pt.put("longitude", rc.getLongitude());
            pt.put("sequenceOrder", rc.getSequenceOrder());
            coordsByRoute.computeIfAbsent(rid, k -> new ArrayList<>()).add(pt);
        }

        Map<Long, List<Long>> stopIdsByRoute = new HashMap<>();
        for (RouteStop rs : allRouteStops) {
            Long rid = rs.getRoute().getId();
            stopIdsByRoute.computeIfAbsent(rid, k -> new ArrayList<>()).add(rs.getStop().getId());
        }

        List<Map<String, Object>> exportedRoutes = new ArrayList<>(routes.size());
        for (Route r : routes) {
            List<Map<String, Object>> rCoords = coordsByRoute.getOrDefault(r.getId(), List.of());
            List<Long> rStopIds = stopIdsByRoute.getOrDefault(r.getId(), List.of());
            Map<String, Object> rMap = toAdminRouteMap(r, rCoords.size(), rStopIds.size());
            rMap.put("coordinates", rCoords);
            rMap.put("stopIds", rStopIds);
            exportedRoutes.add(rMap);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("exportedAt", Instant.now().toString());
        payload.put("routeCount", exportedRoutes.size());
        payload.put("stopCount", stops.size());
        payload.put("routes", exportedRoutes);
        payload.put("stops", stops);
        return payload;
    }

    // -----------------------------------------------------
    // CRUD DE RUTAS (ROUTES)
    // -----------------------------------------------------

    @PostMapping("/routes")
    public ResponseEntity<?> createRoute(@RequestBody Route route) {
        route.setId(null);
        String err = validateAndSanitizeRoute(route);
        if (err != null) return ResponseEntity.badRequest().body(Map.of("error", err));
        Route savedRoute = routeRepository.save(route);
        publicCatalogService.invalidateCache();
        return ResponseEntity.status(HttpStatus.CREATED).body(savedRoute);
    }

    @PutMapping("/routes/{id}")
    public ResponseEntity<?> updateRoute(@PathVariable Long id, @RequestBody Route routeDetails) {
        String err = validateAndSanitizeRoute(routeDetails);
        if (err != null) return ResponseEntity.badRequest().body(Map.of("error", err));
        return routeRepository.findById(id).<ResponseEntity<?>>map(route -> {
            route.setName(routeDetails.getName());
            route.setDescription(routeDetails.getDescription());
            route.setColor(routeDetails.getColor());
            route.setActive(routeDetails.getActive());
            route.setPrice(routeDetails.getPrice());
            route.setStudentPrice(routeDetails.getStudentPrice());
            route.setFrequencyMinutes(routeDetails.getFrequencyMinutes());
            Route saved = routeRepository.save(route);
            publicCatalogService.invalidateCache();
            return ResponseEntity.ok(saved);
        }).orElse(ResponseEntity.notFound().build());
    }

    @PatchMapping("/routes/{id}/active")
    public ResponseEntity<?> toggleRouteActive(@PathVariable Long id, @RequestBody(required = false) Map<String, Object> body) {
        return routeRepository.findById(id).<ResponseEntity<?>>map(route -> {
            boolean nextActive;
            if (body != null && body.get("active") instanceof Boolean b) {
                nextActive = b;
            } else {
                nextActive = !Boolean.TRUE.equals(route.getActive());
            }
            route.setActive(nextActive);
            Route saved = routeRepository.save(route);
            publicCatalogService.invalidateCache();
            return ResponseEntity.ok(Map.of(
                    "id", saved.getId(),
                    "active", Boolean.TRUE.equals(saved.getActive())
            ));
        }).orElse(ResponseEntity.notFound().build());
    }

    @Transactional
    @DeleteMapping("/routes/{id}")
    public ResponseEntity<?> deleteRoute(@PathVariable Long id) {
        return routeRepository.findById(id).map(route -> {
            routeCoordinateRepository.deleteByRouteId(id);
            routeStopRepository.deleteByRouteId(id);
            routeRepository.delete(route);
            publicCatalogService.invalidateCache();
            return ResponseEntity.ok(Map.of("message", "Ruta eliminada correctamente"));
        }).orElse(ResponseEntity.notFound().build());
    }

    // -----------------------------------------------------
    // CRUD DE PARADAS (STOPS)
    // -----------------------------------------------------

    @PostMapping("/stops")
    public ResponseEntity<?> createStop(@RequestBody Stop stop) {
        stop.setId(null);
        String err = validateAndSanitizeStop(stop);
        if (err != null) return ResponseEntity.badRequest().body(Map.of("error", err));
        Stop savedStop = stopRepository.save(stop);
        publicCatalogService.invalidateCache();
        return ResponseEntity.status(HttpStatus.CREATED).body(savedStop);
    }

    @PutMapping("/stops/{id}")
    public ResponseEntity<?> updateStop(@PathVariable Long id, @RequestBody Stop stopDetails) {
        String err = validateAndSanitizeStop(stopDetails);
        if (err != null) return ResponseEntity.badRequest().body(Map.of("error", err));
        return stopRepository.findById(id).<ResponseEntity<?>>map(stop -> {
            stop.setName(stopDetails.getName());
            stop.setLatitude(stopDetails.getLatitude());
            stop.setLongitude(stopDetails.getLongitude());
            if (stopDetails.getType() != null) stop.setType(stopDetails.getType());
            if (stopDetails.getAddress() != null) stop.setAddress(stopDetails.getAddress());
            Stop saved = stopRepository.save(stop);
            publicCatalogService.invalidateCache();
            return ResponseEntity.ok(saved);
        }).orElse(ResponseEntity.notFound().build());
    }

    @Transactional
    @DeleteMapping("/stops/{id}")
    public ResponseEntity<?> deleteStop(@PathVariable Long id) {
        return stopRepository.findById(id).map(stop -> {
            routeStopRepository.deleteByStopId(id);
            stopRepository.delete(stop);
            publicCatalogService.invalidateCache();
            return ResponseEntity.ok(Map.of("message", "Parada eliminada correctamente"));
        }).orElse(ResponseEntity.notFound().build());
    }

    // -----------------------------------------------------
    // GESTIÓN DE GEOMETRÍA Y RECORRIDO DE RUTA (TRAZADO)
    // -----------------------------------------------------

    @Transactional
    @PostMapping("/routes/{id}/geometry")
    public ResponseEntity<?> updateRouteGeometry(@PathVariable Long id, @RequestBody GeometryRequest request) {
        if (request == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Cuerpo de geometría requerido."));
        }
        List<CoordinateDTO> coords = request.getCoordinates();
        if (coords != null && coords.size() > MAX_GEOMETRY_COORDS) {
            return ResponseEntity.badRequest().body(Map.of("error", "El trazado excede el máximo de puntos permitidos."));
        }
        List<Long> rawStopIds = request.getStopIds();
        if (rawStopIds != null && rawStopIds.size() > MAX_ROUTE_STOPS) {
            return ResponseEntity.badRequest().body(Map.of("error", "La ruta excede el máximo de paradas permitidas."));
        }
        if (coords != null) {
            for (CoordinateDTO c : coords) {
                if (c == null || c.getLatitude() == null || c.getLongitude() == null
                        || c.getLatitude().isNaN() || c.getLongitude().isNaN()
                        || c.getLatitude() < -90.0 || c.getLatitude() > 90.0
                        || c.getLongitude() < -180.0 || c.getLongitude() > 180.0) {
                    return ResponseEntity.badRequest().body(Map.of("error", "Coordenadas de trazado inválidas."));
                }
            }
        }

        Route route = routeRepository.findById(id).orElse(null);
        if (route == null) {
            return ResponseEntity.notFound().build();
        }

        // Validar y deduplicar paradas solicitadas ANTES de borrar la geometría previa
        List<Stop> resolvedStops = new ArrayList<>();
        if (rawStopIds != null && !rawStopIds.isEmpty()) {
            Set<Long> uniqueStopIds = new LinkedHashSet<>();
            for (Long stopId : rawStopIds) {
                if (stopId == null) {
                    return ResponseEntity.badRequest().body(Map.of("error", "Parada solicitada inválida: null"));
                }
                uniqueStopIds.add(stopId);
            }
            for (Long stopId : uniqueStopIds) {
                Stop stop = stopRepository.findById(stopId).orElse(null);
                if (stop == null) {
                    return ResponseEntity.badRequest()
                            .body(Map.of("error", "Parada solicitada no existe: " + stopId));
                }
                resolvedStops.add(stop);
            }
        }

        // 1. Eliminar coordenadas y paradas anteriores asociadas a la ruta
        routeCoordinateRepository.deleteByRouteId(id);
        routeStopRepository.deleteByRouteId(id);

        // 2. Guardar nuevas coordenadas de trazado de la línea
        if (coords != null && !coords.isEmpty()) {
            List<RouteCoordinate> routeCoordsList = new ArrayList<>(coords.size());
            for (int i = 0; i < coords.size(); i++) {
                RouteCoordinate rc = new RouteCoordinate();
                rc.setRoute(route);
                rc.setLatitude(coords.get(i).getLatitude());
                rc.setLongitude(coords.get(i).getLongitude());
                rc.setSequenceOrder(i + 1);
                routeCoordsList.add(rc);
            }
            routeCoordinateRepository.saveAll(routeCoordsList);
        }

        // 3. Asociar paradas seleccionadas en orden
        if (!resolvedStops.isEmpty()) {
            List<RouteStop> routeStopsList = new ArrayList<>(resolvedStops.size());
            for (int i = 0; i < resolvedStops.size(); i++) {
                RouteStop rs = new RouteStop();
                rs.setRoute(route);
                rs.setStop(resolvedStops.get(i));
                rs.setStopOrder(i + 1);
                routeStopsList.add(rs);
            }
            routeStopRepository.saveAll(routeStopsList);
        }

        publicCatalogService.invalidateCache();
        return ResponseEntity.ok(Map.of("message", "Trazado y paradas de la ruta actualizados exitosamente"));
    }

    // -----------------------------------------------------
    // GESTIÓN DE REPORTES CIUDADANOS
    // -----------------------------------------------------

    @GetMapping("/reports")
    public List<RouteReport> getCitizenReports() {
        return routeReportRepository.findAllByOrderByCreatedAtDesc();
    }

    @PatchMapping("/reports/{id}")
    public ResponseEntity<?> updateCitizenReport(@PathVariable Long id, @RequestBody Map<String, String> body) {
        String rawStatus = body != null && body.get("status") != null ? body.get("status").trim().toLowerCase() : "";
        if (!VALID_REPORT_STATUSES.contains(rawStatus)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Estado inválido. Usa: pendiente, en_revision, resuelto o descartado."));
        }
        String note = body.get("adminNote") != null ? body.get("adminNote").trim() : null;
        if (note != null && note.length() > 500) {
            return ResponseEntity.badRequest().body(Map.of("error", "La nota de administrador no debe exceder 500 caracteres."));
        }

        return routeReportRepository.findById(id).<ResponseEntity<?>>map(report -> {
            report.setStatus(rawStatus);
            if (body.containsKey("adminNote")) {
                report.setAdminNote(note != null && !note.isEmpty() ? note : null);
            }
            report.setUpdatedAt(LocalDateTime.now());
            return ResponseEntity.ok(routeReportRepository.save(report));
        }).orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/reports/{id}")
    public ResponseEntity<?> deleteCitizenReport(@PathVariable Long id) {
        return routeReportRepository.findById(id).map(report -> {
            routeReportRepository.delete(report);
            return ResponseEntity.ok(Map.of("message", "Reporte eliminado"));
        }).orElse(ResponseEntity.notFound().build());
    }

    // DTOs para la petición de actualización geométrica
    public static class GeometryRequest {
        private List<CoordinateDTO> coordinates;
        private List<Long> stopIds;

        public List<CoordinateDTO> getCoordinates() {
            return coordinates;
        }

        public void setCoordinates(List<CoordinateDTO> coordinates) {
            this.coordinates = coordinates;
        }

        public List<Long> getStopIds() {
            return stopIds;
        }

        public void setStopIds(List<Long> stopIds) {
            this.stopIds = stopIds;
        }
    }

    public static class CoordinateDTO {
        private Double latitude;
        private Double longitude;

        public Double getLatitude() {
            return latitude;
        }

        public void setLatitude(Double latitude) {
            this.latitude = latitude;
        }

        public Double getLongitude() {
            return longitude;
        }

        public void setLongitude(Double longitude) {
            this.longitude = longitude;
        }
    }
}
