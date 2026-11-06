// obd.js - Módulo Maestro de Telemetría Completa OBD2 BLE (KONNWEI KW901 / ELM327 V1.5)
import { appState, triggerHaptic } from './state.js';

const BLE_SERVICES = [
  '0000fff0-0000-1000-8000-00805f9b34fb', // Estándar Konnwei KW901 / Vgate BLE
  '0000ffe0-0000-1000-8000-00805f9b34fb', // Estándar HM-10 / ELM327 BLE
  '000018f0-0000-1000-8000-00805f9b34fb', // Servicio BLE Serial alternativo
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2'  // Servicio BLE UART alternativo
];

let bleDevice = null;
let writeChar = null;
let notifyChar = null;
let pollInterval = null;
let isPollingActive = false;
let isDtcBusy = false;
let isSimulating = false;
let isStoppingTelemetry = false;
let responseBuffer = '';
let currentResolve = null;
let commandTimeoutId = null;
let wakeLockSentinel = null;
let lastRpmWarnTime = 0;

let lastGpsLat = null;
let lastGpsLon = null;
let lastGpsSampleTimeMs = 0;

const EMA_ALPHA_FAST = 0.65;
const EMA_ALPHA_VOLT = 0.45;
let emaRpm = 0;
let emaSpeed = 0;
let emaVolt = 0;

export const BAJAJ_DTC_DICTIONARY = {
  P0107: 'Sensor MAP (Presión Barométrica/Admisión): Voltaje bajo',
  P0108: 'Sensor MAP (Presión Barométrica/Admisión): Señal alta',
  P0112: 'Sensor IAT (Temperatura de Aire de Admisión): Voltaje bajo',
  P0113: 'Sensor IAT (Temperatura de Aire de Admisión): Circuito abierto / Señal alta',
  P0117: 'Sensor EOT/ECT (Temperatura de Motor/Aceite): Voltaje bajo',
  P0118: 'Sensor EOT/ECT (Temperatura de Motor/Aceite): Señal alta o desconectado',
  P0122: 'Sensor TPS (Posición de Mariposa Acelerador): Voltaje bajo',
  P0123: 'Sensor TPS (Posición de Mariposa Acelerador): Voltaje alto',
  P0131: 'Sensor de Oxígeno (Sonda Lambda): Mezcla muy pobre / Voltaje bajo',
  P0132: 'Sensor de Oxígeno (Sonda Lambda): Mezcla muy rica / Voltaje alto',
  P0031: 'Calefactor de Sonda Lambda (Sensor O2): Circuito bajo',
  P0032: 'Calefactor de Sonda Lambda (Sensor O2): Circuito alto',
  P0201: 'Inyector Electrónico FI: Falla en circuito de bobina del inyector',
  P0230: 'Bomba de Combustible FI: Falla en relé o circuito primario',
  P0335: 'Sensor CKP (Posición de Cigüeñal): Sin señal de giro',
  P0351: 'Bobina de Encendido DTS-i #1: Falla en circuito primario/secundario',
  P0352: 'Bobina de Encendido DTS-i #2: Falla en circuito primario/secundario',
  P0500: 'Sensor de Velocidad de Rueda (VSS / ABS): Sin señal',
  P0505: 'Control de Marcha Mínima (IACV / Paso a paso): Ralentí inestable',
  P0562: 'Sistema Eléctrico 12V: Voltaje de batería crítico (<11.2V)',
  P0563: 'Regulador / Rectificador: Sobrecarga de voltaje hacia la ECU (>15.2V)'
};

export const liveEcuData = {
  connected: false,
  mode: 'offline',     // 'offline' | 'ble' | 'sim'
  rpm: 0,
  rawRpm: 0,
  peakRpm: 0,
  speedKmh: 0,
  peakSpeed: 0,
  gear: 'N',           // 'N', '-', '1', '2', '3', '4', '5'
  tempC: 0,            // 0105: Temperatura de motor / aceite EOT (°C)
  iatC: 0,             // 010F: Temperatura aire de admisión (°C)
  voltage: 0.0,        // ATRV: Voltaje real batería 4Ah / estator (V)
  tpsPct: 0,           // 0111: Apertura mariposa acelerador (%)
  engineLoadPct: 0,    // 0104: Carga calculada del motor (%)
  mapKpa: 101,         // 010B: Presión colector admisión / altura (kPa)
  estimatedAltM: 0,    // Altitud barométrica estimada (msnm)
  sessionStartAltM: null,
  altDeltaM: 0,
  mapResetNeeded: false,
  timingAdvDeg: 0,     // 010E: Avance de chispa DTS-i (° antes de PMS)
  o2Volt: 0.45,        // 0114: Voltaje sonda lambda (0.1V - 0.9V)
  stftPct: 0.0,        // 0106: Ajuste corto plazo mezcla aire/gasolina (%)
  runTimeSec: 0,       // 011F: Segundos con motor encendido
  sessionKm: 0.0,      // Distancia integrada en tiempo real desde 010D o GPS (km)
  instKmPerGal: 0.0,   // Economía instantánea estimada (km/gal)
  instKmPerL: 0.0,     // Economía instantánea estimada (km/L)
  dtcCodes: [],        // 03: Lista de códigos de falla activos
  lastDtcScan: '',
  elecTest: {
    active: false,
    phase: 'idle',
    remainingSec: 0,
    restingVolt: 0,
    crankingMinVolt: 99,
    chargingMaxVolt: 0,
    chargingAvgVolt: 0,
    verdictTitle: '',
    verdictStatus: 'ok',
    verdictDetail: ''
  },
  blackbox: {
    recording: false,
    startTimeMs: 0,
    points: [],
    maxTempC: 0,
    maxRpm: 0,
    maxSpeed: 0,
    minVolt: 99
  }
};

