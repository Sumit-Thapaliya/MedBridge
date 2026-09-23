const prisma = require("../config/db");
const { ApiError } = require("../utils/ApiError");
const { computeMedicineStatus: calculateMedicineStatus } = require("../utils/medicineStatus");

const TRANSITIONS = {
  PENDING: ["APPROVED", "DECLINED"],
  APPROVED: ["IN_TRANSIT"],
  IN_TRANSIT: ["COMPLETED"],
  COMPLETED: [],
  DECLINED: [],
};

async function listForHospital(hospitalId, { direction } = {}) {
  let where;
  if (direction === "incoming") {
    where = { fromHospitalId: hospitalId };
  } else if (direction === "outgoing") {
    where = { toHospitalId: hospitalId };
  } else {
    where = { OR: [{ fromHospitalId: hospitalId }, { toHospitalId: hospitalId }] };
  }

  const requests = await prisma.exchangeRequest.findMany({
    where,
    include: { fromHospital: true, toHospital: true },
    orderBy: { requestedOn: "desc" },
  });
  return requests.map((request) => ({
    id: request.id,
    medicine: request.medicine,
    quantity: request.quantity,
    unit: request.unit,
    status: request.status,
    requestedOn: request.requestedOn,
    updatedAt: request.updatedAt,
    fromHospitalId: request.fromHospitalId,
    toHospitalId: request.toHospitalId,
    fromHospital: request.fromHospital.name,
    toHospital: request.toHospital.name,
    direction: request.toHospitalId === hospitalId ? "outgoing" : "incoming",
  }));
}

async function createRequest(requestingHospitalId, { medicine, quantity, unit, toHospitalId }) {
  if (toHospitalId === requestingHospitalId) throw new ApiError(400, "You can't request stock from your own hospital");
  const partner = await prisma.hospital.findUnique({ where: { id: toHospitalId } });
  if (!partner) throw new ApiError(404, "Partner hospital not found");
  const requestingHospital = await prisma.hospital.findUnique({ where: { id: requestingHospitalId } });

  // fromHospital = supplier (partner), toHospital = recipient (requester)
  const created = await prisma.$transaction(async (tx) => {
    const req = await tx.exchangeRequest.create({
      data: {
        medicine,
        quantity,
        unit,
        fromHospitalId: toHospitalId,
        toHospitalId: requestingHospitalId,
      },
      include: { fromHospital: true, toHospital: true },
    });

    await tx.notification.create({
      data: {
        hospitalId: toHospitalId,
        title: `New exchange request from ${requestingHospital ? requestingHospital.name : "a partner"}`,
        body: `${requestingHospital ? requestingHospital.name : "A hospital"} requested ${medicine} × ${quantity} ${unit}.`,
        type: "EXCHANGE",
      },
    });

    // Audit log (best-effort — never affects the request creation)
    try {
      await tx.auditLog.create({
        data: {
          hospitalId: requestingHospitalId,
          userId: null,
          action: "EXCHANGE_REQUEST_CREATED",
          entity: "ExchangeRequest",
          entityId: req.id,
          newValue: { medicine, quantity, unit, toHospitalId },
        },
      });
    } catch {}

    return req;
  });

  return {
    id: created.id,
    medicine: created.medicine,
    quantity: created.quantity,
    unit: created.unit,
    status: created.status,
    requestedOn: created.requestedOn,
    updatedAt: created.updatedAt,
    fromHospitalId: created.fromHospitalId,
    toHospitalId: created.toHospitalId,
    fromHospital: created.fromHospital.name,
    toHospital: created.toHospital.name,
    direction: "outgoing",
  };
}

function assertTransition(request, hospitalId, role, nextStatus) {
  if (role !== "ADMIN") throw new ApiError(403, "Only hospital administrators can change exchange status");
  if (!TRANSITIONS[request.status]?.includes(nextStatus)) {
    throw new ApiError(409, `Cannot change ${request.status} request to ${nextStatus}`);
  }
  const supplierAction = nextStatus === "APPROVED" || nextStatus === "DECLINED" || nextStatus === "IN_TRANSIT";
  if (supplierAction && request.fromHospitalId !== hospitalId) {
    throw new ApiError(403, "Only the supplying hospital can approve, decline, or dispatch this request");
  }
  if (nextStatus === "COMPLETED" && request.toHospitalId !== hospitalId) {
    throw new ApiError(403, "Only the receiving hospital can confirm delivery");
  }
}

