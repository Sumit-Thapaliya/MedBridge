#!/usr/bin/env python3
"""
MedBridge -- event-driven inventory ledger simulation, batch-level, policy-driven.

Every ordering/spoilage/lead-time decision below is driven by a REAL column
from hospitals.csv / medicines.csv -- nothing is a flat constant applied to
every pair the same way:

  pack_size            -> every order and every safety-stock level is rounded
                           to a whole number of packs (no "137.4 tablets")
  abc_class             -> sets safety-stock multiplier AND how aggressively
                           a hospital re-orders (A = tight/frequent, C = bulk)
  unit_cost_npr          -> feeds into abc_class already (kept, not re-used
                           redundantly -- see note in build_pairs)
  road_access_score     -> sets PROCUREMENT LEAD TIME (0-3 weeks). Orders no
                           longer materialize the same week they're placed;
                           they sit in a pending-arrivals queue and land on
                           the correct future week. Persisted to
                           pending_arrivals.json so append_weeks.py can
                           resume without losing in-transit orders.
  requires_cold_chain   -> combined with road_access_score gives a weekly
                           spoilage risk on top of normal expiry-date
                           write-offs (a cold-chain vaccine sitting in a
                           Mountain district with poor road access can go
                           bad before its printed expiry date)

Produces THREE files:
  transactions.csv    -- every stock-changing event, chronologically sorted
                          by a real event_time (not grouped by hospital).
                          Types: CONSUMPTION / PROCUREMENT_ORDERED /
                          PROCUREMENT / EXCHANGE_OUT / EXCHANGE_IN /
                          EXPIRY_WRITEOFF / EMERGENCY_REQUEST
  inventory.csv        -- CURRENT batch-level snapshot (as of END_DATE)
  inventory_state.csv  -- weekly aggregate balance per (hospital, medicine)

  pending_arrivals.json -- in-transit orders not yet received; resumable
                            state for append_weeks.py

hospitals.csv and medicines.csv are UNCHANGED.

Run from apps/ml-service/:
    python training/generate_ledger_data.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from datetime import date, timedelta

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_synthetic_data import (  # noqa: E402
    build_hospitals,
    build_medicines,
    specialty_mult,
    CATEGORY_SEASON,
    ECOREGION_PRESSURE,
    SEASONAL_BASE,
    festival_boost_month_day,
    week_starts,
    write_demo_accounts,
    START_DATE,
    END_DATE,
)

RNG = np.random.default_rng(7)

ROOT = Path(__file__).resolve().parents[1]
OUT_RAW = ROOT / "data" / "raw"
OUT_PROCESSED = ROOT / "data" / "processed"

SUPPLIERS = [
    "DoDA Logistics", "Nepal CMS", "Provincial Medical Store",
    "Private Distributor - Kathmandu", "UNICEF Supply",
    "Local Pharmacy Wholesaler", "BPKMCH Pharmacy Store", "Kanti Central Store",
]

# ABC classification -> ordering POLICY, not just a label.
# A = high value/critical: tight safety stock ceiling relative to reorder
#     point, but re-orders sooner and in smaller increments (closer to
#     just-in-time, since holding costly stock is expensive).
# C = low value/bulk: cheaper to hold, ordered less often but in bigger lots.
ABC_POLICY = {
    "A": {"safety_mult": 1.35, "order_target_mult": 1.8},
    "B": {"safety_mult": 1.00, "order_target_mult": 2.3},
    "C": {"safety_mult": 0.75, "order_target_mult": 3.0},
}


def round_up_to_pack(qty: float, pack_size: int) -> int:
    pack_size = max(1, int(pack_size))
    if qty <= 0:
        return 0
    return int(np.ceil(qty / pack_size) * pack_size)


def lead_time_weeks_from_access(road_access_score: float) -> int:
    """Good roads (Terai, score ~0.95) -> same-week delivery.
    Poor roads (remote Mountain, score ~0.3-0.4) -> up to 3 weeks."""
    raw = (1.0 - float(road_access_score)) * 3.0
    return int(np.clip(round(raw), 0, 3))


def cold_chain_spoil_prob(requires_cold_chain: int, road_access_score: float) -> float:
    """Weekly probability of an early (pre-expiry) spoilage event for a
    cold-chain-dependent item at a poor-road-access facility."""
    if not requires_cold_chain:
        return 0.0
    return float(np.clip(0.05 * (1.0 - float(road_access_score)), 0.0, 0.04))


def build_pairs(hospitals: pd.DataFrame, medicines: pd.DataFrame) -> pd.DataFrame:
    h, m = hospitals.copy(), medicines.copy()
    h["_k"] = 1
    m["_k"] = 1
    pairs = h.merge(m, on="_k").drop(columns="_k").reset_index(drop=True)
    pairs["affinity"] = RNG.normal(1.0, 0.10, len(pairs)).clip(0.65, 1.45)
    pairs["spec_mult"] = [
        specialty_mult(ft, cat) for ft, cat in zip(pairs["facility_type"], pairs["category"])
    ]
    pairs["daily_base"] = (
        pairs["base_demand_per_100_beds"] * (pairs["bed_capacity"] / 100.0)
        * pairs["load_factor"] * pairs["urban_factor"]
        * pairs["affinity"] * pairs["spec_mult"]
    )

    # --- ABC-policy-driven, pack-size-rounded reorder level (safety stock) ---
    abc_safety = pairs["abc_class"].map(lambda c: ABC_POLICY.get(c, ABC_POLICY["B"])["safety_mult"])
    abc_order_target = pairs["abc_class"].map(lambda c: ABC_POLICY.get(c, ABC_POLICY["B"])["order_target_mult"])
    pairs["abc_safety_mult"] = abc_safety.astype(float)
    pairs["abc_order_target_mult"] = abc_order_target.astype(float)

    base_reorder = np.maximum(3.0, pairs["daily_base"] * 10.0)
    pairs["reorder_level"] = [
        max(1, round_up_to_pack(qty * mult, pack))
        for qty, mult, pack in zip(base_reorder, pairs["abc_safety_mult"], pairs["pack_size"])
    ]

    # --- road-access-driven procurement lead time ---
    pairs["lead_time_weeks"] = pairs["road_access_score"].map(lead_time_weeks_from_access).astype(int)

    # --- cold-chain + poor-access -> weekly spoilage risk ---
    pairs["cold_spoil_prob"] = [
        cold_chain_spoil_prob(cc, ras)
        for cc, ras in zip(pairs["requires_cold_chain"], pairs["road_access_score"])
    ]

    pairs["shelf_life_months"] = pairs["shelf_life_months"].astype(int)
    pairs["pack_size"] = pairs["pack_size"].astype(int)
    return pairs


def weekly_multiplier(week_start: pd.Timestamp, ecoregion: np.ndarray, category: np.ndarray,
                       facility_type: np.ndarray, is_referral: np.ndarray) -> np.ndarray:
    month = week_start.month
    day = week_start.day
    seasonal = SEASONAL_BASE.get(month, 1.0)
    festival = festival_boost_month_day(month, day)
    cat_season = np.array([CATEGORY_SEASON.get(c, {}).get(month, 1.0) for c in category])
    eco_cat = np.array([ECOREGION_PRESSURE.get(e, {}).get(c, 1.0) for e, c in zip(ecoregion, category)])
    mult = seasonal * festival * cat_season * eco_cat
    mult = np.where(is_referral == 1, 1.0 + (mult - 1.0) * 0.85, mult)
    return mult


class BatchLedger:
    """One FIFO batch list + one pending-arrivals queue per (hospital,
    medicine) pair, indexed by pair position. Both are the resumable state
    that append_weeks.py needs to continue a run correctly."""

    def __init__(self, n_pairs: int):
        self.batches: list[list[dict]] = [[] for _ in range(n_pairs)]
        self.pending: list[list[dict]] = [[] for _ in range(n_pairs)]
        self._batch_seq = 0

    def new_batch_no(self) -> str:
        self._batch_seq += 1
        return f"BATCH-{self._batch_seq:07d}"

    def balance(self, i: int) -> int:
        return sum(b["qty"] for b in self.batches[i])

    def add_batch(self, i: int, qty: int, manufacture_date: date, shelf_life_months: int) -> str:
        batch_no = self.new_batch_no()
        expiry = manufacture_date + timedelta(days=int(shelf_life_months * 30.44))
        self.batches[i].append({
            "batch_no": batch_no, "qty": int(qty),
            "manufacture_date": manufacture_date, "expiry_date": expiry,
        })
        return batch_no

    def queue_pending(self, i: int, qty: int, order_date: date, arrival_date: date, shelf_life_months: int):
        self.pending[i].append({
            "qty": int(qty), "order_date": order_date, "arrival_date": arrival_date,
            "shelf_life_months": int(shelf_life_months),
        })

    def receive_ready(self, i: int, as_of: date) -> list[tuple[str, int]]:
        """Materializes any pending order whose arrival_date has come, turning
        it into a real batch. Returns [(batch_no, qty), ...] received."""
        ready = [p for p in self.pending[i] if p["arrival_date"] <= as_of]
        if not ready:
            return []
        self.pending[i] = [p for p in self.pending[i] if p["arrival_date"] > as_of]
        received = []
        for p in ready:
            manuf = as_of - timedelta(days=int(RNG.integers(0, 3)))
            batch_no = self.add_batch(i, p["qty"], manuf, p["shelf_life_months"])
            received.append((batch_no, p["qty"]))
        return received

    def consume_fifo(self, i: int, qty_needed: int):
        # FEFO (first-expiry-first-out) is safer for medicines than simple
        # first-manufactured-first-out and directly reduces avoidable waste.
        self.batches[i].sort(key=lambda batch: batch["expiry_date"])
        taken = []
        remaining = qty_needed
        for b in self.batches[i]:
            if remaining <= 0:
                break
            take = min(b["qty"], remaining)
            if take <= 0:
                continue
            b["qty"] -= take
            remaining -= take
            taken.append((b["batch_no"], take))
        self.batches[i] = [b for b in self.batches[i] if b["qty"] > 0]
        return taken, remaining

    def expire_batches(self, i: int, as_of: date):
        writeoffs = []
        keep = []
        for b in self.batches[i]:
            if b["expiry_date"] <= as_of and b["qty"] > 0:
                writeoffs.append((b["batch_no"], b["qty"]))
            else:
                keep.append(b)
        self.batches[i] = keep
        return writeoffs

    def spoil_batch(self, i: int, fraction: float) -> tuple[str, int] | None:
        """Removes `fraction` of the OLDEST open batch early (cold-chain
        failure). Returns (batch_no, qty_lost) or None if nothing to spoil."""
        if not self.batches[i]:
            return None
        self.batches[i].sort(key=lambda b: b["manufacture_date"])
        b = self.batches[i][0]
        lost = max(1, int(round(b["qty"] * fraction)))
        lost = min(lost, b["qty"])
        b["qty"] -= lost
        if b["qty"] <= 0:
            self.batches[i] = [x for x in self.batches[i] if x is not b]
        return b["batch_no"], lost

    # ---- serialization for pending_arrivals.json (native python types only) ----
    def pending_to_jsonable(self, pair_ids: list[tuple[str, str]]) -> dict:
        out = {}
        for i, plist in enumerate(self.pending):
            if not plist:
                continue
            hid, mid = pair_ids[i]
            out[f"{hid}|{mid}"] = [
                {
                    "qty": int(p["qty"]),
                    "order_date": p["order_date"].isoformat(),
                    "arrival_date": p["arrival_date"].isoformat(),
                    "shelf_life_months": int(p["shelf_life_months"]),
                }
                for p in plist
            ]
        return out

    def load_pending_from_json(self, data: dict, pair_index: dict[tuple[str, str], int]):
        for key, plist in data.items():
            hid, mid = key.split("|", 1)
            i = pair_index.get((hid, mid))
            if i is None:
                continue
            for p in plist:
                self.pending[i].append({
                    "qty": int(p["qty"]),
                    "order_date": date.fromisoformat(p["order_date"]),
                    "arrival_date": date.fromisoformat(p["arrival_date"]),
                    "shelf_life_months": int(p["shelf_life_months"]),
                })


def run_simulation(hospitals: pd.DataFrame, medicines: pd.DataFrame,
                    weeks: pd.DatetimeIndex | None = None,
                    ledger: BatchLedger | None = None,
                    start_tx_id: int = 0):
    pairs = build_pairs(hospitals, medicines)
    n = len(pairs)
    if weeks is None:
        weeks = week_starts(START_DATE, END_DATE)
    print(f"Simulating {n} hospital-medicine pairs across {len(weeks)} weeks "
          f"({n * len(weeks):,} pair-weeks), batch-level, policy-driven...")

    ecoregion = pairs["ecoregion"].to_numpy()
    category = pairs["category"].to_numpy()
    facility_type = pairs["facility_type"].to_numpy()
    is_referral = pairs["is_referral"].to_numpy()
    hospital_id = pairs["hospital_id"].to_numpy()
    medicine_id = pairs["medicine_id"].to_numpy()
    province = pairs["province"].to_numpy()
    daily_base = pairs["daily_base"].to_numpy()
    reorder_level = pairs["reorder_level"].to_numpy()
    shelf_life_months = pairs["shelf_life_months"].to_numpy()
    pack_size = pairs["pack_size"].to_numpy()
    order_target_mult = pairs["abc_order_target_mult"].to_numpy()
    lead_time_weeks = pairs["lead_time_weeks"].to_numpy()
    cold_spoil_prob = pairs["cold_spoil_prob"].to_numpy()
    pair_ids = list(zip(pairs["hospital_id"].tolist(), pairs["medicine_id"].tolist()))

    if ledger is None:
        ledger = BatchLedger(n)
        for i in range(n):
            start_qty = max(1, int(daily_base[i] * 7 * RNG.uniform(1.5, 3.5)))
            start_qty = round_up_to_pack(start_qty, pack_size[i])
            manuf = weeks[0].date() - timedelta(weeks=int(RNG.integers(0, 6)))
            ledger.add_batch(i, start_qty, manuf, int(shelf_life_months[i]))

    disruption_left = np.zeros(n, dtype=int)
    shock_left = np.zeros(n, dtype=int)

    transactions: list[dict] = []
    inventory_rows: list[dict] = []

    def rand_event_time(wk_date: date) -> str:
        offset_days = int(RNG.integers(0, 7))
        h = int(RNG.integers(6, 20))
        mi = int(RNG.integers(0, 60))
        dt = pd.Timestamp(wk_date) + pd.Timedelta(days=offset_days, hours=h, minutes=mi)
        return dt.isoformat()

    for week_start in weeks:
        wk_date = week_start.date()
        wk_str = wk_date.isoformat()
        wk_mult = weekly_multiplier(week_start, ecoregion, category, facility_type, is_referral)

        new_disruption = (disruption_left == 0) & (RNG.random(n) < 0.0025)
        disruption_left = np.where(new_disruption, RNG.integers(4, 9, n), disruption_left)
        new_shock = (shock_left == 0) & (RNG.random(n) < 0.0035)
        shock_left = np.where(new_shock, RNG.integers(1, 4, n), shock_left)
        disruption_mult = np.where(disruption_left > 0, RNG.uniform(0.25, 0.55, n), 1.0)
        shock_mult = np.where(shock_left > 0, RNG.uniform(1.8, 3.2, n), 1.0)

        mu = daily_base * 7.0 * wk_mult * disruption_mult * shock_mult
        rel_noise_sigma = np.clip(0.35 - 0.02 * np.log1p(mu), 0.12, 0.45)
        noise = RNG.lognormal(mean=0.0, sigma=rel_noise_sigma)
        desired = np.maximum(0.0, mu * noise)
        desired_int = RNG.poisson(np.clip(desired, 0, 5000))

        unmet = np.zeros(n, dtype=int)

        # --- 0. receive any orders whose lead time has elapsed ---
        for i in range(n):
            for batch_no, qty in ledger.receive_ready(i, wk_date):
                transactions.append({
                    "event_time": rand_event_time(wk_date), "date": wk_str, "type": "PROCUREMENT",
                    "hospital_id": hospital_id[i], "medicine_id": medicine_id[i],
                    "batch_no": batch_no, "counterparty_id": None, "department": None,
                    "quantity": qty, "emergency_flag": 0, "note": "Order received",
                })

        # --- 1. expiry check (normal shelf-life expiry) ---
        for i in range(n):
            for batch_no, qty in ledger.expire_batches(i, wk_date):
                transactions.append({
                    "event_time": rand_event_time(wk_date), "date": wk_str, "type": "EXPIRY_WRITEOFF",
                    "hospital_id": hospital_id[i], "medicine_id": medicine_id[i],
                    "batch_no": batch_no, "counterparty_id": None, "department": None,
                    "quantity": -qty, "emergency_flag": 0, "note": "Expired unrotated",
                })

        # --- 1b. cold-chain early spoilage (independent of printed expiry) ---
        for i in range(n):
            if cold_spoil_prob[i] > 0 and RNG.random() < cold_spoil_prob[i]:
                result = ledger.spoil_batch(i, fraction=float(RNG.uniform(0.3, 1.0)))
                if result:
                    batch_no, lost = result
                    transactions.append({
                        "event_time": rand_event_time(wk_date), "date": wk_str, "type": "EXPIRY_WRITEOFF",
                        "hospital_id": hospital_id[i], "medicine_id": medicine_id[i],
                        "batch_no": batch_no, "counterparty_id": None, "department": None,
                        "quantity": -lost, "emergency_flag": 0, "note": "Cold_chain_spoilage",
                    })

        # --- 2. consumption, FIFO from real batches ---
        for i in range(n):
            if desired_int[i] <= 0:
                continue
            taken, remaining = ledger.consume_fifo(i, int(desired_int[i]))
            unmet[i] = remaining
            dept = str(RNG.choice(["Emergency", "ICU", "OPD", "Pharmacy", "Surgery", "Pediatrics"]))
            for batch_no, qty in taken:
                transactions.append({
                    "event_time": rand_event_time(wk_date), "date": wk_str, "type": "CONSUMPTION",
                    "hospital_id": hospital_id[i], "medicine_id": medicine_id[i],
                    "batch_no": batch_no, "counterparty_id": None, "department": dept,
                    "quantity": -qty, "emergency_flag": 1 if remaining > 0 else 0, "note": None,
                })

        # --- 3. reorder / exchange / procurement ---
        balances = np.array([ledger.balance(i) for i in range(n)])
        short_idx = np.nonzero((balances < reorder_level) | (unmet > 0))[0]
        surplus_mask = balances > (2.2 * reorder_level)
        by_medicine_surplus: dict[str, list[int]] = {}
        for i in np.nonzero(surplus_mask)[0]:
            by_medicine_surplus.setdefault(medicine_id[i], []).append(i)

        for i in short_idx:
            urgent = unmet[i] > 0
            order_target = order_target_mult[i] * reorder_level[i]
            shortfall = int(max(order_target - balances[i], reorder_level[i]))
            matched = False

            if urgent:
                candidates = by_medicine_surplus.get(medicine_id[i], [])
                same_prov = [j for j in candidates if province[j] == province[i] and j != i]
                pick_pool = same_prov if same_prov else [j for j in candidates if j != i]
                if pick_pool:
                    j = pick_pool[int(RNG.integers(0, len(pick_pool)))]
                    j_balance = ledger.balance(j)
                    available = max(0, j_balance - int(1.8 * reorder_level[j]))
                    give = min(shortfall, available)
                    if give > 0:
                        taken, _ = ledger.consume_fifo(j, give)
                        for batch_no, qty in taken:
                            transactions.append({
                                "event_time": rand_event_time(wk_date), "date": wk_str, "type": "EXCHANGE_OUT",
                                "hospital_id": hospital_id[j], "medicine_id": medicine_id[i],
                                "batch_no": batch_no, "counterparty_id": hospital_id[i],
                                "department": None, "quantity": -qty, "emergency_flag": 1, "note": None,
                            })
                        # We do not retain the donor batch dates in the compact
                        # transfer tuple, so estimate a plausible age but clamp
                        # it to leave at least seven days of shelf life. The old
                        # 2-12 week estimate could create already-expired blood
                        # products when shelf life was only one month.
                        shelf_days = max(1, int(shelf_life_months[i] * 30.44))
                        max_age_days = max(0, shelf_days - 7)
                        estimated_age = min(int(RNG.integers(14, 85)), max_age_days)
                        manuf_est = wk_date - timedelta(days=estimated_age)
                        in_batch_no = ledger.add_batch(i, give, manuf_est, int(shelf_life_months[i]))
                        transactions.append({
                            "event_time": rand_event_time(wk_date), "date": wk_str, "type": "EXCHANGE_IN",
                            "hospital_id": hospital_id[i], "medicine_id": medicine_id[i],
                            "batch_no": in_batch_no, "counterparty_id": hospital_id[j],
                            "department": None, "quantity": give, "emergency_flag": 1, "note": None,
                        })
                        matched = True

                transactions.append({
                    "event_time": rand_event_time(wk_date), "date": wk_str, "type": "EMERGENCY_REQUEST",
                    "hospital_id": hospital_id[i], "medicine_id": medicine_id[i], "batch_no": None,
                    "counterparty_id": None, "department": None,
                    "quantity": int(unmet[i]) if unmet[i] > 0 else shortfall,
                    "emergency_flag": 1,
                    "note": "Fulfilled_via_exchange" if matched else ("Open" if unmet[i] > 0 else "Pending"),
                })

            if not matched:
                order_qty = round_up_to_pack(max(shortfall, reorder_level[i]), pack_size[i])
                lt = int(lead_time_weeks[i])
                if lt == 0:
                    batch_no = ledger.add_batch(i, order_qty, wk_date, int(shelf_life_months[i]))
                    transactions.append({
                        "event_time": rand_event_time(wk_date), "date": wk_str, "type": "PROCUREMENT",
                        "hospital_id": hospital_id[i], "medicine_id": medicine_id[i],
                        "batch_no": batch_no, "counterparty_id": str(RNG.choice(SUPPLIERS)),
                        "department": None, "quantity": order_qty, "emergency_flag": 0, "note": None,
                    })
                else:
                    arrival = wk_date + timedelta(weeks=lt)
                    ledger.queue_pending(i, order_qty, wk_date, arrival, int(shelf_life_months[i]))
                    transactions.append({
                        "event_time": rand_event_time(wk_date), "date": wk_str, "type": "PROCUREMENT_ORDERED",
                        "hospital_id": hospital_id[i], "medicine_id": medicine_id[i],
                        "batch_no": None, "counterparty_id": str(RNG.choice(SUPPLIERS)),
                        "department": None, "quantity": order_qty, "emergency_flag": 0,
                        "note": f"Lead_time_{lt}w (road_access-driven)",
                    })

        disruption_left = np.maximum(0, disruption_left - 1)
        shock_left = np.maximum(0, shock_left - 1)

        end_balances = np.array([ledger.balance(i) for i in range(n)])
        avg_recent = np.maximum(daily_base, 0.05)
        days_of_cover = np.where(avg_recent > 0, end_balances / avg_recent, np.nan)
        status = np.where(end_balances <= 0, "OUT_OF_STOCK",
                  np.where(end_balances < reorder_level, "LOW_STOCK", "OK"))
        for i in range(n):
            inventory_rows.append({
                "week_start": wk_str, "hospital_id": hospital_id[i], "medicine_id": medicine_id[i],
                "quantity_on_hand": int(end_balances[i]), "reorder_level": int(reorder_level[i]),
                "avg_daily_use": round(float(avg_recent[i]), 3),
                "days_of_cover": round(float(days_of_cover[i]), 2) if not np.isnan(days_of_cover[i]) else None,
                "stock_status": status[i],
                "pending_orders": len(ledger.pending[i]),
            })

        if week_start.week % 20 == 0:
            print(f"  ...{wk_str} done ({len(transactions):,} tx so far)")

    # --- chronological sort + sequential transaction_id (continuing from start_tx_id) ---
    tx_df = pd.DataFrame(transactions)
    if len(tx_df):
        tx_df["event_time"] = pd.to_datetime(tx_df["event_time"])
        tx_df = tx_df.sort_values("event_time", kind="stable").reset_index(drop=True)
        tx_df.insert(0, "transaction_id", [f"TX-{start_tx_id + i + 1:07d}" for i in range(len(tx_df))])

    inv_state_df = pd.DataFrame(inventory_rows)

    snap_rows = []
    last_date = weeks[-1].date().isoformat()
    for i in range(n):
        for b in ledger.batches[i]:
            if b["qty"] <= 0:
                continue
            snap_rows.append({
                "hospital_id": hospital_id[i], "medicine_id": medicine_id[i],
                "batch_no": b["batch_no"], "quantity_available": b["qty"],
                "manufacture_date": b["manufacture_date"].isoformat(),
                "expiry_date": b["expiry_date"].isoformat(),
                "last_updated": last_date,
            })
    inventory_df = pd.DataFrame(snap_rows)

    return tx_df, inv_state_df, inventory_df, ledger, pair_ids


def _aggregate_training_signals(tx_source: pd.DataFrame | Path | str) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Read only the transaction columns needed for forecasting.

    A full ledger is over one million rows. Reading it in chunks prevents the
    generator from holding the 100+ MB transaction table and the wide feature
    table in memory at the same time. Small cold-start DataFrames still use the
    same logic without going through disk.
    """
    needed = ["hospital_id", "medicine_id", "date", "type", "quantity"]

    if isinstance(tx_source, (str, Path)):
        chunks = pd.read_csv(
            tx_source,
            usecols=needed,
            chunksize=150_000,
            dtype={
                "hospital_id": "category",
                "medicine_id": "category",
                "type": "category",
                "quantity": "float32",
            },
        )
    else:
        chunks = [tx_source[needed].copy()]

    demand_parts: list[pd.DataFrame] = []
    emergency_parts: list[pd.DataFrame] = []
    exchange_parts: list[pd.DataFrame] = []

    for chunk in chunks:
        chunk["date"] = pd.to_datetime(chunk["date"], errors="coerce")
        chunk = chunk.dropna(subset=["date"])

        consumption = chunk[chunk["type"] == "CONSUMPTION"].copy()
        if not consumption.empty:
            consumption["quantity"] = consumption["quantity"].abs().astype("float32")
            demand_parts.append(
                consumption.groupby(
                    ["hospital_id", "medicine_id", "date"],
                    observed=True,
                    as_index=False,
                )["quantity"].sum()
            )

        emergency = chunk[chunk["type"] == "EMERGENCY_REQUEST"]
        if not emergency.empty:
            emergency_parts.append(
                emergency[["hospital_id", "medicine_id", "date"]].drop_duplicates()
            )

        exchange = chunk[chunk["type"] == "EXCHANGE_IN"]
        if not exchange.empty:
            exchange_parts.append(
                exchange[["hospital_id", "medicine_id", "date"]].drop_duplicates()
            )

    if not demand_parts:
        raise ValueError("No CONSUMPTION events were found; demand features cannot be built.")

    demand = (
        pd.concat(demand_parts, ignore_index=True)
        .groupby(["hospital_id", "medicine_id", "date"], observed=True, as_index=False)["quantity"]
        .sum()
        .rename(columns={"date": "week_start", "quantity": "demand_units"})
    )

    def combine_flags(parts: list[pd.DataFrame], value_name: str) -> pd.DataFrame:
        if not parts:
            return pd.DataFrame(columns=["hospital_id", "medicine_id", "week_start", value_name])
        out = pd.concat(parts, ignore_index=True).drop_duplicates(
            ["hospital_id", "medicine_id", "date"]
        )
        out = out.rename(columns={"date": "week_start"})
        out[value_name] = 1
        return out

    emergency = combine_flags(emergency_parts, "had_emergency")
    exchange = combine_flags(exchange_parts, "had_exchange_in")
    return demand, emergency, exchange


