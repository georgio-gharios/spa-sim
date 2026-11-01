#!/usr/bin/env python3
"""Build the Spa-Francorchamps track model from public sources.

Inputs (see tools/track/sources.md, fetched by fetch_sources.sh):
  data/raw/tumftm/Spa.csv, data/raw/bacinger/be-1925.geojson, data/raw/dem/cop30_*.tif
  data/track/annotations.json (hand-authored)
Outputs:
  data/track/spa-2026.json    centerline at ~1 m + annotations resolved to the final frame
  data/track/terrain.bin      Float32 LE heightfield (metres ASL), row-major, rows = +y
  data/track/build-report.json  numbers checked by the acceptance tests / docs
  docs/elevation-profile.png, docs/centerline-overlay.png

World frame: local azimuthal-equidistant (≈ ENU tangent plane) centred on the timing line;
x = east, y = north, z = metres above sea level (EGM2008).

Run with:  python -I tools/track/build_track.py   (from the repo root)
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.merge import merge
from pyproj import Transformer
from scipy.interpolate import CubicSpline
from scipy.ndimage import gaussian_filter, gaussian_filter1d, grey_opening, percentile_filter
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "track"
DOCS = ROOT / "docs"

NOMINAL_LENGTH_M = 7004.0  # bacinger 'length' property; widely published lap length


def log(*a):
    print("[build_track]", *a, file=sys.stderr)


# ----------------------------------------------------------------------------- geometry helpers
def densify(P: np.ndarray, step: float = 1.0) -> np.ndarray:
    out = []
    for a, b in zip(P[:-1], P[1:]):
        n = max(1, int(np.linalg.norm(b - a) / step))
        t = np.linspace(0, 1, n, endpoint=False)[:, None]
        out.append(a + (b - a) * t)
    out.append(P[-1:])
    return np.vstack(out)


def icp_rigid(A: np.ndarray, B_dense: np.ndarray, iters: int = 80):
    """Fit rotation R and translation t so that A @ R.T + t matches the polyline B (dense points)."""
    tree = cKDTree(B_dense)
    R = np.eye(2)
    t = B_dense.mean(0) - A.mean(0)
    for _ in range(iters):
        X = A @ R.T + t
        _, idx = tree.query(X)
        Y = B_dense[idx]
        mx, my = X.mean(0), Y.mean(0)
        H = (X - mx).T @ (Y - my)
        U, _, Vt = np.linalg.svd(H)
        Ri = Vt.T @ U.T
        if np.linalg.det(Ri) < 0:
            Vt[1] *= -1
            Ri = Vt.T @ U.T
        R = Ri @ R
        t = Ri @ (t - mx) + my
    X = A @ R.T + t
    dist, _ = tree.query(X)
    return R, t, dist


def curvature_fd(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Signed curvature of a closed, ~uniformly sampled polyline (finite differences, wrap)."""
    dx = (np.roll(x, -1) - np.roll(x, 1)) / 2
    dy = (np.roll(y, -1) - np.roll(y, 1)) / 2
    ddx = np.roll(x, -1) - 2 * x + np.roll(x, 1)
    ddy = np.roll(y, -1) - 2 * y + np.roll(y, 1)
    return (dx * ddy - dy * ddx) / np.maximum((dx**2 + dy**2) ** 1.5, 1e-9)


def wrap(s: float | np.ndarray, L: float):
    return np.mod(s, L)


def in_range(s: np.ndarray, s0: float, s1: float, L: float) -> np.ndarray:
    """Mask of s inside [s0, s1] on a loop of length L (handles wrap when s1 < s0)."""
    s0, s1 = wrap(s0, L), wrap(s1, L)
    if s0 <= s1:
        return (s >= s0) & (s <= s1)
    return (s >= s0) | (s <= s1)


