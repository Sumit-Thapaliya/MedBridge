const { asyncHandler } = require("../utils/asyncHandler");
const service = require("../services/notifications.service");

const list = asyncHandler(async (req, res) => {
  const notifications = await service.listForHospital(req.user.hospitalId);
  res.json(notifications);
});

const markAllRead = asyncHandler(async (req, res) => {
  const notifications = await service.markAllRead(req.user.hospitalId);
  res.json(notifications);
});

const markOneRead = asyncHandler(async (req, res) => {
  await service.markOneRead(req.user.hospitalId, req.params.id);
  res.status(204).send();
});

module.exports = { list, markAllRead, markOneRead };
