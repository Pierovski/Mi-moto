import {
  isFirebaseConfigured,
  subscribeToAuthChanges,
  getCurrentUser,
  loginPilot,
  registerPilot,
  logoutPilot,
  pushStateToCloud,
  pullStateFromCloud
} from './firebase.js';
import { DEFAULT_TIRES } from './constants.js';
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
  compressImage
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
  resetSweepFlag,
  showToast,
  openCustomConfirm,
  closeCustomConfirm,
  executeConfirmCallback,
  openInfoGuide,
  closeInfoGuide,
  renderImages,
  checkDocsStatusUI,
  renderGarageSection,
  renderLogs,
  renderFuelSection,
  renderRouteAndTCO,
  renderAllMain
} from './ui.js';

let editingLogId = null;
let selectedServiceType = 'breakin_500';
let selectedServiceTitle = '1er Servicio (500 km - Aceite + Filtro)';

let editingFuelId = null;
let selectedFullTank = true;

let editingSpaId = null;
let selectedSpaType = 'Carwash Básico';

let editingModId = null;
let selectedModCat = 'protection';
let selectedModHasElec = false;

let editingExpenseId = null;
let selectedExpenseCat = 'Cochera / Peaje';

let editingTirePos = 'front';
let selectedTireAction = 'edit';
let selectedTireCompound = 'Touring / Calle';

function applyBikeTheme(themeName = 'blue') {
  const normalized = themeName === 'grey' ? 'white' : themeName;
  appState.colorTheme = normalized;
  document.body.setAttribute('data-theme', normalized);
  const editionMap = {
    blue: 'CARIBBEAN BLUE EDITION',
    red: 'RACING RED EDITION',
    black: 'BROOKLYN BLACK EDITION',
    white: 'PEARL METALLIC WHITE EDITION'
  };
  const badge = document.getElementById('onboarding-edition-badge');
  if (badge) badge.textContent = editionMap[normalized] || editionMap.blue;

  document.querySelectorAll('.theme-pill').forEach((btn) => {
    btn.classList.toggle('selected', btn.getAttribute('data-theme') === normalized);
  });
}

function updateHeaderCloudIndicator(status = 'idle') {
  const pill = document.getElementById('cloud-live-indicator');
  const text = document.getElementById('cloud-live-text');
  if (!pill || !text) return;

  pill.classList.remove('syncing', 'ok', 'error');
  const user = getCurrentUser();

  if (!user) {
    text.textContent = 'Local';
    return;
  }

  if (status === 'syncing') {
    pill.classList.add('syncing');
    text.textContent = 'Subiendo...';
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
        .map((st) => `<button type="button" class="quick-pick-pill" data-pick-fuel="${escapeHTML(st)}">⛽ ${escapeHTML(st)}</button>`)
        .join('');
  }

  if (workBox) {
    workBox.innerHTML =
      `<span class="quick-pick-label">Rápido:</span>` +
      picks.workshops
        .map((w) => `<button type="button" class="quick-pick-pill" data-pick-workshop="${escapeHTML(w)}">🏪 ${escapeHTML(w)}</button>`)
        .join('');
  }
}

function switchMainTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-content').forEach((c) => {
    c.classList.toggle('hidden', c.id !== tabId);
  });
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
}