let lastSpeedUpdateMs = 0;
let elecTestTimer = null;
let blackboxTimer = null;
let getGpsCallback = null;
let hasTriggeredMapHaptic = false;

export function registerGpsProviderForBlackbox(fn) {
  getGpsCallback = fn;
}

export function feedGpsDistanceSample(lat, lon, accuracy = 20, speedMps = null) {
  const nowMs = Date.now();

  if (typeof speedMps === 'number' && !isNaN(speedMps) && speedMps >= 0 && !liveEcuData.connected) {
    const gpsKmh = Math.round(speedMps * 3.6);
    if (gpsKmh > liveEcuData.peakSpeed) {
      liveEcuData.peakSpeed = gpsKmh;
    }
  }

  if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) return 0;
  if (accuracy > 45) return 0;

  let calculatedKmh = 0;

  if (lastGpsLat !== null && lastGpsLon !== null) {
    const R = 6371;
    const dLat = ((lat - lastGpsLat) * Math.PI) / 180;
    const dLon = ((lon - lastGpsLon) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lastGpsLat * Math.PI) / 180) *
        Math.cos((lat * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const deltaKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const elapsedHours = lastGpsSampleTimeMs > 0 ? (nowMs - lastGpsSampleTimeMs) / 3600000 : 0;

    if (deltaKm >= 0.006 && deltaKm <= 0.5) {
      if (!liveEcuData.connected) {
        liveEcuData.sessionKm = Number((liveEcuData.sessionKm + deltaKm).toFixed(3));
      }
      if (elapsedHours > 0) {
        const rawCalcKmh = Math.round(deltaKm / elapsedHours);
        if (rawCalcKmh <= 145) {
          calculatedKmh = rawCalcKmh;
          if (!liveEcuData.connected && calculatedKmh > liveEcuData.peakSpeed) {
            liveEcuData.peakSpeed = calculatedKmh;
          }
        }
      }
    }
  }

  lastGpsLat = lat;
  lastGpsLon = lon;
  lastGpsSampleTimeMs = nowMs;
  return calculatedKmh;
}

function applyEmaSmoothing(rawVal, prevEma, alpha) {
  if (rawVal <= 0) return 0;
  if (prevEma <= 0) return rawVal;
  return alpha * rawVal + (1 - alpha) * prevEma;
}

export function updateAltitudeDeltaCheck(currentAltM) {
  if (typeof currentAltM !== 'number' || isNaN(currentAltM) || currentAltM <= 0) return;

  if (liveEcuData.sessionStartAltM === null) {
    liveEcuData.sessionStartAltM = currentAltM;
  }

  const delta = Math.round(currentAltM - liveEcuData.sessionStartAltM);
  liveEcuData.altDeltaM = delta;

  if (Math.abs(delta) >= 1200) {
    liveEcuData.mapResetNeeded = true;
    if (!hasTriggeredMapHaptic) {
      hasTriggeredMapHaptic = true;
      triggerHaptic([50, 80, 50]);
    }
  }
}

export function acknowledgeMapReset() {
  const gps = typeof getGpsCallback === 'function' ? getGpsCallback() : null;
  const currAlt = gps?.alt ?? liveEcuData.estimatedAltM ?? 34;
  liveEcuData.sessionStartAltM = currAlt;
  liveEcuData.altDeltaM = 0;
  liveEcuData.mapResetNeeded = false;
  hasTriggeredMapHaptic = false;
}

function integrateSessionDistance(speedKmh) {
  const now = Date.now();
  if (lastSpeedUpdateMs > 0 && speedKmh > 0) {
    const elapsedHours = (now - lastSpeedUpdateMs) / 3600000;
    if (elapsedHours > 0 && elapsedHours < 0.05) {
      liveEcuData.sessionKm = Number((liveEcuData.sessionKm + speedKmh * elapsedHours).toFixed(3));
    }
  }
  lastSpeedUpdateMs = now;
}

function updateInstantFuelEconomy() {
  const spd = liveEcuData.speedKmh || 0;
  const rpm = liveEcuData.rpm || 0;
  const load = liveEcuData.engineLoadPct || 25;
  const tps = liveEcuData.tpsPct || 10;

  if (spd < 5 || rpm < 1100) {
    liveEcuData.instKmPerGal = 0;
    liveEcuData.instKmPerL = 0;
    return;
  }

  const loadFactor = 0.55 + (load / 100) * 0.65 + (tps / 100) * 0.35;
  const rpmPenalty = rpm > 6500 ? 1 + ((rpm - 6500) / 4000) * 0.35 : 1.0;
  const baseKmGal = 148 / (loadFactor * rpmPenalty);
  const clampedKmGal = Math.max(65, Math.min(185, baseKmGal));

  liveEcuData.instKmPerGal = Number(clampedKmGal.toFixed(1));
  liveEcuData.instKmPerL = Number((clampedKmGal / 3.78541).toFixed(1));
}

// Calibrado para transmisión de 5 velocidades de la Pulsar N160 FI (Piñón 14T / Catalina 45T / Llanta 130/70-17)
function calculateEstimatedGear(rpm, speedKmh) {
  if (speedKmh < 3 || rpm < 950) return 'N';
  const ratio = rpm / Math.max(1, speedKmh);
  if (ratio < 44) return '-';
  if (ratio > 132) return '1';
  if (ratio > 96)  return '2';
  if (ratio > 73)  return '3';
  if (ratio > 57)  return '4';
  return '5';
}

