"""Free-text → structured Extraction (REAL: works on any report/transcript)."""
from .llm import structured
from .schemas import Extraction

SYSTEM = """You extract structured disaster-response information from messy field reports
in Buncombe County / Asheville, North Carolina during the aftermath of Hurricane Helene.

Sources include residents, shelters, NGOs, volunteers, and transcribed public-safety radio.
Radio traffic is terse and coded (10-codes, unit callsigns, 'PW' = public works,
'impassable', 'washout', 'BCSO' = Buncombe County Sheriff, 'AFD' = Asheville Fire, 'EMS',
'10-4', 'en route', mile markers). Decode it.

Rules:
- category=NEED only if a person/household/group needs something. Do NOT infer a human need
  from hazard information alone (a flooded road is HAZARD/INFRASTRUCTURE, not a NEED).
- A road being blocked, closed, washed out, or impassable is INFRASTRUCTURE with road_status=CLOSED.
- Only list needs that the source states or that are directly implied by its words.
- location_text must be something a geocoder can resolve; always append ', NC' context.
- Be calibrated with confidence: second-hand or vague reports are lower.
"""


async def extract(text: str, source_type: str, meta: dict | None = None) -> Extraction:
    prompt = f"SOURCE TYPE: {source_type}\n"
    if meta:
        prompt += "METADATA: " + ", ".join(f"{k}={v}" for k, v in meta.items() if v is not None) + "\n"
    prompt += f"REPORT:\n{text}"
    return await structured(SYSTEM, prompt, Extraction)
