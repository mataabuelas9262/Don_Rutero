/* -----------------------------------------------------
   LÓGICA DEL PANEL DE ADMINISTRACIÓN (Ruta_Bus)
   ----------------------------------------------------- */

let adminRoutes = [];
let selectedRouteId = null;

// Filtros y pestaña activa del panel admin
let activeAdminTab = 'routes'; // 'routes' | 'stops' | 'reports'
let routeStatusFilter = 'all'; // 'all' | 'active' | 'inactive'
let routeSearchText = '';
let stopStatusFilter = 'all';  // 'all' | 'orphan'
let stopSearchText = '';
let adminReportsData = [];
let reportStatusFilter = 'all'; // 'all' | 'pendiente' | 'en_revision' | 'resuelto' | 'descartado'

// Estados del mapa en edición
let drawingMode = false;       // Trazar línea de calles
let stopCreationMode = false;  // Colocar o reubicar una parada
let relocateStopId = null;     // ID si se está reubicando una parada existente
let drawnCoordinates = [];

let historyStack = [];
let initialStudioCoordsSnapshot = '[]';
let initialStudioStopsSnapshot = '[]';

// Referencias a marcadores físicos por stop.id para sincronizar estado visual con MarkerCluster
const physicalStopMarkersMap = new Map();
let importedRouteDraftMeta = null; // { name, color } sugeridos al importar KML
let detectedKmlTracks = [];

function serializeStudioCoords(coords) {
    if (!Array.isArray(coords)) return '[]';
    return JSON.stringify(coords.map(c => [
        Number(c.latitude).toFixed(6),
        Number(c.longitude).toFixed(6)
    ]));
}

function serializeStudioStops(stopIds) {
    if (!Array.isArray(stopIds)) return '[]';
    return JSON.stringify(stopIds.map(id => Number(id)));
}

function captureStudioBaseline() {
    initialStudioCoordsSnapshot = serializeStudioCoords(drawnCoordinates);
    initialStudioStopsSnapshot = serializeStudioStops(selectedStopIds);
}

function hasUnsavedStudioChanges() {
    if (!drawingMode) return false;
    return serializeStudioCoords(drawnCoordinates) !== initialStudioCoordsSnapshot
        || serializeStudioStops(selectedStopIds) !== initialStudioStopsSnapshot;
}

function showAdminConfirm({
    title = 'Confirmar acción',
    message = '',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    danger = true
} = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-modal-title');
        const msgEl = document.getElementById('confirm-modal-message');
        const okBtn = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');
        const closeBtn = document.getElementById('confirm-modal-close');
        const badgeEl = document.getElementById('confirm-modal-badge');

        if (!modal || !okBtn || !cancelBtn) {
            resolve(false);
            return;
        }

        titleEl.textContent = title;
        msgEl.textContent = message;
        okBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;
        okBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';

        if (badgeEl) {
            badgeEl.style.background = danger ? '#fee2e2' : '#eef2ff';
            badgeEl.style.color = danger ? '#dc2626' : 'var(--primary)';
            badgeEl.textContent = danger ? '!' : '?';
        }

        modal.style.display = 'flex';

        const cleanup = (result) => {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            if (closeBtn) closeBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onOverlayClick);
            document.removeEventListener('keydown', onKeyDown);
            resolve(result);
        };

        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        const onOverlayClick = (e) => {
            if (e.target === modal) cleanup(false);
        };
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                cleanup(false);
            }
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        if (closeBtn) closeBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onOverlayClick);
        document.addEventListener('keydown', onKeyDown);
    });
}

async function confirmDiscardStudioChanges(actionText) {
    if (!hasUnsavedStudioChanges()) return true;
    const count = drawnCoordinates.length;
    const message = count > 0
        ? `Realizaste cambios sin guardar en el trazado (${count} puntos en el mapa). Si continúas para ${actionText}, se descartarán tus modificaciones.`
        : 'Realizaste cambios sin guardar en el trazado. Si continúas, se descartarán tus modificaciones.';
    return await showAdminConfirm({
        title: 'Cambios sin guardar',
        message,
        confirmText: 'Descartar cambios',
        cancelText: 'Seguir editando',
        danger: true
    });
}

function saveToHistory() {
    historyStack.push(JSON.parse(JSON.stringify(drawnCoordinates)));
    if (historyStack.length > 50) {
        historyStack.shift();
    }
}
     // [{latitude, longitude}]
let selectedStopIds = [];      // [stopId] (en orden)
let tempPolyline = null;       // Línea temporal dibujada en caliente
let studioBaseColor = '#ff4b2b'; // Color principal activo para el Studio
let tempMarkers = [];          // Marcadores temporales de trazado
let tempArrows = [];           // Flechas de dirección temporales en el Studio
let physicalStopsData = [];    // Lista de paradas físicas cargadas de la DB
let adminOsmSearchTimer = null;
let adminOsmSearchResults = [];
let adminOsmSearchMarker = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Inicializar sesión. Si no es admin, fuera
    await Auth.init();
    if (!Auth.user || Auth.user.role !== 'ROLE_ADMIN') {
        window.location.href = 'index.html';
        return;
    }

    // 2. Inicializar el mapa de Leaflet
    const map = initLeafletMap('map');

    // 3. Cargar rutas, paradas físicas y reportes ciudadanos (en paralelo)
    await Promise.all([refreshAdminRoutes(), refreshPhysicalStops(), refreshAdminReports()]);

    // 4. Configurar eventos del panel
    setupAdminEventListeners(map);
});

function updateAdminStats() {
    const routesEl = document.getElementById('stat-routes-count');
    const routesSubEl = document.getElementById('stat-routes-sub');
    const stopsEl = document.getElementById('stat-stops-count');
    const orphansEl = document.getElementById('stat-orphans-count');
    const orphansBtn = document.getElementById('stat-orphans-btn');

    const totalRoutes = adminRoutes.length;
    const activeRoutes = adminRoutes.filter(r => r.active !== false).length;
    const totalStops = physicalStopsData.length;
    const orphanStops = physicalStopsData.filter(s => Number(s.routeCount || 0) === 0).length;

    if (routesEl) routesEl.textContent = String(totalRoutes);
    if (routesSubEl) routesSubEl.textContent = `${activeRoutes} activas`;
    if (stopsEl) stopsEl.textContent = String(totalStops);
    if (orphansEl) orphansEl.textContent = String(orphanStops);
    if (orphansBtn) orphansBtn.classList.toggle('has-warning', orphanStops > 0);
}

function switchAdminTab(tab) {
    activeAdminTab = (tab === 'stops' || tab === 'reports') ? tab : 'routes';
    const routesTab = document.getElementById('admin-tab-routes');
    const stopsTab = document.getElementById('admin-tab-stops');
    const reportsTab = document.getElementById('admin-tab-reports');
    const routesPanel = document.getElementById('admin-routes-panel');
    const stopsPanel = document.getElementById('admin-stops-panel');
    const reportsPanel = document.getElementById('admin-reports-panel');

    if (routesTab) routesTab.classList.toggle('active', activeAdminTab === 'routes');
    if (stopsTab) stopsTab.classList.toggle('active', activeAdminTab === 'stops');
    if (reportsTab) reportsTab.classList.toggle('active', activeAdminTab === 'reports');
    if (routesPanel) routesPanel.style.display = activeAdminTab === 'routes' ? 'flex' : 'none';
    if (stopsPanel) stopsPanel.style.display = activeAdminTab === 'stops' ? 'flex' : 'none';
    if (reportsPanel) reportsPanel.style.display = activeAdminTab === 'reports' ? 'flex' : 'none';
}

const REPORT_TYPE_LABELS = {
    desvio: 'Desvío / Obra',
    nueva_parada: 'Nueva parada',
    falta_ruta: 'Falta ruta',
    correccion: 'Corrección',
    general: 'Sugerencia'
};

const REPORT_STATUS_META = {
    pendiente: { label: 'Pendiente', cls: 'status-pendiente' },
    en_revision: { label: 'En revisión', cls: 'status-revision' },
    resuelto: { label: 'Resuelto', cls: 'status-resuelto' },
    descartado: { label: 'Descartado', cls: 'status-descartado' }
};

async function refreshAdminReports() {
    try {
        adminReportsData = await Api.getAdminReports();
        if (!Array.isArray(adminReportsData)) adminReportsData = [];
        updateAdminReportsBadge();
        renderAdminReports();
    } catch (err) {
        console.warn('No se pudieron cargar reportes ciudadanos:', err.message);
    }
}

function updateAdminReportsBadge() {
    const badge = document.getElementById('admin-reports-badge');
    if (!badge) return;
    const pendingCount = adminReportsData.filter(r => r.status === 'pendiente').length;
    badge.textContent = String(pendingCount);
    badge.style.display = pendingCount > 0 ? 'inline-flex' : 'none';
}

function renderAdminReports() {
    const container = document.getElementById('admin-report-list');
    if (!container) return;
    container.innerHTML = '';

    const filtered = adminReportsData.filter(r => reportStatusFilter === 'all' || r.status === reportStatusFilter);
    if (filtered.length === 0) {
        const msg = adminReportsData.length === 0
            ? 'Todavía no hay reportes ciudadanos registrados.'
            : 'No hay reportes en este estado.';
        container.innerHTML = `<div style="padding: 18px 12px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">${escapeAdminHtml(msg)}</div>`;
        return;
    }

    filtered.forEach(rep => {
        const typeLabel = REPORT_TYPE_LABELS[rep.type] || 'Reporte';
        const stMeta = REPORT_STATUS_META[rep.status] || REPORT_STATUS_META.pendiente;
        let dateStr = '';
        if (rep.createdAt) {
            const rawStr = String(rep.createdAt).trim();
            const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(rawStr);
            const utcDate = new Date(hasTz ? rawStr : `${rawStr}Z`);
            if (!isNaN(utcDate.getTime())) {
                dateStr = utcDate.toLocaleString('es-MX', {
                    timeZone: 'America/Mazatlan',
                    dateStyle: 'short',
                    timeStyle: 'short'
                });
            }
        }
        const reporterText = rep.reporterUsername ? `Por: ${rep.reporterUsername}` : 'Anónimo';

        const card = document.createElement('div');
        card.className = 'admin-report-card';
        card.innerHTML = `
            <div class="admin-report-head">
                <span class="admin-report-type">${escapeAdminHtml(typeLabel)}</span>
                <span class="admin-report-status ${stMeta.cls}">${escapeAdminHtml(stMeta.label)}</span>
            </div>
            <div class="admin-report-title">${escapeAdminHtml(rep.routeOrPlace)}</div>
            <div class="admin-report-desc">${escapeAdminHtml(rep.description)}</div>
            <div class="admin-report-meta">
                <span>${escapeAdminHtml(reporterText)}</span>
                ${dateStr ? `<span>${escapeAdminHtml(dateStr)}</span>` : ''}
            </div>
            ${rep.adminNote ? `<div class="admin-report-note"><strong>Nota:</strong> ${escapeAdminHtml(rep.adminNote)}</div>` : ''}
            <div class="admin-report-note-editor" style="display: none; margin-top: 8px; gap: 6px; flex-direction: column;">
                <textarea class="form-control admin-report-note-input" rows="2" maxlength="500" placeholder="Nota interna sobre cómo se atendió o por qué se descartó..." style="font-size: 0.76rem; padding: 6px 8px;">${escapeAdminHtml(rep.adminNote || '')}</textarea>
                <div style="display: flex; gap: 6px;">
                    <button type="button" class="route-actions-btn" data-action="save-note" style="font-size: 0.72rem; padding: 4px 8px; color: var(--primary); font-weight: 700;">Guardar nota</button>
                    <button type="button" class="route-actions-btn" data-action="cancel-note" style="font-size: 0.72rem; padding: 4px 8px;">Cancelar</button>
                </div>
            </div>
            <div class="admin-report-actions">
                ${rep.status !== 'en_revision' ? `<button type="button" class="route-actions-btn" data-status="en_revision">Revisar</button>` : ''}
                ${rep.status !== 'resuelto' ? `<button type="button" class="route-actions-btn" data-status="resuelto" style="color: var(--success);">Resolver</button>` : ''}
                ${rep.status !== 'descartado' ? `<button type="button" class="route-actions-btn" data-status="descartado">Descartar</button>` : ''}
                <button type="button" class="route-actions-btn" data-action="locate-osm" title="Buscar este lugar en OpenStreetMap">Ubicar OSM</button>
                <button type="button" class="route-actions-btn" data-action="toggle-note">Nota</button>
                <button type="button" class="route-actions-btn" data-action="delete" style="color: var(--danger);">Eliminar</button>
            </div>
        `;

        card.querySelectorAll('[data-status]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const nextStatus = btn.getAttribute('data-status');
                try {
                    const updated = await Api.updateAdminReport(rep.id, nextStatus, rep.adminNote || '');
                    const idx = adminReportsData.findIndex(x => x.id === rep.id);
                    if (idx >= 0) adminReportsData[idx] = updated;
                    updateAdminReportsBadge();
                    renderAdminReports();
                    showToast('Estado del reporte actualizado.');
                } catch (err) {
                    showToast(err.message, 'error');
                }
            });
        });

        card.querySelector('[data-action="locate-osm"]').addEventListener('click', () => {
            const osmInput = document.getElementById('admin-osm-search-input');
            if (osmInput) {
                osmInput.value = rep.routeOrPlace || '';
                osmInput.focus();
                searchAdminOSMPlaces(osmInput.value);
            }
        });

        const noteEditor = card.querySelector('.admin-report-note-editor');
        const noteInput = card.querySelector('.admin-report-note-input');
        card.querySelector('[data-action="toggle-note"]').addEventListener('click', () => {
            if (noteEditor) noteEditor.style.display = noteEditor.style.display === 'none' ? 'flex' : 'none';
        });
        card.querySelector('[data-action="cancel-note"]').addEventListener('click', () => {
            if (noteEditor) noteEditor.style.display = 'none';
        });
        card.querySelector('[data-action="save-note"]').addEventListener('click', async () => {
            try {
                const nextNote = noteInput ? noteInput.value.trim() : '';
                const updated = await Api.updateAdminReport(rep.id, rep.status, nextNote);
                const idx = adminReportsData.findIndex(x => x.id === rep.id);
                if (idx >= 0) adminReportsData[idx] = updated;
                renderAdminReports();
                showToast('Nota guardada.');
            } catch (err) {
                showToast(err.message, 'error');
            }
        });

        card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
            const ok = await showAdminConfirm({
                title: '¿Eliminar reporte?',
                message: `Se borrará permanentemente el reporte sobre "${rep.routeOrPlace}".`,
                confirmText: 'Sí, eliminar',
                danger: true
            });
            if (!ok) return;
            try {
                await Api.deleteAdminReport(rep.id);
                adminReportsData = adminReportsData.filter(x => x.id !== rep.id);
                updateAdminReportsBadge();
                renderAdminReports();
                showToast('Reporte eliminado.');
            } catch (err) {
                showToast(err.message, 'error');
            }
        });

        container.appendChild(card);
    });
}

