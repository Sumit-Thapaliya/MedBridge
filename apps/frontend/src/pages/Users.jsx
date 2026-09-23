import { useCallback, useEffect, useState } from "react";
import { Check, Trash2, X, UserPlus, Users as UsersIcon } from "lucide-react";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Skeleton from "../components/ui/Skeleton";
import { listUsers, setUserApproval, deleteUser, registerUser } from "../services/authService";
import { useAuth } from "../context/AuthContext";
import "./Users.css";

const ROLE_OPTIONS = [
  { value: "STAFF", label: "Staff" },
  { value: "INVENTORY_MANAGER", label: "Inventory Manager" },
];

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [busy, setBusy] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", password: "", role: "STAFF" });
  const [addError, setAddError] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);

  const load = useCallback(() => {
    setUsers(null);
    listUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  const pending = (users || []).filter((u) => u.approvalStatus === "PENDING");
  const approved = (users || []).filter((u) => u.approvalStatus === "APPROVED");

  const handleApproval = async (id, approve) => {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await setUserApproval(id, approve);
      load();
    } catch (err) {
      alert(err.message || "Action failed");
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`Delete the account for ${u.name} (${u.email})?`)) return;
    setBusy((b) => ({ ...b, [u.id]: true }));
    try {
      await deleteUser(u.id);
      load();
    } catch (err) {
      alert(err.message || "Delete failed");
    } finally {
      setBusy((b) => ({ ...b, [u.id]: false }));
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setAddError("");
    setAddSubmitting(true);
    try {
      await registerUser(addForm);
      setShowAdd(false);
      setAddForm({ name: "", email: "", password: "", role: "STAFF" });
      load();
    } catch (err) {
      setAddError(err.message || "Failed to create account");
    } finally {
      setAddSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Approve new accounts and manage your hospital team."
        actions={
          <Button variant="teal" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? <X size={16} /> : <UserPlus size={16} />}
            {showAdd ? "Cancel" : "Add user"}
          </Button>
        }
      />

      {showAdd && (
        <Card className="users-add-card">
          <form className="users-add-form" onSubmit={handleAdd}>
            {addError && <div className="users-error">{addError}</div>}
            <input
              className="users-input"
              placeholder="Full name"
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              required
              minLength={2}
            />
            <input
              className="users-input"
              type="email"
              placeholder="Work email"
              value={addForm.email}
              onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
            <input
              className="users-input"
              type="password"
              placeholder="Password (min 8)"
              value={addForm.password}
              onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <select
              className="users-input"
              value={addForm.role}
              onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="teal" disabled={addSubmitting}>
              {addSubmitting ? "Creating…" : "Create"}
            </Button>
          </form>
        </Card>
      )}

      <Card className="users-section-card">
        <h3 className="users-section-title">
          Pending approvals{" "}
          {pending.length > 0 && <Badge tone="amber">{pending.length}</Badge>}
        </h3>
        {users === null ? (
          <Skeleton style={{ height: 60, width: "100%" }} />
        ) : pending.length === 0 ? (
          <p className="users-empty">No pending accounts.</p>
        ) : (
          <ul className="users-list">
            {pending.map((u) => (
              <li key={u.id} className="users-row">
                <div className="users-row-main">
                  <div className="users-name">{u.name}</div>
                  <div className="users-sub">
                    {u.email} · {u.role}
                  </div>
                </div>
                <div className="users-row-actions">
                  <Button
                    variant="teal"
                    size="sm"
                    disabled={busy[u.id]}
                    onClick={() => handleApproval(u.id, true)}
                  >
                    <Check size={14} /> Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy[u.id]}
                    onClick={() => handleApproval(u.id, false)}
                  >
                    <X size={14} /> Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="users-section-card">
        <h3 className="users-section-title">
          <UsersIcon size={16} style={{ marginRight: 6 }} />
          All users
        </h3>
        {users === null ? (
          <Skeleton style={{ height: 120, width: "100%" }} />
        ) : approved.length === 0 ? (
          <p className="users-empty">No approved users yet.</p>
        ) : (
          <ul className="users-list">
            {approved.map((u) => {
              const isMe = u.id === me?.id;
              const isAdmin = u.roleKey === "ADMIN";
              return (
                <li key={u.id} className="users-row">
                  <div className="users-row-main">
                    <div className="users-name">
                      {u.name} {isMe && <span className="users-you">(you)</span>}
                    </div>
                    <div className="users-sub">{u.email}</div>
                  </div>
                  <div className="users-row-meta">
                    <Badge tone={isAdmin ? "navy" : u.roleKey === "INVENTORY_MANAGER" ? "teal" : "neutral"}>
                      {u.role}
                    </Badge>
                    {isAdmin || isMe ? null : (
                      <Button variant="danger" size="sm" disabled={busy[u.id]} onClick={() => handleDelete(u)}>
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {me?.roleKey !== "ADMIN" && (
        <p className="users-empty">Only administrators can view this page.</p>
      )}
    </div>
  );
}
