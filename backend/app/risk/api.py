"""Risk surface + hazard context layers."""
import json
from datetime import datetime

from fastapi import APIRouter, HTTPException

from .. import db
from ..clock import sim_now
from . import model

router = APIRouter(tags=["risk"])


@router.get("/risk/surface")
async def risk_surface(at: datetime | None = None, min_risk: float = 0.03):
    if not await model.ready():
        raise HTTPException(503, "risk inputs not loaded — run backend/scripts/load_risk.py")
    t = at or sim_now()
    rows = await model.surface(t, min_risk)
    return {"type": "FeatureCollection", "at": t, "features": [
        {"type": "Feature", "geometry": json.loads(r["geojson"]),
         "properties": {"id": r["id"], "risk": r["risk"], "rain72_mm": r["rain72_mm"]}} for r in rows]}


@router.get("/risk/point")
async def risk_point(lon: float, lat: float, at: datetime | None = None):
    t = at or sim_now()
    r = await model.at_point(lon, lat, t)
    if r is None:
        raise HTTPException(404, "outside the analysis grid")
    r["percentile"] = round(await model.percentile_of(r["risk"], t), 3)
    return r


@router.get("/risk/validation")
async def risk_validation(at: datetime | None = None, top_share: float = 0.2):
    return await model.validation(at or sim_now(), top_share)


@router.get("/layers/landslides")
async def landslides_layer():
    rows = await db.fetch("SELECT id, impact, source, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM landslides")
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [r.pop("lon"), r.pop("lat")]}, "properties": r}
        for r in rows]}