def build_features_from_ledger(
    tx_source: pd.DataFrame | Path | str,
    hospitals: pd.DataFrame,
    medicines: pd.DataFrame,
) -> pd.DataFrame:
    """Build one-week-ahead, leakage-safe demand features.

    The row dated week *t* has target demand for week *t*, while every
    demand-derived feature uses information available no later than *t-1*.
    Missing pair-weeks are explicitly represented as zero consumption so
    ``lag_1w`` always means the immediately preceding calendar week.
    """
    print("Building leakage-safe features from the transaction ledger...")
    weekly, emergency, exchange = _aggregate_training_signals(tx_source)

    # Complete hospital × medicine × week calendar. The old implementation
    # silently skipped no-consumption weeks, making lag_1w mean "previous
    # observed row" rather than "previous week".
    weeks = pd.DataFrame(
        {"week_start": pd.date_range(weekly["week_start"].min(), weekly["week_start"].max(), freq="W-MON")}
    )
    pairs = (
        hospitals[["hospital_id"]]
        .assign(_key=1)
        .merge(medicines[["medicine_id"]].assign(_key=1), on="_key")
        .drop(columns="_key")
    )
    grid = pairs.assign(_key=1).merge(weeks.assign(_key=1), on="_key").drop(columns="_key")
    df = grid.merge(weekly, on=["hospital_id", "medicine_id", "week_start"], how="left")
    df["demand_units"] = df["demand_units"].fillna(0).astype("float32")

    df = df.merge(
        emergency,
        on=["hospital_id", "medicine_id", "week_start"],
        how="left",
    ).merge(
        exchange,
        on=["hospital_id", "medicine_id", "week_start"],
        how="left",
    )
    df["had_emergency"] = pd.to_numeric(
        df["had_emergency"], errors="coerce"
    ).fillna(0).astype("int8")
    df["had_exchange_in"] = pd.to_numeric(
        df["had_exchange_in"], errors="coerce"
    ).fillna(0).astype("int8")
    df = df.sort_values(["hospital_id", "medicine_id", "week_start"]).reset_index(drop=True)

    df["year"] = df["week_start"].dt.year.astype("int16")
    df["month"] = df["week_start"].dt.month.astype("int8")
    df["week_of_year"] = df["week_start"].dt.isocalendar().week.astype("int8")
    df["quarter"] = df["week_start"].dt.quarter.astype("int8")
    df["is_monsoon"] = df["month"].isin([6, 7, 8, 9]).astype("int8")
    df["is_winter"] = df["month"].isin([12, 1, 2]).astype("int8")

    group_keys = ["hospital_id", "medicine_id"]
    g = df.groupby(group_keys, observed=True, group_keys=False)["demand_units"]
    for lag in (1, 2, 3, 4, 8, 12):
        df[f"lag_{lag}w"] = g.shift(lag).astype("float32")
    for window in (2, 4, 8, 12):
        df[f"roll_mean_{window}w"] = g.transform(
            lambda series: series.shift(1).rolling(window, min_periods=1).mean()
        ).astype("float32")
        df[f"roll_std_{window}w"] = g.transform(
            lambda series: series.shift(1).rolling(window, min_periods=2).std()
        ).astype("float32")
    df["roll_min_4w"] = g.transform(
        lambda series: series.shift(1).rolling(4, min_periods=1).min()
    ).astype("float32")
    df["roll_max_4w"] = g.transform(
        lambda series: series.shift(1).rolling(4, min_periods=1).max()
    ).astype("float32")

    # CRITICAL LEAKAGE FIX:
    # `g.diff(1)` used target_t - target_(t-1), exposing the current target.
    # With lag_1w the model could reconstruct target_t exactly. Shift first so
    # differences use only demand already known before the forecast week.
    df["diff_1w"] = g.transform(lambda series: series.shift(1).diff(1)).astype("float32")
    df["diff_4w"] = g.transform(lambda series: series.shift(1).diff(4)).astype("float32")
    df["ewm_4w"] = g.transform(
        lambda series: series.shift(1).ewm(span=4, adjust=False).mean()
    ).astype("float32")
    df["ewm_12w"] = g.transform(
        lambda series: series.shift(1).ewm(span=12, adjust=False).mean()
    ).astype("float32")

    ge = df.groupby(group_keys, observed=True, group_keys=False)["had_emergency"]
    gx = df.groupby(group_keys, observed=True, group_keys=False)["had_exchange_in"]
    df["emergency_last_4w"] = ge.transform(
        lambda series: series.shift(1).rolling(4, min_periods=1).max()
    ).fillna(0).astype("int8")
    df["exchange_in_last_4w"] = gx.transform(
        lambda series: series.shift(1).rolling(4, min_periods=1).max()
    ).fillna(0).astype("int8")
    df = df.drop(columns=["had_emergency", "had_exchange_in"])

    hcols = [
        "hospital_id", "facility_type", "province", "district", "ecoregion", "urban_class",
        "bed_capacity", "ownership", "load_factor", "urban_factor", "is_referral",
        "road_access_score", "latitude", "longitude", "is_demo",
    ]
    mcols = [
        "medicine_id", "generic_name", "category", "dosage_form", "shelf_life_months",
        "unit_cost_npr", "requires_cold_chain", "is_essential",
        "base_demand_per_100_beds", "abc_class", "pack_size",
    ]
    df = df.merge(hospitals[hcols], on="hospital_id", how="left")
    df = df.merge(medicines[mcols], on="medicine_id", how="left")

    df["month_sin"] = np.sin(2 * np.pi * df["month"] / 12).astype("float32")
    df["month_cos"] = np.cos(2 * np.pi * df["month"] / 12).astype("float32")
    df["week_sin"] = np.sin(2 * np.pi * df["week_of_year"] / 52).astype("float32")
    df["week_cos"] = np.cos(2 * np.pi * df["week_of_year"] / 52).astype("float32")

    df = df.rename(columns={"demand_units": "target_demand"})
    df = df[df["week_start"] >= (pd.Timestamp(START_DATE) + pd.Timedelta(weeks=12))].copy()
    historical_features = [
        column for column in df.columns
        if column.startswith(("lag_", "roll_", "diff_", "ewm_"))
    ]
    df[historical_features] = df[historical_features].fillna(0).astype("float32")

    # Guard against accidental reintroduction of the exact leakage formula.
    leaked_difference = (df["target_demand"] - df["lag_1w"]).astype("float32")
    if np.allclose(df["diff_1w"], leaked_difference, equal_nan=True):
        raise RuntimeError("Target leakage detected: diff_1w contains current-week demand.")

    print(f"Feature rows={len(df):,}; forecast weeks use history through t-1 only.")
    return df



