import { useEffect, useState } from "react";
import { Building2, MapPin, Star, Package, Users, Repeat2 } from "lucide-react";
import { api } from "../../services/api";
import Modal from "./Modal";
import Skeleton from "../ui/Skeleton";
import Badge from "../ui/Badge";

export default function HospitalProfileModal({ hospitalId, onClose }) {
  const [hospital, setHospital] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hospitalId) return;
    setLoading(true);
    api.getHospital(hospitalId)
      .then((h) => {
        setHospital(h);
        setError("");
      })
      .catch((e) => setError(e.message || "Failed to load hospital"))
      .finally(() => setLoading(false));
  }, [hospitalId]);

  return (
    <Modal
      title={hospital ? hospital.name : "Hospital Profile"}
      subtitle={hospital ? `${hospital.location} · ${hospital.type}` : "Loading hospital details..."}
      onClose={onClose}
    >
      {loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          <Skeleton style={{ height: 80, width: "100%" }} />
          <Skeleton style={{ height: 60, width: "100%" }} />
          <Skeleton style={{ height: 60, width: "100%" }} />
        </div>
      ) : error ? (
        <div style={{ color: "#b91c1c", background: "#fef2f2", padding: "12px", borderRadius: 8 }}>{error}</div>
      ) : hospital ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ height: 48, width: 48, borderRadius: 8, background: "var(--navy-50)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Building2 size={24} style={{ color: "var(--navy-600)" }} />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{hospital.name}</div>
              <div style={{ fontSize: 13, color: "var(--ink-faint)", display: "flex", alignItems: "center", gap: 4 }}>
                <MapPin size={12} /> {hospital.location}
              </div>
              {hospital.province && (
                <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 2 }}>
                  {hospital.province} {hospital.district ? `· ${hospital.district}` : ""} {hospital.ecoregion ? `· ${hospital.ecoregion}` : ""}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--ink-soft)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Star size={14} style={{ color: "var(--amber-500)", fill: "var(--amber-500)" }} /> {hospital.rating?.toFixed ? hospital.rating.toFixed(1) : hospital.rating}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Package size={14} /> {hospital._count?.medicines ?? 0} medicines
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Users size={14} /> {hospital._count?.users ?? 0} staff
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Repeat2 size={14} /> {(hospital._count?.outgoingRequests ?? 0) + (hospital._count?.incomingRequests ?? 0)} active exchanges
            </span>
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Type</div>
            <Badge tone="navy">{hospital.type}</Badge>
          </div>

          {/* //This Shows the hospitalId
          <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>
            Hospital ID: {hospital.id}
            {hospital.externalCode && ` · Code: ${hospital.externalCode}`} 
          </div>  */}
          
        </div>
      ) : null}
    </Modal>
  );
}
