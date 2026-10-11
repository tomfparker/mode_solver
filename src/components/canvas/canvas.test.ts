import { describe, expect, it } from 'vitest';
import { buildTemplate } from '../../geometry/templates';
import type { RectFeature, TrapezoidFeature } from '../../geometry/types';
import { applyDrag, handlesFor, snap, snapTargets, type SnapContext } from './handles';
import type { ModeResult } from '../../solver/types';
import { e2Extent, profiles } from './fieldImage';
import { fitView, niceStep, scaleBar, toPx, toUm, zoomAt } from './view';

const size = { w: 800, h: 600 };

describe('view transform', () => {
  it('round-trips µm ⇄ px with y flipped', () => {
    const v = { scale: 100, cx: 1, cy: 2 };
    const [px, py] = toPx(v, size, 1.5, 2.5);
    expect(px).toBeCloseTo(450);
    expect(py).toBeCloseTo(250);
    const [x, y] = toUm(v, size, px, py);
    expect(x).toBeCloseTo(1.5);
    expect(y).toBeCloseTo(2.5);
  });

  it('fits a box with true aspect ratio (one scale for x and y)', () => {
    const v = fitView({ x0: 0, x1: 10, y0: 0, y1: 2 }, size, 0);
    expect(v.scale).toBe(80);
    expect(v.cx).toBe(5);
  });

  it('zooms about the cursor', () => {
    const v = { scale: 100, cx: 0, cy: 0 };
    const before = toUm(v, size, 600, 100);
    const z = zoomAt(v, size, 600, 100, 2);
    const after = toUm(z, size, 600, 100);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it('chooses 1-2-5 scale-bar steps', () => {
    expect(niceStep(0.7)).toBe(0.5);
    expect(niceStep(3)).toBe(2);
    expect(niceStep(10)).toBe(10);
    expect(scaleBar({ scale: 200, cx: 0, cy: 0 }).label).toBe('500 nm');
  });
});

const ctx = (over: Partial<SnapContext> = {}): SnapContext => ({ enabled: true, step: 0.01, threshold: 0.02, xs: [0], ys: [], ...over });

describe('snapping', () => {
  it('snaps to a nearby target, else to the grid, always to whole nm', () => {
    expect(snap(0.995, [1], ctx())).toBe(1);
    expect(snap(0.5049, [1], ctx())).toBe(0.5);
    expect(snap(0.12345, [], ctx({ enabled: false }))).toBe(0.123);
  });

  it('collects layer interfaces and other shapes’ edges as targets', () => {
    const p = buildTemplate('slot');
    const left = p.features.find((f) => f.name === 'Left rail')!;
    const t = snapTargets(p, left.id);
    expect(t.ys).toContain(-2); // top of the substrate
    expect(t.xs.some((x) => Math.abs(x - 0.05) < 1e-12)).toBe(true); // left edge of the right rail
  });
});

describe('drag handles', () => {
  const p = buildTemplate('sin-strip');
  const core = p.features.find((f) => f.name === 'Core') as RectFeature;
  const box = p.features.find((f) => f.name === 'BOX') as RectFeature;
  const free = ctx({ enabled: false });

  it('rect: dragging the right edge keeps the left edge fixed', () => {
    const left = core.x - core.width / 2;
    const r = applyDrag(core, 'r', 1.0, 0, 0, 0, free) as Partial<RectFeature>;
    expect(r.x! - r.width! / 2).toBeCloseTo(left, 9);
    expect(r.x! + r.width! / 2).toBeCloseTo(1.0, 9);
  });

  it('rect: dragging the bottom edge keeps the top fixed', () => {
    const top = core.y + core.height;
    const r = applyDrag(core, 'b', 0, core.y - 0.1, 0, 0, free) as Partial<RectFeature>;
    expect(r.y! + r.height!).toBeCloseTo(top, 9);
  });

  it('rect: an edge cannot cross the opposite edge (min 1 nm)', () => {
    const r = applyDrag(core, 'r', -5, 0, 0, 0, free) as Partial<RectFeature>;
    expect(r.width).toBe(0.001);
  });

  it('move snaps an edge onto a nearby target', () => {
    const left = core.x - core.width / 2;
    const r = applyDrag(core, 'move', 0, 0, -left - 0.6 + 0.005, 0, ctx({ xs: [-0.6], threshold: 0.02 }));
    expect(r.x! - core.width / 2).toBeCloseTo(-0.6, 9);
  });

  it('full-width layers: only top/bottom handles, and moving is vertical only', () => {
    expect(handlesFor(box).map((h) => h.name)).toEqual(['b', 't']);
    const r = applyDrag(box, 'move', 0, 0, 3, 0.5, free);
    expect(r).toEqual({ y: box.y + 0.5 });
    const t = applyDrag(box, 't', 0, 1, 0, 0, free) as Partial<RectFeature>;
    expect(t.height).toBeCloseTo(1 - box.y, 9);
  });

  it('trapezoid: width handles are symmetric about the centre', () => {
    const q = buildTemplate('ln-ridge');
    const t = q.features.find((f) => f.kind === 'trapezoid') as TrapezoidFeature;
    const r = applyDrag(t, 'tr', t.x + 0.8, 0, 0, 0, free) as Partial<TrapezoidFeature>;
    expect(r.widthTop).toBeCloseTo(1.6, 9);
  });

  it('every shape in every template has handles', () => {
    for (const id of ['sin-strip', 'ln-ridge', 'fibre', 'diffused']) {
      for (const f of buildTemplate(id).features) expect(handlesFor(f).length).toBeGreaterThan(0);
    }
  });
});

describe('profiles', () => {
  // A separable Gaussian in Ex on a 21 × 11 grid, centred off-middle in y.
  const nx = 21;
  const ny = 11;
  const x = Float64Array.from({ length: nx }, (_, i) => i - 10);
  const y = Float64Array.from({ length: ny }, (_, j) => j - 3);
  const re = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) re[j * nx + i] = Math.exp(-((x[i] / 4) ** 2) - (y[j] / 2) ** 2);
  const zero = new Float32Array(nx * ny);
  const mode = { fields: { Ex: { re, im: zero } } } as unknown as ModeResult;
  const grid = { x, y, nx, ny };

  it('for a separable field, marginals and peak cuts have the same shape', () => {
    const p = profiles(mode, grid, 'E2')!;
    for (let i = 0; i < nx; i++) expect(p.marginalX[i]).toBeCloseTo(p.cutX[i], 5);
    for (let j = 0; j < ny; j++) expect(p.marginalY[j]).toBeCloseTo(p.cutY[j], 5);
  });

  it('is normalised to 1 at the peak, which sits where the field does', () => {
    const p = profiles(mode, grid, 'Ex')!;
    expect(Math.max(...p.marginalX)).toBeCloseTo(1, 6);
    expect(p.cutX.indexOf(Math.max(...p.cutX))).toBe(10); // x = 0
    expect(p.cutY.indexOf(Math.max(...p.cutY))).toBe(3); // y = 0
  });

  it('returns null for a component the mode does not have', () => {
    expect(profiles(mode, grid, 'Hz')).toBeNull();
  });

  it('marks the 1/e² width of the cut: 2w for a Gaussian of 1/e² intensity radius w', () => {
    // I(x) = exp(−2x²/w²) with w = 3, sampled every 0.25.
    const xs = Float64Array.from({ length: 81 }, (_, i) => (i - 40) * 0.25);
    const cut = Float32Array.from(xs, (v) => Math.exp((-2 * v * v) / 9));
    const [a, b] = e2Extent(cut, xs)!;
    expect(b - a).toBeCloseTo(6, 1);
    expect((a + b) / 2).toBeCloseTo(0, 6);
    expect(e2Extent(new Float32Array(5), Float64Array.from([0, 1, 2, 3, 4]))).toBeNull();
  });

  it('reports the same widths through profiles()', () => {
    const p = profiles(mode, grid, 'E2')!;
    // |E|² ∝ exp(−2x²/16): 1/e² intensity radius 4 → width 8 (sampled every 1, so approximate).
    expect(p.widthX![1] - p.widthX![0]).toBeCloseTo(8, 0);
  });
});
