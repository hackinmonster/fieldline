"""Observation processing pipeline (REAL).

One sequential worker so incident linking sees a consistent picture:
  extract (LLM, free text only) → locate → road-network effects → incident linking (LLM)
  → task proposal (LLM) → validator (code) → priority (code) → matching.
"""
import asyncio
import json
import logging

from .. import db, geo
from ..bus import activity, publish
from ..clock import sim_now
from ..coordination import adaptation, matcher, routing
from ..state import tasks as T
from . import classify, incident_linker, priority, task_proposer, task_validator

log = logging.getLogger("pipeline")

FREE_TEXT_SOURCES = {"resident", "shelter", "ngo", "volunteer", "radio", "social"}
# Authoritative structured feeds update the road network / sensor layers directly. They attach to
# incidents as corroboration but never open incidents or spawn tasks on their own.
AUTHORITATIVE_FEEDS = {"ncdot", "usgs", "nhc"}

queue: asyncio.Queue[int] = asyncio.Queue()
busy = False


async def worker():
    while True:
        global busy
        obs_id = await queue.get()
        busy = True
        try:
            await process(obs_id)
        except Exception as e:
            log.exception("pipeline failed for observation %s", obs_id)
            await activity("error", f"Pipeline error on observation #{obs_id}: {e}", {"observation_id": obs_id})
        finally:
            busy = False
            queue.task_done()


async def load_obs(obs_id: int) -> dict:
    return await db.fetchrow(
        "SELECT *, ST_AsGeoJSON(geom) AS geojson FROM observations WHERE id=%s", obs_id)


async def process(obs_id: int):
    obs = await load_obs(obs_id)
    raw = obs["raw"] or {}

    # 1. Understand free text.
    if obs["source_type"] in FREE_TEXT_SOURCES and not obs["extracted"]:
        text = raw.get("text") or raw.get("transcript") or ""
        meta = {k: raw.get(k) for k in ("agency", "channel", "incident_type", "reporter", "location") if raw.get(k)}
        ex = await classify.extract(text, obs["source_type"], meta)
        conf = ex.confidence
        if raw.get("confidence") is not None:  # upstream (e.g. transcription) confidence caps ours
            conf = min(conf, float(raw["confidence"]))
        await db.execute(
            """UPDATE observations SET category=%s, subtype=%s, confidence=%s, extracted=%s,
                 location_text=coalesce(location_text, %s) WHERE id=%s""",
            ex.category.value, ex.subtype, conf, db.J(ex.model_dump(mode="json")), ex.location_text, obs_id)
        obs = await load_obs(obs_id)
        await activity("extract", f"Observation #{obs_id} ({obs['source_type']}) understood as "
                                  f"{ex.category.value}/{ex.subtype}: {ex.summary}"
                                  + (f" — decoded: {ex.decoded_text}" if ex.decoded_text else ""),
                       {"observation_id": obs_id, "extracted": ex.model_dump(mode="json")})
    ex = obs["extracted"] or {}

    # 2. Locate.
    if obs["geom"] is None:
        pt = None
        if ex.get("road_name"):
            hint = await geo.geocode(obs["location_text"]) if obs["location_text"] else None
            landmark = ex.get("cross_street_or_landmark") or ""
            if "bridge" in landmark.lower() or "bridge" in (ex.get("summary") or "").lower():
                pt = routing.find_bridge(ex["road_name"], hint)
            if pt is None:
                pt = await geo.locate_on_road(ex["road_name"], landmark or None, hint)
        if pt is None and obs["location_text"]:
            pt = await geo.geocode(obs["location_text"])
        if pt is None:
            await activity("locate_failed", f"Could not locate observation #{obs_id} ('{obs['location_text']}'); "
                                            "kept for review, not acted on.", {"observation_id": obs_id})
            await publish("observation.created", _obs_payload(await load_obs(obs_id)))
            return
        await db.execute("UPDATE observations SET geom=ST_SetSRID(ST_MakePoint(%s,%s),4326) WHERE id=%s",
                         pt[0], pt[1], obs_id)
        obs = await load_obs(obs_id)
    await publish("observation.created", _obs_payload(obs))

    # 3. Road-network effects (closures / reopenings), from any source.
    road_status = ex.get("road_status")
    if road_status in ("CLOSED", "OPEN"):
        await apply_road_status(obs, road_status == "CLOSED", ex)

    # 4. Incident linking.
    if obs["source_type"] in AUTHORITATIVE_FEEDS:
        cands = await incident_linker.candidates(obs)
        if not cands:
            return  # nothing to corroborate; the road/sensor layer already reflects it
    incident = await incident_linker.link(obs)

    # 5. Task generation / re-prioritization.
    await consider_tasks(incident)