function estimateAltitudeFromKpa(kpa) {
  if (!kpa || kpa <= 0) return 0;
  const clamped = Math.min(102, Math.max(55, kpa));
  return Math.max(0, Math.round((101.3 - clamped) * 88));
}

async function requestDashboardWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
    } catch (e) {}
  }
}

async function releaseDashboardWakeLock() {
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
    } catch (e) {}
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (liveEcuData.connected || liveEcuData.blackbox.recording)) {
    requestDashboardWakeLock();
  }
});

function checkBreakinRpmAlert(rpm) {
  const limitRpm = appState.currentKm < 1000 ? 5000 : (appState.currentKm < 2000 ? 6500 : 8500);
  const now = Date.now();
  if (rpm > limitRpm && now - lastRpmWarnTime > 2500) {
    lastRpmWarnTime = now;
    triggerHaptic([45, 60, 45]);
  }
}

function parseObdResponse(cmd, rawHex) {
  const baseCmd = cmd.slice(0, 4);
  const clean = String(rawHex || '').replace(/[\r\n> ]/g, '').toUpperCase();

  if (baseCmd === 'ATRV') {
    const vMatch = String(rawHex || '').match(/(\d+\.\d+)\s*V?/i);
    if (vMatch) {
      const rawV = parseFloat(vMatch[1]);
      if (rawV > 5 && rawV < 20) {
        if (liveEcuData.elecTest.active) {
          liveEcuData.voltage = rawV;
        } else {
          emaVolt = applyEmaSmoothing(rawV, emaVolt, EMA_ALPHA_VOLT);
          liveEcuData.voltage = Number(emaVolt.toFixed(1));
        }
        feedElecTestSample(rawV, liveEcuData.rpm);
      }
    }
    return;
  }

  if (baseCmd === '010C' && clean.includes('410C')) {
    const idx = clean.indexOf('410C') + 4;
    const A = parseInt(clean.slice(idx, idx + 2), 16);
    const B = parseInt(clean.slice(idx + 2, idx + 4), 16);
    if (!isNaN(A) && !isNaN(B)) {
      const rawRpmVal = Math.round(((A * 256) + B) / 4);
      liveEcuData.rawRpm = rawRpmVal;
      emaRpm = rawRpmVal < 400 ? 0 : Math.round(applyEmaSmoothing(rawRpmVal, emaRpm, EMA_ALPHA_FAST));
      liveEcuData.rpm = emaRpm;

      if (rawRpmVal > liveEcuData.peakRpm) liveEcuData.peakRpm = rawRpmVal;
      liveEcuData.gear = calculateEstimatedGear(liveEcuData.rpm, liveEcuData.speedKmh);
      updateInstantFuelEconomy();
      checkBreakinRpmAlert(rawRpmVal);
    }
    return;
  }

  if (baseCmd === '010D' && clean.includes('410D')) {
    const idx = clean.indexOf('410D') + 4;
    const A = parseInt(clean.slice(idx, idx + 2), 16);
    if (!isNaN(A)) {
      emaSpeed = A <= 1 ? 0 : Math.round(applyEmaSmoothing(A, emaSpeed, EMA_ALPHA_FAST));
      liveEcuData.speedKmh = emaSpeed;
      integrateSessionDistance(A);
      if (A > liveEcuData.peakSpeed) liveEcuData.peakSpeed = A;
      liveEcuData.gear = calculateEstimatedGear(liveEcuData.rpm, liveEcuData.speedKmh);
      updateInstantFuelEconomy();
    }
    return;
  }

  if (baseCmd === '0105' && clean.includes('4105')) {
    const idx = clean.indexOf('4105') + 4;
    const A = parseInt(clean.slice(idx, idx + 2), 16);
    if (!isNaN(A)) liveEcuData.tempC = A - 40;
    return;
  }

  if (baseCmd === '0111' && clean.includes('4111')) {
    const idx = clean.indexOf('4111') + 4;
    const A = parseInt(clean.slice(idx, idx + 2), 16);
    if (!isNaN(A)) liveEcuData.tpsPct = Math.round((A * 100) / 255);
    return;
  }

  if (baseCmd === '0104' && clean.includes('4104')) {
    const idx = clean.indexOf('4104') + 4;
    const A = parseInt(clean.slice(idx, idx + 2), 16);
    if (!isNaN(A)) liveEcuData.engineLoadPct = Math.round((A * 100) / 255);
    return;
  }

  if (baseCmd === '010B' && clean.includes('410B')) {
    const idx = clean.indexOf('410B') + 4;
    const A = parseInt(clean.slice(idx, idx + 2), 16);
    if (!isNaN(A)) {
      liveEcuData.mapKpa = A;
      if ((liveEcuData.rpm === 0 || liveEcuData.tpsPct >= 85) && A >= 60 && A <= 103) {
        liveEcuData.estimatedAltM = estimateAltitudeFromKpa(A);
        updateAltitudeDeltaCheck(liveEcuData.estimatedAltM);
      }
    }
    return;
  }

  if (baseCmd === '010F' && clean.includes('410F')) {
    const idx = clean.indexOf('410F') + 4;
    const A = parseInt(clean.slice(idx, idx + 2), 16);
    if (!isNaN(A)) liveEcuData.iatC = A - 40;
    return;
  }

  if (baseCmd === '010E' && clean.includes('410E')) {
    const idx = clean.indexOf('410E') + 4;
    const A = parseInt(clean.slice(idx, idx + 2), 16);
    if (!isNaN(A)) liveEcuData.timingAdvDeg = Number(((A / 2) - 64).toFixed(1));
    return;
  }

  if (baseCmd === '0114' && clean.includes('4114')) {
    const idx = clean.indexOf('4114') + 4;
    const A = parseInt(clean.slice(idx, idx + 2), 16);
    const B = parseInt(clean.slice(idx + 2, idx + 4), 16);
    if (!isNaN(A)) liveEcuData.o2Volt = Number((A / 200).toFixed(2));
    if (!isNaN(B) && B !== 255) {
      liveEcuData.stftPct = Number((((B - 128) * 100) / 128).toFixed(1));
    }
    return;
  }

  if (baseCmd === '011F' && clean.includes('411F')) {
    const idx = clean.indexOf('411F') + 4;
    const A = parseInt(clean.slice(idx, idx + 2), 16);
    const B = parseInt(clean.slice(idx + 2, idx + 4), 16);
    if (!isNaN(A) && !isNaN(B)) {
      const sec = (A * 256) + B;
      if (sec > 0 && sec < 8 && liveEcuData.mapResetNeeded) {
        acknowledgeMapReset();
      }
      liveEcuData.runTimeSec = sec;
    }
  }
}

