"""Adaptation ladder on changing road conditions (REAL).

Triggered by every road closure. For each active assignment whose planned route
uses a newly closed edge:
  1. REROUTE  — new closure-aware route from the volunteer's current position.
  2. REASSIGN — hand the task to a better-placed capable volunteer.
  3. ESCALATE — nobody can reach it: task BLOCKED, incident priority raised.
Choosing between 1 and 2 when both are feasible is an AI judgment over the
concrete numbers (ETAs, detour, urgency, assignment state), with a
deterministic fastest-ETA fallback if the model call fails.
"""
import logging

from .. import db
from ..bus import activity
from ..clock import sim_now
from ..intelligence.llm import structured
from ..intelligence.schemas import AdaptAction, AdaptDecision
from ..state import tasks as T
from . import matcher, routing

log = logging.getLogger("adaptation")

SYSTEM = """You are a volunteer dispatcher. A road on a volunteer's planned route just closed.
Decide whether the current volunteer should REROUTE (continue on a new route) or whether the task
should be REASSIGNED to the best alternative volunteer. Consider: total time until help arrives,
whether the current volunteer has already accepted / is already en route and likely carrying the
supplies, task urgency, and the cost of churn (reassigning confuses people; avoid it for small gains).
"""


async def on_closure(new_keys: set[tuple[int, int, int]], closure_desc: str):
    if not new_keys:
        return
    active = await db.fetch(
        f"""SELECT {T.ASSIGN_COLS}, v.name AS volunteer_name, ST_X(v.last_geom) AS vlon, ST_Y(v.last_geom) AS vlat
            FROM assignments a JOIN volunteers v ON v.id = a.volunteer_id
            WHERE a.status IN ('OFFERED','ACCEPTED')""")
    affected = [a for a in active if a["route_nodes"] and routing.route_uses(a["route_nodes"], new_keys)]
    if not affected:
        await activity("adaptation", f"Closure ({closure_desc}) checked against {len(active)} active route(s): none affected.",
                       {"active": len(active)})
        return
    for a in affected:
        try:
            await adapt_one(a, new_keys, closure_desc)
        except Exception:
            log.exception("adaptation failed for assignment %s", a["id"])


async def adapt_one(a: dict, new_keys: set, closure_desc: str):
    task = await T.get_task(a["task_id"])
    dst = (task["lon"], task["lat"])
    here = (a["vlon"], a["vlat"])
    await activity("adaptation", f"⚠ Closure ({closure_desc}) cuts {a['volunteer_name']}'s route to task #{task['id']}. Re-planning…",
                   {"assignment_id": a["id"], "task_id": task["id"]})

    baseline = await routing.route(here, dst, ignore=new_keys)       # what remained before the closure
    reroute = await routing.route(here, dst)                          # best route now
    alts, _ = await matcher.rank(task, exclude={a["volunteer_id"]})
    best_alt = alts[0] if alts else None

    # Ladder step 3: nobody can get there.
    if reroute is None and best_alt is None:
        await _release(a, "SUPERSEDED", "destination unreachable after closure")
        await matcher.escalate(task, f"{closure_desc} left no open road route for {a['volunteer_name']} "
                                     f"and no other capable volunteer can reach the task")
        return

    if reroute is not None and best_alt is None:
        action, why = AdaptAction.REROUTE, "No alternative volunteer can reach the task; rerouting is the only option."
    elif reroute is None:
        action, why = AdaptAction.REASSIGN, f"{a['volunteer_name']} can no longer reach the task by road."
    else:
        facts = {
            "task": {"id": task["id"], "type": task["type"], "title": task["title"], "urgency": task["urgency"]},
            "current_volunteer": {"name": a["volunteer_name"], "assignment_status": a["status"],
                                  "remaining_eta_min_before_closure": round(baseline["eta_s"] / 60, 1) if baseline else None,
                                  "new_eta_min_via_detour": round(reroute["eta_s"] / 60, 1)},
            "best_alternative": {"name": best_alt["name"], "eta_min": round(best_alt["route"]["eta_s"] / 60, 1),
                                 "assignment_status": "would need to accept a new offer"},
        }
        try:
            d = await structured(SYSTEM, f"Closure: {closure_desc}\nFacts: {facts}", AdaptDecision)
            action, why = d.action, d.reasoning
        except Exception as e:  # deterministic fallback — keep coordinating if the LLM is down
            log.warning("adapt LLM failed (%s); falling back to fastest ETA", e)
            faster_alt = best_alt["route"]["eta_s"] < reroute["eta_s"]
            action = AdaptAction.REASSIGN if faster_alt else AdaptAction.REROUTE
            why = "fallback rule: pick the faster arrival"

    if action == AdaptAction.REROUTE and reroute is not None:
        detour = (reroute["eta_s"] - baseline["eta_s"]) / 60 if baseline else None
        await db.execute(
            """UPDATE assignments SET route=ST_GeomFromText(%s,4326), route_nodes=%s, eta_s=%s, reason=%s, updated_at=%s
               WHERE id=%s""",
            routing.linestring_wkt(reroute["coords"]), reroute["nodes"], reroute["eta_s"],
            f"Rerouted around {closure_desc}: {why}", sim_now(), a["id"])
        await T.publish_assignment(a["id"])
        old_roads = set(routing.road_names(baseline["nodes"])) if baseline else set()
        new_only = [r for r in routing.road_names(reroute["nodes"]) if r not in old_roads]
        via = f" now via {', '.join(new_only[:3])}" if new_only else ""
        cost = (f"+{detour:.1f} min" if detour is not None and detour >= 0.05 else "no added time") if detour is not None else ""
        await activity("reroute",
                       f"↻ Rerouted {a['volunteer_name']} around {closure_desc}{via} "
                       f"(ETA {reroute['eta_s']/60:.0f} min, {cost}). {why}",
                       {"assignment_id": a["id"], "task_id": task["id"], "old_route": a["route"],
                        "detour_min": detour})
    else:
        await _release(a, "SUPERSEDED", f"reassigned after {closure_desc}")
        await T.set_status(task["id"], "OPEN", f"reassigning: {why}")
        await activity("reassign", f"⇄ Reassigning task #{task['id']} away from {a['volunteer_name']}: {why}",
                       {"assignment_id": a["id"], "task_id": task["id"]})
        await matcher.match(task["id"], exclude={a["volunteer_id"]}, context=f" after {closure_desc}")


async def _release(a: dict, status: str, reason: str):
    await db.execute("UPDATE assignments SET status=%s, reason=%s, updated_at=%s WHERE id=%s",
                     status, reason, sim_now(), a["id"])
    await T.publish_assignment(a["id"])
