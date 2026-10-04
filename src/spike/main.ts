// M0 spike page: loads Pyodide in the worker, times the eigensolve cases, shows a table, and
// exposes the result as window.__spike for the Playwright runner (npm run spike).

import { PyodideSolver, type SpikeResult } from '../solver/workerClient';

declare global {
  interface Window {
    __spike?: SpikeResult & { userAgent: string; crossOriginIsolated: boolean; firstReadyMs: number };
  }
}

const statusEl = document.getElementById('status')!;
const out = document.getElementById('out')!;
const params = new URLSearchParams(location.search);
const sizes = (params.get('sizes') ?? '100,200').split(',').map(Number);
const kinds = (params.get('kinds') ?? 'scalar,vector').split(',');
const repeats = Number(params.get('repeats') ?? 2);

const t0 = performance.now();
const solver = new PyodideSolver();
let started = false;
solver.onStatus(async (s) => {
  if (s.state === 'loading') statusEl.textContent = `${s.stage} (${Math.round(s.progress * 100)}%)`;
  if (s.state === 'error') statusEl.textContent = s.message;
  if (s.state === 'ready' && !started) {
    started = true;
    const firstReadyMs = performance.now() - t0;
    statusEl.textContent = `Ready after ${firstReadyMs.toFixed(0)} ms. Running spike…`;
    const res = await solver.runSpike(sizes, kinds, repeats);
    const cols = ['kind', 'n', 'run', 'unknowns', 'build_ms', 'eigs_total_ms', 'splu_ms', 'arnoldi_ms', 'tuned_total_ms', 'nsolves', 'lu_nnz', 'paths_agree'];
    out.innerHTML =
      `<table><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>` +
      res.results.map((r) => `<tr>${cols.map((c) => `<td>${String(r[c])}</td>`).join('')}</tr>`).join('') +
      `</table><p>Field transfer (6×200×200 f64 → f32): ${res.transferMs.toFixed(1)} ms</p>`;
    statusEl.textContent = `Done. Runtime ready after ${firstReadyMs.toFixed(0)} ms.`;
    window.__spike = { ...res, userAgent: navigator.userAgent, crossOriginIsolated, firstReadyMs };
  }
});
