#!/usr/bin/env python3
"""
MedBridge -- append more simulated weeks onto an existing batch-level ledger.

Resumes from TWO pieces of state:
  inventory.csv           -- open batches on hand (Batch_No, qty, dates)
  pending_arrivals.json   -- orders already placed but not yet delivered
                              (road-access-driven lead time not yet elapsed)

Losing either one on resume would either duplicate stock (batches) or make
in-transit orders vanish (pending arrivals) -- both are reloaded here.

Run from apps/ml-service/:
    python training/append_weeks.py --weeks 8
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_synthetic_data import build_hospitals, build_medicines
from generate_ledger_data import (
    run_simulation, build_features_from_ledger, build_inventory_snapshot,
    save_feature_partitions, build_pairs, BatchLedger, save_pending_arrivals,
)

ROOT = Path(__file__).resolve().parents[1]
OUT_RAW = ROOT / "data" / "raw"
OUT_PROCESSED = ROOT / "data" / "processed"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weeks", type=int, default=4)
    args = ap.parse_args()
    OUT_PROCESSED.mkdir(parents=True, exist_ok=True)

    tx_path = OUT_RAW / "transactions.csv"
    inv_state_path = OUT_RAW / "inventory_state.csv"
    inv_path = OUT_RAW / "inventory.csv"
    pending_path = OUT_RAW / "pending_arrivals.json"
    for p in (tx_path, inv_state_path, inv_path):
        if not p.exists():
            raise SystemExit(f"Missing {p}. Run generate_ledger_data.py first.")

    hospitals = build_hospitals()
    medicines = build_medicines()
    pairs = build_pairs(hospitals, medicines)
    n = len(pairs)
    pair_index = {(h, m): i for i, (h, m) in
                  enumerate(zip(pairs["hospital_id"], pairs["medicine_id"]))}
    pair_ids = list(zip(pairs["hospital_id"].tolist(), pairs["medicine_id"].tolist()))

    existing_tx = pd.read_csv(tx_path)
    existing_inv_state = pd.read_csv(inv_state_path, parse_dates=["week_start"])
    existing_inv = pd.read_csv(inv_path, parse_dates=["manufacture_date", "expiry_date", "last_updated"])

    last_week = existing_inv_state["week_start"].max()
    new_weeks = pd.date_range(last_week + pd.Timedelta(weeks=1), periods=args.weeks, freq="W-MON")
    print(f"Existing ledger ends {last_week.date()}. Appending weeks "
          f"{new_weeks[0].date()} .. {new_weeks[-1].date()}")

    # --- rebuild open batches from the CURRENT snapshot ---
    ledger = BatchLedger(n)
    max_seq = 0
    for _, row in existing_inv.iterrows():
        key = (row["hospital_id"], row["medicine_id"])
        if key not in pair_index:
            continue
        i = pair_index[key]
        ledger.batches[i].append({
            "batch_no": row["batch_no"], "qty": int(row["quantity_available"]),
            "manufacture_date": row["manufacture_date"].date(),
            "expiry_date": row["expiry_date"].date(),
        })
        seq = int(str(row["batch_no"]).replace("BATCH-", ""))
        max_seq = max(max_seq, seq)
    ledger._batch_seq = max_seq

    # --- rebuild in-transit orders from pending_arrivals.json ---
    n_pending_loaded = 0
    if pending_path.exists():
        data = json.loads(pending_path.read_text(encoding="utf-8"))
        ledger.load_pending_from_json(data, pair_index)
        n_pending_loaded = sum(len(v) for v in data.values())
    print(f"Resumed {sum(len(b) for b in ledger.batches):,} open batches, "
          f"{n_pending_loaded:,} in-transit order(s) still pending.")

    start_tx_id = int(existing_tx["transaction_id"].str.replace("TX-", "").astype(int).max())

    new_tx, new_inv_state, new_inv, ledger, _ = run_simulation(
        hospitals, medicines, weeks=new_weeks, ledger=ledger, start_tx_id=start_tx_id,
    )

    tx_df = pd.concat([existing_tx, new_tx], ignore_index=True)
    inv_state_df = pd.concat([existing_inv_state, new_inv_state], ignore_index=True)
    tx_df.to_csv(tx_path, index=False)
    inv_state_df.to_csv(inv_state_path, index=False)
    new_inv.to_csv(inv_path, index=False)  # CURRENT-only, overwrite not append
    serving_snapshot = build_inventory_snapshot(new_inv, inv_state_df, medicines)
    serving_snapshot.to_csv(OUT_RAW / "inventory_snapshots.csv", index=False)
    save_pending_arrivals(ledger, pair_ids, pending_path)
    print(f"transactions.csv now {len(tx_df):,} rows, inventory_state.csv now {len(inv_state_df):,} rows")
    print(f"inventory.csv (current batches) refreshed: {len(new_inv):,} open batches")

    features = build_features_from_ledger(tx_path, hospitals, medicines)
    features.to_csv(OUT_PROCESSED / "demand_features.csv", index=False)
    save_feature_partitions(features, OUT_PROCESSED / "by_hospital")
    print(f"demand_features.csv rebuilt: {len(features):,} rows")
    print("Now re-run training/train_xgb.py to retrain on the updated data.")


if __name__ == "__main__":
    main()