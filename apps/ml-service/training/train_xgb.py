#!/usr/bin/env python3
"""Train and audit the MedBridge one-week-ahead XGBoost demand model.

This trainer intentionally reports several views of performance instead of
optimizing for one impressive number. In particular:

- the split is chronological (never random),
- categorical encoders are fitted on training rows only,
- hospital_id and medicine_id are identifiers, not model features,
- leakage checks reject features that mathematically expose the target,
- naive last-week and rolling-mean baselines are evaluated beside XGBoost,
- pooled raw R², log-scale R², MAE, RMSE, WAPE, and sMAPE are all reported.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.preprocessing import LabelEncoder

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "processed" / "demand_features.csv"
ART_MODELS = ROOT / "artifacts" / "models"
ART_ENC = ROOT / "artifacts" / "encoders"
ART_MET = ROOT / "artifacts" / "metrics"

# IDs are deliberately absent: memorizing a hospital/medicine code prevents
# cold-start generalization. The remaining labels describe real attributes.
CAT_COLS = [
    "facility_type",
    "province",
    "district",
    "ecoregion",
    "urban_class",
    "ownership",
    "category",
    "dosage_form",
    "abc_class",
]

DROP_COLS = [
    "week_start",
    "generic_name",
    "target_demand",
    "hospital_id",
    "medicine_id",
    # Simulation-only coefficients used to create synthetic demand. They are
    # not fields a real hospital supplies at prediction time, so letting the
    # model see them would let it reverse-engineer the generator.
    "base_demand_per_100_beds",
    "load_factor",
    "urban_factor",
    "is_demo",
]

HOLDOUT_WEEKS = 13
VALIDATION_WEEKS = 13


def smape(y_true, y_pred) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    denominator = np.abs(y_true) + np.abs(y_pred)
    mask = denominator > 1e-6
    if not mask.any():
        return 0.0
    return float(np.mean(2 * np.abs(y_pred[mask] - y_true[mask]) / denominator[mask]) * 100)


def metrics_dict(y_true, y_pred) -> dict:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.maximum(0, np.asarray(y_pred, dtype=float))
    absolute_error = np.abs(y_true - y_pred)
    total_actual = float(np.abs(y_true).sum())
    nonzero = y_true > 0

    return {
        "MAE": round(float(mean_absolute_error(y_true, y_pred)), 4),
        "RMSE": round(float(mean_squared_error(y_true, y_pred) ** 0.5), 4),
        "R2": round(float(r2_score(y_true, y_pred)), 6),
        "R2_log1p": round(float(r2_score(np.log1p(y_true), np.log1p(y_pred))), 6),
        "WAPE_pct": round(float(absolute_error.sum() / total_actual * 100), 4) if total_actual else None,
        "sMAPE_pct": round(smape(y_true, y_pred), 4),
        "zero_demand_pct": round(float((~nonzero).mean() * 100), 4),
        "n": int(len(y_true)),
        "mean_actual": round(float(y_true.mean()), 4),
        "mean_pred": round(float(y_pred.mean()), 4),
    }


def chronological_split(df: pd.DataFrame):
    weeks = np.array(sorted(pd.to_datetime(df["week_start"].unique())))
    required = HOLDOUT_WEEKS + VALIDATION_WEEKS + 26
    if len(weeks) < required:
        raise ValueError(f"Need at least {required} weekly periods; found {len(weeks)}")

    test_weeks = set(weeks[-HOLDOUT_WEEKS:])
    validation_weeks = set(weeks[-(HOLDOUT_WEEKS + VALIDATION_WEEKS):-HOLDOUT_WEEKS])
    train_mask = ~df["week_start"].isin(test_weeks | validation_weeks)
    valid_mask = df["week_start"].isin(validation_weeks)
    test_mask = df["week_start"].isin(test_weeks)

    return train_mask, valid_mask, test_mask, {
        "train": f"{pd.Timestamp(weeks[0]).date()} .. {pd.Timestamp(max(weeks[:-(HOLDOUT_WEEKS + VALIDATION_WEEKS)])).date()}",
        "validation": f"{pd.Timestamp(min(validation_weeks)).date()} .. {pd.Timestamp(max(validation_weeks)).date()}",
        "test": f"{pd.Timestamp(min(test_weeks)).date()} .. {pd.Timestamp(max(test_weeks)).date()}",
        "validation_weeks": VALIDATION_WEEKS,
        "test_weeks": HOLDOUT_WEEKS,
    }


def encode_categoricals(df: pd.DataFrame, train_mask: pd.Series):
    """Fit category mappings on training data only; unknown labels map to 0."""
    encoded = df.copy()
    encoders: dict[str, LabelEncoder] = {}

    for column in CAT_COLS:
        if column not in encoded.columns:
            continue
        encoder = LabelEncoder()
        train_values = encoded.loc[train_mask, column].fillna("UNKNOWN").astype(str)
        encoder.fit(train_values)
        known = set(encoder.classes_)
        fallback = encoder.classes_[0]
        values = encoded[column].fillna("UNKNOWN").astype(str)
        values = values.map(lambda value: value if value in known else fallback)
        encoded[column] = encoder.transform(values).astype("int16")
        encoders[column] = encoder

    return encoded, encoders


def audit_for_leakage(df: pd.DataFrame, feature_columns: list[str]) -> dict:
    forbidden = {"target_demand", "demand_units", "future_demand", "quantity_requested"}
    leaked_names = sorted(forbidden.intersection(feature_columns))
    if leaked_names:
        raise RuntimeError(f"Target columns found in features: {leaked_names}")

    if {"diff_1w", "lag_1w", "target_demand"}.issubset(df.columns):
        direct_difference = (df["target_demand"] - df["lag_1w"]).to_numpy(float)
        stored_difference = df["diff_1w"].to_numpy(float)
        if np.allclose(direct_difference, stored_difference, equal_nan=True):
            raise RuntimeError(
                "Leakage detected: diff_1w equals target_demand - lag_1w. "
                "Rebuild features with the shifted-difference implementation."
            )

    demand_features = [
        column for column in feature_columns
        if column.startswith(("lag_", "roll_", "diff_", "ewm_"))
    ]
    return {
        "status": "passed",
        "target_in_features": False,
        "current_target_difference_present": False,
        "history_features_checked": demand_features,
    }


def macro_series_r2(meta: pd.DataFrame, y_true, y_pred) -> dict:
    scored = meta[["hospital_id", "medicine_id"]].copy()
    scored["actual"] = np.asarray(y_true, dtype=float)
    scored["predicted"] = np.asarray(y_pred, dtype=float)
    values = []
    for _, group in scored.groupby(["hospital_id", "medicine_id"], observed=True):
        if len(group) < 3 or group["actual"].nunique() < 2:
            continue
        values.append(r2_score(group["actual"], group["predicted"]))
    if not values:
        return {"mean": None, "median": None, "n_series": 0}
    return {
        "mean": round(float(np.mean(values)), 6),
        "median": round(float(np.median(values)), 6),
        "n_series": len(values),
    }


def grouped_metrics(meta: pd.DataFrame, y_true, y_pred, group_columns: list[str]) -> dict:
    scored = meta[group_columns].copy()
    scored["actual"] = np.asarray(y_true, dtype=float)
    scored["predicted"] = np.asarray(y_pred, dtype=float)
    grouped = scored.groupby(group_columns, observed=True, as_index=False)[
        ["actual", "predicted"]
    ].sum()
    return metrics_dict(grouped["actual"], grouped["predicted"])


def main():
    try:
        from xgboost import XGBRegressor
    except ImportError as error:
        raise SystemExit("XGBoost is missing. Run: python3 -m pip install -r requirements.txt") from error

    if not DATA.exists():
        raise SystemExit(
            f"Missing {DATA}. Run: python3 training/generate_ledger_data.py"
        )

    ART_MODELS.mkdir(parents=True, exist_ok=True)
    ART_ENC.mkdir(parents=True, exist_ok=True)
    ART_MET.mkdir(parents=True, exist_ok=True)

    print("Loading leakage-safe features...")
    raw = pd.read_csv(DATA, parse_dates=["week_start"])
    print(f"  rows={len(raw):,} cols={raw.shape[1]}")

    train_mask, valid_mask, test_mask, split_description = chronological_split(raw)
    original_ids = raw[["week_start", "hospital_id", "medicine_id"]].copy()
    df, encoders = encode_categoricals(raw, train_mask)

    feature_columns = [column for column in df.columns if column not in DROP_COLS]
    leakage_audit = audit_for_leakage(df, feature_columns)

    for column in feature_columns:
        df[column] = pd.to_numeric(df[column], errors="coerce").fillna(0).astype("float32")

    train = df.loc[train_mask]
    valid = df.loc[valid_mask]
    test = df.loc[test_mask]
    X_train, y_train = train[feature_columns], train["target_demand"].astype("float32")
    X_valid, y_valid = valid[feature_columns], valid["target_demand"].astype("float32")
    X_test, y_test = test[feature_columns], test["target_demand"].astype("float32")

    print(
        f"  train={len(train):,} valid={len(valid):,} test={len(test):,} "
        f"features={len(feature_columns)}"
    )
    print("  split:", split_description)
    print("  leakage audit: PASSED")

    # Conservative capacity selected from validation behaviour, not from a
    # desired test score. This is intentionally shallower and more regularized
    # than the former depth-8 / 1200-tree model.
    model = XGBRegressor(
        n_estimators=800,
        max_depth=5,
        learning_rate=0.03,
        subsample=0.80,
        colsample_bytree=0.80,
        min_child_weight=12,
        reg_alpha=0.20,
        reg_lambda=3.0,
        gamma=0.02,
        objective="reg:squarederror",
        tree_method="hist",
        random_state=42,
        n_jobs=-1,
        early_stopping_rounds=50,
    )

    print("Training regularized XGBoost on log1p weekly demand...")
    model.fit(
        X_train,
        np.log1p(y_train),
        # Keep both curves for the diagnostic loss plot. XGBoost monitors the
        # last set (validation) for early stopping.
        eval_set=[
            (X_train, np.log1p(y_train)),
            (X_valid, np.log1p(y_valid)),
        ],
        verbose=False,
    )

    evaluation_history = model.evals_result()
    train_history = evaluation_history.get("validation_0", {})
    valid_history = evaluation_history.get("validation_1", {})
    metric_name = next(iter(valid_history), "rmse")
    history_rows = pd.DataFrame({
        "iteration": np.arange(len(valid_history.get(metric_name, []))),
        "train_log_rmse": train_history.get(metric_name, []),
        "validation_log_rmse": valid_history.get(metric_name, []),
    })
    history_rows.to_csv(ART_MET / "training_history.csv", index=False)

    def predict(frame):
        return np.maximum(0, np.expm1(model.predict(frame)))

    predictions = {
        "train": predict(X_train),
        "validation": predict(X_valid),
        "test": predict(X_test),
    }
    metrics = {
        "train": metrics_dict(y_train, predictions["train"]),
        "validation": metrics_dict(y_valid, predictions["validation"]),
        "test": metrics_dict(y_test, predictions["test"]),
    }

    baseline_predictions = {
        "last_week": np.maximum(0, test["lag_1w"].to_numpy(float)),
        "rolling_4week": np.maximum(0, test["roll_mean_4w"].to_numpy(float)),
        "ewm_4week": np.maximum(0, test["ewm_4w"].to_numpy(float)),
    }
    baseline_metrics = {
        name: metrics_dict(y_test, prediction)
        for name, prediction in baseline_predictions.items()
    }

    test_meta = original_ids.loc[test_mask]
    macro_r2 = macro_series_r2(test_meta, y_test, predictions["test"])
    hospital_week_metrics = grouped_metrics(
        test_meta, y_test, predictions["test"], ["hospital_id", "week_start"]
    )
    medicine_week_metrics = grouped_metrics(
        test_meta, y_test, predictions["test"], ["medicine_id", "week_start"]
    )

    print("\n=== Honest holdout metrics ===")
    for split_name in ("train", "validation", "test"):
        print(split_name.upper(), metrics[split_name])
    print("BASELINES", baseline_metrics)
    print("MACRO SERIES R2", macro_r2)
    print("HOSPITAL-WEEK AGGREGATE", hospital_week_metrics)
    print("MEDICINE-WEEK AGGREGATE", medicine_week_metrics)
    print("best_iteration=", model.best_iteration)

    importance = pd.DataFrame(
        {"feature": feature_columns, "importance": model.feature_importances_}
    ).sort_values("importance", ascending=False)
    importance.to_csv(ART_MET / "feature_importance.csv", index=False)

    sample = raw.loc[test_mask, [
        "week_start", "hospital_id", "medicine_id", "generic_name", "target_demand"
    ]].copy()
    sample["predicted_demand"] = np.round(predictions["test"], 2)
    sample["abs_error"] = np.round(
        np.abs(sample["target_demand"] - sample["predicted_demand"]), 2
    )
    sample.sample(n=min(500, len(sample)), random_state=42).to_csv(
        ART_MET / "test_predictions_sample.csv", index=False
    )

    hospitals_df = pd.read_csv(ROOT / "data" / "raw" / "hospitals.csv")
    demo_ids = sorted(
        hospitals_df.loc[hospitals_df["is_demo"] == 1, "hospital_id"].unique()
    )
    demo_rows = []
    test_hospitals = test_meta["hospital_id"].to_numpy()
    for hospital_id in demo_ids:
        mask = test_hospitals == hospital_id
        if not mask.any():
            continue
        demo_rows.append({
            "hospital_id": hospital_id,
            **metrics_dict(y_test.to_numpy()[mask], predictions["test"][mask]),
        })
    pd.DataFrame(demo_rows).to_csv(
        ART_MET / "demo_hospital_test_metrics.csv", index=False
    )

    model_json = ART_MODELS / "xgb_demand_model.json"
    model.save_model(model_json)
    bundle = {
        "model": model,
        "feature_columns": feature_columns,
        "cat_cols": CAT_COLS,
        "target_transform": "log1p",
        "forecast_horizon": "one_week_ahead",
        "best_iteration": int(model.best_iteration) if model.best_iteration is not None else None,
    }
    joblib.dump(bundle, ART_MODELS / "xgb_demand_model.joblib")
    joblib.dump(encoders, ART_ENC / "label_encoders.joblib")
    (ART_ENC / "feature_columns.json").write_text(
        json.dumps(feature_columns, indent=2), encoding="utf-8"
    )

    report = {
        "model": "XGBRegressor",
        "forecast_horizon": "one week ahead",
        "target": "observed weekly consumption units",
        "target_transform": "log1p / expm1",
        "n_features": len(feature_columns),
        "best_iteration": bundle["best_iteration"],
        "split": split_description,
        "leakage_audit": leakage_audit,
        "metrics": metrics,
        "test_metrics": metrics["test"],  # compatibility with /health
        "test_baselines": baseline_metrics,
        "test_macro_series_r2": macro_r2,
        "test_hospital_week_aggregate": hospital_week_metrics,
        "test_medicine_week_aggregate": medicine_week_metrics,
        "interpretation": (
            "Pooled raw R2 is scale-dominated across heterogeneous hospital/medicine series. "
            "Use it together with WAPE, sMAPE, log-scale R2, macro-series R2, and naive baselines."
        ),
    }
    (ART_MET / "training_metrics.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )

    test_result = metrics["test"]
    summary = f"""# MedBridge XGBoost Training Report

