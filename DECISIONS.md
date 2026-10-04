# DECISIONS.md

Decisions not settled by CLAUDE.md. Format: date — decision — why.

## 2026-10-04 — Do not reuse philsol code; implement the FD solver from the papers
**Why:** philsol's licence is unclear. As of today, the GitHub repo (`philmain28/philsol`, v0.25) has no LICENSE file, and its PyPI metadata is contradictory: the `license` field says "GNU GPL" but the classifier says "License :: Other/Proprietary License". Under CLAUDE.md's rule ("if incompatible or unclear, implement from the papers"), we treat it as unusable. We'll implement from Zhu & Brown and Fallahkhair et al. once those references are verified (M2).

## 2026-10-04 — Pin Pyodide to 314.0.7 (latest release, 2026-09-14)
**Why:** this gives a reproducible numerics stack. The native `.venv` will pin numpy/scipy to the versions this Pyodide ships, so pytest results match the browser. Revisit when upgrading.

## 2026-10-04 — Sweeps are orchestrated from JS, one solve call per step
**Why:** a running Pyodide call can't be interrupted without SharedArrayBuffer (which needs cross-origin isolation). With step-wise orchestration, cancel and progress work on any static host. When `crossOriginIsolated` is true we additionally use `pyodide.setInterruptBuffer` for mid-solve interrupts.

## 2026-10-04 — Frontend libraries
zustand (state + undo history), zod (Project schema / URL decode validation), lz-string (URL hash compression), d3-contour (1/e² contour), Vitest, plain CSS modules. Linting with oxlint (came with the Vite template) instead of ESLint.
**Why:** these are small, well-maintained and unopinionated about UI. They avoid a heavy component framework that would fight a custom canvas-centric layout.

## 2026-10-04 — Maintainer answers to PLAN.md questions
- Licence: **MIT** ("for now").
- Hosting: **GitHub Pages initially**, possibly a server later. So no cross-origin isolation for now; cancellation is latest-wins (see the sweeps decision above). Vite `base: './'` so the build works from a Pages sub-path.
- M1 numbers: **option (b)**, mock solver plus the sourced material library pulled forward into M1.
- Node installed via nvm (user-level). nvm was already present in `~/.config/nvm`; Node 22.23.3 added.

## 2026-10-04 — Python venv created with `--without-pip` + get-pip.py
**Why:** the system lacks the Debian `python3-venv` package (ensurepip missing), and installing it needs sudo. The venv is repo-local and gitignored, with numpy 2.4.6 / scipy 1.18.0 matching Pyodide 314.0.7.

## 2026-10-04 — Eigensolve settings: explicit `splu(permc_spec="MMD_AT_PLUS_A")` + `eigs(tol=1e-8)`
**Why:** M0 spike (docs/spike-m0.md). This is 2× faster than plain `eigs(sigma=…)` in Pyodide with identical n_eff (~1e-14). MMD on A+Aᵀ roughly halves LU fill for these stencils.

## 2026-10-04 — Spike browser numbers measured under Node (V8) for now
**Why:** Playwright's browser downloads (cdn.playwright.dev) time out from this network, with or without the sandbox. Node runs the same Pyodide/WASM code in V8, Chrome's engine. Real Chrome/Firefox numbers are pending a manual run of `/spike.html`.

## 2026-10-04 — Mock solver runs on the main thread
**Why:** generating Hermite–Gaussian fields for ~100×100 takes a few ms, so a worker adds nothing. It goes through the same `LatestWins` scheduler as the Pyodide client, so the UI sees identical cancellation semantics.

## 2026-10-04 — Mock MFD uses D4σ (second moments)
**Why:** this equals the 1/e² diameter for a Gaussian, which is all the mock produces. The real definition for non-Gaussian modes (1/e² contour extent vs D4σ) is an M2 decision and will be logged then.
