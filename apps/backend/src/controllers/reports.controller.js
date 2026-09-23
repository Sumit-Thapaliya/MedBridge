const { asyncHandler } = require("../utils/asyncHandler");
const service = require("../services/reports.service");

const list = asyncHandler(async (req, res) => {
  const reports = await service.listForHospital(req.user.hospitalId);
  res.json(reports);
});

const create = asyncHandler(async (req, res) => {
  const report = await service.create(req.user.hospitalId, req.body);
  res.status(201).json(report);
});

const remove = asyncHandler(async (req, res) => {
  await service.remove(req.user.hospitalId, req.params.id);
  res.status(204).send();
});

module.exports = { list, create, remove };
