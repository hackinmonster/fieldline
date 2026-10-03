# Fieldline: Disaster Response Coordination

A real-time coordination system that turns heterogeneous disaster information into **coordinated volunteer action**, demonstrated on the immediate aftermath of Hurricane Helene in Asheville / Buncombe County, NC (Sep 27–30, 2024).

```
historical disaster conditions (demo: Helene) + incoming observations
 → normalized spatiotemporal data (Tiger Cloud: TimescaleDB + PostGIS)
 → AI understanding (OpenAI) → incident / task (code-guarded)
 → geospatial volunteer matching (PostGIS KNN + closure-aware road routing)
 → adaptation to changing conditions (reroute / reassign / escalate)
 → human action (accept → GPS on scene → mark complete) → updated operational state
```

## Architecture

One FastAPI process with four module boundaries, an in-process event bus, and a WebSocket fan-out to the clients.

| Area | Module | What it does |
|---|---|---|
| Ingestion | `backend/app/ingestion/` | Adapters for resident/shelter/NGO reports, public-safety radio transcripts, NCDOT TIMS events, USGS gauge readings, volunteer field reports → one `observations` hypertable |
| Intelligence | `backend/app/intelligence/` | LLM extraction, AI incident linking, AI task proposals + **code validator**, priority formula |
| Coordination | `backend/app/coordination/` | Matching, closure-aware routing on the OSM drive graph, adaptation ladder |
| Core State/API | `backend/app/state/` | Volunteers, assignments, snapshot reads, task state machine |

Clients share one design system (Fieldline: tokens in `new_reworked_frontend/src/styles/tokens.css`, rules in `new_reworked_frontend/DESIGN.md`):
- `frontend/` → **Fieldline Command** at `/command`: layered geospatial dashboard (ingestion → synthesis → dispatch story, plus system log).
- `new_reworked_frontend/` → **Fieldline**, the volunteer phone app: map with your best match, feed of the same reports command sees, matched tasks, offer → navigate → *Yes, I did it*. `/volunteer` on the dashboard redirects here.

## REAL vs DEMO-STUB

We are explicit about what generalizes and what exists only for the demo.

| Component | Status | Notes |
|---|---|---|
| Free-text understanding (reports, coded radio traffic) | **REAL** | OpenAI structured outputs; works on any text |
| Geocoding | **REAL** | Nominatim bounded to Buncombe + on-disk cache; road/intersection reports resolved against the OSM road network in PostGIS |
| Observation → incident linking | **REAL (AI-decided)** | SQL only narrows candidates (5 km / 48 h recall knob); the LLM decides ATTACH vs NEW with reasoning, stored in `incident_links` |
| Incident → task | **REAL (AI-proposed, code-enforced)** | `task_validator.py`: assistance tasks need a direct human-need report; hazards only yield VERIFY_CONDITION when uncertain; no duplicates |
| Priority | **REAL** | Transparent formula: AI urgency × (vulnerability flags + census-tract 65+/no-vehicle share) |
| Matching | **REAL** | PostGIS KNN → capability filters (with recorded skip reasons) → network ETA. Every volunteer considered is recorded with its outcome, which drives the dashboard's candidate view |
| Operator-approved dispatch | **REAL** | `matcher.auto_dispatch=False` (set by the demo): tasks wait OPEN until command presses *Find the best volunteer* (`POST /incidents/{id}/dispatch`); matching is identical to auto mode |
| Arrival detection | **REAL** | GPS geofence (200 m of the task) on every location update |
| Road closures | **REAL** | Any closure (NCDOT line, radio point) snaps to OSM segments and is removed from routing |
| Adaptation ladder | **REAL** | Every closure is checked against every active route; REROUTE vs REASSIGN is an AI judgment over concrete ETAs (deterministic fallback); ESCALATE when unreachable; BLOCKED tasks retried on reopen / new availability |
| Completion | **By design: trust the volunteer, check the location** | Volunteers are unpaid neighbors, so no photo proof. They tap *Yes, I did it*; `POST /assignments/{id}/complete` only accepts it when their last GPS fix is within 200 m of the task → task COMPLETED → incident RESOLVED |
| Changing your mind | **REAL** | A declined task stays in the volunteer's list; `POST /tasks/{id}/claim` lets them take it while nobody has accepted it (a pending offer to someone else is withdrawn) |
| River gauge observations | **REAL** | Readings stream into a hypertable; crossing the official NWS flood stage emits an observation |
| Replay clock / historical streaming | **DEMO-STUB (by design)** | `backend/app/demo/runner.py` (dashboard *Load scenario*) streams the real feeds + scenario reports through the ingestion functions in time order, waiting for the pipeline after each report. Backend reads time only via `clock.sim_now()` |
| Volunteer GPS movement + fast-forward | **DEMO-STUB** | `runner.Movement` moves volunteers along their ACCEPTED route (arriving at the routed ETA) via the same location function a phone would call, and runs the clock at `travel_speed` (30×) while someone drives |
| Candidate reveal pacing on the dashboard | **Presentation only** | The decision is already made when the animation starts; scan → filter → rank → chosen just paces real results |
| Fieldline `?as=follow` | **DEMO-STUB login** | The phone becomes whoever was most recently dispatched, so it can be opened before the match. `?as=<id>` signs in as a roster volunteer |
| Rerouting UI | **Shown when it happens** | Fieldline draws the routed path with turn-by-turn steps when the backend provides them and shows a notice when an assignment is rerouted; the adaptation ladder is exercised by `ladder_check.py` |
| Resident reports, radio transcripts, volunteer roster | **DEMO-STUB data, REAL logic** | Hand-authored in `replay/scenario.yaml`; no code paths reference them |
| Scenario geography | **Scenario authoring** | Reports sit at real Buncombe roads/places (Bee Tree Rd, Dillingham Rd, Pisgah Hwy, …); social posts carry geotags, the rest are geocoded live. Which volunteer wins each incident is decided by the matcher, not the scenario |