function setAdminPanelCollapsed(collapsed) {
    const sidebar = document.getElementById('admin-sidebar') || document.querySelector('.admin-body .sidebar');
    const toggleBtn = document.getElementById('admin-panel-toggle');
    if (!sidebar) return;
    sidebar.classList.toggle('admin-collapsed', Boolean(collapsed));
    if (toggleBtn) {
        const isCollapsed = sidebar.classList.contains('admin-collapsed');
        toggleBtn.textContent = isCollapsed ? 'Ver panel' : 'Ocultar';
        toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
    }
}

function minimizeStudioHudOnCompactScreen() {
    if (window.innerWidth > 1024) return;
    const studioHud = document.getElementById('studio-controls-hud');
    const studioHudToggle = document.getElementById('studio-hud-toggle');
    if (studioHud) studioHud.classList.add('minimized');
    if (studioHudToggle) studioHudToggle.textContent = 'Ver controles';
}

function setStopPlacementMode({ active, targetStopId = null, message = '' } = {}) {
    stopCreationMode = Boolean(active);
    relocateStopId = stopCreationMode ? (targetStopId ? Number(targetStopId) : null) : null;

    const banner = document.getElementById('stop-mode-banner');
    const bannerText = document.getElementById('stop-mode-banner-text');
    const mapEl = document.getElementById('map');

    if (banner) banner.style.display = stopCreationMode ? 'flex' : 'none';
    if (bannerText && message) bannerText.textContent = message;
    if (mapEl) mapEl.classList.toggle('stop-placement-cursor', stopCreationMode);
    if (stopCreationMode && window.innerWidth <= 1024) {
        setAdminPanelCollapsed(true);
    }
}

// Obtiene y recarga la lista completa de rutas (activas y ocultas) en el panel lateral del admin
async function refreshAdminRoutes() {
    try {
        adminRoutes = await Api.getAdminRoutes();
        renderAdminRoutes();
        updateAdminStats();
    } catch (err) {
        showToast(err.message || 'Error al cargar rutas administrativas', 'error');
    }
}

function getFilteredAdminRoutes() {
    const query = routeSearchText.trim().toLowerCase();
    return adminRoutes.filter(route => {
        const isActive = route.active !== false;
        if (routeStatusFilter === 'active' && !isActive) return false;
        if (routeStatusFilter === 'inactive' && isActive) return false;
        if (query) {
            const hay = `${route.name || ''} ${route.description || ''}`.toLowerCase();
            if (!hay.includes(query)) return false;
        }
        return true;
    });
}

// Renderiza las rutas con badges de estado y acciones sin handlers inline
function renderAdminRoutes() {
    const listContainer = document.getElementById('route-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const routes = getFilteredAdminRoutes();
    if (routes.length === 0) {
        const emptyMsg = adminRoutes.length === 0
            ? 'No hay rutas. Crea una para empezar.'
            : 'Ninguna ruta coincide con el filtro actual.';
        listContainer.innerHTML = `<div style="text-align:center; color:var(--text-muted); font-size:0.88rem; padding: 20px;">${escapeAdminHtml(emptyMsg)}</div>`;
        return;
    }

    routes.forEach(route => {
        const card = document.createElement('div');
        const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(String(route.color || '').trim()) ? route.color.trim() : '#E63E21';
        const routeIdNum = Number(route.id);
        const isActive = route.active !== false;
        const coordCount = Number(route.coordCount ?? 0);
        const stopCount = Number(route.stopCount ?? 0);

        card.className = 'route-card' + (isActive ? '' : ' is-inactive') + (selectedRouteId === routeIdNum ? ' active' : '');
        card.style.setProperty('--card-accent', safeColor);
        card.dataset.id = String(routeIdNum);

        const warnNoTrace = coordCount < 2 ? '<span class="admin-meta-warn">Sin trazado</span>' : '';
        const warnNoStops = stopCount === 0 ? '<span class="admin-meta-warn">Sin paradas</span>' : '';

        card.innerHTML = `
            <div class="route-indicator" style="background-color: ${safeColor}; color: ${safeColor};"></div>
            <div class="route-info">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                    <div class="route-name" style="margin: 0;">${escapeAdminHtml(route.name)}</div>
                    <span class="admin-status-badge ${isActive ? 'active' : 'inactive'}">${isActive ? 'Activa' : 'Oculta'}</span>
                </div>
                <div class="route-desc">${escapeAdminHtml(route.description || 'Sin descripción.')}</div>
                <div class="admin-meta-line">
                    <span>${coordCount} pts · ${stopCount} paradas</span>
                    ${warnNoTrace}
                    ${warnNoStops}
                </div>
                <div class="admin-header-actions" style="margin-top: 8px; flex-wrap: wrap; gap: 5px;">
                    <button type="button" class="btn btn-secondary" data-action="trace" style="padding: 4px 10px; font-size: 0.75rem;">Trazar</button>
                    <button type="button" class="route-actions-btn" data-action="toggle-active" style="font-size: 0.75rem;" title="${isActive ? 'Ocultar al público' : 'Publicar al público'}">${isActive ? 'Ocultar' : 'Activar'}</button>
                    <button type="button" class="route-actions-btn" data-action="edit" style="font-size: 0.75rem;" title="Editar información">Editar</button>
                    <button type="button" class="route-actions-btn" data-action="delete" title="Eliminar ruta" style="font-size: 0.75rem; color: var(--danger);">Eliminar</button>
                </div>
            </div>
        `;

        card.querySelector('[data-action="trace"]').addEventListener('click', (e) => {
            e.stopPropagation();
            startTrazadoMode(routeIdNum, safeColor);
        });
        card.querySelector('[data-action="toggle-active"]').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleRouteActiveAdmin(route);
        });
        card.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
            e.stopPropagation();
            openEditRouteModal(routeIdNum);
        });
        card.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
            e.stopPropagation();
            confirmDeleteRoute(routeIdNum);
        });

        card.addEventListener('click', () => selectRouteAdmin(routeIdNum, card));
        listContainer.appendChild(card);
    });
}

async function toggleRouteActiveAdmin(route) {
    const nextState = !(route.active !== false);
    try {
        await Api.toggleRouteActive(route.id, nextState);
        showToast(nextState ? `Ruta "${route.name}" activada para el público.` : `Ruta "${route.name}" ocultada del mapa público.`);
        await refreshAdminRoutes();
    } catch (err) {
        showToast(err.message || 'No se pudo cambiar el estado de la ruta', 'error');
    }
}

