const assert = require("node:assert/strict");
const test = require("node:test");
const { validateHeaders, normalizeRow } = require("../src/utils/medicineBulk");

test("accepts exact form field names", () => {
  const { missing, unknown } = validateHeaders([
    { name: "x", category: "y", batch: "b", quantity: 1, unit: "u", expiry: "2026-12-31" },
  ]);
  assert.deepEqual(missing, []);
  assert.deepEqual(unknown, []);
});

test("accepts form display labels as aliases", () => {
  const { missing, unknown } = validateHeaders([
    { "Medicine Name": "x", Category: "y", Batch: "b", Quantity: 1, Unit: "u", "Expiry Date": "2026-12-31" },
  ]);
  assert.deepEqual(missing, []);
  assert.deepEqual(unknown, []);
});

test("flags missing required headers", () => {
  const { missing } = validateHeaders([{ name: "x", category: "y" }]);
  assert.deepEqual(missing, ["batch", "quantity", "unit", "expiry"]);
});

test("flags unknown headers", () => {
  const { unknown } = validateHeaders([
    { name: "x", category: "y", batch: "b", quantity: 1, unit: "u", expiry: "2026-12-31", Fancy: "z" },
  ]);
  assert.deepEqual(unknown, ["Fancy"]);
});

test("normalizes a full row (unit_price + status alias + medicine code)", () => {
  const row = normalizeRow(
    {
      Name: "Paracetamol", Category: "Antipyretic", Batch: "B001", Quantity: "50",
      Unit: "boxes", "Unit Price": "1.5", "Expiry Date": "2026-12-31",
      Status: "Low Stock", MedicineCode: "MED-001",
    },
    1
  );
  assert.equal(row.name, "Paracetamol");
  assert.equal(row.quantity, 50);
  assert.equal(row.unitPrice, 1.5);
  assert.equal(row.status, "LOW_STOCK");
  assert.equal(row.medicineCode, "MED-001");
});

test("rejects a non-numeric quantity with the row number", () => {
  assert.throws(
    () => normalizeRow({ name: "x", category: "y", batch: "b", quantity: "abc", unit: "u", expiry: "2026-12-31" }, 3),
    /Row 3: quantity/
  );
});

test("rejects a bad status value", () => {
  assert.throws(
    () => normalizeRow({ name: "x", category: "y", batch: "b", quantity: 1, unit: "u", expiry: "2026-12-31", status: "Nope" }, 2),
    /Invalid status/
  );
});

test("handles Excel serial dates", () => {
  const row = normalizeRow({ name: "x", category: "y", batch: "b", quantity: 1, unit: "u", expiry: 46000 }, 1);
  assert.ok(row.expiry instanceof Date);
});