// ================= MODALES DE TALLER (CREAR Y EDITAR) =================
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
      banner.innerHTML = `<span>🧠 <strong>Memoria (${prevKm} km):</strong> Antes S/ ${prevCost.toFixed(2)} • <strong style="color:var(--neon-lime)">▼ Ahorras S/ ${Math.abs(diff).toFixed(2)} hoy</strong>.</span>`;
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
    selectServiceInModal(editItem.typeId || 'other');
  } else {
    document.getElementById('log-parts-cost').value = '';
    document.getElementById('log-labor-cost').value = '';
    document.getElementById('log-cost').value = '';
    document.getElementById('log-km').value = appState.currentKm;
    document.getElementById('log-date').value = getLocalISODate();
    if (workshopInput) workshopInput.value = '';
    document.getElementById('log-notes').value = '';
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
        fuelMemBanner.innerHTML = `<span>🧠 <strong>Memoria de galón:</strong> Antes S/ ${prevP.toFixed(2)} • <strong style="color:var(--neon-lime)">▼ Bajó S/ ${Math.abs(diffP).toFixed(2)} por galón</strong>.</span>`;
      } else {
        fuelMemBanner.innerHTML = `<span>🧠 <strong>Memoria de galón:</strong> Antes S/ ${prevP.toFixed(2)} • <strong style="color:var(--amber-warn)">▲ Subió S/ ${diffP.toFixed(2)} por galón</strong>.</span>`;
      }
    } else {
      fuelMemBanner.innerHTML = `<span>🧠 <strong>Último precio pagado:</strong> S/ ${prevP.toFixed(2)} por galón Premium.</span>`;
    }
  }

  if (appState.loanModeActive && !editingFuelId) {
    livePreview.innerHTML = `🤝 <strong>Modo Préstamo Activo:</strong> Esta carga quedará aislada para no alterar tu rendimiento personal (km/gal).`;
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
    livePreview.innerHTML = `Tramo Real: <strong>+${delta} km</strong> • Rendimiento: <strong style="color:var(--neon-lime)">${eff.toFixed(1)} km/gal</strong> • Costo: <strong>S/ ${cKm.toFixed(2)}/km</strong>`;
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

  selectedModCat = editItem ? editItem.category : 'protection';
  selectedModHasElec = editItem ? Boolean(editItem.hasElec) : false;

  document.querySelectorAll('#mod-category-picker .service-option').forEach((c) => {
    c.classList.toggle('selected', c.getAttribute('data-modcat') === selectedModCat);
  });

  if (editItem) {
    document.getElementById('mod-name').value = editItem.name || '';
    document.getElementById('mod-brand').value = editItem.brand || '';
    document.getElementById('mod-cost').value = editItem.cost || '';
    document.getElementById('mod-km').value = editItem.km || 0;
    document.getElementById('mod-date').value = editItem.date || getLocalISODate();
    document.getElementById('mod-notes').value = editItem.notes || '';
  } else {
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

  if (selectedTireAction === 'replace') {
    document.getElementById('tire-brand').value = '';
    document.getElementById('tire-size').value = curr.size || (editingTirePos === 'front' ? '100/80-17 TL' : '130/70-17 TL');
    document.getElementById('tire-install-km').value = appState.currentKm;
    document.getElementById('tire-cost').value = '';
    document.getElementById('tire-dot').value = '';
    document.getElementById('tire-date').value = getLocalISODate();
    memBanner.innerHTML = `<span>🔄 <strong>Montar Nueva:</strong> La llanta actual (${escapeHTML(curr.brand)}) pasará automáticamente al historial de llantas anteriores.</span>`;
  } else {
    document.getElementById('tire-brand').value = curr.brand.includes('(Fábrica)') ? '' : curr.brand;
    document.getElementById('tire-size').value = curr.size || (editingTirePos === 'front' ? '100/80-17 TL' : '130/70-17 TL');
    document.getElementById('tire-install-km').value = curr.installKm || 0;
    document.getElementById('tire-life-km').value = curr.lifeKm || (editingTirePos === 'front' ? 18000 : 16000);
    document.getElementById('tire-cost').value = curr.cost > 0 ? curr.cost : '';
    document.getElementById('tire-dot').value = curr.dot || '';
    document.getElementById('tire-date').value = curr.date || getLocalISODate();
    memBanner.innerHTML = `<span>✏️ <strong>Modo Edición:</strong> Actualiza la marca (ej. Timsun, Pirelli), el código DOT o corrige datos sin archivar la llanta actual.</span>`;
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
function setupEventListeners() {
  window.addEventListener('popstate', () => {
    const modalPriority = [
      'modal-confirm',
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
      'modal-mod'
    ];
    for (const id of modalPriority) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) {
        closeModalById(id, true);
        return;
      }
    }
  });

  window.addEventListener('cloud-sync-status', (ev) => {
    updateHeaderCloudIndicator(ev.detail);
  });

  const cloudHeaderPill = document.getElementById('cloud-live-indicator');
  if (cloudHeaderPill) {
    cloudHeaderPill.addEventListener('click', () => openModalById('modal-backup'));
  }

  document.body.addEventListener('click', (e) => {
    const infoBtn = e.target.closest('[data-info-key]');
    if (infoBtn) {
      e.preventDefault();
      e.stopPropagation();
      openInfoGuide(infoBtn.getAttribute('data-info-key'));
      return;
    }

    // Píldoras de Autocompletado Rápido (Grifos y Talleres)
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

    // Agendar Mantenimiento directo en Google Calendar
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
      const isoDate = targetDate.toISOString().slice(0, 10);

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
  setupDrawer('btn-toggle-maint-logs', 'drawer-maint-logs', 'maint-saved-arrow');
  setupDrawer('btn-toggle-station-rank', 'drawer-station-rank', 'station-saved-arrow');
  setupDrawer('btn-toggle-fuel-logs', 'drawer-fuel-logs', 'fuel-saved-arrow');
  setupDrawer('btn-toggle-tire-hist', 'drawer-tire-hist', 'tire-saved-arrow');
  setupDrawer('btn-toggle-spa-logs', 'drawer-spa-logs', 'spa-saved-arrow');
  setupDrawer('btn-toggle-expense-logs', 'drawer-expense-logs', 'expense-saved-arrow');

  // Buscadores Instantáneos en Bitácoras (Taller y Grifo)
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

  // Botón de Modo Préstamo
  const loanToggleBtn = document.getElementById('btn-toggle-loan-mode');
  if (loanToggleBtn) {
    loanToggleBtn.addEventListener('click', () => {
      appState.loanModeActive = !appState.loanModeActive;
      saveState();
      renderFuelSection();
      triggerHaptic(15);
      showToast(
        appState.loanModeActive
          ? '🤝 Modo Préstamo Activado (Cargas aisladas)'
          : '⚡ Modo Préstamo Desactivado'
      );
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

  document.querySelectorAll('.subtab-garage-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.subtab-garage-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.garage-panel').forEach((p) => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(btn.getAttribute('data-garagesub')).classList.remove('hidden');
    });
  });

  document.querySelectorAll('.subtab-route-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.subtab-route-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.route-panel').forEach((p) => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(btn.getAttribute('data-routesub')).classList.remove('hidden');
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

  // Selector de Periodo exclusivo de la Pestaña Grifo
  document.querySelectorAll('.period-btn[data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn[data-period]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      uiConfig.activePeriod = btn.getAttribute('data-period');
      renderFuelSection();
    });
  });

  // Filtro por Periodo en Pestaña Finanzas + Exportar Excel CSV
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

  // Modal Odómetro (Con soporte limpio para corregir hacia abajo con alerta)
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
      // Cierra modal-km sin llamar a history.back() para que no cierre el modal de confirmación
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

  // Modal Mantenimiento
  document.querySelectorAll('#custom-service-picker .service-option').forEach((card) => {
    card.addEventListener('click', () => selectServiceInModal(card.getAttribute('data-value')));
  });
  document.getElementById('log-parts-cost').addEventListener('input', syncMaintTotalCost);
  document.getElementById('log-labor-cost').addEventListener('input', syncMaintTotalCost);

  const closeLogModal = () => closeModalById('modal-log');

  document.getElementById('btn-open-log-modal-top').addEventListener('click', () => openLogModal(null, null));
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

    if (km > appState.currentKm) appState.currentKm = km;

    if (editingLogId) {
      appState.logs = appState.logs.map((l) =>
        String(l.id) === String(editingLogId)
          ? { ...l, typeId: selectedServiceType, title: selectedServiceTitle, km, partsCost, laborCost, cost, date, workshop, notes }
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
        notes
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

    if (editingFuelId) {
      appState.fuelLogs = appState.fuelLogs.map((f) =>
        String(f.id) === String(editingFuelId)
          ? { ...f, fuelType: 'Premium', fullTank: selectedFullTank, cost, priceGal, gallons, km, date, notes }
          : f
      );
    } else {
      appState.fuelLogs.push({
        id: Date.now(),
        fuelType: 'Premium',
        fullTank: selectedFullTank,
        isLoan: Boolean(appState.loanModeActive),
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

  // Modal Llantas
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
      date
    };

    saveState();
    renderAllMain();
    closeTireModal();
    triggerHaptic(15);
    showToast(selectedTireAction === 'replace' ? 'Llanta nueva montada y anterior archivada' : 'Datos de llanta actualizados');
  });

  // Modal Accesorios / Mods
  const closeModModal = () => closeModalById('modal-mod');

  document.getElementById('btn-open-mod-modal').addEventListener('click', () => openModModal(null));
  document.getElementById('btn-close-mod-x').addEventListener('click', closeModModal);
  document.getElementById('btn-cancel-mod').addEventListener('click', closeModModal);

  const modTipsByCat = {
    protection: '🛡️ Tip: En sliders de motor para la N160 verifica que usen pernos de acero grado 8.8 o 10.9 y topes de nylon/delrin.',
    security: '🚨 Tip: Exige instalación con relé y fusible independiente sin pelar el ramal original FI. Consumo en reposo < 3 mA.',
    electric: '⚡ Tip: Conecta cargadores USB o exploradoras únicamente a línea bajo llave (contacto ACC) para proteger la batería de 4Ah.',
    gear: '🪖 Tip: El poliestireno expandido (EPS) de un casco certificado se degrada a los 4 años de uso; la app calculará su vigencia.'
  };

  document.querySelectorAll('#mod-category-picker .service-option').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#mod-category-picker .service-option').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedModCat = card.getAttribute('data-modcat');
      selectedModHasElec = card.getAttribute('data-elec') === 'true';
      document.getElementById('mod-smart-tip').innerHTML = `<span>${modTipsByCat[selectedModCat] || ''}</span>`;
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
          ? { ...m, category: selectedModCat, hasElec: selectedModHasElec, name, brand, cost, km, date, notes }
          : m
      );
    } else {
      appState.accessories.unshift({
        id: Date.now(),
        category: selectedModCat,
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

  // Modal Guantera Digital (Con enlace directo a Google Calendar)
  const closeDocs = () => closeModalById('modal-docs');

  document.getElementById('btn-open-docs-modal').addEventListener('click', () => {
    const d = appState.docs || {};
    document.getElementById('doc-plate').value = d.plate || '';
    document.getElementById('doc-insurance').value = d.insurance || '';
    document.getElementById('doc-soat-cost').value = d.soatCost > 0 ? d.soatCost : '';
    document.getElementById('doc-soat-exp').value = d.soatExp || '';
    document.getElementById('doc-license-exp').value = d.licenseExp || '';
    document.getElementById('doc-vin').value = d.vin || '';
    checkDocsStatusUI();
    openModalById('modal-docs');
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
      vin: document.getElementById('doc-vin').value.trim().toUpperCase()
    };
    saveState();
    renderAllMain();
    closeDocs();
    showToast('Guantera Digital actualizada');
  });

  // Selector de Color de la Moto (Azul, Roja, Negra y Blanca)
  document.querySelectorAll('.theme-pill').forEach((pill) => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const chosen = pill.getAttribute('data-theme') || 'blue';
      applyBikeTheme(chosen);
      saveState();
      showToast(`🎨 Tema aplicado`);
    });
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
      showToast('⚠️ Ingresa tu correo y contraseña (mín. 6 caracteres)');
      return;
    }
    try {
      showToast('🔑 Verificando cuenta...');
      await loginPilot(email, pass);
      updateHeaderCloudIndicator('ok');
      showToast('✅ Sesión iniciada');
    } catch (err) {
      showToast('⚠️ Correo o contraseña incorrectos');
    }
  });

  document.getElementById('btn-auth-register').addEventListener('click', async () => {
    const email = document.getElementById('auth-email-input').value.trim();
    const pass = document.getElementById('auth-pass-input').value;
    if (!email || pass.length < 6) {
      showToast('⚠️ Usa un correo válido y contraseña de mínimo 6 caracteres');
      return;
    }
    try {
      showToast('✨ Creando tu bóveda privada...');
      await registerPilot(email, pass);
      updateHeaderCloudIndicator('syncing');
      await pushStateToCloud(appState);
      updateHeaderCloudIndicator('ok');
      showToast('✅ Cuenta creada y moto respaldada');
    } catch (err) {
      showToast('⚠️ Ese correo ya está registrado o no es válido');
    }
  });

  document.getElementById('btn-auth-logout').addEventListener('click', async () => {
    await logoutPilot();
    updateHeaderCloudIndicator('idle');
    showToast('🚪 Sesión cerrada');
  });

  document.getElementById('btn-cloud-push').addEventListener('click', async () => {
    if (!getCurrentUser()) {
      showToast('⚠️ Inicia sesión primero');
      return;
    }
    try {
      updateHeaderCloudIndicator('syncing');
      showToast('☁️ Subiendo a tu bóveda privada...');
      await pushStateToCloud(appState);
      updateHeaderCloudIndicator('ok');
      showToast('✅ Sincronizado en tu nube');
    } catch (err) {
      updateHeaderCloudIndicator('error');
      showToast('⚠️ Error al subir a Firebase');
      console.error(err);
    }
  });

  document.getElementById('btn-cloud-pull').addEventListener('click', async () => {
    if (!getCurrentUser()) {
      showToast('⚠️ Inicia sesión primero');
      return;
    }
    try {
      updateHeaderCloudIndicator('syncing');
      showToast('🔄 Consultando tu bóveda...');
      const cloudData = await pullStateFromCloud();
      updateHeaderCloudIndicator('ok');
      if (!cloudData || !isValidBackupJson(cloudData)) {
        showToast('⚠️ Aún no tienes respaldo guardado en esta cuenta');
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
          replaceFullState(cloudData);
          applyBikeTheme(appState.colorTheme || 'blue');
          renderAllMain();
          showToast('✅ Datos restaurados de tu cuenta');
        }
      });
    } catch (err) {
      updateHeaderCloudIndicator('error');
      showToast('⚠️ Error de conexión con Firebase');
      console.error(err);
    }
  });

  const closeBackup = () => closeModalById('modal-backup');
  document.getElementById('btn-open-backup-modal').addEventListener('click', () => openModalById('modal-backup'));
  document.getElementById('btn-close-backup-x').addEventListener('click', closeBackup);

  document.getElementById('btn-export').addEventListener('click', () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(appState, null, 2));
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
        replaceFullState(imported);
        applyBikeTheme(appState.colorTheme || 'blue');
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
}

// Ejecuta los Shortcuts de Pantalla de Inicio (?action=fuel | maint | spa)
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
    }
  }, 250);
}

function initApp() {
  loadState();
  applyBikeTheme(appState.colorTheme || 'blue');
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
