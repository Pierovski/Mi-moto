import { STORAGE_KEY, CURRENT_SCHEMA_VERSION, DEFAULT_TIRES } from './constants.js';
import { scheduleAutoCloudSync } from './firebase.js';


// Instancia única global de AudioContext (Evita saturar el límite de hardware móvil)
let sharedAudioCtx = null;

export function getLocalISODate() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

export function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function triggerHaptic(ms = 12) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(ms);
    } catch (e) {}
  }
}

export function compressImage(file, maxWidth, callback) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      callback(canvas.toDataURL('image/jpeg', 0.65));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

export function playN160IgnitionSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioCtx();
    }
    const ctx = sharedAudioCtx;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // 1. Cebado de bomba de inyección FI
    const pumpOsc = ctx.createOscillator();
    const pumpGain = ctx.createGain();
    pumpOsc.type = 'sine';
    pumpOsc.frequency.setValueAtTime(1950, now);
    pumpOsc.frequency.exponentialRampToValueAtTime(2200, now + 0.22);
    pumpGain.gain.setValueAtTime(0.015, now);
    pumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    pumpOsc.connect(pumpGain);
    pumpGain.connect(ctx.destination);
    pumpOsc.start(now);
    pumpOsc.stop(now + 0.26);

    // 2. Pulso monocilíndrico 164.82cc Underbelly
    const engOsc = ctx.createOscillator();
    const subOsc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const masterGain = ctx.createGain();

    engOsc.type = 'sawtooth';
    subOsc.type = 'triangle';

    engOsc.frequency.setValueAtTime(42, now + 0.12);
    engOsc.frequency.exponentialRampToValueAtTime(138, now + 0.36);
    engOsc.frequency.exponentialRampToValueAtTime(76, now + 0.85);
    engOsc.frequency.setValueAtTime(72, now + 1.15);

    subOsc.frequency.setValueAtTime(21, now + 0.12);
    subOsc.frequency.exponentialRampToValueAtTime(69, now + 0.36);
    subOsc.frequency.exponentialRampToValueAtTime(38, now + 0.85);

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.setValueAtTime(18, now + 0.12);
    lfo.frequency.exponentialRampToValueAtTime(28, now + 0.36);
    lfo.frequency.exponentialRampToValueAtTime(15, now + 0.9);
    lfoGain.gain.setValueAtTime(18, now + 0.12);
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, now + 0.12);
    filter.frequency.exponentialRampToValueAtTime(520, now + 0.36);
    filter.frequency.exponentialRampToValueAtTime(210, now + 0.95);
    filter.Q.value = 4.2;

    masterGain.gain.setValueAtTime(0.001, now);
    masterGain.gain.linearRampToValueAtTime(0.22, now + 0.2);
    masterGain.gain.linearRampToValueAtTime(0.32, now + 0.36);
    masterGain.gain.exponentialRampToValueAtTime(0.12, now + 0.85);
    masterGain.gain.exponentialRampToValueAtTime(0.0008, now + 1.38);

    engOsc.connect(filter);
    subOsc.connect(filter);
    filter.connect(masterGain);
    masterGain.connect(ctx.destination);

    engOsc.start(now + 0.12);
    subOsc.start(now + 0.12);
    lfo.start(now + 0.12);

    engOsc.stop(now + 1.4);
    subOsc.stop(now + 1.4);
    lfo.stop(now + 1.4);
  } catch (e) {}
}

export function createDefaultState() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    onboarded: false,
    bikeModel: 'Bajaj Pulsar N160 FI',
    colorTheme: 'blue',
    bikePurchasePrice: 0,
    loanModeActive: false,
    initialKm: 0,
    currentKm: 0,
    tripBaseKm: 0,
    lastPriceGal: '',
    monthlyFuelBudget: 150,
    lastWashKm: 0,
    lastWashDate: '',
    firstUseDate: getLocalISODate(),
    logoBase64: '',
    bikePhotoBase64: '',
    checklistState: [false, false, false, false, false],
    docs: {
      plate: '',
      insurance: '',
      soatExp: '',
      soatCost: 0,
      licenseExp: '',
      vin: ''
    },
    tires: {
      front: { ...DEFAULT_TIRES.front },
      rear: { ...DEFAULT_TIRES.rear },
      history: []
    },
    accessories: [],
    otherExpenses: [],
    lastServiceKm: {
      breakin_500: null,
      chain_lube: 0,
      oil_change: 0,
      air_spark: 0,
      brakes_abs: 0,
      valve_calib: 0,
      fork_oil: 0
    },
    lastServiceDate: {},
    logs: [],
    fuelLogs: [],
    washLogs: []
  };
}

export let appState = createDefaultState();

export function recalculateWashFromLogs() {
  if (!appState.washLogs || appState.washLogs.length === 0) return;
  const sorted = [...appState.washLogs].sort((a, b) => Number(b.km) - Number(a.km) || b.id - a.id);
  appState.lastWashKm = Number(sorted[0].km) || 0;
  appState.lastWashDate = sorted[0].date || '';
}

