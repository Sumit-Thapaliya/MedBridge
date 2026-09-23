const prisma = require("../config/db");
const { ApiError } = require("../utils/ApiError");

async function listHospitals() {
  return prisma.hospital.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          outgoingRequests: { where: { status: { in: ["PENDING", "APPROVED", "IN_TRANSIT"] } } },
          incomingRequests: { where: { status: { in: ["PENDING", "APPROVED", "IN_TRANSIT"] } } },
          medicines: true,
          users: true,
        },
      },
    },
  });
}

async function getHospital(id) {
  const hospital = await prisma.hospital.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          outgoingRequests: { where: { status: { in: ["PENDING", "APPROVED", "IN_TRANSIT"] } } },
          incomingRequests: { where: { status: { in: ["PENDING", "APPROVED", "IN_TRANSIT"] } } },
          medicines: true,
          users: true,
        },
      },
      // NOTE: we deliberately do NOT include `medicines` here. This endpoint is
      // used to view OTHER hospitals' profiles, and returning their medicines
      // would leak batch numbers, quantities, unit prices, and expiry dates —
      // violating the platform guarantee that one hospital can never see
      // another's private inventory. Only coarse public metadata is exposed.
    },
  });
  if (!hospital) throw new ApiError(404, "Hospital not found");
  return hospital;
}

module.exports = { listHospitals, getHospital };
