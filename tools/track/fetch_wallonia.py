#!/usr/bin/env python3
"""Fetch Wallonia (SPW) data for the circuit:

1. LiDAR DTM 2021-2022 (50 cm) heights at points along the built centerline, via the MapServer
   `identify` endpoint (the service renders images only; identify returns the pixel value). Every 2 m:
   centerline, half-widths and both edges -> elevation and real crossfall (camber).
2. ORTHO_2026_PRINTEMPS orthophoto tiles (rendered RGB, 0.25 m/px) covering the circuit, for tracing
   kerbs, runoff, gravel and the pit lane.

Source/attribution: (c) SPW - Service public de Wallonie, geoportail.wallonie.be. Use is subject to the
SPW web-service conditions (free access, source mention must be kept). Raw files stay in data/raw/.
Resumable: results are cached in data/raw/wallonia/.
"""
from __future__ import annotations

import json
import math
import ssl
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "raw" / "wallonia"
DTM = "https://geoservices.wallonie.be/arcgis/rest/services/RELIEF/WALLONIE_MNT_2021_2022/MapServer"
ORTHO = "https://geoservices.wallonie.be/arcgis/rest/services/IMAGERIE/ORTHO_2026_PRINTEMPS/MapServer"
CA = "/root/.ccr/ca-bundle.crt"
CTX = ssl.create_default_context(cafile=CA) if Path(CA).exists() else ssl.create_default_context()
STEP = 2.0
WORKERS = 6


def get(url: str, retries: int = 5) -> bytes:
    for k in range(retries):
        try:
            with urllib.request.urlopen(url, context=CTX, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if k == retries - 1:
                raise
            time.sleep(2 ** k)
    raise RuntimeError("unreachable")


def identify(xy: tuple[float, float]) -> float | None:
    x, y = xy
    p = dict(geometry=f"{x:.2f},{y:.2f}", geometryType="esriGeometryPoint", sr=3812, layers="all", tolerance=0,
             mapExtent=f"{x-10},{y-10},{x+10},{y+10}", imageDisplay="40,40,96", returnGeometry="false", f="json")
    d = json.loads(get(DTM + "/identify?" + urllib.parse.urlencode(p)))
    try:
        v = d["results"][0]["attributes"]["Stretch.Pixel Value"]
        return float(v)
    except (KeyError, IndexError, ValueError):
        return None


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    m = json.loads((ROOT / "data" / "track" / "spa-2026.json").read_text())
    lat0, lon0 = m["frame"]["originLat"], m["frame"]["originLon"]
    to_ll = Transformer.from_crs(f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +datum=WGS84 +units=m", 4326, always_xy=True)
    to_lb = Transformer.from_crs(4326, 3812, always_xy=True)

    # ---- 1. DTM samples
    cache_f = OUT / "dtm_samples.json"
    cache: dict[str, float | None] = json.loads(cache_f.read_text()) if cache_f.exists() else {}
    jobs = []
    n, ds = m["count"], m["ds"]
    stride = max(1, round(STEP / ds))
    for i in range(0, n, stride):
        h = m["heading"][i]
        rx, ry = math.sin(h), -math.cos(h)
        wl, wr = m["widthLeft"][i], m["widthRight"][i]
        for tag, d in (("L", -(wl - 0.4)), ("l", -wl / 2), ("c", 0.0), ("r", wr / 2), ("R", wr - 0.4)):
            key = f"{i}:{tag}"
            if key in cache:
                continue
            lon, lat = to_ll.transform(m["x"][i] + rx * d, m["y"][i] + ry * d)
            jobs.append((key, to_lb.transform(lon, lat)))
    print(f"DTM: {len(cache)} cached, {len(jobs)} to fetch", flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(WORKERS) as ex:
        for k, (key, val) in enumerate(zip([j[0] for j in jobs], ex.map(lambda j: identify(j[1]), jobs))):
            cache[key] = val
            if k % 500 == 499:
                cache_f.write_text(json.dumps(cache))
                print(f"  {k+1}/{len(jobs)}  {(time.time()-t0)/(k+1)*1000:.0f} ms/pt effective", flush=True)
    cache_f.write_text(json.dumps(cache))
    print("DTM done", flush=True)

    # ---- 2. orthophoto tiles
    xs, ys = [], []
    for i in range(0, n, 10):
        lon, lat = to_ll.transform(m["x"][i], m["y"][i])
        X, Y = to_lb.transform(lon, lat)
        xs.append(X)
        ys.append(Y)
    pad, tile_m, px = 120.0, 1024.0, 4096
    x0, y0 = math.floor((min(xs) - pad) / tile_m) * tile_m, math.floor((min(ys) - pad) / tile_m) * tile_m
    meta = {"crs": "EPSG:3812", "tile_m": tile_m, "px": px, "tiles": []}
    tx = x0
    while tx < max(xs) + pad:
        ty = y0
        while ty < max(ys) + pad:
            f = OUT / f"ortho2026_{int(tx)}_{int(ty)}.jpg"
            if not f.exists():
                p = dict(bbox=f"{tx},{ty},{tx+tile_m},{ty+tile_m}", bboxSR=3812, imageSR=3812, size=f"{px},{px}",
                         format="jpg", f="image", dpi=96, transparent="false")
                f.write_bytes(get(ORTHO + "/export?" + urllib.parse.urlencode(p)))
                print("  ortho", f.name, f.stat().st_size, flush=True)
            meta["tiles"].append({"file": f.name, "x0": tx, "y0": ty})
            ty += tile_m
        tx += tile_m
    (OUT / "ortho2026.json").write_text(json.dumps(meta, indent=1))
    print("ORTHO done", len(meta["tiles"]), "tiles", flush=True)


if __name__ == "__main__":
    sys.exit(main())
