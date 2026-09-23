import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import "./InventoryTrendChart.css";

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="trend-tooltip">
      <div className="trend-tooltip-label">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="trend-tooltip-row">
          <span className="trend-tooltip-dot" style={{ background: p.color }} />
          <span className="trend-tooltip-name">
            {p.dataKey === "stockIn" ? "Stock In" : "Stock Out"}
          </span>
          <span className="trend-tooltip-value">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function InventoryTrendChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#E4E9EE"
          vertical={false}
        />
        <XAxis
          dataKey="day"
          tick={{ fontSize: 12, fill: "#8A94A3" }}
          axisLine={{ stroke: "#E4E9EE" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 12, fill: "#8A94A3" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone"
          dataKey="stockIn"
          stroke="#233A5C"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "#233A5C", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
        <Line
          type="monotone"
          dataKey="stockOut"
          stroke="#0E8C82"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "#0E8C82", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}