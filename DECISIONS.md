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

## 2026-10-10 — Maintainer: Solve button instead of live solving
Replaces CLAUDE.md UI principle 3 ("Live results, no Run button"), now updated. Edits mark results out of date (dimmed, with a canvas pill and a highlighted Solve button). Solve or Ctrl+Enter solves the current state; while a solve runs the button becomes Cancel. A newly loaded project (first load, template, shared link) solves automatically, so the app never opens blank. A warning's "fix" button applies the fix and solves.
Consequence for M2: the semi-vector-while-dragging plan is no longer needed. Each Solve runs the chosen solver (full-vector by default).

## 2026-10-10 — Maintainer: wavelength preset buttons removed
The wavelength field stays prominent; arrow keys step 1 nm (Shift: 10 nm).

## 2026-10-10 — Simulation window labelled on the canvas
The dashed rectangle is now labelled "Simulation window", with a tooltip explaining that its edges act as walls and where to resize it. The maintainer couldn't tell what it was.

## 2026-10-10 — Maintainer: one structure list instead of separate layer stack and shapes (option A)
A single list read top → bottom like the cross-section: cladding, then each layer preceded by the shapes sitting on it, then substrate. The list is the single source of truth (`src/geometry/stackList.ts`): reading bottom-up, a shape sits on the nearest layer below it, and higher in the list = painted later (wins overlaps). Dragging a row or using Move up/down rewrites layer order, anchors and paint order together. A layer moves with the shapes sitting on it. The store normalises feature order to the list after every edit. Changing "Sits on" now keeps the shape's offset (it moves onto the new surface) instead of its absolute position, matching list moves. "Bring forward / Send back" were replaced by Move up/down. Supersedes UI principle 2's "layer stack first, shapes second" panel split; the layer-first model itself is unchanged.

## 2026-10-10 — Solve button labelled "Run"
The maintainer calls it a run button.

## 2026-10-10 — Maintainer: background material + shapes replace the layer stack (project version 2)
- A background material fills the plane. Every other region is a shape with absolute coordinates, and list order decides overlap (later = on top). There are no anchors any more: thickening a BOX no longer moves the core, and snapping to other shapes' edges handles re-alignment.
- **Full-width rectangles** model substrates, BOX layers and films. They span the whole plane horizontally (the window never sees an artificial side edge), only move vertically, and have top/bottom handles only. They are ignored when auto-sizing the solve window (otherwise a deep substrate would inflate it). Templates make substrates 50 µm deep (semi-infinite in practice). "+ Layer" adds one on top of the existing layers, listed below finite shapes.
- **Pop-up editor**: clicking a shape on the canvas or in the list opens its editor beside it (it replaces the side Properties panel). A press that moves less than 3 px is a click, not a drag. Escape closes the editor, a second Escape deselects, and clicking empty canvas closes it.
- **Version-1 links migrate automatically**: cladding → background; substrate → a 100 µm-deep full-width rectangle; layers → full-width rectangles; anchored shapes → absolute y.
- The mock's "core" is now the highest-index finite shape (plus neighbours within 250 nm).
Supersedes the 2026-10-05 "features are anchored to layer surfaces" and 2026-10-10 "one structure list (option A)" entries.

## 2026-10-10 — Maintainer: fixed simulation window by default; settings in a left-panel Simulation section
- `settings.window` is either a fixed box or 'auto'. Templates open with a fixed window fitted to their structure, so resizing or moving the core no longer rescales the window (or the mesh, which follows the window). This keeps results comparable between edits.
- The left-panel "Simulation" section has an **auto-size to structure** tick box. When ticked it shows padding; when unticked it shows width, height, centre x/y and a one-off "Fit to structure". It also holds the mode count, and a collapsed "Solver and mesh" part (solver, mesh step, boundary, n guess) that replaces the right panel's Advanced section.
- The boundary warning's fix enlarges a fixed window by 50% about its centre (or raises the padding when auto).
- Links without `settings.window` (older v2 links) load as auto-sized, matching how they behaved when made. No version bump is needed: the field is optional.

## 2026-10-10 — Maintainer: benchmark against open-source solvers; prefer speed over absolute accuracy
- **References:** femwell 0.1.12 (finite elements, GPL-3) and Tidy3D 2.12.0's local mode solver (finite differences, LGPL), run by `benchmarks/run_reference.py` in a separate `.venv-bench` (gitignored). They are dev tools only: nothing from them is imported by the app or solver, and only their output numbers are stored (`solver_py/tests/reference/*.json`, with versions, settings and date). Our MIT licence is unaffected.
- **femwell is the primary reference for isotropic cases.** Its mesh follows shape edges and two mesh levels agree to < 1e-4. Tidy3D's local solver has no subpixel smoothing (that needs their cloud or `tidy3d-extras`, which declares no licence, so it isn't used); on the SOI strip it is biased by about +0.014 at 10 nm cells, so its extrapolated values carry their own uncertainty, which the tests honour. femwell cannot do anisotropic materials, so the LN ridge relies on Tidy3D plus an analytic anisotropic-slab test and an isotropic ridge of the same shape checked by femwell.
- These generated references sit alongside, not instead of, the maintainer's Lumerical/Tidy3D values requested in CLAUDE.md.

