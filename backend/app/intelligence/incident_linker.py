"""Observation → Incident linking (REAL, AI-decided).

SQL only narrows the candidate set (recall bound from config — a cost knob,
not the matching rule). The LLM decides ATTACH vs NEW from the evidence:
distance, time gap, types, sources, and content.
"""
from .. import db
from ..bus import activity, publish
from ..clock import sim_now
from ..config import LINK_RECALL_RADIUS_M, LINK_RECALL_WINDOW_H
from .llm import structured
from .schemas import LinkDecision, LinkResult

SYSTEM = """You maintain the incident picture for a disaster-response coordination system
(Hurricane Helene aftermath, Buncombe County NC).

An INCIDENT is one real-world situation (a household needing water; a washed-out road segment;
a flooded neighborhood). Several observations from different sources may describe the same
incident. You decide whether a NEW observation describes one of the candidate incidents (ATTACH)
or a different situation (NEW).

Reason like a dispatcher:
- Spatial scale depends on the phenomenon: a river flood or regional outage can span kilometers;
  a household's needs are tied to one address (two households 300 m apart are different incidents);
  a road washout is tied to a specific stretch of road.
- Temporal scale depends on the phenomenon: needs can persist for days; flood crests pass in hours.
- Different source types can corroborate each other (a radio report and an NCDOT closure of the
  same road; a river gauge upstream of a flooding report).
- Do NOT merge a human need into a hazard incident just because they are near each other;
  a need is its own incident (hazards may affect it, but they are separate situations).
- If unsure, prefer NEW.
"""


async def candidates(obs: dict) -> list[dict]:
    return await db.fetch(
        """
        SELECT i.id, i.type, i.summary, i.confidence, i.status,
               round(ST_Distance(i.geom::geography, o.geom::geography)) AS distance_m,
               round(extract(epoch FROM (%s - i.updated_at))/3600.0, 1) AS hours_since_update,
               (SELECT json_agg(json_build_object('id', x.id, 'source', x.source_type, 'category', x.category,
                                                  'subtype', x.subtype, 'summary', x.extracted->>'summary')
                                ORDER BY x.observed_at)
                  FROM observations x WHERE x.incident_id = i.id) AS observations
        FROM incidents i, (SELECT ST_Centroid(%s::geometry) AS geom) o
        WHERE i.status = 'OPEN'
          AND ST_DWithin(i.geom::geography, o.geom::geography, %s)
          AND i.updated_at > %s - make_interval(hours => %s)
        ORDER BY i.geom <-> o.geom
        LIMIT 8
        """,
        sim_now(), obs["geom"], LINK_RECALL_RADIUS_M, sim_now(), int(LINK_RECALL_WINDOW_H))


async def link(obs: dict) -> dict:
    """Returns the incident row the observation now belongs to."""
    ex = obs["extracted"] or {}
    cands = await candidates(obs)
    now = sim_now()

    if not cands:
        # Nothing nearby to compare against — a new incident is the only possibility.
        result = LinkResult(decision=LinkDecision.NEW, reasoning="No open incidents within the recall area.",
                            incident_type=obs["subtype"] or obs["category"].lower(),
                            updated_summary=ex.get("summary") or obs["subtype"],
                            confidence=obs["confidence"] or 0.5)
    else:
        prompt = (
            f"NEW OBSERVATION (id {obs['id']}):\n"
            f"  source: {obs['source_type']}  category: {obs['category']}  subtype: {obs['subtype']}\n"
            f"  observed_at: {obs['observed_at']}  confidence: {obs['confidence']}\n"
            f"  location: {obs['location_text']}\n"
            f"  summary: {ex.get('summary')}\n"
            f"  details: {ex}\n\n"
            f"CANDIDATE INCIDENTS (distance from observation, hours since last update):\n"
        )
        for c in cands:
            prompt += (f"- incident {c['id']}: type={c['type']} distance={c['distance_m']}m "
                       f"updated {c['hours_since_update']}h ago confidence={c['confidence']}\n"
                       f"  summary: {c['summary']}\n  observations: {c['observations']}\n")
        result = await structured(SYSTEM, prompt, LinkResult)
        valid_ids = {c["id"] for c in cands}
        if result.decision == LinkDecision.ATTACH and result.incident_id not in valid_ids:
            result.decision = LinkDecision.NEW
            result.reasoning += " [validator: referenced incident not among candidates → NEW]"

    if result.decision == LinkDecision.ATTACH:
        inc = await db.fetchrow(
            """UPDATE incidents SET summary=%s, type=%s, confidence=%s, updated_at=%s
               WHERE id=%s RETURNING *, ST_AsGeoJSON(geom) AS geojson""",
            result.updated_summary, result.incident_type, _clamp(result.confidence), now,
            result.incident_id)
    else:
        inc = await db.fetchrow(
            """INSERT INTO incidents (type, summary, confidence, geom, created_at, updated_at)
               VALUES (%s,%s,%s, ST_Centroid(%s::geometry), %s,%s) RETURNING *, ST_AsGeoJSON(geom) AS geojson""",
            result.incident_type, result.updated_summary, _clamp(result.confidence), obs["geom"], now, now)

    await db.execute("UPDATE observations SET incident_id=%s WHERE id=%s", inc["id"], obs["id"])
    await db.execute(
        """INSERT INTO incident_links (observation_id, incident_id, decision, reasoning, llm_confidence, at)
           VALUES (%s,%s,%s,%s,%s,%s)""",
        obs["id"], inc["id"], result.decision.value, result.reasoning, result.confidence, now)

    verb = "attached to" if result.decision == LinkDecision.ATTACH else "opened new"
    await activity("incident_link",
                   f"Observation #{obs['id']} ({obs['source_type']}) {verb} incident #{inc['id']}: {result.reasoning}",
                   {"observation_id": obs["id"], "incident_id": inc["id"], "decision": result.decision.value,
                    "candidates": len(cands)})
    await publish("incident.updated", _incident_payload(inc))
    return inc


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


def _incident_payload(inc: dict) -> dict:
    return {k: v for k, v in inc.items() if k != "geom"}
