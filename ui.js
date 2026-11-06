import { TANK_CAPACITY_GAL, MAINT_RULES, TECHNICAL_GUIDES, DEFAULT_TIRES, ROUTE_PRESETS, DEFAULT_ORIGIN_COORDS } from './constants.js';
import { BAJAJ_DTC_DICTIONARY, updateAltitudeDeltaCheck, liveEcuData } from './obd.js';
import { appState, escapeHTML, playN160IgnitionSound, triggerHaptic } from './state.js';
import {
  isWithinPeriod,
  getDaysElapsed,
  getLastServiceRecord,
  computeMaintMemoryMap,
  computeChainHealth,
  computeTireTreadWear,
  getLastFuelPriceRecord,
  parseDotCode,
  estimateMonthlyKmRate,
  computeFuelTelemetry,
  computeWorkshopRanking,
  evaluateDocsStatus,
  computeMasterFinancials
} from './telemetry.js';

let toastTimeout = null;
let confirmCallback = null;
let hasRunSweepOnce = false;
let lastMapRenderTimeMs = 0;
let smartHudBound = false;
let elevInspectResetTimer = null;

export const uiConfig = {
  activePeriod: 'month',
  activeModFilter: 'all',
  activeMaintFilter: 'all',
  activeFinPeriod: 'all',
  maintSearchQuery: '',
  fuelSearchQuery: '',
  routeMultiplier: 1,
  routeTerrainFactor: 1,
  activeEcuSubView: 'map',
  activeRoutePresetId: 'standby',
  searchExpanded: false,
  customRoute: (function () {
    try {
      const saved = localStorage.getItem('mi_moto_last_sat_route_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.lat && parsed.lon && Number(parsed.distKm) > 0) {
          return parsed;
        }
      }
    } catch (e) {}
    return { ...ROUTE_PRESETS[0] };
  })(),
  courseUpMode: true,
  followLock: true,
  currentBearingDeg: 0,
  mapZoomScale: 1.0,
  gpsWatchId: null,
  liveGpsLat: null,
  liveGpsLon: null,
  liveGpsAlt: null,
  liveGpsSpeedKmh: null,
  inspectedElevIdx: null
};

function isRouteActive(route) {
  return Boolean(
    route &&
    route.id !== 'standby' &&
    route.lat !== null &&
    route.lon !== null &&
    !isNaN(Number(route.lat)) &&
    !isNaN(Number(route.lon)) &&
    Number(route.distKm) > 0
  );
}

// Cálculo robusto de autonomía que distingue entre Tanque Lleno y Cargas Parciales
function getTankTelemetryState(tele, sessKm = 0) {
  const fuelLogs = Array.isArray(appState.fuelLogs) ? appState.fuelLogs : [];
  const fullCapacityKm = Math.round(tele.avgKmPerGal * TANK_CAPACITY_GAL);

  if (fuelLogs.length === 0) {
    return {
      hasFuelData: false,
      fullCapacityKm,
      remKm: 0,
      tankPct: 0
    };
  }

  const sortedAsc = [...fuelLogs].sort((a, b) => Number(a.km) - Number(b.km) || a.id - b.id);
  let lastFullIndex = -1;
  for (let i = sortedAsc.length - 1; i >= 0; i--) {
    if (sortedAsc[i].fullTank !== false && !sortedAsc[i].isLoan) {
      lastFullIndex = i;
      break;
    }
  }

  const avgKmGal = Math.max(10, tele.avgKmPerGal);

  if (lastFullIndex === -1) {
    let currentGal = 0;
    let prevKm = Number(sortedAsc[0].km) || 0;
    sortedAsc.forEach((log) => {
      const logKm = Number(log.km) || prevKm;
      const burned = Math.max(0, logKm - prevKm) / avgKmGal;
      currentGal = Math.max(0, currentGal - burned);
      currentGal = Math.min(TANK_CAPACITY_GAL, currentGal + (Number(log.gallons) || 0));
      prevKm = logKm;
    });
    const kmAfter = Math.max(0, (Number(appState.currentKm) + sessKm) - prevKm);
    const remGal = Math.max(0, currentGal - (kmAfter / avgKmGal));
    const rem = Math.round(remGal * avgKmGal);
    return {
      hasFuelData: true,
      fullCapacityKm,
      remKm: rem,
      tankPct: Math.max(0, Math.min(100, Math.round((remGal / TANK_CAPACITY_GAL) * 100)))
    };
  }

  const lastFullKm = Number(sortedAsc[lastFullIndex].km) || 0;
  let partialGalSum = 0;
  for (let i = lastFullIndex + 1; i < sortedAsc.length; i++) {
    if (sortedAsc[i].fullTank === false && !sortedAsc[i].isLoan) {
      partialGalSum += Number(sortedAsc[i].gallons) || 0;
    }
  }

  const currentTotalKm = Number(appState.currentKm) + sessKm;
  const kmSinceLastFull = Math.max(0, currentTotalKm - lastFullKm);
  const effectiveGalBurned = (kmSinceLastFull / avgKmGal) - partialGalSum;
  const totalFuelGalInTank = Math.max(0, Math.min(TANK_CAPACITY_GAL, TANK_CAPACITY_GAL - effectiveGalBurned));
  const remKm = Math.round(totalFuelGalInTank * avgKmGal);
  const tankPct = Math.max(0, Math.min(100, Math.round((totalFuelGalInTank / TANK_CAPACITY_GAL) * 100)));

  return {
    hasFuelData: true,
    fullCapacityKm,
    remKm,
    tankPct
  };
}

function syncSmartSearchHudState(hasActiveRoute) {
  bindSmartSearchHudOnce();
  const collapsedPill = document.getElementById('mo-collapsed-route-pill');
  const expandedBox = document.getElementById('mo-expanded-search-box');
  if (!collapsedPill || !expandedBox) return;

  const showCollapsed = hasActiveRoute && !uiConfig.searchExpanded;
  collapsedPill.classList.toggle('hidden', !showCollapsed);
  expandedBox.classList.toggle('hidden', showCollapsed);
}

function bindSmartSearchHudOnce() {
  if (smartHudBound) return;
  const btnLupa = document.getElementById('btn-expand-search-lupa');
  const btnText = document.getElementById('btn-expand-search-text');
  const btnClear = document.getElementById('btn-pill-clear-route');
  if (!btnLupa && !btnText && !btnClear) return;

  smartHudBound = true;

  const expandSearchHandler = (e) => {
    e.stopPropagation();
    uiConfig.searchExpanded = true;
    syncSmartSearchHudState(isRouteActive(uiConfig.customRoute));
    triggerHaptic(10);
    const inp = document.getElementById('map-place-search-input');
    if (inp) {
      setTimeout(() => {
        inp.focus();
        inp.select();
      }, 60);
    }
  };

  btnLupa?.addEventListener('click', expandSearchHandler);
  btnText?.addEventListener('click', expandSearchHandler);

  btnClear?.addEventListener('click', (e) => {
    e.stopPropagation();
    const inp = document.getElementById('map-place-search-input');
    if (inp) inp.value = '';
    const clearSearchBtn = document.getElementById('btn-map-search-clear');
    if (clearSearchBtn) clearSearchBtn.classList.add('hidden');
    clearActiveRouteOnMap();
    triggerHaptic(12);
    showToast('🗺️ Ruta finalizada • Modo Exploración Libre');
  });
}

// ================= GESTOR NATIVO DE MODALES =================
export function openModalById(modalId, pushHistory = true) {
  const el = document.getElementById(modalId);
  if (!el) return;
  const wasHidden = el.classList.contains('hidden');
  el.classList.remove('hidden');
  if (wasHidden && pushHistory) {
    history.pushState({ modalOpen: modalId }, '');
  }
}

export function closeModalById(modalId, skipHistoryBack = false) {
  const el = document.getElementById(modalId);
  if (!el || el.classList.contains('hidden')) return;
  el.classList.add('hidden');
  if (modalId === 'modal-confirm') {
    confirmCallback = null;
  }
  if (!skipHistoryBack && history.state && history.state.modalOpen) {
    history.back();
  }
}

export function resetSweepFlag() {
  hasRunSweepOnce = false;
}

export function showToast(message) {
  const toast = document.getElementById('hud-toast');
  const text = document.getElementById('hud-toast-text');
  if (!toast || !text) return;
  text.textContent = message;
  toast.classList.remove('hidden');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2600);
}

export function openCustomConfirm({
  title,
  message,
  confirmText = 'Confirmar',
  isDanger = false,
  icon = '⚡',
  reuseHistoryState = false,
  onConfirm
}) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-icon-badge').textContent = icon;

  const okBtn = document.getElementById('btn-confirm-ok');
  okBtn.textContent = confirmText;
  okBtn.className = isDanger ? 'btn-danger-solid' : 'btn-neon';

  confirmCallback = onConfirm;
  openModalById('modal-confirm', !reuseHistoryState);
}

export function closeCustomConfirm() {
  closeModalById('modal-confirm');
}

export function executeConfirmCallback() {
  const cb = confirmCallback;
  closeModalById('modal-confirm');
  if (typeof cb === 'function') cb();
}

export function openInfoGuide(key) {
  const guide = TECHNICAL_GUIDES[key];
  if (!guide) return;

  document.getElementById('info-guide-category').textContent = guide.category;
  document.getElementById('info-guide-title').textContent = guide.title;
  document.getElementById('info-guide-how').textContent = guide.how;
  document.getElementById('info-guide-why').textContent = guide.why;
  openModalById('modal-info-guide');
}

export function closeInfoGuide() {
  closeModalById('modal-info-guide');
}

export function openSosModal(ecuData = null) {
  const activeEcu = ecuData || liveEcuData;
  const r = uiConfig.customRoute || ROUTE_PRESETS[0];
  const lat = uiConfig.liveGpsLat ?? (isRouteActive(r) ? r.lat : DEFAULT_ORIGIN_COORDS.lat);
  const lon = uiConfig.liveGpsLon ?? (isRouteActive(r) ? r.lon : DEFAULT_ORIGIN_COORDS.lon);

  const coordsEl = document.getElementById('sos-coords-display');
  if (coordsEl) {
    coordsEl.innerHTML = `${formatDmsCoord(lat, lon)}<br><small style="color:var(--caribbean-bright);font-size:11px;">Decimal: ${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}</small>`;
  }

  const docs = appState.docs || {};
  const plateEl = document.getElementById('sos-plate-val');
  const insEl = document.getElementById('sos-ins-val');
  const vitalEl = document.getElementById('sos-ecu-vital');
  const odoEl = document.getElementById('sos-odo-val');

  if (plateEl) plateEl.textContent = docs.plate ? docs.plate.toUpperCase() : 'N160 FI';
  if (insEl) insEl.textContent = docs.insurance ? `SOAT: ${docs.insurance}` : 'SOAT Activo';
  if (vitalEl) {
    const v = activeEcu && activeEcu.voltage > 0 ? `${activeEcu.voltage.toFixed(1)}V` : '-- V';
    const t = activeEcu && activeEcu.tempC > 0 ? `${activeEcu.tempC}°C` : '-- °C';
    vitalEl.textContent = `${v} • ${t}`;
  }
  if (odoEl) {
    odoEl.textContent = `${Number(appState.currentKm).toLocaleString('es-PE')} km`;
  }

  openModalById('modal-sos');
}

export function runClusterSweep(targetKm, targetTrip) {
  const odoEl = document.getElementById('current-km-display');
  const tripEl = document.getElementById('trip-a-display');
  const cluster = document.getElementById('cockpit-cluster');

  playN160IgnitionSound();

  if (cluster) {
    cluster.classList.remove('sweep-active');
    void cluster.offsetWidth;
    cluster.classList.add('sweep-active');
  }

  const duration = 680;
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    const ease = 1 - Math.pow(1 - progress, 4);

    odoEl.textContent = Math.round(targetKm * ease).toLocaleString('es-PE');
    tripEl.textContent = Math.round(targetTrip * ease).toLocaleString('es-PE');

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      odoEl.textContent = Number(targetKm).toLocaleString('es-PE');
      tripEl.textContent = Number(targetTrip).toLocaleString('es-PE');
    }
  }

  requestAnimationFrame(step);
}

