require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});


/**
 * Seed MedBridge DB from ML synthetic CSVs (8 demo hospital logins).
 *
 * Reads:
 *   apps/ml-service/data/raw/hospitals.csv
 *   apps/ml-service/data/raw/medicines.csv
 *   apps/ml-service/data/raw/inventory_snapshots.csv
 *   apps/ml-service/data/raw/demo_hospital_accounts.csv
 *   apps/ml-service/data/raw/resource_exchange_log.csv
 *
 * Demo password for all: MedBridge@2026
 * Emails: admin@demo-01.medbridge.local … admin@demo-08.medbridge.local
 * Legacy: sarah.johnson@cityhospital.org / password123  (maps to DEMO-01)
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const ML_RAW = path.resolve(__dirname, "../../ml-service/data/raw");

function readCsv(fileName) {
  const full = path.join(ML_RAW, fileName);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing ${full}. Run: cd apps/ml-service && python training/generate_synthetic_data.py`);
  }
  const text = fs.readFileSync(full, "utf8").trim();
  if (!text) throw new Error(`Empty CSV: ${full}`);
  const lines = text.split(/\r?\n/);
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] !== undefined ? cols[i] : "";
    });
    return row;
  });
}

/** Minimal CSV splitter supporting quoted commas */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function mapStockStatus(status, quantity, reorder) {
  const s = String(status || "").toUpperCase();
  if (s.includes("OUT")) return "CRITICAL";
  if (s.includes("LOW_AND") || s.includes("LOW_STOCK")) return "LOW_STOCK";
  if (s.includes("NEAR")) return "MEDIUM_STOCK";
  if (quantity <= (reorder || 0)) return "LOW_STOCK";
  if (quantity < (reorder || 0) * 2) return "MEDIUM_STOCK";
  return "IN_STOCK";
}

function mapExchangeStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("complete")) return "COMPLETED";
  if (s.includes("transit")) return "IN_TRANSIT";
  if (s.includes("approve")) return "APPROVED";
  if (s.includes("reject")) return "DECLINED";
  if (s.includes("request")) return "PENDING";
  return "PENDING";
}

function facilityTypeLabel(t) {
  return String(t || "General").replace(/_/g, " ");
}

