// Mock solver: plausible-looking but NON-PHYSICAL modes, so UI work isn't blocked on numerics.
// It uses the real geometry, solve domain and material indices, and a crude Marcatili-style
// estimate so n_eff, mode count and mode size respond sensibly to edits. Fields are
// Hermite–Gaussians. Every result carries isMock: true and the UI must say so.

import { effectiveMeshStep, indexAtPoint, solveDomain, structureBox } from '../geometry/geometry';
import type { Project } from '../geometry/types';
import type { Axis } from '../materials/types';
import { LatestWins } from './latestWins';
import {
  abortError,
  type ComplexField,
  type FieldGrid,
  type ModeResult,
  type Solver,
  type SolveRequest,
  type SolveResult,
  type SolverStatus,
} from './types';

// Free-space impedance η0 = μ0·c (SI defining constants), Ω. Used for the paraxial H = (n/η0) ẑ×E.
const ETA0 = 376.730313668;
const MAX_CELLS = 300;

export interface MockOptions {
  latencyMs?: number;
}

function hermite(n: number, x: number): number {
  // Physicists' Hermite polynomials H0..H3 are enough for a handful of mock modes.
  switch (n) {
    case 0: return 1;
    case 1: return 2 * x;
    case 2: return 4 * x * x - 2;
    default: return 8 * x * x * x - 12 * x;
  }
}

/** Core index and surrounding index seen by one polarisation (crude: sampled around the core box). */
function contrast(p: Project, axis: Axis) {
  const b = structureBox(p);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  let nCore = -Infinity;
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      const x = b.x0 + ((b.x1 - b.x0) * (i + 0.5)) / 5;
      const y = b.y0 + ((b.y1 - b.y0) * (j + 0.5)) / 5;
      nCore = Math.max(nCore, indexAtPoint(p, x, y, axis));
    }
  }
  const gap = 0.3;
  const around = [
    indexAtPoint(p, b.x0 - gap, cy, axis),
    indexAtPoint(p, b.x1 + gap, cy, axis),
    indexAtPoint(p, cx, b.y1 + gap, axis),
    indexAtPoint(p, cx, b.y0 - gap, axis),
  ].filter((n) => n < nCore - 1e-6); // same-material surroundings (rib slab) don't count as cladding
  const nBg = around.length ? Math.max(...around) : nCore - 0.01;
  return { nCore, nBg, box: b, cx, cy };
}

/** Marcuse-style spot-size factor, used here only to make mock mode sizes behave plausibly. */
function spot(halfWidth: number, v: number): number {
  const vv = Math.max(v, 0.7);
  return halfWidth * (0.65 + 1.619 * vv ** -1.5 + 2.879 * vv ** -6);
}

