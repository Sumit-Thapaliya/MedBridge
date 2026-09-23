#!/usr/bin/env python3
"""
Windows-friendly diagnostic for MedBridge ML import/forecast issues.

Run FROM apps/ml-service:
  python diagnose_windows.py
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def banner(t: str) -> None:
    print("\n" + "=" * 60)
    print(t)
    print("=" * 60)


def main() -> int:
    print("MedBridge diagnose_windows")
    print("Python :", sys.version)
    print("ROOT   :", ROOT)
    print("CWD    :", Path.cwd())
    print("sys.path[0:5]:")
    for p in sys.path[:5]:
        print("  ", p)

    if Path.cwd().resolve() != ROOT.resolve():
        print("\nWARNING: CWD is not apps/ml-service. Prefer:")
        print(f'  cd "{ROOT}"')

    banner("1) Critical files")
    critical = [
        "main.py",
        "app/__init__.py",
        "app/services/__init__.py",
        "app/services/forecast_service.py",
        "app/services/inventory_service.py",
        "app/services/exchange_service.py",
        "data/processed/demand_features.csv",
        "artifacts/models/xgb_demand_model.joblib",
        "artifacts/encoders/label_encoders.joblib",
    ]
    all_files_ok = True
    for rel in critical:
        p = ROOT / rel
        if not p.exists():
            print(f"  [MISS ] {rel}")
            all_files_ok = False
        elif p.stat().st_size == 0:
            print(f"  [EMPTY] {rel}")
            all_files_ok = False
        else:
            # detect UTF-16 BOM (common Notepad mistake on Windows)
            head = p.read_bytes()[:4]
            bom = ""
            if head.startswith(b"\xff\xfe") or head.startswith(b"\xfe\xff"):
                bom = "  ** UTF-16 BOM (bad for Python) **"
                all_files_ok = False
            elif head.startswith(b"\xef\xbb\xbf") and rel.endswith(".py"):
                bom = "  (UTF-8 BOM — usually OK)"
            print(f"  [OK   ] {rel:45} {p.stat().st_size:8} bytes{bom}")
            if rel.endswith("forecast_service.py"):
                text = p.read_text(encoding="utf-8", errors="replace")
                for needle in ("def batch_forecast", "def predict_demand", "def load_bundle"):
                    print(f"           contains {needle}: {needle in text}")

    banner("2) Shadowing check (is another 'app' winning?)")
    # put ROOT first like main.py
    if str(ROOT) in sys.path:
        sys.path.remove(str(ROOT))
    sys.path.insert(0, str(ROOT))
    try:
        import app
        print("  import app ->", getattr(app, "__file__", app))
        print("  app package path:", list(getattr(app, "__path__", [])))
    except Exception as e:
        print("  import app FAILED:", type(e).__name__, e)

    banner("3) Import app.services.forecast_service")
    try:
        mod = importlib.import_module("app.services.forecast_service")
        print("  SUCCESS:", mod.__file__)
        print("  has batch_forecast:", hasattr(mod, "batch_forecast"))
    except Exception:
        print("  FAILED package import:")
        traceback.print_exc()
        print("\n  Trying direct file import via importlib...")
        fpath = ROOT / "app" / "services" / "forecast_service.py"
        if fpath.exists():
            try:
                spec = importlib.util.spec_from_file_location("forecast_service_direct", fpath)
                assert spec and spec.loader
                dmod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(dmod)
                print("  DIRECT FILE IMPORT SUCCESS")
                print("  has batch_forecast:", hasattr(dmod, "batch_forecast"))
            except Exception:
                print("  DIRECT FILE IMPORT ALSO FAILED:")
                traceback.print_exc()
        else:
            print("  file missing:", fpath)

    banner("4) Dependencies")
    for name in ("pandas", "numpy", "joblib", "sklearn", "xgboost"):
        try:
            m = importlib.import_module(name)
            ver = getattr(m, "__version__", "?")
            print(f"  [OK] {name} {ver}")
        except Exception as e:
            print(f"  [NO] {name}: {e}")

    banner("5) Load model + tiny predict (if possible)")
    try:
        from app.services.forecast_services import batch_forecast, MODEL_PATH, ROOT as FROOT
        print("  forecast ROOT:", FROOT)
        print("  MODEL_PATH exists:", MODEL_PATH.exists(), MODEL_PATH)
        feat = ROOT / "data" / "processed" / "demand_features.csv"
        if not feat.exists():
            print("  skip predict: demand_features.csv missing")
            print("  run: python3 training/generate_ledger_data.py")
        elif not MODEL_PATH.exists():
            print("  skip predict: model missing")
            print("  run: python3 training/train_xgb.py")
        else:
            import pandas as pd
            df = pd.read_csv(feat, parse_dates=["week_start"])
            df = df[df["hospital_id"] == "HOSP-BG-003"]
            if df.empty:
                df = pd.read_csv(feat, parse_dates=["week_start"])
            latest = df["week_start"].max()
            rows = df[df["week_start"] == latest].head(3)
            out = batch_forecast(rows)
            cols = [c for c in ["hospital_id", "medicine_id", "target_demand", "predicted_demand"] if c in out.columns]
            print(out[cols].to_string(index=False))
            print("  PREDICT OK")
    except Exception:
        print("  PREDICT FAILED:")
        traceback.print_exc()

    banner("SUMMARY")
    print("If step 3 package import fails but files exist, common causes:")
    print("  - wrong folder (code not under app\\services\\)")
    print("  - missing app\\services\\__init__.py")
    print("  - file saved as .txt or UTF-16")
    print("  - another package named app earlier on sys.path")
    print("  - syntax error inside forecast_service.py")
    print("\nRe-run after fixes. Share the FULL output of this script if still broken.")
    return 0 if all_files_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())