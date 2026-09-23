// Role-based permission helpers. `roleKey` is the raw enum value carried on
// the mapped user object (ADMIN / INVENTORY_MANAGER / STAFF).

export const ROLES = {
  ADMIN: "ADMIN",
  INVENTORY_MANAGER: "INVENTORY_MANAGER",
  STAFF: "STAFF",
};

export function isAdmin(roleKey) {
  return roleKey === ROLES.ADMIN;
}

// Admin + Inventory Manager may create/edit/delete medicines (incl. Excel import).
export function canManageInventory(roleKey) {
  return roleKey === ROLES.ADMIN || roleKey === ROLES.INVENTORY_MANAGER;
}

// Only admin may manage users (approve / delete accounts).
export function canManageUsers(roleKey) {
  return roleKey === ROLES.ADMIN;
}
