# Decisions log

One line per decision: **what** — *why*.

## Process (2026-11-01, owner said "run with what seems best" → all OPEN_QUESTIONS defaults applied)
- Integration branch = `claude/loving-goldberg-z08sar` (stands in for `main`); `phase-NN-*` branches are local and merged `--no-ff`; tags are local only. — *The session may push only this branch.*
- Pause for owner review after each phase. — *Default for Q3; Phases 1–2 are expensive to undo.*
- Code license is a placeholder ("all rights reserved"); OSM-derived data carries ODbL attribution. — *Q4 default.*
- Raw third-party downloads go to git-ignored `data/raw/`; only derived data is committed. — *Licensing (Q5) and repo size.*
- Personal, non-commercial project; FastF1 data is used only for validation and is never committed raw. — *Q5.*
- Metric units, English UI, WebGL2 renderer, race default 44 laps (short = 11). — *Q18–Q21 defaults.*

## Data / track
- Primary centerline: TUMFTM racetrack-database `Spa.csv` (LGPL-3.0; OSM GPS centerline, smoothed, widths from satellite imagery). — *OSM endpoints are blocked by the network policy; this is the best reachable OSM derivative and the only one with track widths.*
- Georeferencing: TUMFTM local frame rigidly fitted (rotation + translation, no scale) to bacinger/f1-circuits `be-1925.geojson` (MIT, WGS84). — *TUMFTM has no geographic origin; bacinger does. Residuals are reported as an independent cross-check.*
- World frame: local ENU tangent plane at the start/finish line (x = east, y = north, z = up, metres); the renderer maps it to Three.js Y-up. — *True-north frame, no UTM grid convergence (~2.3° at Spa), metric everywhere.*
- Elevation: Copernicus GLO-30 DSM, robust low-percentile sampling across the track corridor, then along-track smoothing. — *Wallonia 1 m LiDAR is blocked; GLO-30 is a surface model, so taking a low percentile across the corridor rejects tree canopy.*
- The elevation cross-check uses FastF1 Z once available; GLO-30 alone gives Δ102.7 m (published ≈102 m). — *Telemetry is blocked (needs an F1 account).*
- Timing line (s = 0) = projection of bacinger's first vertex (TUMFTM's own start is 146 m earlier). — *Gives ≈258 m from the line to the La Source apex, consistent with the short run to T1; to be verified with FastF1 Distance = 0.*
- The world is a flat local plane (azimuthal-equidistant); Earth curvature (≈0.3 m drop over 2 km) is ignored. — *Negligible for driving; keeps physics in a simple Cartesian frame.*
- The centerline is resampled at L/round(L) ≈ 1.000 m. Kinks where the local radius is below 12 m are smoothed. — *OSM vertices made a 5.6 m-radius spike at La Source; the real hairpin is ~12–15 m at the centerline.*
- Elevation: minimum across the road at 5 lateral points, then a 20th percentile over a 61 m window, then positive residuals capped at +1 m above a 60 m Gaussian baseline, then a 12 m Gaussian. — *Rejects canopy and bridges (a +6 m footbridge artefact on Kemmel) and keeps real dips such as Eau Rouge.*
- Terrain: 10 m grid sampled from GLO-30, a 70 m grey opening (removes canopy), flattened under road/runoff/pit lane to the cambered road plane minus 0.55 m, blended back over 45 m. — *Terrain must never poke through the road (a test checks both road edges).*
- Pit lane is on the LEFT of the start/finish straight. Entry goes straight on at the Bus Stop while the track jogs right; exit passes around the outside of La Source and runs alongside the left of the descent behind the pit-exit line. — *A lane on the right would have to cross the chicane. Geometry is assumed until OSM pit_lane ways are reachable.*
- Corner numbering T1–T19 follows the common GP map; corners are placed at curvature peaks. Blanchimont = T17, Bus Stop = T18/T19. — *Matches the "Turn 4 = Raidillon exit" track-limits convention.*
- Sector boundaries are assumed at 2150 m and 5150 m. Mini-sectors are 20 equal-distance segments. — *No timing data is reachable; the brief's default is 20.*
- The white line belongs to the track (on-track = between the lines' outer edges). Kerbs lie outside the white line. — *Matches current track-limits practice; Phase 5 uses "all four wheels beyond the line".*
- Runoff and barrier offsets on the inside of a corner are clamped to 0.8 × the smallest radius within ±30 m. No catch fence where that limit is < 80 m. — *Otherwise offset curves fold over themselves at La Source and the Bus Stop.*
- All textures are procedural canvas textures; no external art assets. — *Poly Haven/ambientCG are blocked, and this avoids licensing questions.*
- TypeScript 5.9 instead of 7.0. — *Widest tooling compatibility (Vite/Vitest type plugins); revisit later.*
- three r0.187 with the WebGL2 renderer. — *WebGPU stays an option for Phase 11 (Q20).*
- Playwright runs Chromium with SwiftShader on the Low preset. — *No GPU in CI/cloud; all presets share the same geometry, so the full-lap check stays valid.*
- Quality presets: Low/Medium/High/Ultra = trees 8k/20k/40k/70k, shadows off/1k/2k/4k, anisotropy 2/4/8/16, pixel ratio cap 1/1/1.5/2. — *Starting points; to be tuned with real numbers from the target laptop.*

## Rendering performance
- Every large mesh is split into ~250 m tiles (terrain and forest 300–400 m) instead of whole-lap meshes. — *Whole-lap meshes have site-sized bounding spheres, so nothing was ever culled in the main or shadow pass; the owner measured 20 fps on High.*
- Forest tiles beyond a per-preset distance are hidden (Low/Med/High/Ultra 0.8/1.3/1.9/2.8 km). — *They are fog-faded anyway, and the forest was the largest triangle load.*
- Static structures are merged by material, then re-tiled; start lights stay separate. — *About 200 small boxes were 200+ draw calls in each pass.*
- `preserveDrawingBuffer` is only on with `?static=1` (tests/screenshots). — *It forces a buffer copy every frame.*
- The benchmark reports the GPU renderer string and CPU frame time. — *Hybrid-graphics laptops often run browsers on the iGPU; the numbers must show which GPU was measured.*
- The frame-rate target is judged at the display's vsync cap; Ultra already holds 144 Hz on the RTX 5060 for the track scene. — *Browsers cap rAF at the refresh rate; uncapped headroom would need Firefox `layout.frame_rate=0` or Chrome `--disable-gpu-vsync`.*

## Track data v2 (Wallonia sources)
- Road elevation and banking come from the SPW LiDAR DTM 2021-2022 (50 cm, bare earth), queried with the MapServer `identify` endpoint every 2 m at the centre, the half-widths and both edges (17,500 points, 6 parallel requests). — *The service only renders images; identify returns real heights. This replaces the 30 m surface model on the road (2.8 m RMS difference).*
- Heights are in the Belgian datum (DNG/TAW). The coarse terrain DEM is shifted by the median road difference so they match. — *Consistency between road and terrain matters more than the absolute datum.*
- Banking = atan((z_left_edge − z_right_edge) / span), smoothed over 8 m and clamped to ±8°. Annotation camber values are only a fallback. — *Measured; it agrees with the earlier guesses to within ~1°.*
- Pit lane geometry is traced by hand from the SPW ORTHO_2026_PRINTEMPS orthophoto (0.25 m/px) as control points (world x/y or s/offset/edge) joined with a Catmull-Rom spline, with a per-point lane width. — *OSM is unreachable; the photo shows the 2026 state. The first version (lane on the left) was a wrong inference from geometry alone.*
- The SPW web-service conditions allow free access with the source credited; raw downloads stay in data/raw/. — *Read from LicServicesSPW.pdf; the dataset's own licence record is on a blocked host (metawal.wallonie.be). Verify before any public release.*

## Telemetry (2026 Belgian GP qualifying, FastF1)
- Two lines are modelled: start line at s = 0 (grid gantry in the 2026 photo) and the finish/control line at s = 6882 m (where FastF1 laps begin; ±6 m over 8 laps). Laps, sectors and mini-sectors count from the control line. — *The real circuit has separate start and finish lines; keeping s = 0 at the gantry avoided shifting every annotation.*
- Sector lines are at 2133 m and 4951 m (median of 8 laps, ±10 m). — *Replaces the assumed 2150/5150; the S2/S3 guess was 200 m off.*
- Pace targets live in data/reference/spa-2026-pace.json (pole 104.361 s, dry quali target 103.5–107.5 s, Kemmel top speed 315–345 km/h). — *Real numbers go in data files with a source note (brief §5).*
- Committed telemetry outputs are anonymised (laps ranked 1..5, no driver codes); raw exports stay in data/raw/telemetry/. — *Project IP rules (no real driver names) and the F1 data terms.*
- Campus (T14) max deviation (8.5 m) is not treated as a geometry error: the orthophoto shows our edges on the real asphalt. — *F1 position data is good to ~2–5 m; a rigid alignment adds some error.*

## Car physics (Phase 2)
- The physics core is headless and deterministic at a fixed 500 Hz (DriveSession accumulator, capped at 100 steps per frame). Load transfer uses the previous step's filtered accelerations (15 ms). — *Avoids algebraic loops; meets the ≥360 Hz requirement (Q12).*
- Wheel spin is integrated with a linearised implicit Euler step (local dFx/dκ in the denominator). — *Explicit integration is unstable at low speed with stiff slicks at 500 Hz.*
- Tyre: Magic-Formula curve on a normalised combined-slip vector (one friction budget), with B solved so the peak sits at σ = 1. Load sensitivity uses a reference load scaled by tyre width (rear 375 mm vs front 280 mm). — *Simple, monotonic to the peak (tested); without the width scaling the wide rears were under-gripped and the car spun.*
- Vertical curvature is taken from the LiDAR profile smoothed over ~20 m before differentiating twice. — *Raw 2 m samples gave fake ±1 g bumps; with smoothing, Eau Rouge gives +1.5 g at 300 km/h and the Raidillon crest −0.7 g.*
- Suspension heave is a 2nd-order filter of quasi-static axle loads (ride height, aero sensitivity, visuals); wheel loads stay quasi-static. — *Gives the visible Eau Rouge dip without the stiffness/instability of a full sprung-mass model.*
- Barrier contact is a simple projection with restitution 0.25 and 25 % scrub, only when crossing outward where the barrier type isn't 'none'; pit-lane surface comes from a pit-path spatial hash. — *Rapier isn't needed for single-car barrier contact; revisit for car–car contact in Phase 8.*
- Modules (PowerUnit, EnergyStore, AeroController, AssistSuite) are resolved by id from a registry; Capabilities are derived from modules, never from the era. RuleSets are registered by id; a CarSpec names its RuleSet. — *Brief: new eras = new modules + CarSpec, zero core changes (proved by the test-only car).*
- 2026 values used: 768 kg minimum incl. driver, 3.4 m wheelbase, 1.9 m width, 350 kW MGU-K tapering 290→345 km/h (override 337→355), 4 MJ SoC window, 8.5 MJ/lap, +0.5 MJ overtake, 0.4 s aero transition, ~400 kW ICE. — *Sourced from secondary reports of the FIA 2026 regs (FIA site unreachable); uncertain ones marked "verify" in data/rules/2026.json.*
- Not modelled yet: the mid-2026 amendment limiting the MGU-K to 250 kW outside designated acceleration zones. — *Needs per-circuit zone data; listed in PROGRESS.*
- Aero and grip are calibrated against the 2026 Spa pole lap's speed trace (FastF1): soft μ 2.1, corner mode ClA 6.5 / CdA 1.08, straight mode ClA 2.8 / CdA 0.64, front balance 44.5/40 %. — *First-principles guesses (ClA 3.55, μ 1.8) gave corner speeds ~65 % of real.*
- Energy presets: quali deploys above 100 km/h and superclips at 300 kW above 310 km/h; the out-lap uses the harvest preset. — *Reproduces the real flat speed trace at the end of Kemmel (sim 310 vs real 312 km/h).*
- Racing line v1: minimum-curvature lateral offsets solved coarse-to-fine (32/16/8/4 m) with a 1.0 m margin from the white lines. Speed profile: axle-aware quasi-steady-state with a friction ellipse. — *Single-level gradient descent never converged on long corners; Phase 8 adds the lap-time refinement.*
- Pace target = the real 2026 qualifying field (103.5–110.2 s); the car model's ideal profile lap must also beat pole (104.361 s). — *The scripted driver is not an optimal driver; the field range is a data-backed plausibility window (replaces the first ±3 % guess).*
- La Source and the Bus Stop centerline minimum radius was raised from 12 m to 18 m and checked against the 2026 orthophoto. Lap length is now 6991 m (−0.19 %). — *A 12 m centerline left a 4.8 m inside-edge radius, which was physically impossible and over-slowed the hairpin.*
- Keyboard prototype: digital keys smoothed (steer 2.2/s, return 4.5/s, throttle 5/s, brake 7/s); Casual assists by default in the prototype, H toggles to Pro. — *Drivable on a keyboard now; Phase 3 replaces this with rebindable input.*
