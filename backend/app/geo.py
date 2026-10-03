"""Geocoding + road-name location (REAL).

Nominatim (bounded to Buncombe County) with an on-disk cache so the demo does
not depend on network latency. Road-centric reports ("Riceville Rd at Bull
Creek") are resolved against the OSM road network in PostGIS instead, because
geocoders handle intersections poorly.
"""
import asyncio
import json
import logging
import re

import httpx

from . import db
from .config import GEOCODE_CACHE

log = logging.getLogger("geo")

# Buncombe County bounding box (lon_min, lat_max, lon_max, lat_min) for Nominatim viewbox
VIEWBOX = "-82.90,35.83,-82.25,35.42"
_cache: dict[str, list[float] | None] = {}
_lock = asyncio.Lock()

SUFFIXES = r"\b(road|rd|street|st|avenue|ave|highway|hwy|drive|dr|lane|ln|boulevard|blvd|parkway|pkwy|court|ct|way|place|pl|circle|cir|trail|trl|pike)\b\.?"


def _load():
    global _cache
    if not _cache and GEOCODE_CACHE.exists():
        _cache = json.loads(GEOCODE_CACHE.read_text())


def _save():
    GEOCODE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    GEOCODE_CACHE.write_text(json.dumps(_cache, indent=1))


async def geocode(q: str) -> tuple[float, float] | None:
    """Returns (lon, lat) or None. Falls back to the street without a house number."""
    for variant in _variants(q):
        hit = await _geocode_one(variant)
        if hit is not None:
            return hit
    return None


def _variants(q: str) -> list[str]:
    """Progressively looser forms: as given → without leading place/org name → without house number."""
    out = [q]
    parts = [p.strip() for p in q.split(",")]
    if len(parts) > 2 and not re.match(r"^\d", parts[0]):
        out.append(", ".join(parts[1:]))  # "AB Tech, 340 Victoria Rd, Asheville" → "340 Victoria Rd, Asheville"
    for v in list(out):
        if re.match(r"^\s*\d+\s+", v):
            out.append(re.sub(r"^\s*\d+\s+", "", v))
    return list(dict.fromkeys(out))


async def _geocode_one(q: str) -> tuple[float, float] | None:
    _load()
    key = q.strip().lower()
    if key in _cache:
        v = _cache[key]
        return (v[0], v[1]) if v else None
    async with _lock:
        try:
            async with httpx.AsyncClient(timeout=10, headers={"User-Agent": "helene-coord-hackathon/0.1"}) as c:
                r = await c.get("https://nominatim.openstreetmap.org/search",
                                params={"q": q, "format": "json", "limit": 1,
                                        "viewbox": VIEWBOX, "bounded": 1})
                r.raise_for_status()
                hits = r.json()
            await asyncio.sleep(1.0)  # Nominatim usage policy
        except Exception as e:
            log.warning("geocode failed for %r: %s", q, e)
            return None
    val = [float(hits[0]["lon"]), float(hits[0]["lat"])] if hits else None
    _cache[key] = val
    _save()
    return (val[0], val[1]) if val else None


def road_core(name: str) -> str:
    core = re.sub(SUFFIXES, "", name.lower()).strip()
    return re.sub(r"\s+", " ", core)


async def locate_on_road(road_name: str, near: str | None = None,
                         hint: tuple[float, float] | None = None) -> tuple[float, float] | None:
    """Find a point on a named road, pinned by a cross street / landmark / hint point."""
    core = road_core(road_name)
    if not core:
        return None
    pattern = f"%{core}%"
    # 1) Cross street that is itself a road → intersection point of the two roads.
    if near:
        cross_core = road_core(near)
        if cross_core:
            row = await db.fetchrow(
                """SELECT ST_X(p) AS lon, ST_Y(p) AS lat FROM (
                     SELECT ST_ClosestPoint(a.geom, b.geom) AS p,
                            ST_Distance(a.geom::geography, b.geom::geography) AS d
                     FROM road_segments a, road_segments b
                     WHERE a.name ILIKE %s AND b.name ILIKE %s
                     ORDER BY d LIMIT 1) s WHERE d < 400""",
                pattern, f"%{cross_core}%")
            if row:
                return row["lon"], row["lat"]
        # 2) Landmark → geocode it, then snap to the road.
        if hint is None:
            hint = await geocode(f"{near}, Buncombe County, NC")
    if hint:
        row = await db.fetchrow(
            """SELECT ST_X(p) AS lon, ST_Y(p) AS lat FROM (
                 SELECT ST_ClosestPoint(geom, ST_SetSRID(ST_MakePoint(%s,%s),4326)) AS p
                 FROM road_segments WHERE name ILIKE %s
                 ORDER BY geom <-> ST_SetSRID(ST_MakePoint(%s,%s),4326) LIMIT 1) s""",
            hint[0], hint[1], pattern, hint[0], hint[1])
        if row:
            return row["lon"], row["lat"]
    # 3) Road only → its midpoint (low precision; caller should lower confidence).
    row = await db.fetchrow(
        """SELECT ST_X(c) AS lon, ST_Y(c) AS lat FROM (
             SELECT ST_ClosestPoint(u, ST_Centroid(u)) AS c FROM (
               SELECT ST_Union(geom) AS u FROM road_segments WHERE name ILIKE %s) x) s
           WHERE c IS NOT NULL""", pattern)
    return (row["lon"], row["lat"]) if row else None
