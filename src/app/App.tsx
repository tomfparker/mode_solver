// M0 placeholder shell: proves the mock solver runs through the Solver interface.
// Replaced by the three-zone layout in M1.

import { useEffect, useState } from 'react'
import type { Project } from '../geometry/types'
import { MockSolver } from '../solver/mockSolver'
import type { SolveResult } from '../solver/types'

const demo: Project = {
  version: 1,
  wavelength: 1.55,
  stack: { substrate: 'Si', layers: [{ id: 'box', name: 'BOX', material: 'SiO2', thickness: 3 }], cladding: 'SiO2' },
  features: [{ id: 'core', name: 'Core', kind: 'rect', material: 'Si3N4', cx: 0, cy: 3.4, width: 1.2, height: 0.8 }],
  settings: { solverKind: 'auto', numModes: 4 },
}

export function App() {
  const [result, setResult] = useState<SolveResult | null>(null)
  useEffect(() => {
    const s = new MockSolver()
    s.solve({ id: 'demo', project: demo, numModes: 4 }).then(setResult, () => {})
    return () => s.dispose()
  }, [])
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Waveguide mode solver: M0 scaffold</h1>
      <p>Mock solver (results are not physical). The UI arrives in M1. Spike page: <a href="./spike.html">spike.html</a></p>
      {result && (
        <ul>
          {result.modes.map((m, i) => (
            <li key={i}>
              mode {i}: n_eff {m.neff.re.toFixed(4)}, MFD {m.mfd.x.toFixed(2)} × {m.mfd.y.toFixed(2)} µm
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
