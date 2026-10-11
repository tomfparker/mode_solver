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
- Background material + simple shapes (rectangle, trapezoid, circle, polygon; rectangles can span the full width as layers). Graded index two ways: an index gradient across any shape (exponential, Gaussian, erfc or linear from a chosen edge), and a free-standing 2D Gaussian/erf-stripe profile for diffused or laser-written guides.
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
- **Solves run on demand and are cancellable.** The Run button (Ctrl+Enter) solves the current project; edits mark the shown result "out of date" (dimmed) rather than re-solving. A newly loaded project (first load, template, shared link) solves by itself.

Suggested layout (adjust if there's good reason, and update this file):
```
src/
  app/            # layout, routing, top-level state
  components/     # panels: StructurePanel, Canvas, ResultsPanel, CouplingPath
  geometry/       # Project types (background + ordered shapes), templates, rasterisation + subpixel averaging
  materials/      # material DB loader, Sellmeier evaluation
  solver/         # Solver interface, worker client, mock solver
  coupling/       # fibre presets, lens path model (TS side: types + presentation)
  state/          # store (zustand, undo), URL encode/decode, units, display formatting
  analysis/       # warnings and mode labels derived from (project, result)
solver_py/
  modesolver/     # materials, mesh, rasteriser, FD operators + eigensolve (fd.py), api.py, ui.py (worker bridge)
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
- Eigensolve with shift-invert Arnoldi (explicit SuperLU factorisation with the default COLAMD ordering + `scipy.sparse.linalg.eigs` on the inverse; sigma = (k₀·n_guess)²; real arithmetic when all materials are lossless). Default n_guess = max index in the domain. Reuse the previous eigenvalue as the shift in sweeps, and track modes across sweep steps by overlap.
- Subpixel (anisotropic) index averaging at interfaces is required, not optional. Staircasing is the main accuracy risk for drawn shapes.
- **The mesh is non-uniform** (`solver_py/modesolver/mesh.py`): lines snap to shape edges; cells are sized from each shape's shortest decay length L = λ/(2π·NA), stay uniform for a margin around it, then grow outwards. This is the main speed/accuracy lever: prefer tuning it over refining uniformly. The mesh quality preset (fast / standard / fine) scales all cell sizes.
- **n_eff is Richardson-extrapolated from two meshes** by default (the error is second order in cell size). Fields and mode sizes come from the finer mesh.
- **Speed is preferred over absolute accuracy** (maintainer, 2026-10-10): choose the fastest settings that keep n_eff within ~1e-3 and mode size within ~10% of the references, and justify defaults with `benchmarks/sweep.py`.
- Fields are resampled to a uniform display grid (≤128 cells) for the UI; mode-size metrics are computed there. Native-mesh fields stay in Python for coupling calculations.
- Boundaries: PEC/PMC by default, PML later (for leaky modes and complex indices). Complex indices must not crash; flag them as "lossy, approximate" until PML exists.
- The simulation window is **fixed by default** (templates fit it once to their structure; editing shapes doesn't move it). It is set in the left-panel Simulation section, with an "auto-size to structure" option (structure + padding, recomputed on every edit) and a one-off "Fit to structure". Warn in plain language if the mode amplitude at the boundary exceeds a threshold.

## UI principles (the UI is the priority — get these right)

1. **Numbers are the source of truth; drawing is an input method.** Every object is a list entry with editable numeric parameters. Canvas drag handles and numeric fields edit the same object. Snapping, plus nm-level entry.
2. **Background + shapes, one ordered list.** A background material fills the plane; everything else (substrate, BOX, films, cores) is a shape. Rectangles can be "full width" (span the whole plane horizontally): that is how layers are made. List order decides what is on top. Click a shape (canvas or list) to open its pop-up editor (coordinates, size, material); drag shapes and handles with the mouse. The solve window is sized from finite shapes only. *(Replaced the layer-stack model at the maintainer's request, 2026-10-10.)*
3. **Run button, results never blocked.** A prominent Run button (Ctrl+Enter); after an edit the previous result stays visible, dimmed and marked out of date. Newly loaded projects solve automatically. Show the field overlaid on geometry outlines in the main canvas (|E|², Ex, Ey, Ez, Hx… toggle; 1/e² contour). *(Changed from live solving at the maintainer's request, 2026-10-10.)*
4. **Never a blank canvas.** Open on a working example (SiN strip at 1550 nm). Templates: strip, rib, slot, step-index fibre, diffused channel, LN ridge.
5. **One screen, three zones:** structure (left) | canvas (centre) | results + mode thumbnails + warnings (right). The coupling path strip sits below the results.
6. **Wavelength is a global, prominent control.**
7. **True aspect ratio**, auto-fit view, zoom, scale bar always visible.
8. **Plain-language inline warnings**, e.g. "mode reaches boundary — enlarge window", "multimode at this λ", "large mode mismatch — consider a taper or lensed fibre (optimal waist: …)".
9. **Progressive disclosure:** the left-panel Simulation section shows the window and mode count; mesh, boundary conditions, solver type and n guess sit in its collapsed "Solver and mesh" part with good auto defaults.
10. **Loss waterfall** for coupling: mode shape / magnification / NA clipping / Fresnel / total, each in dB and %.
11. Desktop-first. It should not break on a tablet; phones are not a target.
12. **Look: soft, with brutalist bones.** Monospace body, clear rules and blocky layout, but a gentle finish: off-white surfaces, grey ink, hairline translucent borders, 7 px radius, frosted translucent overlays, soft shadows, sentence-case labels, and the artwork's muted blue for filled controls. Accent colours come from the project artwork in `src/assets`. Tokens live in `src/app/app.css` (the last `:root` block wins); change tokens before adding one-off colours.
13. **Loading screen.** A translucent veil with the rotating disc (`src/assets/disc.webp`) covers the page while the solver loads, until the first result is shown. The same screen, with Cancel, covers any solve that has run for 5 s, or starts immediately if the previous solve took that long. The solver stays visible behind it.
14. **Colour is the user's to set.** Each material has a display colour (soft defaults in `src/materials/colors.ts`; overrides are stored in `Project.materialColors` and travel with the share link; the colour belongs to the material, not the shape). The |E|² colour scheme is a display preference chosen from `COLORMAPS` in `fieldImage.ts` (default Sunset) and remembered locally. Single field components always use blue (−) / red (+).

## Data provenance — strict

- Every material Sellmeier entry, fibre preset (MFD, core, NA, wavelength) and lens preset **must include its source** (paper DOI, refractiveindex.info page, or manufacturer datasheet URL) in the data file.
- **Never invent or recall numeric values from memory.** If a value can't be sourced, leave a clearly marked `TODO: needs source` and surface it to the user.

## Testing and validation

- Every physics function gets a pytest test. Benchmarks:
  - Analytic slab waveguide (TE/TM) n_eff.
  - Step-index fibre LP01 (Bessel solution) n_eff and MFD.
  - Overlap of a Gaussian with itself = 1; Gaussian–Gaussian analytic overlap, including offset and waist mismatch.
  - Convergence test: n_eff vs grid resolution approaches a limit.
  - Reference cases (SOI strip, SiN strip, SOI rib, isotropic ridge, LNOI ridge) against values in `solver_py/tests/reference/`. These are generated by running open-source solvers (femwell, Tidy3D) with `benchmarks/run_reference.py`, and each file records solver versions, settings and date. Never type reference values by hand. Any change to the solver or mesh defaults must keep `test_reference.py` passing. Values the maintainer supplies from Lumerical go in the same folder with their provenance.
  - Analytic uniaxial slab (TE/TM, each optic-axis orientation) for the anisotropy implementation.
  - Anything evaluated in both TypeScript and Python (material dispersion, index-gradient profiles) has a shared check file in `solver_py/tests/reference/` generated by a script; both test suites must reproduce it.
- Frontend: unit tests for geometry rasterisation, URL round-trip, and unit conversion. A Playwright smoke test that the default example solves in the browser.
- **Performance budgets** (measure, don't assume): ~100×100 grid solve < 300 ms in-browser on a typical laptop; first meaningful paint < 2 s; show solver-loading progress while Pyodide initialises.

## Working conventions

- Run tests before declaring a task done. A physics change without a test is not done.
- Keep the `Solver` interface stable. If it must change, update the mock solver and the worker together.
- Prefer small, reviewable commits per milestone step.
- When a design decision isn't covered here, make a reasonable call, note it in `DECISIONS.md` (date, decision, why), and continue. Ask the maintainer only for decisions that are hard to reverse.
- Update this file when architecture or conventions change.

## Commands

Node 22 (Vite 8 needs >= 20.19; `.nvmrc` pins it) is installed via nvm in `~/.config/nvm`.
The system also has apt Node 18, which fails with a `styleText` error. Run `nvm use` if `node -v` shows 18.
In non-interactive shells nvm is not loaded; use
`export PATH="$HOME/.config/nvm/versions/node/v22.23.3/bin:$PATH"`. Python uses a repo-local
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
.venv/bin/python scripts/ui_check.py          # scripted UI check in headless Firefox (needs `npx vite preview --port 4173`)
.venv/bin/python scripts/import_materials.py  # regenerate data/materials/*.json from the refractiveindex.info YAML
.venv/bin/python scripts/make_material_check.py  # regenerate the Python↔TypeScript material cross-check file
.venv/bin/python scripts/make_gradient_check.py  # regenerate the Python↔TypeScript index-gradient cross-check file
.venv/bin/python benchmarks/sweep.py [--md]   # our solver's accuracy vs speed on the reference cases
.venv-bench/bin/python benchmarks/run_reference.py [case …]  # re-run femwell/Tidy3D references (slow; separate venv:
                                                             #   python3 -m venv .venv-bench && .venv-bench/bin/pip install tidy3d femwell)
```
The app uses the real solver by default; add `?solver=mock` to the URL for the instant mock (UI work, demos).
