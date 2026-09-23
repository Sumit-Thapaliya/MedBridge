const express = require("express");
const controller = require("../controllers/hospitals.controller");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Public directory for the "Join hospital" registration page (no auth).
router.get("/directory", controller.directory);

router.use(requireAuth);

router.get("/", controller.list);
router.get("/:id", controller.getOne);

module.exports = router;
