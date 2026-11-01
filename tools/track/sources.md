# Track data sources

`tools/track/fetch_sources.sh` downloads the inputs into `data/raw/` (git-ignored).

| Source | What we use | License | URL |
|---|---|---|---|
| TUMFTM racetrack-database `tracks/Spa.csv` | centerline (x, y) in a UTM-grid-aligned local frame, track widths left/right | LGPL-3.0. Centerline is OSM-derived (ODbL); widths come from satellite imagery processed by TUM | https://github.com/TUMFTM/racetrack-database |
| bacinger/f1-circuits `be-1925.geojson` | WGS84 georeference for the TUMFTM line, independent cross-check, nominal length 7004 m | MIT (geometry OSM-derived, ODbL) | https://github.com/bacinger/f1-circuits |
| Copernicus GLO-30 DEM, tiles N50E005 and N50E006 | elevation (DSM, EGM2008 heights) | Copernicus DEM licence (free, attribution: "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA") | https://copernicus-dem-30m.s3.amazonaws.com |

| SPW Relief de la Wallonie, MNT 2021-2022 LiDAR (50 cm) | road elevation and banking, sampled with `fetch_wallonia.py` | SPW web-service conditions (free access, credit the source: "© SPW - Service public de Wallonie") | https://geoservices.wallonie.be/arcgis/rest/services/RELIEF/WALLONIE_MNT_2021_2022/MapServer |
| SPW ORTHO_2026_PRINTEMPS (0.25 m/px) | tracing the pit lane, checking edges, grandstands, timing line | same | https://geoservices.wallonie.be/arcgis/rest/services/IMAGERIE/ORTHO_2026_PRINTEMPS/MapServer |

Wanted but blocked from the build environment (see PROGRESS.md "Owner actions"):
- OpenStreetMap raw ways (`highway=raceway`, pit lane `service=pit_lane`, gravel/grass areas) via Overpass.
- FastF1 position telemetry (needs an F1 account since 2025/26).

© OpenStreetMap contributors. Track geometry is derived from OSM data, available under the Open Database License.
