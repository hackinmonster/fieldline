"""Completion-evidence verification (REAL): GPS proximity (PostGIS) + vision check (OpenAI vision)."""
from .. import db
from ..config import EVIDENCE_MAX_DISTANCE_M
from .llm import structured
from .schemas import EvidenceVerdict

SYSTEM = """You verify completion evidence for volunteer disaster-relief tasks.
Given the task and a photo + note submitted by the volunteer, judge whether the photo plausibly
shows the task was completed (e.g. a water delivery should show water containers at a residence
or being handed over). Be skeptical of photos unrelated to the task, screenshots, or empty scenes.
Do not require faces. List the relevant items you can actually see."""


async def verify(task: dict, photo: bytes | None, mime: str, note: str | None,
                 lon: float | None, lat: float | None) -> dict:
    checks: dict = {}
    if lon is None or lat is None:
        checks["gps"] = {"ok": False, "detail": "no GPS fix submitted"}
    else:
        d = await db.fetchval("SELECT ST_Distance(%s::geography, ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography)",
                              task["geom"], lon, lat)
        checks["gps"] = {"ok": d <= EVIDENCE_MAX_DISTANCE_M, "distance_m": round(d),
                         "detail": f"{d:.0f} m from task location (limit {EVIDENCE_MAX_DISTANCE_M:.0f} m)"}

    if photo:
        v = await structured(SYSTEM,
                             f"TASK: {task['type']} — {task['title']}\nINSTRUCTIONS: {task['description']}\n"
                             f"VOLUNTEER NOTE: {note or '(none)'}",
                             EvidenceVerdict, image=photo, image_mime=mime)
        checks["photo"] = {"ok": v.consistent_with_task and v.confidence >= 0.6, "confidence": v.confidence,
                           "detail": v.reasoning, "observed_items": v.observed_items}
    else:
        checks["photo"] = {"ok": False, "detail": "no photo submitted"}

    ok = all(c["ok"] for c in checks.values())
    reasoning = " | ".join(f"{k}: {c['detail']}" for k, c in checks.items())
    return {"verdict": "VERIFIED" if ok else "REJECTED", "reasoning": reasoning, "checks": checks}
