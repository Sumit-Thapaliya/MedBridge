// apps/backend/tests/movementType.test.js
const assert = require("node:assert/strict");
const test = require("node:test");

// Pure function extracted from export_for_ml.js logic — testing the sign
// convention without needing a real database connection.
function signedQuantity(type, quantity) {
  const negative = ["CONSUMPTION", "EXCHANGE_OUT", "EXPIRY_WRITEOFF"].includes(type);
  return negative ? -Math.abs(quantity) : Math.abs(quantity);
}

test("consumption, exchange-out, and expiry write-off are negative", () => {
  assert.equal(signedQuantity("CONSUMPTION", 10), -10);
  assert.equal(signedQuantity("EXCHANGE_OUT", 5), -5);
  assert.equal(signedQuantity("EXPIRY_WRITEOFF", 3), -3);
});

test("procurement and exchange-in are positive", () => {
  assert.equal(signedQuantity("PROCUREMENT", 20), 20);
  assert.equal(signedQuantity("EXCHANGE_IN", 7), 7);
});

test("sign convention is stable even if quantity is passed already negative", () => {
  assert.equal(signedQuantity("CONSUMPTION", -10), -10);
  assert.equal(signedQuantity("PROCUREMENT", -20), 20);
});