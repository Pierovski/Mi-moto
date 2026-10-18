import { TANK_CAPACITY_GAL, MAINT_RULES, TECHNICAL_GUIDES, DEFAULT_TIRES } from './constants.js';
import { appState, escapeHTML, playN160IgnitionSound } from './state.js';
import {
  isWithinPeriod,
  getMonthsElapsed,
  getLastServiceRecord,
  computeMaintMemoryMap,
  getLastFuelPriceRecord,
  parseDotCode,
  estimateMonthlyKmRate,
  computeFuelTelemetry,
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
  routeMultiplier: 1,
  routeTerrainFactor: 1
};

// ================= GESTOR NATIVO DE MODALES (BOTÓN ATRÁS DE ANDROID) =================
export function openModalById(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;
  const wasHidden = el.classList.contains('hidden');
  el.classList.remove('hidden');
  if (wasHidden) {
    history.pushState({ modalOpen: modalId }, '');
  }
}

export function closeModalById(modalId, fromPopState = false) {
  const el = document.getElementById(modalId);
  if (!el || el.classList.contains('hidden')) return;
  el.classList.add('hidden');
  if (modalId === 'modal-confirm') {
    confirmCallback = null;
  }
  if (!fromPopState && history.state && history.state.modalOpen) {
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

export function openCustomConfirm({ title, message, confirmText = 'Confirmar', isDanger = false, icon = '⚡', onConfirm }) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-icon-badge').textContent = icon;

  const okBtn = document.getElementById('btn-confirm-ok');
  okBtn.textContent = confirmText;
  okBtn.className = isDanger ? 'btn-danger-solid' : 'btn-neon';

  confirmCallback = onConfirm;
  openModalById('modal-confirm');
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

  const docs = appState.docs || {};
  if (docs.plate && docs.plate.trim() !== '') {
    plateBadge.textContent = docs.plate.trim().toUpperCase();
    plateBadge.classList.remove('hidden');
  } else {
    plateBadge.classList.add('hidden');
  }

  const status = evaluateDocsStatus();
  alertDot.classList.toggle('hidden', !status.hasAlert);
  if (summaryEl) summaryEl.innerHTML = `<span>${status.summaryHtml}</span>`;
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

  let overdueCount = 0;
  let warnCount = 0;

  MAINT_RULES.forEach((rule) => {
    if (rule.onlyFirstTime && appState.lastServiceKm.breakin_500 !== null) return;

    const baseKm = appState.lastServiceKm[rule.id] ?? (appState.initialKm || 0);
    const kmRecorridos = Math.max(0, appState.currentKm - baseKm);
    const nextTargetKm = baseKm + rule.intervalKm;
    const kmRestantes = nextTargetKm - appState.currentKm;
    const kmRatio = kmRecorridos / rule.intervalKm;

    const lastDateStr = appState.lastServiceDate?.[rule.id] || '';
    const monthsElapsed = lastDateStr ? getMonthsElapsed(lastDateStr) : 0;
    const timeRatio = rule.intervalMonths && lastDateStr ? monthsElapsed / rule.intervalMonths : 0;

    const effectiveRatio = Math.max(kmRatio, timeRatio);
    const pct = Math.min(100, Math.round(effectiveRatio * 100));

    let statusClass = 'status-ok';
    let statusText = 'AL DÍA';
    let barColor = 'var(--neon-lime)';

    if (effectiveRatio >= 1) {
      statusClass = 'status-danger';
      statusText = timeRatio >= 1 && kmRatio < 1 ? 'VENCIDO (TIEMPO)' : 'VENCIDO';
      barColor = 'var(--red-danger)';
      overdueCount++;
    } else if (effectiveRatio >= 0.88) {
      statusClass = 'status-warn';
      statusText = 'PRÓXIMO';
      barColor = 'var(--amber-warn)';
      warnCount++;
    }

    const footerRightText =
      kmRestantes >= 0
        ? `Faltan ${kmRestantes.toLocaleString('es-PE')} km`
        : `Pasado ${Math.abs(kmRestantes).toLocaleString('es-PE')} km`;

    const prevRec = getLastServiceRecord(rule.id);
    const lastPriceHint = prevRec ? ` • Último: S/ ${Number(prevRec.cost).toFixed(0)}` : '';

    const card = document.createElement('div');
    card.className = 'maint-card';
    card.innerHTML = `
      <div class="maint-top">
        <div>
          <div class="title-with-info">
            <span class="maint-title">${rule.title}</span>
            <button type="button" class="btn-info-dot" data-info-key="${rule.infoKey}">ⓘ</button>
          </div>
          <div class="maint-sub">${rule.subtitle}${lastPriceHint}</div>
        </div>
        <div class="maint-top-right">
          <button class="btn-quick-done" data-quick-srv="${rule.id}">✓ Hecho</button>
          <span class="status-pill ${statusClass}">${statusText}</span>
        </div>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${pct}%; background: ${barColor};"></div>
      </div>
      <div class="maint-footer">
        <span>Base: ${baseKm.toLocaleString('es-PE')} km • Meta: <strong>${nextTargetKm.toLocaleString('es-PE')} km</strong></span>
        <strong>${footerRightText}</strong>
      </div>
    `;
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

  const filtered =
    uiConfig.activeMaintFilter === 'all'
      ? appState.logs
      : appState.logs.filter((l) => l.typeId === uiConfig.activeMaintFilter || (uiConfig.activeMaintFilter === 'oil_change' && l.typeId === 'breakin_500'));

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-logs">Sin servicios registrados en esta vista.</div>`;
    return;
  }

  const memMap = computeMaintMemoryMap();
  const sortedDesc = [...filtered].sort((a, b) => Number(b.km) - Number(a.km) || b.id - a.id);

  sortedDesc.forEach((item) => {
    const mInfo = memMap[item.id];
    const badges = [];

    const parts = Number(item.partsCost ?? item.cost) || 0;
    const labor = Number(item.laborCost) || 0;
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
  const budgetPct = Math.min(100, Math.round(budgetRatio * 100));

  document.getElementById('budget-limit-label').textContent = `S/ ${budgetLimit.toFixed(0)}`;
  document.getElementById('budget-pct-text').textContent = `${Math.round(budgetRatio * 100)}%`;

  const budgetFill = document.getElementById('budget-progress-fill');
  const budgetStatus = document.getElementById('budget-status-text');
  budgetFill.style.width = `${budgetPct}%`;

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
    .find((f) => f.fullTank !== false);

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

  if (appState.fuelLogs.length === 0) {
    container.innerHTML = `<div class="empty-logs">Sin cargas de combustible registradas.</div>`;
    return;
  }

  const sortedDesc = [...appState.fuelLogs].sort((a, b) => Number(b.km) - Number(a.km) || b.id - a.id);

  sortedDesc.forEach((f) => {
    const tInfo = tele.enrichedMap[f.id];
    const chips = [];

    if (tInfo && tInfo.isBase) {
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
        ${f.notes ? `<div class="log-notes">${escapeHTML(f.notes)}</div>` : ''}
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

  const fin = computeMasterFinancials();

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
