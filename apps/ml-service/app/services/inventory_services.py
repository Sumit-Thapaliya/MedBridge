"""
Inventory helpers: expiry alerts, low-stock, surplus detection.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"


def load_inventory(snapshot_path: Path | None = None) -> pd.DataFrame:
    path = snapshot_path or (RAW / "inventory_snapshots.csv")
    inv = pd.read_csv(path)
    inv["expiry_date"] = pd.to_datetime(inv["expiry_date"])
    inv["snapshot_date"] = pd.to_datetime(inv["snapshot_date"])
    return inv


def load_medicines() -> pd.DataFrame:
    return pd.read_csv(RAW / "medicines.csv")


def load_hospitals() -> pd.DataFrame:
    return pd.read_csv(RAW / "hospitals.csv")


def expiry_alerts(
    inv: pd.DataFrame | None = None,
    within_days: int = 90,
    hospital_id: str | None = None,
    as_of: date | None = None,
) -> pd.DataFrame:
    """Batches expiring within `within_days` (default 90)."""
    inv = load_inventory() if inv is None else inv.copy()
    as_of_ts = pd.Timestamp(as_of or date.today())
    # If synthetic snapshot is in the future relative to "today", use snapshot date
    snap = inv["snapshot_date"].max()
    if snap > as_of_ts:
        as_of_ts = snap

    inv["days_to_expiry_calc"] = (inv["expiry_date"] - as_of_ts).dt.days
    out = inv[inv["days_to_expiry_calc"] <= within_days].copy()
    out = out[out["days_to_expiry_calc"] >= 0]
    if hospital_id:
        out = out[out["hospital_id"] == hospital_id]

    meds = load_medicines()[["medicine_id", "generic_name", "category", "unit"]]
    hosps = load_hospitals()[["hospital_id", "hospital_name", "facility_type"]]
    out = out.merge(meds, on="medicine_id", how="left", suffixes=("", "_m"))
    out = out.merge(hosps, on="hospital_id", how="left")
    out["alert_level"] = pd.cut(
        out["days_to_expiry_calc"],
        bins=[-1, 14, 30, 60, 90],
        labels=["CRITICAL_14d", "HIGH_30d", "MEDIUM_60d", "WATCH_90d"],
    )
    out["estimated_waste_value_npr"] = (
        out["quantity_units"] * out["unit_cost_npr"]
    ).round(2)
    return out.sort_values(["days_to_expiry_calc", "estimated_waste_value_npr"])


def low_stock_alerts(
    inv: pd.DataFrame | None = None,
    hospital_id: str | None = None,
) -> pd.DataFrame:
    inv = load_inventory() if inv is None else inv.copy()
    # aggregate by hospital+medicine
    agg = (
        inv.groupby(["hospital_id", "medicine_id"], as_index=False)
        .agg(
            quantity_units=("quantity_units", "sum"),
            reorder_level=("reorder_level", "max"),
            avg_daily_use=("avg_daily_use", "max"),
            min_days_to_expiry=("days_to_expiry", "min"),
        )
    )
    agg["days_of_cover"] = agg.apply(
        lambda r: (r["quantity_units"] / r["avg_daily_use"]) if r["avg_daily_use"] > 0 else None,
        axis=1,
    )
    low = agg[
        (agg["quantity_units"] <= agg["reorder_level"])
        | (agg["days_of_cover"].fillna(999) < 10)
    ].copy()
    if hospital_id:
        low = low[low["hospital_id"] == hospital_id]

    meds = load_medicines()[["medicine_id", "generic_name", "category"]]
    hosps = load_hospitals()[["hospital_id", "hospital_name", "facility_type"]]
    low = low.merge(meds, on="medicine_id", how="left").merge(hosps, on="hospital_id", how="left")
    low["alert_type"] = "LOW_STOCK"
    return low.sort_values("days_of_cover")


def surplus_stock(
    inv: pd.DataFrame | None = None,
    min_cover_days: float = 40.0,
    hospital_id: str | None = None,
) -> pd.DataFrame:
    inv = load_inventory() if inv is None else inv.copy()
    agg = (
        inv.groupby(["hospital_id", "medicine_id"], as_index=False)
        .agg(
            quantity_units=("quantity_units", "sum"),
            avg_daily_use=("avg_daily_use", "max"),
            nearest_expiry=("days_to_expiry", "min"),
        )
    )
    agg["days_of_cover"] = agg.apply(
        lambda r: (r["quantity_units"] / r["avg_daily_use"]) if r["avg_daily_use"] > 0 else 999,
        axis=1,
    )
    sur = agg[agg["days_of_cover"] >= min_cover_days].copy()
    if hospital_id:
        sur = sur[sur["hospital_id"] == hospital_id]
    meds = load_medicines()[["medicine_id", "generic_name", "category"]]
    hosps = load_hospitals()[["hospital_id", "hospital_name", "facility_type", "latitude", "longitude", "province"]]
    sur = sur.merge(meds, on="medicine_id", how="left").merge(hosps, on="hospital_id", how="left")
    return sur.sort_values("days_of_cover", ascending=False)


def hospital_inventory_summary(hospital_id: str) -> dict:
    inv = load_inventory()
    h = inv[inv["hospital_id"] == hospital_id]
    if h.empty:
        return {"hospital_id": hospital_id, "error": "no inventory"}
    exp = expiry_alerts(hospital_id=hospital_id)
    low = low_stock_alerts(hospital_id=hospital_id)
    return {
        "hospital_id": hospital_id,
        "n_batches": int(len(h)),
        "n_skus": int(h["medicine_id"].nunique()),
        "total_units": int(h["quantity_units"].sum()),
        "total_value_npr": round(float((h["quantity_units"] * h["unit_cost_npr"]).sum()), 2),
        "near_expiry_batches": int(len(exp)),
        "near_expiry_value_npr": round(float(exp["estimated_waste_value_npr"].sum()), 2) if len(exp) else 0,
        "low_stock_skus": int(len(low)),
        "status_breakdown": h["stock_status"].value_counts().to_dict(),
    }