async function downloadAdminBackupJson() {
    try {
        const data = await Api.exportAdminCatalog();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateTag = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `don-rutero-respaldo-${dateTag}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast(`Respaldo descargado (${data.routeCount} rutas, ${data.stopCount} paradas).`);
    } catch (err) {
        showToast(err.message || 'No se pudo generar el respaldo JSON', 'error');
    }
}

// Selecciona una ruta y muestra su trazado actual (funciona también en rutas ocultas vía /api/admin/routes/{id}/...)
async function selectRouteAdmin(routeId, cardElement) {
    if (drawingMode) {
        if (!(await confirmDiscardStudioChanges('ver otra ruta'))) {
            return;
        }
        exitDrawingMode();
    }

    document.querySelectorAll('.route-card').forEach(c => c.classList.remove('active'));
    if (cardElement) cardElement.classList.add('active');

    selectedRouteId = routeId;

    try {
        clearMapDrawings();

        const route = adminRoutes.find(r => r.id === routeId);
        const color = route ? route.color : '#E63E21';

        const [coords, stops] = await Promise.all([
            Api.getAdminRouteCoordinates(routeId),
            Api.getAdminRouteStops(routeId)
        ]);
        drawRouteLine(coords, color);
        drawRouteStops(stops, color);
    } catch (err) {
        showToast('Error al visualizar ruta seleccionada', 'error');
    }
}

function getFilteredAdminStops() {
    const query = stopSearchText.trim().toLowerCase();
    return physicalStopsData.filter(stop => {
        if (stopStatusFilter === 'orphan' && Number(stop.routeCount || 0) > 0) return false;
        if (query) {
            const hay = `${stop.name || ''} ${stop.address || ''} ${stop.type || ''}`.toLowerCase();
            if (!hay.includes(query)) return false;
        }
        return true;
    });
}

function renderAdminStops() {
    const listContainer = document.getElementById('admin-stop-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const stops = getFilteredAdminStops();
    if (stops.length === 0) {
        const emptyMsg = physicalStopsData.length === 0
            ? 'No hay paradas registradas.'
            : 'Ninguna parada coincide con el filtro actual.';
        listContainer.innerHTML = `<div style="text-align:center; color:var(--text-muted); font-size:0.88rem; padding: 20px;">${escapeAdminHtml(emptyMsg)}</div>`;
        return;
    }

    stops.forEach(stop => {
        const config = (typeof getStopIconConfig === 'function')
            ? getStopIconConfig(stop.name, stop.type)
            : { bgColor: '#475569', category: 'Parada' };
        const routeCount = Number(stop.routeCount || 0);
        const card = document.createElement('div');
        card.className = 'admin-stop-card';

        card.innerHTML = `
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 6px;">
                <div style="min-width: 0;">
                    <div style="font-weight: 700; font-size: 0.86rem; color: var(--text-primary);">${escapeAdminHtml(stop.name)}</div>
                    <div style="font-size: 0.74rem; color: var(--text-secondary); margin-top: 2px;">${escapeAdminHtml(stop.address || 'Mazatlán, Sinaloa')}</div>
                </div>
                <span class="admin-status-badge ${routeCount > 0 ? 'active' : 'inactive'}" style="${routeCount === 0 ? 'background: #fef3c7; color: #b45309;' : ''}">
                    ${routeCount > 0 ? `${routeCount} ruta${routeCount > 1 ? 's' : ''}` : 'Sin ruta'}
                </span>
            </div>
            <div style="margin-top: 5px; display: flex; align-items: center; gap: 6px; font-size: 0.7rem; color: var(--text-muted);">
                <span style="padding: 1px 6px; border-radius: 4px; background: ${config.bgColor}18; color: ${config.bgColor}; font-weight: 700;">${escapeAdminHtml(config.category || stop.type || 'Parada')}</span>
                <span>${Number(stop.latitude).toFixed(5)}, ${Number(stop.longitude).toFixed(5)}</span>
            </div>
            <div class="admin-stop-card-actions">
                <button type="button" class="route-actions-btn" data-action="locate" style="font-size: 0.74rem; padding: 4px 8px;">Ver en mapa</button>
                <button type="button" class="route-actions-btn" data-action="edit" style="font-size: 0.74rem; padding: 4px 8px;">Editar</button>
                <button type="button" class="route-actions-btn" data-action="delete" style="font-size: 0.74rem; padding: 4px 8px; color: var(--danger);">Eliminar</button>
            </div>
        `;

        const focusStop = () => focusPhysicalStopOnMap(stop.id);
        card.addEventListener('click', focusStop);
        card.querySelector('[data-action="locate"]').addEventListener('click', (e) => {
            e.stopPropagation();
            focusStop();
        });
        card.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
            e.stopPropagation();
            openEditStopModal(stop.id);
        });
        card.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
            e.stopPropagation();
            confirmDeleteStop(stop.id);
        });

        listContainer.appendChild(card);
    });
}

let activeAdminStopPopup = null;

function openAdminStopPopup(marker, stop) {
    if (!mapInstance || !stop) return;
    const latlng = marker ? marker.getLatLng() : L.latLng(stop.latitude, stop.longitude);
    // Usar L.popup independiente evita que bindPopup registre doble toggle al volver a hacer clic
    if (activeAdminStopPopup) {
        mapInstance.closePopup(activeAdminStopPopup);
    }
    activeAdminStopPopup = L.popup({ offset: [0, -8] })
        .setLatLng(latlng)
        .setContent(buildAdminStopPopup(stop))
        .openOn(mapInstance);
}

function focusPhysicalStopOnMap(stopId) {
    const stop = physicalStopsData.find(s => s.id === Number(stopId));
    if (!stop || !mapInstance) return;
    const marker = physicalStopMarkersMap.get(Number(stopId));

    const openTarget = () => {
        if (marker && typeof allStopsClusterGroup !== 'undefined' && allStopsClusterGroup && typeof allStopsClusterGroup.zoomToShowLayer === 'function') {
            allStopsClusterGroup.zoomToShowLayer(marker, () => openAdminStopPopup(marker, stop));
        } else {
            openAdminStopPopup(marker, stop);
        }
    };

    const targetLatLng = L.latLng(stop.latitude, stop.longitude);
    const targetZoom = Math.max(mapInstance.getZoom(), 16);
    const needsMove = mapInstance.getZoom() < 16 || !mapInstance.getBounds().pad(-0.15).contains(targetLatLng);

    if (needsMove) {
        mapInstance.once('moveend', openTarget);
        mapInstance.setView(targetLatLng, targetZoom, { animate: true });
    } else {
        openTarget();
    }
}

function setPhysicalStopMarkerState(stopId, isSelected) {
    const markerEl = document.getElementById(`physical-stop-${stopId}`);
    if (!markerEl) return;
    if (isSelected) {
        markerEl.style.backgroundColor = '#10b981';
        markerEl.style.borderColor = '#ecfdf5';
        markerEl.style.transform = 'scale(1.28)';
    } else {
        const stop = physicalStopsData.find(s => s.id === Number(stopId));
        const config = (typeof getStopIconConfig === 'function' && stop)
            ? getStopIconConfig(stop.name, stop.type)
            : { bgColor: '#475569' };
        markerEl.style.backgroundColor = config.bgColor;
        markerEl.style.borderColor = 'white';
        markerEl.style.transform = 'scale(1)';
    }
}

function syncStudioSelectedStopVisuals() {
    if (!drawingMode) return;
    physicalStopsData.forEach(s => {
        setPhysicalStopMarkerState(s.id, selectedStopIds.includes(s.id));
    });
}

function buildAdminStopPopup(stop) {
    const config = (typeof getStopIconConfig === 'function')
        ? getStopIconConfig(stop.name, stop.type)
        : { iconUrl: 'assets/icons/pin_parada.svg', bgColor: '#475569', category: 'Punto de Interés' };
    const routeCount = Number(stop.routeCount || 0);
    const routesInfo = routeCount > 0 && Array.isArray(stop.routeNames)
        ? `En ${routeCount} ruta${routeCount > 1 ? 's' : ''}: ${stop.routeNames.slice(0, 3).join(', ')}${stop.routeNames.length > 3 ? '...' : ''}`
        : 'Sin rutas vinculadas';

    const wrap = document.createElement('div');
    wrap.style.cssText = "font-family: 'Inter', sans-serif; min-width: 195px;";
    wrap.innerHTML = `
        <span style="font-size: 0.68rem; background: ${config.bgColor}15; color: ${config.bgColor}; padding: 2px 6px; border-radius: 4px; font-weight: 700; text-transform: uppercase; display: inline-block; margin-bottom: 4px;">${escapeAdminHtml(config.category || 'Punto de Interés')}</span>
        <h4 style="margin:0 0 4px 0; color:#1f2937; font-size: 0.9rem;">${escapeAdminHtml(stop.name)}</h4>
        <p style="margin: 0 0 4px 0; color: #475569; font-size: 0.78rem;">${escapeAdminHtml(stop.address || 'Mazatlán, Sinaloa')}</p>
        <p style="margin: 0 0 8px 0; color: ${routeCount === 0 ? '#b45309' : '#0f766e'}; font-size: 0.72rem; font-weight: 600;">${escapeAdminHtml(routesInfo)}</p>
        <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-secondary" data-stop-action="edit" style="flex: 1; padding: 5px 8px; font-size: 0.75rem;">Editar</button>
            <button type="button" class="btn btn-danger" data-stop-action="delete" style="flex: 1; padding: 5px 8px; font-size: 0.75rem;">Eliminar</button>
        </div>
    `;
    wrap.querySelector('[data-stop-action="edit"]').addEventListener('click', () => {
        mapInstance.closePopup();
        openEditStopModal(stop.id);
    });
    wrap.querySelector('[data-stop-action="delete"]').addEventListener('click', () => {
        confirmDeleteStop(stop.id);
    });
    return wrap;
}

// Obtiene todas las paradas con su conteo de rutas desde admin API y las dibuja en el mapa (con clustering)
async function refreshPhysicalStops() {
    try {
        physicalStopsData = await Api.getAdminStops();
        physicalStopMarkersMap.clear();

        const targetLayer = (typeof getOrResetPhysicalStopsLayer === 'function')
            ? getOrResetPhysicalStopsLayer()
            : mapInstance;
        if (!targetLayer) {
            renderAdminStops();
            updateAdminStats();
            return;
        }

        const markersToAdd = [];

        physicalStopsData.forEach(stop => {
            const config = (typeof getStopIconConfig === 'function')
                ? getStopIconConfig(stop.name, stop.type)
                : { iconUrl: 'assets/icons/pin_parada.svg', bgColor: '#475569' };
            const stopIconHtml = (typeof renderStopCategorySvg === 'function')
                ? renderStopCategorySvg(config.iconKey, 12)
                : `<img src="${config.iconUrl}" alt="" style="width: 12px; height: 12px; filter: brightness(0) invert(1); pointer-events: none;">`;
            const stopIcon = L.divIcon({
                className: 'physical-stop-marker-admin',
                html: `<div style="background-color: ${config.bgColor}; border: 2px solid white; width: 22px; height: 22px; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.28); display: flex; align-items: center; justify-content: center; cursor: pointer;" id="physical-stop-${Number(stop.id)}">
                         ${stopIconHtml}
                       </div>`,
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            });

            const marker = L.marker([stop.latitude, stop.longitude], { icon: stopIcon });

            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                if (drawingMode) {
                    addStopToRouteDrawing(stop);
                } else if (stopCreationMode) {
                    handleMapClickForStop(e.latlng);
                } else {
                    openAdminStopPopup(marker, stop);
                }
            });

            physicalStopMarkersMap.set(Number(stop.id), marker);
            allStopsMarkers.push(marker);
            markersToAdd.push(marker);
        });

        if (typeof allStopsClusterGroup !== 'undefined' && allStopsClusterGroup && targetLayer === allStopsClusterGroup) {
            allStopsClusterGroup.addLayers(markersToAdd);
            if (!allStopsClusterGroup._studioSyncBound) {
                allStopsClusterGroup._studioSyncBound = true;
                allStopsClusterGroup.on('animationend spiderfied', syncStudioSelectedStopVisuals);
            }
        } else {
            markersToAdd.forEach(m => m.addTo(targetLayer));
        }

        renderAdminStops();
        updateAdminStats();
        if (drawingMode) syncStudioSelectedStopVisuals();
    } catch (err) {
        console.error("Error al refrescar paradas físicas", err);
    }
}

// -----------------------------------------------------
// MODO TRAZADO: DIBUJAR COORDENADAS Y AGREGAR PARADAS A LA RUTA
// -----------------------------------------------------

// Renderiza las líneas y flechas del Studio en vivo separando Ida y Regreso con desplazamiento anti-amontonamiento
// Renderiza la línea y flechas del Studio en vivo pasando exactamente por los puntos trazados
function renderStudioRoute() {
    if (tempPolyline) { mapInstance.removeLayer(tempPolyline); tempPolyline = null; }
    if (typeof tempArrows !== 'undefined' && tempArrows) {
        tempArrows.forEach(a => mapInstance.removeLayer(a));
        tempArrows = [];
    }

    if (!drawnCoordinates || drawnCoordinates.length === 0) return;

    const baseColor = typeof studioBaseColor !== 'undefined' && studioBaseColor ? studioBaseColor : '#ff4b2b';
    const latLngs = drawnCoordinates.map(c => [c.latitude, c.longitude]);

    tempPolyline = L.polyline(latLngs, {
        color: baseColor,
        weight: 5,
        opacity: 0.9,
        lineJoin: 'round'
    }).addTo(mapInstance);

    if (drawnCoordinates.length >= 2 && typeof drawRouteArrows === 'function') {
        const arrows = drawRouteArrows(latLngs, baseColor);
        tempArrows.push(...arrows);
    }
}

function updateStudioCounter() {
    const counterEl = document.getElementById('studio-points-counter');
    if (counterEl) {
        counterEl.textContent = `${drawnCoordinates.length} puntos · ${selectedStopIds.length} paradas`;
    }
    
    if (typeof renderStopSequenceManager === 'function') {
        renderStopSequenceManager();
    }
}

// -----------------------------------------------------
// Gestor de Secuencia de Paradas (UI Panel)
// -----------------------------------------------------
function renderStopSequenceManager() {
    const listContainer = document.getElementById('stop-sequence-list');
    const countSpan = document.getElementById('sequence-count');
    if (!listContainer || !countSpan) return;

    countSpan.textContent = selectedStopIds.length.toString();

    if (selectedStopIds.length === 0) {
        listContainer.innerHTML = `<div style="text-align:center; color:var(--text-muted); font-size:0.75rem; padding: 12px 0; font-style: italic;">No hay paradas vinculadas.</div>`;
        return;
    }

    listContainer.innerHTML = '';
    selectedStopIds.forEach((stopId, index) => {
        const stop = physicalStopsData.find(s => s.id === stopId);
        if (!stop) return;

        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.padding = '6px 8px';
        item.style.background = 'white';
        item.style.border = '1px solid #e2e8f0';
        item.style.borderRadius = '6px';
        item.style.fontSize = '0.75rem';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = `${index + 1}. ${stop.name}`;
        nameSpan.style.whiteSpace = 'nowrap';
        nameSpan.style.overflow = 'hidden';
        nameSpan.style.textOverflow = 'ellipsis';
        nameSpan.style.flex = '1';
        nameSpan.style.marginRight = '8px';
        nameSpan.style.fontWeight = '500';
        nameSpan.style.color = 'var(--text-dark)';

        const btnsDiv = document.createElement('div');
        btnsDiv.style.display = 'flex';
        btnsDiv.style.gap = '4px';

        const upBtn = document.createElement('button');
        upBtn.innerHTML = '▲';
        upBtn.style.padding = '2px 6px';
        upBtn.style.border = '1px solid #cbd5e1';
        upBtn.style.background = '#f1f5f9';
        upBtn.style.borderRadius = '4px';
        upBtn.style.cursor = index === 0 ? 'not-allowed' : 'pointer';
        upBtn.style.opacity = index === 0 ? '0.5' : '1';
        upBtn.title = "Mover arriba";
        if (index > 0) {
            upBtn.onclick = () => moveStopInSequence(index, -1);
        }

        const downBtn = document.createElement('button');
        downBtn.innerHTML = '▼';
        downBtn.style.padding = '2px 6px';
        downBtn.style.border = '1px solid #cbd5e1';
        downBtn.style.background = '#f1f5f9';
        downBtn.style.borderRadius = '4px';
        downBtn.style.cursor = index === selectedStopIds.length - 1 ? 'not-allowed' : 'pointer';
        downBtn.style.opacity = index === selectedStopIds.length - 1 ? '0.5' : '1';
        downBtn.title = "Mover abajo";
        if (index < selectedStopIds.length - 1) {
            downBtn.onclick = () => moveStopInSequence(index, 1);
        }
        
        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '❌';
        removeBtn.style.padding = '2px 4px';
        removeBtn.style.border = 'none';
        removeBtn.style.background = 'transparent';
        removeBtn.style.cursor = 'pointer';
        removeBtn.title = "Desvincular parada";
        removeBtn.onclick = () => {
            selectedStopIds.splice(index, 1);
            updateStudioCounter();
            setPhysicalStopMarkerState(stop.id, false);
        };

        btnsDiv.appendChild(upBtn);
        btnsDiv.appendChild(downBtn);
        btnsDiv.appendChild(removeBtn);

        item.appendChild(nameSpan);
        item.appendChild(btnsDiv);
        listContainer.appendChild(item);
    });
}

function moveStopInSequence(index, direction) {
    if (index + direction < 0 || index + direction >= selectedStopIds.length) return;
    
    // Intercambiar elementos en el arreglo principal
    const temp = selectedStopIds[index];
    selectedStopIds[index] = selectedStopIds[index + direction];
    selectedStopIds[index + direction] = temp;
    
    // Forzar actualización visual (sólo repinta la lista)
    renderStopSequenceManager();
}

async function startDirectStudioMode() {
    if (drawingMode) {
        if (!(await confirmDiscardStudioChanges('iniciar un nuevo trazado desde cero'))) {
            return;
        }
    }
    clearMapDrawings();
    
    try {
        if (!history.state || !history.state.studio) {
            history.pushState({ studio: true }, "Studio de Trazado", window.location.href);
        }
    } catch (e) {}

    selectedRouteId = null; // null indica que estamos creando una ruta nueva desde cero en el Studio
    drawingMode = true;
    importedRouteDraftMeta = null;
    setStopPlacementMode({ active: false });
    drawnCoordinates = [];
    selectedStopIds = [];
    studioBaseColor = '#ff4b2b';
    captureStudioBaseline();
    
    document.getElementById('admin-tool-indicator').classList.add('visible');
    const controlsHud = document.getElementById('studio-controls-hud');
    if (controlsHud) {
        controlsHud.classList.add('visible');
        minimizeStudioHudOnCompactScreen();
    }
    document.getElementById('admin-draw-actions').style.display = 'flex';
    document.getElementById('main-list-section').style.display = 'none';

    const btnSave = document.getElementById('btn-save-draw');
    if (btnSave) btnSave.textContent = 'Guardar ruta y trazado';

    renderStudioRoute();
    updateStudioCounter();
    showToast('Modo trazado activo: haz clic en las calles para dibujar o importa KML/JSON/SQL/GPX.');
}

// Inicia el modo de edición de trazado de ruta en el mapa
async function startTrazadoMode(routeId, color) {
    if (drawingMode && selectedRouteId !== routeId) {
        if (!(await confirmDiscardStudioChanges('cambiar a otra ruta'))) {
            return;
        }
    }
    clearMapDrawings();
    
    try {
        if (!history.state || !history.state.studio) {
            history.pushState({ studio: true }, "Studio de Trazado", window.location.href);
        }
    } catch (e) {}

    const route = typeof adminRoutes !== 'undefined' ? adminRoutes.find(r => r.id === routeId) : null;

    selectedRouteId = routeId;
    drawingMode = true;
    setStopPlacementMode({ active: false });
    studioBaseColor = color || (route ? route.color : '#6366f1');

    drawnCoordinates = [];
    tempMarkers = [];
    selectedStopIds = [];
    captureStudioBaseline();
    
    // UI
    document.getElementById('admin-tool-indicator').classList.add('visible');
    const controlsHud = document.getElementById('studio-controls-hud');
    if (controlsHud) {
        controlsHud.classList.add('visible');
        minimizeStudioHudOnCompactScreen();
    }
    document.getElementById('admin-draw-actions').style.display = 'flex';
    document.getElementById('main-list-section').style.display = 'none';

    const btnSave = document.getElementById('btn-save-draw');
    if (btnSave) btnSave.textContent = 'Actualizar trazado en BD';

    showToast('Cargando el trazado existente de la ruta desde la BD...');

    try {
        // Cargar coordenadas y paradas reales desde la API de admin (soporta rutas activas y ocultas)
        const [coords, stops] = await Promise.all([
            Api.getAdminRouteCoordinates(routeId),
            Api.getAdminRouteStops(routeId)
        ]);

        if (coords && coords.length > 0) {
            coords.forEach(c => {
                const lat = c.latitude !== undefined ? parseFloat(c.latitude) : parseFloat(c[0]);
                const lng = c.longitude !== undefined ? parseFloat(c.longitude) : parseFloat(c[1]);
                if (!isNaN(lat) && !isNaN(lng)) {
                    drawnCoordinates.push({ latitude: lat, longitude: lng });

                    const latlng = L.latLng(lat, lng);
                    const pointIcon = L.divIcon({
                        className: 'temp-point-marker',
                        html: `<div style="background-color: white; border: 2px solid #6366f1; width: 8px; height: 8px; border-radius: 50%;"></div>`,
                        iconSize: [8, 8],
                        iconAnchor: [4, 4]
                    });
                    const marker = createDraggableMarker(latlng, pointIcon);
                    tempMarkers.push(marker);
                }
            });
        }

        if (stops && stops.length > 0) {
            stops.forEach(s => {
                if (s && s.stop && s.stop.id) {
                    selectedStopIds.push(s.stop.id);
                } else if (s && s.id) {
                    selectedStopIds.push(s.id);
                }
            });
        }

        captureStudioBaseline();
        renderStudioRoute();
        updateStudioCounter();
        syncStudioSelectedStopVisuals();
        
        if (drawnCoordinates.length > 0) {
            const bounds = L.latLngBounds(drawnCoordinates.map(c => [c.latitude, c.longitude]));
            mapInstance.fitBounds(bounds, { padding: [40, 40] });
            showToast(`🗺️ Studio Activo: Cargados ${drawnCoordinates.length} puntos de "${route ? route.name : 'la ruta'}". Puedes modificar o añadir puntos.`, 'success');
        } else {
            showToast('Modo trazado activo. Esta ruta aún no tiene puntos en la BD. Haz clics para trazar.');
        }
    } catch (err) {
        showToast('Error al cargar coordenadas de la ruta: ' + err.message, 'error');
    }
}

// Agrega una coordenada al trazado cuando se hace clic en el mapa

function redrawAllStudioMarkers() {
    tempMarkers.forEach(m => mapInstance.removeLayer(m));
    tempMarkers = [];
    
    const pointIcon = L.divIcon({
        className: 'custom-point-marker',
        html: `<div style="background-color: white; border: 2px solid ${typeof studioBaseColor !== 'undefined' ? studioBaseColor : '#ff4b2b'}; width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,0.4);"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
    });

    drawnCoordinates.forEach(coord => {
        const marker = createDraggableMarker(L.latLng(coord.latitude, coord.longitude), pointIcon);
        tempMarkers.push(marker);
    });
    renderStudioRoute();
    updateStudioCounter();
}

