/* =========================================================
   DON RUTERO — Lógica Principal de la Vista de Usuario
   ========================================================= */

let allRoutes = [];
let currentFilter = 'all';
let currentSearch = '';
let mobileSheetState = 'half'; // 'peek' | 'half' | 'full'

function isMobileViewport() {
    return window.innerWidth <= 768;
}

function setMobileSheetState(state) {
    const sidebar = document.getElementById('sidebar');
    const labelEl = document.getElementById('mobile-sheet-label');
    if (!sidebar) return;

    sidebar.classList.remove('sheet-peek', 'sheet-full');
    if (!isMobileViewport()) {
        mobileSheetState = 'half';
        return;
    }

    mobileSheetState = state;
    if (state === 'peek') {
        sidebar.classList.add('sheet-peek');
        if (labelEl) labelEl.textContent = 'Ver rutas';
    } else if (state === 'full') {
        sidebar.classList.add('sheet-full');
        if (labelEl) labelEl.textContent = 'Ver mapa';
    } else {
        if (labelEl) labelEl.textContent = 'Expandir';
    }
}

function setupMobileBottomSheet() {
    const handle = document.getElementById('mobile-sheet-handle');
    const sidebar = document.getElementById('sidebar');
    if (!handle || !sidebar) return;

    let isDragging = false;
    let hasMoved = false;
    let suppressClick = false;
    let activePointerId = null;
    let startY = 0;
    let startHeight = 0;
    let lastY = 0;

    const getDetents = () => {
        const vh = window.innerHeight;
        return {
            peek: 132,
            half: Math.round(vh * 0.41),
            full: Math.round(vh * 0.78),
            min: 112,
            max: Math.round(vh * 0.85)
        };
    };

    const finishDrag = (endY) => {
        if (!isDragging) return;
        isDragging = false;

        const detents = getDetents();
        const dy = endY - startY;
        const currentHeight = sidebar.getBoundingClientRect().height;

        sidebar.classList.remove('dragging');

        if (!hasMoved) {
            sidebar.style.height = '';
            return;
        }

        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 120);

        // Elegir el punto más cercano considerando dirección del arrastre
        let targetState = 'half';
        const bias = dy < -24 ? 55 : (dy > 24 ? -55 : 0);
        const projected = currentHeight + bias;

        const distPeek = Math.abs(projected - detents.peek);
        const distHalf = Math.abs(projected - detents.half);
        const distFull = Math.abs(projected - detents.full);

        if (distPeek <= distHalf && distPeek <= distFull) {
            targetState = 'peek';
        } else if (distFull <= distHalf && distFull <= distPeek) {
            targetState = 'full';
        } else {
            targetState = 'half';
        }

        // Mantener altura actual un frame antes de quitar inline height para animar suave desde donde soltó el usuario
        sidebar.style.height = `${Math.round(currentHeight)}px`;
        void sidebar.offsetHeight;
        sidebar.style.height = '';
        setMobileSheetState(targetState);
    };

    handle.addEventListener('pointerdown', (e) => {
        if (!isMobileViewport()) return;
        if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;

        isDragging = true;
        hasMoved = false;
        activePointerId = e.pointerId;
        startY = e.clientY;
        lastY = e.clientY;
        startHeight = sidebar.getBoundingClientRect().height;

        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    });

    handle.addEventListener('pointermove', (e) => {
        if (!isDragging || e.pointerId !== activePointerId) return;
        lastY = e.clientY;
        const dy = e.clientY - startY;

        if (!hasMoved && Math.abs(dy) > 5) {
            hasMoved = true;
            sidebar.classList.add('dragging');
        }
        if (!hasMoved) return;

        const detents = getDetents();
        const nextHeight = Math.max(detents.min, Math.min(detents.max, startHeight - dy));
        sidebar.style.height = `${Math.round(nextHeight)}px`;
    });

    const onPointerEnd = (e) => {
        if (!isDragging || e.pointerId !== activePointerId) return;
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
        activePointerId = null;
        finishDrag(e.clientY || lastY);
    };

    handle.addEventListener('pointerup', onPointerEnd);
    handle.addEventListener('pointercancel', onPointerEnd);

    handle.addEventListener('click', () => {
        if (!isMobileViewport() || suppressClick) return;
        const next = mobileSheetState === 'half' ? 'full' : (mobileSheetState === 'full' ? 'peek' : 'half');
        setMobileSheetState(next);
    });

    window.addEventListener('resize', () => {
        if (!isMobileViewport()) {
            sidebar.classList.remove('dragging');
            sidebar.style.height = '';
            setMobileSheetState('half');
        }
    });
}

let fareMode = 'normal'; // 'normal' | 'student'
let favoriteRouteIds = new Set();

function loadFavoriteRoutes() {
    try {
        const raw = localStorage.getItem('donRuteroFavorites');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                favoriteRouteIds = new Set(parsed.map(id => Number(id)));
            }
        }
    } catch (_) {}
}

function isFavoriteRoute(routeId) {
    return favoriteRouteIds.has(Number(routeId));
}

function toggleFavoriteRoute(routeId) {
    const numId = Number(routeId);
    const added = !favoriteRouteIds.has(numId);
    if (added) favoriteRouteIds.add(numId);
    else favoriteRouteIds.delete(numId);

    try {
        localStorage.setItem('donRuteroFavorites', JSON.stringify(Array.from(favoriteRouteIds)));
    } catch (_) {}

    const detailFavBtn = document.getElementById('detail-fav-btn');
    if (detailFavBtn && Number(detailFavBtn.dataset.routeId) === numId) {
        detailFavBtn.classList.toggle('is-fav', added);
        detailFavBtn.title = added ? 'Quitar de favoritas' : 'Guardar en favoritas';
    }

    if (typeof updateRouteDisplay === 'function' && allRoutes.length > 0) {
        updateRouteDisplay();
    }
    showToast(added ? 'Ruta guardada en favoritas' : 'Ruta quitada de favoritas');
}

function getStarSvg(size = 15) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
}

function getRouteNormalPrice(route) {
    return route && typeof route.price === 'number' && !isNaN(route.price) ? route.price : 13;
}

function getRouteStudentPrice(route) {
    return route && typeof route.studentPrice === 'number' && !isNaN(route.studentPrice) ? route.studentPrice : 3.5;
}

function getActiveRoutePrice(route) {
    return fareMode === 'student' ? getRouteStudentPrice(route) : getRouteNormalPrice(route);
}

function formatCompactFare(amount) {
    return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

function setFareMode(mode, { refreshTrips = true } = {}) {
    fareMode = mode === 'student' ? 'student' : 'normal';
    try {
        localStorage.setItem('donRuteroFareMode', fareMode);
    } catch (_) {}

    document.querySelectorAll('.fare-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fareMode === fareMode);
    });

    if (typeof updateRouteDisplay === 'function' && allRoutes.length > 0) {
        updateRouteDisplay();
    }
    if (refreshTrips && selectedOrigin && selectedDestination && window._tripComputedOptions && window._tripComputedOptions.length > 0) {
        calculateTripRoute();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    loadFavoriteRoutes();
    try {
        const savedFare = localStorage.getItem('donRuteroFareMode');
        if (savedFare === 'student') fareMode = 'student';
    } catch (_) {}

    document.querySelectorAll('.fare-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fareMode === fareMode);
        btn.addEventListener('click', () => setFareMode(btn.dataset.fareMode));
    });

    initLeafletMap('map');
    setupMobileBottomSheet();
    await Promise.all([
        Auth.init(),
        loadBootstrapData()
    ]);
    setupEventListeners();
    handleDeepLinkParams();
});

// ----------------------------------------------------------
// CARGA Y RENDERIZADO DE RUTAS
// ----------------------------------------------------------

function hydrateRoutesFromBootstrap(data) {
    const routes = Array.isArray(data?.routes) ? data.routes : [];
    const stops = Array.isArray(data?.stops) ? data.stops : [];
    const coordsByRoute = data?.coordsByRoute || {};
    const stopIdsByRoute = data?.stopIdsByRoute || {};
    const stopById = new Map(stops.map(s => [s.id, s]));

    routes.forEach((route) => {
        const rawCoords = coordsByRoute[String(route.id)] || [];
        route.coordinatesList = rawCoords.map(pair => ({
            latitude: pair[0],
            longitude: pair[1]
        }));

        const stopIds = stopIdsByRoute[String(route.id)] || [];
        route.stopsList = stopIds
            .map((stopId, idx) => {
                const stop = stopById.get(stopId);
                return stop ? { stopOrder: idx + 1, stop } : null;
            })
            .filter(Boolean);
    });

    allRoutes = routes;
    renderRoutes(allRoutes);
    return stops;
}

async function loadBootstrapData() {
    try {
        const data = await Api.getBootstrap();
        const stops = hydrateRoutesFromBootstrap(data);
        await loadAllPhysicalStopsOnMap(stops);
    } catch (bootstrapErr) {
        console.warn('Bootstrap fallback a carga tradicional:', bootstrapErr);
        await Promise.all([
            loadRoutesList(),
            loadAllPhysicalStopsOnMap()
        ]);
    }
}

async function loadRoutesList() {
    try {
        allRoutes = await Api.getRoutes();
        // Cargar paradas y recorridos en paralelo para arranque rápido
        await Promise.all(allRoutes.map(async (route) => {
            try {
                const [stops, coords] = await Promise.all([
                    Api.getRouteStops(route.id),
                    Api.getRouteCoordinates(route.id)
                ]);
                route.stopsList = stops;
                route.coordinatesList = coords;
            } catch (e) {
                route.stopsList = [];
                route.coordinatesList = [];
            }
        }));
        renderRoutes(allRoutes);
    } catch (err) {
        showToast('Error al conectar con el servidor', 'error');
        console.error(err);
    }
}

function escapeUserHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function renderRoutes(routes, options = {}) {
    const list = document.getElementById('route-list');
    list.innerHTML = '';

    if (options.banner) {
        const banner = document.createElement('div');
        banner.className = `location-status-banner${options.banner.isWarning ? ' warning' : ''}`;
        banner.innerHTML = `
            <div>${options.banner.html}</div>
            <button type="button" class="location-status-clear" onclick="clearSearchedLocation()">Ver todas</button>
        `;
        list.appendChild(banner);
    }

    if (routes.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.cssText = 'text-align:center; color:var(--text-muted); font-size:0.86rem; padding:24px 14px; line-height:1.5;';
        emptyMsg.textContent = currentFilter === 'favoritas'
            ? 'Aún no tienes rutas favoritas. Toca la estrella en cualquier camión para guardarlo aquí.'
            : 'No se encontraron rutas.';
        list.appendChild(emptyMsg);
        return;
    }

    routes.forEach(route => {
        const card = document.createElement('div');
        card.className = 'route-card';
        card.style.setProperty('--card-accent', route.color);
        card.dataset.id = route.id;

        const isAguilas = (route.name && route.name.toLowerCase().includes('aguila')) ||
                          (route.description && route.description.toLowerCase().includes('aguila')) ||
                          route.concesionario === 'aguilas';
        const concesionarioLabel = isAguilas ? 'Águilas del Pacífico' : 'Alianza';
        const normalPrice = getRouteNormalPrice(route);
        const studentPrice = getRouteStudentPrice(route);
        const fareHtml = fareMode === 'student'
            ? `<div class="route-fare-group"><span class="route-fare student-active">${formatCompactFare(studentPrice)}</span><span style="font-size:0.65rem;color:var(--text-muted);">Normal ${formatCompactFare(normalPrice)}</span></div>`
            : `<div class="route-fare-group"><span class="route-fare">${formatCompactFare(normalPrice)}</span><span class="route-fare-student">Est. ${formatCompactFare(studentPrice)}</span></div>`;
        const freqText = route.frequencyMinutes ? ` · cada ${route.frequencyMinutes} min` : '';
        const isFav = isFavoriteRoute(route.id);
        const sighting = (typeof PulseState !== 'undefined' && PulseState.sightings)
            ? PulseState.sightings[String(route.id)]
            : null;
        const sightingBadgeHtml = sighting
            ? `<span class="route-pulse-badge" title="Reportado por pasajero de Don Rutero">● Pasó hace ${Number(sighting.minutesAgo) <= 0 ? '<1' : Number(sighting.minutesAgo)} min</span>`
            : '';

        let distanceBadgeHtml = '';
        if (typeof route._distanceMeters === 'number' && isFinite(route._distanceMeters)) {
            const distTier = route._distanceMeters <= 350 ? 'close' : (route._distanceMeters <= 800 ? 'medium' : 'far');
            distanceBadgeHtml = `<span class="distance-badge ${distTier}" style="margin-left:auto;">A ${formatDistanceInfo(route._distanceMeters)}</span>`;
        }

        card.innerHTML = `
            <div class="route-indicator" style="background-color:${route.color}; color:${route.color};"></div>
            <div class="route-info">
                <div class="route-card-top">
                    <div class="route-name">${escapeUserHtml(route.name)}</div>
                    <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
                        ${fareHtml}
                        <button type="button" class="fav-route-btn ${isFav ? 'is-fav' : ''}" title="${isFav ? 'Quitar de favoritas' : 'Guardar en favoritas'}" aria-label="Favorita">
                            ${getStarSvg(15)}
                        </button>
                    </div>
                </div>
                <div class="route-submeta">
                    <span class="concesionario-dot ${isAguilas ? 'aguilas' : 'alianza'}"></span>
                    <span>${concesionarioLabel}${freqText}</span>
                    ${sightingBadgeHtml}
                    ${distanceBadgeHtml}
                </div>
                <div class="route-desc">${escapeUserHtml(route.description || '')}</div>
            </div>
        `;

        const favBtn = card.querySelector('.fav-route-btn');
        if (favBtn) {
            favBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleFavoriteRoute(route.id);
            });
        }
        card.addEventListener('click', () => selectRoute(route.id, card));
        list.appendChild(card);
    });
}

// ----------------------------------------------------------
// SELECCIÓN DE RUTA Y PANEL DE DETALLES
// ----------------------------------------------------------

async function selectRoute(routeId, cardElement) {
    if (typeof confirmStoppingActiveOnboardTrip === 'function' && !confirmStoppingActiveOnboardTrip('cambiar de ruta')) {
        return;
    }
    document.querySelectorAll('.route-card').forEach(c => c.classList.remove('active'));
    if (cardElement) cardElement.classList.add('active');

    try {
        if (typeof stopOnboardTrip === 'function') stopOnboardTrip({ silent: true });
        clearMapDrawings();
        if (typeof setPhysicalStopsVisible === 'function') setPhysicalStopsVisible(false);
        const route = allRoutes.find(r => r.id === routeId) || await Api.getRouteDetails(routeId);
        const coords = (route.coordinatesList && route.coordinatesList.length > 0)
            ? route.coordinatesList
            : await Api.getRouteCoordinates(routeId);
        const routeStops = Array.isArray(route.stopsList) && route.stopsList.length > 0
            ? route.stopsList
            : await Api.getRouteStops(routeId);
        const polyline = drawRouteLine(coords, route.color);
        drawRouteStops(routeStops, route.color);

        let proximityInfo = null;
        if (window.currentSearchLocation && mapInstance && typeof L !== 'undefined') {
            const loc = window.currentSearchLocation;
            renderSearchedLocationPin(loc.displayName || loc.name, loc.lat, loc.lng);

            const closest = findClosestPointOnRoute({ coordinatesList: coords, stopsList: routeStops }, loc.lat, loc.lng);
            if (closest && closest.lat != null && closest.lng != null && isFinite(closest.dist)) {
                proximityInfo = { placeName: loc.name, dist: closest.dist };

                if (closest.dist >= 15) {
                    const walkLine = L.polyline([[closest.lat, closest.lng], [loc.lat, loc.lng]], {
                        color: '#1D3557',
                        weight: 3.5,
                        opacity: 0.9,
                        dashArray: '7, 8'
                    }).addTo(mapInstance);
                    activePolylines.push(walkLine);
                }

                const distLabel = closest.dist < 25 ? 'Pasa justo aquí' : `Más cercano · ${formatDistanceInfo(closest.dist)}`;
                const nearestDot = L.marker([closest.lat, closest.lng], {
                    zIndexOffset: 1100,
                    icon: L.divIcon({
                        className: 'custom-nearest-point',
                        html: `<div style="display:flex;align-items:center;gap:6px;transform:translate(-8px,-50%);pointer-events:auto;">
                                 <span style="width:13px;height:13px;border-radius:50%;background:#10B981;border:2.5px solid white;box-shadow:0 2px 6px rgba(15,23,42,0.35);flex-shrink:0;"></span>
                                 <span style="background:rgba(255,255,255,0.96);color:#0F172A;border:1px solid #10B981;padding:2px 7px;border-radius:6px;font-size:0.71rem;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(15,23,42,0.16);">${escapeUserHtml(distLabel)}</span>
                               </div>`,
                        iconSize: null
                    })
                }).addTo(mapInstance).bindPopup(
                    `<div style="font-family:inherit;font-size:0.82rem;"><b>Punto más cercano de ${escapeUserHtml(route.name)}</b><br>A ${escapeUserHtml(formatDistanceInfo(closest.dist))} caminando de ${escapeUserHtml(loc.name)}.</div>`
                );
                activeMarkers.push(nearestDot);

                if (closest.dist <= 2500) {
                    const focusBounds = L.latLngBounds([[loc.lat, loc.lng], [closest.lat, closest.lng]]);
                    const opts = typeof getResponsiveFitBoundsOptions === 'function'
                        ? getResponsiveFitBoundsOptions(110, { maxZoom: 15 })
                        : { padding: [110, 110], maxZoom: 15 };
                    mapInstance.fitBounds(focusBounds, opts);
                } else if (polyline) {
                    const extended = polyline.getBounds().extend([loc.lat, loc.lng]);
                    const opts = typeof getResponsiveFitBoundsOptions === 'function'
                        ? getResponsiveFitBoundsOptions(55)
                        : { padding: [55, 55] };
                    mapInstance.fitBounds(extended, opts);
                }
            }
        }

        if (isMobileViewport()) setMobileSheetState('half');
        window._activeDetailRouteId = Number(route.id);
        showDetailPanel(route, routeStops, proximityInfo, coords);
        if (typeof renderPulseMarkers === 'function' && typeof PulseState !== 'undefined') {
            renderPulseMarkers(PulseState);
        }
    } catch (err) {
        showToast('Error al cargar la ruta', 'error');
        console.error(err);
    }
}

function showDetailPanel(route, routeStops, proximityInfo = null, coords = null) {
    const detailPanel = document.getElementById('detail-panel');
    const mainList = document.getElementById('main-list-section');
    mainList.style.display = 'none';

    const title = document.getElementById('detail-title');
    title.textContent = route.name;
    title.style.borderLeft = `4px solid ${route.color}`;
    title.style.paddingLeft = '10px';

    const detailFavBtn = document.getElementById('detail-fav-btn');
    if (detailFavBtn) {
        const isFav = isFavoriteRoute(route.id);
        detailFavBtn.dataset.routeId = String(route.id);
        detailFavBtn.classList.toggle('is-fav', isFav);
        detailFavBtn.title = isFav ? 'Quitar de favoritas' : 'Guardar en favoritas';
        detailFavBtn.onclick = () => toggleFavoriteRoute(route.id);
    }

    const detailQrBtn = document.getElementById('detail-qr-btn');
    if (detailQrBtn) {
        detailQrBtn.onclick = () => openQrModalForRoute(route.id);
    }

    document.getElementById('detail-desc').textContent = route.description || '';
    const routeCoords = Array.isArray(coords) ? coords : (route.coordinatesList || []);
    updateDetailPulseActions(route, routeStops, routeCoords);

    // Meta tags with SVG icons
    const metaContainer = document.getElementById('detail-meta');
    metaContainer.innerHTML = '';
    if (proximityInfo) {
        const tagText = proximityInfo.dist < 25
            ? `Pasa justo por ${proximityInfo.placeName}`
            : `A ${formatDistanceInfo(proximityInfo.dist)} de ${proximityInfo.placeName}`;
        metaContainer.innerHTML += `<span class="route-meta-tag" style="background:#ECFDF5; color:#047857; border-color:#A7F3D0;">${escapeUserHtml(tagText)}</span>`;
    }
    const normalPrice = getRouteNormalPrice(route);
    const studentPrice = getRouteStudentPrice(route);
    metaContainer.innerHTML += `<span class="route-meta-tag price"><img src="assets/icons/ui_moneda.svg" alt="" class="tag-icon">Normal $${normalPrice.toFixed(2)}</span>`;
    metaContainer.innerHTML += `<span class="route-meta-tag" style="background:#ECFDF5; color:#047857; border-color:#A7F3D0;">Estudiante $${studentPrice.toFixed(2)}</span>`;
    if (route.frequencyMinutes) {
        metaContainer.innerHTML += `<span class="route-meta-tag"><img src="assets/icons/ui_reloj.svg" alt="" class="tag-icon">Cada ${route.frequencyMinutes} min</span>`;
    }
    metaContainer.innerHTML += `<span class="route-meta-tag"><img src="assets/icons/ui_reloj.svg" alt="" class="tag-icon">5:30 AM – 10:30 PM</span>`;
    if (routeStops.length > 0) {
        metaContainer.innerHTML += `<span class="route-meta-tag"><img src="assets/icons/pin_parada.svg" alt="" class="tag-icon">${routeStops.length} paradas</span>`;
    }

    // Timeline
    const timeline = document.getElementById('detail-stops-timeline');
    timeline.innerHTML = '';

    if (routeStops.length === 0) {
        timeline.innerHTML = `<div style="color:var(--text-muted); font-size:0.88rem;">Sin paradas registradas.</div>`;
    } else {
        routeStops.forEach(rs => {
            const item = document.createElement('div');
            item.className = 'timeline-item';
            item.style.cursor = 'pointer';
            item.title = 'Ver parada en el mapa';
            item.innerHTML = `
                <div class="timeline-dot" style="border-color:${route.color}"></div>
                <div>
                    <div class="timeline-title">${escapeUserHtml(rs.stop.name)}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted);">Parada #${rs.stopOrder}</div>
                </div>
            `;
            item.addEventListener('click', () => {
                if (rs.stop && rs.stop.latitude != null && rs.stop.longitude != null) {
                    window._lastFocusedRouteStop = {
                        routeId: Number(route.id),
                        name: rs.stop.name,
                        lat: rs.stop.latitude,
                        lng: rs.stop.longitude
                    };
                    if (typeof window._refreshActiveSightingStatus === 'function') {
                        window._refreshActiveSightingStatus();
                    }
                }
                if (typeof focusRouteStopOnMap === 'function') {
                    focusRouteStopOnMap(rs.stop.id);
                }
            });
            timeline.appendChild(item);
        });
    }

    detailPanel.classList.add('visible');
}

function closeDetailPanel() {
    window._activeDetailRouteId = null;
    window._refreshActiveSightingStatus = null;
    document.getElementById('detail-panel').classList.remove('visible');
    document.getElementById('main-list-section').style.display = 'flex';
    document.querySelectorAll('.route-card').forEach(c => c.classList.remove('active'));
    clearMapDrawings();
    if (typeof renderPulseMarkers === 'function' && typeof PulseState !== 'undefined') {
        renderPulseMarkers(PulseState);
    }
}

// ----------------------------------------------------------
// BÚSQUEDA Y FILTROS
// ----------------------------------------------------------
window.currentSearchLocation = null;

// Helper de distancia GPS (Haversine) en metros
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 999999;
    const R = 6371e3; // Radio de la tierra en metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function closestPointOnSegment(pLat, pLng, aLat, aLng, bLat, bLng) {
    const rad = Math.PI / 180;
    const cosLat = Math.cos(pLat * rad);
    const kx = 111320 * cosLat;
    const ky = 110540;

    const ax = (aLng - pLng) * kx;
    const ay = (aLat - pLat) * ky;
    const bx = (bLng - pLng) * kx;
    const by = (bLat - pLat) * ky;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
        t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
    }
    const closestX = ax + t * dx;
    const closestY = ay + t * dy;
    return {
        lat: aLat + t * (bLat - aLat),
        lng: aLng + t * (bLng - aLng),
        dist: Math.sqrt(closestX * closestX + closestY * closestY),
        t
    };
}

function pointToSegmentDistanceMeters(pLat, pLng, aLat, aLng, bLat, bLng) {
    return closestPointOnSegment(pLat, pLng, aLat, aLng, bLat, bLng).dist;
}

function findClosestPointOnRoute(route, lat, lng) {
    let best = { lat: null, lng: null, dist: Infinity, segIdx: -1, t: 0 };

    // Cuando la ruta tiene trazado de calles, calcular cercanía estrictamente sobre la línea real del camión
    const coords = route.coordinatesList;
    if (Array.isArray(coords) && coords.length > 0) {
        if (coords.length === 1 && coords[0].latitude != null && coords[0].longitude != null) {
            const d = calculateDistanceMeters(lat, lng, coords[0].latitude, coords[0].longitude);
            if (d < best.dist) best = { lat: coords[0].latitude, lng: coords[0].longitude, dist: d, segIdx: 0, t: 0 };
        }
        for (let i = 0; i < coords.length - 1; i++) {
            const c1 = coords[i];
            const c2 = coords[i + 1];
            if (c1.latitude == null || c1.longitude == null || c2.latitude == null || c2.longitude == null) continue;
            const proj = closestPointOnSegment(lat, lng, c1.latitude, c1.longitude, c2.latitude, c2.longitude);
            if (proj.dist < best.dist) {
                best = { lat: proj.lat, lng: proj.lng, dist: proj.dist, segIdx: i, t: proj.t };
            }
        }
        return best;
    }

    // Solo usar paradas si la ruta aún no tiene coordenadas trazadas
    if (Array.isArray(route.stopsList)) {
        for (const rs of route.stopsList) {
            const s = rs.stop || rs;
            if (s && s.latitude != null && s.longitude != null) {
                const d = calculateDistanceMeters(lat, lng, s.latitude, s.longitude);
                if (d < best.dist) best = { lat: s.latitude, lng: s.longitude, dist: d, segIdx: -1, t: 0 };
            }
        }
    }

    return best;
}

function getMinDistanceToRouteMeters(route, lat, lng) {
    return findClosestPointOnRoute(route, lat, lng).dist;
}

function isRouteClosedLoop(coords) {
    if (!Array.isArray(coords) || coords.length < 3) return false;
    const first = coords[0];
    const last = coords[coords.length - 1];
    return calculateDistanceMeters(first.latitude, first.longitude, last.latitude, last.longitude) <= 450;
}

// Encuentra todos los puntos candidatos donde una ruta pasa cerca (ej. carril de ida y carril de regreso)
function findRouteCandidates(route, lat, lng, maxDist = 1100) {
    const coords = route.coordinatesList;
    if (!Array.isArray(coords) || coords.length < 2) return [];

    const cosLat = Math.cos(lat * Math.PI / 180);
    const buckets = [];
    let current = null;

    for (let i = 0; i < coords.length - 1; i++) {
        const c1 = coords[i];
        const c2 = coords[i + 1];
        if (c1.latitude == null || c1.longitude == null || c2.latitude == null || c2.longitude == null) continue;
        const proj = closestPointOnSegment(lat, lng, c1.latitude, c1.longitude, c2.latitude, c2.longitude);
        if (proj.dist <= maxDist) {
            const vx = (c2.longitude - c1.longitude) * 111320 * cosLat;
            const vy = (c2.latitude - c1.latitude) * 110540;
            const vLen = Math.hypot(vx, vy);
            const dir = vLen > 0.5 ? { vx: vx / vLen, vy: vy / vLen } : null;
            const cand = { lat: proj.lat, lng: proj.lng, dist: proj.dist, segIdx: i, t: proj.t };

            const dirChanged = current && current.dir && dir && (current.dir.vx * dir.vx + current.dir.vy * dir.vy) < 0.15;
            if (!current || i - current.lastIdx > 10 || dirChanged) {
                if (current) buckets.push(current.best);
                current = { best: cand, lastIdx: i, dir };
            } else {
                current.lastIdx = i;
                if (cand.dist < current.best.dist) {
                    current.best = cand;
                    if (dir) current.dir = dir;
                }
            }
        }
    }
    if (current) buckets.push(current.best);

    return buckets.sort((a, b) => a.dist - b.dist).slice(0, 10);
}

// Calcula la distancia real siguiendo el sentido de las flechas de la ruta y extrae el tramo recorrido
function getForwardLoopMetrics(coords, fromInfo, toInfo) {
    if (!Array.isArray(coords) || coords.length < 2 || fromInfo.segIdx < 0 || toInfo.segIdx < 0) {
        return { forwardDist: Infinity, segmentCoords: null };
    }

    const totalSegs = coords.length - 1;
    const closedLoop = isRouteClosedLoop(coords);

    if (fromInfo.segIdx === toInfo.segIdx && toInfo.t >= fromInfo.t) {
        const d = calculateDistanceMeters(fromInfo.lat, fromInfo.lng, toInfo.lat, toInfo.lng);
        return {
            forwardDist: d,
            segmentCoords: [
                { latitude: fromInfo.lat, longitude: fromInfo.lng },
                { latitude: toInfo.lat, longitude: toInfo.lng }
            ]
        };
    }

    if (!closedLoop && (fromInfo.segIdx > toInfo.segIdx || (fromInfo.segIdx === toInfo.segIdx && toInfo.t < fromInfo.t))) {
        return { forwardDist: Infinity, segmentCoords: null };
    }

    const pts = [{ latitude: fromInfo.lat, longitude: fromInfo.lng }];
    let segCount = 0;
    let idx = fromInfo.segIdx;

    while (segCount <= totalSegs) {
        const nextVertexIdx = idx + 1;
        if (nextVertexIdx < coords.length) {
            pts.push({ latitude: coords[nextVertexIdx].latitude, longitude: coords[nextVertexIdx].longitude });
        }
        idx = (idx + 1) % totalSegs;
        segCount++;
        if (idx === toInfo.segIdx) break;
    }

    pts.push({ latitude: toInfo.lat, longitude: toInfo.lng });

    let forwardDist = 0;
    for (let k = 0; k < pts.length - 1; k++) {
        forwardDist += calculateDistanceMeters(pts[k].latitude, pts[k].longitude, pts[k + 1].latitude, pts[k + 1].longitude);
    }

    return { forwardDist, segmentCoords: pts };
}

function getRouteDirectionVector(coords, segIdx, refLat) {
    if (!Array.isArray(coords) || coords.length < 2 || segIdx < 0) return null;
    const totalPts = coords.length;
    const closedLoop = isRouteClosedLoop(coords);
    const wrap = (idx) => closedLoop ? ((idx % (totalPts - 1)) + (totalPts - 1)) % (totalPts - 1) : Math.max(0, Math.min(totalPts - 1, idx));

    const p0 = coords[wrap(segIdx - 1)];
    const p1 = coords[wrap(segIdx + 3)];
    if (!p0 || !p1 || p0.latitude == null || p1.latitude == null) return null;

    const cosLat = Math.cos((refLat || p0.latitude) * Math.PI / 180);
    let vx = (p1.longitude - p0.longitude) * 111320 * cosLat;
    let vy = (p1.latitude - p0.latitude) * 110540;
    let len = Math.hypot(vx, vy);

    if (len < 1) {
        const a = coords[segIdx];
        const b = coords[Math.min(totalPts - 1, segIdx + 1)];
        vx = (b.longitude - a.longitude) * 111320 * cosLat;
        vy = (b.latitude - a.latitude) * 110540;
        len = Math.hypot(vx, vy);
    }
    if (len < 0.5) return null;
    return { vx: vx / len, vy: vy / len };
}

