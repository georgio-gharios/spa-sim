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