function createDraggableMarker(latlng, icon) {
    const marker = L.marker(latlng, { icon: icon, draggable: true }).addTo(mapInstance);
    

    marker.on('dragstart', function(e) {
        saveToHistory();
    });
    
    marker.on('drag', function(e) {
        const idx = tempMarkers.indexOf(marker);
        if (idx !== -1) {
            drawnCoordinates[idx].latitude = e.latlng.lat;
            drawnCoordinates[idx].longitude = e.latlng.lng;
            renderStudioRoute();
        }
    });
    
    // Clic derecho en el marcador para ELIMINARLO
    marker.on('contextmenu', function(e) {
        L.DomEvent.stopPropagation(e);
        saveToHistory();
        const idx = tempMarkers.indexOf(marker);
        if (idx !== -1) {
            drawnCoordinates.splice(idx, 1);
            mapInstance.removeLayer(marker);
            tempMarkers.splice(idx, 1);
            renderStudioRoute();
            updateStudioCounter();
        }
    });
    
    return marker;
}

function handleMapClickForDrawing(latlng) {
    if (!drawingMode) return;
    saveToHistory();

    const coord = { latitude: latlng.lat, longitude: latlng.lng };
    drawnCoordinates.push(coord);

    // Actualizar polilíneas de Ida y Regreso con desplazamiento lateral
    renderStudioRoute();

    // Crear un pequeño marcador temporal para el punto de control
    const pointIcon = L.divIcon({
        className: 'temp-point-marker',
        html: `<div style="background-color: white; border: 2px solid #6366f1; width: 8px; height: 8px; border-radius: 50%;"></div>`,
        iconSize: [8, 8],
        iconAnchor: [4, 4]
    });

    const marker = createDraggableMarker(latlng, pointIcon);
    tempMarkers.push(marker);
    updateStudioCounter();
}

// Añade una parada a la ruta en el orden del trazado
function addStopToRouteDrawing(stop) {
    if (selectedStopIds.includes(stop.id)) {
        showToast('Esta parada ya está asociada a la ruta', 'error');
        return;
    }
    
    selectedStopIds.push(stop.id);
    setPhysicalStopMarkerState(stop.id, true);

    updateStudioCounter();
    showToast(`Parada "${stop.name}" añadida como parada #${selectedStopIds.length} de la ruta.`);
}

