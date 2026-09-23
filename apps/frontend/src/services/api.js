import { request } from "./httpClient";
import {
  mapUser,
  mapMedicine,
  mapExchangeRequest,
  mapNotification,
  mapReport,
  mapCategories,
  mapExpiryAlert,
  mapActivityFromNotifications,
  toMedicinePayload,
  exchangeStatusEnum,
  medicineStatusEnum,
} from "../utils/mappers";

export const api = {
  async getCurrentUser() {
    const user = await request("/auth/me");
    return mapUser(user);
  },

  async updateProfile(data) {
    const user = await request("/auth/me", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return mapUser(user);
  },

  async deleteAccount(password) {
    return request("/auth/me", {
      method: "DELETE",
      body: JSON.stringify({ password }),
    });
  },
  
  async getDashboardStats() {
    return request("/dashboard/stats");
  },

  async getInventoryOverview(period = "week") {
    const qs = new URLSearchParams({ period });
    return request(`/dashboard/inventory-overview?${qs}`);
  },

  async getMedicineCategories() {
    const rows = await request("/medicines/meta/categories");
    return mapCategories(rows);
  },

  async getMedicines(params = {}) {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.status && params.status !== "All") qs.set("status", medicineStatusEnum(params.status));
    const query = qs.toString();
    const rows = await request(`/medicines${query ? `?${query}` : ""}`);
    return rows.map(mapMedicine);
  },

  async getMedicine(id) {
    return mapMedicine(await request(`/medicines/${id}`));
  },

  async createMedicine(data) {
    return mapMedicine(
      await request("/medicines", {
        method: "POST",
        body: JSON.stringify(toMedicinePayload(data)),
      })
    );
  },

  async updateMedicine(id, data) {
    return mapMedicine(
      await request(`/medicines/${id}`, {
        method: "PATCH",
        body: JSON.stringify(toMedicinePayload(data)),
      })
    );
  },

  async searchMedicines(search) {
    return this.getMedicines({ search });
  },

  async deleteMedicine(id) {
    return request(`/medicines/${id}`, { method: "DELETE" });
  },

  // Bulk import medicines from a parsed Excel/CSV file (array of row objects).
  // Returns { imported, failed, errors } — or throws with a header-mismatch message.
  async bulkImportMedicines(rows) {
    return request("/medicines/bulk", {
      method: "POST",
      body: JSON.stringify({ rows }),
    });
  },

  async getExpiryAlerts(days = 30) {
    const rows = await request(`/medicines/meta/expiring-soon?days=${days}`);
    return rows.map(mapExpiryAlert);
  },

  async getRecentActivity() {
    const notifications = await request("/notifications");
    return mapActivityFromNotifications(notifications);
  },

  async getHospitals() {
    return request("/hospitals");
  },

  // Public hospital directory (no auth) — for the "Join hospital" page.
  async getHospitalDirectory() {
    return request("/hospitals/directory");
  },

  async getHospital(id) {
    return request(`/hospitals/${id}`);
  },

  async getExchangeRequests(params = {}) {
    const qs = new URLSearchParams();
    if (params.direction) qs.set("direction", params.direction);
    const query = qs.toString();
    const rows = await request(`/exchange-requests${query ? `?${query}` : ""}`);
    return rows.map(mapExchangeRequest);
  },

  async createExchangeRequest(data) {
    const result = await request("/exchange-requests", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return mapExchangeRequest(result);
  },

  async updateExchangeStatus(id, status) {
    const enumStatus = exchangeStatusEnum(status);
    const result = await request(`/exchange-requests/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: enumStatus }),
    });
    return mapExchangeRequest(result);
  },

  async getNotifications() {
    const rows = await request("/notifications");
    return rows.map(mapNotification);
  },

  async markAllNotificationsRead() {
    const rows = await request("/notifications/read-all", { method: "PATCH" });
    return rows.map(mapNotification);
  },

  async markNotificationRead(id) {
    await request(`/notifications/${id}/read`, { method: "PATCH" });
  },

  async getDemandForecast() {
    return request("/demand-forecast");
  },

  async getReports() {
    const rows = await request("/reports");
    return rows.map(mapReport);
  },

  async createReport(data) {
    return mapReport(
      await request("/reports", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          period: data.period,
          type: data.type,
        }),
      })
    );
  },

    async deleteReport(id) {
    return request(`/reports/${id}`, { method: "DELETE" });
  },
};
