/**
 * aiRateLimiter - Simple in-memory rate limiter for AI endpoints
 * Prevents abuse, controls costs
 */

const requestCounts = new Map(); // key -> { count, resetTime }

function aiRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000; // 1 minute
  const maxRequests = options.maxRequests || 20; // 20 requests per minute per user
  const message = options.message || "Too many AI requests. Please wait a moment.";

  return (req, res, next) => {
    const userId = req.user?.id || req.ip;
    const key = `ai:${userId}`;
    const now = Date.now();

    let record = requestCounts.get(key);

    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      requestCounts.set(key, record);
      return next();
    }

    if (record.count >= maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({
        available: false,
        message,
        retryAfter,
      });
    }

    record.count++;
    requestCounts.set(key, record);
    next();
  };
}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of requestCounts.entries()) {
    if (now > record.resetTime) {
      requestCounts.delete(key);
    }
  }
}, 5 * 60 * 1000);

module.exports = aiRateLimiter;
