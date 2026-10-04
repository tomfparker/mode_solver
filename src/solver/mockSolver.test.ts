import { describe, expect, it } from 'vitest';
import type { Project } from '../geometry/types';
import { MockSolver, mockSolve } from './mockSolver';
import { isAbortError, type SolveRequest } from './types';

const ETA0 = 376.730313668;

const project: Project = {
  version: 1,
  wavelength: 1.55,
  stack: {
    substrate: 'Si',
    layers: [{ id: 'box', name: 'BOX', material: 'SiO2', thickness: 3 }],
    cladding: 'SiO2',
  },
  features: [{ id: 'core', name: 'Core', kind: 'rect', material: 'Si3N4', cx: 0, cy: 3.4, width: 1.2, height: 0.8 }],
  settings: { solverKind: 'auto', numModes: 4 },
};

const req = (id: string): SolveRequest => ({ id, project, numModes: 4 });

describe('mockSolve', () => {
  const res = mockSolve(req('a'));

  it('flags results as mock', () => {
    expect(res.isMock).toBe(true);
  });

  it('returns field arrays matching the grid', () => {
    const N = res.grid.nx * res.grid.ny;
    for (const m of res.modes) {
      for (const f of Object.values(m.fields)) {
        expect(f!.re.length).toBe(N);
        expect(f!.im.length).toBe(N);
      }
    }
  });

  it('sorts modes by descending n_eff', () => {
    const n = res.modes.map((m) => m.neff.re);
    expect([...n].sort((a, b) => b - a)).toEqual(n);
  });

  it('normalises to unit power: Re∫(E×H*)·ẑ dA / 2 = 1', () => {
    const { x, y } = res.grid;
    const dA = (x[1] - x[0]) * (y[1] - y[0]);
    for (const m of res.modes) {
      const { Ex, Ey, Hx, Hy } = m.fields;
      let p = 0;
      for (let q = 0; q < Ex!.re.length; q++) {
        p += Ex!.re[q] * Hy!.re[q] + Ex!.im[q] * Hy!.im[q] - (Ey!.re[q] * Hx!.re[q] + Ey!.im[q] * Hx!.im[q]);
      }
      expect((p * dA) / 2).toBeCloseTo(1, 4);
      // Sanity: paraxial H magnitude.
      const i = Ex!.re.findIndex((v) => v !== 0);
      if (i >= 0) expect(Hy!.re[i] / Ex!.re[i]).toBeCloseTo(m.neff.re / ETA0, 8);
    }
  });

  it('gives a fundamental MFD of the order of the core size, and a small boundary amplitude', () => {
    const m0 = res.modes[0];
    expect(m0.mfd.x).toBeGreaterThan(0.5);
    expect(m0.mfd.x).toBeLessThan(3);
    expect(m0.boundaryAmplitude).toBeLessThan(1e-3);
  });
});

describe('MockSolver cancellation', () => {
  it('latest wins: a newer request supersedes an older one', async () => {
    const s = new MockSolver({ latencyMs: 20 });
    const p1 = s.solve(req('1'));
    const p2 = s.solve(req('2'));
    const p3 = s.solve(req('3'));
    await expect(p1).rejects.toSatisfy(isAbortError);
    await expect(p2).rejects.toSatisfy(isAbortError);
    expect((await p3).requestId).toBe('3');
  });

  it('honours an AbortSignal', async () => {
    const s = new MockSolver({ latencyMs: 50 });
    const ac = new AbortController();
    const p = s.solve(req('x'), ac.signal);
    ac.abort();
    await expect(p).rejects.toSatisfy(isAbortError);
    expect((await s.solve(req('y'))).requestId).toBe('y');
  });
});
