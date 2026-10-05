// Geometry helpers shared by the canvas, the mock solver and (later) the rasteriser.

import { indexAt, maxIndexAt } from '../materials/library';
import type { Axis } from '../materials/types';
import type { Anchor, Feature, GradedFeature, Layer, MaterialUse, Project, ShapeFeature } from './types';

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36).slice(-4)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** y of the top surface of each layer (bottom → top), with the layer's bottom. */
export function layerBounds(p: Project): { layer: Layer; y0: number; y1: number }[] {
  let y = 0;
  return p.stack.layers.map((layer) => {
    const y0 = y;
    y += layer.thickness;
    return { layer, y0, y1: y };
  });
}

export function stackTop(p: Project): number {
  return p.stack.layers.reduce((s, l) => s + l.thickness, 0);
}

/** Absolute y of an anchor surface. Unknown anchors (e.g. a deleted layer) fall back to 0. */
export function anchorY(p: Project, anchor: Anchor): number {
  if (anchor === 'substrate') return 0;
  const b = layerBounds(p).find((l) => l.layer.id === anchor);
  return b ? b.y1 : 0;
}

export function anchorLabel(p: Project, anchor: Anchor): string {
  if (anchor === 'substrate') return 'substrate';
  return p.stack.layers.find((l) => l.id === anchor)?.name ?? 'substrate';
}

/** Outline of a polygonal shape in absolute coordinates (counter-clockwise). Circles return null. */
export function shapePolygon(p: Project, f: ShapeFeature): [number, number][] | null {
  const ay = anchorY(p, f.anchor);
  switch (f.kind) {
    case 'rect': {
      const y0 = ay + f.y;
      return [
        [f.x - f.width / 2, y0],
        [f.x + f.width / 2, y0],
        [f.x + f.width / 2, y0 + f.height],
        [f.x - f.width / 2, y0 + f.height],
      ];
    }
    case 'trapezoid': {
      const y0 = ay + f.y;
      return [
        [f.x - f.widthBottom / 2, y0],
        [f.x + f.widthBottom / 2, y0],
        [f.x + f.widthTop / 2, y0 + f.height],
        [f.x - f.widthTop / 2, y0 + f.height],
      ];
    }
    case 'polygon':
      return f.points.map(([px, py]) => [f.x + px, ay + f.y + py]);
    case 'circle':
      return null;
  }
}

/** Extent of the graded region drawn on the canvas: where Δn falls to 1/e of its peak. */
export function gradedExtent(f: GradedFeature): { hx: number; hyUp: number; hyDown: number } {
  const hx = (f.profileX === 'erf-strip' ? f.stripWidth / 2 : 0) + f.wx;
  return { hx, hyUp: f.profileY === 'half-gaussian' ? 0 : f.wy, hyDown: f.wy };
}

