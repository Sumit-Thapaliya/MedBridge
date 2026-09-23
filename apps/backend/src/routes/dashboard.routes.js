const express = require("express");
const controller = require("../controllers/dashboard.controller");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

router.get("/stats", controller.stats);
router.get("/inventory-overview", controller.overview);

module.exports = router;