## 2026-10-10 — Solver formulation
Full-vector operator in (Ex, Ey) derived directly from Maxwell's equations on the Yee grid (derivation in `solver_py/modesolver/fd.py`), with E_z eliminated through the discrete divergence condition. Diagonal anisotropy. Semi-vector = one diagonal block; scalar = Helmholtz. Verified against: analytic slab TE/TM, analytic uniaxial slab (three optic-axis orientations), exact fibre LP01 (n_eff to ~5e-6, mode size < 1%), femwell and Tidy3D. References confirmed via Crossref: Zhu & Brown, Opt. Express 10, 853 (2002), doi:10.1364/OE.10.000853; Fallahkhair, Li & Murphy, J. Lightwave Technol. 26, 1423 (2008), doi:10.1109/JLT.2008.923643. No philsol code was used.

## 2026-10-10 — Non-uniform mesh snapped to shape edges, sized by decay length
A uniform mesh needed 10–15 nm cells (7–22 s per solve) to reach 1e-3 on the SOI strip. The solver mesh is now graded: lines sit on shape edges; each shape gets cells of L/5, where L = λ/(2π·NA) is the shortest field decay length it can support (NA² = n_shape² − n_lowest²), kept uniform for 1.5 L beyond the shape, then growing 30% per cell up to λ/(5·n_background). At least 6 cells span a shape's smallest dimension. This one rule scales from silicon wires (L ≈ 78 nm) to fibres (L ≈ 2 µm). Fields are resampled to a uniform ≤128-cell display grid for the UI and for mode-size metrics.
**Why not index-following cell sizes alone:** TE modes need fine cells in the cladding just outside the core (steep evanescent tail), not only inside it. Measured in the sweep.

## 2026-10-10 — Two-mesh Richardson extrapolation of n_eff (default)
The discretisation error is cleanly second order in cell size (measured). Each solve also runs a mesh with 1.4× larger cells; modes are matched by field overlap and n_eff is extrapolated. This costs roughly half as much again and cuts the n_eff error several-fold (SOI strip TM0: +5.9e-3 → +9e-4). Fields and mode sizes come from the finer mesh. `neffRaw` keeps the un-extrapolated value.

## 2026-10-10 — LU ordering reversed from the M0 decision: SuperLU default (COLAMD), real arithmetic
On the real operator, MMD_AT_PLUS_A factorises in 1.2–1.6 s against ~190 ms for COLAMD (100×100 full-vector), the opposite of what the M0 stand-in matrix showed. Lossless structures build a real matrix (about 2× faster than complex). Supersedes the 2026-10-04 "MMD_AT_PLUS_A" entry.

## 2026-10-10 — Mode size definition
`mfd` = full width of |E|² at 1/e² of its peak, along the row and column through the peak (outermost crossings), as a camera line-cut would give. The second-moment (D4σ) widths are also returned (`mfdD4s`). The maintainer was offered the choice and didn't state a preference; this is the default I proposed.

## 2026-10-10 — "Guided" for the real solver
A mode with more than 10% of its |E|² in the outer 5% band of the window is flagged not guided: it lives against the walls (window/slab/substrate-slice modes). The auto-sized window stops at the surface of a separated higher-index layer (e.g. substrate under the BOX) so templates don't pick up substrate-slice modes; with a hand-set window that includes one, the UI warns.

## 2026-10-10 — Boundaries: metal walls only for now
Fields are zero outside the window. The PMC option was removed from the UI until it is implemented; PML remains future work (lossy results are flagged approximate).

## 2026-10-10 — Mesh setting is a quality preset
Fast / Standard / Fine scale all target cell sizes by 1.4 / 1.0 / 0.7. The old uniform `meshStep` field is kept in the schema for the mock solver and old links but is no longer shown.

## 2026-10-10 — Mistake recorded: benchmark venv was committed, then removed
`.venv-bench` (19k files) was swept into a commit by `git add -A`. It was caught before any push; the commit was amended, the directory gitignored, and the objects pruned. Staging is now done with explicit paths.

## 2026-10-10 — About page
A second top-bar tab ("Solver | About") shows a single minimalist page: what the tool does, how the solver works, what each output means, accuracy and run-time benchmarks, limits, and references. Benchmark numbers are copied from `docs/benchmarks-m2.md` (update both together); the material references are generated from the data files. Solver controls are hidden on the About page. The page is UI state, not part of the shareable project link. Citation details were checked against Crossref; Zhu & Brown is cited by first page only because Crossref lists no end page.

## 2026-10-10 — Maintainer: optional field profiles on the canvas
A "Profiles" tick box in the canvas display options (off by default) draws two strips aligned with the structure: along the bottom, the displayed quantity integrated over y against x; along the left, integrated over x against y (solid, filled). Each also shows the cut through the peak (dashed), which is what the MFD values are measured on. The quantity follows the field selector: |E|², or the squared magnitude of the chosen component. Both curves are normalised to their own maximum. With profiles on, the view fits the window into the area left free by the strips. The setting is UI state, not part of the shareable link.

## 2026-10-11 — Maintainer: profiles on by default with rulers and beam-diameter marks; 1/e² contour off by default
- Profile strips are shown by default; the 1/e² contour is off by default. Both remain tick boxes in the display options.
- Each strip has a ruler: ticks at round values about every 80 px, labelled in the user's length unit.
- The 1/e² width of the cut through the peak is marked on each ruler as a coloured span with its value. In the |E|² view this is the MFD of the results table, and is labelled "MFD"; for a single field component it is labelled "1/e² width". Values follow the MFD precision rule (0.01 µm).
- The display-options box moves to the right of the left strip while profiles are shown. The scale bar stays.
