# Helene Volunteer Coordination

A real-time coordination system that turns heterogeneous disaster information into **verified volunteer action**, demonstrated on the immediate aftermath of Hurricane Helene in Asheville / Buncombe County, NC (Sep 27–30, 2024).

```
historical Helene conditions + incoming observations
 → normalized spatiotemporal data (Tiger Cloud: TimescaleDB + PostGIS)
 → AI understanding (OpenAI) → incident / task (code-guarded)
 → geospatial volunteer matching (PostGIS KNN + closure-aware road routing)
 → adaptation to changing conditions (reroute / reassign / escalate)
 → human action → evidence verification (GPS + vision) → updated operational state
```

## Architecture

One FastAPI process with four module boundaries, an in-process event bus, and a WebSocket fan-out to the clients.

| Area | Module | What it does |
|---|---|---|
| Ingestion | `backend/app/ingestion/` | Adapters for resident/shelter/NGO reports, public-safety radio transcripts, NCDOT TIMS events, USGS gauge readings, volunteer field reports → one `observations` hypertable |
| Intelligence | `backend/app/intelligence/` | LLM extraction, AI incident linking, AI task proposals + **code validator**, priority formula, evidence verification |
| Coordination | `backend/app/coordination/` | Matching, closure-aware routing on the OSM drive graph, adaptation ladder |
| Core State/API | `backend/app/state/` | Volunteers, assignments, evidence, snapshot reads, task state machine |

Clients (`frontend/`): `/command` (live geospatial dashboard + decision feed) and `/volunteer` (mobile volunteer app).

## REAL vs DEMO-STUB

We are explicit about what generalizes and what exists only for the demo.

| Component | Status | Notes |
|---|---|---|
| Free-text understanding (reports, coded radio traffic) | **REAL** | OpenAI structured outputs; works on any text |
| Geocoding | **REAL** | Nominatim bounded to Buncombe + on-disk cache; road/intersection reports resolved against the OSM road network in PostGIS |
| Observation → incident linking | **REAL (AI-decided)** | SQL only narrows candidates (5 km / 48 h recall knob); the LLM decides ATTACH vs NEW with reasoning, stored in `incident_links` |
| Incident → task | **REAL (AI-proposed, code-enforced)** | `task_validator.py`: assistance tasks need a direct human-need report; hazards only yield VERIFY_CONDITION when uncertain; no duplicates |
| Priority | **REAL** | Transparent formula: AI urgency × (vulnerability flags + census-tract 65+/no-vehicle share) |
| Matching | **REAL** | PostGIS KNN → capability filters (with recorded skip reasons) → network ETA |
| Road closures | **REAL** | Any closure (NCDOT line, radio point) snaps to OSM segments and is removed from routing |
| Adaptation ladder | **REAL** | Every closure is checked against every active route; REROUTE vs REASSIGN is an AI judgment over concrete ETAs (deterministic fallback); ESCALATE when unreachable; BLOCKED tasks retried on reopen / new availability |
| Evidence verification | **REAL** | PostGIS GPS distance check + OpenAI vision |
| River gauge observations | **REAL** | Readings stream into a hypertable; crossing the official NWS flood stage emits an observation |
| Replay clock / historical streaming | **DEMO-STUB (by design)** | `replay/replayer.py` drives `POST /sim/clock` and the public ingestion endpoints. Backend reads time only via `clock.sim_now()` |
| Volunteer GPS movement | **DEMO-STUB** | `VolunteerSim` in the replayer moves volunteers along their assigned routes via the same location endpoint a phone would use |
| Background volunteers auto-accept | **DEMO-STUB** | Only in the replayer |
| Resident reports, radio transcripts, volunteer roster | **DEMO-STUB data, REAL logic** | Hand-authored in `replay/scenario.yaml`; no code paths reference them |
| Demo geography (Bee Tree Rd / Riverwood Rd) | **Scenario authoring** | Chosen by computing real routes on the OSM graph so the closure genuinely crosses the route and a real detour exists |

## Real data sources

| Source | File | Notes |
|---|---|---|
| NCDOT TIMS historical Helene incidents | `backend/data/ncdot_closures.geojson` | ArcGIS FeatureServer `State_Maintained_Historical_TIMS_Incidents_Hurricane_Helene` (behind NCDOT's "Road Reopening for Hurricane Helene 2024" dashboard). Real closed/reopened timestamps |
| USGS NWIS gauges 03451500 (French Broad @ Asheville), 03451000 (Swannanoa @ Biltmore) | `backend/data/usgs_readings.json` | Includes the Swannanoa gauge's real outage during the crest. NWS flood stages from NOAA NWPS |
| Census TIGER tracts + ACS | `backend/data/tracts.geojson` | Census API now needs a key; without one the script uses Census Reporter's republication of **ACS 2024 5-year** (recorded per feature) |
| NHC best track AL092024 | `backend/data/helene_track.geojson` | Map context only |
| OpenStreetMap drive network | `backend/data/buncombe_drive.graphml` | via OSMnx; mirrored into PostGIS `road_segments` |

## Run it

```bash
# DB: Tiger Cloud service (set DATABASE_URL in backend/.env), or locally: docker compose up -d (TimescaleDB-HA image w/ PostGIS)
# then apply backend/app/schema.sql once
uv venv backend/.venv && uv pip install --python backend/.venv/bin/python \
  fastapi "uvicorn[standard]" "psycopg[binary]" psycopg-pool openai python-dotenv httpx python-multipart pyyaml osmnx requests
cp backend/.env.example backend/.env                   # add OPENAI_API_KEY
for s in fetch_ncdot fetch_usgs load_tiger_acs load_nhc build_graph load_db; do backend/.venv/bin/python backend/scripts/$s.py; done
(cd backend && .venv/bin/uvicorn app.main:app --port 8000)
(cd frontend && npm install && npm run dev)            # http://localhost:5173/command , /volunteer?id=1
backend/.venv/bin/python replay/replayer.py            # press Enter at ⏸ pause points
```
