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

## 2026-10-05 — Maintainer: semi-vector while dragging is acceptable; Solver interface accepted as-is
Given implicitly ("let's just go to M1") after the M0 review. M2 will run semi-vector solves during drags and full-vector when editing pauses.

## 2026-10-05 — Material data: refractiveindex.info (CC0), imported verbatim by script
SiO₂ Malitson 1965 (+ Tan 1998 for the 6.7 µm limit), Si Li 293 K (tabulated, 1.2–14 µm), Si₃N₄ Luke 2015, LiNbO₃ Zelmon 1997 (o and e), air Ciddor 1996. The YAML files are copied unmodified into `data/materials/refractiveindex/`, and `scripts/import_materials.py` writes the JSON, so no coefficient is ever typed by hand.
**Note:** upstream cites Li as "J. Phys. Chem. Ref. Data 9, … (1993)". Volume 9 is 1980; the DOI (10.1063/1.555624) is authoritative. We keep the upstream text verbatim.
**Why:** CLAUDE.md forbids recalled values. A script import keeps provenance mechanical and auditable.

## 2026-10-05 — Features are anchored to layer surfaces
Every shape has `anchor` (a layer id or "substrate") and a y offset from that layer's top. Changing a layer thickness moves what sits on it. Deleting a layer drops its features onto the surface below (same offset). Changing a feature's anchor keeps its absolute position.
**Why:** this matches how users think ("ridge on the slab", "core on the BOX") and makes the layer stack the primary input (UI principle 2).

## 2026-10-05 — Graded-index model
Δn·f(x)·g(y), where f is a Gaussian or an erf-broadened stripe (in-diffused stripe), and g is a Gaussian or a half-Gaussian below the surface. The canvas outline shows the 1/e extent. Template Δn values carry `deltaNIsExample`, which keeps an info warning visible until the user edits Δn.

## 2026-10-05 — Custom materials are constant (n, k), stored in the project
Lab users often have a measured index (polymer, doped glass). These are flagged in the UI as user-entered with no dispersion, and lossy ones (k > 0) as approximate.

## 2026-10-05 — Solver interface change: `ModeResult.guided`
Added so warnings can count guided modes (multimode / below cut-off). Mock and worker are both updated (the worker doesn't solve yet). M2 must define "guided" for the real solver (likely n_eff above the highest cladding/substrate index that the mode's field reaches).

## 2026-10-05 — Mock solver behaviour (M1 only)
The mock uses the real geometry, window and material indices. n_eff, mode count and mode size come from a Marcatili-style estimate around "the core" (the first shape plus any within 250 nm), and the Hermite–Gaussian fields are given an evanescent decay wherever n < n_eff. The numbers are plausible but not physical. Every result is flagged `isMock`, and the UI shows a persistent banner and a "Mock solver" chip.

## 2026-10-05 — Auto window and mesh defaults
Padding = max(1 µm, 1.5 λ, 0.75 × structure size). Mesh = longer window side / 100 (the M0 budget). Both are overridable under Advanced. M2 should revisit the mesh for thin features (a 220 nm SOI core is only a few cells at this default) together with subpixel averaging.

## 2026-10-05 — Canvas and colour
- Geometry: neutral greys that darken with refractive index, so the geometry never competes with the field colours. Materials are identified by text labels and the list, not by colour.
- Field: |E|² on a single-hue blue ramp; signed components on a diverging blue/red ramp with a transparent zero; near-zero fades to transparent. Dark mode reverses the ramp order, so the peak stays brightest.
- The view auto-fits on load and whenever the window no longer fits, unless the user has zoomed or panned (Fit or F resets this). It never moves during a drag.

## 2026-10-05 — Undo semantics
Each discrete edit is one undo step. A drag gesture, or a burst of arrow-key nudges in one field, coalesces into one step. Ctrl+Z inside a field commits what was typed, then undoes it (app-level undo everywhere). Loading a template is undoable.

## 2026-10-05 — Single app stylesheet instead of CSS modules
`src/app/app.css` with design tokens (light/dark). The UI is one screen with few, tightly related components, so one file is easier to keep consistent. Supersedes "plain CSS modules" in the libraries entry above.

## 2026-10-05 — Scripted UI check with Selenium + the Firefox snap's geckodriver
`scripts/ui_check.py` drives the built app in headless Firefox: editing, drag handles, undo, wavelength, templates, URL round-trip, warnings, and JS errors. It's a stopgap, because Playwright's browser downloads time out on this network. The M6 Playwright smoke test remains the target.
