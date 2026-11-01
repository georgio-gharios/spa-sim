# Progress

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
