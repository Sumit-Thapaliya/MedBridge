# MedBridge ML Pipeline — Deep Technical Guide and Validity Audit

## 1. What the ML part is actually responsible for

MedBridge has three related but different kinds of intelligence:

1. **Demand forecasting** — XGBoost estimates how many units of each medicine a hospital will consume in a future week.
2. **Inventory rules** — deterministic code finds low stock and near-expiry batches. These are not trained ML models.
3. **Exchange matching** — deterministic ranking matches a hospital with a shortage to a hospital with surplus, using medicine, stock cover, expiry, province, and distance. This is also not XGBoost.

The LLM assistant is another separate system. It can read forecast output and live PostgreSQL inventory, but it does not train the XGBoost model.

---

## 2. End-to-end architecture

```text
Reference builders
(generate_synthetic_data.py)
        |
        v
Event-driven weekly simulation
(generate_ledger_data.py)
        |
        +--> hospitals.csv / medicines.csv
        +--> transactions.csv
        +--> inventory.csv
        +--> inventory_state.csv
        +--> inventory_snapshots.csv
        +--> pending_arrivals.json
        |
        v
Leakage-safe feature engineering
(build_features_from_ledger)
        |
        v
data/processed/demand_features.csv
        |
        v
Chronological train / validation / test
(train_xgb.py)
        |
        +--> model bundle
        +--> categorical encoders
        +--> feature list
        +--> metrics and reports
        |
        v
FastAPI model serving
(app/api/server.py + forecast_services.py)
        |
        v
Express backend mlClient.js
        |
        v
React Demand Forecast page + AI forecast insight
```

---

## 3. Data-generation steps in detail

### Step 3.1 — Build hospital reference data

`training/generate_synthetic_data.py::build_hospitals()` defines the hospital network.

Each hospital has fields such as:

- `hospital_id`
- facility type
- province and district
- ecoregion and urban class
- latitude and longitude
- bed capacity
- ownership
- specialty focus
- road-access score
- demo-account flags

These fields represent stable hospital characteristics. They affect simulated demand, delivery lead time, and exchange distance.

### Step 3.2 — Build medicine reference data

`build_medicines()` defines the medicine catalogue.

Important fields include:

- medicine code and generic name
- category and dosage form
- strength and unit
- pack size
- shelf life
- unit cost in NPR
- cold-chain requirement
- essential-medicine flag
- ABC inventory class

### Step 3.3 — Create every hospital/medicine pair

`generate_ledger_data.py::build_pairs()` creates the Cartesian product:

```text
41 hospitals × 72 medicines = 2,952 hospital/medicine series
```

For each pair, it calculates an expected base usage using hospital capacity, facility characteristics, medicine category, specialty affinity, and a controlled random facility/medicine affinity.

It also calculates:

- reorder level
- ABC-based safety-stock and order policy
- pack-size rounding
- procurement lead time from road access
- cold-chain spoilage probability

### Step 3.4 — Initialize batch-level stock

`BatchLedger` stores open batches for each hospital/medicine pair.

Each batch contains:

- batch number
- quantity
- manufacture date
- expiry date

The ledger also stores pending procurement arrivals so an order placed this week can arrive several weeks later.

### Step 3.5 — Simulate one week at a time

For every simulated Monday, `run_simulation()` performs the following sequence:

1. Calculate calendar and Nepal-specific seasonality.
2. Apply medicine-category seasonality.
3. Apply ecoregion pressure.
4. Apply festival effects.
5. Apply occasional disruption and shock periods.
6. Generate desired usage with stochastic noise.
7. Receive procurement orders whose lead time has elapsed.
8. Remove batches that reached expiry.
9. Simulate occasional cold-chain spoilage.
10. Consume available batches.
11. Record unmet usage as an emergency request.
12. Look for an exchange donor when the shortage is urgent.
13. Otherwise place or immediately receive a procurement order.
14. Save end-of-week inventory state.

### Step 3.6 — Write raw outputs

The simulation writes:

- `transactions.csv` — event ledger
- `inventory.csv` — current open batches
- `inventory_state.csv` — weekly state for every pair
- `inventory_snapshots.csv` — enriched current serving snapshot
- `pending_arrivals.json` — outstanding procurement orders
- `hospitals.csv`, `medicines.csv`, and `demo_hospital_accounts.csv`

`transactions.csv` contains these event types:

- `CONSUMPTION`
- `PROCUREMENT_ORDERED`
- `PROCUREMENT`
- `EXCHANGE_OUT`
- `EXCHANGE_IN`
- `EXPIRY_WRITEOFF`
- `EMERGENCY_REQUEST`

---

## 4. Feature engineering in detail

The model target is **observed weekly consumption units** for one hospital and medicine.

