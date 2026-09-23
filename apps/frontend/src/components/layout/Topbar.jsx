import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Bell, ChevronDown, Menu, Search } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import "./Topbar.css";
import ThemeToggle from "../ui/ThemeToggle";

export default function Topbar() {
  const { user, unreadCount, setSidebarMobileOpen } = useApp();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  // True after the user picks a result / presses Enter — hides the dropdown
  // without clearing the typed text. Reset on the next keystroke, so a bogus
  // term like "bdndon" still shows "No medicines found."
  const [dismissed, setDismissed] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return undefined;

    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setSearchError("");
      try {
        const medicines = await api.searchMedicines(term);
        if (active) setResults(medicines.slice(0, 5));
      } catch (error) {
        if (active) {
          setResults([]);
          setSearchError(error.message || "Unable to search medicines.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const handleSearchChange = (event) => {
    const nextQuery = event.target.value;
    setQuery(nextQuery);
    setDismissed(false);
    if (nextQuery.trim().length < 2) {
      setResults([]);
      setSearchError("");
    }
  };

  const viewAllResults = () => {
    const term = query.trim();
    if (term) navigate(`/inventory?search=${encodeURIComponent(term)}`);
    setResults([]);
    setDismissed(true);
  };


  return (
    <header className="topbar">
      <button className="topbar-menu-btn" onClick={() => setSidebarMobileOpen(true)}>
        <Menu size={20} />
      </button>

      <div className="topbar-search-wrap">
        <Search className="topbar-search-icon" size={16} />
        <input
          type="search"
          value={query}
          onChange={handleSearchChange}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              viewAllResults();
            }
          }}
          placeholder="Search medicines…"
          aria-label="Search your hospital medicines"
          className="topbar-search-input"
        />
        {query.trim().length >= 2 && !dismissed && (
          <div className="topbar-search-results" role="listbox">
            {loading && <div className="topbar-search-message">Searching…</div>}
            {!loading && searchError && <div className="topbar-search-message topbar-search-error">{searchError}</div>}
            {!loading && !searchError && results.length === 0 && (
              <div className="topbar-search-message">No medicines found.</div>
            )}
            {!loading && results.map((medicine) => (
              <button
                key={medicine.id}
                type="button"
                className="topbar-search-result"
                onClick={viewAllResults}
              >
                <span>{medicine.name}</span>
                <small>{medicine.quantity} {medicine.unit} · {medicine.batch}</small>
              </button>
            ))}
            {!loading && results.length > 0 && (
              <button type="button" className="topbar-search-all" onClick={viewAllResults}>
                View all matching medicines
              </button>
            )}
          </div>
        )}
      </div>

      <div className="topbar-spacer" />

      {/* ADDED: the theme toggle button, placed before the notification bell */}
      <ThemeToggle />

      <Link to="/notifications" className="topbar-icon-btn">
        <Bell size={18} />
        {unreadCount > 0 && <span className="topbar-bell-badge">{unreadCount}</span>}
      </Link>

      <div className="topbar-user-menu-wrap">
        <button onClick={() => setMenuOpen((v) => !v)} className="topbar-user-btn">
          {user ? (
            <img src={user.avatar} alt={user.name} className="topbar-avatar" />
          ) : (
            <div className="topbar-avatar-placeholder" />
          )}
          <div className="topbar-user-text">
            <div className="topbar-user-name">{user?.name || "…"}</div>
            <div className="topbar-user-role">{user?.role}</div>
          </div>
          <ChevronDown className="topbar-chevron" size={16} />
        </button>

        {menuOpen && (
          <div
            className={clsx("topbar-dropdown", "animate-fade-up")}
            onMouseLeave={() => setMenuOpen(false)}
          >
            <Link to="/settings" className="topbar-dropdown-item" onClick={() => setMenuOpen(false)}>
              Account settings
            </Link>
            <Link to="/hospitals" className="topbar-dropdown-item" onClick={() => setMenuOpen(false)}>
              Partner hospitals
            </Link>
            <div className="topbar-dropdown-divider" />
            <button
              type="button"
              className={clsx("topbar-dropdown-item", "topbar-dropdown-danger")}
              onClick={handleLogout}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
