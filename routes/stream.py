"""
routes/stream.py
----------------
Server-Sent Events (SSE) endpoints — one per equipment type.

GET /stream/<test_id>

The browser opens this endpoint when the user starts a test. Flask holds
the connection open and pushes JSON events as the driver yields readings.
No WebSocket library needed — SSE is built into every modern browser.

Event types pushed to the client:
  { "type": "reading",  "data": { ...values... }, "stable": bool, "final": bool }
  { "type": "error",    "data": { "message": "..." } }
  { "type": "stopped",  "data": {} }
"""

import json
import logging
import time

from flask import Blueprint, Response, stream_with_context

import session_state as ss

stream_bp = Blueprint("stream", __name__)
logger    = logging.getLogger(__name__)


def _sse(event_type: str, payload: dict) -> str:
    """Format a single SSE message."""
    data = json.dumps({"type": event_type, **payload})
    return f"data: {data}\n\n"


def _generate(test_id: str):
    """
    Generator that drives the SSE stream for one equipment type.
    Yields formatted SSE strings until the test ends or the driver stops.
    """
    driver = ss.get_driver(test_id)

    if not driver:
        yield _sse("error", {"message": "No driver connected for this equipment."})
        return

    if not driver._running:
        yield _sse("error", {"message": "Test not started. Call /api/start first."})
        return

    try:
        for reading in driver.stream_readings():
            if reading.error:
                yield _sse("error", {"message": reading.error})
            else:
                yield _sse("reading", {
                    "data":   reading.values,
                    "stable": reading.stable,
                    "final":  reading.final,
                })
            if reading.final:
                break

        yield _sse("stopped", {})

    except GeneratorExit:
        # Browser closed the connection
        logger.info(f"[Stream] Client disconnected from {test_id}")
        try:
            driver.stop_test()
        except Exception:
            pass
    except Exception as e:
        logger.error(f"[Stream] Unexpected error for {test_id}: {e}")
        yield _sse("error", {"message": str(e)})


@stream_bp.route("/<test_id>")
def equipment_stream(test_id: str):
    headers = {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",   # disable nginx buffering if behind a proxy
    }
    return Response(
        stream_with_context(_generate(test_id)),
        headers=headers,
    )
