"""Finite-difference eigenmode solver on a Yee grid (diagonal anisotropic permittivity).

Conventions (CLAUDE.md): fields ∝ exp(i(βz − ωt)), lengths in µm, H normalised so that the
returned H is in units where E/H = η₀ in vacuum (H_SI = H / η₀ is applied at the end).

Derivation. With H' = η₀H and ∂z → iβ, Maxwell's curl equations on the Yee grid are
    i·k₀·H'x = Uy·Ez − iβ·Ey          −i·k₀·εx·Ex = Vy·H'z − iβ·H'y
    i·k₀·H'y = iβ·Ex − Ux·Ez          −i·k₀·εy·Ey = iβ·H'x − Vx·H'z
    i·k₀·H'z = Ux·Ey − Uy·Ex          −i·k₀·εz·Ez = Vx·H'y − Vy·H'x
U = forward difference (E → H locations), V = backward difference (H → E locations); on a
uniform mesh V = −Uᵀ.
The discrete divergence of the right-hand column vanishes identically, giving
    Ez = (i/β)·εz⁻¹·(Vx·εx·Ex + Vy·εy·Ey).
Substituting H' and Ez into the Ex and Ey equations leaves an eigenproblem in (Ex, Ey):
    β²·Ex = (k₀²εx + Vy·Uy + Ux·εz⁻¹·Vx·εx)·Ex + (−Vy·Ux + Ux·εz⁻¹·Vy·εy)·Ey
    β²·Ey = (−Vx·Uy + Uy·εz⁻¹·Vx·εx)·Ex + (k₀²εy + Vx·Ux + Uy·εz⁻¹·Vy·εy)·Ey
This is the Yee-mesh formulation family of Zhu & Brown (Opt. Express 10, 853, 2002), written
here for diagonal anisotropy (cf. Fallahkhair et al., J. Lightwave Technol. 26, 1423, 2008).
In a uniform medium the cross terms cancel and each block is the Helmholtz operator.

Boundaries: fields are taken as zero outside the window (metal-like walls). PML is future work.
"""

import time

import numpy as np
import scipy.sparse as sp
from scipy.sparse.linalg import LinearOperator, eigs, splu

ETA0 = 376.730313668  # Ω, μ₀·c
KINDS = ("scalar", "semivector-te", "semivector-tm", "fullvector")


def difference_ops(dx, dy):
    """Forward (U) and backward (V) differences for cell sizes dx (nx values) and dy (ny values).

    U maps node → cell-centre values along its axis (divide by the cell size); V maps
    cell-centre → node values (divide by the distance between neighbouring cell centres).
    Fields are zero outside the window. Unknowns are flattened row-major: index = j·nx + i.
    """

    def pair(d):
        n = len(d)
        dual = np.empty(n)
        dual[0] = d[0]
        dual[1:] = 0.5 * (d[:-1] + d[1:])
        fwd = sp.diags([-np.ones(n), np.ones(n - 1)], [0, 1], shape=(n, n))
        bwd = sp.diags([np.ones(n), -np.ones(n - 1)], [0, -1], shape=(n, n))
        return sp.diags(1 / d) @ fwd, sp.diags(1 / dual) @ bwd

    fx, bx = pair(np.asarray(dx, dtype=float))
    fy, by = pair(np.asarray(dy, dtype=float))
    ix, iy = sp.identity(len(dx)), sp.identity(len(dy))
    return (sp.kron(iy, fx, format="csr"), sp.kron(iy, bx, format="csr"),
            sp.kron(fy, ix, format="csr"), sp.kron(by, ix, format="csr"))


