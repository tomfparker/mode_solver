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


# x is made effectively infinite (3 very wide cells) so the 2-D solver sees a 1-D slab.
SLAB_WINDOW = {"x0": -1.5e6, "x1": 1.5e6, "y0": -2.0, "y1": 2.0}


def slab_project(n1, n2, d):
    return project(LAM, "custom:clad", [rect("custom:core", 0, -d / 2, 1, d, full_width=True)],
                   [custom("core", n1), custom("clad", n2)])


@pytest.mark.parametrize("pol,kind", [("TE", "semivector-te"), ("TM", "semivector-tm"), ("TE", "fullvector"), ("TM", "fullvector")])
def test_slab_matches_analytic(pol, kind):
    n1, n2, d = 2.0, 1.45, 0.5
    res = solve_project(slab_project(n1, n2, d), SLAB_WINDOW, {"nx": 3, "ny": 160}, num_modes=6, kind=kind)
    want = slab_neff(n1, n2, d, pol)
    te_like = pol == "TE"
    got = [m["neff"].real for m in res["modes"] if (m["teFraction"] > 0.5) == te_like]
    assert got, "no mode of the requested polarisation found"
    assert min(abs(g - want) for g in got) < 1e-3  # CLAUDE.md target, at 25 nm cells


def test_slab_te_converges_with_resolution():
    n1, n2, d = 2.0, 1.45, 0.5
    want = slab_neff(n1, n2, d, "TE")
    errs = []
    for ny in (40, 80, 160, 320):
        res = solve_project(slab_project(n1, n2, d), SLAB_WINDOW, {"nx": 3, "ny": ny}, num_modes=1, kind="semivector-te")
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
    res = solve_project(p, window, {"nx": n_cells, "ny": n_cells}, num_modes=2, kind="fullvector")
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
    area = np.outer(g["dy"], g["dx"])
    for m in res["modes"]:
        f = m["native"]
        p = 0.5 * np.real(np.sum((f["Ex"] * np.conj(f["Hy"]) - f["Ey"] * np.conj(f["Hx"])) * area))
        assert p == pytest.approx(1, abs=1e-9)
        assert m["guided"]
        assert m["boundaryAmplitude"] < 1e-3


# ---- Anisotropic slab (diagonal tensor) ----------------------------------------------------

def aniso_slab_neff(n_core, n_clad, d, pol):
    """Fundamental mode of a slab with core indices (n_x, n_y, n_z) in an isotropic cladding.

    TE (Ex): an ordinary TE slab with core index n_x.
    TM (Hx, Ey, Ez): κ = k₀·(n_z/n_y)·√(n_y² − n_eff²), tan(κd/2) = (n_z²/n_c²)·γ/κ.
    """
    nx, ny, nz = n_core
    if pol == "TE":
        return slab_neff(nx, n_clad, d, "TE")

    def f(neff):
        kap = K0 * (nz / ny) * np.sqrt(ny**2 - neff**2)
        gam = K0 * np.sqrt(neff**2 - n_clad**2)
        return kap * d - 2 * np.arctan((nz / n_clad) ** 2 * gam / kap)

    return brentq(f, n_clad + 1e-9, ny - 1e-9)


@pytest.mark.parametrize("optic_axis", ["x", "y", "z"])
@pytest.mark.parametrize("pol", ["TE", "TM"])
def test_anisotropic_slab_matches_analytic(optic_axis, pol):
    from modesolver.materials import index_tensor

    d = 0.6
    n_core = tuple(c.real for c in index_tensor("LiNbO3", LAM, optic_axis=optic_axis))
    assert len(set(n_core)) == 2  # genuinely anisotropic
    n_clad = index_tensor("SiO2", LAM)[0].real
    core = rect("LiNbO3", 0, -d / 2, 1, d, full_width=True, opticAxis=optic_axis)
    p = project(LAM, "SiO2", [core], [])
    res = solve_project(p, SLAB_WINDOW, {"nx": 3, "ny": 200}, num_modes=6, kind="fullvector")
    want = aniso_slab_neff(n_core, n_clad, d, pol)
    got = [m["neff"].real for m in res["modes"] if (m["teFraction"] > 0.5) == (pol == "TE")]
    assert got and min(abs(g - want) for g in got) < 5e-4


