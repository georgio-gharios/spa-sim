"""Small geometry helpers shared by the track tools (numpy + scipy only)."""
from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree


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
