/* -----------------------------------------------------
   GESTIÓN DEL MAPA LEAFLET (Ruta_Bus)
   ----------------------------------------------------- */

// Coordenadas base: Mazatlán, Sinaloa
const MAP_CENTER = [23.2329, -106.4062];
const DEFAULT_ZOOM = 13;

let mapInstance = null;
let activePolylines = []; // Almacena las líneas dibujadas
let activeMarkers = [];    // Almacena los marcadores de paradas
let allStopsMarkers = [];  // Almacena los marcadores de todas las paradas físicas del sistema
let allStopsClusterGroup = null; // Grupo de clustering para evitar amontonamiento de paradas
let activeArrows = [];     // Almacena las flechas de dirección del recorrido
let allPhysicalStopsList = []; // Catálogo global de paradas físicas para búsqueda y autocompletado

function escapeMapHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function safeMapColor(color, fallback = '#475569') {
    const val = String(color || '').trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(val) ? val : fallback;
}

// Inicializa el mapa
function initLeafletMap(containerId) {
    if (mapInstance) return mapInstance;

    // Crear mapa centrado en Mazatlán (preferCanvas acelera polilíneas al arrastrar/hacer zoom)
    mapInstance = L.map(containerId, {
        preferCanvas: true,
        zoomControl: false // Quitamos control de zoom por defecto para posicionarlo a la derecha
    });
    
    mapInstance.setView(MAP_CENTER, DEFAULT_ZOOM);

    // Añadir control de zoom en la esquina superior izquierda
    L.control.zoom({ position: 'topleft' }).addTo(mapInstance);

    // Cargar capa base de OpenStreetMap (gratuita y sin API Key)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxNativeZoom: 19,
        maxZoom: 20
    }).addTo(mapInstance);

    return mapInstance;
}

let activeRouteStopEntries = []; // Marcadores inteligentes del recorrido seleccionado (adaptativos al zoom)

// Controla si se muestran las paradas globales del sistema en el mapa
function setPhysicalStopsVisible(visible) {
    if (!mapInstance) return;
    if (allStopsClusterGroup) {
        if (visible && !mapInstance.hasLayer(allStopsClusterGroup)) {
            mapInstance.addLayer(allStopsClusterGroup);
        } else if (!visible && mapInstance.hasLayer(allStopsClusterGroup)) {
            mapInstance.removeLayer(allStopsClusterGroup);
        }
        return;
    }
    allStopsMarkers.forEach(m => {
        if (visible && !mapInstance.hasLayer(m)) m.addTo(mapInstance);
        else if (!visible && mapInstance.hasLayer(m)) mapInstance.removeLayer(m);
    });
}

// Limpia el mapa de trazados y paradas seleccionadas
function clearMapDrawings() {
    if (mapInstance) {
        mapInstance.off('zoomend', updateRouteStopsVisibility);
    }

    activePolylines.forEach(p => mapInstance.removeLayer(p));
    activePolylines = [];

    activeMarkers.forEach(m => mapInstance.removeLayer(m));
    activeMarkers = [];

    activeRouteStopEntries.forEach(entry => {
        if (mapInstance && mapInstance.hasLayer(entry.marker)) {
            mapInstance.removeLayer(entry.marker);
        }
    });
    activeRouteStopEntries = [];
    
    if (activeArrows) {
        activeArrows.forEach(a => mapInstance.removeLayer(a));
        activeArrows = [];
    }

    setPhysicalStopsVisible(true);
}

