# MedBridge ML Service

FastAPI + XGBoost service for leakage-audited weekly medicine-demand forecasting, inventory alerts, and exchange matching.

For the full file-by-file and step-by-step explanation, see [`../../docs/ML_PIPELINE_GUIDE.md`](../../docs/ML_PIPELINE_GUIDE.md).

## Folder layout

```
apps/ml-service/
  notebooks/        # Jupyter notebooks — the primary interface for EDA, model
  │                 #   comparison, training, and evaluation (see below)
  training/         # Production scripts (called by notebooks + retrain.sh)
  app/api/          # FastAPI server (forecast / expiry / low-stock / exchange)
  app/services/     # Forecasting, inventory, exchange, seed logic
  data/raw/         # Generated datasets (git-ignored, deterministic)
  data/processed/   # Generated feature table + per-hospital partitions
  artifacts/        # Trained model + encoders + metrics (git-ignored)
  reports/          # Persisted comparison results (small CSVs, committed)
  tests/            # pytest suite (leakage guard, smoke, model load, seed)
```

## Notebooks (start here)

Everything an analyst or reviewer needs is in `notebooks/`, run from `apps/ml-service/`:

| # | Notebook | What it does |
|---|---|---|
| 1 | `01_data_extraction_and_eda.ipynb` | Extracts/generates the dataset and explores demand behaviour |
| 2 | `02_model_comparison.ipynb` | Benchmarks Linear/Ridge, Decision Tree, Random Forest, Gradient Boosting, HistGB and XGBoost — **shows why XGBoost wins** |
| 3 | `03_xgboost_training.ipynb` | Trains the production XGBoost (learning curve, feature importance, baselines) |
| 4 | `04_evaluation_and_visualization.ipynb` | Hold-out evaluation, error analysis, per-hospital accuracy, and a live recursive forecast from history |

The notebooks are committed **with their executed outputs** (tables + charts), so the model-selection
evidence is visible directly on GitHub without re-running. To re-run from scratch:

```bash
cd apps/ml-service
pip install -r requirements.txt jupyter
jupyter notebook notebooks/          # or `jupyter nbconvert --execute` on each
```

To regenerate the notebooks' source from `build_notebooks.py`:

```bash
python3 build_notebooks.py
```

## Setup

```bash
cd apps/ml-service
python3 -m venv .venv
source .venv/bin/activate              # Windows: .venv\Scripts\activate
python3 -m pip install -r requirements.txt
```

## Generate, train, test, serve

```bash
python3 training/generate_ledger_data.py
python3 training/train_xgb.py
python3 training/evaluate_model.py
python3 -m pytest -q
python3 -m uvicorn app.api.server:app --host 0.0.0.0 --port 8000 --reload
```

Do not run `generate_synthetic_data.py` directly. It is the reference-data library imported by the ledger generator.

## Health and API docs

- Health: <http://localhost:8000/health>
- OpenAPI UI: <http://localhost:8000/docs>
- Next-week forecast: `GET /forecast?hospital_id=HOSP-BG-001`
- Forecast chart: `GET /forecast/chart?hospital_id=HOSP-BG-001&months=6`
- Metrics: `GET /metrics`

## Current validation result

The current leakage-audited chronological holdout run reports approximately:

- test pooled R²: **0.9085**
- test MAE: **31.07 weekly units**
- test RMSE: **90.00 weekly units**
- test WAPE: **22.91%**

The model-selection comparison (notebook 02) shows XGBoost ahead of every alternative family on
hold-out R² / MAE / WAPE; linear models are catastrophic (negative R²) on this heavy-tailed data.

The former result near 0.99 was invalid because `diff_1w` used current-week demand. The fixed feature uses only earlier weeks. No noise was added merely to lower the score.

Always read R² with WAPE, sMAPE, MAE, naive baselines, and the train/validation/test gap. R² is not an "accuracy percentage."

## CLI helpers

```bash
python3 main.py doctor
python3 main.py metrics
python3 main.py forecast --hospital HOSP-BG-001
python3 main.py expiry --hospital HOSP-BG-001
python3 main.py exchange --demo
```

## Generated files

Large files and model binaries are intentionally Git-ignored and regenerable:

```text
data/raw/*.csv            (hospitals, medicines, transactions, inventory_state, ...)
data/raw/*.json           (pending_arrivals)
data/processed/           (demand_features.csv, by_hospital/)
artifacts/models/
artifacts/encoders/
artifacts/metrics/
```

A fresh clone must regenerate and retrain before the forecast endpoints become healthy.
