from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_trained_model_bundle_loads():
    pytest.importorskip("joblib")
    pytest.importorskip("xgboost")
    from app.services.forecast_services import load_bundle

    model_path = ROOT / "artifacts" / "models" / "xgb_demand_model.joblib"
    encoder_path = ROOT / "artifacts" / "encoders" / "label_encoders.joblib"
    assert model_path.stat().st_size > 0
    assert encoder_path.stat().st_size > 0

    load_bundle.cache_clear()
    bundle = load_bundle()
    assert bundle["model"] is not None
    assert bundle["feature_columns"]
    assert bundle["encoders"]
