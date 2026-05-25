"""
equipment/registry.py
---------------------
Central registry mapping test_id strings to equipment driver classes.

To add a new equipment type:
  1. Create equipment/<name>.py with a class subclassing EquipmentBase
  2. Import it here and add one line to REGISTRY

That's it — the rest of the app (routes, frontend tab list) discovers
equipment from this registry automatically.
"""

from equipment.moisture  import MoistureAnalyzer
from equipment.viscosity import ViscosityMeter

REGISTRY: dict[str, type] = {
    "moisture":  MoistureAnalyzer,
    "viscosity": ViscosityMeter,
}


def get_driver(test_id: str):
    """Return an instantiated driver for the given test_id, or raise KeyError."""
    cls = REGISTRY[test_id]
    return cls()


def list_equipment() -> list[dict]:
    """Return metadata for all registered equipment (for the frontend)."""
    result = []
    for test_id, cls in REGISTRY.items():
        result.append({
            "test_id":      test_id,
            "display_name": cls.display_name,
            "unit":         cls.unit,
        })
    return result
