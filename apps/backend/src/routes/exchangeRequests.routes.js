const express = require("express");
const controller = require("../controllers/exchangeRequests.controller");
const { requireAuth } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  createExchangeRequestSchema,
  updateStatusSchema,
} = require("../utils/validators/exchangeRequest.schema");

const router = express.Router();

router.use(requireAuth);

router.get("/", controller.list);
router.post("/", validate(createExchangeRequestSchema), controller.create);
router.patch("/:id/status", validate(updateStatusSchema), controller.updateStatus);

module.exports = router;
