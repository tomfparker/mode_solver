// About page: what the tool does, how the solver works, sources, and measured benchmarks.
// Benchmark numbers are copied from docs/benchmarks-m2.md (2026-10-10, standard mesh preset);
// update both together. The material list is generated from the data files.

import type { ReactNode } from 'react';
import { LIBRARY } from '../materials/library';
import type { Source } from '../materials/types';

/** Our n_eff minus the reference, for the two highest modes, and native solve time. */
const BENCHMARKS: { name: string; reference: string; d0: string; d1: string; ms: number }[] = [
  { name: 'SOI strip, 500 × 220 nm', reference: 'femwell', d0: '−6e-5', d1: '+7e-4', ms: 390 },
  { name: 'Si₃N₄ strip, 1200 × 800 nm', reference: 'femwell', d0: '+7e-5', d1: '−8e-5', ms: 380 },
  { name: 'SOI rib on a 90 nm slab', reference: 'femwell', d0: '+4e-4', d1: '+3e-4', ms: 350 },
  { name: 'Si₃N₄ ridge, 60° sidewalls', reference: 'femwell', d0: '−1e-4', d1: '−4e-4', ms: 390 },
  { name: 'LiNbO₃ ridge, X-cut (anisotropic)', reference: 'Tidy3D', d0: '−2e-4', d1: '+2e-4', ms: 470 },
];

function sourcesOf(): { material: string; source: Source }[] {
  const out: { material: string; source: Source }[] = [];
  for (const m of LIBRARY) {
    const list = m.kind === 'isotropic' ? [m.n.source] : [m.ordinary.source];
    for (const s of list) out.push({ material: m.name, source: s });
  }
  return out;
}

