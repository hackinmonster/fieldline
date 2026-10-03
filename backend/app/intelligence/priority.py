"""Task priority — a transparent formula in code, fed by AI-extracted inputs."""
from .. import db


async def score(task_urgency: float, incident_id: int, geom) -> tuple[float, dict]:
    flags = await db.fetchval(
        """SELECT coalesce(jsonb_agg(DISTINCT f), '[]'::jsonb) FROM observations o,
                  jsonb_array_elements_text(coalesce(o.extracted->'vulnerability_flags','[]'::jsonb)) f
           WHERE o.incident_id=%s""", incident_id) or []
    tract = await db.fetchrow("SELECT pct_65plus, pct_no_vehicle FROM tracts WHERE ST_Contains(geom, %s::geometry)", geom)
    tract_vuln = ((tract["pct_65plus"] or 0) + (tract["pct_no_vehicle"] or 0)) / 100 if tract else 0
    vuln = min(1.0, 0.25 * len(flags) + tract_vuln)
    p = round(100 * max(0.0, min(1.0, task_urgency)) * (0.6 + 0.4 * vuln), 1)
    return p, {"urgency": task_urgency, "vulnerability_flags": flags, "tract_vulnerability": round(tract_vuln, 2),
               "vulnerability": round(vuln, 2)}
