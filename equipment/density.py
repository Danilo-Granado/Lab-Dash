"""
equipment/density.py
--------------------
Driver for manual density measurement using graded picnometers.

No serial connection — the operator weighs the filled picnometer on a
scale and types the reading in. The driver performs:

    density = (gross_weight_g - picnometer_weight_g) / volume_ml

Picnometer data is hardcoded here since there are only two in use.
To add more, extend the PICNOMETERS list.
"""

import threading
from equipment.base import EquipmentBase, EquipmentStatus, Reading

# ── Picnometer definitions ────────────────────────────────────────────────────
# weight_g : empty picnometer weight
# volume_ml: calibrated volume

PICNOMETERS = [
    {"id": 8, "label": "Picnometer 8", "weight_g": 52.21, "volume_ml": 24.85},
    {"id": 10, "label": "Picnometer 10", "weight_g": 143.48, "volume_ml": 24.87},
]


def calculate_density(gross_weight_g: float, picnometer_id: int) -> dict:
    """
    Calculate density from a gross weight reading.

    Returns a dict with the result and the inputs used, or raises
    ValueError if the picnometer_id is unknown or the result is
    physically implausible (negative density).
    """
    pic = next((p for p in PICNOMETERS if p["id"] == picnometer_id), None)
    if pic is None:
        raise ValueError(f"Unknown picnometer ID: {picnometer_id}")

    net_weight = gross_weight_g - pic["weight_g"]
    if net_weight <= 0:
        raise ValueError(
            f"Gross weight ({gross_weight_g} g) must be greater than "
            f"picnometer weight ({pic['weight_g']} g)."
        )

    density = round(net_weight / pic["volume_ml"], 4)
    return {
        "density_g_ml":      density,
        "gross_weight_g":    gross_weight_g,
        "picnometer_id":     picnometer_id,
        "picnometer_label":  pic["label"],
        "picnometer_weight_g": pic["weight_g"],
        "picnometer_volume_ml": pic["volume_ml"],
        "net_weight_g":      round(net_weight, 4),
    }


class DensityMeter(EquipmentBase):

    test_id      = "density"
    display_name = "Density"
    unit         = "g/mL"

    # Manual-input — no serial port needed
    def __init__(self):
        self.port        = "N/A"
        self._running    = False
        self._last_error: str | None = None

    def configure(self, port: str = "N/A", **kwargs) -> None:
        pass  # no serial port

    def connect(self) -> None:
        pass  # always "connected"

    def disconnect(self) -> None:
        pass

    def is_connected(self) -> bool:
        return True  # manual input is always available

    def check_connection(self) -> bool:
        return True

    def start_test(self, **kwargs) -> None:
        self._running = True

    def stop_test(self) -> None:
        self._running = False

    def stream_readings(self):
        # Manual input doesn't stream — the tab drives submission directly
        # via calculate_density(); this generator is a no-op placeholder.
        return iter([])

    def get_status(self) -> EquipmentStatus:
        return EquipmentStatus(
            connected = True,
            running   = self._running,
            port      = self.port,
            error     = self._last_error,
            extra     = {"picnometers": len(PICNOMETERS)},
        )