# MedBridge Ledger Dataset Dictionary

**Simulation period:** 2023-01-02 through 2026-06-29
**Forecast grain:** hospital × medicine × week
**Reference network:** 41 hospitals, 72 medicines, including 8 demo hospitals

The active implementation is documented in [`../ML_PIPELINE_GUIDE.md`](../ML_PIPELINE_GUIDE.md).

## Demo hospitals

| ID | Hospital |
|---|---|
| `HOSP-BG-001` | Bir Hospital |
| `HOSP-BG-002` | Tribhuvan University Teaching Hospital |
| `HOSP-BG-003` | Bhaktapur Cancer Hospital |
| `HOSP-BG-004` | Kanti Children's Hospital |
| `HOSP-BG-005` | Paropakar Maternity & Women's Hospital |
| `HOSP-GD-001` | Pokhara Academy of Health Sciences |
| `HOSP-KP-002` | Koshi Hospital |
| `HOSP-KR-002` | Jumla District Hospital |

## `hospitals.csv`

One row per hospital. Includes ID, name, facility type, geography, ecoregion, urban class, coordinates, bed capacity, ownership, specialty, road access, and demo metadata.

## `medicines.csv`

One row per medicine/resource. Includes medicine ID, generic name, category, dosage form, strength, unit, pack size, shelf life, unit cost in NPR, cold-chain and essential flags, and ABC class.

## `transactions.csv`

One row per simulated event:

| Column | Meaning |
|---|---|
| `transaction_id` | Unique event ID |
| `event_time` | Simulated event timestamp |
| `date` | Forecast week date |
| `type` | Consumption, procurement, exchange, expiry, or emergency event |
| `hospital_id` | Hospital whose ledger is affected |
| `medicine_id` | Medicine/resource |
| `batch_no` | Batch when applicable |
| `counterparty_id` | Supplier or partner hospital when applicable |
| `department` | Consuming department when applicable |
| `quantity` | Signed units: outbound negative, inbound positive |
| `emergency_flag` | Emergency indicator |
| `note` | Event metadata |

## `inventory.csv`

Current open batches: hospital, medicine, batch, available quantity, manufacture date, expiry date, and last update.

## `inventory_state.csv`

Weekly pair-level state: week, hospital, medicine, on-hand quantity, reorder level, average daily usage, days of cover, stock status, and pending order count.

## `inventory_snapshots.csv`

Compact enriched current snapshot used by expiry, low-stock, surplus, and exchange services.

## `demand_features.csv`

One supervised row per hospital, medicine, and week after the 12-week warm-up. The target is observed weekly consumption. Inputs include only lagged demand history, calendar features, and operational hospital/medicine attributes.

The current leakage fix guarantees that a feature row for week `t` uses demand-derived information only through week `t-1`.

## Time split

The trainer derives the split from available dates:

- final 13 weeks: untouched test
- preceding 13 weeks: validation
- all earlier weeks: training

For the current dataset this is:

- train: 2023-03-27 through 2025-12-29
- validation: 2026-01-05 through 2026-03-30
- test: 2026-04-06 through 2026-06-29
