import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/session";
import { generateAcwrRetrospective } from "@/lib/agents";
import { getAcwrHistory } from "@/lib/history";

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
      { error: "Reconnect Strava once to enable training-load history (this needs your athlete ID, which older sessions don't have yet)." },
      { status: 400 }
    );
  }

  try {
    const history = await getAcwrHistory(session.athleteId);
    const text = await generateAcwrRetrospective(session.raceConfig, history);
    const acwrRetrospective = { text, generatedAt: new Date().toISOString() };
    setSession({ ...session, acwrRetrospective });
    return NextResponse.json({ acwrRetrospective });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to generate a response" }, { status: 500 });
  }
}
