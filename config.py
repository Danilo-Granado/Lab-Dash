"""
config.py
---------
Central configuration. All defaults live here — nothing is hardcoded
in equipment modules or routes. Override by editing this file or by
setting environment variables before starting the server.
"""

import os

# ── Serial port defaults ───────────────────────────────────────────────────────
# Users can change these at runtime from the Overview tab; these are the
# defaults that appear when the app starts.

DEFAULT_PORTS = {
    "moisture":  os.getenv("MOISTURE_PORT",  "COM4"),
    "viscosity": os.getenv("VISCOSITY_PORT", "COM3"),
}

# ── Poll intervals (seconds) ───────────────────────────────────────────────────
VISCOSITY_POLL_INTERVAL_S = float(os.getenv("VISCOSITY_POLL_INTERVAL", "1.0"))
MOISTURE_POLL_INTERVAL_S  = float(os.getenv("MOISTURE_POLL_INTERVAL",  "10.0"))

# ── Storage ────────────────────────────────────────────────────────────────────
CSV_OUTPUT_DIR = os.getenv("CSV_OUTPUT_DIR", "logs")

# ── Profiles ──────────────────────────────────────────────────────────────────
PROFILES_PATH = os.getenv("PROFILES_PATH", "profiles/profiles.json")
