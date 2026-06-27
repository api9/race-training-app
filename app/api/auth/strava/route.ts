import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID || "",
    redirect_uri: process.env.STRAVA_REDIRECT_URI || "",
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all,profile:read_all",
  });
  return NextResponse.redirect(`https://www.strava.com/oauth/authorize?${params.toString()}`);
}
