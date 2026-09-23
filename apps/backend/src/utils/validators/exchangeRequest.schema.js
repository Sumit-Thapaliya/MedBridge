const { z } = require("zod");

const createExchangeRequestSchema = z.object({
  medicine: z.string().trim().min(2).max(160),
  quantity: z.number().int().min(1),
  unit: z.string().trim().min(1).max(32),
  toHospitalId: z.string().uuid(),
});

const updateStatusSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "IN_TRANSIT", "COMPLETED", "DECLINED"]),
});

module.exports = { createExchangeRequestSchema, updateStatusSchema };
