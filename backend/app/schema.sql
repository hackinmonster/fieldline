CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------- Context layers ----------
CREATE TABLE IF NOT EXISTS tracts (
  geoid text PRIMARY KEY,
  name text,
  pop int,
  pct_65plus double precision,
  pct_no_vehicle double precision,
  median_income double precision,
  geom geometry(MultiPolygon, 4326)
);
CREATE INDEX IF NOT EXISTS tracts_geom_idx ON tracts USING gist (geom);

CREATE TABLE IF NOT EXISTS storm_track (
  id serial PRIMARY KEY,
  at timestamptz,
  wind_kt int,
  category text,
  geom geometry(Geometry, 4326)
);

-- ---------- Road network (mirrors the in-memory OSM graph) ----------
CREATE TABLE IF NOT EXISTS road_segments (
  id bigserial PRIMARY KEY,
  u bigint NOT NULL,
  v bigint NOT NULL,
  k int NOT NULL DEFAULT 0,
  name text,
  highway text,
  length_m double precision,
  travel_time_s double precision,
  closed boolean NOT NULL DEFAULT false,
  closed_reason text,
  closed_since timestamptz,
  geom geometry(LineString, 4326),
  UNIQUE (u, v, k)
);
CREATE INDEX IF NOT EXISTS road_segments_geom_idx ON road_segments USING gist (geom);
CREATE INDEX IF NOT EXISTS road_segments_geog_idx ON road_segments USING gist ((geom::geography));

CREATE TABLE IF NOT EXISTS road_events (
  at timestamptz NOT NULL,
  segment_ids bigint[] NOT NULL,
  status text NOT NULL,            -- CLOSED | OPEN
  reason text,
  observation_id bigint
);
SELECT create_hypertable('road_events', 'at', if_not_exists => TRUE);

-- ---------- Sensors ----------
CREATE TABLE IF NOT EXISTS sensor_sites (
  site_id text PRIMARY KEY,
  name text,
  flood_stage_ft double precision,
  geom geometry(Point, 4326)
);
CREATE TABLE IF NOT EXISTS sensor_readings (
  site_id text NOT NULL,
  at timestamptz NOT NULL,
  stage_ft double precision,
  discharge_cfs double precision
);
SELECT create_hypertable('sensor_readings', 'at', if_not_exists => TRUE);

-- ---------- Observations / incidents / tasks ----------
CREATE TABLE IF NOT EXISTS incidents (
  id bigserial PRIMARY KEY,
  status text NOT NULL DEFAULT 'OPEN',   -- OPEN | RESOLVED
  type text,
  summary text,
  priority double precision DEFAULT 0,
  confidence double precision DEFAULT 0.5,
  geom geometry(Point, 4326),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS incidents_geom_idx ON incidents USING gist (geom);

CREATE TABLE IF NOT EXISTS observations (
  id bigserial,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  source_type text NOT NULL,       -- resident|shelter|ngo|volunteer|radio|ncdot|usgs|nhc
  source_ref text,
  location_text text,
  geom geometry(Geometry, 4326),
  category text,                   -- NEED|HAZARD|INFRASTRUCTURE|STATUS
  subtype text,
  confidence double precision,
  extracted jsonb,
  raw jsonb,
  incident_id bigint,
  PRIMARY KEY (id, observed_at)
);
SELECT create_hypertable('observations', 'observed_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS observations_geom_idx ON observations USING gist (geom);

CREATE TABLE IF NOT EXISTS incident_links (
  id bigserial PRIMARY KEY,
  observation_id bigint NOT NULL,
  incident_id bigint NOT NULL,
  decision text NOT NULL,          -- ATTACH | NEW
  reasoning text,
  llm_confidence double precision,
  at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id bigserial PRIMARY KEY,
  incident_id bigint,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  title text,
  description text,
  requirements jsonb NOT NULL DEFAULT '{}',
  urgency double precision,
  priority double precision,
  proposal_reasoning text,
  geom geometry(Point, 4326),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_geom_idx ON tasks USING gist (geom);

CREATE TABLE IF NOT EXISTS task_events (
  task_id bigint NOT NULL,
  at timestamptz NOT NULL,
  from_status text,
  to_status text,
  reason text
);
SELECT create_hypertable('task_events', 'at', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS task_proposals (
  id bigserial PRIMARY KEY,
  incident_id bigint,
  at timestamptz NOT NULL,
  proposal jsonb,
  accepted boolean,
  validator_notes text
);

-- ---------- Volunteers ----------
CREATE TABLE IF NOT EXISTS volunteers (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  skills text[] NOT NULL DEFAULT '{}',
  equipment text[] NOT NULL DEFAULT '{}',
  vehicle jsonb,                   -- {type, capacity_gal, high_clearance, seats}
  available boolean NOT NULL DEFAULT true,
  verify_safe boolean NOT NULL DEFAULT false,
  home geometry(Point, 4326),
  last_geom geometry(Point, 4326),
  last_seen timestamptz
);
CREATE INDEX IF NOT EXISTS volunteers_last_geom_idx ON volunteers USING gist (last_geom);

CREATE TABLE IF NOT EXISTS volunteer_locations (
  volunteer_id bigint NOT NULL,
  at timestamptz NOT NULL,
  geom geometry(Point, 4326)
);
SELECT create_hypertable('volunteer_locations', 'at', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS assignments (
  id bigserial PRIMARY KEY,
  task_id bigint NOT NULL,
  volunteer_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'OFFERED',  -- OFFERED|ACCEPTED|SUPERSEDED|RELEASED|DONE
  route geometry(LineString, 4326),
  route_nodes bigint[],
  eta_s double precision,
  reason text,
  superseded_by bigint,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS assignments_route_idx ON assignments USING gist (route);

CREATE TABLE IF NOT EXISTS evidence (
  id bigserial PRIMARY KEY,
  task_id bigint NOT NULL,
  volunteer_id bigint,
  photo_path text,
  text text,
  geom geometry(Point, 4326),
  submitted_at timestamptz NOT NULL,
  verdict text,                    -- VERIFIED | REJECTED
  verdict_reasoning text,
  details jsonb
);

-- Activity feed: every decision the system makes, for the dashboard.
CREATE TABLE IF NOT EXISTS activity (
  id bigserial,
  at timestamptz NOT NULL,
  kind text NOT NULL,
  message text,
  data jsonb,
  PRIMARY KEY (id, at)
);
SELECT create_hypertable('activity', 'at', if_not_exists => TRUE);
