"""Top-level entry points: Project dict → modes."""

import time

from . import fd
from .raster import rasterise


def resolve_kind(kind):
    return "fullvector" if kind in (None, "auto") else kind


def solve_project(project, window, nx, ny, num_modes=4, kind="auto", n_guess=None, supersample=8):
    """Rasterise `project` inside `window` on an nx×ny grid and solve for modes.

    Returns a dict: grid (x, y cell centres, n_centre index map), modes (see fd.solve),
    kind, timings_ms.
    """
    kind = resolve_kind(kind)
    t0 = time.perf_counter()
    grid = rasterise(project, window, nx, ny, supersample)
    t_raster = (time.perf_counter() - t0) * 1e3
    modes, timings = fd.solve(grid, project["wavelength"], num_modes, kind, n_guess)
    timings = {"raster": t_raster, **timings}
    return {"grid": grid, "modes": modes, "kind": kind, "timings_ms": timings}