// Decodificador compatible con ISO 15765-4 CAN (salta byte de conteo DTC y limpia prefijos multiframa)
function parseDtcMode03(rawHex) {
  const strippedFrames = String(rawHex || '')
    .replace(/^[0-9A-F]:/gim, '')
    .replace(/[\r\n> ]/g, '')
    .toUpperCase()
    .replace(/[^0-9A-F]/g, '');

  if (!strippedFrames.includes('43')) return [];

  const idx = strippedFrames.indexOf('43') + 2;
  let payload = strippedFrames.slice(idx);
  if (payload.length < 4) return [];

  if (payload.length % 4 === 2) {
    payload = payload.slice(2);
  } else if (payload.length >= 6) {
    const possibleCount = parseInt(payload.slice(0, 2), 16);
    const remainingHex = payload.slice(2);
    if (possibleCount > 0 && possibleCount <= 12 && remainingHex.length >= possibleCount * 4 && remainingHex.slice(0, 4) !== '0000') {
      payload = remainingHex;
    }
  }

  const codes = [];
  const prefixMap = ['P0', 'P1', 'P2', 'P3', 'C0', 'C1', 'C2', 'C3', 'B0', 'B1', 'B2', 'B3', 'U0', 'U1', 'U2', 'U3'];

  for (let i = 0; i + 4 <= payload.length; i += 4) {
    const chunk = payload.slice(i, i + 4);
    if (chunk === '0000') continue;
    const firstNibble = parseInt(chunk[0], 16);
    if (isNaN(firstNibble)) continue;
    const code = (prefixMap[firstNibble] || 'P0') + chunk.slice(1);
    if (/^[PCBU][0-9A-F]{4}$/.test(code) && !codes.includes(code)) {
      codes.push(code);
    }
  }
  return codes;
}

function sendAtCommand(cmd, timeoutMs = 450) {
  return new Promise((resolve) => {
    if (!writeChar) return resolve('');

    if (commandTimeoutId) {
      clearTimeout(commandTimeoutId);
      commandTimeoutId = null;
    }

    responseBuffer = '';
    currentResolve = resolve;

    const encoder = new TextEncoder();
    const data = encoder.encode(cmd + '\r');

    const performWrite = async () => {
      if (writeChar.properties.write) {
        try {
          await writeChar.writeValue(data);
          return;
        } catch (e) {}
      }
      if (writeChar.properties.writeWithoutResponse) {
        await writeChar.writeValueWithoutResponse(data);
      } else {
        await writeChar.writeValue(data);
      }
    };

    performWrite().catch(() => {
      if (commandTimeoutId) {
        clearTimeout(commandTimeoutId);
        commandTimeoutId = null;
      }
      if (currentResolve === resolve) {
        currentResolve = null;
        resolve('');
      }
    });

    commandTimeoutId = setTimeout(() => {
      commandTimeoutId = null;
      if (currentResolve === resolve) {
        const partial = responseBuffer;
        currentResolve = null;
        resolve(partial);
      }
    }, timeoutMs);
  });
}

function handleBleNotification(event) {
  const chunk = new TextDecoder().decode(event.target.value);
  responseBuffer += chunk;
  if (responseBuffer.includes('>') && currentResolve) {
    if (commandTimeoutId) {
      clearTimeout(commandTimeoutId);
      commandTimeoutId = null;
    }
    const finalResp = responseBuffer;
    const res = currentResolve;
    currentResolve = null;
    res(finalResp);
  }
}

async function runSequentialBleLoop(onUpdateCallback) {
  const normalPidQueue = [
    '010C', '010D', '0111', '0105',
    '010C', '010D', 'ATRV', '0104',
    '010C', '010D', '0111', '010B',
    '010C', '010D', '010F', '010E',
    '010C', '010D', '0114', '011F'
  ];
  const elecTestQueue = ['ATRV', '010C', 'ATRV', 'ATRV', '010C'];
  let stepIndex = 0;

  while (isPollingActive && liveEcuData.connected && liveEcuData.mode === 'ble') {
    if (isDtcBusy) {
      await new Promise((r) => setTimeout(r, 120));
      continue;
    }

    const queue = liveEcuData.elecTest.active ? elecTestQueue : normalPidQueue;
    const cmd = queue[stepIndex % queue.length];
    stepIndex++;

    const raw = await sendAtCommand(cmd, 240);
    if (!isPollingActive) break;

    if (!isDtcBusy) {
      parseObdResponse(cmd, raw);
      if (onUpdateCallback) onUpdateCallback(liveEcuData);
    }

    await new Promise((r) => setTimeout(r, 14));
  }
}