// Guarda la geometría dibujada o pasa al paso de datos si es creación
async function saveRouteGeometry() {
    if (drawnCoordinates.length < 2) {
        showToast('Dibuja al menos 2 puntos en el mapa o importa desde JSON/SQL/GPX antes de continuar', 'error');
        return;
    }

    // Si selectedRouteId es null, significa que estamos en el Studio directo creando una NUEVA ruta
    if (!selectedRouteId) {
        openCreateRouteModalFromStudio();
        return;
    }

    try {
        const savedRouteId = selectedRouteId;
        await Api.updateRouteGeometry(selectedRouteId, drawnCoordinates, selectedStopIds);
        showToast('Trazado y paradas guardadas con éxito en la Base de Datos');
        exitDrawingMode();
        await Promise.all([refreshAdminRoutes(), refreshPhysicalStops()]);
        if (savedRouteId) {
            const card = document.querySelector(`.route-card[data-id="${savedRouteId}"]`);
            selectRouteAdmin(savedRouteId, card);
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Cancela o sale del modo trazado limpiando estados temporales
function exitDrawingMode() {
    drawingMode = false;
    historyStack = [];
    selectedRouteId = null;
    importedRouteDraftMeta = null;
    initialStudioCoordsSnapshot = '[]';
    initialStudioStopsSnapshot = '[]';
    
    // Ocultar banner y guía flotante de controles
    document.getElementById('admin-tool-indicator').classList.remove('visible');
    const controlsHud = document.getElementById('studio-controls-hud');
    if (controlsHud) controlsHud.classList.remove('visible');
    document.getElementById('admin-draw-actions').style.display = 'none';
    document.getElementById('main-list-section').style.display = 'flex';

    // Limpiar temporales
    if (tempPolyline) {
        mapInstance.removeLayer(tempPolyline);
        tempPolyline = null;
    }
    if (typeof tempPolylineRegreso !== 'undefined' && tempPolylineRegreso) {
        mapInstance.removeLayer(tempPolylineRegreso);
        tempPolylineRegreso = null;
    }
    tempMarkers.forEach(m => mapInstance.removeLayer(m));
    tempMarkers = [];
    if (typeof tempArrows !== 'undefined' && tempArrows) {
        tempArrows.forEach(a => mapInstance.removeLayer(a));
        tempArrows = [];
    }
    drawnCoordinates = [];
    selectedStopIds = [];

    // Refrescar paradas para quitar marcas temporales
    refreshPhysicalStops();
    updateStudioCounter();
}

// Borra el último punto dibujado en el trazado
function undoLastPoint() {
    if (historyStack.length === 0) {
        showToast('No hay más acciones para deshacer', 'info');
        return;
    }
    drawnCoordinates = historyStack.pop();
    redrawAllStudioMarkers();
}

function buildMirrorReturnCoords(sourceCoords, offsetMeters = 12) {
    if (!Array.isArray(sourceCoords) || sourceCoords.length < 2) return [];
    const mirrored = [];
    for (let i = sourceCoords.length - 2; i >= 0; i--) {
        const curr = sourceCoords[i];
        const prev = sourceCoords[i + 1];
        const next = sourceCoords[Math.max(i - 1, 0)];
        const lat = Number(curr.latitude);
        const lng = Number(curr.longitude);
        const cosLat = Math.cos((lat * Math.PI) / 180) || 1;
        const dx = (Number(next.longitude) - Number(prev.longitude)) * 111320 * cosLat;
        const dy = (Number(next.latitude) - Number(prev.latitude)) * 111320;
        const len = Math.hypot(dx, dy);

        if (len > 0.01 && offsetMeters > 0) {
            // Desplazamiento lateral a la derecha del sentido de regreso para poder arrastrar/borrar vértices sin empalmarse
            const rx = dy / len;
            const ry = -dx / len;
            mirrored.push({
                latitude: lat + (ry * offsetMeters) / 111320,
                longitude: lng + (rx * offsetMeters) / (111320 * cosLat)
            });
        } else {
            mirrored.push({ latitude: lat, longitude: lng });
        }
    }
    return mirrored;
}

function mirrorStudioReturn() {
    if (drawnCoordinates.length < 2) {
        showToast('Traza al menos 2 puntos de la ida antes de generar el regreso espejo.', 'error');
        return;
    }
    if (drawnCoordinates.length * 2 - 1 > 10000) {
        showToast('El trazado resultante superaría el máximo permitido de puntos.', 'error');
        return;
    }

    saveToHistory();
    const returnPoints = buildMirrorReturnCoords(drawnCoordinates, 12);
    drawnCoordinates = drawnCoordinates.concat(returnPoints);
    redrawAllStudioMarkers();
    showToast(`Regreso espejo agregado (${returnPoints.length} puntos). Edita tramos distintos o presiona Ctrl + Z para deshacer.`);
}

function clearStudioSelectedStops() {
    if (selectedStopIds.length === 0) {
        showToast('No hay paradas vinculadas para quitar.', 'info');
        return;
    }
    const prevIds = [...selectedStopIds];
    selectedStopIds = [];
    prevIds.forEach(id => setPhysicalStopMarkerState(id, false));
    updateStudioCounter();
    showToast('Se desvincularon todas las paradas de la ruta (la línea se conserva).');
}

// -----------------------------------------------------
// HERRAMIENTAS DE IMPORTACIÓN Y EXPORTACIÓN JSON/SQL (IDEA DE CLAUDE)
// -----------------------------------------------------

function openExportModal() {
    if (drawnCoordinates.length === 0) {
        showToast('No hay puntos trazados para exportar. Dibuja o importa puntos primero en el mapa.', 'error');
        return;
    }
    const jsonString = JSON.stringify(drawnCoordinates, null, 2);
    document.getElementById('export-json-text').value = jsonString;

    const routeIdForSql = selectedRouteId || 1001;
    let sqlString = `-- Sentencias SQL generadas para insertar coordenadas en MySQL/H2 (Ruta ID: ${routeIdForSql})\n`;
    sqlString += `INSERT INTO route_coordinates (route_id, latitude, longitude, sequence_order) VALUES\n`;
    const values = drawnCoordinates.map((c, i) => `(${routeIdForSql}, ${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)}, ${i + 1})`);
    sqlString += values.join(',\n') + ';';
    
    document.getElementById('export-sql-text').value = sqlString;
    document.getElementById('export-modal').style.display = 'flex';
}

function openImportModal() {
    document.getElementById('import-textarea').value = '';
    const fileInput = document.getElementById('import-file-input');
    if (fileInput) fileInput.value = '';
    detectedKmlTracks = [];
    const kmlWrap = document.getElementById('import-kml-track-wrap');
    if (kmlWrap) kmlWrap.style.display = 'none';
    document.getElementById('import-modal').style.display = 'flex';
}

function getKmlTags(root, localName) {
    if (!root || !root.getElementsByTagName) return [];
    const target = localName.toLowerCase();
    return Array.from(root.getElementsByTagName('*')).filter(el => {
        const name = el.localName || String(el.tagName || '').replace(/^.*:/, '');
        return name.toLowerCase() === target;
    });
}

function kmlColorToHex(rawColor) {
    const clean = String(rawColor || '').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{8}$/.test(clean)) {
        const b = clean.slice(2, 4);
        const g = clean.slice(4, 6);
        const r = clean.slice(6, 8);
        return `#${r}${g}${b}`.toLowerCase();
    }
    if (/^[0-9a-fA-F]{6}$/.test(clean)) {
        return `#${clean}`.toLowerCase();
    }
    return null;
}

function prettifyKmlRouteName(rawName) {
    const cleaned = String(rawName || '').replace(/\.kml$/i, '').replace(/[_]+/g, ' ').trim();
    if (!cleaned) return '';
    if (cleaned === cleaned.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(cleaned)) {
        return cleaned.toLowerCase().replace(/\b\p{L}/gu, ch => ch.toUpperCase());
    }
    return cleaned;
}

function parseKmlCoordString(rawCoords, out) {
    const tokens = String(rawCoords || '').trim().split(/\s+/);
    for (const token of tokens) {
        if (!token) continue;
        const parts = token.split(',');
        if (parts.length < 2) continue;
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

        const prev = out.length > 0 ? out[out.length - 1] : null;
        if (prev && Math.abs(prev.latitude - lat) < 1e-6 && Math.abs(prev.longitude - lng) < 1e-6) {
            continue;
        }
        out.push({ latitude: lat, longitude: lng });
    }
}

function extractKmlTracks(xmlText) {
    const text = String(xmlText || '').trim();
    if (!text.startsWith('<') || !/<kml\b/i.test(text)) return [];
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) return [];

    // Construir tabla de colores Style / StyleMap (#id -> #RRGGBB)
    const styleColors = new Map();
    const styleMaps = new Map();
    getKmlTags(doc, 'Style').forEach(st => {
        const id = st.getAttribute('id');
        if (!id) return;
        const lineStyle = getKmlTags(st, 'LineStyle')[0];
        const colorEl = lineStyle ? getKmlTags(lineStyle, 'color')[0] : null;
        const hex = kmlColorToHex(colorEl ? colorEl.textContent : '');
        if (hex) styleColors.set(`#${id}`, hex);
    });
    getKmlTags(doc, 'StyleMap').forEach(sm => {
        const id = sm.getAttribute('id');
        if (!id) return;
        const pairs = getKmlTags(sm, 'Pair');
        const normalPair = pairs.find(p => {
            const k = getKmlTags(p, 'key')[0];
            return k && k.textContent.trim().toLowerCase() === 'normal';
        }) || pairs[0];
        const urlEl = normalPair ? getKmlTags(normalPair, 'styleUrl')[0] : null;
        if (urlEl && urlEl.textContent) {
            styleMaps.set(`#${id}`, urlEl.textContent.trim());
        }
    });

    const resolveTrackColor = (node) => {
        const inlineColor = getKmlTags(node, 'LineStyle')[0];
        if (inlineColor) {
            const cEl = getKmlTags(inlineColor, 'color')[0];
            const hex = kmlColorToHex(cEl ? cEl.textContent : '');
            if (hex) return hex;
        }
        const styleUrlEl = getKmlTags(node, 'styleUrl')[0];
        if (styleUrlEl && styleUrlEl.textContent) {
            let ref = styleUrlEl.textContent.trim();
            if (styleMaps.has(ref)) ref = styleMaps.get(ref);
            if (styleColors.has(ref)) return styleColors.get(ref);
        }
        return null;
    };

    const docNameEl = getKmlTags(doc, 'Document')[0];
    const docTitleEl = docNameEl ? Array.from(docNameEl.children || []).find(ch => (ch.localName || ch.tagName).toLowerCase() === 'name') : null;
    const defaultName = prettifyKmlRouteName(docTitleEl ? docTitleEl.textContent : '') || 'Ruta KML';

    const tracks = [];
    getKmlTags(doc, 'Placemark').forEach((pm, idx) => {
        const lines = getKmlTags(pm, 'LineString');
        if (lines.length === 0) return;
        const coords = [];
        lines.forEach(ls => {
            getKmlTags(ls, 'coordinates').forEach(cEl => parseKmlCoordString(cEl.textContent, coords));
        });
        if (coords.length < 2) return;

        const nameEl = Array.from(pm.children || []).find(ch => (ch.localName || ch.tagName).toLowerCase() === 'name');
        const trackName = prettifyKmlRouteName(nameEl ? nameEl.textContent : '') || (idx === 0 ? defaultName : `${defaultName} #${idx + 1}`);
        tracks.push({
            name: trackName,
            docName: defaultName,
            color: resolveTrackColor(pm),
            coords
        });
    });

    if (tracks.length === 0) {
        const looseLines = getKmlTags(doc, 'LineString');
        const coords = [];
        looseLines.forEach(ls => {
            getKmlTags(ls, 'coordinates').forEach(cEl => parseKmlCoordString(cEl.textContent, coords));
        });
        if (coords.length >= 2) {
            tracks.push({ name: defaultName, docName: defaultName, color: null, coords });
        }
    }
    return tracks;
}

function mergeKmlTracksSequentially(tracks) {
    if (!Array.isArray(tracks) || tracks.length === 0) return [];
    const merged = [];
    const pushPoint = (pt) => {
        const prev = merged.length > 0 ? merged[merged.length - 1] : null;
        if (prev && Math.abs(prev.latitude - pt.latitude) < 1e-6 && Math.abs(prev.longitude - pt.longitude) < 1e-6) {
            return;
        }
        merged.push({ latitude: pt.latitude, longitude: pt.longitude });
    };
    const sqDist = (a, b) => (a.latitude - b.latitude) ** 2 + (a.longitude - b.longitude) ** 2;

    tracks.forEach((tr, idx) => {
        if (!tr || !Array.isArray(tr.coords) || tr.coords.length === 0) return;
        let pts = tr.coords;
        if (idx > 0 && merged.length > 0 && pts.length > 1) {
            const last = merged[merged.length - 1];
            if (sqDist(last, pts[pts.length - 1]) < sqDist(last, pts[0])) {
                pts = [...pts].reverse();
            }
        }
        pts.forEach(pushPoint);
    });
    return merged;
}

function refreshImportKmlTrackSelector(text) {
    const wrap = document.getElementById('import-kml-track-wrap');
    const select = document.getElementById('import-kml-track-select');
    if (!wrap || !select) return;

    detectedKmlTracks = extractKmlTracks(text);
    select.innerHTML = '';
    if (detectedKmlTracks.length <= 1) {
        wrap.style.display = 'none';
        return;
    }

    const totalPts = detectedKmlTracks.reduce((sum, tr) => sum + tr.coords.length, 0);
    const mergeOpt = document.createElement('option');
    mergeOpt.value = 'all';
    mergeOpt.textContent = `Unir todos los trazos (Ida + Regreso · ${totalPts} pts)`;
    select.appendChild(mergeOpt);

    detectedKmlTracks.forEach((tr, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = `${idx + 1}. ${tr.name} (${tr.coords.length} pts)`;
        select.appendChild(opt);
    });
    select.value = 'all';
    wrap.style.display = 'flex';
}

function extractGeoJsonLineCoords(node, out) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FeatureCollection' && Array.isArray(node.features)) {
        node.features.forEach(f => extractGeoJsonLineCoords(f, out));
        return;
    }
    if (node.type === 'Feature' && node.geometry) {
        extractGeoJsonLineCoords(node.geometry, out);
        return;
    }
    if (node.type === 'LineString' && Array.isArray(node.coordinates)) {
        node.coordinates.forEach(pair => {
            if (Array.isArray(pair) && pair.length >= 2) {
                const lng = parseFloat(pair[0]);
                const lat = parseFloat(pair[1]);
                if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                    out.push({ latitude: lat, longitude: lng });
                }
            }
        });
        return;
    }
    if (node.type === 'MultiLineString' && Array.isArray(node.coordinates)) {
        node.coordinates.forEach(line => {
            if (Array.isArray(line)) {
                line.forEach(pair => {
                    if (Array.isArray(pair) && pair.length >= 2) {
                        const lng = parseFloat(pair[0]);
                        const lat = parseFloat(pair[1]);
                        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                            out.push({ latitude: lat, longitude: lng });
                        }
                    }
                });
            }
        });
    }
}

function processImportedText() {
    const text = document.getElementById('import-textarea').value.trim();
    if (!text) {
        showToast('Por favor carga un archivo o pega coordenadas en KML, JSON, GeoJSON, GPX o SQL.', 'error');
        return;
    }

    let parsedCoords = [];
    let pendingMeta = null;

    // 1. Intentar XML KML (Google Earth / Google My Maps: <LineString><coordinates>lng,lat,alt</coordinates>)
    if (text.startsWith('<') && /<kml\b/i.test(text)) {
        try {
            const kmlTracks = detectedKmlTracks.length > 0 ? detectedKmlTracks : extractKmlTracks(text);
            if (kmlTracks.length > 0) {
                const selectEl = document.getElementById('import-kml-track-select');
                const selectedVal = selectEl ? selectEl.value : '0';
                if (selectedVal === 'all' && kmlTracks.length > 1) {
                    parsedCoords = mergeKmlTracksSequentially(kmlTracks);
                    const firstColorTrack = kmlTracks.find(t => t.color);
                    pendingMeta = {
                        name: kmlTracks[0].docName || kmlTracks[0].name || '',
                        color: firstColorTrack ? firstColorTrack.color : null
                    };
                } else {
                    const idx = parseInt(selectedVal, 10) || 0;
                    const chosen = kmlTracks[idx] || kmlTracks[0];
                    parsedCoords = chosen.coords.slice();
                    pendingMeta = {
                        name: chosen.name || '',
                        color: chosen.color || null
                    };
                }
            }
        } catch (e) {}
    }

    // 2. Intentar XML GPX (<trkpt> / <rtept>)
    if (parsedCoords.length === 0 && text.startsWith('<') && text.toLowerCase().includes('<gpx')) {
        try {
            const doc = new DOMParser().parseFromString(text, 'application/xml');
            if (!doc.querySelector('parsererror')) {
                const pts = doc.querySelectorAll('trkpt, rtept, wpt');
                pts.forEach(pt => {
                    const lat = parseFloat(pt.getAttribute('lat'));
                    const lng = parseFloat(pt.getAttribute('lon'));
                    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                        parsedCoords.push({ latitude: lat, longitude: lng });
                    }
                });
            }
        } catch (e) {}
    }

    // 3. Intentar JSON / GeoJSON
    if (parsedCoords.length === 0) {
        try {
            if (text.startsWith('[') || text.startsWith('{')) {
                const data = JSON.parse(text);
                if (data && !Array.isArray(data) && ['FeatureCollection', 'Feature', 'LineString', 'MultiLineString'].includes(data.type)) {
                    extractGeoJsonLineCoords(data, parsedCoords);
                } else {
                    const arr = Array.isArray(data) ? data : (data.coordinates || data.points || []);
                    arr.forEach(item => {
                        const lat = parseFloat(item.lat ?? item.latitude ?? item.latitud ?? item[0]);
                        const lng = parseFloat(item.lng ?? item.lon ?? item.longitude ?? item.longitud ?? item[1]);
                        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                            parsedCoords.push({ latitude: lat, longitude: lng });
                        }
                    });
                }
            }
        } catch (e) {
            // Ignorar si no es JSON, intentaremos con Regex SQL/texto
        }
    }

    if (parsedCoords.length === 0) {
        const regex = /(-?\d{1,3}\.\d{4,16})\s*(?:,|\s+)\s*(-?\d{1,3}\.\d{4,16})/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const val1 = parseFloat(match[1]);
            const val2 = parseFloat(match[2]);
            if (val1 >= -90 && val1 <= 90 && val2 >= -180 && val2 <= 180) {
                if (Math.abs(val1 - 23) < 5 && Math.abs(val2 - (-106)) < 5) {
                    parsedCoords.push({ latitude: val1, longitude: val2 });
                } else if (Math.abs(val2 - 23) < 5 && Math.abs(val1 - (-106)) < 5 && val2 >= -90 && val2 <= 90 && val1 >= -180 && val1 <= 180) {
                    parsedCoords.push({ latitude: val2, longitude: val1 });
                } else {
                    parsedCoords.push({ latitude: val1, longitude: val2 });
                }
            } else if (val2 >= -90 && val2 <= 90 && val1 >= -180 && val1 <= 180) {
                parsedCoords.push({ latitude: val2, longitude: val1 });
            }
        }
    }

    if (parsedCoords.length === 0) {
        showToast('No se detectaron coordenadas válidas. Verifica el formato KML, JSON, GeoJSON, GPX o SQL.', 'error');
        return;
    }

    saveToHistory();
    clearStudioDrawings(true);
    importedRouteDraftMeta = pendingMeta;
    if (!selectedRouteId && pendingMeta && pendingMeta.color) {
        studioBaseColor = pendingMeta.color;
    }
    
    const bounds = L.latLngBounds();
    parsedCoords.forEach(coord => {
        drawnCoordinates.push(coord);
        const latlng = L.latLng(coord.latitude, coord.longitude);
        bounds.extend(latlng);

        const pointIcon = L.divIcon({
            className: 'temp-point-marker',
            html: `<div style="background-color: white; border: 2px solid #6366f1; width: 8px; height: 8px; border-radius: 50%;"></div>`,
            iconSize: [8, 8],
            iconAnchor: [4, 4]
        });
        const marker = createDraggableMarker(latlng, pointIcon);
        tempMarkers.push(marker);
    });

    renderStudioRoute();

    if (drawnCoordinates.length > 0) {
        mapInstance.fitBounds(bounds, { padding: [40, 40] });
    }

    updateStudioCounter();
    document.getElementById('import-modal').style.display = 'none';
    showToast(`⚡ ¡Importación exitosa! ${parsedCoords.length} puntos cargados al mapa.`, 'success');
}

