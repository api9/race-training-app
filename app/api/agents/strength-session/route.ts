import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/session";
import { generateStrengthSession, pickStrengthExercises } from "@/lib/agents";

export async function POST() {
  const session = getSession();
  if (!session.raceConfig) {
    return NextResponse.json({ error: "No race details set up yet" }, { status: 400 });
  }

  try {
    const exercises = pickStrengthExercises(session.raceConfig);
    const text = await generateStrengthSession(session.raceConfig, exercises);
    const strengthSession = { text, exercises, generatedAt: new Date().toISOString() };
    setSession({ ...session, strengthSession });
    return NextResponse.json({ strengthSession });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to generate strength session" }, { status: 500 });
  }
}
