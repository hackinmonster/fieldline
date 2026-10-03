"""Structured-output schemas the LLM must fill. Enums constrain what it can say."""
from enum import Enum

from pydantic import BaseModel, Field


class Category(str, Enum):
    NEED = "NEED"                      # a person/group needs something
    HAZARD = "HAZARD"                  # dangerous condition (flooding, landslide, downed lines)
    INFRASTRUCTURE = "INFRASTRUCTURE"  # roads/bridges/utilities status
    STATUS = "STATUS"                  # informational / resolved / all-clear


class RoadStatus(str, Enum):
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    UNKNOWN = "UNKNOWN"


class Extraction(BaseModel):
    category: Category
    subtype: str = Field(description="short snake_case label, e.g. drinking_water, medical, road_washout, flooding, power_outage, bridge_damage")
    summary: str = Field(description="one plain-English sentence describing what was observed")
    location_text: str | None = Field(None, description="best geocodable location string, e.g. '123 Main St, Swannanoa, NC' or 'Riceville Rd, Asheville, NC'")
    road_name: str | None = Field(None, description="primary road name if the report concerns a road, expanded from abbreviations (e.g. 'Riceville Road')")
    cross_street_or_landmark: str | None = Field(None, description="cross street / landmark that pins the location along the road")
    road_status: RoadStatus | None = None
    people_affected: int | None = None
    vulnerability_flags: list[str] = Field(default_factory=list, description="e.g. elderly, disabled, infant, medical_device, no_vehicle, no_power")
    needs: list[str] = Field(default_factory=list, description="concrete needs stated or clearly implied by the reporter, e.g. drinking_water, food, medication, transport")
    urgency: float = Field(description="0..1 how time-critical")
    confidence: float = Field(description="0..1 how reliable/specific this information is")
    decoded_text: str | None = Field(None, description="for radio traffic: plain-English decoding of codes/abbreviations")


class LinkDecision(str, Enum):
    ATTACH = "ATTACH"
    NEW = "NEW"


class LinkResult(BaseModel):
    decision: LinkDecision
    incident_id: int | None = Field(None, description="required when decision=ATTACH; must be one of the candidate ids")
    reasoning: str
    incident_type: str = Field(description="snake_case incident type for the (new or updated) incident")
    updated_summary: str = Field(description="concise summary of the incident after incorporating this observation")
    confidence: float = Field(description="0..1 confidence the incident is real/accurately described after this evidence")


class TaskType(str, Enum):
    DELIVER_SUPPLIES = "DELIVER_SUPPLIES"
    WELLNESS_CHECK = "WELLNESS_CHECK"
    TRANSPORT = "TRANSPORT"
    VERIFY_CONDITION = "VERIFY_CONDITION"


class Requirements(BaseModel):
    vehicle: bool = False
    high_clearance: bool = False
    min_capacity_gal: float = 0
    min_seats: int = 0
    skills: list[str] = Field(default_factory=list, description="from: first_aid, cpr, chainsaw, heavy_lifting, spanish, medical")
    equipment: list[str] = Field(default_factory=list, description="from: water_jugs, generator, chainsaw, cooler, ladder")
    supplies: list[str] = Field(default_factory=list, description="items to bring, e.g. '10 gal drinking water'")


class TaskProposal(BaseModel):
    create_task: bool
    task_type: TaskType | None = None
    title: str | None = None
    description: str | None = Field(None, description="instructions for the volunteer")
    requirements: Requirements = Field(default_factory=Requirements)
    urgency: float = Field(0.5, description="0..1")
    reasoning: str
    supporting_observation_ids: list[int] = Field(default_factory=list, description="ids of observations that justify the task")


class EvidenceVerdict(BaseModel):
    consistent_with_task: bool
    reasoning: str
    confidence: float
    observed_items: list[str] = Field(default_factory=list)


class AdaptAction(str, Enum):
    REROUTE = "REROUTE"
    REASSIGN = "REASSIGN"


class AdaptDecision(BaseModel):
    action: AdaptAction
    reasoning: str = Field(description="one or two sentences a dispatcher would accept")
