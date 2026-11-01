# Open questions

Each question has a **default** I'll use if you don't answer. Unanswered questions
will be marked "default applied" here and logged in `DECISIONS.md` when I start Phase 1.

Status legend: ❓ open · ✅ answered · ⏩ default applied

> **2026-11-01 — owner answer: "just run with what seems best".** All defaults below are applied (⏩) and logged in `DECISIONS.md`.
> Network check results (Q2) are recorded under Q2.

---

## A. Workflow & environment (these block Phase 1)

**Q1 ⏩ Git branches, `main`, and tags.**
This cloud session can only push to one branch: `claude/loving-goldberg-z08sar`. The brief asks for
one branch per phase merged into `main`, plus a tag per phase. I can't push other branches, `main`,
or tags without your permission.
- **Default:** I create `phase-NN-*` branches locally, commit small conventional commits on them, and
  merge them (`--no-ff`) into the designated branch. That branch plays the role of `main`, and I push
  only that branch. I create tags locally, list them in `PROGRESS.md`, and push nothing else.
  When you want, you open a PR from it to `main` and tag the merges.
- Alternative: you allow me to push `main`, the `phase-*` branches, and the tags.

**Q2 ⏩ Network access for data sources.**
I haven't yet checked which hosts this container can reach: Overpass/OSM, Copernicus/SRTM DEM tiles,
the Wallonia geoportal, FastF1's upstream (livetiming.formula1.com + Ergast/Jolpica), PyPI, npm.
- **Default:** at the start of Phase 1 I run a single read-only reachability check. For any source
  that's blocked, I stop and send you exact download instructions (file, URL, where to put it,
  `data/raw/…`). I won't invent geometry.
- **Result (2026-11-01):** reachable: Copernicus GLO-30 DEM (AWS S3), AWS terrain tiles, raw.githubusercontent.com,
  PyPI, npm. **Blocked by network policy:** overpass-api.de / openstreetmap.org (all OSM endpoints), Géoportail
  Wallonie (LiDAR DEM + orthophotos), Wikipedia, CDNs, Poly Haven / ambientCG. **FastF1** installs, but F1 live-timing
  now requires a signed-in F1 account (`F1_USERNAME`/`F1_PASSWORD`), so position telemetry is unavailable here.
  Interim: OSM-derived public datasets (TUMFTM racetrack-database, bacinger/f1-circuits) + Copernicus GLO-30.
  Owner action requested in `PROGRESS.md` → "Blocked / owner actions".

**Q3 ⏩ Scope and pacing.**
Done to the brief's quality bar, this is months of work and many sessions. The containers are
ephemeral, so I push at every checkpoint.
- **Default:** after each phase's acceptance checks pass, I stop for a short review with you before
  starting the next phase. Phases 1–2 are foundational: geometry errors and physics-core design are
  expensive to undo.
- Alternative: keep going automatically and pause only on blockers.

**Q4 ⏩ Final license and repo visibility.**
OSM-derived geometry is under ODbL: it needs attribution, and the derived *database* is share-alike.
The DEMs carry CC-BY-style terms. The code license is your choice.
- **Default:** code is "all rights reserved" (placeholder) until you choose. `data/` derived from OSM
  gets an ODbL notice and attribution in the README. Please also tell me whether the GitHub repo is
  private or public, because that affects Q5.

**Q5 ⏩ FastF1 / official timing data terms.**
FastF1 pulls data from Formula 1's live-timing service. That data is owned by Formula One
Management, and FastF1 itself says it's for personal/non-commercial use.
- **Default:** the project is personal and non-commercial. Raw telemetry is downloaded only into
  `data/raw/` (git-ignored) and never committed. The repo only gets *derived* artefacts: the
  centerline correction I compute, deviation statistics, and overlay plots. Nothing in the game says
  it's official data.

---

## B. Track data (Phase 1)