export async function connectKonnweiBle(onUpdateCallback, onStatusCallback) {
  if (!navigator.bluetooth) {
    throw new Error('Abre la app desde tu enlace HTTPS de GitHub en Chrome para usar Bluetooth.');
  }

  stopEcuTelemetry();
  if (onStatusCallback) onStatusCallback('Buscando KONNWEI KW901...');

  bleDevice = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_SERVICES
  });

  bleDevice.addEventListener('gattserverdisconnected', () => {
    if (!isStoppingTelemetry) {
      stopEcuTelemetry(onUpdateCallback);
      if (onStatusCallback) onStatusCallback('Escáner desconectado');
    }
  });

  if (onStatusCallback) onStatusCallback('Conectando con ECU N160...');
  const server = await bleDevice.gatt.connect();

  let service = null;
  for (const uuid of BLE_SERVICES) {
    try {
      service = await server.getPrimaryService(uuid);
      if (service) break;
    } catch (e) {}
  }

  if (!service) {
    throw new Error('Canal BLE no encontrado en este dispositivo.');
  }

  const chars = await service.getCharacteristics();
  for (const c of chars) {
    const uuidStr = String(c.uuid || '').toLowerCase();
    if (c.properties.notify || c.properties.indicate) {
      if (!notifyChar || uuidStr.includes('fff1') || uuidStr.includes('ffe1')) {
        notifyChar = c;
      }
    }
    if (c.properties.write || c.properties.writeWithoutResponse) {
      if (!writeChar || uuidStr.includes('fff2') || uuidStr.includes('ffe1')) {
        writeChar = c;
      }
    }
  }

  if (!notifyChar || !writeChar) {
    throw new Error('El adaptador no soporta lectura/escritura BLE.');
  }

  await notifyChar.startNotifications();
  notifyChar.addEventListener('characteristicvaluechanged', handleBleNotification);

  await sendAtCommand('ATZ', 800);
  await sendAtCommand('ATE0', 220);
  await sendAtCommand('ATL0', 220);
  await sendAtCommand('ATS0', 220);
  await sendAtCommand('ATH0', 220);
  await sendAtCommand('ATAT1', 220);
  await sendAtCommand('ATST19', 220);
  await sendAtCommand('ATSP6', 300);

  const testPid = await sendAtCommand('0100', 900);
  if (!String(testPid).replace(/\s+/g, '').includes('4100')) {
    await sendAtCommand('ATSP0', 350);
    await sendAtCommand('0100', 1200);
  }

  liveEcuData.connected = true;
  liveEcuData.mode = 'ble';
  liveEcuData.peakRpm = 0;
  liveEcuData.peakSpeed = 0;
  liveEcuData.sessionStartAltM = null;
  liveEcuData.altDeltaM = 0;
  liveEcuData.mapResetNeeded = false;
  emaRpm = 0;
  emaSpeed = 0;
  emaVolt = 0;
  lastSpeedUpdateMs = Date.now();
  isDtcBusy = false;
  isPollingActive = true;

  await requestDashboardWakeLock();
  if (onStatusCallback) onStatusCallback('🟢 ECU N160 En Línea (CAN 500kbps)');

  runSequentialBleLoop(onUpdateCallback);
}

let chargingSamples = [];

function feedElecTestSample(volt, rpm) {
  const t = liveEcuData.elecTest;
  if (!t.active || volt <= 0) return;

  if (t.phase === 'resting') {
    t.restingVolt = volt;
  } else if (t.phase === 'cranking') {
    if (volt < t.crankingMinVolt) {
      t.crankingMinVolt = volt;
    }
  } else if (t.phase === 'charging') {
    if (volt > t.chargingMaxVolt) t.chargingMaxVolt = volt;
    chargingSamples.push(volt);
    const sum = chargingSamples.reduce((a, b) => a + b, 0);
    t.chargingAvgVolt = Number((sum / chargingSamples.length).toFixed(2));
  }
}

