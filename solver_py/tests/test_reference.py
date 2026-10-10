"""Our solver against saved results from open-source reference solvers.

References are produced by benchmarks/run_reference.py (femwell: finite elements; Tidy3D:
finite differences) and stored in tests/reference/<case>.json with versions and settings.
femwell is the primary reference where available (isotropic cases): its mesh follows the
shape edges and it reports sub-1e-4 convergence. Tidy3D runs locally without subpixel
smoothing, which biases high-contrast cases, so its own uncertainty estimate is honoured.

Targets (CLAUDE.md): n_eff within ~1e-3, mode size within ~10%, at the default ("standard")
mesh preset the app uses.
"""

import json
from pathlib import Path

import pytest

from cases import CASES
from modesolver.api import solve_project
from modesolver.ui import MESH_SCALE

REF_DIR = Path(__file__).parent / "reference"
NEFF_TOL = 1e-3
MFD_TOL = 0.10
N_COMPARE = 2  # the fundamental TE-like and TM-like modes


def load(case):
    f = REF_DIR / f"{case}.json"
    if not f.exists():
        pytest.skip(f"no reference for {case}: run benchmarks/run_reference.py {case}")
    return json.loads(f.read_text())


def primary(ref):
    refs = ref["references"]
    name = "femwell" if "femwell" in refs else "tidy3d"
    return name, refs[name]["modes"]


@pytest.fixture(scope="module")
def ours():
    cache = {}

    def run(case, quality="standard"):
        key = (case, quality)
        if key not in cache:
            c = CASES[case]
            cache[key] = solve_project(c["project"], c["window"], {"scale": MESH_SCALE[quality]}, num_modes=4)
        return cache[key]

    return run


@pytest.mark.parametrize("case", sorted(CASES))
def test_neff_matches_reference(case, ours):
    ref = load(case)
    name, modes = primary(ref)
    got = ours(case)["modes"]
    for i in range(N_COMPARE):
        want = modes[i]
        tol = max(NEFF_TOL, 3 * want.get("neffUncertainty", 0.0))
        err = got[i]["neff"].real - want["neff"]
        assert abs(err) < tol, f"{case} mode {i}: ours {got[i]['neff'].real:.5f} vs {name} {want['neff']:.5f} (Δ {err:+.1e}, tol {tol:.1e})"
        # Same polarisation character.
        assert (got[i]["teFraction"] > 0.5) == (want["teFraction"] > 0.5)


@pytest.mark.parametrize("case", sorted(CASES))
def test_mode_size_matches_tidy3d(case, ours):
    ref = load(case)
    t3 = ref["references"].get("tidy3d")
    if not t3:
        pytest.skip("no Tidy3D fields for this case")
    got = ours(case)["modes"][0]
    want = t3["modes"][0]["mfd"]
    for axis in ("x", "y"):
        rel = got["mfd"][axis] / want[axis] - 1
        assert abs(rel) < MFD_TOL, f"{case} MFD {axis}: ours {got['mfd'][axis]:.3f} vs Tidy3D {want[axis]:.3f} µm ({rel:+.1%})"


@pytest.mark.parametrize("case", sorted(CASES))
def test_fast_mesh_stays_within_three_times_the_target(case, ours):
    """The 'fast' preset trades accuracy for speed, but must stay a usable estimate."""
    ref = load(case)
    _, modes = primary(ref)
    got = ours(case, "fast")["modes"]
    for i in range(N_COMPARE):
        tol = max(3 * NEFF_TOL, 3 * modes[i].get("neffUncertainty", 0.0))
        assert abs(got[i]["neff"].real - modes[i]["neff"]) < tol