def build_operator(grid, wavelength, kind="fullvector"):
    """Sparse operator P with P·E = β²·E for the chosen solver kind, plus the pieces needed later."""
    ny, nx = grid["ezz"].shape
    k0 = 2 * np.pi / wavelength
    ux, vx, uy, vy = difference_ops(grid["dx"], grid["dy"])
    exx, eyy, ezz = (grid[c].ravel() for c in ("exx", "eyy", "ezz"))
    # Lossless structures get a real matrix: real LU and Arnoldi are about twice as fast as complex.
    if not any(np.iscomplexobj(a) and np.any(a.imag != 0) for a in (exx, eyy, ezz)):
        exx, eyy, ezz = exx.real, eyy.real, ezz.real
    ex = sp.diags(exx)
    ey = sp.diags(eyy)
    ezi = sp.diags(1 / ezz)
    ops = {"ux": ux, "vx": vx, "uy": uy, "vy": vy, "ex": ex, "ey": ey, "ezi": ezi, "k0": k0, "nx": nx, "ny": ny}
    if kind == "scalar":
        p = vx @ ux + vy @ uy + k0**2 * sp.diags(ezz)
    else:
        pxx = k0**2 * ex + vy @ uy + ux @ ezi @ vx @ ex
        pyy = k0**2 * ey + vx @ ux + uy @ ezi @ vy @ ey
        if kind == "semivector-te":
            p = pxx
        elif kind == "semivector-tm":
            p = pyy
        elif kind == "fullvector":
            pxy = -vy @ ux + ux @ ezi @ vy @ ey
            pyx = -vx @ uy + uy @ ezi @ vx @ ex
            p = sp.bmat([[pxx, pxy], [pyx, pyy]])
        else:
            raise ValueError(f"unknown solver kind {kind!r}")
    return p.tocsc(), ops


def eigensolve(p, k0, n_guess, num_modes, tol=1e-8):
    """The `num_modes` eigenpairs of P nearest (k₀·n_guess)², by shift-invert Arnoldi.

    Explicit LU + Arnoldi on the inverse. SuperLU's default COLAMD ordering is used: measured
    on the real operator (100×100 full-vector) it factorises in ~190 ms against ~1.2–1.6 s for
    MMD_AT_PLUS_A, despite more fill. (The M0 spike's stand-in matrix suggested the opposite.)
    """
    n = p.shape[0]
    sigma = (k0 * n_guess) ** 2
    lu = splu((p - sigma * sp.identity(n, format="csc")).tocsc())
    op = LinearOperator(p.shape, matvec=lu.solve, dtype=p.dtype)
    k = min(num_modes, n - 2)
    mu, vecs = eigs(op, k=k, which="LM", tol=tol)
    beta2 = sigma + 1 / mu
    order = np.argsort(-np.sqrt(beta2).real)
    return beta2[order], vecs[:, order]


def _centre(a, axis):
    """Average a staggered array onto cell centres along `axis` (neighbour beyond the edge = 0)."""
    b = np.zeros_like(a)
    if axis == "y":
        b[:-1] = a[1:]
    else:
        b[:, :-1] = a[:, 1:]
    return 0.5 * (a + b)


def reconstruct(vec, beta2, ops, kind):
    """All six field components at cell centres, normalised to unit power.

    Returns a dict of complex (ny, nx) arrays Ex, Ey, Ez, Hx, Hy, Hz (H in SI-consistent units:
    A/µm-style scaling with E in V/µm so that ½·Re∫(E×H*)·ẑ dA = 1).
    """
    nx, ny, k0 = ops["nx"], ops["ny"], ops["k0"]
    n = nx * ny
    beta = np.sqrt(beta2)
    zero = np.zeros(n, dtype=complex)
    if kind == "fullvector":
        ex, ey = vec[:n].astype(complex), vec[n:].astype(complex)
    elif kind == "semivector-tm":
        ex, ey = zero, vec.astype(complex)
    else:  # semivector-te and scalar: the field is taken as x-polarised
        ex, ey = vec.astype(complex), zero

    ez = (1j / beta) * (ops["ezi"] @ (ops["vx"] @ (ops["ex"] @ ex) + ops["vy"] @ (ops["ey"] @ ey)))
    hx = (ops["uy"] @ ez - 1j * beta * ey) / (1j * k0)
    hy = (1j * beta * ex - ops["ux"] @ ez) / (1j * k0)
    hz = (ops["ux"] @ ey - ops["uy"] @ ex) / (1j * k0)

    def grid2(a):
        return a.reshape(ny, nx)

    f = {
        "Ex": _centre(grid2(ex), "y"),  # (i+½, j) → centre
        "Ey": _centre(grid2(ey), "x"),  # (i, j+½) → centre
        "Ez": _centre(_centre(grid2(ez), "x"), "y"),  # corner → centre
        "Hx": _centre(grid2(hx), "x") / ETA0,
        "Hy": _centre(grid2(hy), "y") / ETA0,
        "Hz": grid2(hz) / ETA0,
    }
    # Fix the global phase so the dominant transverse component is real and positive at its peak.
    dom = f["Ex"] if np.abs(f["Ex"]).max() >= np.abs(f["Ey"]).max() else f["Ey"]
    phase = np.exp(-1j * np.angle(dom.ravel()[np.abs(dom).argmax()]))
    return {k: v * phase for k, v in f.items()}


