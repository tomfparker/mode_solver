"""Run open-source reference mode solvers on the shared benchmark cases and save the results.

Dev-only. Runs in the separate benchmark environment (never imported by the app or solver):
    python3 -m venv .venv-bench && .venv-bench/bin/pip install tidy3d femwell
    .venv-bench/bin/python benchmarks/run_reference.py [case ...]

Solvers:
  * Tidy3D's local mode solver (finite difference, LGPL). Run on uniform grids at several cell
    sizes, without subpixel smoothing (that needs their cloud or a separately licensed plugin),
    then extrapolated linearly to zero cell size.
  * femwell (finite element, GPL-3; isotropic materials only). Second-order elements on a mesh
    that follows the shape edges, so there is no staircase error.
Indices come from data/materials via solver_py/modesolver/materials.py at the case wavelength,
so all solvers and our own code see identical material values.

Output: solver_py/tests/reference/<case>.json with solver versions, settings and date.
"""

import datetime
import json
import math
import sys
import time
from importlib.metadata import version
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / "solver_py"), str(ROOT / "solver_py" / "tests")]
from cases import CASES  # noqa: E402
from modesolver.materials import index_tensor  # noqa: E402

OUT = ROOT / "solver_py" / "tests" / "reference"
NUM_MODES = 4
TIDY3D_CELLS = (0.02, 0.01)  # µm; extrapolated to 0
# (resolution at shapes, default maximum) in µm: two levels, to estimate convergence.
FEMWELL_LEVELS = ((0.03, 0.3), (0.015, 0.15))


def tensor(use, lam):
    n = index_tensor(use["material"], lam, (), use.get("opticAxis") or "z")
    assert all(abs(c.imag) == 0 for c in n)
    dn = use.get("deltaN") or 0.0
    return tuple(c.real + dn for c in n)


def width_at(profile, coords, level):
    """Full width between the outermost crossings of `level` (same definition as our solver)."""
    above = np.nonzero(profile >= level)[0]
    if len(above) == 0:
        return 0.0
    a, b = above[0], above[-1]

    def edge(i_in, i_out):
        if i_out < 0 or i_out >= len(profile):
            return coords[i_in]
        t = (profile[i_in] - level) / (profile[i_in] - profile[i_out])
        return coords[i_in] + t * (coords[i_out] - coords[i_in])

    return float(edge(b, b + 1) - edge(a, a - 1))


# ---- Tidy3D --------------------------------------------------------------------------------

