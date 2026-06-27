// Persistence + types for Apple Health / Health Connect data, synced from
// the (future) native mobile build. This mirrors the lib/history.ts pattern:
// raw rows in Supabase, keyed by athlete_id, so agents can read multi-day
// trends instead of a single latest snapshot.
//
// No native sync client exists yet (see mobile/src/health for the
// device-side adapters) - this file is the server half of that pipeline:
// it just needs a batch of normalized samples and persists them.
import { getSupabase, isSupabaseConfigured } from "./supabase";

export type HealthSource = "apple_health" | "health_connect";

export type HealthMetric =
  | "steps"
  | "resting_heart_rate"
  | "hrv"
  | "sleep_minutes"
  | "weight_kg"
  | "active_energy_kcal"
  | "workout";

const VALID_SOURCES: HealthSource[] = ["apple_health", "health_connect"];
const VALID_METRICS: HealthMetric[] = [
  "steps",
  "resting_heart_rate",
  "hrv",
  "sleep_minutes",
  "weight_kg",
  "active_energy_kcal",
  "workout",
];

export function isValidHealthSource(value: unknown): value is HealthSource {
  return typeof value === "string" && (VALID_SOURCES as string[]).includes(value);
}

export function isValidHealthMetric(value: unknown): value is HealthMetric {
  return typeof value === "string" && (VALID_METRICS as string[]).includes(value);
}

// What the device adapter hands the sync endpoint - already normalized so
// the server doesn't need to know anything platform-specific.
export type HealthSample = {
  source: HealthSource;
  metric: HealthMetric;
  value: number;
  unit: string;
  recordedAt: string; // ISO timestamp of when the reading happened
  raw?: Record<string, unknown>; // metric-specific extras, e.g. workout type/distance
};

export type HealthSampleRow = {
  source: HealthSource;
  metric: HealthMetric;
  value: number;
  unit: string;
  recorded_at: string;
  raw: Record<string, unknown> | null;
};

// Upserts a batch of samples. Re-syncing an overlapping window (e.g. the
// mobile app re-sends "last 7 days" on every launch) is safe - the
// (athlete_id, source, metric, recorded_at) unique constraint means repeats
// just overwrite the same row instead of duplicating it.
export async function recordHealthSamples(
  athleteId: number,
  samples: HealthSample[]
): Promise<{ synced: number }> {
  if (!isSupabaseConfigured() || samples.length === 0) return { synced: 0 };

  const supabase = getSupabase();

  const rows = samples.map((s) => ({
    athlete_id: athleteId,
    source: s.source,
    metric: s.metric,
    value: s.value,
    unit: s.unit,
    recorded_at: s.recordedAt,
    raw: s.raw ?? null,
  }));

  const { error } = await supabase
    .from("health_samples")
    .upsert(rows, { onConflict: "athlete_id,source,metric,recorded_at" });

  if (error) {
    console.error("recordHealthSamples failed:", error.message);
    return { synced: 0 };
  }

  return { synced: rows.length };
}

// Oldest-first history for one metric - the shape agents will eventually
// want (e.g. recovery-signal pulling resting HR / HRV / sleep trend
// alongside training load). Not wired into any agent yet; this is the data
// layer landing first, agent wiring is a follow-up once real device data
// exists to test against.
export async function getHealthSamples(
  athleteId: number,
  metric: HealthMetric,
  sinceDays = 14
): Promise<HealthSampleRow[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);

  const { data, error } = await supabase
    .from("health_samples")
    .select("source, metric, value, unit, recorded_at, raw")
    .eq("athlete_id", athleteId)
    .eq("metric", metric)
    .gte("recorded_at", since.toISOString())
    .order("recorded_at", { ascending: false });

  if (error) {
    console.error("getHealthSamples failed:", error.message);
    return [];
  }

  return (data ?? []).slice().reverse(); // oldest first
}

// Most recent reading per metric - a quick "what do we know right now"
// snapshot, handy for a future dashboard summary or as agent context
// without pulling full history for every metric.
export async function getLatestHealthSamples(
  athleteId: number
): Promise<Partial<Record<HealthMetric, HealthSampleRow>>> {
  if (!isSupabaseConfigured()) return {};

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("health_samples")
    .select("source, metric, value, unit, recorded_at, raw")
    .eq("athlete_id", athleteId)
    .order("recorded_at", { ascending: false })
    .limit(500); // enough rows to almost certainly cover one of each metric without scanning the whole table

  if (error) {
    console.error("getLatestHealthSamples failed:", error.message);
    return {};
  }

  const latest: Partial<Record<HealthMetric, HealthSampleRow>> = {};
  for (const row of data ?? []) {
    if (!latest[row.metric as HealthMetric]) {
      latest[row.metric as HealthMetric] = row as HealthSampleRow;
    }
  }
  return latest;
}
