package com.rutabus.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Entity
@Table(name = "route_reports")
@Data
@NoArgsConstructor
public class RouteReport {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 40)
    private String type;

    @Column(name = "route_or_place", nullable = false, length = 160)
    private String routeOrPlace;

    @Column(nullable = false, length = 1500)
    private String description;

    @Column(nullable = false, length = 30)
    private String status = "pendiente";

    @Column(name = "admin_note", length = 500)
    private String adminNote;

    @Column(name = "reporter_username", length = 60)
    private String reporterUsername;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
