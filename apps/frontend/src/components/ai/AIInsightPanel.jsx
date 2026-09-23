import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import Card from "../ui/Card";
import "./AIInsightPanel.css";

const numberFormatter = new Intl.NumberFormat("en-US");

export default function AIInsightPanel({ title = "AI Insight", fetcher }) {
  const [insight, setInsight] = useState(null);

  useEffect(() => {
    let mounted = true;
    fetcher().then((res) => mounted && setInsight(res));
    return () => {
      mounted = false;
    };
  }, [fetcher]);

  const rows = Array.isArray(insight?.items) ? insight.items : [];
  const hasRows = rows.length > 0;

  return (
    <Card className="ai-panel">
      <div className="ai-panel-head">
        <div className="ai-panel-icon-wrap">
          <Sparkles size={14} color="#57BDAF" />
        </div>
        <span className="ai-panel-title">{title}</span>
        {insight && !insight.available && <span className="ai-panel-badge">Coming soon</span>}
      </div>

      {!insight ? (
        <p className="ai-panel-message">Checking for insights…</p>
      ) : hasRows ? (
        <div className="ai-panel-structured">
          <p className="ai-panel-headline">{insight.headline}</p>
          {insight.subhead && <p className="ai-panel-subhead">{insight.subhead}</p>}

          <ul className="ai-panel-list">
            {rows.map((row, index) => (
              <li className="ai-panel-row" key={`${row.name}-${index}`}>
                <span className="ai-panel-rank">{row.rank ?? index + 1}</span>
                <span className="ai-panel-row-name">
                  {row.name}
                  {row.category && <span className="ai-panel-row-cat">{row.category}</span>}
                </span>
                {row.demand != null && (
                  <span className="ai-panel-row-value">
                    {numberFormatter.format(Number(row.demand))}
                    <span className="ai-panel-row-unit">units</span>
                  </span>
                )}
              </li>
            ))}
          </ul>

          {insight.meta && <p className="ai-panel-meta">{insight.meta}</p>}
        </div>
      ) : (
        <p className="ai-panel-message">{insight.message}</p>
      )}
    </Card>
  );
}