function getCompassDirection(vx, vy) {
    const deg = (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360;
    const dirs = ['Norte', 'Noreste', 'Este', 'Sureste', 'Sur', 'Suroeste', 'Oeste', 'Noroeste'];
    return dirs[Math.round(deg / 45) % 8];
}

function findNextDownstreamStop(route, boardInfo) {
    if (!route || !Array.isArray(route.stopsList) || !Array.isArray(route.coordinatesList) || boardInfo.segIdx < 0) {
        return null;
    }
    let bestName = null;
    let bestDist = Infinity;
    for (const rs of route.stopsList) {
        const s = rs.stop || rs;
        if (!s || s.latitude == null || s.longitude == null) continue;
        const stopProj = findClosestPointOnRoute({ coordinatesList: route.coordinatesList }, s.latitude, s.longitude);
        if (stopProj.segIdx < 0) continue;
        const { forwardDist } = getForwardLoopMetrics(route.coordinatesList, boardInfo, stopProj);
        if (forwardDist >= 120 && forwardDist <= 2800 && forwardDist < bestDist) {
            bestDist = forwardDist;
            bestName = s.name;
        }
    }
    return bestName;
}

function getBoardingDirectionInfo(route, boardInfo, userLat, userLng, allCandidates = []) {
    const coords = route && route.coordinatesList;
    const vec = getRouteDirectionVector(coords, boardInfo.segIdx, boardInfo.lat);
    if (!vec) return null;

    const compass = getCompassDirection(vec.vx, vec.vy);
    const angleDeg = Math.atan2(vec.vx, vec.vy) * (180 / Math.PI);
    const nextStop = findNextDownstreamStop(route, boardInfo);

    // Verificar si la ruta pasa en sentido contrario cerca del origen (ej. camellón / doble sentido)
    let oppositeCloser = false;
    for (const cand of allCandidates) {
        if (cand.segIdx === boardInfo.segIdx) continue;
        if (cand.dist > 150) continue;
        const candVec = getRouteDirectionVector(coords, cand.segIdx, cand.lat);
        if (candVec && (candVec.vx * vec.vx + candVec.vy * vec.vy) < -0.35 && cand.dist + 3 < boardInfo.dist) {
            oppositeCloser = true;
            break;
        }
    }

    // Producto punto con la acera derecha del camión (en México las puertas abren hacia la derecha)
    const cosLat = Math.cos(boardInfo.lat * Math.PI / 180);
    const ux = (userLng - boardInfo.lng) * 111320 * cosLat;
    const uy = (userLat - boardInfo.lat) * 110540;
    const uLen = Math.hypot(ux, uy);
    const rightX = vec.vy;
    const rightY = -vec.vx;
    const sideDot = uLen > 0 ? (ux * rightX + uy * rightY) / uLen : 0;

    let crossAction = 'check'; // 'cross' | 'same' | 'check'
    let crossLabel = 'Sigue las flechas del mapa';
    if (oppositeCloser || (uLen >= 10 && uLen <= 160 && sideDot <= -0.35)) {
        crossAction = 'cross';
        crossLabel = 'Cruza al otro lado de la calle';
    } else if (uLen >= 10 && uLen <= 160 && sideDot >= 0.35) {
        crossAction = 'same';
        crossLabel = 'De tu lado de la acera';
    }

    return { compass, angleDeg, nextStop, crossAction, crossLabel };
}

function formatBoardingGuidanceHtml(dirInfo) {
    if (!dirInfo) return '';
    const pillStyle = dirInfo.crossAction === 'cross'
        ? 'background:rgba(217,119,6,0.14); color:#B45309; border:1px solid rgba(217,119,6,0.35);'
        : (dirInfo.crossAction === 'same'
            ? 'background:#ECFDF5; color:#047857; border:1px solid #A7F3D0;'
            : 'background:var(--navy-light); color:var(--navy); border:1px solid rgba(29,53,87,0.2);');
    const headingText = dirInfo.nextStop
        ? `Sentido hacia el ${dirInfo.compass} (rumbo a ${dirInfo.nextStop})`
        : `Sentido hacia el ${dirInfo.compass}`;

    return `
        <div style="margin-top:4px; display:flex; flex-direction:column; gap:3px;">
            <span style="display:inline-block; align-self:flex-start; font-size:0.69rem; font-weight:700; padding:2px 7px; border-radius:9999px; ${pillStyle}">${escapeUserHtml(dirInfo.crossLabel)}</span>
            <span style="font-size:0.72rem; color:var(--text-secondary);">${escapeUserHtml(headingText)}</span>
        </div>
    `;
}

function formatDistanceInfo(meters) {
    if (!isFinite(meters)) return 'sin datos';
    const walkMin = Math.max(1, Math.round(meters / 80));
    if (meters < 1000) {
        return `${Math.round(meters)} m (~${walkMin} min)`;
    }
    return `${(meters / 1000).toFixed(1)} km (~${walkMin} min)`;
}

function updateClearSearchBtn() {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('btn-clear-search');
    if (!clearBtn) return;
    const hasContent = Boolean((searchInput && searchInput.value.trim().length > 0) || window.currentSearchLocation);
    clearBtn.style.display = hasContent ? 'inline-flex' : 'none';
}

function clearSearchedLocation() {
    window.currentSearchLocation = null;
    currentSearch = '';
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    const dropdown = document.getElementById('search-suggestions');
    if (dropdown) dropdown.style.display = 'none';
    if (window._tempColoniaMarker && mapInstance) {
        mapInstance.removeLayer(window._tempColoniaMarker);
        window._tempColoniaMarker = null;
    }
    const detailPanel = document.getElementById('detail-panel');
    if (!detailPanel || !detailPanel.classList.contains('visible')) {
        clearMapDrawings();
    }
    updateClearSearchBtn();
    updateRouteDisplay();
}

function resetCategoryFilterToAll() {
    currentFilter = 'all';
    document.querySelectorAll('.pill').forEach(p => {
        p.classList.toggle('active', (p.dataset.filter || 'all') === 'all');
    });
}

function matchesCategoryFilter(r) {
    if (currentFilter === 'all') return true;
    if (currentFilter === 'favoritas') return isFavoriteRoute(r.id);
    const nameDesc = (r.name + ' ' + (r.description || '')).toLowerCase();

    if (currentFilter === 'turistico') {
        const turisticoKeywords = ['turístic', 'turistic', 'playa', 'costera', 'malecón', 'malecon', 'dorada', 'faro', 'cerritos', 'acuario', 'hotel', 'olas altas'];
        return turisticoKeywords.some(kw => nameDesc.includes(kw));
    }
    if (currentFilter === 'centro') {
        const centroKeywords = ['centro', 'mercado', 'suárez', 'suarez', 'catedral', 'pino suárez', 'ololas', 'olas altas', 'juarez', 'juárez'];
        return centroKeywords.some(kw => nameDesc.includes(kw));
    }
    if (currentFilter === 'frecuente') {
        return r.frequencyMinutes && r.frequencyMinutes <= 12;
    }
    return true;
}

function updateRouteDisplay() {
    if (currentFilter === 'guias') {
        renderTouristGuidesList();
        return;
    }
    const q = currentSearch.toLowerCase().trim();
    const categoryRoutes = allRoutes.filter(matchesCategoryFilter);

    // Modo ubicación buscada: ordenar por cercanía real y avisar si está lejos
    if (window.currentSearchLocation) {
        const loc = window.currentSearchLocation;
        const NEARBY_LIMIT = 800;
        const FAR_WARNING_LIMIT = 1500;

        const scored = categoryRoutes
            .map(r => {
                const dist = getMinDistanceToRouteMeters(r, loc.lat, loc.lng);
                return Object.assign({}, r, { _distanceMeters: dist });
            })
            .sort((a, b) => a._distanceMeters - b._distanceMeters);

        const nearby = scored.filter(r => r._distanceMeters <= NEARBY_LIMIT);
        if (nearby.length > 0) {
            renderRoutes(nearby, {
                banner: {
                    isWarning: false,
                    html: `<strong>${nearby.length}</strong> ${nearby.length === 1 ? 'ruta cercana' : 'rutas cercanas'} a <strong>${escapeUserHtml(loc.name)}</strong> (ordenadas por distancia).`
                }
            });
            return;
        }

        const closest = scored.filter(r => isFinite(r._distanceMeters)).slice(0, 3);
        if (closest.length > 0) {
            const minDist = closest[0]._distanceMeters;
            const farMsg = minDist > FAR_WARNING_LIMIT
                ? `<strong>${escapeUserHtml(loc.name)}</strong> está lejos de las rutas registradas (la más cercana pasa a ${formatDistanceInfo(minDist)}). Opciones más próximas:`
                : `No hay rutas a menos de 800 m de <strong>${escapeUserHtml(loc.name)}</strong>. Las más cercanas pasan desde ${formatDistanceInfo(minDist)}:`;

            renderRoutes(closest, {
                banner: {
                    isWarning: true,
                    html: farMsg
                }
            });
            return;
        }

        renderRoutes([], {
            banner: {
                isWarning: true,
                html: `No encontramos rutas registradas cerca de <strong>${escapeUserHtml(loc.name)}</strong>.`
            }
        });
        return;
    }

    // Búsqueda inteligente por texto normalizado, tokens y sinónimos
    const filtered = !q ? categoryRoutes : categoryRoutes
        .map(r => {
            const stopNames = (r.stopsList || []).map(rs => {
                const s = rs.stop || rs;
                return `${s.name || ''} ${s.address || ''} ${s.type || ''}`;
            }).join(' ');
            const matchScore = scoreTextMatch(currentSearch, r.name, `${r.description || ''} ${stopNames}`);
            return { route: r, score: matchScore };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.route);

    renderRoutes(filtered);
}

function filterRoutes(searchText) {
    currentSearch = searchText;
    updateRouteDisplay();
    renderSearchSuggestions(searchText);
}

// ----------------------------------------------------------
// MOTOR DE BÚSQUEDA INTELIGENTE (SINÓNIMOS, TOKENS Y TOLERANCIA A ERRORES)
// ----------------------------------------------------------
const SEARCH_STOP_WORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'con', 'al', 'para', 'por', 'un', 'una']);

const SEARCH_SYNONYM_GROUPS = [
    ['imss', 'seguro', 'seguro social', 'hgzmf', 'clinica 3', 'hector gonzalez', 'hospital general'],
    ['hospital', 'clinica', 'medico', 'salud', 'urgencias', 'cruz roja'],
    ['farmacia', 'farmacias', 'medicina', 'medicinas', 'moderna', 'guadalajara', 'similares', 'benavides'],
    ['marina', 'marina mazatlan', 'cid marina', 'convenciones', 'international center'],
    ['malecon', 'av del mar', 'avenida del mar', 'costera', 'playa norte', 'olas altas', 'mujer mazatleca', 'casa del marino'],
    ['zona dorada', 'dorada', 'camaron sabalo', 'gaviotas', 'zona hotelera'],
    ['centro', 'centro historico', 'mercado pino suarez', 'pino suarez', 'plazuela machado', 'machado', 'catedral', 'plaza republica', 'ayuntamiento', 'azueta'],
    ['central', 'central camionera', 'camionera', 'terminal', 'autobuses'],
    ['acuario', 'gran acuario', 'parque central'],
    ['embarcadero', 'isla de la piedra', 'lancha', 'ferry', 'transbordador', 'puerto'],
    ['universidad', 'uni', 'facultad', 'campus', 'politecnica', 'upsin', 'uas', 'itmaz', 'tec', 'tecnologico', 'tecmilenio', 'ico', 'icatsin'],
    ['escuela', 'colegio', 'instituto', 'prepa', 'preparatoria', 'conalep', 'cbtis', 'cetmar', 'secundaria'],
    ['super', 'supermercado', 'mandado', 'walmart', 'soriana', 'ley', 'bodega aurrera', 'aurrera', 'sams', 'mega', 'abastos'],
    ['cafe', 'cafeteria', 'coffee', 'caffe', 'starbucks', 'caffenio', 'hunters', 'panama'],
    ['pasteleria', 'panaderia', 'postres', 'panama', 'dairy queen'],
    ['comida', 'restaurante', 'mariscos', 'taqueria', 'tacos', 'sushi', 'pizza', 'hamburguesa', 'alitas', 'cenaduria'],
    ['hamburguesa', 'hamburguesas', 'carls', 'carls jr', 'mcdonalds', 'burger'],
    ['pizza', 'pizzeria', 'little caesars', 'rin rin', 'la beba'],
    ['cine', 'peliculas', 'cinemex', 'cinepolis', 'multicinemas'],
    ['banco', 'cajero', 'bbva', 'bancomer', 'banorte', 'santander', 'banamex', 'citibanamex', 'scotiabank', 'hsbc'],
    ['gym', 'gimnasio', 'ejercicio', 'pesas', 'fitness', 'smart fit', 'lionfit', 'roca boxing', 'cancha', 'deportivo'],
    ['refacciones', 'refaccionaria', 'autopartes', 'autozone', 'oreilly', 'pina', 'pro one'],
    ['tienda', 'abarrotes', 'oxxo', 'kiosko', 'conveniencia'],
    ['gas', 'gasolina', 'gasolinera', 'pemex', 'redpetroil', 'indian gas'],
    ['plaza', 'centro comercial', 'mall', 'galerias', 'acaya', 'sendero', 'gran plaza', 'isla tres', 'san joaquin'],
    ['hotel', 'resort', 'suites', 'posada', 'hospedaje'],
    ['iglesia', 'templo', 'parroquia', 'catedral', 'capilla', 'san judas'],
    ['panteon', 'cementerio'],
    ['carretera', 'internacional', 'mex 15', 'libramiento'],
    ['naval', 'marina armada', 'region naval', 'zona naval', 'hospital naval']
];

const SEARCH_SYNONYM_MAP = (() => {
    const map = new Map();
    SEARCH_SYNONYM_GROUPS.forEach((group, groupIdx) => {
        group.forEach(term => {
            if (!map.has(term)) map.set(term, new Set());
            map.get(term).add(groupIdx);
            term.split(' ').forEach(w => {
                if (w.length >= 3) {
                    if (!map.has(w)) map.set(w, new Set());
                    map.get(w).add(groupIdx);
                }
            });
        });
    });
    return map;
})();

function normalizeSearchText(str) {
    return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizeSearchQuery(normStr) {
    const rawTokens = normStr ? normStr.split(' ').filter(Boolean) : [];
    const meaningful = rawTokens.filter(t => !SEARCH_STOP_WORDS.has(t));
    return meaningful.length > 0 ? meaningful : rawTokens;
}

function levenshteinWithin(a, b, maxDist) {
    if (Math.abs(a.length - b.length) > maxDist) return false;
    if (a === b) return true;
    const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const val = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
            cur.push(val);
            if (val < rowMin) rowMin = val;
        }
        if (rowMin > maxDist) return false;
        for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
    }
    return prev[b.length] <= maxDist;
}

function getSynonymsForQuery(normQuery, queryTokens) {
    const groupIds = new Set();
    if (SEARCH_SYNONYM_MAP.has(normQuery)) {
        SEARCH_SYNONYM_MAP.get(normQuery).forEach(id => groupIds.add(id));
    }
    queryTokens.forEach(tok => {
        if (SEARCH_SYNONYM_MAP.has(tok)) {
            SEARCH_SYNONYM_MAP.get(tok).forEach(id => groupIds.add(id));
        }
    });
    return Array.from(groupIds).flatMap(id => SEARCH_SYNONYM_GROUPS[id]);
}

function scoreTextMatch(queryRaw, titleText, extraText = '') {
    const nQuery = normalizeSearchText(queryRaw);
    if (!nQuery) return 1;

    const nTitle = normalizeSearchText(titleText);
    const nExtra = normalizeSearchText(extraText);
    const combined = nExtra ? `${nTitle} ${nExtra}` : nTitle;

    let score = 0;
    if (nTitle === nQuery) score += 160;
    else if (nTitle.startsWith(nQuery)) score += 120;
    else if (nTitle.includes(nQuery)) score += 90;
    else if (combined.includes(nQuery)) score += 55;

    const qTokens = tokenizeSearchQuery(nQuery);
    if (qTokens.length === 0) return score;

    const titleWords = nTitle ? nTitle.split(' ') : [];
    const combinedWords = combined ? combined.split(' ') : [];

    let tokenScoreSum = 0;
    for (const qt of qTokens) {
        let bestTok = 0;
        if (titleWords.some(w => w === qt)) {
            bestTok = 42;
        } else if (titleWords.some(w => w.startsWith(qt))) {
            bestTok = 34;
        } else if (nTitle.includes(qt)) {
            bestTok = 26;
        } else if (combinedWords.some(w => w === qt || w.startsWith(qt))) {
            bestTok = 18;
        } else if (combined.includes(qt)) {
            bestTok = 14;
        } else if (qt.length >= 4) {
            const maxEdit = qt.length >= 7 ? 2 : 1;
            if (titleWords.some(w => w.length >= 3 && levenshteinWithin(qt, w, maxEdit))) {
                bestTok = 16;
            } else if (combinedWords.some(w => w.length >= 4 && levenshteinWithin(qt, w, 1))) {
                bestTok = 10;
            }
        }

        if (bestTok === 0) {
            // Intentar coincidencia referencial por sinónimo del token
            const syns = SEARCH_SYNONYM_MAP.has(qt)
                ? Array.from(SEARCH_SYNONYM_MAP.get(qt)).flatMap(id => SEARCH_SYNONYM_GROUPS[id])
                : [];
            if (syns.some(s => nTitle.includes(s))) bestTok = 15;
            else if (syns.some(s => combined.includes(s))) bestTok = 11;
        }

        if (bestTok === 0) {
            // Solo si la frase completa (ej. "seguro social") es un sinónimo exacto en el mapa
            if (SEARCH_SYNONYM_MAP.has(nQuery)) {
                const exactPhraseSyns = Array.from(SEARCH_SYNONYM_MAP.get(nQuery)).flatMap(id => SEARCH_SYNONYM_GROUPS[id]);
                if (exactPhraseSyns.some(s => combined.includes(s))) {
                    return score + 38;
                }
            }
            return 0;
        }
        tokenScoreSum += bestTok;
    }

    return score + tokenScoreSum;
}

// ----------------------------------------------------------
// BUSCADOR PREDICTIVO Y AUTOCOMPLETADO DE COLONIAS Y DESTINOS
// ----------------------------------------------------------
// Registro seguro de callbacks para sugerencias (evita inyección o rotura por comillas en onclick)
const _suggestionActions = new Map();
let _suggestionSeq = 0;

function registerSuggestionAction(handler) {
    if (_suggestionActions.size > 400) _suggestionActions.clear();
    const id = ++_suggestionSeq;
    _suggestionActions.set(id, handler);
    return id;
}

window.triggerSuggestionAction = function (id) {
    const fn = _suggestionActions.get(Number(id));
    if (typeof fn === 'function') fn();
};

function safeUserColor(color, fallback = '#475569') {
    const val = String(color || '').trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(val) ? val : fallback;
}

function inferOsmStopType(osmClass, osmType) {
    const cls = (osmClass || '').toLowerCase();
    const t = (osmType || '').toLowerCase();
    if (cls === 'amenity') {
        if (t === 'hospital' || t === 'clinic' || t === 'doctors') return 'hospital';
        if (t === 'pharmacy') return 'farmacia';
        if (t === 'school' || t === 'university' || t === 'college' || t === 'kindergarten') return 'escuela';
        if (t === 'restaurant' || t === 'cafe' || t === 'fast_food' || t === 'bar' || t === 'ice_cream') return 'restaurante';
        if (t === 'bank' || t === 'atm') return 'banco';
        if (t === 'fuel') return 'gasolinera';
        if (t === 'bus_station' || t === 'ferry_terminal') return 'transporte';
        if (t === 'place_of_worship') return 'iglesia';
        if (t === 'townhall' || t === 'police' || t === 'courthouse' || t === 'library' || t === 'post_office') return 'gobierno';
        return 'comercio';
    }
    if (cls === 'healthcare') return 'hospital';
    if (cls === 'shop') {
        if (t === 'car_repair' || t === 'car_parts' || t === 'hardware') return 'refaccionaria';
        if (t === 'chemist' || t === 'pharmacy') return 'farmacia';
        return 'comercio';
    }
    if (cls === 'tourism') {
        if (t === 'hotel' || t === 'hostel' || t === 'resort' || t === 'motel' || t === 'guest_house') return 'hotel';
        return 'turistico';
    }
    if (cls === 'leisure') {
        if (t === 'park' || t === 'garden' || t === 'playground') return 'parque';
        if (t === 'fitness_centre' || t === 'sports_centre' || t === 'stadium' || t === 'pitch') return 'deportivo';
        if (t === 'beach_resort') return 'hotel';
        return 'turistico';
    }
    if (cls === 'natural' && (t === 'beach' || t === 'coastline')) return 'hotel';
    if (cls === 'place' || t === 'residential' || t === 'suburb' || t === 'neighbourhood' || t === 'quarter') return 'colonia';
    if (cls === 'highway') return 'calle';
    if (cls === 'building' && (t === 'church' || t === 'cathedral')) return 'iglesia';
    return 'lugar';
}

const MAZATLAN_OSM_VIEWBOX = '-106.54,23.38,-106.28,23.13';
const OSM_QUERY_REWRITES = [
    [/^(?:col|colonia|fracc|fraccionamiento)\.?\s+/i, ''],
    [/^(?:av|ave|avda|calz|blvd)\.?\s+/i, 'Avenida '],
    [/\blibramiento\s*(?:iii|3)\b/i, 'Avenida Oscar Perez Escobosa'],
    [/\blibramiento\s*(?:ii|2)\b/i, 'Avenida Munich'],
    [/\bmexico\s*15\b/i, 'Carretera Internacional'],
    [/\bmalecon\b/i, 'Avenida del Mar'],
    [/\bcamaron\s*sabalo\b/i, 'Avenida Camaron Sabalo'],
    [/\bcolosio\b/i, 'Luis Donaldo Colosio'],
    [/\bejer(?:cito)?\s*mex(?:icano)?\b/i, 'Avenida Ejercito Mexicano']
];

function expandOsmQuery(rawQuery) {
    let q = String(rawQuery || '').trim();
    for (const [pattern, replacement] of OSM_QUERY_REWRITES) {
        if (pattern.test(q)) {
            q = q.replace(pattern, replacement).trim();
        }
    }
    return q || String(rawQuery || '').trim();
}

function formatOsmSubtitle(item) {
    const addr = item && item.address ? item.address : {};
    const zone = addr.neighbourhood || addr.suburb || addr.quarter || addr.residential || '';
    const road = addr.road || '';
    const titleFirst = (item.display_name || '').split(',')[0].trim();
    const parts = [];
    if (road && normalizeSearchText(road) !== normalizeSearchText(titleFirst)) parts.push(road);
    if (zone && normalizeSearchText(zone) !== normalizeSearchText(titleFirst)) parts.push(zone);
    if (parts.length > 0) return `${parts.join(' · ')} · Mazatlán`;
    const cleanFull = (item.display_name || '').replace(/,\s*Sinaloa.*$/i, '').trim();
    return cleanFull || 'Mazatlán, Sinaloa';
}

let osmSearchTimeout = null;
const _osmRequests = new Map();

