import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowDownLeft, ArrowUpRight, Plus, Repeat2 } from "lucide-react";
import { api } from "../services/api";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Skeleton from "../components/ui/Skeleton";
import EmptyState from "../components/ui/EmptyState";
import ExchangeRequestModal from "../components/modals/ExchangeRequestModal";
import { formatDate } from "../utils/format";
import { statusTone } from "../utils/expiry";
import { useApp } from "../context/AppContext";
import "./ExchangeRequests.css";

const TABS = ["All", "Incoming", "Outgoing"];

export default function ExchangeRequests() {
  const [requests, setRequests] = useState(null);
  const [tab, setTab] = useState("All");
  const [showModal, setShowModal] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [error, setError] = useState("");
  const { refreshNotifications } = useApp();

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api.getExchangeRequests();
      setRequests(data);
    } catch (e) {
      setError(e.message || "Failed to load exchange requests");
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered =
    requests?.filter((r) => {
      if (tab === "All") return true;
      return r.direction === tab.toLowerCase();
    }) ?? [];

  const handleStatus = async (id, statusLabel) => {
    setActionId(id);
    setError("");
    try {
      await api.updateExchangeStatus(id, statusLabel);
      await load();
      await refreshNotifications().catch(() => {});
    } catch (e) {
      setError(e.message || `Failed to ${statusLabel}`);
    } finally {
      setActionId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Exchange Requests"
        subtitle="Requests to send or receive medicine stock with partner hospitals."
        actions={
          <Button variant="teal" onClick={() => setShowModal(true)}>
            <Plus size={16} /> New Request
          </Button>
        }
      />

      {error && (
        <div style={{ marginBottom: 12, color: "#b91c1c", background: "#fef2f2", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div className="ex-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx("ex-tab-btn", tab === t && "ex-tab-btn-active")}
          >
            {t}
          </button>
        ))}
      </div>

      {requests === null ? (
        <div className="ex-list">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} style={{ height: 96, width: "100%" }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Repeat2}
            title="No exchange requests"
            description={
              tab === "All"
                ? "When a hospital requests stock from you, or you request stock from another hospital, it will show up here."
                : tab === "Incoming"
                ? "No incoming requests. Incoming means another hospital asked you for stock."
                : "No outgoing requests. Outgoing means you requested stock from another hospital."
            }
            action={
              <Button variant="teal" size="sm" onClick={() => setShowModal(true)}>
                <Plus size={16} /> New Request
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="ex-list">
          {filtered.map((r) => (
            <Card key={r.id} className="ex-card">
              <div className="ex-card-left">
                <div
                  className={clsx(
                    "ex-direction-icon",
                    r.direction === "incoming" ? "ex-direction-icon-in" : "ex-direction-icon-out"
                  )}
                >
                  {r.direction === "incoming" ? (
                    <ArrowDownLeft size={18} />
                  ) : (
                    <ArrowUpRight size={18} />
                  )}
                </div>
                <div className="ex-card-info">
                  <div className="ex-card-title">
                    {r.quantity} {r.unit} · {r.medicine}
                  </div>
                  <div className="ex-card-sub">
                    {r.fromHospital} <span className="ex-arrow">→</span> {r.toHospital}{" "}
                    <span style={{ marginLeft: 6, fontStyle: "italic" }}>({r.direction})</span>
                  </div>
                </div>
              </div>

              <div className="ex-card-right">
                <div>
                  <div className="ex-date-label">Requested</div>
                  <div className="ex-date-value">{formatDate(r.requestedOn)}</div>
                </div>
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>

                {/* Supplier actions for incoming requests */}
                {r.direction === "incoming" && r.status === "Pending" && (
                  <div className="ex-actions">
                    <Button
                      size="sm"
                      variant="teal"
                      disabled={actionId === r.id}
                      onClick={() => handleStatus(r.id, "Approved")}
                    >
                      {actionId === r.id ? "..." : "Approve"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionId === r.id}
                      onClick={() => handleStatus(r.id, "Declined")}
                    >
                      Decline
                    </Button>
                  </div>
                )}

                {r.direction === "incoming" && r.status === "Approved" && (
                  <div className="ex-actions">
                    <Button
                      size="sm"
                      variant="teal"
                      disabled={actionId === r.id}
                      onClick={() => handleStatus(r.id, "In Transit")}
                    >
                      {actionId === r.id ? "..." : "Dispatch"}
                    </Button>
                  </div>
                )}

                {/* Recipient action for outgoing/incoming in transit */}
                {r.direction === "outgoing" && r.status === "In Transit" && (
                  <div className="ex-actions">
                    <Button
                      size="sm"
                      variant="teal"
                      disabled={actionId === r.id}
                      onClick={() => handleStatus(r.id, "Completed")}
                    >
                      {actionId === r.id ? "..." : "Confirm Delivery"}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {showModal && (
        <ExchangeRequestModal
          onClose={() => setShowModal(false)}
          onCreated={async () => {
            await load();
            await refreshNotifications().catch(() => {});
          }}
        />
      )}
    </div>
  );
}
