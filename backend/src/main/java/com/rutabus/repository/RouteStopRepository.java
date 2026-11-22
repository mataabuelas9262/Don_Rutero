package com.rutabus.repository;

import com.rutabus.entity.RouteStop;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface RouteStopRepository extends JpaRepository<RouteStop, Long> {
    List<RouteStop> findByRouteIdOrderByStopOrderAsc(Long routeId);
    List<RouteStop> findAllByOrderByRouteIdAscStopOrderAsc();
    void deleteByRouteId(Long routeId);
    void deleteByStopId(Long stopId);

    @Query("SELECT rs.route.id, COUNT(rs) FROM RouteStop rs GROUP BY rs.route.id")
    List<Object[]> countStopsByRoute();

    @Query("SELECT rs.stop.id, rs.route.id, rs.route.name FROM RouteStop rs ORDER BY rs.route.id ASC, rs.stopOrder ASC")
    List<Object[]> findStopRouteMappings();
}
