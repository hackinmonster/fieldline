"""Single source of time for the whole backend.

In production `sim_now()` would just return the wall clock. For the demo the
replayer (DEMO-STUB) anchors simulated time to a historical instant and sets a
speed multiplier. Nothing else in the backend reads the wall clock directly.
"""
import time
from datetime import datetime, timezone

_anchor_sim: datetime | None = None
_anchor_wall: float = 0.0
_speed: float = 1.0


def sim_now() -> datetime:
    if _anchor_sim is None:
        return datetime.now(timezone.utc)
    from datetime import timedelta
    return _anchor_sim + timedelta(seconds=(time.monotonic() - _anchor_wall) * _speed)


def set_clock(at: datetime, speed: float = 1.0) -> None:
    global _anchor_sim, _anchor_wall, _speed
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    _anchor_sim, _anchor_wall, _speed = at, time.monotonic(), speed


def clock_state() -> dict:
    return {"sim_now": sim_now().isoformat(), "speed": _speed, "simulated": _anchor_sim is not None}