def run_tidy3d(case, dl):
    import tidy3d as td
    from tidy3d.plugins.mode import ModeSolver

    p, w = case["project"], case["window"]
    lam = p["wavelength"]

    def medium(use):
        nx, ny, nz = tensor(use, lam)
        if nx == ny == nz:
            return td.Medium(permittivity=nx**2)
        return td.AnisotropicMedium(xx=td.Medium(permittivity=nx**2), yy=td.Medium(permittivity=ny**2), zz=td.Medium(permittivity=nz**2))

    structures = []
    for f in p["features"]:
        k = f["kind"]
        if k == "rect":
            sx = td.inf if f.get("fullWidth") else f["width"]
            geo = td.Box(center=(0 if f.get("fullWidth") else f["x"], f["y"] + f["height"] / 2, 0), size=(sx, f["height"], td.inf))
        elif k == "trapezoid":
            x, y, wb, wt, h = f["x"], f["y"], f["widthBottom"], f["widthTop"], f["height"]
            geo = td.PolySlab(vertices=[(x - wb / 2, y), (x + wb / 2, y), (x + wt / 2, y + h), (x - wt / 2, y + h)], axis=2, slab_bounds=(-10, 10))
        elif k == "polygon":
            geo = td.PolySlab(vertices=[(f["x"] + a, f["y"] + b) for a, b in f["points"]], axis=2, slab_bounds=(-10, 10))
        elif k == "circle":
            geo = td.Cylinder(center=(f["x"], f["y"], 0), radius=f["radius"], length=td.inf, axis=2)
        else:
            raise ValueError(k)
        structures.append(td.Structure(geometry=geo, medium=medium(f)))

    cx, cy = (w["x0"] + w["x1"]) / 2, (w["y0"] + w["y1"]) / 2
    sx, sy = w["x1"] - w["x0"], w["y1"] - w["y0"]
    sim = td.Simulation(size=(sx, sy, 1), center=(cx, cy, 0), grid_spec=td.GridSpec.uniform(dl=dl), structures=structures,
                        medium=medium(p["background"]), run_time=1e-12, boundary_spec=td.BoundarySpec.all_sides(td.PECBoundary()))
    ms = ModeSolver(simulation=sim, plane=td.Box(center=(cx, cy, 0), size=(sx, sy, 0)),
                    mode_spec=td.ModeSpec(num_modes=NUM_MODES), freqs=[td.C_0 / lam])
    t0 = time.time()
    data = ms.solve()
    elapsed = time.time() - t0
    modes = []
    for m in range(NUM_MODES):
        ex, ey, ez = (np.squeeze(getattr(data, c).isel(mode_index=m, f=0).values) for c in ("Ex", "Ey", "Ez"))
        # Components live on slightly different Yee coordinates; use each one's own for sums and
        # Ex/Ey's shared shape for the intensity cuts (differences are sub-cell).
        xs = np.asarray(data.Ex.x.values, dtype=float)
        ys = np.asarray(data.Ex.y.values, dtype=float)
        te = float((abs(ex) ** 2).sum() / ((abs(ex) ** 2).sum() + (abs(ey) ** 2).sum()))
        ny_, nx_ = min(ex.shape[1], ey.shape[1], ez.shape[1]), min(ex.shape[0], ey.shape[0], ez.shape[0])
        inten = abs(ex[:nx_, :ny_]) ** 2 + abs(ey[:nx_, :ny_]) ** 2 + abs(ez[:nx_, :ny_]) ** 2  # indexed [x, y]
        ip, jp = np.unravel_index(inten.argmax(), inten.shape)
        level = inten.max() * math.exp(-2)
        modes.append({
            "neff": float(np.real(data.n_eff.isel(mode_index=m, f=0).values)),
            "teFraction": te,
            "mfd": {"x": width_at(inten[:, jp], xs[:nx_], level), "y": width_at(inten[ip, :], ys[:ny_], level)},
        })
    return {"dl": dl, "seconds": round(elapsed, 1), "modes": modes}


def tidy3d_reference(case):
    runs = [run_tidy3d(case, dl) for dl in TIDY3D_CELLS]
    (h1, r1), (h2, r2) = [(r["dl"], r) for r in runs]
    extrap = []
    for m in range(NUM_MODES):
        a, b = r1["modes"][m], r2["modes"][m]
        n0 = b["neff"] + (b["neff"] - a["neff"]) * h2 / (h1 - h2)  # linear in cell size → 0
        extrap.append({
            "neff": n0,
            "neffUncertainty": abs(n0 - b["neff"]),
            "teFraction": b["teFraction"],
            "mfd": b["mfd"],
        })
    return {"solver": "tidy3d", "version": version("tidy3d"), "method": "FDFD, uniform grid, no subpixel smoothing; n_eff extrapolated linearly to zero cell size",
            "runs": runs, "modes": extrap}


# ---- femwell -------------------------------------------------------------------------------

def femwell_reference(case):
    runs = [run_femwell(case, lv) for lv in FEMWELL_LEVELS]
    if runs[0] is None:
        return None
    coarse, fine = runs
    modes = [{**m, "neffUncertainty": abs(m["neff"] - c["neff"])} for m, c in zip(fine["modes"], coarse["modes"])]
    return {"solver": "femwell", "version": version("femwell"),
            "method": "FEM, 2nd-order elements on a mesh that follows shape edges; uncertainty = change between the two mesh levels",
            "runs": runs, "modes": modes}


