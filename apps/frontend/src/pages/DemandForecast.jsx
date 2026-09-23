import { useCallback, useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { api } from "../services/api";
import { aiService } from "../services/aiService";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import Skeleton from "../components/ui/Skeleton";
import DemandForecastChart from "../components/charts/DemandForecastChart";
import AIInsightPanel from "../components/ai/AIInsightPanel";
import "./DemandForecast.css";

export default function DemandForecast() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.getDemandForecast().then(setData);
  }, []);

  const fetcher = useCallback(() => aiService.getForecastInsight(), []);

  return (
    <div>
      <PageHeader
        title="Demand Forecast"
        subtitle="Historical demand versus projected need for the coming months."
      />

      <div className="forecast-grid">
        <Card className="forecast-chart-card">
          <div className="forecast-chart-head">
            <TrendingUp size={16} color="#0B7269" />
            <h3 className="forecast-chart-title">Actual vs. Forecast Demand</h3>
          </div>
          {data ? (
            <DemandForecastChart data={data} />
          ) : (
            <Skeleton style={{ height: 300, width: "100%", marginTop: "0.5rem" }} />
          )}
        </Card>

        <div className="forecast-side">
          <AIInsightPanel title="Forecast Insight" fetcher={fetcher} />
          <Card className="forecast-info-card">
            <h3 className="forecast-info-title">How forecasting will work</h3>
            <ul className="forecast-info-list">
              <li className="forecast-info-item">
                <span className="forecast-info-dot" />
                Learns from past consumption and exchange history per medicine.
              </li>
              <li className="forecast-info-item">
                <span className="forecast-info-dot" />
                Flags predicted shortages before stock actually runs low.
              </li>
              <li className="forecast-info-item">
                <span className="forecast-info-dot" />
                Suggests which partner hospitals to request from first.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
