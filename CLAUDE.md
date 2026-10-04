# CLAUDE.md — Browser Waveguide Mode Solver

## What this is

A browser-based waveguide mode solver for optics and photonics lab researchers. Think "spdcalc for waveguide modes": open a URL, pick or sketch a cross-section, and within seconds get mode shape, mode size, effective index, and how well it couples to a fibre (directly or through lenses).

Inspired by:
- **philsol** (PyPI) — full-vector finite-difference mode solver on a Yee grid.
- **spdcalc** — zero-install, instant, shareable browser tool for researchers.

**The gap this fills is usability, not methods.** Lumerical, Tidy3D, femwell, MPB etc. already solve this problem. Our value is: zero install, live results as you edit, lab-relevant outputs, shareable links. When in doubt, favour immediacy and clarity over numerical sophistication.

## Users and the questions they ask

Lab researchers (integrated photonics, nonlinear/quantum optics, fibre labs), not tape-out designers. Typical questions:
- "What's the mode size of my LN ridge at 780 nm?"
- "Is this waveguide single-mode at 1550?"
- "How much light will I get into SMF-28 if I butt-couple?"
- "Which aspheric lens pair should I grab from the drawer to couple this into 780HP?"

## Scope

**In scope**
- 2D cross-section eigenmode solving (scalar / semi-vector / full-vector FD), diagonal anisotropic permittivity.
- Layer stacks + simple shapes (rectangle, trapezoid, circle, polygon) + graded-index (Gaussian/erf) profiles for diffused/laser-written guides.
- Material library with Sellmeier dispersion.
- Outputs: n_eff, n_g, MFD (1/e² intensity, x and y), A_eff, polarisation fraction, mode count / cut-off, far field and NA.
- Fibre mode overlap (butt coupling), misalignment tolerance, optimal Gaussian waist.
- Ideal-lens coupling (single-lens finite conjugate; two-lens collimate+focus) with loss breakdown.
- Wavelength and geometry sweeps (dispersion, taper tip width vs coupling).
- Shareable URL state; PNG/CSV export.

