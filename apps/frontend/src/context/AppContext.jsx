import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext";
import { api } from "../services/api";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);

  useEffect(() => {
    if (!user) {
      queueMicrotask(() => setNotifications([]));
      return;
    }
    api.getNotifications().then(setNotifications).catch(() => setNotifications([]));
    // Keep the bell badge fresh so new events (join requests, low stock,
    // exchanges) appear without waiting for a page reload.
    const timer = setInterval(() => {
      api.getNotifications().then(setNotifications).catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [user]);

  const markAllNotificationsRead = useCallback(async () => {
    try {
      const updated = await api.markAllNotificationsRead();
      setNotifications(updated);
    } catch {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  }, []);

  const refreshNotifications = useCallback(async () => {
    const items = await api.getNotifications();
    setNotifications(items);
    return items;
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const value = {
    user,
    notifications,
    setNotifications,
    refreshNotifications,
    unreadCount,
    markAllNotificationsRead,
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarMobileOpen,
    setSidebarMobileOpen,
    activeHospital: user?.hospital || "",
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
