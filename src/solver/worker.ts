/// <reference lib="webworker" />
// Pyodide worker. Loads the runtime + numpy/scipy, mounts the solver_py package, and serves
// solve/spike requests one at a time. Only workerClient.ts talks to this file.

import type { PyodideAPI } from 'pyodide';
import type { FromWorker, ToWorker } from './protocol';
import type { SolveRequest, SolveResult } from './types';

declare const self: DedicatedWorkerGlobalScope;

// solver_py sources, bundled as raw text so the same files run natively (pytest) and here.
const pySources = import.meta.glob(['../../solver_py/**/*.py', '!../../solver_py/tests/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Material data, placed at the same path relative to solver_py as in the repository.
const materialFiles = import.meta.glob('../../data/materials/*.json', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

const PY_ROOT = '/home/pyodide/solver_py';
const DATA_ROOT = '/home/pyodide/data/materials';

let pyodide: PyodideAPI | null = null;
let loadMs = 0;

function post(msg: FromWorker, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

function status(stage: string, progress: number) {
  post({ type: 'status', status: { state: 'loading', stage, progress } });
}

async function init(base: string, interruptBuffer?: SharedArrayBuffer) {
  const t0 = performance.now();
  try {
    status('Downloading Python runtime', 0.05);
    const mod = (await import(/* @vite-ignore */ `${base}pyodide.mjs`)) as typeof import('pyodide');
    const py = await mod.loadPyodide({ indexURL: base });
    status('Downloading numpy + scipy', 0.4);
    await py.loadPackage(['numpy', 'scipy']);
    status('Loading solver', 0.9);
    for (const [path, src] of Object.entries(pySources)) {
      const rel = path.replace(/^.*solver_py\//, '');
      const full = `${PY_ROOT}/${rel}`;
      py.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
      py.FS.writeFile(full, src);
    }
    py.FS.mkdirTree(DATA_ROOT);
    for (const [path, src] of Object.entries(materialFiles)) {
      py.FS.writeFile(`${DATA_ROOT}/${path.slice(path.lastIndexOf('/') + 1)}`, src);
    }
    py.runPython(`import sys; sys.path.insert(0, "${PY_ROOT}")\nimport modesolver.ui`);
    if (interruptBuffer) py.setInterruptBuffer(new Int32Array(interruptBuffer));
    pyodide = py;
    loadMs = performance.now() - t0;
    post({ type: 'status', status: { state: 'ready' } });
  } catch (e) {
    post({ type: 'status', status: { state: 'error', message: `Solver failed to load: ${String(e)}` } });
  }
}

function runSpike(id: string, sizes: number[], kinds: string[], repeats: number) {
  const py = pyodide!;
  py.globals.set('_sizes', py.toPy(sizes));
  py.globals.set('_kinds', py.toPy(kinds));
  py.globals.set('_repeats', repeats);
  const json = py.runPython(`
import json
from modesolver.spike import run_spike
json.dumps(run_spike(tuple(_sizes), tuple(_kinds), _repeats))
`) as string;
  // Cost of moving six 200×200 field components (as float64) out of Python into a Float32Array.
  const t0 = performance.now();
  const proxy = py.runPython('import numpy as np; np.random.rand(6 * 200 * 200)');
  const buf = proxy.getBuffer('f64');
  const f32 = new Float32Array(buf.data as Float64Array);
  buf.release();
  proxy.destroy();
  const transferMs = performance.now() - t0;
  post({ type: 'spikeDone', id, json, transferMs, loadMs }, [f32.buffer]);
}

/** Collect every typed array's buffer so the result moves to the main thread without copying. */
function buffersOf(v: unknown, out: ArrayBuffer[] = []): ArrayBuffer[] {
  if (ArrayBuffer.isView(v)) out.push(v.buffer as ArrayBuffer);
  else if (Array.isArray(v)) v.forEach((x) => buffersOf(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => buffersOf(x, out));
  return out;
}

function runSolve(req: SolveRequest) {
  const py = pyodide!;
  const t0 = performance.now();
  try {
    py.globals.set('_request_json', JSON.stringify(req));
    const proxy = py.runPython('modesolver.ui.solve_request(_request_json)');
    const t1 = performance.now();
    // numpy arrays arrive as typed-array views into WASM memory; slice() copies them out
    // so they can be transferred.
    const raw = proxy.toJs({ dict_converter: Object.fromEntries, create_proxies: false });
    proxy.destroy();
    const result = detach(raw) as SolveResult;
    result.diagnostics.timingsMs.python = t1 - t0;
    result.diagnostics.timingsMs.transfer = performance.now() - t1;
    post({ type: 'solved', result }, buffersOf(result));
  } catch (e) {
    const message = String(e);
    post({ type: 'solveError', requestId: req.id, message: shortError(message), interrupted: message.includes('KeyboardInterrupt') });
  }
}

/** Deep-copy typed arrays out of WASM memory (plain values pass through). */
function detach(v: unknown): unknown {
  if (ArrayBuffer.isView(v)) return (v as Float32Array).slice();
  if (Array.isArray(v)) return v.map(detach);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, detach(x)]));
  return v;
}

/** Last line of a Python traceback: the part worth showing to a user. */
function shortError(message: string): string {
  const lines = message.trim().split('\n');
  return lines[lines.length - 1] || message;
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      await init(msg.pyodideBase, msg.interruptBuffer);
      break;
    case 'spike':
      runSpike(msg.id, msg.sizes, msg.kinds, msg.repeats);
      break;
    case 'solve':
      runSolve(msg.req);
      break;
  }
};
