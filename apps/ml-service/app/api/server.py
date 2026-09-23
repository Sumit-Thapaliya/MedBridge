"""
MedBridge ML HTTP API (FastAPI).

Run from apps/ml-service:
  uvicorn app.api.server:app --host 0.0.0.0 --port 8000 --reload

Backend (Node) calls these endpoints for forecast / expiry / exchange.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.exchange_services import demo_exchange_plan, suggest_matches
from app.services.forecast_services import (
    batch_forecast,
    load_bundle,
    next_week_forecast,
    recursive_forecast,
)
from app.services.inventory_services import (
    expiry_alerts,
    hospital_inventory_summary,
    low_stock_alerts,
    load_hospitals,
    load_medicines,
)

RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
ART = ROOT / "artifacts"

app = FastAPI(
    title="MedBridge ML Service",
    description="XGBoost demand forecasting + inventory/exchange helpers",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_features() -> Path:
    path = PROC / "demand_features.csv"
    if not path.exists() or path.stat().st_size == 0:
        raise HTTPException(
            status_code=503,
            detail="demand_features.csv missing. Run: python3 training/generate_ledger_data.py",
        )
    return path


def _hospital_partition_path(hospital_id: str) -> Path:
    safe_id = "".join(
        character if character.isalnum() or character in ("-", "_") else "_"
        for character in str(hospital_id)
    )
    return PROC / "by_hospital" / f"{safe_id}.csv"


def _load_hospital_features(hospital_id: str) -> pd.DataFrame:
    """Load a small serving partition; fall back to the full training table."""
    partition = _hospital_partition_path(hospital_id)
    if partition.exists() and partition.stat().st_size > 0:
        return pd.read_csv(partition, parse_dates=["week_start"])

    feature_path = _require_features()
    all_features = pd.read_csv(feature_path, parse_dates=["week_start"])
    return all_features[all_features["hospital_id"] == hospital_id].copy()


def _require_model() -> None:
    model = ART / "models" / "xgb_demand_model.joblib"
    enc = ART / "encoders" / "label_encoders.joblib"
    if not model.exists() or model.stat().st_size == 0:
        raise HTTPException(
            status_code=503,
            detail="Model missing. Run: python training/train_xgb.py",
        )
    if not enc.exists() or enc.stat().st_size == 0:
        raise HTTPException(
            status_code=503,
            detail="Encoders missing. Run: python training/train_xgb.py",
        )


def _df_records(df: pd.DataFrame, limit: Optional[int] = None) -> list[dict[str, Any]]:
    if df is None or len(df) == 0:
        return []
    out = df.copy()
    if limit is not None:
        out = out.head(limit)
    # JSON-safe
    for c in out.columns:
        if pd.api.types.is_datetime64_any_dtype(out[c]):
            out[c] = out[c].astype(str)
    out = out.replace({np.nan: None})
    return out.to_dict(orient="records")


@app.get("/health")
def health() -> dict[str, Any]:
    model_ok = (ART / "models" / "xgb_demand_model.joblib").exists() and (
        ART / "models" / "xgb_demand_model.joblib"
    ).stat().st_size > 0
    feats_ok = (PROC / "demand_features.csv").exists() and (
        PROC / "demand_features.csv"
    ).stat().st_size > 0
    metrics_path = ART / "metrics" / "training_metrics.json"
    metrics = None
    if metrics_path.exists() and metrics_path.stat().st_size > 0:
        try:
            metrics = json.loads(metrics_path.read_text(encoding="utf-8")).get("test_metrics")
        except Exception:
            metrics = None
    return {
        "status": "ok" if model_ok and feats_ok else "degraded",
        "model_loaded": model_ok,
        "features_ready": feats_ok,
        "test_metrics": metrics,
        "service": "medbridge-ml",
    }


@app.get("/metrics")
def metrics() -> dict[str, Any]:
    path = ART / "metrics" / "training_metrics.json"
    if not path.exists() or path.stat().st_size == 0:
        raise HTTPException(status_code=404, detail="training_metrics.json not found")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/hospitals")
def hospitals(demo_only: bool = Query(False)) -> dict[str, Any]:
    df = load_hospitals()
    if demo_only and "is_demo" in df.columns:
        df = df[df["is_demo"] == 1]
    return {"count": len(df), "items": _df_records(df)}


@app.get("/medicines")
def medicines() -> dict[str, Any]:
    df = load_medicines()
    return {"count": len(df), "items": _df_records(df)}


@app.get("/forecast")
def forecast(
    hospital_id: str = Query(..., description="e.g. HOSP-BG-003"),
    top: int = Query(50, ge=1, le=500),
    week: Optional[str] = Query(
        None,
        description="Historical YYYY-MM-DD for a backtest; omit for the next future week",
    ),
) -> dict[str, Any]:
    """Medicine-level one-week-ahead demand forecast for one hospital."""
    _require_model()
    history = _load_hospital_features(hospital_id)
    if history.empty:
        raise HTTPException(status_code=404, detail=f"No feature rows for hospital_id={hospital_id}")

    last_observed = pd.Timestamp(history["week_start"].max())
    is_future = week is None

    try:
        if is_future:
            predicted = next_week_forecast(history)
            forecast_week = pd.Timestamp(predicted["week_start"].iloc[0])
        else:
            requested_week = pd.Timestamp(week)
            rows = history[history["week_start"] == requested_week].copy()
            if rows.empty:
                raise HTTPException(
                    status_code=404,
                    detail=f"No historical feature rows for hospital_id={hospital_id}, week={week}",
                )
            predicted = batch_forecast(rows)
            forecast_week = requested_week
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {error}") from error

    predicted = predicted.sort_values("predicted_demand", ascending=False).head(top)
    columns = [
        column
        for column in [
            "hospital_id",
            "medicine_id",
            "generic_name",
            "category",
            "facility_type",
            "week_start",
            "target_demand",
            "predicted_demand",
        ]
        if column in predicted.columns
    ]
    items = _df_records(predicted[columns])

    slice_mae = None
    if not is_future and "target_demand" in predicted.columns:
        actual = predicted["target_demand"].to_numpy(float)
        estimate = predicted["predicted_demand"].to_numpy(float)
        slice_mae = round(float(np.mean(np.abs(actual - estimate))), 4)

    return {
        "hospital_id": hospital_id,
        "week_start": str(forecast_week.date()),
        "last_observed_week": str(last_observed.date()),
        "forecast_type": "future" if is_future else "historical_backtest",
        "model": "XGBoostRegressor",
        "n_items": len(items),
        "slice_mae": slice_mae,
        "items": items,
    }

@app.get("/forecast/chart")
def forecast_chart(
    hospital_id: str = Query(...),
    months: int = Query(6, ge=3, le=12),
) -> dict[str, Any]:
    """Return historical backtests plus eight weeks of genuine future forecasts."""
    _require_model()
    history = _load_hospital_features(hospital_id)
    if history.empty:
        raise HTTPException(status_code=404, detail=f"No data for {hospital_id}")

    last_observed = pd.Timestamp(history["week_start"].max())
    first_history_month = (last_observed.to_period("M") - (months - 1)).start_time
    recent = history[history["week_start"] >= first_history_month].copy()

    try:
        historical_prediction = batch_forecast(recent)
        future_prediction = recursive_forecast(history, periods=8)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {error}") from error

    historical_prediction["monthKey"] = (
        historical_prediction["week_start"].dt.to_period("M").astype(str)
    )
    historical_monthly = historical_prediction.groupby("monthKey", as_index=False).agg(
        actual=("target_demand", "sum"),
        forecast=("predicted_demand", "sum"),
    )

    future_prediction["week_start"] = pd.to_datetime(future_prediction["week_start"])
    future_prediction["monthKey"] = future_prediction["week_start"].dt.to_period("M").astype(str)
    future_monthly = future_prediction.groupby("monthKey", as_index=False).agg(
        forecast=("predicted_demand", "sum")
    )

    series = []
    for row in historical_monthly.itertuples():
        period = pd.Period(row.monthKey, freq="M")
        series.append({
            "month": period.strftime("%b"),
            "monthKey": row.monthKey,
            "actual": int(round(float(row.actual))),
            "forecast": int(round(float(row.forecast))),
            "kind": "historical_backtest",
        })
    for row in future_monthly.itertuples():
        period = pd.Period(row.monthKey, freq="M")
        series.append({
            "month": period.strftime("%b"),
            "monthKey": row.monthKey,
            "actual": None,
            "forecast": int(round(float(row.forecast))),
            "kind": "future_forecast",
        })

    detail = forecast(hospital_id=hospital_id, top=15, week=None)
    return {
        "hospital_id": hospital_id,
        "model": "XGBoostRegressor",
        "forecast_horizon_weeks": 8,
        "last_observed_week": str(last_observed.date()),
        "series": series,
        "topMedicines": detail["items"],
        "week_start": detail["week_start"],
        "available": True,
        "message": "Leakage-audited one-week model with recursive eight-week forecast",
    }

@app.get("/expiry")
def expiry(
    hospital_id: Optional[str] = None,
    days: int = Query(90, ge=1, le=365),
    limit: int = Query(100, ge=1, le=1000),
) -> dict[str, Any]:
    try:
        df = expiry_alerts(within_days=days, hospital_id=hospital_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return {"count": len(df), "items": _df_records(df, limit)}


@app.get("/low-stock")
def low_stock(
    hospital_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
) -> dict[str, Any]:
    try:
        df = low_stock_alerts(hospital_id=hospital_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return {"count": len(df), "items": _df_records(df, limit)}


@app.get("/inventory/summary")
def inventory_summary(hospital_id: str = Query(...)) -> dict[str, Any]:
    try:
        return hospital_inventory_summary(hospital_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.get("/exchange/suggest")
def exchange_suggest(
    hospital_id: Optional[str] = None,
    medicine_id: Optional[str] = None,
    demo_only: bool = Query(True),
    top_k: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    try:
        if demo_only and not hospital_id and not medicine_id:
            df = demo_exchange_plan(top_k=top_k)
        else:
            df = suggest_matches(
                requesting_hospital_id=hospital_id,
                medicine_id=medicine_id,
                demo_only=demo_only,
                top_k=top_k,
            )
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return {
        "available": True,
        "count": 0 if df is None else len(df),
        "items": _df_records(df) if df is not None else [],
        "message": "Smart match based on surplus, shortage, distance, and near-expiry",
    }


from pydantic import BaseModel
from app.services.seed_service import seed_hospital_history


class HospitalOnboardRequest(BaseModel):
    hospital_id: str
    facility_type: str
    province: str
    district: str
    bed_capacity: int
    weeks_of_history: int = 26


@app.post("/onboarding/seed-history")
def onboarding_seed_history(payload: HospitalOnboardRequest):
    result = seed_hospital_history(
        payload.model_dump(exclude={"weeks_of_history"}),
        weeks_of_history=payload.weeks_of_history,
    )
    return result

@app.on_event("startup")
def _warmup() -> None:
    # Best-effort model load so first request is fast
    try:
        if (ART / "models" / "xgb_demand_model.joblib").exists():
            load_bundle()
            print("XGBoost model warmed up")
    except Exception as e:
        print("Model warmup skipped:", e)


# Optional: allow `python -m app.api.server`
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.api.server:app", host="0.0.0.0", port=8000, reload=False)