"""Analytic benchmarks: slab waveguide TE/TM and step-index fibre LP01."""

import numpy as np
import pytest
from scipy.optimize import brentq
from scipy.special import j0, j1, k0 as bk0, k1 as bk1

from modesolver.api import solve_project

from helpers import circle, custom, project, rect

LAM = 1.55
K0 = 2 * np.pi / LAM


def slab_neff(n1, n2, d, pol, m=0):
    """Symmetric slab: κd = mπ + 2·atan(ξ·γ/κ), ξ = 1 (TE) or n1²/n2² (TM)."""
    xi = 1.0 if pol == "TE" else (n1 / n2) ** 2

    def f(neff):
        kap = K0 * np.sqrt(n1**2 - neff**2)
        gam = K0 * np.sqrt(neff**2 - n2**2)
        return kap * d - m * np.pi - 2 * np.arctan(xi * gam / kap)

    return brentq(f, n2 + 1e-9, n1 - 1e-9)


def slab_project(n1, n2, d):
    return project(LAM, "custom:clad", [rect("custom:core", 0, -d / 2, 1, d, full_width=True)],
                   [custom("core", n1), custom("clad", n2)])


@pytest.mark.parametrize("pol,kind", [("TE", "semivector-te"), ("TM", "semivector-tm"), ("TE", "fullvector"), ("TM", "fullvector")])
def test_slab_matches_analytic(pol, kind):
    n1, n2, d = 2.0, 1.45, 0.5
    # x is made effectively infinite (3 very wide cells) so the 2-D solver sees a 1-D slab.
    window = {"x0": -1.5e6, "x1": 1.5e6, "y0": -2.0, "y1": 2.0}
    res = solve_project(slab_project(n1, n2, d), window, nx=3, ny=160, num_modes=6, kind=kind)
    want = slab_neff(n1, n2, d, pol)
    te_like = pol == "TE"
    got = [m["neff"].real for m in res["modes"] if (m["teFraction"] > 0.5) == te_like]
    assert got, "no mode of the requested polarisation found"
    assert min(abs(g - want) for g in got) < 1e-3  # CLAUDE.md target, at 25 nm cells


def test_slab_te_converges_with_resolution():
    n1, n2, d = 2.0, 1.45, 0.5
    window = {"x0": -1.5e6, "x1": 1.5e6, "y0": -2.0, "y1": 2.0}
    want = slab_neff(n1, n2, d, "TE")
    errs = []
    for ny in (40, 80, 160, 320):
        res = solve_project(slab_project(n1, n2, d), window, nx=3, ny=ny, num_modes=1, kind="semivector-te")
        errs.append(abs(res["modes"][0]["neff"].real - want))
    assert errs[-1] < errs[0] / 4
    assert errs[-1] < 2e-4


def lp01(n_core, n_clad, a):
    """Exact LP01 of a step-index fibre: returns (neff, u, w)."""
    v = K0 * a * np.sqrt(n_core**2 - n_clad**2)

    def f(u):
        w = np.sqrt(v**2 - u**2)
        return u * j1(u) / j0(u) - w * bk1(w) / bk0(w)

    u = brentq(f, 1e-6, min(v, 2.4048) - 1e-9)
    w = np.sqrt(v**2 - u**2)
    return np.sqrt(n_clad**2 + (w / (K0 * a)) ** 2), u, w


def lp01_mfd(a, u, w):
    """1/e² intensity diameter of the exact LP01 field."""

    def inten(r):
        return (j0(u * r / a) if r <= a else j0(u) * bk0(w * r / a) / bk0(w)) ** 2

    r = brentq(lambda rr: inten(rr) - np.exp(-2), 1e-9, 20 * a)
    return 2 * r


def fibre_result(n_cells):
    n_clad, dn, a = 1.444, 0.005, 4.0
    p = project(LAM, "custom:clad", [circle("custom:core", 0, 0, a)], [custom("core", n_clad + dn), custom("clad", n_clad)])
    window = {"x0": -20, "x1": 20, "y0": -20, "y1": 20}
    res = solve_project(p, window, nx=n_cells, ny=n_cells, num_modes=2, kind="fullvector")
    return res, lp01(n_clad + dn, n_clad, a), a


def test_fibre_lp01_neff_and_mfd():
    res, (neff, u, w), a = fibre_result(100)
    m = res["modes"][0]
    assert abs(m["neff"].real - neff) < 1e-4
    want = lp01_mfd(a, u, w)
    assert abs(m["mfd"]["x"] - want) / want < 0.03
    assert abs(m["mfd"]["y"] - want) / want < 0.03
    # The two polarisations of LP01 are degenerate.
    assert abs(res["modes"][0]["neff"].real - res["modes"][1]["neff"].real) < 1e-5


def test_modes_are_unit_power_and_guided():
    res, _, _ = fibre_result(60)
    g = res["grid"]
    for m in res["modes"]:
        f = m["fields"]
        p = 0.5 * np.real(np.sum(f["Ex"] * np.conj(f["Hy"]) - f["Ey"] * np.conj(f["Hx"]))) * g["dx"] * g["dy"]
        assert p == pytest.approx(1, abs=1e-9)
        assert m["guided"]
        assert m["boundaryAmplitude"] < 1e-3
