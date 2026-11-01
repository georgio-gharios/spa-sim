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
| Elevation plot matching the real profile | ✅ `docs/elevation-profile.png`: drop to Eau Rouge (387 m), climb up Raidillon and Kemmel to Les Combes (467 m), long descent through Pouhon to Stavelot (364 m), climb back via Blanchimont. Δ 102.7 m vs ≈102 m published. The shape is asserted in tests. |
| Overlay of centerline vs telemetry, max deviation documented | ⚠️ **Partial.** FastF1 telemetry is blocked (needs an F1 account). Done instead: overlay vs an independent OSM trace (bacinger), RMS 1.14 m, p95 2.09 m, **max 5.66 m at La Source** (`docs/centerline-overlay.png`). The telemetry overlay tool is ready and self-tested. |

Test totals: Vitest 17/17, Playwright 1/1, `tsc --noEmit` clean.

### Known issues and assumptions (not stubs, but unverified)
- **Assumed, not verified from primary sources:** kerb positions and types, runoff surfaces and widths, barrier types, enforced track-limit corners (T4, T9, T19), sector boundaries, timing-line position, camber values, and the whole pit-lane geometry. Each is marked "assumed" in `annotations.json`.
- Elevation comes from a 30 m surface model. Raidillon's peak grade is 15 % (published ~17–18 %), and the short-wavelength profile is smoothed. Forested terrain away from the track still includes some canopy height.
- Corner names for T9, T14 and T16 are best-knowledge; numbering should be checked against the official 2026 map.
- **Performance (target laptop, owner-run, 2026-11-01):** first build, High preset: **avg 20.4 fps**, p50 41.7 ms, p95 97.2 ms, p99 145.8 ms (1790 frames). Far below target. Fixes applied since: spatial tiling of all track, terrain and signage meshes and of the forest (250–400 m tiles) so both the main and shadow passes frustum-cull; a per-preset tree draw distance; structure boxes merged by material; `preserveDrawingBuffer` off outside tests. In a like-for-like view, High now draws 0.5–1.3 M triangles per frame (was 2.9 M). The benchmark line now also reports the GPU name, CPU ms/frame and render size, to rule out integrated-GPU rendering. **Re-run needed.**
- Trees have no LOD yet, and there are no grid-slot markings or crowd animation (planned for Phases 4 and 11).

### Blocked / owner actions
1. **Network allow-list** (cloud environment settings → Network access → Allowed domains): `overpass-api.de` (raw OSM ways: pit lane, gravel/grass areas) and `geoservices.wallonie.be` / `geoportail.wallonie.be` (1 m LiDAR DTM + orthophotos for kerbs/runoff). Alternatively, download them and drop the files into `data/raw/`.
2. **FastF1 telemetry:** either add `F1_USERNAME` / `F1_PASSWORD` as environment secrets (the data stays out of git), or run `python tools/telemetry/export_fastf1.py --year 2026` locally and upload the CSVs. Then `python -I tools/track/telemetry_overlay.py data/raw/telemetry/spa_2026_Q_*.csv` closes the last acceptance item. It also pins the timing line, sector boundaries and the lap-time target for Phase 2.

### Next
Phase 2: car physics (2026 regulations), the modular `CarSpec` architecture, and a keyboard-drivable prototype.
