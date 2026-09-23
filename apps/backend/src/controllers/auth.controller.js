const { asyncHandler } = require("../utils/asyncHandler");
const authService = require("../services/auth.service");

const registerHospital = asyncHandler(async (req, res) => {
  const result = await authService.registerHospitalAndAdmin(req.body);
  res.status(201).json(result);
});

// Public self-registration (Staff / Inventory Manager) → pending approval.
const registerMember = asyncHandler(async (req, res) => {
  const result = await authService.registerMember(req.body);
  res.status(201).json(result);
});

// Admin creates a Staff / Inventory Manager account (approved immediately).
const registerUser = asyncHandler(async (req, res) => {
  const user = await authService.registerUser(req.body, req.user.hospitalId);
  res.status(201).json(user);
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  res.json(result);
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.user.id);
  res.json(user);
});

const updateMe = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user.id, req.body);
  res.json(user);
});

const deleteAccount = asyncHandler(async (req, res) => {
  await authService.deleteAccount(req.user.id, req.body.password);
  res.status(204).send();
});

// --- Admin user management ---
const listUsers = asyncHandler(async (req, res) => {
  const users = await authService.listUsers(req.user.hospitalId);
  res.json(users);
});

const approveUser = asyncHandler(async (req, res) => {
  const user = await authService.approveUser(req.user.hospitalId, req.params.id, req.body);
  res.json(user);
});

const deleteUser = asyncHandler(async (req, res) => {
  await authService.deleteUser(req.user.hospitalId, req.params.id);
  res.status(204).send();
});

module.exports = {
  registerHospital,
  registerMember,
  registerUser,
  login,
  me,
  updateMe,
  deleteAccount,
  listUsers,
  approveUser,
  deleteUser,
};
