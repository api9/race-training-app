const STRAVA_API = "https://www.strava.com/api/v3";

export type Activity = {
  id: number;
  name: string;
  distance: number;
  moving_time: number;
  average_speed: number;
  start_date: string;
  // Strava actually returns these too - declaring them so server-side agent
  // code (week-over-week comparison, etc.) can filter to runs and use local
  // dates the same way the dashboard's own Activity type already does.
  type?: string;
  start_date_local?: string;
};

export async function exchangeCodeForToken(code: string) {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Strava token exchange failed: ${res.status}`);
  return res.json();
}

export async function refreshToken(refresh_token: string) {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${res.status}`);
  return res.json();
}

export async function getActivities(accessToken: string, perPage = 30) {
  const res = await fetch(`${STRAVA_API}/athlete/activities?per_page=${perPage}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava activities fetch failed: ${res.status}`);
  return res.json();
}

// Strava gives speed in meters/second - convert to min/km for display
export function mpsToMinKm(mps: number): string {
  if (!mps) return "-";
  const secPerKm = 1000 / mps;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}/km`;
}
