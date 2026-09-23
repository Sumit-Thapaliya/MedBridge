const { z } = require("zod");

const createReportSchema = z.object({
  name: z.string().min(2),
  period: z.string().min(2),
  type: z.enum(["INVENTORY", "EXCHANGE", "COMPLIANCE"]),
});

module.exports = { createReportSchema };
