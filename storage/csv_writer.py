"""
storage/csv_writer.py
---------------------
Persists test results to a flat CSV file.

This is the ONLY file that touches the filesystem for result storage.
To integrate a database later: implement the same save_result() and
get_results() signatures in a new module (e.g. storage/db_writer.py)
and update the import in routes/storage.py. Nothing else changes.

CSV columns:
    timestamp, po_number, test_id, display_name, result_json, notes
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
    "test_id",
    "display_name",
    "result_json",
    "notes",
]


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
) -> dict:
    """
    Append one result row to the CSV.

    Args:
        po_number:    Production order number (string, user-supplied)
        test_id:      Equipment identifier e.g. "moisture", "viscosity"
        display_name: Human-readable name e.g. "Moisture Content"
        values:       Dict of measurement values (serialised to JSON)
        notes:        Optional operator notes

    Returns:
        The row dict that was written (useful for immediate UI feedback).
    """
    _ensure_file()

    row = {
        "timestamp":    datetime.now().isoformat(timespec="seconds"),
        "po_number":    po_number,
        "test_id":      test_id,
        "display_name": display_name,
        "result_json":  json.dumps(values),
        "notes":        notes,
    }

    with open(CSV_PATH, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writerow(row)

    logger.info(f"Result saved — PO={po_number}  test={test_id}  values={values}")
    return row


def get_results(po_number: str | None = None, test_id: str | None = None) -> list[dict]:
    """
    Read results from the CSV, optionally filtered by PO and/or test_id.

    Returns a list of dicts with result_json already parsed back to dict.
    Results are returned newest-first.
    """
    _ensure_file()

    rows = []
    with open(CSV_PATH, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if po_number and row["po_number"] != po_number:
                continue
            if test_id and row["test_id"] != test_id:
                continue
            # Parse JSON values back to dict for convenience
            try:
                row["values"] = json.loads(row["result_json"])
            except (json.JSONDecodeError, KeyError):
                row["values"] = {}
            rows.append(row)

    return list(reversed(rows))  # newest first
