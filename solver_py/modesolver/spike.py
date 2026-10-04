"""M0 feasibility spike: time sparse shift-invert eigensolves (native and in Pyodide).

This is a timing harness, not the M2 solver. The "scalar" case is a genuine 5-point
Helmholtz operator for a toy step-index rectangle. The "vector-sized" case is a 2x2 block
operator with the size (2N^2 unknowns) and stencil sparsity of a full-vector Yee (Ex, Ey)
formulation, but not its physics. It exists only so the factorisation cost is realistic.
The refractive indices here are toy values for timing, not material data.
"""

import time

import numpy as np
import scipy.sparse as sp
from scipy.sparse.linalg import LinearOperator, eigs, splu

TOY_N_CORE = 2.0
TOY_N_CLAD = 1.45


def _toy_index(n, width=4.0, core_w=1.0, core_h=0.8):
    """Toy step-index rectangle centred in a square domain. Returns (n2 grid, dx)."""
    dx = width / n
    c = (np.arange(n) + 0.5) * dx - width / 2
    X, Y = np.meshgrid(c, c, indexing="xy")
    core = (np.abs(X) <= core_w / 2) & (np.abs(Y) <= core_h / 2)
    return np.where(core, TOY_N_CORE**2, TOY_N_CLAD**2), dx


def _diff_ops(n, dx):
    """Forward (U) and backward (V) first differences on an n x n grid, Dirichlet ends."""
    e = np.ones(n)
    d1 = sp.diags([-e, e[:-1]], [0, 1], shape=(n, n)) / dx
    eye = sp.identity(n)
    ux = sp.kron(eye, d1, format="csr")  # x varies fastest (row-major, indexing="xy")
    uy = sp.kron(d1, eye, format="csr")
    return ux, -ux.T.tocsr(), uy, -uy.T.tocsr()


def scalar_operator(n, wavelength=1.55):
    n2, dx = _toy_index(n)
    k0 = 2 * np.pi / wavelength
    ux, vx, uy, vy = _diff_ops(n, dx)
    lap = vx @ ux + vy @ uy
    a = (lap + sp.diags(k0**2 * n2.ravel())).tocsc()
    return a, k0


def vector_sized_operator(n, wavelength=1.55):
    """Block operator with full-vector size/sparsity (see module docstring)."""
    n2, dx = _toy_index(n)
    k0 = 2 * np.pi / wavelength
    ux, vx, uy, vy = _diff_ops(n, dx)
    lap = vx @ ux + vy @ uy
    pxx = lap + sp.diags(k0**2 * n2.ravel())
    pyy = lap + sp.diags(k0**2 * n2.ravel())
    # Cross terms: ux@vy-type stencils, scaled small so eigenvalues stay near the scalar ones.
    pxy = 0.01 * (ux @ vy)
    pyx = 0.01 * (uy @ vx)
    a = sp.bmat([[pxx, pxy], [pyx, pyy]], format="csc")
    return a, k0


def time_case(kind, n, k=4, wavelength=1.55):
    """Time one eigensolve. Returns a dict of timings (ms) and the found n_eff values."""
    t = {}
    t0 = time.perf_counter()
    build = scalar_operator if kind == "scalar" else vector_sized_operator
    a, k0 = build(n, wavelength)
    t["build_ms"] = (time.perf_counter() - t0) * 1e3
    sigma = (k0 * TOY_N_CORE) ** 2

    # Path 1: the plain API we intend to use, scipy's built-in shift-invert.
    t0 = time.perf_counter()
    vals = eigs(a, k=k, sigma=sigma, which="LM", return_eigenvectors=False)
    t["eigs_total_ms"] = (time.perf_counter() - t0) * 1e3

    # Path 2 (tuned): explicit splu + Arnoldi on the inverse, which also splits factorisation
    # from iteration. MMD on A+A^T roughly halves LU fill vs the default COLAMD for these
    # stencils; tol=1e-8 cuts ~30% of solves with n_eff unchanged to ~1e-14 (see spike notes).
    t0 = time.perf_counter()
    lu = splu(
        (a - sigma * sp.identity(a.shape[0], format="csc")).tocsc(),
        permc_spec="MMD_AT_PLUS_A",
    )
    t["splu_ms"] = (time.perf_counter() - t0) * 1e3
    nsolves = [0]

    def matvec(x):
        nsolves[0] += 1
        return lu.solve(x)

    op = LinearOperator(a.shape, matvec=matvec, dtype=a.dtype)
    t0 = time.perf_counter()
    mu, vecs = eigs(op, k=k, which="LM", tol=1e-8)
    t["arnoldi_ms"] = (time.perf_counter() - t0) * 1e3
    vals2 = sigma + 1 / mu

    neff = np.sort(np.sqrt(vals.real) / k0)[::-1]
    neff2 = np.sort(np.sqrt(vals2.real) / k0)[::-1]
    return {
        "kind": kind,
        "n": n,
        "unknowns": int(a.shape[0]),
        "nnz": int(a.nnz),
        "lu_nnz": int(lu.L.nnz + lu.U.nnz),
        **{key: round(v, 2) for key, v in t.items()},
        "neff": [round(float(x), 6) for x in neff],
        "tuned_total_ms": round(t["splu_ms"] + t["arnoldi_ms"], 2),
        "nsolves": nsolves[0],
        "paths_agree": bool(np.allclose(neff, neff2, atol=1e-8)),
        "field_shape": [int(s) for s in vecs.shape],
    }


def run_spike(sizes=(100, 200), kinds=("scalar", "vector"), repeats=2):
    """Run each case `repeats` times. The first run includes warm-up (imports, JIT-less caches)."""
    out = []
    for kind in kinds:
        for n in sizes:
            for r in range(repeats):
                res = time_case(kind, n)
                res["run"] = r
                out.append(res)
    return out


if __name__ == "__main__":
    import json
    import platform

    print(json.dumps({"platform": platform.platform(), "results": run_spike()}, indent=1))
