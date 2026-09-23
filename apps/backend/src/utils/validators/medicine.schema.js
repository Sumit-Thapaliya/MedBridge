const { z } = require("zod");

const statusEnum = z.enum(["IN_STOCK", "LOW_STOCK", "MEDIUM_STOCK", "CRITICAL"]);

const createMedicineSchema = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(100),
  batch: z.string().trim().min(1).max(100),
  quantity: z.number().int().min(0),
  unit: z.string().trim().min(1).max(32),
  unitPrice: z.number().min(0).optional(),
  expiry: z.coerce.date().refine((date) => date > new Date(), "Expiry must be in the future"),
  status: statusEnum.optional(),
});

const updateMedicineSchema = createMedicineSchema.partial();

module.exports = { createMedicineSchema, updateMedicineSchema };
