"""Rasterise a Project (background + ordered shapes) onto a Yee grid with subpixel averaging.

Mirrors the geometry rules of src/geometry/geometry.ts: later shapes replace earlier ones,
full-width rectangles span all x, graded features add Δn to whatever is there.

Grid layout (nx × ny cells of size dx × dy, window lower-left corner (x0, y0)); arrays are
indexed [j, i] (y, x):
    Ez[j, i] at (x0 + i·dx,       y0 + j·dy)        cell corner
    Ex[j, i] at (x0 + (i+½)·dx,   y0 + j·dy)
    Ey[j, i] at (x0 + i·dx,       y0 + (j+½)·dy)
    Hz[j, i] at (x0 + (i+½)·dx,   y0 + (j+½)·dy)    cell centre

Subpixel averaging: each permittivity sample is the average over the cell-sized box centred
on its field location, taken on an S×S sub-grid. For the component normal to an interface
the harmonic mean applies and for tangential components the arithmetic mean; with the
interface normal n̂ estimated from the gradient of ε inside the box, the diagonal part of the
standard smoothing tensor gives  1/ε_x = n̂x²·⟨1/ε⟩ + (1 − n̂x²)/⟨ε⟩  (likewise y), and
ε_z = ⟨ε⟩ since z is always tangential.
"""

import math

import numpy as np

from .materials import index_tensor


def _in_polygon(pts, X, Y):
    """Even-odd point-in-polygon, vectorised over arrays X, Y."""
    inside = np.zeros(X.shape, dtype=bool)
    n = len(pts)
    for k in range(n):
        xi, yi = pts[k]
        xj, yj = pts[k - 1]
        if yi == yj:
            continue
        cond = (yi > Y) != (yj > Y)
        xint = (xj - xi) * (Y - yi) / (yj - yi) + xi
        inside ^= cond & (X < xint)
    return inside


def shape_mask(f, X, Y):
    """Boolean mask of the points inside a (non-graded) shape."""
    kind = f["kind"]
    if kind == "rect":
        in_y = (Y >= f["y"]) & (Y < f["y"] + f["height"])
        if f.get("fullWidth"):
            return in_y
        return in_y & (np.abs(X - f["x"]) <= f["width"] / 2)
    if kind == "circle":
        return (X - f["x"]) ** 2 + (Y - f["y"]) ** 2 <= f["radius"] ** 2
    if kind == "trapezoid":
        x, y, wb, wt, h = f["x"], f["y"], f["widthBottom"], f["widthTop"], f["height"]
        pts = [(x - wb / 2, y), (x + wb / 2, y), (x + wt / 2, y + h), (x - wt / 2, y + h)]
        return _in_polygon(pts, X, Y)
    if kind == "polygon":
        return _in_polygon([(f["x"] + px, f["y"] + py) for px, py in f["points"]], X, Y)
    raise ValueError(f"unknown shape kind {kind!r}")


_erf = np.vectorize(math.erf, otypes=[float])


def graded_delta_n(f, X, Y):
    """Δn of a graded feature at the points (X, Y)."""
    u = X - f["x"]
    v = Y - f["y"]
    if f["profileX"] == "gaussian":
        fx = np.exp(-((u / f["wx"]) ** 2))
    else:
        half = f["stripWidth"] / 2
        norm = math.erf(half / f["wx"]) or 1e-9
        fx = 0.5 * (_erf((half + u) / f["wx"]) + _erf((half - u) / f["wx"])) / norm
    g = np.exp(-((v / f["wy"]) ** 2))
    if f["profileY"] == "half-gaussian":
        g = np.where(v > 0, 0.0, g)
    return f["deltaN"] * fx * g


