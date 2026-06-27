# Race Training App (web MVP)

A standalone web app version of the race-training-agents system. Runs outside Cowork - connects directly to your own Strava account via OAuth, no Claude/Cowork dependency.

This is a v1 MVP: one data source (Strava), session stored in a single cookie (good for a demo / one browser, not yet multi-device accounts), and no scheduled "agents" yet - just the setup form and a live dashboard. See the architecture plan doc for what's next (agents, more data sources, mobile).

## Run it locally

1. Install dependencies:
   ```
   npm install
   ```
2. Register a Strava API app at https://www.strava.com/settings/api
   - Authorization Callback Domain: `localhost` (for local dev)
3. Copy `.env.example` to `.env.local` and fill in your Strava client ID/secret:
   ```
   cp .env.example .env.local
   ```
4. Run the dev server:
   ```
   npm run dev
   ```
5. Open http://localhost:3000

## Deploy it for real (so others can use it)

1. Push this folder to a GitHub repo.
2. Go to https://vercel.com, import the repo (free Hobby tier is fine to start).
3. In Vercel's project settings, add the same environment variables from `.env.example` - but set `STRAVA_REDIRECT_URI` to your real domain, e.g. `https://your-app.vercel.app/api/auth/strava/callback`.
4. Update your Strava API app's "Authorization Callback Domain" to match your real domain (just the domain, e.g. `your-app.vercel.app`).
5. Deploy. Done - anyone can now visit your URL, connect their own Strava, and see their dashboard.

## What's deliberately not built yet

- **Accounts/database** - right now "login" just means "connected Strava in this browser." Multiple people using the same browser will overwrite each other's session. Next step: add a real user table (Supabase works well) and swap the cookie session for a database-backed one.
- **Scheduled agents** - the 9 training agents (coach, recovery, strength, etc.) aren't wired up yet. They'd run as serverless cron jobs calling the Claude API with the same prompts already written for the Cowork plugin (see `race-training-agents/skills/setup-race-training/references/` in that plugin's files).
- **Apple Health / Health Connect / other data sources** - see the architecture plan doc for why these need native mobile code rather than a backend integration.
- **Notifications/email** - not wired up; would use a transactional email provider (Resend, SendGrid) or Expo push once the mobile app exists.