async function completeTransfer(tx, request) {
  const source = await tx.medicine.findFirst({
    where: {
      hospitalId: request.fromHospitalId,
      name: { equals: request.medicine, mode: "insensitive" },
      unit: request.unit,
      quantity: { gte: request.quantity },
    },
    orderBy: { expiry: "asc" },
  });
  if (!source) {
    throw new ApiError(409, "Supplier no longer has enough matching stock to complete this transfer");
  }

  const sourceNewQty = source.quantity - request.quantity;
  const sourceNewStatus = calculateMedicineStatus(sourceNewQty);

  const updatedSource = await tx.medicine.update({
    where: { id: source.id },
    data: { quantity: sourceNewQty, status: sourceNewStatus },
  });

  await tx.inventoryMovement.create({
    data: { hospitalId: request.fromHospitalId, medicineId: source.id, type: "OUT", quantity: request.quantity },
  });

  let destination = await tx.medicine.findFirst({
    where: {
      hospitalId: request.toHospitalId,
      name: { equals: source.name, mode: "insensitive" },
      batch: source.batch,
      unit: source.unit,
      expiry: source.expiry,
    },
  });

  if (destination) {
    const destNewQty = destination.quantity + request.quantity;
    const destNewStatus = calculateMedicineStatus(destNewQty);
    destination = await tx.medicine.update({
      where: { id: destination.id },
      data: { quantity: destNewQty, status: destNewStatus },
    });
  } else {
    destination = await tx.medicine.create({
      data: {
        medicineCode: source.medicineCode,
        name: source.name,
        category: source.category,
        batch: source.batch,
        quantity: request.quantity,
        unit: source.unit,
        unitPrice: source.unitPrice,
        expiry: source.expiry,
        status: calculateMedicineStatus(request.quantity),
        hospitalId: request.toHospitalId,
      },
    });
  }
  await tx.inventoryMovement.create({
    data: { hospitalId: request.toHospitalId, medicineId: destination.id, type: "IN", quantity: request.quantity },
  });

  return { source: updatedSource, destination };
}

async function updateStatus(hospitalId, role, id, status) {
  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.exchangeRequest.findUnique({
      where: { id },
      include: { fromHospital: true, toHospital: true },
    });
    if (!request) throw new ApiError(404, "Exchange request not found");
    assertTransition(request, hospitalId, role, status);
    if (status === "COMPLETED") await completeTransfer(tx, request);

    const updated = await tx.exchangeRequest.update({
      where: { id },
      data: { status },
      include: { fromHospital: true, toHospital: true },
    });

    // Notify the other party
    const recipientHospitalId = status === "COMPLETED" ? request.fromHospitalId : request.toHospitalId;
    const notifyingHospitalName =
      status === "COMPLETED" ? request.toHospital.name : request.fromHospital.name;

    await tx.notification.create({
      data: {
        hospitalId: recipientHospitalId,
        title: `Exchange request ${status.toLowerCase().replace("_", " ")}`,
        body: `${request.medicine} × ${request.quantity} ${request.unit} is now ${status.toLowerCase().replace("_", " ")}${notifyingHospitalName ? ` by ${notifyingHospitalName}` : ""}.`,
        type: "EXCHANGE",
      },
    });

    // Also notify requester when supplier takes action? Already covered by recipient logic for APPROVED/DECLINED/IN_TRANSIT
    // For COMPLETED we already notified supplier. Let's also create a success notification for recipient if completed?
    if (status === "COMPLETED") {
      await tx.notification.create({
        data: {
          hospitalId: request.toHospitalId,
          title: `Stock received: ${request.medicine}`,
          body: `${request.quantity} ${request.unit} of ${request.medicine} received from ${request.fromHospital.name}. Inventory updated.`,
          type: "SUCCESS",
        },
      });
    }

    // Audit log (best-effort — never affects the status change)
    try {
      await tx.auditLog.create({
        data: {
          hospitalId,
          action: `EXCHANGE_${status}`,
          entity: "ExchangeRequest",
          entityId: id,
          newValue: { status, medicine: request.medicine, quantity: request.quantity },
        },
      });
    } catch {}

    return updated;
  });

  return {
    id: result.id,
    medicine: result.medicine,
    quantity: result.quantity,
    unit: result.unit,
    status: result.status,
    requestedOn: result.requestedOn,
    updatedAt: result.updatedAt,
    fromHospitalId: result.fromHospitalId,
    toHospitalId: result.toHospitalId,
    fromHospital: result.fromHospital.name,
    toHospital: result.toHospital.name,
    direction: result.toHospitalId === hospitalId ? "outgoing" : "incoming",
  };
}

module.exports = { listForHospital, createRequest, updateStatus, assertTransition };
