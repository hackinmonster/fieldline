"""DEMO-STUB: scenario playback + simulated volunteer GPS, driven from the dashboard.

Replaces the terminal replayer. Everything here only *feeds* the real system through the
same functions the public API exposes:
  - setup():   reset → register the scenario's volunteers → stream real NCDOT/USGS history and
               the hand-authored reports (social, NGO, SMS, radio) in time order, waiting for the
               real pipeline (LLM extraction → incident linking → task proposal → validator) to
               finish each one, then park the clock at the live-phase start.
  - rewind():  undo the live phase (dispatches, movement) without re-running ingestion.
  - movement:  moves volunteers along ACCEPTED routes, arriving exactly at the routed ETA, and
               fast-forwards the clock while someone is driving. A real phone would post GPS instead.
Dispatch is operator-approved (matcher.auto_dispatch = False), so tasks wait for command.
"""
import asyncio
import logging
import math
from pathlib import Path

import yaml

from .. import db
from ..bus import publish
from ..clock import clock_state, set_clock, sim_now
from ..config import BACKEND_DIR
from ..coordination import matcher
from ..intelligence import pipeline
from .feeds import ncdot_events, ts, usgs_events

log = logging.getLogger("demo")
SCENARIO = BACKEND_DIR.parent / "replay" / "scenario.yaml"

status: dict = {"phase": "idle", "message": "Scenario not loaded", "done": 0, "total": 0, "by_source": {},
                "live_start": None, "travel_speed": 30}
_setup_task: asyncio.Task | None = None


def load_scenario(path: Path = SCENARIO) -> dict:
    return yaml.safe_load(path.read_text())


async def _status(**kw):
    status.update(kw)
    await publish("demo.status", status)


def _source_of(e: dict) -> str:
    return e["body"].get("source_type", "resident") if e["kind"] == "report" else e["kind"]


async def setup(path: Path = SCENARIO):
    from ..ingestion import api as ing
    from ..state import api as st
    try:
        sc = load_scenario(path)
        start, end, live = ts(sc["start"]), ts(sc["end"]), ts(sc["live_start"])
        events = ncdot_events(start, end, set(sc.get("ncdot_counties", ["Buncombe"])))
        events += usgs_events(start, end, sc.get("usgs_every_min", 60))
        events += [{"at": ts(e["at"]), "kind": e["kind"], "body": e.get("body", {}), "label": e.get("label")}
                   for e in sc["events"]]
        events.sort(key=lambda e: (e["at"], 0 if e["kind"] in ("ncdot", "usgs") else 1))

        movement.progress.clear()
        await _status(phase="loading", message="Resetting…", done=0, total=len(events), by_source={},
                      live_start=live.isoformat(), travel_speed=sc.get("travel_speed", 30))
        await st.sim_reset()
        matcher.auto_dispatch = False
        set_clock(start, 1)
        for v in sc["volunteers"]:
            await st.register_volunteer(st.VolunteerIn(**v))

        for i, e in enumerate(events):
            if e["kind"] not in ("ncdot", "usgs"):
                await pipeline.queue.join()  # LLM steps see the world as of this report's time
            set_clock(e["at"], 1)
            await publish("clock", clock_state())
            body = dict(e["body"])
            if e["kind"] == "ncdot":
                await ing.ingest_ncdot(ing.NcdotEvent(**body))
            elif e["kind"] == "usgs":
                await ing.ingest_usgs(ing.GaugeReading(**body))
            elif e["kind"] == "report":
                body.setdefault("observed_at", e["at"])
                await ing.ingest_report(ing.Report(**body))
            elif e["kind"] == "radio":
                body.setdefault("timestamp", e["at"])
                await ing.ingest_radio(ing.Radio(**body))
            src = _source_of(e)
            status["by_source"][src] = status["by_source"].get(src, 0) + 1
            msg = e.get("label") or f"{src} feed"
            if e["kind"] in ("ncdot", "usgs"):
                await asyncio.sleep(0.01)
                if i % 20 == 0:
                    await _status(phase="ingesting", message=f"Streaming real {src.upper()} history", done=i + 1)
            else:
                await _status(phase="ingesting", message=f"AI processing: {msg}", done=i + 1)
        await _status(phase="ingesting", message="AI finishing the last reports…", done=len(events))
        await pipeline.queue.join()
        set_clock(live, 1)
        await publish("clock", clock_state())
        n = await db.fetchval("SELECT count(*) FROM incidents")
        t = await db.fetchval("SELECT count(*) FROM tasks")
        await _status(phase="ready", message=f"{n} incidents, {t} volunteer tasks awaiting dispatch")
    except Exception as e:
        log.exception("demo setup failed")
        await _status(phase="error", message=str(e))


