"""MedBridge demand forecasting service.

Loads the audited XGBoost bundle, encodes raw feature rows, and constructs
real future feature rows from historical demand. Future forecasts never reuse
the target value from the week being predicted.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = ROOT / "artifacts" / "models" / "xgb_demand_model.joblib"
ENC_PATH = ROOT / "artifacts" / "encoders" / "label_encoders.joblib"

LAGS = (1, 2, 3, 4, 8, 12)
ROLLING_WINDOWS = (2, 4, 8, 12)


@lru_cache(maxsize=1)
def load_bundle() -> dict[str, Any]:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Model not found at {MODEL_PATH}. Run: python3 training/train_xgb.py"
        )
    if not ENC_PATH.exists():
        raise FileNotFoundError(
            f"Encoders not found at {ENC_PATH}. Run: python3 training/train_xgb.py"
        )
    bundle = joblib.load(MODEL_PATH)
    bundle["encoders"] = joblib.load(ENC_PATH)
    return bundle


def clear_model_cache() -> None:
    """Call after retraining when model serving and training share a process."""
    load_bundle.cache_clear()


def _encode_frame(df: pd.DataFrame, encoders: dict) -> pd.DataFrame:
    out = df.copy()
    for column, encoder in encoders.items():
        if column not in out.columns:
            continue
        known = set(encoder.classes_)
        fallback = encoder.classes_[0]
        values = out[column].fillna("UNKNOWN").astype(str)
        values = values.map(lambda value: value if value in known else fallback)
        out[column] = encoder.transform(values)
    return out


def predict_demand(features: pd.DataFrame) -> np.ndarray:
    """Predict non-negative weekly units from raw or encoded feature rows."""
    bundle = load_bundle()
    model = bundle["model"]
    columns = bundle["feature_columns"]
    encoders = bundle["encoders"]

    frame = _encode_frame(features, encoders)
    for column in columns:
        if column not in frame.columns:
            frame[column] = 0
        frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(0)
    prediction = np.expm1(model.predict(frame[columns]))
    return np.maximum(0, prediction)


def forecast_from_history_row(history_features_row: dict[str, Any] | pd.Series) -> float:
    return float(predict_demand(pd.DataFrame([dict(history_features_row)]))[0])


def batch_forecast(feature_df: pd.DataFrame) -> pd.DataFrame:
    """Backtest supplied rows by attaching `predicted_demand`."""
    out = feature_df.copy()
    out["predicted_demand"] = np.round(predict_demand(out), 2)
    return out


def _update_calendar(row: pd.Series, forecast_week: pd.Timestamp) -> None:
    row["week_start"] = forecast_week
    row["year"] = forecast_week.year
    row["month"] = forecast_week.month
    row["week_of_year"] = int(forecast_week.isocalendar().week)
    row["quarter"] = forecast_week.quarter
    row["is_monsoon"] = int(forecast_week.month in (6, 7, 8, 9))
    row["is_winter"] = int(forecast_week.month in (12, 1, 2))
    row["month_sin"] = np.sin(2 * np.pi * forecast_week.month / 12)
    row["month_cos"] = np.cos(2 * np.pi * forecast_week.month / 12)
    row["week_sin"] = np.sin(2 * np.pi * int(forecast_week.isocalendar().week) / 52)
    row["week_cos"] = np.cos(2 * np.pi * int(forecast_week.isocalendar().week) / 52)


def build_next_week_features(history: pd.DataFrame) -> pd.DataFrame:
    """Construct one feature row per hospital/medicine for the next week.

    `history` must contain past `target_demand` rows. For forecast week t, all
    lag, rolling, difference, and EWM values are calculated only from demand
    observed through t-1.
    """
    required = {"week_start", "hospital_id", "medicine_id", "target_demand"}
    missing = required.difference(history.columns)
    if missing:
        raise ValueError(f"History is missing required columns: {sorted(missing)}")

    frame = history.copy()
    frame["week_start"] = pd.to_datetime(frame["week_start"])
    frame = frame.sort_values(["hospital_id", "medicine_id", "week_start"])
    rows = []

    for _, group in frame.groupby(["hospital_id", "medicine_id"], observed=True, sort=False):
        group = group.sort_values("week_start")
        values = group["target_demand"].fillna(0).astype(float).to_numpy()
        if not len(values):
            continue

        row = group.iloc[-1].copy()
        forecast_week = pd.Timestamp(group["week_start"].iloc[-1]) + pd.Timedelta(weeks=1)
        _update_calendar(row, forecast_week)

        for lag in LAGS:
            row[f"lag_{lag}w"] = values[-lag] if len(values) >= lag else 0.0
        for window in ROLLING_WINDOWS:
            recent = values[-window:]
            row[f"roll_mean_{window}w"] = float(np.mean(recent)) if len(recent) else 0.0
            row[f"roll_std_{window}w"] = float(np.std(recent, ddof=1)) if len(recent) > 1 else 0.0

        recent_four = values[-4:]
        row["roll_min_4w"] = float(np.min(recent_four)) if len(recent_four) else 0.0
        row["roll_max_4w"] = float(np.max(recent_four)) if len(recent_four) else 0.0
        row["diff_1w"] = float(values[-1] - values[-2]) if len(values) >= 2 else 0.0
        row["diff_4w"] = float(values[-1] - values[-5]) if len(values) >= 5 else 0.0
        row["ewm_4w"] = float(pd.Series(values).ewm(span=4, adjust=False).mean().iloc[-1])
        row["ewm_12w"] = float(pd.Series(values).ewm(span=12, adjust=False).mean().iloc[-1])

        # These features are already lagged in the training table. Until the
        # raw current-week event flags are persisted separately, carrying the
        # latest known lagged state is safer than inventing an event.
        row["emergency_last_4w"] = int(row.get("emergency_last_4w", 0) or 0)
        row["exchange_in_last_4w"] = int(row.get("exchange_in_last_4w", 0) or 0)
        row["target_demand"] = np.nan
        rows.append(row)

    if not rows:
        return pd.DataFrame(columns=history.columns)
    return pd.DataFrame(rows).reset_index(drop=True)


def next_week_forecast(history: pd.DataFrame) -> pd.DataFrame:
    """Forecast the first genuinely future week after `history`."""
    future = build_next_week_features(history)
    future["predicted_demand"] = np.round(predict_demand(future), 2)
    return future


def recursive_forecast(history: pd.DataFrame, periods: int = 8) -> pd.DataFrame:
    """Generate multi-week forecasts recursively.

    After the first future week, each prediction is fed back only as a lag for
    the next horizon. Returned rows are clearly future rows and do not contain
    an observed target.
    """
    if periods < 1:
        return pd.DataFrame()

    working = history.copy()
    working["week_start"] = pd.to_datetime(working["week_start"])
    outputs = []

    for horizon in range(1, periods + 1):
        future = build_next_week_features(working)
        prediction = np.round(predict_demand(future), 2)
        future["predicted_demand"] = prediction
        future["horizon_week"] = horizon
        outputs.append(future.copy())

        feedback = future.drop(columns=["predicted_demand", "horizon_week"]).copy()
        feedback["target_demand"] = prediction
        working = pd.concat([working, feedback], ignore_index=True)

    return pd.concat(outputs, ignore_index=True)
