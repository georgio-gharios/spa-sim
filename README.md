# SPA 2026

A single-circuit racing simulator of the Circuit de Spa-Francorchamps (2026 layout) for desktop
browsers. Built with TypeScript, Vite and Three.js, around a generic car built to the 2026 open-wheel
technical regulations. All teams, sponsors, drivers and voices are fictional. The rules authority is
"Race Control".

**Status:** Phase 1 (track) complete. See [`docs/PROGRESS.md`](docs/PROGRESS.md) and [`docs/PLAN.md`](docs/PLAN.md).

## Run

```bash
npm install
npm run dev            # http://localhost:5173 — track viewer
```

URL options: `?quality=low|medium|high|ultra`, `?weather=overcast`, `?bench=1` (one-lap fly-through benchmark).
Viewer keys: **F** fly-around, **C** free camera (WASD/QE, drag to look, wheel = speed, Shift = fast), **Space** pause.

## Test

```bash
npm run check          # typecheck + unit tests (Vitest)
npm run e2e            # Playwright: builds, boots the viewer, flies the whole lap
```

## Rebuild the track data

```bash
python3 -m venv .venv && . .venv/bin/activate && pip install -r tools/requirements.txt
npm run track:fetch && npm run track:build
```

## Data sources and licenses

- Track geometry: © OpenStreetMap contributors (ODbL), via the TUMFTM racetrack-database (LGPL-3.0)
  and bacinger/f1-circuits (MIT). The derived track data in `data/track/` is made available under the ODbL.
- Elevation: Copernicus GLO-30 DEM. © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH
  2014–2018, provided under COPERNICUS by the European Union and ESA.
- Kerbs, runoff, barriers and the pit lane are hand-annotated (`data/track/annotations.json`). Each
  entry carries a source note, and unverified entries are marked "assumed".
- All textures are procedurally generated. Sponsor names are invented.

See `tools/track/sources.md` for details.
