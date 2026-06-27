// Agent functions — ported from the race-training-agents Cowork plugin's
// prompt templates, adapted to call the Claude API directly so they work
// outside Cowork. Requires ANTHROPIC_API_KEY in .env.local.

import type { RaceConfig } from "./session";
import type { Activity } from "./strava";
import type { AcwrSnapshotRow, ActivityHistoryRow, NiggleLogRow } from "./history";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

async function callClaude(prompt: string, maxTokens = 800): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set in .env.local — get one at console.anthropic.com"
    );
  }
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? "(no response)";
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

async function callClaudeMessages(
  system: string,
  messages: ChatMessage[],
  maxTokens = 600
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set in .env.local — get one at console.anthropic.com"
    );
  }
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? "(no response)";
}

function weeksUntil(dateStr: string): number {
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (7 * 24 * 60 * 60 * 1000)));
}

// Rough training-phase estimate from % elapsed between start date and race date.
function trainingPhase(startDate: string, raceDate: string): "base" | "build" | "peak" | "taper" {
  const start = new Date(startDate).getTime();
  const race = new Date(raceDate).getTime();
  const now = Date.now();
  const total = race - start;
  if (total <= 0) return "taper";
  const pct = (now - start) / total;
  if (pct < 0.4) return "base";
  if (pct < 0.75) return "build";
  if (pct < 0.92) return "peak";
  return "taper";
}

function recentRunsSummary(activities: Activity[], n = 10): string {
  return (
    activities
      .slice(0, n)
      .map((a) => `- ${a.name}: ${(a.distance / 1000).toFixed(1)}km, ${Math.round(a.moving_time / 60)}min`)
      .join("\n") || "(no recent activity found)"
  );
}

// Agent 1 (ported): weekly training plan, based on the runner's race
// config and recent Strava activity.
export async function generateWeeklyPlan(
  raceConfig: RaceConfig,
  recentActivities: Activity[]
): Promise<string> {
  const weeksLeft = weeksUntil(raceConfig.raceDate);
  const recentSummary = recentRunsSummary(recentActivities);

  const prompt = `You are a running coach. Write this week's training plan for a runner.

Race: ${raceConfig.raceName} on ${raceConfig.raceDate} (${raceConfig.distance}, ${raceConfig.terrain} terrain)
Goal time: ${raceConfig.goalTime}
Weeks remaining until race: ${weeksLeft}

Recent runs (most recent first):
${recentSummary}

Write a concise week of training: easy runs, one tempo/hill session, one long run, a rest day, and one short coaching note based on the recent runs above. If the course is hilly, give effort-based targets instead of flat pace targets. Keep it under 200 words, plain text, no markdown headers.`;

  return callClaude(prompt);
}

// Agent 7 (ported, simplified): daily check-in / motivation nudge.
// The original Cowork agent parses email replies (DONE/TIRED/TIME/
// MOTIVATION/INJURY) — here the runner picks the same option via an
// in-app button rather than an email reply.
export async function generateCheckInResponse(
  raceConfig: RaceConfig,
  status: "DONE" | "TIRED" | "TIME" | "MOTIVATION" | "INJURY"
): Promise<string> {
  const prompt = `You are a supportive running coach. A runner training for ${raceConfig.raceName} (${raceConfig.distance}, goal ${raceConfig.goalTime}) just reported their status for today as: ${status}.

DONE = completed today's session, just acknowledge briefly.
TIRED or MOTIVATION = a fatigue or motivation dip — be encouraging, suggest keeping tomorrow light.
TIME = a schedule conflict — reassure them it's fine, no fitness impact.
INJURY = flag this seriously — recommend rest/reduced intensity and suggest seeing a professional if pain persists.

Write a short (2-3 sentence) coach response, warm and direct, no markdown.`;

  return callClaude(prompt);
}

// Agent 1b (ported): mid-week re-evaluation of the current plan against
// what's actually been logged so far this week.
export async function generateMidweekReplan(
  raceConfig: RaceConfig,
  weeklyPlanText: string | undefined,
  recentActivities: Activity[]
): Promise<string> {
  const weekSoFar = recentRunsSummary(
    recentActivities.filter(
      (a) => Date.now() - new Date(a.start_date).getTime() < 4 * 24 * 60 * 60 * 1000
    ),
    10
  );

  const prompt = `You are a running coach checking in mid-week. Race: ${raceConfig.raceName} on ${raceConfig.raceDate} (${raceConfig.distance}, ${raceConfig.terrain}).

This week's plan was:
${weeklyPlanText || "(no plan was generated this week)"}

What's actually been logged so far this week:
${weekSoFar}

Classify the situation into one of:
A: On track, all sessions done or on pace - say so briefly, no change needed.
B: One missed easy session - reassure, no major change.
C: Missed a key session (tempo/hill) - suggest moving it to a free day this week.
D: Behind on volume and looking fatigued - recommend trimming the upcoming long run.
E: Signs of pain/injury mentioned in run names/notes - recommend rest and flag clearly.

State which scenario applies and the adjusted plan for the rest of the week (if any). Keep it under 150 words, plain text, no markdown.`;

  return callClaude(prompt, 500);
}