For a forecast row dated week `t`, the target is demand during `t`, while all demand-derived inputs must use data available at or before `t-1`.

### Calendar features

- year
- month
- ISO week number
- quarter
- monsoon flag
- winter flag
- sine/cosine cyclical month and week values

### Historical-demand features

- lags: 1, 2, 3, 4, 8, and 12 weeks
- rolling means: 2, 4, 8, and 12 weeks
- rolling standard deviations: 2, 4, 8, and 12 weeks
- four-week minimum and maximum
- lagged one-week and four-week changes
- 4-week and 12-week exponentially weighted means
- whether an emergency occurred in the previous four weeks
- whether an exchange-in occurred in the previous four weeks

### Static hospital features

Examples:

- facility type
- province, district, and ecoregion
- urban class
- bed capacity
- ownership
- referral status
- road-access score
- location

### Static medicine features

Examples:

- category
- dosage form
- shelf life
- unit cost
- cold-chain requirement
- essential flag
- ABC class
- pack size

### Features deliberately excluded during training

- `hospital_id` and `medicine_id` — identifiers would encourage memorization.
- `base_demand_per_100_beds`, `load_factor`, `urban_factor`, `is_demo` — these are simulation coefficients or demo metadata, not reliable operational inputs from a real hospital.
- the current target itself.

### Missing calendar weeks

The revised pipeline explicitly creates the full hospital × medicine × week grid. A week with no recorded consumption becomes zero demand. This ensures `lag_1w` means the immediately preceding calendar week, not merely the preceding non-empty row.

---

## 5. Why the old R² near 0.99 was invalid

The old feature code contained:

```python
df["diff_1w"] = group.diff(1)
```

For row `t`, that calculates:

```text
diff_1w = target(t) - target(t-1)
```

The same row also contained:

```text
lag_1w = target(t-1)
```

Therefore the model could reconstruct the answer:

```text
target(t) = lag_1w + diff_1w
```

This is direct **target leakage**, not genuine forecasting skill. A model can score near 1.0 because the answer is hidden inside an input column.

The corrected feature is:

```text
diff_1w = target(t-1) - target(t-2)
```

The code now shifts the series before calculating differences. An automated leakage audit aborts training if the old mathematical relationship appears again.

No random noise was added merely to force a lower score.

---

## 6. Model training steps

`training/train_xgb.py` performs these steps:

1. Load `demand_features.csv`.
2. Sort unique weeks.
3. Use all early weeks for training.
4. Reserve the next 13 weeks for validation.
5. Reserve the final 13 weeks for untouched testing.
6. Fit categorical encoders on training rows only.
7. Convert unknown future categories to a safe fallback.
8. Exclude identifiers, target fields, and simulation-only coefficients.
9. Run leakage checks.
10. Apply `log1p` to the target to reduce domination by very high-volume items.
11. Train a regularized XGBoost regressor.
12. Use early stopping against validation data.
13. Convert predictions back with `expm1`.
14. Compare XGBoost with naive baselines.
15. Save model, encoders, feature order, metrics, predictions, and feature importance.

### Current regularization

- maximum depth 5
- learning rate 0.03
- row subsampling 0.80
- feature subsampling 0.80
- minimum child weight 12
- L1 regularization 0.20
- L2 regularization 3.0
- early stopping

The old model used greater depth and capacity. The new settings are intentionally conservative, but they were not selected just to manufacture a particular test score.

---

## 7. Current honest evaluation

Current leakage-audited run:

| Split | Pooled R² | MAE | RMSE | WAPE |
|---|---:|---:|---:|---:|
| Train | 0.9123 | 31.74 | 92.01 | 22.45% |
| Validation | 0.9091 | 28.84 | 82.34 | 22.54% |
| Test | **0.9085** | **31.07** | **90.00** | **22.91%** |

Baselines on exactly the same test weeks:

| Baseline | R² | MAE | WAPE |
|---|---:|---:|---:|
| Last week | 0.8439 | 41.26 | 30.43% |
| Four-week mean | 0.8717 | 35.89 | 26.47% |
| Four-week EWM | 0.8793 | 35.15 | 25.92% |

The revised score is approximately 0.91. It was **not forced into a chosen range**. More importantly:

- train, validation, and test are close;
- test performance is not worse than training;
- XGBoost beats meaningful naive baselines;
- direct target leakage is gone.

This is evidence against conventional overfitting.

### Why one R² still does not tell the whole story

Pooled R² is dominated by the large scale differences between high-volume and low-volume medicines. It can be high even when individual low-volume weekly series are difficult.

The same run has test WAPE around 22.9% and high sMAPE because approximately 8% of pair-weeks have zero demand. At the hospital-week aggregate used by the dashboard, random medicine-level errors partly cancel (R² about 0.990 and WAPE about 5.97%). That aggregate score must not be presented as medicine-level accuracy.

