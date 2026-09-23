import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/layout/Sidebar";
import Topbar from "../components/layout/Topbar";
import "./AppLayout.css";

function PageFallback() {
  return <div className="app-layout-fallback">Loading…</div>;
}

export default function AppLayout() {
  return (
    <div className="app-layout-shell">
      <Sidebar />
      <div className="app-layout-main">
        <Topbar />
        <main className="app-layout-content">
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
