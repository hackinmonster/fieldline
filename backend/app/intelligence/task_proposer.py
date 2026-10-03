"""Incident → task proposal (REAL, AI-proposed; enforced by task_validator)."""
from .. import db
from .llm import structured
from .schemas import TaskProposal

SYSTEM = """You propose volunteer tasks for a community disaster-response coordination system
(Hurricane Helene aftermath, Buncombe County NC). Volunteers are ordinary community members,
NOT professional first responders.

Allowed task types:
- DELIVER_SUPPLIES: bring specific supplies (water, food, meds pickup, etc.) to a location.
- WELLNESS_CHECK: visit a specific person/household to check on them.
- TRANSPORT: drive a person somewhere (shelter, pharmacy, medical appointment).
- VERIFY_CONDITION: safely observe and report a reported/uncertain condition from a safe distance
  (never enter floodwater, never cross barricades, never touch downed lines).

Hard principles:
- Only propose DELIVER_SUPPLIES / WELLNESS_CHECK / TRANSPORT when the incident's observations
  include a direct report of a human need. Hazard, sensor, road, weather or radio information
  must NOT be turned into an invented human need.
- Hazard-only incidents: propose VERIFY_CONDITION only if the information is uncertain AND
  ground truth would materially help coordination; otherwise create_task=false.
- Authoritative closures (NCDOT) and sensor readings do not need volunteer verification.
- Life-threatening emergencies (trapped people, medical emergencies, rescues) are for 911 /
  professional responders: create_task=false and say so in reasoning.
- Requirements are HARD FILTERS on which volunteers may be matched, so keep them minimal: only
  what the job physically cannot be done without (e.g. several days of drinking water for a household is
  10+ gallons at ~8 lb/gal, which needs a vehicle with that cargo capacity — set vehicle=true and
  min_capacity_gal; transporting people needs seats; known damaged roads may need high clearance).
  Items the volunteer can pick up (water, food, diapers) go in `supplies`, NOT in `equipment`.
  Only require skills/equipment when the task is impossible or unsafe without them.
- Be specific and safe in the volunteer instructions.
"""


async def propose(incident: dict) -> TaskProposal:
    obs = await db.fetch(
        """SELECT id, source_type, category, subtype, confidence, observed_at, location_text,
                  extracted->>'summary' AS summary, extracted->'needs' AS needs,
                  extracted->'vulnerability_flags' AS vulnerability, extracted->>'people_affected' AS people
           FROM observations WHERE incident_id=%s ORDER BY observed_at""", incident["id"])
    tract = await db.fetchrow(
        """SELECT name, pct_65plus, pct_no_vehicle, median_income FROM tracts
           WHERE ST_Contains(geom, %s::geometry) LIMIT 1""", incident["geom"])
    nearby_closures = await db.fetchval(
        """SELECT count(*) FROM road_segments WHERE closed AND
           ST_DWithin(geom::geography, %s::geography, 3000)""", incident["geom"])
    existing = await db.fetch(
        "SELECT id, type, status, title FROM tasks WHERE incident_id=%s", incident["id"])

    prompt = (f"INCIDENT #{incident['id']} type={incident['type']} confidence={incident['confidence']}\n"
              f"summary: {incident['summary']}\n\nOBSERVATIONS:\n")
    for o in obs:
        prompt += (f"- obs {o['id']} [{o['source_type']}/{o['category']}/{o['subtype']}] conf={o['confidence']} "
                   f"at {o['observed_at']}: {o['summary']} | needs={o['needs']} vulnerability={o['vulnerability']} "
                   f"people={o['people']} location={o['location_text']}\n")
    if tract:
        prompt += (f"\nCENSUS TRACT CONTEXT: {tract['name']}: {tract['pct_65plus']:.0f}% age 65+, "
                   f"{tract['pct_no_vehicle']:.0f}% households without a vehicle, median income ${tract['median_income']:,.0f}\n")
    prompt += f"ROAD CLOSURES WITHIN 3 KM: {nearby_closures}\n"
    if existing:
        prompt += f"EXISTING TASKS FOR THIS INCIDENT: {existing}\n"
    return await structured(SYSTEM, prompt, TaskProposal)
