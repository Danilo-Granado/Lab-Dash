"""
routes/storage.py
-----------------
Endpoints for saving confirmed results and fetching/updating history.

POST  /storage/save                  — save a confirmed result to CSV
GET   /storage/results               — fetch results (filter by PO / test_id)
PATCH /storage/results/<timestamp>   — update approval status after saving
"""

import logging

from flask import Blueprint, jsonify, request

from storage.csv_writer import (
    save_result, get_results, update_approval,
    APPROVED, REJECTED, OVERRIDE_APPROVED, OVERRIDE_REJECTED,
)
from equipment.registry import list_equipment

storage_bp = Blueprint("storage", __name__)
logger     = logging.getLogger(__name__)

VALID_STATUSES = {APPROVED, REJECTED, OVERRIDE_APPROVED, OVERRIDE_REJECTED}


@storage_bp.route("/save", methods=["POST"])
def save():
    data = request.json or {}

    required = ["po_number", "test_id", "values", "approval_status"]
    missing  = [f for f in required if f not in data]
    if missing:
        return jsonify({"ok": False, "error": f"Missing fields: {missing}"}), 400

    status = data["approval_status"]
    if status not in VALID_STATUSES:
        return jsonify({"ok": False, "error": f"Invalid approval_status: {status}"}), 400

    # Override statuses require a non-empty justification
    if status in (OVERRIDE_APPROVED, OVERRIDE_REJECTED):
        if not data.get("override_justification", "").strip():
            return jsonify({"ok": False, "error": "override_justification is required for overrides"}), 400

    equipment    = {e["test_id"]: e for e in list_equipment()}
    eq_info      = equipment.get(data["test_id"], {})
    display_name = eq_info.get("display_name", data["test_id"])

    try:
        row = save_result(
            po_number               = data["po_number"],
            test_id                 = data["test_id"],
            display_name            = display_name,
            values                  = data["values"],
            notes                   = data.get("notes", ""),
            approval_status         = status,
            override_justification  = data.get("override_justification", ""),
            product_name            = data.get("product_name", ""),
        )
        return jsonify({"ok": True, "row": row})
    except Exception as e:
        logger.error(f"[Storage] save error: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500


@storage_bp.route("/results", methods=["GET"])
def results():
    po_number    = request.args.get("po_number") or None
    test_id      = request.args.get("test_id")   or None
    product_name = request.args.get("product_name") or None
    try:
        rows = get_results(po_number=po_number, test_id=test_id, product_name=product_name)
        return jsonify(rows)
    except Exception as e:
        logger.error(f"[Storage] fetch error: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500


@storage_bp.route("/results/<path:timestamp>", methods=["PATCH"])
def patch_approval(timestamp):
    """
    Update the approval status of a saved result identified by its timestamp.
    Body: { "approval_status": "...", "override_justification": "..." }
    """
    data       = request.json or {}
    new_status = data.get("approval_status", "")
    justification = data.get("override_justification", "").strip()

    if new_status not in VALID_STATUSES:
        return jsonify({"ok": False, "error": f"Invalid approval_status: {new_status}"}), 400

    if new_status in (OVERRIDE_APPROVED, OVERRIDE_REJECTED) and not justification:
        return jsonify({"ok": False, "error": "override_justification is required"}), 400

    try:
        found = update_approval(
            timestamp               = timestamp,
            new_status              = new_status,
            override_justification  = justification,
        )
        if not found:
            return jsonify({"ok": False, "error": "No result found with that timestamp"}), 404
        return jsonify({"ok": True})
    except Exception as e:
        logger.error(f"[Storage] patch error: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500