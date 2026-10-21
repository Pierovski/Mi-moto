import { appState, escapeHTML } from './state.js';

export function isWithinPeriod(dateStr, period) {
  if (!dateStr) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const itemDate = new Date(y, m - 1, d);
  const now = new Date();
  if (period === 'year') return itemDate.getFullYear() === now.getFullYear();
  if (period === 'month') return itemDate.getFullYear() === now.getFullYear() && itemDate.getMonth() === now.getMonth();
  if (period === 'week') {
    const todayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = (todayZero - itemDate) / 86400000;
    return diffDays >= 0 && diffDays <= 7;
  }
  return true;
}

export function getDaysElapsed(dateStr) {
  if (!dateStr) return 0;
  const [y, m, d] = dateStr.split('-').map(Number);
  const past = new Date(y, m - 1, d);
  const now = new Date();
  const todayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((todayZero - past) / 86400000));
}

export function getMonthsElapsed(dateStr) {
  return getDaysElapsed(dateStr) / 30.44;
}

export function getLastServiceRecord(typeId, excludeId = null) {
  const matches = appState.logs
    .filter((l) => l.typeId === typeId && Number(l.cost) > 0 && String(l.id) !== String(excludeId))
    .sort((a, b) => Number(b.km) - Number(a.km) || b.id - a.id);
  return matches.length > 0 ? matches[0] : null;
}

export function computeMaintMemoryMap() {
  const sortedAsc = [...appState.logs].sort((a, b) => Number(a.km) - Number(b.km) || a.id - b.id);
  const lastCostByType = {};
  const memoryMap = {};

  sortedAsc.forEach((log) => {
    const cost = Number(log.cost) || 0;
    const prevCost = lastCostByType[log.typeId];
    if (typeof prevCost === 'number' && prevCost > 0 && cost > 0) {
      memoryMap[log.id] = { hasPrev: true, prevCost, diff: cost - prevCost };
    } else {
      memoryMap[log.id] = { hasPrev: false, prevCost: 0, diff: 0 };
    }
    if (cost > 0) lastCostByType[log.typeId] = cost;
  });
  return memoryMap;
}

export function getLastFuelPriceRecord(excludeId = null) {
  const withPrice = [...appState.fuelLogs]
    .filter((f) => Number(f.priceGal) > 0 && String(f.id) !== String(excludeId))
    .sort((a, b) => Number(b.km) - Number(a.km) || b.id - a.id);
  return withPrice.length > 0 ? withPrice[0] : null;
}

// Extrae los últimos 3 grifos y los últimos 3 talleres usados para las píldoras de autocompletado
export function getRecentQuickPicks() {
  const stations = [];
  const workshops = [];

  const sortedFuelDesc = [...appState.fuelLogs].sort((a, b) => Number(b.km) - Number(a.km) || b.id - a.id);
  for (const f of sortedFuelDesc) {
    const raw = String(f.notes || '').trim();
    if (!raw) continue;
    const clean = raw.split(/[-•,/]/)[0].trim();
    if (clean && !stations.some((s) => s.toLowerCase() === clean.toLowerCase())) {
      stations.push(clean);
      if (stations.length >= 3) break;
    }
  }

  const sortedLogsDesc = [...appState.logs].sort((a, b) => Number(b.km) - Number(a.km) || b.id - a.id);
  for (const l of sortedLogsDesc) {
    const raw = String(l.workshop || '').trim();
    if (!raw) continue;
    if (!workshops.some((w) => w.toLowerCase() === raw.toLowerCase())) {
      workshops.push(raw);
      if (workshops.length >= 3) break;
    }
  }

  if (!workshops.some((w) => w.toLowerCase().includes('casa'))) {
    workshops.push('En casa');
  }

  return {
    stations: stations.length > 0 ? stations : ['Primax', 'Repsol', 'Petroperú'],
    workshops: workshops.slice(0, 4)
  };
}

export function parseDotCode(dotStr) {
  const clean = String(dotStr || '').replace(/\D/g, '');
  if (clean.length !== 4) {
    return { valid: false, label: dotStr ? `DOT ${escapeHTML(dotStr)}` : 'DOT S/N', ageYears: 0, isOld: false };
  }
  const week = parseInt(clean.slice(0, 2), 10);
  const fullYear = 2000 + parseInt(clean.slice(2, 4), 10);
  if (week < 1 || week > 53) {
    return { valid: false, label: `DOT ${clean}`, ageYears: 0, isOld: false };
  }
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentWeek = Math.ceil(((now - new Date(currentYear, 0, 1)) / 86400000 + 1) / 7);
  const ageYears = Math.max(0, (currentYear - fullYear) + (currentWeek - week) / 52);

  return {
    valid: true,
    week,
    fullYear,
    ageYears,
    isOld: ageYears >= 4.0,
    label: `DOT ${clean} (Sem ${week}/${fullYear})`
  };
}