The macro R² calculated separately for each hospital/medicine series is near zero over only 13 test observations per series. Per-series R² is statistically unstable on such a short and noisy horizon, but it is still an important warning: do not claim that every individual low-volume SKU is predicted accurately just because pooled or aggregated R² is high.

The report therefore retains all metrics instead of calling R² an “accuracy percentage.”

Never write “91.3% accurate” in the report. Write “pooled holdout R² = 0.9085, test WAPE = 22.9%, and MAE = 31 weekly units.”

### Evaluation graphs

Run `python3 training/evaluate_model.py` after training. It writes a complete pack under `artifacts/metrics/evaluation/`:

- actual versus predicted, linear and log scale;
- residual versus prediction, residual histogram, and Q-Q plot;
- chronological weekly holdout backtest;
- binned regression-calibration plot;
- XGBoost versus naive baselines;
- error and bias by demand-volume band;
- feature importance;
- training and validation loss curve;
- chronological learning curve;
- WAPE by hospital.

ROC, precision-recall, confusion matrix, and probability-calibration graphs are not generated because the deployed task predicts numeric units and is therefore regression. Those graphs become valid only if a separate categorical model—such as next-week stockout yes/no—is explicitly trained and evaluated.

---

## 8. How a real future forecast is produced

The previous API selected the latest historical row and predicted it, which was a backtest rather than a future forecast.

The revised `forecast_services.py` now:

1. Finds the last observed week.
2. Creates a new row dated one week later.
3. Sets lag 1 to the latest observed demand.
4. Sets lag 2 to demand from two observations back.
5. Recalculates rolling, difference, EWM, and calendar features.
6. Leaves `target_demand` empty because the future actual is unknown.
7. Runs XGBoost.
8. Returns the result as `forecast_type: future`.

For the chart, the service recursively generates eight future weeks. After the first future week, its prediction is used only as a lag for the next horizon. Future rows are labelled separately from historical backtests.

---

## 9. How the result reaches the browser

1. FastAPI exposes `/forecast` and `/forecast/chart`.
2. `apps/backend/src/services/mlClient.js` calls FastAPI.
3. `demandForecast.service.js` resolves the database hospital to its ML code.
4. The Express controller returns chart rows to React.
5. `DemandForecast.jsx` requests the rows.
6. `DemandForecastChart.jsx` renders actual demand and forecast demand.
7. `/api/ai/forecast-insight` summarizes top predicted medicines.
8. The LLM RAG layer can also request forecast context for forecast questions.

---

## 10. File-by-file responsibility

### ML root files

| File | Responsibility |
|---|---|
| `requirements.txt` | Python dependencies: pandas, NumPy, scikit-learn, XGBoost, FastAPI, Uvicorn, Joblib. |
| `.gitignore` | Excludes generated processed data and model binaries. |
| `main.py` | Command-line utility for doctor checks, metrics, forecasts, expiry, inventory, and exchange output. |
| `diagnose_windows.py` | Environment/import diagnostic, mainly for Windows path and model-loading problems. |
| `README.md` | Setup, training, serving, validation, and file guide. |

### Training files

| File | Responsibility |
|---|---|
| `training/generate_synthetic_data.py` | Reference-data library: hospitals, medicines, seasonality, specialties, dates, and demo accounts. It no longer runs the obsolete disconnected generator. |
| `training/generate_ledger_data.py` | Main event-driven simulation, batch ledger, raw outputs, full weekly grid, leakage-safe features, and serving snapshot. |
| `training/append_weeks.py` | Continues an existing simulation using current batches and pending orders, then rebuilds features. |
| `training/train_xgb.py` | Chronological splitting, training-only encoding, leakage audit, XGBoost training, baselines, metrics, loss history, and artifact saving. |
| `training/evaluate_model.py` | Produces the full regression evaluation pack: actual-vs-predicted, residual diagnostics, weekly backtest, regression calibration, baseline comparison, error bands, feature importance, loss curve, learning curve, and hospital metrics. |
| `training/demo_showcase.py` | Produces presentation/report CSVs for demo hospitals after data generation and training. |

### Service files

| File | Responsibility |
|---|---|
| `app/api/server.py` | FastAPI routes, health, model metrics, future forecasts, alerts, matching, and onboarding seed endpoint. |
| `app/services/forecast_services.py` | Loads the model, encodes rows, predicts, builds next-week features, and recursively forecasts future weeks. |
| `app/services/inventory_services.py` | Deterministic expiry, low-stock, surplus, and summary calculations. |
| `app/services/exchange_services.py` | Deterministic exchange ranking using stock, expiry, province, and distance. |
| `app/services/seed_service.py` | Generates starter history for a newly registered hospital and optionally persists it for serving. |
| `app/__init__.py`, `app/api/__init__.py`, `app/services/__init__.py` | Mark Python packages. |

