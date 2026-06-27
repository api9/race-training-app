import { NextRequest, NextResponse } from "next/server";
import { getSession, setSession, RaceConfig } from "@/lib/session";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RaceConfig;
  const session = getSession();
  setSession({ ...session, raceConfig: body });
  return NextResponse.json({ ok: true });
}
