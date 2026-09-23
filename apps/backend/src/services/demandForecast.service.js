const prisma = require("../config/db");
const ml = require("./mlClient");

async function resolveHospitalCode(hospitalId) {
  const hospital = await prisma.hospital.findUnique({
    where: { id: hospitalId },
    select: { externalCode: true },
  });
  return hospital?.externalCode || null;
}

async function fallbackForecast(hospitalId, months = 6) {
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const movements = await prisma.inventoryMovement.findMany({
    where: { hospitalId, type: "OUT", occurredAt: { gte: since } },
  });

  const byMonth = new Map();
  for (const movement of movements) {
    const key = `${movement.occurredAt.getFullYear()}-${movement.occurredAt.getMonth()}`;
    byMonth.set(key, (byMonth.get(key) || 0) + movement.quantity);
  }

  const now = new Date();
  const history = [];
  for (let i = months - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    history.push({
      month: date.toLocaleDateString("en-US", { month: "short" }),
      actual: byMonth.get(key) || 0,
    });
  }

  const average = history.slice(-3).reduce((sum, row) => sum + row.actual, 0) / 3;
  const result = history.map((row) => ({ ...row, forecast: Math.round(row.actual) }));
  for (let i = 1; i <= 2; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    result.push({
      month: date.toLocaleDateString("en-US", { month: "short" }),
      actual: null,
      forecast: Math.round(average * (1 + 0.05 * i)),
    });
  }
  return result;
}

// Uses the model for hospitals that are linked to an ML dataset. The existing
// database-derived calculation remains a graceful fallback for new hospitals
// and when the ML service is unavailable.
async function getForecast(hospitalId, months = 6) {
  const hospitalCode = await resolveHospitalCode(hospitalId);
  if (hospitalCode) {
    try {
      const forecast = await ml.getForecastChart(hospitalCode, months);
      if (Array.isArray(forecast.series) && forecast.series.length) return forecast.series;
    } catch (error) {
      // The forecast screen must stay usable if a separately deployed ML
      // service is starting up or temporarily unavailable.
      console.warn(`ML forecast unavailable for ${hospitalCode}: ${error.message}`);
    }
  }
  return fallbackForecast(hospitalId, months);
}

module.exports = { getForecast, fallbackForecast, resolveHospitalCode };
