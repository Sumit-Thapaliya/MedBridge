const { asyncHandler } = require("../utils/asyncHandler");
const service = require("../services/demandForecast.service");

const getForecast = asyncHandler(async (req, res) => {
  const data = await service.getForecast(req.user.hospitalId);
  res.json(data);
});

module.exports = { getForecast };
