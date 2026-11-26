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
import java.util.concurrent.atomic.AtomicLong;

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
            "bloqueo", "accidente", "obras", "inundacion", "desvio",
            "trafico_pesado", "marcha_evento", "sin_servicio", "unidad_averiada", "otro"
    );
    private static final Set<String> ROAD_DISRUPTION_TYPES = Set.of(
            "bloqueo", "accidente", "obras", "desvio", "trafico_pesado", "marcha_evento", "sin_servicio"
    );
    private static final Set<String> WATER_COMPATIBLE_TYPES = Set.of("inundacion", "bloqueo", "desvio", "obras");
    private static final Set<String> BUS_COMPATIBLE_TYPES = Set.of("unidad_averiada", "sin_servicio", "trafico_pesado");
    private static final Set<String> DANGER_TYPES = Set.of("bloqueo", "accidente", "inundacion", "sin_servicio");
    private static final Set<String> VALID_SEVERITIES = Set.of("info", "warning", "danger");

    private static final Map<String, String> ZONE_ALIASES = buildZoneAliases();
    private static final Map<String, String> CONCEPT_SYNONYMS = buildConceptSynonyms();
    private static final Set<String> ZONE_PREFIX_WORDS = Set.of(
            "av", "ave", "avenida", "blvd", "bulevar", "boulevard", "calle", "c",
            "col", "colonia", "fracc", "fraccionamiento", "ctra", "carretera",
            "de", "del", "la", "las", "el", "los", "y", "en"
    );
    private static final Set<String> STOPWORDS = Set.of(
            "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al",
            "en", "por", "para", "con", "sin", "sobre", "entre", "hacia", "y", "o", "u",
            "que", "se", "su", "es", "son", "esta", "estan", "hay", "muy", "mucho", "mucha",
            "casi", "todo", "toda", "todos", "otra", "otro", "frente", "cerca", "junto",
            "esquina", "cruce", "crucero", "altura", "zona", "tramo", "parte", "lado", "sentido",
            "entrada", "salida", "plaza", "glorieta",
            "calle", "avenida", "av", "blvd", "col", "colonia", "fracc", "ruta", "rutas",
            "camion", "camiones", "unidad", "unidades", "reportado", "reporte", "pasa",
            "paso", "pasan", "pasando", "cerrado", "cerrada", "bloqueo", "incidente",
            "problema", "falla", "grande", "fuerte"
    );

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private final AtomicLong incidentSeq = new AtomicLong(1);

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
        final String bucketKey;
        final String zoneKey;
        final Set<String> zoneTokens = new LinkedHashSet<>();
        String zoneLabel;
        String type;
        String typeLabel;
        String latestNote;
        boolean hasExplicitDetail;
        final Set<String> similarityTokens = new LinkedHashSet<>();
        Double latitude;
        Double longitude;
        final Map<String, Long> reporters = new LinkedHashMap<>();
        final Map<String, Long> clearConfirmers = new LinkedHashMap<>();
        Long noticeId;
        boolean escalated;
        long updatedAtMs;

        IncidentBucket(String bucketKey, String zoneKey, Set<String> zoneTokens, String zoneLabel,
                       String type, String typeLabel) {
            this.bucketKey = bucketKey;
            this.zoneKey = zoneKey;
            if (zoneTokens != null) this.zoneTokens.addAll(zoneTokens);
            this.zoneLabel = zoneLabel;
            this.type = type;
            this.typeLabel = typeLabel;
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
            String rawCustomType,
            String rawZoneKey,
            String rawZoneLabel,
            String rawDescription,
            Double lat,
            Double lng,
            String reporterKey) {

        String type = rawType != null ? rawType.trim().toLowerCase(Locale.ROOT) : "bloqueo";
        if (!VALID_INCIDENT_TYPES.contains(type)) {
            throw new IllegalArgumentException("Tipo de incidente inválido.");
        }
        String customType = sanitizeText(rawCustomType, 80, "");
        if ("otro".equals(type) && customType.isBlank() && sanitizeText(rawDescription, 300, "").isBlank()) {
            throw new IllegalArgumentException("Especifica qué incidente está pasando en la calle.");
        }
        String typeLabel = "otro".equals(type)
                ? (!customType.isBlank() ? customType : "Otro incidente")
                : defaultTypeLabel(type);

        String zoneLabel = sanitizeText(rawZoneLabel, 140, "");
        String rawZoneInput = (rawZoneKey != null && !rawZoneKey.isBlank()) ? rawZoneKey : zoneLabel;
        String zoneKey = canonicalZoneKey(rawZoneInput);
        if (zoneKey.isBlank()) {
            throw new IllegalArgumentException("Indica una avenida, calle o colonia para el reporte.");
        }
        if (zoneLabel.isBlank()) {
            zoneLabel = humanizeZoneKey(zoneKey);
        }
        Set<String> zoneTokens = extractZoneTokens(zoneLabel + " " + rawZoneInput);

        String explicitDescription = sanitizeText(rawDescription, 300, "");
        boolean hasExplicitDetail = !explicitDescription.isBlank() || ("otro".equals(type) && !customType.isBlank());
        String description = !explicitDescription.isBlank()
                ? explicitDescription
                : ("otro".equals(type) && !customType.isBlank()
                        ? customType + " en " + zoneLabel
                        : defaultDescriptionForType(type, zoneLabel));

        String combinedSimilarityText = ("otro".equals(type) ? customType + " " : "") + explicitDescription;
        Set<String> incomingTokens = extractContentTokens(combinedSimilarityText);
        if (incomingTokens.isEmpty() && "otro".equals(type)) {
            incomingTokens = extractFallbackTokens(customType + " " + explicitDescription);
        }

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

        IncidentBucket bucket = findBestMatchingBucket(
                type, zoneKey, zoneTokens, incomingTokens, hasExplicitDetail, safeLat, safeLng, now
        );
        if (bucket == null) {
            String newBucketKey = type + "__" + zoneKey + "__" + incidentSeq.getAndIncrement();
            IncidentBucket fresh = new IncidentBucket(newBucketKey, zoneKey, zoneTokens, zoneLabel, type, typeLabel);
            IncidentBucket race = activeIncidents.putIfAbsent(newBucketKey, fresh);
            bucket = race != null ? race : fresh;
        }

        return recordVoteIntoBucket(bucket, reporter, type, typeLabel, description,
                hasExplicitDetail, incomingTokens, safeLat, safeLng, now);
    }

    public Map<String, Object> confirmExistingIncident(String rawIncidentKey, String reporterKey) {
        String key = rawIncidentKey != null ? rawIncidentKey.trim() : "";
        if (key.isBlank()) {
            throw new IllegalArgumentException("Incidente inválido.");
        }
        IncidentBucket bucket = activeIncidents.get(key);
        if (bucket == null) {
            throw new IllegalArgumentException("Ese reporte ya expiró o fue liberado.");
        }
        String reporter = sanitizeText(reporterKey, 80, "anon");
        long now = System.currentTimeMillis();
        return recordVoteIntoBucket(bucket, reporter, bucket.type, bucket.typeLabel, null,
                false, Set.of(), null, null, now);
    }

    private Map<String, Object> recordVoteIntoBucket(
            IncidentBucket bucket,
            String reporter,
            String incomingType,
            String incomingTypeLabel,
            String description,
            boolean hasExplicitDetail,
            Set<String> incomingTokens,
            Double safeLat,
            Double safeLng,
            long now) {

        boolean escalatedNow = false;
        int distinctReporters;
        Long linkedNoticeId;
        String resolvedZoneKey;
        String resolvedZoneLabel;
        String resolvedType;
        String resolvedTypeLabel;

        synchronized (bucket) {
            bucket.prune(now);
            if (description != null && !description.isBlank()) {
                bucket.latestNote = description;
            }
            if (hasExplicitDetail) {
                bucket.hasExplicitDetail = true;
            }
            if (incomingTokens != null && !incomingTokens.isEmpty()) {
                bucket.similarityTokens.addAll(incomingTokens);
            }
            // Si una votación previa genérica se enriquece con un tipo concreto compatible, conservar el más claro
            if ("otro".equals(bucket.type) && !"otro".equals(incomingType)) {
                bucket.type = incomingType;
                bucket.typeLabel = incomingTypeLabel;
            }
            bucket.updatedAtMs = now;
            if (safeLat != null && safeLng != null) {
                bucket.latitude = safeLat;
                bucket.longitude = safeLng;
            }
            bucket.reporters.put(reporter, now);
            bucket.clearConfirmers.remove(reporter);

            distinctReporters = bucket.reporters.size();

            if (distinctReporters >= INCIDENT_ESCALATE_THRESHOLD) {
                if (bucket.noticeId == null) {
                    bucket.noticeId = findMatchingAutoNoticeId(bucket.zoneKey, bucket.type, bucket.typeLabel);
                }
                String title = buildAutoNoticeTitle(bucket.type, bucket.typeLabel, bucket.zoneLabel);
                String body = buildAutoNoticeBody(distinctReporters, bucket.latestNote);
                String severity = DANGER_TYPES.contains(bucket.type) ? "danger" : "warning";
                boolean pinBanner = true;

                if (bucket.noticeId == null) {
                    bucket.noticeId = insertNotice(
                            bucket.zoneKey, bucket.zoneLabel, null, title, body, severity,
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
            resolvedZoneKey = bucket.zoneKey;
            resolvedZoneLabel = bucket.zoneLabel;
            resolvedType = bucket.type;
            resolvedTypeLabel = bucket.typeLabel;
        }

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("incidentKey", bucket.bucketKey);
        response.put("zoneKey", resolvedZoneKey);
        response.put("zoneLabel", resolvedZoneLabel);
        response.put("type", resolvedType);
        response.put("typeLabel", resolvedTypeLabel);
        response.put("distinctReporters", distinctReporters);
        response.put("threshold", INCIDENT_ESCALATE_THRESHOLD);
        response.put("escalated", distinctReporters >= INCIDENT_ESCALATE_THRESHOLD);
        response.put("escalatedNow", escalatedNow);
        response.put("noticeId", linkedNoticeId);
        response.put("message", distinctReporters >= INCIDENT_ESCALATE_THRESHOLD
                ? "¡Confirmado! Con " + distinctReporters + " reportes coincidentes en " + resolvedZoneLabel + ", la alerta ya aparece en Notificaciones de Don Rutero."
                : "Reporte registrado (" + distinctReporters + "/" + INCIDENT_ESCALATE_THRESHOLD + " reportes similares para publicar alerta en " + resolvedZoneLabel + ").");
        return response;
    }

    public Map<String, Object> confirmZoneClear(String rawZoneOrIncidentKey, String reporterKey, boolean isAdmin) {
        String rawTrimmed = rawZoneOrIncidentKey != null ? rawZoneOrIncidentKey.trim() : "";
        String zoneKey = canonicalZoneKey(rawTrimmed);
        if (rawTrimmed.isBlank() && zoneKey.isBlank()) {
            throw new IllegalArgumentException("Zona inválida.");
        }
        String reporter = sanitizeText(reporterKey, 80, "anon");
        long now = System.currentTimeMillis();

        int maxClearCount = 0;
        boolean cleared = isAdmin;
        List<String> keysToRemove = new ArrayList<>();
        Set<Long> clearedNoticeIds = new LinkedHashSet<>();

        IncidentBucket exactBucket = activeIncidents.get(rawTrimmed);
        if (exactBucket != null) {
            synchronized (exactBucket) {
                exactBucket.prune(now);
                exactBucket.clearConfirmers.put(reporter, now);
                maxClearCount = Math.max(maxClearCount, exactBucket.clearConfirmers.size());
                if (isAdmin || exactBucket.clearConfirmers.size() >= COMMUNITY_CLEAR_THRESHOLD) {
                    cleared = true;
                    keysToRemove.add(rawTrimmed);
                    if (exactBucket.noticeId != null) {
                        clearedNoticeIds.add(exactBucket.noticeId);
                    }
                } else if (exactBucket.noticeId != null) {
                    jdbcTemplate.update(
                            "UPDATE service_notices SET clear_count = ?, updated_at_ms = ? WHERE id = ?",
                            maxClearCount, now, exactBucket.noticeId
                    );
                }
            }
            zoneKey = exactBucket.zoneKey;
        } else {
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
                        if (bucket.noticeId != null) {
                            clearedNoticeIds.add(bucket.noticeId);
                        }
                    }
                }
            }

            if (!cleared && maxClearCount == 0) {
                Long activeNoticeId = findActiveAutoNoticeId(zoneKey);
                if (activeNoticeId != null) {
                    return confirmNoticeClear(activeNoticeId, reporter, false);
                }
            }
        }

        if (cleared) {
            for (String k : keysToRemove) {
                activeIncidents.remove(k);
            }
            int updated = 0;
            if (!clearedNoticeIds.isEmpty()) {
                for (Long nid : clearedNoticeIds) {
                    updated += jdbcTemplate.update(
                            "UPDATE service_notices SET active = FALSE, clear_count = GREATEST(clear_count, ?), updated_at_ms = ? WHERE id = ?",
                            Math.max(maxClearCount, isAdmin ? COMMUNITY_CLEAR_THRESHOLD : 1), now, nid
                    );
                }
            } else if (!zoneKey.isBlank()) {
                updated = jdbcTemplate.update("""
                    UPDATE service_notices
                    SET active = FALSE, clear_count = GREATEST(clear_count, ?), updated_at_ms = ?
                    WHERE zone_key = ? AND origin = 'auto_comunidad' AND active = TRUE
                    """, Math.max(maxClearCount, isAdmin ? COMMUNITY_CLEAR_THRESHOLD : 1), now, zoneKey);
            }
            log.info("Zona '{}' marcada como despejada (cleared={}, noticesUpdated={}).", zoneKey, true, updated);
        } else if (exactBucket == null && !zoneKey.isBlank()) {
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
                dto.put("incidentKey", bucket.bucketKey);
                dto.put("zoneKey", bucket.zoneKey);
                dto.put("zoneLabel", bucket.zoneLabel);
                dto.put("type", bucket.type);
                dto.put("typeLabel", bucket.typeLabel);
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

    private Long findMatchingAutoNoticeId(String zoneKey, String type, String typeLabel) {
        List<Map<String, Object>> candidates = jdbcTemplate.queryForList(
                "SELECT id, title FROM service_notices WHERE zone_key = ? AND origin = 'auto_comunidad' AND active = TRUE ORDER BY id DESC LIMIT 10",
                zoneKey
        );
        if (candidates.isEmpty()) return null;
        Set<String> targetTokens = extractContentTokens((typeLabel != null ? typeLabel : "") + " " + defaultTypeLabel(type));
        for (Map<String, Object> row : candidates) {
            String title = Objects.toString(row.get("title"), "");
            Set<String> titleTokens = extractContentTokens(title);
            if (!targetTokens.isEmpty() && countMatchingTokens(targetTokens, titleTokens) > 0) {
                return ((Number) row.get("id")).longValue();
            }
        }
        return null;
    }

    private IncidentBucket findBestMatchingBucket(
            String type,
            String zoneKey,
            Set<String> zoneTokens,
            Set<String> incomingTokens,
            boolean incomingHasExplicitDetail,
            Double lat,
            Double lng,
            long now) {

        IncidentBucket best = null;
        int bestScore = 0;

        for (IncidentBucket bucket : activeIncidents.values()) {
            synchronized (bucket) {
                bucket.prune(now);
                if (bucket.reporters.isEmpty()) continue;

                if (!zonesAreSimilar(bucket.zoneKey, bucket.zoneTokens, zoneKey, zoneTokens)) {
                    continue;
                }

                int score = scoreIncidentSimilarity(
                        bucket, type, incomingTokens, incomingHasExplicitDetail, lat, lng
                );
                if (score > bestScore) {
                    bestScore = score;
                    best = bucket;
                }
            }
        }
        return best;
    }

    private int scoreIncidentSimilarity(
            IncidentBucket bucket,
            String type,
            Set<String> incomingTokens,
            boolean incomingHasExplicitDetail,
            Double lat,
            Double lng) {

        boolean sameType = bucket.type.equals(type);
        boolean involvesCustomType = "otro".equals(bucket.type) || "otro".equals(type);
        if (!sameType && !involvesCustomType && !areTypesCompatible(bucket.type, type)) {
            return 0;
        }

        Double distMeters = (lat != null && lng != null && bucket.latitude != null && bucket.longitude != null)
                ? haversineMeters(lat, lng, bucket.latitude, bucket.longitude)
                : null;

        boolean bothHaveTokens = !bucket.similarityTokens.isEmpty() && !incomingTokens.isEmpty();
        int shared = bothHaveTokens ? countMatchingTokens(bucket.similarityTokens, incomingTokens) : 0;

        if (involvesCustomType || !sameType) {
            if (!bothHaveTokens || shared == 0) {
                return 0;
            }
            if (!hasStrongTokenOverlap(shared, bucket.similarityTokens.size(), incomingTokens.size())) {
                return 0;
            }
            if (distMeters != null && distMeters > 1800 && shared < 2) {
                return 0;
            }
            return (sameType ? 40 : 25) + shared * 15;
        }

        // Mismo tipo predefinido en la misma zona
        if (bothHaveTokens) {
            if (shared == 0 || !hasStrongTokenOverlap(shared, bucket.similarityTokens.size(), incomingTokens.size())) {
                return 0;
            }
            return 50 + shared * 15;
        }

        // Al menos uno fue reporte rápido sin descripción específica
        if (bucket.hasExplicitDetail && incomingHasExplicitDetail) {
            return 0;
        }
        if (distMeters != null && distMeters > 1200) {
            return 0;
        }
        return 30;
    }

    private boolean hasStrongTokenOverlap(int shared, int sizeA, int sizeB) {
        int minSize = Math.min(sizeA, sizeB);
        return shared >= 2 || (minSize > 0 && (double) shared / minSize >= 0.33);
    }

    private boolean areTypesCompatible(String t1, String t2) {
        if (t1.equals(t2)) return true;
        if (ROAD_DISRUPTION_TYPES.contains(t1) && ROAD_DISRUPTION_TYPES.contains(t2)) return true;
        if (WATER_COMPATIBLE_TYPES.contains(t1) && WATER_COMPATIBLE_TYPES.contains(t2)) return true;
        return BUS_COMPATIBLE_TYPES.contains(t1) && BUS_COMPATIBLE_TYPES.contains(t2);
    }

    private boolean zonesAreSimilar(String keyA, Set<String> tokensA, String keyB, Set<String> tokensB) {
        if (keyA.equals(keyB)) return true;
        if (tokensA.isEmpty() || tokensB.isEmpty()) return false;
        int shared = countMatchingTokens(tokensA, tokensB);
        if (shared == 0) return false;
        int minSize = Math.min(tokensA.size(), tokensB.size());
        int maxSize = Math.max(tokensA.size(), tokensB.size());
        return (double) shared / minSize >= 0.65 && (double) shared / maxSize >= 0.5;
    }

    private int countMatchingTokens(Set<String> a, Set<String> b) {
        int matches = 0;
        for (String tokenA : a) {
            if (b.contains(tokenA)) {
                matches++;
                continue;
            }
            if (tokenA.length() >= 5) {
                for (String tokenB : b) {
                    if (tokenB.length() >= 5 && levenshteinAtMostOne(tokenA, tokenB)) {
                        matches++;
                        break;
                    }
                }
            }
        }
        return matches;
    }

    private boolean levenshteinAtMostOne(String s1, String s2) {
        int lenDiff = Math.abs(s1.length() - s2.length());
        if (lenDiff > 1) return false;
        if (s1.length() == s2.length()) {
            int diffs = 0;
            for (int i = 0; i < s1.length(); i++) {
                if (s1.charAt(i) != s2.charAt(i) && ++diffs > 1) return false;
            }
            return true;
        }
        String shorter = s1.length() < s2.length() ? s1 : s2;
        String longer = s1.length() < s2.length() ? s2 : s1;
        int i = 0, j = 0;
        boolean skipped = false;
        while (i < shorter.length() && j < longer.length()) {
            if (shorter.charAt(i) == longer.charAt(j)) {
                i++;
                j++;
            } else {
                if (skipped) return false;
                skipped = true;
                j++;
            }
        }
        return true;
    }

    private double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
        double r = 6371000.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

    private String normalizeAsciiLower(String raw) {
        if (raw == null) return "";
        return Normalizer.normalize(raw.trim().toLowerCase(Locale.ROOT), Normalizer.Form.NFD)
                .replaceAll("\\p{InCombiningDiacriticalMarks}+", "");
    }

    private String normalizeTokenWord(String token) {
        return switch (token) {
            case "i" -> "1";
            case "ii" -> "2";
            case "iii" -> "3";
            case "iv" -> "4";
            default -> token;
        };
    }

    private String normalizeZoneKey(String raw) {
        String norm = normalizeAsciiLower(raw)
                .replaceAll("[^a-z0-9]+", "_")
                .replaceAll("^_+|_+$", "");
        return norm.length() > 64 ? norm.substring(0, 64) : norm;
    }

    private String canonicalZoneKey(String raw) {
        String base = normalizeZoneKey(raw);
        if (base.isBlank()) return "";
        String directAlias = ZONE_ALIASES.get(base);
        if (directAlias != null) return directAlias;

        List<String> stripped = new ArrayList<>();
        for (String part : base.split("_")) {
            if (part.isBlank()) continue;
            String normalized = normalizeTokenWord(part);
            if (!ZONE_PREFIX_WORDS.contains(normalized)) {
                stripped.add(normalized);
            }
        }
        String compact = String.join("_", stripped);
        if (!compact.isBlank()) {
            String alias = ZONE_ALIASES.get(compact);
            if (alias != null) return alias;
            return compact.length() > 64 ? compact.substring(0, 64) : compact;
        }
        return base;
    }

    private Set<String> extractZoneTokens(String raw) {
        Set<String> tokens = new LinkedHashSet<>();
        String clean = normalizeAsciiLower(raw).replaceAll("[^a-z0-9]+", " ");
        for (String part : clean.split("\\s+")) {
            if (part.isBlank()) continue;
            String normalized = normalizeTokenWord(part);
            if (!ZONE_PREFIX_WORDS.contains(normalized)) {
                tokens.add(normalized);
            }
        }
        return tokens;
    }

    private Set<String> extractContentTokens(String raw) {
        Set<String> tokens = new LinkedHashSet<>();
        String clean = normalizeAsciiLower(raw).replaceAll("[^a-z0-9]+", " ");
        for (String part : clean.split("\\s+")) {
            if (part.length() < 2) continue;
            String mapped = CONCEPT_SYNONYMS.getOrDefault(part, normalizeTokenWord(part));
            if (STOPWORDS.contains(mapped) || STOPWORDS.contains(part)) continue;
            tokens.add(mapped);
        }
        return tokens;
    }

    private Set<String> extractFallbackTokens(String raw) {
        Set<String> tokens = new LinkedHashSet<>();
        String clean = normalizeAsciiLower(raw).replaceAll("[^a-z0-9]+", " ");
        for (String part : clean.split("\\s+")) {
            if (part.length() >= 3) {
                tokens.add(CONCEPT_SYNONYMS.getOrDefault(part, normalizeTokenWord(part)));
            }
        }
        return tokens;
    }

    private String humanizeZoneKey(String zoneKey) {
        return Arrays.stream(zoneKey.split("_"))
                .filter(s -> !s.isBlank())
                .map(s -> Character.toUpperCase(s.charAt(0)) + s.substring(1))
                .reduce((a, b) -> a + " " + b)
                .orElse("Mazatlán");
    }

    private String defaultTypeLabel(String type) {
        return switch (type) {
            case "accidente" -> "Accidente / Choque";
            case "obras" -> "Obras / Bacheo";
            case "inundacion" -> "Calle inundada";
            case "desvio" -> "Desvío de ruta";
            case "trafico_pesado" -> "Tráfico muy lento";
            case "marcha_evento" -> "Marcha / Evento";
            case "sin_servicio" -> "Ya no están pasando";
            case "unidad_averiada" -> "Camión descompuesto";
            case "otro" -> "Otro incidente";
            default -> "Bloqueo / Calle cerrada";
        };
    }

    private String defaultDescriptionForType(String type, String zoneLabel) {
        return switch (type) {
            case "accidente" -> "Accidente o choque vial reportado en " + zoneLabel;
            case "obras" -> "Obras o reparación vial reportada en " + zoneLabel;
            case "inundacion" -> "Encharcamiento o inundación reportada en " + zoneLabel;
            case "desvio" -> "Desvío temporal de camiones en " + zoneLabel;
            case "trafico_pesado" -> "Tráfico muy lento reportado en " + zoneLabel;
            case "marcha_evento" -> "Marcha o evento con cierre vial en " + zoneLabel;
            case "sin_servicio" -> "Sin paso de unidades reportado en " + zoneLabel;
            case "unidad_averiada" -> "Camión descompuesto o varado en " + zoneLabel;
            default -> "Bloqueo o cierre vial reportado en " + zoneLabel;
        };
    }

    private String buildAutoNoticeTitle(String type, String typeLabel, String zoneLabel) {
        return switch (type) {
            case "accidente" -> "Accidente vial en " + zoneLabel;
            case "obras" -> "Obras viales en " + zoneLabel;
            case "inundacion" -> "Calle inundada en " + zoneLabel;
            case "desvio" -> "Desvío de rutas en " + zoneLabel;
            case "trafico_pesado" -> "Tráfico lento en " + zoneLabel;
            case "marcha_evento" -> "Marcha o evento en " + zoneLabel;
            case "sin_servicio" -> "Paso detenido en " + zoneLabel;
            case "unidad_averiada" -> "Camión descompuesto en " + zoneLabel;
            case "otro" -> ((typeLabel != null && !typeLabel.isBlank()) ? typeLabel : "Incidente") + " en " + zoneLabel;
            default -> "Bloqueo reportado en " + zoneLabel;
        };
    }

    private String buildAutoNoticeBody(int distinctReporters, String latestDescription) {
        return distinctReporters + " usuarios reportaron afectación reciente. " + latestDescription
                + " Si ya liberaron la calle, toca «Ya está todo bien».";
    }

    private static Map<String, String> buildZoneAliases() {
        Map<String, String> m = new HashMap<>();
        m.put("malecon", "malecon");
        m.put("del_mar", "malecon");
        m.put("malecon_del_mar", "malecon");
        m.put("buelna", "buelna");
        m.put("rafael_buelna", "buelna");
        m.put("ejercito", "ejercito");
        m.put("ejercito_mexicano", "ejercito");
        m.put("insurgentes", "insurgentes");
        m.put("sabalo", "sabalo");
        m.put("zona_dorada", "sabalo");
        m.put("camaron_sabalo", "sabalo");
        m.put("zona_dorada_sabalo", "sabalo");
        m.put("leyva", "leyva");
        m.put("gabriel_leyva", "leyva");
        m.put("centro", "centro");
        m.put("mercado", "centro");
        m.put("mercado_pino_suarez", "centro");
        m.put("centro_mercado", "centro");
        m.put("centro_mercado_pino_suarez", "centro");
        m.put("colosio", "colosio");
        m.put("luis_donaldo_colosio", "colosio");
        m.put("mex15", "mex15");
        m.put("mex_15", "mex15");
        m.put("internacional", "mex15");
        m.put("mexico_15", "mex15");
        m.put("internacional_mex_15", "mex15");
        m.put("marina", "marina");
        m.put("marina_mazatlan", "marina");
        m.put("cerritos", "cerritos");
        m.put("sabalo_cerritos", "cerritos");
        m.put("cerritos_sabalo_cerritos", "cerritos");
        m.put("reforma", "reforma");
        m.put("reforma_gran_plaza", "reforma");
        m.put("gutierrez_najera", "gutierrez_najera");
        m.put("munich", "munich");
        m.put("juan_pablo_2", "munich");
        m.put("munich_juan_pablo_2", "munich");
        m.put("juarez", "juarez");
        m.put("benito_juarez", "juarez");
        m.put("pradera_dorada", "pradera_dorada");
        m.put("pradera", "pradera_dorada");
        m.put("villa_verde", "pradera_dorada");
        m.put("pradera_dorada_villa_verde", "pradera_dorada");
        m.put("urias", "urias");
        m.put("urias_sur", "urias");
        m.put("escobosa", "escobosa");
        m.put("oscar_perez_escobosa", "escobosa");
        m.put("perez_escobosa", "escobosa");
        return Collections.unmodifiableMap(m);
    }

    private static Map<String, String> buildConceptSynonyms() {
        Map<String, String> m = new HashMap<>();
        for (String w : List.of("choque", "choco", "chocar", "chocaron", "accidente", "colision", "atropello", "volcadura")) {
            m.put(w, "choque");
        }
        for (String w : List.of("obra", "obras", "bache", "baches", "bacheo", "reparacion", "reparando", "zanja", "pavimentacion", "excavacion", "maquinaria")) {
            m.put(w, "obras");
        }
        for (String w : List.of("inundado", "inundada", "inundacion", "encharcamiento", "encharcado", "encharcada", "inunda", "charco", "anegado")) {
            m.put(w, "inundacion");
        }
        for (String w : List.of("semaforo", "semaforos")) {
            m.put(w, "semaforo");
        }
        for (String w : List.of("desvio", "desvios", "desviando", "desviaron", "desviacion", "rodeando")) {
            m.put(w, "desvio");
        }
        for (String w : List.of("descompuesto", "descompuso", "averiado", "averiada", "varado", "varada", "ponchado", "ponchada", "tirado", "apagado", "apagada", "apagaron", "sirve", "funciona", "danado", "danada", "roto", "rota")) {
            m.put(w, "averiado");
        }
        for (String w : List.of("marcha", "manifestacion", "planton", "desfile", "carnaval", "carrera", "evento", "concierto", "procesion")) {
            m.put(w, "evento");
        }
        for (String w : List.of("trafico", "congestion", "embotellamiento", "lento", "atorado", "parado", "fila", "colas")) {
            m.put(w, "trafico");
        }
        for (String w : List.of("fuga", "fugas", "derrame", "alcantarilla", "drenaje")) {
            m.put(w, "fuga");
        }
        for (String w : List.of("cable", "cables", "poste", "postes", "luz", "transformador")) {
            m.put(w, "cable_poste");
        }
        for (String w : List.of("arbol", "arboles", "rama", "ramas", "palmera")) {
            m.put(w, "arbol");
        }
        return Collections.unmodifiableMap(m);
    }
}
