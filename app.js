import {
  isFirebaseConfigured,
  subscribeToAuthChanges,
  getCurrentUser,
  getFriendlyAuthError,
  loginPilot,
  registerPilot,
  resetPilotPassword,
  logoutPilot,
  pushStateToCloud,
  pullStateFromCloud
} from './firebase.js';
import { DEFAULT_TIRES, ROUTE_PRESETS } from './constants.js';
import {
  appState,
  loadState,
  saveState,
  replaceFullState,
  isValidBackupJson,
  recalculateServiceKmFromLogs,
  recalculateWashFromLogs,
  getLocalISODate,
  escapeHTML,
  triggerHaptic,
  compressImage,
  saveVaultDocMedia,
  getVaultDocMedia,
  deleteVaultDocMedia
} from './state.js';
import {
  getLastServiceRecord,
  getLastFuelPriceRecord,
  getRecentQuickPicks,
  getFuelPreviewBaseline,
  estimateMonthlyKmRate,
  openGoogleCalendarEvent,
  exportFinancialsToCSV
} from './telemetry.js';
import {
  uiConfig,
  openModalById,
  closeModalById,
  handlePopstateModalBack,
  resetSweepFlag,
  showToast,
  openCustomConfirm,
  closeCustomConfirm,
  executeConfirmCallback,
  openInfoGuide,
  closeInfoGuide,
  openSosModal,
  renderImages,
  checkDocsStatusUI,
  renderGarageSection,
  renderLogs,
  renderFuelSection,
  renderRouteAndTCO,
  renderObdLiveUI,
  renderTacticalMapUI,
  toggleMapBaseLayer,
  toggleCourseUpMode,
  toggleFollowLockMode,
  centerMapOnBike,
  clearActiveRouteOnMap,
  refreshLeafletSize,
  zoomLeafletMap,
  searchPlaceByName,
  searchAndPlotPoisOnMap,
  calculateRealRouteAndElevation,
  renderNightDrainUI,
  startBlackboxReplayMode,
  stopBlackboxReplayTimer,
  closeBlackboxReplayMode,
  toggleBlackboxReplayPlay,
  cycleBlackboxReplaySpeed,
  seekBlackboxReplayFrame,
  renderPriorityBanner,
  renderFavoriteRouteChips,
  renderFavoriteRoutesModalList,
  renderSprintTimerUI,
  renderAllMain
} from './ui.js';
import {
  liveEcuData,
  connectKonnweiBle,
  scanEcuDtcCodes,
  clearEcuDtcCodes,
  startSimulatorMode,
  stopEcuTelemetry,
  resetSessionDistance,
  feedGpsDistanceSample,
  startElectricalHealthTest,
  toggleBlackboxRecording,
  exportBlackboxFile,
  registerGpsProviderForBlackbox,
  registerSprintRecordCallback,
  registerSprintTickCallback,
  armSprintTimer,
  cancelSprintTimer,
  updateAltitudeDeltaCheck,
  acknowledgeMapReset
} from './obd.js';

let editingLogId = null;
let selectedServiceType = 'breakin_500';
let selectedServiceTitle = '1er Servicio (500 km - Aceite + Filtro)';
let selectedChainAction = 'lube_only';

let editingFuelId = null;
let selectedFullTank = true;

let editingSpaId = null;
let selectedSpaType = 'Carwash Básico';

let editingModId = null;
let selectedModCat = 'protection';
let selectedModElecMode = 'none'; // 'none' | 'switched_acc' | 'direct_24_7'
let selectedModHasElec = false;

const MOD_TIPS_BY_CAT = {
  protection: 'Tip: En sliders de motor para la N160 verifica que usen pernos de acero grado 8.8 o 10.9 y topes de nylon/delrin.',
  security: 'Tip: Exige instalación con relé y fusible independiente sin pelar el ramal original FI. Consumo en reposo < 3 mA.',
  electric: 'Tip: Conecta cargadores USB o exploradoras únicamente a línea bajo llave (contacto ACC) para proteger la batería de 4Ah.',
  gear: 'Tip: El poliestireno expandido (EPS) de un casco certificado se degrada a los 4 años de uso; la app calculará su vigencia.'
};

function selectModElecModePill(elecMode = 'none') {
  selectedModElecMode = elecMode || 'none';
  selectedModHasElec = selectedModElecMode !== 'none';
  document.querySelectorAll('#mod-elec-picker .compound-pill').forEach((p) => {
    p.classList.toggle('selected', p.getAttribute('data-modelec') === selectedModElecMode);
  });
}

function syncModCategoryUI(cat = 'protection') {
  selectedModCat = cat || 'protection';
  document.querySelectorAll('#mod-category-picker .service-option').forEach((c) => {
    c.classList.toggle('selected', c.getAttribute('data-modcat') === selectedModCat);
  });
  const tipEl = document.getElementById('mod-smart-tip');
  if (tipEl) {
    tipEl.innerHTML = `<span>${MOD_TIPS_BY_CAT[selectedModCat] || MOD_TIPS_BY_CAT.protection}</span>`;
  }
}

let editingExpenseId = null;
let selectedExpenseCat = 'Cochera / Peaje';

let editingTirePos = 'front';
let selectedTireAction = 'edit';
let selectedTireCompound = 'Touring / Calle';

let hasLoadedInitialRoadRoute = false;
let ecuClockInterval = null;

let heroCoverExpanded = true;
let activeMainTabId = 'tab-maint';

function applySurfaceMode(mode = 'day') {
  const valid = (mode === 'night' || mode === 'dark') ? 'night' : 'day';
  appState.colorTheme = 'blue';
  appState.surfaceMode = valid;
  appState.sunlightMode = false;

  document.body.setAttribute('data-theme', 'blue');
  document.body.setAttribute('data-surface', valid);
  document.body.removeAttribute('data-sunlight');

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', valid === 'night' ? '#070B10' : '#E2F0F6');
  }

  document.querySelectorAll('.surface-pill').forEach((btn) => {
    btn.classList.toggle('selected', btn.getAttribute('data-surface') === valid);
  });

  const sunSvg = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>';
  const moonSvg = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';

  const surfaceBtn = document.getElementById('btn-toggle-surface');
  const surfaceSvg = document.getElementById('surface-toggle-svg');
  if (surfaceBtn) {
    surfaceBtn.title = valid === 'day' ? 'Cambiar a Modo Noche' : 'Cambiar a Modo Día';
    surfaceBtn.classList.toggle('surface-dark-active', valid === 'night');
  }
  if (surfaceSvg) {
    surfaceSvg.innerHTML = valid === 'day' ? moonSvg : sunSvg;
  }

  const obdBtn = document.getElementById('btn-obd-sunlight');
  const sheetSunLbl = document.getElementById('sheet-sun-label');
  const sheetSunSub = document.getElementById('sheet-sun-sub');
  const sheetSvg = document.getElementById('sheet-surface-svg');
  if (obdBtn) obdBtn.classList.toggle('active-tile', valid === 'day');
  if (sheetSunLbl) sheetSunLbl.textContent = valid === 'day' ? 'Modo Noche' : 'Modo Día';
  if (sheetSunSub) sheetSunSub.textContent = valid === 'day' ? 'Cambiar a oscuro N160' : 'Cambiar a celeste plateado';
  if (sheetSvg) sheetSvg.innerHTML = valid === 'day' ? moonSvg : sunSvg;

  if (appState.onboarded) {
    renderFuelSection();
    renderRouteAndTCO();
    if (document.body.classList.contains('ecu-tab-active')) {
      renderObdLiveUI(liveEcuData, false);
      renderTacticalMapUI(liveEcuData, false);
    }
  }
}

function syncHeroCoverState(tabId = activeMainTabId, explicitExpanded = null) {
  if (tabId) activeMainTabId = tabId;
  const shell = document.getElementById('hero-cockpit-shell');
  const btn = document.getElementById('btn-hero-toggle');
  const lbl = document.getElementById('hero-toggle-label');
  if (!shell) return;

  const hasPhoto = Boolean(appState.bikePhotoBase64);
  if (btn) btn.classList.toggle('hidden', !hasPhoto);

  if (!hasPhoto) {
    shell.classList.remove('hero-collapsed');
    heroCoverExpanded = false;
    return;
  }

  heroCoverExpanded = explicitExpanded !== null ? Boolean(explicitExpanded) : activeMainTabId === 'tab-maint';
  shell.classList.toggle('hero-collapsed', !heroCoverExpanded);
  if (lbl) {
    lbl.textContent = heroCoverExpanded ? '⌃ Ocultar portada' : '⌄ Jala o toca para ver portada';
  }
}

function updateHeaderCloudIndicator(status = 'idle') {
  const pill = document.getElementById('btn-open-backup-modal') || document.getElementById('cloud-live-indicator');
  const text = document.getElementById('cloud-live-text');
  if (!pill || !text) return;

  pill.classList.remove('syncing', 'ok', 'error', 'conflict');
  const user = getCurrentUser();

  if (!user) {
    text.textContent = 'Local';
    return;
  }

  if (status === 'syncing') {
    pill.classList.add('syncing');
    text.textContent = 'Subiendo...';
  } else if (status === 'conflict') {
    pill.classList.add('conflict');
    text.textContent = 'Revisar Nube';
  } else if (status === 'error') {
    pill.classList.add('error');
    text.textContent = 'Error Nube';
  } else {
    pill.classList.add('ok');
    text.textContent = 'Nube OK';
  }
}

function renderQuickPicksUI() {
  const picks = getRecentQuickPicks();
  const fuelBox = document.getElementById('fuel-quick-picks');
  const workBox = document.getElementById('workshop-quick-picks');

  if (fuelBox) {
    fuelBox.innerHTML =
      `<span class="quick-pick-label">Rápido:</span>` +
      picks.stations
        .map((st) => `<button type="button" class="quick-pick-pill" data-pick-fuel="${escapeHTML(st)}">${escapeHTML(st)}</button>`)
        .join('');
  }

  if (workBox) {
    workBox.innerHTML =
      `<span class="quick-pick-label">Rápido:</span>` +
      picks.workshops
        .map((w) => `<button type="button" class="quick-pick-pill" data-pick-workshop="${escapeHTML(w)}">${escapeHTML(w)}</button>`)
        .join('');
  }
}

function syncCockpitLiveClock() {
  const clockEl = document.getElementById('mo-live-clock');
  if (clockEl) {
    clockEl.textContent = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
}

function startCockpitClockLoop() {
  syncCockpitLiveClock();
  if (ecuClockInterval) clearInterval(ecuClockInterval);
  ecuClockInterval = setInterval(syncCockpitLiveClock, 15000);
}

function stopCockpitClockLoop() {
  if (ecuClockInterval) {
    clearInterval(ecuClockInterval);
    ecuClockInterval = null;
  }
}

async function exitEcuLandscapeIfNeeded() {
  stopCockpitClockLoop();
  stopBlackboxReplayTimer();
  closeModalById('mo-cockpit-sheet', true);
  document.body.classList.remove('ecu-ride-mode', 'ecu-tab-active', 'ecu-force-landscape');
  const rideBtn = document.getElementById('btn-obd-ride-mode');
  const rideLbl = document.getElementById('sheet-ride-label');
  if (rideBtn) rideBtn.classList.remove('active-tile');
  if (rideLbl) rideLbl.textContent = 'Modo Timón';
  const rotBtn = document.getElementById('btn-obd-rotate');
  if (rotBtn) rotBtn.classList.remove('active-rot');

  try {
    if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch (e) {}
}

function activateMachineOutdoorsSubView(view) {
  uiConfig.activeEcuSubView = view;
  document.querySelectorAll('[data-ecuview]').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-ecuview') === view);
  });

  const dialsPanel = document.getElementById('obd-live-panel');
  const mapPanel = document.getElementById('obd-map-panel');
  const diagPanel = document.getElementById('obd-diag-panel');

  if (dialsPanel) dialsPanel.classList.toggle('hidden', view !== 'dials');
  if (mapPanel) mapPanel.classList.toggle('hidden', view !== 'map');
  if (diagPanel) diagPanel.classList.toggle('hidden', view !== 'diag');

  if (view !== 'map') {
    stopBlackboxReplayTimer();
  }
  if (view === 'map') {
    renderTacticalMapUI(liveEcuData, true);
    if (!hasLoadedInitialRoadRoute) {
      hasLoadedInitialRoadRoute = true;
      const r0 = uiConfig.customRoute;
      if (r0 && r0.id !== 'standby' && r0.lat !== null && r0.lon !== null && Number(r0.distKm) > 0) {
        calculateRealRouteAndElevation({
          destLat: Number(r0.lat),
          destLon: Number(r0.lon),
          name: r0.name,
          region: r0.region
        });
      }
    }
  }
}

function switchMainTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-content').forEach((c) => {
    c.classList.toggle('hidden', c.id !== tabId);
  });

  if (tabId === 'tab-ecu') {
    document.body.classList.add('ecu-tab-active');
    startCockpitClockLoop();
    renderObdLiveUI(liveEcuData, true);
    setTimeout(() => {
      activateMachineOutdoorsSubView(uiConfig.activeEcuSubView || 'map');
    }, 80);
  } else {
    exitEcuLandscapeIfNeeded();
    syncHeroCoverState(tabId);
  }
}

function showOnboardingScreen() {
  closeModalById('modal-backup');
  document.getElementById('onboarding-screen').classList.remove('hidden');
  document.getElementById('main-screen').classList.add('hidden');
  document.getElementById('init-km-input').value = appState.initialKm || appState.currentKm || 0;
  const priceInp = document.getElementById('init-price-input');
  if (priceInp) {
    priceInp.value = appState.bikePurchasePrice > 0 ? appState.bikePurchasePrice : '';
  }
  renderImages();
}

