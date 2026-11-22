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
        showDetailPanel(route, routeStops, proximityInfo);
    } catch (err) {
        showToast('Error al cargar la ruta', 'error');
        console.error(err);
    }
}

function showDetailPanel(route, routeStops, proximityInfo = null) {
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
    document.getElementById('detail-panel').classList.remove('visible');
    document.getElementById('main-list-section').style.display = 'flex';
    document.querySelectorAll('.route-card').forEach(c => c.classList.remove('active'));
    clearMapDrawings();
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

    // Búsqueda por texto normal
    const filtered = categoryRoutes.filter(r => {
        if (!q) return true;
        return r.name.toLowerCase().includes(q) ||
            (r.description && r.description.toLowerCase().includes(q)) ||
            (r.stopsList && r.stopsList.some(rs => {
                const s = rs.stop || rs;
                const nameMatch = s.name && s.name.toLowerCase().includes(q);
                const addrMatch = s.address && s.address.toLowerCase().includes(q);
                const typeMatch = s.type && s.type.toLowerCase().includes(q);
                return nameMatch || addrMatch || typeMatch;
            }));
    });

    renderRoutes(filtered);
}

function filterRoutes(searchText) {
    currentSearch = searchText;
    updateRouteDisplay();
    renderSearchSuggestions(searchText);
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

let osmSearchTimeout = null;

async function fetchOSMPlaces(query, dropdownId, type) {
    if (query.length < 3) return;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ', Mazatlan, Sinaloa')}&format=json&limit=3&addressdetails=1`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown || dropdown.style.display === 'none') return;
        
        let html = '';
        data.forEach(item => {
            const fullName = item.display_name || '';
            const shortName = fullName.split(',')[0];
            const lat = parseFloat(item.lat);
            const lng = parseFloat(item.lon);
            if (isNaN(lat) || isNaN(lng)) return;
            
            let title = isNaN(shortName) ? shortName : fullName.split(',')[1]?.trim() || shortName;
            
            const osmType = item.type || '';
            const osmClass = item.class || '';
            
            let badgeText = "OpenStreetMap";
            let iconUrl = "assets/icons/ui_ubicacion.svg";
            let color = "#2563eb";
            
            if (osmClass === 'amenity') {
                if (osmType === 'hospital' || osmType === 'clinic' || osmType === 'doctors') { badgeText = 'Salud / Médico'; color = '#dc2626'; iconUrl = 'assets/icons/pin_hospital.svg'; }
                else if (osmType === 'school' || osmType === 'university' || osmType === 'college') { badgeText = 'Educación'; color = '#d97706'; iconUrl = 'assets/icons/pin_escuela.svg'; }
                else if (osmType === 'restaurant' || osmType === 'cafe' || osmType === 'fast_food') { badgeText = 'Comida'; color = '#ea580c'; iconUrl = 'assets/icons/pin_restaurante.svg'; }
                else { badgeText = 'Establecimiento'; color = '#6366f1'; iconUrl = 'assets/icons/ui_buscar.svg'; }
            } else if (osmClass === 'shop') {
                badgeText = 'Comercio'; color = '#059669'; iconUrl = 'assets/icons/pin_tienda.svg';
            } else if (osmClass === 'tourism' || osmType === 'hotel') {
                badgeText = 'Turismo'; color = '#0284c7'; iconUrl = 'assets/icons/pin_hotel.svg';
            } else if (osmClass === 'place' || osmType === 'residential' || osmType === 'suburb' || osmType === 'neighbourhood') {
                badgeText = 'Colonia / Zona'; color = '#059669'; iconUrl = 'assets/icons/ui_ubicacion.svg';
            } else if (osmClass === 'highway') {
                badgeText = 'Calle / Avenida'; color = '#64748b'; iconUrl = 'assets/icons/ui_buscar.svg';
            }
            
            const pointObj = { name: title, lat: lat, lng: lng };
            const actionId = registerSuggestionAction(() => {
                const encoded = encodeURIComponent(JSON.stringify(pointObj));
                if (type === 'main') selectColoniaSuggestion(encoded);
                else selectTripPoint(encoded, type);
            });
            
            html += `
                <div class="search-suggestion-item" data-osm-suggestion="true" onclick="triggerSuggestionAction(${actionId})">
                    <div class="suggestion-icon" style="background: ${color};">
                        <img src="${iconUrl}" alt="" style="filter: brightness(0) invert(1); width: 14px; height: 14px;">
                    </div>
                    <div class="suggestion-content">
                        <div class="suggestion-title">${escapeUserHtml(title)}</div>
                        <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap;">
                            <span class="suggestion-badge" style="background: ${color}15; color: ${color};">${escapeUserHtml(badgeText)}</span>
                            <span class="suggestion-subtitle" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; display: block;">${escapeUserHtml(fullName)}</span>
                        </div>
                    </div>
                </div>
            `;
        });
        
        if (html !== '') {
            const noResults = dropdown.querySelector('div[style*="text-align: center"]');
            if (noResults && noResults.textContent.includes('No se encontraron')) {
                noResults.remove();
            }
            // Eliminar sugerencias previas de OSM si existieran (para evitar duplicados al teclear rápido)
            dropdown.querySelectorAll('.search-suggestion-item[data-osm-suggestion="true"]').forEach(el => el.remove());
            
            dropdown.innerHTML += html;
        }
    } catch (e) {
        console.error("OSM Geocoding Error:", e);
    }
}
function renderSearchSuggestions(q) {
    const dropdown = document.getElementById('search-suggestions');
    if (!dropdown) return;
    
    const query = (q || '').toLowerCase().trim();
    if (query.length < 1) {
        dropdown.style.display = 'none';
        return;
    }
    
    let html = '';
    let matchesCount = 0;
    
    // 2. Buscar en Rutas
    allRoutes.forEach(r => {
        if (r.name.toLowerCase().includes(query) || (r.description && r.description.toLowerCase().includes(query))) {
            matchesCount++;
            const safeColor = safeUserColor(r.color, '#E63E21');
            html += `
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
            `;
        }
    });
    
    // 3. Buscar en Destinos y Puntos de Interés (allPhysicalStopsList)
    if (typeof allPhysicalStopsList !== 'undefined' && allPhysicalStopsList.length > 0) {
        let stopMatches = 0;
        allPhysicalStopsList.forEach(stop => {
            if (stopMatches >= 5) return; // Limitar a 5 sugerencias de destinos
            
            const nameMatch = stop.name && stop.name.toLowerCase().includes(query);
            const addrMatch = stop.address && stop.address.toLowerCase().includes(query);
            const typeMatch = stop.type && stop.type.toLowerCase().includes(query);
            
            if (nameMatch || addrMatch || typeMatch) {
                stopMatches++;
                matchesCount++;
                const config = (typeof getStopIconConfig === 'function') ? getStopIconConfig(stop.name, stop.type) : { iconUrl: 'assets/icons/pin_parada.svg', bgColor: '#475569', category: 'Destino' };
                const safeBg = safeUserColor(config.bgColor);
                
                // Determinar qué rutas pasan por o cerca de esta parada
                const passingRoutes = allRoutes.filter(r => r.stopsList && r.stopsList.some(rs => (rs.stop || rs).id === stop.id || (rs.stop || rs).name === stop.name)).map(r => r.name);
                const subtitleText = passingRoutes.length > 0 ? `📍 ${stop.address || 'Mazatlán'} — Pasa: ${passingRoutes.join(', ')}` : `📍 ${stop.address || 'Mazatlán, Sinaloa'}`;
                
                const actionId = registerSuggestionAction(() => {
                    selectStopSuggestion(encodeURIComponent(JSON.stringify(stop)));
                });
                html += `
                    <div class="search-suggestion-item" onclick="triggerSuggestionAction(${actionId})">
                        <div class="suggestion-icon" style="background: ${safeBg};">
                            <img src="${config.iconUrl}" alt="">
                        </div>
                        <div class="suggestion-content">
                            <div class="suggestion-title">${escapeUserHtml(stop.name)}</div>
                            <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap;">
                                <span class="suggestion-badge" style="background: ${safeBg}15; color: ${safeBg};">${escapeUserHtml(config.category || 'Destino')}</span>
                                <span class="suggestion-subtitle">${escapeUserHtml(subtitleText)}</span>
                            </div>
                        </div>
                    </div>
                `;
            }
        });
    }
    
    if (matchesCount === 0) {
        html = `
            <div style="padding: 14px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
                No se encontraron colonias, destinos ni rutas para "<b>${escapeUserHtml(q)}</b>"
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
    const query = (q || '').toLowerCase().trim();
    if (query.length < 1) { dropdown.style.display = 'none'; return; }
    
    let html = '';
    let count = 0;
    
    // Búsqueda de colonias delegada a OSM
    
    // Destinos / Paradas
    if (typeof allPhysicalStopsList !== 'undefined') {
        allPhysicalStopsList.filter(s => (s.name && s.name.toLowerCase().includes(query)) || (s.address && s.address.toLowerCase().includes(query)) || (s.type && s.type.toLowerCase().includes(query))).slice(0, 4).forEach(stop => {
            count++;
            const config = (typeof getStopIconConfig === 'function') ? getStopIconConfig(stop.name, stop.type) : { iconUrl: 'assets/icons/pin_parada.svg', bgColor: '#475569', category: 'Destino' };
            const safeBg = safeUserColor(config.bgColor);
            const pointObj = { name: stop.name, lat: stop.latitude, lng: stop.longitude };
            const actionId = registerSuggestionAction(() => {
                selectTripPoint(encodeURIComponent(JSON.stringify(pointObj)), type);
            });
            html += `
                <div class="search-suggestion-item" onclick="triggerSuggestionAction(${actionId})">
                    <div class="suggestion-icon" style="background: ${safeBg};"><img src="${config.iconUrl}" alt=""></div>
                    <div class="suggestion-content">
                        <div class="suggestion-title">${escapeUserHtml(stop.name)}</div>
                        <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap;">
                            <span class="suggestion-badge" style="background: ${safeBg}15; color: ${safeBg};">${escapeUserHtml(config.category || 'Destino')}</span>
                            <span class="suggestion-subtitle">📍 ${escapeUserHtml(stop.address || 'Mazatlán')}</span>
                        </div>
                    </div>
                </div>
            `;
        });
    }
    
    if (count === 0) {
        html = `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.8rem;">Sin resultados para "${escapeUserHtml(q)}"</div>`;
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

function findBestTransferPoint(routeA, routeB) {
    const coordsA = routeA.coordinatesList || [];
    const coordsB = routeB.coordinatesList || [];
    if (coordsA.length === 0 || coordsB.length === 0) return null;

    // Descarte rápido por bounding box (+ ~500m de margen)
    const pad = 0.005;
    const boxA = getRouteBoundingBox(coordsA);
    const boxB = getRouteBoundingBox(coordsB);
    if (boxA.maxLat + pad < boxB.minLat || boxB.maxLat + pad < boxA.minLat ||
        boxA.maxLng + pad < boxB.minLng || boxB.maxLng + pad < boxA.minLng) {
        return null;
    }

    let best = null;
    const checkVerticesAgainstSegments = (pts, segs, swapped) => {
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (p.latitude == null || p.longitude == null) continue;
            for (let j = 0; j < segs.length - 1; j++) {
                const s1 = segs[j];
                const s2 = segs[j + 1];
                if (s1.latitude == null || s1.longitude == null || s2.latitude == null || s2.longitude == null) continue;
                const proj = closestPointOnSegment(p.latitude, p.longitude, s1.latitude, s1.longitude, s2.latitude, s2.longitude);
                if (!best || proj.dist < best.walkDist) {
                    const latA = swapped ? proj.lat : p.latitude;
                    const lngA = swapped ? proj.lng : p.longitude;
                    const latB = swapped ? p.latitude : proj.lat;
                    const lngB = swapped ? p.longitude : proj.lng;
                    const segA = swapped ? j : Math.min(i, coordsA.length - 2);
                    const tA = swapped ? proj.t : 0;
                    const segB = swapped ? Math.min(i, coordsB.length - 2) : j;
                    const tB = swapped ? 0 : proj.t;
                    best = {
                        latA, lngA, latB, lngB,
                        segA, tA, segB, tB,
                        midLat: (latA + latB) / 2,
                        midLng: (lngA + lngB) / 2,
                        walkDist: proj.dist
                    };
                }
            }
        }
    };

    checkVerticesAgainstSegments(coordsA, coordsB, false);
    checkVerticesAgainstSegments(coordsB, coordsA, true);

    if (!best || best.walkDist > 400) return null;
    return best;
}