export function recalculateServiceKmFromLogs() {
  const baseKm = Number(appState.initialKm) || 0;
  const freshKmMap = {
    breakin_500: null,
    chain_lube: baseKm,
    oil_change: baseKm,
    air_spark: baseKm,
    brakes_abs: baseKm,
    valve_calib: baseKm,
    fork_oil: baseKm
  };
  const freshDateMap = {};

  const sortedAsc = [...appState.logs].sort((a, b) => Number(a.km) - Number(b.km) || a.id - b.id);
  sortedAsc.forEach((log) => {
    const km = Number(log.km) || 0;
    const date = log.date || '';
    if (log.typeId === 'breakin_500') {
      freshKmMap.breakin_500 = km;
      freshKmMap.oil_change = Math.max(freshKmMap.oil_change, km);
      if (date) {
        freshDateMap.breakin_500 = date;
        freshDateMap.oil_change = date;
      }
    } else if (Object.prototype.hasOwnProperty.call(freshKmMap, log.typeId)) {
      if (km >= freshKmMap[log.typeId]) {
        freshKmMap[log.typeId] = km;
        if (date) freshDateMap[log.typeId] = date;
      }
    }
  });

  appState.lastServiceKm = freshKmMap;
  appState.lastServiceDate = freshDateMap;
}

export function migrateAndNormalizeState(raw) {
  const base = createDefaultState();
  if (!raw || typeof raw !== 'object') return base;

  let inferredInitKm = Number(raw.initialKm);
  if (isNaN(inferredInitKm)) {
    const allRecordedKms = [
      ...(Array.isArray(raw.fuelLogs) ? raw.fuelLogs.map((f) => Number(f.km)) : []),
      ...(Array.isArray(raw.logs) ? raw.logs.map((l) => Number(l.km)) : []),
      ...(Array.isArray(raw.washLogs) ? raw.washLogs.map((w) => Number(w.km)) : [])
    ].filter((n) => !isNaN(n) && n >= 0);

    inferredInitKm = allRecordedKms.length > 0 ? Math.min(...allRecordedKms) : 0;
  }

  const normalizedLogs = (Array.isArray(raw.logs) ? raw.logs : []).map((l) => {
    const totalCost = Number(l.cost) || 0;
    const partsCost = l.partsCost !== undefined ? Number(l.partsCost) : totalCost;
    const laborCost = l.laborCost !== undefined ? Number(l.laborCost) : 0;
    return {
      ...l,
      partsCost,
      laborCost,
      cost: partsCost + laborCost > 0 ? partsCost + laborCost : totalCost,
      workshop: l.workshop || ''
    };
  });

  const normalizedFuelLogs = (Array.isArray(raw.fuelLogs) ? raw.fuelLogs : []).map((f) => ({
    ...f,
    fuelType: 'Premium'
  }));

  const merged = {
    ...base,
    ...raw,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    colorTheme: raw.colorTheme || 'blue',
    bikePurchasePrice: Math.max(0, Number(raw.bikePurchasePrice) || 0),
    loanModeActive: Boolean(raw.loanModeActive),
    initialKm: Math.max(0, inferredInitKm),
    currentKm: Math.max(0, Number(raw.currentKm) || 0),
    tripBaseKm: Number(raw.tripBaseKm) || 0,
    lastPriceGal: raw.lastPriceGal || '',
    monthlyFuelBudget: Number(raw.monthlyFuelBudget) > 0 ? Number(raw.monthlyFuelBudget) : 150,
    lastWashKm: Number(raw.lastWashKm) || 0,
    lastWashDate: raw.lastWashDate || '',
    firstUseDate: raw.firstUseDate || getLocalISODate(),
    checklistState: Array.isArray(raw.checklistState) ? raw.checklistState : [false, false, false, false, false],
    docs: {
      ...base.docs,
      ...(raw.docs || {}),
      soatCost: Number(raw.docs?.soatCost) || 0
    },
    tires: {
      front: { ...DEFAULT_TIRES.front, ...(raw.tires?.front || {}) },
      rear: { ...DEFAULT_TIRES.rear, ...(raw.tires?.rear || {}) },
      history: Array.isArray(raw.tires?.history) ? raw.tires.history : []
    },
    accessories: Array.isArray(raw.accessories) ? raw.accessories : [],
    otherExpenses: Array.isArray(raw.otherExpenses) ? raw.otherExpenses : [],
    logs: normalizedLogs,
    fuelLogs: normalizedFuelLogs,
    washLogs: Array.isArray(raw.washLogs) ? raw.washLogs : []
  };

  delete merged.rainMode;
  return merged;
}

export function isValidBackupJson(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (typeof obj.currentKm === 'undefined' || isNaN(Number(obj.currentKm))) return false;
  if ('logs' in obj && !Array.isArray(obj.logs)) return false;
  if ('fuelLogs' in obj && !Array.isArray(obj.fuelLogs)) return false;
  if ('tires' in obj && (typeof obj.tires !== 'object' || obj.tires === null)) return false;
  return true;
}

export function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      appState = migrateAndNormalizeState(parsed);
      recalculateServiceKmFromLogs();
      recalculateWashFromLogs();
      saveState();
    } catch (e) {
      console.error('Error al cargar estado:', e);
    }
  }
}

export function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    scheduleAutoCloudSync(appState, (status) => {
      window.dispatchEvent(new CustomEvent('cloud-sync-status', { detail: status }));
    });
    return true;
  } catch (e) {
    console.error('Error al guardar en localStorage (posible límite de cuota):', e);
    alert('⚠️ Memoria llena: La imagen es muy pesada o alcanzaste el límite del navegador. Exporta tu respaldo JSON.');
    return false;
  }
}

export function replaceFullState(newStateObj) {
  appState = migrateAndNormalizeState(newStateObj);
  recalculateServiceKmFromLogs();
  recalculateWashFromLogs();
  saveState();
}
