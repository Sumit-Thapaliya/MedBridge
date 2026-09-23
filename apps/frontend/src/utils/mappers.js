const MEDICINE_STATUS_LABEL = {
  IN_STOCK: "In Stock",
  LOW_STOCK: "Low Stock",
  MEDIUM_STOCK: "Medium Stock",
  CRITICAL: "Critical",
};

const MEDICINE_STATUS_ENUM = {
  "In Stock": "IN_STOCK",
  "Low Stock": "LOW_STOCK",
  "Medium Stock": "MEDIUM_STOCK",
  Critical: "CRITICAL",
};

const EXCHANGE_STATUS_LABEL = {
  PENDING: "Pending",
  APPROVED: "Approved",
  IN_TRANSIT: "In Transit",
  COMPLETED: "Completed",
  DECLINED: "Declined",
};

const EXCHANGE_STATUS_ENUM = {
  Pending: "PENDING",
  Approved: "APPROVED",
  "In Transit": "IN_TRANSIT",
  Completed: "COMPLETED",
  Declined: "DECLINED",
};

const NOTIFICATION_TYPE_LABEL = {
  CRITICAL: "critical",
  EXCHANGE: "exchange",
  INFO: "info",
  SUCCESS: "success",
};

const REPORT_TYPE_LABEL = {
  INVENTORY: "Inventory",
  EXCHANGE: "Exchange",
  COMPLIANCE: "Compliance",
};

const ROLE_LABEL = { ADMIN: "Admin", INVENTORY_MANAGER: "Inventory Manager", STAFF: "Staff" };

const CATEGORY_COLORS = ["#233A5C", "#0E8C82", "#26A596", "#E8A23D", "#546E97", "#EBB35C"];

export function medicineStatusLabel(status) {
  return MEDICINE_STATUS_LABEL[status] || status;
}

export function medicineStatusEnum(label) {
  return MEDICINE_STATUS_ENUM[label] || label;
}

export function exchangeStatusLabel(status) {
  return EXCHANGE_STATUS_LABEL[status] || status;
}

export function exchangeStatusEnum(label) {
  return EXCHANGE_STATUS_ENUM[label] || label;
}

export function roleLabel(role) {
  return ROLE_LABEL[role] || role;
}

export function mapUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: roleLabel(user.role),
    roleKey: user.role, // raw enum (ADMIN / INVENTORY_MANAGER / STAFF) for gating
    approvalStatus: user.approvalStatus,
    hospital: user.hospital?.name || "",
    hospitalId: user.hospitalId,
    avatar:
      user.avatarUrl ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=233A5C&color=fff`,
  };
}

export function mapMedicine(m) {
  return {
    ...m,
    status: medicineStatusLabel(m.status),
    expiry: m.expiry,
  };
}

export function mapExchangeRequest(r) {
  return {
    ...r,
    status: exchangeStatusLabel(r.status),
  };
}

export function mapNotification(n) {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    type: NOTIFICATION_TYPE_LABEL[n.type] || "info",
    read: n.read,
    time: formatRelativeTime(n.createdAt),
    createdAt: n.createdAt,
  };
}

export function mapReport(r) {
  return {
    ...r,
    type: REPORT_TYPE_LABEL[r.type] || r.type,
  };
}

export function mapCategories(rows) {
  return rows.map((item, i) => ({
    ...item,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));
}

export function mapExpiryAlert(m) {
  const expiry = new Date(m.expiry);
  const daysLeft = Math.ceil((expiry - Date.now()) / (1000 * 60 * 60 * 24));
  const isExpired = daysLeft < 0;

  return {
    id: m.id,
    medicine: m.name,
    daysLeft: isExpired ? 0 : daysLeft,
    isExpired,
    expiry: expiry.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }),
    severity: isExpired ? "Expired" : medicineStatusLabel(m.status),
  };
}
export function mapActivityFromNotifications(notifications) {
  return notifications.slice(0, 5).map((n) => ({
    id: n.id,
    text: n.title,
    time: formatRelativeTime(n.createdAt),
  }));
}

export function formatRelativeTime(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

export function toMedicinePayload(data) {
  return {
    name: data.name,
    category: data.category,
    batch: data.batch,
    quantity: Number(data.quantity),
    unit: data.unit,
    unitPrice: data.unitPrice ? Number(data.unitPrice) : 0,
    expiry: data.expiry,
    status: data.status ? medicineStatusEnum(data.status) : undefined,
  };
}
