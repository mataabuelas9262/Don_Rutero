package com.rutabus.service;

import com.rutabus.entity.Route;
import com.rutabus.entity.RouteCoordinate;
import com.rutabus.entity.RouteStop;
import com.rutabus.entity.Stop;
import com.rutabus.repository.RouteCoordinateRepository;
import com.rutabus.repository.RouteRepository;
import com.rutabus.repository.RouteStopRepository;
import com.rutabus.repository.StopRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class PublicCatalogService {

    @Autowired
    private RouteRepository routeRepository;

    @Autowired
    private StopRepository stopRepository;

    @Autowired
    private RouteCoordinateRepository routeCoordinateRepository;

    @Autowired
    private RouteStopRepository routeStopRepository;

    private volatile Map<String, Object> cachedBootstrap;

    public Map<String, Object> getBootstrapPayload() {
        Map<String, Object> snapshot = this.cachedBootstrap;
        if (snapshot != null) {
            return snapshot;
        }
        synchronized (this) {
            if (this.cachedBootstrap != null) {
                return this.cachedBootstrap;
            }
            List<Route> activeRoutes = new ArrayList<>(routeRepository.findByActiveTrue());
            activeRoutes.sort(Comparator.comparing(Route::getId));

            Set<Long> activeIds = new HashSet<>(activeRoutes.size());
            for (Route r : activeRoutes) {
                activeIds.add(r.getId());
            }

            List<Stop> allStops = stopRepository.findAll(Sort.by(Sort.Direction.ASC, "id"));

            Map<Long, List<double[]>> coordsByRoute = new LinkedHashMap<>();
            for (RouteCoordinate rc : routeCoordinateRepository.findAllByOrderByRouteIdAscSequenceOrderAsc()) {
                Long rid = rc.getRoute().getId();
                if (activeIds.contains(rid)) {
                    coordsByRoute.computeIfAbsent(rid, k -> new ArrayList<>())
                            .add(new double[]{rc.getLatitude(), rc.getLongitude()});
                }
            }

            Map<Long, List<Long>> stopIdsByRoute = new LinkedHashMap<>();
            for (RouteStop rs : routeStopRepository.findAllByOrderByRouteIdAscStopOrderAsc()) {
                Long rid = rs.getRoute().getId();
                if (activeIds.contains(rid)) {
                    stopIdsByRoute.computeIfAbsent(rid, k -> new ArrayList<>())
                            .add(rs.getStop().getId());
                }
            }

            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("routes", activeRoutes);
            payload.put("stops", allStops);
            payload.put("coordsByRoute", coordsByRoute);
            payload.put("stopIdsByRoute", stopIdsByRoute);

            Map<String, Object> immutable = Collections.unmodifiableMap(payload);
            this.cachedBootstrap = immutable;
            return immutable;
        }
    }

    public void invalidateCache() {
        this.cachedBootstrap = null;
    }
}
