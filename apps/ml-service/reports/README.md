# MedBridge ML reports

Small, committed outputs from the notebooks (large artifacts live in the git-ignored `artifacts/`).

- `model_comparison.csv` — hold-out metrics for every candidate model from
  `notebooks/02_model_comparison.ipynb`. XGBoost leads on R², MAE, and WAPE;
  linear models are catastrophic (negative R²) on this heavy-tailed demand data.

| Model | R² | MAE | WAPE % | train (s) |
|---|---:|---:|---:|---:|
| XGBoost | 0.9075 | 31.23 | 23.03 | 7.4 |
| HistGradientBoosting | 0.9063 | 31.38 | 23.14 | 5.8 |
| Random Forest | 0.9021 | 31.98 | 23.58 | 95.2 |
| Gradient Boosting | 0.9014 | 32.03 | 23.62 | 226.9 |
| Decision Tree | 0.8853 | 34.05 | 25.11 | 2.2 |
| Naive: 4-wk mean | 0.8717 | 35.89 | 26.47 | — |
| Naive: last week | 0.8439 | 41.26 | 30.43 | — |
| Ridge Regression | −109.15 | 195.04 | 143.83 | 0.5 |
| Linear Regression | −2215.93 | 477.03 | 351.80 | 0.2 |

> Comparison fits each model on a fixed 150k-row training sample; evaluation is always on the
> full 13-week chronological hold-out. The production XGBoost (notebook 03) trains on the full set.
