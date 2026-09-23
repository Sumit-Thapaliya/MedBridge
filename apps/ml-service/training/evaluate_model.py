#!/usr/bin/env python3
"""Create a complete regression evaluation pack for the MedBridge model.

Run after train_xgb.py:
    python3 training/evaluate_model.py

Optional faster run without refitting diagnostic learning-curve models:
    python3 training/evaluate_model.py --skip-learning-curve

ROC, precision-recall, confusion-matrix, and probability-calibration charts
are intentionally not produced: the deployed XGBoost task is regression, not
classification. See the generated README for when those charts would be valid.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor

from app.services.forecast_services import _encode_frame, predict_demand
from training.train_xgb import (
    chronological_split,
    metrics_dict,
)

FEATURES_PATH = ROOT / "data" / "processed" / "demand_features.csv"
MODEL_PATH = ROOT / "artifacts" / "models" / "xgb_demand_model.joblib"
ENCODERS_PATH = ROOT / "artifacts" / "encoders" / "label_encoders.joblib"
METRICS_PATH = ROOT / "artifacts" / "metrics" / "training_metrics.json"
TRAINING_HISTORY_PATH = ROOT / "artifacts" / "metrics" / "training_history.csv"
OUTPUT = ROOT / "artifacts" / "metrics" / "evaluation"

COLORS = {
    "navy": "#233A5C",
    "teal": "#0E8C82",
    "amber": "#E8A23D",
    "coral": "#D96C5F",
    "grey": "#8A94A3",
    "light": "#E4E9EE",
}


def save_figure(fig: plt.Figure, name: str) -> None:
    fig.tight_layout()
    fig.savefig(OUTPUT / name, dpi=180, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def sampled(frame: pd.DataFrame, n: int = 50_000) -> pd.DataFrame:
    if len(frame) <= n:
        return frame
    return frame.sample(n=n, random_state=42)


def actual_vs_predicted(scored: pd.DataFrame) -> None:
    data = sampled(scored)
    fig, axes = plt.subplots(1, 2, figsize=(13, 5.2))

    maximum = float(max(data["actual"].max(), data["predicted"].max()))
    axes[0].hexbin(
        data["actual"], data["predicted"], gridsize=55,
        mincnt=1, cmap="viridis", bins="log",
    )
    axes[0].plot([0, maximum], [0, maximum], "--", color=COLORS["coral"], label="Ideal")
    axes[0].set(xlabel="Actual weekly units", ylabel="Predicted weekly units", title="Actual vs predicted (linear)")
    axes[0].legend()

    axes[1].hexbin(
        np.log1p(data["actual"]), np.log1p(data["predicted"]),
        gridsize=55, mincnt=1, cmap="viridis", bins="log",
    )
    log_max = float(max(np.log1p(data["actual"]).max(), np.log1p(data["predicted"]).max()))
    axes[1].plot([0, log_max], [0, log_max], "--", color=COLORS["coral"], label="Ideal")
    axes[1].set(xlabel="log1p(actual)", ylabel="log1p(predicted)", title="Actual vs predicted (log scale)")
    axes[1].legend()
    save_figure(fig, "01_actual_vs_predicted.png")


def residual_diagnostics(scored: pd.DataFrame) -> None:
    data = sampled(scored)
    residual = data["actual"] - data["predicted"]
    fig, axes = plt.subplots(1, 3, figsize=(16, 4.8))

    axes[0].scatter(data["predicted"], residual, s=5, alpha=0.16, color=COLORS["teal"])
    axes[0].axhline(0, linestyle="--", color=COLORS["coral"])
    axes[0].set(xlabel="Predicted weekly units", ylabel="Residual (actual - predicted)", title="Residuals vs predictions")

    clip = residual.clip(residual.quantile(0.01), residual.quantile(0.99))
    axes[1].hist(clip, bins=60, color=COLORS["navy"], alpha=0.85)
    axes[1].axvline(0, linestyle="--", color=COLORS["coral"])
    axes[1].set(xlabel="Residual (1st–99th percentile)", ylabel="Count", title="Residual distribution")

    stats.probplot(clip.to_numpy(), dist="norm", plot=axes[2])
    axes[2].set_title("Residual Q-Q plot")
    save_figure(fig, "02_residual_diagnostics.png")


def weekly_backtest(scored: pd.DataFrame) -> None:
    weekly = scored.groupby("week_start", as_index=False)[["actual", "predicted"]].sum()
    fig, ax = plt.subplots(figsize=(11, 5))
    ax.plot(weekly["week_start"], weekly["actual"], marker="o", color=COLORS["navy"], label="Actual")
    ax.plot(weekly["week_start"], weekly["predicted"], marker="o", color=COLORS["teal"], label="Predicted")
    ax.set(xlabel="Untouched test week", ylabel="Total units", title="Chronological holdout: weekly actual vs predicted")
    ax.legend()
    ax.grid(alpha=0.2)
    save_figure(fig, "03_weekly_backtest.png")
    weekly.to_csv(OUTPUT / "weekly_backtest.csv", index=False)


def regression_calibration(scored: pd.DataFrame) -> None:
    work = scored.copy()
    # Duplicate predictions can make qcut return fewer than ten bins.
    work["prediction_bin"] = pd.qcut(work["predicted"], q=10, duplicates="drop")
    calibration = work.groupby("prediction_bin", observed=True).agg(
        mean_predicted=("predicted", "mean"),
        mean_actual=("actual", "mean"),
        count=("actual", "size"),
    ).reset_index(drop=True)

    fig, ax = plt.subplots(figsize=(6.5, 5.5))
    limit = float(max(calibration["mean_actual"].max(), calibration["mean_predicted"].max()))
    ax.plot([0, limit], [0, limit], "--", color=COLORS["coral"], label="Ideal")
    ax.plot(
        calibration["mean_predicted"], calibration["mean_actual"],
        marker="o", linewidth=2, color=COLORS["teal"], label="Binned model",
    )
    ax.set(
        xlabel="Mean predicted units in bin",
        ylabel="Mean actual units in bin",
        title="Regression calibration by prediction decile",
    )
    ax.legend()
    ax.grid(alpha=0.2)
    save_figure(fig, "04_regression_calibration.png")
    calibration.to_csv(OUTPUT / "regression_calibration.csv", index=False)


def model_comparison(scored: pd.DataFrame) -> dict:
    actual = scored["actual"].to_numpy(float)
    candidates = {
        "XGBoost": scored["predicted"].to_numpy(float),
        "Last week": scored["lag_1w"].to_numpy(float),
        "4-week mean": scored["roll_mean_4w"].to_numpy(float),
        "4-week EWM": scored["ewm_4w"].to_numpy(float),
    }
    metrics = {name: metrics_dict(actual, prediction) for name, prediction in candidates.items()}
    table = pd.DataFrame(metrics).T.reset_index(names="model")
    table.to_csv(OUTPUT / "model_comparison.csv", index=False)

    fig, axes = plt.subplots(1, 3, figsize=(14, 4.6))
    colors = [COLORS["teal"], COLORS["grey"], COLORS["amber"], COLORS["navy"]]
    axes[0].bar(table["model"], table["R2"], color=colors)
    axes[0].set(title="Test R²", ylabel="Higher is better")
    axes[1].bar(table["model"], table["MAE"], color=colors)
    axes[1].set(title="Test MAE", ylabel="Lower is better")
    axes[2].bar(table["model"], table["WAPE_pct"], color=colors)
    axes[2].set(title="Test WAPE", ylabel="Percent; lower is better")
    for ax in axes:
        ax.tick_params(axis="x", labelrotation=25)
        ax.grid(axis="y", alpha=0.2)
    save_figure(fig, "05_model_vs_baselines.png")
    return metrics


def error_by_volume(scored: pd.DataFrame) -> None:
    work = scored.copy()
    bins = [-0.1, 0, 10, 50, 200, 1000, np.inf]
    labels = ["0", "1–10", "11–50", "51–200", "201–1000", ">1000"]
    work["demand_band"] = pd.cut(work["actual"], bins=bins, labels=labels)
    work["absolute_error"] = np.abs(work["actual"] - work["predicted"])
    rows = []
    for label, group in work.groupby("demand_band", observed=True):
        denominator = group["actual"].abs().sum()
        rows.append({
            "demand_band": str(label),
            "rows": len(group),
            "MAE": group["absolute_error"].mean(),
            "WAPE_pct": group["absolute_error"].sum() / denominator * 100 if denominator else np.nan,
            "bias": (group["predicted"] - group["actual"]).mean(),
        })
    table = pd.DataFrame(rows)
    table.to_csv(OUTPUT / "error_by_demand_volume.csv", index=False)

    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8))
    axes[0].bar(table["demand_band"], table["MAE"], color=COLORS["teal"])
    axes[0].set(xlabel="Actual weekly demand band", ylabel="MAE", title="Absolute error by demand volume")
    axes[1].bar(table["demand_band"], table["bias"], color=COLORS["amber"])
    axes[1].axhline(0, linestyle="--", color=COLORS["coral"])
    axes[1].set(xlabel="Actual weekly demand band", ylabel="Mean prediction - actual", title="Bias by demand volume")
    save_figure(fig, "06_error_by_demand_volume.png")


def feature_importance(bundle: dict) -> None:
    table = pd.DataFrame({
        "feature": bundle["feature_columns"],
        "importance": bundle["model"].feature_importances_,
    }).sort_values("importance", ascending=False).head(20).sort_values("importance")
    fig, ax = plt.subplots(figsize=(8, 7))
    ax.barh(table["feature"], table["importance"], color=COLORS["navy"])
    ax.set(xlabel="XGBoost gain-based importance", title="Top 20 model features")
    save_figure(fig, "07_feature_importance.png")


def loss_curve(bundle: dict) -> bool:
    if TRAINING_HISTORY_PATH.exists():
        history = pd.read_csv(TRAINING_HISTORY_PATH)
    else:
        result = bundle["model"].evals_result()
        train_values = result.get("validation_0", {}).get("rmse", [])
        valid_values = result.get("validation_1", {}).get("rmse", [])
        if not train_values or not valid_values:
            return False
        history = pd.DataFrame({
            "iteration": np.arange(len(valid_values)),
            "train_log_rmse": train_values,
            "validation_log_rmse": valid_values,
        })

    fig, ax = plt.subplots(figsize=(9, 5))
    ax.plot(history["iteration"], history["train_log_rmse"], color=COLORS["navy"], label="Train")
    ax.plot(history["iteration"], history["validation_log_rmse"], color=COLORS["teal"], label="Validation")
    best = int(history["validation_log_rmse"].idxmin())
    ax.axvline(best, linestyle="--", color=COLORS["coral"], label=f"Best validation iteration: {best}")
    ax.set(xlabel="Boosting iteration", ylabel="RMSE on log1p target", title="Training and validation loss")
    ax.legend()
    ax.grid(alpha=0.2)
    save_figure(fig, "08_loss_curve.png")
    return True


def learning_curve(
    encoded: pd.DataFrame,
    train_mask: pd.Series,
    valid_mask: pd.Series,
    feature_columns: list[str],
) -> pd.DataFrame:
    train = encoded.loc[train_mask].copy()
    valid = encoded.loc[valid_mask].copy()
    train_weeks = np.array(sorted(train["week_start"].unique()))
    fractions = [0.20, 0.40, 0.60, 0.80, 1.00]
    rows = []

    X_valid = valid[feature_columns].astype("float32")
    y_valid = valid["target_demand"].astype("float32")

    for fraction in fractions:
        week_count = max(13, int(len(train_weeks) * fraction))
        included_weeks = set(train_weeks[:week_count])
        subset = train[train["week_start"].isin(included_weeks)]
        X_train = subset[feature_columns].astype("float32")
        y_train = subset["target_demand"].astype("float32")

        diagnostic = XGBRegressor(
            n_estimators=400,
            max_depth=5,
            learning_rate=0.04,
            subsample=0.80,
            colsample_bytree=0.80,
            min_child_weight=12,
            reg_alpha=0.20,
            reg_lambda=3.0,
            objective="reg:squarederror",
            tree_method="hist",
            random_state=42,
            n_jobs=-1,
            early_stopping_rounds=30,
        )
        diagnostic.fit(
            X_train,
            np.log1p(y_train),
            eval_set=[(X_valid, np.log1p(y_valid))],
            verbose=False,
        )
        train_prediction = np.maximum(0, np.expm1(diagnostic.predict(X_train)))
        valid_prediction = np.maximum(0, np.expm1(diagnostic.predict(X_valid)))
        rows.append({
            "fraction": fraction,
            "weeks": week_count,
            "training_rows": len(subset),
            "train_R2": r2_score(y_train, train_prediction),
            "validation_R2": r2_score(y_valid, valid_prediction),
            "train_RMSE": mean_squared_error(y_train, train_prediction) ** 0.5,
            "validation_RMSE": mean_squared_error(y_valid, valid_prediction) ** 0.5,
        })
        print(f"  learning curve {fraction:.0%}: rows={len(subset):,}")

    table = pd.DataFrame(rows)
    table.to_csv(OUTPUT / "learning_curve.csv", index=False)
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8))
    axes[0].plot(table["training_rows"], table["train_R2"], marker="o", label="Train", color=COLORS["navy"])
    axes[0].plot(table["training_rows"], table["validation_R2"], marker="o", label="Validation", color=COLORS["teal"])
    axes[0].set(xlabel="Chronological training rows", ylabel="R²", title="Learning curve — R²")
    axes[1].plot(table["training_rows"], table["train_RMSE"], marker="o", label="Train", color=COLORS["navy"])
    axes[1].plot(table["training_rows"], table["validation_RMSE"], marker="o", label="Validation", color=COLORS["teal"])
    axes[1].set(xlabel="Chronological training rows", ylabel="RMSE (units)", title="Learning curve — RMSE")
    for ax in axes:
        ax.legend()
        ax.grid(alpha=0.2)
    save_figure(fig, "09_learning_curve.png")
    return table


def per_hospital(scored: pd.DataFrame) -> None:
    rows = []
    for hospital_id, group in scored.groupby("hospital_id", observed=True):
        rows.append({"hospital_id": hospital_id, **metrics_dict(group["actual"], group["predicted"])})
    table = pd.DataFrame(rows).sort_values("WAPE_pct")
    table.to_csv(OUTPUT / "metrics_by_hospital.csv", index=False)
    fig, ax = plt.subplots(figsize=(11, 6))
    plot = table.sort_values("WAPE_pct", ascending=False)
    ax.barh(plot["hospital_id"], plot["WAPE_pct"], color=COLORS["teal"])
    ax.set(xlabel="WAPE (%)", title="Test error by hospital")
    save_figure(fig, "10_error_by_hospital.png")


def write_readme(overall: dict, baselines: dict, learning_curve_created: bool) -> None:
    note = f"""# MedBridge Model Evaluation Pack