## Real data sources

| Source | File | Notes |
|---|---|---|
| NCDOT TIMS historical Helene incidents | `backend/data/ncdot_closures.geojson` | ArcGIS FeatureServer `State_Maintained_Historical_TIMS_Incidents_Hurricane_Helene` (behind NCDOT's "Road Reopening for Hurricane Helene 2024" dashboard). Real closed/reopened timestamps |
| USGS NWIS gauges 03451500 (French Broad @ Asheville), 03451000 (Swannanoa @ Biltmore) | `backend/data/usgs_readings.json` | Includes the Swannanoa gauge's real outage during the crest. NWS flood stages from NOAA NWPS |
| Census TIGER tracts + ACS | `backend/data/tracts.geojson` | Census API now needs a key; without one the script uses Census Reporter's republication of **ACS 2024 5-year** (recorded per feature) |
| NHC best track AL092024 | `backend/data/helene_track.geojson` | Map context only |
| OpenStreetMap drive network | `backend/data/buncombe_drive.graphml` | via OSMnx; mirrored into PostGIS `road_segments` |

## Live risk surface (REAL)

`backend/scripts/load_risk.py` pulls every input from public APIs **straight into PostGIS** — no data files on disk:

| Input | API | Used as |
|---|---|---|
| CDC/ATSDR Social Vulnerability Index 2022 (tract) | ArcGIS FeatureServer | vulnerability (also replaces the ACS shares in task priority) |
| USGS 3DEP elevation (30 m) | ImageServer `getSamples` | HAND (height above nearest named stream); cell-scale slope from neighboring hex elevations |
| USGS NHD named flowlines | National Map MapServer | streams for HAND |
| NC DEQ channelized debris-flow model | MapServer `export` (image decoded in memory, pixels sampled) | share of each cell in source/transport zones |
| HRRR hourly precipitation, Sep 25–30 2024 | Open-Meteo historical-forecast API | trailing-72 h rainfall at the sim clock (3 km **model** output, not gauge-observed) |
| USGS preliminary Helene landslide inventory | ArcGIS FeatureServer | **validation only — never a model input** |

Formula (`backend/app/risk/model.py`), on a 400 m hex grid (4,329 cells), recomputed in SQL for the current sim time:
`risk = max(flood_hazard, slide_hazard) × (0.6 + 0.4·SVI)`, with `rain = min(1, rain72/250mm)`, `flood_hazard = rain × exp(−HAND/6m)`, `slide_hazard = rain × max(debris_share, min(1, slope/35°))`.
Task priority now includes the incident's place hazard: `100 × urgency × (0.5 + 0.3·vulnerability + 0.2·hazard)`.
`GET /risk/validation` checks the **landslide component** against the USGS inventory (never an input): its top-20% cells hold ~41% of mapped landslides (~2.0× chance) at the Sep 28 peak. The flood component is not validated (no comparable flood-extent data loaded).

Known limits: HAND uses *named* NHD streams only (overstates height near unnamed creeks); HRRR is a forecast model at 3 km; SVI is 2022 tract-level; weights are hand-set, transparent constants, not fitted.

## Run it

```bash
# DB: Tiger Cloud service (set DATABASE_URL in backend/.env), or locally: docker compose up -d (TimescaleDB-HA image w/ PostGIS)
# then apply backend/app/schema.sql once
uv venv backend/.venv && uv pip install --python backend/.venv/bin/python \
  fastapi "uvicorn[standard]" "psycopg[binary]" psycopg-pool openai python-dotenv httpx pyyaml osmnx requests
cp backend/.env.example backend/.env                   # add OPENAI_API_KEY
for s in fetch_ncdot fetch_usgs load_tiger_acs load_nhc build_graph load_db; do backend/.venv/bin/python backend/scripts/$s.py; done
(cd backend && .venv/bin/uvicorn app.main:app --port 8000)
(cd frontend && npm install && npm run dev)            # http://localhost:5173/command
(cd new_reworked_frontend && npm install && npm run dev)  # http://localhost:5174, the Fieldline volunteer app
```

## Demo runbook (3–4 min, all from the browser)

**Before judges arrive:** open `/command` and press **Load scenario**. It takes 2–3 min of real LLM processing: 26 NCDOT closures and 76 USGS readings from Helene, plus 15 social / NGO / SMS / radio reports, come out as 11 incidents and 10 tasks. It survives backend restarts. Open the Fieldline volunteer app from the dashboard footer (*Volunteer app*) in a second tab: it follows whoever is dispatched next. Between rehearsals, use **↺ Rewind demo**. It undoes dispatches and movement in about a second and keeps the ingested incidents.

1. **Ingestion.** Toggle the *Incoming reports* layers on the map one at a time (social media, NGO & shelter, SMS, radio), then *Conditions* (NCDOT closures, Helene track, USGS gauges, census 65+). The side panel counts what came in from each source.
2. **Synthesis.** Turn the report layers back off. Eleven incidents are on the map, all built by the same pipeline. Click **Deliver drinking water… Bee Tree Rd**. Its three sources (daughter's SMS, a neighbor's Facebook post, a church outreach list) are drawn as lines into one incident. The panel plays sources → what the LLM understood → link decisions ("merged into same incident") → the task, its hard requirements and the guardrail verdict. For contrast, click the swift-water radio call: no task, because it's a 911 job.
3. **Match.** Press **Find the best volunteer**. The map scans 16 nearby volunteers, then rules some out with reasons (no vehicle, cargo too small), then ranks the rest by road ETA and picks one. Click any dot for that volunteer's profile and verdict.
4. **Phone.** Switch to the Fieldline tab (or press *Open …'s phone*). *You are needed nearby* drops in. Tap it to read the task: who asked, why you, what to bring, safety. Press **Accept and navigate**.
5. **Back to the dashboard.** The route turns solid and the volunteer drives at 30× fast-forward. The progress bar counts down, and **On scene** lights up when GPS enters the geofence. *(Optional finale: at the address, tap **Yes, I did it** on the phone → the backend checks the GPS fix → incident turns green, resolved.)*

### Checks
- `replay/replayer.py` — loads the scenario from the terminal (same as the dashboard button).
- `replay/e2e_check.py` — **rewinds**, then plays the story via the API: dispatch the best-corroborated incident, accept, wait for GPS arrival, mark complete → incident RESOLVED.
- `replay/ladder_check.py` — **resets the DB** (press *Load scenario* afterwards); uses inputs not in the scenario to exercise REASSIGN (volunteer trapped by a washout), ESCALATE (no one can reach a household), and recovery when a reopening is radioed in.
