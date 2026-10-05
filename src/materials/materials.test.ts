import { describe, expect, it } from 'vitest';
import { evaluate } from './dispersion';
import { LIBRARY, indexAt } from './library';
import type { Dispersion } from './types';

const src = { citation: 't', doi: null, url: 'u', file: 'f', retrieved: 'r' };

describe('dispersion formulas', () => {
  it('formula 1 with poles C equals formula 2 with poles C²', () => {
    const f1: Dispersion = { model: 'sellmeier1', coefficients: [0.1, 0.7, 0.07, 0.4, 0.12], range: [0.2, 5], source: src };
    const f2: Dispersion = { model: 'sellmeier2', coefficients: [0.1, 0.7, 0.07 ** 2, 0.4, 0.12 ** 2], range: [0.2, 5], source: src };
    for (const l of [0.5, 1.0, 1.55, 3]) expect(evaluate(f1, l).n).toBeCloseTo(evaluate(f2, l).n, 12);
  });

  it('a single-term Sellmeier matches the closed form', () => {
    const d: Dispersion = { model: 'sellmeier1', coefficients: [0, 1.0, 0.1], range: [0.2, 5], source: src };
    const l = 1.2;
    expect(evaluate(d, l).n).toBeCloseTo(Math.sqrt(1 + (l * l) / (l * l - 0.01)), 12);
  });

  it('gas formula: n − 1 = C1 + C2/(C3 − λ⁻²)', () => {
    const d: Dispersion = { model: 'gases', coefficients: [0, 0.05, 200], range: [0.2, 2], source: src };
    expect(evaluate(d, 1).n).toBeCloseTo(1 + 0.05 / 199, 12);
  });

  it('tabulated: interpolates linearly, clamps and flags out-of-range', () => {
    const d: Dispersion = { model: 'tabulated', table: [[1, 3], [2, 2]], range: [1, 2], source: src };
    expect(evaluate(d, 1.25)).toEqual({ n: 2.75, inRange: true });
    expect(evaluate(d, 0.5)).toEqual({ n: 3, inRange: false });
    expect(evaluate(d, 3)).toEqual({ n: 2, inRange: false });
  });
});

describe('material library', () => {
  it('every entry has a source with a DOI or URL, and a validity range', () => {
    expect(LIBRARY.length).toBeGreaterThanOrEqual(5);
    for (const m of LIBRARY) {
      const ds = m.kind === 'isotropic' ? [m.n] : [m.ordinary, m.extraordinary];
      for (const d of ds) {
        expect(d.source.citation.length).toBeGreaterThan(10);
        expect(d.source.doi ?? d.source.url).toBeTruthy();
        expect(d.range[0]).toBeLessThan(d.range[1]);
      }
    }
  });

  it('returns tabulated Si exactly at a table point (Li 293 K file: 1.55 µm → 3.4757)', () => {
    expect(indexAt('Si', 1.55, [])!.n).toBeCloseTo(3.4757, 10);
  });

  it('flags Si below its 1.2 µm table start as out of range', () => {
    expect(indexAt('Si', 0.78, [])!.inRange).toBe(false);
  });

  it('library values are physically sane across their ranges (n > 1, normal dispersion in the NIR)', () => {
    for (const m of LIBRARY) {
      for (const axis of ['x', 'z'] as const) {
        const a = indexAt(m.id, 1.0, [], axis)!;
        const b = indexAt(m.id, 1.6, [], axis)!;
        expect(a.n).toBeGreaterThan(1);
        expect(b.n).toBeLessThanOrEqual(a.n);
      }
    }
  });

  it('uniaxial: n_e along the optic axis, n_o otherwise', () => {
    const ne = indexAt('LiNbO3', 1.55, [], 'x', 'x')!.n;
    const no = indexAt('LiNbO3', 1.55, [], 'y', 'x')!.n;
    expect(ne).not.toBeCloseTo(no, 3);
    expect(indexAt('LiNbO3', 1.55, [], 'z', 'z')!.n).toBe(ne);
  });

  it('custom materials return the user-entered constant index', () => {
    const c = [{ id: 'custom:a', name: 'A', n: 1.7, k: 0.01 }];
    expect(indexAt('custom:a', 0.5, c)).toEqual({ n: 1.7, k: 0.01, inRange: true });
  });
});
