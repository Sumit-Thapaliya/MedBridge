import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import "./Settings.css";

function Field({ label, value, onChange, type = "text", readOnly = false, placeholder }) {
  return (
    <label className="set-field">
      <span className="set-field-label">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        placeholder={placeholder}
        className="set-field-input"
        style={readOnly ? { background: "var(--line)", opacity: 0.7, cursor: "not-allowed" } : {}}
      />
    </label>
  );
}

export default function Settings() {
  const { user } = useApp();
  const { refreshUser, logout } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: "", email: "" });
  const [original, setOriginal] = useState({ name: "", email: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  // Danger zone state
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    if (user) {
      const initial = { name: user.name || "", email: user.email || "" };
      setForm(initial);
      setOriginal(initial);
    }
  }, [user]);

  const hasChanges = form.name !== original.name || form.email !== original.email;
  const isValid = form.name.trim().length >= 2 && form.email.includes("@");

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setMessage({ type: "", text: "" });
  };

  const handleSave = async () => {
    if (!hasChanges) {
      setMessage({ type: "info", text: "No changes to save." });
      return;
    }
    if (!isValid) {
      setMessage({ type: "error", text: "Please enter a valid name (min 2 chars) and email." });
      return;
    }
    setSaving(true);
    setMessage({ type: "", text: "" });
    try {
      const updated = await api.updateProfile({
        name: form.name.trim(),
        email: form.email.trim(),
      });
      setOriginal({ name: updated.name, email: updated.email });
      setForm({ name: updated.name, email: updated.email });
      await refreshUser();
      setMessage({ type: "success", text: "Profile updated successfully!" });
    } catch (err) {
      setMessage({ type: "error", text: err.message || "Failed to update profile." });
    } finally {
      setSaving(false);
    }
  };

  const canDelete = deletePassword.length > 0 && deleteConfirmText.trim().toUpperCase() === "DELETE";

  const handleDeleteAccount = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.deleteAccount(deletePassword);
      logout();
      navigate("/login", { replace: true });
    } catch (err) {
      setDeleteError(err.message || "Failed to delete account. Please check your password.");
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage your account, hospital, and platform preferences." />

      <div className="set-grid">
        <Card className="set-profile-card">
          <h3 className="set-card-title">Profile</h3>

          {message.text && (
            <div
              style={{
                marginBottom: 12,
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                background:
                  message.type === "error"
                    ? "#fef2f2"
                    : message.type === "success"
                    ? "#f0fdf4"
                    : "#eff6ff",
                color:
                  message.type === "error"
                    ? "#b91c1c"
                    : message.type === "success"
                    ? "#166534"
                    : "#1e40af",
                border: `1px solid ${
                  message.type === "error"
                    ? "#fecaca"
                    : message.type === "success"
                    ? "#bbf7d0"
                    : "#bfdbfe"
                }`,
              }}
            >
              {message.text}
            </div>
          )}

          <div className="set-field-grid">
            <Field label="Full name" value={form.name} onChange={handleChange("name")} placeholder="Your full name" />
            <Field label="Role" value={user?.role || ""} readOnly />
            <Field label="Hospital" value={user?.hospital || ""} readOnly />
            <Field label="Email" value={form.email} onChange={handleChange("email")} type="email" placeholder="you@hospital.org" />
          </div>
          <div className="set-save-row" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button variant="teal" onClick={handleSave} disabled={saving || !hasChanges || !isValid}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
            {hasChanges && <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>You have unsaved changes</span>}
          </div>
        </Card>

        <Card className="set-notif-card">
          <h3 className="set-notif-title">Notifications</h3>
          <p className="set-ai-desc">
            Notifications are always on. You'll be alerted about low stock,
            critical shortages, medicines nearing expiry, and exchange request
            updates in the bell menu and on your Dashboard.
          </p>
          <p className="set-ai-desc">
            Per-notification preferences (email digests, muting categories) are
            not yet configurable and will be added in a future update.
          </p>
        </Card>
      </div>

      <Card className="set-ai-card">
        <h3 className="set-notif-title">AI features</h3>
        <p className="set-ai-desc">
          The MedBridge Assistant, demand forecasting, and smart exchange
          matching are active. The Assistant answers medical questions and pulls
          live data from your inventory; forecasting and exchange matching use
          the ML service (port 8000) when it's running.
        </p>
        <p className="set-ai-desc">
          You can manage which LLM provider the Assistant uses from the backend
          <code> .env</code> (LLM_PROVIDER and provider API keys).
        </p>
      </Card>

      <Card className="set-danger-card">
        <h3 className="set-danger-title">Danger Zone</h3>
        <p className="set-danger-desc">
          Deleting your account is permanent and can't be undone. Your hospital's medicines and
          exchange history will remain, but you'll immediately lose access and need a new account
          to log back in.
        </p>

        {deleteError && <div className="set-danger-error">{deleteError}</div>}

        <div className="set-danger-fields">
          <label className="set-field">
            <span className="set-field-label">Confirm your password</span>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="••••••••"
              className="set-field-input"
              autoComplete="current-password"
            />
          </label>
          <label className="set-field">
            <span className="set-field-label">
              Type <strong>DELETE</strong> to confirm
            </span>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="set-field-input"
            />
          </label>
        </div>

        <Button
          variant="danger"
          onClick={handleDeleteAccount}
          disabled={!canDelete || deleting}
        >
          {deleting ? "Deleting…" : "Delete My Account"}
        </Button>
      </Card>
    </div>
  );
}
