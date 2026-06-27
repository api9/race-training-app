// Android Health Connect adapter, built against `react-native-health-connect`
// (matinzd/react-native-health-connect, the actively maintained one). Like
// ios.ts, this is written from the published docs and hasn't been run
// against a real device - it needs a custom Expo dev client
// (`expo prebuild` + `expo run:android`) to test, which doesn't exist in
// this environment. Double-check each record's field shape against the
// installed version before shipping (docs:
// https://matinzd.github.io/react-native-health-connect/).
import {
  initialize,
  requestPermission,
  readRecords,
  type RecordType,
} from "react-native-health-connect";
import type { HealthAdapter, HealthMetric, HealthSample } from "./types";

// Health Connect record types for each metric - same rationale as
// READ_PERMISSIONS in ios.ts, isolate the library's naming in one place.
const RECORD_TYPES: Record<HealthMetric, RecordType> = {
  steps: "Steps",
  resting_heart_rate: "RestingHeartRate",
  hrv: "HeartRateVariabilityRmssd",
  sleep_minutes: "SleepSession",
  weight_kg: "Weight",
  active_energy_kcal: "ActiveCaloriesBurned",
  workout: "ExerciseSession",
};

const ALL_METRICS = Object.keys(RECORD_TYPES) as HealthMetric[];

function isoSince(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export const healthConnectAdapter: HealthAdapter = {
  async requestPermissions(): Promise<Partial<Record<HealthMetric, boolean>>> {
    const isInitialized = await initialize();
    if (!isInitialized) {
      console.warn("healthConnectAdapter: Health Connect failed to initialize (not installed on this device?)");
      return {};
    }

    const granted = await requestPermission(
      ALL_METRICS.map((metric) => ({ accessType: "read" as const, recordType: RECORD_TYPES[metric] }))
    );

    // requestPermission resolves with the list actually granted, which may
    // be a subset of what was asked for - map back to our metric names so
    // fetchSamples knows what's worth querying.
    const grantedRecordTypes = new Set(granted.map((p) => p.recordType));
    const result: Partial<Record<HealthMetric, boolean>> = {};
    for (const metric of ALL_METRICS) {
      result[metric] = grantedRecordTypes.has(RECORD_TYPES[metric]);
    }
    return result;
  },

  async fetchSamples(sinceDays: number): Promise<HealthSample[]> {
    const startTime = isoSince(sinceDays);
    const endTime = new Date().toISOString();
    const timeRangeFilter = { operator: "between" as const, startTime, endTime };
    const samples: HealthSample[] = [];

    // Steps - one row per recorded interval, `count` is the field name.
    const { records: stepsRecords } = await readRecords("Steps", { timeRangeFilter }).catch(() => ({ records: [] as any[] }));
    for (const r of stepsRecords ?? []) {
      samples.push({ source: "health_connect", metric: "steps", value: r.count, unit: "count", recordedAt: r.startTime });
    }

    // Resting heart rate - single bpm reading per record.
    const { records: rhrRecords } = await readRecords("RestingHeartRate", { timeRangeFilter }).catch(() => ({ records: [] as any[] }));
    for (const r of rhrRecords ?? []) {
      samples.push({ source: "health_connect", metric: "resting_heart_rate", value: r.beatsPerMinute, unit: "bpm", recordedAt: r.time });
    }

    // HRV (RMSSD) - single ms reading per record.
    const { records: hrvRecords } = await readRecords("HeartRateVariabilityRmssd", { timeRangeFilter }).catch(() => ({ records: [] as any[] }));
    for (const r of hrvRecords ?? []) {
      samples.push({ source: "health_connect", metric: "hrv", value: r.heartRateVariabilityMillis, unit: "ms", recordedAt: r.time });
    }

    // Sleep - session has start/end, not a duration field directly; compute
    // minutes the same way the iOS adapter does, for the same reason (keep
    // the normalized shape metric-agnostic).
    const { records: sleepRecords } = await readRecords("SleepSession", { timeRangeFilter }).catch(() => ({ records: [] as any[] }));
    for (const r of sleepRecords ?? []) {
      const minutes = (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000;
      samples.push({
        source: "health_connect",
        metric: "sleep_minutes",
        value: Math.round(minutes),
        unit: "minutes",
        recordedAt: r.startTime,
        raw: { endTime: r.endTime, stages: r.stages },
      });
    }

    // Weight - reported in kilograms via a nested unit-conversion object.
    const { records: weightRecords } = await readRecords("Weight", { timeRangeFilter }).catch(() => ({ records: [] as any[] }));
    for (const r of weightRecords ?? []) {
      samples.push({ source: "health_connect", metric: "weight_kg", value: r.weight?.inKilograms, unit: "kg", recordedAt: r.time });
    }

    // Active calories - same nested-unit pattern as weight.
    const { records: energyRecords } = await readRecords("ActiveCaloriesBurned", { timeRangeFilter }).catch(() => ({ records: [] as any[] }));
    for (const r of energyRecords ?? []) {
      samples.push({
        source: "health_connect",
        metric: "active_energy_kcal",
        value: r.energy?.inKilocalories,
        unit: "kcal",
        recordedAt: r.startTime,
      });
    }

    // Exercise sessions - duration computed from start/end like sleep;
    // exercise type and any title go in `raw` since they don't fit the
    // normalized value/unit pair.
    const { records: exerciseRecords } = await readRecords("ExerciseSession", { timeRangeFilter }).catch(() => ({ records: [] as any[] }));
    for (const r of exerciseRecords ?? []) {
      const seconds = (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 1000;
      samples.push({
        source: "health_connect",
        metric: "workout",
        value: Math.round(seconds),
        unit: "seconds",
        recordedAt: r.startTime,
        raw: { exerciseType: r.exerciseType, title: r.title, endTime: r.endTime },
      });
    }

    return samples;
  },
};