export function estimateMonthlyKmRate() {
  if (appState.fuelLogs.length >= 2) {
    const sorted = [...appState.fuelLogs].sort((a, b) => Number(a.km) - Number(b.km));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const deltaKm = Number(last.km) - Number(first.km);
    if (first.date && last.date && deltaKm > 50) {
      const days = Math.max(1, (new Date(last.date) - new Date(first.date)) / 86400000);
      if (days >= 3) return Math.round((deltaKm / days) * 30);
    }
  }
  return 850;
}

export function getFuelPreviewBaseline(excludeId = null) {
  const logs = appState.fuelLogs
    .filter((f) => String(f.id) !== String(excludeId))
    .sort((a, b) => Number(a.km) - Number(b.km) || a.id - b.id);

  let hasBase = false;
  let lastFullKm = 0;
  let pendingGal = 0;
  let pendingCost = 0;

  for (let i = 0; i < logs.length; i++) {
    const item = logs[i];
    if (item.isLoan) {
      if (item.fullTank !== false) {
        hasBase = true;
        lastFullKm = Number(item.km);
        pendingGal = 0;
        pendingCost = 0;
      } else {
        hasBase = false;
        pendingGal = 0;
        pendingCost = 0;
      }
      continue;
    }

    if (!hasBase) {
      if (item.fullTank !== false) {
        hasBase = true;
        lastFullKm = Number(item.km);
        pendingGal = 0;
        pendingCost = 0;
      }
    } else {
      if (item.fullTank === false) {
        pendingGal += Number(item.gallons) || 0;
        pendingCost += Number(item.cost) || 0;
      } else {
        lastFullKm = Number(item.km);
        pendingGal = 0;
        pendingCost = 0;
      }
    }
  }

  if (!hasBase) return { hasBase: false };

  return {
    hasBase: true,
    lastFullKm,
    lastRecordedKm: Number(logs[logs.length - 1].km),
    pendingGal,
    pendingCost
  };
}

