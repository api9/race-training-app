import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  recordHealthSamples,
  getHealthSamples,
  isValidHealthMetric,
  isValidHealthSource,
  type HealthSample,
} from "@/lib/health";

// Two ways to identify which athlete this sync belongs to:
//  - browser/Capacitor clients sharing the existing httpOnly cookie session
//    (same as every other API route in this app)
//  - a bare native app (React Native/Expo) with no cookie at all, which
//    instead sends athleteId directly in the body
// Either way we confirm the athlete row already exists - this app's only
// "auth" today is "you've connected Strava once" via the web flow, so a
// native client still needs that to have happened first. A proper per-device
// token is a follow-up before this ships beyond personal/MVP use.
async function resolveAthleteId(bodyAthleteId: unknown): Promise<number | null> {
  const session = getSession();
  if (session.athleteId) return session.athleteId;

  const candidate = Number(bodyAthleteId);
  if (!Number.isFinite(candidate) || candidate <= 0) return null;
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("athletes")
    .select("athlete_id")
    .eq("athlete_id", candidate)
    .maybeSingle();

  if (error || !data) return null;
  return candidate;
}

export async function POST(req: Request) {
  let athleteIdInput: unknown;
  let rawSamples: unknown;

  try {
    const body = await req.json();
    athleteIdInput = body?.athleteId;
    rawSamples = body?.samples;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!Array.isArray(rawSamples) || rawSamples.length === 0) {
    return NextResponse.json({ error: "No samples provided" }, { status: 400 });
  }
  if (rawSamples.length > 5000) {
    return NextResponse.json({ error: "Too many samples in one batch (max 5000)" }, { status: 400 });
  }

  const athleteId = await resolveAthleteId(athleteIdInput);
  if (!athleteId) {
    return NextResponse.json(
      { error: "Unknown athlete - connect Strava once via the web app before syncing health data." },
      { status: 401 }
    );
  }

  const samples: HealthSample[] = [];
  let skipped = 0;

  for (const item of rawSamples) {
    const source = (item as any)?.source;
    const metric = (item as any)?.metric;
    const value = Number((item as any)?.value);
    const unit = (item as any)?.unit;
    const recordedAt = (item as any)?.recordedAt;
    const raw = (item as any)?.raw;

    const validRecordedAt = typeof recordedAt === "string" && !Number.isNaN(new Date(recordedAt).getTime());

    if (
      isValidHealthSource(source) &&
      isValidHealthMetric(metric) &&
      Number.isFinite(value) &&
      typeof unit === "string" &&
      unit.length > 0 &&
      validRecordedAt
    ) {
      samples.push({
        source,
        metric,
        value,
        unit,
        recordedAt,
        raw: raw && typeof raw === "object" ? raw : undefined,
      });
    } else {
      skipped++;
    }
  }

  if (samples.length === 0) {
    return NextResponse.json({ error: "No valid samples in batch" }, { status: 400 });
  }

  try {
    const { synced } = await recordHealthSamples(athleteId, samples);
    return NextResponse.json({ synced, skipped });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to sync health data" }, { status: 500 });
  }
}

// Mainly for debugging the pipeline before any real UI reads this data -
// ?metric=resting_heart_rate&days=14
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const metricParam = searchParams.get("metric");
  const days = Number(searchParams.get("days") ?? "14");

  if (!isValidHealthMetric(metricParam)) {
    return NextResponse.json({ error: "metric query param is required and must be a recognized metric" }, { status: 400 });
  }

  const session = getSession();
  if (!session.athleteId) {
    return NextResponse.json({ samples: [] });
  }

  const samples = await getHealthSamples(session.athleteId, metricParam, Number.isFinite(days) ? days : 14);
  return NextResponse.json({ samples });
}