def run_femwell(case, level):
    from collections import OrderedDict

    import shapely
    from femwell.maxwell.waveguide import compute_modes
    from femwell.mesh import mesh_from_OrderedDict
    from skfem import Basis, ElementTriP0
    from skfem.io.meshio import from_meshio

    p, w = case["project"], case["window"]
    lam = p["wavelength"]
    box = shapely.box(w["x0"], w["y0"], w["x1"], w["y1"])
    polys, index, fine = OrderedDict(), {}, set()
    # femwell gives earlier entries priority; our later shapes are on top, so reverse.
    for i, f in reversed(list(enumerate(p["features"]))):
        n = tensor(f, lam)
        if not (n[0] == n[1] == n[2]):
            return None  # anisotropic: not supported by femwell's compute_modes
        k = f["kind"]
        if k == "rect":
            x0, x1 = (w["x0"], w["x1"]) if f.get("fullWidth") else (f["x"] - f["width"] / 2, f["x"] + f["width"] / 2)
            g = shapely.box(x0, f["y"], x1, f["y"] + f["height"])
        elif k == "trapezoid":
            x, y, wb, wt, h = f["x"], f["y"], f["widthBottom"], f["widthTop"], f["height"]
            g = shapely.Polygon([(x - wb / 2, y), (x + wb / 2, y), (x + wt / 2, y + h), (x - wt / 2, y + h)])
        elif k == "polygon":
            g = shapely.Polygon([(f["x"] + a, f["y"] + b) for a, b in f["points"]])
        elif k == "circle":
            g = shapely.Point(f["x"], f["y"]).buffer(f["radius"], quad_segs=64)
        else:
            raise ValueError(k)
        name = f"s{i}"
        # Fine mesh on finite shapes only; it grades outwards into full-width layers. (Fine
        # mesh along whole layers exhausts memory on a 7 GB machine.) A structure with only
        # layers refines them all.
        if not f.get("fullWidth"):
            fine.add(name)
        polys[name] = g.intersection(box)
        index[name] = n[0]
    nbg = tensor(p["background"], lam)
    if not (nbg[0] == nbg[1] == nbg[2]):
        return None
    polys["background"] = box
    index["background"] = nbg[0]
    if not fine:
        fine = {name for name in polys if name != "background"}
    res = {name: {"resolution": level[0], "distance": 1.0} for name in polys if name in fine}
    t0 = time.time()
    mesh = from_meshio(mesh_from_OrderedDict(polys, res, default_resolution_max=level[1]))
    basis0 = Basis(mesh, ElementTriP0())
    eps = basis0.zeros()
    for name, n in index.items():
        eps[basis0.get_dofs(elements=name)] = n**2
    modes = compute_modes(basis0, eps, wavelength=lam, num_modes=NUM_MODES, order=2)
    elapsed = time.time() - t0
    out = [{"neff": float(np.real(m.n_eff)), "teFraction": float(m.te_fraction)} for m in modes]
    out.sort(key=lambda d: -d["neff"])
    return {"resolution": level[0], "defaultResolution": level[1], "elements": int(mesh.t.shape[1]), "seconds": round(elapsed, 1), "modes": out}


def main():
    names = sys.argv[1:] or list(CASES)
    for name in names:
        case = CASES[name]
        print(f"== {name}", flush=True)
        lam = case["project"]["wavelength"]
        uses = [case["project"]["background"], *case["project"]["features"]]
        rec = {
            "case": name,
            "generated": datetime.date.today().isoformat(),
            "generatedBy": "benchmarks/run_reference.py",
            "wavelength": lam,
            "window": case["window"],
            "indices": {u.get("name", "background"): tensor(u, lam) for u in uses},
            "references": {},
        }
        t3 = tidy3d_reference(case)
        rec["references"]["tidy3d"] = t3
        print("  tidy3d ", [round(m["neff"], 5) for m in t3["modes"]], "±", [f'{m["neffUncertainty"]:.1e}' for m in t3["modes"]], flush=True)
        fw = femwell_reference(case)
        if fw:
            rec["references"]["femwell"] = fw
            print("  femwell", [round(m["neff"], 5) for m in fw["modes"]], "±", [f'{m["neffUncertainty"]:.1e}' for m in fw["modes"]],
                  f'({fw["runs"][-1]["elements"]} elements, {fw["runs"][-1]["seconds"]} s)', flush=True)
        else:
            print("  femwell skipped (anisotropic material)")
        (OUT / f"{name}.json").write_text(json.dumps(rec, indent=1) + "\n")


if __name__ == "__main__":
    main()
