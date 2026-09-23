import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import {
  Pill,
  DollarSign,
  AlertTriangle,
  Repeat2,
  ArrowRight,
} from "lucide-react";
import { api } from "../services/api";
import { aiService } from "../services/aiService";
import { useAsyncData } from "../hooks/useAsyncData";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import StatCard from "../components/ui/StatCard";
import Badge from "../components/ui/Badge";
import Skeleton from "../components/ui/Skeleton";
import ErrorState from "../components/ui/ErrorState";
import InventoryTrendChart from "../components/charts/InventoryTrendChart";
import CategoryDonutChart from "../components/charts/CategoryDonutChart";
import AIInsightPanel from "../components/ai/AIInsightPanel";
import { formatCurrency, formatNepaliCurrency, formatNumber, formatDate } from "../utils/format";
import { statusTone } from "../utils/expiry";
import "./Dashboard.css";

const getRecentMedicines = () => api.getMedicines().then((m) => m.slice(0, 4));
const getDashboardStats = () => api.getDashboardStats();
const getMedicineCategories = () => api.getMedicineCategories();
const getExpiryAlerts = () => api.getExpiryAlerts();
const getRecentActivity = () => api.getRecentActivity();

export default function Dashboard() {
  const [period, setPeriod] = useState("week");
  const getInventoryOverview = useCallback(
    () => api.getInventoryOverview(period),
    [period],
  );

  const {
    data: stats,
    error: statsError,
    reload: reloadStats,
  } = useAsyncData(getDashboardStats);
  const {
    data: overview,
    error: overviewError,
    reload: reloadOverview,
  } = useAsyncData(getInventoryOverview);
  const {
    data: categories,
    error: categoriesError,
    reload: reloadCategories,
  } = useAsyncData(getMedicineCategories);
  const {
    data: medicines,
    error: medicinesError,
    reload: reloadMedicines,
  } = useAsyncData(getRecentMedicines);
  const {
    data: alerts,
    error: alertsError,
    reload: reloadAlerts,
  } = useAsyncData(getExpiryAlerts);
  const expiredAlerts = (alerts || []).filter((a) => a.isExpired);
  const expiringAlerts = (alerts || []).filter((a) => !a.isExpired);
  const {
    data: activity,
    error: activityError,
    reload: reloadActivity,
  } = useAsyncData(getRecentActivity);

  const forecastFetcher = useCallback(() => aiService.getForecastInsight(), []);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Welcome back! Here's what's happening with your inventory."
      />

      <div className="dash-stat-grid">
        {statsError ? (
          <Card className="dash-skeleton-card" style={{ gridColumn: "1 / -1" }}>
            <ErrorState
              title="Couldn't load dashboard stats"
              description={statsError.message}
              onRetry={reloadStats}
            />
          </Card>
        ) : stats ? (
          <>
            <StatCard
              label="Total Medicines"
              value={formatNumber(stats.totalMedicines.value)}
              icon={Pill}
              iconTone="navy"
              delta={stats.totalMedicines.delta}
              trend={stats.totalMedicines.trend}
              helper="from last month"
            />
            <StatCard
              label="Total Value"
              value={formatNepaliCurrency(stats.totalValue.value)}
              icon={DollarSign}
              iconTone="teal"
              delta={stats.totalValue.delta}
              trend={stats.totalValue.trend}
              helper="from last month"
            />
            <StatCard
              label="Expiring Soon"
              value={stats.expiringSoon.value}
              icon={AlertTriangle}
              iconTone="amber"
              helper={`Within ${stats.expiringSoon.window}`}
            />
            <StatCard
              label="Active Exchanges"
              value={stats.activeExchanges.value}
              icon={Repeat2}
              iconTone="coral"
              helper={stats.activeExchanges.label}
            />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="dash-skeleton-card">
              <Skeleton style={{ height: "100%", width: "100%" }} />
            </Card>
          ))
        )}
      </div>

      <div className="dash-charts-grid">
        <Card className="dash-trend-card">
          <div className="dash-card-head-row">
            <h3 className="dash-card-title">Inventory Overview</h3>
            <select
              className="dash-select"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="quarter">This Quarter</option>
            </select>
          </div>
          {overviewError ? (
            <ErrorState
              title="Couldn't load inventory overview"
              description={overviewError.message}
              onRetry={reloadOverview}
            />
          ) : overview ? (
            <InventoryTrendChart data={overview} />
          ) : (
            <Skeleton
              style={{ height: 260, width: "100%", marginTop: "0.5rem" }}
            />
          )}
        </Card>

        <Card className="dash-categories-card">
          <h3 className="dash-categories-title">Medicine Categories</h3>
          {categoriesError ? (
            <ErrorState
              title="Couldn't load categories"
              description={categoriesError.message}
              onRetry={reloadCategories}
            />
          ) : categories ? (
            <CategoryDonutChart data={categories} />
          ) : (
            <Skeleton style={{ height: 132, width: "100%" }} />
          )}
        </Card>
      </div>

      <div className="dash-bottom-grid">
        <Card className="dash-panel">
          <div className="dash-panel-head">
            <h3 className="dash-panel-title">Expired</h3>
            <Link to="/inventory?status=Expired" className="dash-panel-link">
              View all
            </Link>
          </div>
          <div className="dash-alert-list">
            {alertsError ? (
              <ErrorState
                title="Couldn't load expired medicines"
                description={alertsError.message}
                onRetry={reloadAlerts}
              />
            ) : alerts ? (
              expiredAlerts.length ? (
                expiredAlerts.map((a) => (
                  <div key={a.id} className="dash-alert-row">
                    <div className="dash-alert-dial dash-alert-dial-expired">
                      <span className="dash-alert-dial-expired-label">
                        Expired
                      </span>
                    </div>
                    <div className="dash-alert-info">
                      <div className="dash-alert-name">{a.medicine}</div>
                      <div className="dash-alert-exp">Exp. {a.expiry}</div>
                    </div>
                    <Badge tone={statusTone(a.severity)}>{a.severity}</Badge>
                  </div>
                ))
              ) : (
                <div className="dash-empty">No expired medicines. Well done!</div>
              )
            ) : (
              <Skeleton style={{ height: 96, width: "100%" }} />
            )}
          </div>
        </Card>

        <Card className="dash-panel">
          <div className="dash-panel-head">
            <h3 className="dash-panel-title">Expiry Alerts</h3>
            <Link to="/inventory" className="dash-panel-link">
              View all
            </Link>
          </div>
          <div className="dash-alert-list">
            {alertsError ? (
              <ErrorState
                title="Couldn't load expiry alerts"
                description={alertsError.message}
                onRetry={reloadAlerts}
              />
            ) : alerts ? (
              expiringAlerts.length ? (
                expiringAlerts.map((a) => (
                  <div key={a.id} className="dash-alert-row">
                    <div className="dash-alert-dial">
                      <span className="dash-alert-dial-num">
                        {a.daysLeft}
                      </span>
                      <span className="dash-alert-dial-label">days</span>
                    </div>
                    <div className="dash-alert-info">
                      <div className="dash-alert-name">{a.medicine}</div>
                      <div className="dash-alert-exp">Exp. {a.expiry}</div>
                    </div>
                    <Badge tone={statusTone(a.severity)}>{a.severity}</Badge>
                  </div>
                ))
              ) : (
                <div className="dash-empty">No medicines expiring in this window.</div>
              )
            ) : (
              <Skeleton style={{ height: 96, width: "100%" }} />
            )}
          </div>
        </Card>

        <Card className="dash-panel">
          <div className="dash-panel-head">
            <h3 className="dash-panel-title">Recent Activity</h3>
            <Link to="/notifications" className="dash-panel-link">
              View all
            </Link>
          </div>
          <div className="dash-activity-list">
            {activityError ? (
              <ErrorState
                title="Couldn't load recent activity"
                description={activityError.message}
                onRetry={reloadActivity}
              />
            ) : activity ? (
              activity.map((a) => (
                <div key={a.id} className="dash-activity-row">
                  <span className="dash-activity-dot" />
                  <div>
                    <div className="dash-activity-text">{a.text}</div>
                    <span className="dash-activity-time">{a.time}</span>
                  </div>
                </div>
              ))
            ) : (
              <Skeleton style={{ height: 96, width: "100%" }} />
            )}
          </div>
        </Card>

        <div className="dash-span-rest">
          <AIInsightPanel title="Forecast Insight" fetcher={forecastFetcher} />
        </div>
      </div>

      <Card className="dash-table-card">
        <div className="dash-panel-head">
          <h3 className="dash-panel-title">Recent Medicines</h3>
          <Link
            to="/inventory"
            className="dash-panel-link dash-panel-link-icon"
          >
            View all <ArrowRight size={12} />
          </Link>
        </div>
        {medicinesError ? (
          <ErrorState
            title="Couldn't load recent medicines"
            description={medicinesError.message}
            onRetry={reloadMedicines}
          />
        ) : (
          <div className="dash-table-scroll">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Medicine Name</th>
                  <th>Category</th>
                  <th>Quantity</th>
                  <th>Expiry Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(medicines || []).map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="dash-med-cell">
                        <div className="dash-med-icon">
                          <Pill size={16} />
                        </div>
                        <span className="dash-med-name">{m.name}</span>
                      </div>
                    </td>
                    <td>
                      <Badge tone="navy">{m.category}</Badge>
                    </td>
                    <td className="dash-mono-cell">
                      {m.quantity} {m.unit}
                    </td>
                    <td className="dash-muted-cell">{formatDate(m.expiry)}</td>
                    <td>
                      <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
