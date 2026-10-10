"""Mesh lines for the solver: uniform, or graded and snapped to shape edges.

The graded mesh is the main speed/accuracy lever: grid lines sit exactly on shape edges (so
straight vertical/horizontal interfaces need no staircase approximation), cells are small in
and around the shapes and grow smoothly towards the window edges, where the field is weak
and slowly varying. Fine-grid accuracy for a fraction of the unknowns.
"""

import numpy as np

from .materials import index_tensor

#: Mesh resolution defaults, chosen from the benchmark sweep in docs/benchmarks-m2.md as the
#: fastest settings that keep n_eff within ~1e-3 of the references.
#:
#: The governing length for a shape is the shortest field decay length it can support,
#: L = λ / (2π·NA) with NA² = n_shape² − n_low² (n_low: lowest index in the structure):
#: ~78 nm for silicon in oxide, ~180 nm for nitride, ~2 µm for a fibre core.
#: Cells per L inside the shape and in a margin around it:
CELLS_PER_DECAY_LENGTH = 5
#: Width of that uniform fine margin beyond the shape, in units of L.
MARGIN_DECAY_LENGTHS = 1.5
#: Minimum number of cells across a shape's smallest dimension.
CELLS_PER_FEATURE = 6
#: Cell-size growth per cell beyond the margin.
GROWTH = 1.3
#: Cells per background wavelength far from every shape.
COARSE_PER_WAVELENGTH = 5


def uniform_lines(window, nx, ny):
    return np.linspace(window["x0"], window["x1"], nx + 1), np.linspace(window["y0"], window["y1"], ny + 1)


def _graded_axis(lo, hi, breakpoints, regions, d_max, growth):
    """Node positions on [lo, hi] hitting every breakpoint, with cell size ≈ h(x).

    regions: (a, b, d) intervals wanting cell size d. Away from them the size grows linearly
    with distance, h(x) = min(d_max, min over regions of d + (growth − 1)·distance), which
    makes successive cells grow by a factor ≈ growth.
    """
    regions = [(max(a, lo), min(b, hi), d) for a, b, d in regions if b >= lo and a <= hi]
    d_min = min([d for _, _, d in regions], default=d_max)
    pts = sorted({lo, hi, *[b for b in breakpoints if lo < b < hi]})
    # Drop breakpoints closer than a quarter cell to the previous one (avoids sliver cells).
    kept = [pts[0]]
    for b in pts[1:-1]:
        if b - kept[-1] >= d_min / 4 and pts[-1] - b >= d_min / 4:
            kept.append(b)
    kept.append(pts[-1])

    def h(x):
        if not regions:
            return np.full_like(x, d_max)
        size = [d + (growth - 1) * np.maximum(np.maximum(a - x, x - b), 0.0) for a, b, d in regions]
        return np.minimum(d_max, np.min(size, axis=0))

    nodes = [kept[0]]
    for a, b in zip(kept[:-1], kept[1:]):
        s = np.linspace(a, b, max(int((b - a) / (d_min / 8)) + 2, 16))
        mid = 0.5 * (s[:-1] + s[1:])
        density = np.concatenate([[0.0], np.cumsum(np.diff(s) / h(mid))])  # ∫ dx / h
        n = max(1, int(np.ceil(density[-1] - 1e-9)))
        inner = np.interp(np.arange(1, n) * density[-1] / n, density, s)
        nodes.extend(inner.tolist())
        nodes.append(b)
    return np.array(nodes)


def _n_max(project, use):
    lam = project["wavelength"]
    n = index_tensor(use["material"], lam, project.get("customMaterials", []), use.get("opticAxis") or "z")
    return max(c.real for c in n) + (use.get("deltaN") or 0.0)


