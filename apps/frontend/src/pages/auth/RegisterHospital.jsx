import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import Button from "../../components/ui/Button";
import "./Auth.css";
import logo from "../../assets/logo.png";

const HOSPITAL_TYPES = ["General", "Specialty", "Teaching", "Regional", "Clinic"];

export default function RegisterHospital() {
  const { registerHospital } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    hospitalName: "",
    location: "",
    type: "General",
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await registerHospital(form);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell" data-theme="light">
      <div className="auth-card auth-card-wide">
        <div className="auth-brand">
          <img src={logo} alt="MedBridge" className="auth-brand-logo" />
          <span className="auth-brand-name">MedBridge</span>
        </div>

        <h1 className="auth-title">Register your hospital</h1>
        <p className="auth-subtitle">
          Create a hospital account and set up the first admin user to join the exchange network.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}

          <div className="auth-divider">Hospital</div>

          <label className="auth-field">
            <span className="auth-label">Hospital name</span>
            <input
              className="auth-input"
              value={form.hospitalName}
              onChange={update("hospitalName")}
              placeholder="City Hospital"
              required
              minLength={2}
            />
          </label>

          <div className="auth-row">
            <label className="auth-field">
              <span className="auth-label">Location</span>
              <input
                className="auth-input"
                value={form.location}
                onChange={update("location")}
                placeholder="Kathmandu"
                required
                minLength={2}
              />
            </label>

            <label className="auth-field">
              <span className="auth-label">Type</span>
              <select className="auth-select" value={form.type} onChange={update("type")}>
                {HOSPITAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="auth-divider">Admin account</div>

          <label className="auth-field">
            <span className="auth-label">Your full name</span>
            <input
              className="auth-input"
              value={form.name}
              onChange={update("name")}
              placeholder="Dr. Sarah Johnson"
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
              placeholder="admin@hospital.org"
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
            {submitting ? "Creating account…" : "Create hospital account"}
          </Button>
        </form>

        <p className="auth-footer">
          Already registered?{" "}
          <Link to="/login" className="auth-link">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
