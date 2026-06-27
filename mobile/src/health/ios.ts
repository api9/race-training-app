// Apple HealthKit adapter, built against `react-native-health`
// (agencyenterprise/react-native-health). HealthKit has no JS/web
// equivalent, so none of this has actually been run yet - it needs a custom
// Expo dev client (`expo prebuild` + `expo run:ios`) to test against, which
// doesn't exist in this environment. Treat this as "written from the docs,
// not yet verified" and double-check each call against whatever version
// actually lands in node_modules before shipping (docs:
// https://github.com/agencyenterprise/react-native-health).
import AppleHealthKit, {
  type HealthInputOptions,
  type HealthKitPermissions,
} from "react-native-health";
import type { HealthAdapter, HealthMetric, HealthSample } from "./types";

// HealthKit permission identifiers for each metric we care about - this is
// what gets requested from the user, separate from HEALTHKIT_TYPES below
// (which is just for labeling samples once we have them).
const PERMS = AppleHealthKit.Constants.Permissions;

const READ_PERMISSIONS: Record<HealthMetric, string> = {
  steps: PERMS.Steps,
  resting_heart_rate: PERMS.RestingHeartRate,
  hrv: PERMS.HeartRateVariability,
  sleep_minutes: PERMS.SleepAnalysis,
  weight_kg: PERMS.Weight,
  active_energy_kcal: PERMS.ActiveEnergyBurned,
  workout: PERMS.Workout,
};

const ALL_METRICS = Object.keys(READ_PERMISSIONS) as HealthMetric[];

function initHealthKit(): Promise<void> {
  const permissions: HealthKitPermissions = {
    permissions: {
      read: Object.values(READ_PERMISSIONS),
      write: [],
    },
  };

  return new Promise((resolve, reject) => {
    AppleHealthKit.initHealthKit(permissions, (err: string) => {
      if (err) {
        reject(new Error(err));
      } else {
        resolve();
      }
    });
  });
}

// react-native-health's API is callback-based (err, results) rather than
// promise-based - this wraps each call so the rest of the adapter can use
// async/await like the Health Connect side does.
function callbackToPromise<T>(
  fn: (options: HealthInputOptions, callback: (err: string, results: T) => void) => void,
  options: HealthInputOptions
): Promise<T | null> {
  return new Promise((resolve) => {
    fn(options, (err: string, results: T) => {
      if (err) {
        console.warn("HealthKit query failed:", err);
        resolve(null);
      } else {
        resolve(results);
      }
    });
  });
}

function isoSince(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export const appleHealthAdapter: HealthAdapter = {
  async requestPermissions(): Promise<Partial<Record<HealthMetric, boolean>>> {
    try {
      await initHealthKit();
    } catch (err) {
      console.warn("appleHealthAdapter: initHealthKit failed -", err);
      return {};
    }

    // HealthKit's init callback doesn't tell us per-type grant/deny (Apple
    // hides that from apps by design, to prevent fingerprinting which types
    // a user declined). The best we can do here is assume everything we
    // asked for was granted and let fetchSamples come back empty for
    // anything actually denied - which is indistinguishable from "no data
    // yet" but at least doesn't crash.
    const granted: Partial<Record<HealthMetric, boolean>> = {};
    for (const metric of ALL_METRICS) granted[metric] = true;
    return granted;
  },

  async fetchSamples(sinceDays: number): Promise<HealthSample[]> {
    const startDate = isoSince(sinceDays);
    const options: HealthInputOptions = { startDate };
    const samples: HealthSample[] = [];

    const [steps, restingHr, hrv, sleep, weight, activeEnergy] = await Promise.all([
      callbackToPromise(AppleHealthKit.getDailyStepCountSamples, options),
      callbackToPromise(AppleHealthKit.getRestingHeartRateSamples, options),
      callbackToPromise(AppleHealthKit.getHeartRateVariabilitySamples, options),
      callbackToPromise(AppleHealthKit.getSleepSamples, options),
      callbackToPromise(AppleHealthKit.getWeightSamples, options),
      callbackToPromise(AppleHealthKit.getActiveEnergyBurned, options),
    ]);

    for (const s of steps ?? []) {
      samples.push({ source: "apple_health", metric: "steps", value: s.value, unit: "count", recordedAt: s.startDate });
    }
    for (const s of restingHr ?? []) {
      samples.push({ source: "apple_health", metric: "resting_heart_rate", value: s.value, unit: "bpm", recordedAt: s.startDate });
    }
    for (const s of hrv ?? []) {
      samples.push({ source: "apple_health", metric: "hrv", value: s.value, unit: "ms", recordedAt: s.startDate });
    }
    for (const s of sleep ?? []) {
      // HealthKit reports sleep as start/end timestamps per segment, not a
      // duration - compute minutes here so the server-side shape stays
      // metric-agnostic (a single numeric value + unit).
      const minutes = (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 60000;
      samples.push({
        source: "apple_health",
        metric: "sleep_minutes",
        value: Math.round(minutes),
        unit: "minutes",
        recordedAt: s.startDate,
        raw: { endDate: s.endDate, value: (s as any).value },
      });
    }
    for (const s of weight ?? []) {
      samples.push({ source: "apple_health", metric: "weight_kg", value: s.value, unit: "kg", recordedAt: s.startDate });
    }
    for (const s of activeEnergy ?? []) {
      samples.push({ source: "apple_health", metric: "active_energy_kcal", value: s.value, unit: "kcal", recordedAt: s.startDate });
    }

    // Workouts use a different query shape (getAnchoredWorkouts) and carry
    // useful extras (type, distance) that don't fit the normalized
    // value/unit pair - stash them in `raw` rather than dropping them.
    const workoutResult = await new Promise<any>((resolve) => {
      AppleHealthKit.getAnchoredWorkouts(options, (err: string, results: any) => {
        if (err) {
          console.warn("HealthKit getAnchoredWorkouts failed:", err);
          resolve(null);
        } else {
          resolve(results);
        }
      });
    });

    for (const w of workoutResult?.data ?? []) {
      samples.push({
        source: "apple_health",
        metric: "workout",
        value: w.duration ?? 0,
        unit: "seconds",
        recordedAt: w.start,
        raw: { activityName: w.activityName, distance: w.distance, end: w.end },
      });
    }

    return samples;
  },
};