def index_fields(project, X, Y):
    """Principal indices (n_x, n_y, n_z) at the points (X, Y), as complex arrays."""
    lam = project["wavelength"]
    custom = project.get("customMaterials", [])
    bg = project["background"]
    n = [np.full(X.shape, c, dtype=complex) for c in index_tensor(bg["material"], lam, custom, bg.get("opticAxis") or "z")]
    for f in project["features"]:
        if f["kind"] == "graded":
            continue
        tensor = index_tensor(f["material"], lam, custom, f.get("opticAxis") or "z")
        mask = shape_mask(f, X, Y)
        dn = f.get("deltaN") or 0.0
        for a in range(3):
            n[a][mask] = tensor[a] + dn
    for f in project["features"]:
        if f["kind"] == "graded":
            d = graded_delta_n(f, X, Y)
            for a in range(3):
                n[a] = n[a] + d
    return n


def _box_mean(a, S, ox, oy, nx, ny, w=None, h=None):
    """Mean of `a` over boxes of w×h sub-cells whose lower-left sub-cell is (ox + i·S, oy + j·S)."""
    w = S if w is None else w
    h = S if h is None else h
    c = np.zeros((a.shape[0] + 1, a.shape[1] + 1), dtype=a.dtype)
    c[1:, 1:] = a.cumsum(0).cumsum(1)
    j0 = oy + S * np.arange(ny)[:, None]
    i0 = ox + S * np.arange(nx)[None, :]
    return (c[j0 + h, i0 + w] - c[j0, i0 + w] - c[j0 + h, i0] + c[j0, i0]) / (w * h)


def rasterise(project, window, nx, ny, supersample=8):
    """Permittivity on the Yee grid.

    window: dict with x0, x1, y0, y1. Returns a dict with exx (at Ex), eyy (at Ey), ezz (at Ez),
    n_centre (real index at cell centres, for display), x and y (cell-centre coordinates),
    dx, dy, and n_max (largest real index in the window).
    """
    S = int(supersample)
    if S < 2 or S % 2:
        raise ValueError("supersample must be an even integer ≥ 2")
    x0, x1, y0, y1 = window["x0"], window["x1"], window["y0"], window["y1"]
    dx = (x1 - x0) / nx
    dy = (y1 - y0) / ny
    H = S // 2
    # Sub-grid padded by half a cell on every side, so boxes centred on edge locations fit.
    xs = x0 - dx / 2 + (np.arange(nx * S + S) + 0.5) * dx / S
    ys = y0 - dy / 2 + (np.arange(ny * S + S) + 0.5) * dy / S
    X, Y = np.meshgrid(xs, ys)
    n_x, n_y, n_z = index_fields(project, X, Y)
    e = {"x": n_x**2, "y": n_y**2, "z": n_z**2}

    def smooth(comp, ox, oy, normal_axis):
        """Effective ε for the field component `comp` located at box offset (ox, oy)."""
        eps = e[comp]
        mean = _box_mean(eps, S, ox, oy, nx, ny)
        if normal_axis is None:
            return mean  # z: always tangential
        inv = _box_mean(1 / eps, S, ox, oy, nx, ny)
        # Interface normal from the gradient of ε across the box (difference of half-box means).
        ref = e["z"].real
        gx = _box_mean(ref, S, ox + H, oy, nx, ny, w=H) - _box_mean(ref, S, ox, oy, nx, ny, w=H)
        gy = _box_mean(ref, S, ox, oy + H, nx, ny, h=H) - _box_mean(ref, S, ox, oy, nx, ny, h=H)
        g2 = gx**2 + gy**2
        with np.errstate(invalid="ignore", divide="ignore"):
            p = np.where(g2 > 0, (gx if normal_axis == "x" else gy) ** 2 / g2, 0.0)
        return 1 / (p * inv + (1 - p) / mean)

    exx = smooth("x", H, 0, "x")
    eyy = smooth("y", 0, H, "y")
    ezz = smooth("z", 0, 0, None)
    n_centre = np.sqrt(_box_mean(e["z"], S, H, H, nx, ny)).real
    n_max = float(max(np.sqrt(a).real.max() for a in e.values()))
    return {
        "exx": exx, "eyy": eyy, "ezz": ezz, "n_centre": n_centre, "n_max": n_max,
        "x": x0 + (np.arange(nx) + 0.5) * dx, "y": y0 + (np.arange(ny) + 0.5) * dy, "dx": dx, "dy": dy,
    }
