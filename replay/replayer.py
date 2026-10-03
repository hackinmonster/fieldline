"""DEMO-STUB: historical replay harness.

Streams real historical Helene feeds (NCDOT TIMS closures/reopenings, USGS
gauges) plus hand-authored scenario events (resident reports, radio transcripts)
into the backend's public ingestion API in chronological order, driving a
simulated clock. Also simulates volunteer GPS movement along assigned routes.

The backend has no knowledge of this script: it only sees API calls a live
deployment would also receive.

Usage:  backend/.venv/bin/python replay/replayer.py [replay/scenario.yaml] [--no-pause]
"""
import asyncio
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "backend" / "data"
API = "http://localhost:8000"


def ts(s) -> datetime:
    if isinstance(s, datetime):
        return s if s.tzinfo else s.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(str(s).replace("Z", "+00:00"))


# ---------------- Real feeds → events ----------------
def ncdot_events(start: datetime, end: datetime, counties: set[str]) -> list[dict]:
    feats = json.loads((DATA / "ncdot_closures.geojson").read_text())["features"]
    out = []
    for f in feats:
        p = f["properties"]
        if p.get("county") not in counties or not f.get("geometry"):
            continue
        closed = ts(p["closed_at"]) if p.get("closed_at") else None
        if closed and closed <= end:
            # Closures that began before the window are delivered at window start (state at replay start).
            out.append({"at": max(closed, start), "kind": "ncdot",
                        "body": {"event": "closed", "at": max(closed, start).isoformat(), "properties": p, "geometry": f["geometry"]}})
        if p.get("reopened_at"):
            ro = ts(p["reopened_at"])
            if start <= ro <= end:
                out.append({"at": ro, "kind": "ncdot",
                            "body": {"event": "reopened", "at": ro.isoformat(), "properties": p, "geometry": f["geometry"]}})
    return out


def usgs_events(start: datetime, end: datetime, every_min: int) -> list[dict]:
    rows = json.loads((DATA / "usgs_readings.json").read_text())
    out, last = [], {}
    for r in rows:
        at = ts(r["at"])
        if not (start <= at <= end):
            continue
        prev = last.get(r["site_id"])
        if prev and (at - prev) < timedelta(minutes=every_min):
            continue
        last[r["site_id"]] = at
        out.append({"at": at, "kind": "usgs", "body": {"site_id": r["site_id"], "at": at.isoformat(),
                                                        "stage_ft": r.get("stage_ft"), "discharge_cfs": r.get("discharge_cfs")}})
    return out


# ---------------- Volunteer movement simulator ----------------
def _hav(a, b):
    R = 6371000
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla, dlo = la2 - la1, math.radians(b[0] - a[0])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


class VolunteerSim:
    """Moves volunteers along their ACCEPTED assignment routes at road speed × sim speed.
    Background volunteers (auto_accept) accept offers automatically after a short delay."""

    def __init__(self, client: httpx.AsyncClient, auto_accept_ids: set[int], kmh: float = 45):
        self.c, self.auto, self.kmh = client, auto_accept_ids, kmh
        self.progress: dict[int, tuple[str, float]] = {}  # assignment id → (route signature, meters travelled)
        self.offer_seen: dict[int, float] = {}

    async def run(self):
        loop = asyncio.get_running_loop()
        last = loop.time()
        while True:
            await asyncio.sleep(0.5)
            now = loop.time()
            dt, last = now - last, now
            try:
                st = (await self.c.get(f"{API}/state")).json()
            except Exception:
                continue
            speed = st["clock"]["speed"]
            vols = {v["id"]: v for v in st["volunteers"]}
            for a in st["assignments"]:
                if a["status"] == "OFFERED" and a["volunteer_id"] in self.auto:
                    first = self.offer_seen.setdefault(a["id"], now)
                    if now - first > 3:
                        await self.c.post(f"{API}/assignments/{a['id']}/accept")
                if a["status"] != "ACCEPTED" or not a["route"]:
                    continue
                coords = a["route"]["coordinates"]
                sig = f"{len(coords)}:{coords[0]}:{coords[-1]}"
                prev_sig, travelled = self.progress.get(a["id"], (sig, 0.0))
                if prev_sig != sig:
                    travelled = 0.0  # rerouted: new route starts at the volunteer's current position
                travelled += self.kmh / 3.6 * dt * speed
                self.progress[a["id"]] = (sig, travelled)
                pos = self._along(coords, travelled)
                v = vols.get(a["volunteer_id"])
                if v and (abs(v["lon"] - pos[0]) > 1e-6 or abs(v["lat"] - pos[1]) > 1e-6):
                    await self.c.post(f"{API}/volunteers/{a['volunteer_id']}/location", json={"lon": pos[0], "lat": pos[1]})

    @staticmethod
    def _along(coords, dist):
        for p, q in zip(coords[:-1], coords[1:]):
            seg = _hav(p, q)
            if dist <= seg:
                f = dist / seg if seg else 0
                return (p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f)
            dist -= seg
        return tuple(coords[-1])


