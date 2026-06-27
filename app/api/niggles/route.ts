import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/session";
import { generateInjuryWatch } from "@/lib/agents";
import { recordNiggle, getNiggleHistory } from "@/lib/history";

const VALID_BODY_PARTS = ["calf", "knee", "it_band", "shin", "hip", "foot", "other"];

// Logging a niggle is deliberately cheap - no LLM call here. The
// pattern-detection agent only runs when there's actually something to
// detect (handled inside generateInjuryWatch's own thresholds), so most
// taps just persist a row and return immediately.
export async function POST(req: Request) {
  let bodyPart = "";
  let severity = 0;
  let note: string | undefined;

  try {
    const body = await req.json();
    bodyPart = typeof body?.bodyPart === "string" ? body.bodyPart : "";
    severity = Number(body?.severity);
    note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!VALID_BODY_PARTS.includes(bodyPart)) {
    return NextResponse.json({ error: "Unrecognized body part" }, { status: 400 });
  }
  if (![1, 2, 3].includes(severity)) {
    return NextResponse.json({ error: "Severity must be 1, 2, or 3" }, { status: 400 });
  }

  const session = getSession();
  if (!session.raceConfig) {
    return NextResponse.json({ error: "No race details set up yet" }, { status: 400 });
  }
  if (!session.athleteId) {
    return NextResponse.json(
      { error: "Reconnect Strava once to enable the niggle log (this needs your athlete ID, which older sessions don't have yet)." },
      { status: 400 }
    );
  }

  try {
    await recordNiggle(session.athleteId, bodyPart, severity, note);
    const history = await getNiggleHistory(session.athleteId);
    const result = await generateInjuryWatch(session.raceConfig, history);
    const injuryWatch = { ...result, generatedAt: new Date().toISOString() };
    setSession({ ...session, injuryWatch });
    return NextResponse.json({ injuryWatch });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to log that" }, { status: 500 });
  }
}

// Recent entries for a small "last couple weeks" strip on the dashboard -
// just the raw log, no agent call.
export async function GET() {
  const session = getSession();
  if (!session.athleteId) {
    return NextResponse.json({ entries: [] });
  }
  const history = await getNiggleHistory(session.athleteId, 14);
  return NextResponse.json({ entries: history });
}
