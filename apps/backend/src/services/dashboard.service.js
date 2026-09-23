const prisma = require("../config/db");

async function getStats(hospitalId) {
  const medicines = await prisma.medicine.findMany({
    where: { hospitalId },
    select: { quantity: true, unitPrice: true },
  });

  const totalMedicines = medicines.reduce((sum, m) => sum + m.quantity, 0);
  const totalValue = medicines.reduce((sum, m) => sum + m.quantity * m.unitPrice, 0);

  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 30);
  const expiringSoon = await prisma.medicine.count({
    where: { hospitalId, expiry: { gte: now, lte: cutoff } },
  });

  const activeExchanges = await prisma.exchangeRequest.count({
    where: {
      OR: [{ fromHospitalId: hospitalId }, { toHospitalId: hospitalId }],
      status: { in: ["PENDING", "APPROVED", "IN_TRANSIT"] },
    },
  });

  return {
    totalMedicines: { value: totalMedicines },
    totalValue: { value: Math.round(totalValue) },
    expiringSoon: { value: expiringSoon, window: "30 days" },
    activeExchanges: { value: activeExchanges, label: "In progress" },
  };
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function buildOverviewBuckets(period) {
  const now = startOfDay(new Date());

  if (period === "month") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const buckets = [];
    const cursor = new Date(monthStart);
    while (cursor <= now) {
      const bucketStart = startOfDay(cursor);
      const bucketEnd = endOfDay(new Date(cursor));
      bucketEnd.setDate(bucketEnd.getDate() + 6);
      if (bucketEnd > endOfDay(now)) bucketEnd.setTime(endOfDay(now).getTime());
      buckets.push({
        key: bucketStart.toISOString().slice(0, 10),
        day: bucketStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        start: bucketStart,
        end: bucketEnd,
        stockIn: 0,
        stockOut: 0,
      });
      cursor.setDate(cursor.getDate() + 7);
    }
    return buckets;
  }

  if (period === "quarter") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    const buckets = [];
    const cursor = new Date(now.getFullYear(), quarterStartMonth, 1);
    while (cursor <= now) {
      const bucketStart = startOfDay(cursor);
      const monthEnd = endOfDay(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
      const bucketEnd = monthEnd > endOfDay(now) ? endOfDay(now) : monthEnd;
      buckets.push({
        key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
        day: cursor.toLocaleDateString("en-US", { month: "short" }),
        start: bucketStart,
        end: bucketEnd,
        stockIn: 0,
        stockOut: 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return buckets;
  }

  const buckets = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const bucketStart = startOfDay(d);
    buckets.push({
      key: bucketStart.toISOString().slice(0, 10),
      day: bucketStart.toLocaleDateString("en-US", { weekday: "short" }),
      start: bucketStart,
      end: endOfDay(d),
      stockIn: 0,
      stockOut: 0,
    });
  }
  return buckets;
}

function movementInBucket(occurredAt, bucket) {
  const t = occurredAt.getTime();
  return t >= bucket.start.getTime() && t <= bucket.end.getTime();
}

// Stock in/out totals for the trend chart (daily / weekly / monthly buckets by period).
async function getInventoryOverview(hospitalId, period = "week") {
  const buckets = buildOverviewBuckets(period);
  if (!buckets.length) {
    return [];
  }

  const since = buckets[0].start;

  const movements = await prisma.inventoryMovement.findMany({
    where: { hospitalId, occurredAt: { gte: since } },
  });

  for (const m of movements) {
    const bucket = buckets.find((b) => movementInBucket(m.occurredAt, b));
    if (!bucket) continue;
    if (m.type === "IN") bucket.stockIn += m.quantity;
    else bucket.stockOut += m.quantity;
  }

  return buckets.map(({ day, stockIn, stockOut }) => ({ day, stockIn, stockOut }));
}

module.exports = { getStats, getInventoryOverview };
