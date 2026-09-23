import { request, setToken, getToken } from "./httpClient";
import { mapUser } from "../utils/mappers";

export { getToken, setToken };

export async function login(email, password) {
  const result = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(result.token);
  return { token: result.token, user: mapUser(result.user) };
}

export async function registerHospital(data) {
  const result = await request("/auth/register-hospital", {
    method: "POST",
    body: JSON.stringify(data),
  });
  setToken(result.token);
  return { token: result.token, user: mapUser(result.user) };
}

// Self-register as Staff / Inventory Manager at an existing hospital.
// Returns the pending user (NO token — the account cannot log in until approved).
export async function registerMember(data) {
  const result = await request("/auth/register-member", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return { pending: result.pending, message: result.message, user: mapUser(result.user) };
}

// Admin: create a Staff / Inventory Manager account (approved immediately).
export async function registerUser(data) {
  const user = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return mapUser(user);
}

// Admin: list users of the current hospital.
export async function listUsers() {
  const users = await request("/auth/users");
  return users.map(mapUser);
}

// Admin: approve (approve=true) or reject (approve=false) a pending user.
export async function setUserApproval(id, approve) {
  const user = await request(`/auth/users/${id}/approval`, {
    method: "PATCH",
    body: JSON.stringify({ approve }),
  });
  return mapUser(user);
}

// Admin: delete a user account.
export async function deleteUser(id) {
  return request(`/auth/users/${id}`, { method: "DELETE" });
}

export async function fetchCurrentUser() {
  const user = await request("/auth/me");
  return mapUser(user);
}

export function logout() {
  setToken(null);
}
