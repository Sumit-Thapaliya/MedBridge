#!/usr/bin/env python3
"""
Real-data / Noisy-data Evaluation - High Priority Pending from Mid-term
Tests robustness with Gaussian noise, stockouts, missing data
Documents limitations for report
"""
import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.metrics import r2_score, mean_absolute_error
import joblib

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "processed" / "demand_features.csv"

print("Loading model and data...")
bundle = joblib.load(ROOT / "artifacts" / "models" / "xgb_demand_model.joblib")
model = bundle["model"]
feature_cols = bundle["feature_columns"]

df = pd.read_csv(DATA, parse_dates=["week_start"])
# Simple encoding for test
for c in feature_cols:
    if df[c].dtype == object:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)

test = df[df["week_start"] >= "2026-04-06"].copy()
X_test = test[feature_cols]
y_test = test["target_demand"].astype(float)

def predict(X):
    return np.maximum(0, np.expm1(model.predict(X)))

base_pred = predict(X_test)
base_r2 = r2_score(y_test, base_pred)
base_mae = mean_absolute_error(y_test, base_pred)

print(f"\n=== Base (Clean Synthetic) ===")
print(f"R2: {base_r2:.4f}, MAE: {base_mae:.4f}")

# Test 1: Add 15% Gaussian noise to consumption features
print(f"\n=== Noisy Data (15% Gaussian noise) ===")
np.random.seed(42)
X_noisy = X_test.copy()
# Add noise to numeric columns that represent consumption
for col in ["avg_daily_use", "quantity_units", "reorder_level"]:
    if col in X_noisy.columns:
        noise = np.random.normal(0, 0.15, len(X_noisy))
        X_noisy[col] = X_noisy[col] * (1 + noise)
        X_noisy[col] = X_noisy[col].clip(lower=0)

noisy_pred = predict(X_noisy)
noisy_r2 = r2_score(y_test, noisy_pred)
noisy_mae = mean_absolute_error(y_test, noisy_pred)
print(f"R2: {noisy_r2:.4f} (drop {base_r2 - noisy_r2:.4f}), MAE: {noisy_mae:.4f}")

# Test 2: Simulate stockouts (set some quantities to 0)
print(f"\n=== Stockout Simulation (10% of data qty=0) ===")
X_stockout = X_test.copy()
mask = np.random.random(len(X_stockout)) < 0.1
if "quantity_units" in X_stockout.columns:
    X_stockout.loc[mask, "quantity_units"] = 0

stockout_pred = predict(X_stockout)
stockout_r2 = r2_score(y_test, stockout_pred)
print(f"R2: {stockout_r2:.4f} (drop {base_r2 - stockout_r2:.4f})")

# Test 3: Missing data
print(f"\n=== Missing Data (5% NaN) ===")
X_missing = X_test.copy()
for col in feature_cols[:3]:
    mask = np.random.random(len(X_missing)) < 0.05
    X_missing.loc[mask, col] = np.nan
X_missing = X_missing.fillna(0)

missing_pred = predict(X_missing)
missing_r2 = r2_score(y_test, missing_pred)
print(f"R2: {missing_r2:.4f} (drop {base_r2 - missing_r2:.4f})")

# Save report
report = f"""
# Real-data / Noisy-data Evaluation Report

## Base Performance (Clean Synthetic Data)
- R2: {base_r2:.4f}
- MAE: {base_mae:.4f}
- Data: Synthetic ledger from generate_ledger_data.py, policy-driven, not real hospital data

## Robustness Tests

### 1. Noisy Data (15% Gaussian noise on consumption)
- R2: {noisy_r2:.4f} (drop {base_r2 - noisy_r2:.4f})
- Interpretation: Model is {'robust' if base_r2 - noisy_r2 < 0.1 else 'sensitive'} to noise
- Real hospitals have manual entry errors, ~10-20% noise expected

### 2. Stockout Simulation (10% qty=0)
- R2: {stockout_r2:.4f} (drop {base_r2 - stockout_r2:.4f})
- Interpretation: Stockouts affect demand signal, model should handle

### 3. Missing Data (5% NaN)
- R2: {missing_r2:.4f} (drop {base_r2 - missing_r2:.4f})
- Interpretation: Fillna(0) strategy works but may underestimate

## Limitations (for report)
- Model trained on synthetic data from generate_ledger_data.py, not real hospital data
- Synthetic data is clean, has no manual errors, no unrecorded consumption
- Real hospital data will be noisier, have stockouts, have seasonal outbreaks not in synthetic
- Road access, cold chain, ABC policies are simulated, need validation with real hospital metadata
- For production, need real hospital data integration and retraining
- Current model generalizes via facility_type, province, category (not hospital_id) - good for new hospitals but loses hospital-specific patterns

## Recommendations
- Collect real consumption data from partner hospitals for 3 months
- Retrain with real data + synthetic augmented
- Add more features: supplier lead time actual, staff count, patient volume
- Monitor R2 drop in production, retrain monthly
"""

Path(ROOT / "artifacts" / "metrics" / "noisy_evaluation_report.md").write_text(report)
print(report)
print(f"\nSaved report to artifacts/metrics/noisy_evaluation_report.md")