def feature_partition_path(directory: Path, hospital_id: str) -> Path:
    safe_id = "".join(
        character if character.isalnum() or character in ("-", "_") else "_"
        for character in str(hospital_id)
    )
    return directory / f"{safe_id}.csv"


def save_feature_partitions(
    features: pd.DataFrame,
    directory: Path,
    *,
    replace_all: bool = True,
) -> None:
    """Write small per-hospital histories for low-latency API serving."""
    directory.mkdir(parents=True, exist_ok=True)
    if replace_all:
        for old_file in directory.glob("*.csv"):
            old_file.unlink()
    for hospital_id, rows in features.groupby("hospital_id", observed=True):
        rows.to_csv(feature_partition_path(directory, str(hospital_id)), index=False)


def build_inventory_snapshot(
    inventory_df: pd.DataFrame,
    inventory_state_df: pd.DataFrame,
    medicines: pd.DataFrame,
) -> pd.DataFrame:
    """Create the compact serving snapshot consumed by alert/matching APIs.

    `inventory.csv` remains the batch-level source of truth; this file simply
    enriches each open batch with the latest pair-level reorder/usage state.
    """
    if inventory_df.empty:
        return pd.DataFrame()

    state = inventory_state_df.copy()
    state["week_start"] = pd.to_datetime(state["week_start"])
    latest = (
        state.sort_values("week_start")
        .groupby(["hospital_id", "medicine_id"], observed=True, as_index=False)
        .tail(1)
    )
    latest = latest[[
        "hospital_id", "medicine_id", "week_start", "reorder_level",
        "avg_daily_use", "stock_status",
    ]].rename(columns={"week_start": "snapshot_date"})

    snapshot = inventory_df.merge(
        latest, on=["hospital_id", "medicine_id"], how="left"
    ).merge(
        medicines[["medicine_id", "unit", "unit_cost_npr"]],
        on="medicine_id",
        how="left",
    )
    snapshot = snapshot.rename(columns={
        "batch_no": "batch_id",
        "quantity_available": "quantity_units",
    })
    snapshot["expiry_date"] = pd.to_datetime(snapshot["expiry_date"])
    snapshot["snapshot_date"] = pd.to_datetime(snapshot["snapshot_date"])
    snapshot["days_to_expiry"] = (
        snapshot["expiry_date"] - snapshot["snapshot_date"]
    ).dt.days
    snapshot["days_of_cover"] = np.where(
        snapshot["avg_daily_use"].fillna(0) > 0,
        snapshot["quantity_units"] / snapshot["avg_daily_use"],
        np.nan,
    ).round(2)
    columns = [
        "hospital_id", "medicine_id", "batch_id", "quantity_units",
        "manufacture_date", "expiry_date", "snapshot_date", "reorder_level",
        "avg_daily_use", "days_of_cover", "stock_status", "unit",
        "unit_cost_npr", "days_to_expiry",
    ]
    return snapshot[columns]

