require("dotenv").config();

const app = require("./app");

const PORT = parseInt(process.env.PORT, 10) || 4000;

// Refuse to boot in production with a missing/weak JWT secret — this would
// let anyone forge session tokens. Only enforced in production so local dev
// stays frictionless.
const KNOWN_WEAK_SECRETS = new Set([
  "medbridge-dev-secret-change-in-production-2026",
  "change-me",
  "secret",
  "dev-secret",
  "changeme",
]);
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.JWT_SECRET || KNOWN_WEAK_SECRETS.has(process.env.JWT_SECRET))
) {
  console.error(
    "✗ Refusing to start in production: JWT_SECRET is missing or is a known-weak default."
  );
  console.error("  Set a strong JWT_SECRET in .env (e.g. `openssl rand -hex 32`).");
  process.exit(1);
}

console.log("◇ Starting MedBridge API...");
console.log(`◇ NODE_ENV=${process.env.NODE_ENV || "development"}`);
console.log(`◇ DATABASE_URL=${process.env.DATABASE_URL ? process.env.DATABASE_URL.slice(0, 50) + "..." : "NOT SET"}`);
console.log(`◇ LLM_PROVIDER=${process.env.LLM_PROVIDER || "auto-detect (mock fallback)"}`);
console.log(`◇ CLIENT_ORIGIN=${process.env.CLIENT_ORIGIN || "http://localhost:5173"}`);

async function startServer(portToUse) {
  // --- AdminJS integration from Samir branch ---
  // AdminJS v7 is ESM-only, dynamic import() works from CommonJS
  try {
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && process.env.ADMIN_SESSION_SECRET) {
      console.log("◇ Initializing AdminJS panel...");
      const { buildAdminRouter } = await import("./admin.mjs");
      const { adminRouter, rootPath } = await buildAdminRouter();
      app.use(rootPath, adminRouter);
      console.log(`◇ AdminJS mounted at ${rootPath}`);
    } else {
      console.log("◇ AdminJS skipped (set ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_SESSION_SECRET in .env to enable /admin)");
    }
  } catch (err) {
    console.warn("◇ AdminJS failed to initialize (optional, continuing without admin panel):", err.message);
  }

  // Register 404 and error handlers AFTER admin (so /admin not swallowed) - from Samir pattern + Sushant robust
  app.use(app.notFoundHandler);
  app.use(app.errorHandler);

  const server = app.listen(portToUse, () => {
    console.log(`✓ MedBridge API listening on http://localhost:${portToUse}`);
    console.log(`✓ Health check: http://localhost:${portToUse}/health`);
    console.log(`✓ AI Provider: Check logs above for [AI] provider`);
    if (process.env.ADMIN_EMAIL) {
      console.log(`✓ Admin panel: http://localhost:${portToUse}/admin (if AdminJS enabled)`);
    }
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`✗ Port ${portToUse} already in use!`);
      console.error(`  Run: netstat -ano | findstr :${portToUse}`);
      console.error(`  Then: taskkill /PID <actual_number> /F`);
      console.error(`  Or: taskkill /IM node.exe /F`);
      console.log(`  Trying port ${portToUse + 1}...`);
      setTimeout(() => startServer(portToUse + 1), 1000);
    } else {
      console.error("Server error:", err);
    }
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("SIGTERM received");
    server.close(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    console.log("SIGINT received");
    server.close(() => process.exit(0));
  });

  return server;
}

const serverPromise = startServer(PORT);

serverPromise.catch?.((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

// Safety nets
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err.message);
  console.error(err.stack);
});

// Keep event loop alive on Windows
setInterval(() => {}, 1000 * 60 * 60);
