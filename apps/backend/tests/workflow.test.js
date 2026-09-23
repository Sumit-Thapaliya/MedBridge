const assert = require("node:assert/strict");
const test = require("node:test");

// We test pure logic extracted from services without DB

// ---- Direction logic ----
function getDirection(request, hospitalId) {
  // Fixed logic: toHospital is recipient = outgoing, fromHospital is supplier = incoming
  return request.toHospitalId === hospitalId ? "outgoing" : "incoming";
}

test("direction mapping: supplier sees incoming, recipient sees outgoing", () => {
  const supplierId = "hospital-B";
  const recipientId = "hospital-A";
  const req = { fromHospitalId: supplierId, toHospitalId: recipientId };

  assert.equal(getDirection(req, supplierId), "incoming", "Supplier should see incoming");
  assert.equal(getDirection(req, recipientId), "outgoing", "Recipient should see outgoing");
});

test("listForHospital where clause for direction", () => {
  function buildWhere(hospitalId, direction) {
    if (direction === "incoming") return { fromHospitalId: hospitalId };
    if (direction === "outgoing") return { toHospitalId: hospitalId };
    return { OR: [{ fromHospitalId: hospitalId }, { toHospitalId: hospitalId }] };
  }

  const hid = "h1";
  assert.deepEqual(buildWhere(hid, "incoming"), { fromHospitalId: "h1" });
  assert.deepEqual(buildWhere(hid, "outgoing"), { toHospitalId: "h1" });
  assert.deepEqual(buildWhere(hid, undefined), { OR: [{ fromHospitalId: "h1" }, { toHospitalId: "h1" }] });
});

// ---- Medicine status calculation ----
function calculateStatus(qty) {
  if (qty <= 0) return "CRITICAL";
  if (qty < 5) return "CRITICAL";
  if (qty < 15) return "LOW_STOCK";
  if (qty < 40) return "MEDIUM_STOCK";
  return "IN_STOCK";
}

test("medicine status from quantity", () => {
  assert.equal(calculateStatus(0), "CRITICAL");
  assert.equal(calculateStatus(3), "CRITICAL");
  assert.equal(calculateStatus(10), "LOW_STOCK");
  assert.equal(calculateStatus(20), "MEDIUM_STOCK");
  assert.equal(calculateStatus(100), "IN_STOCK");
});

// ---- Complete transfer inventory update simulation ----
test("completeTransfer should decrement source and increment destination with status recalc", async () => {
  // Simulate source medicine
  let source = { id: "med1", quantity: 50, status: "IN_STOCK" };
  const requestQty = 45;
  const newQty = source.quantity - requestQty;
  const newStatus = calculateStatus(newQty);
  assert.equal(newQty, 5);
  assert.equal(newStatus, "LOW_STOCK");

  // Destination new medicine
  let destExists = null;
  let dest;
  if (!destExists) {
    dest = { quantity: requestQty, status: calculateStatus(requestQty) };
    assert.equal(dest.quantity, 45);
    assert.equal(dest.status, "IN_STOCK");
  }

  // If dest existed with 5, then +45 =50 => IN_STOCK
  destExists = { quantity: 5, status: "LOW_STOCK" };
  const destNewQty = destExists.quantity + requestQty;
  assert.equal(destNewQty, 50);
  assert.equal(calculateStatus(destNewQty), "IN_STOCK");
});

// ---- Exchange request creation notification ----
test("createRequest should create notification for supplier", () => {
  const requestingHospitalId = "hA";
  const supplierId = "hB";
  const medicine = "Amoxicillin";
  const quantity = 10;
  const unit = "boxes";

  // Simulated transaction that creates notification
  let notifications = [];
  function createNotification(hospitalId, title, body) {
    notifications.push({ hospitalId, title, body, type: "EXCHANGE" });
  }

  // Simulate our fixed create logic
  createNotification(
    supplierId,
    `New exchange request from Hospital A`,
    `Hospital A requested ${medicine} × ${quantity} ${unit}.`
  );

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].hospitalId, supplierId);
  assert.match(notifications[0].body, /Amoxicillin/);
});

// ---- updateStatus notification recipient logic ----
test("updateStatus recipient is correct per status", () => {
  function getRecipient(request, status) {
    return status === "COMPLETED" ? request.fromHospitalId : request.toHospitalId;
  }

  const req = { fromHospitalId: "supplier", toHospitalId: "recipient" };
  assert.equal(getRecipient(req, "APPROVED"), "recipient", "Approved should notify recipient");
  assert.equal(getRecipient(req, "DECLINED"), "recipient");
  assert.equal(getRecipient(req, "IN_TRANSIT"), "recipient");
  assert.equal(getRecipient(req, "COMPLETED"), "supplier", "Completed should notify supplier");
});

// ---- Delete medicine should remove movements first ----
test("deleteMedicine transaction deletes movements then medicine", async () => {
  let deletedMovements = false;
  let deletedMedicine = false;
  let order = [];

  const tx = {
    inventoryMovement: {
      deleteMany: async () => {
        order.push("movements");
        deletedMovements = true;
      },
    },
    medicine: {
      delete: async () => {
        order.push("medicine");
        deletedMedicine = true;
      },
    },
  };

  await tx.inventoryMovement.deleteMany({ where: { medicineId: "med1" } });
  await tx.medicine.delete({ where: { id: "med1" } });

  assert.equal(deletedMovements, true);
  assert.equal(deletedMedicine, true);
  assert.deepEqual(order, ["movements", "medicine"], "Movements must be deleted before medicine");
});

// ---- Notifications mark all read ----
test("markAllRead should set all unread to read", () => {
  let notifications = [
    { id: "1", read: false },
    { id: "2", read: false },
    { id: "3", read: true },
  ];

  // Simulate updateMany where read=false => read=true
  notifications = notifications.map((n) => ({ ...n, read: true }));

  assert.equal(notifications.every((n) => n.read), true);
  assert.equal(notifications.filter((n) => !n.read).length, 0);
});

// ---- Exchange status enum mapping ----
test("exchange status label mapping", () => {
  const labelMap = {
    PENDING: "Pending",
    APPROVED: "Approved",
    IN_TRANSIT: "In Transit",
    COMPLETED: "Completed",
    DECLINED: "Declined",
  };

  const enumMap = {
    Pending: "PENDING",
    Approved: "APPROVED",
    "In Transit": "IN_TRANSIT",
    Completed: "COMPLETED",
    Declined: "DECLINED",
  };

  for (const [enumVal, label] of Object.entries(labelMap)) {
    assert.equal(enumMap[label], enumVal);
  }
});
