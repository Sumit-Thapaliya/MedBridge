// Client-side parsing of an uploaded Excel/CSV file into an array of row
// objects keyed by the spreadsheet's header row. Uses SheetJS (xlsx), which
// reads .xlsx, .xls and .csv alike.

import * as XLSX from "xlsx";

// Headers the spreadsheet is expected to contain (mirrors the medicine form).
export const REQUIRED_HEADERS = ["name", "category", "batch", "quantity", "unit", "expiry"];
export const OPTIONAL_HEADERS = ["unitPrice", "status", "medicineCode"];

/**
 * Parse a File into rows (array of objects keyed by header names).
 * @param {File} file
 * @returns {Array<object>}
 */
export async function parseSpreadsheet(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("The spreadsheet has no sheets.");

  // header:1 -> first row is the header, values are raw (dates as Date objects)
  const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
  if (!rows.length) throw new Error("The spreadsheet has no data rows.");

  return rows;
}

/**
 * Validate the parsed rows have the required headers. Returns { missing, unknown }.
 * Header names are compared case-insensitively and tolerating spaces/underscores.
 */
export function checkHeaders(rows) {
  const first = rows[0] || {};
  const present = new Set();
  const unknown = [];

  for (const raw of Object.keys(first)) {
    const key = normalizeHeader(raw);
    if (ALIASES[key]) present.add(ALIASES[key]);
    else unknown.push(raw);
  }

  const missing = REQUIRED_HEADERS.filter((h) => !present.has(h));
  return { missing, unknown };
}

const ALIASES = {
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

/**
 * Download a ready-to-fill Excel template with the exact expected headers and
 * one example row. Uses SheetJS to write a real .xlsx file client-side.
 */
export function downloadTemplate() {
  const header = [
    "name",
    "category",
    "batch",
    "quantity",
    "unit",
    "expiry",
    "unitPrice",
    "status",
    "medicineCode",
  ];

  // One illustrative row so users see the expected format at a glance.
  const example = [
    "Paracetamol",
    "Antipyretic",
    "BATCH-0001",
    100,
    "boxes",
    "2027-06-30",
    1.5,
    "In Stock",
    "MED-001",
  ];

  const worksheet = XLSX.utils.aoa_to_sheet([header, example]);

  // Widen columns for readability.
  worksheet["!cols"] = header.map((h) => ({ wch: Math.max(h.length + 2, 12) }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Medicines");

  XLSX.writeFile(workbook, "medbridge_medicine_import_template.xlsx");
}

/**
 * Convert parsed rows (keyed by arbitrary header text) into the canonical
 * field names the API expects, normalising quantity/unitPrice to numbers and
 * expiry to a YYYY-MM-DD string.
 */
export function normalizeRows(rows) {
  return rows.map((row) => {
    const out = {};
    for (const [rawKey, value] of Object.entries(row)) {
      const key = ALIASES[normalizeHeader(rawKey)];
      if (!key) continue;
      out[key] = value;
    }

    out.quantity = Number(out.quantity);
    out.unitPrice = out.unitPrice === "" || out.unitPrice == null ? undefined : Number(out.unitPrice);

    if (out.expiry instanceof Date && !Number.isNaN(out.expiry.getTime())) {
      out.expiry = out.expiry.toISOString().slice(0, 10);
    } else if (typeof out.expiry === "number") {
      // Excel serial date
      const d = new Date(Math.round((out.expiry - 25569) * 86400 * 1000));
      out.expiry = d.toISOString().slice(0, 10);
    } else {
      out.expiry = String(out.expiry ?? "").trim();
    }

    return out;
  });
}
