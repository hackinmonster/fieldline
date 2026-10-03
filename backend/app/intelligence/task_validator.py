"""Code-enforced guardrails on AI task proposals (REAL).

The LLM proposes; this module disposes. The "AI never invents a need" rule
lives here, not in a prompt.
"""
from dataclasses import dataclass

from .. import db
from .schemas import TaskProposal, TaskType

# A first-person (or family member's) social media post asking for help is a direct need report;
# the LLM's calibrated confidence still distinguishes it from rumor / reposts.
DIRECT_NEED_SOURCES = {"resident", "shelter", "ngo", "volunteer", "social"}
ASSISTANCE_TYPES = {TaskType.DELIVER_SUPPLIES, TaskType.WELLNESS_CHECK, TaskType.TRANSPORT}
ACTIVE_STATUSES = ("OPEN", "ASSIGNED", "EN_ROUTE", "BLOCKED")
# Above this incident confidence a volunteer verification adds little — don't send people to look.
VERIFY_MAX_CONFIDENCE = 0.8


@dataclass
class Verdict:
    accepted: bool
    notes: list[str]


async def validate(incident: dict, p: TaskProposal) -> Verdict:
    notes: list[str] = []
    if not p.create_task or p.task_type is None:
        return Verdict(False, ["model proposed no task"])

    obs = await db.fetch("SELECT id, source_type, category, confidence FROM observations WHERE incident_id=%s",
                         incident["id"])
    obs_ids = {o["id"] for o in obs}

    bogus = [i for i in p.supporting_observation_ids if i not in obs_ids]
    if bogus:
        notes.append(f"supporting observations {bogus} are not part of this incident")
        return Verdict(False, notes)

    if p.task_type in ASSISTANCE_TYPES:
        direct_needs = [o for o in obs if o["category"] == "NEED" and o["source_type"] in DIRECT_NEED_SOURCES]
        if not direct_needs:
            notes.append(f"{p.task_type.value} requires a direct report of a human need "
                         f"(resident/social/shelter/NGO/volunteer); incident has none")
            return Verdict(False, notes)

    if p.task_type == TaskType.VERIFY_CONDITION:
        # How reliable is the best first-hand evidence we have? (not the model's belief about the incident)
        best = max((o["confidence"] or 0) for o in obs) if obs else 0
        if best >= VERIFY_MAX_CONFIDENCE:
            notes.append(f"best evidence confidence {best:.2f} ≥ {VERIFY_MAX_CONFIDENCE}; verification not needed")
            return Verdict(False, notes)
        notes.append("restricted to verify-safe volunteers; observe from a safe distance")

    dup = await db.fetchval(
        "SELECT count(*) FROM tasks WHERE incident_id=%s AND type=%s AND status = ANY(%s)",
        incident["id"], p.task_type.value, list(ACTIVE_STATUSES))
    if dup:
        notes.append(f"an active {p.task_type.value} task already exists for this incident")
        return Verdict(False, notes)

    return Verdict(True, notes or ["passed all guardrails"])
