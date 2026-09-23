# apps/ml-service/tests/test_seed_service.py
import pytest


def test_seed_hospital_history_produces_usable_data():
    from app.services.seed_service import seed_hospital_history

    result = seed_hospital_history({
        "hospital_id": "TEST-HOSP-999",
        "facility_type": "District_Hospital",
        "province": "Bagmati",
        "district": "Chitwan",
        "bed_capacity": 80,
    }, weeks_of_history=8, persist=False)

    assert result["weeks_generated"] >= 8  # Monday-alignment can add a week, that's fine
    assert result["transaction_count"] > 0
    assert result["batch_count"] > 0

    # Every transaction should belong to the hospital we asked for
    assert all(tx["hospital_id"] == "TEST-HOSP-999" for tx in result["transactions"])

    # At least one CONSUMPTION event should exist — otherwise the dashboard
    # would have nothing to show, defeating the whole point of seeding
    types_seen = {tx["type"] for tx in result["transactions"]}
    assert "CONSUMPTION" in types_seen


def test_seed_hospital_history_works_with_minimal_attributes():
    """Confirms DEFAULTS fill in correctly when the signup form only
    collects the bare minimum fields."""
    from app.services.seed_service import seed_hospital_history

    result = seed_hospital_history({
        "hospital_id": "TEST-HOSP-MINIMAL",
        "facility_type": "District_Hospital",
        "province": "Koshi",
        "district": "Morang",
        "bed_capacity": 50,
    }, weeks_of_history=4, persist=False)

    assert result["transaction_count"] > 0