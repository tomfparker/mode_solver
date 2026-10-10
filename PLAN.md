# PLAN.md — Browser Waveguide Mode Solver

CLAUDE.md is authoritative. This file breaks the milestones into tasks, lists risks, and records open questions. M0 and M1 are detailed. M2–M6 are outlined and will be refined at the start of each milestone.

Status: **M2 complete, awaiting review** (2026-10-10). M0 and M1 reviewed. See docs/benchmarks-m2.md for solver accuracy and speed.

---

## 1. Milestones and tasks

### M0 — Feasibility spike + scaffold

**Goal:** prove Pyodide + scipy shift-invert is fast enough in a worker, and lock the `Solver` interface so M1 can proceed on a mock.

| # | Task | Done when |
|---|------|-----------|
| 0.1 | Toolchain: Node LTS (see Q1), Python `.venv` in repo with numpy/scipy/pytest (pinned to the versions Pyodide ships, so native and browser numerics match) | `npm -v`, `pytest --version` work |
| 0.2 | Vite + React + TS scaffold matching CLAUDE.md layout; oxlint; Vitest; `npm run dev/build/test` | Empty app builds; CI-style `npm test` passes |
| 0.3 | `solver_py/` package skeleton (`modesolver/`, `coupling/`, `tests/`), `pyproject.toml`, a trivial pytest | `pytest solver_py` green |
| 0.4 | Worker client: `src/solver/worker.ts` loads Pyodide (pinned version) + numpy + scipy, reports load progress (`loading-runtime` → `loading-packages` → `ready`), mounts `solver_py` into the Pyodide FS | Progress events visible in a dev page |
| 0.5 | **Spike:** in Python, build a 5-point scalar Helmholtz operator for a rectangular core on N×N (N = 100, 200), and a full-vector-sized (2N² unknowns) operator of similar sparsity. Solve with `eigs(A, k=4, sigma=(k0·n_max)², which='LM')`. Time separately: operator build, `splu` factorisation, Arnoldi iterations, data transfer back to JS | Timing table in `docs/spike-m0.md`: Pyodide (Node/V8) and native done; real Chrome + Firefox pending a manual run |
| 0.6 | Fallback check if `eigs`/ARPACK misbehaves in Pyodide: `splu` + a simple shift-invert Arnoldi in numpy, or `LinearOperator` + `eigs` | Either works, or the spike report says it doesn't |
| 0.7 | Define `src/solver/types.ts` (sketch in §2): `Solver`, `SolveRequest`, `SolveResult`, `ModeResult`, `SolverStatus`, cancellation contract | Reviewed by you at the M0 stop |
| 0.8 | `MockSolver` implementing `Solver`: Hermite–Gaussian fields sized from the core bounding box, sorted fake n_eff, artificial latency, honours cancellation. Every result is flagged `isMock: true` | Unit tests: shape of arrays, normalisation, cancellation |
| 0.9 | Write the Commands section in CLAUDE.md; DECISIONS.md entries | — |

**M0 stop:** spike numbers vs the 300 ms budget, and a go/no-go on Pyodide with a fallback plan if it's slow.

### M1 — UI shell on the mock solver (priority)

**Goal:** something real users can sit in front of. It opens on the SiN strip at 1550 nm, every edit updates the results live, and the URL reproduces the state.

