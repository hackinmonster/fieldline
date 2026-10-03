// Mirrors the backend snapshot (backend/app/state/api.py: GET /state), plus optional demo-only fields.

export type TaskType = 'DELIVER_SUPPLIES' | 'WELLNESS_CHECK' | 'TRANSPORT' | 'VERIFY_CONDITION'
export type TaskStatus = 'OPEN' | 'ASSIGNED' | 'EN_ROUTE' | 'BLOCKED' | 'COMPLETED' | 'VERIFIED' | 'REJECTED'
export type AssignmentStatus = 'OFFERED' | 'ACCEPTED' | 'DONE' | 'RELEASED' | 'SUPERSEDED'

export type Requirements = {
  vehicle?: boolean; high_clearance?: boolean; min_capacity_gal?: number; min_seats?: number
  skills?: string[]; equipment?: string[]; supplies?: string[]
}

export type Task = {
  id: number; incident_id: number | null; type: TaskType; status: TaskStatus; title: string; description: string
  requirements: Requirements | null; urgency: number; priority: number; proposal_reasoning: string
  lon: number; lat: number; created_at: string; updated_at: string
  address?: string
}

export type Step = { type: string; modifier?: string | null; name: string; distance_m: number; location: [number, number] }

export type Assignment = {
  id: number; task_id: number; volunteer_id: number; status: AssignmentStatus; eta_s: number; reason: string
  route: GeoJSON.LineString | null; created_at: string; updated_at: string
  distance_m?: number; steps?: Step[]
}

export type Vehicle = { type: string; capacity_gal?: number; seats?: number; high_clearance?: boolean }

export type Volunteer = {
  id: number; name: string; skills: string[]; equipment: string[]; vehicle: Vehicle | null; available: boolean
  verify_safe: boolean; lon: number; lat: number
}

export type Incident = {
  id: number; status: string; type: string; summary: string; priority: number; confidence: number
  lon: number; lat: number; n_obs: number; sources?: string[] | null; location_text?: string | null
}

export type SourceType = 'resident' | 'social' | 'shelter' | 'ngo' | 'volunteer' | 'radio' | 'ncdot' | 'usgs'

export type Observation = {
  id: number; observed_at: string; source_type: SourceType; category: string | null; subtype: string | null
  confidence: number; incident_id: number | null; summary: string | null; point: GeoJSON.Point | null
  reporter?: string | null; raw?: string | null; photo?: string | null; location_text?: string | null
  text?: string | null; channel?: string | null
}

export type Sensor = {
  site_id: string; name: string; flood_stage_ft: number; lon: number; lat: number
  stage_ft: number | null; at: string | null; peak_stage_ft?: number
}

export type Closure = { id: number; name: string; closed_reason: string; closed_since?: string; geometry: GeoJSON.LineString }

export type Resource = { id: number; kind: 'shelter' | 'water' | 'fuel' | 'medical'; name: string; detail: string; status: 'open' | 'limited' | 'closed'; lon: number; lat: number }

export type Activity = { at: string; kind: string; message: string; data: any }

export type Snapshot = {
  clock: { sim_now: string; speed: number; simulated: boolean }
  incidents: Incident[]; tasks: Task[]; assignments: Assignment[]; volunteers: Volunteer[]
  observations: Observation[]; closures: Closure[]; sensors: Sensor[]; activity: Activity[]
  resources?: Resource[]
  demo?: { phase: 'idle' | 'loading' | 'ingesting' | 'ready' | 'error'; message: string }
}

/** What the volunteer sees after "I did it": the backend's location check passed at this distance. */
export type Completion = { task: Task; at: Date; distance_m: number | null; note: string }

export type Mine = { volunteer: Volunteer; assignment: Assignment | null; task: Task | null }
