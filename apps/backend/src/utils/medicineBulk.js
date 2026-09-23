/**
 * Header validation + row normalisation for bulk medicine import (Excel/CSV).
 *
 * The accepted spreadsheet mirrors the "Add medicine" form fields:
 *
 *   Required headers : name, category, batch, quantity, unit, expiry
 *   Optional headers : unitPrice, status, medicineCode
 *
 * Matching is case-insensitive and tolerates spaces/underscores/hyphens, and
 * accepts the form's display labels ("Medicine name", "Expiry date",
 * "Unit price") as aliases for the underlying field names.
 */

const REQUIRED_HEADERS = ["name", "category", "batch", "quantity", "unit", "expiry"];
const OPTIONAL_HEADERS = ["unitPrice", "status", "medicineCode"];

// Maps a normalised header token -> canonical DB field name.
const HEADER_ALIASES = {
  name: "name",
  medicinename: "name",
  category: "category",
  batch: "batch",
  batchnumber: "batch",
  quantity: "quantity",
  unit: "unit",
  unitprice: "unitPrice",
  expiry: "expiry",
  expirydate: "expiry",
  status: "status",
  medicinecode: "medicineCode",
};

function normalizeHeader(key) {
  return String(key ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/** Canonical DB field name for a raw header, or null if unrecognised. */
function canonicalKey(rawHeader) {
  return HEADER_ALIASES[normalizeHeader(rawHeader)] || null;
}

/**
 * Validate that every required header is present (and flag unknown headers).
 * Accepts either an array of objects (JSON rows) or an array of header names.
 * Returns { missing, unknown } — both arrays of human-readable header names.
 */
function validateHeaders(rowsOrHeaders) {
  if (!Array.isArray(rowsOrHeaders) || rowsOrHeaders.length === 0) {
    return { missing: REQUIRED_HEADERS.slice(), unknown: [] };
  }

  const first = rowsOrHeaders[0];
  const rawHeaders =
    typeof first === "object" && first !== null && !Array.isArray(first)
      ? Object.keys(first)
      : rowsOrHeaders;

  const present = new Set();
  const unknown = [];
  for (const h of rawHeaders) {
    const key = canonicalKey(h);
    if (key) present.add(key);
    else unknown.push(String(h));
  }

  const missing = REQUIRED_HEADERS.filter((h) => !present.has(h));
  return { missing, unknown };
}

/**
 * Normalise a single row (object keyed by spreadsheet headers) into the
 * canonical DB field names. Throws on a row that is missing a required field
 * or carries an unparseable value — the message includes the row number.
 */
function normalizeRow(row, index) {
  const normalized = {};
  for (const [k, v] of Object.entries(row)) {
    const key = canonicalKey(k);
    if (key) normalized[key] = v;
  }

  const out = {};

  for (const h of REQUIRED_HEADERS) {
    const v = normalized[h];
    if (v === null || v === undefined || String(v).trim() === "") {
      throw new Error(`Row ${index}: missing required field "${h}"`);
    }
  }

  out.name = String(normalized.name).trim();
  out.category = String(normalized.category).trim();
  out.batch = String(normalized.batch).trim();
  out.unit = String(normalized.unit).trim();

  const qty = Number(normalized.quantity);
  if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
    throw new Error(`Row ${index}: quantity must be a non-negative whole number`);
  }
  out.quantity = qty;

  if (normalized.unitPrice !== undefined && normalized.unitPrice !== null &&
      String(normalized.unitPrice).trim() !== "") {
    const price = Number(normalized.unitPrice);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`Row ${index}: unitPrice must be a non-negative number`);
    }
    out.unitPrice = price;
  }

  // Expiry: accept YYYY-MM-DD strings, JS Date objects, or Excel serial numbers.
  let expiry = null;
  const rawExpiry = normalized.expiry;
  if (rawExpiry instanceof Date) {
    expiry = rawExpiry;
  } else if (typeof rawExpiry === "number" && rawExpiry > 20000 && rawExpiry < 80000) {
    // Excel serial date (days since 1899-12-30)
    expiry = new Date(Math.round((rawExpiry - 25569) * 86400 * 1000));
  } else {
    expiry = new Date(String(rawExpiry).trim());
  }
  if (!expiry || Number.isNaN(expiry.getTime())) {
    throw new Error(`Row ${index}: expiry must be a valid date`);
  }
  out.expiry = expiry;

  if (normalized.medicineCode !== undefined && String(normalized.medicineCode).trim() !== "") {
    out.medicineCode = String(normalized.medicineCode).trim();
  }

  if (normalized.status !== undefined && String(normalized.status).trim() !== "") {
    out.status = normalizeStatus(String(normalized.status).trim());
  }

  return out;
}

const STATUS_ALIASES = {
  IN_STOCK: "IN_STOCK",
  LOW_STOCK: "LOW_STOCK",
  MEDIUM_STOCK: "MEDIUM_STOCK",
  CRITICAL: "CRITICAL",
};

function normalizeStatus(value) {
  const key = value.toUpperCase().replace(/[\s_-]+/g, "_");
  if (STATUS_ALIASES[key]) return STATUS_ALIASES[key];
  throw new Error(
    `Invalid status "${value}" — use one of: In Stock, Low Stock, Medium Stock, Critical`
  );
}

module.exports = {
  REQUIRED_HEADERS,
  OPTIONAL_HEADERS,
  validateHeaders,
  normalizeRow,
  normalizeHeader,
  canonicalKey,
};