async function fetchOSMPlaces(query, dropdownId, type) {
    if (query.length < 3) return;
    const prev = _osmRequests.get(dropdownId);
    if (prev && prev.controller) {
        try { prev.controller.abort(); } catch (_) {}
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const seq = (prev ? prev.seq : 0) + 1;
    _osmRequests.set(dropdownId, { seq, controller });

    const expanded = expandOsmQuery(query);
    const params = new URLSearchParams({
        q: `${expanded}, Mazatlán, Sinaloa, México`,
        format: 'jsonv2',
        limit: '7',
        addressdetails: '1',
        viewbox: MAZATLAN_OSM_VIEWBOX,
        bounded: '1',
        countrycodes: 'mx',
        'accept-language': 'es'
    });
    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

    try {
        const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
        const data = await response.json();

        const currentReq = _osmRequests.get(dropdownId);
        if (currentReq && currentReq.seq !== seq) return;

        const dropdown = document.getElementById(dropdownId);
        if (!dropdown || dropdown.style.display === 'none') return;

        const seenKeys = new Set();
        const acceptedPoints = [];
        let html = '';

        (Array.isArray(data) ? data : []).forEach(item => {
            if (acceptedPoints.length >= 4) return;
            const fullName = item.display_name || '';
            const shortName = fullName.split(',')[0].trim();
            const lat = parseFloat(item.lat);
            const lng = parseFloat(item.lon);
            if (isNaN(lat) || isNaN(lng)) return;

            // Filtro extra por área urbana de Mazatlán
            if (lat < 23.13 || lat > 23.38 || lng < -106.54 || lng > -106.28) return;

            const title = (item.name && item.name.trim())
                ? item.name.trim()
                : (isNaN(shortName) ? shortName : (fullName.split(',')[1]?.trim() || shortName));
            const nTitle = normalizeSearchText(title);
            if (!nTitle) return;

            const addr = item.address || {};
            const zoneKey = normalizeSearchText(addr.neighbourhood || addr.suburb || addr.quarter || '');
            const dedupKey = `${nTitle}|${zoneKey}`;
            if (seenKeys.has(dedupKey)) return;

            // Evitar tramos duplicados muy cercanos de la misma avenida/calle
            if (acceptedPoints.some(p => p.nTitle === nTitle && calculateDistanceMeters(lat, lng, p.lat, p.lng) < 120)) {
                return;
            }
            // Evitar repetir exactamente una parada local ya mostrada a menos de 70 m
            if (Array.isArray(allPhysicalStopsList) && allPhysicalStopsList.some(s =>
                normalizeSearchText(s.name) === nTitle && calculateDistanceMeters(lat, lng, s.latitude, s.longitude) < 70
            )) {
                return;
            }

            seenKeys.add(dedupKey);
            acceptedPoints.push({ nTitle, lat, lng });

            const inferredType = inferOsmStopType(item.class || item.category, item.type);
            const config = (typeof getStopIconConfig === 'function')
                ? getStopIconConfig(title, inferredType)
                : { iconKey: 'parada', bgColor: '#2563eb', category: 'OpenStreetMap' };
            const color = safeUserColor(config.bgColor, '#2563eb');
            const badgeText = config.category && config.category !== 'Parada Oficial del Sistema'
                ? `${config.category} · OSM`
                : 'OpenStreetMap';
            const iconMarkup = (typeof renderStopCategorySvg === 'function')
                ? renderStopCategorySvg(config.iconKey, 15)
                : `<img src="assets/icons/ui_ubicacion.svg" alt="" style="filter: brightness(0) invert(1); width: 14px; height: 14px;">`;
            const subtitle = formatOsmSubtitle(item);

            const pointObj = { name: title, lat: lat, lng: lng };
            const actionId = registerSuggestionAction(() => {
                const encoded = encodeURIComponent(JSON.stringify(pointObj));
                if (type === 'main') selectColoniaSuggestion(encoded);
                else selectTripPoint(encoded, type);
            });

            html += `
                <div class="search-suggestion-item" data-osm-suggestion="true" onclick="triggerSuggestionAction(${actionId})">
                    <div class="suggestion-icon" style="background: ${color};">
                        ${iconMarkup}
                    </div>
                    <div class="suggestion-content">
                        <div class="suggestion-title">${escapeUserHtml(title)}</div>
                        <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap;">
                            <span class="suggestion-badge" style="background: ${color}15; color: ${color};">${escapeUserHtml(badgeText)}</span>
                            <span class="suggestion-subtitle" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; display: block;">${escapeUserHtml(subtitle)}</span>
                        </div>
                    </div>
                </div>
            `;
        });

        const placeholder = dropdown.querySelector('[data-empty-placeholder="true"]');
        if (html !== '') {
            if (placeholder) placeholder.remove();
            dropdown.querySelectorAll('.search-suggestion-item[data-osm-suggestion="true"]').forEach(el => el.remove());
            dropdown.innerHTML += html;
        } else if (placeholder) {
            placeholder.innerHTML = `No se encontraron colonias, calles ni destinos en Mazatlán para "<b>${escapeUserHtml(query)}</b>"`;
        }
    } catch (e) {
        if (e && e.name === 'AbortError') return;
        console.error("OSM Geocoding Error:", e);
        const dropdown = document.getElementById(dropdownId);
        const placeholder = dropdown ? dropdown.querySelector('[data-empty-placeholder="true"]') : null;
        if (placeholder) {
            placeholder.innerHTML = `Sin resultados locales para "<b>${escapeUserHtml(query)}</b>"`;
        }
    }
}
function getPassingRouteNamesForStop(stop) {
    return allRoutes
        .filter(r => r.stopsList && r.stopsList.some(rs => (rs.stop || rs).id === stop.id || (rs.stop || rs).name === stop.name))
        .map(r => r.name);
}

function getRankedStopSuggestions(query, limit = 8) {
    if (typeof allPhysicalStopsList === 'undefined' || !Array.isArray(allPhysicalStopsList)) return [];
    const results = [];
    for (const stop of allPhysicalStopsList) {
        const config = (typeof getStopIconConfig === 'function')
            ? getStopIconConfig(stop.name, stop.type)
            : { iconKey: 'parada', iconUrl: 'assets/icons/pin_parada.svg', bgColor: '#475569', category: 'Destino' };
        const passingRoutes = getPassingRouteNamesForStop(stop);
        const extra = `${stop.address || ''} ${stop.type || ''} ${config.category || ''} ${passingRoutes.join(' ')}`;
        let score = scoreTextMatch(query, stop.name, extra);
        if (score > 0) {
            if (passingRoutes.length > 0) score += 6;
            results.push({ stop, config, passingRoutes, score });
        }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
}

function renderSearchSuggestions(q) {
    const dropdown = document.getElementById('search-suggestions');
    if (!dropdown) return;
    
    const query = (q || '').trim();
    if (query.length < 1) {
        dropdown.style.display = 'none';
        return;
    }
    
    let html = '';
    let matchesCount = 0;
    
    // 1. Buscar y rankear Rutas + Paradas combinadas por relevancia
    const combinedEntries = [];

    allRoutes.forEach(r => {
        const s = scoreTextMatch(query, r.name, `${r.description || ''}`);
        if (s > 0) {
            const safeColor = safeUserColor(r.color, '#E63E21');
            combinedEntries.push({
                score: s + 8,
                html: `
                    <div class="search-suggestion-item" onclick="selectRouteSuggestion(${Number(r.id)})">
                        <div class="suggestion-icon" style="background: ${safeColor};">
                            <img src="assets/icons/ui_camion.svg" alt="">
                        </div>
                        <div class="suggestion-content">
                            <div class="suggestion-title">${escapeUserHtml(r.name)}</div>
                            <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap;">
                                <span class="suggestion-badge" style="background: ${safeColor}15; color: ${safeColor};">Ruta</span>
                                <span class="suggestion-subtitle">${escapeUserHtml(r.description || 'Ruta de autobús urbano en Mazatlán')}</span>
                            </div>
                        </div>
                    </div>
                `
            });
        }
    });

    const rankedStops = getRankedStopSuggestions(query, 8);
    rankedStops.forEach(({ stop, config, passingRoutes, score }) => {
        const safeBg = safeUserColor(config.bgColor);
        const subtitleText = passingRoutes.length > 0
            ? `${stop.address || 'Mazatlán'} — Pasa: ${passingRoutes.slice(0, 4).join(', ')}${passingRoutes.length > 4 ? ` (+${passingRoutes.length - 4})` : ''}`
            : `${stop.address || 'Mazatlán, Sinaloa'}`;
        const iconMarkup = (typeof renderStopCategorySvg === 'function')
            ? renderStopCategorySvg(config.iconKey, 16)
            : `<img src="${config.iconUrl}" alt="">`;
        
        const actionId = registerSuggestionAction(() => {
            selectStopSuggestion(encodeURIComponent(JSON.stringify(stop)));
        });
        combinedEntries.push({
            score,
            html: `
                <div class="search-suggestion-item" onclick="triggerSuggestionAction(${actionId})">
                    <div class="suggestion-icon" style="background: ${safeBg};">
                        ${iconMarkup}
                    </div>
                    <div class="suggestion-content">
                        <div class="suggestion-title">${escapeUserHtml(stop.name)}</div>
                        <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap;">
                            <span class="suggestion-badge" style="background: ${safeBg}15; color: ${safeBg};">${escapeUserHtml(config.category || 'Destino')}</span>
                            <span class="suggestion-subtitle">${escapeUserHtml(subtitleText)}</span>
                        </div>
                    </div>
                </div>
            `
        });
    });

    combinedEntries.sort((a, b) => b.score - a.score);
    const topEntries = combinedEntries.slice(0, 10);
    matchesCount = topEntries.length;
    html = topEntries.map(e => e.html).join('');
    
    if (matchesCount === 0) {
        html = `
            <div data-empty-placeholder="true" style="padding: 14px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
                Buscando coincidencias o lugares cercanos para "<b>${escapeUserHtml(q)}</b>"...
            </div>
        `;
    }
    
    dropdown.innerHTML = html;
    dropdown.style.display = 'block';

    // Disparar búsqueda asíncrona a OpenStreetMap (con debounce)
    if (query.length >= 3) {
        if (osmSearchTimeout) clearTimeout(osmSearchTimeout);
        osmSearchTimeout = setTimeout(() => {
            fetchOSMPlaces(query, 'search-suggestions', 'main');
        }, 500);
    }
}

function selectRouteSuggestion(routeId) {
    const dropdown = document.getElementById('search-suggestions');
    if (dropdown) dropdown.style.display = 'none';
    
    const route = allRoutes.find(r => r.id === routeId);
    if (route) {
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = route.name;
        updateClearSearchBtn();
        filterRoutes(route.name);
        
        const card = document.querySelector(`.route-card[data-id="${routeId}"]`);
        if (card) card.click();
        else {
            drawRoutePolyline(routeId, route.color);
            showDetailPanel(route, route.stopsList || []);
        }
    }
}

function notifyProximityResult(placeName, lat, lng) {
    let minDist = Infinity;
    for (const r of allRoutes) {
        const d = getMinDistanceToRouteMeters(r, lat, lng);
        if (d < minDist) minDist = d;
    }
    if (!isFinite(minDist)) return;

    if (minDist > 1500) {
        showToast(`Aviso: ${placeName} está lejos de las rutas (la más cercana pasa a ${formatDistanceInfo(minDist)}).`, 'error');
    } else if (minDist > 800) {
        showToast(`Sin rutas a menos de 800 m de ${placeName}. Mostrando la más cercana (${formatDistanceInfo(minDist)}).`);
    } else {
        showToast(`Mostrando rutas cercanas a ${placeName}.`);
    }
}

function createTeardropPinIcon(fillColor, labelText = '') {
    const svg = `<svg viewBox="0 0 32 42" width="30" height="39" style="display:block;filter:drop-shadow(0 3px 6px rgba(15,23,42,0.32));">
        <path d="M16 1C7.7 1 1 7.7 1 16c0 10.6 15 24.5 15 24.5S31 26.6 31 16C31 7.7 24.3 1 16 1z" fill="${fillColor}" stroke="#ffffff" stroke-width="2.2"/>
        ${labelText
            ? `<text x="16" y="20.5" text-anchor="middle" fill="#ffffff" font-family="Space Grotesk, Inter, sans-serif" font-size="13" font-weight="800">${escapeUserHtml(labelText)}</text>`
            : `<circle cx="16" cy="16" r="5" fill="#ffffff"/>`}
    </svg>`;
    return L.divIcon({
        className: 'custom-teardrop-pin',
        html: svg,
        iconSize: [30, 39],
        iconAnchor: [15, 39],
        popupAnchor: [0, -34],
        tooltipAnchor: [0, -34]
    });
}

function renderSearchedLocationPin(label, lat, lng) {
    if (!mapInstance || typeof L === 'undefined' || lat == null || lng == null) return;
    if (window._tempColoniaMarker) {
        mapInstance.removeLayer(window._tempColoniaMarker);
        window._tempColoniaMarker = null;
    }
    window._tempColoniaMarker = L.marker([lat, lng], {
        zIndexOffset: 1200,
        icon: createTeardropPinIcon('#1D3557', '')
    }).addTo(mapInstance)
      .bindTooltip(escapeUserHtml(label), {
          permanent: true,
          direction: 'top',
          className: 'rutero-map-label',
          offset: [0, -2]
      });
}

function selectStopSuggestion(stopJsonStr) {
    const dropdown = document.getElementById('search-suggestions');
    if (dropdown) dropdown.style.display = 'none';
    
    try {
        const stop = JSON.parse(decodeURIComponent(stopJsonStr));
        const searchInput = document.getElementById('search-input');
        
        if (searchInput) searchInput.value = stop.name;
        resetCategoryFilterToAll();
        window.currentSearchLocation = { lat: stop.latitude, lng: stop.longitude, name: stop.name, displayName: stop.name };
        currentSearch = stop.name;
        updateClearSearchBtn();
        updateRouteDisplay();
        notifyProximityResult(stop.name, stop.latitude, stop.longitude);
        renderSearchedLocationPin(stop.name, stop.latitude, stop.longitude);
        if (isMobileViewport()) setMobileSheetState('half');
        
        if (mapInstance && typeof L !== 'undefined') {
            if (typeof setPhysicalStopsVisible === 'function') setPhysicalStopsVisible(true);
            const targetMarker = (typeof allStopsMarkers !== 'undefined') ? allStopsMarkers.find(m => {
                const latlng = m.getLatLng();
                return Math.abs(latlng.lat - stop.latitude) < 0.0001 && Math.abs(latlng.lng - stop.longitude) < 0.0001;
            }) : null;

            if (targetMarker && typeof allStopsClusterGroup !== 'undefined' && allStopsClusterGroup && allStopsClusterGroup._map) {
                allStopsClusterGroup.zoomToShowLayer(targetMarker, () => {
                    mapInstance.flyTo([stop.latitude, stop.longitude], 16, { duration: 0.9 });
                    setTimeout(() => targetMarker.openPopup(), 500);
                });
            } else {
                mapInstance.flyTo([stop.latitude, stop.longitude], 16, { duration: 1.2 });
                if (targetMarker) {
                    setTimeout(() => targetMarker.openPopup(), 1200);
                }
            }
        }
    } catch (e) {
        console.error("Error al seleccionar destino:", e);
    }
}

function selectColoniaSuggestion(colJsonStr) {
    try {
        const col = JSON.parse(decodeURIComponent(colJsonStr));
        const searchInput = document.getElementById('search-input');
        const cpText = col.cp ? ` (C.P. ${col.cp})` : '';
        const displayName = `${col.name}${cpText}`;
        
        if (searchInput) searchInput.value = col.name;
        resetCategoryFilterToAll();
        window.currentSearchLocation = { lat: col.lat, lng: col.lng, name: col.name, displayName };
        currentSearch = col.name;
        updateClearSearchBtn();
        updateRouteDisplay();
        
        const dropdown = document.getElementById('search-suggestions');
        if (dropdown) dropdown.style.display = 'none';
        
        if (mapInstance && typeof L !== 'undefined') {
            mapInstance.flyTo([col.lat, col.lng], 15, { duration: 1.2 });
            renderSearchedLocationPin(displayName, col.lat, col.lng);
            notifyProximityResult(displayName, col.lat, col.lng);
            if (isMobileViewport()) setMobileSheetState('half');
        }
    } catch (e) {
        console.error("Error al seleccionar colonia:", e);
    }
}

// ==========================================================
// PLANIFICADOR DE VIAJES ("¿CÓMO LLEGO?" ORIGEN ➔ DESTINO)
// ==========================================================
let selectedOrigin = null;
let selectedDestination = null;

// Destinos turísticos icónicos de Mazatlán (solo atractivos clave para visitantes)
const TOURIST_SPOTLIGHT_DESTINATIONS = [
    { id: 'acuario', label: 'Gran Acuario', fullName: 'Gran Acuario Mazatlán', lat: 23.228906, lng: -106.427609 },
    { id: 'zona-dorada', label: 'Zona Dorada', fullName: 'Zona Dorada (Av. Camarón Sábalo)', lat: 23.244428, lng: -106.452477 },
    { id: 'malecon', label: 'Malecón / Valentinos', fullName: 'Malecón y Letras de Mazatlán (Valentinos)', lat: 23.238356, lng: -106.445794 },
    { id: 'machado', label: 'Plazuela Machado', fullName: 'Plazuela Machado (Centro Histórico)', lat: 23.198354, lng: -106.423209 },
    { id: 'faro', label: 'Faro / Mirador', fullName: 'Faro de Mazatlán (Cerro del Crestón)', lat: 23.181188, lng: -106.425404 },
    { id: 'olas-altas', label: 'Playa Olas Altas', fullName: 'Playa Olas Altas', lat: 23.196363, lng: -106.426693 },
    { id: 'cerritos', label: 'Playa Cerritos', fullName: 'Playa Cerritos', lat: 23.272556, lng: -106.466542 },
    { id: 'brujas', label: 'Playa Brujas', fullName: 'Playa Brujas', lat: 23.302280, lng: -106.489240 },
    { id: 'pino-suarez', label: 'Mercado Pino Suárez', fullName: 'Mercado Pino Suárez', lat: 23.202240, lng: -106.421078 },
    { id: 'isla-piedra', label: 'Isla de la Piedra', fullName: 'Embarcadero Isla de la Piedra', lat: 23.205267, lng: -106.410597 },
    { id: 'cruceros', label: 'Terminal Cruceros', fullName: 'Terminal de Cruceros Mazatlán', lat: 23.194836, lng: -106.414468 },
    { id: 'munba', label: 'Observatorio / MUNBA', fullName: 'Observatorio 1873 y Museo de la Ballena', lat: 23.189687, lng: -106.425063 },
    { id: 'playa-norte', label: 'Playa Norte', fullName: 'Playa Norte (Monumento al Pescador)', lat: 23.211570, lng: -106.421550 }
];

function updateActiveTouristChip(activeId) {
    const container = document.getElementById('tourist-quick-chips');
    if (!container) return;
    container.querySelectorAll('.tourist-chip').forEach((btn) => {
        const isActive = activeId && btn.dataset.spotId === activeId;
        btn.classList.toggle('active', Boolean(isActive));
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function renderTouristQuickChips() {
    const container = document.getElementById('tourist-quick-chips');
    if (!container) return;
    container.innerHTML = TOURIST_SPOTLIGHT_DESTINATIONS.map((spot) => `
        <button type="button"
                class="tourist-chip"
                data-spot-id="${spot.id}"
                aria-pressed="false"
                title="Fijar ${spot.fullName} como destino"
                onclick="selectTouristDestination('${spot.id}')">${spot.label}</button>
    `).join('');
}

function selectTouristDestination(spotId) {
    const spot = TOURIST_SPOTLIGHT_DESTINATIONS.find((s) => s.id === spotId);
    if (!spot) return;

    cancelTripMapPickMode();
    selectedDestination = { name: spot.fullName, lat: spot.lat, lng: spot.lng };

    const destInput = document.getElementById('destination-input');
    const destSug = document.getElementById('destination-suggestions');
    if (destInput) destInput.value = spot.fullName;
    if (destSug) destSug.style.display = 'none';

    updateActiveTouristChip(spot.id);

    if (mapInstance && typeof L !== 'undefined') {
        if (window._tripDestMarker) mapInstance.removeLayer(window._tripDestMarker);
        window._tripDestMarker = L.marker([spot.lat, spot.lng], {
            zIndexOffset: 1100,
            icon: createTeardropPinIcon('#E63E21', 'B')
        })
            .addTo(mapInstance)
            .bindPopup(`<b style="font-family:Inter,sans-serif;">Destino: ${escapeUserHtml(spot.fullName)}</b>`);
    }

    if (selectedOrigin) {
        calculateTripRoute();
        return;
    }

    if (mapInstance) {
        mapInstance.flyTo([spot.lat, spot.lng], 15, { duration: 0.9 });
    }
    if (isMobileViewport() && mobileSheetState === 'peek') {
        setMobileSheetState('half');
    }
    const origInput = document.getElementById('origin-input');
    if (origInput && !isMobileViewport()) origInput.focus();
    showToast(`Destino fijado: ${spot.label}. Ahora indica tu Origen`);
}

function clearTripMapMarkers({ clearLocationMarker = false } = {}) {
    if (!mapInstance) return;
    if (window._tripOrigMarker) { mapInstance.removeLayer(window._tripOrigMarker); window._tripOrigMarker = null; }
    if (window._tripDestMarker) { mapInstance.removeLayer(window._tripDestMarker); window._tripDestMarker = null; }
    if (clearLocationMarker && window._userLocationMarker) {
        mapInstance.removeLayer(window._userLocationMarker);
        window._userLocationMarker = null;
    }
}

function clearTripPlanner({ silent = false } = {}) {
    cancelTripMapPickMode();
    selectedOrigin = null;
    selectedDestination = null;
    window._tripComputedOptions = [];

    const origInput = document.getElementById('origin-input');
    const destInput = document.getElementById('destination-input');
    const origSug = document.getElementById('origin-suggestions');
    const destSug = document.getElementById('destination-suggestions');
    const resultsContainer = document.getElementById('trip-results-container');

    if (origInput) origInput.value = '';
    if (destInput) destInput.value = '';
    if (origSug) origSug.style.display = 'none';
    if (destSug) destSug.style.display = 'none';
    if (resultsContainer) resultsContainer.innerHTML = '';

    clearTripMapMarkers({ clearLocationMarker: true });
    clearMapDrawings();
    updateActiveTouristChip(null);
    if (typeof stopOnboardTrip === 'function') stopOnboardTrip({ silent: true });

    if (!silent) {
        showToast('Búsqueda de viaje limpiada');
    }
}

function swapTripOriginDestination() {
    cancelTripMapPickMode();
    const origInput = document.getElementById('origin-input');
    const destInput = document.getElementById('destination-input');

    const prevOrig = selectedOrigin;
    const prevDest = selectedDestination;
    selectedOrigin = prevDest;
    selectedDestination = prevOrig;

    if (origInput && destInput) {
        const tmpVal = origInput.value;
        origInput.value = destInput.value;
        destInput.value = tmpVal;
    }

    const origSug = document.getElementById('origin-suggestions');
    const destSug = document.getElementById('destination-suggestions');
    if (origSug) origSug.style.display = 'none';
    if (destSug) destSug.style.display = 'none';
    updateActiveTouristChip(null);

    if (selectedOrigin && selectedDestination) {
        calculateTripRoute();
    } else {
        clearTripMapMarkers({ clearLocationMarker: true });
        clearMapDrawings();
        showToast('Origen y destino invertidos');
    }
}

function switchSidebarMode(mode) {
    const tabRutas = document.getElementById('tab-rutas');
    const tabPlan = document.getElementById('tab-planificador');
    const secRutas = document.getElementById('main-list-section');
    const secPlan = document.getElementById('trip-planner-section');
    const detailPanel = document.getElementById('detail-panel');
    
    if (mode === 'rutas') {
        if (typeof confirmStoppingActiveOnboardTrip === 'function' && !confirmStoppingActiveOnboardTrip('explorar otras rutas')) {
            return;
        }
        cancelTripMapPickMode();
        if (typeof stopOnboardTrip === 'function') stopOnboardTrip({ silent: true });
        if (tabRutas) tabRutas.classList.add('active');
        if (tabPlan) tabPlan.classList.remove('active');
        if (secRutas) secRutas.style.display = 'flex';
        if (secPlan) secPlan.style.display = 'none';

        // Al volver a Ver Rutas sin un detalle abierto, limpiar trazado/pines del planificador previo
        if (!detailPanel || !detailPanel.classList.contains('visible')) {
            clearTripMapMarkers();
            clearMapDrawings();
        }
    } else {
        if (tabPlan) tabPlan.classList.add('active');
        if (tabRutas) tabRutas.classList.remove('active');
        if (secPlan) secPlan.style.display = 'flex';
        if (secRutas) secRutas.style.display = 'none';
        if (detailPanel) detailPanel.classList.remove('visible');
        if (isMobileViewport() && mobileSheetState === 'peek') {
            setMobileSheetState('half');
        }
    }
}

let tripMapPickMode = null; // 'origin' | 'destination' | null

function cancelTripMapPickMode() {
    tripMapPickMode = null;
    if (mapInstance && mapInstance.getContainer()) {
        mapInstance.getContainer().style.cursor = '';
    }
    const origPickBtn = document.getElementById('btn-pick-origin-map');
    const destPickBtn = document.getElementById('btn-pick-dest-map');
    if (origPickBtn) origPickBtn.textContent = 'Elegir en mapa';
    if (destPickBtn) destPickBtn.textContent = 'Elegir en mapa';
    const origInput = document.getElementById('origin-input');
    const destInput = document.getElementById('destination-input');
    if (origInput) origInput.placeholder = 'Col. Juárez, 82180, UAS...';
    if (destInput) destInput.placeholder = 'Gran Acuario, Cerritos, 82110...';
}

function enableTripMapPickMode(mode, { silent = false } = {}) {
    if (tripMapPickMode === mode) {
        cancelTripMapPickMode();
        return;
    }
    cancelTripMapPickMode();
    tripMapPickMode = mode;
    if (mapInstance && mapInstance.getContainer()) {
        mapInstance.getContainer().style.cursor = 'crosshair';
    }
    const activeBtn = document.getElementById(mode === 'origin' ? 'btn-pick-origin-map' : 'btn-pick-dest-map');
    if (activeBtn) activeBtn.textContent = 'Cancelar clic en mapa';
    const targetInput = document.getElementById(mode === 'origin' ? 'origin-input' : 'destination-input');
    if (targetInput) {
        targetInput.placeholder = `Haz clic en el mapa para fijar ${mode === 'origin' ? 'Origen' : 'Destino'}...`;
    }
    if (isMobileViewport()) {
        setMobileSheetState('peek');
    }
    if (!silent) {
        const label = mode === 'origin' ? 'Origen' : 'Destino';
        showToast(`Haz clic en el mapa para fijar tu ${label}`);
    }
}

function setupTripPlannerListeners() {
    renderTouristQuickChips();
    const origInput = document.getElementById('origin-input');
    const destInput = document.getElementById('destination-input');
    const btnMyLocation = document.getElementById('btn-use-mylocation');
    const btnPickOriginMap = document.getElementById('btn-pick-origin-map');
    const btnPickDestMap = document.getElementById('btn-pick-dest-map');
    
    if (origInput) {
        origInput.addEventListener('input', (e) => {
            selectedOrigin = null;
            renderTripSuggestions(e.target.value, 'origin-suggestions', 'origin');
        });
        origInput.addEventListener('focus', () => {
            if (isMobileViewport()) setMobileSheetState('full');
            if (origInput.value.trim().length >= 1) renderTripSuggestions(origInput.value, 'origin-suggestions', 'origin');
        });
    }
    if (destInput) {
        destInput.addEventListener('input', (e) => {
            selectedDestination = null;
            updateActiveTouristChip(null);
            renderTripSuggestions(e.target.value, 'destination-suggestions', 'destination');
        });
        destInput.addEventListener('focus', () => {
            if (isMobileViewport()) setMobileSheetState('full');
            if (destInput.value.trim().length >= 1) renderTripSuggestions(destInput.value, 'destination-suggestions', 'destination');
        });
    }
    if (btnPickOriginMap) {
        btnPickOriginMap.addEventListener('click', () => enableTripMapPickMode('origin'));
    }
    if (btnPickDestMap) {
        btnPickDestMap.addEventListener('click', () => enableTripMapPickMode('destination'));
    }
    if (btnMyLocation) {
        btnMyLocation.addEventListener('click', async () => {
            if (btnMyLocation.dataset.loading === '1') return;
            if (!navigator.geolocation) {
                enableTripMapPickMode('origin', { silent: true });
                showToast('Tu navegador no tiene GPS. Haz clic directo en el mapa para fijar tu Origen.', 'error');
                return;
            }
            cancelTripMapPickMode();

            const prevPlaceholder = origInput ? origInput.placeholder : '';
            btnMyLocation.dataset.loading = '1';
            btnMyLocation.style.opacity = '0.45';
            if (origInput) origInput.placeholder = 'Obteniendo ubicación GPS...';
            showToast('Obteniendo tu ubicación GPS...');

            try {
                const pos = await getReliableCurrentPosition();
                const { latitude, longitude } = pos.coords;
                const distFromMazatlan = calculateDistanceMeters(latitude, longitude, 23.2329, -106.4062);

                if (distFromMazatlan > 60000) {
                    enableTripMapPickMode('origin', { silent: true });
                    if (mapInstance && typeof MAP_CENTER !== 'undefined') {
                        mapInstance.setView(MAP_CENTER, typeof DEFAULT_ZOOM !== 'undefined' ? DEFAULT_ZOOM : 13);
                    }
                    showToast('Tu navegador/Windows ubicó otro punto fuera de Mazatlán. Toca el mapa para fijar tu Origen.', 'error');
                    return;
                }

                selectedOrigin = { name: 'Mi ubicación actual', lat: latitude, lng: longitude };
                if (origInput) origInput.value = 'Mi ubicación actual';

                const d1 = document.getElementById('origin-suggestions');
                if (d1) d1.style.display = 'none';

                setUserLocationMarker(latitude, longitude, 'Tu ubicación actual (Origen)');
                if (mapInstance) mapInstance.flyTo([latitude, longitude], 16);
                showToast('Origen fijado en tu ubicación GPS');
            } catch (err) {
                enableTripMapPickMode('origin', { silent: true });
                const reason = getGeolocationErrorMessage(err);
                showToast(`${reason} Toca el mapa para fijar tu Origen.`, 'error');
            } finally {
                btnMyLocation.dataset.loading = '0';
                btnMyLocation.style.opacity = '1';
                if (origInput && tripMapPickMode !== 'origin') {
                    origInput.placeholder = prevPlaceholder || 'Col. Juárez, 82180, UAS...';
                }
            }
        });
    }

    if (mapInstance) {
        mapInstance.on('click', async (e) => {
            if (!tripMapPickMode) return;
            const mode = tripMapPickMode;
            const { lat, lng } = e.latlng;
            cancelTripMapPickMode();

            const fallbackLabel = mode === 'origin'
                ? `Origen en mapa (${lat.toFixed(4)}, ${lng.toFixed(4)})`
                : `Destino en mapa (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

            if (mode === 'origin') {
                selectedOrigin = { name: fallbackLabel, lat, lng };
                if (origInput) origInput.value = fallbackLabel;
                const d1 = document.getElementById('origin-suggestions');
                if (d1) d1.style.display = 'none';
                setUserLocationMarker(lat, lng, 'Origen seleccionado');
                showToast('Origen fijado en el mapa');
            } else {
                selectedDestination = { name: fallbackLabel, lat, lng };
                updateActiveTouristChip(null);
                if (destInput) destInput.value = fallbackLabel;
                const d2 = document.getElementById('destination-suggestions');
                if (d2) d2.style.display = 'none';
                if (window._tripDestMarker) mapInstance.removeLayer(window._tripDestMarker);
                window._tripDestMarker = L.marker([lat, lng], {
                    zIndexOffset: 1100,
                    icon: createTeardropPinIcon('#E63E21', 'B')
                })
                    .addTo(mapInstance)
                    .bindPopup('<b style="font-family:Inter,sans-serif;">Destino seleccionado</b>');
                showToast('Destino fijado en el mapa');
            }
            if (isMobileViewport()) setMobileSheetState('half');

            // Intentar obtener nombre legible de la calle con Nominatim sin bloquear la interacción
            try {
                const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=es`);
                if (resp.ok) {
                    const data = await resp.json();
                    const road = data.address && (data.address.road || data.address.neighbourhood || data.address.suburb);
                    const suburb = data.address && (data.address.neighbourhood || data.address.suburb);
                    if (road) {
                        const niceLabel = (suburb && suburb !== road) ? `${road}, ${suburb}` : road;
                        if (mode === 'origin' && selectedOrigin && selectedOrigin.lat === lat && selectedOrigin.lng === lng) {
                            selectedOrigin.name = niceLabel;
                            if (origInput) origInput.value = niceLabel;
                        } else if (mode === 'destination' && selectedDestination && selectedDestination.lat === lat && selectedDestination.lng === lng) {
                            selectedDestination.name = niceLabel;
                            if (destInput) destInput.value = niceLabel;
                        }
                    }
                }
            } catch (_) {}
        });
    }
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#trip-planner-section')) {
            const d1 = document.getElementById('origin-suggestions');
            const d2 = document.getElementById('destination-suggestions');
            if (d1) d1.style.display = 'none';
            if (d2) d2.style.display = 'none';
        }
    });
}

function renderTripSuggestions(q, dropdownId, type) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    const query = (q || '').trim();
    if (query.length < 1) { dropdown.style.display = 'none'; return; }
    
    let html = '';
    const rankedStops = getRankedStopSuggestions(query, 6);
    rankedStops.forEach(({ stop, config }) => {
        const safeBg = safeUserColor(config.bgColor);
        const pointObj = { name: stop.name, lat: stop.latitude, lng: stop.longitude };
        const iconMarkup = (typeof renderStopCategorySvg === 'function')
            ? renderStopCategorySvg(config.iconKey, 16)
            : `<img src="${config.iconUrl}" alt="">`;
        const actionId = registerSuggestionAction(() => {
            selectTripPoint(encodeURIComponent(JSON.stringify(pointObj)), type);
        });
        html += `
            <div class="search-suggestion-item" onclick="triggerSuggestionAction(${actionId})">
                <div class="suggestion-icon" style="background: ${safeBg};">${iconMarkup}</div>
                <div class="suggestion-content">
                    <div class="suggestion-title">${escapeUserHtml(stop.name)}</div>
                    <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap;">
                        <span class="suggestion-badge" style="background: ${safeBg}15; color: ${safeBg};">${escapeUserHtml(config.category || 'Destino')}</span>
                        <span class="suggestion-subtitle">${escapeUserHtml(stop.address || 'Mazatlán')}</span>
                    </div>
                </div>
            </div>
        `;
    });
    
    if (rankedStops.length === 0) {
        html = `<div data-empty-placeholder="true" style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.8rem;">Buscando en lugares cercanos de Mazatlán para "${escapeUserHtml(q)}"...</div>`;
    }
    dropdown.innerHTML = html;
    dropdown.style.display = 'block';

    // Disparar búsqueda asíncrona a OpenStreetMap (con debounce)
    if (query.length >= 3) {
        if (osmSearchTimeout) clearTimeout(osmSearchTimeout);
        osmSearchTimeout = setTimeout(() => {
            fetchOSMPlaces(query, dropdownId, type);
        }, 500);
    }
}

function selectTripPoint(objStr, type) {
    try {
        const point = JSON.parse(decodeURIComponent(objStr));
        if (type === 'origin') {
            selectedOrigin = point;
            const inp = document.getElementById('origin-input');
            if (inp) inp.value = point.name;
            const d = document.getElementById('origin-suggestions');
            if (d) d.style.display = 'none';
        } else {
            selectedDestination = point;
            const inp = document.getElementById('destination-input');
            if (inp) inp.value = point.name;
            const d = document.getElementById('destination-suggestions');
            if (d) d.style.display = 'none';
        }
    } catch (e) {
        console.error("Error en selectTripPoint:", e);
    }
}

function findNearestStopLabel(route, lat, lng) {
    if (lat == null || lng == null) return null;
    let bestName = null;
    let bestDist = Infinity;

    if (route && Array.isArray(route.stopsList)) {
        for (const rs of route.stopsList) {
            const s = rs.stop || rs;
            if (s && s.latitude != null && s.longitude != null) {
                const d = calculateDistanceMeters(lat, lng, s.latitude, s.longitude);
                if (d <= 250 && d < bestDist) {
                    bestDist = d;
                    bestName = s.name;
                }
            }
        }
    }

    if (!bestName && typeof allPhysicalStopsList !== 'undefined' && Array.isArray(allPhysicalStopsList)) {
        for (const s of allPhysicalStopsList) {
            if (s && s.latitude != null && s.longitude != null) {
                const d = calculateDistanceMeters(lat, lng, s.latitude, s.longitude);
                if (d <= 160 && d < bestDist) {
                    bestDist = d;
                    bestName = s.name;
                }
            }
        }
    }

    return bestName;
}

function getRouteBoundingBox(coords) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const c of coords) {
        if (c.latitude == null || c.longitude == null) continue;
        if (c.latitude < minLat) minLat = c.latitude;
        if (c.latitude > maxLat) maxLat = c.latitude;
        if (c.longitude < minLng) minLng = c.longitude;
        if (c.longitude > maxLng) maxLng = c.longitude;
    }
    return { minLat, maxLat, minLng, maxLng };
}

function findCandidateTransferPoints(routeA, routeB, maxCandidates = 6) {
    const coordsA = routeA.coordinatesList || [];
    const coordsB = routeB.coordinatesList || [];
    if (coordsA.length === 0 || coordsB.length === 0) return [];

    // Descarte rápido por bounding box (+ ~500m de margen)
    const pad = 0.005;
    const boxA = getRouteBoundingBox(coordsA);
    const boxB = getRouteBoundingBox(coordsB);
    if (boxA.maxLat + pad < boxB.minLat || boxB.maxLat + pad < boxA.minLat ||
        boxA.maxLng + pad < boxB.minLng || boxB.maxLng + pad < boxA.minLng) {
        return [];
    }

    const buckets = new Map();
    const recordCandidate = (cand) => {
        if (cand.walkDist > 400) return;
        const key = `${Math.round(cand.midLat / 0.004)}_${Math.round(cand.midLng / 0.004)}`;
        const prev = buckets.get(key);
        if (!prev || cand.walkDist < prev.walkDist) {
            buckets.set(key, cand);
        }
    };

    const checkVerticesAgainstSegments = (pts, segs, swapped) => {
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (p.latitude == null || p.longitude == null) continue;
            for (let j = 0; j < segs.length - 1; j++) {
                const s1 = segs[j];
                const s2 = segs[j + 1];
                if (s1.latitude == null || s1.longitude == null || s2.latitude == null || s2.longitude == null) continue;
                const proj = closestPointOnSegment(p.latitude, p.longitude, s1.latitude, s1.longitude, s2.latitude, s2.longitude);
                if (proj.dist <= 400) {
                    const latA = swapped ? proj.lat : p.latitude;
                    const lngA = swapped ? proj.lng : p.longitude;
                    const latB = swapped ? p.latitude : proj.lat;
                    const lngB = swapped ? p.longitude : proj.lng;
                    const segA = swapped ? j : Math.min(i, coordsA.length - 2);
                    const tA = swapped ? proj.t : 0;
                    const segB = swapped ? Math.min(i, coordsB.length - 2) : j;
                    const tB = swapped ? 0 : proj.t;
                    recordCandidate({
                        latA, lngA, latB, lngB,
                        segA, tA, segB, tB,
                        midLat: (latA + latB) / 2,
                        midLng: (lngA + lngB) / 2,
                        walkDist: proj.dist
                    });
                }
            }
        }
    };

    checkVerticesAgainstSegments(coordsA, coordsB, false);
    checkVerticesAgainstSegments(coordsB, coordsA, true);

    return Array.from(buckets.values())
        .sort((a, b) => a.walkDist - b.walkDist)
        .slice(0, maxCandidates);
}

function findBestTransferPoint(routeA, routeB) {
    return findCandidateTransferPoints(routeA, routeB, 1)[0] || null;
}

function estimateTripMinutes(walkMeters, busMeters, transferCount = 0, trafficMetrics = null) {
    const walkMin = walkMeters > 0 ? Math.max(1, Math.round(walkMeters / 80)) : 0;
    const busKmh = (trafficMetrics && trafficMetrics.effectiveSpeedKmh) ? trafficMetrics.effectiveSpeedKmh : 21.9;
    const metersPerMin = (busKmh * 1000) / 60;
    const busMin = (busMeters && isFinite(busMeters)) ? Math.max(2, Math.round(busMeters / metersPerMin)) : 8;
    const transferMin = transferCount * 4;
    return walkMin + busMin + transferMin;
}

window._tripComputedOptions = [];

