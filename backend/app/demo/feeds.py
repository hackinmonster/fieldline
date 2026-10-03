"""Real historical Helene feeds (NCDOT TIMS, USGS gauges) → time-ordered ingestion events."""
import json
from datetime import datetime, timedelta, timezone

from ..config import DATA_DIR


def ts(s) -> datetime:
    if isinstance(s, datetime):
        return s if s.tzinfo else s.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(str(s).replace("Z", "+00:00"))


def ncdot_events(start: datetime, end: datetime, counties: set[str]) -> list[dict]:
    feats = json.loads((DATA_DIR / "ncdot_closures.geojson").read_text())["features"]
    out = []
    for f in feats:
        p = f["properties"]
        if p.get("county") not in counties or not f.get("geometry"):
            continue
        closed = ts(p["closed_at"]) if p.get("closed_at") else None
        if closed and closed <= end:
            # Closures that began before the window are delivered at window start (state at replay start).
            at = max(closed, start)
            out.append({"at": at, "kind": "ncdot",
                        "body": {"event": "closed", "at": at.isoformat(), "properties": p, "geometry": f["geometry"]}})
        if p.get("reopened_at"):
            ro = ts(p["reopened_at"])
            if start <= ro <= end:
                out.append({"at": ro, "kind": "ncdot",
                            "body": {"event": "reopened", "at": ro.isoformat(), "properties": p, "geometry": f["geometry"]}})
    return out


def usgs_events(start: datetime, end: datetime, every_min: int) -> list[dict]:
    rows = json.loads((DATA_DIR / "usgs_readings.json").read_text())
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
