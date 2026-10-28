import { TANK_CAPACITY_GAL, MAINT_RULES, TECHNICAL_GUIDES, DEFAULT_TIRES, ROUTE_PRESETS, DEFAULT_ORIGIN_COORDS } from './constants.js';
import { BAJAJ_DTC_DICTIONARY } from './obd.js';
import { appState, escapeHTML, playN160IgnitionSound } from './state.js';
import {
  isWithinPeriod,
  getDaysElapsed,
  getMonthsElapsed,
  getLastServiceRecord,
  computeMaintMemoryMap,
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
  activeRoutePresetId: 'samne',
  customRoute: (function () {
    try {
      const saved = localStorage.getItem('mi_moto_last_sat_route_v1');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return { ...ROUTE_PRESETS[0] };
  })(),
  courseUpMode: true,
  currentBearingDeg: 0,
  mapZoomScale: 1.0,
  gpsWatchId: null,
  liveGpsLat: null,
  liveGpsLon: null,
  liveGpsAlt: null,
  liveGpsSpeedKmh: null
};

// ================= GESTOR NATIVO DE MODALES (CON SOPORTE PARA TRANSICIÓN LIMPIA) =================
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
  text.textContent = message;
  toast.classList.remove('hidden');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2600);
}

// Permite abrir el modal de confirmación encima o reemplazando a otro modal sin que history.back() lo cierre
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

