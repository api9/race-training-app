// Persistence helpers for training history. Anything wanting multi-week
// memory (week-over-week deltas, retrospective ACWR narratives, the athlete
// "character portrait") reads from here instead of the session cookie, which
// only ever holds the latest snapshot per agent.
//
// These are no-ops (they just skip silently) until SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are set in .env.local - that way the rest of the
// app keeps working before the user has finished Supabase setup.
import { getSupabase, isSupabaseConfigured } from "./supabase";
import type { Activity } from "./strava";

export async function persistActivities(athleteId: number, athleteName: string | undefined, activities: Activity[]): Promise<void> {
  if (!isSupabaseConfigured() || activities.length === 0) return;

  const supabase = getSupabase();

  // Make sure the athlete row exists before inserting activities that
  // reference it via foreign key.
  await supabase
    .from("athletes")
    .upsert({ athlete_id: athleteId, name: athleteName ?? null }, { onConflict: "athlete_id" });

  const rows = activities.map((a) => ({
    athlete_id: athleteId,
    strava_activity_id: a.id,
    name: a.name,
    distance_m: a.distance,
    moving_time_s: a.moving_time,
    average_speed_mps: a.average_speed,
    start_date: a.start_date,
    type: a.type ?? null,
  }));

  const { error } = await supabase
    .from("activities")
    .upsert(rows, { onConflict: "athlete_id,strava_activity_id" });

  if (error) {
    // Don't let history persistence failures break the user-facing agent
    // response - log and move on.
    console.error("persistActivities failed:", error.message);
  }
}

export type ActivityHistoryRow = {
  distance_m: number;
  moving_time_s: number;
  average_speed_mps: number | null;
  start_date: string;
  type: string | null;
  name: string | null;
};

// Persisted activity history for an athlete (oldest first) - this is the
// long-term picture the athlete "character portrait" needs. Strava's own
// /athlete/activities endpoint only returns the most recent ~30 by default,
// which isn't enough to spot multi-week patterns like preferred run days or
// a real volume trend; this table accumulates everything synced so far.
export async function getActivityHistory(athleteId: number, limit = 500): Promise<ActivityHistoryRow[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("activities")
    .select("distance_m, moving_time_s, average_speed_mps, start_date, type, name")
    .eq("athlete_id", athleteId)
    .order("start_date", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getActivityHistory failed:", error.message);
    return [];
  }

  return (data ?? []).slice().reverse(); // oldest first
}

export type AcwrSnapshotRow = {
  acute_km: number;
  chronic_weekly_km: number;
  ratio: number | null;
  source: string;
  note: string | null;
  computed_at: string;
};

// Recent ACWR history for an athlete, oldest first - this is what makes a
// trend narrative possible instead of just describing a single point-in-time
// number. Returns an empty array (not an error) if Supabase isn't configured
// or there's no history yet, so callers can treat "no data" as a normal case.
export async function getAcwrHistory(athleteId: number, limit = 60): Promise<AcwrSnapshotRow[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("acwr_snapshots")
    .select("acute_km, chronic_weekly_km, ratio, source, note, computed_at")
    .eq("athlete_id", athleteId)
    .order("computed_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getAcwrHistory failed:", error.message);
    return [];
  }

  return (data ?? []).slice().reverse(); // oldest first
}

export async function recordAcwrSnapshot(
  athleteId: number,
  acuteKm: number,
  chronicWeeklyKm: number,
  ratio: number | null,
  source: string,
  note?: string
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = getSupabase();

  // ACWR is a daily-resolution metric - re-triggering it (e.g. clicking "Life
  // happened?" more than once today) shouldn't add a second, near-identical
  // row. That just pads trend history with noise that looks like real data
  // points to anything reading it back (including the retrospective agent).
  // Collapse same-day calls into one row instead: find today's snapshot for
  // this athlete, if any, and update it rather than inserting a duplicate.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const { data: existing, error: lookupError } = await supabase
    .from("acwr_snapshots")
    .select("id, note")
    .eq("athlete_id", athleteId)
    .gte("computed_at", startOfDay.toISOString())
    .lt("computed_at", endOfDay.toISOString())
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    console.error("recordAcwrSnapshot lookup failed:", lookupError.message);
  }

  // If there's already a note today and this call brings a different one
  // (e.g. two separate life events in one day), keep both instead of
  // silently dropping the earlier context.
  const mergedNote =
    existing?.note && note && existing.note !== note
      ? `${existing.note}; ${note}`
      : note ?? existing?.note ?? null;

  const payload = {
    athlete_id: athleteId,
    acute_km: acuteKm,
    chronic_weekly_km: chronicWeeklyKm,
    ratio,
    source,
    note: mergedNote,
    computed_at: new Date().toISOString(),
  };

  const { error } = existing
    ? await supabase.from("acwr_snapshots").update(payload).eq("id", existing.id)
    : await supabase.from("acwr_snapshots").insert(payload);

  if (error) {
    console.error("recordAcwrSnapshot failed:", error.message);
  }
}

export type NiggleLogRow = {
  body_part: string;
  severity: number;
  note: string | null;
  strava_activity_id: number | null;
  logged_at: string;
};

// Unlike recordAcwrSnapshot, this never dedups same-day entries - two niggle
// reports in one day (e.g. logged after a run, then worse again that
// evening) are real signal, not noise, and the injury-watch agent's
// frequency check depends on seeing every entry.
export async function recordNiggle(
  athleteId: number,
  bodyPart: string,
  severity: number,
  note?: string,
  activityId?: number
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = getSupabase();
  const { error } = await supabase.from("niggle_logs").insert({
    athlete_id: athleteId,
    body_part: bodyPart,
    severity,
    note: note ?? null,
    strava_activity_id: activityId ?? null,
    logged_at: new Date().toISOString(),
  });

  if (error) {
    console.error("recordNiggle failed:", error.message);
  }
}

// Rolling window of niggle reports for the pattern check - defaults to 21
// days, a bit wider than the 14-day frequency threshold so the agent can see
// "is this new" vs. "this has been going on a while" context too.
export async function getNiggleHistory(athleteId: number, sinceDays = 21): Promise<NiggleLogRow[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);

  const { data, error } = await supabase
    .from("niggle_logs")
    .select("body_part, severity, note, strava_activity_id, logged_at")
    .eq("athlete_id", athleteId)
    .gte("logged_at", since.toISOString())
    .order("logged_at", { ascending: false });

  if (error) {
    console.error("getNiggleHistory failed:", error.message);
    return [];
  }

  return (data ?? []).slice().reverse(); // oldest first
}