function Doi({ doi, children }: { doi: string; children: ReactNode }) {
  return (
    <a href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export function AboutPage() {
  return (
    <main className="about">
      <article>
        <h1>About</h1>
        <p className="lead">
          A waveguide mode solver that runs in your browser. Describe a cross-section, press Run, and get the guided modes: effective
          index, mode size and field maps. Nothing is installed and nothing is sent to a server; the link in the address bar
          reproduces your structure exactly.
        </p>
        <p>
          It is built for quick lab estimates, not for design sign-off. Use it to answer questions like “is this guide single-mode at
          1550 nm?” or “how big is the mode of my ridge?” in about a second.
        </p>

        <h2>How the solver works</h2>
        <ol>
          <li>
            <b>Materials.</b> Each material’s refractive index is evaluated at your wavelength from published dispersion data.
            Uniaxial crystals use separate ordinary and extraordinary indices along the axes you choose.
          </li>
          <li>
            <b>Mesh.</b> The window is divided into a rectangular grid whose lines sit exactly on shape edges. Cells are small in
            and around each shape, where the field changes fastest, and grow towards the window edges.
          </li>
          <li>
            <b>Edges.</b> Where a cell straddles a sloped or curved boundary, its permittivity is averaged according to the
            direction of the boundary, which removes most of the staircase error.
          </li>
          <li>
            <b>Equations.</b> Maxwell’s equations are written as finite differences on a staggered (Yee) grid and reduced to an
            eigenvalue problem for the two transverse electric field components. Each eigenvalue gives a propagation constant β =
            n<sub>eff</sub>·2π/λ; each eigenvector is a mode. This is a full-vector solution; scalar and semi-vector versions are
            available under Simulation.
          </li>
          <li>
            <b>Eigenmodes.</b> The modes with the highest n<sub>eff</sub> are found with a shift-invert Arnoldi iteration on the
            sparse matrix.
          </li>
          <li>
            <b>Extrapolation.</b> The problem is solved on two meshes and n<sub>eff</sub> is extrapolated to zero cell size, which
            is several times more accurate than either mesh alone.
          </li>
        </ol>
        <p>
          The solver is written in Python (NumPy and SciPy) and runs in the page through Pyodide, which is why the first visit takes
          about ten seconds to load.
        </p>

        <h2>What the numbers mean</h2>
        <ul>
          <li>
            <b>n<sub>eff</sub></b>: effective index of the mode.
          </li>
          <li>
            <b>MFD</b>: full width of |E|² at 1/e² of its peak, along x and y through the peak.
          </li>
          <li>
            <b>A<sub>eff</sub></b>: (∫|E|² dA)² / ∫|E|⁴ dA.
          </li>
          <li>
            <b>TE</b>: fraction of the transverse field energy in E<sub>x</sub> (horizontal). Modes are labelled TE or TM by which
            component dominates.
          </li>
          <li>
            <b>✕</b>: not guided. The mode is below cut-off or belongs to the window walls rather than the waveguide.
          </li>
        </ul>

        <h2>Accuracy</h2>
        <p>
          Checked against two independent open-source solvers, femwell (finite elements) and Tidy3D (finite differences), using
          the same geometry and refractive indices. Differences in n<sub>eff</sub> for the two highest modes, at the default
          Standard mesh:
        </p>
        <table>
          <thead>
            <tr>
              <th>Structure at 1550 nm</th>
              <th>Reference</th>
              <th>Δn<sub>eff</sub> mode 1</th>
              <th>Δn<sub>eff</sub> mode 2</th>
              <th>Solve time</th>
            </tr>
          </thead>
          <tbody>
            {BENCHMARKS.map((b) => (
              <tr key={b.name}>
                <td>{b.name}</td>
                <td>{b.reference}</td>
                <td className="num">{b.d0}</td>
                <td className="num">{b.d1}</td>
                <td className="num">{b.ms} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">
          Solve times are for four modes in desktop Python on a 2016 quad-core PC; in the browser expect about 1.5 times longer
          (the Si₃N₄ strip takes about 0.9 s in Firefox on that machine). Mode sizes agree with Tidy3D within 3% on all five
          structures. Tidy3D was run locally without edge smoothing, so its values for the LiNbO₃ ridge are uncertain to about
          ±4e-3.
        </p>
        <p>
          The solver also reproduces exact solutions: slab waveguides (TE and TM, isotropic and uniaxial) and the LP<sub>01</sub>{' '}
          mode of a step-index fibre.
        </p>
        <table>
          <thead>
            <tr>
              <th>Mesh setting</th>
              <th>Largest n<sub>eff</sub> difference above</th>
              <th>Solve time</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Fast</td>
              <td className="num">3e-3</td>
              <td className="num">190–240 ms</td>
            </tr>
            <tr>
              <td>Standard (default)</td>
              <td className="num">7e-4</td>
              <td className="num">350–470 ms</td>
            </tr>
            <tr>
              <td>Fine</td>
              <td className="num">6e-4</td>
              <td className="num">550–990 ms</td>
            </tr>
          </tbody>
        </table>

        <h2>Limits</h2>
        <ul>
          <li>Straight waveguides only: no bends, tapers or propagation along the guide.</li>
          <li>
            The window has metal walls. Leaky modes and lossy materials are approximate, and a window that cuts through a
            high-index substrate produces spurious modes (the app warns when it sees them).
          </li>
          <li>Group index, fibre coupling and lens coupling are not available yet.</li>
          <li>Results depend on the index data: check that the listed source matches your material and wavelength.</li>
        </ul>

        <h2>References</h2>
        <p>The finite-difference formulation follows the Yee-mesh approach of:</p>
        <ul className="refs">
          <li>
            Z. Zhu and T. G. Brown, “Full-vectorial finite-difference analysis of microstructured optical fibers,”{' '}
            <i>Opt. Express</i> <b>10</b>, 853 (2002). <Doi doi="10.1364/OE.10.000853">doi:10.1364/OE.10.000853</Doi>
          </li>
          <li>
            A. B. Fallahkhair, K. S. Li and T. E. Murphy, “Vector finite difference modesolver for anisotropic dielectric
            waveguides,” <i>J. Lightwave Technol.</i> <b>26</b>, 1423–1431 (2008).{' '}
            <Doi doi="10.1109/JLT.2008.923643">doi:10.1109/JLT.2008.923643</Doi>
          </li>
        </ul>
        <p>Refractive index data (via refractiveindex.info):</p>
        <ul className="refs">
          {sourcesOf().map(({ material, source }) => (
            <li key={material}>
              <b>{material}</b>: {source.citation}
              {source.doi && (
                <>
                  {' '}
                  <Doi doi={source.doi}>doi:{source.doi}</Doi>
                </>
              )}
            </li>
          ))}
        </ul>
        <p>
          Benchmarks: <a href="https://github.com/HelgeGehring/femwell" target="_blank" rel="noreferrer">femwell</a> 0.1.12 and{' '}
          <a href="https://github.com/flexcompute/tidy3d" target="_blank" rel="noreferrer">Tidy3D</a> 2.12.0. Inspired by{' '}
          <a href="https://github.com/philmain28/philsol" target="_blank" rel="noreferrer">philsol</a> and spdcalc.
        </p>
      </article>
    </main>
  );
}
