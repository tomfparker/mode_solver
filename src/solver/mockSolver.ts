// Mock solver: plausible-looking but NON-PHYSICAL modes, so UI work isn't blocked on numerics.
// Fields are Hermite–Gaussians sized from the core; n_eff is a made-up smooth function of
// core size and λ. Every result carries isMock: true and the UI must say so.

import type { Project } from '../geometry/types';
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

export interface MockOptions {
  latencyMs?: number;
  gridCells?: number; // cells along the longer side
}

/** Bounding box of the guiding core: first feature, else the thinnest finite layer as a slab. */
export function coreBox(p: Project): { cx: number; cy: number; w: number; h: number } {
  const f = p.features[0];
  if (f) return { cx: f.cx, cy: f.cy, w: f.width, h: f.height };
  let y = 0;
  let best = { cx: 0, cy: 0.5, w: 4, h: 1 };
  let bestT = Infinity;
  for (const l of p.stack.layers) {
    if (l.thickness < bestT) {
      bestT = l.thickness;
      best = { cx: 0, cy: y + l.thickness / 2, w: 4, h: l.thickness };
    }
    y += l.thickness;
  }
  return best;
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

/** Mode order for the mock: (m, n, polarisation). */
function modeOrder(count: number): { m: number; n: number; pol: 'TE' | 'TM' }[] {
  const out: { m: number; n: number; pol: 'TE' | 'TM' }[] = [];
  const mn = [[0, 0], [1, 0], [0, 1], [2, 0], [1, 1], [3, 0]];
  for (const [m, n] of mn) {
    for (const pol of ['TE', 'TM'] as const) {
      if (out.length < count) out.push({ m, n, pol });
    }
  }
  return out;
}

export function mockSolve(req: SolveRequest, opts: MockOptions = {}): SolveResult {
  const t0 = performance.now();
  const p = req.project;
  const core = coreBox(p);
  const lam = p.wavelength;
  // Domain: core plus a margin that grows with λ (mirrors what auto-sizing will do).
  const pad = Math.max(1.0, 1.5 * lam);
  const W = core.w + 2 * pad;
  const H = core.h + 2 * pad;
  const cells = opts.gridCells ?? 100;
  const d = Math.max(W, H) / cells;
  const nx = Math.max(8, Math.round(W / d));
  const ny = Math.max(8, Math.round(H / d));
  const x = Float64Array.from({ length: nx }, (_, i) => core.cx - W / 2 + (i + 0.5) * (W / nx));
  const y = Float64Array.from({ length: ny }, (_, j) => core.cy - H / 2 + (j + 0.5) * (H / ny));
  const grid: FieldGrid = { x, y, nx, ny };
  const dA = (W / nx) * (H / ny);

  // Waist: tracks the core but never below ~λ/3 (a mode can't be much smaller than that).
  const wx0 = Math.max(0.5 * core.w, lam / 3);
  const wy0 = Math.max(0.5 * core.h, lam / 3);

  const modes: ModeResult[] = modeOrder(req.numModes).map(({ m, n, pol }, i) => {
    // Made-up n_eff: rises with core size / λ, falls with mode order. Not physical.
    const v = Math.sqrt(core.w * core.h) / lam;
    const neffRe = 1.45 + 0.4 * (1 - Math.exp(-2 * v)) - 0.03 * (m + n) - (pol === 'TM' ? 0.01 : 0) - 0.001 * i;
    const wx = wx0 * (1 + 0.1 * (pol === 'TM' ? 1 : 0));
    const wy = wy0;
    const N = nx * ny;
    const main = new Float32Array(N);
    const ez = new Float32Array(N);
    for (let j = 0; j < ny; j++) {
      const v1 = (y[j] - core.cy) / wy;
      for (let k = 0; k < nx; k++) {
        const u = (x[k] - core.cx) / wx;
        const val = hermite(m, Math.SQRT2 * u) * hermite(n, Math.SQRT2 * v1) * Math.exp(-(u * u + v1 * v1));
        main[j * nx + k] = val;
        // Small longitudinal component, ∝ transverse derivative, 90° out of phase (stored in im).
        ez[j * nx + k] = -0.15 * (pol === 'TE' ? u / wx : v1 / wy) * val * lam;
      }
    }
    // Unit power: P = ½·(n/η0)·∫|E_t|² dA = 1.
    let sum = 0;
    for (let q = 0; q < N; q++) sum += main[q] * main[q];
    const scale = Math.sqrt(2 / ((neffRe / ETA0) * sum * dA));
    const hScale = neffRe / ETA0;
    const e = main.map((v2) => v2 * scale);
    const zero = () => new Float32Array(N);
    const cf = (re: Float32Array, im: Float32Array = zero()): ComplexField => ({ re, im });
    const fields: ModeResult['fields'] =
      pol === 'TE'
        ? { Ex: cf(e), Ey: cf(zero()), Ez: cf(zero(), ez.map((v2) => v2 * scale)), Hx: cf(zero()), Hy: cf(e.map((v2) => v2 * hScale)), Hz: cf(zero()) }
        : { Ex: cf(zero()), Ey: cf(e), Ez: cf(zero(), ez.map((v2) => v2 * scale)), Hx: cf(e.map((v2) => -v2 * hScale)), Hy: cf(zero()), Hz: cf(zero()) };
    return { neff: { re: neffRe, im: 0 }, ...intensityMetrics(e, grid), teFraction: pol === 'TE' ? 0.98 : 0.02, fields };
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
          resolve(mockSolve(req, this.opts));
        } catch (e) {
          reject(e);
        }
      }, this.opts.latencyMs ?? 120);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
    });
  }
}
