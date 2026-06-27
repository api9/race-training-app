import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/session";
import { getActivities, refreshToken } from "@/lib/strava";
import { generateChatResponse, type ChatMessage } from "@/lib/agents";

export async function POST(req: Request) {
  let messages: ChatMessage[] = [];
  try {
    const body = await req.json();
    messages = Array.isArray(body?.messages) ? body.messages : [];
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (messages.length === 0) {
    return NextResponse.json({ error: "No message provided" }, { status: 400 });
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
    // Surface every agent output already cached on this dashboard so chat
    // answers reuse what's been generated instead of starting from scratch.
    const insights = {
      weeklyPlan: session.weeklyPlan?.text,
      midweekReplan: session.midweekReplan?.text,
      workoutAnalysis: session.workoutAnalysis?.text,
      recoverySignal: session.recoverySignal?.text,
      strengthSession: session.strengthSession?.text,
      nutritionGuidance: session.nutritionGuidance?.text,
      racePrediction: session.racePrediction?.text,
      retrospective: session.retrospective?.text,
      lastCheckIn: session.lastCheckIn?.text,
      lifeEventReplan: session.lifeEventReplan?.text,
      acwrRetrospective: session.acwrRetrospective?.text,
      weekOverWeek: session.weekOverWeek?.text,
      athletePortrait: session.athletePortrait?.text,
      injuryWatch: session.injuryWatch?.text,
    };
    const reply = await generateChatResponse(session.raceConfig, activities, insights, messages);
    return NextResponse.json({ reply });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to generate a response" }, { status: 500 });
  }
}
