import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { Plus, Search, Pill, SlidersHorizontal, Pencil, Trash2, Upload, Download } from "lucide-react";
import { api } from "../services/api";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Skeleton from "../components/ui/Skeleton";
import EmptyState from "../components/ui/EmptyState";
import MedicineFormModal from "../components/modals/MedicineFormModal";
import { formatDate } from "../utils/format";
import { statusTone } from "../utils/expiry";
import { useAuth } from "../context/AuthContext";
import { canManageInventory } from "../utils/permissions";
import { parseSpreadsheet, checkHeaders, normalizeRows, REQUIRED_HEADERS, downloadTemplate } from "../utils/excelImport";
import "./Inventory.css";

const FILTERS = ["All", "In Stock", "Low Stock", "Critical", "Expired"];

export default function Inventory() {
  const { user } = useAuth();
  const canWrite = canManageInventory(user?.roleKey);

  const [medicines, setMedicines] = useState(null);
  const [modal, setModal] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("search") || "";
  // Deep-linkable status filter: /inventory?status=Expired (used by the
  // dashboard "Expired" panel's View all link).
  const initialStatus = searchParams.get("status");
  const [filter, setFilter] = useState(
    FILTERS.includes(initialStatus) ? initialStatus : "All"
  );

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null); // { imported, failed, errors }
  const [importError, setImportError] = useState("");
  const fileInputRef = useRef(null);

  const loadMedicines = useCallback(() => {
    setMedicines(null);
    api.getMedicines({ search: query }).then(setMedicines).catch(() => setMedicines([]));
  }, [query]);

  useEffect(() => {
    queueMicrotask(loadMedicines);
  }, [loadMedicines]);

  // "Expired" is derived from the expiry date — the backend never stores it
  // as a status.
  const isExpiredMed = (m) => new Date(m.expiry).getTime() < Date.now();

  const filtered = useMemo(() => {
    if (!medicines) return [];
    if (filter === "Expired") return medicines.filter(isExpiredMed);
    return medicines.filter((m) => filter === "All" || m.status === filter);
  }, [medicines, filter]);

  const setSearch = (value) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value.trim()) next.set("search", value);
      else next.delete("search");
      return next;
    });
  };

  const handleSave = async (data) => {
    if (modal?.mode === "edit") {
      await api.updateMedicine(modal.medicine.id, data);
    } else {
      await api.createMedicine(data);
    }
    loadMedicines();
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this medicine from inventory?")) return;
    setDeletingId(id);
    try {
      await api.deleteMedicine(id);
      loadMedicines();
    } catch (err) {
      alert(err.message || "Failed to delete");
    } finally {
      setDeletingId(null);
    }
  };

  // --- Excel / CSV import ----------------------------------------------------
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same file
    if (!file) return;

    setImportError("");
    setImportResult(null);
    setImporting(true);

    try {
      const rows = await parseSpreadsheet(file);

      const { missing, unknown } = checkHeaders(rows);
      if (missing.length > 0) {
        setImportError(
          `Missing required column(s): ${missing.join(", ")}. Required headers are: ${REQUIRED_HEADERS.join(", ")}.`
        );
        return;
      }
      if (unknown.length > 0) {
        setImportError(
          `Unrecognized column(s): ${unknown.join(", ")}. Allowed headers: ${REQUIRED_HEADERS.join(", ")}, unitPrice, status, medicineCode.`
        );
        return;
      }

      const normalized = normalizeRows(rows);
      const result = await api.bulkImportMedicines(normalized);
      setImportResult(result);
      loadMedicines();
    } catch (err) {
      setImportError(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Track stock levels, expiry, and batches across your hospital."
        actions={
          canWrite ? (
            <>
              <Button variant="outline" onClick={downloadTemplate}>
                <Download size={16} /> Template
              </Button>
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                <Upload size={16} /> {importing ? "Importing…" : "Import Excel"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFile}
                style={{ display: "none" }}
              />
              <Button variant="teal" onClick={() => setModal({ mode: "create" })}>
                <Plus size={16} /> Add Medicine
              </Button>
            </>
          ) : undefined
        }
      />

      {(importError || importResult) && (
        <Card className={importError ? "inv-import-banner inv-import-error" : "inv-import-banner"}>
          {importError ? (
            <span>{importError}</span>
          ) : (
            <span>
              Import complete: <strong>{importResult.imported}</strong> added
              {importResult.failed > 0 && (
                <>
                  , <strong>{importResult.failed}</strong> failed
                  {importResult.errors?.length > 0 && (
                    <em> — {importResult.errors.map((e) => `row ${e.row}: ${e.error}`).join("; ")}</em>
                  )}
                </>
              )}
              .
            </span>
          )}
        </Card>
      )}

      <Card className="inv-toolbar">
        <div className="inv-toolbar-row">
          <div className="inv-search-wrap">
            <Search className="inv-search-icon" size={16} />
            <input
              value={query}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, category, batch, or code…"
              className="inv-search-input"
            />
          </div>
          <div className="inv-filters">
            <SlidersHorizontal className="inv-filters-icon" size={16} />
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => {
                  setFilter(f);
                  const next = new URLSearchParams(searchParams);
                  if (f === "All") next.delete("status");
                  else next.set("status", f);
                  setSearchParams(next, { replace: true });
                }}
                className={clsx("inv-filter-btn", filter === f && "inv-filter-btn-active")}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="inv-table-card">
        {medicines === null ? (
          <div className="inv-loading-pad">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} style={{ height: 48, width: "100%" }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Pill}
            title="No medicines found"
            description="Try a different search term or clear your filters."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setFilter("All");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="inv-table-scroll">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Batch</th>
                  <th>Category</th>
                  <th>Quantity</th>
                  <th>Expiry Date</th>
                  <th>Status</th>
                  {canWrite && <th aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id}>
                    <td data-label="Medicine">
                      <div className="inv-med-cell">
                        <div className="inv-med-icon">
                          <Pill size={16} />
                        </div>
                        <span className="inv-med-name">{m.name}</span>
                      </div>
                    </td>
                    <td className="inv-batch-cell" data-label="Batch">{m.batch}</td>
                    <td data-label="Category">
                      <Badge tone="navy">{m.category}</Badge>
                    </td>
                    <td className="inv-mono-cell" data-label="Quantity">
                      {m.quantity} {m.unit}
                    </td>
                    <td className="inv-muted-cell" data-label="Expiry Date">{formatDate(m.expiry)}</td>
                    <td data-label="Status">
                      <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                    </td>
                    {canWrite && (
                      <td data-label="" className="inv-actions-cell">
                        <div className="inv-row-actions">
                          <button
                            type="button"
                            className="inv-action-btn"
                            title="Edit"
                            onClick={() => setModal({ mode: "edit", medicine: m })}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="inv-action-btn inv-action-btn-danger"
                            title="Delete"
                            disabled={deletingId === m.id}
                            onClick={() => handleDelete(m.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal && (
        <MedicineFormModal
          medicine={modal.mode === "edit" ? modal.medicine : null}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
