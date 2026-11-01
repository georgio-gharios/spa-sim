#!/usr/bin/env bash
# Downloads raw track inputs into data/raw (git-ignored). See tools/track/sources.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p data/raw/tumftm data/raw/bacinger data/raw/dem
gh_raw=https://raw.githubusercontent.com
curl -fsSL "$gh_raw/TUMFTM/racetrack-database/master/tracks/Spa.csv" -o data/raw/tumftm/Spa.csv
curl -fsSL "$gh_raw/TUMFTM/racetrack-database/master/LICENSE" -o data/raw/tumftm/LICENSE
curl -fsSL "$gh_raw/bacinger/f1-circuits/master/circuits/be-1925.geojson" -o data/raw/bacinger/be-1925.geojson
curl -fsSL "$gh_raw/bacinger/f1-circuits/master/LICENSE.md" -o data/raw/bacinger/LICENSE.md
for t in N50_00_E005_00 N50_00_E006_00; do
  f=data/raw/dem/cop30_${t:0:3}_${t:7:4}.tif
  [ -f "$f" ] || curl -fsSL "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_${t}_DEM/Copernicus_DSM_COG_10_${t}_DEM.tif" -o "$f"
done
ls -la data/raw/*
