const prisma = require("../config/db");

/**
 * Audit Log Service — records critical actions for security & compliance.
 *
 * `createLog` is deliberately best-effort: if the AuditLog table has not yet
 * been created by a migration (or a write fails for any other reason) the
 * caller's main transaction/effect is NOT affected. Every call is wrapped so
 * an audit write can never break a business operation.
 */

async function createLog({ hospitalId, userId, action, entity, entityId, oldValue, newValue }) {
  try {
    return await prisma.auditLog.create({
      data: {
        hospitalId,
        userId,
        action,
        entity,
        entityId,
        oldValue: oldValue != null ? JSON.stringify(oldValue) : null,
        newValue: newValue != null ? JSON.stringify(newValue) : null,
      },
    });
  } catch (err) {
    console.warn("[AuditLog] Failed to create log:", err.message);
    return null;
  }
}

async function getLogs(hospitalId, { limit = 50, action, entity } = {}) {
  const where = { hospitalId };
  if (action) where.action = action;
  if (entity) where.entity = entity;

  return prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { name: true, email: true } } },
  });
}

module.exports = { createLog, getLogs };