// Agent 2 (ported): analyze the most recent run against recent runs of the
// same type, with an estimated recovery signal.
export async function generateWorkoutAnalysis(
  raceConfig: RaceConfig,
  recentActivities: Activity[]
): Promise<string> {
  const latest = recentActivities[0];
  if (!latest) {
    return "No recent run found to analyze. Log a run on Strava, then try again.";
  }
  const comparable = recentActivities
    .slice(1, 6)
    .map((a) => `- ${a.name}: ${(a.distance / 1000).toFixed(1)}km, ${Math.round(a.moving_time / 60)}min, avg ${(a.average_speed).toFixed(2)}m/s`)
    .join("\n");

  const prompt = `You are a running coach analyzing a single workout for a runner training for ${raceConfig.raceName}.

Most recent run: ${latest.name}, ${(latest.distance / 1000).toFixed(1)}km, ${Math.round(latest.moving_time / 60)}min, avg speed ${(latest.average_speed).toFixed(2)}m/s.

Previous runs for comparison (most recent first):
${comparable || "(no prior runs to compare against)"}

Heart rate and cadence data aren't available from this data source, so do not invent specific numbers for them — acknowledge that and focus the analysis on pace and distance trends versus the comparison runs.

Assign a recovery signal: Green (recovered well, normal next session), Yellow (some fatigue, consider an easier next session), or Red (clear fatigue/strain signal, recommend extra rest) — base this only on pace/distance trend, not invented biometrics.

Write a short analysis (under 150 words, plain text, no markdown) ending with "Recovery signal: [Green/Yellow/Red] — [one-line reason]".`;

  return callClaude(prompt, 500);
}

export type RecoverySignal = "green" | "yellow" | "red";

export type RecoverySignalResult = {
  text: string;
  signal: RecoverySignal;
};

// Deterministic readiness classifier (no LLM involved) based on training
// load over the last 5 days. This used to live entirely inside the LLM's
// prose ("Assign Green/Yellow/Red...") with no code-side equivalent, which
// meant there was nothing solid to render as a gauge. Heuristic: look at how
// much volume landed in the last 3 days vs. the 2 days before that, and how
// many of the last 3 days had a run at all — a short, dense, back-to-back
// stretch is the fatigue pattern the original prompt asked the LLM to spot.
function classifyReadiness(recentActivities: Activity[]): RecoverySignal {
  const now = Date.now();
  const dayOffset = (a: Activity) => Math.floor((now - new Date(a.start_date).getTime()) / (24 * 60 * 60 * 1000));
  const last5 = recentActivities.filter((a) => {
    const d = dayOffset(a);
    return d >= 0 && d < 5;
  });

  const kmByDay: Record<number, number> = {};
  for (const a of last5) {
    const d = dayOffset(a);
    kmByDay[d] = (kmByDay[d] ?? 0) + a.distance / 1000;
  }
  const runDaysLast3 = [0, 1, 2].filter((d) => (kmByDay[d] ?? 0) > 0).length;
  const kmLast3 = [0, 1, 2].reduce((sum, d) => sum + (kmByDay[d] ?? 0), 0);
  const kmDays3to5 = [3, 4].reduce((sum, d) => sum + (kmByDay[d] ?? 0), 0);

  if (runDaysLast3 >= 3 && kmLast3 > 15 && kmLast3 > kmDays3to5 * 1.3) return "red";
  if (runDaysLast3 >= 2 && kmLast3 > 10) return "yellow";
  return "green";
}

// Agent 3 (ported): daily readiness/recovery check based on recent training
// load. The signal is now computed deterministically in code first (so it
// can drive a real gauge), and Claude is only asked to explain it.
export async function generateRecoverySignal(
  raceConfig: RaceConfig,
  recentActivities: Activity[]
): Promise<RecoverySignalResult> {
  const last5days = recentActivities.filter(
    (a) => Date.now() - new Date(a.start_date).getTime() < 5 * 24 * 60 * 60 * 1000
  );
  const summary = recentRunsSummary(last5days, 5);
  const signal = classifyReadiness(recentActivities);
  const signalLabel = { green: "Green", yellow: "Yellow", red: "Red" }[signal];

  const prompt = `You are a running coach assessing a runner's readiness for today, training for ${raceConfig.raceName}.

Last 5 days of activity:
${summary}

The readiness signal has already been computed as ${signalLabel} based on training-load pattern (run frequency and volume over the last 3 days vs. the 2 before that) — use this exact signal, don't assign a different one. There's no sleep/HRV data available, so don't invent any.

Briefly explain why this signal makes sense given the activity above, and invite the runner to factor in their own sense of soreness/sleep since that data isn't tracked here. Under 90 words, plain text, no markdown, don't restate "${signalLabel}" as a standalone label since it's already shown elsewhere.`;

  const text = await callClaude(prompt, 300);
  return { text, signal };
}

// Agent 4 (ported): a single strength session, rotated by day and scaled
// to current training phase.
// Strength exercises are picked deterministically (not by the LLM) so the
// dashboard can pair every exercise with a matching muscle-group illustration
// without depending on the model naming things consistently. The LLM's job is
// just the short coaching note that goes alongside the picked exercises.
export type MuscleGroup = "glutes" | "hamstrings" | "quads" | "calves" | "core" | "hip_abductors" | "ankles" | "upper_body";

export type StrengthExercise = {
  name: string;
  muscleGroups: MuscleGroup[];
  sets: string;
  reps: string;
  note?: string;
};

type ExerciseTemplate = { name: string; muscleGroups: MuscleGroup[]; note?: string };
type ExerciseCategory = "legs" | "core" | "mobility" | "upper";

