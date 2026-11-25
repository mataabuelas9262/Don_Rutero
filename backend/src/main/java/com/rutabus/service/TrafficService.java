package com.rutabus.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class TrafficService {

    private static final Logger log = LoggerFactory.getLogger(TrafficService.class);
    private static final ZoneId MAZATLAN_ZONE = ZoneId.of("America/Mazatlan");

    // Bounding box estricta de Mazatlán y zona conurbada
    public static final double MIN_LAT = 23.12;
    public static final double MAX_LAT = 23.38;
    public static final double MIN_LNG = -106.55;
    public static final double MAX_LNG = -106.25;

    private static final long TELEMETRY_TTL_MS = 15 * 60_000L; // 15 min
    private static final int MAX_TELEMETRY_CELLS = 1500;
    private static final int MAX_CACHED_TILES = 250;

    public record CorridorDef(
            String id,
            String name,
            double midLat,
            double midLng,
            double freeFlowBusKmh,
            boolean coastalTourist,
            List<double[]> points
    ) {
    }

    private static final List<CorridorDef> FALLBACK_CORRIDORS = List.of(
            new CorridorDef("ejercito", "Av. Ejército Mexicano", 23.2335, -106.4238, 24.0, false, List.of(
                    new double[]{23.2232, -106.4194},
                    new double[]{23.2335, -106.4239},
                    new double[]{23.2450, -106.4255}
            )),
            new CorridorDef("buelna", "Av. Rafael Buelna", 23.2448, -106.4367, 25.0, true, List.of(
                    new double[]{23.2385, -106.4452},
                    new double[]{23.2448, -106.4367},
                    new double[]{23.2450, -106.4255}
            ))
    );

    private volatile List<CorridorDef> mazatlanCorridors = FALLBACK_CORRIDORS;

    @PostConstruct
    public void loadCorridorsFromResource() {
        try {
            ClassPathResource res = new ClassPathResource("mazatlan_corridors.json");
            if (!res.exists()) return;
            try (InputStream is = res.getInputStream()) {
                JsonNode arr = objectMapper.readTree(is);
                if (!arr.isArray() || arr.isEmpty()) return;
                List<CorridorDef> loaded = new ArrayList<>();
                for (JsonNode n : arr) {
                    List<double[]> pts = new ArrayList<>();
                    for (JsonNode pt : n.path("points")) {
                        if (pt.isArray() && pt.size() >= 2) {
                            pts.add(new double[]{pt.get(0).asDouble(), pt.get(1).asDouble()});
                        }
                    }
                    if (pts.size() >= 2) {
                        loaded.add(new CorridorDef(
                                n.path("id").asText(),
                                n.path("name").asText(),
                                n.path("midLat").asDouble(),
                                n.path("midLng").asDouble(),
                                n.path("freeFlowBusKmh").asDouble(24.0),
                                n.path("coastalTourist").asBoolean(false),
                                Collections.unmodifiableList(pts)
                        ));
                    }
                }
                if (!loaded.isEmpty()) {
                    this.mazatlanCorridors = Collections.unmodifiableList(loaded);
                    log.info("Cargados {} corredores viales exactos de Mazatlán para tráfico.", loaded.size());
                }
            }
        } catch (Exception e) {
            log.warn("No se pudo cargar mazatlan_corridors.json, usando respaldo: {}", e.getMessage());
        }
    }

    private static class TelemetryBucket {
        double latSum;
        double lngSum;
        double speedSum;
        int samples;
        long updatedAtMs;

        synchronized void add(double lat, double lng, double speedKmh, long nowMs) {
            if (nowMs - updatedAtMs > TELEMETRY_TTL_MS) {
                latSum = 0;
                lngSum = 0;
                speedSum = 0;
                samples = 0;
            }
            latSum += lat;
            lngSum += lng;
            speedSum += speedKmh;
            samples++;
            updatedAtMs = nowMs;
        }

        synchronized Map<String, Object> toDtoIfFresh(long nowMs) {
            if (samples <= 0 || nowMs - updatedAtMs > TELEMETRY_TTL_MS) {
                return null;
            }
            double avgLat = latSum / samples;
            double avgLng = lngSum / samples;
            double avgSpeed = Math.round((speedSum / samples) * 10.0) / 10.0;
            String level = avgSpeed >= 21.0 ? "fluido" : (avgSpeed >= 13.0 ? "moderado" : "lento");
            Map<String, Object> dto = new LinkedHashMap<>();
            dto.put("lat", Math.round(avgLat * 100000.0) / 100000.0);
            dto.put("lng", Math.round(avgLng * 100000.0) / 100000.0);
            dto.put("speedKmh", avgSpeed);
            dto.put("samples", samples);
            dto.put("level", level);
            return dto;
        }
    }

    private record CachedTile(byte[] bytes, long expiresAtMs) {
    }

    private record TomTomFlowReading(double currentSpeed, double freeFlowSpeed, long fetchedAtMs) {
    }

    @Value("${app.traffic.tomtom-api-key:}")
    private String tomtomApiKey;

    @Value("${app.traffic.tomtom-tile-ttl-ms:90000}")
    private long tomtomTileTtlMs;

    @Value("${app.traffic.tomtom-flow-ttl-ms:360000}")
    private long tomtomFlowTtlMs;

    @Autowired
    private ObjectMapper objectMapper;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(3500))
            .build();

    private final Map<String, TelemetryBucket> telemetryCells = new ConcurrentHashMap<>();
    private final Map<String, TomTomFlowReading> tomtomFlowCache = new ConcurrentHashMap<>();
    private volatile long lastTomTomFlowRefreshMs = 0L;

    private final Map<String, CachedTile> tileCache = Collections.synchronizedMap(
            new LinkedHashMap<>(MAX_CACHED_TILES + 16, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, CachedTile> eldest) {
                    return size() > MAX_CACHED_TILES;
                }
            }
    );

    public boolean isTomTomEnabled() {
        return tomtomApiKey != null && !tomtomApiKey.trim().isEmpty();
    }

    public boolean isInsideMazatlan(double lat, double lng) {
        return Double.isFinite(lat) && Double.isFinite(lng)
                && lat >= MIN_LAT && lat <= MAX_LAT
                && lng >= MIN_LNG && lng <= MAX_LNG;
    }

    public boolean recordTelemetryPing(double lat, double lng, double speedKmh) {
        if (!isInsideMazatlan(lat, lng) || !Double.isFinite(speedKmh) || speedKmh < 2.0 || speedKmh > 70.0) {
            return false;
        }
        long now = System.currentTimeMillis();
        long latCell = Math.round(lat * 440.0);
        long lngCell = Math.round(lng * 400.0);
        String key = latCell + ":" + lngCell;
        telemetryCells.computeIfAbsent(key, k -> new TelemetryBucket()).add(lat, lng, speedKmh, now);

        if (telemetryCells.size() > MAX_TELEMETRY_CELLS) {
            telemetryCells.entrySet().removeIf(e -> now - e.getValue().updatedAtMs > TELEMETRY_TTL_MS);
        }
        return true;
    }

    public boolean isTileInMazatlan(int z, int x, int y) {
        if (z < 10 || z > 18) return false;
        int maxIdx = (1 << z) - 1;
        if (x < 0 || x > maxIdx || y < 0 || y > maxIdx) return false;

        double n = 1 << z;
        double westLng = x / n * 360.0 - 180.0;
        double eastLng = (x + 1) / n * 360.0 - 180.0;
        double northLat = tileYToLat(y, n);
        double southLat = tileYToLat(y + 1, n);

        boolean latOverlaps = southLat <= (MAX_LAT + 0.08) && northLat >= (MIN_LAT - 0.08);
        boolean lngOverlaps = westLng <= (MAX_LNG + 0.08) && eastLng >= (MIN_LNG - 0.08);
        return latOverlaps && lngOverlaps;
    }

    private double tileYToLat(int y, double n) {
        double rad = Math.PI - (2.0 * Math.PI * y) / n;
        return Math.toDegrees(Math.atan(Math.sinh(rad)));
    }

    public byte[] getTrafficFlowTile(int z, int x, int y) {
        if (!isTomTomEnabled() || !isTileInMazatlan(z, x, y)) {
            return null;
        }
        String cacheKey = z + "/" + x + "/" + y;
        long now = System.currentTimeMillis();
        CachedTile cached = tileCache.get(cacheKey);
        if (cached != null && cached.expiresAtMs() > now) {
            return cached.bytes();
        }
        try {
            String url = "https://api.tomtom.com/traffic/map/4/tile/flow/relative0/"
                    + z + "/" + x + "/" + y + ".png?tileSize=256&thickness=8&key=" + tomtomApiKey.trim();
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofMillis(4000))
                    .GET()
                    .build();
            HttpResponse<byte[]> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofByteArray());
            if (resp.statusCode() == 200 && resp.body() != null && resp.body().length > 0) {
                tileCache.put(cacheKey, new CachedTile(resp.body(), now + Math.max(15_000L, tomtomTileTtlMs)));
                return resp.body();
            }
        } catch (Exception e) {
            log.warn("TomTom tile fetch fallback ({}/{}/{}): {}", z, x, y, e.getMessage());
        }
        return cached != null ? cached.bytes() : null;
    }

    public Map<String, Object> getLiveTrafficSummary() {
        long nowMs = System.currentTimeMillis();
        ZonedDateTime mztNow = ZonedDateTime.now(MAZATLAN_ZONE);
        refreshTomTomCorridorsIfNeeded(nowMs, mztNow);

        List<Map<String, Object>> communityCells = collectFreshCommunityCells(nowMs);
        double[] timeProfile = computeMazatlanTimeFactors(mztNow);
        double urbanFactor = timeProfile[0];
        double touristFactor = timeProfile[1];
        String periodLabel = classifyPeriodLabel(mztNow);

        List<Map<String, Object>> corridorList = new ArrayList<>();
        double speedSum = 0.0;
        boolean usedTomTom = false;
        boolean usedCommunity = false;

        List<CorridorDef> corridors = this.mazatlanCorridors;
        for (CorridorDef c : corridors) {
            double freeBusKmh = c.freeFlowBusKmh();
            double baseFactor = c.coastalTourist() ? touristFactor : urbanFactor;
            double effectiveBusKmh = freeBusKmh * baseFactor;
            String corrSource = "estimacion_horaria";

            TomTomFlowReading tt = tomtomFlowCache.get(c.id());
            if (tt != null && (nowMs - tt.fetchedAtMs()) <= (tomtomFlowTtlMs * 2L) && tt.freeFlowSpeed() > 5.0) {
                double ratio = Math.max(0.25, Math.min(1.05, tt.currentSpeed() / tt.freeFlowSpeed()));
                effectiveBusKmh = freeBusKmh * ratio;
                corrSource = "tomtom";
                usedTomTom = true;
            }

            // Mezclar telemetría comunitaria GPS real cercana al corredor
            double nearbyGpsSum = 0.0;
            int nearbyWeight = 0;
            for (Map<String, Object> cell : communityCells) {
                double clat = ((Number) cell.get("lat")).doubleValue();
                double clng = ((Number) cell.get("lng")).doubleValue();
                if (approxMeters(c.midLat(), c.midLng(), clat, clng) <= 1300.0) {
                    int samples = ((Number) cell.get("samples")).intValue();
                    double gpsSpeed = ((Number) cell.get("speedKmh")).doubleValue();
                    nearbyGpsSum += gpsSpeed * samples;
                    nearbyWeight += samples;
                }
            }
            if (nearbyWeight > 0) {
                double gpsAvg = nearbyGpsSum / nearbyWeight;
                double gpsBlend = Math.min(0.75, 0.35 + nearbyWeight * 0.10);
                effectiveBusKmh = effectiveBusKmh * (1.0 - gpsBlend) + gpsAvg * gpsBlend;
                corrSource = "tomtom".equals(corrSource) ? "tomtom_y_gps" : "gps_comunitario";
                usedCommunity = true;
            }

            effectiveBusKmh = Math.max(8.0, Math.min(32.0, Math.round(effectiveBusKmh * 10.0) / 10.0));
            double ratio = effectiveBusKmh / freeBusKmh;
            String level = ratio >= 0.75 ? "fluido" : (ratio >= 0.52 ? "moderado" : "lento");

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", c.id());
            item.put("name", c.name());
            item.put("midLat", c.midLat());
            item.put("midLng", c.midLng());
            item.put("speedKmh", effectiveBusKmh);
            item.put("freeFlowBusKmh", freeBusKmh);
            item.put("ratio", Math.round(ratio * 100.0) / 100.0);
            item.put("level", level);
            item.put("source", corrSource);
            item.put("points", c.points());
            corridorList.add(item);

            speedSum += effectiveBusKmh;
        }

        double avgBusSpeedKmh = Math.round((speedSum / corridors.size()) * 10.0) / 10.0;
        String overallLevel = avgBusSpeedKmh >= 19.5 ? "fluido" : (avgBusSpeedKmh >= 14.5 ? "moderado" : "lento");

        String sourceMode = usedTomTom && usedCommunity ? "tomtom_y_gps"
                : usedTomTom ? "tomtom"
                : usedCommunity ? "gps_comunitario"
                : "estimacion_horaria";

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("source", sourceMode);
        out.put("tomtomTilesEnabled", isTomTomEnabled());
        out.put("mazatlanTime", String.format("%02d:%02d", mztNow.getHour(), mztNow.getMinute()));
        out.put("periodLabel", periodLabel);
        out.put("overallLevel", overallLevel);
        out.put("avgBusSpeedKmh", avgBusSpeedKmh);
        out.put("corridors", corridorList);
        out.put("communityCells", communityCells);
        return out;
    }

    private List<Map<String, Object>> collectFreshCommunityCells(long nowMs) {
        List<Map<String, Object>> cells = new ArrayList<>();
        Iterator<Map.Entry<String, TelemetryBucket>> it = telemetryCells.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<String, TelemetryBucket> entry = it.next();
            Map<String, Object> dto = entry.getValue().toDtoIfFresh(nowMs);
            if (dto == null) {
                it.remove();
            } else {
                cells.add(dto);
            }
        }
        return cells;
    }

    private synchronized void refreshTomTomCorridorsIfNeeded(long nowMs, ZonedDateTime mztNow) {
        if (!isTomTomEnabled()) return;
        if (nowMs - lastTomTomFlowRefreshMs < tomtomFlowTtlMs) return;
        // Evitar consumo de cuota en madrugada cuando casi no hay camiones (00:00 - 05:15)
        int mins = mztNow.getHour() * 60 + mztNow.getMinute();
        if (mins < 315 && !tomtomFlowCache.isEmpty()) return;

        lastTomTomFlowRefreshMs = nowMs;
        List<CorridorDef> corridors = this.mazatlanCorridors;
        for (CorridorDef c : corridors) {
            try {
                String url = "https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/12/json?point="
                        + c.midLat() + "," + c.midLng() + "&key=" + tomtomApiKey.trim();
                HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                        .timeout(Duration.ofMillis(3500))
                        .GET()
                        .build();
                HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
                if (resp.statusCode() == 200) {
                    JsonNode seg = objectMapper.readTree(resp.body()).path("flowSegmentData");
                    double current = seg.path("currentSpeed").asDouble(-1);
                    double free = seg.path("freeFlowSpeed").asDouble(-1);
                    if (current > 0 && free > 0) {
                        tomtomFlowCache.put(c.id(), new TomTomFlowReading(current, free, nowMs));
                    }
                }
            } catch (Exception e) {
                log.debug("TomTom flow segment omitido para {}: {}", c.id(), e.getMessage());
            }
        }
    }

    /**
     * Modelo de congestión típico por horario en Mazatlán [urbanFactor, coastalTouristFactor].
     */
    private double[] computeMazatlanTimeFactors(ZonedDateTime mztNow) {
        int mins = mztNow.getHour() * 60 + mztNow.getMinute();
        DayOfWeek dow = mztNow.getDayOfWeek();
        boolean isWeekend = (dow == DayOfWeek.FRIDAY || dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY);

        double urban = 0.92;
        double tourist = 0.90;

        if (!isWeekend && mins >= 420 && mins < 540) {
            urban = 0.64;
            tourist = 0.78;
        } else if (mins >= 780 && mins < 915) {
            urban = 0.68;
            tourist = 0.74;
        } else if (mins >= 1050 && mins < 1200) {
            urban = isWeekend ? 0.76 : 0.63;
            tourist = isWeekend ? 0.56 : 0.62;
        } else if (isWeekend && mins >= 1200 && mins < 1350) {
            urban = 0.84;
            tourist = 0.64;
        } else if (mins >= 540 && mins < 780) {
            urban = 0.85;
            tourist = 0.84;
        } else if (mins >= 915 && mins < 1050) {
            urban = 0.82;
            tourist = 0.78;
        } else {
            urban = 0.98;
            tourist = 0.96;
        }

        return new double[]{urban, tourist};
    }

    private String classifyPeriodLabel(ZonedDateTime mztNow) {
        int mins = mztNow.getHour() * 60 + mztNow.getMinute();
        DayOfWeek dow = mztNow.getDayOfWeek();
        boolean isWeekend = (dow == DayOfWeek.FRIDAY || dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY);

        if (!isWeekend && mins >= 420 && mins < 540) return "Hora pico matutina";
        if (mins >= 780 && mins < 915) return "Hora pico mediodía";
        if (mins >= 1050 && mins < 1200) return isWeekend ? "Tráfico turístico vespertino" : "Hora pico vespertina";
        if (isWeekend && mins >= 1200 && mins < 1350) return "Zona turística concurrida";
        if (mins < 330 || mins >= 1350) return "Flujo nocturno ligero";
        return "Flujo regular";
    }

    private double approxMeters(double lat1, double lng1, double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 6371000.0 * 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
