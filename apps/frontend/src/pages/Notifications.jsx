import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Bell, CheckCircle2, Repeat2, Info } from "lucide-react";
import { api } from "../services/api";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Skeleton from "../components/ui/Skeleton";
import EmptyState from "../components/ui/EmptyState";
import { useApp } from "../context/AppContext";
import "./Notifications.css";

const iconMap = {
  critical: { icon: AlertTriangle, cls: "notif-icon-critical" },
  exchange: { icon: Repeat2, cls: "notif-icon-exchange" },
  info: { icon: Info, cls: "notif-icon-info" },
  success: { icon: CheckCircle2, cls: "notif-icon-success" },
};

export default function Notifications() {
  const {
    notifications: contextNotifications,
    setNotifications: setContextNotifications,
    refreshNotifications,
    markAllNotificationsRead: contextMarkAll,
  } = useApp();

  const [items, setItems] = useState(null);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api.getNotifications();
      setItems(data);
      setContextNotifications(data);
    } catch (e) {
      setError(e.message || "Failed to load notifications");
      setItems([]);
    }
  }, [setContextNotifications]);

  useEffect(() => {
    // If context already has data, use it initially to avoid flash
    if (contextNotifications && contextNotifications.length > 0 && items === null) {
      setItems(contextNotifications);
    }
    load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMarkAll = async () => {
    setMarking(true);
    setError("");
    try {
      const updated = await api.markAllNotificationsRead();
      setItems(updated);
      setContextNotifications(updated);
      // also call context method to keep internal sync
      await contextMarkAll().catch(() => {});
    } catch (e) {
      setError(e.message || "Failed to mark all as read");
      // optimistic fallback
      setItems((prev) => (prev ? prev.map((n) => ({ ...n, read: true })) : []));
      setContextNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } finally {
      setMarking(false);
    }
  };

  const handleMarkOne = async (id) => {
    try {
      await api.markNotificationRead(id);
      setItems((prev) => (prev ? prev.map((n) => (n.id === id ? { ...n, read: true } : n)) : []));
      setContextNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch {
      // silent
    }
  };

  const handleRefresh = async () => {
    await load();
    await refreshNotifications().catch(() => {});
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Stay on top of low stock, expiries, and exchange updates."
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleMarkAll} disabled={marking}>
              {marking ? "Marking..." : "Mark all as read"}
            </Button>
          </div>
        }
      />

      {error && (
        <div style={{ marginBottom: 12, color: "#b91c1c", background: "#fef2f2", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      )}

      <Card className="notif-card">
        {items === null ? (
          <div className="notif-loading-pad">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} style={{ height: 64, width: "100%" }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Bell} title="You're all caught up" description="No notifications right now." />
        ) : (
          <div className="notif-divide">
            {items.map((n) => {
              const cfg = iconMap[String(n.type || "").toLowerCase()] || iconMap.info;
              const Icon = cfg.icon;
              return (
                <div
                  key={n.id}
                  className={clsx("notif-row", !n.read && "notif-row-unread")}
                  onClick={() => !n.read && handleMarkOne(n.id)}
                  style={{ cursor: !n.read ? "pointer" : "default" }}
                  title={!n.read ? "Click to mark as read" : ""}
                >
                  <div className={clsx("notif-icon-wrap", cfg.cls)}>
                    <Icon size={18} />
                  </div>
                  <div className="notif-body">
                    <div className="notif-top-row">
                      <span className="notif-title">{n.title}</span>
                      {!n.read && <span className="notif-unread-dot" />}
                    </div>
                    <p className="notif-text">{n.body}</p>
                    <span className="notif-time">{n.time}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