### Tests

| File | Responsibility |
|---|---|
| `tests/test_feature_leakage.py` | Proves differences use only previous weeks and future rows have no observed target. |
| `tests/test_model_load.py` | Confirms saved model and encoders load. |
| `tests/test_forecast_smoke.py` | Confirms predictions are non-negative. |
| `tests/test_seed_service.py` | Confirms cold-start generation works without modifying production CSVs during tests. |

### Data folders

| Path | Responsibility |
|---|---|
| `data/raw/hospitals.csv` | Hospital reference snapshot. |
| `data/raw/medicines.csv` | Medicine reference snapshot. |
| `data/raw/transactions.csv` | Full event ledger; generated and normally Git-ignored. |
| `data/raw/inventory.csv` | Current batch-level source of truth. |
| `data/raw/inventory_state.csv` | Weekly pair-level state. |
| `data/raw/inventory_snapshots.csv` | Enriched compact snapshot for alert and matching services. |
| `data/raw/pending_arrivals.json` | Procurement orders not yet delivered. |
| `data/raw/demo_hospital_accounts.csv` | Demo account metadata. |
| `data/processed/demand_features.csv` | Final supervised-learning table; generated and Git-ignored. |
| `data/processed/by_hospital/*.csv` | Small per-hospital histories used by FastAPI so a request does not scan the full 184 MB feature table. |
| `data/external/` | Place for documented real external reference sources. Currently mostly documentation placeholders. |

### Artifact folders

| Path | Responsibility |
|---|---|
| `artifacts/models/xgb_demand_model.joblib` | Model bundle used by FastAPI. |
| `artifacts/models/xgb_demand_model.json` | Portable XGBoost model. |
| `artifacts/encoders/label_encoders.joblib` | Training-fitted category encoders. |
| `artifacts/encoders/feature_columns.json` | Exact feature order expected by the model. |
| `artifacts/metrics/training_metrics.json` | Machine-readable validation report. |
| `artifacts/metrics/TRAINING_REPORT.md` | Human-readable validation report. |
| `artifacts/metrics/feature_importance.csv` | Model feature importance. |
| `artifacts/metrics/test_predictions_sample.csv` | Sample untouched holdout predictions. |

### Notebooks

`notebooks/01_eda_nepal_demand.ipynb` and `02_model_results.ipynb` are currently empty placeholders. They do not participate in training or serving.

### Cross-service files outside `ml-service`

| File | Responsibility |
|---|---|
| `apps/retrain.sh` | Exports PostgreSQL movements, merges data, rebuilds features, and retrains. |
| `apps/backend/scripts/export_for_ml.js` | Converts PostgreSQL inventory movements to ledger-compatible CSV rows. |
| `apps/backend/src/services/mlClient.js` | Server-to-server HTTP client for FastAPI. |
| `apps/backend/src/services/demandForecast.service.js` | Chooses ML forecast or database fallback. |
| `apps/frontend/src/pages/DemandForecast.jsx` | Forecast page. |
| `apps/frontend/src/components/charts/DemandForecastChart.jsx` | Actual-versus-forecast chart. |

---

## 11. Exact commands

From `apps/ml-service`:

```bash
python3 -m pip install -r requirements.txt
python3 training/generate_ledger_data.py
python3 training/train_xgb.py
python3 training/evaluate_model.py
python3 -m pytest -q
python3 -m uvicorn app.api.server:app --host 0.0.0.0 --port 8000 --reload
```

Quick checks:

```bash
python3 main.py doctor
python3 main.py metrics
python3 main.py forecast --hospital HOSP-BG-001
```

Running `generate_synthetic_data.py` directly is intentionally disabled. It is a helper library; `generate_ledger_data.py` is the correct generator.

---

## 12. Remaining scientific limitations

The leakage and future-serving bugs are fixed, but limitations remain:

1. The historical data is simulated, not hospital-validated real usage.
2. Pooled R² is scale-dominated and should never be the only metric.
3. Low-volume individual medicine series remain noisy.
4. External outbreak, weather, procurement-policy, and epidemiological predictors are limited.
5. Recursive multi-week uncertainty grows with forecast horizon.
6. The API does not yet return formal prediction intervals.
7. Observed consumption can understate latent demand during stockouts; emergency/unmet demand should eventually be modelled separately.
8. A production system should retrain only after enough verified real consumption data accumulates and should version every deployed model.

The correct academic claim is: **the project now demonstrates a leakage-audited forecasting pipeline on a documented Nepal-context simulation, with chronological holdout testing and live application integration. It is not yet clinically or operationally validated on real hospital records.**
