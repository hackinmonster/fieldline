"""Core State / API: volunteers, assignments, snapshot reads, sim control."""
import json
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import db
from ..bus import activity, publish
from ..clock import clock_state, set_clock, sim_now
from ..coordination import matcher, routing
from ..ingestion.api import store
from . import tasks as T

router = APIRouter(tags=["state"])
ARRIVE_RADIUS_M = 200  # route ends at the nearest road node; rural driveways run long


# ---------------- Volunteers ----------------
class VolunteerIn(BaseModel):
    name: str
    skills: list[str] = []
    equipment: list[str] = []
    vehicle: dict | None = None
    available: bool = True
    verify_safe: bool = False
    lon: float
    lat: float


VOL_COLS = """id, name, skills, equipment, vehicle, available, verify_safe, last_seen,
              ST_X(last_geom) AS lon, ST_Y(last_geom) AS lat"""


@router.post("/volunteers")
async def register_volunteer(v: VolunteerIn):
    row = await db.fetchrow(
        f"""INSERT INTO volunteers (name, skills, equipment, vehicle, available, verify_safe, home, last_geom, last_seen)
            VALUES (%s,%s,%s,%s,%s,%s, ST_SetSRID(ST_MakePoint(%s,%s),4326), ST_SetSRID(ST_MakePoint(%s,%s),4326), %s)
            RETURNING {VOL_COLS}""",
        v.name, v.skills, v.equipment, db.J(v.vehicle) if v.vehicle else None, v.available, v.verify_safe,
        v.lon, v.lat, v.lon, v.lat, sim_now())
    await publish("volunteer.updated", row)
    if v.available:
        await matcher.retry_unassigned(f"{v.name} became available")
    return row


@router.get("/volunteers")
async def list_volunteers():
    return await db.fetch(f"SELECT {VOL_COLS} FROM volunteers ORDER BY id")


@router.get("/volunteers/{vid}")
async def get_volunteer(vid: int):
    v = await db.fetchrow(f"SELECT {VOL_COLS} FROM volunteers WHERE id=%s", vid)
    if not v:
        raise HTTPException(404)
    a = await db.fetchrow(f"SELECT {T.ASSIGN_COLS} FROM assignments a WHERE a.volunteer_id=%s "
                          "AND a.status IN ('OFFERED','ACCEPTED') ORDER BY a.id DESC LIMIT 1", vid)
    task = T._strip(await T.get_task(a["task_id"])) if a else None
    return {"volunteer": v, "assignment": a, "task": task}


class Loc(BaseModel):
    lon: float
    lat: float
    at: datetime | None = None


@router.post("/volunteers/{vid}/location")
async def update_location(vid: int, loc: Loc):
    at = loc.at or sim_now()
    await db.execute("UPDATE volunteers SET last_geom=ST_SetSRID(ST_MakePoint(%s,%s),4326), last_seen=%s WHERE id=%s",
                     loc.lon, loc.lat, at, vid)
    await db.execute("INSERT INTO volunteer_locations (volunteer_id, at, geom) VALUES (%s,%s,ST_SetSRID(ST_MakePoint(%s,%s),4326))",
                     vid, at, loc.lon, loc.lat)
    await publish("volunteer.location", {"id": vid, "lon": loc.lon, "lat": loc.lat, "at": at})
    await _check_arrival(vid)
    return {"ok": True}


async def _check_arrival(vid: int):
    """GPS geofence: the first fix within ARRIVE_RADIUS_M of the task marks the volunteer on scene."""
    a = await db.fetchrow(
        """SELECT a.id, a.task_id, v.name,
                  ST_Distance(v.last_geom::geography, t.geom::geography) AS d
           FROM assignments a JOIN volunteers v ON v.id=a.volunteer_id JOIN tasks t ON t.id=a.task_id
           WHERE a.volunteer_id=%s AND a.status='ACCEPTED'
             AND NOT EXISTS (SELECT 1 FROM activity x WHERE x.kind='arrived' AND (x.data->>'assignment_id')::bigint=a.id)""",
        vid)
    if a and a["d"] <= ARRIVE_RADIUS_M:
        await activity("arrived", f"📍 {a['name']} is on scene for task #{a['task_id']} (GPS within {a['d']:.0f} m).",
                       {"assignment_id": a["id"], "task_id": a["task_id"], "volunteer_id": vid})


