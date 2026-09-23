/**
 * Single source of truth for deriving a medicine's stock status from its
 * quantity. Previously copy-pasted in medicines.service.js and
 * exchangeRequests.service.js (and re-implemented in tests) — keep it in sync
 * here.
 *
 * Thresholds:
 *   < 5        → CRITICAL (covers 0 / negative)
 *   < 15       → LOW_STOCK
 *   < 40       → MEDIUM_STOCK
 *   otherwise  → IN_STOCK
 */
function computeMedicineStatus(quantity) {
  if (quantity < 5) return "CRITICAL";
  if (quantity < 15) return "LOW_STOCK";
  if (quantity < 40) return "MEDIUM_STOCK";
  return "IN_STOCK";
}

module.exports = { computeMedicineStatus };
