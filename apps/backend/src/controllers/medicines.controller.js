const { asyncHandler } = require("../utils/asyncHandler");
const service = require("../services/medicines.service");
const { ApiError } = require("../utils/ApiError");
const { validateHeaders, normalizeRow } = require("../utils/medicineBulk");

const list = asyncHandler(async (req, res) => {
  const search = String(req.query.search || "").trim().slice(0, 100);
  const { status } = req.query;
  const medicines = await service.listMedicines(req.user.hospitalId, { search, status });
  res.json(medicines);
});

const getOne = asyncHandler(async (req, res) => {
  const medicine = await service.getMedicine(req.user.hospitalId, req.params.id);
  res.json(medicine);
});

const create = asyncHandler(async (req, res) => {
  const medicine = await service.createMedicine(req.user.hospitalId, req.body);
  res.status(201).json(medicine);
});

const update = asyncHandler(async (req, res) => {
  const medicine = await service.updateMedicine(req.user.hospitalId, req.params.id, req.body);
  res.json(medicine);
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteMedicine(req.user.hospitalId, req.params.id);
  res.status(204).send();
});

const expiringSoon = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 30;
  const medicines = await service.expiringSoon(req.user.hospitalId, days);
  res.json(medicines);
});

const categories = asyncHandler(async (req, res) => {
  const breakdown = await service.categoryBreakdown(req.user.hospitalId);
  res.json(breakdown);
});

// Bulk import from Excel/CSV. The frontend parses the file into `rows` (an
// array of objects keyed by spreadsheet headers); the server is the source of
// truth for header + field validation.
const bulkImport = asyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows || rows.length === 0) {
    throw new ApiError(400, "No rows to import. The spreadsheet appears to be empty.");
  }

  const { missing, unknown } = validateHeaders(rows);
  if (missing.length > 0) {
    throw new ApiError(
      400,
      `Missing required column(s) in the spreadsheet: ${missing.join(", ")}. ` +
        `Required headers are: name, category, batch, quantity, unit, expiry.`,
      { missing }
    );
  }
  if (unknown.length > 0) {
    throw new ApiError(
      400,
      `Unrecognized column(s) in the spreadsheet: ${unknown.join(", ")}. ` +
        `Allowed headers: name, category, batch, quantity, unit, expiry, unitPrice, status, medicineCode.`,
      { unknown }
    );
  }

  // Normalise + field-validate every row up front so a single bad value is
  // reported clearly (with its row number) instead of half-importing.
  let normalized;
  try {
    normalized = rows.map((row, i) => normalizeRow(row, i + 1));
  } catch (err) {
    throw new ApiError(400, err.message);
  }

  const { created, errors } = await service.bulkCreateMedicines(req.user.hospitalId, normalized);

  res.status(201).json({
    imported: created.length,
    failed: errors.length,
    errors,
    medicines: created,
  });
});

module.exports = { list, getOne, create, update, remove, bulkImport, expiringSoon, categories };
