import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import Button from "../../components/ui/Button";
import "./Auth.css";
import logo from "../../assets/logo.png";

const ROLES = [
  { value: "STAFF", label: "Staff", hint: "Request stock and view inventory" },
  { value: "INVENTORY_MANAGER", label: "Inventory Manager", hint: "Add & manage medicines" },
];

export default function JoinHospital() {
  const { registerMember } = useAuth();
  const [hospitals, setHospitals] = useState([]);
  const [loadingHospitals, setLoadingHospitals] = useState(true);
  const [form, setForm] = useState({
    hospitalId: "",
    name: "",
    email: "",
    password: "",
    role: "STAFF",
  });
  const [error, setError] = useState("");
  const [hospOpen, setHospOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const dropRef = useRef(null);
  const chosenHospital = hospitals.find((h) => h.id === form.hospitalId) || null;
  const chosenRole = ROLES.find((r) => r.value === form.role) || null;

  // Close the custom hospital/role lists when tapping anywhere outside them.
  useEffect(() => {
    if (!hospOpen && !roleOpen) return undefined;
    const close = () => {
      setHospOpen(false);
      setRoleOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [hospOpen, roleOpen]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    api
      .getHospitalDirectory()
      .then(setHospitals)
      .catch(() => setHospitals([]))
      .finally(() => setLoadingHospitals(false));
  }, []);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.hospitalId) {
      setError("Please select your hospital.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await registerMember(form);
      setSubmitted(true);
      void result;
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="auth-shell" data-theme="light">
        <div className="auth-card">
          <div className="auth-brand">
            <img src={logo} alt="MedBridge" className="auth-brand-logo" />
            <span className="auth-brand-name">MedBridge</span>
          </div>
          <h1 className="auth-title">Request submitted</h1>
          <div className="auth-success">
            Your account has been created but is <strong>pending approval</strong>. A hospital
            administrator must approve your account before you can sign in. You will be able to
            log in once approved.
          </div>
          <p className="auth-footer" style={{ marginTop: "1rem" }}>
            <Link to="/login" className="auth-link">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell" data-theme="light">
      <div className="auth-card auth-card-wide">
        <div className="auth-brand">
          <img src={logo} alt="MedBridge" className="auth-brand-logo" />
          <span className="auth-brand-name">MedBridge</span>
        </div>

        <h1 className="auth-title">Join your hospital</h1>
        <p className="auth-subtitle">
          Create a staff or inventory-manager account for an existing hospital. An administrator
          must approve you before you can sign in.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}

          <div className="auth-field">
            <span className="auth-label">Hospital</span>
            <div className="auth-drop" ref={dropRef} onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="auth-select auth-drop-btn"
                aria-haspopup="listbox"
                aria-expanded={hospOpen}
                disabled={loadingHospitals}
                onClick={() => {
                  setRoleOpen(false);
                  setHospOpen((v) => !v);
                }}
              >
                <span className={chosenHospital ? undefined : "auth-drop-placeholder"}>
                  {loadingHospitals
                    ? "Loading hospitals…"
                    : chosenHospital
                      ? `${chosenHospital.name}${chosenHospital.location ? ` — ${chosenHospital.location}` : ""}`
                      : "Select your hospital"}
                </span>
                <ChevronDown size={16} className="auth-drop-chev" />
              </button>
              {hospOpen && (
                <ul className="auth-drop-list" role="listbox">
                  {hospitals.length === 0 && (
                    <li className="auth-drop-empty">No hospitals found.</li>
                  )}
                  {hospitals.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={h.id === form.hospitalId}
                        className="auth-drop-item"
                        onClick={() => {
                          setForm((prev) => ({ ...prev, hospitalId: h.id }));
                          setHospOpen(false);
                        }}
                      >
                        <span>{h.name}</span>
                        {h.location && <small>{h.location}</small>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="auth-divider">Your role</div>

          <div className="auth-field">
            <span className="auth-label">Role</span>
            <div className="auth-drop" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="auth-select auth-drop-btn"
                aria-haspopup="listbox"
                aria-expanded={roleOpen}
                onClick={() => {
                  setHospOpen(false);
                  setRoleOpen((v) => !v);
                }}
              >
                <span>{chosenRole ? chosenRole.label : "Select your role"}</span>
                <ChevronDown size={16} className="auth-drop-chev" />
              </button>
              {roleOpen && (
                <ul className="auth-drop-list" role="listbox">
                  {ROLES.map((r) => (
                    <li key={r.value}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={r.value === form.role}
                        className="auth-drop-item"
                        onClick={() => {
                          setForm((prev) => ({ ...prev, role: r.value }));
                          setRoleOpen(false);
                        }}
                      >
                        <span>{r.label}</span>
                        <small>{r.hint}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="auth-divider">Account</div>

          <label className="auth-field">
            <span className="auth-label">Your full name</span>
            <input
              className="auth-input"
              value={form.name}
              onChange={update("name")}
              placeholder="Jane Doe"
              required
              minLength={2}
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">Work email</span>
            <input
              type="email"
              className="auth-input"
              value={form.email}
              onChange={update("email")}
              placeholder="you@hospital.org"
              required
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">Password</span>
            <input
              type="password"
              className="auth-input"
              value={form.password}
              onChange={update("password")}
              placeholder="At least 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>

          <Button type="submit" variant="teal" className="auth-submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Request access"}
          </Button>
        </form>

        <p className="auth-footer">
          Already have an account?{" "}
          <Link to="/login" className="auth-link">
            Sign in
          </Link>
          {" · "}
          New hospital?{" "}
          <Link to="/register" className="auth-link">
            Register your hospital
          </Link>
        </p>
      </div>
    </div>
  );
}