**1A. Project model and state**
- 1.1 `Project` type + zod schema with a version field (sketch in §2). Layer stack (bottom→top: semi-infinite substrate, finite layers, semi-infinite cladding), features (rect, trapezoid with sidewall angle, circle, polygon, graded-index Gaussian/erf), global λ, settings (advanced), coupling-path placeholder.
- 1.2 Store (zustand) with undo/redo (patch history, coalescing continuous drags into one undo step).
- 1.3 Units: one parser/formatter (`"450 nm"`, `"0.45 µm"`, `"0.45um"`, bare number = field's display unit); internal µm. Display precision rules from CLAUDE.md (n_eff 4 d.p., MFD 0.01 µm, CE 0.1 dB / 1%) in one formatting module.
- 1.4 URL state: JSON → lz-string compressed hash `#p=…`, with a version field and migrations; invalid or old links fall back to the default example plus a notice. Round-trip tests.

**1B. Layout**
- 1.5 Three-zone layout: Structure (left) | Canvas (centre) | Results + thumbnails + warnings (right); coupling-path strip placeholder below Results ("coming in M3/M4"). Resizable panes; minimum widths so tablets don't break.
- 1.6 Top bar: project name, **prominent global wavelength control** (numeric + unit + common-line presets such as 780/1064/1310/1550 nm), template picker, share-link button, undo/redo, solver status chip (loading progress / solving / stale / mock).

**1C. Structure panel**
- 1.7 Layer stack list: add/remove/reorder, material picker, thickness, with substrate and cladding pinned.
- 1.8 Feature list: add shape, select, duplicate, delete; properties panel with numeric fields (nm-level entry, units, arrow-key nudge, shift for ×10).
- 1.9 Templates: strip, rib, slot, step-index fibre, diffused channel, LN ridge (plus SiN strip as the default). Geometry only; material data comes from the material library (see Q3).

**1D. Canvas**
- 1.10 Rendering: SVG for outlines and handles, an underlying `<canvas>` for the field heatmap (ImageData), true aspect ratio, auto-fit, wheel/pinch zoom, pan, always-visible scale bar, axis ticks in µm.
- 1.11 Handles: select a shape, drag body or edge/vertex handles, snapping (grid + other edges + layer interfaces), with Shift to disable snapping. They edit the same store objects as the numeric fields, so the two stay in sync both ways.
- 1.12 Field overlay: |E|², Ex, Ey, Ez, Hx, Hy, Hz toggle; perceptual colormap for intensity, diverging colormap for signed components; opacity slider; 1/e² intensity contour (marching squares via d3-contour); colourbar.
- 1.13 Stale results drawn dimmed with "updating…", never blocking interaction.

**1E. Results panel**
- 1.14 Mode table: n_eff, n_g (shown as "—" until M5 or a 2-point λ solve), MFD x/y, A_eff, TE/TM fraction, with units and correct precision.
- 1.15 Mode thumbnails (click to select the mode shown on the canvas), labelled TE0/TM0/… by dominant polarisation.
- 1.16 Inline plain-language warnings. These are driven by a warnings module that takes (project, result) and returns messages; in M1 the mock triggers them: mode at boundary, multimode at this λ, lossy material, out-of-range λ for material data, and missing data source.
- 1.17 Advanced section (collapsed): solver type (scalar / semi-vector / full-vector), mesh step, domain padding, boundary conditions, number of modes, n_guess, all with auto defaults and an "auto" reset.
- 1.18 Out-of-scope notes in the UI (bends, 3D propagation, design-grade accuracy), plus a persistent "Mock solver — results are not physical" banner while the mock is active.

**1F. Live solve loop**
- 1.19 Debounced (≈150 ms) solve on edit, latest edit wins, cancellable through the `Solver` interface; results keyed by a project hash so stale results are detectable.

**1G. Tests and feel**
- 1.20 Vitest: unit parser, URL round-trip, schema migration, store undo, warnings rules, rasterisation-independent geometry helpers (bounding boxes, hit-testing).
- 1.21 Manual checklist for you (in the M1 summary): keyboard flow, drag/numeric sync, share-link reproduction across browsers, tablet width.

**M1 stop:** a list of what to put in front of users and what to watch for.

### M2 — Real solver (outline)
- Verify the FD references (Zhu & Brown; Fallahkhair et al.) and write a `docs/numerics.md` derivation before coding.
- Rasteriser in Python, with a TS mirror only for canvas previews: per-cell ε tensor with anisotropic subpixel averaging (normal/tangential split of ε vs ε⁻¹ averaging at interfaces).
- Operators: scalar (5-point), semi-vector (TE/TM-like), full-vector Yee (Ex, Ey) with diagonal ε. PEC/PMC boundaries. Operator construction takes per-axis spacing arrays so non-uniform meshes aren't ruled out later.
- Shift-invert eigensolve, mode reconstruction of all six components, unit-power normalisation, and post-processing (n_eff, MFD x/y at 1/e², A_eff, polarisation fraction, mode count/cut-off, boundary-amplitude metric for the warning).
- Complex ε doesn't crash and is flagged "lossy, approximate".
- Material library `data/materials/*.json`: Sellmeier coefficients, validity range, source DOI/URL for each, with the same evaluation in TS (for the UI) and Python (for the solver) and tests that they agree.
- pytest: analytic slab TE/TM, step-index LP01 (Bessel) n_eff + MFD, convergence, and reference placeholders in `solver_py/tests/reference/` (skipped until you fill them).
- Swap the mock for the worker solver behind the same interface; the mock stays available via `?solver=mock`.

### M3 — Fibre coupling (outline)
- `data/fibres/*.json` presets with datasheet URLs (no recalled values; `TODO: needs source` where needed). Gaussian-from-MFD and analytic LP01-from-core/NA.
- Vector E×H overlap on a zero-padded interpolation grid; Fresnel loss reported separately.
- Draggable fibre 1/e² overlay on the canvas; misalignment heatmap via FFT cross-correlation with 1 dB/3 dB contours; gap/defocus plot (Gaussian propagation of the fibre mode); optimal Gaussian waist (x, y).
- Tests: Gaussian self-overlap = 1, Gaussian–Gaussian analytic with offset and waist mismatch, FFT map matches direct overlaps at sample points.

### M4 — Lens coupling (outline)
- Coupling-path strip UI (waveguide → lens(es) → fibre), single-lens and two-lens configurations.
- Ideal-lens model: E(x,y) → E(x/M, y/M), optimise M and focus, NA clipping from the angular spectrum of the near field.
- Loss waterfall (mode shape / magnification / NA clipping / Fresnel / total, in dB and %), labelled "ideal lens bound". Report the optimal f₂/f₁.
- Optional `data/lenses/` presets, sourced only.

### M5 — Sweeps (outline)
- λ sweep (n_eff, n_g) and geometry sweep (any numeric parameter, e.g. taper tip width → CE).
- JS drives the loop one solve per step, which gives clean cancellation (see Risk R3); previous eigenvalue reused as the shift; modes tracked by overlap; progress + cancel in the UI; plots.

### M6 — Polish (outline)
- PNG export (canvas + plots), CSV export (mode table, sweep data, field arrays).
- Performance pass against budgets (100×100 < 300 ms, first meaningful paint < 2 s), with measurements written up.
- Playwright smoke test (default example solves in the browser); static deploy config for the chosen host (Q2).

---

## 2. Interface sketches (to be finalised in M0)

```ts
// src/solver/types.ts (sketch)
export type SolverKind = 'scalar' | 'semivector-te' | 'semivector-tm' | 'fullvector';

export interface SolveRequest {
  id: string;                 // latest-wins bookkeeping
  project: Project;           // serialisable; worker does rasterisation
  numModes: number;
  nGuess?: number;            // default: max index in domain
}

export interface FieldGrid {
  x: Float64Array; y: Float64Array;      // cell-centre coords, µm
  nx: number; ny: number;
}

export interface ModeResult {
  neff: number;               // complex → { re, im } once lossy is supported
  ng?: number;
  mfd: { x: number; y: number };         // 1/e² intensity diameter, µm
  aEff: number;               // µm²
  teFraction: number;         // 0..1
  fields: Partial<Record<'Ex'|'Ey'|'Ez'|'Hx'|'Hy'|'Hz', { re: Float32Array; im: Float32Array }>>;
  boundaryAmplitude: number;  // for the "mode reaches boundary" warning
}

export interface SolveResult {
  requestId: string;
  grid: FieldGrid;
  modes: ModeResult[];
  epsPreview?: Float32Array;  // rasterised index for overlay/debug
  diagnostics: { solverKind: SolverKind; timingsMs: Record<string, number>; warnings: string[] };
  isMock: boolean;
}

export type SolverStatus =
  | { state: 'loading'; stage: string; progress: number }
  | { state: 'ready' } | { state: 'error'; message: string };

export interface Solver {
  status(): SolverStatus;
  onStatus(cb: (s: SolverStatus) => void): () => void;
  solve(req: SolveRequest, signal?: AbortSignal): Promise<SolveResult>;
  dispose(): void;
}
```

Fields cross the worker boundary as transferable Float32Arrays (precision is ample for display and overlaps are done in Python).

```ts
// Project (sketch)
interface Project {
  version: 1;
  wavelength: number;                      // µm, vacuum
  stack: { substrate: MaterialRef; layers: { id; name; material: MaterialRef; thickness: number }[]; cladding: MaterialRef };
  features: Feature[];                     // rect | trapezoid | circle | polygon | graded
  settings: { solverKind: SolverKind | 'auto'; meshStep: number | 'auto'; padding: number | 'auto'; boundary: 'pec' | 'pmc' | 'auto'; numModes: number };
  coupling?: CouplingPath;                 // M3/M4
}
// Feature y-positions are referenced to a layer interface ("sits on top of BOX"),
// so changing a layer thickness moves the features on it.
```

---

## 3. Risks

| ID | Risk | Mitigation |
|----|------|-----------|
| R1 | **Full-vector solve misses the 300 ms budget in WASM.** 100×100 full-vector = 20k unknowns; `splu` fill-in dominates and Pyodide is single-threaded with no optimised BLAS. | M0 measures before we commit. Options if it's slow: live-preview with scalar/semi-vector then refine to full-vector; a coarser auto-mesh during drag; reuse the shift; later Rust→WASM behind the same interface. |
| R2 | ARPACK/`eigs` broken or slow in the current Pyodide scipy build. | M0 task 0.6 fallback (own shift-invert Arnoldi on `splu`). |
| R3 | **Cancellation.** A running Python call can't be interrupted from JS unless `SharedArrayBuffer` is available (needs cross-origin isolation, i.e. COOP/COEP headers). GitHub Pages can't set headers. Terminating the worker means reloading Pyodide (seconds). | Latest-wins: queued stale requests are dropped and results of superseded solves are discarded. Use `pyodide.setInterruptBuffer` when `crossOriginIsolated` is true. Sweeps are driven step-by-step from JS so cancel takes effect between steps. Hosting choice (Q2) decides whether hard interrupts are available. |
| R4 | Pyodide + numpy + scipy download (~tens of MB) hurts first visit; first meaningful paint < 2 s. | UI and mock-free geometry render immediately; the solver loads in parallel with visible progress; cache headers / service worker for repeat visits. "Meaningful paint" = the editable structure, not the first solve. |
| R5 | Subpixel averaging done wrong silently degrades accuracy by more than 1e-3. | Convergence tests, plus comparing a shape that's grid-aligned vs offset by half a cell (n_eff should barely move). |
| R6 | User testing on mock numbers (M1) could produce misleading feedback or get screenshotted as real. | Persistent mock banner + watermark on canvas; see Q3. |
| R7 | Material/fibre data provenance: easy to slip in a recalled number. | Every data file has a required `source` field; a loader test fails on any entry missing it; `TODO: needs source` entries are shown in the UI. |
| R8 | URL length with polygon features and coupling paths. | lz-string compression; round-numbers-to-nm before encoding; test a worst-case project stays under ~2k chars. |
| R9 | Interaction scope creep in the canvas (polygon editing, snapping) eats M1. | Polygon vertex editing is numeric-first; canvas supports move + vertex drag only. |

---

## 4. Open questions (answers needed before M0 code)

**Q1. Node.js is not installed on this machine** (and the system Python has no numpy/scipy). May I install Node 22 LTS user-level via `nvm` (no sudo, lives in `~/.nvm`)? Or would you rather install it yourself? For Python I plan a repo-local `.venv` (gitignored), which needs no system changes.

**Q2. Deployment host.** This decides whether hard cancellation of a running solve is possible (R3):
- *GitHub Pages*: no custom headers, so no `SharedArrayBuffer`. Cancellation is latest-wins and between steps only (a `coi-serviceworker` shim can work around it but is fragile).
- *Cloudflare Pages / Netlify / your own static server*: can set COOP/COEP, so solves can be interrupted mid-run.
My recommendation is Cloudflare Pages or Netlify if you have no constraint. Either way the code works on both; only the "interrupt mid-solve" behaviour differs.

**Q3. What should M1 users see as numbers?** Your user test happens on M1, before the real solver exists.
- (a) Mock as specified: fake n_eff/MFD, with a persistent "mock — not physical" banner. Fastest. Users judge flow, not numbers.
- (b) **Recommended:** (a) plus pulling the sourced material library (Sellmeier + citations) forward into M1, so the material picker shows real n(λ) and the "λ outside data range" warnings are real. The cost is small, and it's needed in M2 anyway.
- (c) Also pull a basic real scalar/semi-vector solver into M1 if the M0 spike is fast. Users then see roughly-right numbers, but M1 slips by an estimated few days and the full-vector path stays in M2.

**Q4. Project licence.** This is hard to reverse once the repo or site is public. Given philsol's licence is unclear (see DECISIONS.md), I'll implement from the papers regardless, so any licence is open to you. MIT, BSD-3, or GPL-3? If you have no preference, I'll use MIT.

Smaller items I'll decide myself and log unless you object: Pyodide loaded from the jsDelivr CDN pinned to 314.0.7, with a build flag to self-host for offline labs; zustand + zod + lz-string + d3-contour; plain CSS modules (no heavy component library); target desktop Chrome, Firefox and Safari. Also: there's an empty `ex.py` in the repo root. OK to delete it?
