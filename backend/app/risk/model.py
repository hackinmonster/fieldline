"""Continuous place-based risk surface (REAL; inputs loaded by scripts/load_risk.py).

risk(cell, t)   = hazard(cell, t) × (0.6 + 0.4 × SVI)
hazard          = max(flood_hazard, slide_hazard)
flood_hazard    = rain × exp(-HAND / 6 m)                    — ~1 at stream level, ~0.2 at 10 m up
slide_hazard    = rain × max(debris, slope)
rain            = min(1, trailing-72h HRRR rainfall / 250 mm) — ~10 in saturates
debris          = share of the cell in NC DEQ debris-flow source/transport zones
slope           = min(1, cell-scale slope° / 35)

The two hazards are kept separate so each can be checked against the right evidence:
landslides validate slide_hazard only (flooding is a different process).

Every term is a transparent function of a public dataset; no learned weights and no
post-event data (the USGS landslide inventory is only used to validate the surface).
"""
from datetime import datetime

from .. import db

RAIN_SATURATION_MM = 250.0
HAND_SCALE_M = 6.0
SLOPE_SATURATION_DEG = 35.0

# Per-cell components at time t (SQL, one statement). %(t)s = evaluation time.
CELL_RISK_SQL = f"""
WITH pt AS (
  SELECT point_id, sum(mm) AS mm72 FROM rain_hourly
  WHERE at > %(t)s::timestamptz - interval '72 hours' AND at <= %(t)s::timestamptz
  GROUP BY point_id),
cell_rain AS (
  SELECT c.id, sum((w->>1)::float * coalesce(pt.mm72, 0)) / nullif(sum((w->>1)::float), 0) AS rain72_mm
  FROM risk_cells c, jsonb_array_elements(c.rain_weights) w
  LEFT JOIN pt ON pt.point_id = (w->>0)::int
  GROUP BY c.id),
parts AS (
  SELECT c.id, c.geojson, c.hand_m, c.slope_deg, c.debris_frac, c.svi, coalesce(cr.rain72_mm, 0) AS rain72_mm,
         least(1, coalesce(cr.rain72_mm, 0) / {RAIN_SATURATION_MM}) AS rain_f,
         exp(-coalesce(c.hand_m, 50) / {HAND_SCALE_M}) AS flood_f,
         coalesce(c.debris_frac, 0) AS debris_f,
         least(1, coalesce(c.slope_deg, 0) / {SLOPE_SATURATION_DEG}) AS slope_f
  FROM risk_cells c LEFT JOIN cell_rain cr ON cr.id = c.id)
SELECT *, rain_f * flood_f AS flood_hazard,
       rain_f * greatest(debris_f, slope_f) AS slide_hazard,
       rain_f * greatest(flood_f, debris_f, slope_f) AS hazard,
       rain_f * greatest(flood_f, debris_f, slope_f) * (0.6 + 0.4 * coalesce(svi, 0.5)) AS risk
FROM parts
"""


async def ready() -> bool:
    # Rain is required; terrain terms (HAND/slope) default to "no exposure" until loaded.
    return bool(await db.fetchval("SELECT count(*) FROM risk_cells WHERE rain_weights IS NOT NULL"))


async def surface(t: datetime, min_risk: float = 0.03) -> list[dict]:
    return await db.fetch(f"SELECT id, geojson, round(risk::numeric, 3)::float AS risk, round(rain72_mm::numeric)::float AS rain72_mm "
                          f"FROM ({CELL_RISK_SQL}) r WHERE risk >= %(min)s", {"t": t, "min": min_risk})


async def at_point(lon: float, lat: float, t: datetime) -> dict | None:
    """Full factor breakdown for the cell containing a point (used for incident scoring + popups)."""
    row = await db.fetchrow(
        f"SELECT * FROM ({CELL_RISK_SQL}) r WHERE id = (SELECT id FROM risk_cells "
        f"WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(%(lon)s,%(lat)s),4326)) LIMIT 1)",
        {"t": t, "lon": lon, "lat": lat})
    if row is None:
        return None
    row.pop("geojson", None)
    return {k: (round(v, 3) if isinstance(v, float) else v) for k, v in row.items()}


async def percentile_of(risk: float, t: datetime) -> float:
    """Share of county cells with lower risk at time t (0..1)."""
    return await db.fetchval(f"SELECT avg((risk < %(r)s)::int)::float FROM ({CELL_RISK_SQL}) r", {"t": t, "r": risk}) or 0.0


async def validation(t: datetime, top_share: float = 0.2) -> dict:
    """How concentrated are mapped Helene landslides in the cells with the highest *landslide* hazard?
    The inventory is NOT an input to the surface, so this is an honest out-of-sample check of that component."""
    row = await db.fetchrow(
        f"""WITH r AS ({CELL_RISK_SQL}),
                 ranked AS (SELECT id, percent_rank() OVER (ORDER BY slide_hazard) AS pr FROM r),
                 hits AS (SELECT c.id, count(l.*) AS n FROM risk_cells c JOIN landslides l ON ST_Contains(c.geom, l.geom) GROUP BY c.id)
            SELECT sum(h.n)::int AS landslides_in_grid,
                   sum(h.n) FILTER (WHERE rk.pr >= 1 - %(share)s)::int AS in_top,
                   (SELECT count(*) FROM ranked WHERE pr >= 1 - %(share)s)::int AS top_cells,
                   (SELECT count(*) FROM ranked)::int AS cells
            FROM hits h JOIN ranked rk ON rk.id = h.id""", {"t": t, "share": top_share})
    total, top = row["landslides_in_grid"] or 0, row["in_top"] or 0
    return {"at": t, "top_share": top_share, "landslides": total, "in_top_cells": top,
            "capture_rate": round(top / total, 3) if total else None,
            "lift": round((top / total) / top_share, 2) if total else None,
            "cells": row["cells"], "top_cells": row["top_cells"]}
