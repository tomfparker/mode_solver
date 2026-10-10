"""Top-level entry points: Project dict → modes."""

import time

import numpy as np

from . import fd
from .mesh import graded_lines, uniform_lines
from .raster import rasterise


def resolve_kind(kind):
    return "fullvector" if kind in (None, "auto") else kind


def mesh_lines(project, window, mesh=None):
    """Mesh lines from a mesh spec.

    None or {}                       → graded mesh with default resolution
    {"scale": 1.5}                   → graded mesh, all cell sizes × scale (coarser/faster)
    {"cells_per_decay_length": 4, …} → graded mesh with explicit settings (also margin, growth, d_max)
    {"nx": 100, "ny": 80}            → uniform mesh
    {"xl": […], "yl": […]}           → explicit lines
    """
    mesh = mesh or {}
    if "xl" in mesh:
        return mesh["xl"], mesh["yl"]
    if "nx" in mesh:
        return uniform_lines(window, mesh["nx"], mesh["ny"])
    return graded_lines(project, window, mesh.get("cells_per_decay_length"), mesh.get("margin"), mesh.get("growth"),
                        mesh.get("d_max"), mesh.get("scale", 1.0))


#: Ratio of cell sizes between the two meshes used for extrapolation.
EXTRAPOLATION_RATIO = 1.4


def _is_graded(mesh):
    return not mesh or ("nx" not in mesh and "xl" not in mesh)


def _match(mode, candidates):
    """Index of the candidate whose transverse E field best overlaps `mode` (display grid), and the overlap."""
    a = np.concatenate([mode["fields"]["Ex"].ravel(), mode["fields"]["Ey"].ravel()])
    best, best_o = None, 0.0
    for k, c in enumerate(candidates):
        b = np.concatenate([c["fields"]["Ex"].ravel(), c["fields"]["Ey"].ravel()])
        o = abs(np.vdot(a, b)) / np.sqrt(np.vdot(a, a).real * np.vdot(b, b).real)
        if o > best_o:
            best, best_o = k, o
    return best, best_o


def solve_project(project, window, mesh=None, num_modes=4, kind="auto", n_guess=None, supersample=8,
                  display_cells=128, extrapolate=None):
    """Rasterise `project` inside `window` and solve for modes.

    With a graded mesh and `extrapolate` (the default), the problem is also solved on a mesh
    with cells EXTRAPOLATION_RATIO times larger, and each n_eff is Richardson-extrapolated
    assuming second-order convergence (measured: see docs/benchmarks-m2.md). This costs about
    half as much again as the single solve and typically cuts the n_eff error several-fold.
    Fields and mode sizes come from the finer mesh.

    Returns a dict: grid (solver mesh and permittivity), display (uniform grid x, y and index
    map n), modes (see fd.solve; `neffRaw` is the un-extrapolated value), kind, timings_ms.
    """
    kind = resolve_kind(kind)
    extrapolate = _is_graded(mesh) if extrapolate is None else (extrapolate and _is_graded(mesh))

    def run(spec):
        t0 = time.perf_counter()
        xl, yl = mesh_lines(project, window, spec)
        grid = rasterise(project, xl, yl, supersample)
        t_raster = (time.perf_counter() - t0) * 1e3
        modes, display, timings = fd.solve(grid, project["wavelength"], num_modes, kind, n_guess, display_cells)
        return grid, modes, display, {"raster": t_raster, **timings}

    grid, modes, display, timings = run(mesh)
    for m in modes:
        m["neffRaw"] = m["neff"]
    if extrapolate:
        coarse_spec = {**(mesh or {}), "scale": (mesh or {}).get("scale", 1.0) * EXTRAPOLATION_RATIO}
        cgrid, cmodes, _, ctimings = run(coarse_spec)
        # Actual cell-size ratio (feature-count rounding makes it differ slightly from the target).
        rho2 = (cgrid["dx"].min() * cgrid["dy"].min()) / (grid["dx"].min() * grid["dy"].min())
        if rho2 > 1.05:
            for m in modes:
                k, overlap = _match(m, cmodes)
                if k is not None and overlap > 0.9:
                    m["neff"] = m["neffRaw"] + (m["neffRaw"] - cmodes[k]["neff"]) / (rho2 - 1)
        timings = {**timings, **{f"coarse_{k}": v for k, v in ctimings.items()}}
        order = sorted(range(len(modes)), key=lambda i: -modes[i]["neff"].real)
        modes = [modes[i] for i in order]
    return {"grid": grid, "display": display, "modes": modes, "kind": kind, "timings_ms": timings}