# ---------------- Main replay loop ----------------
async def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    no_pause = "--no-pause" in sys.argv
    sc = yaml.safe_load(Path(args[0] if args else Path(__file__).parent / "scenario.yaml").read_text())
    start, end = ts(sc["start"]), ts(sc["end"])
    speeds = sorted(((ts(p["from"]), p["speed"]) for p in sc["speed"]), key=lambda x: x[0])

    events = ncdot_events(start, end, set(sc.get("ncdot_counties", ["Buncombe"])))
    events += usgs_events(start, end, sc.get("usgs_every_min", 60))
    for e in sc["events"]:
        events.append({"at": ts(e["at"]), "kind": e["kind"], "body": e.get("body", {}), "label": e.get("label"),
                       "pause": e.get("pause", False)})
    events.sort(key=lambda e: (e["at"], 0 if e["kind"] in ("ncdot", "usgs") else 1))

    async with httpx.AsyncClient(timeout=120) as c:
        if sc.get("reset", True):
            await c.post(f"{API}/sim/reset")
        vol_ids = {}
        for v in sc["volunteers"]:
            body = {k: v[k] for k in v if k not in ("auto_accept",)}
            r = (await c.post(f"{API}/volunteers", json=body)).json()
            vol_ids[v["name"]] = (r["id"], v.get("auto_accept", True))
        auto = {vid for vid, aa in vol_ids.values() if aa}
        print(f"registered {len(vol_ids)} volunteers; demo volunteer(s): "
              + ", ".join(f"{n} → /volunteer?id={i}" for n, (i, aa) in vol_ids.items() if not aa))
        sim = asyncio.create_task(VolunteerSim(c, auto).run())

        def speed_at(t):
            s = speeds[0][1]
            for frm, sp in speeds:
                if t >= frm:
                    s = sp
            return s

        sim_t = start
        await c.post(f"{API}/sim/clock", json={"at": sim_t.isoformat(), "speed": speed_at(sim_t)})
        print(f"{len(events)} events from {start} to {end}")

        for e in events:
            # Advance the simulated clock to the event (respecting speed segments).
            while sim_t < e["at"]:
                sp = speed_at(sim_t)
                nxt = min([e["at"]] + [f for f, _ in speeds if f > sim_t])
                await c.post(f"{API}/sim/clock", json={"at": sim_t.isoformat(), "speed": sp})
                await asyncio.sleep((nxt - sim_t).total_seconds() / sp)
                sim_t = nxt
            if e.get("pause") and not no_pause:
                # Hold the event queue for the presenter; the world (clock, volunteer movement) keeps going.
                await asyncio.to_thread(input, f"\n⏸  [{sim_t:%b %d %H:%M}] next: {e.get('label') or e['kind']} — press Enter ")
                sim_t = max(sim_t, ts((await c.get(f"{API}/sim/clock")).json()["sim_now"]))
                e["at"] = sim_t
            kind = e["kind"]
            if kind == "wait":
                continue
            path = {"ncdot": "/ingest/ncdot", "usgs": "/ingest/usgs", "report": "/ingest/report", "radio": "/ingest/radio"}[kind]
            body = dict(e["body"])
            if kind == "report":
                body.setdefault("observed_at", e["at"].isoformat())
            if kind == "radio":
                body.setdefault("timestamp", e["at"].isoformat())
            r = await c.post(f"{API}{path}", json=body)
            if kind not in ("usgs",):
                print(f"[{e['at']:%b %d %H:%M}] {kind:6} {e.get('label') or body.get('properties', {}).get('road_name', '')} → {r.status_code}")

        print("\nreplay complete — clock keeps running; volunteer sim active. Ctrl+C to exit.")
        await sim


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
