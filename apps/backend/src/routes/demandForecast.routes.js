const express = require("express");
const controller = require("../controllers/demandForecast.controller");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);
router.get("/", controller.getForecast);

module.exports = router;