**Q6 ⏩ Elevation source.**
Spa is in Wallonia, which publishes open LiDAR-derived DEMs (≈1 m resolution, Géoportail de la
Wallonie, open licence with attribution). That's far better than SRTM/Copernicus (30 m), which would
blur Eau Rouge.
- **Default:** use the Wallonia LiDAR DTM as primary, Copernicus GLO-30 for the outer terrain ring,
  and FastF1 Z only as a cross-check (it's noisy, decimetre-scale). If Wallonia is unreachable, I'll
  ask you to download the tiles (Q2).

**Q7 ⏩ Kerbs, runoff, white lines: where the positions come from.**
OSM has the raceway centreline and sometimes gravel/grass areas, but almost never kerbs or exact
white-line positions.
- **Default:** trace kerb and runoff zones by hand into a versioned `data/track/annotations.json`
  (distance-along-track ranges), using open orthophotos (Wallonia ortho WMS, open licence) as the
  reference. Every zone carries a source note. If the orthophotos aren't reachable, I'll ask you
  whether you can supply screenshots/annotations, or whether we accept "plausible, documented"
  placement for kerbs only. Kerbs only, never the track geometry itself.

**Q8 ⏩ "2026 configuration": anything specific in mind?**
I'll verify changes against public sources: the 2022 gravel reinstated at Raidillon / Les Combes /
Stavelot, the Raidillon runoff rebuild, the Bus Stop profile, pit entry/exit.
- **Default:** use the layout as raced at the 2026 Belgian round, documented with sources. Tell me if
  you know of a specific change you want reflected.

**Q9 ⏩ Which corners have enforced track limits?**
Event notes per race aren't always public.
- **Default:** use the most recent Belgian-round Race Director event notes I can find. If I can't
  find them, I use a documented list I propose (e.g. Raidillon exit, Les Combes exit, Pouhon exit,
  Blanchimont, Bus Stop exit) and mark it "assumed" in `data/track/limits.json`.

---

## C. Car & physics (Phase 2)

**Q10 ⏩ Reference data for the 2026 car.**
It's now Nov 2026, so the 2026 season, including Spa, has actually been run.
- **Default:** use the published 2026 Technical/Sporting Regulations (latest issue, including
  mid-season amendments: energy-harvest limits, MGU-K power taper vs speed, active aero zones,
  override mode) for parameters. Use 2026 Belgian round lap times and speed-trap values as the
  pace/top-speed targets. Every figure goes into `data/*.json` with a citation.

**Q11 ⏩ Replay determinism.**
JS doubles are deterministic for the same build in the same engine. `Math.sin/cos/exp` are *not*
guaranteed identical across browsers/V8 versions.
- **Default:** guarantee bit-exact determinism within one build and browser (that's what the tests
  check). Replays also store periodic state keyframes, so they stay correct across browser updates.
  If Rapier is used, it's the deterministic build.

**Q12 ⏩ Physics rate.**
- **Default:** 500 Hz fixed step for the player car and all 21 AI cars (above your ≥360 Hz floor,
  for tyre-model stability at high speed). I'll benchmark and only drop AI cars to 360 Hz if CPU
  needs it, and I'll log the decision.

**Q13 ⏩ An early drivable build?**
In the brief, nothing is drivable in the browser until Phase 3.
- **Default:** at the end of Phase 2, also ship a minimal keyboard-drivable browser build (no
  rebinding/gamepad yet), so you can feel the physics before we build on it.

---

## D. Things I can't verify from a cloud container (acceptance checks)

**Q14 ⏩ Hardware-dependent acceptance checks.**
I can't plug in a DualShock 4/DualSense/Xbox pad or wheel, and I can't measure fps on your
RTX 5060 laptop. The container only has software WebGL.
- **Default:**
  - Input: automated tests with mocked Gamepad API devices that use each controller's real mapping,
    plus a short manual checklist (`docs/MANUAL_TESTS.md`) for you to run on real hardware.
  - Performance: a built-in benchmark mode (scripted fly-around + race camera) that prints
    fps/frame-time percentiles. You run it on your laptop and paste the results back, and I tune.
  - Visual checks (seams, fly-around): automated mesh-topology tests plus Playwright screenshots
    committed to `docs/`.

---

## E. Assets, audio, IP

**Q15 ⏩ Third-party art assets.**
- **Default:** the car, trees, grandstands, pit building and signage are built procedurally in code
  where reasonable. PBR textures/HDRIs come only from CC0 sources (Poly Haven, ambientCG), with
  sources listed in the README. Anything over ~2 MB goes through Git LFS, and **I'll ask before the
  first LFS commit** (is LFS enabled on your remote?).

**Q16 ⏩ Offline TTS voices.**
Open-source TTS models (e.g. Piper) come with voices trained on recordings of real (consenting,
dataset) speakers. That isn't imitation of a specific person, but you asked for "invented" voices.
- **Default:** runtime browser `SpeechSynthesis` plus radio processing. For offline pre-generated
  lines, I propose a short list of permissively licensed Piper voices (multi-speaker/blended, not
  named personalities) for you to approve before I generate anything.

**Q17 ⏩ Fictional teams & sponsors.**
- **Default:** I invent 11 teams (22-car grid), their colours, and ~20 sponsor brands, and check that
  no name collides with a real team or major brand. Tell me if you want to name the player's team.

---

## F. Smaller defaults (answer only if you disagree)

- **Q18 ⏩ Units:** metric (km/h, °C) by default, with an mph/°F toggle.
- **Q19 ⏩ UI language:** English only.
- **Q20 ⏩ Rendering:** WebGL2 renderer by default. Three.js WebGPU behind an experimental setting
  only if it benchmarks better and is stable.
- **Q21 ⏩ Race length:** default 44 laps; the "25% short" option = 11 laps; custom 1–44.
- **Q22 ⏩ Rule numbers:** grid size, Q1/Q2 eliminations for 22 cars, track-limit penalty ladder,
  pit-lane limit, tyre-compound rules. Verified from the 2026 Sporting Regulations, not asked.
  Where real practice differs from your brief, I follow the real rules and log it.
- **Q23 ⏩ Roster vs grid:** ~30 roster drivers; the race grid is 22 drawn from the roster (player +
  21 AI), configurable on the session setup screen.
