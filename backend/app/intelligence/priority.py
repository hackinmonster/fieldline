"""Task priority — a transparent formula in code, fed by AI-extracted inputs.

priority = 100 × urgency × (0.5 + 0.3 × vulnerability + 0.2 × place_hazard)
  urgency       AI-extracted (0..1)
  vulnerability reporter-stated flags (elderly, medical, …) + CDC SVI of the census tract
  place_hazard  continuous risk-surface hazard at the incident (rain × terrain), see risk/model.py
"""
import logging

from .. import db
from ..clock import sim_now
from ..risk import model as risk

log = logging.getLogger("priority")


async def score(task_urgency: float, incident_id: int, geom) -> tuple[float, dict]:
    flags = await db.fetchval(
        """SELECT coalesce(jsonb_agg(DISTINCT f), '[]'::jsonb) FROM observations o,
                  jsonb_array_elements_text(coalesce(o.extracted->'vulnerability_flags','[]'::jsonb)) f
           WHERE o.incident_id=%s""", incident_id) or []
    tract = await db.fetchrow("SELECT pct_65plus, pct_no_vehicle, svi FROM tracts WHERE ST_Contains(geom, %s::geometry)", geom)
    if tract and tract["svi"] is not None:
        tract_vuln = tract["svi"]
    else:  # fall back to the ACS shares if SVI is not loaded
        tract_vuln = ((tract["pct_65plus"] or 0) + (tract["pct_no_vehicle"] or 0)) / 100 if tract else 0
    vuln = min(1.0, 0.25 * len(flags) + 0.75 * tract_vuln)

    place, hazard = None, 0.0
    try:
        pt = await db.fetchrow("SELECT ST_X(ST_Centroid(%s::geometry)) AS lon, ST_Y(ST_Centroid(%s::geometry)) AS lat", geom, geom)
        place = await risk.at_point(pt["lon"], pt["lat"], sim_now())
        hazard = (place or {}).get("hazard") or 0.0
    except Exception as e:  # risk inputs not loaded → priority still works without the place term
        log.warning("risk surface unavailable for priority: %s", e)

    u = max(0.0, min(1.0, task_urgency))
    p = round(100 * u * (0.5 + 0.3 * vuln + 0.2 * hazard), 1)
    factors = {"urgency": task_urgency, "vulnerability_flags": flags, "tract_svi": round(tract_vuln, 2),
               "vulnerability": round(vuln, 2), "place_hazard": round(hazard, 2)}
    if place:
        factors["place"] = {k: place[k] for k in ("rain72_mm", "hand_m", "slope_deg", "debris_frac", "risk") if k in place}
    return p, factors
