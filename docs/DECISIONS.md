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
