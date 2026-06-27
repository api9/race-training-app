// Minimal MVP "session" - JSON encoded into a single cookie.
// Good enough for a single browser/demo. Before real multi-device use,
// swap this for a database-backed session (e.g. Supabase + an httpOnly session id).
import { cookies } from "next/headers";
import type { WeekTotals, RecoverySignal, AthletePortraitStats, StrengthExercise } from "./agents";

export type RaceConfig = {
  raceName: string;
  raceDate: string;
  distance: string;
  terrain: "flat" | "rolling" | "hilly" | "mountainous" | "trail";
  // Expected race-day conditions - no weather API wired up yet, so this is a
  // manual best-guess input the runner can update closer to race day. Used to
  // steer fueling/hydration guidance (heat and humidity change sodium/fluid
  // needs a lot more than terrain does).
  expectedConditions?: "mild" | "hot" | "humid" | "cold" | "variable";
  goalTime: string;
  startDate: string;
};

export type AgentOutput = {
  text: string;
  generatedAt: string;
};

export type SessionData = {
  stravaAccessToken?: string;
  stravaRefreshToken?: string;
  stravaExpiresAt?: number;
  athleteName?: string;
  athleteId?: number;
  raceConfig?: RaceConfig;
  weeklyPlan?: AgentOutput;
  lastCheckIn?: AgentOutput & { status: string };
  midweekReplan?: AgentOutput;
  workoutAnalysis?: AgentOutput;
  recoverySignal?: AgentOutput & { signal: RecoverySignal };
  strengthSession?: AgentOutput & { exercises: StrengthExercise[] };
  nutritionGuidance?: AgentOutput;
  racePrediction?: AgentOutput & {
    conservativeSec: number;
    expectedSec: number;
    stretchSec: number;
    goalSec: number | null;
  };
  retrospective?: AgentOutput;
  lifeEventReplan?: AgentOutput & { note: string };
  acwrRetrospective?: AgentOutput;
  weekOverWeek?: AgentOutput & { thisWeek: WeekTotals; lastWeek: WeekTotals };
  athletePortrait?: AgentOutput & { stats: AthletePortraitStats | null };
  injuryWatch?: AgentOutput & { hasPattern: boolean; flaggedBodyPart: string | null };
};

const COOKIE_NAME = "race_training_session";

export function getSession(): SessionData {
  const raw = cookies().get(COOKIE_NAME)?.value;
  if (!raw) return {};
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
  } catch {
    return {};
  }
}

export function setSession(data: SessionData) {
  const encoded = Buffer.from(JSON.stringify(data), "utf-8").toString("base64");
  cookies().set(COOKIE_NAME, encoded, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSession() {
  cookies().delete(COOKIE_NAME);
}
