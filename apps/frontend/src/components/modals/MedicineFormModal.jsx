import { useState } from "react";
import Modal from "./Modal";
import Button from "../ui/Button";

const STATUS_OPTIONS = ["In Stock", "Low Stock", "Medium Stock", "Critical"];

const EMPTY = {
  name: "",
  category: "",
  batch: "",
  quantity: "",
  unit: "boxes",
  unitPrice: "",
  expiry: "",
  status: "In Stock",
};

function medicineToForm(medicine) {
  if (!medicine) return EMPTY;
  return {
    name: medicine.name,
    category: medicine.category,
    batch: medicine.batch,
    quantity: String(medicine.quantity),
    unit: medicine.unit,
    unitPrice: String(medicine.unitPrice ?? ""),
    expiry: medicine.expiry?.slice?.(0, 10) || new Date(medicine.expiry).toISOString().slice(0, 10),
    status: medicine.status,
  };
}

export default function MedicineFormModal({ medicine, onClose, onSave }) {
  return <MedicineForm key={medicine?.id || "new"} medicine={medicine} onClose={onClose} onSave={onSave} />;
}

function MedicineForm({ medicine, onClose, onSave }) {
  const [form, setForm] = useState(() => medicineToForm(medicine));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(medicine);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save medicine");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={isEdit ? "Edit medicine" : "Add medicine"}
      subtitle={isEdit ? "Update stock details for this item." : "Add a new item to your hospital inventory."}
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={handleSubmit}>
        {error && <div className="modal-error">{error}</div>}

        <label className="modal-field">
          <span className="modal-label">Medicine name</span>
          <input className="modal-input" value={form.name} onChange={update("name")} required />
        </label>

        <div className="modal-row">
          <label className="modal-field">
            <span className="modal-label">Category</span>
            <input className="modal-input" value={form.category} onChange={update("category")} required />
          </label>
          <label className="modal-field">
            <span className="modal-label">Batch</span>
            <input className="modal-input" value={form.batch} onChange={update("batch")} required />
          </label>
        </div>

        <div className="modal-row">
          <label className="modal-field">
            <span className="modal-label">Quantity</span>
            <input
              type="number"
              min="0"
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

        <div className="modal-row">
          <label className="modal-field">
            <span className="modal-label">Unit price (NPR)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              className="modal-input"
              value={form.unitPrice}
              onChange={update("unitPrice")}
            />
          </label>
          <label className="modal-field">
            <span className="modal-label">Expiry date</span>
            <input type="date" className="modal-input" value={form.expiry} onChange={update("expiry")} required />
          </label>
        </div>

        <label className="modal-field">
          <span className="modal-label">Status</span>
          <select className="modal-select" value={form.status} onChange={update("status")}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="modal-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="teal" disabled={submitting}>
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Add medicine"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
