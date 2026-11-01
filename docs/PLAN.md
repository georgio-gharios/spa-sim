# SPA 2026: build plan

Effort is in **working sessions** (one long agent session ≈ one unit). These are rough estimates,
re-estimated at every phase review. Each phase ends with its acceptance checks run, `PROGRESS.md` updated,
a merge into the integration branch, and a local tag (see DECISIONS: git).

| # | Phase | Tag | Est. |
|---|-------|-----|------|
| 0 | Repo bootstrap: Vite + TS strict, Vitest, Playwright, lint, folder layout | — | 0.5 |
| 1 | Data & track geometry | v0.1-track | 3 |
| 2 | Car physics (2026 regs) + modular car architecture + drivable keyboard prototype | v0.2-physics | 5 |
| 3 | Input: keyboard, gamepads, wheels, rebinding | v0.3-input | 2 |
| 4 | Timing, HUD, cameras, replays, sessions incl. Q1/Q2/Q3 | v0.4-timing | 4 |
| 5 | Race Control & track limits, flags, VSC/SC | v0.5-race-control | 4 |
| 6 | Race engineer & radio | v0.6-radio | 3 |
| 7 | Pit stops & strategy, damage | v0.7-pits | 3 |
| 8 | AI opponents + racing-line solver | v0.8-ai | 5 |
| 9 | Drivers across eras, driver packs | v0.9-drivers | 2 |
| 10 | Garage: setup + livery | v0.10-garage | 3 |
| 11 | Weather, audio, menus, accessibility, performance | v0.11-polish | 4 |
| 12 | QA & release | v1.0 | 2 |

## Architecture (fixed at Phase 0, refined per phase)

```
src/
  core/        fixed-step clock, seeded RNG, event bus, config loader (data/*.json with source notes)
  track/       TrackModel: centerline queries (s ↔ xyz), surfaces, kerbs, limits lines, sectors, pit lane
  physics/     vehicle core (4-wheel, tyres, aero, drivetrain), CarSpec types, module interfaces
  physics/modules/  PowerUnit, EnergyStore, AeroController, AssistSuite implementations (2026, test-simple)
  rules/       RuleSet per era (overtake mode, active-aero zones, energy limits)
  input/  timing/  race-control/  radio/  pits/  ai/  drivers/  garage/
  render/      Three.js only, reads simulation state, never writes it
  audio/  ui/
data/          derived, versioned JSON (every real-world number with a `source` note)
tools/         offline pipelines (Python for geodata, Node/TS for solvers)
tests/         vitest unit + headless sims; e2e/ playwright
```

The **simulation runs headless** (`src/core` … `src/pits`, `src/ai`) and is deterministic for a given
build and browser: fixed 500 Hz step, seeded RNG, no wall-clock reads. Rendering interpolates between
simulation states.

## Phase 1 task breakdown
1. Phase 0 bootstrap (Vite/TS/Vitest/Playwright skeleton).
2. `tools/track/`: fetch sources → georeference → resample at 1 m → elevation from DEM → camber/width.
3. Annotations: corners (19), sectors, mini-sectors (20), kerbs, runoff surfaces, enforced limits, pit lane.
4. `data/track/spa-2026.json` + TS loader + `TrackModel` queries, with unit tests (closure, length, continuity).
5. Validation tools: length check, elevation PNG, overlay plot (sources vs centerline; FastF1 once available).
6. Render: road mesh with camber, kerbs, lines, runoff, gravel, grass, barriers, fencing, DEM terrain,
   instanced forest, pit building/garages, grandstands, marshal posts, gantries, invented signage,
   sun/overcast lighting, free camera + scripted fly-around.
7. Acceptance: mesh-seam test, length ±0.5 %, elevation PNG, overlay PNG, Playwright fly-around screenshots.