def normalise_power(f, dx, dy):
    """Scale fields in place to ½·Re∫(E×H*)·ẑ dA = 1 (dx, dy: cell sizes). Returns the original power."""
    area = np.outer(dy, dx)
    p = 0.5 * np.real(np.sum((f["Ex"] * np.conj(f["Hy"]) - f["Ey"] * np.conj(f["Hx"])) * area))
    s = 1 / np.sqrt(abs(p)) if p != 0 else 1.0
    for k in f:
        f[k] = f[k] * s
    return p


def _width_at(profile, coords, level):
    """Full width of `profile` at `level`: distance between the outermost crossings (linear interpolation)."""
    above = np.nonzero(profile >= level)[0]
    if len(above) == 0:
        return 0.0
    a, b = above[0], above[-1]
    d = coords[1] - coords[0]

    def edge(i_in, i_out):
        if i_out < 0 or i_out >= len(profile):
            return coords[i_in] + (0.5 * d if i_out > i_in else -0.5 * d)  # runs into the window edge
        t = (profile[i_in] - level) / (profile[i_in] - profile[i_out])
        return coords[i_in] + t * (coords[i_out] - coords[i_in])

    return float(edge(b, b + 1) - edge(a, a - 1))


def mode_metrics(f, x, y):
    """Mode size and character from centred fields."""
    dx, dy = x[1] - x[0], y[1] - y[0]
    ex2, ey2 = np.abs(f["Ex"]) ** 2, np.abs(f["Ey"]) ** 2
    inten = ex2 + ey2 + np.abs(f["Ez"]) ** 2
    total = inten.sum()
    peak = inten.max()
    jp, ip = np.unravel_index(inten.argmax(), inten.shape)
    level = peak * np.exp(-2)
    # 1/e² full widths along the row and column through the intensity peak.
    mfd_x = _width_at(inten[jp, :], x, level)
    mfd_y = _width_at(inten[:, ip], y, level)
    # Second-moment (D4σ) widths: equal to the 1/e² width for a Gaussian.
    mx = (inten.sum(0) * x).sum() / total
    my = (inten.sum(1) * y).sum() / total
    d4x = 4 * np.sqrt((inten.sum(0) * (x - mx) ** 2).sum() / total)
    d4y = 4 * np.sqrt((inten.sum(1) * (y - my) ** 2).sum() / total)
    edge = np.concatenate([inten[0], inten[-1], inten[:, 0], inten[:, -1]])
    ny, nx = inten.shape
    bx, by = max(2, nx // 20), max(2, ny // 20)
    inner = inten[by:-by, bx:-bx].sum()
    te = ex2.sum() / max((ex2 + ey2).sum(), 1e-300)
    return {
        "mfd": {"x": mfd_x, "y": mfd_y},
        "mfdD4s": {"x": float(d4x), "y": float(d4y)},
        "aEff": float(total**2 / (inten**2).sum() * dx * dy),
        "teFraction": float(te),
        "boundaryAmplitude": float(edge.max() / peak) if peak > 0 else 0.0,
        "edgeFraction": float(1 - inner / total) if total > 0 else 0.0,
    }


#: A mode with more than this fraction of its |E|² in the outer 5% band of the window is a
#: "window mode" (it lives against the walls, e.g. in a substrate slice), not a guided mode.
EDGE_FRACTION_LIMIT = 0.1
#: A mode whose second-moment width exceeds this fraction of the window in x or y is a window mode.
WINDOW_FILL_LIMIT = 0.6


def _interp_axis(src, dst):
    i = np.clip(np.searchsorted(src, dst) - 1, 0, len(src) - 2)
    t = np.clip((dst - src[i]) / (src[i + 1] - src[i]), 0.0, 1.0)
    return i, t


def resample(a, x, y, xu, yu):
    """Bilinear resampling of a (ny, nx) array from cell centres (x, y) onto (xu, yu)."""
    ix, tx = _interp_axis(x, xu)
    iy, ty = _interp_axis(y, yu)
    b = a[:, ix] * (1 - tx) + a[:, ix + 1] * tx
    return b[iy] * (1 - ty)[:, None] + b[iy + 1] * ty[:, None]


def display_axes(grid, cells=128):
    """Uniform cell-centre coordinates covering the window, `cells` along the longer side."""
    xl, yl = grid["xl"], grid["yl"]
    w, h = xl[-1] - xl[0], yl[-1] - yl[0]
    d = max(w, h) / cells
    nxu, nyu = max(16, int(round(w / d))), max(16, int(round(h / d)))
    return xl[0] + (np.arange(nxu) + 0.5) * w / nxu, yl[0] + (np.arange(nyu) + 0.5) * h / nyu


def solve(grid, wavelength, num_modes=4, kind="fullvector", n_guess=None, display_cells=128):
    """Solve for modes on a rasterised grid. Returns (modes, display, timings_ms).

    Each mode: neff (complex), `fields` on the uniform display grid (unit power), `native`
    fields on the solver mesh, metrics, and a guided flag. `display` holds the display grid
    (x, y) and the index map resampled onto it.
    """
    t = {}
    t0 = time.perf_counter()
    p, ops = build_operator(grid, wavelength, kind)
    t["build"] = (time.perf_counter() - t0) * 1e3
    t0 = time.perf_counter()
    beta2, vecs = eigensolve(p, ops["k0"], n_guess if n_guess else grid["n_max"], num_modes)
    t["eigensolve"] = (time.perf_counter() - t0) * 1e3
    t0 = time.perf_counter()
    xu, yu = display_axes(grid, display_cells)
    width, height = grid["xl"][-1] - grid["xl"][0], grid["yl"][-1] - grid["yl"][0]
    modes = []
    for m in range(len(beta2)):
        f = reconstruct(vecs[:, m], beta2[m], ops, kind)
        normalise_power(f, grid["dx"], grid["dy"])
        fu = {k: resample(v, grid["x"], grid["y"], xu, yu) for k, v in f.items()}
        met = mode_metrics(fu, xu, yu)
        neff = complex(np.sqrt(beta2[m]) / ops["k0"])
        # Guided = not living against the walls, and not spread across the whole window
        # (slab and box modes fill it with a half-sine, D4σ ≈ 0.72 × the window).
        spread = max(met["mfdD4s"]["x"] / width, met["mfdD4s"]["y"] / height)
        guided = met["edgeFraction"] < EDGE_FRACTION_LIMIT and spread < WINDOW_FILL_LIMIT
        modes.append({"neff": neff, "fields": fu, "native": f, "guided": guided, **met})
    display = {"x": xu, "y": yu, "n": resample(grid["n_centre"], grid["x"], grid["y"], xu, yu)}
    t["post"] = (time.perf_counter() - t0) * 1e3
    return modes, display, t
