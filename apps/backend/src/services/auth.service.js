const bcrypt = require("bcryptjs");
const prisma = require("../config/db");
const { signToken } = require("../utils/jwt");
const { ApiError } = require("../utils/ApiError");
const { seedNewHospitalHistory } = require("./seedNewHospital.service");
const notifications = require("./notifications.service");

const SALT_ROUNDS = 10;

// Roles an ADMIN may create on behalf of a hospital. ADMIN is deliberately
// excluded so a single hospital can never accumulate more than one admin.
const ASSIGNABLE_ROLES = ["STAFF", "INVENTORY_MANAGER"];

// Roles a person may self-register for. ADMIN is never self-assignable.
const SELF_REGISTER_ROLES = ["STAFF", "INVENTORY_MANAGER"];

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    approvalStatus: user.approvalStatus,
    avatarUrl: user.avatarUrl,
    hospitalId: user.hospitalId,
    hospital: user.hospital
      ? { id: user.hospital.id, name: user.hospital.name }
      : undefined,
  };
}

// Onboards a brand-new hospital onto the platform along with its first
// admin user. The admin is immediately approved (there is nobody to approve
// them), and no further admin can ever be registered for this hospital.
async function registerHospitalAndAdmin({ hospitalName, location, type, name, email, password }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ApiError(409, "An account with this email already exists");

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const hospital = await prisma.hospital.create({
    data: { name: hospitalName, location, type: type || "General" },
  });

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: "ADMIN",
      approvalStatus: "APPROVED",
      hospitalId: hospital.id,
    },
    include: { hospital: true },
  });

  // Fire-and-forget: give the new hospital a sensible starting inventory and
  // demand history via the ML cold-start endpoint. Must never block or fail
  // the actual signup, so errors are swallowed (the service also handles its
  // own failures by returning { seeded: false }).
  seedNewHospitalHistory(hospital).catch((err) => {
    console.error("[auth] Cold-start seeding failed:", err.message);
  });

  const token = signToken({ sub: user.id, hospitalId: user.hospitalId, role: user.role });
  return { token, user: toPublicUser(user) };
}

// Public self-registration for a STAFF or INVENTORY_MANAGER at an existing
// hospital. The account is created PENDING and CANNOT log in until an admin
// of that hospital approves it. ADMIN is rejected outright.
async function registerMember({ name, email, password, hospitalId, role }) {
  if (!SELF_REGISTER_ROLES.includes(role)) {
    throw new ApiError(400, "You can only register as Staff or Inventory Manager");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ApiError(409, "An account with this email already exists");

  const hospital = await prisma.hospital.findUnique({ where: { id: hospitalId } });
  if (!hospital) throw new ApiError(404, "Hospital not found");

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role,
      approvalStatus: "PENDING",
      hospitalId,
    },
    include: { hospital: true },
  });

  // Alert the hospital so an admin sees the request without opening Users.
  // A failure here must not undo the registration, hence the try/catch.
  try {
    await notifications.create(hospitalId, {
      title: "New join request",
      body: `${name} (${email}) requested to join as ${
        role === "INVENTORY_MANAGER" ? "Inventory Manager" : "Staff"
      }. Approve or reject it under Users.`,
      type: "CRITICAL",
    });
  } catch (err) {
    console.warn("[auth] join-request notification failed:", err.message);
  }

  return {
    pending: true,
    message: "Registration received. An administrator must approve your account before you can sign in.",
    user: toPublicUser(user),
  };
}

// Adds a staff or inventory-manager account to an existing hospital, called by
// an ADMIN. Admin-created accounts are approved immediately (the admin is the
// authority). ADMIN role is never assignable here.
async function registerUser({ name, email, password, hospitalId, role }, callerHospitalId) {
  if (callerHospitalId && hospitalId !== callerHospitalId) {
    throw new ApiError(403, "You can only add users to your own hospital");
  }
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new ApiError(400, "Admin can only create Staff or Inventory Manager accounts");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ApiError(409, "An account with this email already exists");

  const hospital = await prisma.hospital.findUnique({ where: { id: hospitalId } });
  if (!hospital) throw new ApiError(404, "Hospital not found");

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: { name, email, passwordHash, role, approvalStatus: "APPROVED", hospitalId },
    include: { hospital: true },
  });

  return toPublicUser(user);
}

async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email }, include: { hospital: true } });
  if (!user) throw new ApiError(401, "Incorrect email or password");

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new ApiError(401, "Incorrect email or password");

  if (user.approvalStatus === "PENDING") {
    throw new ApiError(403, "Your account is awaiting approval by a hospital administrator.");
  }
  if (user.approvalStatus === "REJECTED") {
    throw new ApiError(403, "Your registration was declined. Please contact the hospital administrator.");
  }

  const token = signToken({ sub: user.id, hospitalId: user.hospitalId, role: user.role });
  return { token, user: toPublicUser(user) };
}

async function getProfile(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { hospital: true } });
  if (!user) throw new ApiError(404, "User not found");
  return toPublicUser(user);
}

async function updateProfile(userId, { name, email }) {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw new ApiError(404, "User not found");

  if (email && email !== existing.email) {
    const emailTaken = await prisma.user.findUnique({ where: { email } });
    if (emailTaken) throw new ApiError(409, "Email already in use");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      name: name || undefined,
      email: email || undefined,
    },
    include: { hospital: true },
  });

  return toPublicUser(updated);
}

async function deleteAccount(userId, password) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "User not found");

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new ApiError(401, "Incorrect password");

  await prisma.user.delete({ where: { id: userId } });
}

// --- Admin user management (same-hospital only) ------------------------------

async function listUsers(callerHospitalId) {
  const users = await prisma.user.findMany({
    where: { hospitalId: callerHospitalId },
    orderBy: [{ approvalStatus: "asc" }, { createdAt: "asc" }],
  });
  return users.map(toPublicUser);
}

async function approveUser(callerHospitalId, userId, { approve }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "User not found");
  if (user.hospitalId !== callerHospitalId) {
    throw new ApiError(403, "You can only manage users in your own hospital");
  }
  if (user.role === "ADMIN") {
    throw new ApiError(400, "Admin accounts cannot be approved or rejected");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { approvalStatus: approve ? "APPROVED" : "REJECTED" },
    include: { hospital: true },
  });
  return toPublicUser(updated);
}

async function deleteUser(callerHospitalId, userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "User not found");
  if (user.hospitalId !== callerHospitalId) {
    throw new ApiError(403, "You can only manage users in your own hospital");
  }
  if (user.id === callerHospitalId) {
    throw new ApiError(400, "You cannot delete your own account here");
  }
  if (user.role === "ADMIN") {
    throw new ApiError(400, "Admin accounts cannot be deleted");
  }

  await prisma.user.delete({ where: { id: userId } });
}

module.exports = {
  registerHospitalAndAdmin,
  registerMember,
  registerUser,
  login,
  getProfile,
  updateProfile,
  deleteAccount,
  listUsers,
  approveUser,
  deleteUser,
  toPublicUser,
};
