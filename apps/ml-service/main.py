"""
MedBridge ML Service entrypoint.

Run FROM apps/ml-service:
  python diagnose_windows.py
  python main.py doctor
  python main.py forecast --hospital HOSP-BG-003
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import traceback
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
# Ensure local package wins over any other installed "app"
sys.path = [str(ROOT)] + [p for p in sys.path if Path(p).resolve() != ROOT.resolve()]


def _load_module_from_path(module_name: str, file_path: Path) -> ModuleType:
    """Fallback loader when package import fails on Windows."""
    if not file_path.exists():
        raise FileNotFoundError(file_path)
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {file_path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    spec.loader.exec_module(mod)
    return mod


def import_forecast_service() -> ModuleType:
    """Import forecast service via package path, else direct file."""
    try:
        from app.services import forecast_services as mod  # type: ignore
        return mod
    except Exception as pkg_err:
        path = ROOT / "app" / "services" / "forecast_services.py"
        try:
            return _load_module_from_path("medbridge_forecast_service", path)
        except Exception as file_err:
            print("ERROR: Could not import forecast_service.\n")
            print("Package import error:")
            print(f"  {type(pkg_err).__name__}: {pkg_err}")
            print("Direct file import error:")
            print(f"  {type(file_err).__name__}: {file_err}")
            print(f"\nLooked for file:\n  {path}")
            print(f"Exists: {path.exists()}  Size: {path.stat().st_size if path.exists() else 0}")
            print("\nRun:\n  python diagnose_windows.py")
            raise SystemExit(1) from file_err


def import_inventory_service() -> ModuleType:
    try:
        from app.services import inventory_services as mod  # type: ignore
        return mod
    except Exception:
        path = ROOT / "app" / "services" / "inventory_services.py"
        return _load_module_from_path("medbridge_inventory_service", path)


def import_exchange_service() -> ModuleType:
    try:
        from app.services import exchange_services as mod  # type: ignore
        return mod
    except Exception:
        path = ROOT / "app" / "services" / "exchange_services.py"
        return _load_module_from_path("medbridge_exchange_service", path)


def cmd_doctor(_: argparse.Namespace) -> None:
    print("MedBridge ML doctor")
    print("ROOT:", ROOT)
    print("CWD :", Path.cwd())
    files = [
        ROOT / "app" / "__init__.py",
        ROOT / "app" / "services" / "__init__.py",
        ROOT / "app" / "services" / "forecast_services.py",
        ROOT / "app" / "services" / "inventory_services.py",
        ROOT / "app" / "services" / "exchange_services.py",
        ROOT / "data" / "processed" / "demand_features.csv",
        ROOT / "artifacts" / "models" / "xgb_demand_model.joblib",
    ]
    for p in files:
        if not p.exists():
            print(f"  [MISS] {p.relative_to(ROOT)}")
        elif p.stat().st_size == 0:
            print(f"  [EMPTY] {p.relative_to(ROOT)}")
        else:
            print(f"  [OK  ] {p.relative_to(ROOT)} ({p.stat().st_size} bytes)")

    try:
        mod = import_forecast_service()
        print("\nImport forecast_services: OK")
        print("  module file:", getattr(mod, "__file__", "?"))
        print("  batch_forecast:", hasattr(mod, "batch_forecast"))
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)

    print("\nIf data/model missing, run:")
    print("  python3 training/generate_ledger_data.py")
    print("  python3 training/train_xgb.py")
    print("\nDoctor import check passed")


def cmd_metrics(_: argparse.Namespace) -> None:
    path = ROOT / "artifacts" / "metrics" / "training_metrics.json"
    if not path.exists():
        print(f"Missing {path}. Run: python3 training/train_xgb.py")
        raise SystemExit(1)
    print(path.read_text(encoding="utf-8"))


def cmd_forecast(args: argparse.Namespace) -> None:
    import pandas as pd

    mod = import_forecast_service()
    next_week_forecast = mod.next_week_forecast

    feat_path = ROOT / "data" / "processed" / "demand_features.csv"
    if not feat_path.exists():
        print(f"Missing {feat_path}")
        print("Run: python3 training/generate_ledger_data.py")
        raise SystemExit(1)

    model_path = ROOT / "artifacts" / "models" / "xgb_demand_model.joblib"
    if not model_path.exists():
        print(f"Missing model {model_path}")
        print("Run: python3 training/train_xgb.py")
        raise SystemExit(1)

    feats = pd.read_csv(feat_path, parse_dates=["week_start"])
    if args.hospital:
        feats = feats[feats["hospital_id"] == args.hospital]
        if feats.empty:
            print(f"No rows for hospital_id={args.hospital}")
            print("Try HOSP-BG-001 .. HOSP-KR-002 (see hospitals.csv, is_demo=1 rows)")
            raise SystemExit(1)

    try:
        out = next_week_forecast(feats)
        latest = pd.to_datetime(out["week_start"]).max()
    except Exception:
        print("Forecast failed while predicting:\n")
        traceback.print_exc()
        print("\nRun: python diagnose_windows.py")
        raise SystemExit(1)

    if args.top:
        out = out.sort_values("predicted_demand", ascending=False).head(args.top)

    cols = [
        c
        for c in [
            "hospital_id",
            "medicine_id",
            "generic_name",
            "category",
            "predicted_demand",
        ]
        if c in out.columns
    ]
    print(out[cols].to_string(index=False))
    latest_s = latest.date() if hasattr(latest, "date") else latest
    print(f"\nweek={latest_s} rows={len(out)}")


def cmd_expiry(args: argparse.Namespace) -> None:
    inv = import_inventory_service()
    df = inv.expiry_alerts(within_days=args.days, hospital_id=args.hospital)
    cols = [
        c
        for c in [
            "hospital_id",
            "hospital_name",
            "generic_name",
            "quantity_units",
            "days_to_expiry_calc",
            "alert_level",
            "estimated_waste_value_npr",
        ]
        if c in df.columns
    ]
    print(df[cols].head(args.top).to_string(index=False))
    print(f"\ntotal_alerts={len(df)}")


def cmd_exchange(args: argparse.Namespace) -> None:
    ex = import_exchange_service()
    if args.demo:
        df = ex.demo_exchange_plan(top_k=args.top)
    else:
        df = ex.suggest_matches(
            requesting_hospital_id=args.hospital,
            medicine_id=args.medicine,
            top_k=args.top,
        )
    if df is None or getattr(df, "empty", True):
        print("No matches found.")
        return
    print(df.head(args.top).to_string(index=False))


def cmd_inventory(args: argparse.Namespace) -> None:
    inv = import_inventory_service()
    summary = inv.hospital_inventory_summary(args.hospital)
    print(json.dumps(summary, indent=2))
    low = inv.low_stock_alerts(hospital_id=args.hospital)
    if len(low):
        print("\nLow stock:")
        print(low.head(15).to_string(index=False))


def main() -> None:
    p = argparse.ArgumentParser(description="MedBridge ML Service CLI")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("doctor", help="Check files + imports")
    sub.add_parser("metrics", help="Print training metrics JSON")

    f = sub.add_parser("forecast", help="Forecast demand for latest week")
    f.add_argument("--hospital", default=None)
    f.add_argument("--top", type=int, default=20)

    e = sub.add_parser("expiry", help="Near-expiry alerts")
    e.add_argument("--hospital", default=None)
    e.add_argument("--days", type=int, default=90)
    e.add_argument("--top", type=int, default=30)

    x = sub.add_parser("exchange", help="Suggest resource exchanges")
    x.add_argument("--hospital", default=None)
    x.add_argument("--medicine", default=None)
    x.add_argument("--demo", action="store_true")
    x.add_argument("--top", type=int, default=20)

    inv = sub.add_parser("inventory", help="Hospital inventory summary")
    inv.add_argument("--hospital", required=True)

    args = p.parse_args()
    {
        "doctor": cmd_doctor,
        "metrics": cmd_metrics,
        "forecast": cmd_forecast,
        "expiry": cmd_expiry,
        "exchange": cmd_exchange,
        "inventory": cmd_inventory,
    }[args.cmd](args)


if __name__ == "__main__":
    main()