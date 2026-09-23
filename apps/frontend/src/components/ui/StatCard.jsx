import clsx from "clsx";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import Card from "./Card";
import "./StatCard.css";

export default function StatCard({
  label,
  value,
  icon: Icon,
  iconTone = "navy",
  delta,
  trend,
  helper,
}) {
  return (
    <Card className={clsx("stat-card", "animate-fade-up")}>
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        {Icon && (
          <div className={clsx("stat-card-icon-wrap", `stat-card-icon-${iconTone}`)}>
            <Icon size={18} strokeWidth={2} />
          </div>
        )}
      </div>

      <div className="stat-card-value">{value}</div>

      <div className="stat-card-footer">
        {delta != null && (
          <span
            className={clsx(
              "stat-card-delta",
              trend === "up" ? "stat-card-delta-up" : "stat-card-delta-down"
            )}
          >
            {trend === "up" ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {delta}%
          </span>
        )}
        {helper && <span className="stat-card-helper">{helper}</span>}
      </div>
    </Card>
  );
}
