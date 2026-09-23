from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_batch_forecast_returns_non_negative_predictions():
    pytest.importorskip("xgboost")
    from app.services.forecast_services import batch_forecast

    features_path = ROOT / "data" / "processed" / "demand_features.csv"
    if not features_path.exists():
        pytest.skip("Generated demand features are not available")

    frame = pd.read_csv(features_path).head(3)
    predicted = batch_forecast(frame)
    assert len(predicted) == len(frame)
    assert "predicted_demand" in predicted
    assert (predicted["predicted_demand"] >= 0).all()


def test_next_week_forecast_is_genuinely_future():
    pytest.importorskip("xgboost")
    from app.services.forecast_services import next_week_forecast

    partition = ROOT / "data" / "processed" / "by_hospital" / "HOSP-BG-001.csv"
    if not partition.exists():
        pytest.skip("Generated per-hospital serving features are not available")

    history = pd.read_csv(partition, parse_dates=["week_start"])
    future = next_week_forecast(history)
    assert len(future) == history["medicine_id"].nunique()
    assert future["week_start"].min() > history["week_start"].max()
    assert future["target_demand"].isna().all()
    assert (future["predicted_demand"] >= 0).all()
