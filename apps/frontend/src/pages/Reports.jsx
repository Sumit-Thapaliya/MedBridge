import { useEffect, useState } from "react";
import { FileBarChart2, Download, Plus, X, Trash2 } from "lucide-react";
import { api } from "../services/api";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Skeleton from "../components/ui/Skeleton";
import EmptyState from "../components/ui/EmptyState";
import { formatDate } from "../utils/format";
import "./Reports.css";

const REPORT_TYPES = [
  { value: "INVENTORY", label: "Inventory" },
  { value: "EXCHANGE", label: "Exchange" },
  { value: "COMPLIANCE", label: "Compliance" },
];

function toCsv(rows) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(escape).join(",")).join("\n");
}

function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Pulls REAL, live data for the report's type, and builds the actual CSV
// content — this is the piece that was missing before (a report used to
// only ever contain its own name/period/type, no real data).
async function exportReport(report) {
  let header = [];
  let rows = [];

  if (report.type === "Inventory") {
    const medicines = await api.getMedicines();
    header = ["Medicine", "Batch", "Category", "Quantity", "Unit", "Unit Price", "Expiry", "Status"];
    rows = medicines.map((m) => [
      m.name, m.batch, m.category, m.quantity, m.unit, m.unitPrice, formatDate(m.expiry), m.status,
    ]);
  } else if (report.type === "Exchange") {
    const requests = await api.getExchangeRequests();
    header = ["Medicine", "Quantity", "Unit", "From Hospital", "To Hospital", "Status", "Direction", "Requested On"];
    rows = requests.map((r) => [
      r.medicine, r.quantity, r.unit, r.fromHospital, r.toHospital, r.status, r.direction, formatDate(r.requestedOn),
    ]);
  } else {
    // Compliance -> expiry risk, using a wider 90-day window since this is
    // a report, not the dashboard's immediate-action alert list.
    const alerts = await api.getExpiryAlerts(90);
    header = ["Medicine", "Days Left", "Expiry Date", "Severity"];
    rows = alerts.map((a) => [a.medicine, a.isExpired ? "Expired" : a.daysLeft, a.expiry, a.severity]);
  }

  const titleBlock = [
    [report.name],
    [`Period: ${report.period}`],
    [`Generated: ${formatDate(report.generatedOn)}`],
    [],
  ];

  const csv = [toCsv(titleBlock), toCsv([header]), toCsv(rows)].filter(Boolean).join("\n");
  downloadCsv(`report-${report.id}.csv`, csv);
}

export default function Reports() {
  const [reports, setReports] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", period: "", type: "INVENTORY" });
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState("");
  const [exportingId, setExportingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const load = () => api.getReports().then(setReports).catch(() => setReports([]));

  useEffect(() => {
    load();
  }, []);

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.period.trim()) {
      setFormError("Name and period are required.");
      return;
    }
    setGenerating(true);
    setFormError("");
    try {
      await api.createReport({ name: form.name.trim(), period: form.period.trim(), type: form.type });
      setForm({ name: "", period: "", type: "INVENTORY" });
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err.message || "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  };

  const handleExport = async (report) => {
    setExportingId(report.id);
    try {
      await exportReport(report);
    } catch (err) {
      alert(err.message || "Failed to export report");
    } finally {
      setExportingId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this report?")) return;
    setDeletingId(id);
    try {
      await api.deleteReport(id);
      await load();
    } catch (err) {
      alert(err.message || "Failed to delete report");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Generated summaries of inventory, exchanges, and compliance."
        actions={
          <Button variant="teal" onClick={() => setShowForm((v) => !v)}>
            {showForm ? <X size={16} /> : <Plus size={16} />} {showForm ? "Cancel" : "Generate Report"}
          </Button>
        }
      />

      {showForm && (
        <Card style={{ marginBottom: 16 }}>
          <form onSubmit={handleGenerate} style={{ display: "grid", gap: 12 }}>
            {formError && (
              <div style={{ color: "#b91c1c", background: "#fef2f2", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
                {formError}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 , padding:20}}>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span>Report name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Monthly Inventory Summary"
                  style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span>Period</span>
                <input
                  value={form.period}
                  onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
                  placeholder="Aug 2026"
                  style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span>Type</span>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)" }}
                >
                  {REPORT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <Button type="submit" variant="teal" disabled={generating}>
                {generating ? "Generating…" : "Generate"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="rep-card">
        {reports === null ? (
          <div className="rep-loading-pad">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} style={{ height: 56, width: "100%" }} />
            ))}
          </div>
        ) : reports.length === 0 ? (
          <EmptyState
            icon={FileBarChart2}
            title="No reports yet"
            description="Generate a report to see it here."
            action={
              <Button variant="teal" size="sm" onClick={() => setShowForm(true)}>
                <Plus size={16} /> Generate Report
              </Button>
            }
          />
        ) : (
          <div className="rep-divide">
            {reports.map((r) => (
              <div key={r.id} className="rep-row">
                <div className="rep-icon-wrap">
                  <FileBarChart2 size={18} />
                </div>
                <div className="rep-info">
                  <div className="rep-name">{r.name}</div>
                  <div className="rep-meta">
                    {r.period} · Generated {formatDate(r.generatedOn)}
                  </div>
                </div>
                <Badge tone="navy" hideOnMobile>
                  {r.type}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleExport(r)}
                  disabled={exportingId === r.id}
                >
                  <Download size={14} /> {exportingId === r.id ? "Exporting…" : "Export"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDelete(r.id)}
                  disabled={deletingId === r.id}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