export function startElectricalHealthTest(onUpdateCallback, onStatusCallback) {
  if (!liveEcuData.connected) {
    if (onStatusCallback) onStatusCallback('⚠️ Conecta el escáner o activa el Modo Demo primero');
    return;
  }

  if (elecTestTimer) clearInterval(elecTestTimer);
  chargingSamples = [];

  liveEcuData.elecTest = {
    active: true,
    phase: 'resting',
    remainingSec: 15,
    restingVolt: liveEcuData.voltage || 12.6,
    crankingMinVolt: liveEcuData.voltage || 12.6,
    chargingMaxVolt: liveEcuData.voltage || 13.8,
    chargingAvgVolt: liveEcuData.voltage || 13.8,
    verdictTitle: 'Analizando sistema 12V...',
    verdictStatus: 'ok',
    verdictDetail: 'Etapa 1/3: Mantén el contacto abierto (o ralentí estable) para medir línea base...'
  };

  triggerHaptic(20);
  if (onStatusCallback) onStatusCallback('⚡ Iniciando Test Eléctrico de 15s...');
  if (onUpdateCallback) onUpdateCallback(liveEcuData);

  elecTestTimer = setInterval(() => {
    const t = liveEcuData.elecTest;
    t.remainingSec--;

    if (t.remainingSec > 11) {
      t.phase = 'resting';
      t.verdictDetail = `Etapa 1/3 (${t.remainingSec}s): Midiendo voltaje base de batería 4Ah (${t.restingVolt.toFixed(2)}V)...`;
    } else if (t.remainingSec > 6) {
      if (t.phase !== 'cranking') {
        t.phase = 'cranking';
        triggerHaptic([30, 50, 30]);
      }
      t.verdictDetail = `Etapa 2/3 (${t.remainingSec}s): ¡Arranca el motor ahora! Midiendo caída de tensión CCA (Mín: ${t.crankingMinVolt.toFixed(2)}V)...`;
    } else if (t.remainingSec > 0) {
      if (t.phase !== 'charging') {
        t.phase = 'charging';
        triggerHaptic(25);
      }
      t.verdictDetail = `Etapa 3/3 (${t.remainingSec}s): ¡Mantén 3,500 - 4,000 RPM! Auditando estator y regulador (${t.chargingAvgVolt.toFixed(2)}V)...`;
    } else {
      clearInterval(elecTestTimer);
      elecTestTimer = null;
      t.active = false;
      t.phase = 'done';

      const minV = t.crankingMinVolt;
      const chgV = t.chargingAvgVolt || liveEcuData.voltage;

      if (minV < 9.6) {
        t.verdictStatus = 'danger';
        t.verdictTitle = '⚠️ Batería 4Ah Debilitada (Caída CCA Crítica)';
        t.verdictDetail = `Al arrancar cayó a ${minV.toFixed(2)}V (<9.6V). Tu batería VRLA está perdiendo capacidad de retención. Carga de estator: ${chgV.toFixed(2)}V.`;
      } else if (chgV < 13.2) {
        t.verdictStatus = 'warn';
        t.verdictTitle = '⚠️ Estator / Regulador con Carga Baja';
        t.verdictDetail = `A régimen medio el voltaje promedió ${chgV.toFixed(2)}V (debe estar entre 13.6V y 14.5V). Revisa conector del regulador/rectificador.`;
      } else if (chgV > 14.8) {
        t.verdictStatus = 'danger';
        t.verdictTitle = '🔥 Peligro de Sobrecarga en Regulador (>14.8V)';
        t.verdictDetail = `El regulador alcanzó ${chgV.toFixed(2)}V. Riesgo de inflar la batería 4Ah o dañar la ECU Bosch.`;
      } else {
        t.verdictStatus = 'ok';
        t.verdictTitle = '✅ Sistema Eléctrico 100% Saludable';
        t.verdictDetail = `Base: ${t.restingVolt.toFixed(2)}V • Arranque CCA: ${minV.toFixed(2)}V • Carga Estator Trifásico: ${chgV.toFixed(2)}V (Rango óptimo N160 FI).`;
      }

      triggerHaptic([40, 60, 40]);
      if (onStatusCallback) onStatusCallback('✅ Test Eléctrico completado');
    }

    if (onUpdateCallback) onUpdateCallback(liveEcuData);
  }, 1000);
}

export function toggleBlackboxRecording(onUpdateCallback, onStatusCallback) {
  const bb = liveEcuData.blackbox;

  if (bb.recording) {
    bb.recording = false;
    if (blackboxTimer) {
      clearInterval(blackboxTimer);
      blackboxTimer = null;
    }
    if (!liveEcuData.connected) {
      releaseDashboardWakeLock();
    }
    triggerHaptic(20);
    if (onStatusCallback) onStatusCallback(`⏹ Caja Negra detenida (${bb.points.length} muestras grabadas)`);
    if (onUpdateCallback) onUpdateCallback(liveEcuData);
    return false;
  }

  bb.recording = true;
  bb.startTimeMs = Date.now();
  bb.points = [];
  bb.maxTempC = liveEcuData.tempC || 0;
  bb.maxRpm = liveEcuData.rpm || 0;
  bb.maxSpeed = liveEcuData.speedKmh || 0;
  bb.minVolt = liveEcuData.voltage > 0 ? liveEcuData.voltage : 12.6;

  requestDashboardWakeLock();

  const samplePoint = () => {
    const gps = typeof getGpsCallback === 'function'
      ? getGpsCallback()
      : { lat: -8.1116, lon: -79.0287, alt: liveEcuData.estimatedAltM || 34, speedKmh: 0 };

    const effectiveSpeed = liveEcuData.connected
      ? (liveEcuData.speedKmh || 0)
      : Math.round(Number(gps.speedKmh) || 0);

    const pt = {
      isoTime: new Date().toISOString(),
      elapsedSec: Math.round((Date.now() - bb.startTimeMs) / 1000),
      lat: Number(gps.lat || -8.1116).toFixed(6),
      lon: Number(gps.lon || -79.0287).toFixed(6),
      altM: Math.round(Number(gps.alt ?? liveEcuData.estimatedAltM ?? 34)),
      rpm: liveEcuData.rpm || 0,
      speedKmh: effectiveSpeed,
      gear: liveEcuData.gear || 'N',
      tempC: liveEcuData.tempC || 0,
      voltage: Number(liveEcuData.voltage || 0).toFixed(2),
      tpsPct: liveEcuData.tpsPct || 0,
      loadPct: liveEcuData.engineLoadPct || 0,
      mapKpa: liveEcuData.mapKpa || 101,
      o2Volt: Number(liveEcuData.o2Volt || 0.45).toFixed(2),
      instKmGal: Number(liveEcuData.instKmPerGal || 0).toFixed(1)
    };
    bb.points.push(pt);
    if (pt.tempC > bb.maxTempC) bb.maxTempC = pt.tempC;
    if (pt.rpm > bb.maxRpm) bb.maxRpm = pt.rpm;
    if (pt.speedKmh > bb.maxSpeed) bb.maxSpeed = pt.speedKmh;
    const vNum = parseFloat(pt.voltage);
    if (vNum > 0 && vNum < bb.minVolt) bb.minVolt = vNum;
    if (onUpdateCallback) onUpdateCallback(liveEcuData);
  };

  samplePoint();
  blackboxTimer = setInterval(samplePoint, 2500);
  triggerHaptic(25);
  if (onStatusCallback) onStatusCallback('🔴 Grabando Caja Negra ECU + GPS cada 2.5s');
  if (onUpdateCallback) onUpdateCallback(liveEcuData);
  return true;
}

