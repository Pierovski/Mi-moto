import { getCurrentUser, pushStateToCloud } from './firebase.js';
import { STORAGE_KEY, CURRENT_SCHEMA_VERSION, DEFAULT_TIRES } from './constants.js';

const LOGO_STORAGE_KEY = 'mi_moto_n160_media_logo_v1';
const PHOTO_STORAGE_KEY = 'mi_moto_n160_media_photo_v1';

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


// ================= BÓVEDA OFFLINE INDEXEDDB (CERTIFICADO SOAT & TARJETA PROPIEDAD) =================
const VAULT_DB_NAME = 'mi_moto_n160_vault_db';
const VAULT_STORE_NAME = 'docs_media';

function openVaultDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const req = window.indexedDB.open(VAULT_DB_NAME, 1);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(VAULT_STORE_NAME)) {
        db.createObjectStore(VAULT_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveVaultDocMedia(docKey, base64Data) {
  try {
    const db = await openVaultDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
      tx.objectStore(VAULT_STORE_NAME).put(base64Data, docKey);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('Reserva localStorage para doc:', e);
    try {
      localStorage.setItem(`mi_moto_vault_${docKey}`, base64Data);
      return true;
    } catch (err) {
      return false;
    }
  }
}

export async function getVaultDocMedia(docKey) {
  try {
    const db = await openVaultDB();
    return new Promise((resolve) => {
      const tx = db.transaction(VAULT_STORE_NAME, 'readonly');
      const req = tx.objectStore(VAULT_STORE_NAME).get(docKey);
      req.onsuccess = () => resolve(req.result || localStorage.getItem(`mi_moto_vault_${docKey}`) || '');
      req.onerror = () => resolve(localStorage.getItem(`mi_moto_vault_${docKey}`) || '');
    });
  } catch (e) {
    return localStorage.getItem(`mi_moto_vault_${docKey}`) || '';
  }
}

export async function deleteVaultDocMedia(docKey) {
  try {
    localStorage.removeItem(`mi_moto_vault_${docKey}`);
    const db = await openVaultDB();
    return new Promise((resolve) => {
      const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
      tx.objectStore(VAULT_STORE_NAME).delete(docKey);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    return false;
  }
}

export function createDefaultState() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    onboarded: false,
    bikeModel: 'Bajaj Pulsar N160 FI',
    colorTheme: 'blue',
    sunlightMode: false,
    rideLoadMode: 'solo', // 'solo' (25/28 PSI) | 'pillion' (25/32 PSI + Monoshock Pos 4-5)
    bikePurchasePrice: 0,
    nightDrainTest: {
      baseVolt: 0,
      baseTimeMs: 0,
      morningVolt: 0,
      morningTimeMs: 0,
      hoursElapsed: 0,
      dropVolt: 0
    },
    favoriteRoutes: [],
    sprintRecords: {
      best060: null,
      best080: null,
      last060: null,
      last080: null,
      updatedAt: ''
    },
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
      vin: '',
      sosPhone: '' // Teléfono de emergencia o asistencia rápida
    },
    tires: {
      front: { ...DEFAULT_TIRES.front, treadMm: null },
      rear: { ...DEFAULT_TIRES.rear, treadMm: null },
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
      fi_injector: 0,
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
    fi_injector: baseKm,
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
      workshop: l.workshop || '',
      chainAction: l.chainAction || (l.typeId === 'chain_lube' ? 'lube_only' : '')
    };
  });

  const normalizedFuelLogs = (Array.isArray(raw.fuelLogs) ? raw.fuelLogs : []).map((f) => ({
    ...f,
    fuelType: 'Premium'
  }));

  const storedLogo = localStorage.getItem(LOGO_STORAGE_KEY) || '';
  const storedPhoto = localStorage.getItem(PHOTO_STORAGE_KEY) || '';

  const merged = {
    ...base,
    ...raw,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    colorTheme: raw.colorTheme === 'grey' ? 'white' : (raw.colorTheme || 'blue'),
    sunlightMode: Boolean(raw.sunlightMode),
    rideLoadMode: raw.rideLoadMode === 'pillion' ? 'pillion' : 'solo',
    bikePurchasePrice: Math.max(0, Number(raw.bikePurchasePrice) || 0),
    nightDrainTest: {
      ...base.nightDrainTest,
      ...(raw.nightDrainTest || {})
    },
    favoriteRoutes: Array.isArray(raw.favoriteRoutes) ? raw.favoriteRoutes : [],
    sprintRecords: {
      ...base.sprintRecords,
      ...(raw.sprintRecords || {})
    },
    initialKm: Math.max(0, inferredInitKm),
    currentKm: Math.max(0, Number(raw.currentKm) || 0),
    tripBaseKm: Number(raw.tripBaseKm) || 0,
    lastPriceGal: raw.lastPriceGal || '',
    monthlyFuelBudget: Number(raw.monthlyFuelBudget) > 0 ? Number(raw.monthlyFuelBudget) : 150,
    lastWashKm: Number(raw.lastWashKm) || 0,
    lastWashDate: raw.lastWashDate || '',
    firstUseDate: raw.firstUseDate || getLocalISODate(),
    logoBase64: raw.logoBase64 || storedLogo,
    bikePhotoBase64: raw.bikePhotoBase64 || storedPhoto,
    checklistState: Array.isArray(raw.checklistState) ? raw.checklistState : [false, false, false, false, false],
    docs: {
      ...base.docs,
      ...(raw.docs || {}),
      soatCost: Number(raw.docs?.soatCost) || 0,
      sosPhone: raw.docs?.sosPhone || ''
    },
    tires: {
      front: { ...DEFAULT_TIRES.front, ...(raw.tires?.front || {}) },
      rear: { ...DEFAULT_TIRES.rear, ...(raw.tires?.rear || {}) },
      history: Array.isArray(raw.tires?.history) ? raw.tires.history : []
    },
    accessories: (Array.isArray(raw.accessories) ? raw.accessories : []).map((m) => {
      const eMode = m.elecMode ? m.elecMode : (m.hasElec ? (m.category === 'security' ? 'direct_24_7' : 'switched_acc') : 'none');
      return {
        ...m,
        elecMode: eMode,
        hasElec: eMode !== 'none'
      };
    }),
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
      saveState(false);
    } catch (e) {
      console.error('Error al cargar estado:', e);
    }
  }
}

