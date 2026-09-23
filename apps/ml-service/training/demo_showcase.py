#!/usr/bin/env python3
"""
End-to-end showcase for final report:
  - 8 hospital logins summary
  - Inventory + expiry alerts per demo hospital
  - Exchange suggestions among demo hospitals
  - Demand forecasts for next week (from latest feature rows)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.exchange_services import demo_exchange_plan
from app.services.forecast_services import batch_forecast
from app.services.inventory_services import (
    expiry_alerts,
    hospital_inventory_summary,
    low_stock_alerts,
)

RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
OUT = ROOT / "artifacts" / "metrics" / "demo_showcase"
ART_ENC = ROOT / "artifacts" / "encoders"


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    accounts = pd.read_csv(RAW / "demo_hospital_accounts.csv")
    hospitals = pd.read_csv(RAW / "hospitals.csv")
    demo_ids = accounts["hospital_id"].tolist()

    print("=" * 72)
    print("MedBridge DEMO — 8 Hospital Logins")
    print("=" * 72)
    print(accounts[["hospital_id", "hospital_name", "facility_type", "demo_username", "demo_password"]].to_string(index=False))
    accounts.to_csv(OUT / "01_demo_logins.csv", index=False)

    # Inventory summaries
    summaries = [hospital_inventory_summary(hid) for hid in demo_ids]
    sum_df = pd.DataFrame(summaries)
    sum_df = sum_df.merge(
        hospitals[["hospital_id", "hospital_name", "facility_type"]],
        on="hospital_id",
        how="left",
    )
    print("\n--- Inventory summary (demo hospitals) ---")
    cols = ["hospital_id", "hospital_name", "n_skus", "total_units", "near_expiry_batches", "low_stock_skus", "total_value_npr"]
    print(sum_df[cols].to_string(index=False))
    sum_df.to_csv(OUT / "02_inventory_summary.csv", index=False)

    # Expiry alerts
    exp = expiry_alerts(within_days=90)
    exp_demo = exp[exp["hospital_id"].isin(demo_ids)].copy()
    print(f"\n--- Near-expiry batches (demo, ≤90d): {len(exp_demo)} ---")
    if len(exp_demo):
        show = exp_demo.head(15)[
            ["hospital_name", "generic_name", "quantity_units", "days_to_expiry_calc", "alert_level", "estimated_waste_value_npr"]
        ]
        print(show.to_string(index=False))
    exp_demo.to_csv(OUT / "03_expiry_alerts_demo.csv", index=False)

    # Low stock
    low = low_stock_alerts()
    low_demo = low[low["hospital_id"].isin(demo_ids)].copy()
    print(f"\n--- Low stock SKUs (demo): {len(low_demo)} ---")
    if len(low_demo):
        print(low_demo.head(15)[
            ["hospital_name", "generic_name", "quantity_units", "reorder_level", "days_of_cover"]
        ].to_string(index=False))
    low_demo.to_csv(OUT / "04_low_stock_demo.csv", index=False)

    # Exchange plan
    matches = demo_exchange_plan(top_k=40)
    print(f"\n--- Suggested exchanges among demo hospitals: {len(matches)} ---")
    if len(matches):
        print(matches.head(12)[
            ["from_hospital_name", "to_hospital_name", "generic_name", "suggested_qty",
             "distance_km", "priority", "match_score"]
        ].to_string(index=False))
    matches.to_csv(OUT / "05_exchange_suggestions_demo.csv", index=False)

    # Forecasts for demo hospitals — latest week in feature set
    print("\n--- Demand forecast (latest week features → model) ---")
    feats = pd.read_csv(PROC / "demand_features.csv", parse_dates=["week_start"])
    demo_feat = feats[feats["hospital_id"].isin(demo_ids)].copy()
    latest = demo_feat["week_start"].max()
    latest_rows = demo_feat[demo_feat["week_start"] == latest].copy()

    # Drop columns not needed; batch_forecast encodes cats
    pred_df = batch_forecast(latest_rows)
    # latest_rows already has facility_type / category / generic_name from feature table
    name_map = hospitals.set_index("hospital_id")["hospital_name"].to_dict()
    pred_df["hospital_name"] = pred_df["hospital_id"].map(name_map)
    if "generic_name" not in pred_df.columns or pred_df["generic_name"].isna().all():
        meds = pd.read_csv(RAW / "medicines.csv")[["medicine_id", "generic_name", "category"]]
        pred_df = pred_df.drop(columns=[c for c in ["generic_name", "category"] if c in pred_df.columns], errors="ignore")
        pred_df = pred_df.merge(meds, on="medicine_id", how="left")
    keep = [
        "hospital_id", "hospital_name", "facility_type", "medicine_id", "generic_name",
        "category", "week_start", "target_demand", "predicted_demand",
    ]
    keep = [c for c in keep if c in pred_df.columns]
    out_pred = pred_df[keep].copy()
    out_pred["abs_error"] = (out_pred["target_demand"] - out_pred["predicted_demand"]).abs().round(2)
    out_pred.to_csv(OUT / "06_forecasts_demo_latest_week.csv", index=False)

    # Accuracy on this slice
    mae = float(out_pred["abs_error"].mean())
    # R2
    y = out_pred["target_demand"].to_numpy(float)
    p = out_pred["predicted_demand"].to_numpy(float)
    ss_res = np.sum((y - p) ** 2)
    ss_tot = np.sum((y - y.mean()) ** 2)
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0

    print(f"Latest week: {latest.date()} | demo rows={len(out_pred)} | MAE={mae:.2f} | R2={r2:.4f}")
    print("\nSample forecasts:")
    print(out_pred.sort_values("predicted_demand", ascending=False).head(12)[
        ["hospital_name", "generic_name", "target_demand", "predicted_demand", "abs_error"]
    ].to_string(index=False))

    # Specialty highlight: cancer oncology + children pediatric
    print("\n--- Specialty highlight forecasts ---")
    for hid, label in [("HOSP-BG-003", "Cancer/Oncology"), ("HOSP-BG-004", "Children/Pediatric+Vaccine")]:
        sub = out_pred[out_pred["hospital_id"] == hid]
        if label.startswith("Cancer"):
            sub = sub[sub["category"] == "Oncology"]
        else:
            sub = sub[sub["category"].isin(["Pediatric", "Vaccine"])]
        print(f"\n{label} ({hid}):")
        if len(sub):
            print(sub.head(8)[["generic_name", "target_demand", "predicted_demand"]].to_string(index=False))

    summary = {
        "demo_hospitals": demo_ids,
        "latest_forecast_week": str(latest.date()),
        "forecast_mae": round(mae, 4),
        "forecast_r2": round(float(r2), 6),
        "n_expiry_alerts": int(len(exp_demo)),
        "n_low_stock": int(len(low_demo)),
        "n_exchange_suggestions": int(len(matches)),
        "output_dir": str(OUT),
    }
    (OUT / "00_showcase_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    # Markdown for report
    md = f"""# MedBridge Demo Showcase Output

## 8 Hospital Logins
Password for all: `MedBridge@2026`

| ID | Hospital | Username |
|----|----------|----------|
{chr(10).join(f"| {r.hospital_id} | {r.hospital_name} | `{r.demo_username}` |" for r in accounts.itertuples())}

## System checks (this run)
- Near-expiry alerts (demo): **{len(exp_demo)}**
- Low-stock SKUs (demo): **{len(low_demo)}**
- Exchange suggestions: **{len(matches)}**
- Forecast week: **{latest.date()}**
- Demo forecast MAE: **{mae:.2f}** | R²: **{r2:.4f}**

Files written under `artifacts/metrics/demo_showcase/`.
"""
    (OUT / "SHOWCASE_REPORT.md").write_text(md, encoding="utf-8")
    print("\nSaved showcase →", OUT)


if __name__ == "__main__":
    main()