export function computeFuelTelemetry() {
  const sortedAsc = [...appState.fuelLogs].sort((a, b) => Number(a.km) - Number(b.km) || a.id - b.id);
  const enrichedMap = {};
  const intervalPoints = [];
  const stationMap = {};

  let totalDeltaKm = 0;
  let totalGallonsUsed = 0;
  let totalCostUsed = 0;
  let validIntervals = 0;
  let lastIntervalData = null;
  let lastValidPriceGal = null;
  let latestPriceDiff = null;

  let hasBaseFullTank = false;
  let lastFullKm = 0;
  let pendingGal = 0;
  let pendingCost = 0;

  const normalizeStationName = (rawNotes) => {
    const clean = String(rawNotes || '').trim();
    if (!clean) return 'Sin especificar';
    const firstPart = clean.split(/[-•,/]/)[0].trim();
    return firstPart.charAt(0).toUpperCase() + firstPart.slice(1).toLowerCase();
  };

  for (let i = 0; i < sortedAsc.length; i++) {
    const curr = sortedAsc[i];
    const currPrice = Number(curr.priceGal) || 0;
    let priceDiff = null;
    let prevPriceGal = null;

    if (currPrice > 0 && lastValidPriceGal !== null) {
      priceDiff = currPrice - lastValidPriceGal;
      prevPriceGal = lastValidPriceGal;
      latestPriceDiff = { currPrice, prevPriceGal, priceDiff };
    }
    if (currPrice > 0) lastValidPriceGal = currPrice;

    const isFull = curr.fullTank !== false;
    const isLoan = Boolean(curr.isLoan);
    const stationKey = normalizeStationName(curr.notes);

    if (stationKey !== 'Sin especificar') {
      if (!stationMap[stationKey]) {
        stationMap[stationKey] = {
          name: stationKey,
          visits: 0,
          priceSum: 0,
          priceCount: 0,
          lastPrice: 0,
          deltaKmSum: 0,
          galSum: 0,
          costSum: 0
        };
      }
      stationMap[stationKey].visits++;
      if (currPrice > 0) {
        stationMap[stationKey].priceSum += currPrice;
        stationMap[stationKey].priceCount++;
        stationMap[stationKey].lastPrice = currPrice;
      }
    }

    if (isLoan) {
      enrichedMap[curr.id] = {
        isBase: false,
        isPartial: !isFull,
        isLoan: true,
        deltaKm: 0,
        kmPerGal: 0,
        costPerKm: 0,
        priceDiff,
        prevPriceGal
      };
      if (isFull) {
        hasBaseFullTank = true;
        lastFullKm = Number(curr.km);
        pendingGal = 0;
        pendingCost = 0;
      } else {
        hasBaseFullTank = false;
        pendingGal = 0;
        pendingCost = 0;
      }
      continue;
    }

    if (!hasBaseFullTank) {
      if (isFull) {
        hasBaseFullTank = true;
        lastFullKm = Number(curr.km);
        enrichedMap[curr.id] = { isBase: true, isPartial: false, isLoan: false, deltaKm: 0, kmPerGal: 0, costPerKm: 0, priceDiff, prevPriceGal };
      } else {
        enrichedMap[curr.id] = { isBase: false, isPartial: true, isLoan: false, deltaKm: 0, kmPerGal: 0, costPerKm: 0, priceDiff, prevPriceGal };
      }
    } else {
      const gal = Number(curr.gallons) || 0;
      const cost = Number(curr.cost) || 0;

      if (!isFull) {
        pendingGal += gal;
        pendingCost += cost;
        const stepDelta = Math.max(0, Number(curr.km) - Number(sortedAsc[i - 1].km));
        enrichedMap[curr.id] = { isBase: false, isPartial: true, isLoan: false, deltaKm: stepDelta, kmPerGal: 0, costPerKm: 0, priceDiff, prevPriceGal };
      } else {
        const deltaKm = Number(curr.km) - lastFullKm;
        const effectiveGal = gal + pendingGal;
        const effectiveCost = cost + pendingCost;

        if (deltaKm > 0 && effectiveGal > 0) {
          const kmPerGal = deltaKm / effectiveGal;
          const costPerKm = effectiveCost / deltaKm;
          enrichedMap[curr.id] = { isBase: false, isPartial: false, isLoan: false, deltaKm, kmPerGal, costPerKm, priceDiff, prevPriceGal };
          totalDeltaKm += deltaKm;
          totalGallonsUsed += effectiveGal;
          totalCostUsed += effectiveCost;
          validIntervals++;
          lastIntervalData = { deltaKm, kmPerGal, costPerKm, gal: effectiveGal, cost: effectiveCost };
          intervalPoints.push({ km: Number(curr.km), kmPerGal });

          if (stationKey !== 'Sin especificar' && stationMap[stationKey]) {
            stationMap[stationKey].deltaKmSum += deltaKm;
            stationMap[stationKey].galSum += effectiveGal;
            stationMap[stationKey].costSum += effectiveCost;
          }
        } else {
          enrichedMap[curr.id] = { isBase: false, isPartial: false, isLoan: false, deltaKm: Math.max(0, deltaKm), kmPerGal: 0, costPerKm: 0, priceDiff, prevPriceGal };
        }
        lastFullKm = Number(curr.km);
        pendingGal = 0;
        pendingCost = 0;
      }
    }
  }

  const avgKmPerGal = totalGallonsUsed > 0 ? totalDeltaKm / totalGallonsUsed : 140;
  const avgCostPerKm = totalDeltaKm > 0 ? totalCostUsed / totalDeltaKm : 0.12;

  let diagnosticAlert = null;
  if (validIntervals >= 2 && lastIntervalData) {
    const dropRatio = (avgKmPerGal - lastIntervalData.kmPerGal) / avgKmPerGal;
    if (dropRatio >= 0.12) {
      diagnosticAlert = {
        status: 'warn',
        dropPct: Math.round(dropRatio * 100),
        title: `Caída de rendimiento detectada (-${Math.round(dropRatio * 100)}%)`,
        advice: 'Tu último tramo rindió menos que tu media histórica. Revisa: 1) Presión de llantas en frío (25/28 PSI), 2) Limpieza y holgura de cadena O-Ring (20-30 mm), 3) Estado del filtro viscoso y bujías DTS-i.'
      };
    } else if (lastIntervalData.kmPerGal >= avgKmPerGal) {
      diagnosticAlert = {
        status: 'ok',
        dropPct: 0,
        title: 'Inyección FI y combustión en rango óptimo',
        advice: `Tu último tramo (${lastIntervalData.kmPerGal.toFixed(1)} km/gal) iguala o supera tu media histórica.`
      };
    }
  }

  const stationRanking = Object.values(stationMap)
    .map((st) => {
      const avgPrice = st.priceCount > 0 ? st.priceSum / st.priceCount : 0;
      const realKmPerGal = st.galSum > 0 ? st.deltaKmSum / st.galSum : 0;
      const realCostPerKm = st.deltaKmSum > 0 ? st.costSum / st.deltaKmSum : 0;
      return {
        name: st.name,
        visits: st.visits,
        avgPrice,
        lastPrice: st.lastPrice,
        realKmPerGal,
        realCostPerKm
      };
    })
    .sort((a, b) => {
      if (a.realCostPerKm > 0 && b.realCostPerKm > 0) return a.realCostPerKm - b.realCostPerKm;
      if (a.avgPrice > 0 && b.avgPrice > 0) return a.avgPrice - b.avgPrice;
      return b.visits - a.visits;
    });

  return {
    enrichedMap,
    validIntervals,
    avgKmPerGal,
    avgCostPerKm,
    lastIntervalData,
    latestPriceDiff,
    intervalPoints,
    diagnosticAlert,
    stationRanking
  };
}