def graded_lines(project, window, cells_per_decay_length=None, margin=None, growth=None, d_max=None, scale=1.0):
    """Mesh lines (xl, yl) snapped to shape edges, fine where the field varies fastest.

    Each shape gets cells of L/cells_per_decay_length (L = λ/(2π·NA), see the constants above;
    at most 1/CELLS_PER_FEATURE of its smallest dimension), kept uniform for `margin`·L beyond
    it, then growing by `growth` per cell up to d_max. `scale` multiplies all target sizes
    (the UI's coarser/finer control).
    """
    lam = project["wavelength"]
    npl = cells_per_decay_length or CELLS_PER_DECAY_LENGTH
    margin = MARGIN_DECAY_LENGTHS if margin is None else margin
    growth = growth or GROWTH
    x0, x1, y0, y1 = window["x0"], window["x1"], window["y0"], window["y1"]
    n_bg = _n_max(project, project["background"])
    indices = [n_bg] + [_n_max(project, f) for f in project["features"] if f["kind"] != "graded"]
    n_low = min(indices)
    d_max = d_max or lam / (n_bg * COARSE_PER_WAVELENGTH)
    floor = min(x1 - x0, y1 - y0) / 2000  # never an absurd number of cells
    bx, by, rx, ry = [], [], [], []

    def region(n, lo, hi, *dims):
        """(a, b, d): interval padded by the margin, and its cell size."""
        na2 = n * n - n_low * n_low
        decay = lam / (2 * np.pi * np.sqrt(na2)) if na2 > 1e-9 else np.inf
        d = min([decay / npl, d_max / scale, *[v / CELLS_PER_FEATURE for v in dims if v > 0]])
        d = max(d * scale, floor)
        pad = min(margin * decay, 4 * d_max) if np.isfinite(decay) else 0.0
        return lo - pad, hi + pad, d

    for f in project["features"]:
        k = f["kind"]
        if k == "graded":
            hx = (f["stripWidth"] / 2 if f["profileX"] == "erf-strip" else 0.0) + f["wx"]
            up = 0.0 if f["profileY"] == "half-gaussian" else f["wy"]
            # Index of the host just below the feature origin, plus the peak Δn.
            n = np.sqrt(n_low * n_low + 2 * n_bg * abs(f["deltaN"]) + f["deltaN"] ** 2)
            rx.append(region(n, f["x"] - hx, f["x"] + hx, 2 * f["wx"]))
            ry.append(region(n, f["y"] - f["wy"], f["y"] + up, 2 * f["wy"]))
            continue
        n = _n_max(project, f)
        if k == "rect":
            ya, yb = f["y"], f["y"] + f["height"]
            by += [ya, yb]
            if f.get("fullWidth"):
                # A layer: fine cells around its two surfaces; thin layers are covered throughout.
                ry += [region(n, ya, ya, f["height"]), region(n, yb, yb, f["height"])]
                continue
            xa, xb = f["x"] - f["width"] / 2, f["x"] + f["width"] / 2
            bx += [xa, xb]
            dims = (f["width"], f["height"])
        elif k == "trapezoid":
            ya, yb = f["y"], f["y"] + f["height"]
            by += [ya, yb]
            w = max(f["widthBottom"], f["widthTop"])
            xa, xb = f["x"] - w / 2, f["x"] + w / 2
            bx += [f["x"] - f["widthBottom"] / 2, f["x"] + f["widthBottom"] / 2, f["x"] - f["widthTop"] / 2, f["x"] + f["widthTop"] / 2]
            dims = (max(min(f["widthBottom"], f["widthTop"]), f["height"] / 4), f["height"])
        elif k == "circle":
            xa, xb, ya, yb = f["x"] - f["radius"], f["x"] + f["radius"], f["y"] - f["radius"], f["y"] + f["radius"]
            dims = (2 * f["radius"],)
        else:  # polygon
            xs = [f["x"] + p[0] for p in f["points"]]
            ys = [f["y"] + p[1] for p in f["points"]]
            xa, xb, ya, yb = min(xs), max(xs), min(ys), max(ys)
            bx += xs
            by += ys
            dims = (xb - xa, yb - ya)
        rx.append(region(n, xa, xb, *dims))
        ry.append(region(n, ya, yb, *dims))
    xl = _graded_axis(x0, x1, bx, rx, d_max, growth)
    yl = _graded_axis(y0, y1, by, ry, d_max, growth)
    return xl, yl
