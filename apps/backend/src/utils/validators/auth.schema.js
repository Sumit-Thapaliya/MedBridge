const { z } = require("zod");

const registerHospitalSchema = z.object({
  hospitalName: z.string().min(2),
  location: z.string().min(2),
  type: z.enum(["General", "Specialty", "Teaching", "Regional", "Clinic"]).optional(),
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

// Public self-registration for Staff / Inventory Manager at an existing hospital.
const registerMemberSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  hospitalId: z.string().uuid(),
  role: z.enum(["STAFF", "INVENTORY_MANAGER"]),
});

// Admin-created account (Staff / Inventory Manager only).
const registerUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  hospitalId: z.string().uuid(),
  role: z.enum(["STAFF", "INVENTORY_MANAGER"]),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.string().email().optional(),
});

const deleteAccountSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

const approveUserSchema = z.object({
  approve: z.boolean(),
});

module.exports = {
  registerHospitalSchema,
  registerMemberSchema,
  registerUserSchema,
  loginSchema,
  updateProfileSchema,
  deleteAccountSchema,
  approveUserSchema,
};