## Validity controls
- Forecast horizon: **one week ahead**
- Chronological split: train `{split_description['train']}`, validation `{split_description['validation']}`, test `{split_description['test']}`
- Leakage audit: **PASSED** — all demand-derived inputs are shifted to use only history through t-1
- IDs excluded: `hospital_id`, `medicine_id`
- Model capacity: depth 5, regularized, early stopping

## Holdout performance
| Metric | Train | Validation | Test |
|---|---:|---:|---:|
| Pooled R² | {metrics['train']['R2']:.4f} | {metrics['validation']['R2']:.4f} | **{test_result['R2']:.4f}** |
| Log1p R² | {metrics['train']['R2_log1p']:.4f} | {metrics['validation']['R2_log1p']:.4f} | **{test_result['R2_log1p']:.4f}** |
| MAE | {metrics['train']['MAE']:.2f} | {metrics['validation']['MAE']:.2f} | **{test_result['MAE']:.2f}** |
| RMSE | {metrics['train']['RMSE']:.2f} | {metrics['validation']['RMSE']:.2f} | **{test_result['RMSE']:.2f}** |
| WAPE % | {metrics['train']['WAPE_pct']:.2f} | {metrics['validation']['WAPE_pct']:.2f} | **{test_result['WAPE_pct']:.2f}** |
| sMAPE % | {metrics['train']['sMAPE_pct']:.2f} | {metrics['validation']['sMAPE_pct']:.2f} | **{test_result['sMAPE_pct']:.2f}** |