class Avail(BaseModel):
    available: bool


@router.post("/volunteers/{vid}/availability")
async def set_availability(vid: int, a: Avail):
    row = await db.fetchrow(f"UPDATE volunteers SET available=%s WHERE id=%s RETURNING {VOL_COLS}", a.available, vid)
    await publish("volunteer.updated", row)
    if a.available:
        await matcher.retry_unassigned(f"{row['name']} became available")
    return row


class FieldObs(BaseModel):
    text: str
    lon: float | None = None
    lat: float | None = None


@router.post("/volunteers/{vid}/observations")
async def volunteer_observation(vid: int, o: FieldObs):
    """Volunteers as sensors: field reports enter the same ingestion path."""
    v = await db.fetchrow("SELECT name, ST_X(last_geom) AS lon, ST_Y(last_geom) AS lat FROM volunteers WHERE id=%s", vid)
    lon, lat = (o.lon, o.lat) if o.lon is not None else (v["lon"], v["lat"])
    oid = await store(None, "volunteer", f"volunteer:{vid}", {"text": o.text, "reporter": v["name"]},
                      geom_geojson={"type": "Point", "coordinates": [lon, lat]})
    return {"observation_id": oid}


# ---------------- Assignments ----------------
@router.post("/assignments/{aid}/accept")
async def accept(aid: int):
    a = await T.get_assignment(aid)
    if not a or a["status"] != "OFFERED":
        raise HTTPException(409, "assignment not open for acceptance")
    await db.execute("UPDATE assignments SET status='ACCEPTED', updated_at=%s WHERE id=%s", sim_now(), aid)
    name = await db.fetchval("SELECT name FROM volunteers WHERE id=%s", a["volunteer_id"])
    await T.set_status(a["task_id"], "EN_ROUTE", f"{name} accepted")
    await activity("accept", f"✔ {name} accepted task #{a['task_id']} (ETA {a['eta_s']/60:.0f} min).",
                   {"assignment_id": aid, "task_id": a["task_id"]})
    return await T.publish_assignment(aid)


@router.post("/assignments/{aid}/decline")
async def decline(aid: int):
    a = await T.get_assignment(aid)
    if not a or a["status"] not in ("OFFERED", "ACCEPTED"):
        raise HTTPException(409)
    await db.execute("UPDATE assignments SET status='RELEASED', reason='declined by volunteer', updated_at=%s WHERE id=%s",
                     sim_now(), aid)
    await T.publish_assignment(aid)
    await T.set_status(a["task_id"], "OPEN", "volunteer declined; rematching")
    await matcher.match(a["task_id"], exclude={a["volunteer_id"]}, context=" after decline")
    return {"ok": True}


class Done(BaseModel):
    note: str = ""


@router.post("/assignments/{aid}/complete")
async def complete(aid: int, d: Done | None = None):
    """Volunteer marks the mission done. Volunteers are unpaid neighbors: we take their word for it
    (GPS already showed them on scene), no photo proof."""
    a = await T.get_assignment(aid)
    if not a or a["status"] != "ACCEPTED":
        raise HTTPException(409, "assignment must be accepted first")
    note = (d.note if d else "").strip()
    task = await T.get_task(a["task_id"])
    name = await db.fetchval("SELECT name FROM volunteers WHERE id=%s", a["volunteer_id"])
    await db.execute("UPDATE assignments SET status='DONE', updated_at=%s WHERE id=%s", sim_now(), aid)
    await T.publish_assignment(aid)
    await T.set_status(task["id"], "COMPLETED", f"{name} marked the mission complete" + (f": {note}" if note else ""))
    await activity("completed", f"✅ {name} completed task #{task['id']}." + (f" Note: {note}" if note else ""),
                   {"task_id": task["id"], "assignment_id": aid, "volunteer_id": a["volunteer_id"]})
    open_left = await db.fetchval("SELECT count(*) FROM tasks WHERE incident_id=%s AND status <> 'COMPLETED'",
                                  task["incident_id"])
    if task["incident_id"] and open_left == 0:
        await db.execute("UPDATE incidents SET status='RESOLVED', updated_at=%s WHERE id=%s", sim_now(), task["incident_id"])
        await publish("incident.updated", {"id": task["incident_id"], "status": "RESOLVED"})
        await activity("resolved", f"Incident #{task['incident_id']} resolved — all tasks completed.",
                       {"incident_id": task["incident_id"]})
    await matcher.retry_unassigned(f"{name} is free again")
    return {"ok": True}