let autoSyncTimer = null;

// Separa las imágenes pesadas en llaves propias de almacenamiento local para que el JSON operativo sea ultraligero
export function saveState(triggerCloud = true) {
  try {
    if (appState.logoBase64) {
      localStorage.setItem(LOGO_STORAGE_KEY, appState.logoBase64);
    }
    if (appState.bikePhotoBase64) {
      localStorage.setItem(PHOTO_STORAGE_KEY, appState.bikePhotoBase64);
    }
    const slimState = {
      ...appState,
      logoBase64: '',
      bikePhotoBase64: ''
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slimState));
  } catch (e) {
    console.error('Error guardando estado local:', e);
  }

  // Auto-guardado silencioso en la nube (Sin imágenes Base64 y con protección anti-sobrescritura)
  if (triggerCloud && getCurrentUser() && navigator.onLine) {
    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    window.dispatchEvent(new CustomEvent('cloud-sync-status', { detail: 'syncing' }));

    autoSyncTimer = setTimeout(async () => {
      try {
        const cloudPayload = {
          ...appState,
          logoBase64: '',
          bikePhotoBase64: ''
        };
        await pushStateToCloud(cloudPayload, { forceOverwrite: false });
        window.dispatchEvent(new CustomEvent('cloud-sync-status', { detail: 'ok' }));
      } catch (err) {
        if (err?.code === 'CLOUD_CONFLICT_HIGHER_DATA') {
          console.warn('Auto-sync pausado por protección anti-sobrescritura:', err.cloudMeta);
          window.dispatchEvent(new CustomEvent('cloud-sync-status', { detail: 'conflict' }));
        } else {
          console.warn('Auto-sync postergado:', err);
          window.dispatchEvent(new CustomEvent('cloud-sync-status', { detail: 'error' }));
        }
      }
    }, 2500);
  }
}

export function replaceFullState(newStateObj, triggerCloud = false) {
  appState = migrateAndNormalizeState(newStateObj);
  recalculateServiceKmFromLogs();
  recalculateWashFromLogs();
  saveState(triggerCloud);
}
