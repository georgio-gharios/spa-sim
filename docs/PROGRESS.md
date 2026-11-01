# Progress

## Phase 2: Car physics, 2026 regulations (`v0.2-physics`)

### Built
- `data/cars/car2026.json` (CarSpec), `data/rules/2026.json` (RuleSet), `data/tyres/compounds-2026.json`, `data/physics/{surfaces,environment}.json`, `data/track/zones.json` (active-aero zones and overtake detection), `data/reference/spa-2026-pace.json`. Every real number has a source note.
- `src/physics/`: CarSpec types; module interfaces and registry (`hybrid-v6-2026`, `es-2026`, `active-aero-2026`, `na-engine`, `fixed-aero`, `standard-assists`); tyre model; `Vehicle` core (4 wheels, load transfer, combined-slip tyres with temperature and wear, compounds, aero with ride height and modes, gearbox with shift times, LSD, engine braking, brakes + brake-by-wire regen, fuel burn, surfaces, wetness hook, grade/camber gravity, vertical compression, suspension heave, barriers).
- `src/ai/`: racing line v1 (min-curvature, coarse-to-fine), speed profile (axle-aware QSS), scripted driver (path tracker, threshold braking, traction/edge guards). `src/sim/lapRunner.ts`, `tools/sim/{hotlap,trace}.ts`, `tools/sim/compare_pace.py` (sim vs real 2026 pole trace).
- Keyboard-drivable browser prototype: procedural car (steering, spinning wheels, pitch/roll/heave, moving wing flaps), chase and cockpit cameras, HUD built from the car's capabilities, physics decoupled at 500 Hz.
- Assists: TC (3 levels), ABS, auto gears, auto clutch, steering assist, auto aero; Pro (all off) and Casual presets. Braking/racing-line visual aids are settings only for now (rendering comes with the HUD work in Phase 4).