**Out of scope (say so in the UI rather than half-implementing)**
- 3D propagation (EME/FDTD/BPM), bends (possible later via conformal transform), real lens prescriptions/aberration ray-tracing (that's Zemax/Code V), design-grade accuracy claims.
- Any backend server. The app is static and runs entirely client-side.

## Accuracy targets

"Quick estimate" grade:
- n_eff within ~1e-3 of a converged reference for standard SOI/SiN/LNOI strips and step-index fibre.
- Mode size within ~10%.
- Coupling efficiency labelled as an ideal-optics upper bound where appropriate.

Never present more significant figures than the accuracy supports (default: n_eff to 4 d.p., MFD to 0.01 µm, CE to 0.1 dB / 1%).

## Architecture

- **Frontend:** TypeScript + React + Vite. Static build, deployable to GitHub Pages or similar.
- **Solver:** Python (numpy/scipy) running in **Pyodide inside a Web Worker**, behind a typed `Solver` interface (`src/solver/types.ts`). UI code never imports Pyodide directly. The interface must stay swappable for a future Rust→WASM backend.
- **Python numerics live in `solver_py/` as a normal package**, so the same code is testable natively with pytest and loaded into Pyodide at runtime.
- **State:** a single serialisable `Project` object (geometry, materials, wavelength, coupling path, settings). The URL hash encodes it (compressed). Results are derived and never stored in project state.
- **Solves are debounced and cancellable.** The latest edit wins; stale results are shown dimmed rather than blocking the UI.

Suggested layout (adjust if there's good reason, and update this file):
```
src/
  app/            # layout, routing, top-level state
  components/     # panels: StructurePanel, Canvas, ResultsPanel, CouplingPath
  geometry/       # Project types, shapes, layer stack, rasterisation + subpixel averaging
  materials/      # material DB loader, Sellmeier evaluation
  solver/         # Solver interface, worker client, mock solver
  coupling/       # fibre presets, lens path model (TS side: types + presentation)
  state/          # URL encode/decode, undo
solver_py/
  modesolver/     # FD operators, eigensolve, mode post-processing
  coupling/       # fibre modes (Gaussian, LP01), overlaps, far field, lens model
  tests/          # pytest: analytic + reference benchmarks
data/
  materials/      # Sellmeier coefficients, one file per material, WITH source citation
  fibres/         # fibre presets, WITH datasheet source
  lenses/         # optional lens presets (f, NA, wavelength range), WITH source
```

## Physics conventions (keep consistent everywhere)

- Coordinates: x horizontal, y vertical (growth direction), z propagation. Fields ∝ exp(i(βz − ωt)).
- Internal length unit: **µm**. UI accepts nm or µm and labels units everywhere.
- Wavelength is vacuum wavelength.
- Mode normalisation: unit power, Re∫(E×H*)·ẑ dA / 2 = 1.
- **Coupling overlap (vector, default):**
  η = |∫(E₁×H₂*)·ẑ dA|² / ( Re∫(E₁×H₁*)·ẑ dA · Re∫(E₂×H₂*)·ẑ dA )
  Fibre/Gaussian H from the paraxial relation H = (n/η₀) ẑ × E. The scalar overlap is allowed only for explicitly weakly-guiding cases and must be labelled.
- Report Fresnel facet loss **separately** from mode-mismatch loss.
- Lens coupling: ideal lens maps E(x,y) → E(x/M, y/M). Optimise M and axial focus. NA clipping comes from the angular spectrum (FFT of the near field). Results are labelled "ideal lens bound".
- Misalignment maps are computed by FFT cross-correlation, not repeated overlaps.
- Fibre-mode overlaps happen on a separate, zero-padded interpolation grid large enough for the fibre mode. Never enlarge the solve domain just for this.

## Solver notes

- Base the full-vector solver on a published Yee-grid FD formulation (philsol follows Zhu & Brown, Opt. Express 2002; Fallahkhair et al., JLT 2008 covers anisotropy — verify these references before relying on them). Support diagonal anisotropic ε from day one.
- **Licensing:** check philsol's licence before copying any code. If it's incompatible or unclear, implement from the papers.
- Eigensolve with shift-invert Arnoldi (`scipy.sparse.linalg.eigs`, sigma = (k₀·n_guess)²). Default n_guess = max index in the domain. Reuse the previous eigenvalue as the shift in sweeps, and track modes across sweep steps by overlap.
- Subpixel (anisotropic) index averaging at interfaces is required, not optional. Staircasing is the main accuracy risk for drawn shapes.
- Non-uniform mesh is a later improvement. Design the operator construction so it isn't precluded.
- Boundaries: PEC/PMC by default, PML later (for leaky modes and complex indices). Complex indices must not crash; flag them as "lossy, approximate" until PML exists.
- Auto-size the domain from the structure plus the expected mode extent. Warn in plain language if the mode amplitude at the boundary exceeds a threshold.

## UI principles (the UI is the priority — get these right)

1. **Numbers are the source of truth; drawing is an input method.** Every object is a list entry with editable numeric parameters. Canvas drag handles and numeric fields edit the same object. Snapping, plus nm-level entry.
2. **Layer stack first, shapes second.** Infinite slabs (substrate, BOX, film, cladding) plus a few features. Most structures need no drawing at all.
3. **Live results, no Run button.** Debounced re-solve on edit. Show the field overlaid on geometry outlines in the main canvas (|E|², Ex, Ey, Ez, Hx… toggle; 1/e² contour).
4. **Never a blank canvas.** Open on a working example (SiN strip at 1550 nm). Templates: strip, rib, slot, step-index fibre, diffused channel, LN ridge.
5. **One screen, three zones:** structure (left) | canvas (centre) | results + mode thumbnails + warnings (right). The coupling path strip sits below the results.
6. **Wavelength is a global, prominent control.**
7. **True aspect ratio**, auto-fit view, zoom, scale bar always visible.
8. **Plain-language inline warnings**, e.g. "mode reaches boundary — enlarge window", "multimode at this λ", "large mode mismatch — consider a taper or lensed fibre (optimal waist: …)".
9. **Progressive disclosure:** mesh, domain, boundary conditions and solver type live under "Advanced" with good auto defaults.
10. **Loss waterfall** for coupling: mode shape / magnification / NA clipping / Fresnel / total, each in dB and %.
11. Desktop-first. It should not break on a tablet; phones are not a target.

## Data provenance — strict

- Every material Sellmeier entry, fibre preset (MFD, core, NA, wavelength) and lens preset **must include its source** (paper DOI, refractiveindex.info page, or manufacturer datasheet URL) in the data file.
- **Never invent or recall numeric values from memory.** If a value can't be sourced, leave a clearly marked `TODO: needs source` and surface it to the user.

## Testing and validation

- Every physics function gets a pytest test. Benchmarks:
  - Analytic slab waveguide (TE/TM) n_eff.
  - Step-index fibre LP01 (Bessel solution) n_eff and MFD.
  - Overlap of a Gaussian with itself = 1; Gaussian–Gaussian analytic overlap, including offset and waist mismatch.
  - Convergence test: n_eff vs grid resolution approaches a limit.
  - Reference cases (SOI 500×220 nm, SiN strip, LNOI ridge) against values in `solver_py/tests/reference/`. These are supplied by the maintainer from Lumerical/Tidy3D — don't fabricate them.
- Frontend: unit tests for geometry rasterisation, URL round-trip, and unit conversion. A Playwright smoke test that the default example solves in the browser.
- **Performance budgets** (measure, don't assume): ~100×100 grid solve < 300 ms in-browser on a typical laptop; first meaningful paint < 2 s; show solver-loading progress while Pyodide initialises.

## Working conventions

- Run tests before declaring a task done. A physics change without a test is not done.
- Keep the `Solver` interface stable. If it must change, update the mock solver and the worker together.
- Prefer small, reviewable commits per milestone step.
- When a design decision isn't covered here, make a reasonable call, note it in `DECISIONS.md` (date, decision, why), and continue. Ask the maintainer only for decisions that are hard to reverse.
- Update this file when architecture or conventions change.

## Commands

Node 22 is installed via nvm in `~/.config/nvm` (not on PATH in non-login shells: use
`export PATH="$HOME/.config/nvm/versions/node/v22.23.3/bin:$PATH"`). Python uses a repo-local
`.venv` (numpy/scipy pinned to the versions Pyodide ships).
```
npm install
npm run dev          # local dev server (spike page at /spike.html)
npm run build        # static build (relative base, GitHub Pages friendly)
npm test             # frontend unit tests (Vitest)
npm run lint         # oxlint
npm run e2e          # Playwright smoke tests (config arrives in M6)
npm run spike:node   # M0 eigensolve timing in Pyodide under Node
.venv/bin/pytest solver_py   # numerics tests (native Python)
```