async function main() {
  console.log("Seeding from ML CSVs in", ML_RAW);

  const hospitalsCsv = readCsv("hospitals.csv");
  const medicinesCsv = readCsv("medicines.csv");
  const inventoryCsv = readCsv("inventory.csv");
  let accountsCsv = [];
  try {
    accountsCsv = readCsv("demo_hospital_accounts.csv");
  } catch {
    console.warn("demo_hospital_accounts.csv missing — will synthesize accounts");
  }
  let exchangeCsv = [];
  try {
    exchangeCsv = readCsv("resource_exchange_log.csv");
  } catch {
    console.warn("resource_exchange_log.csv missing — skipping exchanges");
  }

  const demoHospitals = hospitalsCsv.filter((h) => String(h.is_demo) === "1");
  if (demoHospitals.length === 0) {
    throw new Error("No is_demo=1 hospitals in hospitals.csv");
  }

  const medById = Object.fromEntries(medicinesCsv.map((m) => [m.medicine_id, m]));

  console.log("Cleaning existing data…");
  await prisma.inventoryMovement.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.report.deleteMany();
  await prisma.exchangeRequest.deleteMany();
  await prisma.medicine.deleteMany();
  await prisma.user.deleteMany();
  await prisma.hospital.deleteMany();

  const passwordHash = await bcrypt.hash("MedBridge@2026", 10);
  const legacyHash = await bcrypt.hash("password123", 10);

  const hospitalIdByCode = {};
  const accountByCode = Object.fromEntries(
    accountsCsv.map((a) => [a.hospital_id, a])
  );

  console.log(`Creating ${demoHospitals.length} demo hospitals + admins…`);
  for (const h of demoHospitals) {
    const code = h.hospital_id;
    const hospital = await prisma.hospital.create({
      data: {
        externalCode: code,
        name: h.hospital_name,
        location: [h.municipality, h.district, h.province].filter(Boolean).join(", "),
        type: facilityTypeLabel(h.facility_type),
        province: h.province || null,
        district: h.district || null,
        ecoregion: h.ecoregion || null,
        rating: 4.5,
      },
    });
    hospitalIdByCode[code] = hospital.id;

    const acc = accountByCode[code] || {};
    const username = acc.demo_username || code.toLowerCase().replace("-", "_");
    const email = `admin@${code.toLowerCase()}.medbridge.local`;

    await prisma.user.create({
      data: {
        name: `${h.hospital_name} Admin`,
        email,
        passwordHash,
        role: "ADMIN",
        approvalStatus: "APPROVED",
        hospitalId: hospital.id,
      },
    });
    console.log(`  ${code}  login: ${email} / MedBridge@2026  (${username})`);
  }
  
// Legacy single login used by older frontend docs → DEMO-01
// Extra Sarah demo account for a separate hospital.
// Sarah will use Bhaktapur Cancer Hospital's own inventory and forecast data.
const sarahHospitalCode = "HOSP-BG-003";
const sarahHospitalId = hospitalIdByCode[sarahHospitalCode];

if (!sarahHospitalId) {
  throw new Error(`Sarah hospital ${sarahHospitalCode} was not found.`);
}

await prisma.user.create({
  data: {
    name: "Dr. Sarah Johnson",
    email: "sarah.johnson@cityhospital.org",
    passwordHash: legacyHash,
    role: "ADMIN",
    approvalStatus: "APPROVED",
    hospitalId: sarahHospitalId,
    avatarUrl:
      "https://images.unsplash.com/photo-1594824476967-48c8b964273f?q=80&w=200&auto=format&fit=crop",
  },
});

console.log(
  `Sarah created: sarah.johnson@cityhospital.org / password123 → ${sarahHospitalCode}`
);
  // Inventory batches for demo hospitals only (aggregate by hospital+medicine+batch)
  const demoCodes = new Set(Object.keys(hospitalIdByCode));
  const invRows = inventoryCsv.filter((r) => demoCodes.has(r.hospital_id));
  console.log(`Importing ${invRows.length} inventory batches…`);

  let medCreated = 0;
  const medicineUuidByKey = {}; // hospitalCode|medicineId|batch -> uuid

  for (const row of invRows) {
    const hospitalDbId = hospitalIdByCode[row.hospital_id];
    if (!hospitalDbId) continue;
    const meta = medById[row.medicine_id] || {};
    const qty = parseInt(row.quantity_available ?? row.quantity_units, 10) || 0;
    const reorder = parseInt(row.reorder_level, 10) || 0;
    const unitPrice = parseFloat(row.unit_cost_npr || meta.unit_cost_npr || 0) || 0;
    const expiry = row.expiry_date ? new Date(row.expiry_date) : new Date(Date.now() + 180 * 864e5);
    const status = mapStockStatus(row.stock_status, qty, reorder);
    const name = meta.generic_name || row.medicine_id;
    const category = meta.category || "General";
    const unit = row.unit || meta.unit || "units";
    const batch = row.batch_no || row.batch_id || `BATCH-${medCreated}`;

    const created = await prisma.medicine.create({
      data: {
        medicineCode: row.medicine_id,
        name,
        category,
        batch,
        quantity: qty,
        unit,
        unitPrice,
        expiry,
        status,
        hospitalId: hospitalDbId,
      },
    });
    medicineUuidByKey[`${row.hospital_id}|${row.medicine_id}|${batch}`] = created.id;
    // also index without batch for movements
    medicineUuidByKey[`${row.hospital_id}|${row.medicine_id}`] =
      medicineUuidByKey[`${row.hospital_id}|${row.medicine_id}`] || created.id;
    medCreated++;
  }
  console.log(`  medicines/batches created: ${medCreated}`);

  // Synthetic movements from inventory avg_daily_use for charts
  console.log("Creating inventory movements for charts…");
  const movementRows = [];
  const seenPair = new Set();
  for (const row of invRows) {
    const key = `${row.hospital_id}|${row.medicine_id}`;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    const medicineId = medicineUuidByKey[key];
    const hospitalId = hospitalIdByCode[row.hospital_id];
    if (!medicineId || !hospitalId) continue;
    const daily = Math.max(1, Math.round(parseFloat(row.avg_daily_use) || 5));
    for (let i = 6; i >= 0; i--) {
      const day = new Date();
      day.setDate(day.getDate() - i);
      movementRows.push({
        hospitalId,
        medicineId,
        type: "OUT",
        quantity: daily + (i % 3),
        occurredAt: day,
      });
      movementRows.push({
        hospitalId,
        medicineId,
        type: "IN",
        quantity: Math.round(daily * 1.2),
        occurredAt: day,
      });
    }
    // monthly OUT for 6 months
    for (let m = 5; m >= 0; m--) {
      const day = new Date();
      day.setMonth(day.getMonth() - m);
      movementRows.push({
        hospitalId,
        medicineId,
        type: "OUT",
        quantity: daily * 25 + m * 3,
        occurredAt: day,
      });
    }
  }
  // insert in chunks
  const chunk = 1000;
  for (let i = 0; i < movementRows.length; i += chunk) {
    await prisma.inventoryMovement.createMany({ data: movementRows.slice(i, i + chunk) });
  }
  console.log(`  movements: ${movementRows.length}`);

  // Exchange log among demo hospitals
  const demoExchanges = exchangeCsv.filter(
    (e) => demoCodes.has(e.from_hospital_id) && demoCodes.has(e.to_hospital_id)
  );
  let exCount = 0;
  for (const e of demoExchanges.slice(0, 80)) {
    const fromId = hospitalIdByCode[e.from_hospital_id];
    const toId = hospitalIdByCode[e.to_hospital_id];
    if (!fromId || !toId || fromId === toId) continue;
    const meta = medById[e.medicine_id] || {};
    await prisma.exchangeRequest.create({
      data: {
        medicine: meta.generic_name || e.medicine_id,
        quantity: parseInt(e.quantity_units, 10) || 10,
        unit: meta.unit || "units",
        status: mapExchangeStatus(e.status),
        requestedOn: e.request_date ? new Date(e.request_date) : new Date(),
        fromHospitalId: fromId,
        toHospitalId: toId,
      },
    });
    exCount++;
  }
  console.log(`  exchange requests: ${exCount}`);

  // Notifications per hospital from low/near-expiry stock
  for (const code of demoCodes) {
    const hospitalId = hospitalIdByCode[code];
    const critical = await prisma.medicine.findMany({
      where: { hospitalId, status: { in: ["CRITICAL", "LOW_STOCK"] } },
      take: 3,
      orderBy: { quantity: "asc" },
    });
    const notes = critical.map((m) => ({
      hospitalId,
      title: `${m.name} is low`,
      body: `Only ${m.quantity} ${m.unit} left (batch ${m.batch}). Consider exchange or procurement.`,
      type: m.status === "CRITICAL" ? "CRITICAL" : "INFO",
      read: false,
    }));
    notes.push({
      hospitalId,
      title: "XGBoost forecast ready",
      body: "Open Demand Forecast to see AI-predicted weekly medicine needs for your facility.",
      type: "SUCCESS",
      read: false,
    });
    if (notes.length) await prisma.notification.createMany({ data: notes });

    await prisma.report.createMany({
      data: [
        { hospitalId, name: "Monthly Inventory Summary", period: "Jun 2026", type: "INVENTORY" },
        { hospitalId, name: "Exchange Activity Report", period: "Q2 2026", type: "EXCHANGE" },
        { hospitalId, name: "Expiry Risk Report", period: "Jun 2026", type: "COMPLIANCE" },
      ],
    });
  }

  console.log("\nSeed complete.");
  console.log("────────────────────────────────────────────");
  console.log("8 demo hospital logins (password: MedBridge@2026)");
  for (const code of Object.keys(hospitalIdByCode).sort()) {
    console.log(`  admin@${code.toLowerCase()}.medbridge.local`);
  }
  console.log("Legacy: sarah.johnson@cityhospital.org / password123");
  console.log("────────────────────────────────────────────");
  console.log("Start ML:  cd apps/ml-service && uvicorn app.api.server:app --port 8000");
  console.log("Start API: cd apps/backend && npm run dev");
}

main()

  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
