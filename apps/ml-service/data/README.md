# MedBridge ML Data

The active pipeline is ledger-based:

```bash
cd apps/ml-service
python3 training/generate_ledger_data.py
python3 training/train_xgb.py
```

## Raw sources and state

- `raw/hospitals.csv` — hospital reference data
- `raw/medicines.csv` — medicine reference data
- `raw/transactions.csv` — generated stock-changing event ledger
- `raw/inventory.csv` — current open batches
- `raw/inventory_state.csv` — weekly hospital/medicine state
- `raw/inventory_snapshots.csv` — enriched compact serving snapshot
- `raw/pending_arrivals.json` — procurement orders still in transit
- `raw/demo_hospital_accounts.csv` — demo account metadata

## Processed training data

- `processed/demand_features.csv` — complete weekly grid with leakage-safe lag, rolling, EWM, calendar, hospital, and medicine features
- `processed/by_hospital/*.csv` — small API-serving partitions for low-latency forecasts

Generated large files and model artifacts are intentionally Git-ignored. See `docs/ML_PIPELINE_GUIDE.md` for the full schema and process.
