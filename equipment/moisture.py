"""
equipment/moisture.py
---------------------
Driver for the Ohaus MB27 Moisture Analyzer.

Wraps the existing serial logic from main.py into the EquipmentBase interface.
The MB27 is event-driven: one START command fires the test; the app then polls
with "P" every POLL_INTERVAL seconds until the final result block appears.
There are no intermediate numeric readings — only the final block contains values.
"""

import serial
import time
import re
import threading
import logging
from datetime import datetime

from equipment.base import EquipmentBase, EquipmentStatus, Reading
from config import MOISTURE_POLL_INTERVAL_S

logger = logging.getLogger(__name__)

# ── Regex patterns (from original main.py) ────────────────────────────────────
_ELAPSED_RE  = re.compile(r"Elapsed Time\s+([\d:]+)")
_INIT_WT_RE  = re.compile(r"Initial Weight\s+([\d.]+)\s*Grams", re.IGNORECASE)
_FINAL_WT_RE = re.compile(r"Final Weight\s+([\d.]+)\s*Grams", re.IGNORECASE)
_RESULT_RE   = re.compile(r"Final Result\s+([\d.]+)%")


class MoistureAnalyzer(EquipmentBase):

    test_id      = "moisture"
    display_name = "Moisture Content"
    unit         = "%MC"

    def __init__(self):
        self.port          = "COM4"
        self._ser: serial.Serial | None = None
        self._stop_flag    = threading.Event()
        self._running      = False
        self._last_error: str | None = None
        self._started_at: str | None = None
        self._last_poll_lines: list[str] = []

    # ── Configuration ─────────────────────────────────────────────────────────

    def configure(self, port: str, **kwargs) -> None:
        self.port = port

    # ── Connection ────────────────────────────────────────────────────────────

    def connect(self) -> None:
        logger.info(f"[Moisture] Connecting on {self.port}")
        self._ser = serial.Serial(
            port     = self.port,
            baudrate = 2400,
            bytesize = 7,
            parity   = serial.PARITY_NONE,
            stopbits = serial.STOPBITS_TWO,
            xonxoff  = True,
            timeout  = 2,
        )
        time.sleep(0.5)
        self._ser.reset_input_buffer()
        self._last_error = None
        logger.info("[Moisture] Connected.")

    def disconnect(self) -> None:
        if self._ser and self._ser.is_open:
            self._ser.close()
            logger.info("[Moisture] Disconnected.")

    def is_connected(self) -> bool:
        return self._ser is not None and self._ser.is_open

    # ── Test control ──────────────────────────────────────────────────────────

    def start_test(self, **kwargs) -> None:
        if not self.is_connected():
            raise RuntimeError("Not connected.")
        self._stop_flag.clear()
        self._running = True
        self._started_at = datetime.now().isoformat(timespec="seconds")
        self._ser.reset_input_buffer()
        self._send("START")
        logger.info("[Moisture] Test started.")

    def stop_test(self) -> None:
        self._stop_flag.set()
        self._running = False
        if self.is_connected():
            try:
                self._send("STOP")
            except Exception:
                pass
        logger.info("[Moisture] Test stopped.")

    # ── Streaming ─────────────────────────────────────────────────────────────

    def stream_readings(self):
        """
        Polls the analyzer every POLL_INTERVAL seconds.
        Yields a Reading on each poll with whatever state is known.
        Yields a final=True Reading when the end-of-test block arrives.
        """
        max_duration = 60 * 60  # 60-minute hard cutoff
        deadline     = time.time() + max_duration

        while not self._stop_flag.is_set() and time.time() < deadline:
            self._stop_flag.wait(timeout=MOISTURE_POLL_INTERVAL_S)
            if self._stop_flag.is_set():
                break

            try:
                self._ser.reset_input_buffer()
                self._send("P")
                time.sleep(1.0)
                lines = self._read_all_lines()
                self._last_poll_lines = lines

                if self._is_complete(lines):
                    final = self._parse_end_block(lines)
                    self._running = False
                    yield Reading(
                        values={
                            "moisture_pct":    final.get("final_moisture_pct"),
                            "initial_weight_g": final.get("initial_weight_g"),
                            "final_weight_g":   final.get("final_weight_g"),
                            "elapsed_time":     final.get("elapsed_time"),
                        },
                        final=True,
                    )
                    return
                else:
                    # Intermediate poll — no numeric value yet, just heartbeat
                    elapsed_s = time.time() - (
                        datetime.fromisoformat(self._started_at).timestamp()
                        if self._started_at else time.time()
                    )
                    yield Reading(
                        values={
                            "status":    "running",
                            "elapsed_s": round(elapsed_s),
                            "last_poll": lines,
                        },
                        final=False,
                    )

            except Exception as e:
                self._last_error = str(e)
                logger.error(f"[Moisture] Poll error: {e}")
                yield Reading(values={}, error=str(e))

        if time.time() >= deadline:
            yield Reading(values={}, error="Safety timeout reached (60 min).")

    # ── Status ────────────────────────────────────────────────────────────────

    def get_status(self) -> EquipmentStatus:
        return EquipmentStatus(
            connected = self.is_connected(),
            running   = self._running,
            port      = self.port,
            error     = self._last_error,
            extra     = {"started_at": self._started_at},
        )

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _send(self, cmd: str) -> None:
        self._ser.write(f"{cmd}\r\n".encode("ascii"))
        self._ser.flush()

    def _read_all_lines(self) -> list[str]:
        lines = []
        while True:
            buf = bytearray()
            while True:
                ch = self._ser.read(1)
                if not ch:
                    break
                if ch in (b"\r", b"\n"):
                    if buf:
                        break
                else:
                    buf.extend(ch)
            if not buf:
                break
            line = buf.decode("ascii", errors="replace").strip()
            if line:
                lines.append(line)
        return lines

    def _is_complete(self, lines: list[str]) -> bool:
        return any("Elapsed Time" in l or "Final Result" in l for l in lines)

    def _parse_end_block(self, lines: list[str]) -> dict:
        result = {}
        for line in lines:
            if m := _ELAPSED_RE.search(line):
                result["elapsed_time"] = m.group(1)
            elif m := _INIT_WT_RE.search(line):
                result["initial_weight_g"] = float(m.group(1))
            elif m := _FINAL_WT_RE.search(line):
                result["final_weight_g"] = float(m.group(1))
            elif m := _RESULT_RE.search(line):
                result["final_moisture_pct"] = float(m.group(1))
        return result