def save_pending_arrivals(ledger: BatchLedger, pair_ids: list[tuple[str, str]], path: Path):
    data = ledger.pending_to_jsonable(pair_ids)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    n_orders = sum(len(v) for v in data.values())
    print(f"pending_arrivals.json: {n_orders:,} in-transit order(s) across {len(data):,} pair(s)")


def main():
    import gc

    OUT_RAW.mkdir(parents=True, exist_ok=True)
    OUT_PROCESSED.mkdir(parents=True, exist_ok=True)

    hospitals = build_hospitals()
    medicines = build_medicines()
    # Keep the reference CSVs and demo credentials synchronized with the
    # Python builders, which are the actual source of truth.
    hospitals.to_csv(OUT_RAW / "hospitals.csv", index=False)
    medicines.to_csv(OUT_RAW / "medicines.csv", index=False)
    write_demo_accounts(hospitals)

    tx_df, inv_state_df, inventory_df, ledger, pair_ids = run_simulation(hospitals, medicines)
    tx_path = OUT_RAW / "transactions.csv"
    tx_df.to_csv(tx_path, index=False)
    inv_state_df.to_csv(OUT_RAW / "inventory_state.csv", index=False)
    inventory_df.to_csv(OUT_RAW / "inventory.csv", index=False)
    serving_snapshot = build_inventory_snapshot(inventory_df, inv_state_df, medicines)
    serving_snapshot.to_csv(OUT_RAW / "inventory_snapshots.csv", index=False)
    save_pending_arrivals(ledger, pair_ids, OUT_RAW / "pending_arrivals.json")
    print(f"transactions={len(tx_df):,}  inventory_state={len(inv_state_df):,}  "
          f"inventory(current batches)={len(inventory_df):,}")
    print(tx_df["type"].value_counts())

    # Release the large event table before constructing the wide feature table.
    del tx_df, inv_state_df, inventory_df, ledger
    gc.collect()
    features = build_features_from_ledger(tx_path, hospitals, medicines)
    features.to_csv(OUT_PROCESSED / "demand_features.csv", index=False)
    save_feature_partitions(features, OUT_PROCESSED / "by_hospital")
    print(f"demand_features={len(features):,} cols={features.shape[1]}")
    print(f"serving partitions={features['hospital_id'].nunique():,}")


if __name__ == "__main__":
    main()