// A session is always exactly 3 exercises: legs every time (running is a
// single-leg sport - this is non-negotiable for a runner-specific plan), plus
// 2 more picked at random from core/mobility/upper each time "Get another" is
// clicked, so the rotation actually varies instead of being locked to the
// day of week, and every body part gets coverage across regenerates rather
// than only ever showing legs.
const EXERCISE_POOLS: Record<ExerciseCategory, ExerciseTemplate[]> = {
  legs: [
    { name: "Bulgarian split squat", muscleGroups: ["quads", "glutes"] },
    { name: "Step-ups", muscleGroups: ["quads", "glutes"], note: "Use a bench or sturdy step, control the lower on the way down." },
    { name: "Single-leg Romanian deadlift", muscleGroups: ["hamstrings", "glutes"] },
    { name: "Single-leg glute bridge", muscleGroups: ["glutes", "hamstrings"] },
    { name: "Walking lunges", muscleGroups: ["quads", "glutes"] },
    { name: "Single-leg calf raise", muscleGroups: ["calves", "ankles"] },
    { name: "Banded monster walk", muscleGroups: ["hip_abductors", "glutes"], note: "Extra emphasis for hilly or uneven terrain." },
  ],
  core: [
    { name: "Plank", muscleGroups: ["core"] },
    { name: "Side plank", muscleGroups: ["core"] },
    { name: "Bird dog", muscleGroups: ["core", "glutes"], note: "Anti-rotation control, not speed." },
    { name: "Dead bug", muscleGroups: ["core"] },
    { name: "Russian twists", muscleGroups: ["core"] },
  ],
  mobility: [
    { name: "Hip flexor stretch", muscleGroups: ["hip_abductors"], note: "Hold 30s each side." },
    { name: "Clamshells", muscleGroups: ["hip_abductors"] },
    { name: "Single-leg balance reach", muscleGroups: ["ankles", "core"], note: "Proprioception work." },
    { name: "90/90 hip stretch", muscleGroups: ["hip_abductors"], note: "Hold 30s each side." },
    { name: "Lateral hops", muscleGroups: ["ankles", "calves"], note: "Ankle stability for trail/off-road footing." },
  ],
  upper: [
    { name: "Push-ups", muscleGroups: ["upper_body"] },
    { name: "Bent-over rows", muscleGroups: ["upper_body"], note: "Use dumbbells or a band - helps your arm drive late in a race." },
    { name: "Plank shoulder taps", muscleGroups: ["upper_body", "core"] },
    { name: "Standing band pull-aparts", muscleGroups: ["upper_body"], note: "Good posture work for runners who hunch when tired." },
  ],
};

