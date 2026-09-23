import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import "./CategoryDonutChart.css";

// The backend returns one row per medicine category, which can be a long list.
// Drawing every row makes the legend taller than the card and forces the page
// to scroll, so we keep only the largest slices and fold the rest into
// "Others". Exported so the grouping can be unit-tested.
const MAX_SLICES = 4;
const OTHERS_COLOR = "#B3C0D9"; // --navy-200

export function sliceTopCategories(data, maxSlices = MAX_SLICES) {
  if (!Array.isArray(data) || data.length === 0) return [];

  const sorted = [...data].sort((a, b) => Number(b.value) - Number(a.value));

  if (sorted.length <= maxSlices) return sorted;

  const top = sorted.slice(0, maxSlices);
  const rest = sorted.slice(maxSlices);
  const othersValue = rest.reduce((sum, item) => sum + (Number(item.value) || 0), 0);

  // Only add the bucket when it would actually hold something — otherwise a
  // 0% "Others" slice would draw a stray sliver and a pointless legend row.
  if (othersValue > 0) {
    top.push({
      name: `Others (${rest.length})`,
      value: othersValue,
      color: OTHERS_COLOR,
      isOthers: true,
    });
  }

  return top;
}

export default function CategoryDonutChart({ data, maxSlices = MAX_SLICES }) {
  const slices = sliceTopCategories(data, maxSlices);

  if (slices.length === 0) {
    return <p className="donut-empty">No category data yet.</p>;
  }

  return (
    <div className="donut-wrap">
      <div className="donut-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius={38}
              outerRadius={62}
              paddingAngle={3}
              strokeWidth={0}
            >
              {slices.map((entry, i) => (
                <Cell key={entry.name || i} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="donut-legend">
        {slices.map((item) => (
          <div key={item.name} className="donut-legend-row">
            <span className="donut-legend-dot" style={{ background: item.color }} />
            <span className="donut-legend-name">{item.name}</span>
            <span className="donut-legend-value">{item.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}