### Verified (run 2026-11-01)
| Acceptance check | Result |
|---|---|
| Scripted controller follows the centerline for a full lap without leaving the track | ✅ at 85 % pace: 0 s with all four wheels out, max 2 wheels over, no impacts |
| Full-pace dry lap in a plausible range (target = real 2026 quali field 103.5–110.2 s; car model's ideal lap must beat pole) | ✅ **1:47.624** (S 30.43 / 47.05 / 30.14; real pole 30.25 / 46.14 / 28.39). Ideal profile lap 1:37.2 |
| Top speed at the end of Kemmel plausible; battery derating visible in telemetry | ✅ 310 km/h (real 2026 pole: 312) with superclipping; derating flagged when the store runs dry |
| Unit tests: tyre monotonicity, energy store limits, active-aero state machine | ✅ `tests/physics-units.test.ts` |
| Second test-only car (no hybrid, fixed wings) runs the headless lap | ✅ `tests/fixtures/cars/test-simple.json` + test RuleSet; capabilities all false |
| Determinism | ✅ bit-identical state after 3000 steps with the same inputs |

Speed comparison with the real 2026 pole lap (km/h, real / sim): La Source 80/66, Eau Rouge 320/309, Raidillon 301/308, end of Kemmel 312/310, Les Combes 155/142, Malmedy 199/164, Rivage 125/132, Pouhon 267/267, Campus 177/139, Blanchimont 296/290, Bus Stop 77/75.

Test totals: Vitest 38/38, Playwright 2/2 (track fly-around, drive prototype), `tsc` clean.

### Known issues / not yet done
- **The scripted driver is ~10 s off the car's ideal lap.** Its path tracking oscillates slightly at high speed, and it runs slightly wide at the Bus Stop exit (2 wheels over at full pace). The Phase 8 AI replaces it.
- Medium-speed corners (Malmedy, Campus, T9) are 10–20 % slower than real, and top speed before Blanchimont is 298 vs 336 km/h (the energy runs out in S3). Calibration is a balance across corners; revisit with tyre/aero refinement and the AI energy strategy.
- Not modelled yet: the mid-2026 250 kW MGU-K limit outside acceleration zones; brake temperatures; tyre pressure effects (Phase 10 setup); damage (Phase 7); slipstream (Phase 8); collisions between cars (Phase 8, maybe Rapier).
- Keyboard input is the minimal prototype. Rebinding, gamepads and wheels come in Phase 3. Braking/racing-line overlays are not drawn yet.
- The phase branch was accidentally pushed to GitHub as `phase-02-physics` and could not be deleted from the session (permission denied); it contains only commits that are also merged here. The owner can delete it.

### Next
Phase 3: input (keyboard, DualShock 4/DualSense/Xbox pads, wheels; rebinding; hot-plugging).


## Phase 1: Data & track geometry (`v0.1-track`)

### Built
- `tools/track/fetch_sources.sh`, `build_track.py`: OSM-derived centerline (TUMFTM, georeferenced onto bacinger with rigid ICP, RMS 1.17 m), 1 m resampling from the timing line, Copernicus GLO-30 elevation with canopy/bridge rejection, annotations → `data/track/spa-2026.json` (+ `terrain.bin`, `build-report.json`), elevation and overlay PNGs.
- `data/track/annotations.json`: 19 corners, sectors, mini-sectors (20), kerbs (flat/standard/sausage), runoff layers (tarmac/grass/gravel), barriers (armco/tyres/TecPro/concrete/pit wall), enforced track-limit zones, camber, pit lane (80 km/h, boxes for 11 teams, exit line). Every block has a source note.
- `data/track/facts.json`: real-world track facts with source notes.
- `src/track/TrackModel.ts`: headless queries. Sampling, `pointAt(s, d)` on the cambered surface, projection of world (x, y) to (s, d) with hint or a spatial hash, surface classification (tarmac/kerb/runoff/wall), sector and mini-sector, corner, enforced-limits lookup, terrain height.
- `src/render/`: road mesh with camber, white lines, chequered timing line and sector lines, kerbs with red/white and sausage profiles, runoff surfaces, barriers, catch fencing, pit lane and markings, DEM terrain, instanced spruce/broadleaf forest, grandstands with crowd, pit building and 11 coloured garages, marshal posts, start gantry with lights, overhead gantries, invented sponsor boards (VELMORA, QUINTAR FUELS, …). Sunny and overcast lighting with Sky and fog; Low/Medium/High/Ultra presets; free camera and fly-around camera; benchmark mode (`?bench=1`).
- `tools/telemetry/export_fastf1.py`, `tools/track/telemetry_overlay.py` (with `--selftest`) for the telemetry cross-check.

### Verified (all run on 2026-11-01)
| Acceptance check | Result |
|---|---|
| Fly-around of the full lap with no gaps or seams | ✅ `tests/render-geometry.test.ts`: the road is one closed manifold ribbon (exactly 2N boundary edges, 0 non-manifold, 0 degenerate) with all faces up. `e2e/track.spec.ts` flies the whole lap in 50 m steps in Chromium with no errors and checks each frame is non-blank. Screenshots in `docs/screens/`. |
| Centerline length within ±0.5 % of 7.004 km | ✅ 6999.2 m (−0.07 %), measured independently in `tests/track.test.ts` |
| Elevation plot matching the real profile | ✅ `docs/elevation-profile.png`, now from the **SPW LiDAR DTM 2021-22 (50 cm)**: drop to Eau Rouge, climb up Raidillon (peak grade 15.5 %) and Kemmel to Les Combes (468.8 m), long descent through Pouhon to Stavelot (366.6 m), climb back via Blanchimont. **Δ 102.3 m** vs ≈102 m published. Copernicus GLO-30 differs by 2.8 m RMS (datum offset −2.4 m). |
| Overlay of centerline vs telemetry, max deviation documented | ✅ `docs/telemetry-overlay.png`, `data/track/telemetry-report.json`: 5 fastest 2026 Belgian GP qualifying laps (FastF1). Lateral distance to centerline RMS ≤ 2.6 m (cars drive a racing line, not the centre), **max 8.5 m at Campus/T14 (~4.9 km)**. The 2026 orthophoto shows our edges on the real asphalt there, so the excess is position-data noise (2–5 m) plus cars using the painted runoff. Elevation vs telemetry Z: RMS ≤ 0.27 m, max 0.96 m (after a constant −1.0 m datum offset). |

Test totals: Vitest 18/18, Playwright 1/1, `tsc --noEmit` clean.

### Known issues and assumptions (not stubs, but unverified)
- **Now from primary sources (2026-11-01 update):** road elevation and banking (SPW LiDAR 50 cm, sampled every 2 m at centre and both edges); **pit lane re-traced from the SPW spring-2026 orthophoto**. It is on the RIGHT of the start/finish straight (the first version had it mirrored on the left): entry at ~6280 m east of the Bus Stop, loop inside La Source, exit merging ~540 m. Main grandstand moved to the left; stands added on the run to Eau Rouge. Timing line confirmed (gantry + grid at s ≈ 0).
- **From 2026 qualifying telemetry:** finish/control line at s = 6882 m (laps and sectors start here; the start gantry is at s = 0, as at the real circuit), sector lines at 2133 m and 4951 m, and the Phase 2 pace targets in `data/reference/spa-2026-pace.json` (pole 1:44.361, 327–336 km/h max).
- **Still assumed:** kerb positions and types, most runoff surfaces and widths, barrier types, enforced track-limit corners (T4, T9, T19). They can now be checked corner by corner against the 2026 orthophoto (next track pass).
- Terrain away from the track still comes from the 30 m surface model (shifted onto the LiDAR datum), so forested areas include some canopy height.
- Corner names for T9, T14 and T16 are best-knowledge; numbering should be checked against the official 2026 map.
- **Performance (target laptop, owner-run, 2026-11-01):**
  - First build, High preset, browser on the Intel iGPU: avg 20.4 fps (p50 41.7 ms).
  - After spatial tiling/culling, still on the Intel iGPU: avg 41.8 fps (p50 27.8 ms; CPU 2.2 ms/frame, so GPU-bound).
  - After switching Firefox to the RTX 5060, **Ultra** preset, 1857×1002 @ 1.25: **avg 138.4 fps, p50 6.94 ms, p95 6.96 ms, p99 6.96 ms**; CPU 1.76 ms/frame. That is the 144 Hz vsync cap (6.94 ms), so the track scene meets the target with headroom of unknown size; browsers cap requestAnimationFrame at the refresh rate. Firefox reports a generic "GTX 980 … or similar" renderer string (anti-fingerprinting).
  - The scene has no cars, AI or physics yet; re-benchmark as those land (Phase 8 and Phase 11 performance pass).
- Trees have no LOD yet, and there are no grid-slot markings or crowd animation (planned for Phases 4 and 11).

### Blocked / owner actions
1. ~~Network allow-list~~: Wallonia now works (LiDAR + 2026 orthophotos used). `overpass-api.de` connects but the connection closes after a few bytes every time, so OSM raw ways are still unavailable. The orthophotos cover the need.
2. ~~FastF1 telemetry~~: done with the owner's F1 TV account (environment variables). Raw exports stay in git-ignored `data/raw/telemetry/`; committed outputs are anonymised ("lap 1..5").

**Phase 1 acceptance: all four checks pass → tagged `v0.1-track` (local tag; see DECISIONS: git).**

### Next
Phase 2: car physics (2026 regulations), the modular `CarSpec` architecture, and a keyboard-drivable prototype.
