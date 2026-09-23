const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const ml = require("../services/mlClient");
const { resolveHospitalCode } = require("../services/demandForecast.service");
const medicinesService = require("../services/medicines.service");
const assistantController = require("../controllers/assistant.controller");
const aiRateLimiter = require("../middleware/aiRateLimiter");
const { validate } = require("../middleware/validate");
const { z } = require("zod");

const router = express.Router();
router.use(requireAuth);

// --- Validation schemas ---
const askSchema = z.object({
  question: z.string().trim().min(1).max(4000).optional(),
  message: z.string().trim().min(1).max(4000).optional(),
  q: z.string().trim().min(1).max(4000).optional(),
  conversationId: z.string().nullable().optional(),
  conversation_id: z.string().nullable().optional(),
}).refine(data => data.question || data.message || data.q, {
  message: "question, message, or q is required",
});

// --- NEW LLM-Powered Assistant Routes (Production) ---

// Main LLM assistant - replaces old keyword-based logic
router.post(
  "/assistant",
  aiRateLimiter({ maxRequests: 30, windowMs: 60 * 1000 }),
  validate(askSchema),
  assistantController.ask
);

// Streaming version
router.post(
  "/assistant/stream",
  aiRateLimiter({ maxRequests: 20, windowMs: 60 * 1000 }),
  validate(askSchema),
  assistantController.askStream
);

// Conversation management
router.get("/conversations", assistantController.getConversations);
router.get("/conversations/:conversationId", assistantController.getHistory);
router.delete("/conversations/:conversationId", assistantController.deleteConversation);

// Provider info
router.get("/provider", assistantController.getProviderInfo);

// --- Legacy ML Service Routes (kept for dashboard insights) ---

/**
 * Response shapes match apps/frontend/src/services/aiService.js
 * and AIInsightPanel / AIAssistant (available + message).
 *
 * `message` is kept as a plain-string fallback. Routes that return `items`
 * (an array of { rank, name, category, demand }) also include `headline` and
 * `meta` so AIInsightPanel can render a structured list instead of one long
 * run-on sentence.
 */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-07-06" -> "Mon, Jul 6, 2026" (falls back to the raw string). */