function calculateTripRoute() {
    const container = document.getElementById('trip-results-container');
    if (!container) return;
    
    if (!selectedOrigin || !selectedDestination) {
        showToast('Selecciona un Origen y Destino de las sugerencias o usa tu GPS.', 'error');
        return;
    }
    
    container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 0.86rem;">Calculando mejores rutas y transbordos...</div>`;
    
    setTimeout(() => {
        const directWalkDist = calculateDistanceMeters(selectedOrigin.lat, selectedOrigin.lng, selectedDestination.lat, selectedDestination.lng);
        const MAX_BOARD_WALK = 1100;

        const routeMetrics = allRoutes
            .filter(r => Array.isArray(r.coordinatesList) && r.coordinatesList.length > 0)
            .map(r => {
                const origInfo = findClosestPointOnRoute(r, selectedOrigin.lat, selectedOrigin.lng);
                const destInfo = findClosestPointOnRoute(r, selectedDestination.lat, selectedDestination.lng);
                const origCandidates = origInfo.dist <= MAX_BOARD_WALK
                    ? findRouteCandidates(r, selectedOrigin.lat, selectedOrigin.lng, MAX_BOARD_WALK)
                    : [];
                const destCandidates = destInfo.dist <= MAX_BOARD_WALK
                    ? findRouteCandidates(r, selectedDestination.lat, selectedDestination.lng, MAX_BOARD_WALK)
                    : [];
                return { route: r, origInfo, destInfo, origCandidates, destCandidates };
            });

        // 1. Opciones directas (emparejando carril/sentido correcto para llegar hacia el destino)
        const directOptions = routeMetrics
            .filter(m => m.origInfo.dist <= MAX_BOARD_WALK && m.destInfo.dist <= MAX_BOARD_WALK)
            .map(m => {
                const coords = m.route.coordinatesList;
                const oCands = m.origCandidates.length > 0 ? m.origCandidates : [m.origInfo];
                const dCands = m.destCandidates.length > 0 ? m.destCandidates : [m.destInfo];

                let bestPair = {
                    origInfo: m.origInfo,
                    destInfo: m.destInfo,
                    forwardDist: Infinity,
                    segmentCoords: null,
                    pairCost: Infinity
                };

                for (const oc of oCands) {
                    for (const dc of dCands) {
                        const loopInfo = getForwardLoopMetrics(coords, oc, dc);
                        const rideCost = isFinite(loopInfo.forwardDist) ? loopInfo.forwardDist * 0.28 : 999999;
                        const cost = (oc.dist + dc.dist) * 2.2 + rideCost;
                        if (cost < bestPair.pairCost) {
                            bestPair = {
                                origInfo: oc,
                                destInfo: dc,
                                forwardDist: loopInfo.forwardDist,
                                segmentCoords: loopInfo.segmentCoords,
                                pairCost: cost
                            };
                        }
                    }
                }

                const dirInfo = getBoardingDirectionInfo(m.route, bestPair.origInfo, selectedOrigin.lat, selectedOrigin.lng, oCands);
                const totalWalk = bestPair.origInfo.dist + bestPair.destInfo.dist;
                const trafficInfo = computeRouteTrafficMetrics(bestPair.segmentCoords, bestPair.forwardDist);
                const estimatedMin = estimateTripMinutes(totalWalk, bestPair.forwardDist, 0, trafficInfo);

                return {
                    type: 'direct',
                    routeA: m.route,
                    origInfo: bestPair.origInfo,
                    destInfo: bestPair.destInfo,
                    travelCoords: bestPair.segmentCoords,
                    onBusDist: bestPair.forwardDist,
                    estimatedMin,
                    trafficInfo,
                    dirInfo,
                    boardLabel: findNearestStopLabel(m.route, bestPair.origInfo.lat, bestPair.origInfo.lng),
                    alightLabel: findNearestStopLabel(m.route, bestPair.destInfo.lat, bestPair.destInfo.lng),
                    normalPrice: getRouteNormalPrice(m.route),
                    studentPrice: getRouteStudentPrice(m.route),
                    totalPrice: getActiveRoutePrice(m.route),
                    score: totalWalk + (isFinite(bestPair.forwardDist) ? bestPair.forwardDist * 0.08 : 50000)
                };
            })
            .sort((a, b) => a.score - b.score);

        // 2. Opciones con 1 transbordo (2 camiones) solo si no hay directa o si ahorran caminata real sin rodeos absurdos
        const bestDirect = directOptions[0] || null;
        const bestDirectWalk = bestDirect ? (bestDirect.origInfo.dist + bestDirect.destInfo.dist) : Infinity;
        const bestDirectBusDist = (bestDirect && isFinite(bestDirect.onBusDist)) ? bestDirect.onBusDist : Infinity;
        const needTransfers = directOptions.length === 0 || bestDirectWalk > 800;
        const transferOptions = [];
        if (needTransfers) {
            const TRANSFER_PENALTY = 1800;
            const origRoutes = routeMetrics.filter(m => m.origInfo.dist <= 1000);
            const destRoutes = routeMetrics.filter(m => m.destInfo.dist <= 1000);

            for (const candA of origRoutes) {
                for (const candB of destRoutes) {
                    if (candA.route.id === candB.route.id) continue;
                    const candidateTransfers = findCandidateTransferPoints(candA.route, candB.route, 6);
                    if (candidateTransfers.length === 0) continue;

                    const oCandsA = candA.origCandidates.length > 0 ? candA.origCandidates : [candA.origInfo];
                    const dCandsB = candB.destCandidates.length > 0 ? candB.destCandidates : [candB.destInfo];
                    let bestPairOption = null;

                    for (const transfer of candidateTransfers) {
                        const transferPtA = { lat: transfer.latA, lng: transfer.lngA, segIdx: transfer.segA, t: transfer.tA };
                        const transferPtB = { lat: transfer.latB, lng: transfer.lngB, segIdx: transfer.segB, t: transfer.tB };

                        let bestOrigA = candA.origInfo;
                        let bestSegA = null;
                        let bestDistA = Infinity;
                        let bestCostA = Infinity;
                        for (const oc of oCandsA) {
                            const loopA = getForwardLoopMetrics(candA.route.coordinatesList, oc, transferPtA);
                            const rideA = isFinite(loopA.forwardDist) ? loopA.forwardDist * 0.28 : 999999;
                            const costA = oc.dist * 2.2 + rideA;
                            if (costA < bestCostA) {
                                bestCostA = costA;
                                bestOrigA = oc;
                                bestSegA = loopA.segmentCoords;
                                bestDistA = loopA.forwardDist;
                            }
                        }

                        let bestDestB = candB.destInfo;
                        let bestSegB = null;
                        let bestDistB = Infinity;
                        let bestCostB = Infinity;
                        for (const dc of dCandsB) {
                            const loopB = getForwardLoopMetrics(candB.route.coordinatesList, transferPtB, dc);
                            const rideB = isFinite(loopB.forwardDist) ? loopB.forwardDist * 0.28 : 999999;
                            const costB = dc.dist * 2.2 + rideB;
                            if (costB < bestCostB) {
                                bestCostB = costB;
                                bestDestB = dc;
                                bestSegB = loopB.segmentCoords;
                                bestDistB = loopB.forwardDist;
                            }
                        }

                        if (!isFinite(bestDistA) || !isFinite(bestDistB)) continue;

                        const totalBusDist = bestDistA + bestDistB;
                        const totalWalk = bestOrigA.dist + transfer.walkDist + bestDestB.dist;
                        const candidateScore = bestOrigA.dist + transfer.walkDist * 1.5 + bestDestB.dist + totalBusDist * 0.08 + TRANSFER_PENALTY;

                        if (!bestPairOption || candidateScore < bestPairOption.score) {
                            bestPairOption = {
                                transfer,
                                transferPtB,
                                bestOrigA,
                                bestDestB,
                                bestSegA,
                                bestSegB,
                                totalBusDist,
                                totalWalk,
                                score: candidateScore
                            };
                        }
                    }

                    if (!bestPairOption) continue;

                    // Si ya hay ruta directa, descartar transbordos que no ahorran caminata real o dan un rodeo exagerado
                    if (bestDirect) {
                        const walkSaved = bestDirectWalk - bestPairOption.totalWalk;
                        if (walkSaved < 350) continue;
                        if (isFinite(bestDirectBusDist) && bestPairOption.totalBusDist > bestDirectBusDist * 1.65 + 4000) continue;
                    }

                    const { transfer, transferPtB, bestOrigA, bestDestB, bestSegA, bestSegB, totalBusDist, totalWalk, score } = bestPairOption;
                    const transferLabel =
                        findNearestStopLabel(candA.route, transfer.midLat, transfer.midLng) ||
                        findNearestStopLabel(candB.route, transfer.midLat, transfer.midLng);

                    const dirInfoA = getBoardingDirectionInfo(candA.route, bestOrigA, selectedOrigin.lat, selectedOrigin.lng, oCandsA);
                    const dirInfoB = getBoardingDirectionInfo(candB.route, transferPtB, transfer.latA, transfer.lngA, []);
                    const combinedLegCoords = [...(bestSegA || []), ...(bestSegB || [])];
                    const trafficInfo = computeRouteTrafficMetrics(combinedLegCoords, totalBusDist);
                    const estimatedMin = estimateTripMinutes(totalWalk, totalBusDist > 0 ? totalBusDist : Infinity, 1, trafficInfo);

                    transferOptions.push({
                        type: 'transfer',
                        routeA: candA.route,
                        routeB: candB.route,
                        origInfo: bestOrigA,
                        destInfo: bestDestB,
                        travelCoordsA: bestSegA,
                        travelCoordsB: bestSegB,
                        onBusDist: totalBusDist,
                        estimatedMin,
                        trafficInfo,
                        dirInfo: dirInfoA,
                        dirInfoB,
                        transfer,
                        boardLabel: findNearestStopLabel(candA.route, bestOrigA.lat, bestOrigA.lng),
                        transferLabel,
                        alightLabel: findNearestStopLabel(candB.route, bestDestB.lat, bestDestB.lng),
                        normalPrice: getRouteNormalPrice(candA.route) + getRouteNormalPrice(candB.route),
                        studentPrice: getRouteStudentPrice(candA.route) + getRouteStudentPrice(candB.route),
                        totalPrice: getActiveRoutePrice(candA.route) + getActiveRoutePrice(candB.route),
                        score
                    });
                }
            }
            transferOptions.sort((a, b) => a.score - b.score);
        }

        const combined = [...directOptions.slice(0, 3), ...transferOptions.slice(0, 2)]
            .sort((a, b) => a.score - b.score)
            .slice(0, 4);

        window._tripComputedOptions = combined;

        let html = '';
        html += formatTripTrafficSummaryHtml();
        if (directWalkDist <= 350) {
            html += `
                <div class="location-status-banner" style="margin-bottom: 4px;">
                    <div>Tu destino está a <strong>${Math.round(directWalkDist)} m</strong> (~${Math.max(1, Math.round(directWalkDist / 80))} min caminando). Puedes llegar a pie sin tomar camión.</div>
                </div>
            `;
        }

        if (combined.length === 0) {
            const bestOrig = [...routeMetrics].sort((a, b) => a.origInfo.dist - b.origInfo.dist)[0];
            const bestDest = [...routeMetrics].sort((a, b) => a.destInfo.dist - b.destInfo.dist)[0];
            const origHint = bestOrig ? `Cerca del origen: <strong>${escapeUserHtml(bestOrig.route.name)}</strong> (${formatDistanceInfo(bestOrig.origInfo.dist)}).` : '';
            const destHint = bestDest ? `Cerca del destino: <strong>${escapeUserHtml(bestDest.route.name)}</strong> (${formatDistanceInfo(bestDest.destInfo.dist)}).` : '';

            html += `
                <div class="location-status-banner warning" style="flex-direction:column; gap:6px;">
                    <div style="font-weight:700;">Sin ruta directa ni conexión con 1 transbordo</div>
                    <div style="font-size:0.78rem; line-height:1.45;">
                        Uno o ambos puntos quedan a más de 1.1 km de los recorridos registrados.<br>
                        ${origHint}<br>${destHint}
                    </div>
                </div>
            `;
            container.innerHTML = html;
            return;
        }

        html += `<div style="font-size:0.8rem; font-weight:700; color:var(--text-secondary); margin:2px 0 4px 0;">Opciones encontradas (${combined.length}):</div>`;

        combined.forEach((opt, idx) => {
            const isBest = idx === 0;
            const timeLabel = opt.estimatedMin ? `~${opt.estimatedMin} min` : '';
            const kmText = (opt.onBusDist && isFinite(opt.onBusDist)) ? `${(opt.onBusDist / 1000).toFixed(1)} km en camión` : '';
            const trafficBadgeHtml = formatOptionTrafficBadgeHtml(opt.trafficInfo);
            const tripFareHtml = fareMode === 'student'
                ? `<div class="route-fare-group"><span class="route-fare student-active">$${opt.studentPrice.toFixed(2)}</span><span style="font-size:0.65rem;color:var(--text-muted);">Normal $${opt.normalPrice.toFixed(2)}</span></div>`
                : `<div class="route-fare-group"><span class="route-fare">$${opt.normalPrice.toFixed(2)}</span><span class="route-fare-student">Est. $${opt.studentPrice.toFixed(2)}</span></div>`;

            if (opt.type === 'direct') {
                const r = opt.routeA;
                const badgeText = isBest ? 'Mejor opción · Directa' : 'Directa';
                const boardPlace = opt.boardLabel ? `Cerca de ${escapeUserHtml(opt.boardLabel)}` : 'Punto más cercano del trazo';
                const alightPlace = opt.alightLabel ? `Cerca de ${escapeUserHtml(opt.alightLabel)}` : 'Punto más cercano del trazo';

                html += `
                    <div class="route-card trip-card" style="border-left: 4px solid ${r.color}; flex-direction: column; gap: 0;" onclick="toggleTripCard(this, ${idx})">
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 8px;">
                            <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                                <div style="background: ${r.color}; width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0;"></div>
                                <div>
                                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                        <span style="background: ${r.color}15; color: ${r.color}; font-weight: 700; font-size: 0.68rem; padding: 2px 7px; border-radius: 9999px; text-transform: uppercase;">${badgeText}</span>
                                        ${timeLabel ? `<span style="font-size: 0.72rem; font-weight: 700; color: var(--text-secondary);">${timeLabel}${kmText ? ` · ${kmText}` : ''}</span>` : ''}
                                        ${trafficBadgeHtml}
                                    </div>
                                    <h4 style="margin: 4px 0 0 0; font-size: 0.98rem; font-weight: 700; color: var(--text-primary);">${escapeUserHtml(r.name)}</h4>
                                </div>
                            </div>
                            ${tripFareHtml}
                        </div>

                        <div class="trip-card-details" style="display: none; margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px; width: 100%;">
                            <p style="margin: 0 0 10px 0; font-size: 0.78rem; color: var(--text-secondary); line-height: 1.4;">
                                ${escapeUserHtml(r.description || 'Autobús urbano en Mazatlán')} · Cada ${r.frequencyMinutes || 10} min aprox.
                            </p>
                            <div style="background: var(--bg-surface); border-radius: var(--radius-sm); padding: 10px 12px; font-size: 0.8rem; border: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px;">
                                <div style="display: flex; align-items: flex-start; gap: 8px;">
                                    <span class="planner-dot origin" style="margin-top: 5px;"></span>
                                    <div>
                                        <div><strong style="color: var(--success);">Sube:</strong> ${boardPlace}</div>
                                        <div style="color: var(--text-muted); font-size: 0.74rem;">A ${formatDistanceInfo(opt.origInfo.dist)} desde origen</div>
                                        ${formatBoardingGuidanceHtml(opt.dirInfo)}
                                    </div>
                                </div>
                                <div style="display: flex; align-items: flex-start; gap: 8px;">
                                    <span class="planner-dot destination" style="margin-top: 5px;"></span>
                                    <div>
                                        <div><strong style="color: var(--danger);">Baja:</strong> ${alightPlace}</div>
                                        <div style="color: var(--text-muted); font-size: 0.74rem;">A ${formatDistanceInfo(opt.destInfo.dist)} del destino</div>
                                    </div>
                                </div>
                            </div>
                            <div class="trip-action-row">
                                <button type="button" class="btn-onboard-start" style="margin-top:0;flex:1;" onclick="event.stopPropagation(); startOnboardTrip(${idx})">
                                    <img src="assets/icons/ui_camion.svg" alt="" style="width:15px;height:15px;filter:brightness(0) invert(1);"> Voy a bordo
                                </button>
                                <button type="button" class="btn-trip-share" onclick="event.stopPropagation(); shareTripOption(${idx})" title="Compartir cómo llegar por WhatsApp">
                                    Compartir
                                </button>
                            </div>
                            ${formatTripSavingsHtml(opt)}
                        </div>
                    </div>
                `;
            } else {
                const rA = opt.routeA;
                const rB = opt.routeB;
                const badgeText = isBest ? 'Mejor opción · 1 transbordo' : '1 transbordo';
                const boardPlace = opt.boardLabel ? `Cerca de ${escapeUserHtml(opt.boardLabel)}` : 'Punto más cercano';
                const transferPlace = opt.transferLabel ? `Cerca de ${escapeUserHtml(opt.transferLabel)}` : 'Cruce de ambas rutas';
                const transferWalk = opt.transfer.walkDist <= 25 ? 'en el mismo cruce' : `caminando ${Math.round(opt.transfer.walkDist)} m`;
                const alightPlace = opt.alightLabel ? `Cerca de ${escapeUserHtml(opt.alightLabel)}` : 'Punto más cercano';

                html += `
                    <div class="route-card trip-card" style="border-left: 4px solid var(--primary); flex-direction: column; gap: 0;" onclick="toggleTripCard(this, ${idx})">
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 8px;">
                            <div style="min-width: 0;">
                                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                    <span style="background: var(--primary-light); color: var(--primary); font-weight: 700; font-size: 0.68rem; padding: 2px 7px; border-radius: 9999px; text-transform: uppercase;">${badgeText}</span>
                                    ${timeLabel ? `<span style="font-size: 0.72rem; font-weight: 700; color: var(--text-secondary);">${timeLabel}${kmText ? ` · ${kmText}` : ''}</span>` : ''}
                                    ${trafficBadgeHtml}
                                </div>
                                <h4 style="margin: 4px 0 0 0; font-size: 0.92rem; font-weight: 700; color: var(--text-primary); line-height: 1.3;">
                                    <span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:${rA.color}; margin-right:4px;"></span>${escapeUserHtml(rA.name)}
                                    <span style="color:var(--text-muted); font-weight:500;"> → </span>
                                    <span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:${rB.color}; margin-right:4px;"></span>${escapeUserHtml(rB.name)}
                                </h4>
                            </div>
                            ${tripFareHtml}
                        </div>

                        <div class="trip-card-details" style="display: none; margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px; width: 100%;">
                            <div style="background: var(--bg-surface); border-radius: var(--radius-sm); padding: 10px 12px; font-size: 0.8rem; border: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px;">
                                <div style="display: flex; align-items: flex-start; gap: 8px;">
                                    <span class="planner-dot origin" style="margin-top: 5px;"></span>
                                    <div>
                                        <div><strong>1. Toma ${escapeUserHtml(rA.name)}</strong> (${boardPlace})</div>
                                        <div style="color: var(--text-muted); font-size: 0.74rem;">A ${formatDistanceInfo(opt.origInfo.dist)} desde origen</div>
                                        ${formatBoardingGuidanceHtml(opt.dirInfo)}
                                    </div>
                                </div>
                                <div style="display: flex; align-items: flex-start; gap: 8px;">
                                    <span style="width:8px; height:8px; border-radius:50%; background:var(--warning); flex-shrink:0; margin-top:5px;"></span>
                                    <div>
                                        <div><strong style="color: #B45309;">2. Transborda a ${escapeUserHtml(rB.name)}</strong> (${transferPlace})</div>
                                        <div style="color: var(--text-muted); font-size: 0.74rem;">Cambio ${transferWalk}</div>
                                        ${formatBoardingGuidanceHtml(opt.dirInfoB)}
                                    </div>
                                </div>
                                <div style="display: flex; align-items: flex-start; gap: 8px;">
                                    <span class="planner-dot destination" style="margin-top: 5px;"></span>
                                    <div>
                                        <div><strong style="color: var(--danger);">3. Baja en:</strong> ${alightPlace}</div>
                                        <div style="color: var(--text-muted); font-size: 0.74rem;">A ${formatDistanceInfo(opt.destInfo.dist)} del destino</div>
                                    </div>
                                </div>
                            </div>
                            <div class="trip-action-row">
                                <button type="button" class="btn-onboard-start" style="margin-top:0;flex:1;" onclick="event.stopPropagation(); startOnboardTrip(${idx})">
                                    <img src="assets/icons/ui_camion.svg" alt="" style="width:15px;height:15px;filter:brightness(0) invert(1);"> Voy a bordo
                                </button>
                                <button type="button" class="btn-trip-share" onclick="event.stopPropagation(); shareTripOption(${idx})" title="Compartir cómo llegar por WhatsApp">
                                    Compartir
                                </button>
                            </div>
                            ${formatTripSavingsHtml(opt)}
                        </div>
                    </div>
                `;
            }
        });
        
        container.innerHTML = html;
    }, 150);
}

