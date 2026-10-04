// M0 spike under Node: same Pyodide + solver_py code as the browser worker, run in V8's
// WebAssembly engine (the same engine Chrome uses). A proxy for Chrome when real browsers
// can't be driven. Usage: node scripts/spike-node.mjs > docs/spike-node.json
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import os from 'node:os'
import { loadPyodide } from 'pyodide'

const root = new URL('..', import.meta.url).pathname
const t0 = performance.now()
const py = await loadPyodide({ packageCacheDir: join(root, 'node_modules/.cache/pyodide') })
await py.loadPackage(['numpy', 'scipy'], { messageCallback: () => {} })
const loadMs = performance.now() - t0

function* pyFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'tests' && name !== '__pycache__') yield* pyFiles(p) }
    else if (name.endsWith('.py')) yield p
  }
}
const pyRoot = join(root, 'solver_py')
for (const f of pyFiles(pyRoot)) {
  const dest = '/home/pyodide/solver_py/' + relative(pyRoot, f)
  py.FS.mkdirTree(dest.slice(0, dest.lastIndexOf('/')))
  py.FS.writeFile(dest, readFileSync(f, 'utf8'))
}
py.runPython('import sys; sys.path.insert(0, "/home/pyodide/solver_py")')
const json = py.runPython('import json\nfrom modesolver.spike import run_spike\njson.dumps(run_spike())')
console.log(JSON.stringify({
  runtime: `node ${process.version} / pyodide ${py.version}`,
  cpu: os.cpus()[0].model,
  loadMs: Math.round(loadMs),
  results: JSON.parse(json),
}, null, 1))