async function clearStudioDrawings(force = false) {
    if (drawnCoordinates.length > 0 && (!force || force instanceof Event)) {
        const ok = await showAdminConfirm({
            title: 'Limpiar trazado',
            message: `Se borrarán los ${drawnCoordinates.length} puntos trazados actualmente en el lienzo. Esto no modifica la base de datos hasta que guardes.`,
            confirmText: 'Limpiar lienzo',
            cancelText: 'Cancelar',
            danger: true
        });
        if (!ok) {
            return;
        }
    }
    if (tempPolyline) { mapInstance.removeLayer(tempPolyline); tempPolyline = null; }
    if (typeof tempPolylineRegreso !== 'undefined' && tempPolylineRegreso) { mapInstance.removeLayer(tempPolylineRegreso); tempPolylineRegreso = null; }
    tempMarkers.forEach(m => mapInstance.removeLayer(m));
    tempMarkers = [];
    if (typeof tempArrows !== 'undefined' && tempArrows) {
        tempArrows.forEach(a => mapInstance.removeLayer(a));
        tempArrows = [];
    }
    drawnCoordinates = [];
    selectedStopIds = [];
    refreshPhysicalStops();
    updateStudioCounter();
    showToast('Trazado limpio en el mapa.');
}

// -----------------------------------------------------
// GESTIÓN DE PARADAS FÍSICAS (CREAR / ELIMINAR)
// -----------------------------------------------------

let pendingStopEditDraft = null;

async function startStopCreationMode() {
    if (drawingMode) {
        if (!(await confirmDiscardStudioChanges('crear paradas físicas'))) {
            return;
        }
        exitDrawingMode();
    }

    pendingStopEditDraft = null;
    setStopPlacementMode({
        active: true,
        targetStopId: null,
        message: 'Modo colocar parada: haz clic en cualquier punto del mapa.'
    });
    showToast('Haz clic en el mapa para colocar la nueva parada.');
}

async function startRelocateStopMode() {
    const formId = document.getElementById('stop-form-id').value;
    if (!formId) return;

    pendingStopEditDraft = {
        id: Number(formId),
        name: document.getElementById('stop-name').value.trim(),
        type: document.getElementById('stop-type').value,
        address: document.getElementById('stop-address').value.trim()
    };
    document.getElementById('stop-modal').style.display = 'none';
    setStopPlacementMode({
        active: true,
        targetStopId: pendingStopEditDraft.id,
        message: `Reubicando "${pendingStopEditDraft.name || 'parada'}": haz clic en la nueva posición del mapa.`
    });
    showToast('Haz clic en la nueva ubicación de la parada en el mapa.');
}

function escapeAdminHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function inferStopTypeFromOSM(osmClass, osmType) {
    const cls = (osmClass || '').toLowerCase();
    const t = (osmType || '').toLowerCase();
    if (['hospital', 'clinic', 'doctors', 'pharmacy'].includes(t)) return 'hospital';
    if (['school', 'university', 'college', 'kindergarten'].includes(t)) return 'escuela';
    if (['bank', 'atm'].includes(t)) return 'banco';
    if (['restaurant', 'cafe', 'fast_food', 'ice_cream'].includes(t)) return 'restaurante';
    if (t === 'fuel') return 'gasolinera';
    if (['bus_station', 'ferry_terminal'].includes(t) || cls === 'aeroway') return 'transporte';
    if (['hotel', 'motel', 'hostel', 'resort', 'beach'].includes(t)) return 'hotel';
    if (cls === 'shop' || ['supermarket', 'mall', 'marketplace', 'department_store'].includes(t)) return 'comercio';
    if (cls === 'tourism' || cls === 'leisure' || ['park', 'museum', 'attraction', 'theatre', 'cinema'].includes(t)) return 'turistico';
    if (cls === 'industrial') return 'empresa';
    return 'parada';
}

function formatOSMAddress(item) {
    const addr = item && item.address ? item.address : {};
    const street = [addr.road, addr.house_number].filter(Boolean).join(' ');
    const area = addr.suburb || addr.neighbourhood || addr.quarter || addr.residential || addr.city_district;
    const parts = [street, area].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
    if (item && item.display_name) {
        return item.display_name.split(',').slice(0, 3).map(s => s.trim()).join(', ');
    }
    return '';
}

function openStopModalWithData({ id = '', name = '', latitude, longitude, type = 'parada', address = '' }) {
    const stopModal = document.getElementById('stop-modal');
    const idInput = document.getElementById('stop-form-id');
    const titleEl = document.getElementById('stop-modal-title');
    const submitBtn = document.getElementById('stop-submit-btn');
    const relocateBtn = document.getElementById('btn-relocate-stop');
    const isEdit = Boolean(id);

    if (idInput) idInput.value = isEdit ? String(id) : '';
    if (titleEl) titleEl.textContent = isEdit ? 'Editar parada' : 'Nueva parada';
    if (submitBtn) submitBtn.textContent = isEdit ? 'Actualizar parada' : 'Guardar parada';
    if (relocateBtn) relocateBtn.style.display = isEdit ? 'flex' : 'none';

    document.getElementById('stop-name').value = name;
    document.getElementById('stop-type').value = type || 'parada';
    document.getElementById('stop-address').value = address || '';
    document.getElementById('stop-latitude').value = Number(latitude).toFixed(6);
    document.getElementById('stop-longitude').value = Number(longitude).toFixed(6);

    stopModal.style.display = 'flex';
    document.getElementById('stop-name').focus();
}

function openEditStopModal(stopId) {
    const stop = physicalStopsData.find(s => s.id === Number(stopId));
    if (!stop) {
        showToast('No se encontró la parada seleccionada.', 'error');
        return;
    }
    pendingStopEditDraft = null;
    openStopModalWithData({
        id: stop.id,
        name: stop.name || '',
        latitude: stop.latitude,
        longitude: stop.longitude,
        type: stop.type || 'parada',
        address: stop.address || ''
    });
}

async function fetchReverseOSMForStop(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json&addressdetails=1`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();

        const stopModal = document.getElementById('stop-modal');
        if (!stopModal || stopModal.style.display === 'none') return;

        const addressInput = document.getElementById('stop-address');
        const nameInput = document.getElementById('stop-name');
        const typeSelect = document.getElementById('stop-type');

        const formattedAddr = formatOSMAddress(data);
        if (addressInput && !addressInput.value.trim() && formattedAddr) {
            addressInput.value = formattedAddr;
        }
        if (nameInput && !nameInput.value.trim() && data.name) {
            nameInput.value = data.name;
        }
        if (typeSelect && typeSelect.value === 'parada' && (data.category || data.type)) {
            typeSelect.value = inferStopTypeFromOSM(data.category, data.type);
        }
    } catch (err) {
        console.warn('No se pudo autocompletar dirección con OSM:', err);
    }
}

async function searchAdminOSMPlaces(query) {
    const dropdown = document.getElementById('admin-osm-suggestions');
    if (!dropdown) return;

    const trimmed = (query || '').trim();
    if (trimmed.length < 3) {
        dropdown.style.display = 'none';
        return;
    }

    dropdown.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">Buscando en OpenStreetMap...</div>`;
    dropdown.style.display = 'block';

    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmed + ', Mazatlan, Sinaloa')}&format=json&limit=6&addressdetails=1`;
        const response = await fetch(url);
        const data = await response.json();
        adminOsmSearchResults = Array.isArray(data) ? data : [];

        if (adminOsmSearchResults.length === 0) {
            dropdown.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">Sin resultados en OSM para "${escapeAdminHtml(trimmed)}"</div>`;
            return;
        }

        dropdown.innerHTML = adminOsmSearchResults.map((item, idx) => {
            const firstPart = (item.display_name || '').split(',')[0].trim();
            const title = item.name || (isNaN(firstPart) ? firstPart : ((item.display_name || '').split(',')[1] || firstPart).trim());
            const address = formatOSMAddress(item) || item.display_name || 'Mazatlán, Sinaloa';
            const stopType = inferStopTypeFromOSM(item.class, item.type);
            const config = (typeof getStopIconConfig === 'function')
                ? getStopIconConfig(title, stopType)
                : { iconUrl: 'assets/icons/ui_ubicacion.svg', bgColor: '#059669', category: 'Lugar OSM' };

            const osmIconHtml = (typeof renderStopCategorySvg === 'function')
                ? renderStopCategorySvg(config.iconKey, 15)
                : `<img src="${config.iconUrl}" alt="" style="filter: brightness(0) invert(1); width: 14px; height: 14px;">`;
            return `
                <div class="search-suggestion-item" data-osm-idx="${idx}">
                    <div class="suggestion-icon" style="background: ${config.bgColor};">
                        ${osmIconHtml}
                    </div>
                    <div class="suggestion-content">
                        <div class="suggestion-title">${escapeAdminHtml(title)}</div>
                        <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap;">
                            <span class="suggestion-badge" style="background: ${config.bgColor}15; color: ${config.bgColor};">${escapeAdminHtml(config.category || 'OSM')}</span>
                            <span class="suggestion-subtitle">${escapeAdminHtml(address)}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        dropdown.querySelectorAll('[data-osm-idx]').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.getAttribute('data-osm-idx'), 10);
                if (!isNaN(idx) && adminOsmSearchResults[idx]) {
                    selectAdminOSMPlace(adminOsmSearchResults[idx]);
                }
            });
        });
    } catch (err) {
        console.error('Error buscando en OSM:', err);
        dropdown.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--danger); font-size: 0.82rem;">Error al consultar OpenStreetMap</div>`;
    }
}

