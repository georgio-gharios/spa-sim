#!/usr/bin/env python3
"""Overlay real telemetry positions (FastF1 export) on the built centerline.

    python -I tools/track/telemetry_overlay.py data/raw/telemetry/spa_2026_Q_*.csv
    python -I tools/track/telemetry_overlay.py --selftest

FastF1 X/Y/Z are decimetres in an arbitrary rotated circuit frame, so we fit a rigid 2D transform
(rotation + translation, scale fixed at 0.1 m/dm) with ICP. Outputs docs/telemetry-overlay.png and
data/track/telemetry-report.json (max/RMS lateral deviation, elevation offset/deviation).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_track import icp_rigid  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def load_track():
    m = json.loads((ROOT / "data" / "track" / "spa-2026.json").read_text())
    return np.c_[m["x"], m["y"]], np.array(m["z"]), m


def icp_with_init(A: np.ndarray, B: np.ndarray):
    """Try several initial rotations (telemetry frames are arbitrarily rotated) and keep the best fit."""
    best = None
    for ang in np.radians(np.arange(0, 360, 30)):
        c, s = np.cos(ang), np.sin(ang)
        R0 = np.array([[c, -s], [s, c]])
        A0 = (A - A.mean(0)) @ R0.T + B.mean(0)
        R, t, d = icp_rigid(A0, B, iters=60)
        rms = float(np.sqrt((d**2).mean()))
        if best is None or rms < best[0]:
            best = (rms, A0 @ R.T + t, d)
    return best


def overlay(paths: list[Path], label: str) -> dict:
    C, Z, m = load_track()
    tree = cKDTree(C)
    report = {"files": [], "label": label}
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axs = plt.subplots(1, 3, figsize=(18, 6), dpi=110)
    axs[0].plot(C[:, 0], C[:, 1], color="#1f5fa8", lw=2, label="centerline")
    for p in paths:
        raw = np.genfromtxt(p, delimiter=",", names=True)
        A = np.c_[raw["X_dm"], raw["Y_dm"]] * 0.1
        za = raw["Z_dm"] * 0.1
        rms, X, _ = icp_with_init(A, C)
        dist, idx = tree.query(X)
        dz = za - Z[idx]
        dz_off = float(np.median(dz))
        dz_dev = dz - dz_off
        r = {
            "file": p.name,
            "samples": int(len(X)),
            "lateral_rms_m": float(np.sqrt((dist**2).mean())),
            "lateral_p95_m": float(np.percentile(dist, 95)),
            "lateral_max_m": float(dist.max()),
            "lateral_max_at_s": float(idx[np.argmax(dist)] * m["ds"]),
            "z_offset_m": dz_off,
            "z_dev_rms_m": float(np.sqrt((dz_dev**2).mean())),
            "z_dev_max_m": float(np.abs(dz_dev).max()),
        }
        report["files"].append(r)
        axs[0].plot(X[:, 0], X[:, 1], lw=0.7, alpha=0.8, label=p.stem)
        axs[1].plot(idx * m["ds"] / 1000, dist, lw=0.6, label=p.stem)
        axs[2].plot(idx * m["ds"] / 1000, za - dz_off, lw=0.6, label=f"{p.stem} (shifted {dz_off:+.1f} m)")
        print(json.dumps(r))
    axs[2].plot(np.arange(len(Z)) * m["ds"] / 1000, Z, color="k", lw=1.2, label="centerline z")
    axs[0].set_aspect("equal")
    axs[0].legend(fontsize=7)
    axs[0].set_title(f"positions ({label})")
    axs[1].set_title("lateral distance telemetry -> centerline [m]")
    axs[1].set_xlabel("km")
    axs[2].set_title("elevation [m]")
    axs[2].set_xlabel("km")
    axs[2].legend(fontsize=7)
    for a in axs[1:]:
        a.grid(alpha=0.3)
    fig.tight_layout()
    return report, fig


def selftest() -> None:
    """Validate the alignment code: perturb our own centerline into a FastF1-like frame and recover it."""
    C, Z, _ = load_track()
    rng = np.random.default_rng(1)
    ang = np.radians(137.0)
    R = np.array([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]])
    lateral = rng.normal(0, 1.0, len(C))  # cars don't drive the centerline
    nrm = np.c_[np.gradient(C[:, 1]), -np.gradient(C[:, 0])]
    nrm /= np.linalg.norm(nrm, axis=1)[:, None]
    P = (C + nrm * lateral[:, None]) @ R.T + np.array([1234.0, -567.0])
    tmp = ROOT / "data" / "raw" / "telemetry"
    tmp.mkdir(parents=True, exist_ok=True)
    f = tmp / "selftest.csv"
    np.savetxt(f, np.c_[np.arange(len(P)), P * 10, (Z + 30) * 10, np.zeros(len(P))], delimiter=",",
               header="Distance_m,X_dm,Y_dm,Z_dm,Speed_kmh", comments="")
    rep, _ = overlay([f], "selftest")
    r = rep["files"][0]
    assert r["lateral_rms_m"] < 1.5, r
    assert abs(r["z_offset_m"] - 30) < 0.5, r
    print("selftest OK")


def main() -> None:
    if "--selftest" in sys.argv:
        selftest()
        return
    paths = [Path(p) for p in sys.argv[1:]]
    if not paths:
        sys.exit("usage: telemetry_overlay.py <fastf1-export.csv>... | --selftest")
    rep, fig = overlay(paths, "FastF1")
    fig.savefig(ROOT / "docs" / "telemetry-overlay.png")
    (ROOT / "data" / "track" / "telemetry-report.json").write_text(json.dumps(rep, indent=2))


if __name__ == "__main__":
    main()
