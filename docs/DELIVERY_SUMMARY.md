# MedBridge ML — Delivery Summary

Supervisor-style review and rework of the ML layer, based on the **Samir** branch dataset,
published as a clean, conflict-free branch ready to merge.

---

## 1. What was delivered

| Item | Location | Status |
|---|---|---|
| Extracted Samir dataset + pipeline | `apps/ml-service/training/` | ✅ deterministic regeneration |
| 4 executed Jupyter notebooks | `apps/ml-service/notebooks/` | ✅ committed **with outputs** |
| Model comparison (7 models + 2 baselines) | `notebooks/02_…`, `reports/model_comparison.csv` | ✅ XGBoost wins |
| Production XGBoost training | `notebooks/03_…`, `training/train_xgb.py` | ✅ R² = 0.9085 |
| End-to-end forecast integration | FastAPI → backend `mlClient.js` → React chart | ✅ verified live |
| Conflict-free branch | `feature/ml-notebooks-and-integration` | ✅ 4 clean commits |

---

## 2. The decision the notebooks make for you

`notebooks/02_model_comparison.ipynb` benchmarks every candidate on the **same chronological
hold-out** (last 13 weeks untouched, log1p target, leak-audited features). Result:

| Model | R² | MAE | WAPE % | Train time |
|---|---:|---:|---:|---:|
| **XGBoost** ✅ | **0.9075** | **31.23** | **23.03** | 7 s |
| HistGradientBoosting | 0.9063 | 31.38 | 23.14 | 6 s |
| Random Forest | 0.9021 | 31.98 | 23.58 | 95 s |
| Gradient Boosting | 0.9014 | 32.03 | 23.62 | 227 s |
| Decision Tree | 0.8853 | 34.05 | 25.11 | 2 s |
| Naive: 4-week mean | 0.8717 | 35.89 | 26.47 | — |
| Naive: last week | 0.8439 | 41.26 | 30.43 | — |
| Ridge Regression | −109.15 | 195.04 | 143.83 | 0.5 s |
| Linear Regression | −2215.93 | 477.03 | 351.80 | 0.2 s |

**Why the graphs point to XGBoost:**
- **Linear / Ridge are catastrophic** (negative R²): demand is non-linear, and the `log1p → expm1`
  round-trip amplifies any log-space error exponentially on this heavy-tailed data. Even their
  log-space R² (0.65–0.78) is far below XGBoost's 0.95.
- **Decision Tree overfits** (high variance on hold-out).
- **Random Forest** averages trees, smoothing the sharp seasonal peaks — slightly worse *and* ~13× slower.
- **XGBoost** wins on R², MAE, and WAPE with the best bias–variance trade-off (regularisation +
  column subsampling + early stopping on validation).

Notebooks 03 and 04 add learning curves, feature importance, residual/error analysis, per-hospital
and per-category accuracy, and a live 8-week recursive forecast — the exact path the API serves.

---

## 3. Validation (leak-audited, chronological hold-out)

- Test pooled **R² = 0.9085**, **MAE = 31.07 units**, **WAPE = 22.91 %**
- Hospital-week aggregate R² = **0.990**; Medicine-week aggregate R² = **0.983**
- Beats all naive baselines (last-week / 4-week mean / EWM)
- 7/7 `pytest` tests pass, including the **feature-leakage guard**

> The old ~0.99 result was invalid — `diff_1w` leaked the current week's demand. Fixed; no noise
> was added just to lower the score.

---

## 4. Integration (verified live)

Started the FastAPI service and confirmed every endpoint:

- `GET /health` → `ok`, model loaded, test metrics exposed
- `GET /forecast/chart?hospital_id=HOSP-BG-003` → 6 months history backtest **+ 8-week recursive future forecast**
- `GET /forecast`, `/expiry`, `/low-stock`, `/inventory/summary`, `/exchange/suggest`, `/hospitals`, `/medicines`, `/metrics` → all healthy

The backend (`mlClient.js` → `demandForecast.service.js`) and React chart were already wired to this
contract, so **no backend/frontend code needed changing** — the improved model slots straight in.

---

## 5. Merge-conflict resolution

The conflict root-cause was the **committed 30 MB `inventory_state.csv`** (and friends) being
modified on Samir's branch and deleted on Sushil's. Fixed by:

- Git-ignoring **all** generated data (`data/raw/*`, `data/processed/`, `artifacts/`) — they are
  deterministic outputs of `generate_ledger_data.py`.
- Untracking the committed CSVs, `.pyc` caches, and `XGBOOST_TUNING_CONSOLE.log`.
- Pulling in **only the ML layer** from Samir (no audit/backend/frontend changes), avoiding the
  conflicts those introduced.

Verified a clean merge into `main` **and** the `Sushil` publish path (both fast-forward, no conflicts).

---

## 6. Commits

```
6208d8d docs: point quickstart at the real pipeline entrypoint
1e6d148 feat(ml): add executed Jupyter notebooks (EDA, comparison, training, evaluation)
78f7f6a chore(ml): gitignore regenerable datasets + artifacts, drop committed CSVs
deba89f feat(ml): bring in Samir's ledger-based ML pipeline
```

## 7. To publish from your Sushil branch

```bash
git fetch origin
git checkout Sushil
git merge main                                   # fast-forward (Sushil is behind main)
git merge feature/ml-notebooks-and-integration   # clean, no conflicts
git push origin Sushil
```

(Or open a PR from `feature/ml-notebooks-and-integration` straight into `main`.)
