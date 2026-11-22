package com.rutabus.repository;

import com.rutabus.entity.RouteReport;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface RouteReportRepository extends JpaRepository<RouteReport, Long> {
    List<RouteReport> findAllByOrderByCreatedAtDesc();
}