function toggleTripCard(cardEl, optionIdx) {
    const details = cardEl.querySelector('.trip-card-details');
    const isExpanded = details && details.style.display === 'block';
    
    document.querySelectorAll('.trip-card').forEach(c => {
        const d = c.querySelector('.trip-card-details');
        if (d) d.style.display = 'none';
        c.classList.remove('active');
    });
    
    if (!isExpanded && details) {
        details.style.display = 'block';
        cardEl.classList.add('active');
        const opt = window._tripComputedOptions[optionIdx];
        if (opt) viewTripOptionOnMap(opt);
        setTimeout(() => cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    } else {
        clearMapDrawings();
    }
}

function addTripWalkLine(lat1, lng1, lat2, lng2) {
    if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return;
    if (calculateDistanceMeters(lat1, lng1, lat2, lng2) < 15) return;
    const walkLine = L.polyline([[lat1, lng1], [lat2, lng2]], {
        color: '#475569',
        weight: 3,
        dashArray: '6, 8',
        opacity: 0.85
    }).addTo(mapInstance);
    activePolylines.push(walkLine);
}

function addTripPin(lat, lng, bgColor, label, shortLetter = '') {
    const marker = L.marker([lat, lng], {
        zIndexOffset: 1150,
        icon: createTeardropPinIcon(bgColor, shortLetter)
    }).addTo(mapInstance)
      .bindPopup(`<div style="font-family:inherit;font-size:0.82rem;font-weight:600;">${escapeUserHtml(label)}</div>`)
      .bindTooltip(escapeUserHtml(label), {
          direction: 'top',
          className: 'rutero-map-label',
          offset: [0, -2]
      });
    activeMarkers.push(marker);
    return marker;
}

function addTripBoardMarker(lat, lng, dirInfo, routeName) {
    const isCross = dirInfo.crossAction === 'cross';
    const bg = isCross ? '#D97706' : '#1D3557';
    const angle = typeof dirInfo.angleDeg === 'number' ? dirInfo.angleDeg : 0;
    const crossTag = isCross
        ? `<span style="margin-left:5px;background:#FFFBEB;color:#B45309;border:1px solid #F59E0B;border-radius:5px;padding:1px 6px;font-size:0.68rem;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(15,23,42,0.18);">Cruza</span>`
        : '';

    const marker = L.marker([lat, lng], {
        zIndexOffset: 1120,
        icon: L.divIcon({
            className: 'custom-board-node',
            html: `<div style="display:inline-flex;align-items:center;">
                     <div style="width:24px;height:24px;border-radius:50%;background:${bg};border:2.5px solid #ffffff;box-shadow:0 2px 8px rgba(15,23,42,0.35);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                       <svg viewBox="0 0 24 24" width="13" height="13" style="transform:rotate(${angle}deg);fill:#ffffff;">
                         <path d="M12 2L19 20L12 16L5 20Z"/>
                       </svg>
                     </div>
                     ${crossTag}
                   </div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        })
    }).addTo(mapInstance)
      .bindPopup(`<div style="font-family:inherit;font-size:0.82rem;"><b>${escapeUserHtml(isCross ? 'Cruza al otro lado de la calle' : 'Punto de subida')}</b><br>${escapeUserHtml(routeName)} · Sentido ${escapeUserHtml(dirInfo.compass)}${dirInfo.nextStop ? `<br>Rumbo a ${escapeUserHtml(dirInfo.nextStop)}` : ''}</div>`)
      .bindTooltip(`${isCross ? 'Cruza · ' : 'Sube · '}Sentido ${escapeUserHtml(dirInfo.compass)}`, {
          direction: 'top',
          className: 'rutero-map-label',
          offset: [0, -10]
      });
    activeMarkers.push(marker);
    return marker;
}

function addTripTransferMarker(lat, lng, titleText) {
    const marker = L.marker([lat, lng], {
        zIndexOffset: 1140,
        icon: L.divIcon({
            className: 'custom-transfer-node',
            html: `<div style="width:26px;height:26px;border-radius:7px;background:#D97706;border:2.5px solid #ffffff;box-shadow:0 2px 8px rgba(15,23,42,0.32);display:flex;align-items:center;justify-content:center;">
                     <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                       <polyline points="17 1 21 5 17 9"></polyline>
                       <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                       <polyline points="7 23 3 19 7 15"></polyline>
                       <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
                     </svg>
                   </div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        })
    }).addTo(mapInstance)
      .bindPopup(`<div style="font-family:inherit;font-size:0.82rem;font-weight:600;">${escapeUserHtml(titleText)}</div>`)
      .bindTooltip(escapeUserHtml(titleText), {
          direction: 'top',
          className: 'rutero-map-label',
          offset: [0, -12]
      });
    activeMarkers.push(marker);
    return marker;
}

function collectStopsForTripOption(opt) {
    const tripStops = [];
    const seenIds = new Set();
    const appendLegStops = (route, rawCoords) => {
        if (!route || !Array.isArray(route.stopsList) || route.stopsList.length === 0) return;
        const coords = (Array.isArray(rawCoords) && rawCoords.length >= 2)
            ? rawCoords.map(normalizeLatLngPoint).filter(Boolean)
            : (Array.isArray(route.coordinatesList) ? route.coordinatesList.map(normalizeLatLngPoint).filter(Boolean) : []);
        if (coords.length === 0) {
            route.stopsList.forEach(rs => {
                const st = rs && rs.stop;
                if (st && st.id != null && !seenIds.has(st.id)) {
                    seenIds.add(st.id);
                    tripStops.push({ stop: st, stopOrder: rs.stopOrder, color: route.color });
                }
            });
            return;
        }
        const matched = [];
        route.stopsList.forEach(rs => {
            const st = rs && rs.stop;
            if (!st || st.latitude == null || st.longitude == null || seenIds.has(st.id)) return;
            let bestDist = Infinity;
            let bestIdx = 0;
            for (let i = 0; i < coords.length; i++) {
                const d = calculateDistanceMeters(st.latitude, st.longitude, coords[i][0], coords[i][1]);
                if (d < bestDist) {
                    bestDist = d;
                    bestIdx = i;
                }
            }
            if (bestDist <= 300) {
                seenIds.add(st.id);
                matched.push({ bestIdx, entry: { stop: st, stopOrder: rs.stopOrder, color: route.color } });
            }
        });
        matched.sort((a, b) => a.bestIdx - b.bestIdx);
        matched.forEach(m => tripStops.push(m.entry));
    };

    if (opt.type === 'transfer') {
        appendLegStops(opt.routeA, opt.travelCoordsA);
        appendLegStops(opt.routeB, opt.travelCoordsB);
    } else {
        appendLegStops(opt.routeA, opt.travelCoords);
    }
    return tripStops;
}

function viewTripOptionOnMap(opt) {
    if (!opt || !mapInstance) return;
    clearMapDrawings();
    if (typeof setPhysicalStopsVisible === 'function') setPhysicalStopsVisible(false);

    if (window._tempColoniaMarker) { mapInstance.removeLayer(window._tempColoniaMarker); window._tempColoniaMarker = null; }
    if (window._tripOrigMarker) { mapInstance.removeLayer(window._tripOrigMarker); window._tripOrigMarker = null; }
    if (window._tripDestMarker) { mapInstance.removeLayer(window._tripDestMarker); window._tripDestMarker = null; }

    // Dibujar recorrido completo tenue y resaltar con flechas únicamente el tramo real en el sentido correcto
    if (opt.routeA && opt.routeA.coordinatesList) {
        if (opt.type === 'direct' && opt.travelCoords && opt.travelCoords.length >= 2) {
            drawRouteLine(opt.routeA.coordinatesList, opt.routeA.color, { weight: 3.5, opacity: 0.24, showArrows: false, fitBounds: false });
            drawRouteLine(opt.travelCoords, opt.routeA.color, { weight: 6, opacity: 0.96, showArrows: true, fitBounds: false });
        } else if (opt.type === 'transfer' && opt.travelCoordsA && opt.travelCoordsA.length >= 2) {
            drawRouteLine(opt.routeA.coordinatesList, opt.routeA.color, { weight: 3.5, opacity: 0.22, showArrows: false, fitBounds: false });
            drawRouteLine(opt.travelCoordsA, opt.routeA.color, { weight: 6, opacity: 0.96, showArrows: true, fitBounds: false });
        } else {
            drawRouteLine(opt.routeA.coordinatesList, opt.routeA.color, { fitBounds: false });
        }
    }
    if (opt.type === 'transfer' && opt.routeB && opt.routeB.coordinatesList) {
        if (opt.travelCoordsB && opt.travelCoordsB.length >= 2) {
            drawRouteLine(opt.routeB.coordinatesList, opt.routeB.color, { weight: 3.5, opacity: 0.22, showArrows: false, fitBounds: false });
            drawRouteLine(opt.travelCoordsB, opt.routeB.color, { weight: 6, opacity: 0.96, showArrows: true, fitBounds: false });
        } else {
            drawRouteLine(opt.routeB.coordinatesList, opt.routeB.color, { fitBounds: false });
        }
    }

    // Mostrar específicamente las paradas de la(s) ruta(s) del viaje planeado / Voy a bordo
    const tripStops = collectStopsForTripOption(opt);
    if (typeof drawRouteStops === 'function' && tripStops.length > 0) {
        drawRouteStops(tripStops, opt.routeA ? opt.routeA.color : '#6366f1', { markEndpoints: false, minIconZoom: 14 });
    }

    // Líneas punteadas de caminata al punto de subida, transbordo y bajada
    addTripWalkLine(selectedOrigin.lat, selectedOrigin.lng, opt.origInfo.lat, opt.origInfo.lng);
    addTripWalkLine(opt.destInfo.lat, opt.destInfo.lng, selectedDestination.lat, selectedDestination.lng);

    addTripPin(selectedOrigin.lat, selectedOrigin.lng, '#059669', `Origen: ${selectedOrigin.name}`, 'A');

    if (opt.dirInfo && calculateDistanceMeters(selectedOrigin.lat, selectedOrigin.lng, opt.origInfo.lat, opt.origInfo.lng) >= 8) {
        addTripBoardMarker(opt.origInfo.lat, opt.origInfo.lng, opt.dirInfo, opt.routeA.name);
    }

    if (opt.type === 'transfer' && opt.transfer) {
        addTripWalkLine(opt.transfer.latA, opt.transfer.lngA, opt.transfer.latB, opt.transfer.lngB);
        addTripTransferMarker(opt.transfer.midLat, opt.transfer.midLng, `Transbordo a ${opt.transferLabel || opt.routeB.name}`);
    }
    addTripPin(selectedDestination.lat, selectedDestination.lng, '#E63E21', `Destino: ${selectedDestination.name}`, 'B');

    const points = [
        [selectedOrigin.lat, selectedOrigin.lng],
        [opt.origInfo.lat, opt.origInfo.lng],
        [opt.destInfo.lat, opt.destInfo.lng],
        [selectedDestination.lat, selectedDestination.lng]
    ];
    if (opt.type === 'transfer' && opt.transfer) {
        points.push([opt.transfer.midLat, opt.transfer.midLng]);
    }
    if (isMobileViewport()) setMobileSheetState('half');
    const tripFitOpts = typeof getResponsiveFitBoundsOptions === 'function'
        ? getResponsiveFitBoundsOptions(70, { maxZoom: 15 })
        : { padding: [70, 70], maxZoom: 15 };
    mapInstance.fitBounds(L.latLngBounds(points), tripFitOpts);

    const toastText = opt.type === 'transfer'
        ? `Viaje con transbordo: ${opt.routeA.name} → ${opt.routeB.name}`
        : `Viaje directo en ${opt.routeA.name}`;
    showToast(toastText);
}

// ----------------------------------------------------------
// GEOLOCALIZACIÓN
// ----------------------------------------------------------

function setUserLocationMarker(lat, lng, label = 'Tu ubicación') {
    if (!mapInstance) return;
    if (window._userLocationMarker) {
        mapInstance.removeLayer(window._userLocationMarker);
    }
    const userIcon = L.divIcon({
        className: 'user-location-marker',
        html: `<div style="width:18px;height:18px;border-radius:50%;background:#005C97;border:3px solid white;box-shadow:0 0 12px rgba(0,92,151,0.5);"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
    });
    window._userLocationMarker = L.marker([lat, lng], { icon: userIcon })
        .addTo(mapInstance)
        .bindPopup(`<b style="font-family:Inter,sans-serif;">${escapeUserHtml(label)}</b>`);
}

function getPositionOnce(options) {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
}

async function getReliableCurrentPosition() {
    if (!navigator.geolocation) {
        throw { code: 'UNSUPPORTED' };
    }
    if (window.isSecureContext === false) {
        throw { code: 'INSECURE_CONTEXT' };
    }

    let permState = 'prompt';
    try {
        if (navigator.permissions && navigator.permissions.query) {
            const status = await navigator.permissions.query({ name: 'geolocation' });
            permState = status.state;
        }
    } catch (e) {}

    const attemptLookup = async () => {
        try {
            return await getPositionOnce({ enableHighAccuracy: false, timeout: 6000, maximumAge: 180000 });
        } catch (err) {
            // Reintentar con alta precisión si falló por timeout/señal (no si el SO/navegador bloqueó)
            if (err && err.code === 1) throw err;
            return await getPositionOnce({ enableHighAccuracy: true, timeout: 5500, maximumAge: 30000 });
        }
    };

    // Si el permiso ya está concedido, proteger contra navegadores de escritorio que cuelgan el callback
    if (permState === 'granted') {
        let timerId;
        const guard = new Promise((_, reject) => {
            timerId = setTimeout(() => reject({ code: 3 }), 11000);
        });
        try {
            return await Promise.race([attemptLookup(), guard]);
        } finally {
            clearTimeout(timerId);
        }
    }

    return await attemptLookup();
}

function getGeolocationErrorMessage(err) {
    if (!err || err.code === 'UNSUPPORTED') {
        return 'Tu navegador no soporta geolocalización GPS.';
    }
    if (err.code === 'INSECURE_CONTEXT' || window.isSecureContext === false) {
        return 'En celular por HTTP sin candado el navegador bloquea el GPS (requiere HTTPS o localhost).';
    }
    if (err.code === 1) {
        const msg = String(err.message || '').toLowerCase();
        if (msg.includes('secure')) {
            return 'El navegador exige HTTPS o localhost para usar el GPS.';
        }
        return 'Windows o el navegador bloqueó la ubicación (revisa Privacidad -> Ubicación).';
    }
    if (err.code === 2) {
        return 'Tu navegador/Windows no devolvió coordenadas GPS.';
    }
    if (err.code === 3) {
        return 'Tiempo de espera agotado buscando GPS.';
    }
    return 'No se pudo obtener tu ubicación GPS.';
}

async function geolocateUser() {
    if (!navigator.geolocation) {
        showToast('Tu navegador no soporta geolocalización', 'error');
        return;
    }
    showToast('Obteniendo tu ubicación...');
    try {
        const pos = await getReliableCurrentPosition();
        const { latitude, longitude } = pos.coords;
        const distFromMazatlan = calculateDistanceMeters(latitude, longitude, 23.2329, -106.4062);

        if (distFromMazatlan > 60000) {
            if (mapInstance && typeof MAP_CENTER !== 'undefined') {
                mapInstance.setView(MAP_CENTER, typeof DEFAULT_ZOOM !== 'undefined' ? DEFAULT_ZOOM : 13);
            }
            showToast('Tu navegador/Windows ubicó fuera de Mazatlán. Revisa "Ubicación predeterminada" o usa el buscador.', 'error');
            return;
        }

        if (mapInstance) {
            mapInstance.setView([latitude, longitude], 16);
            setUserLocationMarker(latitude, longitude, 'Tu ubicación');
        }
        showToast('Ubicación encontrada');
    } catch (err) {
        showToast(getGeolocationErrorMessage(err), 'error');
    }
}

// ----------------------------------------------------------
// EVENT LISTENERS
// ----------------------------------------------------------

let _googleGsiInitializedClientId = null;

async function handleGoogleCredentialResponse(response) {
    if (!response || !response.credential) return;
    const ok = await Auth.loginWithGoogle(response.credential);
    if (ok) {
        const loginModal = document.getElementById('login-modal');
        const registerModal = document.getElementById('register-modal');
        const loginErr = document.getElementById('login-error-banner');
        const regErr = document.getElementById('register-error-banner');
        if (loginErr) loginErr.style.display = 'none';
        if (regErr) regErr.style.display = 'none';
        if (loginModal) loginModal.style.display = 'none';
        if (registerModal) registerModal.style.display = 'none';
    }
}

function renderGoogleSignInButtons(clientId, retry = 0) {
    if (!clientId) return;
    const gId = window.google && window.google.accounts && window.google.accounts.id;
    if (!gId) {
        if (retry < 15) {
            setTimeout(() => renderGoogleSignInButtons(clientId, retry + 1), 300);
        }
        return;
    }
    if (_googleGsiInitializedClientId !== clientId) {
        gId.initialize({
            client_id: clientId,
            callback: handleGoogleCredentialResponse,
            auto_select: false
        });
        _googleGsiInitializedClientId = clientId;
    }
    ['google-signin-btn-login', 'google-signin-btn-register'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el || el.dataset.renderedClientId === clientId) return;
        el.innerHTML = '';
        gId.renderButton(el, {
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'pill',
            locale: 'es_419',
            width: 310
        });
        el.dataset.renderedClientId = clientId;
    });
}

async function initGoogleAuthIntegration({ forceConfig = false } = {}) {
    try {
        if (forceConfig || !window._authConfigCache) {
            window._authConfigCache = await Api.getAuthConfig();
        }
        const cfg = window._authConfigCache || {};
        const hasGoogle = Boolean(cfg.googleEnabled && cfg.googleClientId);
        const forceClassicPwd = new URLSearchParams(window.location.search).get('passwordLogin') === '1';
        const googleOnlyMode = hasGoogle && !forceClassicPwd;

        const loginSec = document.getElementById('google-login-section');
        const loginDivider = loginSec ? loginSec.querySelector('.auth-divider') : null;
        const loginFormEl = document.getElementById('login-form');
        const loginFooter = document.querySelector('#login-modal .form-footer');
        const loginSubtitle = document.querySelector('#login-modal .auth-subtitle');

        const regSec = document.getElementById('google-register-section');
        const regDivider = document.getElementById('google-register-divider');
        const regForm = document.getElementById('register-form');
        const regGoogleOnlyNote = document.getElementById('register-google-only-note');

        if (loginSec) loginSec.style.display = hasGoogle ? 'flex' : 'none';
        if (loginDivider) loginDivider.style.display = googleOnlyMode ? 'none' : 'flex';
        if (loginFormEl) loginFormEl.style.display = googleOnlyMode ? 'none' : 'flex';
        if (loginFooter) loginFooter.style.display = googleOnlyMode ? 'none' : 'block';
        if (loginSubtitle) {
            loginSubtitle.textContent = googleOnlyMode
                ? 'Accede rápido y seguro con tu cuenta de Google'
                : 'Bienvenido de nuevo a Don Rutero';
        }

        if (regSec) regSec.style.display = hasGoogle ? 'flex' : 'none';
        if (regDivider) regDivider.style.display = googleOnlyMode ? 'none' : 'flex';
        if (regForm) regForm.style.display = googleOnlyMode ? 'none' : 'flex';
        if (regGoogleOnlyNote) regGoogleOnlyNote.style.display = googleOnlyMode ? 'block' : 'none';

        if (hasGoogle) {
            renderGoogleSignInButtons(cfg.googleClientId);
        }
    } catch (_) {}
}

function setupEventListeners() {
    // Sidebar toggle -> Abre el Menú Principal Drawer
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => toggleMainMenu(true));
    }

    const closeMenuBtn = document.getElementById('close-menu-btn');
    if (closeMenuBtn) closeMenuBtn.addEventListener('click', () => toggleMainMenu(false));

    const menuBackdrop = document.getElementById('menu-backdrop');
    if (menuBackdrop) menuBackdrop.addEventListener('click', () => toggleMainMenu(false));

    const menuAuthCard = document.getElementById('menu-auth-card');
    if (menuAuthCard) {
        menuAuthCard.addEventListener('click', () => {
            toggleMainMenu(false);
            if (Auth.user) {
                if (confirm('¿Deseas cerrar sesión?')) Auth.logout();
            } else {
                const lModal = document.getElementById('login-modal');
                if (lModal) lModal.style.display = 'flex';
            }
        });
    }

    const infoClose = document.getElementById('info-close');
    const infoBtn = document.getElementById('info-modal-btn');
    const infoModal = document.getElementById('info-modal');
    if (infoClose && infoModal) infoClose.addEventListener('click', () => { infoModal.style.display = 'none'; });
    if (infoBtn && infoModal) infoBtn.addEventListener('click', () => { infoModal.style.display = 'none'; });

    document.querySelectorAll('[data-legal-modal]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            showMenuModal(el.getAttribute('data-legal-modal'));
        });
    });

    const btnNotificaciones = document.getElementById('btn-notificaciones');
    const notificationsModal = document.getElementById('notifications-modal');
    const notificationsClose = document.getElementById('notifications-close');
    const notificationsReportBtn = document.getElementById('notifications-report-btn');
    
    if (btnNotificaciones && notificationsModal) {
        btnNotificaciones.addEventListener('click', () => {
            notificationsModal.style.display = 'flex';
            loadLivePulse();
        });
        notificationsModal.addEventListener('click', (e) => {
            if (e.target === notificationsModal) notificationsModal.style.display = 'none';
        });
    }
    if (notificationsClose && notificationsModal) {
        notificationsClose.addEventListener('click', () => notificationsModal.style.display = 'none');
    }

    const reportClose = document.getElementById('report-close');
    const reportModal = document.getElementById('report-modal');
    const reportForm = document.getElementById('report-form');
    if (notificationsReportBtn && notificationsModal && reportModal) {
        notificationsReportBtn.addEventListener('click', () => {
            notificationsModal.style.display = 'none';
            reportModal.style.display = 'flex';
        });
    }
    if (reportClose && reportModal) reportClose.addEventListener('click', () => { reportModal.style.display = 'none'; });
    if (reportForm) {
        reportForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const typeEl = document.getElementById('report-type');
            const routeEl = document.getElementById('report-route');
            const descEl = document.getElementById('report-desc');
            const submitBtn = reportForm.querySelector('button[type="submit"]');

            const type = typeEl ? typeEl.value : 'general';
            const route = routeEl ? routeEl.value.trim() : '';
            const description = descEl ? descEl.value.trim() : '';

            if (route.length < 2) {
                showToast('Indica la ruta, colonia o lugar del reporte.', 'error');
                return;
            }
            if (description.length < 5) {
                showToast('Describe un poco más el detalle (mínimo 5 caracteres).', 'error');
                return;
            }

            const prevLabel = submitBtn ? submitBtn.textContent : '';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Enviando...';
            }

            try {
                await Api.submitReport({ type, route, description });
                if (reportModal) reportModal.style.display = 'none';
                reportForm.reset();
                showToast('¡Reporte guardado! Lo revisaremos en el panel de administración.');
            } catch (err) {
                showToast(err.message || 'Error al enviar el reporte', 'error');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = prevLabel || 'Enviar reporte';
                }
            }
        });
    }

    // Inicializar listeners del Planificador Inteligente ("¿Cómo Llego?")
    if (typeof setupTripPlannerListeners === 'function') setupTripPlannerListeners();

    // Search & Autocomplete
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('btn-clear-search');
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => clearSearchedLocation());
    }
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            window.currentSearchLocation = null;
            if (!e.target.value.trim() && window._tempColoniaMarker && mapInstance) {
                mapInstance.removeLayer(window._tempColoniaMarker);
                window._tempColoniaMarker = null;
            }
            updateClearSearchBtn();
            filterRoutes(e.target.value);
        });
        searchInput.addEventListener('focus', () => {
            if (isMobileViewport()) setMobileSheetState('full');
            if (searchInput.value.trim().length >= 1) renderSearchSuggestions(searchInput.value);
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const dropdown = document.getElementById('search-suggestions');
                if (dropdown) dropdown.style.display = 'none';
            }
        });
    }
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            const dropdown = document.getElementById('search-suggestions');
            if (dropdown) dropdown.style.display = 'none';
        }
    });

    // Close detail
    const closeBtn = document.getElementById('close-detail-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeDetailPanel);

    // Filter pills
    document.querySelectorAll('.pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentFilter = pill.dataset.filter || 'all';
            updateRouteDisplay();
        });
    });

    // Toggle Lugares
    const toggleLugares = document.getElementById('toggle-lugares-btn');
    if (toggleLugares) {
        toggleLugares.addEventListener('click', () => {
            toggleLugares.classList.toggle('active');
            const text = toggleLugares.querySelector('.toggle-text');
            if (text) text.textContent = toggleLugares.classList.contains('active') ? 'ON' : 'OFF';
            // Future: toggle POI markers on map
        });
    }

    const STRONG_PWD_MSG = 'La contraseña debe tener mínimo 8 caracteres, 1 mayúscula, 1 minúscula, 1 número y 1 símbolo.';

    function validateStrongPasswordClient(pwd) {
        const s = String(pwd || '');
        const checks = {
            len: s.length >= 8 && s.length <= 128,
            upper: /[A-ZÁÉÍÓÚÜÑ]/.test(s),
            lower: /[a-záéíóúüñ]/.test(s),
            digit: /\d/.test(s),
            symbol: /[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9\s]/.test(s)
        };
        return {
            ok: checks.len && checks.upper && checks.lower && checks.digit && checks.symbol,
            checks
        };
    }

    function renderPasswordChecklist(containerEl, pwd) {
        if (!containerEl) return;
        const { checks } = validateStrongPasswordClient(pwd);
        const rules = [
            { key: 'len', label: '8+ caracteres' },
            { key: 'upper', label: '1 mayúscula' },
            { key: 'lower', label: '1 minúscula' },
            { key: 'digit', label: '1 número' },
            { key: 'symbol', label: '1 símbolo (!@#)' }
        ];
        containerEl.innerHTML = '';
        rules.forEach((rule) => {
            const chip = document.createElement('span');
            chip.className = `pwd-rule${checks[rule.key] ? ' ok' : ''}`;
            chip.textContent = `${checks[rule.key] ? '✓ ' : ''}${rule.label}`;
            containerEl.appendChild(chip);
        });
    }

    function bindPasswordChecklist(inputEl, containerEl) {
        if (!inputEl || !containerEl) return;
        renderPasswordChecklist(containerEl, inputEl.value);
        inputEl.addEventListener('input', () => renderPasswordChecklist(containerEl, inputEl.value));
    }

    function showAuthBanner(bannerEl, textEl, message, displayMode = 'flex') {
        if (textEl) textEl.textContent = message;
        if (bannerEl) {
            bannerEl.style.display = displayMode;
            if (typeof bannerEl.scrollIntoView === 'function') {
                bannerEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    async function withButtonLoading(btn, loadingText, asyncFn) {
        if (!btn) {
            return await asyncFn();
        }
        if (btn.dataset.loading === '1') return;
        const originalNodes = Array.from(btn.childNodes);
        const wasDisabled = btn.disabled;
        btn.dataset.loading = '1';
        btn.disabled = true;
        btn.classList.add('is-loading');

        const spinner = document.createElement('span');
        spinner.className = 'btn-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = loadingText || 'Cargando...';
        btn.innerHTML = '';
        btn.appendChild(spinner);
        btn.appendChild(label);

        try {
            return await asyncFn();
        } finally {
            delete btn.dataset.loading;
            btn.disabled = wasDisabled;
            btn.classList.remove('is-loading');
            btn.innerHTML = '';
            originalNodes.forEach((n) => btn.appendChild(n));
        }
    }

    async function handleResendWithCooldown(linkEl, asyncFn, cooldownSec = 20) {
        if (!linkEl || linkEl.dataset.busy === '1') return;
        const originalText = linkEl.dataset.origText || linkEl.textContent;
        linkEl.dataset.origText = originalText;
        linkEl.dataset.busy = '1';
        linkEl.classList.add('auth-resend-disabled');
        linkEl.textContent = 'Enviando nuevo código...';

        let ok = false;
        try {
            await asyncFn();
            ok = true;
        } finally {
            if (!ok) {
                delete linkEl.dataset.busy;
                linkEl.classList.remove('auth-resend-disabled');
                linkEl.textContent = originalText;
            }
        }

        let remaining = cooldownSec;
        linkEl.textContent = `Reenviar disponible en ${remaining}s`;
        const timer = setInterval(() => {
            remaining -= 1;
            if (!document.body.contains(linkEl) || remaining <= 0) {
                clearInterval(timer);
                delete linkEl.dataset.busy;
                linkEl.classList.remove('auth-resend-disabled');
                linkEl.textContent = originalText;
                return;
            }
            linkEl.textContent = `Reenviar disponible en ${remaining}s`;
        }, 1000);
    }

    const COMMON_EMAIL_DOMAIN_TYPOS = {
        'gmial.com': 'gmail.com',
        'gmal.com': 'gmail.com',
        'gamil.com': 'gmail.com',
        'gnail.com': 'gmail.com',
        'gmail.con': 'gmail.com',
        'gmail.comm': 'gmail.com',
        'gmail.com.mx': 'gmail.com',
        'gmail.mx': 'gmail.com',
        'hotmal.com': 'hotmail.com',
        'hotnail.com': 'hotmail.com',
        'hotmail.con': 'hotmail.com',
        'outlok.com': 'outlook.com',
        'outloo.com': 'outlook.com',
        'outlook.con': 'outlook.com',
        'yaho.com': 'yahoo.com',
        'yahoo.con': 'yahoo.com',
        'iclod.com': 'icloud.com',
        'icloud.con': 'icloud.com',
        'upsin.edu': 'upsin.edu.mx',
        'upsin.mx': 'upsin.edu.mx'
    };

    function detectEmailTypo(rawEmail) {
        const email = String(rawEmail || '').trim().toLowerCase();
        const atIdx = email.lastIndexOf('@');
        if (atIdx < 1 || atIdx === email.length - 1) return null;
        const local = email.slice(0, atIdx);
        const domain = email.slice(atIdx + 1);
        if (COMMON_EMAIL_DOMAIN_TYPOS[domain]) {
            return `${local}@${COMMON_EMAIL_DOMAIN_TYPOS[domain]}`;
        }
        if (domain.endsWith('.con')) {
            return `${local}@${domain.slice(0, -4)}.com`;
        }
        if (domain.endsWith('.comm')) {
            return `${local}@${domain.slice(0, -5)}.com`;
        }
        return null;
    }

    function bindEmailTypoHint(inputEl, hintEl, confirmEl = null) {
        if (!inputEl || !hintEl) return;
        const refresh = () => {
            const suggested = detectEmailTypo(inputEl.value);
            if (!suggested) {
                hintEl.style.display = 'none';
                hintEl.innerHTML = '';
                return;
            }
            hintEl.innerHTML = '';
            const span = document.createElement('span');
            span.textContent = `¿Quisiste decir ${suggested}?`;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'auth-typo-btn';
            btn.textContent = 'Corregir';
            btn.addEventListener('click', () => {
                inputEl.value = suggested;
                if (confirmEl && confirmEl.value.trim()) {
                    confirmEl.value = suggested;
                }
                hintEl.style.display = 'none';
                inputEl.focus();
            });
            hintEl.appendChild(span);
            hintEl.appendChild(btn);
            hintEl.style.display = 'flex';
        };
        inputEl.addEventListener('input', refresh);
        inputEl.addEventListener('blur', refresh);
    }

    // User badge (account modal & logout)
    const userBadge = document.getElementById('user-badge');
    const accountModal = document.getElementById('account-modal');
    const accountClose = document.getElementById('account-close');
    const accountLogoutBtn = document.getElementById('account-logout-btn');
    const btnToggleChangePwd = document.getElementById('btn-toggle-change-pwd');
    const changePwdForm = document.getElementById('change-password-form');
    const changePwdErr = document.getElementById('change-pwd-error');
    const newPwdInput = document.getElementById('new-password-input');
    const changePwdRules = document.getElementById('change-pwd-rules');
    bindPasswordChecklist(newPwdInput, changePwdRules);
    
    function resetChangePasswordForm() {
        if (changePwdForm) {
            changePwdForm.reset();
            changePwdForm.style.display = 'none';
        }
        if (changePwdErr) {
            changePwdErr.textContent = '';
            changePwdErr.style.display = 'none';
        }
        renderPasswordChecklist(changePwdRules, '');
    }

    if (userBadge && accountModal) {
        userBadge.addEventListener('click', () => {
            resetChangePasswordForm();
            const titleEl = document.getElementById('account-username');
            if (titleEl && Auth.user && Auth.user.username) {
                titleEl.textContent = Auth.user.username;
            }
            accountModal.style.display = 'flex';
        });
    }
    if (accountClose && accountModal) {
        accountClose.addEventListener('click', () => {
            resetChangePasswordForm();
            accountModal.style.display = 'none';
        });
    }
    if (btnToggleChangePwd && changePwdForm) {
        btnToggleChangePwd.addEventListener('click', () => {
            const isOpen = changePwdForm.style.display === 'flex';
            changePwdForm.style.display = isOpen ? 'none' : 'flex';
            if (changePwdErr) changePwdErr.style.display = 'none';
            renderPasswordChecklist(changePwdRules, newPwdInput ? newPwdInput.value : '');
        });
    }
    if (changePwdForm) {
        changePwdForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (changePwdErr) changePwdErr.style.display = 'none';
            const curr = document.getElementById('current-password-input').value;
            const next = newPwdInput.value;
            const conf = document.getElementById('confirm-new-password-input').value;

            if (!validateStrongPasswordClient(next).ok) {
                showAuthBanner(changePwdErr, changePwdErr, STRONG_PWD_MSG, 'block');
                return;
            }
            if (next !== conf) {
                showAuthBanner(changePwdErr, changePwdErr, 'Las nuevas contraseñas no coinciden.', 'block');
                return;
            }
            const submitBtn = changePwdForm.querySelector('button[type="submit"]');
            await withButtonLoading(submitBtn, 'Guardando...', async () => {
                try {
                    await Api.changePassword(curr, next);
                    resetChangePasswordForm();
                    accountModal.style.display = 'none';
                    showToast('Contraseña actualizada correctamente');
                } catch (err) {
                    showAuthBanner(changePwdErr, changePwdErr, err.message || 'No se pudo actualizar la contraseña.', 'block');
                }
            });
        });
    }
    if (accountLogoutBtn && accountModal) {
        accountLogoutBtn.addEventListener('click', () => {
            resetChangePasswordForm();
            accountModal.style.display = 'none';
            Auth.logout();
        });
    }

    // Admin button
    const adminBtn = document.getElementById('admin-btn');
    if (adminBtn) adminBtn.addEventListener('click', () => { window.location.href = 'admin.html'; });

    // Geolocation FAB
    const fabLocation = document.getElementById('fab-location');
    if (fabLocation) fabLocation.addEventListener('click', geolocateUser);

    // Login modal
    const loginBtn = document.getElementById('login-btn');
    const loginModal = document.getElementById('login-modal');
    const loginClose = document.getElementById('login-close');
    const loginForm = document.getElementById('login-form');
    const loginErrorBanner = document.getElementById('login-error-banner');
    const loginErrorText = document.getElementById('login-error-text');

    if (loginBtn) loginBtn.addEventListener('click', () => { 
        if (loginErrorBanner) loginErrorBanner.style.display = 'none';
        loginModal.style.display = 'flex';
        initGoogleAuthIntegration();
    });
    if (loginClose) loginClose.addEventListener('click', () => { loginModal.style.display = 'none'; });

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (loginErrorBanner) loginErrorBanner.style.display = 'none';
            const u = document.getElementById('login-username').value.trim();
            const p = document.getElementById('login-password').value;
            if (!u || !p) {
                showAuthBanner(loginErrorBanner, loginErrorText, 'Por favor ingresa usuario o correo y contraseña');
                return;
            }
            const submitBtn = loginForm.querySelector('button[type="submit"]');
            await withButtonLoading(submitBtn, 'Iniciando sesión...', async () => {
                try {
                    const success = await Auth.login(u, p);
                    if (success) { 
                        loginModal.style.display = 'none'; 
                        loginForm.reset(); 
                    } else {
                        showAuthBanner(loginErrorBanner, loginErrorText, 'Usuario o contraseña incorrectos');
                    }
                } catch (err) {
                    showAuthBanner(loginErrorBanner, loginErrorText, err.message || 'Error al iniciar sesión');
                }
            });
        });
    }

    // Register modal (2 Pasos)
    const registerModal = document.getElementById('register-modal');
    const registerClose = document.getElementById('register-close');
    const registerForm = document.getElementById('register-form');
    const verifyForm = document.getElementById('verify-form');
    const openRegister = document.getElementById('open-register');
    const openLogin = document.getElementById('open-login');
    const step1Container = document.getElementById('register-step-1-form');
    const step2Container = document.getElementById('register-step-2-code');
    const regErrorBanner = document.getElementById('register-error-banner');
    const regErrorText = document.getElementById('register-error-text');
    const verifyErrorBanner = document.getElementById('verify-error-banner');
    const verifyErrorText = document.getElementById('verify-error-text');
    const regSubmitBtn = document.getElementById('register-submit-btn');
    const regEmailInput = document.getElementById('register-email');
    const regConfirmEmailInput = document.getElementById('register-confirm-email');
    const regEmailHint = document.getElementById('register-email-hint');
    const regUsernameInput = document.getElementById('register-username');
    const regUsernameNote = document.getElementById('register-username-note');
    const regPasswordInput = document.getElementById('register-password');
    const regPwdRules = document.getElementById('register-pwd-rules');

    bindEmailTypoHint(regEmailInput, regEmailHint, regConfirmEmailInput);
    bindPasswordChecklist(regPasswordInput, regPwdRules);
    if (regUsernameInput && regUsernameNote) {
        regUsernameInput.addEventListener('input', () => {
            const val = regUsernameInput.value;
            const hasInvalid = /\s|[^a-zA-Z0-9_.-]/.test(val);
            regUsernameNote.style.color = hasInvalid ? '#DC2626' : '';
            regUsernameNote.textContent = hasInvalid
                ? '⚠️ Sin espacios ni acentos: usa solo letras, números, . _ o -'
                : 'Sin espacios ni acentos (3–30 caracteres: letras, números, . _ -)';
        });
    }

    function resetRegisterModal() {
        if (regErrorBanner) regErrorBanner.style.display = 'none';
        if (verifyErrorBanner) verifyErrorBanner.style.display = 'none';
        if (regEmailHint) { regEmailHint.style.display = 'none'; regEmailHint.innerHTML = ''; }
        if (regUsernameNote) {
            regUsernameNote.style.color = '';
            regUsernameNote.textContent = 'Sin espacios ni acentos (3–30 caracteres: letras, números, . _ -)';
        }
        if (step1Container) step1Container.style.display = 'flex';
        if (step2Container) step2Container.style.display = 'none';
        if (registerForm) registerForm.reset();
        if (verifyForm) verifyForm.reset();
        renderPasswordChecklist(regPwdRules, '');
    }

    if (openRegister) openRegister.addEventListener('click', async (e) => { 
        e.preventDefault(); 
        loginModal.style.display = 'none'; 
        resetRegisterModal();
        registerModal.style.display = 'flex';
        await initGoogleAuthIntegration({ forceConfig: true });
        if (regSubmitBtn) {
            try {
                const cfg = window._authConfigCache || await Api.getAuthConfig();
                if (regSubmitBtn.dataset.loading !== '1') {
                    regSubmitBtn.textContent = (cfg && cfg.requireEmailVerification === false)
                        ? 'Crear cuenta'
                        : 'Siguiente: Verificar correo';
                }
            } catch (_) {}
        }
    });
    initGoogleAuthIntegration();
    if (openLogin) openLogin.addEventListener('click', (e) => { 
        e.preventDefault(); 
        registerModal.style.display = 'none'; 
        if (loginErrorBanner) loginErrorBanner.style.display = 'none';
        loginModal.style.display = 'flex'; 
    });
    if (registerClose) registerClose.addEventListener('click', () => { registerModal.style.display = 'none'; });

    // PASO 1: Enviar formulario principal
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (regErrorBanner) regErrorBanner.style.display = 'none';

            const email = regEmailInput.value.trim().toLowerCase();
            const confirmEmail = regConfirmEmailInput ? regConfirmEmailInput.value.trim().toLowerCase() : email;
            const u = regUsernameInput.value.trim();
            const p = regPasswordInput.value;
            const confirmP = document.getElementById('register-confirm-password').value;

            // Validaciones
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
            if (!emailRegex.test(email)) {
                showAuthBanner(regErrorBanner, regErrorText, 'Ingresa un correo electrónico válido');
                return;
            }
            if (email !== confirmEmail) {
                showAuthBanner(regErrorBanner, regErrorText, 'Los correos electrónicos no coinciden. Verifica el dominio (ej. @gmail.com o @upsin.edu.mx).');
                return;
            }
            if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(u)) {
                showAuthBanner(regErrorBanner, regErrorText, 'El usuario debe tener entre 3 y 30 caracteres (sin espacios ni acentos; solo letras, números, . _ -)');
                return;
            }
            if (!validateStrongPasswordClient(p).ok) {
                showAuthBanner(regErrorBanner, regErrorText, STRONG_PWD_MSG);
                return;
            }
            if (p !== confirmP) {
                showAuthBanner(regErrorBanner, regErrorText, 'Las contraseñas no coinciden');
                return;
            }

            await withButtonLoading(regSubmitBtn, 'Enviando código...', async () => {
                try {
                    // Solicitar código de verificación al backend (en Beta sin correo, registra directo)
                    const res = await Api.sendVerificationCode(email);
                    if (res && res.skipVerification) {
                        await Api.register(email, u, p, '');
                        showToast('¡Cuenta creada con éxito! Ya puedes iniciar sesión.');
                        registerModal.style.display = 'none';
                        resetRegisterModal();
                        if (loginErrorBanner) loginErrorBanner.style.display = 'none';
                        loginModal.style.display = 'flex';
                        return;
                    }

                    window._tempRegEmail = email;
                    window._tempRegUsername = u;
                    window._tempRegPassword = p;

                    // Pasar al Paso 2
                    step1Container.style.display = 'none';
                    step2Container.style.display = 'flex';
                    const emailDisplay = document.getElementById('register-email-display');
                    if (emailDisplay) emailDisplay.textContent = email;

                    if (res && res.code) {
                        showToast(`📲 Local: Tu código para ${email} es ${res.code}`);
                    } else {
                        showToast('Código de verificación enviado a tu correo.');
                    }
                } catch (err) {
                    showAuthBanner(regErrorBanner, regErrorText, err.message || 'Error al validar el correo');
                }
            });
        });
    }

    // PASO 2: Verificar código en el servidor y crear cuenta
    if (verifyForm) {
        verifyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (verifyErrorBanner) verifyErrorBanner.style.display = 'none';

            const codeInput = document.getElementById('register-code-input').value.trim();
            if (!/^\d{6}$/.test(codeInput)) {
                showAuthBanner(verifyErrorBanner, verifyErrorText, 'Ingresa un código de 6 dígitos');
                return;
            }

            const verifyBtn = verifyForm.querySelector('button[type="submit"]');
            await withButtonLoading(verifyBtn, 'Verificando...', async () => {
                try {
                    const res = await Api.register(
                        window._tempRegEmail,
                        window._tempRegUsername,
                        window._tempRegPassword,
                        codeInput
                    );
                    if (res) {
                        showToast('¡Cuenta creada y verificada con éxito! Ya puedes iniciar sesión.');
                        registerModal.style.display = 'none';
                        resetRegisterModal();
                        if (loginErrorBanner) loginErrorBanner.style.display = 'none';
                        loginModal.style.display = 'flex';
                    }
                } catch (err) {
                    showAuthBanner(verifyErrorBanner, verifyErrorText, err.message || 'Código incorrecto o error al crear la cuenta');
                }
            });
        });
    }

    const resendLink = document.getElementById('resend-code-link');
    if (resendLink) {
        resendLink.addEventListener('click', async (e) => {
            e.preventDefault();
            await handleResendWithCooldown(resendLink, async () => {
                try {
                    const res = await Api.sendVerificationCode(window._tempRegEmail);
                    if (res && res.code) {
                        showToast(`📲 Local: Nuevo código enviado: ${res.code}`);
                    } else {
                        showToast('Nuevo código enviado a tu correo.');
                    }
                } catch (err) {
                    showToast(err.message, 'error');
                    throw err;
                }
            });
        });
    }

    const backStep1 = document.getElementById('back-to-step-1');
    if (backStep1) {
        backStep1.addEventListener('click', (e) => {
            e.preventDefault();
            step2Container.style.display = 'none';
            step1Container.style.display = 'flex';
            if (regErrorBanner) regErrorBanner.style.display = 'none';
        });
    }

    // Forgot Password modal (2 pasos reales)
    const forgotModal = document.getElementById('forgot-modal');
    const forgotClose = document.getElementById('forgot-close');
    const forgotForm = document.getElementById('forgot-form');
    const resetPwdForm = document.getElementById('reset-password-form');
    const forgotStep1 = document.getElementById('forgot-step-1-email');
    const forgotStep2 = document.getElementById('forgot-step-2-reset');
    const forgotEmailInput = document.getElementById('forgot-email');
    const forgotEmailHint = document.getElementById('forgot-email-hint');
    const forgotEmailDisplay = document.getElementById('forgot-email-display');
    const resetNewPwdInput = document.getElementById('reset-new-password');
    const resetPwdRules = document.getElementById('reset-pwd-rules');
    const openForgot = document.getElementById('open-forgot');
    const forgotBackLogin = document.getElementById('forgot-back-login');
    const forgotResendLink = document.getElementById('forgot-resend-code');
    const forgotBackStep1 = document.getElementById('forgot-back-step-1');
    const forgotErrorBanner = document.getElementById('forgot-error-banner');
    const forgotErrorText = document.getElementById('forgot-error-text');
    const forgotSuccessBanner = document.getElementById('forgot-success-banner');
    const forgotSuccessText = document.getElementById('forgot-success-text');

    bindEmailTypoHint(forgotEmailInput, forgotEmailHint);
    bindPasswordChecklist(resetNewPwdInput, resetPwdRules);

    function resetForgotModal() {
        if (forgotErrorBanner) forgotErrorBanner.style.display = 'none';
        if (forgotSuccessBanner) forgotSuccessBanner.style.display = 'none';
        if (forgotEmailHint) { forgotEmailHint.style.display = 'none'; forgotEmailHint.innerHTML = ''; }
        if (forgotStep1) forgotStep1.style.display = 'flex';
        if (forgotStep2) forgotStep2.style.display = 'none';
        if (forgotForm) forgotForm.reset();
        if (resetPwdForm) resetPwdForm.reset();
        renderPasswordChecklist(resetPwdRules, '');
        window._tempResetEmail = '';
    }

    if (openForgot) {
        openForgot.addEventListener('click', (e) => {
            e.preventDefault();
            loginModal.style.display = 'none';
            resetForgotModal();
            forgotModal.style.display = 'flex';
        });
    }
    if (forgotClose) forgotClose.addEventListener('click', () => { forgotModal.style.display = 'none'; });
    if (forgotBackLogin) {
        forgotBackLogin.addEventListener('click', (e) => {
            e.preventDefault();
            forgotModal.style.display = 'none';
            if (loginErrorBanner) loginErrorBanner.style.display = 'none';
            loginModal.style.display = 'flex';
        });
    }
    if (forgotBackStep1) {
        forgotBackStep1.addEventListener('click', (e) => {
            e.preventDefault();
            if (forgotErrorBanner) forgotErrorBanner.style.display = 'none';
            if (forgotSuccessBanner) forgotSuccessBanner.style.display = 'none';
            if (forgotStep2) forgotStep2.style.display = 'none';
            if (forgotStep1) forgotStep1.style.display = 'flex';
        });
    }

    if (forgotForm) {
        forgotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (forgotErrorBanner) forgotErrorBanner.style.display = 'none';
            if (forgotSuccessBanner) forgotSuccessBanner.style.display = 'none';

            const email = forgotEmailInput.value.trim().toLowerCase();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
            if (!emailRegex.test(email)) {
                showAuthBanner(forgotErrorBanner, forgotErrorText, 'Ingresa un correo electrónico válido');
                return;
            }

            const forgotBtn = forgotForm.querySelector('button[type="submit"]');
            await withButtonLoading(forgotBtn, 'Enviando código...', async () => {
                try {
                    const res = await Api.forgotPassword(email);
                    window._tempResetEmail = email;
                    if (forgotEmailDisplay) forgotEmailDisplay.textContent = email;
                    if (forgotStep1) forgotStep1.style.display = 'none';
                    if (forgotStep2) forgotStep2.style.display = 'flex';
                    showAuthBanner(forgotSuccessBanner, forgotSuccessText, res.message || 'Código enviado a tu correo.');
                    if (res && res.code) {
                        showToast(`📲 Local: Código de recuperación para ${email}: ${res.code}`);
                    }
                } catch (err) {
                    showAuthBanner(forgotErrorBanner, forgotErrorText, err.message || 'No se pudo enviar el código de recuperación');
                }
            });
        });
    }

    if (forgotResendLink) {
        forgotResendLink.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!window._tempResetEmail) return;
            await handleResendWithCooldown(forgotResendLink, async () => {
                try {
                    const res = await Api.forgotPassword(window._tempResetEmail);
                    if (res && res.code) {
                        showToast(`📲 Local: Nuevo código de recuperación: ${res.code}`);
                    } else {
                        showToast('Nuevo código de recuperación enviado.');
                    }
                } catch (err) {
                    showToast(err.message, 'error');
                    throw err;
                }
            });
        });
    }

    if (resetPwdForm) {
        resetPwdForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (forgotErrorBanner) forgotErrorBanner.style.display = 'none';
            if (forgotSuccessBanner) forgotSuccessBanner.style.display = 'none';

            const code = document.getElementById('reset-code-input').value.trim();
            const newPwd = resetNewPwdInput.value;
            const confirmPwd = document.getElementById('reset-confirm-password').value;

            if (!/^\d{6}$/.test(code)) {
                showAuthBanner(forgotErrorBanner, forgotErrorText, 'Ingresa el código de 6 dígitos');
                return;
            }
            if (!validateStrongPasswordClient(newPwd).ok) {
                showAuthBanner(forgotErrorBanner, forgotErrorText, STRONG_PWD_MSG);
                return;
            }
            if (newPwd !== confirmPwd) {
                showAuthBanner(forgotErrorBanner, forgotErrorText, 'Las contraseñas nuevas no coinciden');
                return;
            }

            const resetBtn = resetPwdForm.querySelector('button[type="submit"]');
            await withButtonLoading(resetBtn, 'Restableciendo...', async () => {
                try {
                    await Api.resetPassword(window._tempResetEmail, code, newPwd);
                    forgotModal.style.display = 'none';
                    resetForgotModal();
                    showToast('Contraseña restablecida con éxito. Ya puedes iniciar sesión.');
                    if (loginErrorBanner) loginErrorBanner.style.display = 'none';
                    loginModal.style.display = 'flex';
                } catch (err) {
                    showAuthBanner(forgotErrorBanner, forgotErrorText, err.message || 'No se pudo restablecer la contraseña');
                }
            });
        });
    }
}

// ----------------------------------------------------------
// LÓGICA DEL MENÚ PRINCIPAL Y MODALES INFORMATIVOS
// ----------------------------------------------------------
const menuContentData = {
    'guia_app': {
        title: '¿Cómo usar Don Rutero?',
        icon: 'assets/icons/ui_buscar.svg',
        body: '1. Explorar rutas y paradas:\nBusca por nombre, colonia, hospital o plaza, o usa los filtros rápidos (Favoritas, Turístico, Centro, Frecuentes). Con el selector Normal / Estudiante cambias al instante el precio mostrado en cada tarjeta.\n\n2. Detalle de ruta, sentido y QR:\nToca cualquier ruta para ver su trazado exacto con flechas de dirección, tarifa, frecuencia estimada, línea de paradas y su botón de código QR o estrella para guardarla en Favoritas.\n\n3. Planificador "¿Cómo Llego?":\nElige tu origen (o toca "Usar mi GPS"), tu destino o un lugar turístico sugerido. Don Rutero te muestra rutas directas o con transbordo, la distancia a caminar, si te conviene cruzar la calle por el sentido del camión y el botón "Voy a bordo" para ir viendo tu próxima parada.\n\n4. Reportes ciudadanos:\nSi detectas un desvío, parada faltante o cambio de recorrido, envíanos un aviso desde "Reportar o Sugerir ruta".'
    },
    'faq': {
        title: 'Preguntas Frecuentes (FAQ)',
        icon: 'assets/icons/ui_campana.svg',
        body: '• ¿Cuántas rutas tiene Don Rutero?\nActualmente contamos con 27 rutas trazadas calle por calle y 420 paradas ubicadas en colonias, Centro, Zona Dorada y vialidades principales de Mazatlán.\n\n• ¿Cuánto cuesta el pasaje?\nTarifa normal: entre $13.00 y $16.00 MXN según la ruta o unidad (tradicional o con aire acondicionado). Tarifa estudiantil: $3.50 MXN presentando credencial vigente o TIIE. Puedes alternar entre Normal y Estudiante directo en la app.\n\n• ¿Qué hago si no hay un camión directo?\nEn la pestaña "¿Cómo Llego?" el planificador también busca opciones con transbordo automático e indica la parada donde bajar y abordar el segundo camión.\n\n• ¿Necesito crear una cuenta para usar la app?\nNo. Todas las rutas, paradas, el planificador y "Voy a bordo" funcionan sin iniciar sesión. La cuenta es gratuita y opcional.\n\n• ¿A qué hora pasan los camiones?\nLa mayoría inicia alrededor de las 5:30 AM y realiza sus últimas vueltas entre las 9:30 PM y 10:30 PM, con intervalos aproximados de 8 a 20 minutos según la ruta.'
    },
    'transporte_mzt': {
        title: 'Guía del Transporte en Mazatlán',
        icon: 'assets/icons/ui_camion.svg',
        body: 'En Mazatlán operan principalmente dos agrupaciones urbanas:\n\n• Alianza de Camiones (Verdes / "Puro Sinaloa"):\nUnidades modernas —gran parte con aire acondicionado— que cubren corredores costeros (Malecón, Sábalo, Cerritos), Centro y colonias en expansión.\n\n• Águilas del Pacífico (Rojos):\nAutobuses tradicionales con cobertura amplia hacia colonias populares, zona norte, sur, Juárez y Centro Histórico.\n\nConsejos útiles para moverte:\n- Sentido de circulación: muchas rutas regresan por calles paralelas. Activa la ruta y sigue las flechas del mapa para pararte en la acera correcta.\n- Paradas visibles: acerca el mapa para ver los iconos de paraderos y lugares clave.\n- Tarifas y horarios: lleva cambio exacto ($13–$16 MXN general; $3.50 MXN estudiante con credencial/TIIE). El horario habitual va de ~5:30 AM a ~10:30 PM.'
    },
    'acerca': {
        title: 'Acerca de Don Rutero',
        icon: 'assets/icons/ui_ubicacion.svg',
        body: 'Don Rutero es una plataforma web comunitaria y gratuita de movilidad urbana creada en Mazatlán, Sinaloa, para ayudar tanto a locales como a turistas a moverse en camión con claridad y sin perderse.\n\n¿Qué incluye hoy (Beta v1.0)?\n• Catálogo activo de 27 rutas y 420 paradas georreferenciadas.\n• Trazados con flechas de dirección adaptativas según el zoom.\n• Planificador "¿Cómo Llego?" con rutas directas, transbordos y cálculo de caminata.\n• Modo "Voy a bordo" (simulación o GPS en vivo) y códigos QR compartibles por ruta o parada.\n• Selector de tarifa Normal / Estudiante y lista de Favoritas.\n\nEste proyecto sigue creciendo con las aportaciones de quienes usan el camión todos los días en el puerto.\n\n© 2026 Don Rutero · Todos los derechos reservados.'
    },
    'terminos': {
        title: 'Términos de Uso',
        icon: 'assets/icons/ui_escudo.svg',
        body: 'Última actualización: noviembre de 2026\n\n1. Carácter informativo del servicio\nDon Rutero es una plataforma comunitaria gratuita orientada a facilitar la consulta de rutas, paradas y transbordos aproximados del transporte público urbano en Mazatlán, Sinaloa. No está afiliada ni operada de manera oficial por concesionarios, alianzas de camiones ni autoridades de movilidad.\n\n2. Exactitud de rutas, tarifas y horarios\nLos trazados, paraderos, tarifas (general y estudiante) y frecuencias mostradas son referenciales y pueden cambiar por desvíos, obras viales, clima, tránsito o ajustes operativos sin previo aviso.\n\n3. Uso adecuado y cuentas\nEl usuario se compromete a utilizar el sitio de forma lícita, sin realizar peticiones automatizadas abusivas, intentar vulnerar la seguridad o suplantar identidad. Las sugerencias o reportes enviados pueden usarse para mejorar el catálogo de rutas.\n\n4. Propiedad intelectual y atribuciones\n© 2026 Don Rutero. Todos los derechos reservados. El nombre, logotipo, diseño de interfaz y código de la plataforma pertenecen a sus autores. La cartografía base y geocodificación corresponden a OpenStreetMap y sus colaboradores.\n\n5. Limitación de responsabilidad\nLa plataforma se ofrece "tal cual" en fase Beta. Las decisiones de traslado corresponden únicamente al usuario.'
    },
    'privacidad': {
        title: 'Aviso de Privacidad',
        icon: 'assets/icons/ui_candado_check.svg',
        body: 'Última actualización: noviembre de 2026\n\n1. Datos personales que recopilamos\n• Navegación pública: puedes consultar rutas, paradas y el planificador sin crear cuenta ni proporcionar datos personales.\n• Registro opcional de cuenta: si decides registrarte, almacenamos únicamente tu nombre de usuario, correo electrónico y tu contraseña cifrada (hash seguro BCrypt) para gestionar tu sesión.\n\n2. Uso de tu ubicación (GPS)\nCuando utilizas "Mi ubicación" o el modo "Voy a bordo (GPS)", las coordenadas de tu dispositivo se procesan localmente en tu navegador para centrar el mapa o identificar paradas cercanas. No guardamos ni rastreamos tu historial de ubicaciones en nuestros servidores.\n\n3. Almacenamiento local del navegador\nGuardamos en el almacenamiento local (localStorage) tu sesión activa y tus rutas favoritas para recordarlas entre visitas.\n\n4. Servicios de terceros\nPara mostrar el mapa y buscar direcciones por nombre, tu navegador solicita mosaicos y resultados de OpenStreetMap / Nominatim conforme a sus políticas. Don Rutero no vende ni comparte tus datos con terceros con fines publicitarios.\n\n5. Contacto y eliminación de cuenta\nSi deseas solicitar la eliminación o corrección de tu cuenta o tienes dudas sobre privacidad, puedes contactarnos mediante la opción "Reportar o Sugerir ruta" en el menú.'
    },
    'legal': {
        title: 'Términos de Uso y Privacidad',
        icon: 'assets/icons/ui_escudo.svg',
        body: '© 2026 Don Rutero · Todos los derechos reservados.\nConsulta las secciones dedicadas de "Términos de uso" y "Aviso de privacidad" en el menú principal.'
    }
};

function toggleMainMenu(show) {
    const drawer = document.getElementById('main-menu-drawer');
    const backdrop = document.getElementById('menu-backdrop');
    if (!drawer || !backdrop) return;
    
    const isOpen = show !== undefined ? show : !drawer.classList.contains('open');
    if (isOpen) {
        drawer.classList.add('open');
        backdrop.classList.add('open');
    } else {
        drawer.classList.remove('open');
        backdrop.classList.remove('open');
    }
}

function showMenuModal(type) {
    toggleMainMenu(false);
    
    if (type === 'sugerir') {
        const reportModal = document.getElementById('report-modal');
        if (reportModal) reportModal.style.display = 'flex';
        return;
    }

    const data = menuContentData[type];
    if (!data) return;
    
    const modal = document.getElementById('info-modal');
    const titleEl = document.getElementById('info-modal-title');
    const bodyEl = document.getElementById('info-modal-body');
    const iconEl = document.querySelector('#info-modal-icon img');
    
    if (titleEl) titleEl.textContent = data.title;
    if (bodyEl) {
        bodyEl.textContent = data.body;
        bodyEl.scrollTop = 0;
    }
    if (iconEl) iconEl.src = data.icon;
    
    if (modal) {
        modal.style.display = 'flex';
    }
}

// ----------------------------------------------------------
// GENERADOR DE CÓDIGO QR DE PARADERO Y ENLACES DIRECTOS
// ----------------------------------------------------------
let activeQrConfig = null;

function buildQrShareUrl(paramName, entityId) {
    const base = window.location.origin && window.location.origin !== 'null'
        ? `${window.location.origin}${window.location.pathname}`
        : `${window.location.pathname}`;
    return `${base}?${paramName}=${encodeURIComponent(String(entityId))}`;
}

function drawQrMatrixOnCanvas(canvas, qr, padding = 10) {
    const ctx = canvas.getContext('2d');
    const count = qr.getModuleCount();
    const size = canvas.width;
    const cellSize = (size - padding * 2) / count;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = '#0F172A';
    for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
            if (qr.isDark(r, c)) {
                const x = Math.floor(padding + c * cellSize);
                const y = Math.floor(padding + r * cellSize);
                const w = Math.ceil(padding + (c + 1) * cellSize) - x;
                const h = Math.ceil(padding + (r + 1) * cellSize) - y;
                ctx.fillRect(x, y, w, h);
            }
        }
    }
}

function createQrInstance(url) {
    if (typeof qrcode !== 'function') {
        throw new Error('La librería de QR no está cargada');
    }
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return qr;
}

function openQrModal(config) {
    const modal = document.getElementById('qr-modal');
    const canvas = document.getElementById('qr-preview-canvas');
    const accentBar = document.getElementById('qr-accent-bar');
    const kindEl = document.getElementById('qr-entity-kind');
    const titleEl = document.getElementById('qr-entity-title');
    const metaEl = document.getElementById('qr-entity-meta');
    const urlEl = document.getElementById('qr-url-preview');
    const localhostNote = document.getElementById('qr-localhost-note');
    if (!modal || !canvas) return;

    try {
        const qr = createQrInstance(config.url);
        activeQrConfig = { ...config, qr };

        if (accentBar) accentBar.style.background = config.color || '#E63E21';
        if (kindEl) kindEl.textContent = config.kindLabel;
        if (titleEl) titleEl.textContent = config.title;
        if (metaEl) metaEl.textContent = config.meta || '';
        if (urlEl) {
            urlEl.textContent = config.url;
            urlEl.href = config.url;
        }
        if (localhostNote) {
            const host = window.location.hostname;
            localhostNote.style.display = (host === 'localhost' || host === '127.0.0.1') ? 'block' : 'none';
        }

        drawQrMatrixOnCanvas(canvas, qr, 8);
        modal.style.display = 'flex';
    } catch (err) {
        console.error('Error al generar QR:', err);
        showToast('No se pudo generar el código QR', 'error');
    }
}

function openQrModalForRoute(routeId) {
    const route = allRoutes.find((r) => Number(r.id) === Number(routeId));
    if (!route) return;
    const freqText = route.frequencyMinutes ? `Cada ${route.frequencyMinutes} min` : 'Frecuencia regular';
    const normalStr = `$${getRouteNormalPrice(route).toFixed(2)}`;
    const studentStr = `$${getRouteStudentPrice(route).toFixed(2)}`;
    const meta = `Tarifa ${normalStr} · Est. ${studentStr} · ${freqText}`;
    openQrModal({
        kindLabel: 'RUTA DE CAMIÓN',
        title: route.name.trim(),
        meta,
        color: route.color || '#E63E21',
        url: buildQrShareUrl('ruta', route.id),
        filename: `QR-DonRutero-Ruta-${route.id}.png`
    });
}

function openQrModalForStop(stopId) {
    let stop = Array.isArray(allPhysicalStopsList)
        ? allPhysicalStopsList.find((s) => Number(s.id) === Number(stopId))
        : null;
    if (!stop && Array.isArray(allRoutes)) {
        for (const r of allRoutes) {
            const hit = (r.stopsList || []).find((rs) => rs.stop && Number(rs.stop.id) === Number(stopId));
            if (hit) {
                stop = hit.stop;
                break;
            }
        }
    }
    if (!stop) {
        showToast('Parada no encontrada para generar QR', 'error');
        return;
    }
    openQrModal({
        kindLabel: 'PARADERO MAZATLÁN',
        title: stop.name,
        meta: stop.address || `${stop.latitude.toFixed(4)}, ${stop.longitude.toFixed(4)}`,
        color: '#E63E21',
        url: buildQrShareUrl('parada', stop.id),
        filename: `QR-DonRutero-Parada-${stop.id}.png`
    });
}

function downloadQrTotemPng() {
    if (!activeQrConfig || !activeQrConfig.qr) return;
    const { kindLabel, title, meta, color, qr, filename } = activeQrConfig;

    const w = 520;
    const h = 680;
    const cardCanvas = document.createElement('canvas');
    cardCanvas.width = w;
    cardCanvas.height = h;
    const ctx = cardCanvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = color || '#E63E21';
    ctx.fillRect(0, 0, w, 24);

    ctx.fillStyle = '#64748B';
    ctx.font = 'bold 16px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`DON RUTERO · ${kindLabel}`, w / 2, 72);

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 26px Inter, Arial, sans-serif';
    const titleTrim = title.length > 34 ? `${title.slice(0, 32)}…` : title;
    ctx.fillText(titleTrim, w / 2, 114);

    if (meta) {
        ctx.fillStyle = '#475569';
        ctx.font = '500 15px Inter, Arial, sans-serif';
        const metaTrim = meta.length > 56 ? `${meta.slice(0, 54)}…` : meta;
        ctx.fillText(metaTrim, w / 2, 144);
    }

    const qrBoxSize = 360;
    const qrCanvas = document.createElement('canvas');
    qrCanvas.width = qrBoxSize;
    qrCanvas.height = qrBoxSize;
    drawQrMatrixOnCanvas(qrCanvas, qr, 16);

    const qrX = (w - qrBoxSize) / 2;
    const qrY = 176;
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 2;
    ctx.strokeRect(qrX - 10, qrY - 10, qrBoxSize + 20, qrBoxSize + 20);
    ctx.drawImage(qrCanvas, qrX, qrY);

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 17px Inter, Arial, sans-serif';
    ctx.fillText('Escanea para ver mapa, paradas y horarios', w / 2, 588);

    ctx.fillStyle = '#64748B';
    ctx.font = '500 13px Inter, Arial, sans-serif';
    ctx.fillText('Movilidad urbana · Mazatlán, Sinaloa', w / 2, 620);

    const link = document.createElement('a');
    link.download = filename || 'QR-DonRutero.png';
    link.href = cardCanvas.toDataURL('image/png');
    link.click();
    showToast('Tarjeta QR descargada en PNG');
}

function setupQrModalListeners() {
    const modal = document.getElementById('qr-modal');
    const closeBtn = document.getElementById('qr-modal-close');
    const copyBtn = document.getElementById('btn-copy-qr-url');
    const downloadBtn = document.getElementById('btn-download-qr');

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    }
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            if (!activeQrConfig || !activeQrConfig.url) return;
            try {
                await navigator.clipboard.writeText(activeQrConfig.url);
                showToast('Enlace del QR copiado al portapapeles');
            } catch (_) {
                showToast('No se pudo copiar automáticamente', 'error');
            }
        });
    }
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadQrTotemPng);
    }
}

function handleDeepLinkParams() {
    setupQrModalListeners();
    setupDonationListeners();
    const params = new URLSearchParams(window.location.search);
    const rutaId = params.get('ruta');
    const paradaId = params.get('parada');

    if (rutaId) {
        const numericId = Number(rutaId);
        const route = allRoutes.find((r) => Number(r.id) === numericId);
        if (route) {
            switchSidebarMode('rutas');
            selectRoute(route.id);
            showToast(`Ruta "${route.name.trim()}" abierta desde QR`);
            return;
        }
    }

    if (paradaId) {
        const numericStopId = Number(paradaId);
        const stop = Array.isArray(allPhysicalStopsList)
            ? allPhysicalStopsList.find((s) => Number(s.id) === numericStopId)
            : null;
        if (stop) {
            switchSidebarMode('rutas');
            selectStopSuggestion(encodeURIComponent(JSON.stringify(stop)));
            showToast(`Paradero "${stop.name}" abierto desde QR`);
            return;
        }
    }

    const fromLat = parseFloat(params.get('fromLat'));
    const fromLng = parseFloat(params.get('fromLng'));
    const toLat = parseFloat(params.get('toLat'));
    const toLng = parseFloat(params.get('toLng'));
    if ([fromLat, fromLng, toLat, toLng].every((v) => isFinite(v))) {
        const fromName = params.get('fromName') || 'Origen compartido';
        const toName = params.get('toName') || 'Destino compartido';
        switchSidebarMode('planificador');
        selectedOrigin = { lat: fromLat, lng: fromLng, name: fromName };
        selectedDestination = { lat: toLat, lng: toLng, name: toName };
        const oIn = document.getElementById('origin-input');
        const dIn = document.getElementById('destination-input');
        if (oIn) oIn.value = fromName;
        if (dIn) dIn.value = toName;
        calculateTripRoute();
        showToast('Viaje compartido abierto en "¿Cómo Llego?"');
    }
}

window.openQrModalForRoute = openQrModalForRoute;
window.openQrModalForStop = openQrModalForStop;

// ----------------------------------------------------------
// MODO "VOY A BORDO" (SEGUIMIENTO EN RUTA Y SIMULACIÓN)
// ----------------------------------------------------------
const onboardState = {
    active: false,
    option: null,
    points: [],
    totalDistM: 0,
    legSplitM: null,
    stopsTimeline: [],
    source: 'sim', // 'sim' | 'gps'
    paused: false,
    speedMultiplier: 1,
    currentDistM: 0,
    timerId: null,
    watchId: null,
    bgPollTimerId: null,
    wakeLockSentinel: null,
    busMarker: null,
    notifiedNearLeg: false,
    notifiedNearEnd: false,
    notifiedFarFromRoute: false,
    corridorTrafficSpeedKmh: 22,
    liveBusSpeedKmh: null,
    lastGpsFix: null,
    lastTelemetrySentMs: 0,
    alarmEnabled: true,
    bgNotifEnabled: false,
    lastNotifSyncMs: 0,
    hudSnapshot: null,
    cachedRoundIconColor: null,
    cachedRoundIconUrl: null
};

function normalizeLatLngPoint(p) {
    if (!p) return null;
    if (Array.isArray(p) && p.length >= 2) return [Number(p[0]), Number(p[1])];
    if (typeof p.lat === 'number' && typeof p.lng === 'number') return [p.lat, p.lng];
    if (typeof p.latitude === 'number' && typeof p.longitude === 'number') return [p.latitude, p.longitude];
    return null;
}

function collectStopsAlongLeg(rawCoords, route, startCumM, legIdx) {
    if (!route || !Array.isArray(route.stopsList) || rawCoords.length === 0) return [];
    const results = [];
    const seenIds = new Set();

    // Precomputar distancias acumuladas locales sobre rawCoords
    const cumLocal = [0];
    for (let i = 1; i < rawCoords.length; i++) {
        cumLocal.push(cumLocal[i - 1] + calculateDistanceMeters(
            rawCoords[i - 1][0], rawCoords[i - 1][1],
            rawCoords[i][0], rawCoords[i][1]
        ));
    }

    route.stopsList.forEach((rs) => {
        const st = rs.stop;
        if (!st || st.latitude == null || st.longitude == null || seenIds.has(st.id)) return;
        let bestDist = Infinity;
        let bestIdx = 0;
        for (let i = 0; i < rawCoords.length; i++) {
            const d = calculateDistanceMeters(st.latitude, st.longitude, rawCoords[i][0], rawCoords[i][1]);
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        if (bestDist <= 280) {
            seenIds.add(st.id);
            results.push({
                name: st.name,
                cumM: startCumM + cumLocal[bestIdx],
                legIdx,
                routeName: route.name.trim()
            });
        }
    });

    results.sort((a, b) => a.cumM - b.cumM);
    return results;
}

function buildOnboardJourneyData(opt) {
    const legs = opt.type === 'transfer'
        ? [
            { coords: opt.travelCoordsA || [], route: opt.routeA, legIdx: 0 },
            { coords: opt.travelCoordsB || [], route: opt.routeB, legIdx: 1 }
        ]
        : [
            { coords: opt.travelCoords || [], route: opt.routeA, legIdx: 0 }
        ];

    const points = [];
    const stopsTimeline = [];
    let cumM = 0;
    let legSplitM = null;

    legs.forEach((leg, idx) => {
        const cleanCoords = leg.coords.map(normalizeLatLngPoint).filter(Boolean);
        if (cleanCoords.length === 0) return;

        if (idx === 1 && points.length > 0) {
            legSplitM = cumM;
            const prev = points[points.length - 1];
            cumM += calculateDistanceMeters(prev.lat, prev.lng, cleanCoords[0][0], cleanCoords[0][1]);
        }

        const legStartCum = cumM;
        cleanCoords.forEach(([lat, lng], pIdx) => {
            if (pIdx > 0) {
                const prevCoord = cleanCoords[pIdx - 1];
                cumM += calculateDistanceMeters(prevCoord[0], prevCoord[1], lat, lng);
            }
            points.push({
                lat,
                lng,
                cumM,
                legIdx: leg.legIdx,
                routeName: leg.route ? leg.route.name.trim() : 'Camión',
                routeColor: leg.route && leg.route.color ? leg.route.color : '#E63E21'
            });
        });

        stopsTimeline.push(...collectStopsAlongLeg(cleanCoords, leg.route, legStartCum, leg.legIdx));
    });

    return { points, totalDistM: cumM, legSplitM, stopsTimeline };
}

function interpolateOnboardPoint(points, targetCumM) {
    if (!points.length) return null;
    if (targetCumM <= 0) return points[0];
    const last = points[points.length - 1];
    if (targetCumM >= last.cumM) return last;

    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        if (targetCumM <= b.cumM) {
            const span = b.cumM - a.cumM;
            const t = span > 0 ? (targetCumM - a.cumM) / span : 0;
            return {
                lat: a.lat + (b.lat - a.lat) * t,
                lng: a.lng + (b.lng - a.lng) * t,
                cumM: targetCumM,
                legIdx: a.legIdx,
                routeName: a.routeName,
                routeColor: a.routeColor
            };
        }
    }
    return last;
}

function renderOnboardBusMarker(lat, lng, color) {
    if (!mapInstance || typeof L === 'undefined') return;
    if (!onboardState.busMarker) {
        onboardState.busMarker = L.marker([lat, lng], {
            zIndexOffset: 1400,
            icon: L.divIcon({
                className: 'onboard-bus-marker',
                html: `<div style="width:32px;height:32px;border-radius:50%;background:${color || '#0F172A'};border:3px solid #ffffff;box-shadow:0 4px 14px rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;">
                         <img src="assets/icons/ui_camion.svg" alt="" style="width:17px;height:17px;filter:brightness(0) invert(1);pointer-events:none;">
                       </div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            })
        }).addTo(mapInstance);
    } else {
        onboardState.busMarker.setLatLng([lat, lng]);
    }
}

