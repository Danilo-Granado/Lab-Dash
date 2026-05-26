"""
equipment/viscosity.py
----------------------
Driver for the IKA Rotavisc LO-VI Viscosimeter.

Wraps serial_comm.py, parser.py, stability.py, and torque_controller.py
from the existing codebase into the EquipmentBase interface.

Two modes:
  fixed_rpm   — user sets RPM; auto-stops when viscosity is stable
  auto_torque — PID controller adjusts RPM to maintain a target torque %;
                auto-stops when viscosity is stable at the settled torque
"""

import threading
import time
import logging

import serial

from equipment.base import EquipmentBase, EquipmentStatus, Reading
from config import VISCOSITY_POLL_INTERVAL_S

logger = logging.getLogger(__name__)

# ── Serial constants (from serial_comm.py) ────────────────────────────────────
TX_TERMINATOR      = b" \r\n"
CMD_READ_VISCOSITY = "IN_PV_80"
CMD_READ_TORQUE    = "IN_PV_5"
CMD_READ_SPEED     = "IN_PV_4"
CMD_SET_SPEED      = "OUT_SP_4"
CMD_SET_SPINDLE    = "OUT_SP_81"
CMD_START_MOTOR    = "START_4"
CMD_STOP_MOTOR     = "STOP_4"

# ── Stability defaults (from stability.py) ────────────────────────────────────
WINDOW_SIZE              = 15
STABILITY_THRESHOLD      = 2.5   # % relative range — fixed RPM mode
STABILITY_THRESHOLD_AUTO = 2.5   # % relative range — auto torque mode
MIN_STABLE_DURATION      = 15.0  # seconds
MIN_STABLE_DURATION_AUTO = 20.0  # seconds

# ── Torque controller defaults (from torque_controller.py) ───────────────────
TORQUE_SETPOINT       = 50.0
TORQUE_INNER_DEADBAND =  1.0
FINE_ZONE_THRESHOLD   =  3.0
MAX_STEP_COARSE       =  2.5
MAX_STEP_FINE         =  0.1
MIN_INCREMENT         =  0.1
SPEED_MIN             =  5.0
SPEED_MAX             = 200.0
SETTLING_TICKS        =  6
Kp, Ki, Kd            = 0.6, 0.15, 0.6


