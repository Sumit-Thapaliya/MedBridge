#!/usr/bin/env bash
# Run from the repository root: bash apps/retrain.sh
# Exports PostgreSQL movements, appends unseen rows to the ledger, rebuilds
# leakage-safe features, retrains, and writes a versioned validation report.

set -euo pipefail

echo "== 1/4: Exporting PostgreSQL inventory movements =="
cd apps/backend
node scripts/export_for_ml.js

echo "== 2/4: Appending only unseen real transaction IDs =="
cd ../ml-service
python3 - <<'PYEOF'
from pathlib import Path
import pandas as pd

real_path = Path("../backend/exports/real_transactions.csv")
tx_path = Path("data/raw/transactions.csv")
if not tx_path.exists():
    raise SystemExit("transactions.csv is missing; run training/generate_ledger_data.py first")

if not real_path.exists() or real_path.stat().st_size == 0:
    print("No PostgreSQL export was produced; keeping the existing ledger.")
else:
    existing_ids = set(
        pd.read_csv(tx_path, usecols=["transaction_id"], dtype="string")["transaction_id"]
        .dropna()
        .tolist()
    )
    real = pd.read_csv(real_path)
    real = real.rename(columns={"occurred_at": "event_time"})
    unseen = real[~real["transaction_id"].astype(str).isin(existing_ids)].copy()
    columns = [
        "transaction_id", "event_time", "date", "type", "hospital_id",
        "medicine_id", "batch_no", "counterparty_id", "department",
        "quantity", "emergency_flag", "note",
    ]
    for column in columns:
        if column not in unseen.columns:
            unseen[column] = None
    if len(unseen):
        unseen[columns].to_csv(tx_path, mode="a", header=False, index=False)
    print(f"Export rows={len(real):,}; newly appended={len(unseen):,}")
PYEOF

echo "== 3/4: Rebuilding complete leakage-safe weekly features =="
python3 - <<'PYEOF'
from pathlib import Path
import pandas as pd
from training.generate_ledger_data import build_features_from_ledger

raw = Path("data/raw")
hospitals = pd.read_csv(raw / "hospitals.csv")
medicines = pd.read_csv(raw / "medicines.csv")
features = build_features_from_ledger(raw / "transactions.csv", hospitals, medicines)
out = Path("data/processed/demand_features.csv")
out.parent.mkdir(parents=True, exist_ok=True)
features.to_csv(out, index=False)
print(f"Rebuilt {len(features):,} feature rows")
PYEOF

echo "== 4/4: Retraining and validating XGBoost =="
python3 training/train_xgb.py

echo "Done. Restart FastAPI so its cached model bundle is reloaded."
