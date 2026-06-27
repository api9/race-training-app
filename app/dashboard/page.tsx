"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";

type Activity = {
  id: number;
  name: string;
  distance: number; // meters
  moving_time: number; // seconds
  average_speed: number; // m/s
  total_elevation_gain: number;
  start_date_local: string;
  type: string;
};

type RaceConfig = {
  raceName: string;
  raceDate: string;
  distance: string;
  terrain: "flat" | "rolling" | "hilly" | "mountainous" | "trail";
  goalTime: string;
  startDate: string;
};

// Mirrors WeekTotals from lib/agents.ts.
type WeekTotals = {
  km: number;
  runCount: number;
  longestKm: number;
  avgPaceMps: number;
};

// Mirrors AthletePortraitStats from lib/agents.ts.
type AthletePortraitStats = {
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

type RecoverySignalValue = "green" | "yellow" | "red";

// Mirrors MuscleGroup/StrengthExercise from lib/agents.ts.
type MuscleGroup = "glutes" | "hamstrings" | "quads" | "calves" | "core" | "hip_abductors" | "ankles" | "upper_body";
type StrengthExercise = {
  name: string;
  muscleGroups: MuscleGroup[];
  sets: string;
  reps: string;
  note?: string;
};

// AgentOutput now carries optional structured fields alongside the
// narrative text - only the four chart-backed agents (racePrediction,
// recoverySignal, weekOverWeek, athletePortrait) populate them, the rest
// stay text-only. Mirrors the (extended) shape from lib/session.ts.
type AgentOutput = {
  text: string;
  generatedAt: string;
  thisWeek?: WeekTotals;
  lastWeek?: WeekTotals;
  conservativeSec?: number;
  expectedSec?: number;
  stretchSec?: number;
  goalSec?: number | null;
  signal?: RecoverySignalValue;
  stats?: AthletePortraitStats | null;
  hasPattern?: boolean;
  flaggedBodyPart?: string | null;
  exercises?: StrengthExercise[];
};

const BODY_PARTS: { key: string; label: string }[] = [
  { key: "calf", label: "Calf" },
  { key: "knee", label: "Knee" },
  { key: "it_band", label: "IT band" },
  { key: "shin", label: "Shin" },
  { key: "hip", label: "Hip" },
  { key: "foot", label: "Foot" },
  { key: "other", label: "Other" },
];

type ChatMessage = { role: "user" | "assistant"; content: string };

// Mirrors AcwrSnapshotRow from lib/history.ts. Re-declared locally (rather
// than imported) so this client component never pulls in server-only
// Supabase code - we only need the shape, not the query helpers.
type AcwrPoint = {
  ratio: number | null;
  acute_km: number;
  chronic_weekly_km: number;
  source: string;
  note: string | null;
  computed_at: string;
};

// Mon-Sun range for the current week, e.g. "Jun 16 - Jun 22" - shown next to
// "This week's plan" so the card's scope is obvious without opening it.
function currentWeekRangeLabel(): string {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(monday)} - ${fmt(sunday)}`;
}

function mpsToMinKm(mps: number): string {
  if (!mps) return "-";
  const secPerKm = 1000 / mps;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}/km`;
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

// Riegel-style prediction with a terrain penalty - rough rules of thumb,
// not a substitute for an actual elevation-profile model.
const TERRAIN_PENALTY: Record<RaceConfig["terrain"], number> = {
  flat: 1,
  rolling: 1.03,
  hilly: 1.08,
  mountainous: 1.15,
  trail: 1.12, // technical/unpaved footing slows pace independent of elevation
};

function predictFinishTime(recentPaceSecPerKm: number, raceDistanceKm: number, terrain: RaceConfig["terrain"]) {
  const recentDistanceKm = 10; // baseline assumption for the demo - swap for a real recent long-run distance
  const exponent = 1.06;
  const predictedSec = recentPaceSecPerKm * recentDistanceKm * Math.pow(raceDistanceKm / recentDistanceKm, exponent);
  return predictedSec * (TERRAIN_PENALTY[terrain] ?? 1);
}

function formatSecAsTime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

const DISTANCE_KM: Record<string, number> = {
  "5k": 5,
  "10k": 10,
  "half marathon": 21.1,
  marathon: 42.2,
};

type AgentKey =
  | "weeklyPlan"
  | "midweekReplan"
  | "workoutAnalysis"
  | "recoverySignal"
  | "strengthSession"
  | "nutritionGuidance"
  | "racePrediction"
  | "retrospective"
  | "acwrRetrospective"
  | "weekOverWeek"
  | "athletePortrait";

type AgentCategory = "run" | "workout" | "fueling";

type AgentConfig = {
  key: AgentKey;
  title: string;
  endpoint: string;
  buttonLabel: string;
  regenerateLabel: string;
  emptyText: string;
  category: AgentCategory;
  featured?: boolean;
  // Visual weight within a section. Unset = "standard" (actionable-now:
  // tells you what to do today/this week). "tertiary" = reflective/look-back
  // content (trends, retrospectives, the personality portrait) - useful but
  // not something you need to act on right now, so it renders smaller and
  // collapsed by default rather than competing with the actionable cards.
  tier?: "tertiary";
  // Which of the four chart-backed agents this is, if any - drives which
  // visual renders above the text inside AgentCard.
  chart?: "weekOverWeek" | "racePrediction" | "recoverySignal" | "athletePortrait" | "strengthSession";
  // If true, this card fetches its content automatically once Strava data
  // loads, instead of waiting for the user to click the button. Reserved for
  // the handful of cards people want to see immediately - everything else
  // stays click-to-reveal to avoid firing a wave of AI calls on every load.
  autoRun?: boolean;
};

const AGENTS: AgentConfig[] = [
  {
    key: "weeklyPlan",
    title: "This week's plan",
    endpoint: "/api/agents/weekly-plan",
    buttonLabel: "Generate plan",
    regenerateLabel: "Regenerate",
    emptyText: "No plan generated yet this week.",
    category: "run",
    featured: true,
    autoRun: true,
  },
  {
    key: "midweekReplan",
    title: "Mid-week check",
    endpoint: "/api/agents/midweek-replan",
    buttonLabel: "Check progress",
    regenerateLabel: "Check again",
    emptyText: "See if this week's plan still fits how training's actually gone.",
    category: "run",
    autoRun: true,
  },
  {
    key: "racePrediction",
    title: "Race prediction",
    endpoint: "/api/agents/race-prediction",
    buttonLabel: "Predict my race",
    regenerateLabel: "Re-predict",
    emptyText: "Conservative / expected / stretch finish times vs. your goal.",
    category: "run",
    chart: "racePrediction",
    autoRun: true,
  },
  {
    key: "retrospective",
    title: "Weekly retrospective",
    endpoint: "/api/agents/retrospective",
    buttonLabel: "Generate retrospective",
    regenerateLabel: "Regenerate",
    emptyText: "A quick look back at the week, plus two reflection questions.",
    category: "run",
    tier: "tertiary",
    autoRun: true,
  },
  {
    key: "acwrRetrospective",
    title: "Training load trend",
    endpoint: "/api/agents/acwr-retrospective",
    buttonLabel: "See my trend",
    regenerateLabel: "Refresh trend",
    emptyText: "A look back across your training-load history, not just one snapshot — needs a few weeks (or check-ins) of data to get going.",
    category: "run",
    tier: "tertiary",
    autoRun: true,
  },
  {
    key: "weekOverWeek",
    title: "Week vs. last week",
    endpoint: "/api/agents/week-over-week",
    buttonLabel: "Compare weeks",
    regenerateLabel: "Refresh comparison",
    emptyText: "How this week's volume, longest run, and pace stack up against last week.",
    category: "run",
    tier: "tertiary",
    chart: "weekOverWeek",
    autoRun: true,
  },
  {
    key: "athletePortrait",
    title: "Your running personality",
    endpoint: "/api/agents/athlete-portrait",
    buttonLabel: "Build my portrait",
    regenerateLabel: "Refresh portrait",
    emptyText: "A character sketch built from your training patterns — consistency, preferred days, volume trend, and more. Needs a few weeks of synced runs.",
    category: "run",
    tier: "tertiary",
    chart: "athletePortrait",
    autoRun: true,
  },
  {
    key: "workoutAnalysis",
    title: "Last workout analysis",
    endpoint: "/api/agents/workout-analysis",
    buttonLabel: "Analyze last run",
    regenerateLabel: "Re-analyze",
    emptyText: "Get a read on your most recent run vs. recent similar runs.",
    category: "workout",
  },
  {
    key: "recoverySignal",
    title: "Today's readiness",
    endpoint: "/api/agents/recovery-signal",
    buttonLabel: "Check readiness",
    regenerateLabel: "Check again",
    emptyText: "Green/yellow/red readiness signal based on recent training load.",
    category: "workout",
    chart: "recoverySignal",
    autoRun: true,
  },
  {
    key: "strengthSession",
    title: "Strength session",
    endpoint: "/api/agents/strength-session",
    buttonLabel: "Get today's session",
    regenerateLabel: "Get another",
    emptyText: "A 30-40 minute strength session scaled to your training phase.",
    category: "workout",
    featured: true,
    chart: "strengthSession",
    autoRun: true,
  },
  {
    key: "nutritionGuidance",
    title: "Fueling guidance",
    endpoint: "/api/agents/nutrition-guidance",
    buttonLabel: "Get fueling tips",
    regenerateLabel: "Refresh tips",
    emptyText: "Pre/during/post-run fueling guidance scaled to your race distance.",
    category: "fueling",
  },
];

const SECTION_LABELS: Record<AgentCategory, { title: string; blurb: string }> = {
  run: {
    title: "Run coaching",
    blurb: "Plan, race outlook, and how the week's actually gone.",
  },
  workout: {
    title: "Workout & readiness",
    blurb: "Per-session feedback and how recovered you are right now.",
  },
  fueling: {
    title: "Fueling",
    blurb: "Pre/during/post-run nutrition for your race distance.",
  },
};

// Chat dropped from here on purpose - it's a floating widget on every screen
// size now, not a destination you navigate to.
const TABS: { key: "home" | AgentCategory; label: string; icon: string }[] = [
  { key: "home", label: "Home", icon: "🏠" },
  { key: "run", label: "Run", icon: "🏃" },
  { key: "workout", label: "Workout", icon: "💪" },
  { key: "fueling", label: "Fueling", icon: "🍌" },
];

type AgentState = { output?: AgentOutput; loading: boolean; error?: string };

// --- Chart components for the four data-visualization cards -------------

function WeekComparisonChart({ thisWeek, lastWeek }: { thisWeek: WeekTotals; lastWeek: WeekTotals }) {
  const maxKm = Math.max(thisWeek.km, lastWeek.km, 1);
  const deltaKm = thisWeek.km - lastWeek.km;
  const pctDelta = lastWeek.km > 0 ? (deltaKm / lastWeek.km) * 100 : thisWeek.km > 0 ? 100 : 0;
  return (
    <div className="mb-2 rounded-md bg-slate-50 p-2 dark:bg-slate-700/30">
      <div className="flex items-end gap-2">
        {[{ label: "Last wk", w: lastWeek }, { label: "This wk", w: thisWeek }].map((row) => (
          <div key={row.label} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{row.w.km.toFixed(1)}km</span>
            <div className="flex h-14 w-full items-end overflow-hidden rounded bg-slate-200 dark:bg-slate-600">
              <div
                className="w-full rounded-t bg-orange-500 dark:bg-orange-400"
                style={{ height: `${Math.max((row.w.km / maxKm) * 100, row.w.km > 0 ? 6 : 2)}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">{row.label}</span>
          </div>
        ))}
        <div className="flex flex-1 flex-col items-center justify-center gap-0.5 text-center">
          <span
            className={
              deltaKm >= 0
                ? "text-sm font-bold text-emerald-600 dark:text-emerald-400"
                : "text-sm font-bold text-amber-600 dark:text-amber-400"
            }
          >
            {deltaKm >= 0 ? "▲" : "▼"} {Math.abs(pctDelta).toFixed(0)}%
          </span>
          <span className="text-[9px] text-slate-400 dark:text-slate-500">volume vs. last wk</span>
          <span className="text-[9px] text-slate-500 dark:text-slate-400">{thisWeek.longestKm.toFixed(1)}km long run</span>
        </div>
      </div>
    </div>
  );
}

function RacePredictionBar({
  conservativeSec,
  expectedSec,
  stretchSec,
  goalSec,
}: {
  conservativeSec: number;
  expectedSec: number;
  stretchSec: number;
  goalSec: number | null;
}) {
  if (!expectedSec) return null;
  const min = Math.min(stretchSec, goalSec ?? stretchSec);
  const max = Math.max(conservativeSec, goalSec ?? conservativeSec);
  const span = Math.max(max - min, 1);
  const pct = (sec: number) => Math.min(100, Math.max(0, ((sec - min) / span) * 100));
  return (
    <div className="mb-2 rounded-md bg-slate-50 p-2 dark:bg-slate-700/30">
      <div className="relative h-2.5 w-full rounded-full bg-gradient-to-r from-emerald-300 via-orange-300 to-rose-300 dark:from-emerald-700 dark:via-orange-700 dark:to-rose-700">
        {goalSec !== null && (
          <div
            className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 bg-slate-900 dark:bg-slate-100"
            style={{ left: `${pct(goalSec)}%` }}
          />
        )}
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-orange-700 dark:border-slate-800"
          style={{ left: `${pct(expectedSec)}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
        <span>Stretch {formatSecAsTime(stretchSec)}</span>
        <span className="font-semibold text-orange-700 dark:text-orange-300">Expected {formatSecAsTime(expectedSec)}</span>
        <span>Conservative {formatSecAsTime(conservativeSec)}</span>
      </div>
      {goalSec !== null && (
        <p className="mt-0.5 text-center text-[9px] text-slate-400 dark:text-slate-500">| marks your goal time</p>
      )}
    </div>
  );
}

function ReadinessGauge({ signal }: { signal: RecoverySignalValue }) {
  const config = {
    green: { label: "Green — good to go", color: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300", pct: 85, icon: "✓" },
    yellow: { label: "Yellow — ease up today", color: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", pct: 55, icon: "!" },
    red: { label: "Red — rest or go very easy", color: "bg-rose-500", text: "text-rose-700 dark:text-rose-300", pct: 20, icon: "✕" },
  }[signal];
  return (
    <div className="mb-2 flex items-center gap-3 rounded-md bg-slate-50 p-2 dark:bg-slate-700/30">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${config.color} text-base font-bold text-white`}>
        {config.icon}
      </div>
      <div className="flex-1">
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-600">
          <div className={`h-full rounded-full ${config.color}`} style={{ width: `${config.pct}%` }} />
        </div>
        <p className={`mt-1 text-xs font-semibold ${config.text}`}>{config.label}</p>
      </div>
    </div>
  );
}

function PortraitStatTiles({ stats }: { stats: AthletePortraitStats }) {
  const trendUp = stats.recentAvgKm > stats.earlyAvgKm + 0.5;
  const trendDown = stats.recentAvgKm < stats.earlyAvgKm - 0.5;
  const consistencyPct = stats.weeksWithAnyRun > 0 ? (stats.weeksWithThreePlus / stats.weeksWithAnyRun) * 100 : 0;
  const tiles = [
    { label: "Avg runs/wk", value: stats.avgRunsPerWeek.toFixed(1) },
    { label: "Longest run", value: `${stats.longestRunKm.toFixed(1)}km` },
    { label: "Avg pace", value: stats.avgPace },
    { label: "Top day", value: stats.preferredDays[0]?.slice(0, 3) ?? "varies" },
  ];
  return (
    <div className="mb-2 rounded-md bg-slate-50 p-2 dark:bg-slate-700/30">
      <div className="grid grid-cols-4 gap-1.5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-md bg-white p-1.5 text-center shadow-sm dark:bg-slate-800">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-200">{t.value}</div>
            <div className="text-[9px] text-slate-400 dark:text-slate-500">{t.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[9px] text-slate-500 dark:text-slate-400">
        <span>{consistencyPct.toFixed(0)}% of weeks with 3+ runs</span>
        <span
          className={
            trendUp
              ? "text-emerald-600 dark:text-emerald-400"
              : trendDown
              ? "text-amber-600 dark:text-amber-400"
              : "text-slate-500 dark:text-slate-400"
          }
        >
          Volume {trendUp ? "▲ up" : trendDown ? "▼ down" : "→ flat"}
        </span>
      </div>
    </div>
  );
}

// Simplified side-view runner silhouette in a lunge pose, used as a tiny
// "anatomy chart" thumbnail next to each strength exercise so it's obvious
// at a glance which muscles that exercise is working - same idea as the
// muscle-highlight diagrams you see on gym equipment, just hand-drawn in SVG
// rather than a photo. Regions not in `highlight` stay neutral slate;
// highlighted ones turn orange to match the app's accent color.
function MuscleIllustration({ highlight }: { highlight: MuscleGroup[] }) {
  // Unique gradient ids per instance (useId) so the dozen+ copies of this
  // SVG that can appear in one strength-session list don't collide on a
  // shared <linearGradient id>, which browsers will otherwise dedupe to
  // whichever copy rendered first.
  const uid = useId().replace(/:/g, "");
  const hiGrad = `${uid}-hi`;
  const loGrad = `${uid}-lo`;
  const color = (group: MuscleGroup) => `url(#${highlight.includes(group) ? hiGrad : loGrad})`;

  return (
    <svg
      viewBox="0 0 100 132"
      className="h-16 w-14 shrink-0"
      role="img"
      aria-label={`Illustration highlighting ${highlight.map((g) => g.replace("_", " ")).join(", ")}`}
    >
      <defs>
        <linearGradient id={hiGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fb923c" />
          <stop offset="100%" stopColor="#c2410c" />
        </linearGradient>
        <linearGradient id={loGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cbd5e1" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
      </defs>

      {/* ground shadow, for a sense of footing */}
      <ellipse cx="54" cy="126" rx="34" ry="4" className="fill-slate-200 dark:fill-slate-700" opacity={0.6} />

      {/* back leg: hamstring + calf, trailing behind in the lunge */}
      <path d="M54,62 Q44,72 38,82" stroke={color("hamstrings")} strokeWidth="11" strokeLinecap="round" fill="none" />
      <path d="M38,82 Q34,94 31,104" stroke={color("calves")} strokeWidth="9" strokeLinecap="round" fill="none" />
      <rect x="18" y="103" width="16" height="6" rx="3" fill={color("ankles")} />

      {/* back arm, swung back */}
      <path d="M50,27 Q41,35 37,46" stroke={color("upper_body")} strokeWidth="7" strokeLinecap="round" fill="none" />
      <circle cx="37" cy="46" r="3.5" fill={color("upper_body")} />

      {/* core / torso */}
      <path
        d="M52,22 C46,24 45,34 46,46 C47,54 50,58 56,60 C62,58 65,54 66,46 C67,34 66,24 60,22 C57,21 55,21 52,22 Z"
        fill={color("core")}
      />

      {/* head */}
      <circle cx="59" cy="13" r="8" className="fill-slate-300 dark:fill-slate-500" />

      {/* front arm, swung forward */}
      <path d="M62,27 Q71,31 77,41" stroke={color("upper_body")} strokeWidth="7" strokeLinecap="round" fill="none" />
      <circle cx="77" cy="41" r="3.5" fill={color("upper_body")} />

      {/* glutes + hip abductors at the hip */}
      <ellipse cx="56" cy="60" rx="11" ry="8" fill={color("glutes")} />
      <ellipse cx="65" cy="58" rx="5.5" ry="7" fill={color("hip_abductors")} />

      {/* front (lunging) leg: quad + shin */}
      <path d="M58,62 Q66,71 70,82" stroke={color("quads")} strokeWidth="11" strokeLinecap="round" fill="none" />
      <path d="M70,82 Q74,94 77,104" stroke={color("calves")} strokeWidth="9" strokeLinecap="round" fill="none" />
      <rect x="71" y="103" width="16" height="6" rx="3" fill={color("ankles")} />
    </svg>
  );
}

// Friendlier label for a muscle-group key, e.g. "hip_abductors" -> "Hip abductors".
function formatMuscleGroup(group: MuscleGroup): string {
  return group.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

// One row per exercise: illustration thumbnail on the left, name/sets-reps/
// note/muscle-group label on the right. This is the "horse stretch chart"
// style layout the user asked for - illustration paired directly with the
// exercise it belongs to, rather than one diagram floating above a list.
function StrengthExerciseRows({ exercises }: { exercises: StrengthExercise[] }) {
  return (
    <div className="mb-2 flex flex-col gap-2">
      {exercises.map((ex, i) => (
        <div
          key={`${ex.name}-${i}`}
          className="flex items-center gap-3 rounded-md bg-slate-50 p-2 dark:bg-slate-700/30"
        >
          <MuscleIllustration highlight={ex.muscleGroups} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="font-semibold text-slate-800 dark:text-slate-100">{ex.name}</span>
              <span className="whitespace-nowrap text-sm font-medium text-orange-600 dark:text-orange-400">
                {ex.sets} × {ex.reps}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {ex.muscleGroups.map(formatMuscleGroup).join(" · ")}
            </p>
            {ex.note && <p className="mt-0.5 text-xs italic text-slate-400 dark:text-slate-500">{ex.note}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentChart({ config, output }: { config: AgentConfig; output: AgentOutput }) {
  if (config.chart === "weekOverWeek" && output.thisWeek && output.lastWeek) {
    return <WeekComparisonChart thisWeek={output.thisWeek} lastWeek={output.lastWeek} />;
  }
  if (config.chart === "racePrediction" && output.expectedSec) {
    return (
      <RacePredictionBar
        conservativeSec={output.conservativeSec ?? 0}
        expectedSec={output.expectedSec}
        stretchSec={output.stretchSec ?? 0}
        goalSec={output.goalSec ?? null}
      />
    );
  }
  if (config.chart === "recoverySignal" && output.signal) {
    return <ReadinessGauge signal={output.signal} />;
  }
  if (config.chart === "athletePortrait" && output.stats) {
    return <PortraitStatTiles stats={output.stats} />;
  }
  if (config.chart === "strengthSession" && output.exercises) {
    return <StrengthExerciseRows exercises={output.exercises} />;
  }
  return null;
}

// Slim bar showing how far through the training block (startDate -> raceDate)
// today sits, so "Days to race" has visual context instead of being a bare number.
function TrainingProgressBar({ raceConfig }: { raceConfig: RaceConfig }) {
  const start = new Date(raceConfig.startDate).getTime();
  const race = new Date(raceConfig.raceDate).getTime();
  const totalMs = Math.max(race - start, 1);
  const percent = Math.min(100, Math.max(0, ((Date.now() - start) / totalMs) * 100));
  return (
    <div className="rounded-lg border-2 border-orange-300 bg-white p-3 shadow-sm dark:border-orange-900 dark:bg-slate-800">
      <div className="mb-1.5 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span>Training block progress</span>
        <span>{Math.round(percent)}%</span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Training block progress"
      >
        <div
          className="h-full rounded-full bg-orange-600 transition-all dark:bg-orange-400"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400 dark:text-slate-500">
        <span>Start ({new Date(raceConfig.startDate).toLocaleDateString()})</span>
        <span>Race day ({new Date(raceConfig.raceDate).toLocaleDateString()})</span>
      </div>
    </div>
  );
}

// Bar chart of weekly running volume over the last 8 weeks (Mon-Sun buckets),
// computed client-side from activities already loaded for the dashboard.
function WeeklyMileageChart({ activities }: { activities: Activity[] }) {
  const runs = activities.filter((a) => a.type === "Run");

  function mondayOf(d: Date) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  const thisMonday = mondayOf(new Date());
  const weeks = Array.from({ length: 8 }, (_, idx) => {
    const i = 7 - idx;
    const weekStart = new Date(thisMonday);
    weekStart.setDate(weekStart.getDate() - i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const km = runs
      .filter((a) => {
        const d = new Date(a.start_date_local);
        return d >= weekStart && d < weekEnd;
      })
      .reduce((sum, a) => sum + a.distance / 1000, 0);
    return { label: weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" }), km, isCurrent: i === 0 };
  });

  const max = Math.max(...weeks.map((w) => w.km), 1);
  const completedWeeks = weeks.filter((w) => !w.isCurrent);
  const avgKm = completedWeeks.length > 0 ? completedWeeks.reduce((sum, w) => sum + w.km, 0) / completedWeeks.length : 0;
  const hasRestWeeks = completedWeeks.some((w) => w.km === 0);
  const summary = weeks
    .map((w) => `week of ${w.label}: ${w.isCurrent ? "in progress, " : ""}${w.km.toFixed(1)} km`)
    .join(", ");

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-transparent dark:bg-slate-800">
      <div className="flex h-32 items-end gap-2" role="img" aria-label={`Weekly running distance, ${summary}`}>
        {weeks.map((w, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              {w.isCurrent ? "so far" : w.km > 0 ? w.km.toFixed(1) : "rest"}
            </span>
            <div
              className={
                w.isCurrent
                  ? "w-full rounded-t border-2 border-dashed border-orange-400 bg-orange-50 dark:border-orange-500 dark:bg-orange-900/20"
                  : w.km > 0
                  ? "w-full rounded-t bg-orange-400 dark:bg-orange-600"
                  : "w-full rounded-t bg-slate-200 dark:bg-slate-700"
              }
              style={{ height: `${Math.max((w.km / max) * 100, w.km > 0 ? 4 : 3)}%` }}
            />
            <span className="text-[10px] text-slate-400 dark:text-slate-500">{w.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Averaging <span className="font-semibold text-slate-700 dark:text-slate-200">{avgKm.toFixed(1)} km/week</span>{" "}
        over the last {completedWeeks.length} completed weeks.{" "}
        {hasRestWeeks && "Gray bars are weeks with no logged runs."}
      </p>
      <p className="sr-only">{summary}</p>
    </div>
  );
}

// Line chart of ACWR ratio over time with the 0.8-1.3 sweet spot shaded, so
// the training-load trend is visible at a glance instead of only living in
// the "Training load trend" card's generated prose.
function AcwrTrendChart({ history }: { history: AcwrPoint[] }) {
  const plottable = history.filter((h) => h.ratio !== null) as (AcwrPoint & { ratio: number })[];

  if (plottable.length < 2) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-transparent dark:bg-slate-800">
        <h3 className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">Training load balance</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Not enough history yet to chart a trend - check back after a few more weeks of training or "Life happened?" updates.
        </p>
      </div>
    );
  }

  const width = 600;
  const height = 130;
  const padX = 24;
  const padY = 16;
  const maxY = Math.max(1.6, ...plottable.map((p) => p.ratio));
  const xStep = (width - padX * 2) / (plottable.length - 1);

  const xFor = (i: number) => padX + i * xStep;
  const yFor = (ratio: number) => height - padY - (ratio / maxY) * (height - padY * 2);

  const points = plottable.map((p, i) => `${xFor(i)},${yFor(p.ratio)}`).join(" ");
  const sweetTop = yFor(1.3);
  const sweetBottom = yFor(0.8);
  const latest = plottable[plottable.length - 1].ratio;
  const summary = plottable.map((p) => `${new Date(p.computed_at).toLocaleDateString()}: ${p.ratio.toFixed(2)}`).join(", ");

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-transparent dark:bg-slate-800">
      <h3 className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">Training load balance</h3>
      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Are you ramping up too fast, too slow, or right on track?</p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Training load balance over ${plottable.length} readings, most recent ${latest.toFixed(2)}. ${summary}`}
      >
        <rect
          x={padX}
          y={sweetTop}
          width={width - padX * 2}
          height={Math.max(sweetBottom - sweetTop, 0)}
          className="fill-emerald-100 dark:fill-emerald-900/40"
        />
        <polyline points={points} fill="none" strokeWidth={2} className="stroke-orange-600 dark:stroke-orange-400" />
        {plottable.map((p, i) => (
          <circle key={i} cx={xFor(i)} cy={yFor(p.ratio)} r={3} className="fill-orange-700 dark:fill-orange-300" />
        ))}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500">
        <span>{new Date(plottable[0].computed_at).toLocaleDateString()}</span>
        <span className="text-emerald-600 dark:text-emerald-400">0.8-1.3 sweet spot</span>
        <span>{new Date(plottable[plottable.length - 1].computed_at).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

// Shimmering placeholder bars shown while a card is generating its first
// output. Widths are varied so it reads as "text incoming" rather than a
// uniform gray block - matches the line-clamp rhythm of the real copy.
function SkeletonLines({ variant }: { variant: "featured" | "standard" | "compact" }) {
  const barHeight = variant === "featured" ? "h-3" : variant === "compact" ? "h-2" : "h-2.5";
  const widths = ["w-full", "w-11/12", "w-4/5", "w-2/3"];
  const rows = variant === "compact" ? 2 : 3;
  return (
    <div className="animate-pulse space-y-1.5 py-0.5" role="status" aria-label="Loading">
      {widths.slice(0, rows).map((w, i) => (
        <div key={i} className={`${barHeight} ${w} rounded-full bg-slate-200 dark:bg-slate-700`} />
      ))}
    </div>
  );
}

// Chart-shaped skeleton for the four chart-backed agents, so the loading
// state doesn't visually "pop" once the real chart swaps in.
function SkeletonChart() {
  return (
    <div className="animate-pulse mb-2 flex h-20 items-end gap-1.5 rounded-md bg-slate-50 p-2 dark:bg-slate-900/40">
      {[40, 65, 50, 80, 60, 90, 70].map((h, i) => (
        <div key={i} className="flex-1 rounded-t bg-slate-200 dark:bg-slate-700" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

function AgentCard({
  config,
  state,
  onRun,
  subtitle,
}: {
  config: AgentConfig;
  state: AgentState | undefined;
  onRun: () => void;
  subtitle?: string;
}) {
  const loading = state?.loading ?? false;
  const hasOutput = !!state?.output;
  const variant: "featured" | "standard" | "compact" = config.featured
    ? "featured"
    : config.tier === "tertiary"
    ? "compact"
    : "standard";
  // Compact (reflective/look-back) cards used to start collapsed so they didn't
  // compete with cards that need action - but now that they auto-run and arrive
  // pre-filled, default them open so the info is visible without an extra tap.
  const [collapsed, setCollapsed] = useState(variant === "compact" && !config.autoRun);
  const hasBody = hasOutput || !!state?.error || !!config.emptyText;
  return (
    <div
      className={
        variant === "featured"
          ? "flex h-full flex-col rounded-lg border-2 border-orange-300 bg-orange-50 p-4 shadow-sm transition-shadow hover:shadow-md dark:border-orange-800 dark:bg-slate-800"
          : variant === "compact"
          ? "flex h-full flex-col rounded-md border border-slate-100 bg-slate-50/70 p-2.5 transition-colors hover:bg-slate-100 dark:border-slate-700/50 dark:bg-slate-800/40 dark:hover:bg-slate-800/70"
          : "flex h-full flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:border-transparent dark:bg-slate-800 dark:hover:bg-slate-800/70"
      }
    >
      <div className={collapsed ? "flex items-center justify-between gap-2" : "mb-1.5 flex items-center justify-between gap-2"}>
        <button
          onClick={() => setCollapsed((prev) => !prev)}
          disabled={!hasBody}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand" : "Collapse"}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left transition-colors enabled:hover:text-orange-700 enabled:active:text-orange-800 disabled:cursor-default disabled:opacity-70 dark:enabled:hover:text-orange-300 dark:enabled:active:text-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
        >
          {hasBody && (
            <span className={variant === "featured" ? "text-sm text-slate-500 dark:text-slate-400" : "text-xs text-slate-400 dark:text-slate-500"}>
              {collapsed ? "▶" : "▼"}
            </span>
          )}
          <h2
            className={
              variant === "featured"
                ? "truncate text-base font-semibold leading-snug dark:text-slate-100"
                : variant === "compact"
                ? "truncate text-xs font-medium leading-snug text-slate-600 dark:text-slate-300"
                : "truncate text-sm font-medium leading-snug dark:text-slate-100"
            }
          >
            {config.title}
            {subtitle && (
              <span className="ml-1.5 truncate text-xs font-normal text-slate-400 dark:text-slate-500">
                {subtitle}
              </span>
            )}
          </h2>
        </button>
        <button
          onClick={onRun}
          disabled={loading}
          className={
            variant === "compact"
              ? // Darker default border/text than other tertiary chips so this still reads
                // as clickable at rest - a washed-out gray-on-gray look is indistinguishable
                // from :disabled. Disabled state goes the other way: lighter + opacity-locked.
                "shrink-0 rounded-md border border-slate-400 px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors enabled:hover:border-slate-500 enabled:hover:bg-slate-50 enabled:active:bg-slate-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 dark:border-slate-500 dark:text-slate-200 dark:enabled:hover:bg-slate-700 dark:enabled:active:bg-slate-600 dark:disabled:border-slate-700 dark:disabled:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
              : hasOutput
              ? "shrink-0 rounded-lg border border-orange-700 px-2.5 py-1.5 text-xs font-medium text-orange-700 transition-colors enabled:hover:bg-orange-50 enabled:active:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-orange-400 dark:text-orange-300 dark:enabled:hover:bg-orange-900/30 dark:enabled:active:bg-orange-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
              : "shrink-0 rounded-lg bg-orange-700 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors enabled:hover:bg-orange-800 enabled:active:bg-orange-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
          }
        >
          {loading ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              {hasOutput ? "" : "Working..."}
            </span>
          ) : hasOutput ? (
            config.regenerateLabel
          ) : (
            config.buttonLabel
          )}
        </button>
      </div>
      {!collapsed && (
        <>
          {state?.error && <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>}
          {loading && !hasOutput ? (
            <>
              {config.chart && <SkeletonChart />}
              <SkeletonLines variant={variant} />
            </>
          ) : state?.output ? (
            <>
              {config.chart && <AgentChart config={config} output={state.output} />}
              <p
                className={
                  variant === "featured"
                    ? "scroll-soft max-h-56 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300"
                    : variant === "compact"
                    ? // No inner scrollbar here - now that these cards stack in a single
                      // column on mobile (see CategorySection), letting the card grow to
                      // fit its text means the page only ever scrolls in one direction.
                      "whitespace-pre-wrap text-xs leading-relaxed text-slate-600 dark:text-slate-400"
                    : "scroll-soft max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-300"
                }
              >
                {state.output.text}
              </p>
            </>
          ) : (
            !state?.error && <p className="text-xs text-slate-500 dark:text-slate-400">{config.emptyText}</p>
          )}
        </>
      )}
    </div>
  );
}

// One category's worth of content: the ACWR chart (run only), the featured
// card, standard cards in a grid, and compact cards in a horizontally
// swipeable row on mobile (a regular grid from sm: up). Shared between the
// always-visible desktop layout and the mobile per-tab view so the
// card-rendering logic only lives in one place.
function CategorySection({
  category,
  agentStates,
  runAgent,
  acwrHistory,
  id,
}: {
  category: AgentCategory;
  agentStates: Partial<Record<AgentKey, AgentState>>;
  runAgent: (config: AgentConfig) => void;
  acwrHistory: AcwrPoint[];
  id?: string;
}) {
  const agentsInSection = AGENTS.filter((a) => a.category === category);
  const featuredAgent = agentsInSection.find((a) => a.featured);
  const standardAgents = agentsInSection.filter((a) => !a.featured && a.tier !== "tertiary");
  const compactAgents = agentsInSection.filter((a) => !a.featured && a.tier === "tertiary");
  return (
    <div id={id} className="scroll-mt-20">
      <h2 className="mb-1 text-base font-semibold text-slate-800 dark:text-slate-100">{SECTION_LABELS[category].title}</h2>
      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{SECTION_LABELS[category].blurb}</p>
      {category === "run" && (
        <div className="mb-3">
          <AcwrTrendChart history={acwrHistory} />
        </div>
      )}
      {featuredAgent && (
        <div className="mb-3">
          <AgentCard
            config={featuredAgent}
            state={agentStates[featuredAgent.key]}
            onRun={() => runAgent(featuredAgent)}
            subtitle={featuredAgent.key === "weeklyPlan" ? currentWeekRangeLabel() : undefined}
          />
        </div>
      )}
      {standardAgents.length > 0 && (
        <div
          className={
            // Cap columns at the card count so 1-2 cards stretch to fill the row
            // instead of leaving an unused, empty-looking column on wide screens.
            standardAgents.length === 1
              ? "grid grid-cols-1 gap-3"
              : standardAgents.length === 2
              ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
              : "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          }
        >
          {standardAgents.map((config) => (
            <AgentCard
              key={config.key}
              config={config}
              state={agentStates[config.key]}
              onRun={() => runAgent(config)}
              subtitle={config.key === "weeklyPlan" ? currentWeekRangeLabel() : undefined}
            />
          ))}
        </div>
      )}
      {compactAgents.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Look-back &amp; extras
          </p>
          {/* One scroll direction at a time: a single vertical column on mobile so
              this row doesn't compete with the page's own vertical scroll, widening
              into a real grid from sm: up where there's room for side-by-side cards. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {compactAgents.map((config) => (
              <div key={config.key}>
                <AgentCard config={config} state={agentStates[config.key]} onRun={() => runAgent(config)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChatPanel({
  messages,
  input,
  setInput,
  loading,
  error,
  sendMessage,
  heightClass,
}: {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  loading: boolean;
  error: string | null;
  sendMessage: () => void;
  heightClass: string;
}) {
  return (
    <div className={`flex w-full flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 ${heightClass}`}>
      <div className="flex items-center justify-between rounded-t-lg border-b border-slate-200 bg-orange-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Ask your coach</span>
      </div>
      <div className="scroll-soft flex-1 overflow-y-auto px-3 py-2">
        {messages.length === 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Ask anything about your training — e.g. "what insights did I miss from my last run?" Answers are
            grounded in your Strava data and the insights already generated on this dashboard.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "self-end max-w-[85%] rounded-lg bg-orange-700 px-2.5 py-1.5 text-xs text-white"
                  : "self-start max-w-[85%] rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200"
              }
            >
              {m.content}
            </div>
          ))}
          {loading && (
            <div className="self-start max-w-[85%] rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-500 dark:bg-slate-700 dark:text-slate-400">
              Thinking...
            </div>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
      <div className="flex items-center gap-2 border-t border-slate-200 p-2 dark:border-slate-700">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendMessage();
          }}
          placeholder="Ask about your training..."
          className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="shrink-0 rounded-lg bg-orange-700 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors enabled:hover:bg-orange-800 enabled:active:bg-orange-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get a response");
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return { messages, input, setInput, loading, error, sendMessage };
}

// Floating chat bubble - lives on every screen size now. On mobile it sits
// above the fixed bottom nav so the two never overlap, and the popup panel
// width adapts to narrow viewports instead of the old fixed desktop width.
function FloatingChatWidget({
  open,
  setOpen,
  ...chat
}: ReturnType<typeof useChat> & { open: boolean; setOpen: (v: boolean | ((prev: boolean) => boolean)) => void }) {
  return (
    <div className="fixed bottom-20 right-4 z-50 lg:bottom-5 lg:right-5">
      {open && (
        <div className="mb-3 w-[calc(100vw-2rem)] max-w-sm rounded-lg shadow-2xl ring-1 ring-black/10 dark:shadow-black/60 dark:ring-white/10 sm:w-96">
          <ChatPanel {...chat} heightClass="h-[28rem]" />
        </div>
      )}
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? "Close chat" : "Open chat"}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-700 text-xl text-white shadow-lg transition-colors hover:bg-orange-800 active:bg-orange-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
      >
        {open ? "✕" : "💬"}
      </button>
    </div>
  );
}

function SidebarPanels({
  checkIn,
  checkInLoading,
  checkInError,
  runCheckIn,
  lifeEventNote,
  setLifeEventNote,
  lifeEventResult,
  lifeEventLoading,
  lifeEventError,
  runLifeEvent,
  recentRuns,
  niggleBodyPart,
  setNiggleBodyPart,
  niggleLogging,
  niggleError,
  logNiggle,
}: {
  checkIn: (AgentOutput & { status: string }) | null;
  checkInLoading: string | null;
  checkInError: string | null;
  runCheckIn: (status: string) => void;
  lifeEventNote: string;
  setLifeEventNote: (v: string) => void;
  lifeEventResult: (AgentOutput & { note: string }) | null;
  lifeEventLoading: boolean;
  lifeEventError: string | null;
  runLifeEvent: () => void;
  recentRuns: Activity[];
  niggleBodyPart: string | null;
  setNiggleBodyPart: (v: string | null) => void;
  niggleLogging: boolean;
  niggleError: string | null;
  logNiggle: (bodyPart: string, severity: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:border-transparent dark:bg-slate-800">
        <h2 className="mb-1 text-sm font-medium dark:text-slate-100">Daily check-in</h2>
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">How did today's session go?</p>
        <div className="flex flex-wrap gap-1.5">
          {["DONE", "TIRED", "TIME", "MOTIVATION", "INJURY"].map((status) =>
            status === "INJURY" ? (
              <button
                key={status}
                onClick={() => runCheckIn(status)}
                disabled={checkInLoading !== null}
                className="rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-700 transition-colors enabled:hover:border-red-400 enabled:hover:bg-red-100 enabled:active:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:bg-red-950 dark:text-red-300 dark:enabled:hover:bg-red-900 dark:enabled:active:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
              >
                {checkInLoading === status ? "..." : status}
              </button>
            ) : (
              <button
                key={status}
                onClick={() => runCheckIn(status)}
                disabled={checkInLoading !== null}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 transition-colors enabled:hover:border-slate-400 enabled:hover:bg-slate-50 enabled:active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-500 dark:text-slate-200 dark:enabled:hover:bg-slate-700 dark:enabled:active:bg-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
              >
                {checkInLoading === status ? "..." : status}
              </button>
            )
          )}
        </div>
        {checkInError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{checkInError}</p>}
        {checkIn && <p className="mt-2 text-xs text-slate-700 dark:text-slate-300">{checkIn.text}</p>}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:border-transparent dark:bg-slate-800">
        <h2 className="mb-1 text-sm font-medium dark:text-slate-100">Anything bothering you?</h2>
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          Tap the spot, then how bad — two taps, done. Catching a pattern early beats finding out the hard way.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {BODY_PARTS.map((part) => (
            <button
              key={part.key}
              onClick={() => setNiggleBodyPart(niggleBodyPart === part.key ? null : part.key)}
              disabled={niggleLogging}
              className={
                niggleBodyPart === part.key
                  ? "rounded-lg border border-orange-700 bg-orange-700 px-2 py-1.5 text-xs font-semibold text-white transition-colors enabled:hover:bg-orange-800 enabled:active:bg-orange-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
                  : "rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 transition-colors enabled:hover:border-slate-400 enabled:hover:bg-slate-50 enabled:active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-500 dark:text-slate-200 dark:enabled:hover:bg-slate-700 dark:enabled:active:bg-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
              }
            >
              {part.label}
            </button>
          ))}
        </div>
        {niggleBodyPart && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500 dark:text-slate-400">How bad?</span>
            {[
              { severity: 1, label: "Mild" },
              { severity: 2, label: "Noticeable" },
              { severity: 3, label: "Concerning" },
            ].map((s) => (
              <button
                key={s.severity}
                onClick={() => logNiggle(niggleBodyPart, s.severity)}
                disabled={niggleLogging}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 transition-colors enabled:hover:border-slate-400 enabled:hover:bg-slate-50 enabled:active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-500 dark:text-slate-200 dark:enabled:hover:bg-slate-700 dark:enabled:active:bg-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
              >
                {niggleLogging ? "..." : s.label}
              </button>
            ))}
          </div>
        )}
        {niggleError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{niggleError}</p>}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:border-transparent dark:bg-slate-800">
        <h2 className="mb-1 text-sm font-medium dark:text-slate-100">Life happened?</h2>
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          Skipped a session, feeling sluggish, traveling — tell your coach and get the week recalculated against
          your actual training load.
        </p>
        <div className="flex flex-col gap-1.5">
          <textarea
            value={lifeEventNote}
            onChange={(e) => setLifeEventNote(e.target.value)}
            placeholder="e.g. Skipped Tuesday's run, feeling sluggish this week"
            rows={2}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
          <button
            onClick={runLifeEvent}
            disabled={lifeEventLoading || !lifeEventNote.trim()}
            className="self-start rounded-lg bg-orange-700 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors enabled:hover:bg-orange-800 enabled:active:bg-orange-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
          >
            {lifeEventLoading ? "..." : "Recalculate my week"}
          </button>
        </div>
        {lifeEventError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{lifeEventError}</p>}
        {lifeEventResult && (
          <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-300">
            {lifeEventResult.text}
          </p>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium dark:text-slate-100">Recent runs</h2>
        <div className="flex flex-col gap-1.5">
          {recentRuns.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">No runs found yet.</p>}
          {recentRuns.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-transparent dark:bg-slate-800"
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-medium dark:text-slate-100">{a.name}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {new Date(a.start_date_local).toLocaleDateString()}
                </div>
              </div>
              <div className="shrink-0 text-right text-[11px]">
                <div className="dark:text-slate-200">{(a.distance / 1000).toFixed(1)} km</div>
                <div className="text-slate-500 dark:text-slate-400">{mpsToMinKm(a.average_speed)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Dormant unless the pattern-detection agent actually flags something - no
// point nagging the athlete with a quiet card every time they open the
// dashboard. When it does fire, it's promoted above the fold (outside the
// collapsed sidebar disclosure) since this is the one thing worth a glance
// before anything else.
function InjuryWatchCard({
  injuryWatch,
}: {
  injuryWatch: (AgentOutput & { hasPattern: boolean; flaggedBodyPart: string | null }) | null;
}) {
  if (!injuryWatch?.hasPattern) return null;
  const partLabel = BODY_PARTS.find((p) => p.key === injuryWatch.flaggedBodyPart)?.label ?? injuryWatch.flaggedBodyPart;
  return (
    <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 shadow-sm dark:border-amber-600 dark:bg-amber-950/40">
      <h2 className="mb-1 text-sm font-semibold text-amber-900 dark:text-amber-200">
        ⚠ Injury watch{partLabel ? `: ${partLabel}` : ""}
      </h2>
      <p className="text-xs text-amber-800 dark:text-amber-100">{injuryWatch.text}</p>
    </div>
  );
}

export default function Dashboard() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [raceConfig, setRaceConfig] = useState<RaceConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [agentStates, setAgentStates] = useState<Partial<Record<AgentKey, AgentState>>>({});

  const [checkIn, setCheckIn] = useState<(AgentOutput & { status: string }) | null>(null);
  const [checkInLoading, setCheckInLoading] = useState<string | null>(null);
  const [checkInError, setCheckInError] = useState<string | null>(null);

  const [lifeEventNote, setLifeEventNote] = useState("");
  const [lifeEventResult, setLifeEventResult] = useState<(AgentOutput & { note: string }) | null>(null);
  const [lifeEventLoading, setLifeEventLoading] = useState(false);
  const [lifeEventError, setLifeEventError] = useState<string | null>(null);

  const [niggleBodyPart, setNiggleBodyPart] = useState<string | null>(null);
  const [niggleLogging, setNiggleLogging] = useState(false);
  const [niggleError, setNiggleError] = useState<string | null>(null);
  const [injuryWatch, setInjuryWatch] = useState<(AgentOutput & { hasPattern: boolean; flaggedBodyPart: string | null }) | null>(
    null
  );

  const [chatWidgetOpen, setChatWidgetOpen] = useState(false);

  const [isDark, setIsDark] = useState(false);

  const [acwrHistory, setAcwrHistory] = useState<AcwrPoint[]>([]);

  // Mobile-first tab state - desktop ignores this and shows everything at
  // once via the lg: layered layout below.
  const [activeTab, setActiveTab] = useState<"home" | AgentCategory>("home");

  const chat = useChat();

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const dark = saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  function toggleTheme() {
    setIsDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  }

  useEffect(() => {
    fetch("/api/activities")
      .then((res) => {
        if (!res.ok) throw new Error("not connected or fetch failed");
        return res.json();
      })
      .then((data) => {
        setActivities(data.activities ?? []);
        setRaceConfig(data.raceConfig ?? null);
      })
      .catch(() => setError("Couldn't load your Strava data. Try reconnecting."))
      .finally(() => setLoading(false));

    // Separate, non-blocking fetch - chart still renders (in its "not enough
    // history" state) even if this fails or there's no history yet.
    fetch("/api/history/acwr")
      .then((res) => (res.ok ? res.json() : { history: [] }))
      .then((data) => setAcwrHistory(data.history ?? []))
      .catch(() => setAcwrHistory([]));
  }, []);

  // Auto-populate the handful of "primary" cards (autoRun: true) the moment
  // Strava data is in, instead of waiting for a click - this is the bit users
  // asked for so the dashboard greets them with answers, not buttons. Fires
  // once per page load and only for cards with no output yet, so it never
  // re-triggers an AI call you didn't ask for.
  const autoRunFired = useRef(false);
  useEffect(() => {
    if (autoRunFired.current) return;
    if (loading || error || !raceConfig) return;
    autoRunFired.current = true;
    AGENTS.filter((a) => a.autoRun).forEach((config) => {
      runAgent(config);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, raceConfig]);

  async function runAgent(config: AgentConfig) {
    setAgentStates((prev) => ({
      ...prev,
      [config.key]: { ...prev[config.key], loading: true, error: undefined },
    }));
    try {
      const res = await fetch(config.endpoint, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate");
      const output: AgentOutput = data[config.key];
      setAgentStates((prev) => ({ ...prev, [config.key]: { output, loading: false } }));
    } catch (err: any) {
      setAgentStates((prev) => ({
        ...prev,
        [config.key]: { ...prev[config.key], loading: false, error: err.message },
      }));
    }
  }

  async function runCheckIn(status: string) {
    setCheckInLoading(status);
    setCheckInError(null);
    try {
      const res = await fetch("/api/agents/check-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get response");
      setCheckIn(data.lastCheckIn);
    } catch (err: any) {
      setCheckInError(err.message);
    } finally {
      setCheckInLoading(null);
    }
  }

  async function runLifeEvent() {
    const note = lifeEventNote.trim();
    if (!note || lifeEventLoading) return;
    setLifeEventLoading(true);
    setLifeEventError(null);
    try {
      const res = await fetch("/api/agents/life-event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get a response");
      setLifeEventResult(data.lifeEventReplan);
      setLifeEventNote("");
    } catch (err: any) {
      setLifeEventError(err.message);
    } finally {
      setLifeEventLoading(false);
    }
  }

  async function logNiggle(bodyPart: string, severity: number) {
    if (niggleLogging) return;
    setNiggleLogging(true);
    setNiggleError(null);
    try {
      const res = await fetch("/api/niggles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bodyPart, severity }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to log that");
      setInjuryWatch(data.injuryWatch);
      setNiggleBodyPart(null);
    } catch (err: any) {
      setNiggleError(err.message);
    } finally {
      setNiggleLogging(false);
    }
  }

  if (loading)
    return <main className="p-12 text-center text-slate-500 dark:text-slate-400">Loading your training data...</main>;

  if (error) {
    return (
      <main className="mx-auto max-w-md p-12 text-center">
        <p className="mb-4 text-slate-600 dark:text-slate-300">{error}</p>
        <a href="/api/auth/strava" className="rounded-lg bg-orange-700 px-6 py-3 font-medium text-white">
          Reconnect Strava
        </a>
      </main>
    );
  }

  const runs = activities.filter((a) => a.type === "Run");
  const recentRuns = runs.slice(0, 8);
  const totalKmLast30 = runs
    .filter((a) => Date.now() - new Date(a.start_date_local).getTime() < 30 * 24 * 60 * 60 * 1000)
    .reduce((sum, a) => sum + a.distance / 1000, 0);

  const avgRecentPaceSec =
    recentRuns.length > 0
      ? recentRuns.reduce((sum, a) => sum + 1000 / a.average_speed, 0) / recentRuns.length
      : 0;

  const raceDistanceKm = raceConfig ? DISTANCE_KM[raceConfig.distance] ?? 21.1 : 21.1;
  const terrain = raceConfig?.terrain ?? "flat";
  const predictedSec = avgRecentPaceSec ? predictFinishTime(avgRecentPaceSec, raceDistanceKm, terrain) : 0;

  const sidebarPanels = (
    <SidebarPanels
      checkIn={checkIn}
      checkInLoading={checkInLoading}
      checkInError={checkInError}
      runCheckIn={runCheckIn}
      lifeEventNote={lifeEventNote}
      setLifeEventNote={setLifeEventNote}
      lifeEventResult={lifeEventResult}
      lifeEventLoading={lifeEventLoading}
      lifeEventError={lifeEventError}
      runLifeEvent={runLifeEvent}
      recentRuns={recentRuns}
      niggleBodyPart={niggleBodyPart}
      setNiggleBodyPart={setNiggleBodyPart}
      niggleLogging={niggleLogging}
      niggleError={niggleError}
      logNiggle={logNiggle}
    />
  );

  const overviewStrip = raceConfig && (
    <>
      <div className="grid grid-cols-3 gap-2 text-center lg:gap-3">
        <div className="rounded-lg border-2 border-orange-300 bg-white p-2 shadow-sm transition-shadow hover:shadow-md dark:border-orange-900 dark:bg-slate-800 lg:p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 lg:text-xs">Days to race</div>
          <div className="text-lg font-bold text-orange-700 dark:text-orange-300 lg:text-2xl">{daysUntil(raceConfig.raceDate)}</div>
        </div>
        <div className="rounded-lg border-2 border-orange-300 bg-white p-2 shadow-sm transition-shadow hover:shadow-md dark:border-orange-900 dark:bg-slate-800 lg:p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 lg:text-xs">Last 30 days</div>
          <div className="text-lg font-bold text-orange-700 dark:text-orange-300 lg:text-2xl">{totalKmLast30.toFixed(1)} km</div>
        </div>
        <div className="rounded-lg border-2 border-orange-300 bg-white p-2 shadow-sm transition-shadow hover:shadow-md dark:border-orange-900 dark:bg-slate-800 lg:p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 lg:text-xs">Predicted finish</div>
          <div className="text-lg font-bold text-orange-700 dark:text-orange-300 lg:text-2xl">
            {predictedSec ? formatSecAsTime(predictedSec) : "-"}
          </div>
        </div>
      </div>
      <TrainingProgressBar raceConfig={raceConfig} />
      {/* Home is the "glance and go" page - keep it to the handful of numbers above.
          Everything else, including the trend chart, is one tap away rather than on by default. */}
      <details className="group rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
        <summary className="cursor-pointer list-none text-sm font-medium text-slate-700 dark:text-slate-200">
          <span className="inline-block transition-transform group-open:rotate-90">▶</span> 8-week mileage chart
        </summary>
        <div className="pt-2">
          <WeeklyMileageChart activities={activities} />
        </div>
      </details>
    </>
  );

  return (
    <main className="mx-auto max-w-7xl pb-20">
      {/* Sticky compact header - condensed on mobile, same content on desktop */}
      <div className="sticky top-0 z-30 mb-3 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-900">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold leading-tight dark:text-slate-100 lg:text-xl">
            {raceConfig?.raceName || "Your training"}
          </h1>
          {raceConfig && (
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400 lg:text-xs">
              {daysUntil(raceConfig.raceDate)}d to go · Goal {raceConfig.goalTime || "not set"} · {raceConfig.terrain}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            aria-pressed={isDark}
            className="flex shrink-0 items-center gap-1.5 rounded-full px-1 py-1 transition-colors hover:bg-slate-100 active:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 dark:hover:bg-slate-800 dark:active:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
          >
            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">{isDark ? "Dark" : "Light"}</span>
            <span
              className={
                isDark
                  ? "relative h-7 w-14 rounded-full border border-slate-700 bg-slate-900 p-0.5 transition-colors duration-300"
                  : "relative h-7 w-14 rounded-full border border-amber-200 bg-amber-100 p-0.5 transition-colors duration-300"
              }
            >
              <span
                className={
                  isDark
                    ? "flex h-6 w-6 translate-x-7 items-center justify-center rounded-full bg-sky-500 text-xs shadow-sm transition-transform duration-300"
                    : "flex h-6 w-6 translate-x-0 items-center justify-center rounded-full bg-amber-400 text-xs shadow-sm transition-transform duration-300"
                }
              >
                {isDark ? "🌙" : "☀️"}
              </span>
            </span>
          </button>
          <Link
            href="/setup"
            className="hidden rounded text-sm font-medium text-orange-700 underline transition-colors hover:text-orange-800 active:text-orange-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 dark:text-orange-300 dark:hover:text-orange-200 dark:focus-visible:ring-offset-slate-900 lg:inline"
          >
            Edit race details
          </Link>
          <form action="/api/auth/logout" method="POST" className="hidden lg:block">
            <button
              type="submit"
              className="rounded text-sm font-medium text-slate-500 underline transition-colors hover:text-slate-700 active:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 dark:text-slate-400 dark:hover:text-slate-200 dark:active:text-slate-100 dark:focus-visible:ring-offset-slate-900"
            >
              Disconnect Strava
            </button>
          </form>
        </div>
      </div>

      {/* One tab = one page, at every width. Home, Run, Workout, and Fueling are now
          genuinely separate views - switching tabs swaps what's rendered instead of
          scrolling to a section, so Run never shows workout/fueling content and vice
          versa. Home is deliberately thin: just the handful of numbers a runner wants
          at a glance, not the whole dashboard. */}
      <div className="px-4">
        {activeTab === "home" && (
          <div className="mx-auto flex max-w-2xl flex-col gap-3 lg:gap-4 lg:py-4">{overviewStrip}</div>
        )}

        {activeTab === "run" && (
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-4 lg:gap-4">
            <div className="flex flex-col gap-4 lg:col-span-3">
              <CategorySection category="run" agentStates={agentStates} runAgent={runAgent} acwrHistory={acwrHistory} />
            </div>
            <div className="flex flex-col gap-4 lg:col-span-1">
              <InjuryWatchCard injuryWatch={injuryWatch} />
              {/* Check-in / life events / recent runs: useful but secondary, tucked behind one tap on mobile */}
              <details className="group rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 lg:hidden">
                <summary className="cursor-pointer list-none text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span> Check-in, life updates &amp; recent runs
                </summary>
                <div className="mt-3 flex flex-col gap-4">{sidebarPanels}</div>
              </details>
              <div className="hidden lg:flex lg:flex-col lg:gap-4">{sidebarPanels}</div>
            </div>
          </div>
        )}

        {activeTab === "workout" && (
          <CategorySection category="workout" agentStates={agentStates} runAgent={runAgent} acwrHistory={acwrHistory} />
        )}

        {activeTab === "fueling" && (
          <CategorySection category="fueling" agentStates={agentStates} runAgent={runAgent} acwrHistory={acwrHistory} />
        )}
      </div>

      {/* Bottom tab bar - persists at every width and fully swaps the page content on click.
          Chat isn't a tab anymore - it's a floating widget that lives on top of all of this. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-700 dark:bg-slate-900">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className={
              activeTab === tab.key
                ? "flex flex-1 flex-col items-center gap-0.5 py-2 text-orange-700 transition-colors hover:bg-orange-50 active:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-inset dark:text-orange-300 dark:hover:bg-orange-900/20 dark:active:bg-orange-900/40"
                : "flex flex-1 flex-col items-center gap-0.5 py-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-inset dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300 dark:active:bg-slate-700"
            }
            aria-current={activeTab === tab.key}
          >
            <span
              className={
                activeTab === tab.key
                  ? "flex h-7 w-7 items-center justify-center rounded-md border-2 border-orange-500 bg-orange-50 text-lg leading-none dark:border-orange-400 dark:bg-orange-900/30"
                  : "flex h-7 w-7 items-center justify-center rounded-md border-2 border-transparent text-lg leading-none"
              }
            >
              {tab.icon}
            </span>
            <span className="text-[10px] font-medium">{tab.label}</span>
          </button>
        ))}
      </nav>

      <FloatingChatWidget {...chat} open={chatWidgetOpen} setOpen={setChatWidgetOpen} />
    </main>
  );
}
