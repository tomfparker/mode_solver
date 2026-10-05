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

| case | unknowns | native `eigs` | native tuned | **Pyodide tuned** (Node/V8) | **Pyodide tuned** (Firefox) | Pyodide `eigs` (Node / Firefox) |
|---|---|---|---|---|---|---|
| scalar 100×100 | 10 000 | 200 | 85–95 | **150 + 11 build** | **143 + 10 build** | 317 / 324 |
| scalar 200×200 | 40 000 | 1 000–1 400 | 465 | **710 + 25 build** | **770 + 28 build** | 1 520 / 1 683 |
| vector 100×100 | 20 000 | 600 | 350–370 | **540–560 + 19 build** | **590 + 18 build** | 970 / 1 055 |
| vector 200×200 | 80 000 | 4 000 | 1 900–2 000 | **2 650 + 50 build** | **3 094 + 50 build** | 6 070 / 7 162 |

Firefox (desktop, run by the maintainer on the same machine, 2026-10-04): runtime ready after
**12.4 s** on first (uncached) load; field transfer 8 ms. Firefox's LU fill for vector 200×200 is
higher than native (8.8M vs 3.5M nnz with the same ordering). The cause is unknown and doesn't
matter at 100×100. Chrome numbers are pending.

Field transfer out of Python is negligible (a few ms for six 200×200 components). Raw data:
`docs/spike-native.json`, `docs/spike-node.json`.

Pyodide runtime + numpy + scipy load: ~8 s in Node on the first (uncached) run; 12.4 s in
Firefox on first load (dominated by downloading ~30 MB). Cached repeat-visit time is pending.

## Conclusions

1. **Shift-invert `eigs` works in Pyodide.** ARPACK is present and gives the same answers as native.
2. **WASM costs about 1.4–1.7× native.** Factorisation (`splu`) and the ~50 triangular solves of
   the Arnoldi iteration dominate, and both grow superlinearly with N.
3. **Budget (100×100 < 300 ms):** met for scalar/semi-vector (~165 ms). **Missed ~2× for
   full-vector** (~560 ms) on this CPU.
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
under Node (V8). Firefox has now been measured by hand (above). **Still needed: Chrome, and
the cached repeat-visit load time:** `npm run dev`, open
<http://localhost:5173/spike.html>, and send me the table. Firefox's SpiderMonkey WASM
performance may differ. The page also reports the time until the runtime is ready.
