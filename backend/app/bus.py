"""In-process event bus + WebSocket fan-out.

Every state change is published here; the WebSocket hub forwards all events to
connected clients (dashboard + volunteer app). Also persists a human-readable
activity feed so the dashboard can show *why* the system did something.
"""
import asyncio
import json
import logging
from datetime import datetime

from fastapi import WebSocket

log = logging.getLogger("bus")


class Hub:
    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket):
        self.clients.discard(ws)

    async def broadcast(self, msg: dict):
        data = json.dumps(msg, default=_default)
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


hub = Hub()


def _default(o):
    if isinstance(o, datetime):
        return o.isoformat()
    return str(o)


async def publish(event: str, data: dict | None = None):
    await hub.broadcast({"event": event, "data": data or {}})


async def activity(kind: str, message: str, data: dict | None = None):
    """Record + broadcast a decision/explanation for the activity feed."""
    from . import db
    from .clock import sim_now
    at = sim_now()
    await db.execute("INSERT INTO activity (at, kind, message, data) VALUES (%s,%s,%s,%s)",
                     at, kind, message, db.J(data or {}))
    log.info("[%s] %s", kind, message)
    await publish("activity", {"at": at, "kind": kind, "message": message, "data": data or {}})


def spawn(coro):
    task = asyncio.create_task(coro)
    task.add_done_callback(_log_exc)
    return task


def _log_exc(t: asyncio.Task):
    if not t.cancelled() and t.exception():
        log.exception("background task failed", exc_info=t.exception())