export function mockSolve(req: SolveRequest): SolveResult {
  const t0 = performance.now();
  const p = req.project;
  const lam = p.wavelength;
  const k0 = (2 * Math.PI) / lam;
  const dom = solveDomain(p);
  const step = effectiveMeshStep(p);
  const W = dom.x1 - dom.x0;
  const H = dom.y1 - dom.y0;
  const nx = Math.min(MAX_CELLS, Math.max(8, Math.round(W / step)));
  const ny = Math.min(MAX_CELLS, Math.max(8, Math.round(H / step)));
  const x = Float64Array.from({ length: nx }, (_, i) => dom.x0 + (i + 0.5) * (W / nx));
  const y = Float64Array.from({ length: ny }, (_, j) => dom.y0 + (j + 0.5) * (H / ny));
  const grid: FieldGrid = { x, y, nx, ny };
  const dA = (W / nx) * (H / ny);

  type Cand = { m: number; n: number; pol: 'TE' | 'TM'; neff: number; guided: boolean; wx: number; wy: number; cx: number; cy: number };
  const cands: Cand[] = [];
  for (const pol of ['TE', 'TM'] as const) {
    const c = contrast(p, pol === 'TE' ? 'x' : 'y');
    const na = Math.sqrt(Math.max(c.nCore ** 2 - c.nBg ** 2, 1e-8));
    const ax = (c.box.x1 - c.box.x0) / 2;
    const ay = (c.box.y1 - c.box.y0) / 2;
    const vx = k0 * ax * na * (pol === 'TE' ? 1 : 0.92);
    const vy = k0 * ay * na * (pol === 'TM' ? 1 : 0.92);
    for (const [m, n] of [[0, 0], [1, 0], [0, 1], [2, 0], [1, 1], [3, 0], [0, 2]]) {
      // Marcatili-like: (1 − b) = (1 − bx) + (1 − by); cut-off of order m at V = mπ/2.
      const bx = 1 - (((m + 1) * Math.PI) / (2 * vx + Math.PI)) ** 2;
      const by = 1 - (((n + 1) * Math.PI) / (2 * vy + Math.PI)) ** 2;
      const b = bx + by - 1;
      const guided = b > 0;
      if (!guided && (m > 0 || n > 0)) continue;
      const bb = guided ? b : 0.002;
      cands.push({
        m, n, pol, guided,
        neff: Math.sqrt(c.nBg ** 2 + (c.nCore ** 2 - c.nBg ** 2) * bb),
        wx: Math.min(spot(ax, vx), W / 2),
        wy: Math.min(spot(ay, vy), H / 2),
        cx: c.cx, cy: c.cy,
      });
    }
  }
  cands.sort((a, b) => b.neff - a.neff);
  const guidedOnes = cands.filter((c) => c.guided);
  const chosen = (guidedOnes.length ? guidedOnes : cands.slice(0, 1)).slice(0, req.numModes);

  const N = nx * ny;
  const modes: ModeResult[] = chosen.map(({ m, n, pol, neff, guided, wx, wy, cx, cy }) => {
    const main = new Float32Array(N);
    const ez = new Float32Array(N);
    for (let j = 0; j < ny; j++) {
      const v = (y[j] - cy) / wy;
      for (let i = 0; i < nx; i++) {
        const u = (x[i] - cx) / wx;
        const val = hermite(m, Math.SQRT2 * u) * hermite(n, Math.SQRT2 * v) * Math.exp(-(u * u + v * v));
        main[j * nx + i] = val;
        // Small longitudinal component ∝ transverse derivative, 90° out of phase (stored in im).
        ez[j * nx + i] = -0.15 * (pol === 'TE' ? u / wx : v / wy) * val * lam;
      }
    }
    // Unit power: P = ½·(n/η0)·∫|E_t|² dA = 1.
    let sum = 0;
    for (let q = 0; q < N; q++) sum += main[q] * main[q];
    const scale = Math.sqrt(2 / ((neff / ETA0) * sum * dA));
    const hScale = neff / ETA0;
    const e = main.map((v2) => v2 * scale);
    const zero = () => new Float32Array(N);
    const cf = (re: Float32Array, im: Float32Array = zero()): ComplexField => ({ re, im });
    const ezs = ez.map((v2) => v2 * scale);
    const fields: ModeResult['fields'] =
      pol === 'TE'
        ? { Ex: cf(e), Ey: cf(zero()), Ez: cf(zero(), ezs), Hx: cf(zero()), Hy: cf(e.map((v2) => v2 * hScale)), Hz: cf(zero()) }
        : { Ex: cf(zero()), Ey: cf(e), Ez: cf(zero(), ezs), Hx: cf(e.map((v2) => -v2 * hScale)), Hy: cf(zero()), Hz: cf(zero()) };
    return {
      neff: { re: neff, im: 0 },
      ...intensityMetrics(e, grid),
      teFraction: pol === 'TE' ? 0.98 : 0.02,
      guided,
      fields,
    };
  });

  return {
    requestId: req.id,
    grid,
    modes,
    diagnostics: {
      solverKind: p.settings.solverKind === 'auto' ? 'fullvector' : p.settings.solverKind,
      timingsMs: { total: performance.now() - t0 },
      notes: ['Mock solver: fields and numbers are not physical.'],
    },
    isMock: true,
  };
}

/** MFD (D4σ, equal to the 1/e² diameter for a Gaussian), A_eff and boundary amplitude from a real field. */
export function intensityMetrics(e: Float32Array, g: FieldGrid): Pick<ModeResult, 'mfd' | 'aEff' | 'boundaryAmplitude'> {
  const { nx, ny, x, y } = g;
  const dA = (x[1] - x[0]) * (y[1] - y[0]);
  let s = 0, sx = 0, sy = 0, s2 = 0, peak = 0, edge = 0;
  for (let j = 0; j < ny; j++) {
    for (let k = 0; k < nx; k++) {
      const I = e[j * nx + k] ** 2;
      s += I; sx += I * x[k]; sy += I * y[j]; s2 += I * I;
      peak = Math.max(peak, I);
      if (j === 0 || k === 0 || j === ny - 1 || k === nx - 1) edge = Math.max(edge, I);
    }
  }
  const mx = sx / s, my = sy / s;
  let vx = 0, vy = 0;
  for (let j = 0; j < ny; j++) {
    for (let k = 0; k < nx; k++) {
      const I = e[j * nx + k] ** 2;
      vx += I * (x[k] - mx) ** 2;
      vy += I * (y[j] - my) ** 2;
    }
  }
  return {
    mfd: { x: 4 * Math.sqrt(vx / s), y: 4 * Math.sqrt(vy / s) },
    aEff: (s * dA) ** 2 / (s2 * dA),
    boundaryAmplitude: peak > 0 ? edge / peak : 0,
  };
}

export class MockSolver implements Solver {
  readonly name = 'mock';
  private queue: LatestWins<SolveRequest, SolveResult>;
  private opts: MockOptions;

  constructor(opts: MockOptions = {}) {
    this.opts = opts;
    this.queue = new LatestWins((req, signal) => this.exec(req, signal));
  }

  status(): SolverStatus {
    return { state: 'ready' };
  }

  onStatus(cb: (s: SolverStatus) => void): () => void {
    cb(this.status());
    return () => {};
  }

  solve(req: SolveRequest, signal?: AbortSignal): Promise<SolveResult> {
    return this.queue.submit(req, signal);
  }

  dispose() {}

  private exec(req: SolveRequest, signal: AbortSignal): Promise<SolveResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          resolve(mockSolve(req));
        } catch (e) {
          reject(e);
        }
      }, this.opts.latencyMs ?? 120);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
    });
  }
}
