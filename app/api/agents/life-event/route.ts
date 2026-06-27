import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/session";
import { getActivities, refreshToken } from "@/lib/strava";
import { generateLifeEventReplan, calcAcwr } from "@/lib/agents";
import { persistActivities, recordAcwrSnapshot } from "@/lib/history";

export async function POST(req: Request) {
  let note = "";
  try {
    const body = await req.json();
    note = typeof body?.note === "string" ? body.note.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!note) {
    return NextResponse.json({ error: "Tell me what happened first" }, { status: 400 });
  }

  const session = getSession();
  if (!session.stravaAccessToken) {
    return NextResponse.json({ error: "Not connected to Strava" }, { status: 401 });
  }
  if (!session.raceConfig) {
    return NextResponse.json({ error: "No race details set up yet" }, { status: 400 });
  }

  let accessToken = session.stravaAccessToken;
  if (session.stravaExpiresAt && Date.now() / 1000 > session.stravaExpiresAt - 60) {
    try {
      const refreshed = await refreshToken(session.stravaRefreshToken!);
      accessToken = refreshed.access_token;
      setSession({
        ...session,
        stravaAccessToken: refreshed.access_token,
        stravaRefreshToken: refreshed.refresh_token,
        stravaExpiresAt: refreshed.expires_at,
      });
    } catch {
      return NextResponse.json({ error: "Strava token refresh failed" }, { status: 401 });
    }
  }

  try {
    const activities = await getActivities(accessToken);
    const text = await generateLifeEventReplan(session.raceConfig, activities, note);
    const lifeEventReplan = { text, note, generatedAt: new Date().toISOString() };
    setSession({ ...session, lifeEventReplan });

    // Best-effort persistence for future history-dependent features. Skips
    // silently if Supabase isn't configured yet or the athlete id wasn't
    // captured (e.g. they connected Strava before this field existed -
    // reconnecting picks it up).
    if (session.athleteId) {
      const { acuteKm, chronicWeeklyKm, ratio } = calcAcwr(activities);
      await persistActivities(session.athleteId, session.athleteName, activities);
      await recordAcwrSnapshot(session.athleteId, acuteKm, chronicWeeklyKm, ratio, "life_event", note);
    }

    return NextResponse.json({ lifeEventReplan });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to generate a response" }, { status: 500 });
  }
}