function prettyWeekStart(weekStart) {
  if (!weekStart) return "";
  const parsed = new Date(`${String(weekStart).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return String(weekStart);
  return `${DAYS_SHORT[parsed.getUTCDay()]}, ${MONTHS_SHORT[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`;
}

router.get(
  "/forecast-insight",
  asyncHandler(async (req, res) => {
    const code = await resolveHospitalCode(req.user.hospitalId);
    if (!code) {
      return res.json({
        available: false,
        message:
          "This hospital is not linked to the ML demo codes yet. Re-run backend seed after ML CSVs are present.",
      });
    }

    try {
      const [detail, health] = await Promise.all([
        ml.getForecastDetail(code, 5),
        ml.health().catch(() => null),
      ]);

      const top = (detail.items || []).slice(0, 3);
      const r2 = health?.test_metrics?.R2;
      const model = detail.model || "XGBoost";
      const r2Text = r2 != null ? ` Model test R² ≈ ${Number(r2).toFixed(3)}.` : "";

      if (!top.length) {
        return res.json({
          available: true,
          headline: `Forecast connected for ${code}.`,
          meta: r2Text ? `Model test R² ≈ ${Number(r2).toFixed(3)}` : null,
          message: `XGBoost forecast is connected for ${code}.${r2Text}`,
        });
      }

      const rows = top.map((i, index) => ({
        rank: index + 1,
        name: i.generic_name,
        category: i.category || null,
        demand: Math.round(Number(i.predicted_demand)),
      }));

      const metaParts = [`${model} model`];
      if (r2 != null) metaParts.push(`test R² ≈ ${Number(r2).toFixed(3)}`);
      if (detail.week_start) metaParts.push(`forecast week ${detail.week_start}`);

      return res.json({
        available: true,
        headline: `Top demand this week — ${code}`,
        subhead: detail.week_start
          ? `Week of ${prettyWeekStart(detail.week_start)}`
          : undefined,
        items: rows,
        meta: metaParts.join(" · "),
        // Plain-text fallback for any consumer that only reads `message`.
        message: `XGBoost forecast for ${code} (week ${detail.week_start}): highest need — ${rows
          .map((r) => `${r.name} (~${r.demand} units)`)
          .join("; ")}.${r2Text}`,
      });
    } catch (err) {
      return res.json({
        available: false,
        message: `AI forecast offline (${err.message}). Start ML on port 8000 for live XGBoost insights.`,
      });
    }
  })
);

// Legacy keyword-based fallback - now points to new LLM but keeps route for backwards compat
router.post(
  "/assistant/legacy",
  asyncHandler(async (req, res) => {
    const q = String((req.body && (req.body.question || req.body.q || req.body.message)) || "").trim();
    const hospitalId = req.user.hospitalId;
    const code = await resolveHospitalCode(hospitalId);

    if (!q) {
      return res.json({
        available: true,
        message: "Ask about expiry, low stock, demand forecast, or exchange matches.",
      });
    }

    const ql = q.toLowerCase();

    try {
      if (ql.includes("expir")) {
        const days = ql.includes("week") ? 14 : 30;
        const dbExp = await medicinesService.expiringSoon(hospitalId, days);
        const names = dbExp.slice(0, 8).map((m) => `${m.name} (${m.batch})`);
        return res.json({
          available: true,
          message: names.length
            ? `Medicines expiring within ${days} days: ${names.join("; ")}.`
            : `No medicines in your inventory expire within ${days} days.`,
        });
      }

      if (ql.includes("forecast") || ql.includes("demand") || ql.includes("short")) {
        if (!code) {
          return res.json({
            available: false,
            message: "Hospital is not linked to an ML code for forecasting.",
          });
        }
        const detail = await ml.getForecastDetail(code, 5);
        const lines = (detail.items || [])
          .slice(0, 5)
          .map((i) => `${i.generic_name}: ~${Math.round(i.predicted_demand)} units`);
        return res.json({
          available: true,
          message: `XGBoost demand forecast (${code}, week ${detail.week_start}): ${lines.join("; ")}.`,
        });
      }

      if (ql.includes("exchange") || ql.includes("match") || ql.includes("request") || ql.includes("hospital")) {
        const data = await ml.getSmartMatches({ hospitalCode: code, demoOnly: true, topK: 5 });
        const items = data.items || [];
        if (!items.length) {
          return res.json({ available: true, message: "No exchange matches found right now." });
        }
        const lines = items.slice(0, 4).map(
          (m) =>
            `${m.from_hospital_name} → ${m.to_hospital_name}: ${m.generic_name} x${m.suggested_qty}`
        );
        return res.json({
          available: true,
          message: `Suggested partners: ${lines.join(" | ")}`,
        });
      }

      if (ql.includes("low") || ql.includes("stock") || ql.includes("insulin")) {
        if (code) {
          const low = await ml.getLowStock(code, 8);
          const lines = (low.items || []).map(
            (i) =>
              `${i.generic_name} (${i.days_of_cover != null ? Number(i.days_of_cover).toFixed(1) + "d cover" : "low"})`
          );
          return res.json({
            available: true,
            message: lines.length ? `Low stock: ${lines.join("; ")}` : "No low-stock SKUs in the ML snapshot.",
          });
        }
      }

      return res.json({
        available: true,
        message:
          'Try: "Which medicines expire in the next 2 weeks?", "show demand forecast", or "suggest a hospital to request insulin from".',
      });
    } catch (err) {
      return res.json({
        available: false,
        message: `Assistant could not reach the ML service: ${err.message}`,
      });
    }
  })
);

router.get(
  "/health",
  asyncHandler(async (_req, res) => {
    try {
      const h = await ml.health();
      const providerInfo = (() => {
        try {
          const AIService = require("../services/ai/AIService");
          return { llmProvider: AIService.getProviderInfo ? "loaded" : "unknown" };
        } catch {
          return { llmProvider: "error" };
        }
      })();
      res.json({ available: true, message: "ML service online", mlServiceUrl: ml.baseUrl(), ...h, ...providerInfo });
    } catch (err) {
      res.json({ available: false, message: err.message, mlServiceUrl: ml.baseUrl() });
    }
  })
);

module.exports = router;
