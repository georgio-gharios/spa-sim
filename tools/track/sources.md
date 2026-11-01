# Track data sources

`tools/track/fetch_sources.sh` downloads the inputs into `data/raw/` (git-ignored).

| Source | What we use | License | URL |
|---|---|---|---|
| TUMFTM racetrack-database `tracks/Spa.csv` | centerline (x, y) in a UTM-grid-aligned local frame, track widths left/right | LGPL-3.0. Centerline is OSM-derived (ODbL); widths come from satellite imagery processed by TUM | https://github.com/TUMFTM/racetrack-database |
| bacinger/f1-circuits `be-1925.geojson` | WGS84 georeference for the TUMFTM line, independent cross-check, nominal length 7004 m | MIT (geometry OSM-derived, ODbL) | https://github.com/bacinger/f1-circuits |
| Copernicus GLO-30 DEM, tiles N50E005 and N50E006 | elevation (DSM, EGM2008 heights) | Copernicus DEM licence (free, attribution: "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA") | https://copernicus-dem-30m.s3.amazonaws.com |

Wanted but blocked from the build environment (see PROGRESS.md "Owner actions"):
- OpenStreetMap raw ways (`highway=raceway`, pit lane `service=pit_lane`, gravel/grass areas) via Overpass.
- Wallonia LiDAR DTM (1 m) and orthophotos (Géoportail de la Wallonie).
- FastF1 position telemetry (needs an F1 account since 2025/26).

© OpenStreetMap contributors. Track geometry is derived from OSM data, available under the Open Database License.