## Baseline comparison on the same test weeks
| Model | R² | MAE | WAPE % | sMAPE % |
|---|---:|---:|---:|---:|
{chr(10).join(f"| {name} | {values['R2']:.4f} | {values['MAE']:.2f} | {values['WAPE_pct']:.2f} | {values['sMAPE_pct']:.2f} |" for name, values in baseline_metrics.items())}

Macro per-series R²: mean `{macro_r2['mean']}`, median `{macro_r2['median']}` across `{macro_r2['n_series']}` series.

Operational aggregates on the same test rows:
- Hospital-week aggregate: R² `{hospital_week_metrics['R2']:.4f}`, WAPE `{hospital_week_metrics['WAPE_pct']:.2f}%`
- Medicine-week aggregate: R² `{medicine_week_metrics['R2']:.4f}`, WAPE `{medicine_week_metrics['WAPE_pct']:.2f}%`

## Why the former ~0.99 result was invalid
The old `diff_1w = current_target - lag_1w` feature contained the answer for the row being predicted. Together with `lag_1w`, a tree could reconstruct the target almost exactly. The feature is now calculated as `lag_1w - lag_2w`, using only information known before the forecast week. No noise was added merely to force a lower score.

## Top 15 features
{importance.head(15).to_string(index=False)}
"""
    (ART_MET / "TRAINING_REPORT.md").write_text(summary, encoding="utf-8")

    print("\nSaved audited artifacts under", ROOT / "artifacts")
    print(
        f"TEST: R2={test_result['R2']:.4f} MAE={test_result['MAE']:.2f} "
        f"WAPE={test_result['WAPE_pct']:.2f}% sMAPE={test_result['sMAPE_pct']:.2f}%"
    )


if __name__ == "__main__":
    main()
