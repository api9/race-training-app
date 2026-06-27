import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/session";
import { generateAthletePortrait } from "@/lib/agents";
import { getActivityHistory } from "@/lib/history";

export async function POST() {
  const session = getSession();
  if (!session.stravaAccessToken) {
    return NextResponse.json({ error: "Not connected to Strava" }, { status: 401 });
  }
  if (!session.raceConfig) {
    return NextResponse.json({ error: "No race details set up yet" }, { status: 400 });
  }
  if (!session.athleteId) {
    return NextResponse.json(
      { error: "Reconnect Strava once to enable the running-personality portrait (this needs your athlete ID, which older sessions don't have yet)." },
      { status: 400 }
    );
  }

  try {
    const activityHistory = await getActivityHistory(session.athleteId);
    const result = await generateAthletePortrait(session.raceConfig, activityHistory);
    const athletePortrait = { ...result, generatedAt: new Date().toISOString() };
    setSession({ ...session, athletePortrait });
    return NextResponse.json({ athletePortrait });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to generate a response" }, { status: 500 });
  }
}
