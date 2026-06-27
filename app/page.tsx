import { getSession } from "@/lib/session";
import Link from "next/link";

export default function Home() {
  const session = getSession();
  const connected = Boolean(session.stravaAccessToken);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-semibold">Race Training</h1>
      <p className="text-slate-600">
        Personalized training built from your own run data - no spreadsheets, no guesswork.
      </p>

      {connected ? (
        <Link
          href="/setup"
          className="rounded-lg bg-orange-600 px-6 py-3 font-medium text-white hover:bg-orange-700"
        >
          Continue to setup
        </Link>
      ) : (
        <a
          href="/api/auth/strava"
          className="rounded-lg bg-orange-600 px-6 py-3 font-medium text-white hover:bg-orange-700"
        >
          Connect Strava to get started
        </a>
      )}

      <p className="text-xs text-slate-400">
        This is a v1 demo - one source (Strava) for now. Apple Health / Health Connect support
        is planned for the native mobile build.
      </p>
    </main>
  );
}
