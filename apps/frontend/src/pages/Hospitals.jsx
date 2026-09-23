import { useEffect, useState } from "react";
import { Building2, MapPin, Star, Repeat2 } from "lucide-react";
import { api } from "../services/api";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import Skeleton from "../components/ui/Skeleton";
import Button from "../components/ui/Button";
import ExchangeRequestModal from "../components/modals/ExchangeRequestModal";
import HospitalProfileModal from "../components/modals/HospitalProfileModal";
import { useApp } from "../context/AppContext";
import "./Hospitals.css";

export default function Hospitals() {
  const [hospitals, setHospitals] = useState(null);
  const [selectedHospitalId, setSelectedHospitalId] = useState(null);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileHospitalId, setProfileHospitalId] = useState(null);
  const { activeHospital, refreshNotifications } = useApp();

  useEffect(() => {
    api.getHospitals().then(setHospitals).catch(() => setHospitals([]));
  }, []);

  const handleRequestStock = (hospitalId) => {
    setSelectedHospitalId(hospitalId);
    setShowRequestModal(true);
  };

  const handleViewProfile = (hospitalId) => {
    setProfileHospitalId(hospitalId);
    setShowProfileModal(true);
  };

  return (
    <div>
      <PageHeader
        title="Hospitals"
        subtitle="Partner hospitals and clinics connected to your exchange network."
      />

      <div className="hosp-grid">
        {hospitals === null
          ? Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="hosp-skeleton-card">
                <Skeleton style={{ height: "100%", width: "100%" }} />
              </Card>
            ))
          : hospitals.map((h) => (
              <Card key={h.id} className="hosp-card">
                <div className="hosp-head">
                  <div className="hosp-icon-wrap">
                    <Building2 className="hosp-icon" size={20} />
                  </div>
                  <div>
                    <div className="hosp-name">{h.name}</div>
                    <div className="hosp-location">
                      <MapPin size={12} /> {h.location} · {h.type}
                    </div>
                  </div>
                </div>

                <div className="hosp-meta">
                  <span className="hosp-meta-item">
                    <Star size={14} className="hosp-star" />
                    {h.rating.toFixed(1)}
                  </span>
                  <span className="hosp-meta-item">
                    <Repeat2 size={14} />
                    {h.activeExchanges} active
                  </span>
                </div>

                <div className="hosp-actions">
                  <Button size="sm" variant="outline" className="hosp-actions-btn" onClick={() => handleViewProfile(h.id)}>
                    View Profile
                  </Button>
                  <Button
                    size="sm"
                    variant="teal"
                    className="hosp-actions-btn"
                    onClick={() => handleRequestStock(h.id)}
                    disabled={activeHospital === h.name}
                    title={activeHospital === h.name ? "This is your hospital" : `Request stock from ${h.name}`}
                  >
                    {activeHospital === h.name ? "Your Hospital" : "Request Stock"}
                  </Button>
                </div>
              </Card>
            ))}
      </div>

      {showRequestModal && (
        <ExchangeRequestModal
          preselectedHospitalId={selectedHospitalId}
          onClose={() => {
            setShowRequestModal(false);
            setSelectedHospitalId(null);
          }}
          onCreated={async () => {
            await refreshNotifications().catch(() => {});
          }}
        />
      )}

      {showProfileModal && profileHospitalId && (
        <HospitalProfileModal
          hospitalId={profileHospitalId}
          onClose={() => {
            setShowProfileModal(false);
            setProfileHospitalId(null);
          }}
        />
      )}
    </div>
  );
}
