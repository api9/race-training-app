# Race Training — mobile (data layer only, no screens yet)

This folder is the start of the native mobile build the web app's "Apple
Health / Health Connect support is planned" line was promising. Right now it
contains **only** the health sync data layer — `src/health/` — no app UI.
That's deliberate: the sync logic is reusable no matter what the eventual
screens look like, so it made sense to build it first.

## Why React Native + Expo (recommendation)

You said framework choice was undecided, so here's the call and the reasoning:

**React Native with Expo, using a custom dev client (not Expo Go).** A few
reasons this beats the alternatives for this project specifically:

- The existing backend is a Next.js/TypeScript/Supabase app. RN keeps you in
  the same language and a lot of the same mental model (components, hooks,
  fetch calls to the same API). Capacitor (wrapping the existing Next.js
  pages in a WebView) was the other realistic option, but HealthKit/Health
  Connect access from a WebView is awkward — you'd still need a native
  bridge plugin, at which point you've recreated RN's job with less
  ecosystem support.
- Flutter/native Swift+Kotlin would both work technically, but neither
  reuses any of your existing TypeScript, and you'd be maintaining business
  logic in two completely separate codebases instead of one.
- Expo specifically (vs. bare RN) because its tooling (EAS Build, prebuild)
  removes most of the historical pain of RN native builds — the one catch is
  that **HealthKit and Health Connect both require real native modules that
  Expo Go can't load**, so you need `expo-dev-client` and your own build
  (`expo prebuild` + `expo run:ios` / `expo run:android`), not the Expo Go
  app from the store. `app.json` here is already configured for that path.

## What's actually implemented

- `src/health/types.ts` — shared `HealthSample`/`HealthMetric` types and the
  `HealthAdapter` interface, mirroring `lib/health.ts` on the server exactly.
- `src/health/ios.ts` / `src/health/android.ts` — real calls into
  `react-native-health` (HealthKit) and `react-native-health-connect`
  (Health Connect), written against each library's published docs. **Not
  yet run against a real device** — there's no Mac/Xcode or Android Studio
  in the environment this was built in, so treat these as "written
  correctly per the docs, unverified in practice" until you build a dev
  client and test them. Likely first frictions: exact field names on
  returned records (e.g. Health Connect's nested `energy.inKilocalories`
  shape, or whether `getAnchoredWorkouts`' result shape matches what's
  coded here) tend to drift slightly between library versions.
- `src/health/index.ts` — `syncHealthData(apiBaseUrl, athleteId, sinceDays)`:
  picks the right adapter for the platform, requests permissions, fetches
  samples, and POSTs them to the web app's `/api/health/sync`.

## What's NOT here yet (by design — "data layer now, UI later")

- No screens, no navigation, no App.tsx entry point.
- No real-device verification — the HealthKit/Health Connect calls in
  `ios.ts`/`android.ts` are implemented but unrun (see above).
- No per-device auth token. `syncHealthData` currently takes `athleteId`
  directly, which the server trusts as long as that athlete already exists
  (i.e., has connected Strava once via the web app). That's fine for
  personal/MVP use; before sharing this with anyone else, swap it for a real
  per-device token issued at pairing time.

## Setting up test builds (Android + iOS)

You're on Windows, which means Android can be built locally but iOS has to
go through Expo's cloud build service (EAS Build) since Xcode only runs on
macOS. `eas.json` in this folder already has a `development` profile
configured for both platforms — once your accounts exist below, the actual
build commands are short.

### Accounts you need to create yourself (I can't do this part)

1. **Expo account** — free. Sign up at https://expo.dev, then run
   `npx eas login` from this folder once it's installed.
2. **Apple Developer account** — $99/year, at https://developer.apple.com.
   Required by Apple for installing any non-App-Store build on a real
   iPhone, even your own test build. Not optional, no workaround.
3. (Android needs no paid account for local testing — Android Studio +
   USB debugging is free.)

### Android — build and test locally

1. Install Android Studio (free): https://developer.android.com/studio
2. Either start an emulator from Android Studio, or plug in a real Android
   phone with Developer Options → USB debugging turned on.
3. Make sure Health Connect is on the device — built into the OS on Android
   14+, otherwise install it from the Play Store first.
4. From this `mobile/` folder:
   ```
   npm install
   npx expo prebuild
   npx expo run:android
   ```
5. Grant health permissions when the app prompts, then try
   `syncHealthData(...)` and see what comes back.

### iOS — build via EAS Build (no Mac needed)

1. `npm install -g eas-cli` (one-time, on your machine).
2. `npx eas login` (after creating the Expo account above).
3. From this `mobile/` folder: `npx eas build --profile development --platform ios`
   - First run will ask a few setup questions (bundle identifier is already
     set in `app.json` as `com.racetraining.mobile` — change it if you'd
     rather use something else) and will prompt you to connect your Apple
     Developer account for signing.
4. Wait for the cloud build (Expo emails/links you when it's done — usually
   10–20 minutes).
5. Open the link on your iPhone to install the dev client build directly
   (no App Store involved).
6. Run `npx expo start --dev-client` from this folder and connect to it from
   the installed app to load the JS bundle.

### After either build installs

Treat the first run as a debugging pass, not a victory lap — `ios.ts` and
`android.ts` were written against each library's docs but never executed
(see above). Expect to fix at least one field-name mismatch on the first
real sync. That's normal, not a sign something's broken in the setup.
