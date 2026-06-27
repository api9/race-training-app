import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/strava";
import { getSession, setSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/?error=missing_code", req.url));
  }

  try {
    const tokenData = await exchangeCodeForToken(code);
    const session = getSession();
    setSession({
      ...session,
      stravaAccessToken: tokenData.access_token,
      stravaRefreshToken: tokenData.refresh_token,
      stravaExpiresAt: tokenData.expires_at,
      athleteName: tokenData.athlete
        ? `${tokenData.athlete.firstname} ${tokenData.athlete.lastname}`.trim()
        : undefined,
      athleteId: tokenData.athlete?.id,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.redirect(new URL("/?error=strava_auth_failed", req.url));
  }

  return NextResponse.redirect(new URL("/setup", req.url));
}
