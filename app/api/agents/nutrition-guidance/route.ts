import { NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/session";
import { generateNutritionGuidance } from "@/lib/agents";

export async function POST() {
  const session = getSession();
  if (!session.raceConfig) {
    return NextResponse.json({ error: "No race details set up yet" }, { status: 400 });
  }

  try {
    const text = await generateNutritionGuidance(session.raceConfig);
    const nutritionGuidance = { text, generatedAt: new Date().toISOString() };
    setSession({ ...session, nutritionGuidance });
    return NextResponse.json({ nutritionGuidance });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to generate nutrition guidance" }, { status: 500 });
  }
}
