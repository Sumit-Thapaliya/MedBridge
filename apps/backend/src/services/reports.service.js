const prisma = require("../config/db");
const { ApiError } = require("../utils/ApiError");

async function listForHospital(hospitalId) {
  return prisma.report.findMany({
    where: { hospitalId },
    orderBy: { generatedOn: "desc" },
  });
}

async function create(hospitalId, { name, period, type }) {
  return prisma.report.create({ data: { hospitalId, name, period, type } });
}

async function remove(hospitalId, id) {
  const report = await prisma.report.findFirst({ where: { id, hospitalId } });
  if (!report) throw new ApiError(404, "Report not found");
  await prisma.report.delete({ where: { id } });
}

module.exports = { listForHospital, create, remove };
