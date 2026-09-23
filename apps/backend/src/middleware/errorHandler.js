const { ApiError } = require("../utils/ApiError");

function notFoundHandler(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: err.message, details: err.details });
  }

  // Prisma known errors (e.g. unique constraint violations)
  if (err.code === "P2002") {
    return res.status(409).json({ error: `Duplicate value for: ${err.meta?.target?.join(", ")}` });
  }
  if (err.code === "P2025") {
    return res.status(404).json({ error: "Record not found" });
  }

  console.error(err);
  res.status(500).json({ error: "Something went wrong on our end" });
}

module.exports = { notFoundHandler, errorHandler };
