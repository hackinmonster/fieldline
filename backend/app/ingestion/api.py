"""Ingestion: heterogeneous sources → common Observation (REAL).

Each adapter maps its source's native shape into the same `observations` row.
Free-text sources are queued for LLM understanding; structured feeds are
mapped field-by-field. Endpoints are what a production deployment's live feeds
would call; in the demo the replayer calls them.
"""
import json
from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel

from .. import db
from ..bus import activity, publish
from ..clock import sim_now
from ..intelligence import pipeline

router = APIRouter(prefix="/ingest", tags=["ingestion"])


async def store(observed_at: datetime | None, source_type: str, source_ref: str | None, raw: dict, *,
                location_text: str | None = None, geom_geojson: dict | None = None, category: str | None = None,
                subtype: str | None = None, confidence: float | None = None, extracted: dict | None = None) -> int:
    now = sim_now()
    row = await db.fetchrow(
        """INSERT INTO observations (observed_at, received_at, source_type, source_ref, location_text, geom,
                                     category, subtype, confidence, extracted, raw)
           VALUES (%s,%s,%s,%s,%s, CASE WHEN %s::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON(%s),4326) END,
                   %s,%s,%s,%s,%s) RETURNING id""",
        observed_at or now, now, source_type, source_ref, location_text,
        json.dumps(geom_geojson) if geom_geojson else None, json.dumps(geom_geojson) if geom_geojson else None,
        category, subtype, confidence, db.J(extracted) if extracted else None, db.J(raw))
    await pipeline.queue.put(row["id"])
    return row["id"]


def _point(lon, lat):
    return {"type": "Point", "coordinates": [lon, lat]} if lon is not None and lat is not None else None


# ---------- Community reports (resident / shelter / NGO / volunteer) ----------
class Report(BaseModel):
    text: str
    source_type: str = "resident"
    reporter: str | None = None
    location_text: str | None = None
    lon: float | None = None
    lat: float | None = None
    observed_at: datetime | None = None
    channel: str | None = None  # sms | app | hotline | web


@router.post("/report")
async def ingest_report(r: Report):
    oid = await store(r.observed_at, r.source_type, r.channel, r.model_dump(mode="json"),
                      location_text=r.location_text, geom_geojson=_point(r.lon, r.lat))
    return {"observation_id": oid}


# ---------- Public-safety radio (prepared transcripts; STT is upstream/out of scope) ----------
class Radio(BaseModel):
    timestamp: datetime | None = None
    agency: str | None = None
    channel: str | None = None
    transcript: str
    location: str | None = None
    lon: float | None = None
    lat: float | None = None
    incident_type: str | None = None
    confidence: float | None = None  # transcription confidence


@router.post("/radio")
async def ingest_radio(r: Radio):
    oid = await store(r.timestamp, "radio", f"{r.agency}/{r.channel}", r.model_dump(mode="json"),
                      location_text=r.location, geom_geojson=_point(r.lon, r.lat))
    return {"observation_id": oid}


# ---------- NCDOT TIMS (structured) ----------
CLOSED_CONDITIONS = {"Road Closed", "Road Impassable", "Road Closed with Detour", "Ramp Closed"}


class NcdotEvent(BaseModel):
    event: str  # "closed" | "reopened"
    at: datetime
    properties: dict
    geometry: dict


@router.post("/ncdot")
async def ingest_ncdot(e: NcdotEvent):
    p = e.properties
    is_closure = p.get("condition") in CLOSED_CONDITIONS
    if e.event == "reopened":
        road_status, cat = "OPEN", "STATUS"
    elif is_closure:
        road_status, cat = "CLOSED", "INFRASTRUCTURE"
    else:  # lane closures / partial access: recorded, road stays routable
        road_status, cat = None, "INFRASTRUCTURE"
    name = p.get("common_name") or p.get("road_name")
    extracted = {
        "summary": f"NCDOT: {p.get('road_name')} — {p.get('condition') if e.event != 'reopened' else 'reopened'}. {p.get('description') or ''}".strip(),
        "road_name": name, "road_status": road_status, "confidence": 0.95,
        "location_text": p.get("location"),
    }
    oid = await store(e.at, "ncdot", p.get("id"), {"event": e.event, **p},
                      location_text=f"{p.get('road_name')} — {p.get('location')}", geom_geojson=e.geometry,
                      category=cat, subtype="road_closure" if road_status == "CLOSED" else "road_status",
                      confidence=0.95, extracted=extracted)
    return {"observation_id": oid}


# ---------- USGS river gauges (structured sensor stream) ----------
class GaugeReading(BaseModel):
    site_id: str
    at: datetime
    stage_ft: float | None = None
    discharge_cfs: float | None = None


@router.post("/usgs")
async def ingest_usgs(r: GaugeReading):
    """Every reading lands in the sensor hypertable. A reading that crosses the official
    NWS flood stage (in either direction) also becomes an Observation."""
    prev = await db.fetchrow("SELECT stage_ft FROM sensor_readings WHERE site_id=%s AND at < %s AND stage_ft IS NOT NULL "
                             "ORDER BY at DESC LIMIT 1",
                             r.site_id, r.at)
    await db.execute("INSERT INTO sensor_readings (site_id, at, stage_ft, discharge_cfs) VALUES (%s,%s,%s,%s)",
                     r.site_id, r.at, r.stage_ft, r.discharge_cfs)
    site = await db.fetchrow("SELECT site_id, name, flood_stage_ft, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM sensor_sites WHERE site_id=%s",
                             r.site_id)
    await publish("sensor.reading", {**r.model_dump(mode="json"), "flood_stage_ft": site and site["flood_stage_ft"]})
    if not site or r.stage_ft is None or site["flood_stage_ft"] is None:
        return {"stored": True}
    fs = site["flood_stage_ft"]
    if prev is None:  # first reading we have: report the current state if already flooding
        crossed_up, crossed_down = r.stage_ft >= fs, False
    else:
        crossed_up, crossed_down = prev["stage_ft"] < fs <= r.stage_ft, prev["stage_ft"] >= fs > r.stage_ft
    if crossed_up or crossed_down:
        summary = (f"{site['name']} {'rose above' if crossed_up else 'fell below'} flood stage "
                   f"({r.stage_ft:.1f} ft vs {fs} ft flood stage).")
        oid = await store(r.at, "usgs", r.site_id, r.model_dump(mode="json"),
                          location_text=site["name"], geom_geojson=_point(site["lon"], site["lat"]),
                          category="HAZARD" if crossed_up else "STATUS",
                          subtype="river_flooding" if crossed_up else "river_receding", confidence=0.98,
                          extracted={"summary": summary, "confidence": 0.98})
        await activity("sensor", "🌊 " + summary, {"site_id": r.site_id, "observation_id": oid})
        return {"stored": True, "observation_id": oid}
    return {"stored": True}
