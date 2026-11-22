package com.rutabus.controller;

import com.rutabus.entity.Route;
import com.rutabus.entity.RouteCoordinate;
import com.rutabus.entity.RouteStop;
import com.rutabus.entity.Stop;
import com.rutabus.repository.RouteCoordinateRepository;
import com.rutabus.repository.RouteRepository;
import com.rutabus.repository.RouteStopRepository;
import com.rutabus.repository.StopRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

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
}
