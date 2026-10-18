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

export function getMonthsElapsed(dateStr) {
  if (!dateStr) return 0;
  const [y, m, d] = dateStr.split('-').map(Number);
  const past = new Date(y, m - 1, d);
  const now = new Date();
  const diffDays = (now - past) / 86400000;
  return Math.max(0, diffDays / 30.44);
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

// Busca el primer tanque lleno real para establecer el Punto Base sin distorsiones por cargas parciales iniciales
export function getFuelPreviewBaseline(excludeId = null) {
  const logs = appState.fuelLogs
    .filter((f) => String(f.id) !== String(excludeId))
    .sort((a, b) => Number(a.km) - Number(b.km) || a.id - b.id);

  const firstFullIdx = logs.findIndex((f) => f.fullTank !== false);
  if (firstFullIdx === -1) return { hasBase: false };

  let lastFullKm = Number(logs[firstFullIdx].km);
  let pendingGal = 0;
  let pendingCost = 0;

  for (let i = firstFullIdx + 1; i < logs.length; i++) {
    const item = logs[i];
    if (item.fullTank === false) {
      pendingGal += Number(item.gallons) || 0;
      pendingCost += Number(item.cost) || 0;
    } else {
      lastFullKm = Number(item.km);
      pendingGal = 0;
      pendingCost = 0;
    }
  }

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

    if (!hasBaseFullTank) {
      if (isFull) {
        hasBaseFullTank = true;
        lastFullKm = Number(curr.km);
        enrichedMap[curr.id] = { isBase: true, isPartial: false, deltaKm: 0, kmPerGal: 0, costPerKm: 0, priceDiff, prevPriceGal };
      } else {
        enrichedMap[curr.id] = { isBase: false, isPartial: true, deltaKm: 0, kmPerGal: 0, costPerKm: 0, priceDiff, prevPriceGal };
      }
    } else {
      const gal = Number(curr.gallons) || 0;
      const cost = Number(curr.cost) || 0;

      if (!isFull) {
        pendingGal += gal;
        pendingCost += cost;
        const stepDelta = Math.max(0, Number(curr.km) - Number(sortedAsc[i - 1].km));
        enrichedMap[curr.id] = { isBase: false, isPartial: true, deltaKm: stepDelta, kmPerGal: 0, costPerKm: 0, priceDiff, prevPriceGal };
      } else {
        const deltaKm = Number(curr.km) - lastFullKm;
        const effectiveGal = gal + pendingGal;
        const effectiveCost = cost + pendingCost;

        if (deltaKm > 0 && effectiveGal > 0) {
          const kmPerGal = deltaKm / effectiveGal;
          const costPerKm = effectiveCost / deltaKm;
          enrichedMap[curr.id] = { isBase: false, isPartial: false, deltaKm, kmPerGal, costPerKm, priceDiff, prevPriceGal };
          totalDeltaKm += deltaKm;
          totalGallonsUsed += effectiveGal;
          totalCostUsed += effectiveCost;
          validIntervals++;
          lastIntervalData = { deltaKm, kmPerGal, costPerKm, gal: effectiveGal, cost: effectiveCost };
          intervalPoints.push({ km: Number(curr.km), kmPerGal });
        } else {
          enrichedMap[curr.id] = { isBase: false, isPartial: false, deltaKm: Math.max(0, deltaKm), kmPerGal: 0, costPerKm: 0, priceDiff, prevPriceGal };
        }
        lastFullKm = Number(curr.km);
        pendingGal = 0;
        pendingCost = 0;
      }
    }
  }

  const avgKmPerGal = totalGallonsUsed > 0 ? totalDeltaKm / totalGallonsUsed : 140;
  const avgCostPerKm = totalDeltaKm > 0 ? totalCostUsed / totalDeltaKm : 0.12;

  return { enrichedMap, validIntervals, avgKmPerGal, avgCostPerKm, lastIntervalData, latestPriceDiff, intervalPoints };
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
  const modsCost = (appState.accessories || []).reduce((s, m) => s + (Number(m.cost) || 0), 0);
  const allGarage = frontCost + rearCost + histTireCost + modsCost;

  const soatCost = Number(appState.docs?.soatCost) || 0;
  const extraDocsAndOther = (appState.otherExpenses || []).reduce((s, e) => s + (Number(e.cost) || 0), 0);
  const allAdmin = soatCost + extraDocsAndOther;

  const opCostTotal = allFuel + allMaint + allSpa + allAdmin;
  const grandTotalInvested = opCostTotal + allGarage;

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

  const safeDiv = grandTotalInvested > 0 ? grandTotalInvested : 1;
  const shares = {
    fuelPct: Math.round((allFuel / safeDiv) * 100),
    maintPct: Math.round((allMaint / safeDiv) * 100),
    spaPct: Math.round((allSpa / safeDiv) * 100),
    garagePct: Math.round((allGarage / safeDiv) * 100),
    adminPct: Math.round((allAdmin / safeDiv) * 100)
  };

  return {
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
