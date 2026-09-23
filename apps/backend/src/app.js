const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth.routes");
const hospitalsRoutes = require("./routes/hospitals.routes");
const medicinesRoutes = require("./routes/medicines.routes");
const exchangeRequestsRoutes = require("./routes/exchangeRequests.routes");
const notificationsRoutes = require("./routes/notifications.routes");
const reportsRoutes = require("./routes/reports.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const demandForecastRoutes = require("./routes/demandForecast.routes");
const aiRoutes = require("./routes/ai.routes");

const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

// SECURITY: Security headers (XSS/CSP, HSTS, etc.). CSP is left off so the
// React SPA and AdminJS panel are not blocked.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// SECURITY: Rate limiting — an auth limiter to slow brute-force attempts and a
// general limiter to protect the API from abuse. Limits are generous enough
// that normal client traffic is unaffected.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 auth requests per 15 min per IP
  message: { message: "Too many auth attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // 200 requests per minute per IP
  message: { message: "Too many requests, please slow down" },
});

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(generalLimiter);

app.get("/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString(), version: "2.0-excellent" }));

// -----------------------------------------------------------------------
// Add a new resource to the API by adding one line here + one routes file.
// -----------------------------------------------------------------------
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/hospitals", hospitalsRoutes);
app.use("/api/medicines", medicinesRoutes);
app.use("/api/exchange-requests", exchangeRequestsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/demand-forecast", demandForecastRoutes);
app.use("/api/ai", aiRoutes);

// Note: notFoundHandler and errorHandler are NOT registered here anymore
// They are registered in index.js AFTER admin router, so /admin is not swallowed
// This supports both AdminJS (from Samir) and robust error handling (from Sushant)

module.exports = app;
module.exports.notFoundHandler = notFoundHandler;
module.exports.errorHandler = errorHandler;