async def apply_road_status(obs: dict, is_closed: bool, ex: dict):
    segs = await routing.snap_closure(obs["geojson"], ex.get("road_name"))
    if not segs:
        await activity("road", f"Road report #{obs['id']} ({ex.get('road_name') or obs['location_text']}) "
                               "did not match any road segment.", {"observation_id": obs["id"]})
        return
    desc = ex.get("road_name") or segs[0]["name"] or "road segment"
    if ex.get("cross_street_or_landmark"):
        desc += f" at {ex['cross_street_or_landmark']}"
    changed = await routing.set_closed([s["id"] for s in segs], is_closed, ex.get("summary") or desc, obs["observed_at"])
    await db.execute("INSERT INTO road_events (at, segment_ids, status, reason, observation_id) VALUES (%s,%s,%s,%s,%s)",
                     obs["observed_at"], [s["id"] for s in segs], "CLOSED" if is_closed else "OPEN",
                     ex.get("summary"), obs["id"])
    await publish("road.updated", {"closed": is_closed, "reason": desc, "source": obs["source_type"],
                                   "segments": [{"id": r["id"], "geometry": json.loads(r["geojson"])} for r in changed]})
    await activity("road", f"{'⛔ Closed' if is_closed else '✅ Reopened'} {desc} ({len(changed)} segments) "
                           f"from {obs['source_type']} report #{obs['id']}.", {"observation_id": obs["id"]})
    if is_closed:
        await adaptation.on_closure({(s["u"], s["v"], s["k"]) for s in segs}, f"{desc} closure")
    else:
        await matcher.retry_unassigned(f"{desc} reopened")


async def consider_tasks(incident: dict):
    active = await db.fetch("SELECT id, urgency FROM tasks WHERE incident_id=%s AND status = ANY(%s)",
                            incident["id"], list(task_validator.ACTIVE_STATUSES))
    if active:
        # New evidence on an incident that already has work → re-score, don't duplicate.
        for t in active:
            p, _ = await priority.score(t["urgency"] or 0.5, incident["id"], incident["geom"])
            await db.execute("UPDATE tasks SET priority=%s WHERE id=%s", p, t["id"])
            await publish("task.updated", await _task_payload(t["id"]))
        return
    sources = await db.fetch("SELECT DISTINCT source_type FROM observations WHERE incident_id=%s", incident["id"])
    if all(s["source_type"] in AUTHORITATIVE_FEEDS for s in sources):
        return

    proposal = await task_proposer.propose(incident)
    verdict = await task_validator.validate(incident, proposal)
    await db.execute("INSERT INTO task_proposals (incident_id, at, proposal, accepted, validator_notes) VALUES (%s,%s,%s,%s,%s)",
                     incident["id"], sim_now(), db.J(proposal.model_dump(mode="json")), verdict.accepted, "; ".join(verdict.notes))
    if not proposal.create_task:
        await activity("task_proposal", f"Incident #{incident['id']}: no task — {proposal.reasoning}",
                       {"incident_id": incident["id"]})
        return
    if not verdict.accepted:
        await activity("validator_reject", f"🛡 Guardrail rejected AI proposal {proposal.task_type.value if proposal.task_type else ''} "
                                           f"for incident #{incident['id']}: {'; '.join(verdict.notes)}",
                       {"incident_id": incident["id"], "proposal": proposal.model_dump(mode="json")})
        return

    p, factors = await priority.score(proposal.urgency, incident["id"], incident["geom"])
    reqs = proposal.requirements.model_dump()
    now = sim_now()
    task = await db.fetchrow(
        """INSERT INTO tasks (incident_id, type, status, title, description, requirements, urgency, priority,
                              proposal_reasoning, geom, created_at, updated_at)
           VALUES (%s,%s,'OPEN',%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        incident["id"], proposal.task_type.value, proposal.title, proposal.description, db.J(reqs),
        proposal.urgency, p, proposal.reasoning, incident["geom"], now, now)
    await db.execute("INSERT INTO task_events (task_id, at, from_status, to_status, reason) VALUES (%s,%s,NULL,'OPEN',%s)",
                     task["id"], now, "created from validated AI proposal")
    await db.execute("UPDATE incidents SET priority=%s WHERE id=%s", p, incident["id"])
    await publish("task.updated", await _task_payload(task["id"]))
    await activity("task_created", f"📋 Task #{task['id']} {proposal.task_type.value}: {proposal.title} "
                                   f"(priority {p}). Why: {proposal.reasoning}",
                   {"task_id": task["id"], "incident_id": incident["id"], "priority_factors": factors,
                    "requirements": reqs, "validator": verdict.notes})
    if matcher.auto_dispatch:
        await matcher.match(task["id"])


async def _task_payload(task_id: int) -> dict:
    return T._strip(await T.get_task(task_id))


def _obs_payload(obs: dict) -> dict:
    return {k: (json.loads(v) if k == "geojson" and v else v) for k, v in obs.items() if k != "geom"}
