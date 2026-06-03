"""
routes/api.py
-------------
REST endpoints for session management and equipment control.

POST /api/session          — set PO number and active tests
GET  /api/session          — get current session state
GET  /api/equipment        — list all registered equipment
GET  /api/profiles         — list product profiles
POST /api/connect          — connect a driver to its serial port
POST /api/disconnect       — disconnect a driver
POST /api/start            — start a test (fires the stream generator)
POST /api/stop             — stop a running test
GET  /api/status           — connection + run status for all equipment
POST /api/ports            — update port configuration
"""

import json
import logging
import threading
from pathlib import Path

from flask import Blueprint, jsonify, request

import session_state as ss
from equipment.registry import list_equipment, get_driver
from config import PROFILES_PATH

api_bp = Blueprint("api", __name__)
logger = logging.getLogger(__name__)

# ── Session ────────────────────────────────────────────────────────────────────

@api_bp.route("/session", methods=["GET"])
def get_session():
    return jsonify({
        "po_number":    ss.get_po(),
        "active_tests": ss.get_active_tests(),
        "profile_key":  ss.get_profile_key(),
        "product_name": ss.get_product_name(),
        "ports":        ss.state["ports"],
    })


@api_bp.route("/session", methods=["POST"])
def set_session():
    data = request.json or {}
    if "po_number" in data:
        ss.set_po(data["po_number"])
    if "active_tests" in data:
        ss.set_active_tests(data["active_tests"])
    if "profile_key" in data:
        ss.set_profile_key(data["profile_key"])
    if "product_name" in data:
        ss.set_product_name(data["product_name"])
    return jsonify({"ok": True, "po_number": ss.get_po(), "active_tests": ss.get_active_tests(), "profile_key": ss.get_profile_key(), "product_name": ss.get_product_name()})


# ── Equipment metadata ─────────────────────────────────────────────────────────

@api_bp.route("/equipment", methods=["GET"])
def equipment_list():
    return jsonify(list_equipment())


# ── Profiles ───────────────────────────────────────────────────────────────────

@api_bp.route("/profiles", methods=["GET"])
def profiles():
    path = Path(PROFILES_PATH)
    if not path.exists():
        return jsonify({})
    with open(path) as f:
        data = json.load(f)
    # Strip internal comment key
    data.pop("_comment", None)
    return jsonify(data)


# ── Picnometers ────────────────────────────────────────────────────────────────

@api_bp.route("/picnometers", methods=["GET"])
def picnometers():
    """Return the picnometer list defined in equipment/density.py."""
    from equipment.density import PICNOMETERS
    return jsonify(PICNOMETERS)


# ── Specs ──────────────────────────────────────────────────────────────────────

@api_bp.route("/specs/<profile_key>/<test_id>", methods=["GET"])
def get_specs(profile_key, test_id):
    """
    Return the min/max spec for a given profile + test combination.
    Response: { "min": float|null, "max": float|null, "defined": bool }
    "defined": false means no spec exists → pass-through (always approved).
    """
    path = Path(PROFILES_PATH)
    if not path.exists():
        return jsonify({"min": None, "max": None, "defined": False})

    with open(path) as f:
        profiles = json.load(f)

    profile = profiles.get(profile_key, {})
    specs   = profile.get("specs", {})
    spec    = specs.get(test_id)

    if spec is None:
        return jsonify({"min": None, "max": None, "defined": False})

    return jsonify({
        "min":     spec.get("min"),
        "max":     spec.get("max"),
        "defined": True,
    })


# ── Port config ────────────────────────────────────────────────────────────────

@api_bp.route("/ports", methods=["POST"])
def update_ports():
    data = request.json or {}
    for test_id, port in data.items():
        ss.set_port(test_id, port)
    return jsonify({"ok": True, "ports": ss.state["ports"]})


# ── Connection ─────────────────────────────────────────────────────────────────

@api_bp.route("/connect", methods=["POST"])
def connect():
    data    = request.json or {}
    test_id = data.get("test_id")
    if not test_id:
        return jsonify({"ok": False, "error": "test_id required"}), 400

    # Re-use existing driver if already connected
    driver = ss.get_driver(test_id)
    if driver and driver.is_connected():
        return jsonify({"ok": True, "message": "Already connected"})

    try:
        driver = get_driver(test_id)
        port   = ss.get_port(test_id)
        driver.configure(port=port)
        driver.connect()
        ss.set_driver(test_id, driver)
        return jsonify({"ok": True})
    except Exception as e:
        logger.error(f"[API] connect {test_id}: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500


@api_bp.route("/disconnect", methods=["POST"])
def disconnect():
    data    = request.json or {}
    test_id = data.get("test_id")
    driver  = ss.get_driver(test_id)
    if driver:
        try:
            if driver._running:
                driver.stop_test()
            driver.disconnect()
        except Exception as e:
            logger.warning(f"[API] disconnect {test_id}: {e}")
        ss.clear_driver(test_id)
    return jsonify({"ok": True})


# ── Test control ───────────────────────────────────────────────────────────────

@api_bp.route("/start", methods=["POST"])
def start():
    data    = request.json or {}
    test_id = data.get("test_id")
    driver  = ss.get_driver(test_id)

    if not driver:
        return jsonify({"ok": False, "error": "Not connected"}), 400
    if driver._running:
        return jsonify({"ok": False, "error": "Already running"}), 400

    params = {k: v for k, v in data.items() if k != "test_id"}
    try:
        driver.start_test(**params)
        return jsonify({"ok": True})
    except Exception as e:
        logger.error(f"[API] start {test_id}: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500


@api_bp.route("/stop", methods=["POST"])
def stop():
    data    = request.json or {}
    test_id = data.get("test_id")
    driver  = ss.get_driver(test_id)
    if driver:
        try:
            driver.stop_test()
        except Exception as e:
            logger.warning(f"[API] stop {test_id}: {e}")
    return jsonify({"ok": True})


# ── Status ─────────────────────────────────────────────────────────────────────

@api_bp.route("/status", methods=["GET"])
def status():
    result = {}
    for eq in list_equipment():
        tid    = eq["test_id"]
        driver = ss.get_driver(tid)
        if driver:
            s = driver.get_status()
            result[tid] = {
                "connected": s.connected,
                "running":   s.running,
                "port":      s.port,
                "error":     s.error,
                "extra":     s.extra,
            }
        else:
            result[tid] = {
                "connected": False,
                "running":   False,
                "port":      ss.get_port(tid),
                "error":     None,
                "extra":     {},
            }
    return jsonify(result)