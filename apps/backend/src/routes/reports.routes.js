const express = require("express");
const controller = require("../controllers/reports.controller");
const { requireAuth } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { createReportSchema } = require("../utils/validators/report.schema");

const router = express.Router();

router.use(requireAuth);

router.get("/", controller.list);
router.post("/", validate(createReportSchema), controller.create);
router.delete("/:id", controller.remove);

module.exports = router;