export function computeWorkshopRanking() {
  const map = {};
  let diyCount = 0;
  let diyPartsSpent = 0;

  appState.logs.forEach((l) => {
    const rawW = String(l.workshop || '').trim();
    const labor = Number(l.laborCost) || 0;
    const parts = Number(l.partsCost ?? l.cost) || 0;
    const total = Number(l.cost) || 0;

    const name = rawW ? rawW : (labor === 0 ? 'Hecho en casa (Tú mismo)' : 'Taller General');
    if (labor === 0 && parts > 0) {
      diyCount++;
      diyPartsSpent += parts;
    }

    if (!map[name]) {
      map[name] = {
        name,
        visits: 0,
        totalSpent: 0,
        partsSpent: 0,
        laborSpent: 0,
        lastDate: l.date || '',
        lastKm: Number(l.km) || 0
      };
    }
    map[name].visits++;
    map[name].totalSpent += total;
    map[name].partsSpent += parts;
    map[name].laborSpent += labor;
    if ((Number(l.km) || 0) >= map[name].lastKm) {
      map[name].lastKm = Number(l.km) || 0;
      map[name].lastDate = l.date || map[name].lastDate;
    }
  });

  const list = Object.values(map).sort((a, b) => b.visits - a.visits || b.totalSpent - a.totalSpent);
  return { list, diyCount, diyPartsSpent };
}

export function evaluateDocsStatus() {
  const docs = appState.docs || {};
  const today = new Date();
  const zeroToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const alerts = [];
  let hasDanger = false;
  let hasWarn = false;

  if (docs.soatExp) {
    const [y, m, d] = docs.soatExp.split('-').map(Number);
    const expDate = new Date(y, m - 1, d);
    const diffDays = Math.ceil((expDate - zeroToday) / 86400000);
    if (diffDays < 0) {
      hasDanger = true;
      alerts.push(`⚠️ <strong style="color:var(--red-danger)">SOAT Vencido hace ${Math.abs(diffDays)}d</strong>`);
    } else if (diffDays <= 15) {
      hasWarn = true;
      alerts.push(`🔔 <strong style="color:var(--amber-warn)">SOAT vence en ${diffDays}d</strong>`);
    } else {
      alerts.push(`✅ <strong>SOAT:</strong> ${diffDays}d vigentes`);
    }
  }

  if (docs.licenseExp) {
    const [y, m, d] = docs.licenseExp.split('-').map(Number);
    const expDate = new Date(y, m - 1, d);
    const diffDays = Math.ceil((expDate - zeroToday) / 86400000);
    if (diffDays < 0) {
      hasDanger = true;
      alerts.push(`⚠️ <strong style="color:var(--red-danger)">Brevete Vencido hace ${Math.abs(diffDays)}d</strong>`);
    } else if (diffDays <= 30) {
      hasWarn = true;
      alerts.push(`🔔 <strong style="color:var(--amber-warn)">Brevete vence en ${diffDays}d</strong>`);
    } else {
      alerts.push(`🪪 <strong>Brevete:</strong> Al día (${docs.licenseExp})`);
    }
  }

  const summaryHtml =
    alerts.length > 0
      ? alerts.join(' • ')
      : '🪪 Registra tu Placa, SOAT y Brevete para activar las alertas automáticas de vigencia.';

  return {
    hasAlert: hasDanger || hasWarn,
    hasDanger,
    summaryHtml
  };
}