export function exportBlackboxFile(format = 'csv') {
  const pts = liveEcuData.blackbox.points || [];
  if (pts.length === 0) return false;

  const dateTag = new Date().toISOString().slice(0, 10);
  if (format === 'gpx') {
    const trkpts = pts
      .map(
        (p) =>
          `      <trkpt lat="${p.lat}" lon="${p.lon}">\n` +
          `        <ele>${p.altM}</ele>\n` +
          `        <time>${p.isoTime}</time>\n` +
          `        <desc>RPM:${p.rpm} | Spd:${p.speedKmh}km/h | Gear:${p.gear} | Temp:${p.tempC}C | Volt:${p.voltage}V | TPS:${p.tpsPct}%</desc>\n` +
          `      </trkpt>`
      )
      .join('\n');

    const gpxContent =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<gpx version="1.1" creator="Mi Moto Pulsar N160 FI BlackBox">\n` +
      `  <trk>\n` +
      `    <name>Telemetria Ruta N160 FI (${dateTag})</name>\n` +
      `    <trkseg>\n${trkpts}\n    </trkseg>\n` +
      `  </trk>\n` +
      `</gpx>`;

    const blob = new Blob([gpxContent], { type: 'application/gpx+xml;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MiMoto_N160_BlackBox_${dateTag}.gpx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  }

  const headers = [
    'Timestamp_ISO', 'Segundos', 'Latitud', 'Longitud', 'Altitud_msnm',
    'RPM', 'Velocidad_Kmh', 'Marcha', 'Temp_EOT_C', 'Voltaje_V',
    'TPS_Pct', 'Carga_Motor_Pct', 'MAP_kPa', 'O2_Lambda_V', 'Econ_KmGal'
  ];
  const rows = pts.map((p) => [
    p.isoTime, p.elapsedSec, p.lat, p.lon, p.altM,
    p.rpm, p.speedKmh, p.gear, p.tempC, p.voltage,
    p.tpsPct, p.loadPct, p.mapKpa, p.o2Volt, p.instKmGal
  ]);

  const csvContent = '\uFEFF' + [headers, ...rows].map((r) => r.join(';')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MiMoto_N160_BlackBox_${dateTag}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}

export async function scanEcuDtcCodes(onUpdateCallback, onStatusCallback) {
  const nowStr = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  if (liveEcuData.mode === 'sim') {
    if (liveEcuData.dtcCodes.length === 0) {
      liveEcuData.dtcCodes = ['P0131', 'P0562'];
      if (onStatusCallback) onStatusCallback('🔍 Demo: 2 códigos DTC simulados detectados');
    } else {
      liveEcuData.dtcCodes = [];
      if (onStatusCallback) onStatusCallback('✅ Demo: 0 fallas detectadas en la ECU');
    }
    liveEcuData.lastDtcScan = nowStr;
    if (onUpdateCallback) onUpdateCallback(liveEcuData);
    return;
  }

  if (!liveEcuData.connected || !writeChar) {
    if (onStatusCallback) onStatusCallback('⚠️ Conecta el escáner o activa Demo primero');
    return;
  }

  if (onStatusCallback) onStatusCallback('🔍 Escaneando memoria de fallas ECU (Modo 03)...');
  isDtcBusy = true;
  try {
    await new Promise((r) => setTimeout(r, 220));
    const raw = await sendAtCommand('03', 900);
    liveEcuData.dtcCodes = parseDtcMode03(raw);
    liveEcuData.lastDtcScan = nowStr;
  } finally {
    isDtcBusy = false;
  }

  if (liveEcuData.dtcCodes.length === 0) {
    if (onStatusCallback) onStatusCallback('✅ ECU Limpia: 0 códigos de error activos');
  } else {
    triggerHaptic([60, 80, 60]);
    if (onStatusCallback) onStatusCallback(`⚠️ Se detectaron ${liveEcuData.dtcCodes.length} código(s) DTC`);
  }
  if (onUpdateCallback) onUpdateCallback(liveEcuData);
}

export async function clearEcuDtcCodes(onUpdateCallback, onStatusCallback) {
  if (liveEcuData.mode === 'sim') {
    liveEcuData.dtcCodes = [];
    if (onStatusCallback) onStatusCallback('✅ Check Engine borrado (Modo Demo)');
    if (onUpdateCallback) onUpdateCallback(liveEcuData);
    return;
  }

  if (!liveEcuData.connected || !writeChar) {
    if (onStatusCallback) onStatusCallback('⚠️ Conecta el escáner a la moto primero');
    return;
  }

  isDtcBusy = true;
  try {
    await new Promise((r) => setTimeout(r, 220));
    await sendAtCommand('04', 900);
    liveEcuData.dtcCodes = [];
  } finally {
    isDtcBusy = false;
  }

  triggerHaptic(30);
  if (onStatusCallback) onStatusCallback('✅ Memoria DTC reiniciada y Check Engine apagado');
  if (onUpdateCallback) onUpdateCallback(liveEcuData);
}

export async function startSimulatorMode(onUpdateCallback, onStatusCallback) {
  stopEcuTelemetry();
  isSimulating = true;
  liveEcuData.connected = true;
  liveEcuData.mode = 'sim';
  liveEcuData.peakRpm = 0;
  liveEcuData.peakSpeed = 0;
  liveEcuData.sessionStartAltM = 34;
  liveEcuData.altDeltaM = 0;
  liveEcuData.mapResetNeeded = false;
  lastSpeedUpdateMs = Date.now();
  liveEcuData.tempC = 68;
  liveEcuData.iatC = 26;
  liveEcuData.voltage = 14.1;
  liveEcuData.mapKpa = 99;
  liveEcuData.estimatedAltM = 34;
  liveEcuData.runTimeSec = 120;
  emaRpm = 1450;
  emaSpeed = 0;
  emaVolt = 14.1;

  await requestDashboardWakeLock();
  if (onStatusCallback) onStatusCallback('⚡ Telemetría Completa Demo Activa');

  pollInterval = setInterval(() => {
    const time = Date.now() / 1000;
    const wave = Math.abs(Math.sin(time * 0.65));
    const fastWave = Math.sin(time * 2.2);

    const rawRpmVal = Math.round(1450 + wave * 6700);
    const rawSpdVal = Math.round(wave * 106);

    emaRpm = Math.round(applyEmaSmoothing(rawRpmVal, emaRpm, EMA_ALPHA_FAST));
    emaSpeed = Math.round(applyEmaSmoothing(rawSpdVal, emaSpeed, EMA_ALPHA_FAST));

    liveEcuData.rawRpm = rawRpmVal;
    liveEcuData.rpm = emaRpm;
    if (rawRpmVal > liveEcuData.peakRpm) liveEcuData.peakRpm = rawRpmVal;

    liveEcuData.speedKmh = emaSpeed;
    integrateSessionDistance(emaSpeed);
    if (rawSpdVal > liveEcuData.peakSpeed) liveEcuData.peakSpeed = rawSpdVal;

    liveEcuData.gear = calculateEstimatedGear(emaRpm, emaSpeed);
    updateInstantFuelEconomy();
    liveEcuData.tpsPct = Math.round(wave * 88);
    liveEcuData.engineLoadPct = Math.min(100, Math.round(18 + wave * 76));
    liveEcuData.tempC = Math.min(108, Math.round(78 + Math.sin(time * 0.12) * 18));
    liveEcuData.iatC = Math.round(25 + Math.sin(time * 0.08) * 4);

    if (liveEcuData.elecTest.active) {
      if (liveEcuData.elecTest.phase === 'resting') {
        liveEcuData.voltage = 12.6;
      } else if (liveEcuData.elecTest.phase === 'cranking') {
        liveEcuData.voltage = 10.7;
      } else {
        liveEcuData.voltage = 14.2;
      }
      feedElecTestSample(liveEcuData.voltage, emaRpm);
    } else {
      const simV = 14.0 + Math.sin(time * 0.35) * 0.3;
      emaVolt = applyEmaSmoothing(simV, emaVolt, EMA_ALPHA_VOLT);
      liveEcuData.voltage = Number(emaVolt.toFixed(1));
    }

    liveEcuData.mapKpa = Math.round(38 + wave * 62);
    liveEcuData.timingAdvDeg = Number((10 + wave * 24).toFixed(1));
    liveEcuData.o2Volt = Number((0.48 + fastWave * 0.36).toFixed(2));
    liveEcuData.stftPct = Number((fastWave * 3.8).toFixed(1));
    liveEcuData.runTimeSec += 0.25;

    checkBreakinRpmAlert(rawRpmVal);
    if (onUpdateCallback) onUpdateCallback(liveEcuData);
  }, 250);
}

export function resetSessionDistance() {
  liveEcuData.sessionKm = 0.0;
  lastSpeedUpdateMs = Date.now();
  lastGpsLat = null;
  lastGpsLon = null;
  lastGpsSampleTimeMs = 0;
}

export function stopEcuTelemetry(onUpdateCallback) {
  if (isStoppingTelemetry) return;
  isStoppingTelemetry = true;

  try {
    lastSpeedUpdateMs = 0;
    isPollingActive = false;
    isDtcBusy = false;
    liveEcuData.connected = false;
    liveEcuData.mode = 'offline';
    isSimulating = false;
    emaRpm = 0;
    emaSpeed = 0;
    emaVolt = 0;

    if (commandTimeoutId) {
      clearTimeout(commandTimeoutId);
      commandTimeoutId = null;
    }
    currentResolve = null;

    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }

    if (elecTestTimer) {
      clearInterval(elecTestTimer);
      elecTestTimer = null;
      liveEcuData.elecTest.active = false;
    }

    writeChar = null;
    notifyChar = null;

    if (bleDevice && bleDevice.gatt && bleDevice.gatt.connected) {
      try {
        bleDevice.gatt.disconnect();
      } catch (e) {}
    }

    // Mantiene la pantalla encendida si la Caja Negra sigue grabando vía GPS
    if (!liveEcuData.blackbox.recording) {
      releaseDashboardWakeLock();
    }

    liveEcuData.rpm = 0;
    liveEcuData.rawRpm = 0;
    liveEcuData.speedKmh = 0;
    liveEcuData.gear = 'N';
    liveEcuData.tpsPct = 0;
    liveEcuData.engineLoadPct = 0;
    if (onUpdateCallback) onUpdateCallback(liveEcuData);
  } finally {
    isStoppingTelemetry = false;
  }
}
