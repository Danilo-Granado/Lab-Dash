"""
equipment/base.py
-----------------
Abstract base class every equipment module must implement.

Adding a new test type:
  1. Create equipment/<name>.py
  2. Subclass EquipmentBase
  3. Implement all abstract methods
  4. Register it in equipment/registry.py

Nothing else in the app needs to change.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Reading:
    """
    A single data point from any equipment.
    `values` is a dict so each device can expose its own named channels
    (e.g. viscosity + torque, or moisture_pct + weight).
    `stable` is only meaningful for streaming devices.
    `final` marks the definitive end-of-test result.
    """
    values:    dict[str, Any]
    stable:    bool = False
    final:     bool = False
    error:     str | None = None


@dataclass
class EquipmentStatus:
    connected:   bool = False
    running:     bool = False
    port:        str  = ""
    error:       str | None = None
    extra:       dict = field(default_factory=dict)  # device-specific state


class EquipmentBase(ABC):
    """
    Base class for all lab equipment drivers.

    Lifecycle:
        configure(port, **kwargs)   ← called from Overview tab settings
        connect()                   ← opens serial port
        start_test(**kwargs)        ← begins acquisition
        stream_readings()           ← generator, yields Reading objects
        stop_test()                 ← stops acquisition cleanly
        disconnect()                ← closes serial port
    """

    # ── Identity ──────────────────────────────────────────────────────────────
    # Subclasses must set these as class attributes.

    test_id:     str = ""   # e.g. "moisture", "viscosity"
    display_name: str = ""  # e.g. "Moisture Content", "Viscosity"
    unit:        str = ""   # e.g. "%MC", "mPa·s"

    # ── Configuration ─────────────────────────────────────────────────────────

    def configure(self, port: str, **kwargs) -> None:
        """
        Apply runtime configuration (port, mode, parameters).
        Called before connect(). Safe to call again to reconfigure.
        """
        self.port = port

    # ── Connection ────────────────────────────────────────────────────────────

    @abstractmethod
    def connect(self) -> None:
        """Open the serial connection."""
        ...

    @abstractmethod
    def disconnect(self) -> None:
        """Close the serial connection cleanly."""
        ...

    @abstractmethod
    def is_connected(self) -> bool:
        ...

    # ── Test control ──────────────────────────────────────────────────────────

    @abstractmethod
    def start_test(self, **kwargs) -> None:
        """Begin the test. kwargs carries mode-specific parameters."""
        ...

    @abstractmethod
    def stop_test(self) -> None:
        """Stop the test and leave the device in a safe state."""
        ...

    # ── Data ──────────────────────────────────────────────────────────────────

    @abstractmethod
    def stream_readings(self):
        """
        Generator that yields Reading objects until the test ends or is stopped.
        Must respect a stop signal — check self._stop_flag in the loop.
        """
        ...

    # ── Status ────────────────────────────────────────────────────────────────

    @abstractmethod
    def get_status(self) -> EquipmentStatus:
        """Return current connection and run state."""
        ...