function estimateTripMinutes(walkMeters, busMeters, transferCount = 0) {
    const walkMin = walkMeters > 0 ? Math.max(1, Math.round(walkMeters / 80)) : 0;
    const busMin = (busMeters && isFinite(busMeters)) ? Math.max(2, Math.round(busMeters / 365)) : 8;
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
                const estimatedMin = estimateTripMinutes(totalWalk, bestPair.forwardDist, 0);

                return {
                    type: 'direct',
                    routeA: m.route,
                    origInfo: bestPair.origInfo,
                    destInfo: bestPair.destInfo,
                    travelCoords: bestPair.segmentCoords,
                    onBusDist: bestPair.forwardDist,
                    estimatedMin,
                    dirInfo,
                    boardLabel: findNearestStopLabel(m.route, bestPair.origInfo.lat, bestPair.origInfo.lng),
                    alightLabel: findNearestStopLabel(m.route, bestPair.destInfo.lat, bestPair.destInfo.lng),
                    normalPrice: getRouteNormalPrice(m.route),
                    studentPrice: getRouteStudentPrice(m.route),
                    totalPrice: getActiveRoutePrice(m.route),
                    score: totalWalk + (isFinite(bestPair.forwardDist) ? bestPair.forwardDist * 0.08 : 0)
                };
            })
            .sort((a, b) => a.score - b.score);

        // 2. Opciones con 1 transbordo (2 camiones) cuando no hay directas o las directas requieren caminar mucho
        const needTransfers = directOptions.length === 0 || (directOptions[0].origInfo.dist + directOptions[0].destInfo.dist > 800);
        const transferOptions = [];
        if (needTransfers) {
            const origRoutes = routeMetrics.filter(m => m.origInfo.dist <= 1000);
            const destRoutes = routeMetrics.filter(m => m.destInfo.dist <= 1000);

            for (const candA of origRoutes) {
                for (const candB of destRoutes) {
                    if (candA.route.id === candB.route.id) continue;
                    const transfer = findBestTransferPoint(candA.route, candB.route);
                    if (!transfer) continue;

                    const transferPtA = { lat: transfer.latA, lng: transfer.lngA, segIdx: transfer.segA, t: transfer.tA };
                    const transferPtB = { lat: transfer.latB, lng: transfer.lngB, segIdx: transfer.segB, t: transfer.tB };

                    const oCandsA = candA.origCandidates.length > 0 ? candA.origCandidates : [candA.origInfo];
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

                    const dCandsB = candB.destCandidates.length > 0 ? candB.destCandidates : [candB.destInfo];
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

                    const transferLabel =
                        findNearestStopLabel(candA.route, transfer.midLat, transfer.midLng) ||
                        findNearestStopLabel(candB.route, transfer.midLat, transfer.midLng);

                    const dirInfoA = getBoardingDirectionInfo(candA.route, bestOrigA, selectedOrigin.lat, selectedOrigin.lng, oCandsA);
                    const dirInfoB = getBoardingDirectionInfo(candB.route, transferPtB, transfer.latA, transfer.lngA, []);
                    const totalBusDist = (isFinite(bestDistA) ? bestDistA : 0) + (isFinite(bestDistB) ? bestDistB : 0);
                    const totalWalk = bestOrigA.dist + transfer.walkDist + bestDestB.dist;
                    const estimatedMin = estimateTripMinutes(totalWalk, totalBusDist > 0 ? totalBusDist : Infinity, 1);

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
                        dirInfo: dirInfoA,
                        dirInfoB,
                        transfer,
                        boardLabel: findNearestStopLabel(candA.route, bestOrigA.lat, bestOrigA.lng),
                        transferLabel,
                        alightLabel: findNearestStopLabel(candB.route, bestDestB.lat, bestDestB.lng),
                        normalPrice: getRouteNormalPrice(candA.route) + getRouteNormalPrice(candB.route),
                        studentPrice: getRouteStudentPrice(candA.route) + getRouteStudentPrice(candB.route),
                        totalPrice: getActiveRoutePrice(candA.route) + getActiveRoutePrice(candB.route),
                        score: bestOrigA.dist + transfer.walkDist * 1.5 + bestDestB.dist + 450
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
                            <button type="button" class="btn-onboard-start" onclick="event.stopPropagation(); startOnboardTrip(${idx})">
                                <img src="assets/icons/ui_camion.svg" alt="" style="width:15px;height:15px;filter:brightness(0) invert(1);"> Voy a bordo · Seguir viaje
                            </button>
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
                            <button type="button" class="btn-onboard-start" onclick="event.stopPropagation(); startOnboardTrip(${idx})">
                                <img src="assets/icons/ui_camion.svg" alt="" style="width:15px;height:15px;filter:brightness(0) invert(1);"> Voy a bordo · Seguir viaje
                            </button>
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

    const btnNotificaciones = document.getElementById('btn-notificaciones');
    const notificationsModal = document.getElementById('notifications-modal');
    const notificationsClose = document.getElementById('notifications-close');
    const notificationsReportBtn = document.getElementById('notifications-report-btn');
    
    if (btnNotificaciones && notificationsModal) {
        btnNotificaciones.addEventListener('click', () => notificationsModal.style.display = 'flex');
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
        reportForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (reportModal) reportModal.style.display = 'none';
            reportForm.reset();
            showToast('¡Reporte enviado con éxito! Gracias por ayudar a mejorar Don Rutero.');
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

    // User badge (account modal & logout)
    const userBadge = document.getElementById('user-badge');
    const accountModal = document.getElementById('account-modal');
    const accountClose = document.getElementById('account-close');
    const accountLogoutBtn = document.getElementById('account-logout-btn');
    const btnToggleChangePwd = document.getElementById('btn-toggle-change-pwd');
    const changePwdForm = document.getElementById('change-password-form');
    const changePwdErr = document.getElementById('change-pwd-error');
    
    function resetChangePasswordForm() {
        if (changePwdForm) {
            changePwdForm.reset();
            changePwdForm.style.display = 'none';
        }
        if (changePwdErr) {
            changePwdErr.textContent = '';
            changePwdErr.style.display = 'none';
        }
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
        });
    }
    if (changePwdForm) {
        changePwdForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (changePwdErr) changePwdErr.style.display = 'none';
            const curr = document.getElementById('current-password-input').value;
            const next = document.getElementById('new-password-input').value;
            const conf = document.getElementById('confirm-new-password-input').value;

            if (next.length < 8) {
                changePwdErr.textContent = 'La nueva contraseña debe tener al menos 8 caracteres.';
                changePwdErr.style.display = 'block';
                return;
            }
            if (next !== conf) {
                changePwdErr.textContent = 'Las nuevas contraseñas no coinciden.';
                changePwdErr.style.display = 'block';
                return;
            }
            try {
                await Api.changePassword(curr, next);
                resetChangePasswordForm();
                accountModal.style.display = 'none';
                showToast('Contraseña actualizada correctamente');
            } catch (err) {
                changePwdErr.textContent = err.message || 'No se pudo actualizar la contraseña.';
                changePwdErr.style.display = 'block';
            }
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
    });
    if (loginClose) loginClose.addEventListener('click', () => { loginModal.style.display = 'none'; });

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (loginErrorBanner) loginErrorBanner.style.display = 'none';
            const u = document.getElementById('login-username').value.trim();
            const p = document.getElementById('login-password').value;
            if (!u || !p) {
                if (loginErrorText) loginErrorText.textContent = 'Por favor ingresa usuario y contraseña';
                if (loginErrorBanner) loginErrorBanner.style.display = 'flex';
                return;
            }
            try {
                const success = await Auth.login(u, p);
                if (success) { 
                    loginModal.style.display = 'none'; 
                    loginForm.reset(); 
                } else {
                    if (loginErrorText) loginErrorText.textContent = 'Usuario o contraseña incorrectos';
                    if (loginErrorBanner) loginErrorBanner.style.display = 'flex';
                }
            } catch (err) {
                if (loginErrorText) loginErrorText.textContent = err.message || 'Error al iniciar sesión';
                if (loginErrorBanner) loginErrorBanner.style.display = 'flex';
            }
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

    function resetRegisterModal() {
        if (regErrorBanner) regErrorBanner.style.display = 'none';
        if (verifyErrorBanner) verifyErrorBanner.style.display = 'none';
        if (step1Container) step1Container.style.display = 'flex';
        if (step2Container) step2Container.style.display = 'none';
        if (registerForm) registerForm.reset();
        if (verifyForm) verifyForm.reset();
    }

    if (openRegister) openRegister.addEventListener('click', async (e) => { 
        e.preventDefault(); 
        loginModal.style.display = 'none'; 
        resetRegisterModal();
        registerModal.style.display = 'flex';
        if (regSubmitBtn) {
            try {
                const cfg = await Api.getAuthConfig();
                regSubmitBtn.textContent = (cfg && cfg.requireEmailVerification === false)
                    ? 'Crear cuenta'
                    : 'Siguiente: Verificar correo';
            } catch (_) {}
        }
    });
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

            const email = document.getElementById('register-email').value.trim();
            const u = document.getElementById('register-username').value.trim();
            const p = document.getElementById('register-password').value;
            const confirmP = document.getElementById('register-confirm-password').value;

            // Validaciones
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                regErrorText.textContent = 'Ingresa un correo electrónico válido';
                regErrorBanner.style.display = 'flex';
                return;
            }
            if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(u)) {
                regErrorText.textContent = 'El usuario debe tener entre 3 y 30 caracteres (letras, números, . _ -)';
                regErrorBanner.style.display = 'flex';
                return;
            }
            if (p.length < 8) {
                regErrorText.textContent = 'La contraseña debe tener al menos 8 caracteres';
                regErrorBanner.style.display = 'flex';
                return;
            }
            if (p !== confirmP) {
                regErrorText.textContent = 'Las contraseñas no coinciden';
                regErrorBanner.style.display = 'flex';
                return;
            }

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
                    showToast(`📲 Demo: Tu código para ${email} es ${res.code}`);
                } else {
                    showToast('Código de verificación enviado a tu correo.');
                }
            } catch (err) {
                regErrorText.textContent = err.message || 'Error al validar el correo';
                regErrorBanner.style.display = 'flex';
            }
        });
    }

    // PASO 2: Verificar código en el servidor y crear cuenta
    if (verifyForm) {
        verifyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (verifyErrorBanner) verifyErrorBanner.style.display = 'none';

            const codeInput = document.getElementById('register-code-input').value.trim();
            if (!/^\d{6}$/.test(codeInput)) {
                verifyErrorText.textContent = 'Ingresa un código de 6 dígitos';
                verifyErrorBanner.style.display = 'flex';
                return;
            }

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
                verifyErrorText.textContent = err.message || 'Código incorrecto o error al crear la cuenta';
                verifyErrorBanner.style.display = 'flex';
            }
        });
    }

    const resendLink = document.getElementById('resend-code-link');
    if (resendLink) {
        resendLink.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                const res = await Api.sendVerificationCode(window._tempRegEmail);
                if (res && res.code) {
                    showToast(`📲 Demo: Nuevo código enviado: ${res.code}`);
                } else {
                    showToast('Nuevo código enviado a tu correo.');
                }
            } catch (err) {
                showToast(err.message, 'error');
            }
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

    // Forgot Password modal
    const forgotModal = document.getElementById('forgot-modal');
    const forgotClose = document.getElementById('forgot-close');
    const forgotForm = document.getElementById('forgot-form');
    const openForgot = document.getElementById('open-forgot');
    const forgotBackLogin = document.getElementById('forgot-back-login');
    const forgotErrorBanner = document.getElementById('forgot-error-banner');
    const forgotErrorText = document.getElementById('forgot-error-text');
    const forgotSuccessBanner = document.getElementById('forgot-success-banner');
    const forgotSuccessText = document.getElementById('forgot-success-text');

    function resetForgotModal() {
        if (forgotErrorBanner) forgotErrorBanner.style.display = 'none';
        if (forgotSuccessBanner) forgotSuccessBanner.style.display = 'none';
        if (forgotForm) forgotForm.reset();
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

    if (forgotForm) {
        forgotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (forgotErrorBanner) forgotErrorBanner.style.display = 'none';
            if (forgotSuccessBanner) forgotSuccessBanner.style.display = 'none';

            const email = document.getElementById('forgot-email').value.trim();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                if (forgotErrorText) forgotErrorText.textContent = 'Ingresa un correo electrónico válido';
                if (forgotErrorBanner) forgotErrorBanner.style.display = 'flex';
                return;
            }

            try {
                const res = await Api.forgotPassword(email);
                if (forgotSuccessText) forgotSuccessText.textContent = res.message || 'Enlace enviado con éxito';
                if (forgotSuccessBanner) forgotSuccessBanner.style.display = 'flex';
            } catch (err) {
                if (forgotErrorText) forgotErrorText.textContent = err.message || 'No existe ninguna cuenta con este correo';
                if (forgotErrorBanner) forgotErrorBanner.style.display = 'flex';
            }
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
        body: '1. Buscador Principal:\nEscribe el nombre de la colonia, hospital o plaza a la que quieres ir. Te mostraremos las rutas que pasan cerca.\n\n2. Planificador Inteligente (¿Cómo llego?):\nPon el lugar donde estás y el lugar a donde vas. El sistema calculará automáticamente qué camión te lleva más directo.\n\n3. Detalles de Ruta:\nToca cualquier camión de la lista para ver su recorrido exacto en el mapa.'
    },
    'faq': {
        title: 'Preguntas Frecuentes (FAQ)',
        icon: 'assets/icons/ui_campana.svg',
        body: '• ¿Cuánto cuesta el pasaje?\nTarifa normal: $13 MXN (unidades tradicionales) y hasta $15 MXN (unidades con aire acondicionado).\n\n• ¿Cuánto cuesta el pasaje estudiantil?\n$3.50 MXN presentando tu credencial escolar vigente o Tarjeta Inteligente (TIIE).\n\n• ¿A qué hora dejan de pasar?\nLa gran mayoría inician sus recorridos a las 5:30 AM y terminan su última vuelta alrededor de las 10:00 PM o 10:30 PM. ¡Toma tus precauciones!\n\n• ¿La aplicación es gratis?\nSí, 100% gratuita para apoyar a todos los mazatlecos y turistas.'
    },
    'transporte_mzt': {
        title: 'Guía del Transporte en Mazatlán',
        icon: 'assets/icons/ui_camion.svg',
        body: 'En Mazatlán operan principalmente dos concesionarios:\n\n- Alianza de Camiones (Verdes / "Puro Sinaloa"):\nOperan unidades modernas, la mayoría con aire acondicionado, cubriendo toda la ciudad y zona costera.\n\n- Águilas del Pacífico (Rojos):\nAutobuses tradicionales que conectan colonias populares con el Centro Histórico y Zona Dorada.'
    },
    'acerca': {
        title: 'Acerca de Don Rutero',
        icon: 'assets/icons/ui_ubicacion.svg',
        body: 'Don Rutero es una plataforma digital de movilidad urbana creada para facilitar los traslados en transporte público en Mazatlán, Sinaloa.\n\nNuestra misión es ayudar tanto a locales como a turistas a navegar la ciudad de forma fácil, rápida y sin perderse en el intento.'
    },
    'legal': {
        title: 'Privacidad y Avisos Legales',
        icon: 'assets/icons/ui_filtro.svg',
        body: 'La información mostrada es referencial y puede sufrir cambios sin previo aviso.\n\nPrivacidad: Tu ubicación GPS solo se usa de forma local en tu dispositivo y nunca se comparte con terceros.'
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
    if (bodyEl) bodyEl.textContent = data.body;
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
        }
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
    busMarker: null,
    notifiedNearLeg: false,
    notifiedNearEnd: false
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
    const etaMin = Math.max(1, Math.round((remainToActionM / 1000) / 22 * 60));

    if (routeBar) routeBar.style.background = pt.routeColor;
    if (routeNameEl) routeNameEl.textContent = pt.routeName;
    if (badgeEl) badgeEl.textContent = onboardState.source === 'gps' ? 'GPS EN VIVO' : 'VOY A BORDO';
    if (fillEl) fillEl.style.width = `${pct.toFixed(1)}%`;

    const upcomingStop = onboardState.stopsTimeline.find((s) => s.cumM > distM + 40 && s.legIdx === pt.legIdx);
    const isArrived = distM >= total - 35;
    const isNearAction = remainToActionM <= 300;

    if (nextStopEl) {
        nextStopEl.classList.toggle('alert-near', isNearAction && !isArrived);
        if (isArrived) {
            nextStopEl.textContent = `Llegaste cerca de ${opt.alightLabel || 'tu destino'}`;
        } else if (isNearAction) {
            if (inFirstLeg) {
                nextStopEl.textContent = `Prepárate para transbordar (${remainToActionM} m)`;
            } else {
                nextStopEl.textContent = `¡Prepárate para bajar! (${remainToActionM} m)`;
            }
        } else if (upcomingStop) {
            const toNext = Math.max(20, Math.round(upcomingStop.cumM - distM));
            nextStopEl.textContent = `Próx. parada: ${upcomingStop.name} (${formatOnboardDistance(toNext)})`;
        } else {
            nextStopEl.textContent = inFirstLeg
                ? `Rumbo a transbordo (${formatOnboardDistance(remainToActionM)})`
                : `Rumbo a descenso (${formatOnboardDistance(remainToActionM)})`;
        }
    }

    if (alightEl) {
        if (isArrived) {
            alightEl.textContent = 'Recorrido completado · Puedes finalizar el seguimiento';
        } else if (inFirstLeg) {
            const trPlace = opt.transferLabel ? `${opt.transferLabel} · ` : '';
            alightEl.textContent = `Transbordo (${trPlace}${opt.routeB.name.trim()}) en ${formatOnboardDistance(remainToActionM)} (~${etaMin} min)`;
        } else {
            const destLabel = opt.alightLabel || (selectedDestination ? selectedDestination.name : 'tu destino');
            alightEl.textContent = `Tu bajada (${destLabel}) en ${formatOnboardDistance(remainToActionM)} (~${etaMin} min)`;
        }
    }

    if (inFirstLeg && isNearAction && !onboardState.notifiedNearLeg) {
        onboardState.notifiedNearLeg = true;
        showToast('Próximo transbordo en menos de 300 m');
        if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    }
    if (!inFirstLeg && isNearAction && !isArrived && !onboardState.notifiedNearEnd) {
        onboardState.notifiedNearEnd = true;
        showToast('¡Prepárate para bajar! Tu parada está a menos de 300 m');
        if (navigator.vibrate) navigator.vibrate([160, 80, 160]);
    }
}