## Core holdout metrics

```json
{json.dumps(overall, indent=2)}
```

## Files

- `01_actual_vs_predicted.png`
- `02_residual_diagnostics.png`
- `03_weekly_backtest.png`
- `04_regression_calibration.png`
- `05_model_vs_baselines.png`
- `06_error_by_demand_volume.png`
- `07_feature_importance.png`
- `08_loss_curve.png`
- `09_learning_curve.png` ({'created' if learning_curve_created else 'skipped by command option'})
- `10_error_by_hospital.png`
- CSV data underlying the plots
- `test_predictions.csv`
- `evaluation_metrics.json`

## Why classification graphs are absent

ROC, precision-recall, confusion matrix, and probability-calibration curves require a categorical target and usually a predicted probability. MedBridge XGBoost predicts a numeric number of weekly units, so those charts would be mathematically inappropriate and misleading.

If MedBridge later trains a separate binary model such as `stockout_next_week = yes/no`, that model should have ROC-AUC, PR-AUC, confusion matrix, precision, recall, F1, specificity, and probability calibration. Do not create those graphs by arbitrarily converting the current regression target merely to make the report look larger.

## Interpretation rule

Use pooled R² together with MAE, RMSE, WAPE, sMAPE, residual plots, chronological weekly plots, learning/loss curves, per-hospital metrics, and naive baselines. R² is not an accuracy percentage.
"""
    (OUTPUT / "README.md").write_text(note, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--skip-learning-curve",
        action="store_true",
        help="Skip the five diagnostic refits for a faster evaluation run",
    )
    args = parser.parse_args()

    for required in (FEATURES_PATH, MODEL_PATH, ENCODERS_PATH):
        if not required.exists():
            raise SystemExit(f"Missing {required}. Generate data and train the model first.")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    print("Loading features and audited model...")
    raw = pd.read_csv(FEATURES_PATH, parse_dates=["week_start"])
    train_mask, valid_mask, test_mask, split = chronological_split(raw)
    bundle = joblib.load(MODEL_PATH)
    encoders = joblib.load(ENCODERS_PATH)
    bundle["encoders"] = encoders

    test = raw.loc[test_mask].copy()
    prediction = predict_demand(test)
    scored = test[[
        "week_start", "hospital_id", "medicine_id", "generic_name",
        "category", "target_demand", "lag_1w", "roll_mean_4w", "ewm_4w",
    ]].copy()
    scored = scored.rename(columns={"target_demand": "actual"})
    scored["predicted"] = prediction
    scored["residual"] = scored["actual"] - scored["predicted"]
    scored["absolute_error"] = np.abs(scored["residual"])
    scored.to_csv(OUTPUT / "test_predictions.csv", index=False)

    overall = metrics_dict(scored["actual"], scored["predicted"])
    baselines = model_comparison(scored)
    actual_vs_predicted(scored)
    residual_diagnostics(scored)
    weekly_backtest(scored)
    regression_calibration(scored)
    error_by_volume(scored)
    feature_importance(bundle)
    loss_created = loss_curve(bundle)
    per_hospital(scored)

    learning_created = False
    if not args.skip_learning_curve:
        print("Building chronological learning curve (five diagnostic refits)...")
        encoded = _encode_frame(raw, encoders)
        feature_columns = bundle["feature_columns"]
        for column in feature_columns:
            encoded[column] = pd.to_numeric(encoded[column], errors="coerce").fillna(0).astype("float32")
        learning_curve(encoded, train_mask, valid_mask, feature_columns)
        learning_created = True

    result = {
        "task": "regression",
        "split": split,
        "overall_test": overall,
        "baselines": baselines,
        "loss_curve_created": loss_created,
        "learning_curve_created": learning_created,
        "classification_graphs_applicable": False,
    }
    (OUTPUT / "evaluation_metrics.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    write_readme(overall, baselines, learning_created)

    print("\nEvaluation complete:", OUTPUT)
    print(json.dumps(overall, indent=2))
    print("Classification charts skipped correctly: this model is regression.")


if __name__ == "__main__":
    main()