# ----------------------------------------------------------------------------- DEM
class Dem:
    def __init__(self, paths: list[Path], bounds):
        srcs = [rasterio.open(p) for p in paths]
        arr, transform = merge(srcs, bounds=bounds)
        self.z = arr[0].astype(np.float64)
        self.lon0 = transform.c
        self.lat0 = transform.f
        self.dlon = transform.a
        self.dlat = transform.e  # negative
        for s in srcs:
            s.close()

    def sample(self, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        """Bilinear sample at pixel centres."""
        c = (lon - self.lon0) / self.dlon - 0.5
        r = (lat - self.lat0) / self.dlat - 0.5
        c0 = np.floor(c).astype(int)
        r0 = np.floor(r).astype(int)
        fc = c - c0
        fr = r - r0
        H, W = self.z.shape
        c0 = np.clip(c0, 0, W - 2)
        r0 = np.clip(r0, 0, H - 2)
        z = self.z
        return (
            z[r0, c0] * (1 - fc) * (1 - fr)
            + z[r0, c0 + 1] * fc * (1 - fr)
            + z[r0 + 1, c0] * (1 - fc) * fr
            + z[r0 + 1, c0 + 1] * fc * fr
        )


def catmull_rom(points: np.ndarray, step: float = 1.0) -> np.ndarray:
    """Centripetal Catmull-Rom through points (open), resampled at ~step metres."""
    P = np.vstack([2 * points[0] - points[1], points, 2 * points[-1] - points[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t0 = 0.0
        t1 = t0 + np.linalg.norm(p1 - p0) ** 0.5
        t2 = t1 + np.linalg.norm(p2 - p1) ** 0.5
        t3 = t2 + np.linalg.norm(p3 - p2) ** 0.5
        n = max(2, int(np.linalg.norm(p2 - p1) / step))
        for t in np.linspace(t1, t2, n, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    out.append(points[-1])
    return np.array(out)


def resample_polyline(P: np.ndarray, step: float = 1.0) -> np.ndarray:
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.r_[0, np.cumsum(seg)]
    n = max(2, int(round(s[-1] / step)) + 1)
    ss = np.linspace(0, s[-1], n)
    return np.c_[np.interp(ss, s, P[:, 0]), np.interp(ss, s, P[:, 1])]


# ----------------------------------------------------------------------------- main
def main() -> None:
    ann = json.loads((OUT / "annotations.json").read_text())

    # --- sources
    tum = np.loadtxt(RAW / "tumftm" / "Spa.csv", delimiter=",", comments="#")
    gj = json.loads((RAW / "bacinger" / "be-1925.geojson").read_text())
    ll = np.array(gj["features"][0]["geometry"]["coordinates"], dtype=float)
    lon_ref, lat_ref = ll[0]

    to_local = Transformer.from_crs(
        4326, f"+proj=aeqd +lat_0={lat_ref} +lon_0={lon_ref} +datum=WGS84 +units=m", always_xy=True
    )
    bx, by = to_local.transform(ll[:, 0], ll[:, 1])
    B = np.c_[bx, by]
    B_dense = densify(B, 1.0)

    # --- georeference TUMFTM onto bacinger (rigid)
    R, t, fit_dist = icp_rigid(tum[:, :2], B_dense)
    rot_deg = math.degrees(math.atan2(R[1, 0], R[0, 0]))
    log(f"ICP rot={rot_deg:.3f} deg  rms={np.sqrt((fit_dist**2).mean()):.2f} m  max={fit_dist.max():.2f} m")
    X = tum[:, :2] @ R.T + t
    wR_raw, wL_raw = tum[:, 2], tum[:, 3]

    # --- periodic spline over the TUMFTM samples
    P = np.vstack([X, X[:1]])
    s_raw = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    L_raw = s_raw[-1]
    cx = CubicSpline(s_raw, P[:, 0], bc_type="periodic")
    cy = CubicSpline(s_raw, P[:, 1], bc_type="periodic")
    cwr = CubicSpline(s_raw, np.r_[wR_raw, wR_raw[:1]], bc_type="periodic")
    cwl = CubicSpline(s_raw, np.r_[wL_raw, wL_raw[:1]], bc_type="periodic")

    # timing line = projection of bacinger's first vertex (local origin) on the spline
    fine = np.arange(0, L_raw, 0.05)
    d2 = cx(fine) ** 2 + cy(fine) ** 2
    s_origin = float(fine[np.argmin(d2)])
    log(f"timing line at TUMFTM s={s_origin:.2f} m (offset from bacinger vertex {math.sqrt(d2.min()):.2f} m)")

    # true arc length of the spline (dense integration)
    dense = np.arange(0, L_raw, 0.1)
    sp = np.hypot(cx(dense, 1), cy(dense, 1))
    L = float(np.sum(sp) * 0.1)
    N = int(round(L))
    ds = L / N
    # map uniform arc length -> spline parameter
    arc = np.r_[0, np.cumsum(sp * 0.1)]
    par = np.r_[dense, L_raw]
    s_out = np.arange(N) * ds
    a_target = np.mod(np.interp(s_origin, par, arc) + s_out, arc[-1])
    u = np.interp(a_target, arc, par)
    x = cx(u)
    y = cy(u)
    wL = cwl(u)
    wR = cwr(u)

    # The OSM-derived polyline has vertex kinks at the tightest apexes (e.g. a 5.6 m radius spike at
    # La Source). Locally smooth positions wherever the centerline radius drops below MIN_RADIUS.
    MIN_RADIUS = 12.0
    for it in range(400):
        k = curvature_fd(x, y)
        bad = np.abs(k) > 1.0 / MIN_RADIUS
        if not bad.any():
            break
        m = gaussian_filter1d(bad.astype(float), 6, mode="wrap")
        m = np.clip(m * 3, 0, 1)
        xs = gaussian_filter1d(x, 2.0, mode="wrap")
        ys = gaussian_filter1d(y, 2.0, mode="wrap")
        x = x * (1 - m) + xs * m
        y = y * (1 - m) + ys * m
    log(f"curvature regularisation: {it} iterations, max |k| now {np.abs(curvature_fd(x, y)).max():.4f}")
    # refit and resample uniformly (smoothing perturbs the spacing slightly); index 0 stays the timing line
    P2 = np.vstack([np.c_[x, y], [x[0], y[0]]])
    s2 = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P2, axis=0), axis=1))]
    sx = CubicSpline(s2, P2[:, 0], bc_type="periodic")
    sy = CubicSpline(s2, P2[:, 1], bc_type="periodic")
    swl = CubicSpline(s2, np.r_[wL, wL[:1]], bc_type="periodic")
    swr = CubicSpline(s2, np.r_[wR, wR[:1]], bc_type="periodic")
    L = float(s2[-1])
    N = int(round(L))
    ds = L / N
    s_out = np.arange(N) * ds
    x, y, wL, wR = sx(s_out), sy(s_out), swl(s_out), swr(s_out)
    dx, dy = sx(s_out, 1), sy(s_out, 1)
    ddx, ddy = sx(s_out, 2), sy(s_out, 2)
    heading = np.arctan2(dy, dx)
    curvature = (dx * ddy - dy * ddx) / (dx**2 + dy**2) ** 1.5
    x0, y0 = float(x[0]), float(y[0])
    x -= x0
    y -= y0

    # geographic origin of the timing line
    to_ll = Transformer.from_crs(
        f"+proj=aeqd +lat_0={lat_ref} +lon_0={lon_ref} +datum=WGS84 +units=m", 4326, always_xy=True
    )
    lon_o, lat_o = to_ll.transform(x0, y0)
    # re-centre the local projection on the timing line (difference < 1 cm over the site)
    to_local = Transformer.from_crs(
        4326, f"+proj=aeqd +lat_0={lat_o} +lon_0={lon_o} +datum=WGS84 +units=m", always_xy=True
    )
    to_ll = Transformer.from_crs(
        f"+proj=aeqd +lat_0={lat_o} +lon_0={lon_o} +datum=WGS84 +units=m", 4326, always_xy=True
    )
    bx, by = to_local.transform(ll[:, 0], ll[:, 1])
    B = np.c_[bx, by]

    # --- DEM
    lon_c, lat_c = to_ll.transform(x, y)
    pad = 0.02
    dem = Dem(
        sorted((RAW / "dem").glob("cop30_*.tif")),
        bounds=(lon_c.min() - pad, lat_c.min() - pad, lon_c.max() + pad, lat_c.max() + pad),
    )

    nx_r, ny_r = np.sin(heading), -np.cos(heading)  # right-hand normal
    lat_samples = []
    for f in (-1.0, -0.5, 0.0, 0.5, 1.0):
        off = np.where(f < 0, f * wL, f * wR)
        px, py = x + nx_r * off, y + ny_r * off
        lo, la = to_ll.transform(px, py)
        lat_samples.append(dem.sample(np.asarray(lo), np.asarray(la)))
    z_raw = np.min(np.vstack(lat_samples), axis=0)  # reject canopy at the edges
    win = int(round(61 / ds)) | 1
    z_lo = percentile_filter(z_raw, 20, size=win, mode="wrap")  # reject trees/bridges along track
    base = gaussian_filter1d(z_lo, sigma=60 / ds, mode="wrap")
    resid = z_lo - base
    # structures and trees only ever ADD height: cap positive residuals, keep dips (Eau Rouge) intact
    z_c = base + np.minimum(resid, 1.0)
    z = gaussian_filter1d(z_c, sigma=12 / ds, mode="wrap")
    grade = np.gradient(z, ds)
    log(f"elevation min={z.min():.1f} max={z.max():.1f} delta={z.max() - z.min():.1f} m; max grade {grade.max()*100:.1f}% / {grade.min()*100:.1f}%")

    # --- annotations resolved
    def zones_mask(zs):
        return [in_range(s_out, z_["s0"], z_["s1"], L) for z_ in zs]

    camber = np.full(N, float(ann["camber"]["default"]))
    for zn in ann["camber"]["zones"]:
        m = in_range(s_out, zn["s0"], zn["s1"], L)
        camber[m] = zn["deg"]
    camber = gaussian_filter1d(camber, sigma=12 / ds, mode="wrap")  # smooth transitions

    corners = ann["corners"]["list"]
    kd = ann["kerbs"]["defaults"]
    overrides = {o["corner"]: o["type"] for o in ann["kerbs"]["typeOverrides"]}
    kerbs = []
    for c in corners:
        inside = "right" if c["dir"] == "R" else "left"
        outside = "left" if inside == "right" else "right"
        ktype = overrides.get(c["n"], "standard")
        kerbs.append({"corner": c["n"], "side": inside, "s0": float(wrap(c["apex"] - kd["insideBefore"], L)),
                      "s1": float(wrap(c["apex"] + kd["insideAfter"], L)), "type": ktype,
                      "width": kd["insideWidth"], "offset": 0.0})
        kerbs.append({"corner": c["n"], "side": outside, "s0": float(wrap(c["apex"] + kd["outsideAfterApex"], L)),
                      "s1": float(wrap(c["s1"] + kd["outsideBeyondExit"], L)), "type": ktype,
                      "width": kd["outsideWidth"], "offset": 0.0})
    for e in ann["kerbs"]["extra"]:
        kerbs.append({"corner": None, "side": e["side"], "s0": e["s0"], "s1": e["s1"], "type": e["type"],
                      "width": e["width"], "offset": e["offset"]})

    # --- pit lane path
    pit = ann["pit"]

    def pt(s, off):
        i = int(round(wrap(s, L) / ds)) % N
        return np.array([x[i] + nx_r[i] * off, y[i] + ny_r[i] * off])

    def hd(s):
        i = int(round(wrap(s, L) / ds)) % N
        return np.array([math.cos(heading[i]), math.sin(heading[i])])

    def idx(s):
        return int(round(wrap(s, L) / ds)) % N

    # The lane leaves the left edge before the Bus Stop and runs straight on while the track jogs right
    # through the chicane, follows the left of the start/finish straight, passes around the outside of
    # La Source and runs alongside the left of the descent before merging (pit-exit line on the left).
    e_s = pit["entryS"]
    off = -pit["laneOffset"]
    ctrl = [pt(e_s - 40, -(wL[idx(e_s - 40)] - 2.0)), pt(e_s, -(wL[idx(e_s)] + 1.0)), pt(e_s + 40, -(wL[idx(e_s + 40)] + 5.0))]
    a_pt = pt(e_s + 80, -(wL[idx(e_s + 80)] + 7.0))
    b_pt = pt(6800, off)
    for f in np.linspace(0, 1, 6)[:-1]:
        ctrl.append((1 - f) * a_pt + f * b_pt)
    for s_ in np.arange(6800, L + 390, 30):
        # widen around the outside of La Source (hairpin) so the lane clears the track edge
        sm = s_ - L
        f = np.clip(min((sm - 120) / 60, (390 - sm) / 40), 0, 1) if sm > 0 else 0.0
        ctrl.append(pt(s_, off - 5.0 * f))
    m_s = pit["mergeS"]
    for s_ in np.arange(420, m_s + 61, 30):
        f = np.clip((s_ - 420) / (m_s + 60 - 420), 0, 1)
        f = f * f * (3 - 2 * f)
        target = -(wL[idx(s_)] - 1.5)
        ctrl.append(pt(s_, (1 - f) * off + f * target))
    pit_xy = resample_polyline(catmull_rom(np.array(ctrl), 2.0), 1.0)

    # pit-lane clearance from the racing surface (excluding the entry/merge ends)
    tree_c = cKDTree(np.c_[x, y])
    dist_c, near = tree_c.query(pit_xy)
    half = np.maximum(wL, wR)[near]
    clearance = dist_c - half - pit["laneWidth"] / 2
    # segregated section: from the end of the entry split to the start of the exit run-alongside
    _, k0 = cKDTree(pit_xy).query(pt(e_s + 90, off))
    _, k1 = cKDTree(pit_xy).query(pt(330, off))
    core = slice(int(k0), int(k1))
    log(f"pit lane length {len(pit_xy)} m; min clearance in core section {clearance[core].min():.2f} m")

    tree_p = cKDTree(pit_xy)

    def pit_s(main_s: float) -> float:
        i = idx(main_s)
        return float(tree_p.query([x[i], y[i]])[1])

    pit_features = {
        "speedLimitStart": pit_s(pit["speedLimitStartS"]),
        "speedLimitEnd": pit_s(pit["speedLimitEndS"]),
        "boxesStart": pit_s(pit["boxesS0"]),
        "boxesEnd": pit_s(pit["boxesS1"]),
        "exitLineStart": pit_s(pit["exitLine"]["s0"]),
        "exitLineEnd": pit_s(pit["exitLine"]["s1"]),
    }
    log(f"pit features (pit-lane metres): {pit_features}")

    lo_p, la_p = to_ll.transform(pit_xy[:, 0], pit_xy[:, 1])
    z_pit_dem = dem.sample(np.asarray(lo_p), np.asarray(la_p))
    # pit lane follows the main road height at its nearest point, blended with the DEM away from it
    z_pit = gaussian_filter1d(z[near], 8)

    # --- terrain heightfield
    cell = 10.0
    margin = 700.0
    gx0 = math.floor((x.min() - margin) / cell) * cell
    gy0 = math.floor((y.min() - margin) / cell) * cell
    gx1 = math.ceil((x.max() + margin) / cell) * cell
    gy1 = math.ceil((y.max() + margin) / cell) * cell
    nxg = int((gx1 - gx0) / cell) + 1
    nyg = int((gy1 - gy0) / cell) + 1
    GX, GY = np.meshgrid(gx0 + np.arange(nxg) * cell, gy0 + np.arange(nyg) * cell)
    glo, gla = to_ll.transform(GX.ravel(), GY.ravel())
    terr = dem.sample(np.asarray(glo), np.asarray(gla)).reshape(nyg, nxg)
    terr = grey_opening(terr, size=(7, 7))  # suppress forest canopy (DSM -> DTM-ish)
    terr = gaussian_filter(terr, 1.2)

    # flatten the corridor under the road, runoff and pit lane
    def runoff_total(side: str) -> np.ndarray:
        dflt = sum(l_["width"] for l_ in ann["runoff"]["default"])
        out = np.full(N, dflt)
        for zn in ann["runoff"]["zones"]:
            if zn["side"] == side:
                out[in_range(s_out, zn["s0"], zn["s1"], L)] = sum(l_["width"] for l_ in zn["layers"])
        return out

    corr = np.maximum(wL + runoff_total("left"), wR + runoff_total("right")) + 3.0
    pts_all = np.vstack([np.c_[x, y], pit_xy])
    z_all = np.r_[z, z_pit]
    corr_all = np.r_[corr, np.full(len(pit_xy), pit["laneWidth"] / 2 + 25.0)]
    tree_all = cKDTree(pts_all)
    dg, ig = tree_all.query(np.c_[GX.ravel(), GY.ravel()])
    dg = dg.reshape(nyg, nxg)
    ig = ig.reshape(nyg, nxg)
    # follow the cambered road plane laterally for main-track nodes (pit lane is flat)
    gxy = np.c_[GX.ravel(), GY.ravel()].reshape(nyg, nxg, 2)
    is_main = ig < N
    im = np.where(is_main, ig, 0)
    lat_d = (gxy[..., 0] - x[im]) * nx_r[im] + (gxy[..., 1] - y[im]) * ny_r[im]
    lat_d = np.clip(lat_d, -(wL[im] + 2.0), wR[im] + 2.0)
    cam_dz = np.where(is_main, -lat_d * np.tan(np.radians(camber[im])), 0.0)
    road_z = z_all[ig] + cam_dz - 0.55
    inner = corr_all[ig]
    blend = np.clip((dg - inner) / 45.0, 0, 1)
    blend = blend * blend * (3 - 2 * blend)
    terr = road_z * (1 - blend) + terr * blend
    log(f"terrain grid {nxg}x{nyg} @ {cell} m")

    # --- outputs
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "terrain.bin").write_bytes(terr.astype("<f4").tobytes())

    r3 = lambda a: [round(float(v), 3) for v in a]  # noqa: E731
    model = {
        "format": "spa-track/1",
        "name": "Circuit de Spa-Francorchamps",
        "configuration": "2026 Grand Prix layout",
        "direction": "clockwise",
        "sources": {
            "centerline": "TUMFTM racetrack-database Spa.csv (LGPL-3.0; OSM-derived, (c) OpenStreetMap contributors, ODbL)",
            "georeference": "bacinger/f1-circuits be-1925.geojson (MIT; OSM-derived)",
            "elevation": "Copernicus GLO-30 DEM (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA",
            "annotations": "data/track/annotations.json (see per-block source notes)",
        },
        "frame": {
            "description": "local azimuthal-equidistant tangent plane at the timing line; x east, y north, z metres ASL (EGM2008)",
            "originLat": round(lat_o, 8),
            "originLon": round(lon_o, 8),
        },
        "length": round(L, 3),
        "nominalLength": NOMINAL_LENGTH_M,
        "count": N,
        "ds": ds,
        "x": r3(x),
        "y": r3(y),
        "z": r3(z),
        "heading": [round(float(v), 5) for v in heading],
        "curvature": [round(float(v), 6) for v in curvature],
        "camberDeg": [round(float(v), 2) for v in camber],
        "widthLeft": r3(wL),
        "widthRight": r3(wR),
        "corners": corners,
        "sectors": {"boundaries": ann["sectors"]["boundaries"], "miniSectorCount": ann["sectors"]["miniSectorCount"]},
        "kerbs": kerbs,
        "runoff": {"default": ann["runoff"]["default"], "zones": ann["runoff"]["zones"]},
        "barriers": ann["barriers"],
        "trackLimits": ann["trackLimits"]["enforced"],
        "pit": {
            **{k: v for k, v in pit.items() if k != "source"},
            "pathFeatures": pit_features,
            "path": {"x": r3(pit_xy[:, 0]), "y": r3(pit_xy[:, 1]), "z": r3(z_pit)},
        },
        "terrain": {"file": "terrain.bin", "x0": gx0, "y0": gy0, "cell": cell, "nx": nxg, "ny": nyg},
    }
    (OUT / "spa-2026.json").write_text(json.dumps(model, separators=(",", ":")))

    # deviation of final centerline vs bacinger (independent OSM trace)
    tree_b = cKDTree(densify(np.vstack([B, B[:1]]), 0.5))
    dev, _ = tree_b.query(np.c_[x, y])
    report = {
        "length_m": L,
        "nominal_length_m": NOMINAL_LENGTH_M,
        "length_error_pct": (L - NOMINAL_LENGTH_M) / NOMINAL_LENGTH_M * 100,
        "samples": N,
        "ds_m": ds,
        "icp_rotation_deg": rot_deg,
        "dev_vs_bacinger_m": {"rms": float(np.sqrt((dev**2).mean())), "p95": float(np.percentile(dev, 95)), "max": float(dev.max()),
                              "max_at_s": float(s_out[np.argmax(dev)])},
        "elevation_m": {"min": float(z.min()), "max": float(z.max()), "delta": float(z.max() - z.min()),
                        "min_at_s": float(s_out[np.argmin(z)]), "max_at_s": float(s_out[np.argmax(z)]),
                        "timing_line": float(z[0])},
        "max_grade_pct": {"up": float(grade.max() * 100), "down": float(grade.min() * 100),
                          "up_at_s": float(s_out[np.argmax(grade)]), "down_at_s": float(s_out[np.argmin(grade)])},
        "width_m": {"min": float((wL + wR).min()), "max": float((wL + wR).max()), "mean": float((wL + wR).mean())},
        "signed_area_m2": float(0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y)),
        "pit_lane_length_m": int(len(pit_xy)),
        "pit_min_clearance_m": float(clearance[core].min()),
        "telemetry_overlay": "not run: FastF1 requires F1 account credentials (see PROGRESS.md)",
    }
    (OUT / "build-report.json").write_text(json.dumps(report, indent=2))
    log(json.dumps(report, indent=2))

    # --- plots
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    DOCS.mkdir(exist_ok=True)
    fig, ax = plt.subplots(figsize=(14, 5), dpi=120)
    ax.plot(s_out / 1000, z_raw, color="#bbbbbb", lw=0.6, label="GLO-30 raw (min across road)")
    ax.plot(s_out / 1000, z_lo, color="#e0a03a", lw=0.6, alpha=0.7, label="20th-pct filtered")
    ax.plot(s_out / 1000, z, color="#1f5fa8", lw=2, label="processed elevation")
    for c in corners:
        i = idx(c["apex"])
        ax.annotate(f'T{c["n"]}', (s_out[i] / 1000, z[i]), textcoords="offset points", xytext=(0, 10),
                    ha="center", fontsize=8)
    for b in ann["sectors"]["boundaries"]:
        ax.axvline(b / 1000, color="#999", ls="--", lw=0.8)
    for name, s_ in (("Eau Rouge", 917), ("Kemmel", 1700), ("Les Combes", 2285), ("Pouhon", 3800), ("Stavelot", 5035), ("Blanchimont", 6040)):
        i = idx(s_)
        ax.text(s_out[i] / 1000, z.min() - 8, name, ha="center", fontsize=8, color="#555")
    ax.set_xlabel("distance from timing line [km]")
    ax.set_ylabel("elevation [m ASL]")
    ax.set_title(f"Spa-Francorchamps elevation profile — Δ {z.max()-z.min():.1f} m, lap {L/1000:.3f} km")
    ax.set_xlim(0, L / 1000)
    ax.set_ylim(z.min() - 15, z.max() + 15)
    ax.grid(alpha=0.3)
    ax.legend(loc="upper right")
    fig.tight_layout()
    fig.savefig(DOCS / "elevation-profile.png")
    plt.close(fig)

    fig, axs = plt.subplots(1, 2, figsize=(15, 8), dpi=110, gridspec_kw={"width_ratios": [1.1, 1]})
    ax = axs[0]
    ax.plot(B[:, 0], B[:, 1], color="#e0663a", lw=3, alpha=0.6, label="bacinger/f1-circuits (OSM trace)")
    ax.plot(x, y, color="#1f5fa8", lw=1, label="final centerline (TUMFTM, fitted)")
    ax.plot(pit_xy[:, 0], pit_xy[:, 1], color="#2a9d4b", lw=1, label="pit lane (assumed)")
    for c in corners:
        i = idx(c["apex"])
        ax.annotate(str(c["n"]), (x[i], y[i]), fontsize=8, xytext=(4, 4), textcoords="offset points")
    ax.plot([0], [0], "ko", ms=4)
    ax.set_aspect("equal")
    ax.legend(loc="lower left", fontsize=8)
    ax.set_title("Centerline vs independent OSM trace (FastF1 telemetry pending)")
    ax.set_xlabel("east [m]")
    ax.set_ylabel("north [m]")
    ax = axs[1]
    ax.plot(s_out / 1000, dev, color="#333", lw=0.8)
    ax.set_title(f"lateral deviation: rms {np.sqrt((dev**2).mean()):.2f} m, max {dev.max():.2f} m")
    ax.set_xlabel("distance [km]")
    ax.set_ylabel("deviation [m]")
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(DOCS / "centerline-overlay.png")
    plt.close(fig)


if __name__ == "__main__":
    main()
