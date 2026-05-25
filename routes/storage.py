"""
routes/storage.py
-----------------
Endpoints for saving confirmed results and fetching history.

POST /storage/save      — save a confirmed result to CSV
GET  /storage/results   — fetch results (optionally filtered by PO / test_id)
"""

import logging

from flask import Blueprint, jsonify, request

from storage.csv_writer import save_result, get_results
from equipment.registry import list_equipment

storage_bp = Blueprint("storage", __name__)
logger     = logging.getLogger(__name__)


@storage_bp.route("/save", methods=["POST"])
def save():
    data = request.json or {}

    required = ["po_number", "test_id", "values"]
    missing  = [f for f in required if f not in data]
    if missing:
        return jsonify({"ok": False, "error": f"Missing fields: {missing}"}), 400

    # Resolve display_name from registry
    equipment  = {e["test_id"]: e for e in list_equipment()}
    eq_info    = equipment.get(data["test_id"], {})
    display_name = eq_info.get("display_name", data["test_id"])

    try:
        row = save_result(
            po_number    = data["po_number"],
            test_id      = data["test_id"],
            display_name = display_name,
            values       = data["values"],
            notes        = data.get("notes", ""),
        )
        return jsonify({"ok": True, "row": row})
    except Exception as e:
        logger.error(f"[Storage] save error: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500


@storage_bp.route("/results", methods=["GET"])
def results():
    po_number = request.args.get("po_number") or None
    test_id   = request.args.get("test_id")   or None
    try:
        rows = get_results(po_number=po_number, test_id=test_id)
        return jsonify(rows)
    except Exception as e:
        logger.error(f"[Storage] fetch error: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500
