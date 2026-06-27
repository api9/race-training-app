import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAcwrHistory } from "@/lib/history";

// Read-only endpoint for the dashboard's ACWR trend chart. Separate from
// /api/agents/acwr-retrospective (which generates a narrative and costs a
// Claude call) - this just returns the raw snapshot history so the chart can
// render without spending an LLM call every time the dashboard loads.
export async function GET() {
  const session = getSession();
  if (!session.athleteId) {
    return NextResponse.json({ history: [] });
  }

  const history = await getAcwrHistory(session.athleteId);
  return NextResponse.json({ history });
}