function selectAdminOSMPlace(item) {
    const dropdown = document.getElementById('admin-osm-suggestions');
    if (dropdown) dropdown.style.display = 'none';

    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    if (isNaN(lat) || isNaN(lng) || !mapInstance) return;

    const firstPart = (item.display_name || '').split(',')[0].trim();
    const title = item.name || (isNaN(firstPart) ? firstPart : ((item.display_name || '').split(',')[1] || firstPart).trim());
    const address = formatOSMAddress(item);
    const inferredType = inferStopTypeFromOSM(item.class, item.type);

    const searchInput = document.getElementById('admin-osm-search-input');
    if (searchInput) searchInput.value = title;

    if (adminOsmSearchMarker) {
        mapInstance.removeLayer(adminOsmSearchMarker);
    }

    const searchIcon = L.divIcon({
        className: 'admin-osm-pin',
        html: `<div style="background: #2563eb; border: 3px solid #ffffff; width: 28px; height: 28px; border-radius: 50%; box-shadow: 0 4px 12px rgba(37,99,235,0.45); display: flex; align-items: center; justify-content: center;">
                 <img src="assets/icons/ui_ubicacion.svg" alt="" style="width: 14px; height: 14px; filter: brightness(0) invert(1); pointer-events: none;">
               </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });

    adminOsmSearchMarker = L.marker([lat, lng], { icon: searchIcon }).addTo(mapInstance);
    const popupContent = document.createElement('div');
    popupContent.style.cssText = "font-family: 'Inter', sans-serif; min-width: 200px;";
    popupContent.innerHTML = `
        <span style="font-size: 0.68rem; background: rgba(0,92,151,0.1); color: #005C97; padding: 2px 7px; border-radius: 9999px; font-weight: 700; text-transform: uppercase; display: inline-block; margin-bottom: 5px;">OpenStreetMap</span>
        <h4 style="margin: 0 0 4px 0; color: #0f172a; font-size: 0.92rem; font-weight: 700;">${escapeAdminHtml(title)}</h4>
        <p style="margin: 0 0 4px 0; color: #475569; font-size: 0.78rem;">${escapeAdminHtml(address || 'Mazatlán, Sinaloa')}</p>
        <p style="margin: 0 0 10px 0; color: #64748b; font-size: 0.72rem;">${lat.toFixed(6)}, ${lng.toFixed(6)}</p>
        <button type="button" id="btn-save-osm-as-stop" class="btn btn-primary btn-full" style="padding: 7px 10px; font-size: 0.8rem;">
            Guardar como parada
        </button>
    `;

    popupContent.querySelector('#btn-save-osm-as-stop').addEventListener('click', () => {
        mapInstance.closePopup();
        openStopModalWithData({
            name: title,
            latitude: lat,
            longitude: lng,
            type: inferredType,
            address
        });
    });

    adminOsmSearchMarker.bindPopup(popupContent).addTo(mapInstance);
    mapInstance.flyTo([lat, lng], 17, { duration: 1.0 });
    setTimeout(() => {
        if (adminOsmSearchMarker) adminOsmSearchMarker.openPopup();
    }, 500);
}

// Muestra modal para crear parada o reubicar parada existente
function handleMapClickForStop(latlng) {
    if (!stopCreationMode) return;

    const draft = pendingStopEditDraft;
    const isRelocate = Boolean(relocateStopId && draft && draft.id === relocateStopId);
    pendingStopEditDraft = null;
    setStopPlacementMode({ active: false });

    if (isRelocate) {
        openStopModalWithData({
            id: draft.id,
            name: draft.name,
            latitude: latlng.lat,
            longitude: latlng.lng,
            type: draft.type || 'parada',
            address: draft.address || ''
        });
        showToast('Nueva posición aplicada. Pulsa "Actualizar parada" para guardar.');
        return;
    }

    openStopModalWithData({
        id: '',
        name: '',
        latitude: latlng.lat,
        longitude: latlng.lng,
        type: 'parada',
        address: ''
    });
    fetchReverseOSMForStop(latlng.lat, latlng.lng);
}

// Guarda o actualiza la parada física
async function handleStopFormSubmit(e) {
    e.preventDefault();
    const idRaw = document.getElementById('stop-form-id') ? document.getElementById('stop-form-id').value.trim() : '';
    const name = document.getElementById('stop-name').value.trim();
    const type = document.getElementById('stop-type').value;
    const address = document.getElementById('stop-address').value.trim();
    const latitude = parseFloat(document.getElementById('stop-latitude').value);
    const longitude = parseFloat(document.getElementById('stop-longitude').value);

    if (isNaN(latitude) || isNaN(longitude)) {
        showToast('Coordenadas de parada inválidas.', 'error');
        return;
    }

    try {
        if (idRaw) {
            await Api.updateStop(Number(idRaw), { name, latitude, longitude, type, address });
            showToast('Parada física actualizada correctamente.');
        } else {
            await Api.createStop({ name, latitude, longitude, type, address });
            showToast('Parada física registrada correctamente.');
        }

        pendingStopEditDraft = null;
        document.getElementById('stop-modal').style.display = 'none';
        document.getElementById('stop-form').reset();
        if (document.getElementById('stop-form-id')) document.getElementById('stop-form-id').value = '';
        if (adminOsmSearchMarker) {
            mapInstance.removeLayer(adminOsmSearchMarker);
            adminOsmSearchMarker = null;
        }
        await Promise.all([refreshPhysicalStops(), refreshAdminRoutes()]);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function confirmDeleteStop(stopId) {
    const ok = await showAdminConfirm({
        title: 'Eliminar parada física',
        message: '¿Estás seguro de que deseas eliminar esta parada física? Se desvinculará de cualquier ruta que la use.',
        confirmText: 'Eliminar parada',
        cancelText: 'Cancelar',
        danger: true
    });
    if (ok) {
        try {
            await Api.deleteStop(stopId);
            showToast('Parada física eliminada.');
            mapInstance.closePopup();
            await Promise.all([refreshPhysicalStops(), refreshAdminRoutes()]);
        } catch (err) {
            showToast(err.message, 'error');
        }
    }
}

// -----------------------------------------------------
// OPERACIONES CRUD DE RUTAS
// -----------------------------------------------------

function openCreateRouteModal() {
    document.getElementById('route-modal-title').textContent = 'Crear Nueva Ruta';
    document.getElementById('route-form-id').value = '';
    document.getElementById('route-name-input').value = '';
    document.getElementById('route-desc-input').value = '';
    document.getElementById('route-color-input').value = '#ff4b2b';
    if (document.getElementById('route-price-input')) document.getElementById('route-price-input').value = '13.0';
    if (document.getElementById('route-student-price-input')) document.getElementById('route-student-price-input').value = '3.5';
    if (document.getElementById('route-freq-input')) document.getElementById('route-freq-input').value = '10';
    document.getElementById('route-active-input').checked = true;
    
    const btnEditStudio = document.getElementById('btn-edit-route-studio');
    if (btnEditStudio) btnEditStudio.style.display = 'none';

    document.getElementById('route-modal').style.display = 'flex';
}

function openCreateRouteModalFromStudio() {
    document.getElementById('route-modal-title').textContent = 'Finalizar y Crear Nueva Ruta';
    document.getElementById('route-form-id').value = '';
    const prefillName = (importedRouteDraftMeta && importedRouteDraftMeta.name) ? importedRouteDraftMeta.name : '';
    const prefillColor = (importedRouteDraftMeta && importedRouteDraftMeta.color && /^#[0-9a-fA-F]{6}$/.test(importedRouteDraftMeta.color))
        ? importedRouteDraftMeta.color
        : '#ff4b2b';
    document.getElementById('route-name-input').value = prefillName;
    document.getElementById('route-desc-input').value = `Ruta trazada interactivamente desde el Studio con ${drawnCoordinates.length} puntos GPS y ${selectedStopIds.length} paradas.`;
    document.getElementById('route-color-input').value = prefillColor;
    if (document.getElementById('route-price-input')) document.getElementById('route-price-input').value = '13.0';
    if (document.getElementById('route-student-price-input')) document.getElementById('route-student-price-input').value = '3.5';
    if (document.getElementById('route-freq-input')) document.getElementById('route-freq-input').value = '10';
    document.getElementById('route-active-input').checked = true;
    
    const btnEditStudio = document.getElementById('btn-edit-route-studio');
    if (btnEditStudio) btnEditStudio.style.display = 'none';

    document.getElementById('route-modal').style.display = 'flex';
}

function openEditRouteModal(routeId) {
    const route = adminRoutes.find(r => r.id === routeId);
    if (!route) return;

    document.getElementById('route-modal-title').textContent = 'Editar Ruta';
    document.getElementById('route-form-id').value = route.id;
    document.getElementById('route-name-input').value = route.name;
    document.getElementById('route-desc-input').value = route.description || '';
    document.getElementById('route-color-input').value = route.color;
    if (document.getElementById('route-price-input')) document.getElementById('route-price-input').value = route.price || '13.0';
    if (document.getElementById('route-student-price-input')) document.getElementById('route-student-price-input').value = route.studentPrice != null ? route.studentPrice : '3.5';
    if (document.getElementById('route-freq-input')) document.getElementById('route-freq-input').value = route.frequencyMinutes || '10';
    document.getElementById('route-active-input').checked = route.active;

    const btnEditStudio = document.getElementById('btn-edit-route-studio');
    if (btnEditStudio) {
        btnEditStudio.style.display = 'flex';
        btnEditStudio.onclick = () => {
            document.getElementById('route-modal').style.display = 'none';
            startTrazadoMode(route.id, route.color);
        };
    }

    document.getElementById('route-modal').style.display = 'flex';
}

async function handleRouteFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('route-form-id').value;
    const name = document.getElementById('route-name-input').value;
    const description = document.getElementById('route-desc-input').value;
    const color = document.getElementById('route-color-input').value;
    const active = document.getElementById('route-active-input').checked;
    const price = document.getElementById('route-price-input') ? (parseFloat(document.getElementById('route-price-input').value) || 13.0) : 13.0;
    const studentPriceInput = document.getElementById('route-student-price-input');
    const parsedStudentPrice = studentPriceInput ? parseFloat(studentPriceInput.value) : 3.5;
    const studentPrice = !isNaN(parsedStudentPrice) && parsedStudentPrice >= 0 ? parsedStudentPrice : 3.5;
    const frequencyMinutes = document.getElementById('route-freq-input') ? (parseInt(document.getElementById('route-freq-input').value, 10) || 10) : 10;

    const routeData = { name, description, color, active, price, studentPrice, frequencyMinutes };

    try {
        if (id) {
            // Update
            await Api.updateRoute(id, routeData);
            showToast('Ruta actualizada exitosamente.');
        } else {
            // Create
            const newRoute = await Api.createRoute(routeData);
            
            // ¡MAGIA DEL STUDIO! Si estamos trazando e importando, enviamos las coordenadas y paradas a la Base de Datos en un solo paso
            if (drawingMode && drawnCoordinates.length > 0) {
                await Api.updateRouteGeometry(newRoute.id, drawnCoordinates, selectedStopIds);
                showToast(`🎉 ¡Ruta "${newRoute.name}" creada, trazada con ${drawnCoordinates.length} puntos y guardada en la Base de Datos!`, 'success');
                exitDrawingMode();
            } else {
                showToast('Ruta creada exitosamente en la Base de Datos.');
            }
        }
        document.getElementById('route-modal').style.display = 'none';
        document.getElementById('route-form').reset();
        await refreshAdminRoutes();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function confirmDeleteRoute(routeId) {
    if (drawingMode) {
        if (!(await confirmDiscardStudioChanges('eliminar esta ruta'))) {
            return;
        }
        exitDrawingMode();
    }
    const ok = await showAdminConfirm({
        title: 'Eliminar ruta',
        message: '¿Estás seguro de que deseas eliminar esta ruta por completo? Esta acción es irreversible.',
        confirmText: 'Eliminar ruta',
        cancelText: 'Cancelar',
        danger: true
    });
    if (ok) {
        try {
            await Api.deleteRoute(routeId);
            showToast('Ruta eliminada.');
            selectedRouteId = null;
            clearMapDrawings();
            await Promise.all([refreshAdminRoutes(), refreshPhysicalStops()]);
        } catch (err) {
            showToast(err.message, 'error');
        }
    }
}

// -----------------------------------------------------
function projectStopToSegmentMeters(stopLat, stopLng, a, b) {
    const cos = Math.cos((stopLat * Math.PI) / 180) || 1;
    const ax = (Number(a.longitude) - stopLng) * 111320 * cos;
    const ay = (Number(a.latitude) - stopLat) * 111320;
    const bx = (Number(b.longitude) - stopLng) * 111320 * cos;
    const by = (Number(b.latitude) - stopLat) * 111320;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const segLen = Math.sqrt(len2);
    return {
        dist: Math.hypot(ax + t * dx, ay + t * dy),
        t,
        segLen
    };
}

// Auto-asignar y ordenar paradas por distancia acumulada continua (primer paso geográfico en circuitos Ida+Regreso)
function autoAssignStopsByProximity() {
    if (!drawingMode || drawnCoordinates.length < 2) {
        showToast('Se necesitan al menos 2 puntos en el trazado activo para vincular paradas.', 'error');
        return;
    }

    if (!physicalStopsData || physicalStopsData.length === 0) {
        showToast('No hay paradas físicas cargadas en el mapa.', 'error');
        return;
    }

    const radiusSelect = document.getElementById('auto-assign-radius');
    const parsedRadius = radiusSelect ? parseInt(radiusSelect.value, 10) : 250;
    const thresholdMeters = (!isNaN(parsedRadius) && parsedRadius >= 50 && parsedRadius <= 1500) ? parsedRadius : 250;

    const cumDist = [0];
    for (let i = 0; i < drawnCoordinates.length - 1; i++) {
        const a = drawnCoordinates[i];
        const b = drawnCoordinates[i + 1];
        const stepLen = projectStopToSegmentMeters(Number(a.latitude), Number(a.longitude), a, b).segLen;
        cumDist.push(cumDist[i] + stepLen);
    }

    let newlyAssignedCount = 0;
    const stopsWithOrder = [];

    physicalStopsData.forEach(stop => {
        const stopLat = Number(stop.latitude);
        const stopLng = Number(stop.longitude);
        let minDist = Infinity;
        let bestCumFallback = 0;
        const segHits = new Array(drawnCoordinates.length - 1);

        for (let i = 0; i < drawnCoordinates.length - 1; i++) {
            const hit = projectStopToSegmentMeters(stopLat, stopLng, drawnCoordinates[i], drawnCoordinates[i + 1]);
            segHits[i] = hit;
            if (hit.dist < minDist) {
                minDist = hit.dist;
                bestCumFallback = cumDist[i] + hit.t * hit.segLen;
            }
        }

        const isAlreadySelected = selectedStopIds.includes(stop.id);
        if (!isAlreadySelected && minDist > thresholdMeters) {
            return;
        }

        const passLimit = minDist <= thresholdMeters
            ? Math.min(thresholdMeters, Math.max(120, minDist + 80))
            : minDist + 40;

        let chosenCum = bestCumFallback;
        for (let i = 0; i < segHits.length; i++) {
            if (segHits[i].dist <= passLimit) {
                let bestPassD = segHits[i].dist;
                let bestPassCum = cumDist[i] + segHits[i].t * segHits[i].segLen;
                for (let j = i + 1; j < segHits.length; j++) {
                    const h2 = segHits[j];
                    if (h2.dist < bestPassD) {
                        bestPassD = h2.dist;
                        bestPassCum = cumDist[j] + h2.t * h2.segLen;
                    } else if (h2.dist > bestPassD + 45 && h2.dist > passLimit) {
                        break;
                    }
                }
                chosenCum = bestPassCum;
                break;
            }
        }

        stopsWithOrder.push({ id: stop.id, cum: chosenCum });
        if (!isAlreadySelected) {
            newlyAssignedCount++;
            setPhysicalStopMarkerState(stop.id, true);
        }
    });

    stopsWithOrder.sort((a, b) => a.cum - b.cum);
    selectedStopIds = stopsWithOrder.map(s => s.id);

    updateStudioCounter();
    if (newlyAssignedCount > 0) {
        showToast(`Se auto-vincularon ${newlyAssignedCount} paradas dentro de ${thresholdMeters} m y se ordenaron según el trazado.`);
    } else {
        showToast(`No hubo nuevas paradas dentro de ${thresholdMeters} m; secuencia ordenada según el trazado.`);
    }
}

// CONFIGURACIÓN DE EVENT LISTENERS DEL ADMINISTRADOR
// -----------------------------------------------------

function setupAdminEventListeners(map) {
    // Escuchar clics en el mapa
    map.on('click', (e) => {
        if (drawingMode) {
            handleMapClickForDrawing(e.latlng);
        } else if (stopCreationMode) {
            handleMapClickForStop(e.latlng);
        }
    });

    // Clic derecho para mover rápidamente el punto del trazado más cercano a la ubicación del clic
        map.on('contextmenu', (e) => {
        if (e.originalEvent) {
            e.originalEvent.preventDefault();
        }
        // Insertar nuevo punto en el segmento más cercano
        if (drawingMode && drawnCoordinates.length >= 2) {
            let closestIdx = -1;
            let minDistance = Infinity;
            const clickPoint = mapInstance.project(e.latlng); // Proyectar a píxeles para cálculo geométrico plano
            
            for (let i = 0; i < drawnCoordinates.length - 1; i++) {
                const p1 = mapInstance.project(L.latLng(drawnCoordinates[i].latitude, drawnCoordinates[i].longitude));
                const p2 = mapInstance.project(L.latLng(drawnCoordinates[i+1].latitude, drawnCoordinates[i+1].longitude));
                
                // Usar la distancia perpendicular real al segmento de la línea
                const dist = L.LineUtil.pointToSegmentDistance(clickPoint, p1, p2);
                
                if (dist < minDistance) {
                    minDistance = dist;
                    closestIdx = i;
                }
            }
            if (closestIdx !== -1) {
                saveToHistory();
                const newCoord = { latitude: e.latlng.lat, longitude: e.latlng.lng };
                drawnCoordinates.splice(closestIdx + 1, 0, newCoord);
                redrawAllStudioMarkers();
                showToast('Punto intermedio insertado.');
            }
        } else if (drawingMode) {
             handleMapClickForDrawing(e.latlng);
        }
    });

    // Bloquear el menú contextual nativo del navegador en todo el mapa
    const mapElement = document.getElementById('map');
    if (mapElement) {
        mapElement.addEventListener('contextmenu', (e) => {
            if (drawingMode) {
                e.preventDefault();
            }
        });
    }

    // Función de confirmación al presionar "Cancelar / Salir del Studio"
    const handleConfirmExitStudio = async () => {
        if (drawingMode) {
            if (!(await confirmDiscardStudioChanges('salir del Studio'))) {
                return;
            }
        }
        exitDrawingMode();
    };

    // Guardar / Cancelar / Deshacer en modo trazado Studio
    document.getElementById('btn-save-draw').addEventListener('click', saveRouteGeometry);
    document.getElementById('btn-cancel-draw').addEventListener('click', handleConfirmExitStudio);
    document.getElementById('btn-undo-draw').addEventListener('click', undoLastPoint);
    if (document.getElementById('btn-clear-draw')) document.getElementById('btn-clear-draw').addEventListener('click', clearStudioDrawings);
    if (document.getElementById('btn-mirror-return')) document.getElementById('btn-mirror-return').addEventListener('click', mirrorStudioReturn);
    if (document.getElementById('btn-clear-stops-draw')) document.getElementById('btn-clear-stops-draw').addEventListener('click', clearStudioSelectedStops);
    if (document.getElementById('btn-import-json')) document.getElementById('btn-import-json').addEventListener('click', openImportModal);
    if (document.getElementById('btn-auto-assign')) document.getElementById('btn-auto-assign').addEventListener('click', autoAssignStopsByProximity);
    if (document.getElementById('btn-export-json')) document.getElementById('btn-export-json').addEventListener('click', openExportModal);
    if (document.getElementById('btn-process-import')) document.getElementById('btn-process-import').addEventListener('click', processImportedText);

    // Subida de archivos (.json / .geojson / .gpx / .sql) en Importar
    const pickFileBtn = document.getElementById('btn-pick-import-file');
    const importFileInput = document.getElementById('import-file-input');
    if (pickFileBtn && importFileInput) {
        pickFileBtn.addEventListener('click', () => importFileInput.click());
        importFileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) {
                showToast('El archivo excede el límite de 5 MB.', 'error');
                importFileInput.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const content = String(reader.result || '');
                document.getElementById('import-textarea').value = content;
                refreshImportKmlTrackSelector(content);
                showToast(`Archivo "${file.name}" cargado. Pulsa "Procesar y dibujar en mapa".`);
            };
            reader.onerror = () => showToast('No se pudo leer el archivo seleccionado.', 'error');
            reader.readAsText(file, 'utf-8');
        });
    }
    const importTextareaEl = document.getElementById('import-textarea');
    if (importTextareaEl) {
        importTextareaEl.addEventListener('input', (e) => {
            refreshImportKmlTrackSelector(e.target.value || '');
        });
    }

    // Botones del panel para activar herramientas
    const panelToggleBtn = document.getElementById('admin-panel-toggle');
    if (panelToggleBtn) {
        panelToggleBtn.addEventListener('click', () => {
            const sidebar = document.getElementById('admin-sidebar') || document.querySelector('.admin-body .sidebar');
            setAdminPanelCollapsed(!(sidebar && sidebar.classList.contains('admin-collapsed')));
        });
    }
    window.addEventListener('resize', () => {
        if (window.innerWidth > 1024) {
            setAdminPanelCollapsed(false);
        }
    });

    document.getElementById('btn-create-route').addEventListener('click', startDirectStudioMode);
    document.getElementById('btn-create-stop').addEventListener('click', startStopCreationMode);
    if (document.getElementById('btn-backup-catalog')) {
        document.getElementById('btn-backup-catalog').addEventListener('click', downloadAdminBackupJson);
    }
    if (document.getElementById('btn-cancel-stop-mode')) {
        document.getElementById('btn-cancel-stop-mode').addEventListener('click', () => {
            pendingStopEditDraft = null;
            setStopPlacementMode({ active: false });
            showToast('Modo de colocación de parada cancelado.', 'info');
        });
    }
    if (document.getElementById('btn-relocate-stop')) {
        document.getElementById('btn-relocate-stop').addEventListener('click', startRelocateStopMode);
    }

    // Pestañas y filtros locales de Rutas / Paradas + botón rápido de huérfanas
    const tabRoutes = document.getElementById('admin-tab-routes');
    const tabStops = document.getElementById('admin-tab-stops');
    const tabReports = document.getElementById('admin-tab-reports');
    if (tabRoutes) tabRoutes.addEventListener('click', () => switchAdminTab('routes'));
    if (tabStops) tabStops.addEventListener('click', () => switchAdminTab('stops'));
    if (tabReports) {
        tabReports.addEventListener('click', () => {
            switchAdminTab('reports');
            refreshAdminReports();
        });
    }

    document.querySelectorAll('#admin-report-status-filters [data-report-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            reportStatusFilter = btn.getAttribute('data-report-filter') || 'all';
            document.querySelectorAll('#admin-report-status-filters .admin-chip').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            renderAdminReports();
        });
    });

    const routeFilterInput = document.getElementById('admin-route-filter');
    if (routeFilterInput) {
        routeFilterInput.addEventListener('input', (e) => {
            routeSearchText = e.target.value || '';
            renderAdminRoutes();
        });
    }
    document.querySelectorAll('#admin-route-status-filters [data-route-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            routeStatusFilter = btn.getAttribute('data-route-filter') || 'all';
            document.querySelectorAll('#admin-route-status-filters .admin-chip').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            renderAdminRoutes();
        });
    });

    const stopFilterInput = document.getElementById('admin-stop-filter');
    if (stopFilterInput) {
        stopFilterInput.addEventListener('input', (e) => {
            stopSearchText = e.target.value || '';
            renderAdminStops();
        });
    }
    const setStopStatusFilterUI = (filterVal) => {
        stopStatusFilter = filterVal;
        document.querySelectorAll('#admin-stop-status-filters .admin-chip').forEach(c => {
            c.classList.toggle('active', c.getAttribute('data-stop-filter') === filterVal);
        });
        renderAdminStops();
    };
    document.querySelectorAll('#admin-stop-status-filters [data-stop-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            setStopStatusFilterUI(btn.getAttribute('data-stop-filter') || 'all');
        });
    });
    const orphansBtn = document.getElementById('stat-orphans-btn');
    if (orphansBtn) {
        orphansBtn.addEventListener('click', () => {
            switchAdminTab('stops');
            setStopStatusFilterUI('orphan');
        });
    }

    // Toggle de guía de controles de trazado y atajo Ctrl+Z / Escape
    const studioHud = document.getElementById('studio-controls-hud');
    const studioHudToggle = document.getElementById('studio-hud-toggle');
    if (studioHud && studioHudToggle) {
        studioHudToggle.addEventListener('click', () => {
            const isMin = studioHud.classList.toggle('minimized');
            studioHudToggle.textContent = isMin ? 'Ver controles' : 'Ocultar';
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && stopCreationMode) {
            pendingStopEditDraft = null;
            setStopPlacementMode({ active: false });
            showToast('Colocación de parada cancelada.', 'info');
            return;
        }
        if (!drawingMode) return;
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undoLastPoint();
        }
    });

    // Buscador OSM para ubicar y crear paradas sin salir del panel
    const adminOsmInput = document.getElementById('admin-osm-search-input');
    const adminOsmDropdown = document.getElementById('admin-osm-suggestions');
    if (adminOsmInput && adminOsmDropdown) {
        adminOsmInput.addEventListener('input', (e) => {
            clearTimeout(adminOsmSearchTimer);
            const val = e.target.value;
            if (val.trim().length < 3) {
                adminOsmDropdown.style.display = 'none';
                return;
            }
            adminOsmSearchTimer = setTimeout(() => searchAdminOSMPlaces(val), 450);
        });
        adminOsmInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(adminOsmSearchTimer);
                searchAdminOSMPlaces(adminOsmInput.value);
            }
        });
        document.addEventListener('click', (e) => {
            const box = document.getElementById('admin-osm-search-box');
            if (box && !box.contains(e.target)) {
                adminOsmDropdown.style.display = 'none';
            }
        });
    }

    // Submits de Formularios
    document.getElementById('route-form').addEventListener('submit', handleRouteFormSubmit);
    document.getElementById('stop-form').addEventListener('submit', handleStopFormSubmit);

    // Cerrar Modales
    document.getElementById('route-modal-close').addEventListener('click', () => {
        document.getElementById('route-modal').style.display = 'none';
    });
    document.getElementById('stop-modal-close').addEventListener('click', () => {
        document.getElementById('stop-modal').style.display = 'none';
        pendingStopEditDraft = null;
        setStopPlacementMode({ active: false });
    });
    if (document.getElementById('import-modal-close')) {
        document.getElementById('import-modal-close').addEventListener('click', () => {
            document.getElementById('import-modal').style.display = 'none';
        });
    }
    if (document.getElementById('export-modal-close')) {
        document.getElementById('export-modal-close').addEventListener('click', () => {
            document.getElementById('export-modal').style.display = 'none';
        });
    }
    if (document.getElementById('copy-json-btn')) {
        document.getElementById('copy-json-btn').addEventListener('click', () => {
            const el = document.getElementById('export-json-text');
            navigator.clipboard.writeText(el.value);
            showToast('JSON copiado al portapapeles 📋');
        });
    }
    if (document.getElementById('copy-sql-btn')) {
        document.getElementById('copy-sql-btn').addEventListener('click', () => {
            const el = document.getElementById('export-sql-text');
            navigator.clipboard.writeText(el.value);
            showToast('Sentencia SQL copiada al portapapeles 📋');
        });
    }

    // Logout en badge de usuario
    const userBadge = document.getElementById('user-badge');
    if (userBadge) {
        userBadge.addEventListener('click', async () => {
            if (drawingMode && !(await confirmDiscardStudioChanges('cerrar sesión'))) {
                return;
            }
            const ok = await showAdminConfirm({
                title: 'Cerrar sesión',
                message: '¿Deseas cerrar tu sesión de administrador?',
                confirmText: 'Cerrar sesión',
                cancelText: 'Cancelar',
                danger: false
            });
            if (ok) {
                Auth.logout();
            }
        });
    }

    // Botón de Volver a Vista de Usuario con protección anti-pérdida
    document.getElementById('user-view-btn').addEventListener('click', async () => {
        if (drawingMode) {
            if (!(await confirmDiscardStudioChanges('volver al mapa público'))) {
                return;
            }
        }
        window.location.href = 'index.html';
    });

    // Protección universal contra recargas de pestaña, cierre de ventana o navegación del navegador
    window.addEventListener('beforeunload', (e) => {
        if (hasUnsavedStudioChanges()) {
            e.preventDefault();
            e.returnValue = 'Tienes cambios sin guardar en el Studio.';
            return e.returnValue;
        }
    });

    // Protección contra el botón "Atrás" (flecha atrás o botón de ratón) del navegador
    window.addEventListener('popstate', async () => {
        if (drawingMode && hasUnsavedStudioChanges()) {
            // Mantener la URL actual en el historial mientras responde en el modal personalizado
            try {
                history.pushState({ studio: true }, "Studio de Trazado", window.location.href);
            } catch (err) {}
            if (!(await confirmDiscardStudioChanges('volver atrás en el navegador'))) {
                return;
            }
            exitDrawingMode();
        } else if (drawingMode) {
            exitDrawingMode();
        }
    });
}
