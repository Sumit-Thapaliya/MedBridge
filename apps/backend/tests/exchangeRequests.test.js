const assert = require("node:assert/strict");
const test = require("node:test");
const { assertTransition } = require("../src/services/exchangeRequests.service");

const supplierRequest = {
  status: "PENDING",
  fromHospitalId: "supplier",
  toHospitalId: "recipient",
};

test("only a supplier admin can approve a pending request", () => {
  assert.doesNotThrow(() => assertTransition(supplierRequest, "supplier", "ADMIN", "APPROVED"));
  assert.throws(
    () => assertTransition(supplierRequest, "recipient", "ADMIN", "APPROVED"),
    /supplying hospital/
  );
  assert.throws(
    () => assertTransition(supplierRequest, "supplier", "STAFF", "APPROVED"),
    /administrators/
  );
});

test("only the recipient admin can confirm an in-transit delivery", () => {
  const inTransit = { ...supplierRequest, status: "IN_TRANSIT" };
  assert.doesNotThrow(() => assertTransition(inTransit, "recipient", "ADMIN", "COMPLETED"));
  assert.throws(
    () => assertTransition(inTransit, "supplier", "ADMIN", "COMPLETED"),
    /receiving hospital/
  );
});

test("terminal and skipped transitions are rejected", () => {
  assert.throws(
    () => assertTransition(supplierRequest, "supplier", "ADMIN", "COMPLETED"),
    /Cannot change/
  );
  assert.throws(
    () => assertTransition({ ...supplierRequest, status: "COMPLETED" }, "supplier", "ADMIN", "DECLINED"),
    /Cannot change/
  );
});