function formatOnboardDistance(meters) {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.max(10, Math.round(meters))} m`;
}

function updateOnboardHudAtDistance(distM) {
    const pt = interpolateOnboardPoint(onboardState.points, distM);
    if (!pt) return;

    renderOnboardBusMarker(pt.lat, pt.lng, pt.routeColor);

    const routeBar = document.getElementById('onboard-route-bar');
    const routeNameEl = document.getElementById('onboard-route-name');
    const nextStopEl = document.getElementById('onboard-next-stop');
    const alightEl = document.getElementById('onboard-alight-info');
    const fillEl = document.getElementById('onboard-progress-fill');
    const badgeEl = document.getElementById('onboard-mode-badge');

    const total = Math.max(1, onboardState.totalDistM);
    const pct = Math.min(100, Math.max(0, (distM / total) * 100));
    const opt = onboardState.option;
    const isTransfer = opt && opt.type === 'transfer' && onboardState.legSplitM != null;
    const inFirstLeg = isTransfer && distM < onboardState.legSplitM;

    const legTargetM = inFirstLeg ? onboardState.legSplitM : total;
    const remainToActionM = Math.max(0, Math.round(legTargetM - distM));
    const corridorKmh = onboardState.corridorTrafficSpeedKmh || 22;
    const effectiveEtaKmh = (onboardState.source === 'gps' && onboardState.liveBusSpeedKmh)
        ? Math.max(9, Math.min(30, onboardState.liveBusSpeedKmh * 0.5 + corridorKmh * 0.5))
        : corridorKmh;
    const etaMin = Math.max(1, Math.round((remainToActionM / 1000) / effectiveEtaKmh * 60));

    if (routeBar) routeBar.style.background = pt.routeColor;
    if (routeNameEl) routeNameEl.textContent = pt.routeName;
    if (badgeEl) badgeEl.textContent = onboardState.source === 'gps' ? 'GPS EN VIVO' : 'VOY A BORDO';
    if (fillEl) fillEl.style.width = `${pct.toFixed(1)}%`;

    const upcomingStop = onboardState.stopsTimeline.find((s) => s.cumM > distM + 40 && s.legIdx === pt.legIdx);
    const isArrived = distM >= total - 35;
    const isNearAction = remainToActionM <= 300;
    const destLabel = inFirstLeg
        ? `Transbordo ${opt.transferLabel ? `${opt.transferLabel} ` : ''}(${opt.routeB.name.trim()})`
        : (opt.alightLabel || (selectedDestination ? selectedDestination.name : 'tu destino'));

    let nextStopText = '';
    if (isArrived) {
        nextStopText = `Llegaste cerca de ${opt.alightLabel || 'tu destino'}`;
    } else if (isNearAction) {
        nextStopText = inFirstLeg
            ? `Prepárate para transbordar (${remainToActionM} m)`
            : `¡Prepárate para bajar! (${remainToActionM} m)`;
    } else if (upcomingStop) {
        const toNext = Math.max(20, Math.round(upcomingStop.cumM - distM));
        nextStopText = `Próx: ${upcomingStop.name} (${formatOnboardDistance(toNext)})`;
    } else {
        nextStopText = inFirstLeg
            ? `Rumbo a transbordo (${formatOnboardDistance(remainToActionM)})`
            : `Rumbo a descenso (${formatOnboardDistance(remainToActionM)})`;
    }

    if (nextStopEl) {
        nextStopEl.classList.toggle('alert-near', isNearAction && !isArrived);
        nextStopEl.textContent = upcomingStop && !isArrived && !isNearAction
            ? nextStopText.replace('Próx:', 'Próx. parada:')
            : nextStopText;
    }

    if (alightEl) {
        if (isArrived) {
            alightEl.textContent = 'Recorrido completado · Puedes finalizar el seguimiento';
        } else if (inFirstLeg) {
            const trPlace = opt.transferLabel ? `${opt.transferLabel} · ` : '';
            alightEl.textContent = `Transbordo (${trPlace}${opt.routeB.name.trim()}) en ${formatOnboardDistance(remainToActionM)} (~${etaMin} min)`;
        } else {
            alightEl.textContent = `Tu bajada (${destLabel}) en ${formatOnboardDistance(remainToActionM)} (~${etaMin} min)`;
        }
    }

    onboardState.hudSnapshot = {
        routeName: pt.routeName,
        routeColor: pt.routeColor || '#E63E21',
        pct,
        remainToActionM,
        etaMin,
        nextStopShort: nextStopText,
        destLabel,
        isNearAction,
        isArrived,
        inFirstLeg
    };

    if (inFirstLeg && isNearAction && !onboardState.notifiedNearLeg) {
        onboardState.notifiedNearLeg = true;
        showToast('Próximo transbordo en menos de 300 m');
        if (onboardState.alarmEnabled) {
            if (navigator.vibrate) navigator.vibrate([160, 80, 160]);
            if (typeof playDropoffChime === 'function') playDropoffChime(false);
        }
    }
    if (!inFirstLeg && isNearAction && !isArrived && !onboardState.notifiedNearEnd) {
        onboardState.notifiedNearEnd = true;
        showToast('¡Prepárate para bajar! Tu parada está a menos de 300 m');
        if (onboardState.alarmEnabled) {
            if (navigator.vibrate) navigator.vibrate([220, 90, 220, 90, 280]);
            if (typeof playDropoffChime === 'function') playDropoffChime(true);
            if (typeof syncOnboardSystemNotification === 'function') {
                syncOnboardSystemNotification(true);
            }
        }
    }
    if (onboardState.bgNotifEnabled || document.hidden) {
        if (typeof syncOnboardSystemNotification === 'function') {
            syncOnboardSystemNotification(false);
        }
    }
    syncOnboardHudViewportOffset();
}

function clearOnboardTimers() {
    if (onboardState.timerId) {
        clearInterval(onboardState.timerId);
        onboardState.timerId = null;
    }
    if (onboardState.bgPollTimerId) {
        clearInterval(onboardState.bgPollTimerId);
        onboardState.bgPollTimerId = null;
    }
    if (onboardState.watchId != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(onboardState.watchId);
        onboardState.watchId = null;
    }
    if (onboardState.wakeLockSentinel) {
        onboardState.wakeLockSentinel.release().catch(() => {});
        onboardState.wakeLockSentinel = null;
    }
}

function canUseOnboardSimulation() {
    const host = window.location.hostname || '';
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    const hasSimParam = new URLSearchParams(window.location.search).get('sim') === '1';
    const isAdmin = typeof Auth !== 'undefined' && Auth.user && Auth.user.role === 'ROLE_ADMIN';
    return isLocalHost || hasSimParam || isAdmin;
}

function shouldDefaultOnboardToSim() {
    const host = window.location.hostname || '';
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    const hasSimParam = new URLSearchParams(window.location.search).get('sim') === '1';
    return isLocalHost || hasSimParam;
}

function startOnboardSimulationLoop() {
    clearOnboardTimers();
    const stepBaseM = Math.max(18, onboardState.totalDistM / 180);
    onboardState.timerId = setInterval(() => {
        if (!onboardState.active || onboardState.paused || onboardState.source !== 'sim') return;
        onboardState.currentDistM = Math.min(
            onboardState.totalDistM,
            onboardState.currentDistM + stepBaseM * onboardState.speedMultiplier
        );
        updateOnboardHudAtDistance(onboardState.currentDistM);
        if (onboardState.currentDistM >= onboardState.totalDistM) {
            onboardState.paused = true;
            const playBtn = document.getElementById('onboard-play-btn');
            if (playBtn) playBtn.textContent = 'Reiniciar';
        }
    }, 250);
}

function projectCoordOntoJourney(lat, lng) {
    let bestDist = Infinity;
    let bestCumM = 0;
    onboardState.points.forEach((p) => {
        const d = calculateDistanceMeters(lat, lng, p.lat, p.lng);
        if (d < bestDist) {
            bestDist = d;
            bestCumM = p.cumM;
        }
    });
    return { bestCumM, offsetM: bestDist };
}

let onboardHudResizeObserver = null;

function applyOnboardHudViewportOffsetNow() {
    const hud = document.getElementById('onboard-hud');
    if (!hud || hud.style.display === 'none') {
        document.body.classList.remove('onboard-active');
        document.documentElement.style.removeProperty('--onboard-hud-bottom');
        return;
    }
    document.body.classList.add('onboard-active');
    const rect = hud.getBoundingClientRect();
    if (rect && rect.bottom > 0) {
        document.documentElement.style.setProperty('--onboard-hud-bottom', `${Math.ceil(rect.bottom)}px`);
    }
}

function syncOnboardHudViewportOffset() {
    const hud = document.getElementById('onboard-hud');
    if (hud && typeof ResizeObserver === 'function' && !onboardHudResizeObserver) {
        onboardHudResizeObserver = new ResizeObserver(() => {
            applyOnboardHudViewportOffsetNow();
        });
        onboardHudResizeObserver.observe(hud);
    }
    applyOnboardHudViewportOffsetNow();
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => applyOnboardHudViewportOffsetNow());
    }
}

function setOnboardWaitingGpsHud(message) {
    const nextStopEl = document.getElementById('onboard-next-stop');
    const alightEl = document.getElementById('onboard-alight-info');
    if (nextStopEl) {
        nextStopEl.classList.remove('alert-near');
        nextStopEl.textContent = message || 'Buscando tu ubicación GPS...';
    }
    if (alightEl) {
        alightEl.textContent = 'Activa el permiso de ubicación para seguir tu viaje en tiempo real';
    }
    syncOnboardHudViewportOffset();
}

function confirmStoppingActiveOnboardTrip(actionLabel = 'cambiar de ruta') {
    if (!onboardState.active) return true;
    if (onboardState.currentDistM >= Math.max(0, onboardState.totalDistM - 35)) return true;
    const activeRoute = document.getElementById('onboard-route-name')?.textContent || 'tu ruta actual';
    return window.confirm(`Vas a bordo de "${activeRoute}". ¿Deseas finalizar este seguimiento para ${actionLabel}?`);
}

function processOnboardGpsPosition(pos) {
    if (!onboardState.active || onboardState.source !== 'gps' || !pos || !pos.coords) return;
    const { latitude, longitude, speed } = pos.coords;
    const distMazatlan = calculateDistanceMeters(latitude, longitude, 23.2329, -106.4062);
    if (distMazatlan > 60000) {
        if (!onboardState.notifiedFarFromRoute) {
            onboardState.notifiedFarFromRoute = true;
            showToast('Tu GPS ubicó fuera de Mazatlán; el seguimiento en ruta requiere estar dentro de la ciudad.', 'error');
        }
        setOnboardWaitingGpsHud('GPS fuera de Mazatlán');
        return;
    }

    const nowMs = Date.now();
    const proj = projectCoordOntoJourney(latitude, longitude);
    if (proj.offsetM > 8000 && !onboardState.notifiedFarFromRoute) {
        onboardState.notifiedFarFromRoute = true;
        showToast(`Tu ubicación está lejos de esta ruta (${formatOnboardDistance(proj.offsetM)}).`);
    }

    let measuredKmh = null;
    if (typeof speed === 'number' && isFinite(speed) && speed >= 0.6 && speed <= 20) {
        measuredKmh = speed * 3.6;
    } else if (onboardState.lastGpsFix) {
        const dtSec = (nowMs - onboardState.lastGpsFix.tsMs) / 1000;
        if (dtSec >= 5 && dtSec <= 90) {
            const stepM = calculateDistanceMeters(
                onboardState.lastGpsFix.lat,
                onboardState.lastGpsFix.lng,
                latitude,
                longitude
            );
            if (stepM >= 15) {
                const calcKmh = (stepM / dtSec) * 3.6;
                if (calcKmh >= 2 && calcKmh <= 68) {
                    measuredKmh = calcKmh;
                }
            }
        }
    }
    onboardState.lastGpsFix = { lat: latitude, lng: longitude, tsMs: nowMs };

    if (measuredKmh !== null && proj.offsetM <= 85) {
        const clamped = Math.max(9, Math.min(34, measuredKmh));
        onboardState.liveBusSpeedKmh = onboardState.liveBusSpeedKmh
            ? (onboardState.liveBusSpeedKmh * 0.55 + clamped * 0.45)
            : clamped;

        if (nowMs - onboardState.lastTelemetrySentMs >= 25000 && typeof Api.sendTrafficTelemetry === 'function') {
            onboardState.lastTelemetrySentMs = nowMs;
            Api.sendTrafficTelemetry(latitude, longitude, Math.round(measuredKmh * 10) / 10);
        }
    }

    onboardState.currentDistM = proj.bestCumM;
    updateOnboardHudAtDistance(onboardState.currentDistM);
    renderOnboardBusMarker(latitude, longitude, '#005C97');
}

function startOnboardGpsWatch() {
    clearOnboardTimers();
    const simAllowed = canUseOnboardSimulation();
    if (!navigator.geolocation) {
        if (simAllowed) {
            showToast('Tu navegador no soporta GPS en vivo; usando simulación.', 'error');
            setOnboardTrackingSource('sim');
        } else {
            showToast('Tu navegador no soporta GPS en vivo.', 'error');
            setOnboardWaitingGpsHud('GPS no disponible en este navegador');
        }
        return;
    }
    if (window.isSecureContext === false) {
        if (simAllowed) {
            showToast('En celular sin HTTPS el GPS está bloqueado; puedes usar Simular.', 'error');
            setOnboardTrackingSource('sim');
        } else {
            showToast('Se requiere conexión segura (HTTPS) para usar GPS en vivo.', 'error');
            setOnboardWaitingGpsHud('GPS bloqueado sin HTTPS');
        }
        return;
    }
    if (navigator.wakeLock && typeof navigator.wakeLock.request === 'function') {
        navigator.wakeLock.request('screen').then((s) => {
            onboardState.wakeLockSentinel = s;
        }).catch(() => {});
    }
    setOnboardWaitingGpsHud('Buscando tu ubicación GPS...');
    showToast('GPS en vivo activado para tu viaje');
    onboardState.watchId = navigator.geolocation.watchPosition(
        processOnboardGpsPosition,
        (err) => {
            const msg = getGeolocationErrorMessage(err);
            showToast(simAllowed ? `${msg} Puedes usar Simular.` : `${msg} Revisa los permisos de ubicación.`, 'error');
            setOnboardWaitingGpsHud('Esperando señal GPS...');
        },
        { enableHighAccuracy: true, maximumAge: 4000, timeout: 7000 }
    );
    onboardState.bgPollTimerId = setInterval(() => {
        if (!onboardState.active || onboardState.source !== 'gps') return;
        const lastAge = onboardState.lastGpsFix ? (Date.now() - onboardState.lastGpsFix.tsMs) : Infinity;
        if (lastAge >= 6000) {
            navigator.geolocation.getCurrentPosition(
                processOnboardGpsPosition,
                () => {},
                { enableHighAccuracy: true, maximumAge: 4000, timeout: 5500 }
            );
        } else if (onboardState.bgNotifEnabled || document.hidden) {
            syncOnboardSystemNotification(false);
        }
    }, 8000);
}

function startOnboardTrip(optionIdx) {
    const opt = window._tripComputedOptions && window._tripComputedOptions[optionIdx];
    if (!opt) return;
    if (onboardState.active && !confirmStoppingActiveOnboardTrip('cambiar al nuevo recorrido')) {
        return;
    }

    viewTripOptionOnMap(opt);
    const journey = buildOnboardJourneyData(opt);
    if (!journey.points || journey.points.length < 2) {
        showToast('No hay trazo suficiente para iniciar el seguimiento a bordo', 'error');
        return;
    }

    stopOnboardTrip({ silent: true });

    const simAllowed = canUseOnboardSimulation();
    const initialSource = (simAllowed && shouldDefaultOnboardToSim()) ? 'sim' : 'gps';

    onboardState.active = true;
    onboardState.option = opt;
    onboardState.points = journey.points;
    onboardState.totalDistM = journey.totalDistM;
    onboardState.legSplitM = journey.legSplitM;
    onboardState.stopsTimeline = journey.stopsTimeline;
    onboardState.currentDistM = 0;
    onboardState.paused = false;
    onboardState.speedMultiplier = 1;
    onboardState.source = initialSource;
    onboardState.notifiedNearLeg = false;
    onboardState.notifiedNearEnd = false;
    onboardState.notifiedFarFromRoute = false;
    onboardState.corridorTrafficSpeedKmh = (opt.trafficInfo && opt.trafficInfo.effectiveSpeedKmh)
        ? opt.trafficInfo.effectiveSpeedKmh
        : 22;
    onboardState.liveBusSpeedKmh = null;
    onboardState.lastGpsFix = null;

    const hud = document.getElementById('onboard-hud');
    const playBtn = document.getElementById('onboard-play-btn');
    const speedBtn = document.getElementById('onboard-speed-btn');
    const controlsRow = document.querySelector('#onboard-hud .onboard-controls-row');
    if (playBtn) playBtn.textContent = 'Pausar';
    if (speedBtn) speedBtn.textContent = '1x';
    if (controlsRow) controlsRow.style.display = simAllowed ? 'flex' : 'none';
    if (hud) hud.style.display = 'block';

    setOnboardTrackingSource(initialSource);
    syncOnboardHudViewportOffset();
    if (isMobileViewport()) setMobileSheetState('peek');
}

function setOnboardTrackingSource(source) {
    const simAllowed = canUseOnboardSimulation();
    onboardState.source = (source === 'sim' && simAllowed) ? 'sim' : 'gps';
    const simPill = document.getElementById('onboard-src-sim');
    const gpsPill = document.getElementById('onboard-src-gps');
    const simCtrls = document.getElementById('onboard-sim-controls');
    const controlsRow = document.querySelector('#onboard-hud .onboard-controls-row');
    if (controlsRow) controlsRow.style.display = simAllowed ? 'flex' : 'none';
    if (simPill) simPill.classList.toggle('active', onboardState.source === 'sim');
    if (gpsPill) gpsPill.classList.toggle('active', onboardState.source === 'gps');
    if (simCtrls) simCtrls.style.display = (simAllowed && onboardState.source === 'sim') ? 'inline-flex' : 'none';

    if (!onboardState.active) return;
    if (onboardState.source === 'gps') {
        updateOnboardHudAtDistance(onboardState.currentDistM);
        startOnboardGpsWatch();
    } else {
        startOnboardSimulationLoop();
        updateOnboardHudAtDistance(onboardState.currentDistM);
    }
    syncOnboardHudViewportOffset();
}

function toggleOnboardPlayPause() {
    if (!onboardState.active || onboardState.source !== 'sim') return;
    const playBtn = document.getElementById('onboard-play-btn');
    if (onboardState.currentDistM >= onboardState.totalDistM) {
        onboardState.currentDistM = 0;
        onboardState.paused = false;
        onboardState.notifiedNearLeg = false;
        onboardState.notifiedNearEnd = false;
        updateOnboardHudAtDistance(0);
        if (playBtn) playBtn.textContent = 'Pausar';
        return;
    }
    onboardState.paused = !onboardState.paused;
    if (playBtn) playBtn.textContent = onboardState.paused ? 'Reanudar' : 'Pausar';
}

function cycleOnboardSpeed() {
    const order = [1, 2, 4];
    const nextIdx = (order.indexOf(onboardState.speedMultiplier) + 1) % order.length;
    onboardState.speedMultiplier = order[nextIdx];
    const speedBtn = document.getElementById('onboard-speed-btn');
    if (speedBtn) speedBtn.textContent = `${onboardState.speedMultiplier}x`;
}

function stopOnboardTrip({ silent = false } = {}) {
    clearOnboardTimers();
    const wasActive = onboardState.active;
    onboardState.active = false;
    onboardState.option = null;
    onboardState.points = [];
    if (typeof closeOnboardSystemNotification === 'function') closeOnboardSystemNotification();
    onboardState.bgNotifEnabled = false;
    const bgBtn = document.getElementById('onboard-bg-notif-btn');
    if (bgBtn) {
        bgBtn.classList.remove('active');
        bgBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg> Avisar en barra: OFF';
    }
    if (onboardState.busMarker && mapInstance) {
        mapInstance.removeLayer(onboardState.busMarker);
        onboardState.busMarker = null;
    }
    const hud = document.getElementById('onboard-hud');
    if (hud) hud.style.display = 'none';
    syncOnboardHudViewportOffset();
    if (!silent && wasActive) {
        showToast('Seguimiento a bordo finalizado');
    }
}

window.startOnboardTrip = startOnboardTrip;
window.stopOnboardTrip = stopOnboardTrip;
window.setOnboardTrackingSource = setOnboardTrackingSource;
window.toggleOnboardPlayPause = toggleOnboardPlayPause;
window.cycleOnboardSpeed = cycleOnboardSpeed;

// ----------------------------------------------------------
// APARTADO DE DONACIONES ("APOYAR A DON RUTERO")
// ----------------------------------------------------------
// Personaliza aquí tus datos reales antes de publicar en producción
const DONATION_CONFIG = {
    bankName: 'NU (ambas opciones)',
    beneficiary: 'Kevin Tirado · Don Rutero Mazatlán',
    clabe: '638180000143752374',
    cardNumber: '5101 2581 6612 8833',
    externalLabel: 'Donar en línea (Mercado Pago)',
    externalUrl: 'https://link.mercadopago.com.mx/donrutero'
};

function isPlaceholderDigits(val) {
    const digits = String(val || '').replace(/\s+/g, '');
    return !digits || /^0+$/.test(digits);
}

function openDonationModal({ fromMenu = false } = {}) {
    if (fromMenu && typeof toggleMainMenu === 'function') {
        toggleMainMenu(false);
    }
    const modal = document.getElementById('donation-modal');
    if (!modal) return;

    const bankEl = document.getElementById('donate-bank-name');
    const benEl = document.getElementById('donate-beneficiary');
    const clabeEl = document.getElementById('donate-clabe');
    const cardEl = document.getElementById('donate-card-number');
    const cardRow = document.getElementById('donate-card-row');
    const extLabelEl = document.getElementById('donate-external-label');
    const hintEl = document.getElementById('donate-config-hint');

    if (bankEl) bankEl.textContent = DONATION_CONFIG.bankName;
    if (benEl) benEl.textContent = DONATION_CONFIG.beneficiary;
    if (clabeEl) clabeEl.textContent = DONATION_CONFIG.clabe;
    if (cardRow) {
        cardRow.style.display = DONATION_CONFIG.cardNumber ? 'flex' : 'none';
    }
    if (cardEl) cardEl.textContent = DONATION_CONFIG.cardNumber || '';
    if (extLabelEl) extLabelEl.textContent = DONATION_CONFIG.externalLabel;

    const hasRealClabe = !isPlaceholderDigits(DONATION_CONFIG.clabe);
    const hasRealUrl = typeof DONATION_CONFIG.externalUrl === 'string' && DONATION_CONFIG.externalUrl.startsWith('https://');
    if (hintEl) {
        hintEl.style.display = (!hasRealClabe && !hasRealUrl) ? 'block' : 'none';
    }

    modal.style.display = 'flex';
}

async function copyDonationDigits(rawVal, label) {
    if (isPlaceholderDigits(rawVal)) {
        showToast('Configura tu ' + label + ' real en DONATION_CONFIG (js/app.js)', 'error');
        return;
    }
    const clean = String(rawVal).replace(/\s+/g, '');
    try {
        await navigator.clipboard.writeText(clean);
        showToast(`${label} copiada al portapapeles`);
    } catch (_) {
        showToast('No se pudo copiar automáticamente', 'error');
    }
}

function setupDonationListeners() {
    const navBtn = document.getElementById('btn-donate-nav');
    const menuBtn = document.getElementById('menu-donate-btn');
    const modal = document.getElementById('donation-modal');
    const closeBtn = document.getElementById('donation-modal-close');
    const copyClabeBtn = document.getElementById('btn-copy-clabe');
    const copyCardBtn = document.getElementById('btn-copy-card');
    const extBtn = document.getElementById('btn-donate-external');

    if (navBtn) navBtn.addEventListener('click', () => openDonationModal());
    if (menuBtn) {
        menuBtn.addEventListener('click', () => openDonationModal({ fromMenu: true }));
        menuBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openDonationModal({ fromMenu: true });
            }
        });
    }
    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    }

    if (copyClabeBtn) {
        copyClabeBtn.addEventListener('click', () => copyDonationDigits(DONATION_CONFIG.clabe, 'CLABE'));
    }
    if (copyCardBtn) {
        copyCardBtn.addEventListener('click', () => copyDonationDigits(DONATION_CONFIG.cardNumber, 'Tarjeta'));
    }
    if (extBtn) {
        extBtn.addEventListener('click', () => {
            const url = (DONATION_CONFIG.externalUrl || '').trim();
            if (!url.startsWith('https://')) {
                showToast('Agrega tu enlace https:// de Mercado Pago, PayPal o Ko-fi en DONATION_CONFIG (js/app.js)', 'error');
                return;
            }
            window.open(url, '_blank', 'noopener,noreferrer');
        });
    }
}

window.openDonationModal = openDonationModal;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initTrafficModule();
        initCommunityPulse();
        renderPlannerShortcuts();
        setupOnboardBackgroundListeners();
    });
} else {
    initTrafficModule();
    initCommunityPulse();
    renderPlannerShortcuts();
    setupOnboardBackgroundListeners();
}

// ----------------------------------------------------------
// MÓDULO DE TRÁFICO EN TIEMPO REAL Y AJUSTE DE TIEMPOS
// ----------------------------------------------------------
const TrafficState = {
    enabled: false,
    data: null,
    lastFetchMs: 0,
    refreshTimer: null
};

async function loadTrafficSummary({ force = false } = {}) {
    const now = Date.now();
    if (!force && TrafficState.data && (now - TrafficState.lastFetchMs) < 90000) {
        return TrafficState.data;
    }
    try {
        if (typeof Api !== 'undefined' && typeof Api.getLiveTraffic === 'function') {
            const payload = await Api.getLiveTraffic();
            TrafficState.data = payload;
            TrafficState.lastFetchMs = Date.now();
            updateTrafficUiControls();
            if (TrafficState.enabled && typeof renderTrafficOverlay === 'function') {
                renderTrafficOverlay(TrafficState.data, true);
            }
        }
    } catch (err) {
        console.warn('No se pudo obtener estado de tráfico:', err && err.message ? err.message : err);
    }
    return TrafficState.data;
}

function getTrafficSourceHumanLabel(data) {
    if (!data) return '';
    if (data.source === 'tomtom_y_gps') return 'TomTom + GPS en vivo Don Rutero';
    if (data.source === 'tomtom') return 'TomTom Traffic en vivo';
    if (data.source === 'gps_comunitario') return 'GPS en vivo Don Rutero + horario';
    return 'Estimación por horario de Mazatlán';
}

function updateTrafficUiControls() {
    const btn = document.getElementById('fab-traffic');
    const dot = document.getElementById('traffic-status-dot');
    const legend = document.getElementById('traffic-legend');
    const periodEl = document.getElementById('traffic-legend-period');
    const speedEl = document.getElementById('traffic-legend-speed');
    const srcEl = document.getElementById('traffic-legend-source');

    const data = TrafficState.data;
    const level = (data && data.overallLevel) || 'fluido';
    if (btn) {
        btn.classList.toggle('active', TrafficState.enabled);
        btn.setAttribute('aria-pressed', TrafficState.enabled ? 'true' : 'false');
    }
    if (dot) {
        dot.className = `traffic-status-dot level-${level === 'lento' ? 'lento' : level === 'moderado' ? 'moderado' : 'fluido'}`;
    }
    if (legend) {
        legend.style.display = TrafficState.enabled ? 'block' : 'none';
        if (TrafficState.enabled && data) {
            if (periodEl) periodEl.textContent = data.periodLabel || 'Flujo en Mazatlán';
            if (speedEl) speedEl.textContent = data.avgBusSpeedKmh ? `~${Number(data.avgBusSpeedKmh).toFixed(0)} km/h` : '';
            if (srcEl) srcEl.textContent = getTrafficSourceHumanLabel(data);
        }
    }
}

async function toggleTrafficLayer() {
    TrafficState.enabled = !TrafficState.enabled;
    if (TrafficState.enabled) {
        await loadTrafficSummary({ force: !TrafficState.data });
    }
    updateTrafficUiControls();
    if (typeof renderTrafficOverlay === 'function') {
        renderTrafficOverlay(TrafficState.data, TrafficState.enabled);
    }
    if (TrafficState.enabled && TrafficState.data) {
        showToast(`${TrafficState.data.periodLabel || 'Tráfico'} · ${getTrafficSourceHumanLabel(TrafficState.data)}`);
    }
}

function computeRouteTrafficMetrics(travelCoords, busMeters) {
    const baseBusKmh = 21.9;
    const data = TrafficState.data;
    if (!data || !Array.isArray(data.corridors) || data.corridors.length === 0) {
        return { effectiveSpeedKmh: baseBusKmh, delayMin: 0, level: 'fluido' };
    }

    const coords = Array.isArray(travelCoords) ? travelCoords : [];
    const corridors = data.corridors;
    const cells = Array.isArray(data.communityCells) ? data.communityCells : [];

    let weightedSpeedSum = 0;
    let weightedFreeSum = 0;
    let matchedSamples = 0;

    if (coords.length > 0) {
        const step = Math.max(1, Math.floor(coords.length / 26));
        for (let i = 0; i < coords.length; i += step) {
            const p = coords[i];
            if (!p || typeof p.latitude !== 'number' || typeof p.longitude !== 'number') continue;

            let bestCorr = null;
            let bestDist = Infinity;
            for (const c of corridors) {
                if (!Array.isArray(c.points)) continue;
                for (const cp of c.points) {
                    const d = calculateDistanceMeters(p.latitude, p.longitude, cp[0], cp[1]);
                    if (d < bestDist) {
                        bestDist = d;
                        bestCorr = c;
                    }
                }
            }
            if (bestCorr && bestDist <= 750) {
                weightedSpeedSum += Number(bestCorr.speedKmh) || baseBusKmh;
                weightedFreeSum += Number(bestCorr.freeFlowBusKmh) || 24;
                matchedSamples++;
            } else {
                for (const cell of cells) {
                    if (calculateDistanceMeters(p.latitude, p.longitude, cell.lat, cell.lng) <= 500) {
                        weightedSpeedSum += Number(cell.speedKmh) || baseBusKmh;
                        weightedFreeSum += 23;
                        matchedSamples++;
                        break;
                    }
                }
            }
        }
    }

    let effectiveKmh;
    let freeKmh;
    if (matchedSamples > 0) {
        const matchedAvg = weightedSpeedSum / matchedSamples;
        const matchedFree = weightedFreeSum / matchedSamples;
        const coverage = Math.min(1, matchedSamples / 5);
        effectiveKmh = matchedAvg * coverage + (Number(data.avgBusSpeedKmh) || baseBusKmh) * (1 - coverage);
        freeKmh = matchedFree * coverage + 23.5 * (1 - coverage);
    } else {
        effectiveKmh = (Number(data.avgBusSpeedKmh) || baseBusKmh) * 0.55 + baseBusKmh * 0.45;
        freeKmh = 23.0;
    }

    effectiveKmh = Math.max(9.0, Math.min(26.0, Math.round(effectiveKmh * 10) / 10));
    let delayMin = 0;
    if (busMeters && isFinite(busMeters) && busMeters > 200) {
        const freeMin = (busMeters / 1000) / Math.max(18, freeKmh) * 60;
        const currMin = (busMeters / 1000) / effectiveKmh * 60;
        delayMin = Math.max(0, Math.round(currMin - freeMin));
    }

    const level = (effectiveKmh < 14.5 || delayMin >= 5) ? 'lento'
        : (effectiveKmh < 18.5 || delayMin >= 2) ? 'moderado'
        : 'fluido';

    return { effectiveSpeedKmh: effectiveKmh, delayMin, level };
}

function formatTripTrafficSummaryHtml() {
    const data = TrafficState.data;
    if (!data) return '';
    const dotColor = data.overallLevel === 'lento' ? '#EF4444'
        : data.overallLevel === 'moderado' ? '#F59E0B' : '#10B981';
    const srcText = getTrafficSourceHumanLabel(data);
    return `
        <div class="trip-traffic-summary">
            <span style="display:inline-flex;align-items:center;gap:6px;font-weight:700;color:var(--text-primary);">
                <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};display:inline-block;"></span>
                ${escapeUserHtml(data.periodLabel || 'Tráfico actual')}
            </span>
            <span style="font-size:0.7rem;color:var(--text-muted);">${escapeUserHtml(srcText)}</span>
        </div>
    `;
}

function formatOptionTrafficBadgeHtml(trafficInfo) {
    if (!trafficInfo) return '';
    if (trafficInfo.level === 'lento') {
        const extra = trafficInfo.delayMin > 0 ? ` (+${trafficInfo.delayMin} min)` : '';
        return `<span class="trip-traffic-pill lento">Tráfico lento${extra}</span>`;
    }
    if (trafficInfo.level === 'moderado') {
        const extra = trafficInfo.delayMin > 0 ? ` (+${trafficInfo.delayMin} min)` : '';
        return `<span class="trip-traffic-pill moderado">Moderado${extra}</span>`;
    }
    return TrafficState.enabled ? `<span class="trip-traffic-pill fluido">Fluido</span>` : '';
}

function initTrafficModule() {
    loadTrafficSummary();
    if (TrafficState.refreshTimer) clearInterval(TrafficState.refreshTimer);
    TrafficState.refreshTimer = setInterval(() => {
        if (TrafficState.enabled || document.getElementById('tab-planificador')?.classList.contains('active')) {
            loadTrafficSummary({ force: true });
        }
    }, 120000);
}

window.toggleTrafficLayer = toggleTrafficLayer;

// ----------------------------------------------------------
// MÓDULO DE PULSO COMUNITARIO, AVISOS VIVOS Y GUÍAS MAZATLÁN
// ----------------------------------------------------------
const ZONE_CENTER_PRESETS = {
    malecon: { label: 'Malecón (Av. Del Mar)', lat: 23.2247, lng: -106.4259 },
    buelna: { label: 'Av. Rafael Buelna', lat: 23.2442, lng: -106.4345 },
    ejercito: { label: 'Av. Ejército Mexicano', lat: 23.2285, lng: -106.4205 },
    insurgentes: { label: 'Av. Insurgentes', lat: 23.2318, lng: -106.4092 },
    sabalo: { label: 'Zona Dorada / Sábalo', lat: 23.2655, lng: -106.4648 },
    leyva: { label: 'Av. Gabriel Leyva', lat: 23.2148, lng: -106.4060 },
    centro: { label: 'Centro / Mercado Pino Suárez', lat: 23.2041, lng: -106.4218 },
    colosio: { label: 'Blvd. Colosio', lat: 23.2452, lng: -106.3953 },
    mex15: { label: 'Carretera Internacional / MEX 15', lat: 23.2585, lng: -106.4182 },
    marina: { label: 'Av. de la Marina', lat: 23.2758, lng: -106.4487 },
    cerritos: { label: 'Cerritos / Av. Sábalo Cerritos', lat: 23.2725, lng: -106.4665 },
    reforma: { label: 'Av. Reforma / Gran Plaza', lat: 23.2401, lng: -106.4367 },
    gutierrez_najera: { label: 'Av. Gutiérrez Nájera', lat: 23.2111, lng: -106.4199 },
    munich: { label: 'Av. Múnich / Juan Pablo II', lat: 23.2545, lng: -106.3940 },
    juarez: { label: 'Col. Benito Juárez', lat: 23.2295, lng: -106.4054 },
    pradera_dorada: { label: 'Pradera Dorada / Villa Verde', lat: 23.2682, lng: -106.3745 },
    urias: { label: 'Urías / Sur', lat: 23.2175, lng: -106.3765 },
    escobosa: { label: 'Av. Óscar Pérez Escobosa', lat: 23.2923, lng: -106.4524 }
};

const PulseState = {
    data: null,
    sightings: {},
    activeNotices: [],
    incidents: [],
    dismissedBannerIds: new Set(),
    pollTimer: null
};

async function loadLivePulse() {
    try {
        if (typeof Api === 'undefined' || typeof Api.getLivePulse !== 'function') return null;
        const data = await Api.getLivePulse();
        PulseState.data = data;
        PulseState.activeNotices = Array.isArray(data.activeNotices) ? data.activeNotices : [];
        PulseState.incidents = Array.isArray(data.incidents) ? data.incidents : [];
        PulseState.sightings = data.sightingsByRoute || {};

        updateNotificationsBadgeAndFeed();
        renderCityLiveBanner();
        if (typeof renderPulseMarkers === 'function') {
            renderPulseMarkers(data);
        }
        if (typeof window._refreshActiveSightingStatus === 'function') {
            window._refreshActiveSightingStatus();
        }
        if (currentFilter !== 'guias' && Array.isArray(allRoutes) && allRoutes.length > 0 && !document.getElementById('detail-panel')?.classList.contains('visible')) {
            document.querySelectorAll('.route-card[data-id]').forEach((card) => {
                const rid = card.getAttribute('data-id');
                const sub = card.querySelector('.route-submeta');
                if (!sub) return;
                const oldBadge = sub.querySelector('.route-pulse-badge');
                const s = PulseState.sightings[String(rid)];
                if (s) {
                    const text = `● Pasó hace ${Number(s.minutesAgo) <= 0 ? '<1' : Number(s.minutesAgo)} min`;
                    if (oldBadge) {
                        oldBadge.textContent = text;
                    } else {
                        const span = document.createElement('span');
                        span.className = 'route-pulse-badge';
                        span.title = 'Reportado por pasajero de Don Rutero';
                        span.textContent = text;
                        const distBadge = sub.querySelector('.distance-badge');
                        if (distBadge) sub.insertBefore(span, distBadge);
                        else sub.appendChild(span);
                    }
                } else if (oldBadge) {
                    oldBadge.remove();
                }
            });
        }
        return data;
    } catch (err) {
        console.warn('No se pudo actualizar pulso comunitario:', err && err.message ? err.message : err);
        return null;
    }
}

function updateNotificationsBadgeAndFeed() {
    const badge = document.getElementById('notif-badge');
    const liveList = document.getElementById('notifications-live-list');
    const incList = document.getElementById('pulse-incidents-list');

    const totalAlertCount = PulseState.activeNotices.length;
    if (badge) {
        badge.textContent = totalAlertCount > 9 ? '9+' : String(totalAlertCount);
        badge.style.display = totalAlertCount > 0 ? 'inline-flex' : 'none';
    }

    if (liveList) {
        if (PulseState.activeNotices.length === 0) {
            liveList.innerHTML = '<div class="pulse-empty-hint">Sin bloqueos ni avisos urgentes activos en este momento.</div>';
        } else {
            liveList.innerHTML = PulseState.activeNotices.map((n) => {
                const isAuto = n.origin === 'auto_comunidad';
                const sev = n.severity === 'danger' ? 'danger' : (n.severity === 'warning' ? 'warning' : 'info');
                const tag = isAuto ? `Comunidad · ${Number(n.reportCount || 3)} reportes` : 'Aviso Don Rutero';
                const clearBtn = isAuto
                    ? `<button type="button" class="btn-pulse-clear" onclick="confirmNoticeClearFromUi(${Number(n.id)})">Ya está todo bien${Number(n.clearCount || 0) > 0 ? ` (${Number(n.clearCount)}/2)` : ''}</button>`
                    : '';
                return `
                    <div class="live-notice-card sev-${sev}">
                        <div class="live-notice-top">
                            <span class="live-notice-origin">${escapeUserHtml(tag)}</span>
                            <span class="live-notice-zone">${escapeUserHtml(n.zoneLabel || 'Mazatlán')}</span>
                        </div>
                        <h4 class="live-notice-title">${escapeUserHtml(n.title)}</h4>
                        <p class="live-notice-body">${escapeUserHtml(n.body)}</p>
                        ${clearBtn ? `<div class="live-notice-actions">${clearBtn}</div>` : ''}
                    </div>
                `;
            }).join('');
        }
    }

    if (incList) {
        const pendingIncidents = PulseState.incidents.filter((i) => !i.escalated);
        if (pendingIncidents.length === 0) {
            incList.innerHTML = '';
        } else {
            incList.innerHTML = pendingIncidents.map((inc) => {
                const actionKey = inc.incidentKey || inc.zoneKey;
                const typeTag = inc.typeLabel ? `<span>${escapeUserHtml(inc.typeLabel)}</span> · ` : '';
                return `
                <div class="pulse-pending-item">
                    <div style="min-width:0;">
                        <strong>${escapeUserHtml(inc.zoneLabel)}</strong> · ${typeTag}${escapeUserHtml(inc.description)}
                        <span class="pulse-progress-pill">${Number(inc.distinctReporters)}/${Number(inc.threshold || 3)}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                        <button type="button" class="pulse-mini-link" onclick="confirmIncidentMatchFromUi('${escapeUserHtml(actionKey)}')">+1 Yo igual</button>
                        <button type="button" class="pulse-mini-link" onclick="confirmZoneClearFromUi('${escapeUserHtml(actionKey)}')">Ya está libre</button>
                    </div>
                </div>
            `;
            }).join('');
        }
    }
}

function renderCityLiveBanner() {
    const banner = document.getElementById('city-live-banner');
    const badgeEl = document.getElementById('city-live-banner-badge');
    const textEl = document.getElementById('city-live-banner-text');
    if (!banner || !textEl) return;

    const candidate = PulseState.activeNotices.find((n) => n.pinBanner && !PulseState.dismissedBannerIds.has(Number(n.id)));
    if (!candidate) {
        banner.style.display = 'none';
        return;
    }

    banner.className = `city-live-banner sev-${candidate.severity === 'danger' ? 'danger' : (candidate.severity === 'warning' ? 'warning' : 'info')}`;
    if (badgeEl) {
        badgeEl.textContent = candidate.origin === 'auto_comunidad' ? 'BLOQUEO' : 'AVISO';
    }
    textEl.textContent = `${candidate.title}: ${candidate.body}`;
    banner.dataset.noticeId = String(candidate.id);
    banner.style.display = 'flex';
}

async function confirmNoticeClearFromUi(noticeId) {
    try {
        const res = await Api.clearPulseNotice(noticeId);
        showToast(res.message || 'Confirmación enviada');
        await loadLivePulse();
    } catch (err) {
        showToast(err.message || 'No se pudo enviar confirmación', 'error');
    }
}

async function confirmZoneClearFromUi(zoneOrIncidentKey) {
    if (!zoneOrIncidentKey) return;
    try {
        const res = await Api.clearZoneIncident(zoneOrIncidentKey);
        showToast(res.message || 'Confirmación enviada');
        await loadLivePulse();
    } catch (err) {
        showToast(err.message || 'No se pudo confirmar despeje', 'error');
    }
}

async function confirmIncidentMatchFromUi(incidentKey) {
    if (!incidentKey) return;
    try {
        const res = await Api.confirmPulseIncident(incidentKey);
        showToast(res.message || 'Confirmación registrada');
        await loadLivePulse();
    } catch (err) {
        showToast(err.message || 'No se pudo confirmar el reporte', 'error');
    }
}

function isInsideMazatlanClientCoords(lat, lng) {
    return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= 23.12 && lat <= 23.38 && lng >= -106.56 && lng <= -106.30;
}

function resolveQuickSightingLocation(routeId) {
    return new Promise((resolve) => {
        const fallback = () => {
            if (window.currentSearchLocation && isInsideMazatlanClientCoords(window.currentSearchLocation.lat, window.currentSearchLocation.lng)) {
                resolve({ lat: window.currentSearchLocation.lat, lng: window.currentSearchLocation.lng, source: 'search' });
                return;
            }
            if (window._lastFocusedRouteStop && Number(window._lastFocusedRouteStop.routeId) === Number(routeId)) {
                resolve({ lat: window._lastFocusedRouteStop.lat, lng: window._lastFocusedRouteStop.lng, source: 'stop', stopName: window._lastFocusedRouteStop.name });
                return;
            }
            resolve(null);
        };

        if (window._lastKnownGpsLocation && (Date.now() - window._lastKnownGpsLocation.ts) < 45000) {
            resolve({ lat: window._lastKnownGpsLocation.lat, lng: window._lastKnownGpsLocation.lng, source: 'gps' });
            return;
        }
        if (!('geolocation' in navigator)) {
            fallback();
            return;
        }
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) { settled = true; fallback(); }
        }, 3500);

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                const lat = pos?.coords?.latitude;
                const lng = pos?.coords?.longitude;
                if (isInsideMazatlanClientCoords(lat, lng)) {
                    window._lastKnownGpsLocation = { lat, lng, ts: Date.now() };
                    resolve({ lat, lng, source: 'gps' });
                } else {
                    fallback();
                }
            },
            () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                fallback();
            },
            { enableHighAccuracy: true, timeout: 3200, maximumAge: 45000 }
        );
    });
}

function computePolylineSegmentMeters(coords, startIdx, endIdx) {
    if (!Array.isArray(coords) || coords.length < 2) return 0;
    const a = Math.max(0, Math.min(startIdx, endIdx));
    const b = Math.min(coords.length - 1, Math.max(startIdx, endIdx));
    let total = 0;
    for (let i = a; i < b; i++) {
        total += calculateDistanceMeters(coords[i].latitude, coords[i].longitude, coords[i + 1].latitude, coords[i + 1].longitude);
    }
    return total;
}

function computeSightingRelativeHint(sighting, route, coords) {
    if (!sighting || typeof sighting.latitude !== 'number' || typeof sighting.longitude !== 'number') return '';
    if (!Array.isArray(coords) || coords.length < 2) return '';

    const gpsValid = window._lastKnownGpsLocation && (Date.now() - window._lastKnownGpsLocation.ts) < 180000
        ? window._lastKnownGpsLocation : null;
    const ref = gpsValid
        || (window.currentSearchLocation && isInsideMazatlanClientCoords(window.currentSearchLocation.lat, window.currentSearchLocation.lng) ? window.currentSearchLocation : null)
        || (window._lastFocusedRouteStop && Number(window._lastFocusedRouteStop.routeId) === Number(route.id) ? window._lastFocusedRouteStop : null);
    if (!ref) return '';

    const sightPt = findClosestPointOnRoute({ coordinatesList: coords }, sighting.latitude, sighting.longitude);
    const userPt = findClosestPointOnRoute({ coordinatesList: coords }, ref.lat, ref.lng);
    if (!sightPt || !userPt || sightPt.segIdx < 0 || userPt.segIdx < 0 || userPt.dist > 2500) return '';

    const directGap = calculateDistanceMeters(sightPt.lat, sightPt.lng, userPt.lat, userPt.lng);
    if (Math.abs(sightPt.segIdx - userPt.segIdx) <= 2 || directGap < 180) {
        return 'muy cerca de tu punto';
    }

    if (!isRouteClosedLoop(coords)) {
        const distM = computePolylineSegmentMeters(coords, sightPt.segIdx, userPt.segIdx);
        return sightPt.segIdx < userPt.segIdx
            ? `~${formatDistanceInfo(distM)} antes de tu punto`
            : `ya pasó (~${formatDistanceInfo(distM)} después)`;
    }

    const totalM = computePolylineSegmentMeters(coords, 0, coords.length - 1);
    const forwardM = sightPt.segIdx <= userPt.segIdx
        ? computePolylineSegmentMeters(coords, sightPt.segIdx, userPt.segIdx)
        : computePolylineSegmentMeters(coords, sightPt.segIdx, coords.length - 1) + computePolylineSegmentMeters(coords, 0, userPt.segIdx);
    const behindM = Math.max(0, totalM - forwardM);
    if (forwardM <= behindM) {
        return `~${formatDistanceInfo(forwardM)} antes de tu punto`;
    }
    return `ya pasó (~${formatDistanceInfo(behindM)} después)`;
}

function updateDetailPulseActions(route, routeStops, coords = []) {
    const statusEl = document.getElementById('detail-sighting-status');
    const sightingBtn = document.getElementById('detail-sighting-btn');
    const shareBtn = document.getElementById('detail-share-btn');
    if (!route) return;

    const renderStatus = () => {
        const s = PulseState.sightings[String(route.id)];
        if (statusEl) {
            if (s) {
                const minsText = Number(s.minutesAgo) <= 0 ? 'menos de 1 min' : `${Number(s.minutesAgo)} min`;
                const stopPart = s.stopName ? ` cerca de ${s.stopName}` : '';
                const relHint = computeSightingRelativeHint(s, route, coords);
                const relPart = relHint ? ` · ${relHint}` : '';
                const locateBtn = (typeof s.latitude === 'number' && typeof s.longitude === 'number')
                    ? `<button type="button" class="pulse-locate-link" onclick="focusBusSightingOnMap(${Number(route.id)})">Ver punto</button>`
                    : '';
                statusEl.innerHTML = `<span class="pulse-live-dot-inline"></span> Visto hace ${escapeUserHtml(minsText)}${escapeUserHtml(stopPart)}${escapeUserHtml(relPart)}${locateBtn}`;
            } else {
                statusEl.textContent = '¿Acabas de ver este camión? Avísale a otros pasajeros';
            }
        }
    };
    window._refreshActiveSightingStatus = renderStatus;
    renderStatus();

    if (sightingBtn) {
        sightingBtn.disabled = false;
        sightingBtn.onclick = async () => {
            sightingBtn.disabled = true;
            try {
                const loc = await resolveQuickSightingLocation(route.id);
                let nearStop = (loc && loc.stopName) ? loc.stopName : '';
                let postLat = null;
                let postLng = null;
                let dirHint = 'IDA';

                if (loc) {
                    const closest = findClosestPointOnRoute({ coordinatesList: coords, stopsList: routeStops }, loc.lat, loc.lng);
                    if (closest && closest.dist <= 750 && closest.lat != null) {
                        postLat = closest.lat;
                        postLng = closest.lng;
                        if (Array.isArray(coords) && coords.length > 4 && closest.segIdx > coords.length / 2) {
                            dirHint = 'VUELTA';
                        }
                    } else if (!closest || closest.dist <= 3000) {
                        postLat = loc.lat;
                        postLng = loc.lng;
                    }
                    if (!nearStop && Array.isArray(routeStops) && routeStops.length > 0) {
                        let bestD = 900;
                        routeStops.forEach((rs) => {
                            if (!rs.stop) return;
                            const d = calculateDistanceMeters(loc.lat, loc.lng, rs.stop.latitude, rs.stop.longitude);
                            if (d < bestD) { bestD = d; nearStop = rs.stop.name; }
                        });
                    }
                }

                const res = await Api.postBusSighting(route.id, route.name, dirHint, nearStop, postLat, postLng);
                if (res && res.summary) {
                    PulseState.sightings[String(route.id)] = res.summary;
                }
                showToast(postLat != null
                    ? '¡Aviso publicado por 15 min con punto en el mapa!'
                    : (res.message || '¡Aviso publicado por 15 min!'));
                renderStatus();
                if (typeof renderPulseMarkers === 'function') {
                    renderPulseMarkers(PulseState);
                }
                loadLivePulse();
            } catch (err) {
                showToast(err.message || 'Espera un momento antes de reportar otra vez', 'error');
            } finally {
                setTimeout(() => { sightingBtn.disabled = false; }, 3000);
            }
        };
    }

    if (shareBtn) {
        shareBtn.onclick = () => shareSingleRoute(route);
    }
}

function initCommunityPulse() {
    loadLivePulse();
    if (PulseState.pollTimer) clearInterval(PulseState.pollTimer);
    PulseState.pollTimer = setInterval(() => loadLivePulse(), 45000);

    const toggleFormBtn = document.getElementById('toggle-pulse-incident-form');
    const incForm = document.getElementById('pulse-incident-form');
    const typeSel = document.getElementById('pulse-inc-type');
    const customTypeIn = document.getElementById('pulse-inc-custom-type');
    const zoneSel = document.getElementById('pulse-inc-zone');
    const customZoneIn = document.getElementById('pulse-inc-custom-zone');

    if (toggleFormBtn && incForm) {
        toggleFormBtn.addEventListener('click', () => {
            const visible = incForm.style.display === 'flex';
            incForm.style.display = visible ? 'none' : 'flex';
            toggleFormBtn.textContent = visible ? '+ Reportar ahora' : 'Cerrar';
        });
    }
    if (typeSel && customTypeIn) {
        typeSel.addEventListener('change', () => {
            customTypeIn.style.display = typeSel.value === 'otro' ? 'block' : 'none';
            if (typeSel.value === 'otro') customTypeIn.focus();
        });
    }
    if (zoneSel && customZoneIn) {
        zoneSel.addEventListener('change', () => {
            customZoneIn.style.display = zoneSel.value === 'custom' ? 'block' : 'none';
            if (zoneSel.value === 'custom') customZoneIn.focus();
        });
    }
    if (incForm) {
        incForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const type = typeSel?.value || 'bloqueo';
            const customType = customTypeIn?.value.trim() || '';
            const zoneVal = zoneSel?.value || 'malecon';
            const customLabel = customZoneIn?.value.trim() || '';
            const desc = document.getElementById('pulse-inc-desc')?.value.trim() || '';

            if (type === 'otro' && !customType) {
                showToast('Escribe qué incidente está pasando en la calle.', 'error');
                customTypeIn?.focus();
                return;
            }
            const preset = ZONE_CENTER_PRESETS[zoneVal];
            const zoneKey = zoneVal === 'custom' ? customLabel : zoneVal;
            const zoneLabel = zoneVal === 'custom' ? customLabel : (preset ? preset.label : zoneVal);
            if (!zoneKey) {
                showToast('Escribe la avenida, calle o colonia afectada.', 'error');
                customZoneIn?.focus();
                return;
            }
            const recentGps = (window._lastKnownGpsLocation && (Date.now() - window._lastKnownGpsLocation.ts) < 180000
                && isInsideMazatlanClientCoords(window._lastKnownGpsLocation.lat, window._lastKnownGpsLocation.lng))
                ? window._lastKnownGpsLocation : null;
            const center = (mapInstance && typeof mapInstance.getCenter === 'function') ? mapInstance.getCenter() : null;
            const centerInside = center && isInsideMazatlanClientCoords(center.lat, center.lng) ? center : null;
            const lat = preset ? preset.lat : (recentGps ? recentGps.lat : (centerInside ? centerInside.lat : null));
            const lng = preset ? preset.lng : (recentGps ? recentGps.lng : (centerInside ? centerInside.lng : null));

            try {
                const res = await Api.postPulseIncident({
                    type, customType, zoneKey, zoneLabel, description: desc, latitude: lat, longitude: lng
                });
                showToast(res.message || 'Reporte enviado');
                if (customTypeIn) customTypeIn.value = '';
                if (customZoneIn) customZoneIn.value = '';
                if (document.getElementById('pulse-inc-desc')) document.getElementById('pulse-inc-desc').value = '';
                incForm.style.display = 'none';
                if (toggleFormBtn) toggleFormBtn.textContent = '+ Reportar ahora';
                await loadLivePulse();
            } catch (err) {
                showToast(err.message || 'No se pudo enviar el reporte', 'error');
            }
        });
    }

    const bannerClose = document.getElementById('city-live-banner-close');
    const bannerMore = document.getElementById('city-live-banner-more');
    const banner = document.getElementById('city-live-banner');
    if (bannerClose && banner) {
        bannerClose.addEventListener('click', () => {
            const nid = Number(banner.dataset.noticeId);
            if (nid) PulseState.dismissedBannerIds.add(nid);
            banner.style.display = 'none';
        });
    }
    if (bannerMore) {
        bannerMore.addEventListener('click', () => {
            const nm = document.getElementById('notifications-modal');
            if (nm) nm.style.display = 'flex';
        });
    }
}

// ----------------------------------------------------------
// MODO TURISTA CURADO, ATAJOS, AHORRO Y COMPARTIR WHATSAPP
// ----------------------------------------------------------
const CURATED_TOURIST_GUIDES = [
    {
        title: 'Centro Histórico → Zona Dorada',
        badge: 'Ahorras ~$120 vs app/taxi',
        fare: '$13 MXN',
        tip: 'Sube por Av. Ejército Mexicano o Malecón (Sábalo Centro / Cerritos). Bájate frente a Plaza Laguna o Las Flores.',
        from: { lat: 23.2041, lng: -106.4218, name: 'Centro / Mercado Pino Suárez' },
        to: { lat: 23.2555, lng: -106.4581, name: 'Zona Dorada' }
    },
    {
        title: 'Terminal de Cruceros → Malecón / Acuario',
        badge: 'Ahorras ~$140 vs taxi puerto',
        fare: '$13 MXN',
        tip: 'Camina hacia Av. Gabriel Leyva / Miguel Alemán afuera del puerto y toma ruta al Norte hacia Av. Del Mar.',
        from: { lat: 23.1920, lng: -106.4160, name: 'Terminal de Cruceros' },
        to: { lat: 23.2279, lng: -106.4275, name: 'Gran Acuario Mazatlán' }
    },
    {
        title: 'Zona Dorada → El Faro Mazatlán',
        badge: 'Ahorras ~$130 vs taxi',
        fare: '$13 MXN',
        tip: 'Toma Sábalo Centro hacia el Sur por toda la bahía; bájate en la glorieta de Olas Altas / Escollera y camina 6 min.',
        from: { lat: 23.2555, lng: -106.4581, name: 'Zona Dorada' },
        to: { lat: 23.1825, lng: -106.4282, name: 'El Faro Mazatlán' }
    },
    {
        title: 'Central Camionera → Zona Dorada',
        badge: 'Ahorras ~$110 vs taxi central',
        fare: '$13 MXN',
        tip: 'Sal a Av. Ejército Mexicano (a 2 cuadras); casi todas las rutas al Norte cruzan Rafael Buelna y Zona Dorada.',
        from: { lat: 23.2194, lng: -106.4158, name: 'Central Camionera' },
        to: { lat: 23.2555, lng: -106.4581, name: 'Zona Dorada' }
    },
    {
        title: 'Centro → Playas de Cerritos',
        badge: 'Ahorras ~$170 vs app/taxi',
        fare: '$13 MXN',
        tip: 'Busca camiones con letrero "Sábalo Cerritos" o "Cerritos Juárez"; te llevan directo hasta la zona norte de hoteles.',
        from: { lat: 23.2041, lng: -106.4218, name: 'Centro Mazatlán' },
        to: { lat: 23.2980, lng: -106.4840, name: 'Playa Cerritos' }
    }
];

function renderTouristGuidesList() {
    const list = document.getElementById('route-list');
    if (!list) return;
    list.innerHTML = `
        <div class="guides-intro-banner">
            <strong>Modo Turista en Camión</strong>
            <span>Guías rápidas para moverte por Mazatlán pagando $13 MXN sin pagar de más en traslados cortos.</span>
        </div>
    `;
    CURATED_TOURIST_GUIDES.forEach((g, idx) => {
        const card = document.createElement('div');
        card.className = 'guide-card';
        card.innerHTML = `
            <div class="guide-card-top">
                <span class="guide-fare-pill">${escapeUserHtml(g.fare)}</span>
                <span class="guide-save-pill">${escapeUserHtml(g.badge)}</span>
            </div>
            <h4 class="guide-title">${escapeUserHtml(g.title)}</h4>
            <p class="guide-tip">${escapeUserHtml(g.tip)}</p>
            <button type="button" class="btn-guide-launch" onclick="launchCuratedGuide(${idx})">Ver qué camión tomar en el mapa</button>
        `;
        list.appendChild(card);
    });
}

function launchCuratedGuide(idx) {
    const g = CURATED_TOURIST_GUIDES[idx];
    if (!g) return;
    switchSidebarMode('planificador');
    selectedOrigin = { lat: g.from.lat, lng: g.from.lng, name: g.from.name };
    selectedDestination = { lat: g.to.lat, lng: g.to.lng, name: g.to.name };
    const oIn = document.getElementById('origin-input');
    const dIn = document.getElementById('destination-input');
    if (oIn) oIn.value = g.from.name;
    if (dIn) dIn.value = g.to.name;
    calculateTripRoute();
    if (isMobileViewport()) setMobileSheetState('half');
}
window.launchCuratedGuide = launchCuratedGuide;

const SHORTCUTS_STORAGE_KEY = 'donrutero_user_shortcuts_v1';
const SHORTCUT_DEFS = [
    {
        key: 'casa',
        label: 'Casa',
        svg: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"></path><path d="M5 9.5V20h14V9.5"></path></svg>'
    },
    {
        key: 'chamba',
        label: 'Chamba',
        svg: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"></rect><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>'
    },
    {
        key: 'escuela',
        label: 'Escuela',
        svg: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10l-10-5-10 5 10 5 10-5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>'
    }
];

function getSavedShortcuts() {
    try {
        const raw = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (_) {
        return {};
    }
}

function saveShortcutsMap(obj) {
    try { localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(obj)); } catch (_) {}
}

function renderPlannerShortcuts() {
    const row = document.getElementById('planner-shortcuts-row');
    if (!row) return;
    const saved = getSavedShortcuts();
    row.innerHTML = SHORTCUT_DEFS.map((s) => {
        const item = saved[s.key];
        if (item && item.lat && item.lng) {
            return `
                <div class="shortcut-chip-wrap">
                    <button type="button" class="shortcut-chip is-saved" onclick="usePlannerShortcut('${s.key}')" title="Ir a ${escapeUserHtml(item.name)}">
                        ${s.svg} ${escapeUserHtml(s.label)}
                    </button>
                    <button type="button" class="shortcut-clear-btn" onclick="clearPlannerShortcut('${s.key}')" title="Borrar atajo ${escapeUserHtml(s.label)}">&times;</button>
                </div>
            `;
        }
        return `
            <button type="button" class="shortcut-chip" onclick="saveCurrentAsShortcut('${s.key}')" title="Elige un destino abajo y tócalo para guardarlo como ${escapeUserHtml(s.label)}">
                ${s.svg} + ${escapeUserHtml(s.label)}
            </button>
        `;
    }).join('');
}

function saveCurrentAsShortcut(key) {
    const target = selectedDestination || selectedOrigin;
    if (!target || !target.lat || !target.lng) {
        showToast(`Primero elige un Destino en el cuadro de abajo y luego toca "+ ${key}" para guardarlo.`);
        return;
    }
    const saved = getSavedShortcuts();
    saved[key] = { lat: target.lat, lng: target.lng, name: target.name || key };
    saveShortcutsMap(saved);
    renderPlannerShortcuts();
    showToast(`Guardado "${target.name}" como tu atajo de ${key}`);
}

async function usePlannerShortcut(key) {
    const saved = getSavedShortcuts();
    const item = saved[key];
    if (!item) return;
    selectedDestination = { lat: item.lat, lng: item.lng, name: item.name };
    const dIn = document.getElementById('destination-input');
    if (dIn) dIn.value = item.name;

    if (!selectedOrigin && window.currentSearchLocation) {
        selectedOrigin = {
            lat: window.currentSearchLocation.lat,
            lng: window.currentSearchLocation.lng,
            name: window.currentSearchLocation.name || 'Mi ubicación'
        };
        const oIn = document.getElementById('origin-input');
        if (oIn) oIn.value = selectedOrigin.name;
    }
    if (selectedOrigin && selectedDestination) {
        calculateTripRoute();
    } else {
        showToast(`Destino fijado en ${item.name}. Ahora indica tu origen o toca el botón GPS.`);
    }
}

function clearPlannerShortcut(key) {
    const saved = getSavedShortcuts();
    delete saved[key];
    saveShortcutsMap(saved);
    renderPlannerShortcuts();
}

window.saveCurrentAsShortcut = saveCurrentAsShortcut;
window.usePlannerShortcut = usePlannerShortcut;
window.clearPlannerShortcut = clearPlannerShortcut;

function formatTripSavingsHtml(opt) {
    if (!opt || !opt.busMeters) return '';
    const km = Math.max(1.5, opt.busMeters / 1000);
    const estTaxiMxn = Math.round(Math.max(70, Math.min(240, 48 + km * 11)));
    const busCost = (typeof fareMode !== 'undefined' && fareMode === 'student') ? 3.5 : (opt.type === 'transfer' ? 26 : 13);
    const saved = Math.max(45, Math.round(estTaxiMxn - busCost));
    return `<div class="trip-savings-pill">Ahorras ~$${saved} MXN aprox. vs taxi o app en este tramo</div>`;
}

async function shareTextOrWhatsapp(text, url) {
    const full = `${text}\n${url}`;
    if (navigator.share) {
        try {
            await navigator.share({ title: 'Don Rutero · Mazatlán', text, url });
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') return;
        }
    }
    const waUrl = `https://wa.me/?text=${encodeURIComponent(full)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
}

