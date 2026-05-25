"""
session_state.py
----------------
In-memory session state shared across all routes.

Holds the active PO number, active test selection, port configuration,
and live driver instances. This is intentionally simple — one lab PC,
one operator at a time. No database or Redis needed.
"""

from config import DEFAULT_PORTS

# ── Active session ─────────────────────────────────────────────────────────────

state = {
    # Set by the user in the Overview tab
    "po_number":    "",
    "active_tests": [],          # list of test_ids currently enabled

    # Port config — initialised from config.py defaults
    "ports": dict(DEFAULT_PORTS),

    # Live driver instances keyed by test_id
    # { "moisture": MoistureAnalyzer instance | None, ... }
    "drivers": {},

    # Streaming threads keyed by test_id
    "threads": {},
}


def get_po() -> str:
    return state["po_number"]

def set_po(po: str) -> None:
    state["po_number"] = po.strip()

def get_active_tests() -> list:
    return state["active_tests"]

def set_active_tests(tests: list) -> None:
    state["active_tests"] = tests

def get_port(test_id: str) -> str:
    return state["ports"].get(test_id, "")

def set_port(test_id: str, port: str) -> None:
    state["ports"][test_id] = port

def get_driver(test_id: str):
    return state["drivers"].get(test_id)

def set_driver(test_id: str, driver) -> None:
    state["drivers"][test_id] = driver

def clear_driver(test_id: str) -> None:
    state["drivers"].pop(test_id, None)
