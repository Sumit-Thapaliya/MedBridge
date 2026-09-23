#!/usr/bin/env python3
"""
MedBridge — Nepal-context synthetic data for XGBoost demand forecasting.

Covers full hospital spectrum (general, teaching, cancer, children, maternity,
eye, trauma, PHC, community, private) across all 7 provinces.

8 DEMO hospitals (is_demo=1) are used for final-report multi-login showcase.
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

RNG = np.random.default_rng(42)

START_DATE = date(2023, 1, 2)
END_DATE = date(2026, 6, 30)

ROOT = Path(__file__).resolve().parents[1]
OUT_RAW = ROOT / "data" / "raw"
OUT_PROCESSED = ROOT / "data" / "processed"
OUT_DOCS = Path(__file__).resolve().parents[3] / "docs" / "data"

SEASONAL_BASE = {
    1: 1.25, 2: 1.15, 3: 1.05, 4: 1.00, 5: 1.10, 6: 1.35,
    7: 1.45, 8: 1.40, 9: 1.25, 10: 1.20, 11: 1.05, 12: 1.15,
}

CATEGORY_SEASON = {
    "Antibiotic": {6: 1.25, 7: 1.35, 8: 1.30, 9: 1.15},
    "Analgesic": {9: 1.15, 10: 1.20},
    "Antipyretic": {6: 1.30, 7: 1.40, 8: 1.35},
    "ORS_Electrolyte": {5: 1.40, 6: 1.70, 7: 1.80, 8: 1.60, 9: 1.30},
    "Antimalarial": {6: 1.50, 7: 1.70, 8: 1.60, 9: 1.40},
    "Antidiarrheal": {5: 1.35, 6: 1.60, 7: 1.70, 8: 1.50},
    "Respiratory": {11: 1.30, 12: 1.50, 1: 1.60, 2: 1.40, 3: 1.20},
    "Cardiovascular": {},
    "Antidiabetic": {},
    "Vaccine": {3: 1.20, 4: 1.25, 9: 1.15, 10: 1.20},
    "IV_Fluid": {6: 1.30, 7: 1.40, 8: 1.35, 1: 1.15},
    "Surgical_Consumable": {9: 1.20, 10: 1.25},
    "Antihypertensive": {},
    "Gastrointestinal": {5: 1.20, 6: 1.35, 7: 1.40, 8: 1.30},
    "Antiseptic": {9: 1.15, 10: 1.20},
    "Anthelmintic": {2: 1.40, 3: 1.50, 8: 1.30, 9: 1.25},
    "Oncology": {1: 1.05, 2: 1.05, 3: 1.05, 4: 1.05, 5: 1.05, 6: 1.05,
                 7: 1.05, 8: 1.05, 9: 1.05, 10: 1.05, 11: 1.05, 12: 1.05},
    "Pediatric": {6: 1.25, 7: 1.35, 8: 1.30, 12: 1.20, 1: 1.25, 2: 1.20},
    "Maternity_OBGYN": {1: 1.05, 10: 1.10},
    "Ophthalmic": {},
    "Trauma_Emergency": {9: 1.25, 10: 1.30, 6: 1.15, 7: 1.15},
    "Blood_Product": {9: 1.20, 10: 1.25},
    "Anesthetic": {},
    "Nutritional": {6: 1.15, 7: 1.20, 8: 1.15},
}

FACILITY_LOAD = {
    "Central_Hospital": 1.00,
    "Regional_Hospital": 0.65,
    "Zonal_Hospital": 0.45,
    "District_Hospital": 0.30,
    "Teaching_Hospital": 0.85,
    "Primary_Health_Center": 0.12,
    "Community_Hospital": 0.22,
    "Cancer_Hospital": 0.70,
    "Children_Hospital": 0.55,
    "Maternity_Hospital": 0.50,
    "Eye_Hospital": 0.35,
    "Trauma_Center": 0.60,
    "Mental_Hospital": 0.25,
    "Ayurveda_Hospital": 0.15,
}

# Specialty mix: multiplies base demand by medicine category for specialty hospitals
SPECIALTY_CATEGORY_BOOST = {
    "Cancer_Hospital": {
        "Oncology": 8.0, "Analgesic": 2.0, "Antibiotic": 1.3, "IV_Fluid": 1.8,
        "Antiemetic": 3.0, "Blood_Product": 2.5, "Nutritional": 2.0,
        "Pediatric": 0.3, "Maternity_OBGYN": 0.2, "Ophthalmic": 0.3,
        "Vaccine": 0.4, "Antimalarial": 0.4, "ORS_Electrolyte": 0.6,
    },
    "Children_Hospital": {
        "Pediatric": 6.0, "Vaccine": 3.5, "ORS_Electrolyte": 2.5, "Antibiotic": 1.8,
        "Antipyretic": 2.0, "Respiratory": 2.2, "Nutritional": 2.0,
        "Oncology": 0.8, "Antihypertensive": 0.15, "Cardiovascular": 0.2,
        "Antidiabetic": 0.2, "Maternity_OBGYN": 0.1, "Anesthetic": 0.8,
    },
    "Maternity_Hospital": {
        "Maternity_OBGYN": 7.0, "Blood_Product": 3.0, "IV_Fluid": 2.0,
        "Antibiotic": 1.5, "Analgesic": 1.4, "Anesthetic": 2.5,
        "Oncology": 0.2, "Pediatric": 1.2, "Vaccine": 1.3,
        "Cardiovascular": 0.5, "Antimalarial": 0.5,
    },
    "Eye_Hospital": {
        "Ophthalmic": 10.0, "Antibiotic": 1.2, "Analgesic": 1.1,
        "Anesthetic": 1.5, "Surgical_Consumable": 1.8,
        "Oncology": 0.2, "ORS_Electrolyte": 0.3, "Antimalarial": 0.2,
        "Maternity_OBGYN": 0.1, "Pediatric": 0.4, "Vaccine": 0.3,
    },
    "Trauma_Center": {
        "Trauma_Emergency": 6.0, "Surgical_Consumable": 3.0, "Analgesic": 2.5,
        "Anesthetic": 2.5, "Blood_Product": 3.0, "IV_Fluid": 2.2,
        "Antibiotic": 1.6, "Antiseptic": 2.0,
        "Oncology": 0.2, "Maternity_OBGYN": 0.3, "Ophthalmic": 0.4,
    },
    "Mental_Hospital": {
        "Cardiovascular": 0.6, "Antidiabetic": 0.6, "Antihypertensive": 0.7,
        "Oncology": 0.1, "Surgical_Consumable": 0.3, "Trauma_Emergency": 0.2,
        "Maternity_OBGYN": 0.1, "Vaccine": 0.4, "ORS_Electrolyte": 0.5,
    },
}

ECOREGION_PRESSURE = {
    "Mountain": {"Respiratory": 1.25, "Cardiovascular": 1.10, "Antimalarial": 0.30},
    "Hill": {"Respiratory": 1.10, "Antimalarial": 0.70, "ORS_Electrolyte": 1.00},
    "Terai": {
        "Antimalarial": 1.50, "ORS_Electrolyte": 1.35, "Antidiarrheal": 1.30,
        "Antipyretic": 1.20, "Antibiotic": 1.15,
    },
}

URBAN_MULT = {
    "Metropolitan": 1.15,
    "Sub_Metropolitan": 1.00,
    "Municipality": 0.75,
    "Rural_Municipality": 0.55,
}


def build_hospitals() -> pd.DataFrame:
    """
    Full Nepal network + 8 DEMO facilities for multi-login showcase.

    Demo set (is_demo=1) spans specialties & geography so exchange / forecast
    demos look realistic:
      HOSP-BG-001 Bir Hospital              — Central general (Kathmandu)
      HOSP-BG-002 TUTH                      — Teaching (Kathmandu)
      HOSP-BG-003 Bhaktapur Cancer Hospital — Cancer specialty
      HOSP-BG-004 Kanti Children's          — Pediatric specialty
      HOSP-BG-005 Paropakar Maternity       — Maternity
      HOSP-KP-002 Koshi Hospital            — Regional Terai
      HOSP-GD-001 Pokhara Academy           — Regional Hill
      HOSP-KR-002 Jumla District            — Remote Mountain
    """
    rows = [
        # ---------- DEMO 8 (final report multi-login) ----------
        ("HOSP-BG-001", "Bir Hospital", "Central_Hospital", "Bagmati", "Kathmandu", "Kathmandu", "Hill", "Metropolitan", 27.7052, 85.3140, 460, "public", 1, "General / Emergency / Referral"),
        ("HOSP-BG-002", "Tribhuvan University Teaching Hospital (TUTH)", "Teaching_Hospital", "Bagmati", "Kathmandu", "Maharajgunj", "Hill", "Metropolitan", 27.7360, 85.3300, 700, "public", 1, "Teaching / Multi-specialty"),
        ("HOSP-BG-003", "Bhaktapur Cancer Hospital", "Cancer_Hospital", "Bagmati", "Bhaktapur", "Dudhpati", "Hill", "Municipality", 27.6725, 85.4278, 120, "public", 1, "Oncology / Chemotherapy / Palliative"),
        ("HOSP-BG-004", "Kanti Children's Hospital", "Children_Hospital", "Bagmati", "Kathmandu", "Maharajgunj", "Hill", "Metropolitan", 27.7375, 85.3320, 350, "public", 1, "Pediatrics / Neonatal / Vaccines"),
        ("HOSP-BG-005", "Paropakar Maternity & Women's Hospital", "Maternity_Hospital", "Bagmati", "Kathmandu", "Thapathali", "Hill", "Metropolitan", 27.6900, 85.3200, 415, "public", 1, "OBGYN / Labor / Blood bank"),
        ("HOSP-KP-002", "Koshi Hospital", "Regional_Hospital", "Koshi", "Morang", "Biratnagar", "Terai", "Metropolitan", 26.4525, 87.2718, 350, "public", 1, "Regional general / Monsoon load"),
        ("HOSP-GD-001", "Pokhara Academy of Health Sciences", "Regional_Hospital", "Gandaki", "Kaski", "Pokhara", "Hill", "Metropolitan", 28.2096, 83.9856, 500, "public", 1, "Regional / Trauma / Tourism corridor"),
        ("HOSP-KR-002", "Jumla District Hospital", "District_Hospital", "Karnali", "Jumla", "Khalanga", "Mountain", "Municipality", 29.2740, 82.1830, 50, "public", 1, "Remote mountain / Access-limited"),

        # ---------- Specialty & extended network ----------
        ("HOSP-BG-010", "BP Koirala Memorial Cancer Hospital", "Cancer_Hospital", "Bagmati", "Chitwan", "Bharatpur", "Terai", "Metropolitan", 27.6700, 84.4300, 250, "public", 0, "National cancer referral"),
        ("HOSP-BG-011", "Tilganga Institute of Ophthalmology", "Eye_Hospital", "Bagmati", "Kathmandu", "Gaushala", "Hill", "Metropolitan", 27.7050, 85.3480, 100, "community", 0, "Eye specialty"),
        ("HOSP-BG-012", "National Trauma Center", "Trauma_Center", "Bagmati", "Kathmandu", "Mahankal", "Hill", "Metropolitan", 27.7020, 85.3200, 200, "public", 0, "Trauma / Ortho emergency"),
        ("HOSP-BG-013", "Patan Hospital", "Teaching_Hospital", "Bagmati", "Lalitpur", "Lagankhel", "Hill", "Metropolitan", 27.6683, 85.3222, 450, "public", 0, "Teaching / General"),
        ("HOSP-BG-014", "Civil Service Hospital", "Central_Hospital", "Bagmati", "Kathmandu", "Minbhawan", "Hill", "Metropolitan", 27.6910, 85.3420, 200, "public", 0, "Civil servants / General"),
        ("HOSP-BG-015", "Dhulikhel Hospital", "Teaching_Hospital", "Bagmati", "Kavrepalanchok", "Dhulikhel", "Hill", "Municipality", 27.6190, 85.5420, 375, "community", 0, "Community teaching"),
        ("HOSP-BG-016", "Hetauda Hospital", "Zonal_Hospital", "Bagmati", "Makwanpur", "Hetauda", "Hill", "Sub_Metropolitan", 27.4280, 85.0320, 150, "public", 0, "Zonal general"),
        ("HOSP-BG-017", "Chautara District Hospital", "District_Hospital", "Bagmati", "Sindhupalchok", "Chautara", "Hill", "Municipality", 27.7780, 85.7160, 50, "public", 0, "District hill"),
        ("HOSP-BG-018", "Mental Hospital Lagankhel", "Mental_Hospital", "Bagmati", "Lalitpur", "Lagankhel", "Hill", "Metropolitan", 27.6660, 85.3240, 100, "public", 0, "Psychiatry"),
        ("HOSP-BG-019", "Grande International Hospital", "Central_Hospital", "Bagmati", "Kathmandu", "Dhapasi", "Hill", "Metropolitan", 27.7500, 85.3300, 200, "private", 0, "Private multi-specialty"),

        # Koshi
        ("HOSP-KP-001", "B.P. Koirala Institute of Health Sciences (BPKIHS)", "Teaching_Hospital", "Koshi", "Sunsari", "Dharan", "Hill", "Sub_Metropolitan", 26.8065, 87.2846, 700, "public", 0, "Eastern teaching referral"),
        ("HOSP-KP-003", "Mechi Zonal Hospital", "Zonal_Hospital", "Koshi", "Jhapa", "Bhadrapur", "Terai", "Municipality", 26.5440, 88.0940, 180, "public", 0, "Eastern border Terai"),
        ("HOSP-KP-004", "Okhaldhunga Community Hospital", "Community_Hospital", "Koshi", "Okhaldhunga", "Siddhicharan", "Hill", "Municipality", 27.3167, 86.5042, 50, "community", 0, "Hill community"),

        # Madhesh
        ("HOSP-MD-001", "Provincial Hospital Janakpur", "Regional_Hospital", "Madhesh", "Dhanusha", "Janakpur", "Terai", "Sub_Metropolitan", 26.7288, 85.9250, 300, "public", 0, "Madhesh regional"),
        ("HOSP-MD-002", "Narayani Hospital", "Zonal_Hospital", "Madhesh", "Parsa", "Birgunj", "Terai", "Metropolitan", 27.0104, 84.8770, 250, "public", 0, "Border trade hub"),
        ("HOSP-MD-003", "Gaur District Hospital", "District_Hospital", "Madhesh", "Rautahat", "Gaur", "Terai", "Municipality", 26.7640, 85.2780, 75, "public", 0, "District Terai"),
        ("HOSP-MD-004", "National Medical College Teaching Hospital", "Teaching_Hospital", "Madhesh", "Parsa", "Birgunj", "Terai", "Metropolitan", 27.0200, 84.8800, 700, "private", 0, "Private teaching"),

        # Gandaki
        ("HOSP-GD-002", "Dhaulagiri Hospital", "Zonal_Hospital", "Gandaki", "Baglung", "Baglung", "Hill", "Municipality", 28.2700, 83.5900, 100, "public", 0, "Hill zonal"),
        ("HOSP-GD-003", "Gorkha District Hospital", "District_Hospital", "Gandaki", "Gorkha", "Gorkha Bazaar", "Hill", "Municipality", 28.0000, 84.6330, 60, "public", 0, "District hill"),
        ("HOSP-GD-004", "Manang Primary Health Center", "Primary_Health_Center", "Gandaki", "Manang", "Chame", "Mountain", "Rural_Municipality", 28.5560, 84.2410, 15, "public", 0, "High mountain PHC"),
        ("HOSP-GD-005", "Manipal Teaching Hospital", "Teaching_Hospital", "Gandaki", "Kaski", "Pokhara", "Hill", "Metropolitan", 28.2400, 83.9900, 750, "private", 0, "Private teaching"),

        # Lumbini
        ("HOSP-LB-001", "Lumbini Provincial Hospital", "Regional_Hospital", "Lumbini", "Rupandehi", "Butwal", "Terai", "Sub_Metropolitan", 27.7000, 83.4480, 300, "public", 0, "Lumbini regional"),
        ("HOSP-LB-002", "Bheri Hospital", "Zonal_Hospital", "Lumbini", "Banke", "Nepalgunj", "Terai", "Sub_Metropolitan", 28.0500, 81.6160, 250, "public", 0, "Mid-west Terai"),
        ("HOSP-LB-003", "Rapti Academy of Health Sciences", "Teaching_Hospital", "Lumbini", "Dang", "Ghorahi", "Terai", "Sub_Metropolitan", 28.0400, 82.4850, 200, "public", 0, "Teaching Terai"),
        ("HOSP-LB-004", "Pyuthan District Hospital", "District_Hospital", "Lumbini", "Pyuthan", "Pyuthan Khalanga", "Hill", "Municipality", 28.1000, 82.8700, 45, "public", 0, "District hill"),
        ("HOSP-LB-005", "Lumbini Medical College Teaching Hospital", "Teaching_Hospital", "Lumbini", "Palpa", "Tansen", "Hill", "Municipality", 27.8670, 83.5460, 600, "private", 0, "Private teaching hill"),

        # Karnali
        ("HOSP-KR-001", "Karnali Provincial Hospital", "Regional_Hospital", "Karnali", "Surkhet", "Birendranagar", "Hill", "Municipality", 28.6000, 81.6160, 200, "public", 0, "Karnali regional"),
        ("HOSP-KR-003", "Dolpa Primary Health Center", "Primary_Health_Center", "Karnali", "Dolpa", "Dunai", "Mountain", "Rural_Municipality", 28.9500, 82.9000, 12, "public", 0, "Remote mountain PHC"),
        ("HOSP-KR-004", "Rukum West District Hospital", "District_Hospital", "Karnali", "Rukum West", "Musikot", "Hill", "Municipality", 28.6300, 82.4500, 40, "public", 0, "District hill"),

        # Sudurpashchim
        ("HOSP-SP-001", "Seti Provincial Hospital", "Regional_Hospital", "Sudurpashchim", "Kailali", "Dhangadhi", "Terai", "Sub_Metropolitan", 28.6850, 80.6210, 280, "public", 0, "Far-west regional"),
        ("HOSP-SP-002", "Mahakali Hospital", "Zonal_Hospital", "Sudurpashchim", "Kanchanpur", "Bhimdatta", "Terai", "Municipality", 28.9700, 80.1800, 150, "public", 0, "Far-west border"),
        ("HOSP-SP-003", "Bajhang District Hospital", "District_Hospital", "Sudurpashchim", "Bajhang", "Chainpur", "Mountain", "Municipality", 29.5500, 81.2000, 35, "public", 0, "Mountain district"),
        ("HOSP-SP-004", "Dadeldhura Hospital", "District_Hospital", "Sudurpashchim", "Dadeldhura", "Amargadhi", "Hill", "Municipality", 29.3000, 80.5800, 55, "public", 0, "Hill district"),
    ]
    cols = [
        "hospital_id", "hospital_name", "facility_type", "province", "district",
        "municipality", "ecoregion", "urban_class", "latitude", "longitude",
        "bed_capacity", "ownership", "is_demo", "specialty_focus",
    ]
    df = pd.DataFrame(rows, columns=cols)
    df["load_factor"] = df["facility_type"].map(FACILITY_LOAD).astype(float)
    df["urban_factor"] = df["urban_class"].map(URBAN_MULT).astype(float)
    df["is_referral"] = df["facility_type"].isin([
        "Central_Hospital", "Regional_Hospital", "Teaching_Hospital",
        "Cancer_Hospital", "Trauma_Center", "Children_Hospital", "Maternity_Hospital",
    ]).astype(int)
    base_access = df["ecoregion"].map({"Terai": 0.95, "Hill": 0.75, "Mountain": 0.40}).astype(float)
    df["road_access_score"] = (base_access + RNG.normal(0, 0.04, len(df))).clip(0.2, 1.0).round(3)

    # Demo login credentials (for later frontend; stored for seed)
    demo_mask = df["is_demo"] == 1
    df["demo_username"] = np.where(demo_mask, df["hospital_id"].str.lower().str.replace("-", "_"), "")
    df["demo_role"] = np.where(demo_mask, "hospital_admin", "")
    return df


def build_medicines() -> pd.DataFrame:
    rows = [
        # General essential
        ("MED-001", "Paracetamol", "Calpol / Napa", "Antipyretic", "Tablet", "500mg", "tablet", 100, 36, 1.5, 0, 1, 45.0),
        ("MED-002", "Paracetamol", "PCM Syrup", "Antipyretic", "Syrup", "125mg/5ml", "bottle", 1, 24, 45.0, 0, 1, 8.0),
        ("MED-003", "Ibuprofen", "Brufen", "Analgesic", "Tablet", "400mg", "tablet", 100, 36, 2.5, 0, 1, 18.0),
        ("MED-004", "Diclofenac", "Voveran", "Analgesic", "Injection", "75mg/3ml", "ampoule", 10, 24, 25.0, 0, 1, 6.0),
        ("MED-005", "Amoxicillin", "Amoxil", "Antibiotic", "Capsule", "500mg", "capsule", 100, 24, 6.0, 0, 1, 22.0),
        ("MED-006", "Amoxicillin + Clavulanate", "Augmentin", "Antibiotic", "Tablet", "625mg", "tablet", 10, 24, 35.0, 0, 1, 10.0),
        ("MED-007", "Azithromycin", "Azithral", "Antibiotic", "Tablet", "500mg", "tablet", 3, 24, 40.0, 0, 1, 8.0),
        ("MED-008", "Ciprofloxacin", "Cifran", "Antibiotic", "Tablet", "500mg", "tablet", 10, 36, 8.0, 0, 1, 12.0),
        ("MED-009", "Ceftriaxone", "Monocef", "Antibiotic", "Injection", "1g", "vial", 1, 24, 85.0, 0, 1, 9.0),
        ("MED-010", "Metronidazole", "Flagyl", "Antibiotic", "Tablet", "400mg", "tablet", 100, 36, 2.0, 0, 1, 14.0),
        ("MED-011", "ORS (WHO formula)", "Jeevan Jal", "ORS_Electrolyte", "Sachet", "20.5g", "sachet", 50, 36, 8.0, 0, 1, 25.0),
        ("MED-012", "Zinc Sulfate", "Zinconia", "ORS_Electrolyte", "Tablet", "20mg", "tablet", 100, 36, 1.2, 0, 1, 15.0),
        ("MED-013", "Ringer's Lactate", "RL IV", "IV_Fluid", "Infusion", "500ml", "bag", 1, 24, 55.0, 0, 1, 12.0),
        ("MED-014", "Normal Saline 0.9%", "NS IV", "IV_Fluid", "Infusion", "500ml", "bag", 1, 24, 45.0, 0, 1, 18.0),
        ("MED-015", "Dextrose 5%", "D5 IV", "IV_Fluid", "Infusion", "500ml", "bag", 1, 24, 48.0, 0, 1, 10.0),
        ("MED-016", "Artemether-Lumefantrine", "Coartem", "Antimalarial", "Tablet", "20/120mg", "tablet", 24, 24, 15.0, 0, 1, 3.5),
        ("MED-017", "Chloroquine", "Nivaquine", "Antimalarial", "Tablet", "250mg", "tablet", 100, 36, 1.8, 0, 0, 1.5),
        ("MED-018", "Salbutamol", "Asthalin", "Respiratory", "Inhaler", "100mcg", "unit", 1, 24, 180.0, 0, 1, 4.0),
        ("MED-019", "Salbutamol", "Asthalin Resp", "Respiratory", "Nebulizer_Solution", "5mg/ml", "ampoule", 10, 24, 30.0, 0, 1, 5.0),
        ("MED-020", "Amoxicillin (Pediatric)", "Mox Dry Syrup", "Pediatric", "Dry_Syrup", "125mg/5ml", "bottle", 1, 24, 55.0, 0, 1, 7.0),
        ("MED-021", "Amlodipine", "Amlovas", "Antihypertensive", "Tablet", "5mg", "tablet", 100, 36, 1.0, 0, 1, 20.0),
        ("MED-022", "Losartan", "Repace", "Antihypertensive", "Tablet", "50mg", "tablet", 100, 36, 2.5, 0, 1, 16.0),
        ("MED-023", "Metformin", "Glycomet", "Antidiabetic", "Tablet", "500mg", "tablet", 100, 36, 1.5, 0, 1, 22.0),
        ("MED-024", "Insulin Human Regular", "Actrapid", "Antidiabetic", "Injection", "100IU/ml", "vial", 1, 24, 450.0, 1, 1, 3.0),
        ("MED-025", "Atorvastatin", "Atorva", "Cardiovascular", "Tablet", "10mg", "tablet", 100, 36, 3.0, 0, 1, 12.0),
        ("MED-026", "Aspirin", "Disprin", "Cardiovascular", "Tablet", "75mg", "tablet", 100, 36, 0.8, 0, 1, 18.0),
        ("MED-027", "Omeprazole", "Omez", "Gastrointestinal", "Capsule", "20mg", "capsule", 100, 36, 2.0, 0, 1, 20.0),
        ("MED-028", "Ondansetron", "Emeset", "Gastrointestinal", "Tablet", "4mg", "tablet", 10, 36, 6.0, 0, 1, 8.0),
        ("MED-029", "Loperamide", "Imodium", "Antidiarrheal", "Tablet", "2mg", "tablet", 100, 36, 1.5, 0, 1, 6.0),
        ("MED-030", "Povidone Iodine", "Betadine", "Antiseptic", "Solution", "10%", "bottle_100ml", 1, 36, 85.0, 0, 1, 5.0),
        ("MED-031", "Surgical Gloves (sterile)", "MediGlove", "Surgical_Consumable", "Pair", "Size 7", "pair", 50, 60, 25.0, 0, 1, 30.0),
        ("MED-032", "Disposable Syringe", "Dispovan", "Surgical_Consumable", "Syringe", "5ml", "piece", 100, 60, 5.0, 0, 1, 40.0),
        ("MED-033", "IV Cannula", "Vasofix", "Surgical_Consumable", "Cannula", "20G", "piece", 50, 60, 35.0, 0, 1, 15.0),
        ("MED-034", "Tetanus Toxoid", "TT Vaccine", "Vaccine", "Injection", "0.5ml", "vial", 10, 24, 25.0, 1, 1, 2.5),
        ("MED-035", "Anti-Rabies Vaccine", "Abhayrab", "Vaccine", "Injection", "0.5ml", "vial", 1, 24, 350.0, 1, 1, 1.2),
        ("MED-036", "Iron + Folic Acid", "IFA", "Maternity_OBGYN", "Tablet", "60mg/400mcg", "tablet", 100, 24, 0.5, 0, 1, 28.0),
        ("MED-037", "Albendazole", "Zentel", "Anthelmintic", "Tablet", "400mg", "tablet", 1, 36, 8.0, 0, 1, 4.0),
        ("MED-038", "Dexamethasone", "Dexona", "Respiratory", "Injection", "4mg/ml", "ampoule", 10, 24, 12.0, 0, 1, 4.5),
        ("MED-039", "Pheniramine", "Avil", "Respiratory", "Injection", "22.75mg/ml", "ampoule", 10, 36, 10.0, 0, 1, 3.5),
        ("MED-040", "Tramadol", "Tramazac", "Analgesic", "Injection", "50mg/ml", "ampoule", 10, 36, 28.0, 0, 0, 3.0),
        # Oncology
        ("MED-041", "Cyclophosphamide", "Endoxan", "Oncology", "Injection", "500mg", "vial", 1, 24, 180.0, 0, 1, 2.0),
        ("MED-042", "Doxorubicin", "Adriamycin", "Oncology", "Injection", "50mg", "vial", 1, 24, 1200.0, 1, 1, 1.2),
        ("MED-043", "Paclitaxel", "Taxol", "Oncology", "Injection", "100mg", "vial", 1, 24, 3500.0, 0, 1, 0.8),
        ("MED-044", "Cisplatin", "Platin", "Oncology", "Injection", "50mg", "vial", 1, 24, 450.0, 0, 1, 1.0),
        ("MED-045", "Morphine Sulfate", "Morphine", "Oncology", "Tablet", "10mg", "tablet", 20, 24, 15.0, 0, 1, 4.0),
        ("MED-046", "Filgrastim (G-CSF)", "Neupogen", "Oncology", "Injection", "300mcg", "prefilled", 1, 18, 4500.0, 1, 1, 0.6),
        # Pediatric
        ("MED-047", "ORS Pediatric", "Jeevan Jal Junior", "Pediatric", "Sachet", "10.2g", "sachet", 50, 36, 6.0, 0, 1, 18.0),
        ("MED-048", "Amoxicillin Pediatric Drops", "Mox Drops", "Pediatric", "Drops", "100mg/ml", "bottle", 1, 24, 65.0, 0, 1, 6.0),
        ("MED-049", "Vitamin A Capsule", "Retinol", "Pediatric", "Capsule", "200000 IU", "capsule", 100, 24, 2.0, 0, 1, 8.0),
        ("MED-050", "Pentavalent Vaccine", "DPT-HepB-Hib", "Vaccine", "Injection", "0.5ml", "vial", 10, 24, 120.0, 1, 1, 3.5),
        ("MED-051", "Measles-Rubella Vaccine", "MR Vaccine", "Vaccine", "Injection", "0.5ml", "vial", 10, 24, 80.0, 1, 1, 3.0),
        ("MED-052", "Oral Rehydration + Zinc Kit", "ORS-Zinc Kit", "Pediatric", "Kit", "combo", "kit", 1, 24, 25.0, 0, 1, 10.0),
        # Maternity
        ("MED-053", "Oxytocin", "Pitocin", "Maternity_OBGYN", "Injection", "10 IU/ml", "ampoule", 10, 24, 35.0, 1, 1, 8.0),
        ("MED-054", "Misoprostol", "Cytotec", "Maternity_OBGYN", "Tablet", "200mcg", "tablet", 4, 24, 20.0, 0, 1, 5.0),
        ("MED-055", "Magnesium Sulfate", "MgSO4", "Maternity_OBGYN", "Injection", "50%", "ampoule", 10, 36, 18.0, 0, 1, 3.0),
        ("MED-056", "Tranexamic Acid", "TXA", "Maternity_OBGYN", "Injection", "500mg", "ampoule", 5, 36, 45.0, 0, 1, 2.5),
        # Ophthalmic
        ("MED-057", "Ciprofloxacin Eye Drops", "Ciplox Eye", "Ophthalmic", "Drops", "0.3%", "bottle", 1, 24, 55.0, 0, 1, 6.0),
        ("MED-058", "Timolol Eye Drops", "Glucomol", "Ophthalmic", "Drops", "0.5%", "bottle", 1, 24, 90.0, 0, 1, 4.0),
        ("MED-059", "Tropicamide Eye Drops", "Tropicacyl", "Ophthalmic", "Drops", "1%", "bottle", 1, 24, 70.0, 0, 1, 3.5),
        # Trauma / emergency
        ("MED-060", "Anti-Snake Venom (ASVS)", "ASV", "Trauma_Emergency", "Injection", "10ml", "vial", 1, 24, 2500.0, 1, 1, 0.8),
        ("MED-061", "Adrenaline", "Epinephrine", "Trauma_Emergency", "Injection", "1mg/ml", "ampoule", 10, 24, 25.0, 0, 1, 2.0),
        ("MED-062", "Atropine", "Atropine SO4", "Trauma_Emergency", "Injection", "0.6mg/ml", "ampoule", 10, 36, 12.0, 0, 1, 1.5),
        ("MED-063", "Tetanus Immunoglobulin", "TIG", "Trauma_Emergency", "Injection", "250 IU", "vial", 1, 24, 850.0, 1, 1, 1.0),
        ("MED-064", "Plaster of Paris Bandage", "POP", "Trauma_Emergency", "Bandage", "15cm", "roll", 12, 60, 80.0, 0, 1, 8.0),
        # Blood / anesthetic / nutrition
        ("MED-065", "Whole Blood Unit (proxy stock)", "Blood Bank Unit", "Blood_Product", "Unit", "350ml", "unit", 1, 1, 0.0, 1, 1, 2.0),
        ("MED-066", "Packed RBC (proxy)", "PRBC", "Blood_Product", "Unit", "250ml", "unit", 1, 1, 0.0, 1, 1, 1.5),
        ("MED-067", "Lignocaine 2%", "Xylocaine", "Anesthetic", "Injection", "2%", "vial", 1, 36, 40.0, 0, 1, 5.0),
        ("MED-068", "Ketamine", "Ketalar", "Anesthetic", "Injection", "50mg/ml", "vial", 1, 36, 180.0, 0, 1, 1.5),
        ("MED-069", "Spinal Bupivacaine", "Sensorcaine", "Anesthetic", "Injection", "0.5%", "ampoule", 5, 36, 95.0, 0, 1, 2.0),
        ("MED-070", "Ready-to-Use Therapeutic Food", "RUTF", "Nutritional", "Sachet", "92g", "sachet", 150, 24, 120.0, 0, 1, 4.0),
        ("MED-071", "Fentanyl", "Fent", "Analgesic", "Injection", "50mcg/ml", "ampoule", 10, 24, 150.0, 0, 0, 1.2),
        ("MED-072", "Meropenem", "Meronem", "Antibiotic", "Injection", "1g", "vial", 1, 24, 650.0, 0, 1, 2.5),
    ]
    cols = [
        "medicine_id", "generic_name", "brand_example", "category", "dosage_form",
        "strength", "unit", "pack_size", "shelf_life_months", "unit_cost_npr",
        "requires_cold_chain", "is_essential", "base_demand_per_100_beds",
    ]
    df = pd.DataFrame(rows, columns=cols)
    value = df["unit_cost_npr"] * df["base_demand_per_100_beds"]
    df["abc_class"] = pd.cut(value, bins=[-np.inf, 30, 150, np.inf], labels=["C", "B", "A"]).astype(str)
    return df


def week_starts(start: date, end: date) -> pd.DatetimeIndex:
    s = pd.Timestamp(start)
    s = s - pd.Timedelta(days=s.weekday())
    e = pd.Timestamp(end)
    return pd.date_range(s, e, freq="W-MON")


def festival_boost_month_day(month: int, day: int) -> float:
    if (month == 9 and day >= 25) or (month == 10 and day <= 20):
        return 1.25
    if (month == 10 and day >= 25) or (month == 11 and day <= 5):
        return 1.15
    if month == 3 and 5 <= day <= 15:
        return 1.10
    if month == 4 and 10 <= day <= 16:
        return 1.08
    return 1.0


def specialty_mult(facility_type: str, category: str) -> float:
    boosts = SPECIALTY_CATEGORY_BOOST.get(facility_type)
    if not boosts:
        # general hospitals: mild suppress pure specialty drugs
        if category in ("Oncology", "Ophthalmic"):
            return 0.25
        if category in ("Maternity_OBGYN", "Pediatric"):
            return 0.70
        if category in ("Trauma_Emergency", "Blood_Product", "Anesthetic"):
            return 0.85
        return 1.0
    return float(boosts.get(category, 0.55))



def write_demo_accounts(hospitals: pd.DataFrame):
    demo = hospitals[hospitals["is_demo"] == 1][
        ["hospital_id", "hospital_name", "facility_type", "province", "district",
         "ecoregion", "bed_capacity", "demo_username", "specialty_focus"]
    ].copy()
    demo["demo_password"] = "MedBridge@2026"
    demo["login_role"] = "hospital_admin"
    demo.to_csv(OUT_RAW / "demo_hospital_accounts.csv", index=False)
    return demo




if __name__ == "__main__":
    # SAFETY: this file used to have its own main() that regenerated the OLD
    # 4-file disconnected data format (demand_history.csv, inventory_snapshots.csv,
    # resource_exchange_log.csv, emergency_requests.csv) and overwrote
    # hospitals.csv / demand_features.csv in the process. That pipeline was
    # replaced by the ledger-based simulation — running the old main() here
    # would silently wipe out cold-start-seeded hospitals and revert the
    # feature file to the old, leaky format. That logic has been removed.
    #
    # This file is now ONLY a library of shared builders (build_hospitals,
    # build_medicines, specialty_mult, week_starts, festival_boost_month_day,
    # write_demo_accounts) imported by generate_ledger_data.py and
    # append_weeks.py. Run one of those instead:
    print("This script is no longer meant to be run directly.")
    print("Use:  python training/generate_ledger_data.py   (full regeneration)")
    print("  or: python training/append_weeks.py --weeks N  (top up existing data)")