class ViscosityMeter(EquipmentBase):

    test_id      = "viscosity"
    display_name = "Viscosity"
    unit         = "mPa·s"

    def __init__(self):
        self.port         = "COM3"
        self._ser: serial.Serial | None = None
        self._stop_flag   = threading.Event()
        self._running     = False
        self._last_error: str | None = None
        # test parameters — set by start_test()
        self._mode        = "fixed_rpm"   # "fixed_rpm" | "auto_torque"
        self._spindle     = 1
        self._speed       = 50.0
        self._torque_setpoint = TORQUE_SETPOINT
        # live state
        self._current_speed = 0.0

    # ── Configuration ─────────────────────────────────────────────────────────

    def configure(self, port: str, **kwargs) -> None:
        self.port = port

    # ── Connection ────────────────────────────────────────────────────────────

    def connect(self) -> None:
        logger.info(f"[Viscosity] Connecting on {self.port}")
        self._ser = serial.Serial(
            port     = self.port,
            baudrate = 9600,
            bytesize = serial.EIGHTBITS,
            parity   = serial.PARITY_NONE,
            stopbits = serial.STOPBITS_ONE,
            timeout  = 2.0,
            xonxoff  = False,
            rtscts   = False,
            dsrdtr   = False,
        )
        time.sleep(0.5)
        self._drain_input()
        self._last_error = None
        logger.info("[Viscosity] Connected.")

    def disconnect(self) -> None:
        if self._ser and self._ser.is_open:
            self._ser.close()
            logger.info("[Viscosity] Disconnected.")

    def is_connected(self) -> bool:
        return self._ser is not None and self._ser.is_open

    # ── Test control ──────────────────────────────────────────────────────────

    def start_test(self, **kwargs) -> None:
        """
        kwargs:
          mode (str):             "fixed_rpm" | "auto_torque"
          spindle (int):          spindle number
          speed (float):          initial RPM (fixed_rpm mode)
          torque_setpoint (float): target torque % (auto_torque mode)
        """
        if not self.is_connected():
            raise RuntimeError("Not connected.")

        self._mode             = kwargs.get("mode", "fixed_rpm")
        self._spindle          = int(kwargs.get("spindle", 1))
        self._speed            = float(kwargs.get("speed", 50.0))
        self._torque_setpoint  = float(kwargs.get("torque_setpoint", TORQUE_SETPOINT))
        self._current_speed    = self._speed
        self._stop_flag.clear()
        self._running = True

        # Motor startup sequence (order is critical — see README)
        self._query_validated(f"{CMD_SET_SPINDLE} {self._spindle}")
        self._query_validated(CMD_START_MOTOR)
        time.sleep(1.0)
        self._query_validated(f"{CMD_SET_SPEED} {self._speed:.2f}")

        logger.info(f"[Viscosity] Test started — mode={self._mode} speed={self._speed} RPM")

    def stop_test(self) -> None:
        self._stop_flag.set()
        self._running = False
        if self.is_connected():
            try:
                self._query_validated(CMD_STOP_MOTOR)
            except Exception as e:
                logger.warning(f"[Viscosity] Stop command failed: {e}")
        logger.info("[Viscosity] Test stopped.")

    # ── Streaming ─────────────────────────────────────────────────────────────

    def stream_readings(self):
        """
        Polls IN_PV_80 (and IN_PV_5 in auto_torque mode) every
        VISCOSITY_POLL_INTERVAL_S seconds. Evaluates stability after
        each reading. Yields a Reading; final=True when stable and
        ready to stop.
        """
        from collections import deque
        import math

        # ── Stability state ───────────────────────────────────────────────────
        threshold = (
            STABILITY_THRESHOLD_AUTO if self._mode == "auto_torque"
            else STABILITY_THRESHOLD
        )
        min_stable = (
            MIN_STABLE_DURATION_AUTO if self._mode == "auto_torque"
            else MIN_STABLE_DURATION
        )
        buffer: deque[float] = deque(maxlen=WINDOW_SIZE)
        stable_since: float | None = None

        # ── PID state (auto_torque only) ──────────────────────────────────────
        pid_integral   = 0.0
        pid_last_error: float | None = None
        settling_ticks = 0

        while not self._stop_flag.is_set():
            tick_start = time.monotonic()

            try:
                # ── Read viscosity ─────────────────────────────────────────────
                raw_visc = self._query(CMD_READ_VISCOSITY)
                viscosity = self._parse_float(raw_visc, CMD_READ_VISCOSITY)

                torque = None
                if self._mode == "auto_torque":
                    raw_torq = self._query(CMD_READ_TORQUE)
                    torque = self._parse_float(raw_torq, CMD_READ_TORQUE)

                # ── Stability evaluation ───────────────────────────────────────
                buffer.append(viscosity)
                is_stable = False
                rel_range = None

                if len(buffer) == WINDOW_SIZE:
                    readings = list(buffer)
                    mean     = sum(readings) / len(readings)
                    if mean > 0:
                        rel_range = (max(readings) - min(readings)) / mean * 100.0
                        is_stable = rel_range < threshold

                if is_stable:
                    if stable_since is None:
                        stable_since = time.monotonic()
                else:
                    stable_since = None

                stable_for_s = (
                    round(time.monotonic() - stable_since, 1)
                    if stable_since else 0.0
                )
                ready_to_stop = stable_for_s >= min_stable

                # ── PID adjustment (auto_torque only) ─────────────────────────
                if self._mode == "auto_torque" and torque is not None:
                    if settling_ticks > 0:
                        settling_ticks -= 1
                    else:
                        new_speed = self._pid_step(
                            torque, self._current_speed,
                            pid_integral, pid_last_error,
                            self._torque_setpoint,
                        )
                        if new_speed is not None:
                            self._current_speed = new_speed
                            self._query_validated(
                                f"{CMD_SET_SPEED} {self._current_speed:.2f}"
                            )
                            buffer.clear()
                            stable_since = None
                            settling_ticks = SETTLING_TICKS

                # ── Yield reading ──────────────────────────────────────────────
                values = {
                    "viscosity":    round(viscosity, 2),
                    "torque":       round(torque, 2) if torque is not None else None,
                    "speed_rpm":    round(self._current_speed, 2),
                    "rel_range_pct": round(rel_range, 3) if rel_range is not None else None,
                    "stable_for_s": stable_for_s,
                    "buffer_fill":  len(buffer),
                }

                if ready_to_stop:
                    self._running = False
                    yield Reading(values=values, stable=True, final=True)
                    self.stop_test()
                    return

                yield Reading(values=values, stable=is_stable, final=False)

            except Exception as e:
                self._last_error = str(e)
                logger.error(f"[Viscosity] Read error: {e}")
                yield Reading(values={}, error=str(e))

            # ── Maintain poll interval ─────────────────────────────────────────
            elapsed = time.monotonic() - tick_start
            sleep_for = max(0.0, VISCOSITY_POLL_INTERVAL_S - elapsed)
            self._stop_flag.wait(timeout=sleep_for)

    # ── Status ────────────────────────────────────────────────────────────────

    def get_status(self) -> EquipmentStatus:
        return EquipmentStatus(
            connected = self.is_connected(),
            running   = self._running,
            port      = self.port,
            error     = self._last_error,
            extra     = {
                "mode":        self._mode,
                "speed_rpm":   self._current_speed,
                "spindle":     self._spindle,
            },
        )

    # ── Serial helpers ────────────────────────────────────────────────────────

    def _send(self, cmd: str) -> None:
        self._ser.write(cmd.encode("ascii") + TX_TERMINATOR)

    def _read_line(self) -> bytes:
        return self._ser.readline()

    def _query(self, cmd: str) -> bytes:
        self._send(cmd)
        return self._read_line()

    def _query_validated(self, cmd: str) -> bytes:
        response = self._query(cmd)
        expected = cmd.split()[0].encode("ascii")
        if not response.startswith(expected):
            raise RuntimeError(
                f"Echo mismatch — sent '{cmd}', got: {response!r}"
            )
        return response

    def _drain_input(self) -> None:
        while self._ser.in_waiting > 0:
            stale = self._ser.readline()
            logger.warning(f"[Viscosity] Drained stale: {stale!r}")

    def _parse_float(self, raw: bytes, expected_cmd: str) -> float:
        if not raw:
            raise ValueError(f"Empty response for {expected_cmd}")
        decoded = raw.decode("ascii").strip()
        tokens  = decoded.split()
        if len(tokens) < 2 or tokens[0] != expected_cmd:
            raise ValueError(f"Bad response for {expected_cmd}: {decoded!r}")
        return float(tokens[1])

    def _pid_step(
        self,
        torque: float,
        speed: float,
        integral: float,
        last_error: float | None,
        setpoint: float,
    ) -> float | None:
        """Inline PID — same logic as torque_controller.py."""
        import math
        error = setpoint - torque
        if abs(error) < TORQUE_INNER_DEADBAND:
            return None
        zone     = "fine" if abs(error) <= FINE_ZONE_THRESHOLD else "coarse"
        max_step = MAX_STEP_FINE if zone == "fine" else MAX_STEP_COARSE

        integral += error * VISCOSITY_POLL_INTERVAL_S
        ilim      = max_step / (Ki if Ki != 0 else 1.0)
        integral  = max(-ilim, min(ilim, integral))

        p = Kp * error
        i = Ki * integral
        d = (Kd * (error - last_error) / VISCOSITY_POLL_INTERVAL_S
             if last_error is not None else 0.0)
        raw = p + i + d

        clamped = max(-max_step, min(max_step, raw))
        if 0 < abs(clamped) < MIN_INCREMENT:
            clamped = math.copysign(MIN_INCREMENT, clamped)

        new_speed = round(speed + clamped, 2)
        new_speed = max(SPEED_MIN, min(SPEED_MAX, new_speed))
        return new_speed