// Semáforo Ordenado por Urgencia + Calculadora de Días Restantes (Aceite/Tiempo) + Barra 0% Limpia
export function renderMaintenanceCards() {
  const grid = document.getElementById('maint-alerts-grid');
  grid.innerHTML = '';

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

    const lastDateStr = appState.lastServiceDate?.[rule.id] || appState.firstUseDate || '';
    let daysLeft = null;
    let timeRatio = 0;

    if (rule.intervalMonths && lastDateStr) {
      const totalAllowedDays = Math.round(rule.intervalMonths * 30.44);
      const elapsedDays = getDaysElapsed(lastDateStr);
      daysLeft = totalAllowedDays - elapsedDays;
      timeRatio = elapsedDays / totalAllowedDays;
    }

    const effectiveRatio = Math.max(kmRatio, timeRatio);
    const pct = kmRecorridos === 0 && timeRatio < 0.03 ? 0 : Math.min(100, Math.round(effectiveRatio * 100));

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
    } else if (effectiveRatio >= 0.85) {
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

    const calBtnHtml = showCalBtn
      ? `<button type="button" class="btn-cal-ics" data-cal-maint="${escapeHTML(rule.title)}" data-cal-targetkm="${nextTargetKm}" data-cal-daysleft="${daysLeft !== null ? daysLeft : ''}">📅 Agendar</button>`
      : '';

    const fillStyle =
      pct <= 0
        ? 'width: 0%; opacity: 0; background: transparent;'
        : `width: ${pct}%; background: ${barColor};`;

    evaluatedCards.push({
      urgencyWeight,
      effectiveRatio,
      originalIdx,
      html: `
        <div class="maint-top">
          <div>
            <div class="title-with-info">
              <span class="maint-title">${rule.title}</span>
              <button type="button" class="btn-info-dot" data-info-key="${rule.infoKey}">ⓘ</button>
            </div>
            <div class="maint-sub">${rule.subtitle}${lastPriceHint}</div>
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

  // Ordenar: Primero VENCIDOS (2), luego PRÓXIMOS (1), luego mayor porcentaje de desgaste
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

  sortedDesc.forEach((item) => {
    const mInfo = memMap[item.id];
    const badges = [];

    const parts = Number(item.partsCost ?? item.cost) || 0;
    const labor = Number(item.laborCost) || 0;
    if (item.workshop) {
      badges.push(`<span class="tele-chip">🏪 ${escapeHTML(item.workshop)}</span>`);
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
    const kmRestantes = Math.max(0, lifeKm - kmRodados);
    const wearRatio = kmRodados / lifeKm;
    const lifeRemainingPct = Math.max(0, Math.min(100, Math.round((1 - wearRatio) * 100)));

    const dotInfo = parseDotCode(tire.dot);
    let statusClass = 'status-ok';
    let statusText = `${lifeRemainingPct}% VIDA`;
    let barColor = 'var(--neon-lime)';

    if (wearRatio >= 1 || dotInfo.isOld) {
      statusClass = 'status-danger';
      statusText = dotInfo.isOld ? 'CAUCHO >4 AÑOS' : 'CAMBIAR YA';
      barColor = 'var(--red-danger)';
    } else if (wearRatio >= 0.85) {
      statusClass = 'status-warn';
      statusText = `DESGASTE (${lifeRemainingPct}%)`;
      barColor = 'var(--amber-warn)';
    }

    const monthsLeft = Math.max(1, Math.round(kmRestantes / Math.max(200, monthlyRate)));
    const projText = kmRestantes > 0 ? `~${monthsLeft} mes(es)` : 'Límite TWI';
    const psiLabel = posKey === 'front' ? 'DELANTERA (25 PSI)' : 'TRASERA (28 / 32 PSI)';

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
          </div>
        </div>
        <div class="maint-top-right">
          <button class="btn-quick-done" data-edit-tire="${posKey}">⚙️ Cambiar / Editar</button>
          <span class="status-pill ${statusClass}">${statusText}</span>
        </div>
      </div>

      <div class="progress-track" style="margin-top:9px;">
        <div class="progress-fill" style="width: ${lifeRemainingPct}%; background: ${barColor};"></div>
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
          <span>PROYECCIÓN CAMBIO</span>
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

  document.getElementById('seg-fuel').style.width = `${Math.max(2, fin.shares.fuelPct)}%`;
  document.getElementById('seg-maint').style.width = `${Math.max(2, fin.shares.maintPct + fin.shares.spaPct)}%`;
  document.getElementById('seg-garage').style.width = `${Math.max(2, fin.shares.garagePct)}%`;
  document.getElementById('seg-admin').style.width = `${Math.max(2, fin.shares.adminPct)}%`;

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

export function renderElevationProfileSVG(elevArray, progressRatio = 0.25) {
  const wrap = document.getElementById('map-elevation-svg-wrap');
  if (!wrap || !Array.isArray(elevArray) || elevArray.length < 2) return;

  const w = 165, h = 42, padLeft = 24, padRight = 6, padY = 5;
  const minE = Math.min(...elevArray);
  const maxE = Math.max(...elevArray, minE + 150);
  const span = Math.max(100, maxE - minE);

  const pts = elevArray.map((val, idx) => {
    const x = padLeft + (idx / (elevArray.length - 1)) * (w - padLeft - padRight);
    const y = h - padY - ((val - minE) / span) * (h - padY * 2);
    return { x, y, val };
  });

  const polyStr = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaStr = `${pts[0].x.toFixed(1)},${h - 2} ${polyStr} ${pts[pts.length - 1].x.toFixed(1)},${h - 2}`;

  const clampedProg = Math.max(0, Math.min(1, progressRatio));
  const targetFloatIdx = clampedProg * (pts.length - 1);
  const lowIdx = Math.floor(targetFloatIdx);
  const highIdx = Math.min(pts.length - 1, Math.ceil(targetFloatIdx));
  const frac = targetFloatIdx - lowIdx;

  const dotX = pts[lowIdx].x + (pts[highIdx].x - pts[lowIdx].x) * frac;
  const dotY = pts[lowIdx].y + (pts[highIdx].y - pts[lowIdx].y) * frac;

  const midE = Math.round((minE + maxE) / 2);

  wrap.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="none">
      <defs>
        <linearGradient id="elevFillGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#58E800" stop-opacity="0.42"/>
          <stop offset="100%" stop-color="#58E800" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <!-- Guías horizontales y escala altitudinal estilo Machine Outdoors -->
      <line x1="${padLeft}" y1="${padY}" x2="${w - padRight}" y2="${padY}" stroke="rgba(210,218,228,0.12)" stroke-dasharray="2 2" stroke-width="0.8"/>
      <line x1="${padLeft}" y1="${(h / 2).toFixed(1)}" x2="${w - padRight}" y2="${(h / 2).toFixed(1)}" stroke="rgba(210,218,228,0.10)" stroke-dasharray="2 2" stroke-width="0.8"/>
      <line x1="${padLeft}" y1="${h - padY}" x2="${w - padRight}" y2="${h - padY}" stroke="rgba(210,218,228,0.12)" stroke-width="0.8"/>
      <text x="1" y="${padY + 3}" fill="#7C8B9E" font-size="6.8" font-weight="700">${Math.round(maxE)}</text>
      <text x="1" y="${(h / 2 + 2).toFixed(1)}" fill="#7C8B9E" font-size="6.8" font-weight="700">${midE}</text>
      <text x="1" y="${h - 2}" fill="#7C8B9E" font-size="6.8" font-weight="700">${Math.round(minE)}</text>

      <polygon points="${areaStr}" fill="url(#elevFillGrad)" />
      <polyline fill="none" stroke="#58E800" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${polyStr}" />
      <circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="4.8" fill="rgba(88,232,0,0.35)" />
      <circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="2.8" fill="#FFFFFF" stroke="#58E800" stroke-width="1.5" />
    </svg>
  `;
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


let radarInnerRing = null;
let radarOuterRing = null;

// Calcula el rumbo azimutal (0° a 360°) desde el punto A (Moto) hacia el punto B (Destino)
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

export function applyMapOrientationRotation(origLat, origLon, destLat, destLon) {
  const mapEl = document.getElementById('leaflet-sat-map');
  const needleEl = document.getElementById('map-compass-needle');
  const degTxtEl = document.getElementById('map-bearing-deg-txt');

  const bearing = calculateBearingDeg(origLat, origLon, destLat, destLon);
  uiConfig.currentBearingDeg = bearing;

  // Sin rotación CSS del contenedor para que el arrastre táctil con los dedos sea 100% natural (derecha = derecha, arriba = arriba)
  if (mapEl) {
    mapEl.style.setProperty('--bike-pin-rot', `${bearing.toFixed(1)}deg`);
  }

  if (needleEl) {
    needleEl.style.transform = `rotate(${bearing.toFixed(1)}deg)`;
  }

  if (degTxtEl) {
    degTxtEl.textContent = `Rumbo ${Math.round(bearing)}° ${getCardinalLabel(bearing)}`;
  }
}

export function toggleCourseUpMode() {
  recenterLeafletRoute();
  return true;
}

export function refreshLeafletSize() {
  if (leafletMap) {
    [60, 220, 450].forEach((ms) => {
      setTimeout(() => {
        leafletMap.invalidateSize({ animate: false });
        if (routeNeonPolyline && currentRoadLatLngs.length >= 2) {
          leafletMap.fitBounds(routeNeonPolyline.getBounds(), { padding: [28, 28] });
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
    zoom: 11,
    zoomControl: false,
    attributionControl: true
  });

  // Capa 1: Imagen Satelital HD Esri World Imagery
  satTileLayer = window.L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 18,
      attribution: 'Satélite © Esri'
    }
  );

  // Superposición de nombres limpios de localidades y rutas (Sin marca de agua de API key)
  labelsTileLayer = window.L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
    {
      maxZoom: 19,
      subdomains: 'abcd',
      opacity: 0.9
    }
  );

  // Capa 2: Mapa de Calles y Carreteras OpenStreetMap
  streetTileLayer = window.L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }
  );

  satTileLayer.addTo(leafletMap);
  labelsTileLayer.addTo(leafletMap);

  // Observador automático de tamaño: cada vez que cambie el contenedor (Vertical <-> Horizontal o Modo Timón), centra el mapa al instante
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (leafletMap) {
        leafletMap.invalidateSize({ animate: false });
      }
    });
    ro.observe(container);
  }

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
    leafletMap.fitBounds(routeNeonPolyline.getBounds(), { padding: [24, 24] });
  } else {
    const origLat = uiConfig.liveGpsLat ?? DEFAULT_ORIGIN_COORDS.lat;
    const origLon = uiConfig.liveGpsLon ?? DEFAULT_ORIGIN_COORDS.lon;
    leafletMap.setView([origLat, origLon], 11);
  }
}