# ---------------- Operator dispatch ----------------
@router.post("/incidents/{iid}/dispatch")
async def dispatch_incident(iid: int):
    """Command approves dispatch for an incident's open task → real matching runs now."""
    t = await db.fetchrow("SELECT id FROM tasks WHERE incident_id=%s AND status IN ('OPEN','BLOCKED') "
                          "ORDER BY priority DESC NULLS LAST LIMIT 1", iid)
    if not t:
        raise HTTPException(409, "incident has no task waiting for dispatch")
    await activity("dispatch", f"Command dispatched task #{t['id']} (incident #{iid}).", {"task_id": t["id"], "incident_id": iid})
    a = await matcher.match(t["id"])
    decision = await db.fetchrow("SELECT kind, message, data FROM activity WHERE kind IN ('match','escalation') "
                                 "AND (data->>'task_id')::bigint=%s ORDER BY at DESC, id DESC LIMIT 1", t["id"])
    return {"task_id": t["id"], "assignment": a, "decision": decision}


@router.get("/incidents/{iid}")
async def incident_detail(iid: int):
    """Everything behind one incident: raw source items → LLM understanding → linking → task proposal."""
    inc = await db.fetchrow("SELECT id, status, type, summary, priority, confidence, created_at, updated_at, "
                            "ST_X(geom) AS lon, ST_Y(geom) AS lat FROM incidents WHERE id=%s", iid)
    if not inc:
        raise HTTPException(404)
    return {"incident": inc,
            "observations": await db.fetch(
                "SELECT id, observed_at, source_type, source_ref, location_text, category, subtype, confidence, extracted, raw "
                "FROM observations WHERE incident_id=%s ORDER BY observed_at", iid),
            "links": await db.fetch("SELECT * FROM incident_links WHERE incident_id=%s ORDER BY at", iid),
            "proposals": await db.fetch("SELECT * FROM task_proposals WHERE incident_id=%s ORDER BY at", iid),
            "tasks": await db.fetch(f"SELECT {T.TASK_COLS} FROM tasks t WHERE t.incident_id=%s ORDER BY t.id", iid)}