function shareSingleRoute(route) {
    if (!route) return;
    const shareUrl = `${window.location.origin}/?ruta=${encodeURIComponent(route.id)}`;
    const text = `Así te vas en el camión ${route.name.trim()} en Mazatlán (Don Rutero):`;
    shareTextOrWhatsapp(text, shareUrl);
}

function shareTripOption(idx) {
    const opt = Array.isArray(window._tripComputedOptions) ? window._tripComputedOptions[idx] : null;
    if (!opt || !selectedOrigin || !selectedDestination) return;
    const params = new URLSearchParams({
        fromLat: String(Number(selectedOrigin.lat).toFixed(5)),
        fromLng: String(Number(selectedOrigin.lng).toFixed(5)),
        fromName: selectedOrigin.name || 'Origen',
        toLat: String(Number(selectedDestination.lat).toFixed(5)),
        toLng: String(Number(selectedDestination.lng).toFixed(5)),
        toName: selectedDestination.name || 'Destino'
    });
    const shareUrl = `${window.location.origin}/?${params.toString()}`;
    const text = opt.type === 'transfer'
        ? `Cómo llegar en camión (${selectedOrigin.name} -> ${selectedDestination.name}): Toma ${opt.routeA.name.trim()} y transborda a ${opt.routeB.name.trim()}. Checa dónde subir en Don Rutero:`
        : `Cómo llegar en camión (${selectedOrigin.name} -> ${selectedDestination.name}): Toma el ${opt.routeA.name.trim()} (sube cerca de ${opt.boardLabel || 'tu origen'}). Ve el trazado en Don Rutero:`;
    shareTextOrWhatsapp(text, shareUrl);
}
window.shareTripOption = shareTripOption;