// Dibuja flechas de dirección adaptativas al zoom y al área visible del mapa
function drawRouteArrows(latLngs, color = '#6366f1') {
    if (!mapInstance || !latLngs || latLngs.length < 2) return [];

    const safeColor = safeMapColor(color);
    let totalDistance = 0;
    const distances = [0];

    for (let i = 0; i < latLngs.length - 1; i++) {
        const p1 = L.latLng(latLngs[i][0], latLngs[i][1]);
        const p2 = L.latLng(latLngs[i + 1][0], latLngs[i + 1][1]);
        totalDistance += p1.distanceTo(p2);
        distances.push(totalDistance);
    }

    if (totalDistance < 10) return [];

    // Colocar puntos candidatos cada ~130 m (máx. 350 por ruta); el viewport culling mantiene muy pocas flechas activas en DOM
    const step = Math.max(130, totalDistance / 350);
    let nextArrowDist = Math.min(step / 2, totalDistance / 2);
    const candidates = [];

    for (let i = 0; i < latLngs.length - 1; i++) {
        while (nextArrowDist >= distances[i] && nextArrowDist < distances[i + 1]) {
            const segmentLen = distances[i + 1] - distances[i];
            if (segmentLen > 0.1) {
                const ratio = (nextArrowDist - distances[i]) / segmentLen;
                const lat = latLngs[i][0] + (latLngs[i + 1][0] - latLngs[i][0]) * ratio;
                const lng = latLngs[i][1] + (latLngs[i + 1][1] - latLngs[i][1]) * ratio;

                const dLat = latLngs[i + 1][0] - latLngs[i][0];
                const dLon = (latLngs[i + 1][1] - latLngs[i][1]) * Math.cos(lat * Math.PI / 180);
                const angle = Math.atan2(dLon, dLat) * (180 / Math.PI);

                candidates.push({
                    latlng: L.latLng(lat, lng),
                    angle,
                    marker: null
                });
            }
            nextArrowDist += step;
        }
    }

    if (candidates.length === 0) return [];

    const arrowGroup = L.layerGroup().addTo(mapInstance);

    const buildArrowMarker = (entry) => {
        const arrowIcon = L.divIcon({
            className: 'route-direction-arrow',
            html: `<div style="transform: rotate(${entry.angle.toFixed(1)}deg); display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; pointer-events: none;">
                     <svg viewBox="0 0 24 24" width="20" height="20" style="fill: ${safeColor}; stroke: #ffffff; stroke-width: 4.5px; stroke-linejoin: round; stroke-linecap: round; paint-order: stroke fill;">
                       <path d="M12 2 L21 20 L12 15.5 L3 20 Z" />
                     </svg>
                   </div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });
        return L.marker(entry.latlng, {
            icon: arrowIcon,
            interactive: false,
            zIndexOffset: 250
        });
    };

    const syncVisibleArrows = () => {
        if (!mapInstance || !mapInstance.hasLayer(arrowGroup)) return;
        const zoom = mapInstance.getZoom();
        const stride = zoom >= 16 ? 1 : (zoom >= 14 ? 2 : 4);
        const visibleBounds = mapInstance.getBounds().pad(0.25);

        for (let idx = 0; idx < candidates.length; idx++) {
            const entry = candidates[idx];
            const shouldShow = (idx % stride === 0) && visibleBounds.contains(entry.latlng);
            if (shouldShow) {
                if (!entry.marker) entry.marker = buildArrowMarker(entry);
                if (!arrowGroup.hasLayer(entry.marker)) {
                    arrowGroup.addLayer(entry.marker);
                }
            } else if (entry.marker && arrowGroup.hasLayer(entry.marker)) {
                arrowGroup.removeLayer(entry.marker);
            }
        }
    };

    mapInstance.on('zoomend moveend', syncVisibleArrows);
    arrowGroup.on('remove', () => {
        if (mapInstance) {
            mapInstance.off('zoomend moveend', syncVisibleArrows);
        }
    });

    syncVisibleArrows();
    return [arrowGroup];
}

// Calcula padding seguro para fitBounds respetando el Bottom Sheet en móvil
function getResponsiveFitBoundsOptions(basePadding = 50, extraOptions = {}) {
    const isMobileUserView = window.innerWidth <= 768 && !document.body.classList.contains('admin-body');
    if (isMobileUserView) {
        const sheetHeight = Math.round(window.innerHeight * 0.42);
        return Object.assign({
            paddingTopLeft: [24, 68],
            paddingBottomRight: [24, sheetHeight + 16]
        }, extraOptions);
    }
    return Object.assign({
        padding: [basePadding, basePadding]
    }, extraOptions);
}

// Dibuja una línea de ruta en el mapa exactamente por las coordenadas trazadas
function drawRouteLine(coordinates, color = '#6366f1', options = {}) {
    if (!mapInstance || !coordinates || coordinates.length === 0) return;

    const {
        weight = 5,
        opacity = 0.9,
        showArrows = true,
        fitBounds = true,
        dashArray = null
    } = options;

    // Convertir coordenadas del backend {latitude, longitude} a formato Leaflet [lat, lng]
    const latLngs = coordinates.map(c => [c.latitude, c.longitude]);

    // Crear polilínea exacta sin desplazamientos ni separaciones para que pase justo por las calles marcadas
    const polyOpts = {
        color: color,
        weight,
        opacity,
        lineJoin: 'round'
    };
    if (dashArray) polyOpts.dashArray = dashArray;

    const polyline = L.polyline(latLngs, polyOpts).addTo(mapInstance);
    activePolylines.push(polyline);

    // Dibuja flechas directrices a lo largo de la ruta para indicar el sentido del camión en cada calle
    if (showArrows) {
        const arrows = drawRouteArrows(latLngs, color);
        activeArrows.push(...arrows);
    }

    // Ajustar vista para encuadrar la ruta sin quedar oculta tras el panel inferior en móvil
    if (fitBounds) {
        mapInstance.fitBounds(polyline.getBounds(), getResponsiveFitBoundsOptions(50));
    }
    return polyline;
}

const STOP_GLYPH_PATHS = {
    escuela: '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 2.7 3.5 6 3.5s6-1.5 6-3.5v-5"/>',
    hospital: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 7v10M7 12h10"/>',
    farmacia: '<path d="M10.5 20.5 19.5 11.5a4.95 4.95 0 0 0-7-7l-9 9a4.95 4.95 0 0 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
    comercio: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    transporte: '<path d="M8 6v6"/><path d="M16 6v6"/><path d="M2 12h20"/><path d="M4 18V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v11"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/>',
    hotel: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
    parque: '<path d="M12 22v-5"/><path d="M12 17c-4 0-6.5-2.6-6.5-6 2.5 0 4.2-1.5 6.5-5 2.3 3.5 4 5 6.5 5 0 3.4-2.5 6-6.5 6Z"/>',
    turistico: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/>',
    iglesia: '<path d="M12 2v6"/><path d="M9 5h6"/><path d="M5 22V12l7-4 7 4v10"/><path d="M10 22v-5h4v5"/>',
    deportivo: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    banco: '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M12 2 2 7h20L12 2Z"/>',
    gasolinera: '<path d="M3 22V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v17"/><path d="M3 12h11"/><path d="M14 7h2a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9l-3-3"/>',
    restaurante: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    refaccionaria: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/>',
    colonia: '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',
    calle: '<path d="M12 2v20"/><path d="M6 5h11l2 2.5L17 10H6z"/><path d="M18 14H7l-2 2.5L7 19h11z"/>',
    parada: '<circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5.4 7 11.5 7.35 11.8a1 1 0 0 0 1.3 0C13 21.5 20 15.4 20 10a8 8 0 0 0-8-8Z"/>'
};

function renderStopCategorySvg(iconKey, sizePx = 15) {
    const inner = STOP_GLYPH_PATHS[iconKey] || STOP_GLYPH_PATHS.parada;
    const sz = Number(sizePx) || 15;
    return `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none; display:block; flex-shrink:0;">${inner}</svg>`;
}

// Helper para obtener configuración vectorial SVG y color de marca según la categoría del lugar en Mazatlán (sin emojis)
function getStopIconConfig(stopName, stopType) {
    const type = (stopType || '').toLowerCase().trim();
    const name = (stopName || '').toLowerCase();

    // 1. Priorizar el tipo explícito guardado en base de datos o inferido de OSM
    if (type === 'escuela') {
        return { iconKey: 'escuela', iconUrl: 'assets/icons/pin_escuela.svg', bgColor: '#2563EB', category: 'Centro Educativo / Campus' };
    }
    if (type === 'hospital') {
        return { iconKey: 'hospital', iconUrl: 'assets/icons/pin_hospital.svg', bgColor: '#DC2626', category: 'Hospital / Centro Médico' };
    }
    if (type === 'salud' || type === 'farmacia' || type === 'laboratorio' || type === 'veterinaria') {
        return { iconKey: 'farmacia', iconUrl: 'assets/icons/pin_farmacia.svg', bgColor: '#E11D48', category: 'Salud / Farmacia' };
    }
    if (type === 'restaurante' || type === 'comida' || type === 'comida_rapida') {
        return { iconKey: 'restaurante', iconUrl: 'assets/icons/pin_restaurante.svg', bgColor: '#F43F5E', category: 'Restaurante / Comida' };
    }
    if (type === 'hotel' || type === 'playa') {
        return { iconKey: 'hotel', iconUrl: 'assets/icons/pin_hotel.svg', bgColor: '#0891B2', category: 'Hotel / Zona Costera' };
    }
    if (type === 'parque' || type === 'plaza') {
        return { iconKey: 'parque', iconUrl: 'assets/icons/pin_parque.svg', bgColor: '#15803D', category: 'Parque / Plaza Pública' };
    }
    if (type === 'turistico' || type === 'entretenimiento') {
        return { iconKey: 'turistico', iconUrl: 'assets/icons/pin_museo.svg', bgColor: '#7C3AED', category: 'Punto Turístico / Cultura' };
    }
    if (type === 'iglesia' || type === 'gobierno' || type === 'tramite' || type === 'biblioteca') {
        return { iconKey: 'iglesia', iconUrl: 'assets/icons/pin_museo.svg', bgColor: '#4F46E5', category: type === 'iglesia' ? 'Templo / Iglesia' : 'Gobierno / Servicio Público' };
    }
    if (type === 'deportivo' || type === 'gimnasio') {
        return { iconKey: 'deportivo', iconUrl: 'assets/icons/pin_parque.svg', bgColor: '#0D9488', category: 'Deporte / Gimnasio' };
    }
    if (type === 'centro_comercial' || type === 'comercio' || type === 'mercado' || type === 'tienda_conveniencia' || type === 'servicio') {
        return { iconKey: 'comercio', iconUrl: 'assets/icons/pin_tienda.svg', bgColor: '#059669', category: 'Comercio / Plaza Comercial' };
    }
    if (type === 'transporte') {
        return { iconKey: 'transporte', iconUrl: 'assets/icons/pin_puerto.svg', bgColor: '#D97706', category: 'Terminal / Transporte' };
    }
    if (type === 'banco') {
        return { iconKey: 'banco', iconUrl: 'assets/icons/pin_tienda.svg', bgColor: '#10B981', category: 'Sucursal Bancaria' };
    }
    if (type === 'gasolinera') {
        return { iconKey: 'gasolinera', iconUrl: 'assets/icons/pin_tienda.svg', bgColor: '#F59E0B', category: 'Estación de Servicio' };
    }
    if (type === 'refaccionaria' || type === 'ferreteria' || type === 'empresa' || type === 'industria') {
        return { iconKey: 'refaccionaria', iconUrl: 'assets/icons/pin_tienda.svg', bgColor: '#4B5563', category: 'Refaccionaria / Industria' };
    }
    if (type === 'colonia') {
        return { iconKey: 'colonia', iconUrl: 'assets/icons/ui_ubicacion.svg', bgColor: '#0EA5E9', category: 'Colonia / Zona' };
    }
    if (type === 'calle') {
        return { iconKey: 'calle', iconUrl: 'assets/icons/ui_buscar.svg', bgColor: '#64748B', category: 'Calle / Vialidad' };
    }

    // 2. Respaldo heurístico por nombre cuando el tipo es genérico ("lugar", "zona", "parada", vacío)
    if (name.includes('uas') || name.includes('itmaz') || name.includes('upsin') || name.includes('ico') || name.includes('universidad') || name.includes('tecnológico') || name.includes('campus') || name.includes('escuela') || name.includes('colegio') || name.includes('instituto') || name.includes('cbtis') || name.includes('cetmar') || name.includes('conalep')) {
        return { iconKey: 'escuela', iconUrl: 'assets/icons/pin_escuela.svg', bgColor: '#2563EB', category: 'Centro Educativo / Campus' };
    }
    if (name.includes('hospital') || name.includes('imss') || name.includes('issste') || name.includes('sharp') || name.includes('martiniano') || name.includes('clínica') || name.includes('médico') || name.includes('cruz roja') || name.includes('alhma')) {
        return { iconKey: 'hospital', iconUrl: 'assets/icons/pin_hospital.svg', bgColor: '#DC2626', category: 'Hospital / Centro Médico' };
    }
    if (name.includes('farmacia')) {
        return { iconKey: 'farmacia', iconUrl: 'assets/icons/pin_farmacia.svg', bgColor: '#E11D48', category: 'Salud / Farmacia' };
    }
    if (name.includes('parque') || name.includes('plazuela')) {
        return { iconKey: 'parque', iconUrl: 'assets/icons/pin_parque.svg', bgColor: '#15803D', category: 'Parque / Plaza Pública' };
    }
    if (name.includes('mercado') || name.includes('plaza') || name.includes('galerías') || name.includes('sendero') || name.includes('acaya') || name.includes('soriana') || name.includes('ley') || name.includes('walmart') || name.includes('tienda') || name.includes('comercial') || name.includes('home depot') || name.includes('sams club') || name.includes('bodega aurrera') || name.includes('office depot') || name.includes('coppel') || name.includes('oxxo') || name.includes('kiosko')) {
        return { iconKey: 'comercio', iconUrl: 'assets/icons/pin_tienda.svg', bgColor: '#059669', category: 'Comercio / Plaza Comercial' };
    }
    if (name.includes('central') || name.includes('terminal') || name.includes('autobuses') || name.includes('marítima') || name.includes('ferry') || name.includes('ferries') || name.includes('aeropuerto') || name.includes('puerto') || name.includes('embarcadero') || name.includes('cruceros')) {
        return { iconKey: 'transporte', iconUrl: 'assets/icons/pin_puerto.svg', bgColor: '#D97706', category: 'Terminal / Transporte' };
    }
    if (name.includes('hotel') || name.includes('riu') || name.includes('resort') || name.includes('playa') || name.includes('cerritos') || name.includes('dorada') || name.includes('olas altas') || name.includes('marina') || name.includes('yates') || name.includes('venadito') || name.includes('pueblo bonito') || name.includes('brujas')) {
        return { iconKey: 'hotel', iconUrl: 'assets/icons/pin_hotel.svg', bgColor: '#0891B2', category: 'Hotel / Zona Costera' };
    }
    if (name.includes('acuario') || name.includes('monumento') || name.includes('monos') || name.includes('clavadista') || name.includes('teatro') || name.includes('mirador') || name.includes('malecón') || name.includes('cinépolis') || name.includes('cinemex') || name.includes('museo')) {
        return { iconKey: 'turistico', iconUrl: 'assets/icons/pin_museo.svg', bgColor: '#7C3AED', category: 'Punto Turístico / Cultura' };
    }
    if (name.includes('catedral') || name.includes('iglesia') || name.includes('templo') || name.includes('palacio') || name.includes('ayuntamiento')) {
        return { iconKey: 'iglesia', iconUrl: 'assets/icons/pin_museo.svg', bgColor: '#4F46E5', category: 'Templo / Gobierno' };
    }
    if (name.includes('estadio') || name.includes('teodoro') || name.includes('encanto') || name.includes('cancha') || name.includes('gimnasio') || name.includes('gym') || name.includes('deportivo') || name.includes('skate')) {
        return { iconKey: 'deportivo', iconUrl: 'assets/icons/pin_parque.svg', bgColor: '#0D9488', category: 'Deporte / Gimnasio' };
    }
    if (name.includes('bbva') || name.includes('banorte') || name.includes('santander') || name.includes('banamex') || name.includes('scotiabank') || name.includes('banco')) {
        return { iconKey: 'banco', iconUrl: 'assets/icons/pin_tienda.svg', bgColor: '#10B981', category: 'Sucursal Bancaria' };
    }
    if (name.includes('gasolinera') || name.includes('pemex') || name.includes('gasmaz') || name.includes('gas station')) {
        return { iconKey: 'gasolinera', iconUrl: 'assets/icons/pin_tienda.svg', bgColor: '#F59E0B', category: 'Estación de Servicio' };
    }
    if (name.includes('restaurante') || name.includes('taquería') || name.includes('mariscos') || name.includes('bistro') || name.includes('café') || name.includes('cervecería') || name.includes('panamá') || name.includes('sushi') || name.includes('pizza')) {
        return { iconKey: 'restaurante', iconUrl: 'assets/icons/pin_restaurante.svg', bgColor: '#F43F5E', category: 'Restaurante / Comida' };
    }
    if (name.includes('industrial') || name.includes('s.a. de c.v.') || name.includes('grupo') || name.includes('envases') || name.includes('refaccion') || name.includes('autozone')) {
        return { iconKey: 'refaccionaria', iconUrl: 'assets/icons/pin_tienda.svg', bgColor: '#4B5563', category: 'Refaccionaria / Industria' };
    }
    return { iconKey: 'parada', iconUrl: 'assets/icons/pin_parada.svg', bgColor: '#475569', category: 'Parada Oficial del Sistema' };
}

let activeRouteStopsMinIconZoom = 15;

function updateRouteStopsVisibility() {
    if (!mapInstance || activeRouteStopEntries.length === 0) return;

    const zoom = mapInstance.getZoom();
    const useCompactDots = zoom < activeRouteStopsMinIconZoom;
    const minPixelGap = zoom >= 17 ? 0 : (zoom >= 16 ? 24 : (zoom >= 15 ? 36 : 48));
    const keptPoints = [];

    // 1. Siempre mantener visibles Inicio y Fin de la ruta
    activeRouteStopEntries.forEach(entry => {
        if (!entry.isEndpoint) return;
        entry.marker.setIcon(entry.fullIcon);
        if (!mapInstance.hasLayer(entry.marker)) entry.marker.addTo(mapInstance);
        keptPoints.push(mapInstance.latLngToContainerPoint(entry.latlng));
    });

    // 2. Filtrar paradas intermedias por distancia mínima en pantalla según el nivel de zoom
    activeRouteStopEntries.forEach(entry => {
        if (entry.isEndpoint) return;
        const pt = mapInstance.latLngToContainerPoint(entry.latlng);
        const collides = minPixelGap > 0 && keptPoints.some(kp => pt.distanceTo(kp) < minPixelGap);

        if (collides) {
            if (mapInstance.hasLayer(entry.marker)) {
                mapInstance.removeLayer(entry.marker);
            }
        } else {
            entry.marker.setIcon(useCompactDots ? entry.compactIcon : entry.fullIcon);
            if (!mapInstance.hasLayer(entry.marker)) {
                entry.marker.addTo(mapInstance);
            }
            keptPoints.push(pt);
        }
    });
}

function focusRouteStopOnMap(stopId) {
    if (!mapInstance || activeRouteStopEntries.length === 0) return;
    const entry = activeRouteStopEntries.find(e => e.stopId === stopId);
    if (!entry) return;

    const isMobileUserView = window.innerWidth <= 768 && !document.body.classList.contains('admin-body');
    if (isMobileUserView && typeof setMobileSheetState === 'function') {
        setMobileSheetState('half');
    }

    mapInstance.flyTo(entry.latlng, Math.max(mapInstance.getZoom(), 17), { duration: 0.7 });
    setTimeout(() => {
        entry.marker.setIcon(entry.fullIcon);
        if (!mapInstance.hasLayer(entry.marker)) entry.marker.addTo(mapInstance);
        entry.marker.openPopup();
        if (isMobileUserView) {
            mapInstance.panBy([0, Math.round(window.innerHeight * 0.16)], { animate: true });
        }
    }, 450);
}

// Dibuja los marcadores de paradas de una ruta evitando amontonamiento según el zoom
function drawRouteStops(stops, color = '#6366f1', options = {}) {
    if (!mapInstance || !stops || stops.length === 0) return;

    const markEndpoints = options.markEndpoints !== false;
    activeRouteStopsMinIconZoom = typeof options.minIconZoom === 'number' ? options.minIconZoom : 15;

    activeRouteStopEntries.forEach(entry => {
        if (mapInstance.hasLayer(entry.marker)) mapInstance.removeLayer(entry.marker);
    });
    activeRouteStopEntries = [];

    const lastIdx = stops.length - 1;

    stops.forEach((rs, index) => {
        const stop = rs.stop;
        if (!stop || stop.latitude == null || stop.longitude == null) return;

        const config = getStopIconConfig(stop.name, stop.type);
        const markerBg = safeMapColor(rs.color || color || config.bgColor, '#E63E21');
        const isEndpoint = markEndpoints && (index === 0 || index === lastIdx);
        const endBadge = isEndpoint ? (index === 0 ? 'INICIO' : 'FIN') : '';

        const compactIcon = L.divIcon({
            className: 'custom-stop-marker',
            html: `<div style="background-color: #ffffff; border: 2.5px solid ${markerBg}; width: 11px; height: 11px; border-radius: 50%; box-shadow: 0 1px 4px rgba(0,0,0,0.35);"></div>`,
            iconSize: [11, 11],
            iconAnchor: [5, 5]
        });

        const fullIcon = L.divIcon({
            className: 'custom-stop-marker',
            html: isEndpoint
                ? `<div style="position: relative; background-color: ${markerBg}; border: 2.5px solid white; width: 24px; height: 24px; border-radius: 50%; box-shadow: 0 3px 10px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;">
                     ${renderStopCategorySvg(config.iconKey, 13)}
                   </div>`
                : `<div style="background-color: ${markerBg}; border: 2px solid white; width: 22px; height: 22px; border-radius: 50%; box-shadow: 0 2px 7px rgba(0,0,0,0.32); display: flex; align-items: center; justify-content: center;">
                     ${renderStopCategorySvg(config.iconKey, 12)}
                   </div>`,
            iconSize: isEndpoint ? [24, 24] : [22, 22],
            iconAnchor: [isEndpoint ? 12 : 11, isEndpoint ? 12 : 11]
        });

        const endpointNote = endBadge
            ? `<span style="font-size: 0.65rem; background: ${markerBg}; color: white; padding: 2px 6px; border-radius: 9999px; font-weight: 700; margin-left: 6px;">${endBadge}</span>`
            : '';
        const orderPrefix = rs.stopOrder != null && Number.isFinite(Number(rs.stopOrder))
            ? `Parada #${Number(rs.stopOrder)} — `
            : '';

        const marker = L.marker([stop.latitude, stop.longitude], {
            icon: compactIcon,
            zIndexOffset: isEndpoint ? 400 : 100
        }).bindPopup(`
            <div style="font-family: 'Inter', sans-serif; padding: 2px; min-width: 170px;">
                <div style="display:flex; align-items:center; flex-wrap:wrap; margin-bottom:4px;">
                    <span style="font-size: 0.7rem; background: rgba(0,0,0,0.06); color: ${safeMapColor(config.bgColor)}; padding: 2px 6px; border-radius: 4px; font-weight: 700; text-transform: uppercase;">${escapeMapHtml(config.category)}</span>
                    ${endpointNote}
                </div>
                <h4 style="margin: 0 0 4px 0; color: #1f2937; font-weight: 700; font-size: 0.95rem;">${orderPrefix}${escapeMapHtml(stop.name)}</h4>
                <p style="margin: 0 0 4px 0; color: #475569; font-size: 0.78rem;">${escapeMapHtml(stop.address || 'Mazatlán, Sinaloa')}</p>
                <p style="margin: 0; color: #64748b; font-size: 0.75rem;">GPS: ${stop.latitude.toFixed(4)}, ${stop.longitude.toFixed(4)}</p>
                ${typeof openQrModalForStop === 'function' ? `<button type="button" onclick="openQrModalForStop(${Number(stop.id)})" class="popup-qr-btn">Ver QR de paradero</button>` : ''}
            </div>
        `);

        activeRouteStopEntries.push({
            stopId: stop.id,
            latlng: L.latLng(stop.latitude, stop.longitude),
            marker,
            compactIcon,
            fullIcon,
            isEndpoint
        });
    });

    mapInstance.off('zoomend', updateRouteStopsVisibility);
    mapInstance.on('zoomend', updateRouteStopsVisibility);
    updateRouteStopsVisibility();
}

// Prepara y limpia la capa agrupada (MarkerCluster) para paradas físicas
function getOrResetPhysicalStopsLayer() {
    if (!mapInstance) return null;

    if (allStopsClusterGroup) {
        allStopsClusterGroup.clearLayers();
    }
    allStopsMarkers.forEach(m => {
        if (mapInstance.hasLayer(m)) mapInstance.removeLayer(m);
    });
    allStopsMarkers = [];

    if (typeof L.markerClusterGroup === 'function') {
        if (!allStopsClusterGroup) {
            allStopsClusterGroup = L.markerClusterGroup({
                maxClusterRadius: 52,
                disableClusteringAtZoom: 17,
                maxClusterRadius: 46,
                disableClusteringAtZoom: 16,
                spiderfyOnMaxZoom: true,
                showCoverageOnHover: false,
                animate: false,
                animate: true,
                chunkedLoading: true,
                removeOutsideVisibleBounds: true,
                iconCreateFunction: (cluster) => {
                    const count = cluster.getChildCount();
                    const tier = count >= 30 ? 'lg' : (count >= 10 ? 'md' : 'sm');
                    const size = count >= 30 ? 42 : (count >= 10 ? 36 : 30);
                    return L.divIcon({
                        html: `<div class="rutero-cluster rutero-cluster-${tier}">${count}</div>`,
                        className: 'rutero-cluster-wrapper',
                        iconSize: L.point(size, size)
                    });
                }
            }).addTo(mapInstance);
        }
        return allStopsClusterGroup;
    }

    return mapInstance;
}

// Carga y dibuja todas las paradas físicas del sistema (con clustering + iconos SVG por categoría)
async function loadAllPhysicalStopsOnMap(prefetchedStops = null) {
    try {
        const targetLayer = getOrResetPhysicalStopsLayer();
        if (!targetLayer) return;

        allPhysicalStopsList = Array.isArray(prefetchedStops)
            ? prefetchedStops
            : await Api.getAllStops();
        const markersToAdd = [];

        allPhysicalStopsList.forEach(stop => {
            const config = getStopIconConfig(stop.name, stop.type);

            const defaultIcon = L.divIcon({
                className: 'physical-stop-marker',
                html: `<div style="background-color: ${config.bgColor}; border: 2px solid #ffffff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                         ${renderStopCategorySvg(config.iconKey, 12)}
                       </div>`,
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            });

            const marker = L.marker([stop.latitude, stop.longitude], { icon: defaultIcon })
                .bindPopup(`
                    <div style="font-family: 'Inter', sans-serif; padding: 2px; min-width: 180px;">
                        <span style="font-size: 0.68rem; background: ${safeMapColor(config.bgColor)}15; color: ${safeMapColor(config.bgColor)}; padding: 2px 7px; border-radius: 9999px; font-weight: 700; text-transform: uppercase; display: inline-block; margin-bottom: 5px;">${escapeMapHtml(config.category)}</span>
                        <h4 style="margin: 0 0 4px 0; color: #0f172a; font-size: 0.9rem; font-weight: 700; line-height: 1.3;">${escapeMapHtml(stop.name)}</h4>
                        <p style="margin: 0 0 4px 0; color: #475569; font-size: 0.78rem;">${escapeMapHtml(stop.address || 'Mazatlán, Sinaloa')}</p>
                        <p style="margin: 0; color: #64748b; font-size: 0.72rem;">${stop.latitude.toFixed(4)}, ${stop.longitude.toFixed(4)}</p>
                        <button type="button" onclick="openQrModalForStop(${Number(stop.id)})" class="popup-qr-btn">Ver QR de paradero</button>
                    </div>
                `);

            allStopsMarkers.push(marker);
            markersToAdd.push(marker);
        });

        if (allStopsClusterGroup && targetLayer === allStopsClusterGroup) {
            allStopsClusterGroup.addLayers(markersToAdd);
        } else {
            markersToAdd.forEach(m => m.addTo(targetLayer));
        }
    } catch (err) {
        console.error("Error al cargar paradas físicas:", err.message);
    }
}

let trafficCorridorGroup = null;
let tomtomTrafficTileLayer = null;

function getTrafficLevelColor(level) {
    if (level === 'lento') return '#EF4444';
    if (level === 'moderado') return '#F59E0B';
    return '#10B981';
}

function getTrafficLevelLabel(level) {
    if (level === 'lento') return 'Tráfico lento';
    if (level === 'moderado') return 'Tráfico moderado';
    return 'Tráfico fluido';
}

function renderTrafficOverlay(trafficData, enabled) {
    if (!mapInstance) return;

    if (tomtomTrafficTileLayer && mapInstance.hasLayer(tomtomTrafficTileLayer)) {
        mapInstance.removeLayer(tomtomTrafficTileLayer);
    }
    if (trafficCorridorGroup) {
        trafficCorridorGroup.clearLayers();
    }
    if (!enabled || !trafficData) return;

    if (trafficData.tomtomTilesEnabled && typeof API_BASE_URL === 'string') {
        if (!tomtomTrafficTileLayer) {
            tomtomTrafficTileLayer = L.tileLayer(`${API_BASE_URL}/traffic/tiles/{z}/{x}/{y}.png`, {
                opacity: 0.78,
                maxNativeZoom: 18,
                maxZoom: 20,
                zIndex: 420
            });
        }
        tomtomTrafficTileLayer.addTo(mapInstance);
    }

    if (!trafficCorridorGroup) {
        trafficCorridorGroup = L.layerGroup().addTo(mapInstance);
    } else if (!mapInstance.hasLayer(trafficCorridorGroup)) {
        trafficCorridorGroup.addTo(mapInstance);
    }

    const corridors = Array.isArray(trafficData.corridors) ? trafficData.corridors : [];
    const lineOpacity = trafficData.tomtomTilesEnabled ? 0.25 : 0.85;
    const lineWeight = trafficData.tomtomTilesEnabled ? 4 : 5;

    corridors.forEach((corr) => {
        if (!Array.isArray(corr.points) || corr.points.length < 2) return;
        const color = getTrafficLevelColor(corr.level);
        const levelLabel = getTrafficLevelLabel(corr.level);
        const speedText = corr.speedKmh ? `~${Number(corr.speedKmh).toFixed(0)} km/h` : '';
        const srcText = corr.source === 'tomtom_y_gps' ? 'TomTom + GPS en vivo'
            : corr.source === 'tomtom' ? 'TomTom en vivo'
            : corr.source === 'gps_comunitario' ? 'GPS en vivo Don Rutero'
            : 'Estimación por horario';

        const halo = L.polyline(corr.points, {
            color: '#ffffff',
            weight: lineWeight + 2.5,
            opacity: lineOpacity * 0.55,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false
        });
        const line = L.polyline(corr.points, {
            color,
            weight: lineWeight,
            opacity: lineOpacity,
            lineCap: 'round',
            lineJoin: 'round'
        }).bindTooltip(
            `<strong>${escapeMapHtml(corr.name)}</strong><br>${escapeMapHtml(levelLabel)}${speedText ? ` (${escapeMapHtml(speedText)})` : ''}<br><span style="opacity:0.8;font-size:0.75em;">${escapeMapHtml(srcText)}</span>`,
            { sticky: true }
        );
        trafficCorridorGroup.addLayer(halo);
        trafficCorridorGroup.addLayer(line);
    });

    const cells = Array.isArray(trafficData.communityCells) ? trafficData.communityCells : [];
    cells.forEach((cell) => {
        if (typeof cell.lat !== 'number' || typeof cell.lng !== 'number') return;
        const color = getTrafficLevelColor(cell.level);
        const dot = L.circleMarker([cell.lat, cell.lng], {
            radius: 7,
            color: '#ffffff',
            weight: 2,
            fillColor: color,
            fillOpacity: 0.92
        }).bindTooltip(
            `<strong>GPS en vivo Don Rutero</strong><br>Velocidad promedio: ${Number(cell.speedKmh).toFixed(1)} km/h (${Number(cell.samples || 1)} lectura${Number(cell.samples) === 1 ? '' : 's'})`,
            { sticky: true }
        );
        trafficCorridorGroup.addLayer(dot);
    });
}
