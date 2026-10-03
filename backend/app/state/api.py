"""Core State / API: volunteers, assignments, evidence, snapshot reads, sim control."""
import json
from datetime import datetime

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from .. import db
from ..bus import activity, publish
from ..clock import clock_state, set_clock, sim_now
from ..config import UPLOAD_DIR
from ..coordination import matcher, routing
from ..ingestion.api import store
from ..intelligence import verify as verifier
from . import tasks as T

router = APIRouter(tags=["state"])


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
    return {"ok": True}


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


@router.post("/assignments/{aid}/complete")
async def complete(aid: int, photo: UploadFile | None = File(None), note: str = Form(""),
                   lon: float | None = Form(None), lat: float | None = Form(None)):
    a = await T.get_assignment(aid)
    if not a or a["status"] != "ACCEPTED":
        raise HTTPException(409, "assignment must be accepted first")
    task = await T.get_task(a["task_id"])
    data, mime, path = None, "image/jpeg", None
    if photo is not None:
        data = await photo.read()
        mime = photo.content_type or mime
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        path = UPLOAD_DIR / f"task{task['id']}_a{aid}_{int(sim_now().timestamp())}_{photo.filename or 'photo.jpg'}"
        path.write_bytes(data)
    await T.set_status(task["id"], "COMPLETED", "volunteer submitted completion evidence")
    result = await verifier.verify(task, data, mime, note, lon, lat)
    await db.execute(
        """INSERT INTO evidence (task_id, volunteer_id, photo_path, text, geom, submitted_at, verdict, verdict_reasoning, details)
           VALUES (%s,%s,%s,%s, CASE WHEN %s::float IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(%s,%s),4326) END, %s,%s,%s,%s)""",
        task["id"], a["volunteer_id"], path and path.name, note, lon, lon, lat, sim_now(),
        result["verdict"], result["reasoning"], db.J(result["checks"]))
    name = await db.fetchval("SELECT name FROM volunteers WHERE id=%s", a["volunteer_id"])
    if result["verdict"] == "VERIFIED":
        await db.execute("UPDATE assignments SET status='DONE', updated_at=%s WHERE id=%s", sim_now(), aid)
        await T.publish_assignment(aid)
        await T.set_status(task["id"], "VERIFIED", result["reasoning"])
        await activity("verified", f"✅ Task #{task['id']} VERIFIED — {name}'s evidence checks out. {result['reasoning']}",
                       {"task_id": task["id"], "checks": result["checks"], "photo": path and path.name})
        open_left = await db.fetchval("SELECT count(*) FROM tasks WHERE incident_id=%s AND status <> 'VERIFIED'",
                                      task["incident_id"])
        if task["incident_id"] and open_left == 0:
            await db.execute("UPDATE incidents SET status='RESOLVED', updated_at=%s WHERE id=%s", sim_now(), task["incident_id"])
            await publish("incident.updated", {"id": task["incident_id"], "status": "RESOLVED"})
            await activity("resolved", f"Incident #{task['incident_id']} resolved — all tasks verified.",
                           {"incident_id": task["incident_id"]})
        await matcher.retry_unassigned(f"{name} is free again")
    else:
        await T.set_status(task["id"], "EN_ROUTE", "evidence rejected; volunteer asked to resubmit")
        await activity("rejected", f"✖ Evidence for task #{task['id']} rejected: {result['reasoning']}",
                       {"task_id": task["id"], "checks": result["checks"]})
    return result


# ---------------- Snapshot reads ----------------
@router.get("/state")
async def snapshot():
    incidents = await db.fetch(
        """SELECT id, status, type, summary, priority, confidence, created_at, updated_at,
                  ST_X(geom) AS lon, ST_Y(geom) AS lat,
                  (SELECT count(*) FROM observations o WHERE o.incident_id=i.id) AS n_obs
           FROM incidents i ORDER BY updated_at DESC""")
    tasks = await db.fetch(f"SELECT {T.TASK_COLS} FROM tasks t ORDER BY priority DESC NULLS LAST")
    assignments = await db.fetch(f"SELECT {T.ASSIGN_COLS} FROM assignments a ORDER BY a.id")
    volunteers = await list_volunteers()
    observations = await db.fetch(
        """SELECT id, observed_at, source_type, category, subtype, confidence, incident_id, location_text,
                  extracted->>'summary' AS summary, ST_AsGeoJSON(ST_Centroid(geom))::json AS point
           FROM observations WHERE geom IS NOT NULL ORDER BY observed_at DESC LIMIT 300""")
    closures = await db.fetch(
        "SELECT id, name, closed_reason, closed_since, ST_AsGeoJSON(geom)::json AS geometry FROM road_segments WHERE closed")
    sensors = await db.fetch(
        """SELECT s.site_id, s.name, s.flood_stage_ft, ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat, r.stage_ft, r.discharge_cfs, r.at
           FROM sensor_sites s LEFT JOIN LATERAL (SELECT * FROM sensor_readings x WHERE x.site_id=s.site_id
                ORDER BY at DESC LIMIT 1) r ON true""")
    activity_rows = await db.fetch("SELECT at, kind, message, data FROM activity ORDER BY at DESC, id DESC LIMIT 150")
    return {"clock": clock_state(), "incidents": incidents, "tasks": tasks, "assignments": assignments,
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
            "evidence": await db.fetch("SELECT id, photo_path, text, verdict, verdict_reasoning, details, submitted_at "
                                       "FROM evidence WHERE task_id=%s ORDER BY id", tid),
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
              "assignments", "evidence", "activity", "road_events", "sensor_readings", "volunteer_locations", "volunteers"):
        await db.execute(f"TRUNCATE {t} RESTART IDENTITY")
    await db.execute("UPDATE road_segments SET closed=false, closed_reason=NULL, closed_since=NULL WHERE closed")
    routing.closed.clear()
    await publish("reset", {})
    return {"ok": True}