function showMainScreen() {
  document.getElementById('onboarding-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  renderAllMain(true);
  syncHeroCoverState(activeMainTabId);
}

// ================= MODALES DE TALLER (CON AUDITORÍA DE CADENA O-RING) =================
function selectChainActionPill(actionVal) {
  selectedChainAction = actionVal || 'lube_only';
  document.querySelectorAll('#chain-action-picker .compound-pill').forEach((p) => {
    p.classList.toggle('selected', p.getAttribute('data-chainact') === selectedChainAction);
  });
}

function selectServiceInModal(serviceId) {
  document.querySelectorAll('#custom-service-picker .service-option').forEach((c) => {
    if (c.getAttribute('data-value') === serviceId) {
      c.classList.add('selected');
      selectedServiceType = serviceId;
      selectedServiceTitle = c.getAttribute('data-title');
    } else {
      c.classList.remove('selected');
    }
  });

  const chainWrap = document.getElementById('chain-action-picker-wrap');
  if (chainWrap) {
    chainWrap.classList.toggle('hidden', selectedServiceType !== 'chain_lube');
  }
  updateMaintMemoryBanner();
}

function syncMaintTotalCost() {
  const parts = parseFloat(document.getElementById('log-parts-cost').value) || 0;
  const labor = parseFloat(document.getElementById('log-labor-cost').value) || 0;
  const total = parts + labor;
  document.getElementById('log-cost').value = total > 0 ? total.toFixed(2) : '';
  updateMaintMemoryBanner();
}

function updateMaintMemoryBanner() {
  const banner = document.getElementById('maint-memory-banner');
  const typedCost = parseFloat(document.getElementById('log-cost').value);
  const prevRecord = getLastServiceRecord(selectedServiceType, editingLogId);

  if (!prevRecord) {
    banner.innerHTML = `<span>💡 <strong>1ra vez registrando este servicio:</strong> El monto total quedará guardado en memoria.</span>`;
    return;
  }

  const prevCost = Number(prevRecord.cost);
  const prevKm = Number(prevRecord.km).toLocaleString('es-PE');

  if (!isNaN(typedCost) && typedCost > 0) {
    const diff = typedCost - prevCost;
    if (Math.abs(diff) < 0.05) {
      banner.innerHTML = `<span>🧠 <strong>Memoria (${prevKm} km):</strong> Pagaste <strong>S/ ${prevCost.toFixed(2)}</strong> • Hoy te cuesta igual.</span>`;
    } else if (diff < 0) {
      banner.innerHTML = `<span>🧠 <strong>Memoria (${prevKm} km):</strong> Antes S/ ${prevCost.toFixed(2)} • <strong style="color:var(--status-ok)">▼ Ahorras S/ ${Math.abs(diff).toFixed(2)} hoy</strong>.</span>`;
    } else {
      banner.innerHTML = `<span>🧠 <strong>Memoria (${prevKm} km):</strong> Antes S/ ${prevCost.toFixed(2)} • <strong style="color:var(--amber-warn)">▲ S/ ${diff.toFixed(2)} más caro hoy</strong>.</span>`;
    }
  } else {
    banner.innerHTML = `<span>🧠 <strong>Memoria de gasto:</strong> La última vez (${prevKm} km) este servicio te costó <strong style="color:var(--caribbean-bright)">S/ ${prevCost.toFixed(2)}</strong>.</span>`;
  }
}

function openLogModal(preselectSrvId = null, editItem = null) {
  editingLogId = editItem ? editItem.id : null;
  document.getElementById('log-modal-title').textContent = editItem ? 'Editar Mantenimiento' : 'Registrar Mantenimiento';

  const workshopInput = document.getElementById('log-workshop');
  renderQuickPicksUI();

  if (editItem) {
    const parts = Number(editItem.partsCost ?? editItem.cost) || 0;
    const labor = Number(editItem.laborCost) || 0;
    document.getElementById('log-parts-cost').value = parts > 0 ? parts : '';
    document.getElementById('log-labor-cost').value = labor > 0 ? labor : '';
    document.getElementById('log-cost').value = (parts + labor) > 0 ? (parts + labor).toFixed(2) : '';
    document.getElementById('log-km').value = editItem.km;
    document.getElementById('log-date').value = editItem.date || getLocalISODate();
    if (workshopInput) workshopInput.value = editItem.workshop || '';
    document.getElementById('log-notes').value = editItem.notes || '';
    selectChainActionPill(editItem.chainAction || 'lube_only');
    selectServiceInModal(editItem.typeId || 'other');
  } else {
    document.getElementById('log-parts-cost').value = '';
    document.getElementById('log-labor-cost').value = '';
    document.getElementById('log-cost').value = '';
    document.getElementById('log-km').value = appState.currentKm;
    document.getElementById('log-date').value = getLocalISODate();
    if (workshopInput) workshopInput.value = '';
    document.getElementById('log-notes').value = '';
    selectChainActionPill('lube_only');
    selectServiceInModal(preselectSrvId || selectedServiceType);
  }

  openModalById('modal-log');
}

// ================= MODAL DE GRIFO PREMIUM (CREAR Y EDITAR) =================
function updateFuelPreview(sourceId = null) {
  const fuelKmInput = document.getElementById('fuel-km');
  const fuelCostInput = document.getElementById('fuel-cost');
  const fuelPriceInput = document.getElementById('fuel-price-gal');
  const fuelGallonsInput = document.getElementById('fuel-gallons');
  const livePreview = document.getElementById('live-fuel-preview');
  const fuelMemBanner = document.getElementById('fuel-memory-banner');

  const cost = parseFloat(fuelCostInput.value);
  const price = parseFloat(fuelPriceInput.value);

  if (sourceId !== 'fuel-gallons' && !isNaN(cost) && !isNaN(price) && price > 0) {
    fuelGallonsInput.value = (cost / price).toFixed(2);
  }

  const lastPriceRec = getLastFuelPriceRecord(editingFuelId);
  if (!lastPriceRec) {
    fuelMemBanner.innerHTML = `<span>⛽ <strong>Memoria de grifo:</strong> El precio por galón Premium quedará guardado para comparar tus siguientes cargas.</span>`;
  } else {
    const prevP = Number(lastPriceRec.priceGal);
    if (!isNaN(price) && price > 0) {
      const diffP = price - prevP;
      if (Math.abs(diffP) < 0.01) {
        fuelMemBanner.innerHTML = `<span>🧠 <strong>Memoria de galón:</strong> S/ ${price.toFixed(2)} • Mismo precio que tu última carga.</span>`;
      } else if (diffP < 0) {
        fuelMemBanner.innerHTML = `<span>🧠 <strong>Memoria de galón:</strong> Antes S/ ${prevP.toFixed(2)} • <strong style="color:var(--status-ok)">▼ Bajó S/ ${Math.abs(diffP).toFixed(2)} por galón</strong>.</span>`;
      } else {
        fuelMemBanner.innerHTML = `<span>🧠 <strong>Memoria de galón:</strong> Antes S/ ${prevP.toFixed(2)} • <strong style="color:var(--amber-warn)">▲ Subió S/ ${diffP.toFixed(2)} por galón</strong>.</span>`;
      }
    } else {
      fuelMemBanner.innerHTML = `<span>🧠 <strong>Último precio pagado:</strong> S/ ${prevP.toFixed(2)} por galón Premium.</span>`;
    }
  }

  const isLoanChecked = Boolean(document.getElementById('fuel-is-loan-chk')?.checked);
  if (isLoanChecked) {
    livePreview.innerHTML = `<strong>Modo Préstamo:</strong> Esta carga quedará aislada para no alterar tu rendimiento personal (km/gal).`;
    return;
  }

  const kmToday = parseInt(fuelKmInput.value, 10);
  const galToday = parseFloat(fuelGallonsInput.value);
  const baseline = getFuelPreviewBaseline(editingFuelId);

  if (!baseline.hasBase) {
    if (selectedFullTank) {
      livePreview.innerHTML = `Punto Base: <strong>${kmToday || 0} km</strong> quedará registrado como primer Tanque Lleno de referencia.`;
    } else {
      livePreview.innerHTML = `⚡ <strong>Carga Parcial:</strong> Registra al menos un "Tanque Lleno" para iniciar el cálculo exacto de rendimiento.`;
    }
    return;
  }

  if (!selectedFullTank) {
    livePreview.innerHTML = `⚡ <strong>Carga Parcial:</strong> Se acumularán los galones y Soles hasta tu próximo llenado al primer corte.`;
    return;
  }

  const delta = kmToday - baseline.lastFullKm;
  const totalGal = (galToday || 0) + baseline.pendingGal;
  const totalCost = (cost || 0) + baseline.pendingCost;

  if (!isNaN(delta) && delta > 0 && totalGal > 0 && totalCost > 0) {
    const eff = delta / totalGal;
    const cKm = totalCost / delta;
    livePreview.innerHTML = `Tramo Real: <strong>+${delta} km</strong> • Rendimiento: <strong style="color:var(--status-ok)">${eff.toFixed(1)} km/gal</strong> • Costo: <strong>S/ ${cKm.toFixed(2)}/km</strong>`;
  } else {
    livePreview.innerHTML = `Último tanque lleno: <strong>${baseline.lastFullKm} km</strong>. Ingresa el kilometraje actual y el monto pagado.`;
  }
}

function openFuelModal(editItem = null) {
  editingFuelId = editItem ? editItem.id : null;
  document.getElementById('fuel-modal-title').textContent = editItem ? 'Editar Abastecimiento' : 'Nuevo Abastecimiento';

  renderQuickPicksUI();

  const lastRec = getLastFuelPriceRecord(editingFuelId);
  selectedFullTank = editItem ? editItem.fullTank !== false : true;

  document.querySelectorAll('#fuel-mode-picker .mode-pill').forEach((p) => {
    p.classList.toggle('selected', (p.getAttribute('data-full') === 'true') === selectedFullTank);
  });

  const loanChk = document.getElementById('fuel-is-loan-chk');
  if (loanChk) loanChk.checked = Boolean(editItem ? editItem.isLoan : false);

  if (editItem) {
    document.getElementById('fuel-km').value = editItem.km;
    document.getElementById('fuel-cost').value = editItem.cost;
    document.getElementById('fuel-price-gal').value = editItem.priceGal || '';
    document.getElementById('fuel-gallons').value = Number(editItem.gallons).toFixed(2);
    document.getElementById('fuel-date').value = editItem.date || getLocalISODate();
    document.getElementById('fuel-notes').value = editItem.notes || '';
  } else {
    document.getElementById('fuel-km').value = appState.currentKm;
    document.getElementById('fuel-cost').value = '';
    document.getElementById('fuel-price-gal').value = lastRec ? Number(lastRec.priceGal).toFixed(2) : (appState.lastPriceGal || '');
    document.getElementById('fuel-gallons').value = '';
    document.getElementById('fuel-date').value = getLocalISODate();
    document.getElementById('fuel-notes').value = '';
  }

  updateFuelPreview('fuel-gallons');
  openModalById('modal-fuel');
}

// ================= MODALES DE GARAJE Y OTROS GASTOS =================
function openSpaModal(editItem = null) {
  editingSpaId = editItem ? editItem.id : null;
  document.getElementById('spa-modal-title').textContent = editItem ? 'Editar Lavado' : 'Registrar Lavado';

  selectedSpaType = editItem ? editItem.type : 'Carwash Básico';
  document.querySelectorAll('#spa-type-picker .compound-pill').forEach((p) => {
    p.classList.toggle('selected', p.getAttribute('data-spatype') === selectedSpaType);
  });

  if (editItem) {
    document.getElementById('spa-km').value = editItem.km;
    document.getElementById('spa-cost').value = editItem.cost;
    document.getElementById('spa-date').value = editItem.date || getLocalISODate();
    document.getElementById('spa-notes').value = editItem.notes || '';
  } else {
    const activePill = document.querySelector('#spa-type-picker .compound-pill.selected');
    document.getElementById('spa-km').value = appState.currentKm;
    document.getElementById('spa-cost').value = activePill ? activePill.getAttribute('data-defaultcost') : '12';
    document.getElementById('spa-date').value = getLocalISODate();
    document.getElementById('spa-notes').value = '';
  }

  openModalById('modal-spa');
}

function openModModal(editItem = null) {
  editingModId = editItem ? editItem.id : null;
  document.getElementById('mod-modal-title').textContent = editItem ? 'Editar Accesorio' : 'Agregar Accesorio';

  const cat = editItem ? (editItem.category || 'protection') : 'protection';
  syncModCategoryUI(cat);

  if (editItem) {
    const inferredElecMode = editItem.elecMode
      ? editItem.elecMode
      : (editItem.hasElec ? (cat === 'security' ? 'direct_24_7' : 'switched_acc') : 'none');
    selectModElecModePill(inferredElecMode);

    document.getElementById('mod-name').value = editItem.name || '';
    document.getElementById('mod-brand').value = editItem.brand || '';
    document.getElementById('mod-cost').value = editItem.cost || '';
    document.getElementById('mod-km').value = editItem.km || 0;
    document.getElementById('mod-date').value = editItem.date || getLocalISODate();
    document.getElementById('mod-notes').value = editItem.notes || '';
  } else {
    selectModElecModePill('none');
    document.getElementById('mod-name').value = '';
    document.getElementById('mod-brand').value = '';
    document.getElementById('mod-cost').value = '';
    document.getElementById('mod-km').value = appState.currentKm;
    document.getElementById('mod-date').value = getLocalISODate();
    document.getElementById('mod-notes').value = '';
  }

  openModalById('modal-mod');
}

function openExpenseModal(editItem = null) {
  editingExpenseId = editItem ? editItem.id : null;
  document.getElementById('expense-modal-title').textContent = editItem ? 'Editar Gasto' : 'Registrar Gasto';

  selectedExpenseCat = editItem ? editItem.category : 'Cochera / Peaje';
  document.querySelectorAll('#expense-cat-picker .compound-pill').forEach((p) => {
    p.classList.toggle('selected', p.getAttribute('data-expcat') === selectedExpenseCat);
  });

  if (editItem) {
    document.getElementById('expense-title').value = editItem.title || '';
    document.getElementById('expense-cost').value = editItem.cost || '';
    document.getElementById('expense-km').value = editItem.km || appState.currentKm;
    document.getElementById('expense-date').value = editItem.date || getLocalISODate();
  } else {
    document.getElementById('expense-title').value = '';
    document.getElementById('expense-cost').value = '';
    document.getElementById('expense-km').value = appState.currentKm;
    document.getElementById('expense-date').value = getLocalISODate();
  }

  openModalById('modal-expense');
}

function syncTireModalFields() {
  const curr = appState.tires[editingTirePos] || DEFAULT_TIRES[editingTirePos];
  const memBanner = document.getElementById('tire-memory-banner');
  const treadInput = document.getElementById('tire-tread-mm');

  if (selectedTireAction === 'replace') {
    document.getElementById('tire-brand').value = '';
    document.getElementById('tire-size').value = curr.size || (editingTirePos === 'front' ? '100/80-17 TL' : '130/70-17 TL');
    document.getElementById('tire-install-km').value = appState.currentKm;
    document.getElementById('tire-cost').value = '';
    document.getElementById('tire-dot').value = '';
    if (treadInput) treadInput.value = editingTirePos === 'front' ? '4.8' : '6.0';
    document.getElementById('tire-date').value = getLocalISODate();
    memBanner.innerHTML = `<span>🔄 <strong>Montar Nueva:</strong> La llanta actual (${escapeHTML(curr.brand)}) pasará automáticamente al historial de llantas anteriores.</span>`;
  } else {
    document.getElementById('tire-brand').value = curr.brand.includes('(Fábrica)') ? '' : curr.brand;
    document.getElementById('tire-size').value = curr.size || (editingTirePos === 'front' ? '100/80-17 TL' : '130/70-17 TL');
    document.getElementById('tire-install-km').value = curr.installKm || 0;
    document.getElementById('tire-life-km').value = curr.lifeKm || (editingTirePos === 'front' ? 18000 : 16000);
    document.getElementById('tire-cost').value = curr.cost > 0 ? curr.cost : '';
    document.getElementById('tire-dot').value = curr.dot || '';
    if (treadInput) treadInput.value = curr.treadMm !== null && curr.treadMm !== undefined ? curr.treadMm : '';
    document.getElementById('tire-date').value = curr.date || getLocalISODate();
    memBanner.innerHTML = `<span>✏️ <strong>Modo Edición:</strong> Si ingresas la <strong>Cocada Actual (mm)</strong>, la app calculará el desgaste real en km/mm hasta el límite TWI (1.6 mm).</span>`;
  }
}

function openTireModal(pos) {
  editingTirePos = pos;
  const curr = appState.tires[pos] || DEFAULT_TIRES[pos];

  document.getElementById('tire-modal-pos-tag').textContent =
    pos === 'front' ? 'NEUMÁTICO DELANTERO (25 PSI)' : 'NEUMÁTICO TRASERO (28 / 32 PSI)';
  document.getElementById('tire-modal-title').textContent =
    pos === 'front' ? 'Configurar Llanta Delantera' : 'Configurar Llanta Trasera';

  selectedTireAction = 'edit';
  document.querySelectorAll('#tire-action-picker .mode-pill').forEach((p) => {
    p.classList.toggle('selected', p.getAttribute('data-tireaction') === 'edit');
  });

  selectedTireCompound = curr.compound || 'Touring / Calle';
  document.querySelectorAll('#tire-compound-picker .compound-pill').forEach((p) => {
    p.classList.toggle('selected', p.getAttribute('data-compound') === selectedTireCompound);
  });

  syncTireModalFields();
  openModalById('modal-tire');
}

// ================= DELEGACIÓN Y EVENTOS PRINCIPALES =================

async function syncVaultDocsUI() {
  const soatImg = await getVaultDocMedia('soat_cert');
  const cardImg = await getVaultDocMedia('prop_card');

  const soatBadge = document.getElementById('vault-soat-badge');
  const btnViewSoat = document.getElementById('btn-vault-view-soat');
  const btnDelSoat = document.getElementById('btn-vault-del-soat');

  if (soatBadge) {
    soatBadge.textContent = soatImg ? 'Guardado ✓' : 'Vacío';
    soatBadge.className = `status-pill ${soatImg ? 'status-ok' : 'status-warn'}`;
  }
  btnViewSoat?.classList.toggle('hidden', !soatImg);
  btnDelSoat?.classList.toggle('hidden', !soatImg);

  const cardBadge = document.getElementById('vault-card-badge');
  const btnViewCard = document.getElementById('btn-vault-view-card');
  const btnDelCard = document.getElementById('btn-vault-del-card');

  if (cardBadge) {
    cardBadge.textContent = cardImg ? 'Guardado ✓' : 'Vacío';
    cardBadge.className = `status-pill ${cardImg ? 'status-ok' : 'status-warn'}`;
  }
  btnViewCard?.classList.toggle('hidden', !cardImg);
  btnDelCard?.classList.toggle('hidden', !cardImg);
}

function setupEventListeners() {
  window.addEventListener('popstate', () => {
    handlePopstateModalBack([
      'modal-vault-fullscreen',
      'modal-confirm',
      'modal-sos',
      'mo-cockpit-sheet',
      'modal-fav-routes',
      'modal-info-guide',
      'modal-km',
      'modal-bike-price',
      'modal-budget',
      'modal-spa',
      'modal-log',
      'modal-fuel',
      'modal-expense',
      'modal-backup',
      'modal-docs',
      'modal-tire',
      'modal-mod',
      'modal-route-cfg'
    ]);
  });

  window.addEventListener('orientationchange', () => {
    refreshLeafletSize();
  });
  window.addEventListener('resize', () => {
    if (document.body.classList.contains('ecu-tab-active')) {
      refreshLeafletSize();
    }
  });

  window.addEventListener('cloud-sync-status', (ev) => {
    updateHeaderCloudIndicator(ev.detail);
  });

  // Conmutador único Día / Noche (Cabecera y Cockpit)
  const toggleDayNightHandler = () => {
    const nextMode = appState.surfaceMode === 'night' ? 'day' : 'night';
    applySurfaceMode(nextMode);
    saveState();
    closeModalById('mo-cockpit-sheet', true);
    triggerHaptic(12);
    showToast(nextMode === 'day' ? '☀️ Modo Día N160 activado' : '🌙 Modo Noche N160 activado');
  };

  document.getElementById('btn-toggle-surface')?.addEventListener('click', toggleDayNightHandler);

  // Selector Día / Noche (Onboarding y Ajustes)
  document.querySelectorAll('.surface-pill').forEach((pill) => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const chosen = pill.getAttribute('data-surface') === 'night' ? 'night' : 'day';
      applySurfaceMode(chosen);
      saveState();
      triggerHaptic(10);
      showToast(chosen === 'day' ? '☀️ Modo Día N160 activado' : '🌙 Modo Noche N160 activado');
    });
  });

  // Portada desplegable: toque en tirador o gesto de jalar hacia abajo / arriba sobre el Odómetro
  const heroShellEl = document.getElementById('hero-cockpit-shell');
  let heroTouchStartY = 0;
  let heroTouchStartX = 0;

  document.getElementById('btn-hero-toggle')?.addEventListener('click', () => {
    syncHeroCoverState(activeMainTabId, !heroCoverExpanded);
    triggerHaptic(10);
  });

  heroShellEl?.addEventListener('touchstart', (ev) => {
    if (!appState.bikePhotoBase64 || !ev.touches?.length) return;
    heroTouchStartY = ev.touches[0].clientY;
    heroTouchStartX = ev.touches[0].clientX;
  }, { passive: true });

  heroShellEl?.addEventListener('touchend', (ev) => {
    if (!appState.bikePhotoBase64 || !ev.changedTouches?.length) return;
    const dy = ev.changedTouches[0].clientY - heroTouchStartY;
    const dx = ev.changedTouches[0].clientX - heroTouchStartX;
    if (Math.abs(dy) > 32 && Math.abs(dy) > Math.abs(dx)) {
      if (dy > 0 && !heroCoverExpanded) {
        syncHeroCoverState(activeMainTabId, true);
        triggerHaptic(12);
      } else if (dy < 0 && heroCoverExpanded) {
        syncHeroCoverState(activeMainTabId, false);
        triggerHaptic(10);
      }
    }
  }, { passive: true });

  // Acceso directo desde la Placa en cabecera hacia la Guantera Digital
  document.getElementById('header-plate-badge')?.addEventListener('click', () => {
    document.getElementById('btn-open-docs-modal')?.click();
    triggerHaptic(10);
  });

  // Banner de Alerta Proactiva (Acción 1-toque y cierre por sesión)
  document.getElementById('btn-priority-dismiss')?.addEventListener('click', () => {
    if (uiConfig.currentPriorityAlert) {
      uiConfig.dismissedAlertId = uiConfig.currentPriorityAlert.id;
    }
    renderPriorityBanner();
    triggerHaptic(8);
  });

  document.getElementById('btn-priority-action')?.addEventListener('click', () => {
    const alert = uiConfig.currentPriorityAlert;
    if (!alert) return;
    triggerHaptic(12);
    if (alert.actionType === 'docs') {
      document.getElementById('btn-open-docs-modal')?.click();
    } else if (alert.actionType === 'maint') {
      switchMainTab('tab-maint');
      openLogModal(alert.actionTarget, null);
    }
  });

  // Panel Deslizable del Cockpit (Bottom Sheet)
  const closeCockpitSheet = () => closeModalById('mo-cockpit-sheet');
  document.getElementById('btn-mo-sheet-toggle')?.addEventListener('click', () => {
    openModalById('mo-cockpit-sheet');
    triggerHaptic(10);
  });
  document.getElementById('btn-close-sheet-x')?.addEventListener('click', closeCockpitSheet);

  // Cierre nativo al tocar fuera de cualquier tarjeta modal (Backdrop Tap)
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop && backdrop.id) {
        closeModalById(backdrop.id);
      }
    });
  });

  // Switch Rápido Piloto Solo vs. Copiloto / Carga (PSI + Monoshock Nitrox)
  document.getElementById('btn-toggle-load-mode')?.addEventListener('click', () => {
    appState.rideLoadMode = appState.rideLoadMode === 'pillion' ? 'solo' : 'pillion';
    saveState();
    renderGarageSection();
    triggerHaptic(14);
    showToast(
      appState.rideLoadMode === 'pillion'
        ? '👥 Modo Copiloto/Carga: 25 / 32 PSI • Monoshock Pos 4-5'
        : '👤 Modo Piloto Solo: 25 / 28 PSI • Monoshock Pos 2-3'
    );
  });

  // Auditoría de Drenaje Parásito Nocturno (Batería 4Ah en reposo)
  document.getElementById('btn-night-save-base')?.addEventListener('click', () => {
    let v = liveEcuData.connected && liveEcuData.voltage > 5 ? Number(liveEcuData.voltage) : 0;
    if (!v) {
      const manual = window.prompt('Ingresa el voltaje actual en reposo (vía multímetro o contacto OBD2):', '12.75');
      if (manual === null) return;
      v = parseFloat(String(manual).replace(',', '.'));
    }
    if (isNaN(v) || v < 8 || v > 16) {
      showToast('⚠️ Ingresa un voltaje válido entre 8.0V y 16.0V');
      return;
    }
    appState.nightDrainTest = {
      baseVolt: Number(v.toFixed(2)),
      baseTimeMs: Date.now(),
      morningVolt: 0,
      morningTimeMs: 0,
      hoursElapsed: 0,
      dropVolt: 0
    };
    saveState();
    renderNightDrainUI();
    triggerHaptic(15);
    showToast(`🌙 Base nocturna guardada: ${v.toFixed(2)}V`);
  });

  document.getElementById('btn-night-compare-morning')?.addEventListener('click', () => {
    const nd = appState.nightDrainTest || {};
    if (!nd.baseVolt || nd.baseVolt <= 0) {
      showToast('⚠️ Primero registra la "🌙 Base Noche" al apagar tu moto');
      return;
    }
    let v = liveEcuData.connected && liveEcuData.voltage > 5 ? Number(liveEcuData.voltage) : 0;
    if (!v) {
      const manual = window.prompt(`Base anoche: ${nd.baseVolt.toFixed(2)}V. Ingresa el voltaje en frío de esta mañana:`, '12.62');
      if (manual === null) return;
      v = parseFloat(String(manual).replace(',', '.'));
    }
    if (isNaN(v) || v < 8 || v > 16) {
      showToast('⚠️ Ingresa un voltaje válido entre 8.0V y 16.0V');
      return;
    }
    const nowMs = Date.now();
    const hours = nd.baseTimeMs > 0 ? Math.max(0.1, (nowMs - nd.baseTimeMs) / 3600000) : 8.0;
    const drop = Number((nd.baseVolt - v).toFixed(2));

    appState.nightDrainTest = {
      ...nd,
      morningVolt: Number(v.toFixed(2)),
      morningTimeMs: nowMs,
      hoursElapsed: Number(hours.toFixed(1)),
      dropVolt: drop
    };
    saveState();
    renderNightDrainUI();
    triggerHaptic(20);
    showToast(drop > 0.25 ? `⚠️ Fuga detectada (-${drop.toFixed(2)}V)` : `✅ Reposo evaluado (Δ ${drop.toFixed(2)}V)`);
  });

  // Botón Modo Día / Modo Noche dentro del Panel del Cockpit
  document.getElementById('btn-obd-sunlight')?.addEventListener('click', toggleDayNightHandler);

  // Confirmación de reinicio barométrico del sensor MAP en Sierra
  document.getElementById('btn-ack-map-reset')?.addEventListener('click', () => {
    acknowledgeMapReset();
    renderObdLiveUI(liveEcuData, true);
    triggerHaptic(15);
    showToast('✅ Sensor MAP recalibrado para tu altitud actual');
  });

  // Eventos de Ficha SOS en Ruta (WhatsApp + Copiar Coordenadas)
  const handleOpenSos = () => {
    openSosModal(liveEcuData);
    triggerHaptic(20);
  };
  document.getElementById('btn-mo-open-sos')?.addEventListener('click', handleOpenSos);
  document.getElementById('btn-close-sos-x')?.addEventListener('click', () => closeModalById('modal-sos'));
  document.getElementById('btn-close-sos-ok')?.addEventListener('click', () => closeModalById('modal-sos'));

  document.getElementById('btn-sos-copy')?.addEventListener('click', () => {
    const r = uiConfig.customRoute || ROUTE_PRESETS[0];
    const lat = Number(uiConfig.liveGpsLat ?? r.lat ?? -8.1116).toFixed(6);
    const lon = Number(uiConfig.liveGpsLon ?? r.lon ?? -79.0287).toFixed(6);
    const text = `🆘 SOS Ruta Pulsar N160 FI (${appState.docs?.plate || 'S/P'}) - Coordenadas: ${lat}, ${lon} (https://maps.google.com/?q=${lat},${lon})`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast('📋 Coordenadas SOS copiadas'));
    } else {
      showToast(`📍 ${lat}, ${lon}`);
    }
  });

  document.getElementById('btn-sos-whatsapp')?.addEventListener('click', () => {
    const r = uiConfig.customRoute || ROUTE_PRESETS[0];
    const lat = Number(uiConfig.liveGpsLat ?? r.lat ?? -8.1116).toFixed(6);
    const lon = Number(uiConfig.liveGpsLon ?? r.lon ?? -79.0287).toFixed(6);
    const plate = appState.docs?.plate || 'Pulsar N160 FI';
    const volt = liveEcuData.voltage > 0 ? `${liveEcuData.voltage.toFixed(1)}V` : 'S/D';
    const msg =
      `🆘 *REPORTE SOS EN RUTA - MI MOTO N160*\n` +
      `🏍️ Unidad: ${plate} (${appState.currentKm.toLocaleString('es-PE')} km)\n` +
      `📍 Ubicación GPS: ${lat}, ${lon}\n` +
      `🗺️ Mapa: https://maps.google.com/?q=${lat},${lon}\n` +
      `🔋 Estado ECU: Batería ${volt} | Temp ${liveEcuData.tempC || '--'}°C`;
    const cleanPhone = String(appState.docs?.sosPhone || '').replace(/\D/g, '');
    const waUrl = cleanPhone
      ? `https://wa.me/51${cleanPhone.replace(/^51/, '')}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  });

  // Eventos de Telemetría OBD2 en Vivo (Konnwei KW901 BLE + Simulador Demo)
  const btnObdConnect = document.getElementById('btn-obd-connect');
  if (btnObdConnect) {
    btnObdConnect.addEventListener('click', async () => {
      closeModalById('mo-cockpit-sheet', true);
      if (liveEcuData.connected && liveEcuData.mode === 'ble') {
        stopEcuTelemetry(renderObdLiveUI);
        showToast('🔌 Telemetría ECU desconectada');
        return;
      }
      try {
        await connectKonnweiBle(renderObdLiveUI, (msg) => showToast(msg));
        triggerHaptic(20);
      } catch (err) {
        stopEcuTelemetry(renderObdLiveUI);
        showToast(`⚠️ ${err.message || 'No se pudo conectar al escáner'}`);
      }
    });
  }

  const btnObdSim = document.getElementById('btn-obd-sim');
  if (btnObdSim) {
    btnObdSim.addEventListener('click', () => {
      closeModalById('mo-cockpit-sheet', true);
      if (liveEcuData.connected && liveEcuData.mode === 'sim') {
        stopEcuTelemetry(renderObdLiveUI);
        showToast('⏹ Modo Demo detenido');
      } else {
        startSimulatorMode(renderObdLiveUI, (msg) => showToast(msg));
        triggerHaptic(15);
      }
    });
  }

  // Proveedor completo de coordenadas y velocidad GPS en vivo para la Caja Negra (BlackBox Recorder)
  registerGpsProviderForBlackbox(() => {
    const r = uiConfig.customRoute || ROUTE_PRESETS[0];
    return {
      lat: uiConfig.liveGpsLat ?? r.lat ?? -8.1116,
      lon: uiConfig.liveGpsLon ?? r.lon ?? -79.0287,
      alt: uiConfig.liveGpsAlt ?? liveEcuData.estimatedAltM ?? 34,
      speedKmh: uiConfig.liveGpsSpeedKmh ?? 0
    };
  });

  // Actualización fluida del segundero Sprint (20 Hz en GPS, OBD2 y Demo)
  registerSprintTickCallback((ecu) => renderSprintTimerUI(ecu));

  // Registro de Récords del Cronómetro Sprint (0-60 / 0-80 km/h)
  registerSprintRecordCallback(({ target, timeSec }) => {
    if (!appState.sprintRecords) {
      appState.sprintRecords = { best060: null, best080: null, last060: null, last080: null, updatedAt: '' };
    }
    let isNewBest = false;
    if (target === 60) {
      appState.sprintRecords.last060 = timeSec;
      if (appState.sprintRecords.best060 === null || timeSec < Number(appState.sprintRecords.best060)) {
        appState.sprintRecords.best060 = timeSec;
        isNewBest = true;
      }
    } else if (target === 80) {
      appState.sprintRecords.last080 = timeSec;
      if (appState.sprintRecords.best080 === null || timeSec < Number(appState.sprintRecords.best080)) {
        appState.sprintRecords.best080 = timeSec;
        isNewBest = true;
      }
    }
    appState.sprintRecords.updatedAt = getLocalISODate();
    saveState();
    renderSprintTimerUI(liveEcuData);
    showToast(isNewBest ? `Nuevo Récord 0-${target} km/h: ${timeSec.toFixed(2)}s` : `0-${target} km/h: ${timeSec.toFixed(2)}s`);
  });

  document.getElementById('btn-sprint-toggle')?.addEventListener('click', () => {
    const st = liveEcuData.sprint?.status || 'idle';
    if (st === 'waiting_stop' || st === 'armed' || st === 'running') {
      cancelSprintTimer(renderObdLiveUI);
      showToast('Cronómetro Sprint cancelado');
    } else {
      if (!liveEcuData.connected && uiConfig.gpsWatchId === null) {
        showToast('Activa ECU, GPS Vivo o Modo Demo para medir aceleración');
      }
      armSprintTimer(renderObdLiveUI, (msg) => showToast(msg));
    }
  });

  document.getElementById('btn-sprint-reset')?.addEventListener('click', () => {
    openCustomConfirm({
      title: 'Reiniciar Récords Sprint',
      message: '¿Deseas borrar tus mejores marcas de 0–60 y 0–80 km/h?',
      confirmText: 'Sí, Reiniciar',
      isDanger: true,
      icon: '↻',
      onConfirm: () => {
        appState.sprintRecords = { best060: null, best080: null, last060: null, last080: null, updatedAt: '' };
        cancelSprintTimer(renderObdLiveUI);
        saveState();
        renderSprintTimerUI(liveEcuData);
        showToast('Récords Sprint reiniciados');
      }
    });
  });

  // Botón de Test Automático de Salud Eléctrica (15 Segundos)
  const btnStartElecTest = document.getElementById('btn-start-elec-test');
  if (btnStartElecTest) {
    btnStartElecTest.addEventListener('click', () => {
      startElectricalHealthTest(renderObdLiveUI, (msg) => showToast(msg));
    });
  }

  // Botones de Grabación y Exportación de Caja Negra (Auto-enciende GPS si estaba apagado)
  const handleBlackboxToggle = () => {
    closeModalById('mo-cockpit-sheet', true);
    if (!liveEcuData.blackbox.recording && uiConfig.gpsWatchId === null) {
      document.getElementById('btn-toggle-gps')?.click();
    }
    toggleBlackboxRecording(renderObdLiveUI, (msg) => showToast(msg));
  };
  document.getElementById('btn-obd-rec-toggle')?.addEventListener('click', handleBlackboxToggle);
  document.getElementById('btn-bb-toggle-diag')?.addEventListener('click', handleBlackboxToggle);

  document.getElementById('btn-bb-export-gpx')?.addEventListener('click', () => {
    if (!exportBlackboxFile('gpx')) {
      showToast('⚠️ Primero graba una sesión con "🔴 REC"');
    } else {
      triggerHaptic(15);
      showToast('🗺️ Ruta .GPX descargada con telemetría ECU');
    }
  });

  document.getElementById('btn-bb-export-csv')?.addEventListener('click', () => {
    if (!exportBlackboxFile('csv')) {
      showToast('⚠️ Primero graba una sesión con "🔴 REC"');
    } else {
      triggerHaptic(15);
      showToast('📊 Telemetría .CSV descargada');
    }
  });

  // Eventos del Reproductor Interactivo de Caja Negra (Race Replay en el Mapa)
  const openRaceReplayHandler = () => {
    closeModalById('mo-cockpit-sheet', true);
    const hadRecordedPts = (liveEcuData.blackbox?.points?.length || 0) >= 2;
    activateMachineOutdoorsSubView('map');
    setTimeout(() => {
      if (startBlackboxReplayMode()) {
        triggerHaptic(15);
        showToast(
          hadRecordedPts
            ? `▶️ Race Replay: ${liveEcuData.blackbox.points.length} muestras cargadas`
            : '▶️ Race Replay Demo cargado (desliza la barra o dale Play)'
        );
      }
    }, 90);
  };

  document.getElementById('btn-bb-open-replay')?.addEventListener('click', openRaceReplayHandler);
  document.getElementById('btn-mo-open-replay-top')?.addEventListener('click', openRaceReplayHandler);

  document.getElementById('btn-replay-play')?.addEventListener('click', () => {
    toggleBlackboxReplayPlay();
    triggerHaptic(10);
  });

  document.getElementById('btn-replay-speed')?.addEventListener('click', () => {
    const mult = cycleBlackboxReplaySpeed();
    triggerHaptic(8);
    showToast(`⏩ Velocidad Replay: ${mult}x`);
  });

  document.getElementById('replay-scrubber')?.addEventListener('input', (ev) => {
    seekBlackboxReplayFrame(ev.target.value);
  });

  document.getElementById('btn-replay-close')?.addEventListener('click', () => {
    closeBlackboxReplayMode();
    triggerHaptic(10);
    showToast('⏹ Saliste del modo Race Replay');
  });

  const btnScanDtc = document.getElementById('btn-obd-scan-dtc');
  if (btnScanDtc) {
    btnScanDtc.addEventListener('click', () => {
      scanEcuDtcCodes(renderObdLiveUI, (msg) => showToast(msg));
    });
  }

  const btnClearDtc = document.getElementById('btn-obd-clear-dtc');
  if (btnClearDtc) {
    btnClearDtc.addEventListener('click', () => {
      openCustomConfirm({
        title: '¿Borrar Check Engine (DTC)?',
        message: 'Se enviará el comando Modo 04 a la ECU de tu Pulsar N160 para limpiar los códigos de error almacenados y apagar el testigo.',
        confirmText: 'Sí, Borrar Fallas',
        isDanger: true,
        icon: '🧹',
        onConfirm: () => {
          clearEcuDtcCodes(renderObdLiveUI, (msg) => showToast(msg));
        }
      });
    });
  }

  // Botón Rotación Horizontal Exclusiva para la Pestaña ECU (Con bloqueo nativo + Modo Widescreen Forzado)
  const btnRotateEcu = document.getElementById('btn-obd-rotate');
  if (btnRotateEcu) {
    btnRotateEcu.addEventListener('click', async () => {
      const isNativeLandscape = window.matchMedia('(orientation: landscape)').matches;
      const isForcedLandscape = document.body.classList.contains('ecu-force-landscape');
      const currentlyHorizontal = isNativeLandscape || isForcedLandscape;

      const rideBtnSync = document.getElementById('btn-obd-ride-mode');
      const rideLblSync = document.getElementById('sheet-ride-label');
      if (!currentlyHorizontal) {
        document.body.classList.add('ecu-ride-mode', 'ecu-tab-active', 'ecu-force-landscape');
        btnRotateEcu.classList.add('active-rot');
        if (rideBtnSync) rideBtnSync.classList.add('active-tile');
        if (rideLblSync) rideLblSync.textContent = 'Salir Timón';
        try {
          if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
          }
          if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape');
          }
        } catch (err) {}
        refreshLeafletSize();
        triggerHaptic(15);
        showToast('Modo Horizontal Widescreen Activado');
      } else {
        document.body.classList.remove('ecu-force-landscape', 'ecu-ride-mode');
        btnRotateEcu.classList.remove('active-rot');
        if (rideBtnSync) rideBtnSync.classList.remove('active-tile');
        if (rideLblSync) rideLblSync.textContent = 'Modo Timón';
        try {
          if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
          }
          if (document.fullscreenElement && document.exitFullscreen) {
            await document.exitFullscreen();
          }
        } catch (err) {}
        refreshLeafletSize();
        triggerHaptic(12);
        showToast('Modo Vertical Restaurado');
      }
    });
  }

  // Selector de Vistas Machine Outdoors OS
  document.querySelectorAll('[data-ecuview]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-ecuview') || 'map';
      activateMachineOutdoorsSubView(view);
      triggerHaptic(10);
    });
  });

  document.getElementById('btn-mo-exit-home')?.addEventListener('click', () => {
    switchMainTab('tab-maint');
    triggerHaptic(12);
  });

  // ================= BUSCADOR PROFESIONAL + AUTOCOMPLETADO + CHIPS DE DESTINOS Y PDI =================
  const searchInput = document.getElementById('map-place-search-input');
  const searchBtn = document.getElementById('btn-map-search-go');
  const searchClearBtn = document.getElementById('btn-map-search-clear');
  const searchDropdown = document.getElementById('map-search-results');
  let searchDebounceTimer = null;

  function syncClearSearchBtnVisibility() {
    if (!searchClearBtn) return;
    const hasText = Boolean((searchInput?.value || '').trim());
    const hasRoute = Boolean(
      uiConfig.customRoute &&
      uiConfig.customRoute.id !== 'standby' &&
      uiConfig.customRoute.lat !== null &&
      Number(uiConfig.customRoute.distKm) > 0
    );
    searchClearBtn.classList.toggle('hidden', !hasText && !hasRoute);
  }

  function renderSearchDropdownItems(results) {
    if (!searchDropdown) return;
    if (!results || results.length === 0) {
      searchDropdown.classList.add('hidden');
      searchDropdown.innerHTML = '';
      return;
    }

    searchDropdown.innerHTML = results
      .map(
        (r, idx) => `
        <button type="button" class="map-search-item" data-sidx="${idx}">
          <div style="min-width:0;flex:1;">
            <strong>📍 ${escapeHTML(r.name)}</strong>
            <small>${escapeHTML(r.region)}</small>
          </div>
          <span class="map-search-dist-pill">~${r.approxRoadKm || '--'} km • ${r.cardinal || 'N'}</span>
        </button>`
      )
      .join('');
    searchDropdown.classList.remove('hidden');

    searchDropdown.querySelectorAll('.map-search-item').forEach((itemBtn) => {
      itemBtn.addEventListener('click', async () => {
        const idx = parseInt(itemBtn.getAttribute('data-sidx'), 10) || 0;
        const picked = results[idx];
        searchDropdown.classList.add('hidden');
        if (searchInput) searchInput.value = picked.name;
        document.querySelectorAll('#map-quick-presets .mo-preset-chip').forEach((c) => c.classList.remove('active'));
        await calculateRealRouteAndElevation({
          destLat: picked.lat,
          destLon: picked.lon,
          name: picked.name,
          region: picked.region
        });
        syncClearSearchBtnVisibility();
        triggerHaptic(15);
        showToast(`🏁 Ruta trazada hacia ${picked.name}`);
      });
    });
  }

  async function executePlaceSearch(autoSelectSingle = true) {
    const q = (searchInput?.value || '').trim();
    if (!q) {
      showToast('⚠️ Escribe un pueblo, distrito, grifo o lugar');
      return;
    }
    if (autoSelectSingle) {
      showToast(`🔍 Buscando "${q}" en satélite...`);
    }
    try {
      const results = await searchPlaceByName(q);
      if (!results || results.length === 0) {
        if (searchDropdown) searchDropdown.classList.add('hidden');
        if (autoSelectSingle) {
          showToast('⚠️ No se encontró ese destino. Intenta agregando "La Libertad" o "Perú"');
        }
        return;
      }

      if (autoSelectSingle && results.length === 1) {
        if (searchDropdown) searchDropdown.classList.add('hidden');
        const chosen = results[0];
        document.querySelectorAll('#map-quick-presets .mo-preset-chip').forEach((c) => c.classList.remove('active'));
        await calculateRealRouteAndElevation({
          destLat: chosen.lat,
          destLon: chosen.lon,
          name: chosen.name,
          region: chosen.region
        });
        syncClearSearchBtnVisibility();
        showToast(`🏁 Ruta satelital trazada hacia ${chosen.name}`);
        return;
      }

      renderSearchDropdownItems(results);
    } catch (err) {
      if (autoSelectSingle) {
        showToast('⚠️ Verifica tu conexión a internet para buscar destinos');
      }
    }
  }

  if (searchBtn) {
    searchBtn.addEventListener('click', () => executePlaceSearch(true));
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      syncClearSearchBtnVisibility();
      const val = searchInput.value.trim();
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      if (val.length < 3) {
        if (searchDropdown) searchDropdown.classList.add('hidden');
        return;
      }
      searchDebounceTimer = setTimeout(() => {
        executePlaceSearch(false);
      }, 650);
    });

    searchInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        executePlaceSearch(true);
      }
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (searchDropdown) searchDropdown.classList.add('hidden');
      clearActiveRouteOnMap();
      syncClearSearchBtnVisibility();
      triggerHaptic(10);
      showToast('🗺️ Mapa en Modo Exploración Libre');
    });
  }

  // Cerrar desplegable de búsqueda al tocar fuera
  document.addEventListener('click', (e) => {
    if (searchDropdown && !searchDropdown.classList.contains('hidden')) {
      const insideHud = e.target.closest('.mo-map-top-search-hud');
      if (!insideHud) {
        searchDropdown.classList.add('hidden');
      }
    }
  });

  // Radar POI (Grifos / Miradores) en la barra del Mapa
  document.querySelectorAll('#map-quick-presets .mo-preset-chip.poi').forEach((chip) => {
    chip.addEventListener('click', async () => {
      document.querySelectorAll('#map-quick-presets .mo-preset-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      if (searchDropdown) searchDropdown.classList.add('hidden');
      triggerHaptic(12);

      const poiQuery = chip.getAttribute('data-poi-query');
      if (poiQuery) {
        const isFuel = poiQuery.toLowerCase().includes('grifo');
        showToast(`Escaneando ${isFuel ? 'grifos cercanos' : 'miradores'} en el mapa...`);
        const count = await searchAndPlotPoisOnMap(poiQuery, isFuel ? '⛽' : '📸');
        if (count > 0) {
          showToast(`${count} punto(s) marcados. Toca uno para trazar ruta.`);
        } else {
          showToast('No se hallaron puntos cercanos en este radio');
        }
        syncClearSearchBtnVisibility();
      }
    });
  });

  // ================= GESTOR DE MIS RUTAS FAVORITAS =================
  let pendingFavCoords = null;

  function openFavRoutesModal(preferActiveDest = true) {
    const r = uiConfig.customRoute;
    const hasDest = Boolean(r && r.id !== 'standby' && r.lat !== null && r.lon !== null && Number(r.distKm) > 0);
    const nameInp = document.getElementById('fav-route-name');
    const regInp = document.getElementById('fav-route-region');
    const hintEl = document.getElementById('fav-source-hint');

    if (preferActiveDest && hasDest) {
      pendingFavCoords = { lat: Number(r.lat), lon: Number(r.lon) };
      if (nameInp) nameInp.value = r.name || '';
      if (regInp) regInp.value = r.region || '';
      if (hintEl) {
        hintEl.innerHTML = `<span>Origen: <strong>Destino activo</strong> (${pendingFavCoords.lat.toFixed(4)}, ${pendingFavCoords.lon.toFixed(4)})</span>`;
      }
    } else if (uiConfig.liveGpsLat !== null && uiConfig.liveGpsLon !== null) {
      pendingFavCoords = { lat: Number(uiConfig.liveGpsLat), lon: Number(uiConfig.liveGpsLon) };
      if (nameInp) nameInp.value = '';
      if (regInp) regInp.value = 'Ubicación GPS guardada';
      if (hintEl) {
        hintEl.innerHTML = `<span>Origen: <strong>Tu ubicación GPS actual</strong> (${pendingFavCoords.lat.toFixed(4)}, ${pendingFavCoords.lon.toFixed(4)})</span>`;
      }
    } else {
      pendingFavCoords = null;
      if (nameInp) nameInp.value = '';
      if (regInp) regInp.value = '';
      if (hintEl) {
        hintEl.innerHTML = `<span>Primero busca un lugar en el mapa, toca un punto satelital o enciende <strong>GPS Vivo</strong> para guardar coordenadas.</span>`;
      }
    }

    renderFavoriteRoutesModalList();
    openModalById('modal-fav-routes');
  }

  const closeFavModal = () => closeModalById('modal-fav-routes');
  document.getElementById('btn-open-fav-modal')?.addEventListener('click', () => {
    openFavRoutesModal(true);
    triggerHaptic(10);
  });
  document.getElementById('btn-pill-save-fav')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openFavRoutesModal(true);
    triggerHaptic(10);
  });
  document.getElementById('btn-close-fav-x')?.addEventListener('click', closeFavModal);
  document.getElementById('btn-cancel-fav')?.addEventListener('click', closeFavModal);

  document.getElementById('btn-save-fav-route')?.addEventListener('click', () => {
    const name = (document.getElementById('fav-route-name')?.value || '').trim();
    const region = (document.getElementById('fav-route-region')?.value || '').trim() || 'Mi Ruta Favorita';

    if (!pendingFavCoords) {
      showToast('Busca un destino en el mapa o activa GPS Vivo primero');
      return;
    }
    if (!name) {
      showToast('Escribe un nombre para tu ruta favorita');
      document.getElementById('fav-route-name')?.focus();
      return;
    }

    if (!Array.isArray(appState.favoriteRoutes)) appState.favoriteRoutes = [];
    const existingIdx = appState.favoriteRoutes.findIndex(
      (f) =>
        Math.abs(Number(f.lat) - pendingFavCoords.lat) < 0.002 &&
        Math.abs(Number(f.lon) - pendingFavCoords.lon) < 0.002
    );
    if (existingIdx >= 0) {
      appState.favoriteRoutes[existingIdx] = {
        ...appState.favoriteRoutes[existingIdx],
        name,
        region
      };
    } else {
      appState.favoriteRoutes.unshift({
        id: Date.now(),
        name,
        region,
        lat: pendingFavCoords.lat,
        lon: pendingFavCoords.lon
      });
    }

    saveState();
    renderFavoriteRouteChips();
    renderFavoriteRoutesModalList();
    if (document.getElementById('fav-route-name')) document.getElementById('fav-route-name').value = '';
    triggerHaptic(15);
    showToast(`★ "${name}" guardado en Mis Rutas Favoritas`);
  });

  // Clic en chips dinámicos de Mis Rutas Favoritas (en el mapa y dentro del modal)
  document.getElementById('map-fav-chips-wrap')?.addEventListener('click', async (ev) => {
    const chip = ev.target.closest('[data-fav-id]');
    if (!chip) return;
    const favId = chip.getAttribute('data-fav-id');
    const fav = (appState.favoriteRoutes || []).find((f) => String(f.id) === String(favId));
    if (!fav) return;

    if (searchDropdown) searchDropdown.classList.add('hidden');
    if (searchInput) searchInput.value = fav.name;
    triggerHaptic(12);
    showToast(`Trazando ruta hacia ${fav.name}...`);
    await calculateRealRouteAndElevation({
      destLat: Number(fav.lat),
      destLon: Number(fav.lon),
      name: fav.name,
      region: fav.region
    });
    syncClearSearchBtnVisibility();
    showToast(`Ruta activa: ${fav.name}`);
  });

  document.getElementById('fav-routes-modal-list')?.addEventListener('click', async (ev) => {
    const goBtn = ev.target.closest('[data-go-fav]');
    if (goBtn) {
      const favId = goBtn.getAttribute('data-go-fav');
      const fav = (appState.favoriteRoutes || []).find((f) => String(f.id) === String(favId));
      if (!fav) return;
      closeFavModal();
      if (searchInput) searchInput.value = fav.name;
      triggerHaptic(12);
      await calculateRealRouteAndElevation({
        destLat: Number(fav.lat),
        destLon: Number(fav.lon),
        name: fav.name,
        region: fav.region
      });
      syncClearSearchBtnVisibility();
      showToast(`Ruta activa: ${fav.name}`);
      return;
    }

    const delBtn = ev.target.closest('[data-del-fav]');
    if (delBtn) {
      const favId = delBtn.getAttribute('data-del-fav');
      appState.favoriteRoutes = (appState.favoriteRoutes || []).filter((f) => String(f.id) !== String(favId));
      saveState();
      renderFavoriteRouteChips();
      renderFavoriteRoutesModalList();
      triggerHaptic(10);
      showToast('Ruta favorita eliminada');
    }
  });

  // Modal de Configuración de Ruta Manual
  let selectedRouteTerrainFactor = 1.10;
  let selectedRouteDiffLabel = 'Media • Ascenso';

  function openRouteConfigModal() {
    const r = uiConfig.customRoute || ROUTE_PRESETS[0];
    document.getElementById('cfg-route-name').value = r.id === 'standby' ? '' : (r.name || '');
    document.getElementById('cfg-route-region').value = r.id === 'standby' ? '' : (r.region || '');
    document.getElementById('cfg-route-km').value = r.distKm > 0 ? r.distKm : 42.5;
    document.getElementById('cfg-route-min').value = r.estMin > 0 ? r.estMin : 55;
    document.getElementById('cfg-route-alt').value = r.peakAlt > 34 ? r.peakAlt : 1450;
    selectedRouteTerrainFactor = r.terrainFactor || 1.10;
    selectedRouteDiffLabel = r.difficulty || 'Media • Ascenso';

    document.querySelectorAll('#cfg-route-terrain-picker .compound-pill').forEach((p) => {
      p.classList.toggle('selected', Math.abs(parseFloat(p.getAttribute('data-rterr')) - selectedRouteTerrainFactor) < 0.02);
    });
    openModalById('modal-route-cfg');
  }

  document.getElementById('btn-open-route-cfg')?.addEventListener('click', openRouteConfigModal);

  const closeRouteCfg = () => closeModalById('modal-route-cfg');
  document.getElementById('btn-close-routecfg-x')?.addEventListener('click', closeRouteCfg);
  document.getElementById('btn-cancel-routecfg')?.addEventListener('click', closeRouteCfg);

  document.querySelectorAll('#cfg-route-terrain-picker .compound-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#cfg-route-terrain-picker .compound-pill').forEach((p) => p.classList.remove('selected'));
      pill.classList.add('selected');
      selectedRouteTerrainFactor = parseFloat(pill.getAttribute('data-rterr')) || 1.10;
      selectedRouteDiffLabel = pill.getAttribute('data-rdiff') || 'Media • Ascenso';
    });
  });

  document.getElementById('btn-save-routecfg')?.addEventListener('click', () => {
    const name = document.getElementById('cfg-route-name').value.trim() || 'Destino Manual';
    const region = document.getElementById('cfg-route-region').value.trim() || 'Ruta Táctica N160 FI';
    const distKm = Math.max(1, parseFloat(document.getElementById('cfg-route-km').value) || 40);
    const estMin = Math.max(5, parseInt(document.getElementById('cfg-route-min').value, 10) || Math.round(distKm * 1.25));
    const peakAlt = Math.max(0, parseInt(document.getElementById('cfg-route-alt').value, 10) || 1200);
    const startAlt = uiConfig.liveGpsAlt !== null ? Math.round(uiConfig.liveGpsAlt) : 34;

    const stepAlt = (peakAlt - startAlt) / 6;
    const elevProfile = [
      startAlt,
      Math.round(startAlt + stepAlt * 0.9),
      Math.round(startAlt + stepAlt * 2.1),
      Math.round(startAlt + stepAlt * 3.4),
      Math.round(startAlt + stepAlt * 4.8),
      Math.round(startAlt + stepAlt * 5.6),
      peakAlt
    ];

    uiConfig.searchExpanded = false;
    uiConfig.customRoute = {
      ...uiConfig.customRoute,
      id: 'custom',
      name,
      region,
      distKm,
      estMin,
      startAlt,
      peakAlt,
      lat: uiConfig.customRoute?.lat ?? -7.9912,
      lon: uiConfig.customRoute?.lon ?? -78.6854,
      terrainFactor: selectedRouteTerrainFactor,
      difficulty: selectedRouteDiffLabel,
      elevProfile
    };

    syncClearSearchBtnVisibility();
    renderTacticalMapUI(liveEcuData, true);
    closeRouteCfg();
    triggerHaptic(15);
    showToast(`🏁 Ruta "${name}" (${distKm} km) actualizada`);
  });

  // Botón de GPS Satelital en Vivo (Sincronizado con Odómetro de Ruta, Velocidad Pico y Caja Negra)
  const btnToggleGps = document.getElementById('btn-toggle-gps');
  if (btnToggleGps) {
    btnToggleGps.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showToast('⚠️ Tu navegador no tiene soporte de geolocalización');
        return;
      }
      if (uiConfig.gpsWatchId !== null) {
        navigator.geolocation.clearWatch(uiConfig.gpsWatchId);
        uiConfig.gpsWatchId = null;
        uiConfig.liveGpsSpeedKmh = null;
        btnToggleGps.classList.remove('active');
        btnToggleGps.textContent = 'GPS Vivo';
        renderObdLiveUI(liveEcuData, false);
        renderTacticalMapUI(liveEcuData, false);
        showToast('⏹ Rastreo GPS desactivado');
        return;
      }

      showToast('🛰️ Conectando con satélites GPS...');
      btnToggleGps.classList.add('active');
      btnToggleGps.textContent = 'GPS Activo';

      let recalculatedFromGpsOnce = false;
      uiConfig.gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          const newLat = pos.coords.latitude;
          const newLon = pos.coords.longitude;
          const accuracy = pos.coords.accuracy || 20;

          const fallbackKmh = feedGpsDistanceSample(newLat, newLon, accuracy, pos.coords.speed);

          uiConfig.liveGpsLat = newLat;
          uiConfig.liveGpsLon = newLon;
          if (pos.coords.altitude !== null && !isNaN(pos.coords.altitude)) {
            uiConfig.liveGpsAlt = pos.coords.altitude;
            updateAltitudeDeltaCheck(pos.coords.altitude);
          }
          if (pos.coords.speed !== null && !isNaN(pos.coords.speed) && pos.coords.speed >= 0) {
            uiConfig.liveGpsSpeedKmh = pos.coords.speed * 3.6;
          } else {
            uiConfig.liveGpsSpeedKmh = fallbackKmh || 0;
          }

          if (!recalculatedFromGpsOnce) {
            recalculatedFromGpsOnce = true;
            const currR = uiConfig.customRoute;
            if (currR && currR.id !== 'standby' && currR.lat !== null && currR.lon !== null && Number(currR.distKm) > 0) {
              calculateRealRouteAndElevation({
                destLat: Number(currR.lat),
                destLon: Number(currR.lon),
                name: currR.name,
                region: currR.region
              });
            } else {
              centerMapOnBike(14);
              renderObdLiveUI(liveEcuData, false);
              renderTacticalMapUI(liveEcuData, false);
            }
          } else {
            renderObdLiveUI(liveEcuData, false);
            renderTacticalMapUI(liveEcuData, false);
          }
        },
        () => {
          showToast('⚠️ Activa la Ubicación de tu teléfono para usar el GPS');
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
      );
    });
  }

  const btnLayerToggle = document.getElementById('btn-map-layer-toggle');
  if (btnLayerToggle) {
    btnLayerToggle.addEventListener('click', () => {
      const isSat = toggleMapBaseLayer();
      btnLayerToggle.textContent = isSat ? 'Satélite' : 'Calles';
      triggerHaptic(10);
      showToast(isSat ? '🛰️ Vista Satelital HD Activada' : '🗺️ Vista de Calles Activada');
    });
  }

  document.getElementById('btn-map-heading-mode')?.addEventListener('click', () => {
    toggleCourseUpMode();
    triggerHaptic(12);
    showToast('▲ Vista de ruta centrada');
  });

  document.getElementById('btn-map-my-loc')?.addEventListener('click', () => {
    centerMapOnBike(15);
    triggerHaptic(10);
    if (uiConfig.gpsWatchId === null) {
      btnToggleGps?.click();
    } else {
      showToast('📍 Centrado en tu posición GPS');
    }
  });

  document.getElementById('btn-map-follow-lock')?.addEventListener('click', () => {
    const locked = toggleFollowLockMode();
    triggerHaptic(10);
    showToast(locked ? '🔒 Seguimiento automático de moto activado' : '🔓 Mapa libre (puedes explorar arrastrando)');
  });

  document.getElementById('btn-map-zoom-in')?.addEventListener('click', () => {
    zoomLeafletMap(1);
  });

  document.getElementById('btn-map-zoom-out')?.addEventListener('click', () => {
    zoomLeafletMap(-1);
  });

  document.getElementById('btn-map-open-gmaps')?.addEventListener('click', () => {
    const r = uiConfig.customRoute || ROUTE_PRESETS[0];
    if (r && r.id !== 'standby' && r.lat && r.lon) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}&travelmode=driving`, '_blank', 'noopener,noreferrer');
    } else {
      const lat = uiConfig.liveGpsLat ?? -8.1116;
      const lon = uiConfig.liveGpsLon ?? -79.0287;
      window.open(`https://www.google.com/maps/@${lat},${lon},14z`, '_blank', 'noopener,noreferrer');
    }
  });

  // Botón Modo Timón (100% Pantalla Completa Cero Scroll y Botones Grandes)
  const btnRideMode = document.getElementById('btn-obd-ride-mode');
  if (btnRideMode) {
    btnRideMode.addEventListener('click', async () => {
      closeModalById('mo-cockpit-sheet', true);
      const isRide = document.body.classList.toggle('ecu-ride-mode');
      const rideLbl = document.getElementById('sheet-ride-label');
      if (!isRide) {
        document.body.classList.remove('ecu-force-landscape');
        const rotBtnSync = document.getElementById('btn-obd-rotate');
        if (rotBtnSync) rotBtnSync.classList.remove('active-rot');
      }
      btnRideMode.classList.toggle('active-tile', isRide);
      if (rideLbl) rideLbl.textContent = isRide ? 'Salir Timón' : 'Modo Timón';
      try {
        if (isRide && document.documentElement.requestFullscreen && !document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        } else if (!isRide && document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
        }
      } catch (e) {}
      refreshLeafletSize();
      triggerHaptic(12);
      showToast(isRide ? 'Modo Timón Activo (Pantalla Completa)' : 'Vista estándar restaurada');
    });
  }

  // Botón para inyectar los kilómetros reales medidos por la ECU o GPS directo al Odómetro Total de la App
  const btnSyncSessionKm = document.getElementById('btn-obd-sync-km');
  if (btnSyncSessionKm) {
    btnSyncSessionKm.addEventListener('click', () => {
      const addKm = Math.round(Number(liveEcuData.sessionKm) || 0);
      if (addKm < 1) {
        showToast('⚠️ Rueda al menos 1 km en la sesión para sumar al odómetro');
        return;
      }
      const targetKm = appState.currentKm + addKm;
      openCustomConfirm({
        title: 'Inyectar Km de Ruta',
        message: `Se registraron +${Number(liveEcuData.sessionKm).toFixed(2)} km en este trayecto. ¿Deseas sumar ${addKm} km a tu Odómetro Total (${appState.currentKm.toLocaleString('es-PE')} → ${targetKm.toLocaleString('es-PE')} km)?`,
        confirmText: `Sumar +${addKm} km`,
        isDanger: false,
        icon: '🏁',
        onConfirm: () => {
          appState.currentKm = targetKm;
          resetSessionDistance();
          recalculateServiceKmFromLogs();
          recalculateWashFromLogs();
          saveState();
          renderAllMain();
          renderObdLiveUI(liveEcuData, true);
          triggerHaptic(20);
          showToast(`✅ Odómetro actualizado a ${targetKm.toLocaleString('es-PE')} km`);
        }
      });
    });
  }

  document.body.addEventListener('click', (e) => {
    const infoBtn = e.target.closest('[data-info-key]');
    if (infoBtn) {
      e.preventDefault();
      e.stopPropagation();
      openInfoGuide(infoBtn.getAttribute('data-info-key'));
      return;
    }

    const pickFuelBtn = e.target.closest('[data-pick-fuel]');
    if (pickFuelBtn) {
      const val = pickFuelBtn.getAttribute('data-pick-fuel');
      const inp = document.getElementById('fuel-notes');
      if (inp) {
        inp.value = val;
        triggerHaptic(10);
      }
      return;
    }

    const pickWorkBtn = e.target.closest('[data-pick-workshop]');
    if (pickWorkBtn) {
      const val = pickWorkBtn.getAttribute('data-pick-workshop');
      const inp = document.getElementById('log-workshop');
      if (inp) {
        inp.value = val;
        if (val.toLowerCase().includes('casa')) {
          document.getElementById('log-labor-cost').value = '0';
          syncMaintTotalCost();
        }
        triggerHaptic(10);
      }
      return;
    }

    const calMaintBtn = e.target.closest('[data-cal-maint]');
    if (calMaintBtn) {
      const title = calMaintBtn.getAttribute('data-cal-maint');
      const targetKm = Number(calMaintBtn.getAttribute('data-cal-targetkm')) || appState.currentKm;
      const daysLeftAttr = calMaintBtn.getAttribute('data-cal-daysleft');
      const kmLeft = Math.max(0, targetKm - appState.currentKm);
      const dailyRate = Math.max(10, estimateMonthlyKmRate() / 30);

      let daysUntil = Math.min(60, Math.max(1, Math.round(kmLeft / dailyRate)));
      if (daysLeftAttr !== '' && !isNaN(Number(daysLeftAttr))) {
        daysUntil = Math.max(1, Math.min(daysUntil, Number(daysLeftAttr)));
      }

      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + daysUntil);
      const offsetMs = targetDate.getTimezoneOffset() * 60000;
      const isoDate = new Date(targetDate.getTime() - offsetMs).toISOString().slice(0, 10);

      openGoogleCalendarEvent({
        title: `${title} (${targetKm.toLocaleString('es-PE')} km)`,
        description: `Mantenimiento preventivo programado para tu Bajaj Pulsar N160 FI a los ${targetKm.toLocaleString('es-PE')} km (Odómetro actual: ${appState.currentKm.toLocaleString('es-PE')} km).`,
        dateStr: isoDate
      });
      showToast(`📅 Abriendo Google Calendar (${isoDate})...`);
      return;
    }

    const oemCard = e.target.closest('[data-copy-code]');
    if (oemCard) {
      const code = oemCard.getAttribute('data-copy-code');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => showToast(`Código copiado: ${code}`));
      } else {
        showToast(`Código OEM: ${code}`);
      }
      return;
    }

    const quickSrvBtn = e.target.closest('[data-quick-srv]');
    if (quickSrvBtn) {
      openLogModal(quickSrvBtn.getAttribute('data-quick-srv'), null);
      return;
    }

    const editTireBtn = e.target.closest('[data-edit-tire]');
    if (editTireBtn) {
      openTireModal(editTireBtn.getAttribute('data-edit-tire'));
      return;
    }

    const editMaintBtn = e.target.closest('[data-edit-maint]');
    if (editMaintBtn) {
      const id = editMaintBtn.getAttribute('data-edit-maint');
      const found = appState.logs.find((x) => String(x.id) === String(id));
      if (found) openLogModal(null, found);
      return;
    }

    const editFuelBtn = e.target.closest('[data-edit-fuel]');
    if (editFuelBtn) {
      const id = editFuelBtn.getAttribute('data-edit-fuel');
      const found = appState.fuelLogs.find((x) => String(x.id) === String(id));
      if (found) openFuelModal(found);
      return;
    }

    const editSpaBtn = e.target.closest('[data-edit-spa]');
    if (editSpaBtn) {
      const id = editSpaBtn.getAttribute('data-edit-spa');
      const found = (appState.washLogs || []).find((x) => String(x.id) === String(id));
      if (found) openSpaModal(found);
      return;
    }

    const editModBtn = e.target.closest('[data-edit-mod]');
    if (editModBtn) {
      const id = editModBtn.getAttribute('data-edit-mod');
      const found = (appState.accessories || []).find((x) => String(x.id) === String(id));
      if (found) openModModal(found);
      return;
    }

    const editExpBtn = e.target.closest('[data-edit-exp]');
    if (editExpBtn) {
      const id = editExpBtn.getAttribute('data-edit-exp');
      const found = (appState.otherExpenses || []).find((x) => String(x.id) === String(id));
      if (found) openExpenseModal(found);
      return;
    }

    const delMaintBtn = e.target.closest('[data-del-maint]');
    if (delMaintBtn) {
      const id = delMaintBtn.getAttribute('data-del-maint');
      const title = delMaintBtn.getAttribute('data-title');
      openCustomConfirm({
        title: 'Eliminar Mantenimiento',
        message: `¿Deseas eliminar "${title}" de tu bitácora?`,
        confirmText: 'Sí, Eliminar',
        isDanger: true,
        icon: '🗑️',
        onConfirm: () => {
          appState.logs = appState.logs.filter((l) => String(l.id) !== String(id));
          recalculateServiceKmFromLogs();
          saveState();
          renderAllMain();
          showToast('Servicio eliminado');
        }
      });
      return;
    }

    const delFuelBtn = e.target.closest('[data-del-fuel]');
    if (delFuelBtn) {
      const id = delFuelBtn.getAttribute('data-del-fuel');
      const km = delFuelBtn.getAttribute('data-fuel-km');
      openCustomConfirm({
        title: 'Eliminar Abastecimiento',
        message: `¿Deseas eliminar la carga registrada a los ${Number(km).toLocaleString('es-PE')} km?`,
        confirmText: 'Sí, Eliminar',
        isDanger: true,
        icon: '⛽',
        onConfirm: () => {
          appState.fuelLogs = appState.fuelLogs.filter((x) => String(x.id) !== String(id));
          saveState();
          renderAllMain();
          showToast('Abastecimiento eliminado');
        }
      });
      return;
    }

    const delSpaBtn = e.target.closest('[data-del-spa]');
    if (delSpaBtn) {
      const id = delSpaBtn.getAttribute('data-del-spa');
      openCustomConfirm({
        title: 'Eliminar Lavado',
        message: '¿Deseas borrar este registro de lavado?',
        confirmText: 'Sí, Eliminar',
        isDanger: true,
        icon: '🚿',
        onConfirm: () => {
          appState.washLogs = appState.washLogs.filter((x) => String(x.id) !== String(id));
          recalculateWashFromLogs();
          saveState();
          renderAllMain();
          showToast('Lavado eliminado');
        }
      });
      return;
    }

    const delTireHistBtn = e.target.closest('[data-del-tire-hist]');
    if (delTireHistBtn) {
      const id = delTireHistBtn.getAttribute('data-del-tire-hist');
      openCustomConfirm({
        title: 'Eliminar del Historial',
        message: '¿Deseas borrar este neumático antiguo del historial?',
        confirmText: 'Sí, Eliminar',
        isDanger: true,
        icon: '🛞',
        onConfirm: () => {
          appState.tires.history = appState.tires.history.filter((x) => String(x.id) !== String(id));
          saveState();
          renderAllMain();
          showToast('Registro eliminado');
        }
      });
      return;
    }

    const delModBtn = e.target.closest('[data-del-mod]');
    if (delModBtn) {
      const id = delModBtn.getAttribute('data-del-mod');
      const name = delModBtn.getAttribute('data-mod-name');
      openCustomConfirm({
        title: 'Eliminar Accesorio',
        message: `¿Deseas eliminar "${name}" de tu equipamiento?`,
        confirmText: 'Sí, Eliminar',
        isDanger: true,
        icon: '🛡️',
        onConfirm: () => {
          appState.accessories = appState.accessories.filter((x) => String(x.id) !== String(id));
          saveState();
          renderAllMain();
          showToast('Accesorio eliminado');
        }
      });
      return;
    }

    const delExpBtn = e.target.closest('[data-del-exp]');
    if (delExpBtn) {
      const id = delExpBtn.getAttribute('data-del-exp');
      openCustomConfirm({
        title: 'Eliminar Gasto',
        message: '¿Deseas eliminar este gasto de tu registro?',
        confirmText: 'Sí, Eliminar',
        isDanger: true,
        icon: '🗑️',
        onConfirm: () => {
          appState.otherExpenses = appState.otherExpenses.filter((x) => String(x.id) !== String(id));
          saveState();
          renderAllMain();
          showToast('Gasto eliminado');
        }
      });
    }
  });

  document.getElementById('btn-close-info-x').addEventListener('click', closeInfoGuide);
  document.getElementById('btn-close-info-ok').addEventListener('click', closeInfoGuide);
  document.getElementById('btn-confirm-cancel').addEventListener('click', closeCustomConfirm);
  document.getElementById('btn-confirm-ok').addEventListener('click', executeConfirmCallback);

  const setupDrawer = (btnId, drawerId, arrowId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const drawer = document.getElementById(drawerId);
      const arrow = document.getElementById(arrowId);
      const isHidden = drawer.classList.toggle('hidden');
      if (arrow) arrow.textContent = isHidden ? '▾' : '▴';
    });
  };
  setupDrawer('btn-toggle-workshop-rank', 'drawer-workshop-rank', 'workshop-saved-arrow');
  setupDrawer('btn-toggle-station-rank', 'drawer-station-rank', 'station-saved-arrow');
  setupDrawer('btn-toggle-fuel-logs', 'drawer-fuel-logs', 'fuel-saved-arrow');
  setupDrawer('btn-toggle-tire-hist', 'drawer-tire-hist', 'tire-saved-arrow');
  setupDrawer('btn-toggle-spa-logs', 'drawer-spa-logs', 'spa-saved-arrow');
  setupDrawer('btn-toggle-expense-logs', 'drawer-expense-logs', 'expense-saved-arrow');
  setupDrawer('btn-toggle-manual-route', 'drawer-manual-route', 'manual-route-arrow');

  const maintSearchInp = document.getElementById('maint-search-input');
  if (maintSearchInp) {
    maintSearchInp.addEventListener('input', (e) => {
      uiConfig.maintSearchQuery = e.target.value;
      renderLogs();
    });
  }

  const fuelSearchInp = document.getElementById('fuel-search-input');
  if (fuelSearchInp) {
    fuelSearchInp.addEventListener('input', (e) => {
      uiConfig.fuelSearchQuery = e.target.value;
      renderFuelSection();
    });
  }

  document.querySelectorAll('#maint-log-filters .mod-filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#maint-log-filters .mod-filter-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      uiConfig.activeMaintFilter = pill.getAttribute('data-maintfilter');
      renderLogs();
    });
  });

  const logoInput = document.getElementById('logo-input');
  document.getElementById('logo-trigger').addEventListener('click', () => logoInput.click());
  document.getElementById('header-logo-btn').addEventListener('click', () => logoInput.click());

  logoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    compressImage(file, 300, (base64) => {
      appState.logoBase64 = base64;
      saveState();
      renderImages();
      showToast('Icono actualizado');
    });
  });

  const photoInput = document.getElementById('photo-input');
  document.getElementById('photo-trigger').addEventListener('click', () => photoInput.click());

  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    compressImage(file, 900, (base64) => {
      appState.bikePhotoBase64 = base64;
      saveState();
      renderImages();
      syncHeroCoverState(activeMainTabId, true);
      showToast('Foto de tu N160 guardada');
    });
  });

  document.getElementById('btn-start-app').addEventListener('click', () => {
    const initKm = Math.max(0, parseInt(document.getElementById('init-km-input').value, 10) || 0);
    const priceInp = document.getElementById('init-price-input');
    const initPrice = priceInp ? Math.max(0, parseFloat(priceInp.value) || 0) : 0;

    appState.initialKm = initKm;
    if (initPrice > 0) appState.bikePurchasePrice = initPrice;

    if (!appState.onboarded || appState.currentKm < initKm) {
      appState.currentKm = initKm;
      appState.tripBaseKm = initKm;
      appState.lastWashKm = initKm;
      appState.firstUseDate = getLocalISODate();
    }
    appState.onboarded = true;
    resetSweepFlag();
    recalculateServiceKmFromLogs();
    saveState();
    showMainScreen();
    showToast('⚡ Tablero N160 encendido');
  });

  document.getElementById('btn-reset-onboarding').addEventListener('click', showOnboardingScreen);

  document.getElementById('trip-reset-trigger').addEventListener('click', () => {
    const currentTrip = Math.max(0, appState.currentKm - (appState.tripBaseKm || 0));
    openCustomConfirm({
      title: 'Reiniciar TRIP A',
      message: `El medidor parcial actual (${currentTrip.toLocaleString('es-PE')} km) volverá a 0 km tomando como base tu odómetro actual de ${appState.currentKm.toLocaleString('es-PE')} km.`,
      confirmText: 'Reiniciar a 0 km',
      isDanger: false,
      icon: '↻',
      onConfirm: () => {
        appState.tripBaseKm = appState.currentKm;
        saveState();
        renderAllMain();
        showToast('TRIP A reiniciado a 0 km');
      }
    });
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchMainTab(btn.getAttribute('data-tab'));
    });
  });

  document.querySelectorAll('.subtab-maint-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.subtab-maint-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.maint-panel').forEach((p) => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(btn.getAttribute('data-maintsub'))?.classList.remove('hidden');
      triggerHaptic(8);
    });
  });

  document.querySelectorAll('.subtab-garage-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.subtab-garage-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.garage-panel').forEach((p) => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(btn.getAttribute('data-garagesub')).classList.remove('hidden');
    });
  });

  document.querySelectorAll('.subtab-spec-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.subtab-spec-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.spec-panel').forEach((p) => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(btn.getAttribute('data-specsub')).classList.remove('hidden');
    });
  });

  document.querySelectorAll('.ride-chk').forEach((chk, idx) => {
    chk.addEventListener('change', () => {
      appState.checklistState[idx] = chk.checked;
      saveState();
    });
  });

  document.getElementById('btn-reset-checklist').addEventListener('click', () => {
    appState.checklistState = [false, false, false, false, false];
    saveState();
    renderAllMain();
    showToast('Checklist reiniciado');
  });

  document.querySelectorAll('.period-btn[data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn[data-period]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      uiConfig.activePeriod = btn.getAttribute('data-period');
      renderFuelSection();
    });
  });

  document.querySelectorAll('#fin-period-picker .period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#fin-period-picker .period-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      uiConfig.activeFinPeriod = btn.getAttribute('data-finperiod') || 'all';
      renderRouteAndTCO();
    });
  });

  const btnExportCsv = document.getElementById('btn-export-fin-csv');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => {
      exportFinancialsToCSV(uiConfig.activeFinPeriod || 'all');
      triggerHaptic(15);
      showToast('📊 Reporte Excel (.csv) descargado');
    });
  }

  document.getElementById('route-km-input').addEventListener('input', renderRouteAndTCO);
  document.querySelectorAll('#route-trip-picker .route-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#route-trip-picker .route-pill').forEach((p) => p.classList.remove('selected'));
      pill.classList.add('selected');
      uiConfig.routeMultiplier = parseInt(pill.getAttribute('data-mult'), 10) || 1;
      renderRouteAndTCO();
    });
  });

  document.querySelectorAll('#route-terrain-picker .terrain-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#route-terrain-picker .terrain-pill').forEach((p) => p.classList.remove('selected'));
      pill.classList.add('selected');
      uiConfig.routeTerrainFactor = parseFloat(pill.getAttribute('data-factor')) || 1;
      renderRouteAndTCO();
    });
  });

  // Modal Odómetro
  const inputNewKm = document.getElementById('input-new-km');
  const closeKm = () => closeModalById('modal-km');

  document.getElementById('btn-open-km-modal').addEventListener('click', () => {
    inputNewKm.value = appState.currentKm;
    openModalById('modal-km');
    inputNewKm.focus();
  });
  document.getElementById('btn-cancel-km').addEventListener('click', closeKm);
  document.getElementById('btn-close-km-x').addEventListener('click', closeKm);

  document.getElementById('btn-save-km').addEventListener('click', () => {
    const val = parseInt(inputNewKm.value, 10);
    if (isNaN(val) || val < 0) return;

    const applyNewKm = (newKm) => {
      appState.currentKm = newKm;
      if (appState.tripBaseKm > newKm) {
        appState.tripBaseKm = newKm;
      }
      if (appState.initialKm > newKm) {
        appState.initialKm = newKm;
      }
      recalculateServiceKmFromLogs();
      recalculateWashFromLogs();
      saveState();
      renderAllMain();
      triggerHaptic(12);
      showToast(`Odómetro actualizado: ${newKm.toLocaleString('es-PE')} km`);
    };

    if (val < appState.currentKm) {
      closeModalById('modal-km', true);
      openCustomConfirm({
        title: '¿Corregir Odómetro hacia abajo?',
        message: `Estás ingresando ${val.toLocaleString('es-PE')} km, que es menor a tu odómetro actual (${appState.currentKm.toLocaleString('es-PE')} km). ¿Confirmas que deseas regresar el kilometraje?`,
        confirmText: 'Sí, Regresar Km',
        isDanger: true,
        icon: '⚠️',
        reuseHistoryState: true,
        onConfirm: () => applyNewKm(val)
      });
    } else {
      closeKm();
      applyNewKm(val);
    }
  });

  // Modal Precio de Compra de la Moto (CAPEX)
  const closeBikePrice = () => closeModalById('modal-bike-price');
  const editBikePriceBtn = document.getElementById('btn-edit-bike-price');
  if (editBikePriceBtn) {
    editBikePriceBtn.addEventListener('click', () => {
      document.getElementById('input-bike-price').value = appState.bikePurchasePrice > 0 ? appState.bikePurchasePrice : '';
      openModalById('modal-bike-price');
    });
  }
  document.getElementById('btn-close-bike-price-x').addEventListener('click', closeBikePrice);
  document.getElementById('btn-cancel-bike-price').addEventListener('click', closeBikePrice);
  document.getElementById('btn-save-bike-price').addEventListener('click', () => {
    const val = Math.max(0, parseFloat(document.getElementById('input-bike-price').value) || 0);
    appState.bikePurchasePrice = val;
    saveState();
    renderAllMain();
    closeBikePrice();
    triggerHaptic(12);
    showToast(`Patrimonio Moto: S/ ${val.toLocaleString('es-PE')}`);
  });

  // Modal Presupuesto Mensual
  const closeBudget = () => closeModalById('modal-budget');
  document.getElementById('btn-edit-budget').addEventListener('click', () => {
    document.getElementById('input-new-budget').value = appState.monthlyFuelBudget || 150;
    openModalById('modal-budget');
  });
  document.getElementById('btn-close-budget-x').addEventListener('click', closeBudget);
  document.getElementById('btn-cancel-budget').addEventListener('click', closeBudget);
  document.getElementById('btn-save-budget').addEventListener('click', () => {
    const val = parseFloat(document.getElementById('input-new-budget').value);
    if (!isNaN(val) && val >= 10) {
      appState.monthlyFuelBudget = val;
      saveState();
      renderAllMain();
      closeBudget();
      showToast(`Tope mensual: S/ ${val.toFixed(0)}`);
    }
  });

  // Modal Lavado / Cuidado
  const closeSpaModal = () => closeModalById('modal-spa');

  document.querySelectorAll('#spa-type-picker .compound-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#spa-type-picker .compound-pill').forEach((p) => p.classList.remove('selected'));
      pill.classList.add('selected');
      selectedSpaType = pill.getAttribute('data-spatype');
      if (!editingSpaId) {
        document.getElementById('spa-cost').value = pill.getAttribute('data-defaultcost');
      }
    });
  });

  document.getElementById('btn-do-spa').addEventListener('click', () => openSpaModal(null));
  document.getElementById('btn-close-spa-x').addEventListener('click', closeSpaModal);
  document.getElementById('btn-cancel-spa').addEventListener('click', closeSpaModal);

  document.getElementById('btn-save-spa').addEventListener('click', () => {
    const km = parseInt(document.getElementById('spa-km').value, 10) || appState.currentKm;
    const cost = parseFloat(document.getElementById('spa-cost').value) || 0;
    const date = document.getElementById('spa-date').value || getLocalISODate();
    const notes = document.getElementById('spa-notes').value.trim();

    if (km > appState.currentKm) appState.currentKm = km;

    if (editingSpaId) {
      appState.washLogs = appState.washLogs.map((w) =>
        String(w.id) === String(editingSpaId) ? { ...w, type: selectedSpaType, km, cost, date, notes } : w
      );
    } else {
      appState.washLogs.unshift({ id: Date.now(), type: selectedSpaType, km, cost, date, notes });
    }

    recalculateWashFromLogs();
    saveState();
    renderAllMain();
    closeSpaModal();
    triggerHaptic(15);
    showToast(editingSpaId ? 'Lavado actualizado' : `Lavado registrado (S/ ${cost.toFixed(2)})`);
  });

  // Modal Mantenimiento (Con soporte de auditoría de cadena)
  document.querySelectorAll('#custom-service-picker .service-option').forEach((card) => {
    card.addEventListener('click', () => selectServiceInModal(card.getAttribute('data-value')));
  });
  document.querySelectorAll('#chain-action-picker .compound-pill').forEach((pill) => {
    pill.addEventListener('click', () => selectChainActionPill(pill.getAttribute('data-chainact')));
  });
  document.getElementById('log-parts-cost').addEventListener('input', syncMaintTotalCost);
  document.getElementById('log-labor-cost').addEventListener('input', syncMaintTotalCost);

  const closeLogModal = () => closeModalById('modal-log');

  document.getElementById('btn-open-log-modal-top').addEventListener('click', () => openLogModal(null, null));
  document.getElementById('btn-open-log-modal-hist')?.addEventListener('click', () => openLogModal(null, null));
  document.getElementById('btn-cancel-log').addEventListener('click', closeLogModal);
  document.getElementById('btn-close-log-x').addEventListener('click', closeLogModal);

  document.getElementById('btn-save-log').addEventListener('click', () => {
    const partsCost = parseFloat(document.getElementById('log-parts-cost').value) || 0;
    const laborCost = parseFloat(document.getElementById('log-labor-cost').value) || 0;
    const cost = partsCost + laborCost;
    const km = parseInt(document.getElementById('log-km').value, 10) || appState.currentKm;
    const date = document.getElementById('log-date').value || getLocalISODate();
    const workshop = (document.getElementById('log-workshop')?.value || '').trim();
    const notes = document.getElementById('log-notes').value.trim();
    const chainAction = selectedServiceType === 'chain_lube' ? selectedChainAction : '';

    if (km > appState.currentKm) appState.currentKm = km;

    if (editingLogId) {
      appState.logs = appState.logs.map((l) =>
        String(l.id) === String(editingLogId)
          ? { ...l, typeId: selectedServiceType, title: selectedServiceTitle, km, partsCost, laborCost, cost, date, workshop, notes, chainAction }
          : l
      );
    } else {
      appState.logs.unshift({
        id: Date.now(),
        typeId: selectedServiceType,
        title: selectedServiceTitle,
        km,
        partsCost,
        laborCost,
        cost,
        date,
        workshop,
        notes,
        chainAction
      });
    }

    recalculateServiceKmFromLogs();
    saveState();
    renderAllMain();
    closeLogModal();
    triggerHaptic(15);
    showToast(editingLogId ? 'Servicio actualizado' : 'Servicio guardado en bitácora');
  });

  // Modal Combustible (100% Premium)
  const closeFuelModal = () => closeModalById('modal-fuel');

  ['fuel-km', 'fuel-cost', 'fuel-price-gal', 'fuel-gallons'].forEach((id) => {
    document.getElementById(id).addEventListener('input', (e) => updateFuelPreview(e.target.id));
  });
  document.getElementById('fuel-is-loan-chk')?.addEventListener('change', () => updateFuelPreview());

  document.querySelectorAll('#fuel-mode-picker .mode-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#fuel-mode-picker .mode-pill').forEach((p) => p.classList.remove('selected'));
      pill.classList.add('selected');
      selectedFullTank = pill.getAttribute('data-full') === 'true';
      updateFuelPreview();
    });
  });

  document.getElementById('btn-open-fuel-modal').addEventListener('click', () => openFuelModal(null));
  document.getElementById('btn-cancel-fuel').addEventListener('click', closeFuelModal);
  document.getElementById('btn-close-fuel-x').addEventListener('click', closeFuelModal);

  document.getElementById('btn-save-fuel').addEventListener('click', () => {
    const cost = parseFloat(document.getElementById('fuel-cost').value) || 0;
    const priceGal = parseFloat(document.getElementById('fuel-price-gal').value) || 0;
    const gallons = parseFloat(document.getElementById('fuel-gallons').value) || (priceGal > 0 ? cost / priceGal : 0);
    const km = parseInt(document.getElementById('fuel-km').value, 10) || appState.currentKm;
    const date = document.getElementById('fuel-date').value || getLocalISODate();
    const notes = document.getElementById('fuel-notes').value.trim();

    if (cost <= 0) {
      showToast('⚠️ Ingresa el monto pagado en Soles');
      document.getElementById('fuel-cost').focus();
      return;
    }

    if (priceGal > 0) appState.lastPriceGal = priceGal;
    if (km > appState.currentKm) appState.currentKm = km;

    const isLoanFill = Boolean(document.getElementById('fuel-is-loan-chk')?.checked);
    if (editingFuelId) {
      appState.fuelLogs = appState.fuelLogs.map((f) =>
        String(f.id) === String(editingFuelId)
          ? { ...f, fuelType: 'Premium', fullTank: selectedFullTank, isLoan: isLoanFill, cost, priceGal, gallons, km, date, notes }
          : f
      );
    } else {
      appState.fuelLogs.push({
        id: Date.now(),
        fuelType: 'Premium',
        fullTank: selectedFullTank,
        isLoan: isLoanFill,
        cost,
        priceGal,
        gallons,
        km,
        date,
        notes
      });
    }

    saveState();
    renderAllMain();
    closeFuelModal();
    triggerHaptic(15);
    showToast(editingFuelId ? 'Carga actualizada' : 'Abastecimiento Premium registrado');
  });

  // Modal Otros Gastos
  const closeExpenseModal = () => closeModalById('modal-expense');

  document.querySelectorAll('#expense-cat-picker .compound-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#expense-cat-picker .compound-pill').forEach((p) => p.classList.remove('selected'));
      pill.classList.add('selected');
      selectedExpenseCat = pill.getAttribute('data-expcat');
    });
  });

  document.getElementById('btn-open-expense-modal').addEventListener('click', () => openExpenseModal(null));
  document.getElementById('btn-close-expense-x').addEventListener('click', closeExpenseModal);
  document.getElementById('btn-cancel-expense').addEventListener('click', closeExpenseModal);

  document.getElementById('btn-save-expense').addEventListener('click', () => {
    const title = document.getElementById('expense-title').value.trim();
    const cost = parseFloat(document.getElementById('expense-cost').value) || 0;
    const km = parseInt(document.getElementById('expense-km').value, 10) || appState.currentKm;
    const date = document.getElementById('expense-date').value || getLocalISODate();

    if (!title || cost <= 0) {
      showToast('⚠️ Ingresa el concepto y monto del gasto');
      return;
    }

    if (km > appState.currentKm) appState.currentKm = km;

    if (editingExpenseId) {
      appState.otherExpenses = appState.otherExpenses.map((e) =>
        String(e.id) === String(editingExpenseId) ? { ...e, category: selectedExpenseCat, title, cost, km, date } : e
      );
    } else {
      appState.otherExpenses.unshift({
        id: Date.now(),
        category: selectedExpenseCat,
        title,
        cost,
        km,
        date
      });
    }

    saveState();
    renderAllMain();
    closeExpenseModal();
    triggerHaptic(15);
    showToast(editingExpenseId ? 'Gasto actualizado' : 'Gasto registrado');
  });

  // Modal Llantas (Con lectura física de milímetros de cocada)
  const closeTireModal = () => closeModalById('modal-tire');

  document.getElementById('btn-close-tire-x').addEventListener('click', closeTireModal);
  document.getElementById('btn-cancel-tire').addEventListener('click', closeTireModal);

  document.querySelectorAll('#tire-action-picker .mode-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#tire-action-picker .mode-pill').forEach((p) => p.classList.remove('selected'));
      pill.classList.add('selected');
      selectedTireAction = pill.getAttribute('data-tireaction');
      syncTireModalFields();
    });
  });

  document.querySelectorAll('#tire-compound-picker .compound-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#tire-compound-picker .compound-pill').forEach((p) => p.classList.remove('selected'));
      pill.classList.add('selected');
      selectedTireCompound = pill.getAttribute('data-compound');
      document.getElementById('tire-life-km').value = pill.getAttribute('data-life');
    });
  });

  document.getElementById('btn-save-tire').addEventListener('click', () => {
    const brand = document.getElementById('tire-brand').value.trim();
    const size = document.getElementById('tire-size').value.trim() || (editingTirePos === 'front' ? '100/80-17 TL' : '130/70-17 TL');
    const installKm = parseInt(document.getElementById('tire-install-km').value, 10) || 0;
    const lifeKm = parseInt(document.getElementById('tire-life-km').value, 10) || 16000;
    const cost = parseFloat(document.getElementById('tire-cost').value) || 0;
    const dot = document.getElementById('tire-dot').value.trim();
    const rawTread = document.getElementById('tire-tread-mm')?.value;
    const treadMm = rawTread !== '' && !isNaN(parseFloat(rawTread)) ? parseFloat(rawTread) : null;
    const date = document.getElementById('tire-date').value || getLocalISODate();

    if (!brand) {
      showToast('⚠️ Ingresa la marca y modelo de la llanta');
      document.getElementById('tire-brand').focus();
      return;
    }

    const prevTire = appState.tires[editingTirePos];
    if (selectedTireAction === 'replace' && prevTire) {
      appState.tires.history.unshift({
        id: Date.now(),
        pos: editingTirePos,
        posLabel: editingTirePos === 'front' ? 'Delantera' : 'Trasera',
        brand: prevTire.brand,
        size: prevTire.size,
        installKm: prevTire.installKm || 0,
        removedKm: installKm,
        totalRunKm: Math.max(0, installKm - (prevTire.installKm || 0)),
        cost: prevTire.cost || 0,
        dot: prevTire.dot || ''
      });
    }

    if (installKm > appState.currentKm) appState.currentKm = installKm;

    appState.tires[editingTirePos] = {
      pos: editingTirePos,
      label: editingTirePos === 'front' ? 'DELANTERA' : 'TRASERA',
      brand,
      size,
      compound: selectedTireCompound,
      installKm,
      lifeKm,
      cost,
      dot,
      treadMm,
      date
    };

    saveState();
    renderAllMain();
    closeTireModal();
    triggerHaptic(15);
    showToast(selectedTireAction === 'replace' ? 'Llanta nueva montada y anterior archivada' : 'Datos y cocada de llanta actualizados');
  });

  // Modal Accesorios / Mods
  const closeModModal = () => closeModalById('modal-mod');

  document.getElementById('btn-open-mod-modal').addEventListener('click', () => openModModal(null));
  document.getElementById('btn-close-mod-x').addEventListener('click', closeModModal);
  document.getElementById('btn-cancel-mod').addEventListener('click', closeModModal);

  document.querySelectorAll('#mod-category-picker .service-option').forEach((card) => {
    card.addEventListener('click', () => {
      const cat = card.getAttribute('data-modcat') || 'protection';
      syncModCategoryUI(cat);
      if (!editingModId) {
        const defElec = card.getAttribute('data-default-elec') || 'none';
        selectModElecModePill(defElec);
      }
    });
  });

  document.querySelectorAll('#mod-elec-picker .compound-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      selectModElecModePill(pill.getAttribute('data-modelec') || 'none');
    });
  });

  document.querySelectorAll('#mod-category-filters .mod-filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#mod-category-filters .mod-filter-pill').forEach((p) => p.classList.remove('selected', 'active'));
      pill.classList.add('active');
      uiConfig.activeModFilter = pill.getAttribute('data-modcat');
      renderGarageSection();
    });
  });

  document.getElementById('btn-save-mod').addEventListener('click', () => {
    const name = document.getElementById('mod-name').value.trim();
    const brand = document.getElementById('mod-brand').value.trim();
    const cost = parseFloat(document.getElementById('mod-cost').value) || 0;
    const km = parseInt(document.getElementById('mod-km').value, 10) || appState.currentKm;
    const date = document.getElementById('mod-date').value || getLocalISODate();
    const notes = document.getElementById('mod-notes').value.trim();

    if (!name) {
      showToast('⚠️ Ingresa el nombre del accesorio');
      document.getElementById('mod-name').focus();
      return;
    }

    if (km > appState.currentKm) appState.currentKm = km;

    if (editingModId) {
      appState.accessories = appState.accessories.map((m) =>
        String(m.id) === String(editingModId)
          ? { ...m, category: selectedModCat, elecMode: selectedModElecMode, hasElec: selectedModHasElec, name, brand, cost, km, date, notes }
          : m
      );
    } else {
      appState.accessories.unshift({
        id: Date.now(),
        category: selectedModCat,
        elecMode: selectedModElecMode,
        hasElec: selectedModHasElec,
        name,
        brand,
        cost,
        km,
        date,
        notes
      });
    }

    saveState();
    renderAllMain();
    closeModModal();
    triggerHaptic(15);
    showToast(editingModId ? 'Accesorio actualizado' : 'Accesorio agregado a tu Garaje');
  });

  // Modal Guantera Digital
  const closeDocs = () => closeModalById('modal-docs');

  document.getElementById('btn-open-docs-modal').addEventListener('click', () => {
    const d = appState.docs || {};
    document.getElementById('doc-plate').value = d.plate || '';
    document.getElementById('doc-insurance').value = d.insurance || '';
    document.getElementById('doc-soat-cost').value = d.soatCost > 0 ? d.soatCost : '';
    document.getElementById('doc-soat-exp').value = d.soatExp || '';
    document.getElementById('doc-license-exp').value = d.licenseExp || '';
    document.getElementById('doc-vin').value = d.vin || '';
    const sosInp = document.getElementById('doc-sos-phone');
    if (sosInp) sosInp.value = d.sosPhone || '';
    checkDocsStatusUI();
    syncVaultDocsUI();
    openModalById('modal-docs');
  });

  // Eventos de Bóveda Offline IndexedDB (Certificado SOAT y Tarjeta de Propiedad en Pantalla Completa)
  const soatVaultInput = document.getElementById('vault-soat-input');
  const cardVaultInput = document.getElementById('vault-card-input');

  document.getElementById('btn-vault-upload-soat')?.addEventListener('click', () => soatVaultInput?.click());
  document.getElementById('btn-vault-upload-card')?.addEventListener('click', () => cardVaultInput?.click());

  soatVaultInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    compressImage(file, 1600, async (base64) => {
      await saveVaultDocMedia('soat_cert', base64);
      await syncVaultDocsUI();
      triggerHaptic(15);
      showToast('📄 Certificado SOAT guardado offline en HD');
    }, 0.88);
    e.target.value = '';
  });

  cardVaultInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    compressImage(file, 1600, async (base64) => {
      await saveVaultDocMedia('prop_card', base64);
      await syncVaultDocsUI();
      triggerHaptic(15);
      showToast('🪪 Tarjeta de Propiedad guardada offline en HD');
    }, 0.88);
    e.target.value = '';
  });

  let vaultFsRotation = 0;
  let vaultFsZoomed = false;

  function applyVaultFsTransform() {
    const img = document.getElementById('vault-fs-img');
    const stage = document.getElementById('vault-fs-stage');
    const zoomBtn = document.getElementById('btn-vault-fs-zoom');
    if (!img || !stage) return;
    const isRotatedSide = vaultFsRotation % 180 !== 0;
    stage.classList.toggle('zoomed', vaultFsZoomed);
    img.classList.toggle('rotated-side', isRotatedSide);
    const scale = vaultFsZoomed ? 2.0 : 1;
    img.style.transform = `rotate(${vaultFsRotation}deg) scale(${scale})`;
    if (zoomBtn) zoomBtn.textContent = vaultFsZoomed ? '1x' : 'Zoom';
  }

  const showVaultPreview = async (docKey, title) => {
    const data = await getVaultDocMedia(docKey);
    if (!data) return;
    const img = document.getElementById('vault-fs-img');
    const ttl = document.getElementById('vault-fs-title');
    const topbar = document.getElementById('vault-fs-topbar');
    if (img && ttl) {
      vaultFsRotation = 0;
      vaultFsZoomed = false;
      ttl.textContent = title;
      img.src = data;
      topbar?.classList.remove('fs-hidden');
      applyVaultFsTransform();
      openModalById('modal-vault-fullscreen');
      triggerHaptic(12);
    }
  };

  document.getElementById('btn-vault-view-soat')?.addEventListener('click', () => showVaultPreview('soat_cert', 'Certificado SOAT (Offline)'));
  document.getElementById('btn-vault-view-card')?.addEventListener('click', () => showVaultPreview('prop_card', 'Tarjeta de Propiedad (Offline)'));

  document.getElementById('btn-vault-fs-close')?.addEventListener('click', () => {
    closeModalById('modal-vault-fullscreen');
    triggerHaptic(8);
  });

  document.getElementById('btn-vault-fs-rotate')?.addEventListener('click', () => {
    vaultFsRotation = (vaultFsRotation + 90) % 360;
    applyVaultFsTransform();
    triggerHaptic(10);
  });

  document.getElementById('btn-vault-fs-zoom')?.addEventListener('click', () => {
    vaultFsZoomed = !vaultFsZoomed;
    applyVaultFsTransform();
    triggerHaptic(10);
  });

  document.getElementById('vault-fs-stage')?.addEventListener('click', () => {
    document.getElementById('vault-fs-topbar')?.classList.toggle('fs-hidden');
  });

  document.getElementById('btn-vault-del-soat')?.addEventListener('click', async () => {
    await deleteVaultDocMedia('soat_cert');
    await syncVaultDocsUI();
    closeModalById('modal-vault-fullscreen');
    showToast('Documento SOAT eliminado de la bóveda');
  });

  document.getElementById('btn-vault-del-card')?.addEventListener('click', async () => {
    await deleteVaultDocMedia('prop_card');
    await syncVaultDocsUI();
    closeModalById('modal-vault-fullscreen');
    showToast('Tarjeta eliminada de la bóveda');
  });

  document.getElementById('btn-cal-soat').addEventListener('click', () => {
    const exp = document.getElementById('doc-soat-exp').value;
    if (!exp) {
      showToast('⚠️ Primero selecciona la fecha de vencimiento del SOAT');
      return;
    }
    const plate = document.getElementById('doc-plate').value.trim().toUpperCase() || 'N160';
    openGoogleCalendarEvent({
      title: `Renovar SOAT (${plate})`,
      description: `Vencimiento del SOAT de tu Bajaj Pulsar N160 FI (${plate}). Aseguradora: ${document.getElementById('doc-insurance').value || 'Vigilar'}.`,
      dateStr: exp
    });
    showToast('📅 Abriendo Google Calendar...');
  });

  document.getElementById('btn-cal-license').addEventListener('click', () => {
    const exp = document.getElementById('doc-license-exp').value;
    if (!exp) {
      showToast('⚠️ Primero selecciona la fecha de vencimiento de tu Brevete');
      return;
    }
    openGoogleCalendarEvent({
      title: 'Revalidar Brevete B-IIc',
      description: 'Fecha de vencimiento de tu licencia de conducir categoría B-IIc.',
      dateStr: exp
    });
    showToast('📅 Abriendo Google Calendar...');
  });

  document.getElementById('btn-close-docs-x').addEventListener('click', closeDocs);
  document.getElementById('btn-cancel-docs').addEventListener('click', closeDocs);

  document.getElementById('btn-save-docs').addEventListener('click', () => {
    appState.docs = {
      plate: document.getElementById('doc-plate').value.trim().toUpperCase(),
      insurance: document.getElementById('doc-insurance').value.trim(),
      soatCost: parseFloat(document.getElementById('doc-soat-cost').value) || 0,
      soatExp: document.getElementById('doc-soat-exp').value,
      licenseExp: document.getElementById('doc-license-exp').value,
      vin: document.getElementById('doc-vin').value.trim().toUpperCase(),
      sosPhone: (document.getElementById('doc-sos-phone')?.value || '').trim()
    };
    saveState();
    renderAllMain();
    closeDocs();
    showToast('Guantera Digital actualizada');
  });



  // Eventos de Autenticación Multiusuario y Nube Firebase
  const cloudBanner = document.getElementById('cloud-status-banner');
  const loggedOutBox = document.getElementById('auth-logged-out-box');
  const loggedInBox = document.getElementById('auth-logged-in-box');

  subscribeToAuthChanges((user) => {
    updateHeaderCloudIndicator(user ? 'ok' : 'idle');
    if (!cloudBanner) return;
    if (user) {
      cloudBanner.innerHTML = `<span>🟢 <strong>Piloto activo:</strong> ${escapeHTML(user.email)}<br><small>Tus datos se guardan solo en tu bóveda privada.</small></span>`;
      loggedOutBox.classList.add('hidden');
      loggedInBox.classList.remove('hidden');
    } else {
      cloudBanner.innerHTML = `<span>🔒 Inicia sesión o crea tu cuenta para respaldar tu moto en tu bóveda privada.</span>`;
      loggedOutBox.classList.remove('hidden');
      loggedInBox.classList.add('hidden');
    }
  });

  document.getElementById('btn-auth-login').addEventListener('click', async () => {
    const email = document.getElementById('auth-email-input').value.trim();
    const pass = document.getElementById('auth-pass-input').value;
    if (!email || pass.length < 6) {
      showToast('Ingresa tu correo y contraseña (mín. 6 caracteres)');
      return;
    }
    try {
      showToast('Verificando cuenta...');
      await loginPilot(email, pass);
      updateHeaderCloudIndicator('ok');
      showToast('Sesión iniciada correctamente');
    } catch (err) {
      showToast(getFriendlyAuthError(err));
    }
  });

  document.getElementById('btn-auth-register').addEventListener('click', async () => {
    const email = document.getElementById('auth-email-input').value.trim();
    const pass = document.getElementById('auth-pass-input').value;
    if (!email || pass.length < 6) {
      showToast('Usa un correo válido y contraseña de mínimo 6 caracteres');
      return;
    }
    try {
      showToast('Creando tu bóveda privada...');
      await registerPilot(email, pass);
      updateHeaderCloudIndicator('syncing');
      await pushStateToCloud(appState, { forceOverwrite: true });
      updateHeaderCloudIndicator('ok');
      showToast('Cuenta creada y moto respaldada');
    } catch (err) {
      showToast(getFriendlyAuthError(err));
    }
  });

  document.getElementById('btn-auth-reset')?.addEventListener('click', async () => {
    const email = document.getElementById('auth-email-input').value.trim();
    if (!email || !email.includes('@')) {
      showToast('Escribe tu correo arriba para enviarte el enlace de recuperación');
      document.getElementById('auth-email-input')?.focus();
      return;
    }
    try {
      showToast('Enviando enlace de recuperación...');
      await resetPilotPassword(email);
      showToast('Correo enviado. Revisa tu bandeja de entrada o spam.');
    } catch (err) {
      showToast(getFriendlyAuthError(err));
    }
  });

  document.getElementById('btn-auth-logout').addEventListener('click', async () => {
    await logoutPilot();
    updateHeaderCloudIndicator('idle');
    showToast('Sesión cerrada');
  });

  document.getElementById('btn-cloud-push').addEventListener('click', async () => {
    if (!getCurrentUser()) {
      showToast('Inicia sesión primero');
      return;
    }
    try {
      updateHeaderCloudIndicator('syncing');
      showToast('Verificando y subiendo respaldo ligero...');
      await pushStateToCloud(appState, { forceOverwrite: false });
      updateHeaderCloudIndicator('ok');
      showToast('Sincronizado en tu nube (sin fotos pesadas)');
    } catch (err) {
      if (err?.code === 'CLOUD_CONFLICT_HIGHER_DATA') {
        const meta = err.cloudMeta || {};
        updateHeaderCloudIndicator('conflict');
        closeModalById('modal-backup', true);
        openCustomConfirm({
          title: 'Respaldo superior en la nube',
          message: `Tu nube tiene ${Number(meta.currentKm || 0).toLocaleString('es-PE')} km (${meta.logsCount || 0} servicios, ${meta.fuelLogsCount || 0} cargas), mientras este equipo marca ${Number(appState.currentKm).toLocaleString('es-PE')} km. ¿Seguro que deseas SOBRESCRIBIR la nube? (Si cambiaste de teléfono, cancela y toca "Bajar de Mi Nube").`,
          confirmText: 'Sí, Sobrescribir',
          isDanger: true,
          icon: '⚠️',
          reuseHistoryState: true,
          onConfirm: async () => {
            try {
              updateHeaderCloudIndicator('syncing');
              await pushStateToCloud(appState, { forceOverwrite: true });
              updateHeaderCloudIndicator('ok');
              showToast('Nube actualizada con los datos de este equipo');
            } catch (e2) {
              updateHeaderCloudIndicator('error');
              showToast(getFriendlyAuthError(e2));
            }
          }
        });
      } else {
        updateHeaderCloudIndicator('error');
        showToast(getFriendlyAuthError(err));
        console.error(err);
      }
    }
  });

  document.getElementById('btn-cloud-pull').addEventListener('click', async () => {
    if (!getCurrentUser()) {
      showToast('Inicia sesión primero');
      return;
    }
    try {
      updateHeaderCloudIndicator('syncing');
      showToast('Consultando tu bóveda...');
      const cloudData = await pullStateFromCloud();
      updateHeaderCloudIndicator('ok');
      if (!cloudData || !isValidBackupJson(cloudData)) {
        showToast('Aún no tienes respaldo guardado en esta cuenta');
        return;
      }
      closeModalById('modal-backup', true);
      openCustomConfirm({
        title: 'Restaurar Mi Moto',
        message: `Se encontró tu respaldo privado con ${Number(cloudData.currentKm).toLocaleString('es-PE')} km. ¿Deseas cargarlo en este teléfono?`,
        confirmText: 'Sí, Restaurar',
        isDanger: false,
        icon: '☁️',
        reuseHistoryState: true,
        onConfirm: () => {
          replaceFullState(cloudData, false);
          applySurfaceMode(appState.surfaceMode || 'day');
          renderAllMain();
          showToast('Datos restaurados de tu cuenta');
        }
      });
    } catch (err) {
      updateHeaderCloudIndicator('error');
      showToast(getFriendlyAuthError(err));
      console.error(err);
    }
  });

  const closeBackup = () => closeModalById('modal-backup');
  document.getElementById('btn-open-backup-modal').addEventListener('click', () => openModalById('modal-backup'));
  document.getElementById('btn-close-backup-x').addEventListener('click', closeBackup);

  document.getElementById('btn-export').addEventListener('click', () => {
    const exportPayload = {
      ...appState,
      logoBase64: appState.logoBase64 || localStorage.getItem('mi_moto_n160_media_logo_v1') || '',
      bikePhotoBase64: appState.bikePhotoBase64 || localStorage.getItem('mi_moto_n160_media_photo_v1') || ''
    };
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', `MiMoto_N160_Respaldo_${appState.currentKm}km.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('Respaldo JSON descargado');
  });

  const importInput = document.getElementById('import-input');
  document.getElementById('btn-import-trigger').addEventListener('click', () => importInput.click());

  importInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
      try {
        const imported = JSON.parse(ev.target.result);
        if (!isValidBackupJson(imported)) {
          showToast('⚠️ Estructura de respaldo incompatible o dañada');
          return;
        }
        replaceFullState(imported, true);
        applySurfaceMode(appState.surfaceMode || 'day');
        renderAllMain();
        closeBackup();
        showToast('Copia de seguridad restaurada');
      } catch (err) {
        showToast('⚠️ Archivo JSON no válido');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  syncClearSearchBtnVisibility();
}

function handleAppShortcutActions() {
  if (!appState.onboarded) return;
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  if (!action) return;

  window.history.replaceState({}, document.title, window.location.pathname);

  setTimeout(() => {
    if (action === 'fuel') {
      switchMainTab('tab-fuel');
      openFuelModal(null);
    } else if (action === 'maint') {
      switchMainTab('tab-maint');
      openLogModal(null, null);
    } else if (action === 'spa') {
      switchMainTab('tab-garage');
      openSpaModal(null);
    } else if (action === 'cockpit') {
      switchMainTab('tab-ecu');
    }
  }, 250);
}

function initApp() {
  loadState();
  applySurfaceMode(appState.surfaceMode || 'day');
  if (appState.onboarded) {
    showMainScreen();
  } else {
    showOnboardingScreen();
  }
  setupEventListeners();
  handleAppShortcutActions();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.update();
    }).catch(() => {});

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', initApp);
