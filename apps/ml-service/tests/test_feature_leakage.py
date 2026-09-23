from datetime import date, timedelta

import pandas as pd

from training.generate_ledger_data import build_features_from_ledger


def test_differences_use_only_previous_weeks():
    start = date(2023, 1, 2)
    transactions = []
    for index in range(20):
        # Non-linear sequence makes current and lagged differences distinct.
        quantity = (index + 1) ** 2
        week = start + timedelta(weeks=index)
        transactions.append({
            "hospital_id": "H-1",
            "medicine_id": "M-1",
            "date": week.isoformat(),
            "type": "CONSUMPTION",
            "quantity": -quantity,
        })

    hospitals = pd.DataFrame([{
        "hospital_id": "H-1",
        "facility_type": "District_Hospital",
        "province": "Bagmati",
        "district": "Kathmandu",
        "ecoregion": "Hill",
        "urban_class": "Municipality",
        "bed_capacity": 50,
        "ownership": "public",
        "load_factor": 1.0,
        "urban_factor": 1.0,
        "is_referral": 0,
        "road_access_score": 0.8,
        "latitude": 27.7,
        "longitude": 85.3,
        "is_demo": 0,
    }])
    medicines = pd.DataFrame([{
        "medicine_id": "M-1",
        "generic_name": "Example",
        "category": "Analgesic",
        "dosage_form": "Tablet",
        "shelf_life_months": 24,
        "unit_cost_npr": 1.0,
        "requires_cold_chain": 0,
        "is_essential": 1,
        "base_demand_per_100_beds": 10.0,
        "abc_class": "B",
        "pack_size": 10,
    }])

    features = build_features_from_ledger(
        pd.DataFrame(transactions), hospitals, medicines
    ).sort_values("week_start")
    row = features.iloc[-1]

    # For forecast week t, lag_1 is y(t-1), lag_2 is y(t-2), and the
    # difference must be y(t-1)-y(t-2), never y(t)-y(t-1).
    assert row["diff_1w"] == row["lag_1w"] - row["lag_2w"]
    assert row["diff_1w"] != row["target_demand"] - row["lag_1w"]
    assert row["week_start"] > features.iloc[-2]["week_start"]


def test_future_row_is_after_history_and_has_no_observed_target():
    from app.services.forecast_services import build_next_week_features

    history = pd.DataFrame({
        "hospital_id": ["H-1"] * 5,
        "medicine_id": ["M-1"] * 5,
        "week_start": pd.date_range("2026-01-05", periods=5, freq="W-MON"),
        "target_demand": [10.0, 12.0, 15.0, 14.0, 20.0],
        "emergency_last_4w": [0] * 5,
        "exchange_in_last_4w": [0] * 5,
    })

    future = build_next_week_features(history).iloc[0]
    assert future["week_start"] == pd.Timestamp("2026-02-09")
    assert pd.isna(future["target_demand"])
    assert future["lag_1w"] == 20.0
    assert future["lag_2w"] == 14.0
    assert future["diff_1w"] == 6.0