export function renderImages() {
  const onbLogo = document.getElementById('onboarding-logo');
  const onbLogoPh = document.getElementById('logo-placeholder');
  const hdrLogo = document.getElementById('header-logo');
  const hdrFallback = document.getElementById('header-logo-fallback');

  if (appState.logoBase64) {
    onbLogo.src = appState.logoBase64;
    onbLogo.classList.remove('hidden');
    onbLogoPh.classList.add('hidden');
    hdrLogo.src = appState.logoBase64;
    hdrLogo.classList.remove('hidden');
    hdrFallback.classList.add('hidden');
  }

  const onbPhoto = document.getElementById('onboarding-bike-photo');
  const onbPhotoPh = document.getElementById('photo-placeholder');
  const banner = document.getElementById('main-bike-banner');
  const bannerImg = document.getElementById('banner-bike-img');

  if (appState.bikePhotoBase64) {
    onbPhoto.src = appState.bikePhotoBase64;
    onbPhoto.classList.remove('hidden');
    onbPhotoPh.classList.add('hidden');
    bannerImg.src = appState.bikePhotoBase64;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

export function checkDocsStatusUI() {
  const plateBadge = document.getElementById('header-plate-badge');
  const alertDot = document.getElementById('docs-alert-dot');
  const summaryEl = document.getElementById('docs-status-summary');
  const garageDocsSummary = document.getElementById('garage-docs-summary');
  const garageDocsWidget = document.getElementById('docs-garage-widget');

  const docs = appState.docs || {};
  if (docs.plate && docs.plate.trim() !== '') {
    plateBadge.textContent = docs.plate.trim().toUpperCase();
    plateBadge.classList.remove('hidden');
  } else {
    plateBadge.classList.add('hidden');
  }

  const status = evaluateDocsStatus();
  if (alertDot) alertDot.classList.toggle('hidden', !status.hasAlert);
  if (summaryEl) summaryEl.innerHTML = `<span>${status.summaryHtml}</span>`;
  if (garageDocsSummary) {
    const platePrefix = docs.plate ? `<strong>Placa ${escapeHTML(docs.plate.toUpperCase())}</strong> • ` : '';
    garageDocsSummary.innerHTML = `${platePrefix}${status.summaryHtml}`;
  }
  if (garageDocsWidget) {
    garageDocsWidget.classList.remove('docs-alert', 'docs-danger');
    if (status.hasDanger) garageDocsWidget.classList.add('docs-danger');
    else if (status.hasAlert) garageDocsWidget.classList.add('docs-alert');
  }
  return status;
}

export function renderSparkline(points) {
  const card = document.getElementById('sparkline-card');
  const wrap = document.getElementById('sparkline-svg-wrap');
  const badge = document.getElementById('sparkline-badge');

  if (!points || points.length < 2) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');
  const recent = points.slice(-6);
  const values = recent.map((p) => p.kmPerGal);
  const minVal = Math.min(...values) * 0.96;
  const maxVal = Math.max(...values) * 1.04;
  const range = Math.max(1, maxVal - minVal);
  const width = 320, height = 48, padX = 16, padY = 8;

  const coords = recent.map((pt, idx) => ({
    x: padX + (idx / (recent.length - 1)) * (width - padX * 2),
    y: height - padY - ((pt.kmPerGal - minVal) / range) * (height - padY * 2)
  }));

  const polylinePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const areaPoints = `${coords[0].x.toFixed(1)},${height} ${polylinePoints} ${coords[coords.length - 1].x.toFixed(1)},${height}`;

  const diffLast = recent[recent.length - 1].kmPerGal - recent[recent.length - 2].kmPerGal;
  if (Math.abs(diffLast) < 0.3) {
    badge.textContent = 'Consumo Estable';
    badge.style.color = 'var(--caribbean-bright)';
  } else if (diffLast > 0) {
    badge.textContent = `▲ Mejoró +${diffLast.toFixed(1)} km/gal`;
    badge.style.color = 'var(--neon-lime)';
  } else {
    badge.textContent = `▼ Varió ${diffLast.toFixed(1)} km/gal`;
    badge.style.color = 'var(--amber-warn)';
  }

  const circlesHtml = coords
    .map((c, i) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${i === coords.length - 1 ? 3.5 : 2.5}" fill="${i === coords.length - 1 ? '#58E800' : '#49BFE6'}" />`)
    .join('');

  wrap.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#49BFE6" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="#49BFE6" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      <polygon points="${areaPoints}" fill="url(#sparkGrad)" />
      <polyline fill="none" stroke="#49BFE6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${polylinePoints}" />
      ${circlesHtml}
    </svg>
  `;
}

export function renderMaintenanceCards() {
  const grid = document.getElementById('maint-alerts-grid');
  grid.innerHTML = '';

  const chainHealth = computeChainHealth();
  const chainBanner = document.getElementById('chain-stretch-alert-banner');
  if (chainBanner) {
    if (chainHealth.stretchWarning) {
      chainBanner.classList.remove('hidden');
      chainBanner.innerHTML = `
        <strong>⚠️ Alerta de Estiramiento en Cadena 428 O-Ring</strong>
        <span>Has tenido que tensar el eje trasero 3 veces en solo <strong>${chainHealth.stretchSpanKm.toLocaleString('es-PE')} km</strong>. Inspecciona posible desgaste en dientes de catalina (45T) y piñón (14T) o eslabones rígidos.</span>
      `;
    } else {
      chainBanner.classList.add('hidden');
    }
  }

  let overdueCount = 0;
  let warnCount = 0;
  const evaluatedCards = [];

  MAINT_RULES.forEach((rule, originalIdx) => {
    if (rule.onlyFirstTime && appState.lastServiceKm.breakin_500 !== null) return;

    const baseKm = appState.lastServiceKm[rule.id] ?? (appState.initialKm || 0);
    const kmRecorridos = Math.max(0, appState.currentKm - baseKm);
    const nextTargetKm = baseKm + rule.intervalKm;
    const kmRestantes = nextTargetKm - appState.currentKm;
    const kmRatio = kmRecorridos / rule.intervalKm;

    const lastDateStr = appState.lastServiceDate?.[rule.id] || '';
    let daysLeft = null;
    let timeRatio = 0;

    if (rule.intervalMonths && lastDateStr) {
      const totalAllowedDays = Math.round(rule.intervalMonths * 30.44);
      const elapsedDays = getDaysElapsed(lastDateStr);
      daysLeft = totalAllowedDays - elapsedDays;
      timeRatio = elapsedDays / totalAllowedDays;
    }

    const pct = Math.min(100, Math.floor(kmRatio * 100));
    const effectiveRatio = Math.max(kmRatio, timeRatio >= 1 ? timeRatio : 0);

    let statusClass = 'status-ok';
    let statusText = 'AL DÍA';
    let barColor = 'var(--neon-lime)';
    let showCalBtn = false;
    let urgencyWeight = 0;

    if (effectiveRatio >= 1) {
      statusClass = 'status-danger';
      statusText = timeRatio >= 1 && kmRatio < 1 ? 'VENCIDO (TIEMPO)' : 'VENCIDO';
      barColor = 'var(--red-danger)';
      overdueCount++;
      showCalBtn = true;
      urgencyWeight = 2;
    } else if (kmRatio >= 0.85) {
      statusClass = 'status-warn';
      statusText = 'PRÓXIMO';
      barColor = 'var(--amber-warn)';
      warnCount++;
      showCalBtn = true;
      urgencyWeight = 1;
    }

    let timeTextAddon = '';
    if (daysLeft !== null) {
      if (daysLeft < 0) {
        timeTextAddon = ` • Vencido hace ${Math.abs(daysLeft)}d`;
      } else {
        timeTextAddon = ` • o ${daysLeft}d`;
      }
    }

    const footerRightText =
      kmRestantes >= 0
        ? `Faltan ${kmRestantes.toLocaleString('es-PE')} km${timeTextAddon}`
        : `Pasado ${Math.abs(kmRestantes).toLocaleString('es-PE')} km${timeTextAddon}`;

    const prevRec = getLastServiceRecord(rule.id);
    const lastPriceHint = prevRec ? ` • Último: S/ ${Number(prevRec.cost).toFixed(0)}` : '';
    const chainExtraHint =
      rule.id === 'chain_lube' && chainHealth.tensionCount > 0
        ? ` • ${chainHealth.tensionCount} ajuste(s) tensión`
        : '';

    const calBtnHtml = showCalBtn
      ? `<button type="button" class="btn-cal-ics" data-cal-maint="${escapeHTML(rule.title)}" data-cal-targetkm="${nextTargetKm}" data-cal-daysleft="${daysLeft !== null ? daysLeft : ''}">📅 Agendar</button>`
      : '';

    const fillStyle =
      pct <= 0
        ? 'width: 0%; opacity: 0; background: transparent;'
        : `width: ${pct}%; background: ${barColor};`;

    evaluatedCards.push({
      urgencyWeight,
      effectiveRatio: kmRatio,
      originalIdx,
      html: `
        <div class="maint-top">
          <div>
            <div class="title-with-info">
              <span class="maint-title">${rule.title}</span>
              <button type="button" class="btn-info-dot" data-info-key="${rule.infoKey}">ⓘ</button>
            </div>
            <div class="maint-sub">${rule.subtitle}${lastPriceHint}${chainExtraHint}</div>
          </div>
          <div class="maint-top-right">
            ${calBtnHtml}
            <button class="btn-quick-done" data-quick-srv="${rule.id}">✓ Hecho</button>
            <span class="status-pill ${statusClass}">${statusText}</span>
          </div>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="${fillStyle}"></div>
        </div>
        <div class="maint-footer">
          <span>Base: ${baseKm.toLocaleString('es-PE')} km • Meta: <strong>${nextTargetKm.toLocaleString('es-PE')} km</strong></span>
          <strong>${footerRightText}</strong>
        </div>
      `
    });
  });

  evaluatedCards.sort((a, b) => {
    if (b.urgencyWeight !== a.urgencyWeight) return b.urgencyWeight - a.urgencyWeight;
    if (Math.abs(b.effectiveRatio - a.effectiveRatio) > 0.01) return b.effectiveRatio - a.effectiveRatio;
    return a.originalIdx - b.originalIdx;
  });

  evaluatedCards.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'maint-card';
    card.innerHTML = item.html;
    grid.appendChild(card);
  });

  const healthBadge = document.getElementById('bike-health-badge');
  const docsCheck = checkDocsStatusUI();

  if (overdueCount > 0) {
    healthBadge.textContent = `● Atención: ${overdueCount} servicio(s) vencido(s)`;
    healthBadge.style.color = 'var(--red-danger)';
  } else if (docsCheck.hasDanger) {
    healthBadge.textContent = `● Atención: Documento vencido`;
    healthBadge.style.color = 'var(--red-danger)';
  } else if (warnCount > 0) {
    healthBadge.textContent = `● Servicio próximo (${warnCount})`;
    healthBadge.style.color = 'var(--amber-warn)';
  } else if (docsCheck.hasAlert) {
    healthBadge.textContent = `● Revisar vigencia en Guantera`;
    healthBadge.style.color = 'var(--amber-warn)';
  } else {
    healthBadge.textContent = `● Sistema 100% Óptimo`;
    healthBadge.style.color = 'var(--neon-lime)';
  }
}

export function renderLogs() {
  const container = document.getElementById('logs-container');
  container.innerHTML = '';

  document.getElementById('maint-count-badge').textContent = appState.logs.length;

  const monthMaint = appState.logs.filter((l) => isWithinPeriod(l.date, 'month')).reduce((acc, l) => acc + (Number(l.cost) || 0), 0);
  const yearMaint = appState.logs.filter((l) => isWithinPeriod(l.date, 'year')).reduce((acc, l) => acc + (Number(l.cost) || 0), 0);

  document.getElementById('maint-month-total').textContent = `S/ ${monthMaint.toFixed(2)}`;
  document.getElementById('maint-year-total').textContent = `S/ ${yearMaint.toFixed(2)}`;

  const wRank = computeWorkshopRanking();
  const wCountBadge = document.getElementById('workshop-count-badge');
  const wSummary = document.getElementById('workshop-diy-summary');
  const wContainer = document.getElementById('workshop-rank-container');

  if (wCountBadge) wCountBadge.textContent = wRank.list.length;
  if (wSummary) {
    wSummary.textContent =
      wRank.diyCount > 0
        ? `Has realizado ${wRank.diyCount} servicio(s) tú mismo en casa (S/ 0 mano de obra)`
        : 'Registra el nombre del taller o mecánico en cada servicio';
  }
  if (wContainer) {
    wContainer.innerHTML = '';
    if (wRank.list.length === 0) {
      wContainer.innerHTML = `<div class="empty-logs">Aún no hay talleres registrados en tu bitácora.</div>`;
    } else {
      wRank.list.forEach((w, idx) => {
        const div = document.createElement('div');
        div.className = 'rank-item-row';
        div.innerHTML = `
          <div class="log-left">
            <h4><span class="rank-medal ${idx === 0 ? 'top1' : ''}">#${idx + 1}</span> ${escapeHTML(w.name)}</h4>
            <div class="log-meta">${w.visits} visita(s) • Última: ${w.lastKm.toLocaleString('es-PE')} km (${escapeHTML(w.lastDate)})</div>
            <div class="log-telemetry-badges">
              <span class="tele-chip">Repuestos: S/ ${w.partsSpent.toFixed(0)}</span>
              <span class="tele-chip ${w.laborSpent === 0 ? 'neon' : ''}">M.O: S/ ${w.laborSpent.toFixed(0)}</span>
            </div>
          </div>
          <div class="log-right">
            <span class="log-cost">S/ ${w.totalSpent.toFixed(2)}</span>
          </div>
        `;
        wContainer.appendChild(div);
      });
    }
  }

  const q = (uiConfig.maintSearchQuery || '').trim().toLowerCase();

  const filtered = appState.logs.filter((l) => {
    const catMatch =
      uiConfig.activeMaintFilter === 'all' ||
      l.typeId === uiConfig.activeMaintFilter ||
      (uiConfig.activeMaintFilter === 'oil_change' && l.typeId === 'breakin_500');
    if (!catMatch) return false;
    if (!q) return true;
    const haystack = `${l.title || ''} ${l.workshop || ''} ${l.notes || ''} ${l.date || ''} ${l.km || ''} ${l.cost || ''}`.toLowerCase();
    return haystack.includes(q);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-logs">Sin servicios que coincidan con tu búsqueda o filtro.</div>`;
    return;
  }

  const memMap = computeMaintMemoryMap();
  const sortedDesc = [...filtered].sort((a, b) => Number(b.km) - Number(a.km) || b.id - a.id);

  const chainActionLabels = {
    lube_only: '🧴 Solo Limpieza/Lub',
    lube_and_tension: '🔧 Lub + Tensión Eje',
    kit_replace: '⚙️ Kit Nuevo 14T/45T'
  };

  sortedDesc.forEach((item) => {
    const mInfo = memMap[item.id];
    const badges = [];

    const parts = Number(item.partsCost ?? item.cost) || 0;
    const labor = Number(item.laborCost) || 0;
    if (item.workshop) {
      badges.push(`<span class="tele-chip">🏪 ${escapeHTML(item.workshop)}</span>`);
    }
    if (item.typeId === 'chain_lube' && item.chainAction && chainActionLabels[item.chainAction]) {
      badges.push(`<span class="tele-chip">${chainActionLabels[item.chainAction]}</span>`);
    }
    if (labor > 0) {
      badges.push(`<span class="tele-chip">Rep: S/ ${parts.toFixed(0)} • M.O: S/ ${labor.toFixed(0)}</span>`);
    } else if (parts > 0) {
      badges.push(`<span class="tele-chip neon">Hecho por ti (M.O: S/ 0)</span>`);
    }

    if (mInfo && mInfo.hasPrev) {
      if (Math.abs(mInfo.diff) < 0.05) {
        badges.push(`<span class="mem-badge mem-same">= Igual que anterior (S/ ${mInfo.prevCost.toFixed(2)})</span>`);
      } else if (mInfo.diff < 0) {
        badges.push(`<span class="mem-badge mem-down">▼ -S/ ${Math.abs(mInfo.diff).toFixed(2)} vs anterior</span>`);
      } else {
        badges.push(`<span class="mem-badge mem-up">▲ +S/ ${mInfo.diff.toFixed(2)} vs anterior</span>`);
      }
    }

    const div = document.createElement('div');
    div.className = 'log-item';
    div.innerHTML = `
      <div class="log-left">
        <h4>${escapeHTML(item.title)}</h4>
        <div class="log-meta">${escapeHTML(item.date)} • ${Number(item.km).toLocaleString('es-PE')} km</div>
        <div class="log-telemetry-badges">${badges.join('')}</div>
        ${item.notes ? `<div class="log-notes">${escapeHTML(item.notes)}</div>` : ''}
      </div>
      <div class="log-right">
        <span class="log-cost">S/ ${Number(item.cost || 0).toFixed(2)}</span>
        <div class="log-btn-group">
          <button class="btn-edit-log" data-edit-maint="${item.id}">Editar</button>
          <button class="btn-del-log" data-del-maint="${item.id}" data-title="${escapeHTML(item.title)}">Eliminar</button>
        </div>
      </div>
    `;
    container.appendChild(div);
  });
}

export function renderFuelSection() {
  document.getElementById('fuel-count-badge').textContent = appState.fuelLogs.length;

  const loanBanner = document.getElementById('loan-mode-banner');
  const loanTitle = document.getElementById('loan-mode-title');
  const loanDesc = document.getElementById('loan-mode-desc');
  const loanBtn = document.getElementById('btn-toggle-loan-mode');

  if (loanBanner) {
    const isLoan = Boolean(appState.loanModeActive);
    loanBanner.classList.toggle('active', isLoan);
    loanTitle.textContent = isLoan ? 'Modo Préstamo: ACTIVO (Aislando datos)' : 'Modo Préstamo: Desactivado';
    loanDesc.textContent = isLoan
      ? 'Las cargas registradas ahora no alterarán tu promedio histórico de km/gal'
      : 'Actívalo si prestas la moto para no alterar tu promedio km/gal';
    loanBtn.textContent = isLoan ? 'Desactivar' : 'Activar';
  }

  const labelMap = {
    week: 'PREMIUM (SEMANA)',
    month: 'PREMIUM (MES)',
    year: 'PREMIUM (AÑO)'
  };
  document.getElementById('fuel-period-label').textContent = labelMap[uiConfig.activePeriod];

  const filteredFuel = appState.fuelLogs.filter((f) => isWithinPeriod(f.date, uiConfig.activePeriod));
  const filteredMaint = appState.logs.filter((l) => isWithinPeriod(l.date, uiConfig.activePeriod));
  const filteredSpa = (appState.washLogs || []).filter((w) => isWithinPeriod(w.date, uiConfig.activePeriod));
  const filteredOther = (appState.otherExpenses || []).filter((e) => isWithinPeriod(e.date, uiConfig.activePeriod));

  const fuelSpent = filteredFuel.reduce((sum, f) => sum + (Number(f.cost) || 0), 0);
  const fuelGallons = filteredFuel.reduce((sum, f) => sum + (Number(f.gallons) || 0), 0);
  const maintSpent = filteredMaint.reduce((sum, l) => sum + (Number(l.cost) || 0), 0);
  const spaSpent = filteredSpa.reduce((sum, w) => sum + (Number(w.cost) || 0), 0);
  const otherSpent = filteredOther.reduce((sum, e) => sum + (Number(e.cost) || 0), 0);

  document.getElementById('fuel-spent-period').textContent = `S/ ${fuelSpent.toFixed(2)}`;
  document.getElementById('fuel-gallons-period').textContent = `${fuelGallons.toFixed(2)} gal Premium`;
  document.getElementById('total-bike-period').textContent = `S/ ${(fuelSpent + maintSpent + spaSpent + otherSpent).toFixed(2)}`;

  const monthFuelSpent = appState.fuelLogs
    .filter((f) => isWithinPeriod(f.date, 'month'))
    .reduce((s, f) => s + (Number(f.cost) || 0), 0);
  const budgetLimit = Math.max(10, Number(appState.monthlyFuelBudget) || 150);
  const budgetRatio = monthFuelSpent / budgetLimit;
  const budgetPct = monthFuelSpent <= 0 ? 0 : Math.min(100, Math.round(budgetRatio * 100));

  document.getElementById('budget-limit-label').textContent = `S/ ${budgetLimit.toFixed(0)}`;
  document.getElementById('budget-pct-text').textContent = `${Math.round(budgetRatio * 100)}%`;

  const budgetFill = document.getElementById('budget-progress-fill');
  const budgetStatus = document.getElementById('budget-status-text');
  budgetFill.style.width = `${budgetPct}%`;
  budgetFill.style.opacity = budgetPct === 0 ? '0' : '1';

  if (budgetRatio >= 1) {
    budgetFill.style.background = 'var(--red-danger)';
    budgetStatus.innerHTML = `<span style="color:var(--red-danger)">Excediste tu tope mensual por S/ ${(monthFuelSpent - budgetLimit).toFixed(2)}</span>`;
  } else if (budgetRatio >= 0.85) {
    budgetFill.style.background = 'var(--amber-warn)';
    budgetStatus.innerHTML = `<span style="color:var(--amber-warn)">Quedan S/ ${(budgetLimit - monthFuelSpent).toFixed(2)} de tu tope mensual</span>`;
  } else {
    budgetFill.style.background = 'var(--neon-lime)';
    budgetStatus.textContent = `Disponible este mes: S/ ${(budgetLimit - monthFuelSpent).toFixed(2)}`;
  }

  const tele = computeFuelTelemetry();
  const trendSub = document.getElementById('fuel-price-trend-sub');

  if (tele.latestPriceDiff) {
    const d = tele.latestPriceDiff.priceDiff;
    const currP = tele.latestPriceDiff.currPrice;
    if (Math.abs(d) < 0.01) {
      trendSub.innerHTML = `Galón Premium estable: <strong>S/ ${currP.toFixed(2)}</strong>`;
    } else if (d < 0) {
      trendSub.innerHTML = `<span style="color:var(--neon-lime)">▼ Galón bajó S/ ${Math.abs(d).toFixed(2)}</span> (S/ ${currP.toFixed(2)})`;
    } else {
      trendSub.innerHTML = `<span style="color:var(--amber-warn)">▲ Galón subió S/ ${d.toFixed(2)}</span> (S/ ${currP.toFixed(2)})`;
    }
  } else {
    const lastRec = getLastFuelPriceRecord();
    trendSub.textContent = lastRec ? `Último galón: S/ ${Number(lastRec.priceGal).toFixed(2)}` : 'Grifo + Taller + Lavado + Otros';
  }

  const diagBanner = document.getElementById('fi-diagnostic-banner');
  if (diagBanner) {
    if (tele.diagnosticAlert) {
      diagBanner.classList.remove('hidden');
      diagBanner.classList.toggle('ok', tele.diagnosticAlert.status === 'ok');
      diagBanner.innerHTML = `
        <strong>${tele.diagnosticAlert.status === 'ok' ? '✅' : '⚠️'} Diagnóstico Preventivo FI: ${escapeHTML(tele.diagnosticAlert.title)}</strong>
        <span>${escapeHTML(tele.diagnosticAlert.advice)}</span>
      `;
    } else {
      diagBanner.classList.add('hidden');
    }
  }

  const stCount = document.getElementById('station-count-badge');
  const stSub = document.getElementById('best-station-sub');
  const stContainer = document.getElementById('station-rank-container');

  if (stCount) stCount.textContent = tele.stationRanking.length;
  if (stSub) {
    if (tele.stationRanking.length > 0) {
      const top = tele.stationRanking[0];
      stSub.innerHTML =
        top.realCostPerKm > 0
          ? `🏆 Más rentable: <strong style="color:var(--neon-lime)">${escapeHTML(top.name)}</strong> (S/ ${top.realCostPerKm.toFixed(2)}/km • ${top.realKmPerGal.toFixed(1)} km/gal)`
          : `🏆 Mejor precio galón: <strong style="color:var(--caribbean-bright)">${escapeHTML(top.name)}</strong> (S/ ${top.avgPrice.toFixed(2)}/gal)`;
    } else {
      stSub.textContent = 'Elige o escribe el nombre del grifo al abastecer (ej. Primax, Repsol)';
    }
  }
  if (stContainer) {
    stContainer.innerHTML = '';
    if (tele.stationRanking.length === 0) {
      stContainer.innerHTML = `<div class="empty-logs">Selecciona el nombre de la estación en el campo "Grifo" de tus cargas para comparar cuál rinde más.</div>`;
    } else {
      tele.stationRanking.forEach((st, idx) => {
        const div = document.createElement('div');
        div.className = 'rank-item-row';
        div.innerHTML = `
          <div class="log-left">
            <h4><span class="rank-medal ${idx === 0 ? 'top1' : ''}">#${idx + 1}</span> ⛽ ${escapeHTML(st.name)}</h4>
            <div class="log-meta">${st.visits} carga(s) • Promedio: S/ ${st.avgPrice > 0 ? st.avgPrice.toFixed(2) : '--'}/gal</div>
            <div class="log-telemetry-badges">
              ${st.realKmPerGal > 0 ? `<span class="tele-chip neon">Rinde ${st.realKmPerGal.toFixed(1)} km/gal</span>` : `<span class="tele-chip">Acumulando tramo completo</span>`}
              ${st.realCostPerKm > 0 ? `<span class="tele-chip">Costo real: S/ ${st.realCostPerKm.toFixed(2)}/km</span>` : ''}
            </div>
          </div>
          <div class="log-right">
            <span class="log-cost">${st.lastPrice > 0 ? `S/ ${st.lastPrice.toFixed(2)}` : '--'}</span>
            <small style="font-size:9px;color:var(--alloy-muted);">últ. galón</small>
          </div>
        `;
        stContainer.appendChild(div);
      });
    }
  }

  renderSparkline(tele.intervalPoints);

  const kmGalEl = document.getElementById('tele-km-per-gal');
  const kmLitEl = document.getElementById('tele-km-per-liter');
  const costKmEl = document.getElementById('tele-cost-per-km');
  const cost100El = document.getElementById('tele-cost-100km');
  const lastDeltaEl = document.getElementById('tele-last-delta');
  const lastEffEl = document.getElementById('tele-last-eff');
  const tankRangeEl = document.getElementById('tele-tank-range');
  const tipBanner = document.getElementById('tele-status-msg');

  const firstFullRec = [...appState.fuelLogs]
    .sort((a, b) => Number(a.km) - Number(b.km) || a.id - b.id)
    .find((f) => f.fullTank !== false && !f.isLoan);

  if (tele.validIntervals > 0) {
    const kmPerLit = tele.avgKmPerGal / 3.78541;
    const cost100 = tele.avgCostPerKm * 100;
    const estRange = Math.round(tele.avgKmPerGal * TANK_CAPACITY_GAL);

    kmGalEl.innerHTML = `${tele.avgKmPerGal.toFixed(1)} <small>km/gal</small>`;
    kmLitEl.textContent = `${kmPerLit.toFixed(1)} km por litro`;
    costKmEl.innerHTML = `S/ ${tele.avgCostPerKm.toFixed(2)} <small>/km</small>`;
    cost100El.textContent = `S/ ${cost100.toFixed(2)} cada 100 km`;
    lastDeltaEl.innerHTML = `+${tele.lastIntervalData.deltaKm} <small>km</small>`;
    lastEffEl.textContent = `Tramo: ${tele.lastIntervalData.kmPerGal.toFixed(1)} km/gal`;
    tankRangeEl.innerHTML = `~${estRange} <small>km</small>`;
    tipBanner.innerHTML = `Consumo medido en <strong>${tele.validIntervals} tramo(s)</strong>: tu N160 rinde <strong>${tele.avgKmPerGal.toFixed(1)} km/gal</strong> con Gasolina Premium y gasta <strong>S/ ${tele.avgCostPerKm.toFixed(2)} por km</strong>.`;
  } else if (firstFullRec) {
    const baseKm = Number(firstFullRec.km).toLocaleString('es-PE');
    kmGalEl.innerHTML = `-- <small>km/gal</small>`;
    kmLitEl.textContent = `Carga base activa`;
    costKmEl.innerHTML = `S/ -- <small>/km</small>`;
    cost100El.textContent = `Esperando 2do tanque lleno`;
    lastDeltaEl.innerHTML = `${baseKm} <small>km</small>`;
    lastEffEl.textContent = `Punto de partida`;
    tankRangeEl.innerHTML = `~520 <small>km</small>`;
    tipBanner.innerHTML = `Punto base (Tanque Lleno) registrado a los <strong>${baseKm} km</strong>. En tu próximo llenado al primer corte verás el rendimiento exacto.`;
  } else {
    kmGalEl.innerHTML = `-- <small>km/gal</small>`;
    kmLitEl.textContent = `-- km por litro`;
    costKmEl.innerHTML = `S/ -- <small>/km</small>`;
    cost100El.textContent = `S/ -- cada 100 km`;
    lastDeltaEl.innerHTML = `-- <small>km</small>`;
    lastEffEl.textContent = `Entre últimas 2 cargas`;
    tankRangeEl.innerHTML = `~520 <small>km</small>`;
    tipBanner.innerHTML = `Registra una carga con "Tanque Lleno (1er Corte)" para establecer el Punto Base de telemetría.`;
  }

  const container = document.getElementById('fuel-logs-container');
  container.innerHTML = '';

  const fq = (uiConfig.fuelSearchQuery || '').trim().toLowerCase();
  const visibleFuel = appState.fuelLogs.filter((f) => {
    if (!fq) return true;
    const hay = `${f.notes || ''} ${f.date || ''} ${f.km || ''} ${f.cost || ''} ${f.priceGal || ''}`.toLowerCase();
    return hay.includes(fq);
  });

  if (visibleFuel.length === 0) {
    container.innerHTML = `<div class="empty-logs">Sin cargas de combustible que coincidan con la vista.</div>`;
    return;
  }

  const sortedDesc = [...visibleFuel].sort((a, b) => Number(b.km) - Number(a.km) || b.id - a.id);

  sortedDesc.forEach((f) => {
    const tInfo = tele.enrichedMap[f.id];
    const chips = [];

    if (tInfo && tInfo.isLoan) {
      chips.push(`<span class="mem-badge mem-up">🤝 Modo Préstamo (Aislado)</span>`);
    } else if (tInfo && tInfo.isBase) {
      chips.push(`<span class="tele-chip">Punto Base Inicial (1er Corte)</span>`);
    } else if (tInfo && tInfo.isPartial) {
      chips.push(`<span class="tele-chip">Carga Parcial${tInfo.deltaKm > 0 ? ` (+${tInfo.deltaKm} km)` : ' (Previo a Base)'}</span>`);
    } else if (tInfo && tInfo.deltaKm > 0) {
      chips.push(`<span class="tele-chip">+${tInfo.deltaKm} km</span>`);
      chips.push(`<span class="tele-chip neon">${tInfo.kmPerGal.toFixed(1)} km/gal</span>`);
      chips.push(`<span class="tele-chip">S/ ${tInfo.costPerKm.toFixed(2)}/km</span>`);
    }

    if (tInfo && tInfo.priceDiff !== null) {
      if (Math.abs(tInfo.priceDiff) < 0.01) {
        chips.push(`<span class="mem-badge mem-same">= S/ ${Number(f.priceGal).toFixed(2)}/gal</span>`);
      } else if (tInfo.priceDiff < 0) {
        chips.push(`<span class="mem-badge mem-down">▼ -S/ ${Math.abs(tInfo.priceDiff).toFixed(2)}/gal</span>`);
      } else {
        chips.push(`<span class="mem-badge mem-up">▲ +S/ ${tInfo.priceDiff.toFixed(2)}/gal</span>`);
      }
    } else if (Number(f.priceGal) > 0) {
      chips.push(`<span class="mem-badge mem-same">S/ ${Number(f.priceGal).toFixed(2)}/gal</span>`);
    }

    const div = document.createElement('div');
    div.className = 'log-item';
    div.innerHTML = `
      <div class="log-left">
        <h4>Premium • ${Number(f.gallons).toFixed(2)} gal</h4>
        <div class="log-meta">${escapeHTML(f.date)} • Odómetro: ${Number(f.km).toLocaleString('es-PE')} km</div>
        <div class="log-telemetry-badges">${chips.join('')}</div>
        ${f.notes ? `<div class="log-notes">⛽ ${escapeHTML(f.notes)}</div>` : ''}
      </div>
      <div class="log-right">
        <span class="log-cost">S/ ${Number(f.cost).toFixed(2)}</span>
        <div class="log-btn-group">
          <button class="btn-edit-log" data-edit-fuel="${f.id}">Editar</button>
          <button class="btn-del-log" data-del-fuel="${f.id}" data-fuel-km="${f.km}">Eliminar</button>
        </div>
      </div>
    `;
    container.appendChild(div);
  });
}

export function renderGarageSection() {
  const lastWash = Number(appState.lastWashKm) || (appState.initialKm || 0);
  const kmSinceWash = Math.max(0, appState.currentKm - lastWash);
  const spaCard = document.getElementById('spa-widget-card');
  const spaTitle = document.getElementById('spa-status-title');
  const spaSub = document.getElementById('spa-sub-txt');

  if (kmSinceWash >= 400) {
    spaCard.classList.add('spa-due');
    spaTitle.innerHTML = `<span style="color:var(--amber-warn)">Sugerencia: Lavado de chasis y retenes</span>`;
    spaSub.textContent = `Llevas ${kmSinceWash.toLocaleString('es-PE')} km desde el último lavado (${lastWash.toLocaleString('es-PE')} km)`;
  } else {
    spaCard.classList.remove('spa-due');
    spaTitle.textContent = 'Pintura y retenes al día';
    spaSub.textContent = `Último lavado: ${lastWash.toLocaleString('es-PE')} km (Hace ${kmSinceWash.toLocaleString('es-PE')} km)`;
  }

  const washList = appState.washLogs || [];
  document.getElementById('spa-count-badge').textContent = washList.length;
  const monthSpa = washList.filter((w) => isWithinPeriod(w.date, 'month')).reduce((s, w) => s + (Number(w.cost) || 0), 0);
  const allSpa = washList.reduce((s, w) => s + (Number(w.cost) || 0), 0);

  document.getElementById('spa-month-total').textContent = `S/ ${monthSpa.toFixed(2)}`;
  document.getElementById('spa-all-total').textContent = `S/ ${allSpa.toFixed(2)}`;

  const spaContainer = document.getElementById('spa-logs-container');
  spaContainer.innerHTML = '';
  if (washList.length === 0) {
    spaContainer.innerHTML = `<div class="empty-logs">Sin lavados registrados aún.</div>`;
  } else {
    const sortedWashes = [...washList].sort((a, b) => Number(b.km) - Number(a.km) || b.id - a.id);
    sortedWashes.forEach((w) => {
      const div = document.createElement('div');
      div.className = 'log-item';
      div.innerHTML = `
        <div class="log-left">
          <h4>🚿 ${escapeHTML(w.type || 'Lavado')}</h4>
          <div class="log-meta">${escapeHTML(w.date)} • ${Number(w.km).toLocaleString('es-PE')} km</div>
          ${w.notes ? `<div class="log-notes">${escapeHTML(w.notes)}</div>` : ''}
        </div>
        <div class="log-right">
          <span class="log-cost">S/ ${Number(w.cost || 0).toFixed(2)}</span>
          <div class="log-btn-group">
            <button class="btn-edit-log" data-edit-spa="${w.id}">Editar</button>
            <button class="btn-del-log" data-del-spa="${w.id}">Eliminar</button>
          </div>
        </div>
      `;
      spaContainer.appendChild(div);
    });
  }

  const tiresGrid = document.getElementById('tires-status-grid');
  tiresGrid.innerHTML = '';
  const monthlyRate = estimateMonthlyKmRate();

  ['front', 'rear'].forEach((posKey) => {
    const tire = appState.tires[posKey] || DEFAULT_TIRES[posKey];
    const installKm = Number(tire.installKm) || 0;
    const lifeKm = Math.max(1000, Number(tire.lifeKm) || 16000);
    const kmRodados = Math.max(0, appState.currentKm - installKm);

    const treadInfo = computeTireTreadWear(tire, posKey);

    const kmRestantes =
      treadInfo.hasMeasurement && treadInfo.projectedRemainingKm !== null
        ? treadInfo.projectedRemainingKm
        : Math.max(0, lifeKm - kmRodados);

    const wearRatio = treadInfo.hasMeasurement ? treadInfo.wearRatio : kmRodados / lifeKm;
    const lifeRemainingPct = treadInfo.hasMeasurement
      ? treadInfo.lifeRemainingPct
      : Math.max(0, Math.min(100, Math.round((1 - wearRatio) * 100)));

    const wearBarPct = kmRodados < 50 && !treadInfo.hasMeasurement
      ? 0
      : Math.max(0, Math.min(100, Math.floor(wearRatio * 100)));

    const dotInfo = parseDotCode(tire.dot);
    let statusClass = 'status-ok';
    let statusText = `${lifeRemainingPct}% VIDA`;
    let barColor = 'var(--neon-lime)';

    if (wearRatio >= 1 || dotInfo.isOld || treadInfo.isBelowTwi) {
      statusClass = 'status-danger';
      statusText = dotInfo.isOld ? 'CAUCHO >4 AÑOS' : (treadInfo.isBelowTwi ? 'LÍMITE TWI 1.6MM' : 'CAMBIAR YA');
      barColor = 'var(--red-danger)';
    } else if (wearRatio >= 0.85) {
      statusClass = 'status-warn';
      statusText = `DESGASTE (${lifeRemainingPct}%)`;
      barColor = 'var(--amber-warn)';
    }

    const monthsLeft = Math.max(1, Math.round(kmRestantes / Math.max(200, monthlyRate)));
    const projText =
      treadInfo.hasMeasurement && treadInfo.kmPerMm > 0
        ? `${treadInfo.kmPerMm.toLocaleString('es-PE')} km/mm`
        : (kmRestantes > 0 ? `~${monthsLeft} mes(es)` : 'Límite TWI');

    const projLabel =
      treadInfo.hasMeasurement && treadInfo.kmPerMm > 0
        ? 'RITMO REAL (TWI)'
        : 'PROYECCIÓN CAMBIO';

    const treadChipHtml = treadInfo.hasMeasurement
      ? `<span class="tire-spec-chip ${treadInfo.isBelowTwi ? 'dot-warn' : 'dot-ok'}">Cocada: ${treadInfo.currentMm.toFixed(1)} mm</span>`
      : '';

    const psiLabel = posKey === 'front' ? 'DELANTERA (25 PSI)' : 'TRASERA (28 / 32 PSI)';
    const tireFillStyle =
      wearBarPct <= 0
        ? 'width: 0%; opacity: 0; background: transparent;'
        : `width: ${wearBarPct}%; background: ${barColor};`;

    const card = document.createElement('div');
    card.className = 'tire-card';
    card.innerHTML = `
      <div class="tire-card-header">
        <div>
          <span class="tire-pos-badge">🛞 LLANTA ${psiLabel}</span>
          <div class="tire-brand-title">${escapeHTML(tire.brand)}</div>
          <div class="tire-meta-row">
            <span class="tire-spec-chip">${escapeHTML(tire.size)}</span>
            <span class="tire-spec-chip">${escapeHTML(tire.compound)}</span>
            <span class="tire-spec-chip ${dotInfo.isOld ? 'dot-warn' : 'dot-ok'}">${dotInfo.label}</span>
            ${treadChipHtml}
          </div>
        </div>
        <div class="maint-top-right">
          <button class="btn-quick-done" data-edit-tire="${posKey}">⚙️ Cambiar / Editar</button>
          <span class="status-pill ${statusClass}">${statusText}</span>
        </div>
      </div>

      <div class="progress-track" style="margin-top:9px;">
        <div class="progress-fill" style="${tireFillStyle}"></div>
      </div>

      <div class="tire-metrics-strip">
        <div class="tm-box">
          <span>RODADOS CON LLANTA</span>
          <strong>${kmRodados.toLocaleString('es-PE')} km</strong>
        </div>
        <div class="tm-box">
          <span>VIDA RESTANTE</span>
          <strong>${kmRestantes.toLocaleString('es-PE')} km</strong>
        </div>
        <div class="tm-box">
          <span>${projLabel}</span>
          <strong style="color:var(--caribbean-bright)">${projText}</strong>
        </div>
      </div>
    `;
    tiresGrid.appendChild(card);
  });

  const histList = appState.tires.history || [];
  document.getElementById('tire-history-count').textContent = histList.length;
  const histContainer = document.getElementById('tire-history-container');
  histContainer.innerHTML = '';

  if (histList.length === 0) {
    histContainer.innerHTML = `<div class="empty-logs">Cuando reemplaces una llanta, el juego anterior quedará guardado aquí.</div>`;
  } else {
    histList.forEach((h) => {
      const div = document.createElement('div');
      div.className = 'log-item';
      div.innerHTML = `
        <div class="log-left">
          <h4>${escapeHTML(h.posLabel)}: ${escapeHTML(h.brand)} (${escapeHTML(h.size)})</h4>
          <div class="log-meta">Montada: ${Number(h.installKm).toLocaleString('es-PE')} km • Retirada: ${Number(h.removedKm).toLocaleString('es-PE')} km</div>
          <div class="log-telemetry-badges">
            <span class="tele-chip neon">Duró ${Number(h.totalRunKm).toLocaleString('es-PE')} km</span>
            ${h.dot ? `<span class="tele-chip">DOT ${escapeHTML(h.dot)}</span>` : ''}
          </div>
        </div>
        <div class="log-right">
          <span class="log-cost">S/ ${Number(h.cost || 0).toFixed(2)}</span>
          <button class="btn-del-log" data-del-tire-hist="${h.id}">Eliminar</button>
        </div>
      `;
      histContainer.appendChild(div);
    });
  }

  const mods = appState.accessories || [];
  document.getElementById('mods-count-badge').textContent = mods.length;
  const totalModsCost = mods.reduce((acc, m) => acc + (Number(m.cost) || 0), 0);
  document.getElementById('mods-total-invested').textContent = `S/ ${totalModsCost.toFixed(2)}`;

  const elecModsCount = mods.filter((m) => m.hasElec).length;
  const elecStatusEl = document.getElementById('mods-elec-status');
  elecStatusEl.style.color = '';
  if (elecModsCount === 0) {
    elecStatusEl.textContent = '0 Mods (Óptima)';
    elecStatusEl.className = 'fin-val';
  } else if (elecModsCount === 1) {
    elecStatusEl.textContent = '1 Activo (Vigilar)';
    elecStatusEl.className = 'fin-val carib-txt';
  } else {
    elecStatusEl.textContent = `${elecModsCount} Activos (Riesgo 4Ah)`;
    elecStatusEl.className = 'fin-val';
    elecStatusEl.style.color = 'var(--amber-warn)';
  }

  const modsContainer = document.getElementById('mods-list-container');
  modsContainer.innerHTML = '';
  const filteredMods = uiConfig.activeModFilter === 'all' ? mods : mods.filter((m) => m.category === uiConfig.activeModFilter);

  if (filteredMods.length === 0) {
    modsContainer.innerHTML = `<div class="empty-logs">Sin accesorios en esta categoría. Toca "+ Agregar" para registrar sliders, alarma o casco.</div>`;
  } else {
    const catLabels = {
      protection: '🛡️ Protección / Sliders',
      security: '🚨 Seguridad / Alarma',
      electric: '⚡ Eléctrico / Cockpit',
      gear: '🪖 Casco / Piloto'
    };

    filteredMods.forEach((m) => {
      const badges = [`<span class="tele-chip">${catLabels[m.category] || 'Accesorio'}</span>`];
      if (m.hasElec) badges.push(`<span class="mem-badge mem-up">⚡ Consumo 12V (Batería 4Ah)</span>`);
      if (m.category === 'gear' && m.date) {
        const buyYear = parseInt(m.date.split('-')[0], 10);
        if (!isNaN(buyYear)) badges.push(`<span class="tele-chip neon">Vigencia EPS hasta ${buyYear + 4}</span>`);
      }

      const div = document.createElement('div');
      div.className = 'log-item';
      div.innerHTML = `
        <div class="log-left">
          <h4>${escapeHTML(m.name)} ${m.brand ? `• <span style="color:var(--caribbean-bright)">${escapeHTML(m.brand)}</span>` : ''}</h4>
          <div class="log-meta">${escapeHTML(m.date || 'S/F')} • Instalado a los ${Number(m.km || 0).toLocaleString('es-PE')} km</div>
          <div class="log-telemetry-badges">${badges.join('')}</div>
          ${m.notes ? `<div class="log-notes">${escapeHTML(m.notes)}</div>` : ''}
        </div>
        <div class="log-right">
          <span class="log-cost">S/ ${Number(m.cost || 0).toFixed(2)}</span>
          <div class="log-btn-group">
            <button class="btn-edit-log" data-edit-mod="${m.id}">Editar</button>
            <button class="btn-del-log" data-del-mod="${m.id}" data-mod-name="${escapeHTML(m.name)}">Eliminar</button>
          </div>
        </div>
      `;
      modsContainer.appendChild(div);
    });
  }
}

export function renderRouteAndTCO() {
  const tele = computeFuelTelemetry();
  const baseDist = parseFloat(document.getElementById('route-km-input').value) || 0;
  const totalDist = baseDist * uiConfig.routeMultiplier;

  const effectiveKmPerGal = tele.avgKmPerGal / uiConfig.routeTerrainFactor;
  const neededGal = effectiveKmPerGal > 0 ? totalDist / effectiveKmPerGal : 0;
  const estCost = totalDist * tele.avgCostPerKm * uiConfig.routeTerrainFactor;

  document.getElementById('route-total-km').textContent = `${totalDist} km`;
  document.getElementById('route-needed-gal').textContent = `${neededGal.toFixed(2)} gal`;
  document.getElementById('route-est-cost').textContent = `S/ ${estCost.toFixed(2)}`;

  const fin = computeMasterFinancials(uiConfig.activeFinPeriod || 'all');
  const opexTagEl = document.querySelector('.co-card.opex .co-tag');
  if (opexTagEl) {
    const tagMap = { all: '🔥 OPERATIVO (OPEX TOTAL)', month: '🔥 OPERATIVO (ESTE MES)', year: '🔥 OPERATIVO (ESTE AÑO)' };
    opexTagEl.textContent = tagMap[uiConfig.activeFinPeriod] || tagMap.all;
  }

  const capexDisp = document.getElementById('capex-total-display');
  const capexSub = document.getElementById('capex-bike-sub');
  const opexDisp = document.getElementById('opex-total-display');
  const opexMini = document.getElementById('opex-per-km-mini');
  const tcoCapexRow = document.getElementById('tco-capex-row');

  if (capexDisp) capexDisp.textContent = `S/ ${fin.capexTotal.toFixed(2)}`;
  if (capexSub) {
    capexSub.textContent = fin.bikePrice > 0 ? `Moto: S/ ${fin.bikePrice.toLocaleString('es-PE')}` : 'Sin precio moto';
  }
  if (opexDisp) opexDisp.textContent = `S/ ${fin.opCostTotal.toFixed(2)}`;
  if (opexMini) opexMini.textContent = `S/ ${fin.realOpCostPerKm.toFixed(2)}/km`;
  if (tcoCapexRow) tcoCapexRow.textContent = `S/ ${fin.capexTotal.toFixed(2)}`;

  document.getElementById('master-grand-total').textContent = `S/ ${fin.grandTotalInvested.toFixed(2)}`;
  document.getElementById('tco-fuel-all').textContent = `S/ ${fin.allFuel.toFixed(2)}`;
  document.getElementById('tco-maint-all').textContent = `S/ ${fin.allMaint.toFixed(2)}`;
  document.getElementById('tco-parts-vs-labor').textContent = `Rep: S/ ${fin.allParts.toFixed(2)} • M.O: S/ ${fin.allLabor.toFixed(2)}`;
  document.getElementById('tco-spa-all').textContent = `S/ ${fin.allSpa.toFixed(2)}`;
  document.getElementById('tco-garage-all').textContent = `S/ ${fin.allGarage.toFixed(2)}`;
  document.getElementById('tco-admin-all').textContent = `S/ ${fin.allAdmin.toFixed(2)}`;

  document.getElementById('pct-fuel').textContent = `${fin.shares.fuelPct}%`;
  document.getElementById('pct-maint').textContent = `${fin.shares.maintPct}%`;
  document.getElementById('pct-spa').textContent = `${fin.shares.spaPct}%`;
  document.getElementById('pct-garage').textContent = `${fin.shares.garagePct}%`;
  document.getElementById('pct-admin').textContent = `${fin.shares.adminPct}%`;

  const segFuel = document.getElementById('seg-fuel');
  const segMaint = document.getElementById('seg-maint');
  const segGarage = document.getElementById('seg-garage');
  const segAdmin = document.getElementById('seg-admin');

  if (fin.opCostTotal <= 0) {
    [segFuel, segMaint, segGarage, segAdmin].forEach((s) => {
      if (s) {
        s.style.width = '0%';
        s.style.opacity = '0';
      }
    });
  } else {
    if (segFuel) {
      segFuel.style.width = `${fin.shares.fuelPct}%`;
      segFuel.style.opacity = fin.shares.fuelPct > 0 ? '1' : '0';
    }
    if (segMaint) {
      const maintPlusSpa = fin.shares.maintPct + fin.shares.spaPct;
      segMaint.style.width = `${maintPlusSpa}%`;
      segMaint.style.opacity = maintPlusSpa > 0 ? '1' : '0';
    }
    if (segGarage) {
      segGarage.style.width = `${fin.shares.garagePct}%`;
      segGarage.style.opacity = fin.shares.garagePct > 0 ? '1' : '0';
    }
    if (segAdmin) {
      segAdmin.style.width = `${fin.shares.adminPct}%`;
      segAdmin.style.opacity = fin.shares.adminPct > 0 ? '1' : '0';
    }
  }

  document.getElementById('tracked-km-label').textContent = `${fin.trackedKm.toLocaleString('es-PE')} km medidos`;
  document.getElementById('tco-real-km').textContent = `S/ ${fin.realOpCostPerKm.toFixed(2)} / km`;
  document.getElementById('tco-daily-cost').textContent = `S/ ${fin.dailyOpCost.toFixed(2)} / día (${fin.activeDays}d)`;

  const expList = appState.otherExpenses || [];
  document.getElementById('expense-count-badge').textContent = expList.length;
  const expContainer = document.getElementById('expense-logs-container');
  expContainer.innerHTML = '';

  if (expList.length === 0) {
    expContainer.innerHTML = `<div class="empty-logs">Sin gastos adicionales (peajes, cochera, parches o trámites) registrados.</div>`;
  } else {
    const sortedExp = [...expList].sort((a, b) => Number(b.km) - Number(a.km) || b.id - a.id);
    sortedExp.forEach((e) => {
      const div = document.createElement('div');
      div.className = 'log-item';
      div.innerHTML = `
        <div class="log-left">
          <h4>${escapeHTML(e.title)}</h4>
          <div class="log-meta">${escapeHTML(e.date)} • ${Number(e.km || 0).toLocaleString('es-PE')} km</div>
          <div class="log-telemetry-badges"><span class="tele-chip">${escapeHTML(e.category || 'Gasto')}</span></div>
        </div>
        <div class="log-right">
          <span class="log-cost">S/ ${Number(e.cost || 0).toFixed(2)}</span>
          <div class="log-btn-group">
            <button class="btn-edit-log" data-edit-exp="${e.id}">Editar</button>
            <button class="btn-del-log" data-del-exp="${e.id}">Eliminar</button>
          </div>
        </div>
      `;
      expContainer.appendChild(div);
    });
  }
}

export function renderAllMain(triggerSweep = false) {
  renderImages();
  bindSmartSearchHudOnce();

  const tripKm = Math.max(0, appState.currentKm - (appState.tripBaseKm || 0));

  if (triggerSweep && !hasRunSweepOnce) {
    hasRunSweepOnce = true;
    runClusterSweep(Number(appState.currentKm), tripKm);
  } else {
    document.getElementById('current-km-display').textContent = Number(appState.currentKm).toLocaleString('es-PE');
    document.getElementById('trip-a-display').textContent = tripKm.toLocaleString('es-PE');
  }

  const breakinPill = document.getElementById('breakin-pill');
  if (breakinPill) {
    if (appState.currentKm < 2000) {
      breakinPill.classList.remove('hidden');
      breakinPill.textContent = `ASENTAMIENTO (${appState.currentKm}/2000) ⓘ`;
    } else {
      breakinPill.classList.add('hidden');
    }
  }

  document.querySelectorAll('.ride-chk').forEach((chk, idx) => {
    chk.checked = Boolean(appState.checklistState[idx]);
  });

  checkDocsStatusUI();
  renderGarageSection();
  renderMaintenanceCards();
  renderLogs();
  renderFuelSection();
  renderRouteAndTCO();
}

export function formatDmsCoord(lat, lon) {
  const toDms = (val, posChar, negChar) => {
    const abs = Math.abs(Number(val) || 0);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = Math.round((minFloat - min) * 60);
    return `${deg}° ${String(min).padStart(2, '0')}' ${String(sec).padStart(2, '0')}" ${val >= 0 ? posChar : negChar}`;
  };
  return `${toDms(lat, 'N', 'S')}<br>${toDms(lon, 'E', 'O')}`;
}

export function renderElevationProfileSVG(elevArray, progressRatio = 0, routeActive = true) {
  const wrap = document.getElementById('map-elevation-svg-wrap');
  if (!wrap) return;

  const w = 165, h = 42, padLeft = 24, padRight = 6, padY = 5;

  if (!routeActive || !Array.isArray(elevArray) || elevArray.length < 2) {
    const baseAlt = Math.round(uiConfig.liveGpsAlt ?? 34);
    wrap.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="none">
        <line x1="${padLeft}" y1="${padY}" x2="${w - padRight}" y2="${padY}" stroke="rgba(210,218,228,0.08)" stroke-dasharray="2 2" stroke-width="0.8"/>
        <line x1="${padLeft}" y1="${(h / 2).toFixed(1)}" x2="${w - padRight}" y2="${(h / 2).toFixed(1)}" stroke="rgba(73,191,230,0.28)" stroke-dasharray="3 3" stroke-width="1.2"/>
        <line x1="${padLeft}" y1="${h - padY}" x2="${w - padRight}" y2="${h - padY}" stroke="rgba(210,218,228,0.12)" stroke-width="0.8"/>
        <text x="1" y="${(h / 2 + 2).toFixed(1)}" fill="#7C8B9E" font-size="6.8" font-weight="700">${baseAlt}m</text>
        <text x="${((w + padLeft) / 2).toFixed(0)}" y="${(h / 2 - 4).toFixed(1)}" fill="#8E9BAE" font-size="6.8" font-weight="700" text-anchor="middle">Sin ruta trazada</text>
      </svg>
    `;
    return;
  }

  const minE = Math.min(...elevArray);
  const maxE = Math.max(...elevArray, minE + 120);
  const span = Math.max(80, maxE - minE);

  const pts = elevArray.map((val, idx) => {
    const x = padLeft + (idx / (elevArray.length - 1)) * (w - padLeft - padRight);
    const y = h - padY - ((val - minE) / span) * (h - padY * 2);
    return { x, y, val };
  });

  const polyStr = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaStr = `${pts[0].x.toFixed(1)},${h - 2} ${polyStr} ${pts[pts.length - 1].x.toFixed(1)},${h - 2}`;

  const activeFloatIdx =
    uiConfig.inspectedElevIdx !== null
      ? Math.max(0, Math.min(pts.length - 1, uiConfig.inspectedElevIdx))
      : Math.max(0, Math.min(1, progressRatio)) * (pts.length - 1);

  const lowIdx = Math.floor(activeFloatIdx);
  const highIdx = Math.min(pts.length - 1, Math.ceil(activeFloatIdx));
  const frac = activeFloatIdx - lowIdx;

  const dotX = pts[lowIdx].x + (pts[highIdx].x - pts[lowIdx].x) * frac;
  const dotY = pts[lowIdx].y + (pts[highIdx].y - pts[lowIdx].y) * frac;
  const midE = Math.round((minE + maxE) / 2);

  wrap.innerHTML = `
    <svg id="elev-interactive-svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="none">
      <defs>
        <linearGradient id="elevFillGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#58E800" stop-opacity="0.38"/>
          <stop offset="100%" stop-color="#58E800" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <line x1="${padLeft}" y1="${padY}" x2="${w - padRight}" y2="${padY}" stroke="rgba(210,218,228,0.12)" stroke-dasharray="2 2" stroke-width="0.8"/>
      <line x1="${padLeft}" y1="${(h / 2).toFixed(1)}" x2="${w - padRight}" y2="${(h / 2).toFixed(1)}" stroke="rgba(210,218,228,0.10)" stroke-dasharray="2 2" stroke-width="0.8"/>
      <line x1="${padLeft}" y1="${h - padY}" x2="${w - padRight}" y2="${h - padY}" stroke="rgba(210,218,228,0.12)" stroke-width="0.8"/>
      <text x="1" y="${padY + 3}" fill="#7C8B9E" font-size="6.8" font-weight="700">${Math.round(maxE)}</text>
      <text x="1" y="${(h / 2 + 2).toFixed(1)}" fill="#7C8B9E" font-size="6.8" font-weight="700">${midE}</text>
      <text x="1" y="${h - 2}" fill="#7C8B9E" font-size="6.8" font-weight="700">${Math.round(minE)}</text>
      <polygon points="${areaStr}" fill="url(#elevFillGrad)" />
      <polyline fill="none" stroke="#58E800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${polyStr}" />
      <line x1="${dotX.toFixed(1)}" y1="${padY}" x2="${dotX.toFixed(1)}" y2="${h - padY}" stroke="rgba(255,255,255,0.28)" stroke-dasharray="1.5 1.5" stroke-width="0.8"/>
      <circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="4.5" fill="rgba(88,232,0,0.32)" />
      <circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="2.6" fill="#FFFFFF" stroke="#58E800" stroke-width="1.4" />
    </svg>
  `;

  const svgEl = wrap.querySelector('#elev-interactive-svg');
  if (svgEl) {
    svgEl.onclick = (ev) => {
      const rect = svgEl.getBoundingClientRect();
      const relX = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      const idx = Math.round(relX * (elevArray.length - 1));
      uiConfig.inspectedElevIdx = idx;

      const pickedAlt = elevArray[idx];
      const totalKm = Number(uiConfig.customRoute?.distKm) || 0;
      const pickedKm = ((idx / Math.max(1, elevArray.length - 1)) * totalKm).toFixed(1);

      const elevEl = document.getElementById('map-current-elev');
      if (elevEl) elevEl.textContent = `${pickedAlt.toLocaleString('es-PE')} m`;

      renderElevationProfileSVG(elevArray, progressRatio, true);
      triggerHaptic(8);
      showToast(`⛰️ Km ${pickedKm}: ${pickedAlt.toLocaleString('es-PE')} msnm`);

      if (elevInspectResetTimer) clearTimeout(elevInspectResetTimer);
      elevInspectResetTimer = setTimeout(() => {
        uiConfig.inspectedElevIdx = null;
        renderTacticalMapUI(liveEcuData, false);
      }, 4000);
    };
  }
}

let leafletMap = null;
let satTileLayer = null;
let labelsTileLayer = null;
let streetTileLayer = null;
let isSatelliteLayerActive = true;
let routeShadowPolyline = null;
let routeNeonPolyline = null;
let safeRangeCircle = null;
let bikeLeafletMarker = null;
let destLeafletMarker = null;
let currentRoadLatLngs = [];
let poiLayerGroup = null;

export function calculateBearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lon2 - lon1);

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x);
  return (toDeg(theta) + 360) % 360;
}

export function getCardinalLabel(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round(((deg % 360) / 45)) % 8];
}

function computeHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function applyMapOrientationRotation(origLat, origLon, destLat, destLon) {
  const mapEl = document.getElementById('leaflet-sat-map');
  const needleEl = document.getElementById('map-compass-needle');
  const degTxtEl = document.getElementById('map-bearing-deg-txt');

  if (destLat === null || destLon === null) {
    uiConfig.currentBearingDeg = 0;
    if (mapEl) mapEl.style.setProperty('--bike-pin-rot', '0deg');
    if (needleEl) needleEl.style.transform = 'rotate(0deg)';
    if (degTxtEl) degTxtEl.textContent = '0° N';
    return;
  }

  const bearing = calculateBearingDeg(origLat, origLon, destLat, destLon);
  uiConfig.currentBearingDeg = bearing;

  if (mapEl) mapEl.style.setProperty('--bike-pin-rot', `${bearing.toFixed(1)}deg`);
  if (needleEl) needleEl.style.transform = `rotate(${bearing.toFixed(1)}deg)`;
  if (degTxtEl) degTxtEl.textContent = `${Math.round(bearing)}° ${getCardinalLabel(bearing)}`;
}

export function toggleCourseUpMode() {
  recenterLeafletRoute();
  return true;
}

export function toggleFollowLockMode() {
  uiConfig.followLock = !uiConfig.followLock;
  const btn = document.getElementById('btn-map-follow-lock');
  if (btn) {
    btn.classList.toggle('active', uiConfig.followLock);
    btn.textContent = uiConfig.followLock ? '🔒' : '🔓';
  }
  if (uiConfig.followLock) {
    centerMapOnBike();
  }
  return uiConfig.followLock;
}

export function centerMapOnBike(zoomLevel = 14) {
  if (!leafletMap) return;
  const origLat = uiConfig.liveGpsLat ?? DEFAULT_ORIGIN_COORDS.lat;
  const origLon = uiConfig.liveGpsLon ?? DEFAULT_ORIGIN_COORDS.lon;
  leafletMap.setView([origLat, origLon], Math.max(leafletMap.getZoom(), zoomLevel), { animate: true });
}

function removeRouteLayersFromLeaflet() {
  if (!leafletMap) return;
  [routeShadowPolyline, routeNeonPolyline, destLeafletMarker, safeRangeCircle].forEach((layer) => {
    if (layer && leafletMap.hasLayer(layer)) {
      leafletMap.removeLayer(layer);
    }
  });
  routeShadowPolyline = null;
  routeNeonPolyline = null;
  destLeafletMarker = null;
  safeRangeCircle = null;
  currentRoadLatLngs = [];
}

export function clearActiveRouteOnMap() {
  if (elevInspectResetTimer) {
    clearTimeout(elevInspectResetTimer);
    elevInspectResetTimer = null;
  }
  uiConfig.customRoute = { ...ROUTE_PRESETS[0] };
  uiConfig.activeRoutePresetId = 'standby';
  uiConfig.searchExpanded = true;
  uiConfig.inspectedElevIdx = null;
  try {
    localStorage.removeItem('mi_moto_last_sat_route_v1');
  } catch (e) {}

  removeRouteLayersFromLeaflet();
  if (poiLayerGroup && leafletMap && leafletMap.hasLayer(poiLayerGroup)) {
    poiLayerGroup.clearLayers();
  }

  document.querySelectorAll('#map-quick-presets .mo-preset-chip').forEach((c) => c.classList.remove('active'));
  syncSmartSearchHudState(false);

  centerMapOnBike(12);
  renderTacticalMapUI(liveEcuData, false);
}

export function refreshLeafletSize() {
  if (leafletMap) {
    [60, 220, 450].forEach((ms) => {
      setTimeout(() => {
        leafletMap.invalidateSize({ animate: false });
        if (routeNeonPolyline && currentRoadLatLngs.length >= 2) {
          leafletMap.fitBounds(routeNeonPolyline.getBounds(), { padding: [36, 36] });
        }
      }, ms);
    });
  }
}

export function initLeafletSatelliteMap(onMapClickCallback) {
  const container = document.getElementById('leaflet-sat-map');
  if (!container || typeof window.L === 'undefined') return null;

  if (leafletMap) {
    refreshLeafletSize();
    return leafletMap;
  }

  const origLat = uiConfig.liveGpsLat ?? DEFAULT_ORIGIN_COORDS.lat;
  const origLon = uiConfig.liveGpsLon ?? DEFAULT_ORIGIN_COORDS.lon;

  leafletMap = window.L.map('leaflet-sat-map', {
    center: [origLat, origLon],
    zoom: 12,
    zoomControl: false,
    attributionControl: true
  });

  satTileLayer = window.L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 18, attribution: 'Satélite © Esri' }
  );

  labelsTileLayer = window.L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 18, opacity: 0.92 }
  );

  streetTileLayer = window.L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© OpenStreetMap' }
  );

  satTileLayer.addTo(leafletMap);
  labelsTileLayer.addTo(leafletMap);
  poiLayerGroup = window.L.layerGroup().addTo(leafletMap);

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (leafletMap) leafletMap.invalidateSize({ animate: false });
    });
    ro.observe(container);
  }

  leafletMap.on('dragstart', () => {
    if (uiConfig.searchExpanded && isRouteActive(uiConfig.customRoute)) {
      uiConfig.searchExpanded = false;
      syncSmartSearchHudState(true);
    }
    if (uiConfig.followLock) {
      uiConfig.followLock = false;
      const btn = document.getElementById('btn-map-follow-lock');
      if (btn) {
        btn.classList.remove('active');
        btn.textContent = '🔓';
      }
    }
  });

  leafletMap.on('click', (ev) => {
    if (typeof onMapClickCallback === 'function') {
      onMapClickCallback(ev.latlng.lat, ev.latlng.lng);
    }
  });

  return leafletMap;
}

export function toggleMapBaseLayer() {
  if (!leafletMap || !satTileLayer || !streetTileLayer) return true;
  isSatelliteLayerActive = !isSatelliteLayerActive;

  if (isSatelliteLayerActive) {
    if (leafletMap.hasLayer(streetTileLayer)) leafletMap.removeLayer(streetTileLayer);
    satTileLayer.addTo(leafletMap);
    labelsTileLayer.addTo(leafletMap);
  } else {
    if (leafletMap.hasLayer(satTileLayer)) leafletMap.removeLayer(satTileLayer);
    if (leafletMap.hasLayer(labelsTileLayer)) leafletMap.removeLayer(labelsTileLayer);
    streetTileLayer.addTo(leafletMap);
  }
  return isSatelliteLayerActive;
}

export function zoomLeafletMap(delta) {
  if (!leafletMap) return;
  leafletMap.setZoom(leafletMap.getZoom() + delta);
}

export function recenterLeafletRoute() {
  if (!leafletMap) return;
  if (routeNeonPolyline && currentRoadLatLngs.length >= 2) {
    leafletMap.fitBounds(routeNeonPolyline.getBounds(), { padding: [36, 36] });
  } else {
    centerMapOnBike(13);
  }
}

export async function searchPlaceByName(query) {
  const clean = String(query || '').trim();
  if (!clean) return [];

  const origLat = uiConfig.liveGpsLat ?? DEFAULT_ORIGIN_COORDS.lat;
  const origLon = uiConfig.liveGpsLon ?? DEFAULT_ORIGIN_COORDS.lon;

  const urlPe = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&countrycodes=pe&q=${encodeURIComponent(clean)}`;
  const res = await fetch(urlPe, { headers: { 'Accept-Language': 'es' } });
  let data = await res.json();

  if (!Array.isArray(data) || data.length === 0) {
    const urlGlobal = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&q=${encodeURIComponent(clean)}`;
    const resG = await fetch(urlGlobal, { headers: { 'Accept-Language': 'es' } });
    data = await resG.json();
  }

  return (Array.isArray(data) ? data : []).map((item) => {
    const parts = String(item.display_name || '').split(',').map((s) => s.trim());
    const shortName = parts[0] || clean;
    const region = parts.slice(1, 3).join(' • ') || 'Ruta Satelital N160';
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    const approxRoadKm = Number((computeHaversineKm(origLat, origLon, lat, lon) * 1.25).toFixed(1));
    const cardinal = getCardinalLabel(calculateBearingDeg(origLat, origLon, lat, lon));

    return { name: shortName, region, lat, lon, approxRoadKm, cardinal };
  });
}

export async function searchAndPlotPoisOnMap(poiQuery, iconEmoji = '⛽') {
  if (!leafletMap) initLeafletSatelliteMap();
  const origLat = uiConfig.liveGpsLat ?? DEFAULT_ORIGIN_COORDS.lat;
  const origLon = uiConfig.liveGpsLon ?? DEFAULT_ORIGIN_COORDS.lon;

  const viewbox = `${(origLon - 0.35).toFixed(4)},${(origLat + 0.35).toFixed(4)},${(origLon + 0.35).toFixed(4)},${(origLat - 0.35).toFixed(4)}`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=8&countrycodes=pe&viewbox=${viewbox}&bounded=1&q=${encodeURIComponent(poiQuery)}`;

  let results = [];
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    results = await res.json();
    if (!Array.isArray(results) || results.length === 0) {
      results = await searchPlaceByName(`${poiQuery} Trujillo`);
    } else {
      results = results.map((item) => {
        const parts = String(item.display_name || '').split(',').map((s) => s.trim());
        return {
          name: parts[0] || poiQuery,
          region: parts.slice(1, 3).join(' • ') || 'PDI en Ruta',
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon)
        };
      });
    }
  } catch (e) {}

  if (!results || results.length === 0) return 0;

  if (poiLayerGroup) poiLayerGroup.clearLayers();
  const boundsPts = [[origLat, origLon]];

  results.forEach((poi) => {
    boundsPts.push([poi.lat, poi.lon]);
    const pinIcon = window.L.divIcon({
      className: '',
      html: `<div class="n160-poi-pin" title="${escapeHTML(poi.name)}">${iconEmoji}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    const marker = window.L.marker([poi.lat, poi.lon], { icon: pinIcon });
    marker.on('click', () => {
      triggerHaptic(15);
      calculateRealRouteAndElevation({
        destLat: poi.lat,
        destLon: poi.lon,
        name: poi.name,
        region: poi.region
      });
      showToast(`🏁 Trazando ruta hacia ${poi.name}`);
    });
    if (poiLayerGroup) poiLayerGroup.addLayer(marker);
  });

  if (leafletMap && boundsPts.length >= 2) {
    leafletMap.fitBounds(boundsPts, { padding: [42, 42] });
  }
  return results.length;
}

export async function calculateRealRouteAndElevation({ destLat, destLon, name, region }) {
  const origLat = uiConfig.liveGpsLat ?? DEFAULT_ORIGIN_COORDS.lat;
  const origLon = uiConfig.liveGpsLon ?? DEFAULT_ORIGIN_COORDS.lon;

  let distKm = 40;
  let estMin = 50;
  let roadLatLngs = [
    [origLat, origLon],
    [destLat, destLon]
  ];

  try {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${origLon},${origLat};${destLon},${destLat}?overview=full&geometries=geojson`;
    const osrmRes = await fetch(osrmUrl);
    const osrmJson = await osrmRes.json();

    if (osrmJson && osrmJson.routes && osrmJson.routes.length > 0) {
      const r0 = osrmJson.routes[0];
      distKm = Number((r0.distance / 1000).toFixed(1));
      estMin = Math.max(2, Math.round(r0.duration / 60));
      if (r0.geometry && Array.isArray(r0.geometry.coordinates)) {
        roadLatLngs = r0.geometry.coordinates.map((c) => [c[1], c[0]]);
      }
    }
  } catch (e) {
    distKm = Number((computeHaversineKm(origLat, origLon, destLat, destLon) * 1.28).toFixed(1));
    estMin = Math.max(5, Math.round(distKm * 1.25));
  }

  let elevProfile = [34, 250, 680, 1100, 1450];
  let startAlt = Math.round(uiConfig.liveGpsAlt ?? 34);
  let peakAlt = startAlt;

  try {
    const sampleCount = 10;
    const sampledCoords = [];
    for (let i = 0; i < sampleCount; i++) {
      const idx = Math.min(roadLatLngs.length - 1, Math.floor((i / (sampleCount - 1)) * (roadLatLngs.length - 1)));
      sampledCoords.push(roadLatLngs[idx]);
    }
    const latsParam = sampledCoords.map((pt) => pt[0].toFixed(4)).join(',');
    const lonsParam = sampledCoords.map((pt) => pt[1].toFixed(4)).join(',');

    const elevUrl = `https://api.open-meteo.com/v1/elevation?latitude=${latsParam}&longitude=${lonsParam}`;
    const elevRes = await fetch(elevUrl);
    const elevJson = await elevRes.json();

    if (elevJson && Array.isArray(elevJson.elevation) && elevJson.elevation.length >= 2) {
      elevProfile = elevJson.elevation.map((v) => Math.max(0, Math.round(Number(v) || 0)));
      startAlt = elevProfile[0];
      peakAlt = Math.max(...elevProfile);
    }
  } catch (e) {}

  let terrainFactor = 1.0;
  let difficulty = 'Baja • Pista Plana';
  const altGain = Math.max(0, peakAlt - startAlt);

  if (peakAlt >= 2300 || altGain >= 1800) {
    terrainFactor = 1.18;
    difficulty = `Alta • Sierra (${peakAlt.toLocaleString('es-PE')}m)`;
  } else if (peakAlt >= 700 || altGain >= 500) {
    terrainFactor = 1.10;
    difficulty = `Media • Ascenso (${peakAlt.toLocaleString('es-PE')}m)`;
  }

  currentRoadLatLngs = roadLatLngs;
  if (elevInspectResetTimer) {
    clearTimeout(elevInspectResetTimer);
    elevInspectResetTimer = null;
  }
  uiConfig.inspectedElevIdx = null;
  uiConfig.searchExpanded = false;

  uiConfig.customRoute = {
    id: 'live',
    name: name || 'Destino Seleccionado',
    region: region || `Cima ${peakAlt.toLocaleString('es-PE')} msnm`,
    distKm,
    estMin,
    startAlt,
    peakAlt,
    terrainFactor,
    difficulty,
    lat: destLat,
    lon: destLon,
    elevProfile
  };

  try {
    localStorage.setItem('mi_moto_last_sat_route_v1', JSON.stringify(uiConfig.customRoute));
  } catch (e) {}
  renderTacticalMapUI(liveEcuData, true);
}

export function renderTacticalMapUI(ecuData = liveEcuData, fitMapBounds = false) {
  const activeEcu = ecuData || liveEcuData;

  const clockEl = document.getElementById('mo-live-clock');
  if (clockEl) {
    clockEl.textContent = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const topTempEl = document.getElementById('mo-top-temp-txt');
  if (topTempEl) {
    const iatOrMotor = activeEcu?.connected && activeEcu?.iatC > 0 ? activeEcu.iatC : 24;
    topTempEl.textContent = `${iatOrMotor}°C`;
  }

  const route = uiConfig.customRoute || ROUTE_PRESETS[0];
  const hasActiveRoute = isRouteActive(route);
  const tele = computeFuelTelemetry();
  const sessKm = Number(activeEcu?.sessionKm) || 0;
  const tankState = getTankTelemetryState(tele, sessKm);

  syncSmartSearchHudState(hasActiveRoute);

  let progressRatio = hasActiveRoute && route.distKm > 0 ? Math.min(1, sessKm / route.distKm) : 0;
  if (hasActiveRoute && activeEcu?.mode === 'sim') {
    progressRatio = ((Date.now() / 1000) % 25) / 25;
  }

  const remDistKm = hasActiveRoute ? Math.max(0, route.distKm * (1 - progressRatio)) : 0;
  const remMin = hasActiveRoute ? Math.max(1, Math.round(route.estMin * (1 - progressRatio))) : 0;

  const etaDate = new Date(Date.now() + remMin * 60000);
  const etaStr = hasActiveRoute
    ? etaDate.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '--:--';

  const effKmGal = tele.avgKmPerGal / (route.terrainFactor || 1.0);
  const neededGal = hasActiveRoute && effKmGal > 0 ? route.distKm / effKmGal : 0;
  const neededSoles = hasActiveRoute ? route.distKm * tele.avgCostPerKm * (route.terrainFactor || 1.0) : 0;

  const titleEl = document.getElementById('map-dest-title');
  if (titleEl) {
    titleEl.textContent = hasActiveRoute ? route.name : 'Exploración Libre';
    document.getElementById('map-dest-region').textContent = hasActiveRoute
      ? route.region
      : 'Toca la lupa para buscar destino';
  }

  const mapPanel = document.getElementById('obd-map-panel');
  if (mapPanel && !mapPanel.classList.contains('hidden') && typeof window.L !== 'undefined') {
    if (!leafletMap) {
      initLeafletSatelliteMap((clickedLat, clickedLon) => {
        triggerHaptic(12);
        calculateRealRouteAndElevation({
          destLat: clickedLat,
          destLon: clickedLon,
          name: `Punto (${clickedLat.toFixed(3)}, ${clickedLon.toFixed(3)})`,
          region: 'Marcado en Mapa Satelital'
        });
      });
    }

    if (leafletMap) {
      const origLat = uiConfig.liveGpsLat ?? DEFAULT_ORIGIN_COORDS.lat;
      const origLon = uiConfig.liveGpsLon ?? DEFAULT_ORIGIN_COORDS.lon;

      const bikeIcon = window.L.divIcon({
        className: '',
        html: `<div class="n160-bike-pin" title="Mi Pulsar N160">▲</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      if (!hasActiveRoute) {
        removeRouteLayersFromLeaflet();
        applyMapOrientationRotation(origLat, origLon, null, null);
        if (!bikeLeafletMarker) {
          bikeLeafletMarker = window.L.marker([origLat, origLon], { icon: bikeIcon }).addTo(leafletMap);
        } else {
          bikeLeafletMarker.setLatLng([origLat, origLon]);
        }
        if (uiConfig.followLock && uiConfig.gpsWatchId !== null) {
          leafletMap.panTo([origLat, origLon], { animate: true });
        }
      } else {
        const destLat = Number(route.lat);
        const destLon = Number(route.lon);
        applyMapOrientationRotation(origLat, origLon, destLat, destLon);

        const hasMatchingRoad =
          currentRoadLatLngs &&
          currentRoadLatLngs.length >= 2 &&
          Math.abs(currentRoadLatLngs[currentRoadLatLngs.length - 1][0] - destLat) < 0.02 &&
          Math.abs(currentRoadLatLngs[currentRoadLatLngs.length - 1][1] - destLon) < 0.02;

        const polyCoords = hasMatchingRoad
          ? currentRoadLatLngs
          : [[origLat, origLon], [destLat, destLon]];

        const targetIdx = Math.min(polyCoords.length - 1, Math.floor(progressRatio * (polyCoords.length - 1)));
        const bikeLatLng =
          uiConfig.gpsWatchId !== null && uiConfig.liveGpsLat !== null
            ? [uiConfig.liveGpsLat, uiConfig.liveGpsLon]
            : polyCoords[targetIdx];

        if (!routeShadowPolyline) {
          routeShadowPolyline = window.L.polyline(polyCoords, { color: '#05090F', weight: 8, opacity: 0.78 }).addTo(leafletMap);
        } else {
          routeShadowPolyline.setLatLngs(polyCoords);
        }

        if (!routeNeonPolyline) {
          routeNeonPolyline = window.L.polyline(polyCoords, { color: '#58E800', weight: 4.2, opacity: 1.0 }).addTo(leafletMap);
        } else {
          routeNeonPolyline.setLatLngs(polyCoords);
        }

        if (!bikeLeafletMarker) {
          bikeLeafletMarker = window.L.marker(bikeLatLng, { icon: bikeIcon }).addTo(leafletMap);
        } else {
          bikeLeafletMarker.setLatLng(bikeLatLng);
        }

        const destIcon = window.L.divIcon({
          className: '',
          html: `<div class="n160-dest-pin" title="${escapeHTML(route.name)}">🏁</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        const endCoord = polyCoords[polyCoords.length - 1];
        if (!destLeafletMarker) {
          destLeafletMarker = window.L.marker(endCoord, { icon: destIcon }).addTo(leafletMap);
        } else {
          destLeafletMarker.setLatLng(endCoord);
        }

        if (tankState.hasFuelData) {
          const routeSpanMeters = Math.max(3000, (route.distKm || 20) * 1000);
          const rMid = Math.round(routeSpanMeters * 0.68);
          const ringColor = tankState.remKm >= route.distKm * 2 ? '#58E800' : (tankState.remKm >= route.distKm ? '#FF9F0A' : '#FF453A');

          if (!safeRangeCircle) {
            safeRangeCircle = window.L.circle(bikeLatLng, {
              radius: rMid,
              color: ringColor,
              weight: 1.4,
              dashArray: '6, 5',
              fillColor: ringColor,
              fillOpacity: 0.06
            }).addTo(leafletMap);
          } else {
            safeRangeCircle.setLatLng(bikeLatLng);
            safeRangeCircle.setRadius(rMid);
            safeRangeCircle.setStyle({ color: ringColor, fillColor: ringColor });
          }
        }

        if (fitMapBounds && routeNeonPolyline) {
          refreshLeafletSize();
        } else if (uiConfig.followLock && (uiConfig.gpsWatchId !== null || activeEcu?.mode === 'sim')) {
          leafletMap.panTo(bikeLatLng, { animate: true });
        }
      }
    }
  }

  const liveSpd = Number(activeEcu?.speedKmh) || Number(uiConfig.liveGpsSpeedKmh) || 0;
  const spdEl = document.getElementById('map-live-speed');
  if (spdEl) spdEl.textContent = Math.round(liveSpd);

  const hudGearEl = document.getElementById('map-hud-gear');
  const hudVitalsEl = document.getElementById('map-hud-vitals');
  if (hudGearEl) {
    hudGearEl.textContent = activeEcu?.connected ? (activeEcu.gear || 'N') : 'N';
  }
  if (hudVitalsEl) {
    if (activeEcu?.connected) {
      const tVal = activeEcu.tempC > 0 ? `${activeEcu.tempC}°C` : '--°C';
      const vVal = activeEcu.voltage > 0 ? `${activeEcu.voltage.toFixed(1)}V` : '--V';
      const rVal = (Number(activeEcu.rpm) || 0).toLocaleString('es-PE');
      hudVitalsEl.textContent = `🌡️ ${tVal} • 🔋 ${vVal} • ${rVal} RPM`;
    } else {
      hudVitalsEl.textContent = uiConfig.gpsWatchId !== null ? '🟢 Velocidad GPS Satelital' : '⚡ Conecta ECU o activa Demo';
    }
  }

  const distEl = document.getElementById('map-bot-dist');
  const etaEl = document.getElementById('map-bot-eta');
  const needGalEl = document.getElementById('map-bot-needgal');
  const terrainEl = document.getElementById('map-bot-terrain');

  if (distEl) {
    distEl.innerHTML = hasActiveRoute ? `${remDistKm.toFixed(1)} <small>km</small>` : `-- <small>km</small>`;
  }
  if (etaEl) {
    etaEl.textContent = hasActiveRoute ? `${remMin}m • ${etaStr}` : 'ETA --:--';
  }
  if (needGalEl) {
    needGalEl.textContent = hasActiveRoute
      ? `Req: ${neededGal.toFixed(2)} gal (S/ ${neededSoles.toFixed(2)})`
      : 'Toca 🔍 para elegir destino';
  }
  if (terrainEl) {
    const extraPct = Math.round(((route.terrainFactor || 1) - 1) * 100);
    const gpsTxt = uiConfig.gpsWatchId !== null ? '🟢 GPS Vivo' : '🛰️ Satélite';
    terrainEl.textContent = hasActiveRoute
      ? `${extraPct > 0 ? `Ascenso (+${extraPct}% FI)` : 'Costa (0%)'} • ${gpsTxt}`
      : `Modo Libre • ${gpsTxt}`;
  }

  const avgKmL = tele.avgKmPerGal / 3.78541;
  const kmlEl = document.getElementById('map-avg-kml');
  const kmgalEl = document.getElementById('map-avg-kmgal');
  if (kmlEl) kmlEl.textContent = `${avgKmL.toFixed(1)} km/L`;
  if (kmgalEl) kmgalEl.textContent = `${tele.avgKmPerGal.toFixed(0)} km/gal`;

  const safeRangeEl = document.getElementById('map-safe-range');
  const safeBarEl = document.getElementById('map-safe-bar');
  const safePctEl = document.getElementById('map-safe-pct');
  if (safeRangeEl) {
    safeRangeEl.innerHTML = tankState.hasFuelData
      ? `⛽ ~${tankState.remKm} <small>km</small>`
      : `⛽ 0 <small>km</small>`;
  }
  if (safeBarEl) {
    safeBarEl.style.width = `${tankState.tankPct}%`;
  }
  if (safePctEl) {
    if (!tankState.hasFuelData) {
      safePctEl.textContent = '0% • Sin carga en Grifo';
    } else if (!hasActiveRoute) {
      safePctEl.textContent = `${tankState.tankPct}% de tanque disp.`;
    } else {
      const canRoundTrip = tankState.remKm >= route.distKm * 2;
      safePctEl.textContent = canRoundTrip
        ? `${tankState.tankPct}% • Ida y Vuelta ✓`
        : `${tankState.tankPct}% • Recargar en ruta`;
    }
  }

  const elevArr = Array.isArray(route.elevProfile) && route.elevProfile.length >= 2 ? route.elevProfile : [34, 34];
  const floatIdx = progressRatio * (elevArr.length - 1);
  const interpAlt = hasActiveRoute
    ? Math.round(
        elevArr[Math.floor(floatIdx)] +
          (elevArr[Math.min(elevArr.length - 1, Math.ceil(floatIdx))] - elevArr[Math.floor(floatIdx)]) * (floatIdx - Math.floor(floatIdx))
      )
    : Math.round(uiConfig.liveGpsAlt ?? 34);

  const currentAlt =
    uiConfig.inspectedElevIdx !== null && elevArr[uiConfig.inspectedElevIdx] !== undefined
      ? elevArr[uiConfig.inspectedElevIdx]
      : uiConfig.liveGpsAlt !== null
      ? Math.round(uiConfig.liveGpsAlt)
      : (activeEcu?.connected && activeEcu?.estimatedAltM > 0 ? activeEcu.estimatedAltM : interpAlt);

  if (uiConfig.liveGpsAlt !== null || activeEcu?.mode === 'sim') {
    updateAltitudeDeltaCheck(currentAlt);
  }

  const elevEl = document.getElementById('map-current-elev');
  if (elevEl) elevEl.textContent = `${currentAlt.toLocaleString('es-PE')} m`;

  const peakAltEl = document.getElementById('map-bot-peak-alt');
  if (peakAltEl) {
    peakAltEl.textContent = hasActiveRoute
      ? `• Cima ${Number(route.peakAlt || 0).toLocaleString('es-PE')}m`
      : `• Base ${currentAlt}m`;
  }

  renderElevationProfileSVG(elevArr, progressRatio, hasActiveRoute);
}

export function renderObdLiveUI(data, forceMap = false) {
  const activeData = data || liveEcuData;
  const nowMs = Date.now();
  if (forceMap || (uiConfig.activeEcuSubView === 'map' && nowMs - lastMapRenderTimeMs >= 900)) {
    lastMapRenderTimeMs = nowMs;
    renderTacticalMapUI(activeData, forceMap);
  } else {
    const clockEl = document.getElementById('mo-live-clock');
    if (clockEl && nowMs - lastMapRenderTimeMs >= 2000) {
      lastMapRenderTimeMs = nowMs;
      clockEl.textContent = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
  }

  const altAlertBanner = document.getElementById('mo-map-altitude-alert');
  if (altAlertBanner) {
    altAlertBanner.classList.toggle('hidden', !activeData?.mapResetNeeded);
  }

  const card = document.getElementById('obd-cockpit-card');
  const panel = document.getElementById('obd-live-panel');
  const statusPill = document.getElementById('obd-live-status');
  const btnConnect = document.getElementById('btn-obd-connect');
  const btnSim = document.getElementById('btn-obd-sim');

  if (!card || !panel) return;

  const tele = computeFuelTelemetry();
  const sessKm = Number(activeData?.sessionKm) || 0;
  const tankState = getTankTelemetryState(tele, sessKm);

  const footerFuelPct = document.getElementById('obd-footer-fuel-pct');
  const footerRange = document.getElementById('obd-footer-range');
  const footerOdo = document.getElementById('obd-footer-odo');
  const barTank = document.getElementById('obd-bar-tank');

  if (footerFuelPct) footerFuelPct.textContent = tankState.hasFuelData ? `~${tankState.tankPct}%` : '0%';
  if (footerRange) footerRange.textContent = tankState.hasFuelData ? `~${tankState.remKm} km` : '0 km';
  if (footerOdo) footerOdo.textContent = `${Math.round(Number(appState.currentKm) + sessKm).toLocaleString('es-PE')} km`;
  if (barTank) {
    barTank.style.width = `${tankState.tankPct}%`;
    barTank.style.backgroundColor =
      tankState.tankPct <= 20
        ? 'var(--red-danger)'
        : tankState.tankPct <= 35
        ? 'var(--amber-warn)'
        : 'var(--neon-lime)';
  }

  // Distancia de sesión y estado de Caja Negra siempre activos (incluso rodando solo con GPS sin escáner BLE)
  const distSmall = document.getElementById('obd-micro-dist');
  const sessTxt = document.getElementById('obd-session-km-txt');
  if (distSmall) distSmall.textContent = `Ruta: +${sessKm.toFixed(2)} km`;
  if (sessTxt) sessTxt.textContent = `+${sessKm.toFixed(2)} km hoy`;

  if (activeData?.blackbox) {
    const bb = activeData.blackbox;
    const topRecBtn = document.getElementById('btn-obd-rec-toggle');
    const diagRecBtn = document.getElementById('btn-bb-toggle-diag');
    const bbSummary = document.getElementById('bb-status-summary');
    const bbPts = document.getElementById('bb-val-points');
    const bbTemp = document.getElementById('bb-val-maxtemp');
    const bbPeaks = document.getElementById('bb-val-peaks');

    if (topRecBtn) {
      topRecBtn.textContent = bb.recording ? `⏹ REC (${bb.points.length})` : '🔴 REC';
      topRecBtn.classList.toggle('recording-active', bb.recording);
    }
    if (diagRecBtn) {
      diagRecBtn.textContent = bb.recording ? '⏹ Detener Grabación' : '🔴 Grabar Ruta';
    }
    if (bbSummary) {
      bbSummary.textContent = bb.recording
        ? `🔴 GRABANDO EN VIVO: ${bb.points.length} puntos capturados (GPS + 14 sensores ECU)`
        : bb.points.length > 0
        ? `✅ Sesión lista (${bb.points.length} puntos). Descarga tu ruta en .GPX o .CSV`
        : 'Listo para grabar trazado satelital y parámetros del motor cada 2.5s';
      bbSummary.style.color = bb.recording ? 'var(--red-danger)' : 'var(--neon-lime)';
    }
    if (bbPts) bbPts.textContent = `${bb.points.length} pts`;
    if (bbTemp) bbTemp.textContent = bb.maxTempC > 0 ? `${bb.maxTempC} °C` : '-- °C';
    if (bbPeaks) bbPeaks.textContent = `${bb.maxSpeed} km/h • ${bb.maxRpm} RPM`;
  }

  if (!activeData || !activeData.connected) {
    card.classList.remove('obd-active', 'obd-shift-alert');
    statusPill.textContent = uiConfig.gpsWatchId !== null ? 'GPS VIVO' : 'OFFLINE';
    statusPill.className = 'status-pill status-ok';
    if (btnConnect) btnConnect.textContent = '⚡ ECU';
    if (btnSim) btnSim.textContent = 'Demo';

    const gpsSpd = Math.round(Number(uiConfig.liveGpsSpeedKmh) || 0);
    const gpsSpdPct = Math.min(100, Math.round((gpsSpd / 140) * 100));
    document.getElementById('obd-speed-val').textContent = String(gpsSpd);
    document.getElementById('obd-peak-speed').textContent = String(Number(activeData?.peakSpeed) || 0);
    document.getElementById('obd-gear-val').textContent = 'N';
    document.getElementById('obd-rpm-val').textContent = '0';
    document.getElementById('obd-rpm-bar').style.width = '0%';
    ['obd-bar-temp', 'obd-bar-volt', 'obd-bar-tps', 'obd-bar-econ'].forEach((id) => {
      const b = document.getElementById(id);
      if (b) b.style.width = '0%';
    });
    const rpmArcOff = document.getElementById('obd-rpm-arc');
    const spdArcOff = document.getElementById('obd-speed-arc');
    if (rpmArcOff) rpmArcOff.setAttribute('stroke-dashoffset', '100');
    if (spdArcOff) spdArcOff.setAttribute('stroke-dashoffset', String(100 - gpsSpdPct));
    return;
  }

  card.classList.add('obd-active');

  if (activeData.mode === 'sim') {
    statusPill.textContent = 'DEMO';
    statusPill.className = 'status-pill status-warn';
    if (btnSim) btnSim.textContent = '⏹ Salir';
    if (btnConnect) btnConnect.textContent = '⚡ ECU';
  } else {
    statusPill.textContent = 'ONLINE';
    statusPill.className = 'status-pill status-ok';
    if (btnConnect) btnConnect.textContent = '⏹ Cortar';
    if (btnSim) btnSim.textContent = 'Demo';
  }

  const rpm = Number(activeData.rpm) || 0;
  const peakRpm = Number(activeData.peakRpm) || 0;
  const spd = Number(activeData.speedKmh) || 0;
  const peakSpd = Number(activeData.peakSpeed) || 0;
  const gear = activeData.gear || 'N';

  document.getElementById('obd-speed-val').textContent = spd;
  document.getElementById('obd-peak-speed').textContent = peakSpd;
  document.getElementById('obd-gear-val').textContent = gear;
  document.getElementById('obd-rpm-val').textContent = rpm.toLocaleString('es-PE');
  document.getElementById('obd-peak-rpm').textContent = peakRpm.toLocaleString('es-PE');

  const rpmPct = Math.min(100, Math.round((rpm / 10000) * 100));
  const spdPct = Math.min(100, Math.round((spd / 140) * 100));

  const rpmArc = document.getElementById('obd-rpm-arc');
  const spdArc = document.getElementById('obd-speed-arc');
  if (rpmArc) rpmArc.setAttribute('stroke-dashoffset', String(100 - rpmPct));
  if (spdArc) spdArc.setAttribute('stroke-dashoffset', String(100 - spdPct));

  const rpmBar = document.getElementById('obd-rpm-bar');
  if (rpmBar) rpmBar.style.width = `${rpmPct}%`;

  const isBreakin1k = appState.currentKm < 1000;
  const isBreakin2k = appState.currentKm >= 1000 && appState.currentKm < 2000;
  const shiftLimit = isBreakin1k ? 5000 : (isBreakin2k ? 6500 : 8500);

  const redzoneArc = document.getElementById('obd-rpm-redzone-arc');
  if (redzoneArc) {
    const startPct = Math.round((shiftLimit / 10000) * 100);
    const zoneLen = 100 - startPct;
    redzoneArc.setAttribute('stroke-dasharray', `${zoneLen} 100`);
    redzoneArc.setAttribute('stroke-dashoffset', `-${startPct}`);
  }

  if (rpmArc) {
    rpmArc.classList.toggle('torque-glow', rpm >= 6000 && rpm < shiftLimit);
  }

  const guardPill = document.getElementById('obd-breakin-guard');
  if (rpm >= shiftLimit) {
    card.classList.add('obd-shift-alert');
    guardPill.textContent = '¡SUBIR MARCHA!';
    guardPill.style.background = 'rgba(255, 69, 58, 0.25)';
    guardPill.style.color = 'var(--red-danger)';
    if (rpmArc) rpmArc.setAttribute('stroke', 'var(--red-danger)');
  } else if (rpm >= shiftLimit * 0.85) {
    card.classList.remove('obd-shift-alert');
    guardPill.textContent = 'ZONA ALTA';
    guardPill.style.background = 'rgba(255, 159, 10, 0.2)';
    guardPill.style.color = 'var(--amber-warn)';
    if (rpmArc) rpmArc.setAttribute('stroke', 'var(--amber-warn)');
  } else {
    card.classList.remove('obd-shift-alert');
    guardPill.textContent = isBreakin1k ? 'CUIDANDO <5k' : 'ÓPTIMO';
    guardPill.style.background = 'rgba(88, 232, 0, 0.15)';
    guardPill.style.color = 'var(--neon-lime)';
    if (rpmArc) rpmArc.setAttribute('stroke', 'var(--neon-lime)');
  }

  const tempC = Number(activeData.tempC) || 0;
  const tempEl = document.getElementById('obd-temp-val');
  const tempSub = document.getElementById('obd-temp-status');
  const barTemp = document.getElementById('obd-bar-temp');
  tempEl.innerHTML = `${tempC} <small>°C</small>`;

  const tempPct = tempC > 0 ? Math.max(0, Math.min(100, Math.round(((tempC - 20) / 105) * 100))) : 0;
  if (barTemp) barTemp.style.width = `${tempPct}%`;

  if (tempC < 45) {
    tempSub.textContent = '❄️ Frío (Calentar)';
    tempEl.style.color = 'var(--caribbean-bright)';
    if (barTemp) barTemp.style.backgroundColor = 'var(--caribbean-bright)';
  } else if (tempC <= 110) {
    tempSub.textContent = '✅ Aceite/Culata OK';
    tempEl.style.color = 'var(--neon-lime)';
    if (barTemp) barTemp.style.backgroundColor = 'var(--neon-lime)';
  } else if (tempC <= 115) {
    tempSub.textContent = '⚠️ Exigencia Alta';
    tempEl.style.color = 'var(--amber-warn)';
    if (barTemp) barTemp.style.backgroundColor = 'var(--amber-warn)';
  } else {
    tempSub.textContent = '🔥 Alerta EOT >115°C';
    tempEl.style.color = 'var(--red-danger)';
    if (barTemp) barTemp.style.backgroundColor = 'var(--red-danger)';
  }

  const volt = Number(activeData.voltage) || 0;
  const voltEl = document.getElementById('obd-volt-val');
  const voltSub = document.getElementById('obd-volt-status');
  const barVolt = document.getElementById('obd-bar-volt');
  voltEl.innerHTML = `${volt > 0 ? volt.toFixed(1) : '--'} <small>V</small>`;

  const voltPct = volt > 0 ? Math.max(0, Math.min(100, Math.round(((volt - 11.0) / 4.0) * 100))) : 0;
  if (barVolt) barVolt.style.width = `${voltPct}%`;

  if (volt === 0) {
    voltSub.textContent = 'Leyendo pin 16...';
  } else if (volt < 12.2) {
    voltEl.style.color = 'var(--red-danger)';
    voltSub.textContent = '⚠️ Batería baja';
    if (barVolt) barVolt.style.backgroundColor = 'var(--red-danger)';
  } else if (volt >= 13.5 && volt <= 14.6) {
    voltEl.style.color = 'var(--neon-lime)';
    voltSub.textContent = '⚡ Estator OK';
    if (barVolt) barVolt.style.backgroundColor = 'var(--neon-lime)';
  } else {
    voltEl.style.color = 'var(--caribbean-bright)';
    voltSub.textContent = 'Reposo 12V OK';
    if (barVolt) barVolt.style.backgroundColor = 'var(--caribbean-bright)';
  }

  const tps = Number(activeData.tpsPct) || 0;
  const loadPct = Number(activeData.engineLoadPct) || 0;
  document.getElementById('obd-tps-val').innerHTML = `${tps} <small>%</small>`;
  document.getElementById('obd-load-status').textContent = `Esfuerzo: ${loadPct}%`;
  const barTps = document.getElementById('obd-bar-tps');
  if (barTps) barTps.style.width = `${tps}%`;

  const instKmL = Number(activeData.instKmPerL) || 0;
  const instKmGal = Number(activeData.instKmPerGal) || 0;
  const econEl = document.getElementById('obd-inst-econ');
  const econSub = document.getElementById('obd-inst-gal-sub');
  const barEcon = document.getElementById('obd-bar-econ');

  if (instKmL > 0) {
    econEl.innerHTML = `${instKmL.toFixed(1)} <small>km/L</small>`;
    econSub.textContent = `${instKmGal.toFixed(0)} km/gal en vivo`;
    const econPct = Math.min(100, Math.round((instKmL / 50) * 100));
    if (barEcon) barEcon.style.width = `${econPct}%`;
  } else {
    econEl.innerHTML = `-- <small>km/L</small>`;
    econSub.textContent = `Media: ${tele.avgKmPerGal.toFixed(0)} km/gal`;
    if (barEcon) barEcon.style.width = `0%`;
  }

  document.getElementById('obd-micro-load').textContent = `${loadPct}%`;
  document.getElementById('obd-micro-map').textContent = `${activeData.mapKpa || '--'} kPa`;
  document.getElementById('obd-micro-alt').textContent = `Alt: ~${(activeData.estimatedAltM || 0).toLocaleString('es-PE')} msnm`;
  document.getElementById('obd-micro-iat').textContent = `${activeData.iatC || '--'} °C`;
  document.getElementById('obd-micro-timing').textContent = `${activeData.timingAdvDeg || 0}°`;
  document.getElementById('obd-micro-o2').textContent = `${Number(activeData.o2Volt || 0).toFixed(2)} V`;

  const stft = Number(activeData.stftPct) || 0;
  const stftSign = stft > 0 ? '+' : '';
  document.getElementById('obd-micro-stft').textContent = `STFT: ${stftSign}${stft.toFixed(1)}%`;

  const totalSec = Math.floor(Number(activeData.runTimeSec) || 0);
  const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const secs = String(totalSec % 60).padStart(2, '0');
  document.getElementById('obd-micro-runtime').textContent = `${mins}:${secs}`;

  const dtcSummary = document.getElementById('obd-dtc-summary');
  const dtcListEl = document.getElementById('obd-dtc-list');
  const btnClearDtc = document.getElementById('btn-obd-clear-dtc');
  const codes = Array.isArray(activeData.dtcCodes) ? activeData.dtcCodes : [];

  if (codes.length === 0) {
    dtcSummary.textContent = activeData.lastDtcScan
      ? `✅ 0 Fallas en ECU (Escaneado ${activeData.lastDtcScan})`
      : '✅ 0 Códigos de falla detectados en la ECU';
    dtcSummary.style.color = 'var(--neon-lime)';
    dtcListEl.classList.add('hidden');
    dtcListEl.innerHTML = '';
    if (btnClearDtc) btnClearDtc.classList.add('hidden');
  } else {
    dtcSummary.textContent = `⚠️ ${codes.length} Falla(s) activa(s) en Check Engine`;
    dtcSummary.style.color = 'var(--red-danger)';
    dtcListEl.classList.remove('hidden');
    if (btnClearDtc) btnClearDtc.classList.remove('hidden');

    dtcListEl.innerHTML = codes
      .map((code) => {
        const desc = BAJAJ_DTC_DICTIONARY[code] || 'Código de falla registrado en módulo de inyección Bosch/Bajaj';
        return `<div class="obd-dtc-item"><span class="obd-dtc-code">${escapeHTML(code)}</span><span style="color:#FFFFFF;flex:1;">${escapeHTML(desc)}</span></div>`;
      })
      .join('');
  }

  if (activeData.elecTest) {
    const et = activeData.elecTest;
    const btnStartEt = document.getElementById('btn-start-elec-test');
    const etTitle = document.getElementById('elec-test-title');
    const etDetail = document.getElementById('elec-test-detail');
    const etRest = document.getElementById('et-val-rest');
    const etCrank = document.getElementById('et-val-crank');
    const etCharge = document.getElementById('et-val-charge');

    if (btnStartEt) {
      btnStartEt.textContent = et.active ? `⏳ ${et.remainingSec}s...` : '⚡ Test 15s';
      btnStartEt.disabled = et.active;
    }
    if (etRest) etRest.textContent = et.restingVolt > 0 ? `${et.restingVolt.toFixed(2)} V` : '-- V';
    if (etCrank) etCrank.textContent = et.crankingMinVolt < 90 ? `${et.crankingMinVolt.toFixed(2)} V` : '-- V';
    if (etCharge) etCharge.textContent = et.chargingAvgVolt > 0 ? `${et.chargingAvgVolt.toFixed(2)} V` : '-- V';

    if (etTitle && et.verdictTitle) {
      etTitle.textContent = et.verdictTitle;
      etTitle.style.color =
        et.verdictStatus === 'danger'
          ? 'var(--red-danger)'
          : et.verdictStatus === 'warn'
          ? 'var(--amber-warn)'
          : 'var(--neon-lime)';
    }
    if (etDetail && et.verdictDetail) {
      etDetail.textContent = et.verdictDetail;
    }
  }
}
