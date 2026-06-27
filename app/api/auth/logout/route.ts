import { NextRequest, NextResponse } from "next/server";
import { clearSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  clearSession();
  return NextResponse.redirect(new URL("/", req.url));
}
