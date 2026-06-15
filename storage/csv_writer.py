"""
storage/csv_writer.py
---------------------
Persists test results to a flat CSV file.

This is the ONLY file that touches the filesystem for result storage.
To integrate a database later: implement the same save_result(),
get_results(), and update_approval() signatures in a new module
(e.g. storage/db_writer.py) and update the import in routes/storage.py.
Nothing else changes.

CSV columns:
    timestamp, po_number, product_name, test_id, display_name, result_json,
    notes, approval_status, override_justification
"""

import csv
import json
import logging
from datetime import datetime
from pathlib import Path

from config import CSV_OUTPUT_DIR

logger = logging.getLogger(__name__)

CSV_PATH = Path(CSV_OUTPUT_DIR) / "results.csv"

FIELDNAMES = [
    "timestamp",
    "po_number",
    "product_name",              # display_name of the active profile
    "test_id",
    "display_name",
    "result_json",
    "notes",
    "approval_status",          # "approved" | "rejected" | "override_approved" | "override_rejected"
    "override_justification",   # non-empty only when status is an override
]

# Valid status values
APPROVED          = "approved"
REJECTED          = "rejected"
OVERRIDE_APPROVED = "override_approved"
OVERRIDE_REJECTED = "override_rejected"


def _ensure_file() -> None:
    """Create the CSV with a header row if it doesn't exist yet."""
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not CSV_PATH.exists():
        with open(CSV_PATH, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
            writer.writeheader()
        logger.info(f"Created results CSV at {CSV_PATH}")


def save_result(
    po_number:    str,
    test_id:      str,
    display_name: str,
    values:       dict,
    notes:        str = "",
    approval_status: str = APPROVED,
    override_justification: str = "",
    product_name: str = "",
) -> dict:
    """
    Append one result row to the CSV.

    Args:
        po_number:               Production order number
        test_id:                 Equipment identifier e.g. "moisture"
        display_name:            Human-readable test name e.g. "Moisture Content"
        values:                  Dict of measurement values
        notes:                   Optional operator notes
        approval_status:         One of the four status constants above
        override_justification:  Required when status is an override
        product_name:            Display name of the active product profile

    Returns:
        The row dict that was written.
    """
    _ensure_file()

    row = {
        "timestamp":              datetime.now().isoformat(timespec="seconds"),
        "po_number":              po_number,
        "product_name":           product_name,
        "test_id":                test_id,
        "display_name":           display_name,
        "result_json":            json.dumps(values),
        "notes":                  notes,
        "approval_status":        approval_status,
        "override_justification": override_justification,
    }

    with open(CSV_PATH, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writerow(row)

    logger.info(
        f"Result saved — PO={po_number}  test={test_id}  "
        f"status={approval_status}  values={values}"
    )
    return row


def get_results(
    po_number: str | None = None,
    test_id: str | None = None,
    product_name: str | None = None
) -> list[dict]:
    """
    Read results from the CSV, optionally filtered by PO, test_id and/or product_name.
    Returns a list of dicts with result_json parsed back to dict.
    Results are returned newest-first.
    """
    _ensure_file()

    rows = []
    with open(CSV_PATH, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if po_number and po_number.lower() not in row.get("po_number", "").lower():
                continue
            if test_id and row["test_id"] != test_id:
                continue
            if product_name and product_name.lower() not in row.get("product_name", "").lower():
                continue
            try:
                row["values"] = json.loads(row["result_json"])
            except (json.JSONDecodeError, KeyError):
                row["values"] = {}
            # Ensure new columns exist even in older CSV files
            row.setdefault("approval_status", APPROVED)
            row.setdefault("override_justification", "")
            row.setdefault("product_name", "")
            rows.append(row)

    return list(reversed(rows))  # newest first


def update_approval(
    timestamp:              str,
    new_status:             str,
    override_justification: str = "",
) -> bool:
    """
    Rewrite the CSV in-place to update the approval_status of the row
    matching the given timestamp.

    Returns True if a row was found and updated, False otherwise.
    """
    _ensure_file()

    rows = []
    found = False

    with open(CSV_PATH, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Ensure new columns exist for legacy rows
            row.setdefault("approval_status", APPROVED)
            row.setdefault("override_justification", "")
            if row["timestamp"] == timestamp:
                row["approval_status"]        = new_status
                row["override_justification"] = override_justification
                found = True
            rows.append(row)

    if found:
        with open(CSV_PATH, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
            writer.writeheader()
            writer.writerows(rows)
        logger.info(f"Approval updated — timestamp={timestamp}  new_status={new_status}")

    return found