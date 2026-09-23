"""
apps/ml-service/app/services/seed_service.py

Generates starter transaction/inventory history for a brand-new hospital
that just signed up, using the SAME simulation engine as the bulk generator
(training/generate_ledger_data.py), just scoped to one hospital instead of
all 42-ish reference hospitals.

Returns plain Python data (lists of dicts) — this service does NOT write to
Postgres itself. The Node backend calls this endpoint, gets the data back,
and writes it into the real database, tagging it isSynthetic=True.
"""
from __future__ import annotations

import sys
from pathlib import Path
from datetime import date, timedelta

import numpy as np
import pandas as pd

TRAINING_DIR = Path(__file__).resolve().parents[2] / "training"
sys.path.insert(0, str(TRAINING_DIR))

from generate_synthetic_data import build_medicines  # noqa: E402
from generate_ledger_data import (  # noqa: E402
    build_pairs,
    run_simulation,
    week_starts,
    build_features_from_ledger,
    feature_partition_path,
)

RAW_DIR = Path(__file__).resolve().parents[2] / "data" / "raw"
PROCESSED_DIR = Path(__file__).resolve().parents[2] / "data" / "processed"

# Reasonable defaults when the signup form doesn't collect every attribute
# our simulation formula wants. Keep this list in sync with what the signup
# form on the frontend actually asks for.
DEFAULTS = {
    "urban_class": "Municipality",
    "ecoregion": "Hill",
    "ownership": "public",
    "load_factor": 1.0,
    "urban_factor": 1.0,
    "is_referral": 0,
    "road_access_score": 0.7,
    "latitude": 27.7,
    "longitude": 85.3,
    "is_demo": 0,
}


def _persist_for_serving(hospitals_df: pd.DataFrame, tx_df: pd.DataFrame, medicines_df: pd.DataFrame):
    """Appends the new hospital + its transactions into the SAME files
    /forecast reads from, and appends its feature rows to demand_features.csv.
    Without this, seeding only reaches Postgres — the ML service would still
    404 on this hospital, since /forecast reads demand_features.csv directly,
    not the database.
    """
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    hospitals_path = RAW_DIR / "hospitals.csv"
    if hospitals_path.exists():
        existing = pd.read_csv(hospitals_path)
        if hospitals_df["hospital_id"].iloc[0] not in existing["hospital_id"].values:
            combined = pd.concat([existing, hospitals_df], ignore_index=True)
            combined.to_csv(hospitals_path, index=False)

    tx_path = RAW_DIR / "transactions.csv"
    if tx_path.exists():
        tx_df.to_csv(tx_path, mode="a", header=False, index=False)
    else:
        tx_df.to_csv(tx_path, index=False)

    feats = build_features_from_ledger(tx_df, hospitals_df, medicines_df)
    feat_path = PROCESSED_DIR / "demand_features.csv"
    if feat_path.exists():
        feats.to_csv(feat_path, mode="a", header=False, index=False)
    else:
        feats.to_csv(feat_path, index=False)

    partition_dir = PROCESSED_DIR / "by_hospital"
    partition_dir.mkdir(parents=True, exist_ok=True)
    partition_path = feature_partition_path(
        partition_dir, str(hospitals_df["hospital_id"].iloc[0])
    )
    if partition_path.exists():
        existing_partition = pd.read_csv(partition_path, parse_dates=["week_start"])
        combined_partition = pd.concat([existing_partition, feats], ignore_index=True)
        combined_partition = combined_partition.drop_duplicates(
            ["hospital_id", "medicine_id", "week_start"], keep="last"
        )
        combined_partition.to_csv(partition_path, index=False)
    else:
        feats.to_csv(partition_path, index=False)


def seed_hospital_history(
    hospital_row: dict,
    weeks_of_history: int = 26,
    *,
    persist: bool = True,
) -> dict:
    """
    hospital_row must at minimum contain:
      hospital_id (str, the Postgres Hospital.id — used as the join key),
      facility_type (str), province (str), district (str), bed_capacity (int)
    Anything else falls back to DEFAULTS.
    """
    row = {**DEFAULTS, **hospital_row}
    hospitals_df = pd.DataFrame([row])
    medicines_df = build_medicines()

    end = date.today()
    start = end - timedelta(weeks=weeks_of_history)
    weeks = week_starts(start, end)

    tx_df, inv_state_df, inventory_df, _, _ = run_simulation(
        hospitals_df, medicines_df, weeks=weeks
    )

    # The Medicine table requires `category` and a packaging `unit` — the raw
    # ledger snapshot only has batch/quantity/expiry, so enrich it here with
    # the reference attributes from medicines_df before handing it back.
    med_lookup = medicines_df.set_index("medicine_id")[["category", "dosage_form", "generic_name"]]
    inventory_df = inventory_df.merge(med_lookup, left_on="medicine_id", right_index=True, how="left")

    # Bridge into the ML service's own serving data — without this, /forecast
    # would 404 for this hospital even though Postgres has its data. Tests can
    # disable persistence so they never modify the real training CSVs.
    if persist:
        _persist_for_serving(hospitals_df, tx_df, medicines_df)

    return {
        "hospital_id": row["hospital_id"],
        "weeks_generated": len(weeks),
        "transactions": tx_df.to_dict(orient="records"),
        "current_inventory": inventory_df.to_dict(orient="records"),
        "transaction_count": len(tx_df),
        "batch_count": len(inventory_df),
    }