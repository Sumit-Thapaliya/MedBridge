"""
Resource exchange matcher: surplus hospital → shortage hospital by distance, priority, expiry.
"""

from __future__ import annotations

import math
from pathlib import Path

import pandas as pd

from app.services.inventory_services import (
    load_hospitals,
    load_inventory,
    load_medicines,
    low_stock_alerts,
    surplus_stock,
)

ROOT = Path(__file__).resolve().parents[2]


def haversine(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def suggest_matches(
    requesting_hospital_id: str | None = None,
    medicine_id: str | None = None,
    demo_only: bool = False,
    top_k: int = 20,
) -> pd.DataFrame:
    """
    Match low-stock needs with surplus holders.
    Score favors: same medicine, shorter distance, nearer expiry on donor (redistribute before waste), same province.
    """
    hospitals = load_hospitals()
    if demo_only:
        hospitals = hospitals[hospitals["is_demo"] == 1]

    low = low_stock_alerts()
    sur = surplus_stock(min_cover_days=35)

    if requesting_hospital_id:
        low = low[low["hospital_id"] == requesting_hospital_id]
    if medicine_id:
        low = low[low["medicine_id"] == medicine_id]
        sur = sur[sur["medicine_id"] == medicine_id]

    # restrict to hospital set
    allowed = set(hospitals["hospital_id"])
    low = low[low["hospital_id"].isin(allowed)]
    sur = sur[sur["hospital_id"].isin(allowed)]

    hloc = hospitals.set_index("hospital_id")[["latitude", "longitude", "province", "hospital_name", "facility_type"]]

    rows = []
    for _, need in low.iterrows():
        donors = sur[sur["medicine_id"] == need["medicine_id"]]
        donors = donors[donors["hospital_id"] != need["hospital_id"]]
        if donors.empty:
            continue
        try:
            nlat, nlon = hloc.loc[need["hospital_id"], ["latitude", "longitude"]]
            nprov = hloc.loc[need["hospital_id"], "province"]
        except KeyError:
            continue

        for _, d in donors.iterrows():
            try:
                dlat, dlon = hloc.loc[d["hospital_id"], ["latitude", "longitude"]]
                dprov = hloc.loc[d["hospital_id"], "province"]
            except KeyError:
                continue
            dist = haversine(float(nlat), float(nlon), float(dlat), float(dlon))
            same_prov = int(nprov == dprov)
            # higher score better
            expiry_urgency = 1.0 / max(1.0, float(d.get("nearest_expiry", 90)))
            cover_extra = max(0.0, float(d["days_of_cover"]) - 35.0)
            score = (
                100.0
                - dist * 0.15
                + same_prov * 15.0
                + expiry_urgency * 80.0
                + min(cover_extra, 40) * 0.4
            )
            transfer_qty = int(min(
                d["quantity_units"] * 0.25,
                max(need["reorder_level"] * 2 - need["quantity_units"], 10),
            ))
            if transfer_qty <= 0:
                continue
            rows.append({
                "from_hospital_id": d["hospital_id"],
                "from_hospital_name": hloc.loc[d["hospital_id"], "hospital_name"],
                "to_hospital_id": need["hospital_id"],
                "to_hospital_name": hloc.loc[need["hospital_id"], "hospital_name"],
                "medicine_id": need["medicine_id"],
                "generic_name": need.get("generic_name"),
                "category": need.get("category"),
                "suggested_qty": transfer_qty,
                "distance_km": round(dist, 1),
                "same_province": same_prov,
                "donor_days_of_cover": round(float(d["days_of_cover"]), 1),
                "donor_nearest_expiry_days": d.get("nearest_expiry"),
                "need_days_of_cover": round(float(need["days_of_cover"]), 2) if pd.notna(need["days_of_cover"]) else None,
                "match_score": round(score, 2),
                "priority": "Emergency" if (need["days_of_cover"] or 0) < 5 else (
                    "High" if (need["days_of_cover"] or 0) < 10 else "Normal"
                ),
            })

    if not rows:
        return pd.DataFrame()
    out = pd.DataFrame(rows).sort_values("match_score", ascending=False)
    return out.head(top_k)


def demo_exchange_plan(top_k: int = 30) -> pd.DataFrame:
    """Exchange suggestions limited to the 8 demo hospitals."""
    return suggest_matches(demo_only=True, top_k=top_k)