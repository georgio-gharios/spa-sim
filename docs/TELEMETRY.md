# Adding real F1 telemetry (optional)

FastF1 reads Formula 1's live-timing archive. Since 2025/26 that archive needs a signed-in F1 account
**with an active F1 TV subscription**: FastF1 refuses the token otherwise ("An active F1TV subscription
is required"). The data belongs to Formula One Management; this project uses it only to validate the
track. Raw telemetry is never committed.

## Option A: run it on your Windows laptop (recommended)

1. Install Python 3.12+ from python.org (tick "Add python.exe to PATH").
2. In PowerShell, inside the `spa-sim` folder:

   ```
   git pull
   py -m pip install fastf1 numpy scipy matplotlib
   $env:F1_USERNAME = "you@example.com"
   $env:F1_PASSWORD = "your-password"
   py tools/telemetry/export_fastf1.py --year 2026 --session Q
   py tools/track/telemetry_overlay.py (Get-ChildItem data/raw/telemetry/spa_2026_Q_*.csv).FullName
   ```

   The `$env:` lines only last for that PowerShell window, so nothing is saved to disk or git.
3. Commit and push only the two derived files: `docs/telemetry-overlay.png` and `data/track/telemetry-report.json`.

## Option B: let the cloud session do it

Add `F1_USERNAME` and `F1_PASSWORD` as secrets in the cloud environment's settings, and add
`account.formula1.com`, `api.formula1.com`, `id.formula1.com` and `livetiming.formula1.com` to its
allowed domains. A new session picks them up.

## Without F1 TV

Not needed for the track itself: the centerline, elevation, banking, kerbs and pit lane are now
cross-checked against the Wallonia 50 cm LiDAR terrain model and the spring-2026 orthophotos.
Public lap and qualifying times (Jolpica/Ergast API, reachable from the cloud) give the Phase 2
lap-time target. Telemetry would still help pin down the exact timing-line and sector-boundary
positions.