# ---------------- Snapshot reads ----------------
@router.get("/state")
async def snapshot():
    incidents = await db.fetch(
        """SELECT id, status, type, summary, priority, confidence, created_at, updated_at,
                  ST_X(geom) AS lon, ST_Y(geom) AS lat,
                  (SELECT count(*) FROM observations o WHERE o.incident_id=i.id) AS n_obs,
                  (SELECT array_agg(DISTINCT o.source_type) FROM observations o WHERE o.incident_id=i.id) AS sources,
                  (SELECT o.location_text FROM observations o WHERE o.incident_id=i.id AND o.location_text IS NOT NULL
                   ORDER BY o.observed_at LIMIT 1) AS location_text
           FROM incidents i ORDER BY priority DESC NULLS LAST""")
    tasks = await db.fetch(f"SELECT {T.TASK_COLS} FROM tasks t ORDER BY priority DESC NULLS LAST")
    assignments = await db.fetch(f"SELECT {T.ASSIGN_COLS} FROM assignments a ORDER BY a.id")
    volunteers = await list_volunteers()
    observations = await db.fetch(
        """SELECT id, observed_at, source_type, category, subtype, confidence, incident_id, location_text,
                  extracted->>'summary' AS summary, ST_AsGeoJSON(ST_Centroid(geom))::json AS point,
                  coalesce(raw->>'text', raw->>'transcript') AS text, raw->>'reporter' AS reporter,
                  coalesce(raw->>'channel', raw->>'agency') AS channel
           FROM observations WHERE geom IS NOT NULL ORDER BY observed_at DESC LIMIT 500""")
    closures = await db.fetch(
        "SELECT id, name, closed_reason, closed_since, ST_AsGeoJSON(geom)::json AS geometry FROM road_segments WHERE closed")
    sensors = await db.fetch(
        """SELECT s.site_id, s.name, s.flood_stage_ft, ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat, r.stage_ft, r.discharge_cfs, r.at
           FROM sensor_sites s LEFT JOIN LATERAL (SELECT * FROM sensor_readings x WHERE x.site_id=s.site_id
                ORDER BY at DESC LIMIT 1) r ON true""")
    activity_rows = await db.fetch("SELECT at, kind, message, data FROM activity ORDER BY at DESC, id DESC LIMIT 150")
    from ..demo import runner
    return {"clock": clock_state(), "demo": runner.status, "incidents": incidents, "tasks": tasks, "assignments": assignments,
            "volunteers": volunteers, "observations": observations, "closures": closures,
            "sensors": sensors, "activity": activity_rows}


@router.get("/sensors/{site_id}/series")
async def sensor_series(site_id: str):
    return await db.fetch("SELECT at, stage_ft, discharge_cfs FROM sensor_readings WHERE site_id=%s ORDER BY at", site_id)


@router.get("/layers/tracts")
async def tracts_layer():
    rows = await db.fetch("SELECT geoid, name, pop, pct_65plus, pct_no_vehicle, median_income, "
                          "ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0005))::json AS g FROM tracts")
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": r.pop("g"), "properties": r} for r in rows]}


@router.get("/layers/storm")
async def storm_layer():
    rows = await db.fetch("SELECT at, wind_kt, category, ST_AsGeoJSON(geom)::json AS g FROM storm_track ORDER BY id")
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": r.pop("g"), "properties": r} for r in rows]}


@router.get("/tasks/{tid}")
async def task_detail(tid: int):
    t = await T.get_task(tid)
    if not t:
        raise HTTPException(404)
    return {"task": T._strip(t),
            "events": await db.fetch("SELECT * FROM task_events WHERE task_id=%s ORDER BY at", tid),
            "assignments": await db.fetch(f"SELECT {T.ASSIGN_COLS} FROM assignments a WHERE a.task_id=%s ORDER BY a.id", tid),
            "observations": await db.fetch("SELECT id, source_type, category, subtype, observed_at, extracted->>'summary' AS summary, raw "
                                           "FROM observations WHERE incident_id=%s ORDER BY observed_at", t["incident_id"]),
            "links": await db.fetch("SELECT * FROM incident_links WHERE incident_id=%s ORDER BY at", t["incident_id"])}


# ---------------- Simulation control (DEMO-STUB: replay harness only) ----------------
class ClockIn(BaseModel):
    at: datetime
    speed: float = 1.0


@router.post("/sim/clock")
async def sim_clock(c: ClockIn):
    set_clock(c.at, c.speed)
    await publish("clock", clock_state())
    return clock_state()


@router.get("/sim/clock")
async def get_clock():
    return clock_state()


@router.post("/sim/reset")
async def sim_reset():
    for t in ("observations", "incidents", "incident_links", "tasks", "task_events", "task_proposals",
              "assignments", "activity", "road_events", "sensor_readings", "volunteer_locations", "volunteers"):
        await db.execute(f"TRUNCATE {t} RESTART IDENTITY")
    await db.execute("UPDATE road_segments SET closed=false, closed_reason=NULL, closed_since=NULL WHERE closed")
    routing.closed.clear()
    matcher.auto_dispatch = True
    await publish("reset", {})
    return {"ok": True}
