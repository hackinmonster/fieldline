"""Geospatial volunteer matching (REAL).

1. PostGIS KNN pulls the nearest available volunteers.
2. Hard capability filters (vehicle, clearance, capacity, seats, skills, equipment,
   verify-safety) — reasons recorded so the dashboard can show who was skipped and why.
3. Road-network ETA (closure-aware) for the remaining candidates; lowest ETA wins.
"""
from .. import db
from ..bus import activity, publish
from ..clock import sim_now
from ..config import MATCH_CANDIDATES
from ..state import tasks as T
from . import routing

WALK_MPS = 1.3


def capability_gaps(vol: dict, task: dict) -> list[str]:
    req = task["requirements"] or {}
    veh = vol["vehicle"] or {}
    gaps = []
    if task["type"] == "VERIFY_CONDITION" and not vol["verify_safe"]:
        gaps.append("not cleared for verification tasks")
    if req.get("vehicle") and not veh:
        gaps.append("no vehicle")
    if req.get("high_clearance") and not veh.get("high_clearance"):
        gaps.append("vehicle lacks high clearance")
    if (req.get("min_capacity_gal") or 0) > (veh.get("capacity_gal") or 0):
        gaps.append(f"cargo {veh.get('capacity_gal', 0)} gal < {req['min_capacity_gal']} gal")
    if (req.get("min_seats") or 0) > (veh.get("seats") or 0):
        gaps.append(f"{veh.get('seats', 0)} seats < {req['min_seats']}")
    missing_sk = set(req.get("skills") or []) - set(vol["skills"] or [])
    if missing_sk:
        gaps.append("missing skills: " + ", ".join(sorted(missing_sk)))
    missing_eq = set(req.get("equipment") or []) - set(vol["equipment"] or [])
    if missing_eq:
        gaps.append("missing equipment: " + ", ".join(sorted(missing_eq)))
    return gaps


async def rank(task: dict, exclude: set[int] | None = None) -> tuple[list[dict], list[dict]]:
    """Returns (reachable candidates sorted by ETA, skipped volunteers with reasons)."""
    exclude = exclude or set()
    vols = await db.fetch(
        """SELECT v.id, v.name, v.skills, v.equipment, v.vehicle, v.verify_safe,
                  ST_X(v.last_geom) AS lon, ST_Y(v.last_geom) AS lat,
                  round(ST_Distance(v.last_geom::geography, %s::geography)) AS dist_m
           FROM volunteers v
           WHERE v.available AND v.last_geom IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.volunteer_id=v.id
                             AND a.status IN ('OFFERED','ACCEPTED'))
           ORDER BY v.last_geom <-> %s::geometry
           LIMIT 25""", task["geom"], task["geom"])
    ok, skipped = [], []
    for v in vols:
        if v["id"] in exclude:
            continue
        gaps = capability_gaps(v, task)
        (skipped.append({**v, "reasons": gaps}) if gaps else ok.append(v))
    ok = ok[:MATCH_CANDIDATES]
    dst = (task["lon"], task["lat"])
    for v in ok:
        r = await routing.route((v["lon"], v["lat"]), dst)
        if r is not None and not v["vehicle"]:
            # On foot: same road path, walking pace instead of drive time.
            r = {**r, "eta_s": routing.path_length_m(r["coords"]) / WALK_MPS, "mode": "walk"}
        v["route"] = r
        if r is None:
            v["unreachable"] = True
    reachable = sorted([v for v in ok if v.get("route")], key=lambda v: v["route"]["eta_s"])
    for v in ok:
        if v.get("unreachable"):
            skipped.append({**v, "reasons": ["no open road route to task"]})
    return reachable, skipped


async def create_assignment(task: dict, vol: dict, reason: str) -> dict:
    now = sim_now()
    r = vol["route"]
    a = await db.fetchrow(
        """INSERT INTO assignments (task_id, volunteer_id, status, route, route_nodes, eta_s, reason, created_at, updated_at)
           VALUES (%s,%s,'OFFERED', ST_GeomFromText(%s,4326), %s, %s, %s, %s, %s) RETURNING id""",
        task["id"], vol["id"], routing.linestring_wkt(r["coords"]), r["nodes"], r["eta_s"], reason, now, now)
    await T.set_status(task["id"], "ASSIGNED", f"offered to {vol['name']}")
    return await T.publish_assignment(a["id"])


async def match(task_id: int, exclude: set[int] | None = None, context: str = "") -> dict | None:
    task = await T.get_task(task_id)
    if task is None or task["status"] not in ("OPEN", "BLOCKED", "ASSIGNED", "EN_ROUTE"):
        return None
    reachable, skipped = await rank(task, exclude)
    skipped_txt = "; ".join(f"{s['name']} ({s['dist_m']:.0f} m): {', '.join(s['reasons'])}" for s in skipped[:5])
    if not reachable:
        if task["status"] == "BLOCKED":
            return None  # already escalated; don't re-alert on every retry
        await escalate(task, f"no capable volunteer can reach the task{context}. Skipped: {skipped_txt or 'none available'}")
        return None
    best = reachable[0]
    others = ", ".join(f"{v['name']} {v['route']['eta_s']/60:.0f} min" for v in reachable[1:4])
    reason = (f"{best['name']} is the fastest capable volunteer by road "
              f"({best['route']['eta_s']/60:.0f} min, {best['dist_m']/1000:.1f} km straight-line){context}")
    a = await create_assignment(task, best, reason)
    await activity("match", f"Task #{task_id} → {best['name']}: {reason}. Alternatives: {others or 'none'}. "
                            f"Skipped: {skipped_txt or 'none'}",
                   {"task_id": task_id, "volunteer_id": best["id"], "assignment_id": a["id"],
                    "skipped": [{"id": s["id"], "name": s["name"], "reasons": s["reasons"]} for s in skipped],
                    "alternatives": [{"id": v["id"], "name": v["name"], "eta_s": v["route"]["eta_s"]} for v in reachable[1:]]})
    return a


async def escalate(task: dict, why: str):
    await T.set_status(task["id"], "BLOCKED", why)
    if task["incident_id"]:
        await db.execute("UPDATE incidents SET priority = priority + 25, updated_at=%s WHERE id=%s",
                         sim_now(), task["incident_id"])
        await publish("incident.updated", {"id": task["incident_id"]})
    await activity("escalation", f"⚠ Task #{task['id']} BLOCKED — {why}. Escalated to command for human decision.",
                   {"task_id": task["id"], "incident_id": task["incident_id"]})


async def retry_unassigned(reason: str):
    """Conditions changed (road reopened, volunteer freed up) — retry OPEN/BLOCKED tasks."""
    rows = await db.fetch("SELECT id FROM tasks WHERE status IN ('OPEN','BLOCKED') ORDER BY priority DESC NULLS LAST")
    for r in rows:
        await match(r["id"], context=f" (retry: {reason})")
