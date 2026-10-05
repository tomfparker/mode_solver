// Drag handles and snapping for canvas editing. Pure functions: the canvas component turns
// pointer moves into calls to applyDrag, and the result is written to the same store fields
// the numeric inputs edit.

import { anchorY, featureBox, gradedExtent, layerBounds, shapePolygon } from '../../geometry/geometry';
import type { Feature, Project } from '../../geometry/types';
import { roundNm } from '../../state/units';

export interface Handle {
  name: string;
  x: number; // absolute µm
  y: number;
  cursor: string;
}

const MIN = 0.001; // 1 nm: smallest size a drag can produce

export function handlesFor(p: Project, f: Feature): Handle[] {
  const ay = anchorY(p, f.anchor);
  switch (f.kind) {
    case 'rect': {
      const y0 = ay + f.y;
      const ym = y0 + f.height / 2;
      return [
        { name: 'l', x: f.x - f.width / 2, y: ym, cursor: 'ew-resize' },
        { name: 'r', x: f.x + f.width / 2, y: ym, cursor: 'ew-resize' },
        { name: 'b', x: f.x, y: y0, cursor: 'ns-resize' },
        { name: 't', x: f.x, y: y0 + f.height, cursor: 'ns-resize' },
      ];
    }
    case 'trapezoid': {
      const y0 = ay + f.y;
      return [
        { name: 'bl', x: f.x - f.widthBottom / 2, y: y0, cursor: 'ew-resize' },
        { name: 'br', x: f.x + f.widthBottom / 2, y: y0, cursor: 'ew-resize' },
        { name: 'tl', x: f.x - f.widthTop / 2, y: y0 + f.height, cursor: 'ew-resize' },
        { name: 'tr', x: f.x + f.widthTop / 2, y: y0 + f.height, cursor: 'ew-resize' },
        { name: 't', x: f.x, y: y0 + f.height, cursor: 'ns-resize' },
      ];
    }
    case 'circle':
      return [{ name: 'r', x: f.x + f.radius, y: ay + f.y, cursor: 'ew-resize' }];
    case 'polygon':
      return shapePolygon(p, f)!.map(([x, y], i) => ({ name: `v${i}`, x, y, cursor: 'move' }));
    case 'graded': {
      const e = gradedExtent(f);
      const yc = ay + f.y;
      const hs: Handle[] = [
        { name: 'wx', x: f.x + e.hx, y: yc, cursor: 'ew-resize' },
        { name: 'wy', x: f.x, y: yc - f.wy, cursor: 'ns-resize' },
      ];
      if (f.profileX === 'erf-strip') hs.push({ name: 'strip', x: f.x + f.stripWidth / 2, y: yc - f.wy / 2, cursor: 'ew-resize' });
      return hs;
    }
  }
}

export interface SnapContext {
  enabled: boolean;
  /** Grid step, µm (zoom dependent). */
  step: number;
  /** Max distance to snap to a target, µm (zoom dependent). */
  threshold: number;
  xs: number[];
  ys: number[];
}

/** Snap targets: x = 0, layer interfaces, and the edges/centres of other features. */
export function snapTargets(p: Project, excludeId: string | null): { xs: number[]; ys: number[] } {
  const xs = [0];
  const ys = [0, ...layerBounds(p).map((b) => b.y1)];
  for (const f of p.features) {
    if (f.id === excludeId) continue;
    const b = featureBox(p, f);
    xs.push(b.x0, b.x1, (b.x0 + b.x1) / 2);
    ys.push(b.y0, b.y1);
  }
  return { xs, ys };
}

