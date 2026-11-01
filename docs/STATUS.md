# SPA 2026: session hand-off status

_Last updated: 2026-11-01, end of Phase 2. Read this first in a new session, then `docs/PROGRESS.md`,
`docs/DECISIONS.md` and the original brief (owner's first message; the phase list is mirrored in `docs/PLAN.md`)._

## Where things stand

| Phase | State | Tag (local only, see below) |
|---|---|---|
| 1 Track data & geometry | ✅ done, all 4 acceptance checks pass | `v0.1-track` → `146b6ef` |
| 2 Car physics (2026) + drivable prototype | ✅ done, all acceptance checks pass | `v0.2-physics` → `f1bfc8f` |
| 3 Input (keyboard, pads, wheels, rebinding) | ⏭ next, not started | |
| 4–12 | not started | |

- **Code:** all work is on the branch `claude/loving-goldberg-z08sar` (it stands in for `main`, DECISIONS → Process).
  `origin` also has a stray `phase-02-physics` branch (already merged; the owner may delete it).
- **Tags are not on GitHub** (this cloud session could only push one branch). Recreate them in a new clone:
  `git tag -a v0.1-track 146b6ef -m "Phase 1"` and `git tag -a v0.2-physics f1bfc8f -m "Phase 2"`.
- **Tests:** `npm run check` → Vitest 38/38, `tsc` clean; `npm run e2e` → Playwright 2/2 (track fly-around, drive prototype).
- **Owner workflow preferences:** pause for review after each phase. The owner is on Windows (PowerShell) and Firefox,
  with an RTX 5060 laptop (Ultra holds the 144 Hz vsync cap). They prefer short, direct answers and say "go" to start
  the next phase. Ask before anything expensive to undo.

## Starting a new session

1. Clone or attach `georgio-gharios/spa-sim`, then check out `claude/loving-goldberg-z08sar` (or whatever branch the new session
   is told to use; if it's a new branch, start it from this one).
2. `npm install`. Node 22 works; Playwright 1.63 uses the pre-installed Chromium.
3. Python tools: `python3 -m venv /tmp/venv && . /tmp/venv/bin/activate && pip install -r tools/requirements.txt fastf1 pillow`.
4. **Raw data is git-ignored and is NOT in the repo** (`data/raw/`). The committed derived data (`data/track/*`) is
   enough to run, test and develop. Only re-fetch raw data to rebuild the track:
   - `bash tools/track/fetch_sources.sh` (TUMFTM, bacinger, Copernicus DEM; ~60 MB)
   - `python -I tools/track/fetch_wallonia.py` (SPW LiDAR samples + 2026 orthophotos; **~20 min**, resumable)
   - FastF1 telemetry needs the owner's F1 TV login in the env vars `F1_USERNAME` / `F1_PASSWORD` (already set in the
     cloud environment) → `python tools/telemetry/export_fastf1.py --year 2026 --session Q`, then
     `tools/track/telemetry_overlay.py …`. The pole speed trace for `tools/sim/compare_pace.py` is also derived
     from FastF1 (`data/raw/telemetry/pole_trace.json`; see the snippet in DECISIONS/PROGRESS or regenerate it).
   - Then `python -I tools/track/build_track.py`.
5. Network: Wallonia geoportal and F1 domains are allowed; `overpass-api.de` connects, then gets cut (OSM unusable);
   fia.com, Wikipedia and CDNs are blocked (use the WebSearch tool for regulation facts).

## Repo map

```
data/track/        spa-2026.json (centerline 1 m, annotations resolved), terrain.bin, annotations.json (hand input),
                   facts.json, zones.json (active-aero zones), telemetry-report.json, build-report.json
data/cars/         car2026.json (CarSpec)          data/rules/2026.json (RuleSet)
data/tyres/        compounds-2026.json             data/physics/ surfaces.json, environment.json
data/reference/    spa-2026-pace.json (real 2026 quali pace, targets)
src/track/         TrackModel (headless queries: s<->xy, surfaces, sectors from control line, grade, kv, barriers, pit lane)
src/physics/       spec.ts, Vehicle.ts (core), tyre.ts, data.ts, modules/ (interfaces, registry, 2026 + test modules)
src/ai/            racing-line/ (minCurvature v1, speedProfile), ScriptedDriver.ts
src/sim/           lapRunner.ts (headless hot lap)
src/game/          DriveSession.ts (fixed 500 Hz loop)      src/input/ KeyboardDriver.ts (prototype)
src/render/        TrackViewer, scenery, lighting, tiling, quality presets, track/ geometry, car/ CarModel, DriveController
src/ui/            viewerHud.ts, driveHud.ts
tools/track/       fetch_sources.sh, fetch_wallonia.py, build_track.py, telemetry_overlay.py, geo.py
tools/sim/         hotlap.ts, trace.ts, compare_pace.py      tools/telemetry/ export_fastf1.py
tests/             Vitest (track, render geometry, physics units, physics laps); fixtures/ test-only car + RuleSet
e2e/               Playwright (track fly-around, drive prototype)
docs/              PLAN, PROGRESS, DECISIONS, OPEN_QUESTIONS, TELEMETRY, STATUS (this file), PNG plots, screens/
```

## Key facts a new session must not re-derive

- **World frame:** x east, y north, z up (metres; heights in the Belgian datum from LiDAR). three.js: (x, z − baseZ, −y).
- **Track s:** s = 0 is the **start gantry**; the **control/finish line is s = 6882** (laps, sectors and mini-sectors
  count from it). Sector lines: 2133 / 4951. Lap length is 6991 m.
- **Pit lane is on the RIGHT of the start/finish straight** (traced from the 2026 orthophoto). Entry around 6280 m, east of the Bus Stop;
  the exit loops inside La Source and merges around 540 m.
- **Physics:** fixed 500 Hz, deterministic, headless. Era specifics live only in modules + CarSpec + RuleSet.
  Capabilities (hybrid / activeAero / overtakeMode / drs) drive the HUD, the radio and the garage.
- **Calibration:** aero and grip are tuned to the real 2026 pole lap (soft μ 2.1, corner ClA 6.5 / CdA 1.08, straight 2.8 / 0.64).
  Run `npx tsx tools/sim/hotlap.ts soft`, then `python -I tools/sim/compare_pace.py` after any physics change.
- **IP rules:** no real team, driver or sponsor names in committed files. Telemetry outputs are anonymised ("lap 1..5").
  Raw F1 data stays in `data/raw/`.

## Open items / known issues (details in PROGRESS.md)

- Scripted driver ~10 s off the car's ideal lap; slight wobble at speed; Bus Stop exit can put two wheels over. The Phase 8 AI replaces it.
- Medium-speed corners 10–20 % slower than real; the battery runs out in S3 (top speed before Blanchimont 298 vs 336 km/h).
- Still assumed (not yet checked against the 2026 photo): kerb positions and types, most runoff and barriers, enforced
  track-limit corners (T4/T9/T19).
- Not modelled yet: the 250 kW MGU-K rule outside acceleration zones, brake temperatures, damage, slipstream, car–car contact.

## Next: Phase 3 (Input), per the brief

Keyboard (WASD + arrows, smoothing settings, all action keys) · Gamepad API with DualShock 4 / DualSense / Xbox
glyphs, deadzone/linearity/saturation, analogue triggers, rumble on kerbs/lock-ups/wheelspin · basic wheel support
(axis mapping, rotation; no force feedback in browsers, documented) · full per-device rebinding UI saved to
localStorage with reset · hot-plugging. Acceptance: each device type can complete a lap (mock Gamepad devices in
tests + a manual checklist for the owner), rebinding persists across reloads, a deadzone-maths test.
Replace `src/input/KeyboardDriver.ts`; DriveSession/DriveController only consume `DriverInput`.

**Suggested opening prompt for the new session:**
> Continue SPA 2026. Read docs/STATUS.md, docs/PROGRESS.md and docs/DECISIONS.md, recreate the local tags, then start Phase 3 (input).
