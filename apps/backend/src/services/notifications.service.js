const prisma = require("../config/db");

async function listForHospital(hospitalId) {
  return prisma.notification.findMany({
    where: { hospitalId },
    orderBy: { createdAt: "desc" },
  });
}

async function markAllRead(hospitalId) {
  await prisma.notification.updateMany({
    where: { hospitalId, read: false },
    data: { read: true },
  });
  return listForHospital(hospitalId);
}

async function markOneRead(hospitalId, id) {
  return prisma.notification.updateMany({
    where: { id, hospitalId },
    data: { read: true },
  });
}

async function create(hospitalId, { title, body, type }) {
  return prisma.notification.create({ data: { hospitalId, title, body, type } });
}

module.exports = { listForHospital, markAllRead, markOneRead, create };
