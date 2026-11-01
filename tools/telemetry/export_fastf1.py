#!/usr/bin/env python3
"""Export real car position telemetry for Spa from FastF1 (run on your own machine).

Since 2025/26 F1's live-timing archive needs a signed-in F1 account, so this can't run in the
cloud build environment. Run it locally:

    pip install fastf1
    export F1_USERNAME=... F1_PASSWORD=...        # your own F1 account (never commit these)
    python tools/telemetry/export_fastf1.py --year 2026 --session Q

It writes data/raw/telemetry/spa_<year>_<session>_<driver>.csv (git-ignored) with columns
Distance_m, X_dm, Y_dm, Z_dm, Speed_kmh for the fastest lap of the top N drivers. Then run
tools/track/telemetry_overlay.py to compare against our centerline.

Terms: F1 timing data is owned by Formula One Management; use for personal validation only.
The raw files stay out of git; only derived statistics/plots are committed.
"""
import argparse
from pathlib import Path

import fastf1

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--session", default="Q")
    ap.add_argument("--drivers", type=int, default=5, help="top-N fastest drivers to export")
    args = ap.parse_args()
    out = ROOT / "data" / "raw" / "telemetry"
    out.mkdir(parents=True, exist_ok=True)
    (out / "cache").mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(out / "cache"))
    s = fastf1.get_session(args.year, "Belgian Grand Prix", args.session)
    s.load(laps=True, telemetry=True, weather=False, messages=False)
    laps = s.laps.pick_quicklaps()
    drivers = laps.groupby("Driver")["LapTime"].min().sort_values().index[: args.drivers]
    for drv in drivers:
        lap = s.laps.pick_drivers(drv).pick_fastest()
        tel = lap.get_telemetry().add_distance()
        df = tel[["Distance", "X", "Y", "Z", "Speed"]].rename(
            columns={"Distance": "Distance_m", "X": "X_dm", "Y": "Y_dm", "Z": "Z_dm", "Speed": "Speed_kmh"}
        )
        path = out / f"spa_{args.year}_{args.session}_{drv}.csv"
        df.to_csv(path, index=False)
        print(f"{drv}: lap {lap['LapTime']} -> {path} ({len(df)} samples)")


if __name__ == "__main__":
    main()
