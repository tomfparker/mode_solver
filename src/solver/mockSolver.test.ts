import { describe, expect, it } from 'vitest';
import { buildTemplate, TEMPLATES } from '../geometry/templates';
import { MockSolver, mockSolve } from './mockSolver';
import { isAbortError, type SolveRequest } from './types';

const ETA0 = 376.730313668;
const project = buildTemplate('sin-strip');
const req = (id: string, p = project): SolveRequest => ({ id, project: p, numModes: 4 });

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
      const i = Ex!.re.findIndex((v) => v !== 0);
      if (i >= 0) expect(Hy!.re[i] / Ex!.re[i]).toBeCloseTo(m.neff.re / ETA0, 8);
    }
  });

  it('gives a fundamental of plausible size, inside the window', () => {
    const m0 = res.modes[0];
    expect(m0.guided).toBe(true);
    expect(m0.mfd.x).toBeGreaterThan(0.5);
    expect(m0.mfd.x).toBeLessThan(3);
    expect(m0.boundaryAmplitude).toBeLessThan(1e-3);
  });

  it('keeps n_eff between the cladding and core indices', () => {
    for (const m of res.modes) {
      expect(m.neff.re).toBeGreaterThan(1.44);
      expect(m.neff.re).toBeLessThan(2.1);
    }
  });

  it('runs on every template without throwing, with at least one mode', () => {
    for (const t of TEMPLATES) {
      const r = mockSolve(req(t.id, t.build()));
      expect(r.modes.length).toBeGreaterThan(0);
      expect(Number.isFinite(r.modes[0].neff.re)).toBe(true);
    }
  });

  it('shrinking the core reduces the number of guided modes', () => {
    const big = buildTemplate('sin-strip');
    const small = buildTemplate('sin-strip');
    Object.assign(big.features.find((f) => f.name === 'Core')!, { width: 3, height: 1.5 });
    Object.assign(small.features.find((f) => f.name === 'Core')!, { width: 0.6, height: 0.4 });
    big.settings.numModes = 12;
    small.settings.numModes = 12;
    const nb = mockSolve({ id: 'b', project: big, numModes: 12 }).modes.filter((m) => m.guided).length;
    const ns = mockSolve({ id: 's', project: small, numModes: 12 }).modes.filter((m) => m.guided).length;
    expect(nb).toBeGreaterThan(ns);
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