// Busca cualquier pueblo, ciudad, mirador o dirección usando OpenStreetMap Nominatim
export async function searchPlaceByName(query) {
  const clean = String(query || '').trim();
  if (!clean) return [];

  const urlPe = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&countrycodes=pe&q=${encodeURIComponent(clean)}`;
  const res = await fetch(urlPe, { headers: { 'Accept-Language': 'es' } });
  let data = await res.json();

  if (!Array.isArray(data) || data.length === 0) {
    const urlGlobal = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(clean)}`;
    const resG = await fetch(urlGlobal, { headers: { 'Accept-Language': 'es' } });
    data = await resG.json();
  }

  return (Array.isArray(data) ? data : []).map((item) => {
    const parts = String(item.display_name || '').split(',').map((s) => s.trim());
    const shortName = parts[0] || clean;
    const region = parts.slice(1, 3).join(' • ') || 'Ruta Satelital N160';
    return {
      name: shortName,
      region,
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon)
    };
  });
}

// Calcula la carretera real con OSRM y extrae los metros sobre el nivel del mar (msnm) reales con Open-Meteo DEM
export async function calculateRealRouteAndElevation({ destLat, destLon, name, region }) {
  const statusTag = document.getElementById('map-route-status-tag');
  if (statusTag) statusTag.textContent = '🔄 CALCULANDO CARRETERA Y ALTITUD...';

  const origLat = uiConfig.liveGpsLat ?? DEFAULT_ORIGIN_COORDS.lat;
  const origLon = uiConfig.liveGpsLon ?? DEFAULT_ORIGIN_COORDS.lon;

  let distKm = 40;
  let estMin = 50;
  let roadLatLngs = [
    [origLat, origLon],
    [destLat, destLon]
  ];

  try {
    // 1. Trazado vial real por carretera (OSRM)
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
    // Si está sin internet, calcula distancia lineal con factor de curva 1.28x
    const R = 6371;
    const dLat = ((destLat - origLat) * Math.PI) / 180;
    const dLon = ((destLon - origLon) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((origLat * Math.PI) / 180) * Math.cos((destLat * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    distKm = Number((R * c * 1.28).toFixed(1));
    estMin = Math.max(5, Math.round(distKm * 1.25));
  }

  // 2. Muestrear 10 puntos a lo largo de la carretera para obtener la curva real de Elevación (msnm)
  let elevProfile = [34, 250, 680, 1100, 1450];
  let startAlt = 34;
  let peakAlt = 1450;

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
  } catch (e) {
    // Mantiene el perfil estimado si no hay conexión
  }

  // 3. Ajustar automáticamente el factor de consumo de Inyección FI según la altitud máxima real de la ruta
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

  uiConfig.customRoute = {
    id: 'live',
    name: name || 'Destino Seleccionado',
    region: region || `Ruta Real OSRM • Cima ${peakAlt.toLocaleString('es-PE')} msnm`,
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
  if (statusTag) statusTag.textContent = '🛰️ RUTA SATELITAL & ELEVACIÓN REAL';
  renderTacticalMapUI(null, true);
}

export function renderTacticalMapUI(ecuData, fitMapBounds = false) {
  // Actualizar Reloj en Vivo y Barra de Estado Superior de Machine Outdoors
  const clockEl = document.getElementById('mo-live-clock');
  if (clockEl) {
    clockEl.textContent = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const topTempEl = document.getElementById('mo-top-temp-txt');
  if (topTempEl) {
    const iatOrMotor = ecuData?.connected && ecuData?.iatC > 0 ? ecuData.iatC : 24;
    topTempEl.textContent = `${iatOrMotor}°C`;
  }
  const connBarFill = document.getElementById('mo-conn-bar-fill');
  if (connBarFill) {
    connBarFill.style.background = ecuData?.connected ? '#58E800' : '#49BFE6';
    connBarFill.style.width = ecuData?.connected ? '100%' : '35%';
  }

  const route = uiConfig.customRoute || ROUTE_PRESETS[0];
  const tele = computeFuelTelemetry();

  // Cálculo de combustible actual y alcance seguro
  const fullCapacityKm = Math.round(tele.avgKmPerGal * TANK_CAPACITY_GAL);
  const lastFuelSorted = [...appState.fuelLogs].sort((a, b) => Number(b.km) - Number(a.km) || b.id - a.id);
  const lastRefuelKm = lastFuelSorted.length > 0 ? Number(lastFuelSorted[0].km) : Number(appState.initialKm || 0);
  const sessKm = Number(ecuData?.sessionKm) || 0;
  const kmSinceRefuel = Math.max(0, (Number(appState.currentKm) + sessKm) - lastRefuelKm);
  const remKm = Math.max(0, fullCapacityKm - Math.round(kmSinceRefuel));
  const tankPct = Math.max(5, Math.min(100, Math.round((remKm / Math.max(1, fullCapacityKm)) * 100)));

  // Progreso a lo largo de la ruta según distancia recorrida en la sesión (o animación suave en modo Demo)
  let progressRatio = route.distKm > 0 ? Math.min(1, sessKm / route.distKm) : 0;
  if (ecuData?.mode === 'sim') {
    progressRatio = ((Date.now() / 1000) % 25) / 25;
  }

  const remDistKm = Math.max(0, route.distKm * (1 - progressRatio));
  const remMin = Math.max(1, Math.round(route.estMin * (1 - progressRatio)));

  // Hora Estimada de Llegada (ETA)
  const etaDate = new Date(Date.now() + remMin * 60000);
  const etaStr = etaDate.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });

  // Galones y Soles requeridos para llegar al destino considerando el factor topográfico
  const effKmGal = tele.avgKmPerGal / (route.terrainFactor || 1.0);
  const neededGal = effKmGal > 0 ? route.distKm / effKmGal : 0;
  const neededSoles = route.distKm * tele.avgCostPerKm * (route.terrainFactor || 1.0);

  // Barra Superior de Destino
  const titleEl = document.getElementById('map-dest-title');
  if (titleEl) {
    titleEl.textContent = route.name;
    document.getElementById('map-dest-region').textContent = route.region;
    document.getElementById('map-dest-dist').textContent = `${remDistKm.toFixed(1)} km`;
    document.getElementById('map-dest-time').textContent = `${remMin} min`;
  }

  // Actualizar Mapa Satelital Leaflet si está visible
  const mapPanel = document.getElementById('obd-map-panel');
  if (mapPanel && !mapPanel.classList.contains('hidden') && typeof window.L !== 'undefined') {
    if (!leafletMap) {
      initLeafletSatelliteMap((clickedLat, clickedLon) => {
        calculateRealRouteAndElevation({
          destLat: clickedLat,
          destLon: clickedLon,
          name: `Punto Táctico (${clickedLat.toFixed(3)}, ${clickedLon.toFixed(3)})`,
          region: 'Coordenada marcada en Mapa Satelital'
        });
      });
    }

    if (leafletMap) {
      const origLat = uiConfig.liveGpsLat ?? DEFAULT_ORIGIN_COORDS.lat;
      const origLon = uiConfig.liveGpsLon ?? DEFAULT_ORIGIN_COORDS.lon;
      const destLat = route.lat ?? -8.0150;
      const destLon = route.lon ?? -78.8500;
      applyMapOrientationRotation(origLat, origLon, destLat, destLon);

      const polyCoords =
        currentRoadLatLngs && currentRoadLatLngs.length >= 2
          ? currentRoadLatLngs
          : [
              [origLat, origLon],
              [destLat, destLon]
            ];

      // Posición interpolada de la moto a lo largo de los puntos reales de la carretera
      const targetIdx = Math.min(polyCoords.length - 1, Math.floor(progressRatio * (polyCoords.length - 1)));
      const bikeLatLng = uiConfig.gpsWatchId !== null && uiConfig.liveGpsLat !== null
        ? [uiConfig.liveGpsLat, uiConfig.liveGpsLon]
        : polyCoords[targetIdx];

      if (!routeShadowPolyline) {
        routeShadowPolyline = window.L.polyline(polyCoords, {
          color: '#05090F',
          weight: 8,
          opacity: 0.75
        }).addTo(leafletMap);
      } else {
        routeShadowPolyline.setLatLngs(polyCoords);
      }

      if (!routeNeonPolyline) {
        routeNeonPolyline = window.L.polyline(polyCoords, {
          color: '#58E800',
          weight: 4,
          opacity: 1.0
        }).addTo(leafletMap);
      } else {
        routeNeonPolyline.setLatLngs(polyCoords);
      }

      // 3 Anillos Concéntricos de Radar Estilo "Machine Outdoors" centrados en la Moto
      const routeSpanMeters = Math.max(3000, (route.distKm || 20) * 1000);
      const rInner = Math.round(routeSpanMeters * 0.33);
      const rMid = Math.round(routeSpanMeters * 0.68);
      const rOuter = Math.round(routeSpanMeters * 1.05);
      const ringColor = remKm >= route.distKm * 2 ? '#58E800' : (remKm >= route.distKm ? '#FF9F0A' : '#FF453A');

      if (!radarInnerRing) {
        radarInnerRing = window.L.circle(bikeLatLng, {
          radius: rInner,
          color: ringColor,
          weight: 1,
          dashArray: '4, 6',
          fillOpacity: 0
        }).addTo(leafletMap);
      } else {
        radarInnerRing.setLatLng(bikeLatLng);
        radarInnerRing.setRadius(rInner);
        radarInnerRing.setStyle({ color: ringColor });
      }

      if (!safeRangeCircle) {
        safeRangeCircle = window.L.circle(bikeLatLng, {
          radius: rMid,
          color: ringColor,
          weight: 1.6,
          dashArray: '6, 5',
          fillColor: ringColor,
          fillOpacity: 0.09
        }).addTo(leafletMap);
      } else {
        safeRangeCircle.setLatLng(bikeLatLng);
        safeRangeCircle.setRadius(rMid);
        safeRangeCircle.setStyle({ color: ringColor, fillColor: ringColor });
      }

      if (!radarOuterRing) {
        radarOuterRing = window.L.circle(bikeLatLng, {
          radius: rOuter,
          color: '#49BFE6',
          weight: 1,
          dashArray: '3, 7',
          fillOpacity: 0
        }).addTo(leafletMap);
      } else {
        radarOuterRing.setLatLng(bikeLatLng);
        radarOuterRing.setRadius(rOuter);
      }

      // Marcadores de Moto (Azul) y Meta (Bandera 🏁)
      const bikeIcon = window.L.divIcon({
        className: '',
        html: `<div class="n160-bike-pin" title="Mi Pulsar N160">▲</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const destIcon = window.L.divIcon({
        className: '',
        html: `<div class="n160-dest-pin" title="${escapeHTML(route.name)}">🏁</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      if (!bikeLeafletMarker) {
        bikeLeafletMarker = window.L.marker(bikeLatLng, { icon: bikeIcon }).addTo(leafletMap);
      } else {
        bikeLeafletMarker.setLatLng(bikeLatLng);
      }

      const endCoord = polyCoords[polyCoords.length - 1];
      if (!destLeafletMarker) {
        destLeafletMarker = window.L.marker(endCoord, { icon: destIcon }).addTo(leafletMap);
      } else {
        destLeafletMarker.setLatLng(endCoord);
      }

      if (fitMapBounds && routeNeonPolyline) {
        refreshLeafletSize();
      }
    }
  }

  // Columna Derecha: Velocidad Actual (ECU o GPS), Consumo Promedio, Autonomía y Elevación
  const liveSpd = Number(ecuData?.speedKmh) || Number(uiConfig.liveGpsSpeedKmh) || 0;
  const spdEl = document.getElementById('map-live-speed');
  const spdBar = document.getElementById('map-live-speed-bar');
  const spdArc = document.getElementById('map-live-speed-arc');
  const spdPct = Math.min(100, Math.round((liveSpd / 130) * 100));
  if (spdEl) spdEl.textContent = Math.round(liveSpd);
  if (spdBar) spdBar.style.width = `${spdPct}%`;
  if (spdArc) spdArc.setAttribute('stroke-dashoffset', String(100 - spdPct));

  const avgKmL = tele.avgKmPerGal / 3.78541;
  const kmlEl = document.getElementById('map-avg-kml');
  const kmgalEl = document.getElementById('map-avg-kmgal');
  if (kmlEl) kmlEl.innerHTML = `${avgKmL.toFixed(1)} <small>km/L</small>`;
  if (kmgalEl) kmgalEl.textContent = `${tele.avgKmPerGal.toFixed(1)} km/gal • Histórico FI`;

  const safeRangeEl = document.getElementById('map-safe-range');
  const safeBarEl = document.getElementById('map-safe-bar');
  const safePctEl = document.getElementById('map-safe-pct');
  if (safeRangeEl) safeRangeEl.innerHTML = `⛽ ~${remKm} <small>km</small>`;
  if (safeBarEl) safeBarEl.style.width = `${tankPct}%`;
  if (safePctEl) {
    const canRoundTrip = remKm >= route.distKm * 2;
    safePctEl.textContent = canRoundTrip ? `${tankPct}% • Alcanza Ida y Vuelta ✓` : `${tankPct}% • Abastecer en ruta`;
  }

  // Altitud Actual (Prioriza GPS real -> Sensor Barométrico MAP ECU -> Interpolación del perfil DEM real)
  const elevArr = Array.isArray(route.elevProfile) && route.elevProfile.length >= 2 ? route.elevProfile : [34, 450, 950, 1450];
  const floatIdx = progressRatio * (elevArr.length - 1);
  const interpAlt = Math.round(
    elevArr[Math.floor(floatIdx)] +
      (elevArr[Math.min(elevArr.length - 1, Math.ceil(floatIdx))] - elevArr[Math.floor(floatIdx)]) * (floatIdx - Math.floor(floatIdx))
  );

  const currentAlt =
    uiConfig.liveGpsAlt !== null
      ? Math.round(uiConfig.liveGpsAlt)
      : (ecuData?.connected && ecuData?.estimatedAltM > 0 ? ecuData.estimatedAltM : interpAlt);

  const elevEl = document.getElementById('map-current-elev');
  if (elevEl) elevEl.innerHTML = `${currentAlt.toLocaleString('es-PE')} <small>m</small>`;

  renderElevationProfileSVG(elevArr, progressRatio);

  // Barra Inferior de 4 Columnas
  const botRange = document.getElementById('map-bot-range');
  if (botRange) {
    botRange.textContent = `~${remKm} km`;
    document.getElementById('map-bot-fuel-bar').style.width = `${tankPct}%`;
    document.getElementById('map-bot-fuel-txt').textContent = `${tankPct}% Combustible actual`;
    document.getElementById('map-bot-dist').textContent = `${remDistKm.toFixed(1)} km`;
    document.getElementById('map-bot-eta').textContent = `${remMin} min • ETA ${etaStr}`;
    document.getElementById('map-bot-needgal').textContent = `Req: ${neededGal.toFixed(2)} gal (S/ ${neededSoles.toFixed(2)})`;
    document.getElementById('map-bot-routename').textContent = route.name;
    const extraPct = Math.round(((route.terrainFactor || 1) - 1) * 100);
    document.getElementById('map-bot-terrain').textContent = extraPct > 0 ? `Ascenso (+${extraPct}% FI)` : 'Costa / Plano (0%)';
    document.getElementById('map-bot-diff').textContent = route.difficulty || 'Media';

    const lat = uiConfig.liveGpsLat ?? route.lat ?? -8.1116;
    const lon = uiConfig.liveGpsLon ?? route.lon ?? -79.0287;
    document.getElementById('map-bot-coords').innerHTML = formatDmsCoord(lat, lon);
    document.getElementById('map-bot-gps-status').textContent =
      uiConfig.gpsWatchId !== null ? '🛰️ GPS Satelital Activo' : '🛰️ Satélite Esri + OSRM';
    document.getElementById('map-bot-peak-alt').textContent = `Cima: ${Number(route.peakAlt || 0).toLocaleString('es-PE')} msnm`;
  }
}

export function renderObdLiveUI(data) {
  renderTacticalMapUI(data);
  const card = document.getElementById('obd-cockpit-card');
  const panel = document.getElementById('obd-live-panel');
  const statusPill = document.getElementById('obd-live-status');
  const btnConnect = document.getElementById('btn-obd-connect');
  const btnSim = document.getElementById('btn-obd-sim');

  if (!card || !panel) return;

  // Actualizar siempre el pie de tanque y odómetro con la telemetría histórica de Mi Moto
  const tele = computeFuelTelemetry();
  const fullCapacityKm = Math.round(tele.avgKmPerGal * TANK_CAPACITY_GAL);
  const lastFuelSorted = [...appState.fuelLogs].sort((a, b) => Number(b.km) - Number(a.km) || b.id - a.id);
  const lastRefuelKm = lastFuelSorted.length > 0 ? Number(lastFuelSorted[0].km) : Number(appState.initialKm || 0);
  const sessKm = Number(data?.sessionKm) || 0;
  const kmSinceRefuel = Math.max(0, (Number(appState.currentKm) + sessKm) - lastRefuelKm);
  const remKm = Math.max(0, fullCapacityKm - Math.round(kmSinceRefuel));
  const tankPct = Math.max(5, Math.min(100, Math.round((remKm / Math.max(1, fullCapacityKm)) * 100)));

  const footerFuelPct = document.getElementById('obd-footer-fuel-pct');
  const footerRange = document.getElementById('obd-footer-range');
  const footerOdo = document.getElementById('obd-footer-odo');
  const barTank = document.getElementById('obd-bar-tank');

  if (footerFuelPct) footerFuelPct.textContent = `~${tankPct}%`;
  if (footerRange) footerRange.textContent = `~${remKm} km`;
  if (footerOdo) footerOdo.textContent = `${Math.round(Number(appState.currentKm) + sessKm).toLocaleString('es-PE')} km`;
  if (barTank) {
    barTank.style.width = `${tankPct}%`;
    barTank.style.backgroundColor = tankPct <= 20 ? 'var(--red-danger)' : (tankPct <= 35 ? 'var(--amber-warn)' : 'var(--neon-lime)');
  }

  if (!data || !data.connected) {
    card.classList.remove('obd-active', 'obd-shift-alert');
    statusPill.textContent = 'OFFLINE';
    statusPill.className = 'status-pill status-ok';
    if (btnConnect) btnConnect.textContent = '⚡ Conectar';
    if (btnSim) btnSim.textContent = 'Demo';
    document.getElementById('obd-speed-val').textContent = '0';
    document.getElementById('obd-gear-val').textContent = 'N';
    document.getElementById('obd-rpm-val').textContent = '0';
    document.getElementById('obd-rpm-bar').style.width = '0%';
    const rpmArcOff = document.getElementById('obd-rpm-arc');
    const spdArcOff = document.getElementById('obd-speed-arc');
    if (rpmArcOff) rpmArcOff.setAttribute('stroke-dashoffset', '100');
    if (spdArcOff) spdArcOff.setAttribute('stroke-dashoffset', '100');
    return;
  }

  card.classList.add('obd-active');

  if (data.mode === 'sim') {
    statusPill.textContent = 'DEMO ACTIVO';
    statusPill.className = 'status-pill status-warn';
    if (btnSim) btnSim.textContent = '⏹ Salir Demo';
    if (btnConnect) btnConnect.textContent = '⚡ Conectar';
  } else {
    statusPill.textContent = 'CONECTADO';
    statusPill.className = 'status-pill status-ok';
    if (btnConnect) btnConnect.textContent = '⏹ Cortar';
    if (btnSim) btnSim.textContent = 'Demo';
  }

  // NIVEL 1: Relojes Circulares Machine Outdoors (RPM, Marcha, Velocidad)
  const rpm = Number(data.rpm) || 0;
  const peakRpm = Number(data.peakRpm) || 0;
  const spd = Number(data.speedKmh) || 0;
  const peakSpd = Number(data.peakSpeed) || 0;
  const gear = data.gear || 'N';

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

  // NIVEL 2: 4 Tarjetas de Signos Vitales con Mini-Barras C-H / L-H
  const tempC = Number(data.tempC) || 0;
  const tempEl = document.getElementById('obd-temp-val');
  const tempSub = document.getElementById('obd-temp-status');
  const barTemp = document.getElementById('obd-bar-temp');
  tempEl.innerHTML = `${tempC} <small>°C</small>`;

  const tempPct = Math.max(5, Math.min(100, Math.round(((tempC - 20) / 95) * 100)));
  if (barTemp) barTemp.style.width = `${tempPct}%`;

  if (tempC < 45) {
    tempSub.textContent = '❄️ Frío (Calentar)';
    tempEl.style.color = 'var(--caribbean-bright)';
    if (barTemp) barTemp.style.backgroundColor = 'var(--caribbean-bright)';
  } else if (tempC <= 95) {
    tempSub.textContent = '✅ Operativa normal';
    tempEl.style.color = 'var(--neon-lime)';
    if (barTemp) barTemp.style.backgroundColor = 'var(--neon-lime)';
  } else {
    tempSub.textContent = '🔥 Alerta térmica';
    tempEl.style.color = 'var(--red-danger)';
    if (barTemp) barTemp.style.backgroundColor = 'var(--red-danger)';
  }

  const volt = Number(data.voltage) || 0;
  const voltEl = document.getElementById('obd-volt-val');
  const voltSub = document.getElementById('obd-volt-status');
  const barVolt = document.getElementById('obd-bar-volt');
  voltEl.innerHTML = `${volt > 0 ? volt.toFixed(1) : '--'} <small>V</small>`;

  const voltPct = volt > 0 ? Math.max(5, Math.min(100, Math.round(((volt - 11.0) / 4.0) * 100))) : 0;
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

  const tps = Number(data.tpsPct) || 0;
  const loadPct = Number(data.engineLoadPct) || 0;
  document.getElementById('obd-tps-val').innerHTML = `${tps} <small>%</small>`;
  document.getElementById('obd-load-status').textContent = `Esfuerzo: ${loadPct}%`;
  const barTps = document.getElementById('obd-bar-tps');
  if (barTps) barTps.style.width = `${tps}%`;

  // Economía Instantánea (km/L & km/gal)
  const instKmL = Number(data.instKmPerL) || 0;
  const instKmGal = Number(data.instKmPerGal) || 0;
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

  // NIVEL 3: Micro-Grilla de 6 Sensores Secundarios
  document.getElementById('obd-micro-load').textContent = `${loadPct}%`;
  document.getElementById('obd-micro-map').textContent = `${data.mapKpa || '--'} kPa`;
  document.getElementById('obd-micro-alt').textContent = `Alt: ~${(data.estimatedAltM || 0).toLocaleString('es-PE')} msnm`;
  document.getElementById('obd-micro-iat').textContent = `${data.iatC || '--'} °C`;
  document.getElementById('obd-micro-timing').textContent = `${data.timingAdvDeg || 0}°`;
  document.getElementById('obd-micro-o2').textContent = `${Number(data.o2Volt || 0).toFixed(2)} V`;

  const stft = Number(data.stftPct) || 0;
  const stftSign = stft > 0 ? '+' : '';
  document.getElementById('obd-micro-stft').textContent = `STFT: ${stftSign}${stft.toFixed(1)}%`;

  const totalSec = Math.floor(Number(data.runTimeSec) || 0);
  const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const secs = String(totalSec % 60).padStart(2, '0');
  document.getElementById('obd-micro-runtime').textContent = `${mins}:${secs}`;

  const distSmall = document.getElementById('obd-micro-dist');
  const sessTxt = document.getElementById('obd-session-km-txt');
  if (distSmall) distSmall.textContent = `Ruta: +${sessKm.toFixed(2)} km`;
  if (sessTxt) sessTxt.textContent = `+${sessKm.toFixed(2)} km hoy`;

  // NIVEL 5: Diagnóstico Check Engine (DTC)
  const dtcSummary = document.getElementById('obd-dtc-summary');
  const dtcListEl = document.getElementById('obd-dtc-list');
  const btnClearDtc = document.getElementById('btn-obd-clear-dtc');
  const codes = Array.isArray(data.dtcCodes) ? data.dtcCodes : [];

  if (codes.length === 0) {
    dtcSummary.textContent = data.lastDtcScan
      ? `✅ 0 Fallas en ECU (Escaneado ${data.lastDtcScan})`
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
}
