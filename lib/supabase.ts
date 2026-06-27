// Server-side Supabase client. Uses the service-role key, so this file must
// only ever be imported from server code (API routes, server components) -
// never shipped to the browser.
//
// Setup (you do this part, not Claude/this codebase):
//   1. Create a project at https://supabase.com
//   2. Project Settings -> API -> copy "Project URL" and "service_role" key
//   3. Paste them into .env.local as SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
//   4. Run supabase/schema.sql in the SQL editor (Supabase dashboard -> SQL Editor)
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

// Lazily constructed so importing this file doesn't throw at build time if
// the env vars aren't set yet - only calling getSupabase() does.
export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase isn't configured yet - set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (see .env.example)."
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false },
  });
  return cached;
}

// True once the env vars are present, so callers can skip persistence
// gracefully instead of crashing while the user hasn't set up Supabase yet.
export function isSupabaseConfigured(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}
