// Entry point for the health data layer: picks the right platform adapter
// and pushes whatever it returns to the existing Next.js/Supabase backend.
// No UI here on purpose - screens come later, this is just sync plumbing.
import { Platform } from "react-native";
import type { HealthAdapter, HealthMetric, HealthSample } from "./types";
import { appleHealthAdapter } from "./ios";
import { healthConnectAdapter } from "./android";

export type { HealthAdapter, HealthMetric, HealthSample, HealthSource } from "./types";

function getAdapter(): HealthAdapter | null {
  if (Platform.OS === "ios") return appleHealthAdapter;
  if (Platform.OS === "android") return healthConnectAdapter;
  return null; // web/other - no health API to read from
}

export type SyncResult =
  | { ok: true; synced: number; skipped: number }
  | { ok: false; reason: "unsupported_platform" | "no_permissions" | "request_failed"; error?: string };

// Full round trip: request permissions (if not already granted), pull
// recent samples, POST them to /api/health/sync.
//
// `apiBaseUrl` should point at wherever the Next.js app is reachable from the
// device (e.g. the deployed URL, or a LAN address during local dev).
// `athleteId` is required here because the native app has no httpOnly cookie
// session to piggyback on - see the auth note in app/api/health/sync/route.ts.
export async function syncHealthData(
  apiBaseUrl: string,
  athleteId: number,
  sinceDays = 7
): Promise<SyncResult> {
  const adapter = getAdapter();
  if (!adapter) {
    return { ok: false, reason: "unsupported_platform" };
  }

  const granted = await adapter.requestPermissions();
  const hasAnyPermission = Object.values(granted).some(Boolean);
  if (!hasAnyPermission) {
    return { ok: false, reason: "no_permissions" };
  }

  const samples = await adapter.fetchSamples(sinceDays);
  if (samples.length === 0) {
    return { ok: true, synced: 0, skipped: 0 };
  }

  try {
    const res = await fetch(`${apiBaseUrl}/api/health/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ athleteId, samples }),
    });

    const body = await res.json();
    if (!res.ok) {
      return { ok: false, reason: "request_failed", error: body?.error ?? `HTTP ${res.status}` };
    }

    return { ok: true, synced: body.synced ?? 0, skipped: body.skipped ?? 0 };
  } catch (err: any) {
    return { ok: false, reason: "request_failed", error: err?.message };
  }
}