function clearOnboardTimers() {
    if (onboardState.timerId) {
        clearInterval(onboardState.timerId);
        onboardState.timerId = null;
    }
    if (onboardState.watchId != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(onboardState.watchId);
        onboardState.watchId = null;
    }
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

function startOnboardGpsWatch() {
    clearOnboardTimers();
    if (!navigator.geolocation) {
        showToast('Tu navegador no soporta GPS en vivo; usando simulación.', 'error');
        setOnboardTrackingSource('sim');
        return;
    }
    if (window.isSecureContext === false) {
        showToast('En celular sin HTTPS el GPS está bloqueado; puedes usar Simular.', 'error');
        setOnboardTrackingSource('sim');
        return;
    }
    showToast('GPS en vivo activado para tu viaje');
    onboardState.watchId = navigator.geolocation.watchPosition(
        (pos) => {
            if (!onboardState.active || onboardState.source !== 'gps') return;
            const { latitude, longitude } = pos.coords;
            const proj = projectCoordOntoJourney(latitude, longitude);
            onboardState.currentDistM = proj.bestCumM;
            updateOnboardHudAtDistance(onboardState.currentDistM);
            renderOnboardBusMarker(latitude, longitude, '#005C97');
        },
        (err) => {
            showToast(`${getGeolocationErrorMessage(err)} Puedes usar Simular.`, 'error');
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
    );
}

function startOnboardTrip(optionIdx) {
    const opt = window._tripComputedOptions && window._tripComputedOptions[optionIdx];
    if (!opt) return;

    viewTripOptionOnMap(opt);
    const journey = buildOnboardJourneyData(opt);
    if (!journey.points || journey.points.length < 2) {
        showToast('No hay trazo suficiente para iniciar el seguimiento a bordo', 'error');
        return;
    }

    stopOnboardTrip({ silent: true });

    onboardState.active = true;
    onboardState.option = opt;
    onboardState.points = journey.points;
    onboardState.totalDistM = journey.totalDistM;
    onboardState.legSplitM = journey.legSplitM;
    onboardState.stopsTimeline = journey.stopsTimeline;
    onboardState.currentDistM = 0;
    onboardState.paused = false;
    onboardState.speedMultiplier = 1;
    onboardState.source = 'sim';
    onboardState.notifiedNearLeg = false;
    onboardState.notifiedNearEnd = false;

    const hud = document.getElementById('onboard-hud');
    const playBtn = document.getElementById('onboard-play-btn');
    const speedBtn = document.getElementById('onboard-speed-btn');
    if (playBtn) playBtn.textContent = 'Pausar';
    if (speedBtn) speedBtn.textContent = '1x';
    if (hud) hud.style.display = 'block';

    setOnboardTrackingSource('sim');
    updateOnboardHudAtDistance(0);
    if (isMobileViewport()) setMobileSheetState('peek');
    showToast('Modo "Voy a bordo" activo');
}

function setOnboardTrackingSource(source) {
    onboardState.source = source === 'gps' ? 'gps' : 'sim';
    const simPill = document.getElementById('onboard-src-sim');
    const gpsPill = document.getElementById('onboard-src-gps');
    const simCtrls = document.getElementById('onboard-sim-controls');
    if (simPill) simPill.classList.toggle('active', onboardState.source === 'sim');
    if (gpsPill) gpsPill.classList.toggle('active', onboardState.source === 'gps');
    if (simCtrls) simCtrls.style.display = onboardState.source === 'sim' ? 'inline-flex' : 'none';

    if (!onboardState.active) return;
    if (onboardState.source === 'gps') {
        startOnboardGpsWatch();
    } else {
        startOnboardSimulationLoop();
    }
    updateOnboardHudAtDistance(onboardState.currentDistM);
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
    if (onboardState.busMarker && mapInstance) {
        mapInstance.removeLayer(onboardState.busMarker);
        onboardState.busMarker = null;
    }
    const hud = document.getElementById('onboard-hud');
    if (hud) hud.style.display = 'none';
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



