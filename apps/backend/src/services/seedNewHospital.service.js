// apps/backend/src/services/seedNewHospital.service.js
//
// Called once, right after a new Hospital row is created during signup.
// Calls the ML service's cold-start endpoint, then writes the returned
// starter history into Postgres, clearly flagged isSynthetic=true.

const prisma = require("../config/db");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

// Map your signup form's `type` field to what the ML simulation expects.
// Extend this if your form collects more/different facility types.
const FACILITY_TYPE_MAP = {
  General: "District_Hospital",
  Teaching: "Teaching_Hospital",
  Regional: "Regional_Hospital",
  Specialty: "Central_Hospital",
  Clinic: "PHC",
};

// Rough dosage-form -> packaging-unit mapping. Your actual medicine form
// uses free-text units like "boxes"/"vials"/"bottles" — this is a
// reasonable default, adjust the mapping if your data differs.
const UNIT_MAP = {
  Tablet: "boxes",
  Capsule: "boxes",
  Syrup: "bottles",
  Injection: "vials",
  IV_Fluid: "bottles",
  Ointment: "tubes",
  Drops: "bottles",
};

async function seedNewHospitalHistory(hospital) {
  const facilityType = FACILITY_TYPE_MAP[hospital.type] || "District_Hospital";

  let seedData;
  try {
    const res = await fetch(`${ML_SERVICE_URL}/onboarding/seed-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hospital_id: hospital.id,
        facility_type: facilityType,
        province: hospital.location || "Bagmati",
        district: hospital.location || "Kathmandu",
        bed_capacity: 80,
        weeks_of_history: 26,
      }),
      signal: AbortSignal.timeout(30000), // this can take a few seconds, give it room
    });
    if (!res.ok) throw new Error(`ML service returned ${res.status}`);
    seedData = await res.json();
  } catch (err) {
    // Seeding is a nice-to-have for a good first-login experience — never
    // let it block or fail the actual signup.
    console.error("Cold-start seeding failed, hospital created with empty history:", err.message);
    return { seeded: false };
  }

  // 1. Create Medicine rows (current batches) from the synthetic snapshot
  const medicineIdMap = {}; // ML medicine_id (e.g. "MED-021") -> real Medicine.id
  for (const batch of seedData.current_inventory) {
    const med = await prisma.medicine.create({
      data: {
        hospitalId: hospital.id,
        medicineCode: batch.medicine_id,
        name: batch.generic_name || batch.medicine_id,
        category: batch.category || "Uncategorized",
        unit: UNIT_MAP[batch.dosage_form] || "units",
        batch: batch.batch_no,
        quantity: batch.quantity_available,
        expiry: new Date(batch.expiry_date),
      },
    });
    medicineIdMap[batch.medicine_id] = med.id;
  }

  // 2. Create InventoryMovement rows from the transaction ledger
  // Note: Extra fields (batchNo, counterpartyId, etc) from Samir's enhanced schema are optional
  // For backward compat with simple schema (IN/OUT only), we map types and use base fields
  const movements = seedData.transactions
    .filter((tx) => medicineIdMap[tx.medicine_id])
    .map((tx) => {
      // Map Samir's detailed types to Sushant's base types if needed, but merged enum now supports both
      // Keep original type if valid, otherwise map to IN/OUT
      let type = tx.type;
      const validTypes = ["IN", "OUT", "PROCUREMENT", "CONSUMPTION", "EXCHANGE_OUT", "EXCHANGE_IN", "EXPIRY_WRITEOFF"];
      if (!validTypes.includes(type)) {
        // Fallback: procurement/in -> IN, consumption/out -> OUT
        if (["CONSUMPTION", "EXCHANGE_OUT", "EXPIRY_WRITEOFF"].includes(type)) type = "OUT";
        else type = "IN";
      }
      return {
        hospitalId: hospital.id,
        medicineId: medicineIdMap[tx.medicine_id],
        type,
        quantity: Math.abs(tx.quantity),
        occurredAt: new Date(tx.occurred_at),
      };
    });

  if (movements.length > 0) {
    await prisma.inventoryMovement.createMany({ data: movements });
  }

  return { seeded: true, medicinesCreated: Object.keys(medicineIdMap).length, movementsCreated: movements.length };
}

module.exports = { seedNewHospitalHistory };