# ---- Graded-index (diffused) guide: sanity, no analytic reference --------------------------

def test_diffused_channel_guides_between_substrate_and_peak_index():
    """The app's diffused-channel template: an in-diffused stripe in Z-cut-like LiNbO3 under air."""
    from modesolver.materials import index_tensor
    from modesolver.ui import MESH_SCALE

    dn = 0.01
    sub = {"kind": "rect", "id": "s", "name": "Substrate", "material": "LiNbO3", "opticAxis": "y",
           "x": 0, "y": -50, "width": 10, "height": 50, "fullWidth": True}
    stripe = {"kind": "graded", "id": "g", "name": "Stripe", "x": 0, "y": 0, "deltaN": dn, "profileX": "erf-strip",
              "stripWidth": 7, "wx": 2, "wy": 3, "profileY": "half-gaussian"}
    p = project(LAM, "Air", [sub, stripe], [])
    window = {"x0": -13.75, "x1": 13.75, "y0": -11.25, "y1": 8.25}  # the template's fitted window
    res = solve_project(p, window, {"scale": MESH_SCALE["standard"]}, num_modes=2)
    nx, ny, _ = (c.real for c in index_tensor("LiNbO3", LAM, optic_axis="y"))
    m = res["modes"][0]
    n_host = nx if m["teFraction"] > 0.5 else ny
    assert n_host < m["neff"].real < n_host + dn
    assert m["guided"]
    # The mode sits just below the surface and is a few µm across.
    assert 3 < m["mfd"]["x"] < 15 and 1 < m["mfd"]["y"] < 10
    assert sum(res["timings_ms"].values()) < 5000


# ---- Index gradient across a shape ---------------------------------------------------------

def test_rasterised_gradient_matches_the_profile_function():
    from modesolver.raster import gradient_profile, index_fields

    core = rect("custom:host", 0, -4, 6, 4, gradient={"from": "top", "profile": "exponential", "deltaN": 0.02, "length": 1.0})
    p = project(LAM, "custom:host", [core], [custom("host", 2.0)])
    ys = np.array([-5.0, -3.5, -2.0, -0.5, -1e-9, 0.5])
    n = index_fields(p, np.array([0.0]), ys)[0][:, 0]
    want = 2.0 + np.where((ys >= -4) & (ys < 0), 0.02 * gradient_profile("exponential", -ys, 1.0), 0.0)
    assert np.allclose(n, want, atol=1e-12)


@pytest.mark.parametrize("profile", ["exponential", "gaussian", "erfc", "linear"])
def test_graded_layer_guides_and_strengthens_with_delta_n(profile):
    """A surface layer with an index gradient from the top (exchanged / diffused planar guide)."""

    def neff(dn):
        layer = rect("custom:host", 0, -30, 1, 30, full_width=True, gradient={"from": "top", "profile": profile, "deltaN": dn, "length": 2.0})
        p = project(LAM, "custom:air", [layer], [custom("host", 2.2), custom("air", 1.0)])
        window = {"x0": -1.5e6, "x1": 1.5e6, "y0": -14.0, "y1": 2.0}
        yl = np.linspace(-14, 2, 321)
        res = solve_project(p, window, {"xl": np.array([-1.5e6, -0.5e6, 0.5e6, 1.5e6]), "yl": yl}, num_modes=2, kind="semivector-te")
        return res["modes"][0]["neff"].real

    # Δn large enough to be above cut-off for every profile (erfc and linear are the shallowest).
    a, b = neff(0.03), neff(0.06)
    assert 2.2 < a < 2.23
    assert 2.2 < b < 2.26
    assert b > a
