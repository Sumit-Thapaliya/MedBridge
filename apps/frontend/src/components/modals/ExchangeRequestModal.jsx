import { useEffect, useState } from "react";
import { api } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import Modal from "./Modal";
import Button from "../ui/Button";

export default function ExchangeRequestModal({ preselectedHospitalId, onClose, onCreated }) {
  const { user } = useAuth();
  const [hospitals, setHospitals] = useState([]);
  const [form, setForm] = useState({
    medicine: "",
    quantity: "",
    unit: "boxes",
    toHospitalId: preselectedHospitalId || "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.getHospitals().then((list) => {
      const partners = list.filter((h) => h.id !== user?.hospitalId);
      setHospitals(partners);
      if (preselectedHospitalId) {
        setForm((prev) => ({ ...prev, toHospitalId: preselectedHospitalId }));
      } else if (partners.length === 1) {
        setForm((prev) => ({ ...prev, toHospitalId: partners[0].id }));
      }
    });
  }, [preselectedHospitalId, user?.hospitalId]);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const payload = {
        medicine: form.medicine,
        quantity: Number(form.quantity),
        unit: form.unit,
      };

      // "General" = broadcast: one request per partner hospital.
      if (form.toHospitalId === "GENERAL") {
        if (hospitals.length === 0) {
          throw new Error("No partner hospitals available to request from.");
        }
        const results = await Promise.allSettled(
          hospitals.map((h) =>
            api.createExchangeRequest({ ...payload, toHospitalId: h.id })
          )
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          const first = results.find((r) => r.status === "rejected");
          throw new Error(
            failed === results.length
              ? first.reason?.message || "Failed to create requests"
              : `Created ${results.length - failed} of ${results.length} requests. ${first.reason?.message || ""}`
          );
        }
      } else {
        await api.createExchangeRequest({ ...payload, toHospitalId: form.toHospitalId });
      }

      onCreated?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to create request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="New exchange request"
      subtitle="Request stock from a partner hospital on the network."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={handleSubmit}>
        {error && <div className="modal-error">{error}</div>}

        <label className="modal-field">
          <span className="modal-label">Request from hospital</span>
          <select className="modal-select" value={form.toHospitalId} onChange={update("toHospitalId")} required>
            <option value="">Select a hospital…</option>
            <option value="GENERAL">General — request from all hospitals</option>
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} — {h.location}
              </option>
            ))}
          </select>
        </label>

        <label className="modal-field">
          <span className="modal-label">Medicine</span>
          <input
            className="modal-input"
            value={form.medicine}
            onChange={update("medicine")}
            placeholder="Amoxicillin 500mg"
            required
          />
        </label>

        <div className="modal-row">
          <label className="modal-field">
            <span className="modal-label">Quantity</span>
            <input
              type="number"
              min="1"
              className="modal-input"
              value={form.quantity}
              onChange={update("quantity")}
              required
            />
          </label>
          <label className="modal-field">
            <span className="modal-label">Unit</span>
            <input className="modal-input" value={form.unit} onChange={update("unit")} required />
          </label>
        </div>

        <div className="modal-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="teal" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
