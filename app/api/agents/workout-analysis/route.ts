import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/session";
import { getActivities, refreshToken } from "@/lib/strava";
import { generateWorkoutAnalysis } from "@/lib/agents";

export async function POST() {
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
    const text = await generateWorkoutAnalysis(session.raceConfig, activities);
    const workoutAnalysis = { text, generatedAt: new Date().toISOString() };
    setSession({ ...session, workoutAnalysis });
    return NextResponse.json({ workoutAnalysis });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to analyze workout" }, { status: 500 });
  }
}