function strengthSetsReps(phase: "base" | "build" | "peak" | "taper"): { sets: string; reps: string } {
  if (phase === "build") return { sets: "4", reps: "8-10" };
  if (phase === "peak" || phase === "taper") return { sets: "2", reps: "10 (light)" };
  return { sets: "3", reps: "12-15" };
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

export function pickStrengthExercises(raceConfig: RaceConfig): StrengthExercise[] {
  const phase = trainingPhase(raceConfig.startDate, raceConfig.raceDate);
  const { sets, reps } = strengthSetsReps(phase);
  const needsAnkleWork = raceConfig.terrain === "trail" || raceConfig.terrain === "mountainous";

  // Legs every time, plus 2 more categories chosen at random each call - this
  // is what makes "Get another" actually change the session instead of
  // re-showing the same day-locked picks.
  const otherCategories = shuffle<ExerciseCategory>(["core", "mobility", "upper"]).slice(0, 2);
  const categories: ExerciseCategory[] = ["legs", ...otherCategories];

  const templates = categories.map((cat) => {
    let pool = EXERCISE_POOLS[cat];
    if (cat === "mobility" && needsAnkleWork) {
      const ankleFocused = pool.filter((t) => t.muscleGroups.includes("ankles"));
      if (ankleFocused.length > 0) pool = ankleFocused;
    }
    return pickRandom(pool);
  });

  return templates.map((t) => ({ ...t, sets, reps }));
}

export async function generateStrengthSession(raceConfig: RaceConfig, exercises: StrengthExercise[]): Promise<string> {
  const phase = trainingPhase(raceConfig.startDate, raceConfig.raceDate);
  const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const exerciseNames = exercises.map((e) => e.name).join(", ");

  const prompt = `You are a running coach. A runner training for ${raceConfig.raceName} (${raceConfig.distance}, ${raceConfig.terrain} terrain) is about to do today's (${dayOfWeek}) strength session: ${exerciseNames}. Current training phase: ${phase}.

Write a 2-3 sentence coaching note (under 60 words) tying these specific exercises together and how to approach effort/intensity given the ${phase} phase. Don't restate the exercise list, sets, or reps - those are already shown separately - just give context and one form cue. Plain text, no markdown.`;

  return callClaude(prompt, 200);
}

// Agent 5 (ported): fueling guidance scaled to race distance and the
// upcoming long run.
export async function generateNutritionGuidance(raceConfig: RaceConfig): Promise<string> {
  const phase = trainingPhase(raceConfig.startDate, raceConfig.raceDate);
  const conditions = raceConfig.expectedConditions ?? "mild";

  const conditionsNote: Record<string, string> = {
    mild: "Conditions are expected to be mild, so standard hydration/electrolyte guidance applies without extra adjustment.",
    hot: "Hot conditions are expected — raise sodium intake noticeably above normal, increase fluid volume, and front-load hydration well before the run starts since thirst lags behind actual fluid loss.",
    humid: "Hot and humid conditions are expected — sweat doesn't evaporate well in humidity, so sweat rate (and sodium loss) runs higher than the heat alone would suggest. Emphasize electrolytes over plain water, and flag a paced/conservative effort.",
    cold: "Cold conditions are expected — runners under-hydrate in the cold because thirst is blunted, so call that out explicitly even though sweat loss feels lower. Note that fluids may need to be carried somewhere they won't freeze on longer efforts.",
    variable: "Race-day conditions aren't locked in yet — give guidance for a moderate-weather default, but flag that sodium/fluid needs should be dialed up if it turns out hot or humid, and call out checking the forecast in race week.",
  };

  const distanceGuidance: Record<string, string> = {
    "5k": "A 5k is short and high-intensity — there's no real in-run fueling need. Focus almost entirely on the pre-run meal (carb-focused, 2-3 hours out, light/familiar food only) and a small carb snack 30-60 min out if racing on an empty stomach feels off. Don't overcomplicate this with mid-run nutrition.",
    "10k": "A 10k sits right at the edge of needing in-run fueling. Most runners can get through on pre-run fueling alone, but mention a small amount of fluid/electrolyte intake as optional for runners who are slower or racing in heat. Keep the pre-run meal carb-focused, 2-3 hours out.",
    "half marathon": "A half marathon needs real in-run fueling: carbs starting around 45-60 minutes in (roughly 30-60g carbs/hour depending on experience and gut tolerance), plus electrolytes, especially past the hour mark. Pre-run meal 2-3 hours out, smaller carb snack 30-60 min before the gun.",
    marathon: "A full marathon needs the most deliberate fueling strategy of the four: carbs from ~30-45 minutes in onward at 60-90g carbs/hour for trained guts (lower if untrained — practice this in long runs, never debut it on race day), consistent electrolyte intake throughout, and a clear hydration plan tied to aid stations. Carb-load in the 1-2 days prior, not just the night before.",
  };

  const prompt = `You are a running coach giving fueling guidance to a runner training for a ${raceConfig.distance} race (${raceConfig.raceName}, ${raceConfig.terrain} terrain). Current training phase: ${phase}.

Distance-specific strategy: ${distanceGuidance[raceConfig.distance] ?? distanceGuidance["half marathon"]}

Weather factor: ${conditionsNote[conditions]}

Structure the answer around pre-run, during-run, and post-run (protein + carbs within an hour, rehydration scaled to how much was lost). Be concrete about what's different for THIS distance and THESE conditions rather than generic advice that would apply to any race. Under 200 words, plain text, no markdown headers.`;

  return callClaude(prompt, 500);
}

const DISTANCE_KM: Record<string, number> = {
  "5k": 5,
  "10k": 10,
  "half marathon": 21.1,
  marathon: 42.2,
};

// Parses goal-time strings like "1:45:00", "1:45", or "45:00" into seconds.
// Returns null if the string can't be parsed (e.g. empty or freeform text).
function parseTimeToSec(timeStr: string | undefined): number | null {
  if (!timeStr) return null;
  const parts = timeStr.trim().split(":").map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

export type RacePredictionResult = {
  text: string;
  conservativeSec: number;
  expectedSec: number;
  stretchSec: number;
  goalSec: number | null;
};

// Agent 6 (ported, now with a real code-side calculation instead of asking
// the LLM to do arithmetic in its head): Riegel-style time prediction
// (T2 = T1 * (D2/D1)^1.06) from the runner's actual recent pace/distance,
// with a hill penalty if applicable, producing Conservative/Expected/Stretch
// finish times. Claude is then only asked to write the narrative around
// numbers that are already computed, so the prose can't drift from the chart.
export async function generateRacePrediction(
  raceConfig: RaceConfig,
  recentActivities: Activity[]
): Promise<RacePredictionResult> {
  const summary = recentRunsSummary(recentActivities, 10);
  const runs = recentActivities.filter((a) => !a.type || a.type === "Run").slice(0, 10);

  const raceDistanceKm = DISTANCE_KM[raceConfig.distance] ?? 21.1;
  // Rough rules-of-thumb penalty by terrain, not a real elevation-profile model.
  const TERRAIN_PENALTY: Record<RaceConfig["terrain"], number> = {
    flat: 1,
    rolling: 1.03,
    hilly: 1.08,
    mountainous: 1.15,
    trail: 1.12,
  };
  const terrainPenalty = TERRAIN_PENALTY[raceConfig.terrain] ?? 1;
  const goalSec = parseTimeToSec(raceConfig.goalTime);

  let expectedSec = 0;
  if (runs.length > 0) {
    const distances = runs.map((a) => a.distance / 1000).filter((d) => d > 0);
    const paces = runs.filter((a) => a.average_speed > 0).map((a) => 1000 / a.average_speed); // sec/km
    const avgDistanceKm = distances.length ? distances.reduce((s, v) => s + v, 0) / distances.length : 0;
    const avgPaceSecPerKm = paces.length ? paces.reduce((s, v) => s + v, 0) / paces.length : 0;
    if (avgDistanceKm > 0 && avgPaceSecPerKm > 0) {
      expectedSec = avgPaceSecPerKm * avgDistanceKm * Math.pow(raceDistanceKm / avgDistanceKm, 1.06) * terrainPenalty;
    }
  }
  // Conservative = a bit slower than expected, Stretch = a bit faster -
  // a simple +/-spread rather than a separate statistical model, since the
  // input data (recent average pace/distance) is itself a rough proxy.
  const conservativeSec = expectedSec ? expectedSec * 1.05 : 0;
  const stretchSec = expectedSec ? expectedSec * 0.96 : 0;

  const fmt = (sec: number) => {
    if (!sec) return "not enough recent data";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.round(sec % 60);
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const prompt = `You are a running coach predicting a race result. Race: ${raceConfig.raceName} on ${raceConfig.raceDate} (${raceConfig.distance}, ${raceConfig.terrain} terrain). Goal time: ${raceConfig.goalTime || "not set"}.

Recent runs (most recent first, with pace/distance):
${summary}

These three finish times have already been calculated using a Riegel-style projection (T2 = T1 * (D2/D1)^1.06) from the runner's recent average pace/distance${
    terrainPenalty > 1 ? `, with a ${Math.round((terrainPenalty - 1) * 100)}% terrain penalty applied for the ${raceConfig.terrain} course` : ""
  } — use these exact numbers, don't recompute or contradict them:
- Conservative: ${fmt(conservativeSec)}
- Expected: ${fmt(expectedSec)}
- Stretch: ${fmt(stretchSec)}

Briefly explain what's driving this projection (recent pace/volume trend) and compare honestly against the goal of ${raceConfig.goalTime || "(no goal set)"} — if the goal looks out of reach based on current data, say so plainly and suggest whether next training cycle is more realistic. Under 130 words, plain text, no markdown headers, don't repeat the three times verbatim since they're already shown elsewhere.`;

  const text = expectedSec
    ? await callClaude(prompt, 400)
    : "Not enough recent run data yet to project a race time — log a few more runs and check back.";

  return { text, conservativeSec, expectedSec, stretchSec, goalSec };
}

// Agent 8 (ported, simplified): weekly retrospective summary plus the two
// reflective questions from the original agent (no persistent knowledge-base
// note in this version - the runner just sees this on the dashboard).
export async function generateRetrospective(
  raceConfig: RaceConfig,
  recentActivities: Activity[]
): Promise<string> {
  const weekActivities = recentActivities.filter(
    (a) => Date.now() - new Date(a.start_date).getTime() < 7 * 24 * 60 * 60 * 1000
  );
  const summary = recentRunsSummary(weekActivities, 10);
  const totalKm = weekActivities.reduce((sum, a) => sum + a.distance / 1000, 0);

  const prompt = `You are a running coach writing a brief weekly retrospective for a runner training for ${raceConfig.raceName}.

This week's sessions:
${summary}
Total distance this week: ${totalKm.toFixed(1)}km

Write a short, encouraging summary of the week's training load and any notable runs (under 80 words), then end with exactly these two questions on their own lines: "What was your biggest win this week?" and "What felt hardest this week?" Plain text, no markdown.`;

  return callClaude(prompt, 400);
}

const INSIGHT_LABELS: Record<string, string> = {
  weeklyPlan: "This week's plan",
  midweekReplan: "Mid-week check",
  workoutAnalysis: "Last workout analysis",
  recoverySignal: "Today's readiness",
  strengthSession: "Strength session",
  nutritionGuidance: "Fueling guidance",
  racePrediction: "Race prediction",
  retrospective: "Weekly retrospective",
  lastCheckIn: "Last daily check-in",
  lifeEventReplan: "Life event update",
  acwrRetrospective: "Training load trend",
  weekOverWeek: "Week vs. last week",
  athletePortrait: "Your running personality",
};

// Acute:Chronic Workload Ratio, distance-based (km). Acute = last 7 days,
// chronic = trailing 28-day average weekly load. This is a simplified proxy
// (no intensity/HR weighting) but it's enough to flag sharp volume swings
// in either direction — the classic ACWR injury-risk and undertraining signal.
export function calcAcwr(activities: Activity[]): { acuteKm: number; chronicWeeklyKm: number; ratio: number | null } {
  const now = Date.now();
  const days = (a: Activity) => (now - new Date(a.start_date).getTime()) / (24 * 60 * 60 * 1000);
  const acuteKm = activities.filter((a) => days(a) < 7).reduce((sum, a) => sum + a.distance / 1000, 0);
  const last28Km = activities.filter((a) => days(a) < 28).reduce((sum, a) => sum + a.distance / 1000, 0);
  const chronicWeeklyKm = last28Km / 4;
  const ratio = chronicWeeklyKm > 0 ? acuteKm / chronicWeeklyKm : null;
  return { acuteKm, chronicWeeklyKm, ratio };
}

// "Life happened" agent: takes a free-text note about something that
// disrupted training (skipped session, feeling sluggish, travel, illness,
// etc.), recalculates ACWR from actual Strava data, and gives a concrete
// read on whether the disruption pushes the runner toward injury risk
// (ratio climbing too fast after resuming) or undertraining drift (ratio
// dropping too far), with a plan adjustment for the rest of the week.
export async function generateLifeEventReplan(
  raceConfig: RaceConfig,
  recentActivities: Activity[],
  note: string
): Promise<string> {
  const { acuteKm, chronicWeeklyKm, ratio } = calcAcwr(recentActivities);
  const weekSoFar = recentRunsSummary(
    recentActivities.filter((a) => Date.now() - new Date(a.start_date).getTime() < 7 * 24 * 60 * 60 * 1000),
    10
  );

  const prompt = `You are a running coach for a runner training for ${raceConfig.raceName} on ${raceConfig.raceDate} (${raceConfig.distance}, ${raceConfig.terrain} terrain), goal ${raceConfig.goalTime}.

The runner just told you: "${note}"

This week's logged runs so far:
${weekSoFar}

Acute:Chronic Workload Ratio (distance-based, a standard injury-risk/undertraining signal):
- Last 7 days: ${acuteKm.toFixed(1)}km
- Trailing 28-day average week: ${chronicWeeklyKm.toFixed(1)}km
- Ratio: ${ratio !== null ? ratio.toFixed(2) : "not enough history yet"}
(Ratio under ~0.8 suggests undertraining drift; 0.8-1.3 is the safe/sweet-spot range; over ~1.5 suggests a sharp load spike and elevated injury risk. If there isn't enough history, say so honestly rather than inventing a verdict.)

Respond directly to what the runner told you, reference the training-load read above in plain terms (not just the number, and never use the acronym "ACWR" — say "training load balance" instead), and give a concrete, specific adjustment for the rest of this week — what to do, what to skip or move, and whether this is a "no big deal" or "actually worth paying attention to" situation. Under 150 words, plain text, no markdown headers.`;

  return callClaude(prompt, 500);
}

// Retrospective ACWR narrative (roadmap item #5): reads the athlete's
// accumulated ACWR snapshot history (from Supabase, oldest first) and writes
// a trend-aware look-back - was load climbing, declining, or steady over the
// recent weeks - rather than describing a single point-in-time ratio like
// generateLifeEventReplan does. Genuinely needs persistent history; this is
// the first feature that couldn't have been built on the old single-cookie
// session.
export async function generateAcwrRetrospective(
  raceConfig: RaceConfig,
  history: AcwrSnapshotRow[]
): Promise<string> {
  if (history.length === 0) {
    return "No training-load history yet. Once you've used \"Life happened?\" (or trained for a couple of weeks with this connected), there'll be enough data here to spot trends instead of just a single snapshot.";
  }
  if (history.length === 1) {
    const only = history[0];
    return `Only one data point so far (${new Date(only.computed_at).toLocaleDateString()}): ratio ${
      only.ratio !== null ? only.ratio.toFixed(2) : "not enough history yet"
    }. Check back after a few more "Life happened?" updates or weeks of training to get an actual trend instead of a single reading.`;
  }

  const timeline = history
    .map(
      (s) =>
        `- ${new Date(s.computed_at).toLocaleDateString()}: ratio ${
          s.ratio !== null ? s.ratio.toFixed(2) : "n/a"
        } (acute ${s.acute_km.toFixed(1)}km / chronic-weekly ${s.chronic_weekly_km.toFixed(1)}km)${
          s.note ? ` — noted: "${s.note}"` : ""
        }`
    )
    .join("\n");

  const prompt = `You are a running coach writing a retrospective on training load trend for a runner training for ${raceConfig.raceName} on ${raceConfig.raceDate} (${raceConfig.distance}, ${raceConfig.terrain} terrain).

Here is their Acute:Chronic Workload Ratio (ACWR) history over time, oldest first (ratio under ~0.8 = undertraining drift, 0.8-1.3 = sweet spot, over ~1.5 = elevated injury risk from a sharp load spike):
${timeline}

Write a short retrospective (under 160 words, plain text, no markdown headers) that:
1. Names the actual trend across these readings - climbing, declining, oscillating, or steady - don't just restate the latest number.
2. Calls out any point where it crossed out of the 0.8-1.3 sweet spot, and whether it's still out of range now.
3. Connects to any notes left alongside the numbers if they help explain the pattern.
4. Ends with one concrete, forward-looking recommendation for the next week or two based on the trend (not just the most recent reading).

Be honest if the trend is genuinely fine - don't manufacture concern that isn't there. Never use the acronym "ACWR" in your response - call it "training load balance" instead.`;

  return callClaude(prompt, 500);
}

export type WeekTotals = {
  km: number;
  runCount: number;
  longestKm: number;
  avgPaceMps: number; // 0 if no runs
};

function mondayOfServer(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function summarizeWeek(runs: Activity[], start: Date, end: Date): WeekTotals {
  const inWeek = runs.filter((a) => {
    const d = new Date(a.start_date_local ?? a.start_date);
    return d >= start && d < end;
  });
  const km = inWeek.reduce((sum, a) => sum + a.distance / 1000, 0);
  const longestKm = inWeek.reduce((max, a) => Math.max(max, a.distance / 1000), 0);
  const speeds = inWeek.filter((a) => a.average_speed > 0).map((a) => a.average_speed);
  const avgPaceMps = speeds.length > 0 ? speeds.reduce((s, v) => s + v, 0) / speeds.length : 0;
  return { km, runCount: inWeek.length, longestKm, avgPaceMps };
}

function paceLabel(mps: number): string {
  if (!mps) return "n/a";
  const secPerKm = 1000 / mps;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}/km`;
}

// Roadmap item #4: week-over-week comparison. Strava's activity summaries
// don't include HR, cadence, or interval/effort-type splits (the other
// agents already disclose this same limitation), so this sticks to what the
// data actually supports - volume, run count, longest run, and average
// pace - rather than inventing an effort-type breakdown that isn't there.
export type WeekOverWeekResult = {
  text: string;
  thisWeek: WeekTotals;
  lastWeek: WeekTotals;
};

export async function generateWeekOverWeekComparison(
  raceConfig: RaceConfig,
  recentActivities: Activity[]
): Promise<WeekOverWeekResult> {
  const runs = recentActivities.filter((a) => !a.type || a.type === "Run");
  const thisMonday = mondayOfServer(new Date());
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const nextMonday = new Date(thisMonday);
  nextMonday.setDate(nextMonday.getDate() + 7);

  const thisWeek = summarizeWeek(runs, thisMonday, nextMonday);
  const lastWeek = summarizeWeek(runs, lastMonday, thisMonday);

  if (thisWeek.runCount === 0 && lastWeek.runCount === 0) {
    return {
      text: "No runs logged in either this week or last week yet, so there's nothing to compare. Once a couple of runs land this week, check back here.",
      thisWeek,
      lastWeek,
    };
  }

  const prompt = `You are a running coach comparing two consecutive training weeks for a runner training for ${raceConfig.raceName} on ${raceConfig.raceDate} (${raceConfig.distance}, ${raceConfig.terrain} terrain).

Last week (Mon-Sun):
- Runs: ${lastWeek.runCount}
- Total distance: ${lastWeek.km.toFixed(1)}km
- Longest run: ${lastWeek.longestKm.toFixed(1)}km
- Average pace: ${paceLabel(lastWeek.avgPaceMps)}

This week so far (Mon-today):
- Runs: ${thisWeek.runCount}
- Total distance: ${thisWeek.km.toFixed(1)}km
- Longest run: ${thisWeek.longestKm.toFixed(1)}km
- Average pace: ${paceLabel(thisWeek.avgPaceMps)}

Note this week is still in progress (not necessarily a full 7 days yet), so don't penalize it for having less volume than a completed week if today isn't Sunday - frame the comparison fairly given that.

Heart rate, cadence, and interval/effort-type splits aren't available from this data source - don't invent them. Base the comparison only on volume, run count, longest run, and pace.

Write a short comparison (under 130 words, plain text, no markdown) that names the concrete deltas (more/less volume, faster/slower pace, longer/shorter long run), says what that likely means for training load, and ends with one practical suggestion for the rest of this week.`;

  const text = await callClaude(prompt, 450);
  return { text, thisWeek, lastWeek };
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Roadmap item #3: the athlete "character portrait" - a running-personality
// summary built from accumulated history rather than a single week. Needs
// persisted activity history (lib/history.ts), not just Strava's last ~30
// activities, to say anything real about multi-week tendencies.
export type AthletePortraitStats = {
  totalRuns: number;
  spanWeeks: number;
  weeksWithAnyRun: number;
  weeksWithThreePlus: number;
  avgRunsPerWeek: number;
  preferredDays: string[];
  earlyAvgKm: number;
  recentAvgKm: number;
  longestRunKm: number;
  avgPace: string;
};

export type AthletePortraitResult = {
  text: string;
  // null = not enough history yet to compute real stats - the UI should
  // render an empty/placeholder state rather than a chart with zeroes.
  stats: AthletePortraitStats | null;
};

export async function generateAthletePortrait(
  raceConfig: RaceConfig,
  activityHistory: ActivityHistoryRow[]
): Promise<AthletePortraitResult> {
  const runs = activityHistory.filter((a) => !a.type || a.type === "Run");

  if (runs.length < 6) {
    return {
      text: "Not enough running history yet to draw a real character portrait — this needs a handful of weeks of synced runs first. Keep training (and keep Strava synced) and check back in a couple of weeks.",
      stats: null,
    };
  }

  const firstDate = new Date(runs[0].start_date);
  const lastDate = new Date(runs[runs.length - 1].start_date);
  const spanDays = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / (24 * 60 * 60 * 1000));
  const spanWeeks = Math.max(1, spanDays / 7);

  if (spanWeeks < 2) {
    return {
      text: "Not enough running history yet to draw a real character portrait — all the synced runs are from the same short window. Keep training (and keep Strava synced) and check back in a couple of weeks.",
      stats: null,
    };
  }

  // Bucket into Mon-Sun weeks to measure consistency and a volume trend,
  // reusing the same week boundary logic as the week-over-week comparison.
  const weekBuckets = new Map<string, { km: number; count: number }>();
  for (const r of runs) {
    const monday = mondayOfServer(new Date(r.start_date));
    const key = monday.toISOString().slice(0, 10);
    const bucket = weekBuckets.get(key) ?? { km: 0, count: 0 };
    bucket.km += r.distance_m / 1000;
    bucket.count += 1;
    weekBuckets.set(key, bucket);
  }
  const weeks = Array.from(weekBuckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, v]) => v);

  const weeksWithAnyRun = weeks.length;
  const weeksWithThreePlus = weeks.filter((w) => w.count >= 3).length;
  const avgRunsPerWeek = runs.length / weeksWithAnyRun;

  const dayCounts = new Array(7).fill(0);
  for (const r of runs) dayCounts[new Date(r.start_date).getDay()] += 1;
  const maxDayCount = Math.max(...dayCounts);
  const preferredDays = dayCounts
    .map((count, idx) => ({ day: WEEKDAY_NAMES[idx], count }))
    .filter((d) => d.count === maxDayCount && maxDayCount > 0)
    .map((d) => d.day);

  const half = Math.floor(weeks.length / 2);
  const earlyWeeks = weeks.slice(0, half || 1);
  const recentWeeks = weeks.slice(half || 1);
  const avgKm = (arr: { km: number }[]) => (arr.length ? arr.reduce((s, w) => s + w.km, 0) / arr.length : 0);
  const earlyAvgKm = avgKm(earlyWeeks);
  const recentAvgKm = avgKm(recentWeeks.length ? recentWeeks : earlyWeeks);

  const longestRunKm = runs.reduce((max, r) => Math.max(max, r.distance_m / 1000), 0);

  const speeds = runs.filter((r) => (r.average_speed_mps ?? 0) > 0).map((r) => r.average_speed_mps as number);
  const avgPace = speeds.length ? paceLabel(speeds.reduce((s, v) => s + v, 0) / speeds.length) : "n/a";

  const prompt = `You are a running coach writing a brief "running personality" character portrait for a runner training for ${raceConfig.raceName} (${raceConfig.distance}, ${raceConfig.terrain} terrain), based only on accumulated training-log stats - not feelings, motivation, or injury history you don't actually have data on.

Stats covering ${runs.length} runs over about ${Math.round(spanWeeks)} weeks:
- Weeks with at least one run: ${weeksWithAnyRun}
- Weeks with 3+ runs: ${weeksWithThreePlus}
- Average runs per active week: ${avgRunsPerWeek.toFixed(1)}
- Most common run day(s): ${preferredDays.join(", ") || "no clear pattern"}
- Average weekly distance, earlier vs. more recent weeks: ${earlyAvgKm.toFixed(1)}km vs ${recentAvgKm.toFixed(1)}km
- Longest single run on record: ${longestRunKm.toFixed(1)}km
- Average pace across all runs: ${avgPace}

Write a short, warm character portrait (under 140 words, plain text, no markdown) that names one or two real tendencies these stats actually show (e.g. consistency level, a preferred day pattern, whether volume is trending up/flat/down, how their longest run compares to typical), gives it personality without inventing facts not in the stats, and ends with one encouraging, forward-looking note tied to ${raceConfig.raceName}. Be honest if the data shows inconsistency rather than only flattering.`;

  const text = await callClaude(prompt, 500);
  return {
    text,
    stats: {
      totalRuns: runs.length,
      spanWeeks,
      weeksWithAnyRun,
      weeksWithThreePlus,
      avgRunsPerWeek,
      preferredDays,
      earlyAvgKm,
      recentAvgKm,
      longestRunKm,
      avgPace,
    },
  };
}

const BODY_PART_LABELS: Record<string, string> = {
  calf: "calf",
  knee: "knee",
  it_band: "IT band",
  shin: "shin",
  hip: "hip",
  foot: "foot",
  other: "other area",
};

export type InjuryWatchResult = {
  text: string;
  hasPattern: boolean;
  flaggedBodyPart: string | null;
};

// Self-reported niggles are the leading indicator pace/ACWR data can't see —
// by the time pain shows up in performance data, it's usually already an
// injury rather than "about to be." Two cheap, deliberately conservative
// triggers decide whether this is worth surfacing at all: 3+ reports of the
// same body part within a 14-day window, or severity climbing across the
// most recent same-body-part entries. Anything short of that stays dormant
// (hasPattern: false) so the dashboard doesn't cry wolf over one sore calf.
export async function generateInjuryWatch(
  raceConfig: RaceConfig,
  history: NiggleLogRow[]
): Promise<InjuryWatchResult> {
  if (history.length === 0) {
    return {
      text: "No niggles logged in the last few weeks. Keep using the quick logger after runs if anything feels off — it's how patterns get caught early instead of after they've become an injury.",
      hasPattern: false,
      flaggedBodyPart: null,
    };
  }

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const recent = history.filter((n) => new Date(n.logged_at) >= fourteenDaysAgo);
  const countsByPart = new Map<string, NiggleLogRow[]>();
  for (const n of recent) {
    const list = countsByPart.get(n.body_part) ?? [];
    list.push(n);
    countsByPart.set(n.body_part, list);
  }

  let flaggedBodyPart: string | null = null;
  let triggerReason = "";
  for (const [part, entries] of countsByPart) {
    const frequencyTriggered = entries.length >= 3;
    const sorted = entries.slice().sort((a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime());
    const escalationTriggered =
      sorted.length >= 2 && sorted[sorted.length - 1].severity >= 2 && sorted[sorted.length - 1].severity >= sorted[0].severity + 1;

    if (frequencyTriggered || escalationTriggered) {
      flaggedBodyPart = part;
      triggerReason = frequencyTriggered
        ? `reported ${entries.length} times in the last 14 days`
        : "severity has been climbing across recent reports";
      break; // surface one pattern at a time rather than overwhelming with several
    }
  }

  if (!flaggedBodyPart) {
    return {
      text: `${recent.length} niggle report${recent.length === 1 ? "" : "s"} logged in the last 14 days, nothing repeating or escalating yet. Nothing to act on right now — keep logging so anything real gets caught early.`,
      hasPattern: false,
      flaggedBodyPart: null,
    };
  }

  const timeline = recent
    .filter((n) => n.body_part === flaggedBodyPart)
    .map((n) => `- ${new Date(n.logged_at).toLocaleDateString()}: severity ${n.severity}/3${n.note ? ` — "${n.note}"` : ""}`)
    .join("\n");

  const label = BODY_PART_LABELS[flaggedBodyPart] ?? flaggedBodyPart;

  const prompt = `You are a running coach (not a doctor) flagging an emerging pattern for a runner training for ${raceConfig.raceName} on ${raceConfig.raceDate} (${raceConfig.distance}, ${raceConfig.terrain} terrain).

They've self-reported the following about their ${label}, most recent last (${triggerReason}):
${timeline}

Write a short, direct flag (under 130 words, plain text, no markdown) that:
1. Names the pattern plainly (frequency or escalation) without being alarmist.
2. Suggests one concrete, practical adjustment for the next few days (e.g. swap a specific session type, add mobility/strength work, reduce volume) — not generic "listen to your body" filler.
3. Clearly recommends seeing a physio or doctor if it's gotten to "concerning" severity or doesn't improve soon — you are not diagnosing anything.

Be calm and useful, not scary.`;

  const text = await callClaude(prompt, 400);
  return { text, hasPattern: true, flaggedBodyPart };
}

// Chat agent: free-form Q&A grounded in the runner's race config, recent
// Strava activity, and whatever the other dashboard agents have already
// generated this session — so the runner isn't re-explaining context the
// dashboard already has, and answers can reference those insights directly.
export async function generateChatResponse(
  raceConfig: RaceConfig,
  recentActivities: Activity[],
  insights: Partial<Record<string, string | undefined>>,
  history: ChatMessage[]
): Promise<string> {
  const summary = recentRunsSummary(recentActivities, 10);

  const insightsBlock =
    Object.entries(insights)
      .filter(([, text]) => !!text)
      .map(([key, text]) => `${INSIGHT_LABELS[key] ?? key}:\n${text}`)
      .join("\n\n") || "(no agent insights generated yet — encourage the runner to run a few of the dashboard agents first)";

  const system = `You are a running coach assistant embedded in a training dashboard for a runner training for ${raceConfig.raceName} on ${raceConfig.raceDate} (${raceConfig.distance}, ${raceConfig.terrain} terrain), goal time ${raceConfig.goalTime}.

Recent runs (most recent first):
${summary}

Insights already generated elsewhere on this runner's dashboard — refer to these directly and reuse their conclusions instead of re-deriving from scratch when they're relevant to the question:
${insightsBlock}

Answer the runner's questions conversationally and specifically, grounding answers in the data and insights above. If a question isn't covered by the data or insights available, say so honestly rather than inventing numbers or claims. Keep answers under 150 words, plain text, no markdown headers.`;

  return callClaudeMessages(system, history, 500);
}
