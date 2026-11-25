package com.rutabus.service;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Service;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.text.Normalizer;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class CommunityPulseService {

    private static final Logger log = LoggerFactory.getLogger(CommunityPulseService.class);

    public static final int INCIDENT_ESCALATE_THRESHOLD = 3;
    public static final int COMMUNITY_CLEAR_THRESHOLD = 2;
    private static final long SIGHTING_TTL_MS = 15 * 60_000L;
    private static final long INCIDENT_TTL_MS = 2 * 60 * 60_000L;
    private static final long DEFAULT_AUTO_NOTICE_TTL_MS = 3 * 60 * 60_000L;
    private static final int MAX_SIGHTING_ROUTES = 200;
    private static final int MAX_INCIDENT_ZONES = 250;

    private static final Set<String> VALID_INCIDENT_TYPES = Set.of(
            "bloqueo", "inundacion", "desvio", "sin_servicio"
    );
    private static final Set<String> VALID_SEVERITIES = Set.of("info", "warning", "danger");

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private static class SightingEntry {
        final String reporterKey;
        final String routeName;
        final String direction;
        final String stopName;
        final Double latitude;
        final Double longitude;
        final long timestampMs;

        SightingEntry(String reporterKey, String routeName, String direction, String stopName,
                      Double latitude, Double longitude, long timestampMs) {
            this.reporterKey = reporterKey;
            this.routeName = routeName;
            this.direction = direction;
            this.stopName = stopName;
            this.latitude = latitude;
            this.longitude = longitude;
            this.timestampMs = timestampMs;
        }
    }

    private static class IncidentBucket {
        final String zoneKey;
        String zoneLabel;
        String type;
        String latestNote;
        Double latitude;
        Double longitude;
        final Map<String, Long> reporters = new LinkedHashMap<>();
        final Map<String, Long> clearConfirmers = new LinkedHashMap<>();
        Long noticeId;
        boolean escalated;
        long updatedAtMs;

        IncidentBucket(String zoneKey, String zoneLabel, String type) {
            this.zoneKey = zoneKey;
            this.zoneLabel = zoneLabel;
            this.type = type;
        }

        synchronized void prune(long nowMs) {
            reporters.entrySet().removeIf(e -> nowMs - e.getValue() > INCIDENT_TTL_MS);
            clearConfirmers.entrySet().removeIf(e -> nowMs - e.getValue() > INCIDENT_TTL_MS);
        }
    }

    private final Map<Long, List<SightingEntry>> sightingsByRoute = new ConcurrentHashMap<>();
    private final Map<String, IncidentBucket> activeIncidents = new ConcurrentHashMap<>();
    private final Map<Long, Set<String>> noticeClearConfirmers = new ConcurrentHashMap<>();

    @PostConstruct
    public void initNoticesTable() {
        try {
            jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS service_notices (
                    id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    zone_key VARCHAR(80),
                    zone_label VARCHAR(160),
                    route_id BIGINT,
                    title VARCHAR(160) NOT NULL,
                    body VARCHAR(600) NOT NULL,
                    severity VARCHAR(24) NOT NULL,
                    origin VARCHAR(24) NOT NULL,
                    report_count INT NOT NULL DEFAULT 0,
                    clear_count INT NOT NULL DEFAULT 0,
                    pin_banner BOOLEAN NOT NULL DEFAULT FALSE,
                    active BOOLEAN NOT NULL DEFAULT TRUE,
                    latitude DOUBLE,
                    longitude DOUBLE,
                    created_by VARCHAR(60),
                    created_at_ms BIGINT NOT NULL,
                    updated_at_ms BIGINT NOT NULL,
                    expires_at_ms BIGINT
                )
                """);
        } catch (Exception e) {
            log.warn("No se pudo verificar/crear tabla service_notices: {}", e.getMessage());
        }
    }

    public Map<String, Object> recordBusSighting(
            Long routeId, String routeName, String direction, String stopName,
            Double lat, Double lng, String reporterKey) {
        if (routeId == null || routeId <= 0) {
            throw new IllegalArgumentException("routeId inválido.");
        }
        long now = System.currentTimeMillis();
        String safeName = sanitizeText(routeName, 120, "Ruta #" + routeId);
        String safeDir = ("VUELTA".equalsIgnoreCase(direction) || "REGRESO".equalsIgnoreCase(direction))
                ? "VUELTA" : "IDA";
        String safeStop = sanitizeText(stopName, 120, "");
        String safeReporter = sanitizeText(reporterKey, 80, "anon");

        Double safeLat = null;
        Double safeLng = null;
        if (lat != null && lng != null && Double.isFinite(lat) && Double.isFinite(lng)
                && lat >= TrafficService.MIN_LAT && lat <= TrafficService.MAX_LAT
                && lng >= TrafficService.MIN_LNG && lng <= TrafficService.MAX_LNG) {
            safeLat = Math.round(lat * 1_000_000.0) / 1_000_000.0;
            safeLng = Math.round(lng * 1_000_000.0) / 1_000_000.0;
        }

        List<SightingEntry> list = sightingsByRoute.computeIfAbsent(routeId,
                k -> Collections.synchronizedList(new ArrayList<>()));

        synchronized (list) {
            list.removeIf(s -> now - s.timestampMs > SIGHTING_TTL_MS);
            for (SightingEntry existing : list) {
                if (existing.reporterKey.equals(safeReporter) && (now - existing.timestampMs) < 120_000L) {
                    return Map.of(
                            "rateLimited", true,
                            "message", "Ya reportaste esta ruta hace menos de 2 minutos.",
                            "summary", summarizeSightingsLocked(routeId, list, now)
                    );
                }
            }
            list.add(new SightingEntry(safeReporter, safeName, safeDir, safeStop, safeLat, safeLng, now));
            if (list.size() > 30) {
                list.remove(0);
            }
        }

        if (sightingsByRoute.size() > MAX_SIGHTING_ROUTES) {
            sightingsByRoute.entrySet().removeIf(e -> {
                synchronized (e.getValue()) {
                    e.getValue().removeIf(s -> now - s.timestampMs > SIGHTING_TTL_MS);
                    return e.getValue().isEmpty();
                }
            });
        }

        synchronized (list) {
            return Map.of(
                    "rateLimited", false,
                    "message", "¡Gracias! Aviso de camión recién visto publicado por 15 min.",
                    "summary", summarizeSightingsLocked(routeId, list, now)
            );
        }
    }

    public Map<String, Object> reportIncident(
            String rawType,
            String rawZoneKey,
            String rawZoneLabel,
            String rawDescription,
            Double lat,
            Double lng,
            String reporterKey) {

        String type = rawType != null ? rawType.trim().toLowerCase(Locale.ROOT) : "bloqueo";
        if (!VALID_INCIDENT_TYPES.contains(type)) {
            throw new IllegalArgumentException("Tipo de incidente inválido. Usa: bloqueo, inundacion, desvio o sin_servicio.");
        }
        String zoneLabel = sanitizeText(rawZoneLabel, 140, "");
        String zoneKey = normalizeZoneKey(rawZoneKey != null && !rawZoneKey.isBlank() ? rawZoneKey : zoneLabel);
        if (zoneKey.isBlank()) {
            throw new IllegalArgumentException("Indica una zona o corredor para el reporte.");
        }
        if (zoneLabel.isBlank()) {
            zoneLabel = humanizeZoneKey(zoneKey);
        }
        String description = sanitizeText(rawDescription, 300, defaultDescriptionForType(type, zoneLabel));
        String reporter = sanitizeText(reporterKey, 80, "anon");
        long now = System.currentTimeMillis();

        Double safeLat = null;
        Double safeLng = null;
        if (lat != null && lng != null && Double.isFinite(lat) && Double.isFinite(lng)
                && lat >= TrafficService.MIN_LAT && lat <= TrafficService.MAX_LAT
                && lng >= TrafficService.MIN_LNG && lng <= TrafficService.MAX_LNG) {
            safeLat = Math.round(lat * 1_000_000.0) / 1_000_000.0;
            safeLng = Math.round(lng * 1_000_000.0) / 1_000_000.0;
        }

        if (activeIncidents.size() > MAX_INCIDENT_ZONES) {
            activeIncidents.entrySet().removeIf(e -> {
                e.getValue().prune(now);
                return e.getValue().reporters.isEmpty();
            });
        }

        String bucketKey = type + "::" + zoneKey;
        final String initialZoneLabel = zoneLabel;
        IncidentBucket bucket = activeIncidents.computeIfAbsent(
                bucketKey, k -> new IncidentBucket(zoneKey, initialZoneLabel, type)
        );

        boolean escalatedNow = false;
        int distinctReporters;
        Long linkedNoticeId;

        synchronized (bucket) {
            bucket.prune(now);
            bucket.zoneLabel = zoneLabel;
            bucket.latestNote = description;
            bucket.updatedAtMs = now;
            if (safeLat != null && safeLng != null) {
                bucket.latitude = safeLat;
                bucket.longitude = safeLng;
            }
            bucket.reporters.put(reporter, now);
            // Un nuevo reporte activo invalida confirmaciones previas de despeje del mismo reportante
            bucket.clearConfirmers.remove(reporter);

            distinctReporters = bucket.reporters.size();

            if (distinctReporters >= INCIDENT_ESCALATE_THRESHOLD) {
                if (bucket.noticeId == null) {
                    bucket.noticeId = findActiveAutoNoticeId(zoneKey);
                }
                String title = buildAutoNoticeTitle(type, zoneLabel);
                String body = buildAutoNoticeBody(distinctReporters, description);
                String severity = ("bloqueo".equals(type) || "inundacion".equals(type)) ? "danger" : "warning";
                boolean pinBanner = true;

                if (bucket.noticeId == null) {
                    bucket.noticeId = insertNotice(
                            zoneKey, zoneLabel, null, title, body, severity,
                            "auto_comunidad", distinctReporters, bucket.clearConfirmers.size(),
                            pinBanner, bucket.latitude, bucket.longitude,
                            "comunidad", now, now + DEFAULT_AUTO_NOTICE_TTL_MS
                    );
                    escalatedNow = true;
                } else {
                    jdbcTemplate.update("""
                        UPDATE service_notices
                        SET title = ?, body = ?, severity = ?, report_count = ?, pin_banner = ?,
                            latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude),
                            updated_at_ms = ?, expires_at_ms = ?
                        WHERE id = ?
                        """,
                            title, body, severity, distinctReporters, pinBanner,
                            bucket.latitude, bucket.longitude, now, now + DEFAULT_AUTO_NOTICE_TTL_MS, bucket.noticeId
                    );
                }
                bucket.escalated = true;
            }
            linkedNoticeId = bucket.noticeId;
        }

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("zoneKey", zoneKey);
        response.put("zoneLabel", zoneLabel);
        response.put("type", type);
        response.put("distinctReporters", distinctReporters);
        response.put("threshold", INCIDENT_ESCALATE_THRESHOLD);
        response.put("escalated", distinctReporters >= INCIDENT_ESCALATE_THRESHOLD);
        response.put("escalatedNow", escalatedNow);
        response.put("noticeId", linkedNoticeId);
        response.put("message", distinctReporters >= INCIDENT_ESCALATE_THRESHOLD
                ? "¡Confirmado! Con " + distinctReporters + " reportes en " + zoneLabel + ", la alerta ya aparece en Notificaciones de Don Rutero."
                : "Reporte registrado (" + distinctReporters + "/" + INCIDENT_ESCALATE_THRESHOLD + " para publicar alerta automática en " + zoneLabel + ").");
        return response;
    }

    public Map<String, Object> confirmZoneClear(String rawZoneKey, String reporterKey, boolean isAdmin) {
        String zoneKey = normalizeZoneKey(rawZoneKey);
        if (zoneKey.isBlank()) {
            throw new IllegalArgumentException("Zona inválida.");
        }
        String reporter = sanitizeText(reporterKey, 80, "anon");
        long now = System.currentTimeMillis();

        int maxClearCount = 0;
        boolean cleared = isAdmin;
        List<String> keysToRemove = new ArrayList<>();

        for (Map.Entry<String, IncidentBucket> entry : activeIncidents.entrySet()) {
            IncidentBucket bucket = entry.getValue();
            if (!bucket.zoneKey.equals(zoneKey)) continue;
            synchronized (bucket) {
                bucket.prune(now);
                bucket.clearConfirmers.put(reporter, now);
                maxClearCount = Math.max(maxClearCount, bucket.clearConfirmers.size());
                if (isAdmin || bucket.clearConfirmers.size() >= COMMUNITY_CLEAR_THRESHOLD) {
                    cleared = true;
                    keysToRemove.add(entry.getKey());
                }
            }
        }

        if (!cleared && maxClearCount == 0) {
            // Caso en que el aviso siguió vivo en BD después de reinicio
            Long activeNoticeId = findActiveAutoNoticeId(zoneKey);
            if (activeNoticeId != null) {
                return confirmNoticeClear(activeNoticeId, reporter, false);
            }
        }

        if (cleared) {
            for (String k : keysToRemove) {
                activeIncidents.remove(k);
            }
            int updated = jdbcTemplate.update("""
                UPDATE service_notices
                SET active = FALSE, clear_count = GREATEST(clear_count, ?), updated_at_ms = ?
                WHERE zone_key = ? AND origin = 'auto_comunidad' AND active = TRUE
                """, Math.max(maxClearCount, isAdmin ? COMMUNITY_CLEAR_THRESHOLD : 1), now, zoneKey);
            log.info("Zona '{}' marcada como despejada (cleared={}, noticesUpdated={}).", zoneKey, true, updated);
        } else {
            jdbcTemplate.update("""
                UPDATE service_notices
                SET clear_count = ?, updated_at_ms = ?
                WHERE zone_key = ? AND origin = 'auto_comunidad' AND active = TRUE
                """, maxClearCount, now, zoneKey);
        }

        return Map.of(
                "zoneKey", zoneKey,
                "cleared", cleared,
                "clearCount", maxClearCount,
                "clearThreshold", COMMUNITY_CLEAR_THRESHOLD,
                "message", cleared
                        ? "¡Gracias! Zona reportada libre y notificación retirada de Don Rutero."
                        : "Confirmación registrada (" + maxClearCount + "/" + COMMUNITY_CLEAR_THRESHOLD + "). Con otra confirmación ciudadana se quita la alerta."
        );
    }

    private static final org.springframework.jdbc.core.RowMapper<Map<String, Object>> NOTICE_ROW_MAPPER = (rs, rowNum) -> {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", rs.getLong("id"));
        m.put("zoneKey", rs.getString("zone_key"));
        m.put("zoneLabel", rs.getString("zone_label"));
        long rid = rs.getLong("route_id");
        m.put("routeId", rs.wasNull() ? null : rid);
        m.put("title", rs.getString("title"));
        m.put("body", rs.getString("body"));
        m.put("severity", rs.getString("severity"));
        m.put("origin", rs.getString("origin"));
        m.put("reportCount", rs.getInt("report_count"));
        m.put("clearCount", rs.getInt("clear_count"));
        m.put("pinBanner", rs.getBoolean("pin_banner"));
        m.put("active", rs.getBoolean("active"));
        double lat = rs.getDouble("latitude");
        m.put("latitude", rs.wasNull() ? null : lat);
        double lng = rs.getDouble("longitude");
        m.put("longitude", rs.wasNull() ? null : lng);
        m.put("createdBy", rs.getString("created_by"));
        m.put("createdAtMs", rs.getLong("created_at_ms"));
        m.put("updatedAtMs", rs.getLong("updated_at_ms"));
        long exp = rs.getLong("expires_at_ms");
        m.put("expiresAtMs", rs.wasNull() ? null : exp);
        return m;
    };

    public Map<String, Object> confirmNoticeClear(Long noticeId, String reporterKey, boolean isAdmin) {
        if (noticeId == null || noticeId <= 0) {
            throw new IllegalArgumentException("ID de aviso inválido.");
        }
        List<Map<String, Object>> rows = jdbcTemplate.query(
                "SELECT * FROM service_notices WHERE id = ?", NOTICE_ROW_MAPPER, noticeId);
        if (rows.isEmpty()) {
            return Map.of("found", false, "cleared", false, "message", "Aviso no encontrado.");
        }
        Map<String, Object> row = rows.get(0);
        String origin = Objects.toString(row.get("origin"), "");
        String zoneKey = Objects.toString(row.get("zoneKey"), "");

        if (!isAdmin && !"auto_comunidad".equals(origin)) {
            return Map.of(
                    "found", true,
                    "cleared", false,
                    "message", "Este es un aviso oficial del administrador; solo el equipo Don Rutero puede retirarlo."
            );
        }

        String reporter = sanitizeText(reporterKey, 80, "anon");
        Set<String> confirmers = noticeClearConfirmers.computeIfAbsent(noticeId, k -> ConcurrentHashMap.newKeySet());
        confirmers.add(reporter);
        int clearCount = confirmers.size();
        boolean cleared = isAdmin || clearCount >= COMMUNITY_CLEAR_THRESHOLD;
        long now = System.currentTimeMillis();

        if (cleared) {
            jdbcTemplate.update(
                    "UPDATE service_notices SET active = FALSE, clear_count = ?, updated_at_ms = ? WHERE id = ?",
                    clearCount, now, noticeId
            );
            noticeClearConfirmers.remove(noticeId);
            if (!zoneKey.isBlank()) {
                activeIncidents.entrySet().removeIf(e -> e.getValue().zoneKey.equals(zoneKey));
            }
        } else {
            jdbcTemplate.update(
                    "UPDATE service_notices SET clear_count = ?, updated_at_ms = ? WHERE id = ?",
                    clearCount, now, noticeId
            );
        }

        return Map.of(
                "found", true,
                "cleared", cleared,
                "clearCount", clearCount,
                "clearThreshold", COMMUNITY_CLEAR_THRESHOLD,
                "message", cleared
                        ? "¡Todo en orden! La alerta se retiró de Notificaciones."
                        : "Confirmación registrada (" + clearCount + "/" + COMMUNITY_CLEAR_THRESHOLD + "). Con una más se retira la alerta."
        );
    }

    public Map<String, Object> createAdminNotice(
            String rawTitle,
            String rawBody,
            String rawSeverity,
            String rawZoneLabel,
            boolean pinBanner,
            Integer durationHours,
            Double lat,
            Double lng,
            String adminUsername) {

        String title = sanitizeText(rawTitle, 150, "");
        String body = sanitizeText(rawBody, 550, "");
        if (title.isBlank() || body.isBlank()) {
            throw new IllegalArgumentException("El aviso requiere título y mensaje.");
        }
        String severity = rawSeverity != null ? rawSeverity.trim().toLowerCase(Locale.ROOT) : "info";
        if (!VALID_SEVERITIES.contains(severity)) {
            severity = "info";
        }
        String zoneLabel = sanitizeText(rawZoneLabel, 140, "Mazatlán");
        String zoneKey = normalizeZoneKey(zoneLabel);
        long now = System.currentTimeMillis();
        Long expiresAt = (durationHours != null && durationHours > 0)
                ? now + Math.min(durationHours, 24 * 30) * 3_600_000L
                : null;

        Double safeLat = (lat != null && Double.isFinite(lat)) ? lat : null;
        Double safeLng = (lng != null && Double.isFinite(lng)) ? lng : null;

        Long id = insertNotice(
                zoneKey.isBlank() ? null : zoneKey,
                zoneLabel,
                null,
                title,
                body,
                severity,
                "admin",
                0,
                0,
                pinBanner,
                safeLat,
                safeLng,
                sanitizeText(adminUsername, 60, "admin"),
                now,
                expiresAt
        );
        return getNoticeById(id);
    }

    public boolean dismissNoticeAsAdmin(Long id) {
        long now = System.currentTimeMillis();
        List<String> zones = jdbcTemplate.query(
                "SELECT zone_key FROM service_notices WHERE id = ?",
                (rs, i) -> rs.getString("zone_key"), id);
        if (zones.isEmpty()) return false;
        String zoneKey = Objects.toString(zones.get(0), "");
        jdbcTemplate.update("UPDATE service_notices SET active = FALSE, updated_at_ms = ? WHERE id = ?", now, id);
        noticeClearConfirmers.remove(id);
        if (!zoneKey.isBlank()) {
            activeIncidents.entrySet().removeIf(e -> e.getValue().zoneKey.equals(zoneKey));
        }
        return true;
    }

    public boolean deleteNoticeAsAdmin(Long id) {
        List<String> zones = jdbcTemplate.query(
                "SELECT zone_key FROM service_notices WHERE id = ?",
                (rs, i) -> rs.getString("zone_key"), id);
        if (zones.isEmpty()) return false;
        String zoneKey = Objects.toString(zones.get(0), "");
        jdbcTemplate.update("DELETE FROM service_notices WHERE id = ?", id);
        noticeClearConfirmers.remove(id);
        if (!zoneKey.isBlank()) {
            activeIncidents.entrySet().removeIf(e -> e.getValue().zoneKey.equals(zoneKey));
        }
        return true;
    }

    public List<Map<String, Object>> listNoticesForAdmin() {
        long now = System.currentTimeMillis();
        expireOldNotices(now);
        return jdbcTemplate.query("""
            SELECT * FROM service_notices
            ORDER BY active DESC, updated_at_ms DESC
            LIMIT 80
            """, NOTICE_ROW_MAPPER);
    }

    public Map<String, Object> getLivePulseSnapshot() {
        long now = System.currentTimeMillis();
        expireOldNotices(now);

        List<Map<String, Object>> activeNotices = jdbcTemplate.query("""
            SELECT * FROM service_notices
            WHERE active = TRUE
            ORDER BY pin_banner DESC, updated_at_ms DESC
            LIMIT 25
            """, NOTICE_ROW_MAPPER);

        List<Map<String, Object>> incidentDtos = new ArrayList<>();
        Iterator<Map.Entry<String, IncidentBucket>> it = activeIncidents.entrySet().iterator();
        while (it.hasNext()) {
            IncidentBucket bucket = it.next().getValue();
            synchronized (bucket) {
                bucket.prune(now);
                if (bucket.reporters.isEmpty()) {
                    it.remove();
                    continue;
                }
                Map<String, Object> dto = new LinkedHashMap<>();
                dto.put("zoneKey", bucket.zoneKey);
                dto.put("zoneLabel", bucket.zoneLabel);
                dto.put("type", bucket.type);
                dto.put("description", bucket.latestNote);
                dto.put("distinctReporters", bucket.reporters.size());
                dto.put("threshold", INCIDENT_ESCALATE_THRESHOLD);
                dto.put("escalated", bucket.reporters.size() >= INCIDENT_ESCALATE_THRESHOLD);
                dto.put("clearCount", bucket.clearConfirmers.size());
                dto.put("clearThreshold", COMMUNITY_CLEAR_THRESHOLD);
                dto.put("latitude", bucket.latitude);
                dto.put("longitude", bucket.longitude);
                dto.put("updatedAtMs", bucket.updatedAtMs);
                incidentDtos.add(dto);
            }
        }
        incidentDtos.sort((a, b) -> Long.compare(
                ((Number) b.get("updatedAtMs")).longValue(),
                ((Number) a.get("updatedAtMs")).longValue()
        ));

        Map<Long, Map<String, Object>> sightingsSummary = new LinkedHashMap<>();
        Iterator<Map.Entry<Long, List<SightingEntry>>> sit = sightingsByRoute.entrySet().iterator();
        while (sit.hasNext()) {
            Map.Entry<Long, List<SightingEntry>> e = sit.next();
            List<SightingEntry> list = e.getValue();
            synchronized (list) {
                list.removeIf(s -> now - s.timestampMs > SIGHTING_TTL_MS);
                if (list.isEmpty()) {
                    sit.remove();
                    continue;
                }
                sightingsSummary.put(e.getKey(), summarizeSightingsLocked(e.getKey(), list, now));
            }
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("generatedAtMs", now);
        out.put("incidentThreshold", INCIDENT_ESCALATE_THRESHOLD);
        out.put("clearThreshold", COMMUNITY_CLEAR_THRESHOLD);
        out.put("activeNotices", activeNotices);
        out.put("incidents", incidentDtos);
        out.put("sightingsByRoute", sightingsSummary);
        return out;
    }

    private void expireOldNotices(long now) {
        try {
            jdbcTemplate.update(
                    "UPDATE service_notices SET active = FALSE, updated_at_ms = ? WHERE active = TRUE AND expires_at_ms IS NOT NULL AND expires_at_ms <= ?",
                    now, now
            );
        } catch (Exception e) {
            log.debug("Omitiendo limpieza expiración de avisos: {}", e.getMessage());
        }
    }

    private Long findActiveAutoNoticeId(String zoneKey) {
        List<Long> ids = jdbcTemplate.queryForList(
                "SELECT id FROM service_notices WHERE zone_key = ? AND origin = 'auto_comunidad' AND active = TRUE ORDER BY id DESC LIMIT 1",
                Long.class, zoneKey
        );
        return ids.isEmpty() ? null : ids.get(0);
    }

    private Long insertNotice(
            String zoneKey, String zoneLabel, Long routeId,
            String title, String body, String severity, String origin,
            int reportCount, int clearCount, boolean pinBanner,
            Double lat, Double lng, String createdBy,
            long nowMs, Long expiresAtMs) {
        KeyHolder kh = new GeneratedKeyHolder();
        jdbcTemplate.update(con -> {
            PreparedStatement ps = con.prepareStatement("""
                INSERT INTO service_notices
                (zone_key, zone_label, route_id, title, body, severity, origin,
                 report_count, clear_count, pin_banner, active, latitude, longitude,
                 created_by, created_at_ms, updated_at_ms, expires_at_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?, ?, ?, ?)
                """, Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, zoneKey);
            ps.setString(2, zoneLabel);
            if (routeId != null) ps.setLong(3, routeId); else ps.setNull(3, java.sql.Types.BIGINT);
            ps.setString(4, title);
            ps.setString(5, body);
            ps.setString(6, severity);
            ps.setString(7, origin);
            ps.setInt(8, reportCount);
            ps.setInt(9, clearCount);
            ps.setBoolean(10, pinBanner);
            if (lat != null) ps.setDouble(11, lat); else ps.setNull(11, java.sql.Types.DOUBLE);
            if (lng != null) ps.setDouble(12, lng); else ps.setNull(12, java.sql.Types.DOUBLE);
            ps.setString(13, createdBy);
            ps.setLong(14, nowMs);
            ps.setLong(15, nowMs);
            if (expiresAtMs != null) ps.setLong(16, expiresAtMs); else ps.setNull(16, java.sql.Types.BIGINT);
            return ps;
        }, kh);
        Number key = kh.getKey();
        return key != null ? key.longValue() : null;
    }

    private Map<String, Object> getNoticeById(Long id) {
        List<Map<String, Object>> list = jdbcTemplate.query(
                "SELECT * FROM service_notices WHERE id = ?", NOTICE_ROW_MAPPER, id);
        return list.isEmpty() ? Map.of() : list.get(0);
    }

    private Map<String, Object> summarizeSightingsLocked(Long routeId, List<SightingEntry> list, long nowMs) {
        SightingEntry latest = list.get(list.size() - 1);
        long minutesAgo = Math.max(0L, (nowMs - latest.timestampMs) / 60_000L);
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("routeId", routeId);
        summary.put("routeName", latest.routeName);
        summary.put("count", list.size());
        summary.put("lastTimestampMs", latest.timestampMs);
        summary.put("minutesAgo", minutesAgo);
        summary.put("direction", latest.direction);
        summary.put("stopName", latest.stopName);
        summary.put("latitude", latest.latitude);
        summary.put("longitude", latest.longitude);
        return summary;
    }

    private String sanitizeText(String raw, int maxLen, String fallback) {
        if (raw == null) return fallback;
        String clean = raw.replaceAll("[\\r\\n\\t]+", " ").trim();
        if (clean.isEmpty()) return fallback;
        return clean.length() > maxLen ? clean.substring(0, maxLen) : clean;
    }

    private String normalizeZoneKey(String raw) {
        if (raw == null) return "";
        String norm = Normalizer.normalize(raw.trim().toLowerCase(Locale.ROOT), Normalizer.Form.NFD)
                .replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
                .replaceAll("[^a-z0-9]+", "_")
                .replaceAll("^_+|_+$", "");
        return norm.length() > 64 ? norm.substring(0, 64) : norm;
    }

    private String humanizeZoneKey(String zoneKey) {
        return Arrays.stream(zoneKey.split("_"))
                .filter(s -> !s.isBlank())
                .map(s -> Character.toUpperCase(s.charAt(0)) + s.substring(1))
                .reduce((a, b) -> a + " " + b)
                .orElse("Mazatlán");
    }

    private String defaultDescriptionForType(String type, String zoneLabel) {
        return switch (type) {
            case "inundacion" -> "Encharcamiento o inundación reportada en " + zoneLabel;
            case "desvio" -> "Desvío temporal de camiones en " + zoneLabel;
            case "sin_servicio" -> "Sin paso de unidades reportado en " + zoneLabel;
            default -> "Bloqueo o cierre vial reportado en " + zoneLabel;
        };
    }

    private String buildAutoNoticeTitle(String type, String zoneLabel) {
        return switch (type) {
            case "inundacion" -> "Calle inundada en " + zoneLabel;
            case "desvio" -> "Desvío de rutas en " + zoneLabel;
            case "sin_servicio" -> "Paso detenido en " + zoneLabel;
            default -> "Bloqueo reportado en " + zoneLabel;
        };
    }

    private String buildAutoNoticeBody(int distinctReporters, String latestDescription) {
        return distinctReporters + " usuarios reportaron afectación reciente. " + latestDescription
                + " Si ya liberaron la calle, toca «Ya está todo bien».";
    }
}
