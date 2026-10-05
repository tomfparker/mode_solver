# M0 spike: sparse shift-invert eigensolve in Pyodide

Date: 2026-10-04. Machine: Intel Core i5-6500T (2016, 35 W desktop part, 4 cores). This is
probably slower than a typical current laptop, but that's untested.
Stack: Pyodide 314.0.7 (Python 3.14.2, numpy 2.4.6, scipy 1.18.0), native venv pinned to
the same numpy/scipy. Code: `solver_py/modesolver/spike.py`.

## What was timed

- **scalar**: real 5-point Helmholtz operator, toy step-index rectangle, N×N grid (N² unknowns).
- **vector**: 2×2 block operator with the size (2N² unknowns) and stencil sparsity of a
  full-vector Yee (Ex, Ey) operator, but not its physics. It only exists to make the
  factorisation cost realistic.
- k = 4 modes, shift σ = (k₀·n_max)².
- `eigs` = plain `scipy.sparse.linalg.eigs(A, sigma=σ)` (default ordering, tol = machine eps).
- `tuned` = explicit `splu(A − σI, permc_spec="MMD_AT_PLUS_A")` + `eigs` on the inverse
  with `tol=1e-8`. n_eff agrees with the plain path to ~1e-14.

## Results (ms, second run = warm)

Pyodide columns are "tuned solve + operator build" for the warm run.

| case | unknowns | native `eigs` | native tuned | **Node (V8)** | **Firefox** | **Chrome** | Pyodide `eigs` (Node / Firefox / Chrome) |
|---|---|---|---|---|---|---|---|
| scalar 100×100 | 10 000 | 200 | 85–95 | **150 + 11** | **143 + 10** | **150 + 13** | 317 / 324 / 374 |
| scalar 200×200 | 40 000 | 1 000–1 400 | 465 | **710 + 25** | **770 + 28** | **758 + 29** | 1 520 / 1 683 / 1 629 |
| vector 100×100 | 20 000 | 600 | 350–370 | **540–560 + 19** | **590 + 18** | **548 + 19** | 970 / 1 055 / 1 068 |
| vector 200×200 | 80 000 | 4 000 | 1 900–2 000 | **2 650 + 50** | **3 094 + 50** | **2 672 + 52** | 6 070 / 7 162 / 6 247 |

Firefox (desktop, run by the maintainer on the same machine, 2026-10-04): runtime ready after
**12.4 s** on first (uncached) load; field transfer 8 ms. LU fill (nnz) is identical in native,
Node and Firefox, so the speed differences come from the WASM engines alone, not from the
factorisation.

Chrome (desktop, same machine, 2026-10-05): runtime ready after **8.4 s** on first load.
Solve timings match Node (both V8). **Field transfer: 351 ms in Chrome vs 8 ms in Firefox.**
This is a single sample, and it measures np.random.rand + getBuffer + a JS Float64→Float32
copy. It's unexplained. Before relying on it, M2 will produce float32 in numpy, transfer that
buffer directly (no JS-side conversion), and log per-solve transfer time in
`diagnostics.timingsMs`.

Field transfer out of Python is negligible (a few ms for six 200×200 components). Raw data:
`docs/spike-native.json`, `docs/spike-node.json`.

Pyodide runtime + numpy + scipy load: ~8 s in Node on the first (uncached) run; 12.4 s in
Firefox and 8.4 s in Chrome on first load (dominated by downloading ~30 MB). Cached
repeat-visit time is pending.

## Conclusions

1. **Shift-invert `eigs` works in Pyodide.** ARPACK is present and gives the same answers as native.
2. **WASM costs about 1.4–1.7× native.** Factorisation (`splu`) and the ~50 triangular solves of
   the Arnoldi iteration dominate, and both grow superlinearly with N.
3. **Budget (100×100 < 300 ms):** met for scalar/semi-vector (~155–165 ms in all three
   engines). **Missed ~2× for full-vector** (~550–610 ms) on this CPU.
4. Tuning matters: the tuned path is 2× faster than plain `eigs`. M2 uses it.

## Proposed strategy for M2 (for review)

- During drags and rapid edits, run a semi-vector solve at ~100×100 (<300 ms). Run the
  full-vector solve once editing pauses (~0.5 s at 100×100). Results show which solver
  produced them. The UI already treats results as possibly stale.
- Reuse the previous n_eff as the shift on every re-solve. Measured natively, this cuts
  ~25% of the Arnoldi iterations.
- Request only the modes shown (k = 2) during drags.
- If this isn't enough, the next lever is a Rust→WASM sparse LU behind the same `Solver`
  interface, not a different algorithm.

## Not yet measured (check by hand)

Playwright's browser downloads time out from this network, so automated runs use Pyodide
under Node (V8). Firefox and Chrome have been measured by hand (above). **Still needed:
the cached repeat-visit load time.** Reload <http://localhost:5173/spike.html> and note the
"Runtime ready" line.
