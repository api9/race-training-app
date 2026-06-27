// Shared types for the device-side health adapters (iOS HealthKit, Android
// Health Connect). These mirror lib/health.ts on the server exactly - the
// whole point of normalizing here, on-device, is that the server never has
// to know which platform a reading came from.

export type HealthSource = "apple_health" | "health_connect";

export type HealthMetric =
  | "steps"
  | "resting_heart_rate"
  | "hrv"
  | "sleep_minutes"
  | "weight_kg"
  | "active_energy_kcal"
  | "workout";

export type HealthSample = {
  source: HealthSource;
  metric: HealthMetric;
  value: number;
  unit: string;
  recordedAt: string; // ISO timestamp
  raw?: Record<string, unknown>;
};

// One adapter per platform, same shape both ways - index.ts picks whichever
// matches Platform.OS and the rest of the app never branches on platform.
export interface HealthAdapter {
  // Ask the OS for permission to read the metrics this app cares about.
  // Returns which metrics were actually granted - the caller should only
  // request samples for metrics that come back true, since HealthKit/Health
  // Connect both allow partial grants (e.g. steps yes, sleep no).
  requestPermissions(): Promise<Partial<Record<HealthMetric, boolean>>>;

  // Pull everything new since `sinceDays` ago, across every metric the app
  // has permission for. Broad/everything-available scope for now per current
  // plan - narrowing to just what agents actually use is a later pass once
  // there's real device data to look at.
  fetchSamples(sinceDays: number): Promise<HealthSample[]>;
}
