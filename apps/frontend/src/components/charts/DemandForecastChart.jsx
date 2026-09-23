import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export default function DemandForecastChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E4E9EE" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 12, fill: "#8A94A3" }}
          axisLine={{ stroke: "#E4E9EE" }}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 12, fill: "#8A94A3" }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{
            background: "#14213D",
            border: "none",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "#fff", fontWeight: 600 }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(v) => (v === "actual" ? "Actual demand" : "AI forecast")}
        />
        <Bar dataKey="actual" fill="#B3C0D9" radius={[4, 4, 0, 0]} barSize={28} />
        <Line
          type="monotone"
          dataKey="forecast"
          stroke="#0E8C82"
          strokeWidth={2.5}
          strokeDasharray="5 3"
          dot={{ r: 3, fill: "#0E8C82", strokeWidth: 0 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
