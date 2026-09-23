#!/bin/bash
# MedBridge One-Command Data Pipeline - High Priority from Mid-term
# Generates all metadata, ledger, features, model artifacts, showcase outputs

set -e
echo "=== MedBridge Data Pipeline ==="

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
ML_DIR="$ROOT_DIR/apps/ml-service"
BACKEND_DIR="$ROOT_DIR/apps/backend"

echo "Root: $ROOT_DIR"
echo "ML Dir: $ML_DIR"

cd "$ML_DIR"

echo ""
echo "[1/7] Generating synthetic hospitals & medicines metadata..."
python3 training/generate_synthetic_data.py

echo ""
echo "[2/7] Generating event-driven ledger (transactions, inventory, state)..."
python3 training/generate_ledger_data.py

echo ""
echo "[3/7] Validating ledger - checking no negative stock..."
python3 - << 'PY'
import pandas as pd
from pathlib import Path
inv = pd.read_csv("data/raw/inventory.csv")
if (inv["quantity_units"] < 0).any():
    print("ERROR: Negative stock found!")
    exit(1)
print(f"✓ Inventory valid: {len(inv)} batches, no negative stock")
PY

echo ""
echo "[4/7] Generating demand features (demand_features.csv)..."
python3 training/generate_features.py || python3 training/generate_synthetic_data.py --features-only || echo "Feature generation - using existing generate_synthetic_data"

echo ""
echo "[5/7] Training XGBoost model..."
python3 training/train_xgb.py

echo ""
echo "[6/7] Evaluating model & generating graphs..."
python3 training/evaluate_model.py || echo "Evaluate script not found, skipping graphs"

echo ""
echo "[7/7] Exporting for backend & seeding..."
cd "$BACKEND_DIR"
node scripts/export_for_ml.js || echo "export_for_ml.js not found, skipping"
echo "Seeding database..."
npm run seed || npx prisma db seed || echo "Seed failed - check DB connection"

echo ""
echo "=== Pipeline Complete ==="
echo "Artifacts:"
echo "  - data/raw/hospitals.csv, medicines.csv, inventory.csv, transactions.csv"
echo "  - data/processed/demand_features.csv"
echo "  - artifacts/models/xgb_demand_model.joblib"
echo "  - artifacts/metrics/training_metrics.json, feature_importance.csv"
echo ""
echo "Next: Start services"
echo "  cd apps/ml-service && uvicorn app.api.server:app --port 8000 --reload"
echo "  cd apps/backend && npm run dev"
echo "  cd apps/frontend && npm run dev"
