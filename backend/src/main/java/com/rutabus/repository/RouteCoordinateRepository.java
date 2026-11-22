package com.rutabus.repository;

import com.rutabus.entity.RouteCoordinate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface RouteCoordinateRepository extends JpaRepository<RouteCoordinate, Long> {
    List<RouteCoordinate> findByRouteIdOrderBySequenceOrderAsc(Long routeId);
    List<RouteCoordinate> findAllByOrderByRouteIdAscSequenceOrderAsc();
    void deleteByRouteId(Long routeId);

    @Query("SELECT rc.route.id, COUNT(rc) FROM RouteCoordinate rc GROUP BY rc.route.id")
    List<Object[]> countCoordinatesByRoute();
}
