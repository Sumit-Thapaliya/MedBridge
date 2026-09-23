const express = require("express");
const controller = require("../controllers/medicines.controller");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { createMedicineSchema, updateMedicineSchema } = require("../utils/validators/medicine.schema");

const router = express.Router();

router.use(requireAuth);

// Specific routes before "/:id" so they aren't swallowed by the param route.
router.get("/meta/expiring-soon", controller.expiringSoon);
router.get("/meta/categories", controller.categories);

// Read access for any authenticated user (Staff can view + search).
router.get("/", controller.list);
router.get("/:id", controller.getOne);

// Write access restricted to Admin + Inventory Manager.
router.post("/", requireRole("ADMIN", "INVENTORY_MANAGER"), validate(createMedicineSchema), controller.create);
router.post("/bulk", requireRole("ADMIN", "INVENTORY_MANAGER"), controller.bulkImport);
router.patch("/:id", requireRole("ADMIN", "INVENTORY_MANAGER"), validate(updateMedicineSchema), controller.update);
router.delete("/:id", requireRole("ADMIN", "INVENTORY_MANAGER"), controller.remove);

module.exports = router;
