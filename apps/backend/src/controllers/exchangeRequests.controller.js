const { asyncHandler } = require("../utils/asyncHandler");
const service = require("../services/exchangeRequests.service");

const list = asyncHandler(async (req, res) => {
  const { direction } = req.query;
  const requests = await service.listForHospital(req.user.hospitalId, { direction });
  res.json(requests);
});

const create = asyncHandler(async (req, res) => {
  const request = await service.createRequest(req.user.hospitalId, req.body);
  res.status(201).json(request);
});

const updateStatus = asyncHandler(async (req, res) => {
  const request = await service.updateStatus(req.user.hospitalId, req.user.role, req.params.id, req.body.status);
  res.json(request);
});

module.exports = { list, create, updateStatus };