async def restore():
    """On backend restart: if a scenario is already in the DB, come back in the live phase."""
    if not await db.fetchval("SELECT count(*) FROM incidents"):
        return
    sc = load_scenario()
    live = ts(sc["live_start"])
    last = await db.fetchval("SELECT max(at) FROM activity")
    matcher.auto_dispatch = False
    set_clock(max(live, last) if last else live, 1)
    rows = await db.fetch("SELECT source_type, count(*) AS n FROM observations GROUP BY 1")
    n = await db.fetchval("SELECT count(*) FROM incidents")
    by_source = {r["source_type"]: r["n"] for r in rows}
    by_source["usgs"] = await db.fetchval("SELECT count(*) FROM sensor_readings")  # every reading, not just flood-stage crossings
    status.update(phase="ready", message=f"{n} incidents (restored after restart)", by_source=by_source, live_start=live.isoformat(),
                  travel_speed=sc.get("travel_speed", 30), done=0, total=0)


def start_setup():
    global _setup_task
    if _setup_task and not _setup_task.done():
        return False
    _setup_task = asyncio.create_task(setup())
    return True


async def rewind():
    """Back to the start of the live phase: no dispatches, volunteers home, ingestion results kept."""
    if not status.get("live_start"):
        raise RuntimeError("scenario not loaded")
    live = ts(status["live_start"])
    movement.progress.clear()
    for t in ("assignments", "volunteer_locations"):
        await db.execute(f"TRUNCATE {t} RESTART IDENTITY")
    await db.execute("UPDATE tasks SET status='OPEN', updated_at=%s WHERE status <> 'OPEN'", live)
    await db.execute("DELETE FROM task_events WHERE at >= %s", live)
    await db.execute("UPDATE incidents SET status='OPEN' WHERE status='RESOLVED'")
    await db.execute("UPDATE volunteers SET last_geom=home, available=true")
    await db.execute("DELETE FROM activity WHERE at >= %s", live)
    matcher.auto_dispatch = False
    set_clock(live, 1)
    await publish("clock", clock_state())
    await _status(phase="ready", message="Rewound to the start of the live phase")
    await publish("reset", {})


# ---------------- Simulated GPS ----------------
def _hav(a, b):
    R = 6371000
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla, dlo = la2 - la1, math.radians(b[0] - a[0])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def _along(coords, dist):
    for p, q in zip(coords[:-1], coords[1:]):
        seg = _hav(p, q)
        if dist <= seg:
            f = dist / seg if seg else 0
            return (p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f)
        dist -= seg
    return tuple(coords[-1])


class Movement:
    def __init__(self):
        self.progress: dict[int, dict] = {}  # assignment id → {sig, start, length, done}

    async def run(self):
        while True:
            await asyncio.sleep(0.4)
            try:
                await self.tick()
            except Exception:
                log.exception("movement tick failed")

    async def tick(self):
        from ..state import api as st
        if status["phase"] != "ready":
            return
        rows = await db.fetch("SELECT id, volunteer_id, eta_s, ST_AsGeoJSON(route)::json AS route FROM assignments "
                              "WHERE status='ACCEPTED' AND route IS NOT NULL")
        moving = False
        for a in rows:
            coords = a["route"]["coordinates"]
            sig = f"{len(coords)}:{coords[0]}:{coords[-1]}"
            p = self.progress.get(a["id"])
            if p is None or p["sig"] != sig:
                p = self.progress[a["id"]] = {"sig": sig, "start": sim_now(), "done": False,
                                              "length": sum(_hav(x, y) for x, y in zip(coords[:-1], coords[1:]))}
            if p["done"]:
                continue
            moving = True
            frac = min(1.0, (sim_now() - p["start"]).total_seconds() / max(a["eta_s"] or 1, 1))
            lon, lat = _along(coords, frac * p["length"])
            await st.update_location(a["volunteer_id"], st.Loc(lon=lon, lat=lat))
            if frac >= 1:
                p["done"] = True
        # Fast-forward the clock only while someone is driving.
        speed = clock_state()["speed"]
        want = status["travel_speed"] if moving else 1
        if speed != want:
            set_clock(sim_now(), want)
            await publish("clock", clock_state())


movement = Movement()