/** Snap a single coordinate: to a target if close, else to the grid. Always nm-rounded. */
export function snap(v: number, targets: number[], ctx: SnapContext): number {
  if (!ctx.enabled) return roundNm(v);
  let best = v;
  let bestD = ctx.threshold;
  for (const t of targets) {
    const d = Math.abs(t - v);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  if (best !== v) return roundNm(best);
  return roundNm(Math.round(v / ctx.step) * ctx.step);
}

/** Offset needed to snap the first of several candidate coordinates that lands near a target. */
function snapOffset(cands: number[], targets: number[], ctx: SnapContext): number {
  if (!ctx.enabled) return 0;
  let best = 0;
  let bestD = ctx.threshold;
  for (const c of cands) {
    for (const t of targets) {
      const d = Math.abs(t - c);
      if (d < bestD) {
        best = t - c;
        bestD = d;
      }
    }
  }
  if (bestD < ctx.threshold) return best;
  // No target nearby: snap the first candidate to the grid.
  return Math.round(cands[0] / ctx.step) * ctx.step - cands[0];
}

/**
 * New field values for `start` (the feature at drag start) after dragging `handle` to the
 * absolute point (px, py), or by (dx, dy) for a body move.
 */
export function applyDrag(
  p: Project,
  start: Feature,
  handle: string,
  px: number,
  py: number,
  dx: number,
  dy: number,
  ctx: SnapContext,
): Partial<Feature> {
  const ay = anchorY(p, start.anchor);

  if (handle === 'move') {
    const b = featureBox(p, start);
    const ox = snapOffset([b.x0 + dx, b.x1 + dx, (b.x0 + b.x1) / 2 + dx], ctx.xs, ctx);
    const oy = snapOffset([b.y0 + dy, b.y1 + dy], ctx.ys, ctx);
    return { x: roundNm(start.x + dx + ox), y: roundNm(start.y + dy + oy) };
  }

  const sx = () => snap(px, ctx.xs, ctx);
  const sy = () => snap(py, ctx.ys, ctx);

  switch (start.kind) {
    case 'rect': {
      const left = start.x - start.width / 2;
      const right = start.x + start.width / 2;
      const bottom = ay + start.y;
      const top = bottom + start.height;
      if (handle === 'l') {
        const l = Math.min(sx(), right - MIN);
        return { x: roundNm((l + right) / 2), width: roundNm(right - l) };
      }
      if (handle === 'r') {
        const r = Math.max(sx(), left + MIN);
        return { x: roundNm((left + r) / 2), width: roundNm(r - left) };
      }
      if (handle === 't') return { height: roundNm(Math.max(sy(), bottom + MIN) - bottom) };
      if (handle === 'b') {
        const b = Math.min(sy(), top - MIN);
        return { y: roundNm(b - ay), height: roundNm(top - b) };
      }
      return {};
    }
    case 'trapezoid': {
      const half = Math.max(Math.abs(sx() - start.x), MIN / 2);
      if (handle === 'bl' || handle === 'br') return { widthBottom: roundNm(2 * half) };
      if (handle === 'tl' || handle === 'tr') return { widthTop: roundNm(2 * half) };
      if (handle === 't') return { height: roundNm(Math.max(sy() - (ay + start.y), MIN)) };
      return {};
    }
    case 'circle':
      return { radius: roundNm(Math.max(Math.hypot(px - start.x, py - (ay + start.y)), MIN)) };
    case 'polygon': {
      const i = Number(handle.slice(1));
      const pts = start.points.map((q) => [...q] as [number, number]);
      pts[i] = [roundNm(sx() - start.x), roundNm(sy() - ay - start.y)];
      return { points: pts };
    }
    case 'graded': {
      const yc = ay + start.y;
      if (handle === 'wx') {
        const strip = start.profileX === 'erf-strip' ? start.stripWidth / 2 : 0;
        return { wx: roundNm(Math.max(sx() - start.x - strip, MIN)) };
      }
      if (handle === 'wy') return { wy: roundNm(Math.max(yc - sy(), MIN)) };
      if (handle === 'strip') return { stripWidth: roundNm(Math.max(2 * (sx() - start.x), 0)) };
      return {};
    }
  }
}

/** New thickness when dragging the top surface of layer `id` to absolute y. */
export function dragLayerTop(p: Project, id: string, py: number, ctx: SnapContext): number | null {
  const b = layerBounds(p).find((l) => l.layer.id === id);
  if (!b) return null;
  return roundNm(Math.max(snap(py, ctx.ys, ctx) - b.y0, MIN));
}
