-- Run this in the Supabase dashboard: Project -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run (uses IF NOT EXISTS / ON CONFLICT-friendly constraints).

-- One row per Strava athlete who's connected the app. Everything else
-- below is scoped to athlete_id so multiple people can use the app without
-- overwriting each other's data (the single-cookie session couldn't do this).
create table if not exists athletes (
  athlete_id   bigint primary key,        -- Strava's numeric athlete id (tokenData.athlete.id)
  name         text,
  created_at   timestamptz not null default now()
);

-- Raw activity history, synced from Strava. This is what makes
-- week-over-week comparisons and multi-week trend features possible -
-- the old cookie session only ever held "whatever Strava returned just now."
create table if not exists activities (
  id                  bigserial primary key,
  athlete_id          bigint not null references athletes(athlete_id) on delete cascade,
  strava_activity_id  bigint not null,
  name                text,
  distance_m          numeric not null,        -- meters, matches Strava's raw units
  moving_time_s        integer not null,
  average_speed_mps    numeric,
  start_date           timestamptz not null,
  type                 text,                    -- e.g. "Run" - not always present from Strava, nullable
  inserted_at          timestamptz not null default now(),
  unique (athlete_id, strava_activity_id)
);

create index if not exists activities_athlete_start_idx
  on activities (athlete_id, start_date desc);

-- A computed-metric snapshot every time ACWR (or similar) gets calculated,
-- so retrospective/trend features (#5, #4, #3 on the roadmap) have a real
-- history to look back over instead of recomputing from scratch each time.
create table if not exists acwr_snapshots (
  id                bigserial primary key,
  athlete_id        bigint not null references athletes(athlete_id) on delete cascade,
  acute_km          numeric not null,
  chronic_weekly_km numeric not null,
  ratio             numeric,                  -- null when there's not enough history yet
  source            text not null default 'life_event', -- where this snapshot came from, e.g. 'life_event', 'retrospective'
  note              text,                     -- optional free-text context (e.g. the life-event note)
  computed_at       timestamptz not null default now()
);

create index if not exists acwr_snapshots_athlete_idx
  on acwr_snapshots (athlete_id, computed_at desc);

-- Self-reported "something feels off" entries - the leading indicator that
-- pace/ACWR data can't see. A pattern across these (same body part flagged
-- repeatedly, or severity climbing) is what the injury-watch agent reads.
create table if not exists niggle_logs (
  id                  bigserial primary key,
  athlete_id          bigint not null references athletes(athlete_id) on delete cascade,
  body_part           text not null,        -- 'calf' | 'knee' | 'it_band' | 'shin' | 'hip' | 'foot' | 'other'
  severity            smallint not null,    -- 1 mild / 2 noticeable / 3 concerning
  note                text,
  strava_activity_id  bigint,                -- nullable: not every niggle ties to a specific logged run
  logged_at           timestamptz not null default now()
);

create index if not exists niggle_logs_athlete_idx
  on niggle_logs (athlete_id, logged_at desc);

-- Raw samples synced from Apple Health / Health Connect on the (future)
-- native mobile build. One row per metric reading rather than one row per
-- device sync batch, so agents can query a single metric's history cleanly
-- (e.g. "resting HR for the last 14 days") regardless of how the data
-- arrived. The unique constraint makes re-syncing an overlapping window
-- idempotent - the mobile app can always resync "last 7 days" without
-- worrying about double-counting.
create table if not exists health_samples (
  id           bigserial primary key,
  athlete_id   bigint not null references athletes(athlete_id) on delete cascade,
  source       text not null,        -- 'apple_health' | 'health_connect'
  metric       text not null,        -- 'steps' | 'resting_heart_rate' | 'hrv' | 'sleep_minutes' | 'weight_kg' | 'active_energy_kcal' | 'workout'
  value        numeric not null,
  unit         text not null,
  recorded_at  timestamptz not null, -- when the reading actually happened, not when it was synced
  raw          jsonb,                 -- metric-specific extras (e.g. workout type/distance) the normalized columns don't capture
  inserted_at  timestamptz not null default now(),
  unique (athlete_id, source, metric, recorded_at)
);

create index if not exists health_samples_athlete_metric_idx
  on health_samples (athlete_id, metric, recorded_at desc);
