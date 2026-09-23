import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { routes, navGroups } from "../../routes";
import { useApp } from "../../context/AppContext";
import { useAuth } from "../../context/AuthContext";
import logo from "../../assets/logo.png";
import "./Sidebar.css";

// A nav item is visible if it declares no roles, or the current user's role
// is in the declared list.
function isVisible(item, roleKey) {
  if (!item.nav?.roles || item.nav.roles.length === 0) return true;
  return item.nav.roles.includes(roleKey);
}

function NavItem({ item, collapsed }) {
  const { label, icon: Icon, badge } = item.nav;
  // On phones the sidebar is an overlay; choosing a page must close it so
  // the page alone is visible. (No effect on desktop — the state only drives
  // the mobile drawer.)
  const { setSidebarMobileOpen } = useApp();
  return (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      onClick={() => setSidebarMobileOpen(false)}
      className={({ isActive }) =>
        clsx("sidebar-nav-item", isActive && "sidebar-nav-item-active")
      }
      title={collapsed ? label : undefined}
    >
      {({ isActive }) => (
        <>
          <span className={clsx("sidebar-active-bar", isActive && "sidebar-active-bar-on")} />
          <Icon className="sidebar-nav-icon" size={18} strokeWidth={1.9} />
          {!collapsed && <span className="sidebar-nav-label">{label}</span>}
          {!collapsed && badge && <span className="sidebar-nav-badge">{badge}</span>}
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const { sidebarCollapsed, setSidebarCollapsed, sidebarMobileOpen, setSidebarMobileOpen } =
    useApp();
  const { user } = useAuth();
  const roleKey = user?.roleKey;

  const grouped = navGroups
    .map((group) => ({
      group,
      items: routes.filter((r) => r.nav?.group === group && isVisible(r, roleKey)),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      {sidebarMobileOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarMobileOpen(false)} />
      )}

      <aside
        className={clsx(
          "sidebar",
          sidebarCollapsed && "sidebar-collapsed",
          sidebarMobileOpen && "sidebar-open"
        )}
      >
        <div className="sidebar-top-row">
          <div className="sidebar-brand">
            <div className="sidebar-brand-mark">
              <img src={logo} alt="MedBridge" className="sidebar-brand-logo" width={32} height={32} />
            </div>
            {!sidebarCollapsed && (
              <div className="sidebar-brand-text">
                <div className="sidebar-brand-name">MedBridge</div>
                <div className="sidebar-brand-sub">Medicine Exchange Platform</div>
              </div>
            )}
          </div>
          <button className="sidebar-close-btn" onClick={() => setSidebarMobileOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <nav className={clsx("sidebar-nav", "scrollbar-thin")}>
          {grouped.map(({ group, items }) => (
            <div key={group}>
              {!sidebarCollapsed && <div className="sidebar-group-label">{group}</div>}
              <div className="sidebar-group-items">
                {items.map((item) => (
                  <NavItem key={item.path} item={item} collapsed={sidebarCollapsed} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="sidebar-collapse-btn"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={16} />
            ) : (
              <>
                <PanelLeftClose size={16} />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
