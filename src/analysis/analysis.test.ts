import { describe, expect, it } from 'vitest';
import { buildTemplate } from '../geometry/templates';
import type { ModeResult, SolveResult } from '../solver/types';
import { labelModes } from './modeLabels';
import { BOUNDARY_THRESHOLD, computeWarnings } from './warnings';

const mode = (over: Partial<ModeResult>): ModeResult => ({
  neff: { re: 1.8, im: 0 },
  mfd: { x: 1, y: 1 },
  aEff: 1,
  teFraction: 1,
  fields: {},
  boundaryAmplitude: 0,
  guided: true,
  ...over,
});

const result = (modes: ModeResult[]): SolveResult => ({
  requestId: 'r',
  grid: { x: new Float64Array(2), y: new Float64Array(2), nx: 2, ny: 2 },
  modes,
  diagnostics: { solverKind: 'fullvector', timingsMs: {}, notes: [] },
  isMock: true,
});

const ids = (w: { id: string }[]) => w.map((x) => x.id);

describe('labelModes', () => {
  it('numbers TE-like and TM-like families separately', () => {
    expect(labelModes([{ teFraction: 0.99 }, { teFraction: 0.02 }, { teFraction: 0.95 }, { teFraction: 0.5 }])).toEqual([
      'TE0',
      'TM0',
      'TE1',
      'Mode 3 (hybrid)',
    ]);
  });
});

describe('computeWarnings', () => {
  const p = buildTemplate('sin-strip');

  it('is quiet for a single-mode, well-contained default at 1550 nm', () => {
    expect(computeWarnings(p, result([mode({}), mode({ teFraction: 0 })]))).toEqual([]);
  });

  it('flags multimode when a polarisation family has more than one guided mode', () => {
    const w = computeWarnings(p, result([mode({}), mode({ teFraction: 0 }), mode({})]));
    expect(ids(w)).toContain('multimode');
    expect(w.find((x) => x.id === 'multimode')!.text).toContain('TE0, TM0, TE1');
  });

  it('ignores unguided modes when counting', () => {
    expect(ids(computeWarnings(p, result([mode({}), mode({ guided: false })])))).not.toContain('multimode');
  });

  it('flags no guided mode', () => {
    expect(ids(computeWarnings(p, result([mode({ guided: false })])))).toContain('no-guided');
  });

  it('flags a mode reaching the window edge, with a fix action', () => {
    const w = computeWarnings(p, result([mode({ boundaryAmplitude: BOUNDARY_THRESHOLD * 2 })]));
    const b = w.find((x) => x.id === 'boundary')!;
    // Templates open with a fixed window, so the fix enlarges it about its centre.
    expect(b.action?.kind).toBe('set-window');
    if (b.action?.kind !== 'set-window') return;
    expect(b.action.window.x1 - b.action.window.x0).toBeGreaterThan(0);
    const q = { ...p, settings: { ...p.settings, window: 'auto' as const } };
    const a = computeWarnings(q, result([mode({ boundaryAmplitude: BOUNDARY_THRESHOLD * 2 })])).find((x) => x.id === 'boundary')!.action;
    expect(a?.kind).toBe('increase-padding');
  });

  it('flags λ outside a material’s data range (Si table starts at 1.2 µm)', () => {
    const q = { ...p, wavelength: 0.78 };
    expect(ids(computeWarnings(q, null))).toContain('range-Si');
  });

  it('notes custom constant-index materials and flags lossy ones', () => {
    const q = structuredClone(p);
    q.customMaterials.push({ id: 'custom:x', name: 'Polymer', n: 1.5, k: 0.001 });
    q.background = { material: 'custom:x' };
    const w = ids(computeWarnings(q, null));
    expect(w).toContain('custom-custom:x');
    expect(w).toContain('lossy-custom:x');
  });

  it('reminds the user that template Δn values are examples', () => {
    expect(computeWarnings(buildTemplate('fibre'), null).some((w) => w.id.startsWith('example-dn'))).toBe(true);
  });
});
