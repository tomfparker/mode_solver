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


def _integral(a):
    c = np.zeros((a.shape[0] + 1, a.shape[1] + 1), dtype=a.dtype)
    c[1:, 1:] = a.cumsum(0).cumsum(1)
    return c


class _Boxes:
    """Area-weighted means over boxes of sub-cells (cells may differ in size)."""

    def __init__(self, wx, wy, S, nx, ny):
        self.S, self.nx, self.ny = S, nx, ny
        self.w = np.outer(wy, wx)  # sub-cell areas
        self.cw = _integral(self.w)

    def _sum(self, c, ox, oy, w, h):
        j0 = oy + self.S * np.arange(self.ny)[:, None]
        i0 = ox + self.S * np.arange(self.nx)[None, :]
        return c[j0 + h, i0 + w] - c[j0, i0 + w] - c[j0 + h, i0] + c[j0, i0]

    def mean(self, a, ox, oy, w=None, h=None):
        """Mean of `a` over boxes of w×h sub-cells with lower-left sub-cell (ox + i·S, oy + j·S)."""
        w = self.S if w is None else w
        h = self.S if h is None else h
        return self._sum(_integral(a * self.w), ox, oy, w, h) / self._sum(self.cw, ox, oy, w, h)


def _sub_axis(lines, S):
    """Sub-sample coordinates and widths: S per cell, padded by one copy of each edge cell."""
    d = np.diff(lines)
    d = np.concatenate([[d[0]], d, [d[-1]]])
    starts = np.concatenate([[lines[0] - d[0]], lines])  # left edge of each (padded) cell
    k = (np.arange(S) + 0.5) / S
    coords = (starts[:, None] + d[:, None] * k[None, :]).ravel()
    widths = np.repeat(d / S, S)
    return coords, widths


def rasterise(project, xl, yl, supersample=8):
    """Permittivity on the Yee grid defined by mesh lines xl (nx+1 values) and yl (ny+1).

    Returns a dict with exx (at Ex), eyy (at Ey), ezz (at Ez), n_centre (real index at cell
    centres), the lines, cell centres x/y, cell sizes dx/dy (arrays), and n_max.
    """
    S = int(supersample)
    if S < 2 or S % 2:
        raise ValueError("supersample must be an even integer ≥ 2")
    xl = np.asarray(xl, dtype=float)
    yl = np.asarray(yl, dtype=float)
    nx, ny = len(xl) - 1, len(yl) - 1
    H = S // 2
    # The padded sub-grid starts one cell before the window; box offsets below are relative
    # to half a cell before the window, hence the extra H.
    xs, wx = _sub_axis(xl, S)
    ys, wy = _sub_axis(yl, S)
    X, Y = np.meshgrid(xs, ys)
    n_x, n_y, n_z = index_fields(project, X, Y)
    e = {"x": n_x**2, "y": n_y**2, "z": n_z**2}
    boxes = _Boxes(wx, wy, S, nx, ny)
    ref = e["z"].real

    def smooth(comp, ox, oy, normal_axis):
        """Effective ε for the field component `comp` whose box starts at sub-offset (ox, oy)."""
        eps = e[comp]
        mean = boxes.mean(eps, ox, oy)
        if normal_axis is None:
            return mean  # z: always tangential
        inv = boxes.mean(1 / eps, ox, oy)
        # Interface normal from the gradient of ε across the box (difference of half-box means).
        gx = boxes.mean(ref, ox + H, oy, w=H) - boxes.mean(ref, ox, oy, w=H)
        gy = boxes.mean(ref, ox, oy + H, h=H) - boxes.mean(ref, ox, oy, h=H)
        g2 = gx**2 + gy**2
        with np.errstate(invalid="ignore", divide="ignore"):
            p = np.where(g2 > 0, (gx if normal_axis == "x" else gy) ** 2 / g2, 0.0)
        return 1 / (p * inv + (1 - p) / mean)

    # Box lower-left offsets in padded sub-cells: a node-centred box starts half a cell before
    # the node (H into the previous cell), a cell-centred box starts at the cell (S).
    node, cell = H, S
    exx = smooth("x", cell, node, "x")  # Ex at (cell centre, node)
    eyy = smooth("y", node, cell, "y")  # Ey at (node, cell centre)
    ezz = smooth("z", node, node, None)  # Ez at (node, node)
    n_centre = np.sqrt(boxes.mean(e["z"], cell, cell)).real
    n_max = float(max(np.sqrt(a).real.max() for a in e.values()))
    return {
        "exx": exx, "eyy": eyy, "ezz": ezz, "n_centre": n_centre, "n_max": n_max,
        "xl": xl, "yl": yl, "x": 0.5 * (xl[:-1] + xl[1:]), "y": 0.5 * (yl[:-1] + yl[1:]),
        "dx": np.diff(xl), "dy": np.diff(yl),
    }
