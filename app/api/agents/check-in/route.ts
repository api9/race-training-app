import { NextRequest, NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/session";
import { generateCheckInResponse } from "@/lib/agents";

const VALID = ["DONE", "TIRED", "TIME", "MOTIVATION", "INJURY"] as const;

export async function POST(req: NextRequest) {
  const session = getSession();
  if (!session.raceConfig) {
    return NextResponse.json({ error: "No race details set up yet" }, { status: 400 });
  }
  const body = await req.json();
  const status = body?.status;
  if (!VALID.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    const text = await generateCheckInResponse(session.raceConfig, status);
    const lastCheckIn = { text, generatedAt: new Date().toISOString(), status };
    setSession({ ...session, lastCheckIn });
    return NextResponse.json({ lastCheckIn });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to generate response" }, { status: 500 });
  }
}