export function featureBox(p: Project, f: Feature): Box {
  const ay = anchorY(p, f.anchor);
  if (f.kind === 'circle') return { x0: f.x - f.radius, x1: f.x + f.radius, y0: ay + f.y - f.radius, y1: ay + f.y + f.radius };
  if (f.kind === 'graded') {
    const e = gradedExtent(f);
    return { x0: f.x - e.hx, x1: f.x + e.hx, y0: ay + f.y - e.hyDown, y1: ay + f.y + e.hyUp };
  }
  const poly = shapePolygon(p, f)!;
  const xs = poly.map((q) => q[0]);
  const ys = poly.map((q) => q[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  return boxes.reduce((a, b) => ({
    x0: Math.min(a.x0, b.x0),
    x1: Math.max(a.x1, b.x1),
    y0: Math.min(a.y0, b.y0),
    y1: Math.max(a.y1, b.y1),
  }));
}

/** Bounding box of the guiding structure: all features, or the finite layers if there are none. */
export function structureBox(p: Project): Box {
  const fb = unionBox(p.features.map((f) => featureBox(p, f)));
  if (fb) return fb;
  const top = stackTop(p);
  return { x0: -1, x1: 1, y0: 0, y1: Math.max(top, 0.1) };
}

/** Auto padding grows with λ and with the structure size (big cores have big modes). */
export function effectivePadding(p: Project): number {
  if (p.settings.padding !== 'auto') return p.settings.padding;
  const b = structureBox(p);
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  return Math.max(1.0, 1.5 * p.wavelength, 0.75 * size);
}

/** Simulation window: the structure plus padding on every side. */
export function solveDomain(p: Project): Box {
  const b = structureBox(p);
  const pad = effectivePadding(p);
  return { x0: b.x0 - pad, x1: b.x1 + pad, y0: b.y0 - pad, y1: b.y1 + pad };
}

/** Grid step: ~100 cells along the longer side (the M0 performance budget) unless overridden. */
export function effectiveMeshStep(p: Project): number {
  if (p.settings.meshStep !== 'auto') return p.settings.meshStep;
  const d = solveDomain(p);
  return Math.max(d.x1 - d.x0, d.y1 - d.y0) / 100;
}

function inPolygon(poly: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function insideShape(p: Project, f: ShapeFeature, x: number, y: number): boolean {
  if (f.kind === 'circle') {
    const cy = anchorY(p, f.anchor) + f.y;
    return (x - f.x) ** 2 + (y - cy) ** 2 <= f.radius ** 2;
  }
  return inPolygon(shapePolygon(p, f)!, x, y);
}

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7), adequate for profile shapes.
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return s * (1 - poly * Math.exp(-a * a));
}

/** Δn contributed by a graded feature at (x, y). */
export function gradedDeltaN(p: Project, f: GradedFeature, x: number, y: number): number {
  const u = x - f.x;
  const v = y - (anchorY(p, f.anchor) + f.y);
  const fx =
    f.profileX === 'gaussian'
      ? Math.exp(-((u / f.wx) ** 2))
      : 0.5 * (erf((f.stripWidth / 2 + u) / f.wx) + erf((f.stripWidth / 2 - u) / f.wx)) /
        erf(f.stripWidth / 2 / f.wx || 1e-9);
  if (f.profileY === 'half-gaussian' && v > 0) return 0;
  return f.deltaN * fx * Math.exp(-((v / f.wy) ** 2));
}

/** The material (and Δn) occupying a point, ignoring graded features. */
export function materialAt(p: Project, x: number, y: number): { use: MaterialUse; deltaN: number; owner: string } {
  let use: MaterialUse = p.stack.cladding;
  let owner = 'cladding';
  if (y < 0) {
    use = p.stack.substrate;
    owner = 'substrate';
  } else {
    for (const b of layerBounds(p)) {
      if (y >= b.y0 && y < b.y1) {
        use = b.layer;
        owner = b.layer.id;
        break;
      }
    }
  }
  let deltaN = 0;
  for (const f of p.features) {
    if (f.kind !== 'graded' && insideShape(p, f, x, y)) {
      use = f;
      owner = f.id;
      deltaN = f.deltaN ?? 0;
    }
  }
  return { use, deltaN, owner };
}

/** Refractive index (real part) at a point for a field polarised along `axis`. */
export function indexAtPoint(p: Project, x: number, y: number, axis: Axis = 'x'): number {
  const { use, deltaN } = materialAt(p, x, y);
  let n = (indexAt(use.material, p.wavelength, p.customMaterials, axis, use.opticAxis ?? 'z')?.n ?? 1) + deltaN;
  for (const f of p.features) if (f.kind === 'graded') n += gradedDeltaN(p, f, x, y);
  return n;
}

/** Every material referenced by the project (for range/provenance warnings). */
export function usedMaterials(p: Project): MaterialUse[] {
  const uses: MaterialUse[] = [p.stack.substrate, ...p.stack.layers, p.stack.cladding];
  for (const f of p.features) if (f.kind !== 'graded') uses.push(f);
  return uses;
}

/** Highest refractive index anywhere in the structure: the default eigensolver shift guess. */
export function maxIndex(p: Project): number {
  let n = 1;
  for (const u of usedMaterials(p)) {
    const dn = 'deltaN' in u ? ((u as { deltaN?: number }).deltaN ?? 0) : 0;
    n = Math.max(n, maxIndexAt(u.material, p.wavelength, p.customMaterials) + Math.max(dn, 0));
  }
  for (const f of p.features) {
    if (f.kind === 'graded') {
      const host = materialAt(p, f.x, anchorY(p, f.anchor) + f.y - 1e-6).use;
      n = Math.max(n, maxIndexAt(host.material, p.wavelength, p.customMaterials) + Math.max(f.deltaN, 0));
    }
  }
  return n;
}
