const express = require("express");
const controller = require("../controllers/auth.controller");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  registerHospitalSchema,
  registerMemberSchema,
  registerUserSchema,
  loginSchema,
  updateProfileSchema,
  deleteAccountSchema,
  approveUserSchema,
} = require("../utils/validators/auth.schema");

const router = express.Router();

// Onboard a new hospital + its first (and only) admin account.
router.post("/register-hospital", validate(registerHospitalSchema), controller.registerHospital);

// Public self-registration → Staff / Inventory Manager, pending approval.
router.post("/register-member", validate(registerMemberSchema), controller.registerMember);

// Add a staff / inventory-manager account to an existing hospital.
// Only an ADMIN of the SAME hospital may create accounts.
router.post("/register", requireAuth, requireRole("ADMIN"), validate(registerUserSchema), controller.registerUser);

router.post("/login", validate(loginSchema), controller.login);

router.get("/me", requireAuth, controller.me);
router.patch("/me", requireAuth, validate(updateProfileSchema), controller.updateMe);
router.delete("/me", requireAuth, validate(deleteAccountSchema), controller.deleteAccount);

// Admin user management (own hospital only).
router.get("/users", requireAuth, requireRole("ADMIN"), controller.listUsers);
router.patch("/users/:id/approval", requireAuth, requireRole("ADMIN"), validate(approveUserSchema), controller.approveUser);
router.delete("/users/:id", requireAuth, requireRole("ADMIN"), controller.deleteUser);

module.exports = router;