export function computeMasterFinancials() {
  const allFuel = appState.fuelLogs.reduce((s, f) => s + (Number(f.cost) || 0), 0);
  const allMaint = appState.logs.reduce((s, l) => s + (Number(l.cost) || 0), 0);
  const allParts = appState.logs.reduce((s, l) => s + (Number(l.partsCost ?? l.cost) || 0), 0);
  const allLabor = appState.logs.reduce((s, l) => s + (Number(l.laborCost) || 0), 0);
  const allSpa = (appState.washLogs || []).reduce((s, w) => s + (Number(w.cost) || 0), 0);

  const frontCost = Number(appState.tires.front.cost) || 0;
  const rearCost = Number(appState.tires.rear.cost) || 0;
  const histTireCost = (appState.tires.history || []).reduce((s, h) => s + (Number(h.cost) || 0), 0);
  const allTires = frontCost + rearCost + histTireCost;

  const modsCost = (appState.accessories || []).reduce((s, m) => s + (Number(m.cost) || 0), 0);
  const bikePrice = Number(appState.bikePurchasePrice) || 0;
  const capexTotal = bikePrice + modsCost;

  const allGarage = allTires + modsCost;

  const soatCost = Number(appState.docs?.soatCost) || 0;
  const extraDocsAndOther = (appState.otherExpenses || []).reduce((s, e) => s + (Number(e.cost) || 0), 0);
  const allAdmin = soatCost + extraDocsAndOther;

  const opCostTotal = allFuel + allMaint + allSpa + allAdmin + allTires;
  const grandTotalInvested = opCostTotal + capexTotal;

  const trackedKm = Math.max(0, Number(appState.currentKm) - (Number(appState.initialKm) || 0));
  const realOpCostPerKm = trackedKm > 0 ? opCostTotal / trackedKm : 0;

  const allDates = [
    appState.firstUseDate,
    ...appState.fuelLogs.map((f) => f.date),
    ...appState.logs.map((l) => l.date),
    ...(appState.washLogs || []).map((w) => w.date),
    ...(appState.otherExpenses || []).map((e) => e.date)
  ]
    .filter(Boolean)
    .sort();

  let activeDays = 1;
  if (allDates.length > 0) {
    const [y, m, d] = allDates[0].split('-').map(Number);
    const firstDate = new Date(y, m - 1, d);
    const now = new Date();
    const diffDays = Math.floor((now - firstDate) / 86400000) + 1;
    activeDays = Math.max(1, diffDays);
  }
  const dailyOpCost = opCostTotal / activeDays;

  const safeOpDiv = Math.max(1, allFuel + allMaint + allSpa + allGarage + allAdmin);
  const shares = {
    fuelPct: Math.round((allFuel / safeOpDiv) * 100),
    maintPct: Math.round((allMaint / safeOpDiv) * 100),
    spaPct: Math.round((allSpa / safeOpDiv) * 100),
    garagePct: Math.round((allGarage / safeOpDiv) * 100),
    adminPct: Math.round((allAdmin / safeOpDiv) * 100)
  };

  return {
    bikePrice,
    modsCost,
    capexTotal,
    allTires,
    allFuel,
    allMaint,
    allParts,
    allLabor,
    allSpa,
    allGarage,
    allAdmin,
    opCostTotal,
    grandTotalInvested,
    trackedKm,
    realOpCostPerKm,
    activeDays,
    dailyOpCost,
    shares
  };
}

// Abre directamente Google Calendar con el evento pre-cargado (Sin descargar archivos .ics)
export function openGoogleCalendarEvent({ title, description, dateStr }) {
  let targetDate = dateStr;
  if (!targetDate) {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    targetDate = d.toISOString().slice(0, 10);
  }

  const [y, m, day] = targetDate.split('-').map(Number);
  const startObj = new Date(Date.UTC(y, m - 1, day));
  const endObj = new Date(Date.UTC(y, m - 1, day + 1));

  const fmt = (dt) => dt.toISOString().slice(0, 10).replace(/-/g, '');
  const datesParam = `${fmt(startObj)}/${fmt(endObj)}`;

  const gcalUrl =
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(`🏍️ Mi Moto N160: ${title}`)}` +
    `&dates=${datesParam}` +
    `&details=${encodeURIComponent(description || 'Recordatorio generado desde Mi Moto - Pulsar N160 FI')}`;

  window.open(gcalUrl, '_blank', 'noopener,noreferrer');
}