// ----------------------------------------------------------
// ALARMA DE BAJADA Y NOTIFICACIÓN EN BARRA (VOY A BORDO)
// ----------------------------------------------------------
function toggleOnboardAlarm() {
    onboardState.alarmEnabled = !onboardState.alarmEnabled;
    const btn = document.getElementById('onboard-alarm-btn');
    if (btn) {
        btn.classList.toggle('active', onboardState.alarmEnabled);
        btn.innerHTML = onboardState.alarmEnabled
            ? '<img src="assets/icons/ui_campana.svg" alt="" style="width:13px;height:13px;vertical-align:-2px;"> Alarma bajada: ON'
            : '<img src="assets/icons/ui_campana.svg" alt="" style="width:13px;height:13px;vertical-align:-2px;opacity:0.5;"> Alarma: OFF';
    }
    if (onboardState.alarmEnabled && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }
    showToast(onboardState.alarmEnabled ? 'Alarma de bajada activada (~300 m antes)' : 'Alarma de bajada silenciada');
}
window.toggleOnboardAlarm = toggleOnboardAlarm;

function playDropoffChime(isFinalStop) {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const notes = isFinalStop ? [587.33, 783.99, 987.77] : [523.25, 659.25];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.14);
            gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.14);
            gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.14 + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.14 + 0.24);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + i * 0.14);
            osc.stop(ctx.currentTime + i * 0.14 + 0.26);
        });
        setTimeout(() => ctx.close().catch(() => {}), 1200);
    } catch (_) {}
}

let _onboardSwRegPromise = null;
function ensureOnboardServiceWorker() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    const isSecureOrigin = window.location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (!isSecureOrigin) return Promise.resolve(null);
    if (!_onboardSwRegPromise) {
        _onboardSwRegPromise = navigator.serviceWorker.register('sw.js')
            .then(() => navigator.serviceWorker.ready)
            .catch(() => null);
    }
    return _onboardSwRegPromise;
}

function getSafeNotifHexColor(color, fallback = '#E63E21') {
    const val = String(color || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(val) ? val : fallback;
}

function buildOnboardNotifRoundIconUrl(routeColor) {
    const color = getSafeNotifHexColor(routeColor, '#E63E21');
    if (onboardState.cachedRoundIconColor === color && onboardState.cachedRoundIconUrl) {
        return onboardState.cachedRoundIconUrl;
    }
    try {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 128;
        const ctx = c.getContext('2d');
        if (!ctx) return 'assets/icon-192.png';
        ctx.clearRect(0, 0, 128, 128);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(64, 64, 58, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.roundRect(38, 30, 52, 50, 10);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(45, 38, 38, 19, 4);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(49, 68, 4, 0, Math.PI * 2);
        ctx.arc(79, 68, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.roundRect(44, 78, 10, 10, 3);
        ctx.roundRect(74, 78, 10, 10, 3);
        ctx.fill();

        const dataUrl = c.toDataURL('image/png');
        onboardState.cachedRoundIconColor = color;
        onboardState.cachedRoundIconUrl = dataUrl;
        return dataUrl;
    } catch (_) {
        return 'assets/icon-192.png';
    }
}

function buildOnboardNotifBannerDataUrl(snap) {
    if (!snap) return null;
    try {
        const W = 640;
        const H = 166;
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d');
        if (!ctx) return null;

        const accentColor = snap.isNearAction && !snap.isArrived
            ? '#DC2626'
            : getSafeNotifHexColor(snap.routeColor, '#E63E21');
        const fillBarColor = snap.isNearAction && !snap.isArrived ? '#DC2626' : '#10B981';
        const pct = Math.max(0, Math.min(100, Number(snap.pct || 0)));

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = accentColor;
        ctx.fillRect(0, 0, W, 6);

        ctx.fillStyle = fillBarColor;
        ctx.beginPath();
        ctx.arc(30, 34, 5.5, 0, Math.PI * 2);
        ctx.fill();

        const routeUpper = String(snap.routeName || 'EN RUTA').toUpperCase();
        const headerLabel = `VOY A BORDO · ${routeUpper}`;
        ctx.fillStyle = '#0F172A';
        ctx.font = '800 17px system-ui, -apple-system, Roboto, sans-serif';
        let clippedHeader = headerLabel;
        while (ctx.measureText(clippedHeader).width > W - 180 && clippedHeader.length > 10) {
            clippedHeader = clippedHeader.slice(0, -2) + '…';
        }
        ctx.fillText(clippedHeader, 44, 40);

        const etaText = snap.isArrived ? 'Llegada' : `~${Math.max(1, Number(snap.etaMin || 1))} min`;
        ctx.font = '800 18px system-ui, -apple-system, Roboto, sans-serif';
        const etaW = Math.max(82, ctx.measureText(etaText).width + 26);
        const pillX = W - 22 - etaW;
        ctx.fillStyle = snap.isNearAction && !snap.isArrived ? '#DC2626' : '#0F172A';
        ctx.beginPath();
        ctx.roundRect(pillX, 18, etaW, 32, 8);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText(etaText, pillX + etaW / 2, 40);
        ctx.textAlign = 'left';

        const rightMeta = `${formatOnboardDistance(snap.remainToActionM || 0)} · ${Math.round(pct)}%`;
        ctx.font = '700 18px system-ui, -apple-system, Roboto, sans-serif';
        const rightW = ctx.measureText(rightMeta).width;
        ctx.fillStyle = '#475569';
        ctx.textAlign = 'right';
        ctx.fillText(rightMeta, W - 22, 84);
        ctx.textAlign = 'left';

        const destText = `${snap.inFirstLeg ? 'Transbordo' : 'Bajada'}: ${snap.destLabel || 'tu destino'}`;
        ctx.fillStyle = '#0F172A';
        ctx.font = '700 20px system-ui, -apple-system, Roboto, sans-serif';
        let clippedDest = destText;
        const maxDestW = W - 44 - rightW - 20;
        while (ctx.measureText(clippedDest).width > maxDestW && clippedDest.length > 8) {
            clippedDest = clippedDest.slice(0, -2) + '…';
        }
        ctx.fillText(clippedDest, 22, 84);

        const trackX = 22;
        const trackY = 104;
        const trackW = W - 44;
        const trackH = 12;
        ctx.fillStyle = '#E2E8F0';
        ctx.beginPath();
        ctx.roundRect(trackX, trackY, trackW, trackH, 6);
        ctx.fill();

        const fillW = Math.max(trackH, Math.round((pct / 100) * trackW));
        ctx.fillStyle = fillBarColor;
        ctx.beginPath();
        ctx.roundRect(trackX, trackY, Math.min(trackW, fillW), trackH, 6);
        ctx.fill();

        ctx.fillStyle = '#64748B';
        ctx.font = '600 15px system-ui, -apple-system, Roboto, sans-serif';
        ctx.fillText('Subida', trackX, 144);
        ctx.textAlign = 'center';
        ctx.fillText('En ruta', W / 2, 144);
        ctx.textAlign = 'right';
        ctx.fillText('Bajada (aviso 300 m)', W - 22, 144);
        ctx.textAlign = 'left';

        return c.toDataURL('image/png');
    } catch (_) {
        return null;
    }
}

async function syncOnboardSystemNotification(forceUrgent = false) {
    if (!onboardState.active || !('Notification' in window) || Notification.permission !== 'granted') return;
    const now = Date.now();
    if (!forceUrgent && (now - onboardState.lastNotifSyncMs) < 3000) return;
    onboardState.lastNotifSyncMs = now;

    const snap = onboardState.hudSnapshot;
    const routeName = (snap && snap.routeName) || document.getElementById('onboard-route-name')?.textContent || 'En ruta';
    const nextStop = (snap && snap.nextStopShort) || document.getElementById('onboard-next-stop')?.textContent || 'Siguiendo viaje';
    const etaLabel = snap
        ? (snap.isArrived ? 'Llegada' : (snap.isNearAction ? '¡Prepárate para bajar!' : `~${Math.max(1, snap.etaMin)} min`))
        : '';
    const title = etaLabel ? `${routeName} · ${etaLabel}` : routeName;
    const bodySecondLine = snap
        ? (snap.isArrived ? 'Recorrido completado' : `Bajada: ${snap.destLabel} · faltan ${formatOnboardDistance(snap.remainToActionM)}`)
        : (document.getElementById('onboard-alight-info')?.textContent || '');
    const iconUrl = buildOnboardNotifRoundIconUrl(snap && snap.isNearAction && !snap.isArrived ? '#DC2626' : (snap && snap.routeColor));
    const bannerUrl = buildOnboardNotifBannerDataUrl(snap);

    try {
        const reg = await ensureOnboardServiceWorker();
        if (reg && typeof reg.showNotification === 'function') {
            const opts = {
                body: `${nextStop}${bodySecondLine ? `\n${bodySecondLine}` : ''}`,
                icon: iconUrl,
                badge: 'assets/badge-bus.png',
                tag: 'donrutero-onboard',
                renotify: forceUrgent,
                silent: !forceUrgent,
                actions: [{ action: 'stop-onboard', title: 'Finalizar viaje' }]
            };
            if (bannerUrl) opts.image = bannerUrl;
            await reg.showNotification(title, opts);
        } else {
            new Notification(title, {
                body: `${nextStop}${bodySecondLine ? ` · ${bodySecondLine}` : ''}`,
                icon: iconUrl,
                tag: 'donrutero-onboard',
                silent: !forceUrgent
            });
        }
    } catch (_) {}
}

function updateBgNotifButtonUi() {
    const btn = document.getElementById('onboard-bg-notif-btn');
    if (!btn) return;
    btn.classList.toggle('active', onboardState.bgNotifEnabled);
    btn.innerHTML = onboardState.bgNotifEnabled
        ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg> En barra: ON'
        : '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg> Avisar en barra: OFF';
}

async function toggleOnboardBackgroundNotification() {
    if (!onboardState.active) return;
    if (!('Notification' in window)) {
        showToast('Tu navegador no admite notificaciones del sistema en esta conexión.', 'error');
        return;
    }

    if (onboardState.bgNotifEnabled) {
        onboardState.bgNotifEnabled = false;
        closeOnboardSystemNotification();
        updateBgNotifButtonUi();
        showToast('Notificación en barra desactivada');
        return;
    }

    let perm = Notification.permission;
    if (perm === 'default') {
        try { perm = await Notification.requestPermission(); } catch (_) {}
    }
    if (perm !== 'granted') {
        showToast('Activa los permisos de notificación (requiere HTTPS o localhost).', 'error');
        return;
    }

    onboardState.bgNotifEnabled = true;
    onboardState.lastNotifSyncMs = 0;
    updateBgNotifButtonUi();
    await syncOnboardSystemNotification(false);
    showToast('Notificación en vivo activada en tu barra del sistema');
}
window.toggleOnboardBackgroundNotification = toggleOnboardBackgroundNotification;

function setupOnboardBackgroundListeners() {
    document.addEventListener('visibilitychange', () => {
        if (!onboardState.active) return;
        if (onboardState.source === 'gps' && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                processOnboardGpsPosition,
                () => {},
                { enableHighAccuracy: true, maximumAge: 3000, timeout: 4500 }
            );
        }
        if (document.hidden && (onboardState.bgNotifEnabled || Notification.permission === 'granted')) {
            syncOnboardSystemNotification(false);
        }
    });
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'STOP_ONBOARD') {
                stopOnboardTrip();
            }
        });
    }
}

function closeOnboardSystemNotification() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((reg) => reg.getNotifications({ tag: 'donrutero-onboard' }))
            .then((list) => list.forEach((n) => n.close()))
            .catch(() => {});
    }
}

window.confirmNoticeClearFromUi = confirmNoticeClearFromUi;
window.confirmZoneClearFromUi = confirmZoneClearFromUi;


