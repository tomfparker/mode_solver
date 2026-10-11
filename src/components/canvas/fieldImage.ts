// Field → image and 1/e² contour.
// Colour rules (dataviz skill): |E|² is magnitude → single-hue blue ramp, light → dark, with
// near-zero fading to transparent so the geometry underneath stays readable. Signed components
// are polarity → diverging blue (−) / red (+) with a neutral (transparent) zero.

import { contours } from 'd3-contour';
import type { FieldView } from '../../state/store';
import type { FieldGrid, ModeResult } from '../../solver/types';

// Sequential blue ramp, steps 100 → 700 of the reference palette.
const BLUE = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
// Diverging arms: blue (negative) and red (positive), light → dark.
const NEG = ['#9ec5f4', '#3987e5', '#184f95'];
const POS = ['#f2a7a6', '#e34948', '#a8302f'];

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
const rgb = (ramp: string[]) => ramp.map(hex);
// Dark surfaces get their own order: magnitude runs dark → light so the peak stays brightest.
const RAMPS = {
  light: { seq: rgb(BLUE), neg: rgb(NEG), pos: rgb(POS) },
  dark: { seq: rgb([...BLUE].reverse()), neg: rgb([...NEG].reverse()), pos: rgb([...POS].reverse()) },
};

export function prefersDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

function ramp(stops: [number, number, number][], t: number): [number, number, number] {
  const u = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(u), stops.length - 2);
  const f = u - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
}

export interface FieldData {
  values: Float32Array; // normalised: [0,1] for intensity, [−1,1] for signed
  signed: boolean;
  /** Which part is shown for a component: real or imaginary (whichever is larger). */
  part?: 're' | 'im';
}

export function intensity(m: ModeResult): Float32Array {
  const parts = (['Ex', 'Ey', 'Ez'] as const).map((k) => m.fields[k]).filter(Boolean);
  const n = parts[0]?.re.length ?? 0;
  const out = new Float32Array(n);
  for (const f of parts) for (let i = 0; i < n; i++) out[i] += f!.re[i] ** 2 + f!.im[i] ** 2;
  return out;
}

export function fieldData(m: ModeResult, view: FieldView): FieldData | null {
  if (view === 'E2') {
    const I = intensity(m);
    let max = 0;
    for (const v of I) max = Math.max(max, v);
    return { values: I.map((v) => (max > 0 ? v / max : 0)), signed: false };
  }
  const f = m.fields[view];
  if (!f) return null;
  let maxRe = 0;
  let maxIm = 0;
  for (let i = 0; i < f.re.length; i++) {
    maxRe = Math.max(maxRe, Math.abs(f.re[i]));
    maxIm = Math.max(maxIm, Math.abs(f.im[i]));
  }
  const part = maxIm > maxRe ? 'im' : 're';
  const src = f[part];
  const max = Math.max(maxRe, maxIm);
  return { values: src.map((v) => (max > 0 ? v / max : 0)), signed: true, part };
}

export interface Crop {
  i0: number;
  i1: number; // exclusive
  j0: number;
  j1: number;
}

/** Square window around a mode's intensity centroid, ~2.4× its larger MFD (for thumbnails). */
export function modeCrop(m: ModeResult, g: FieldGrid): Crop {
  const I = intensity(m);
  let s = 0, sx = 0, sy = 0;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const v = I[j * g.nx + i];
      s += v; sx += v * g.x[i]; sy += v * g.y[j];
    }
  }
  if (s <= 0) return { i0: 0, i1: g.nx, j0: 0, j1: g.ny };
  const half = 1.2 * Math.max(m.mfd.x, m.mfd.y);
  const idx = (arr: Float64Array, v: number) => {
    let k = 0;
    while (k < arr.length - 1 && arr[k] < v) k++;
    return k;
  };
  return {
    i0: idx(g.x, sx / s - half),
    i1: idx(g.x, sx / s + half) + 1,
    j0: idx(g.y, sy / s - half),
    j1: idx(g.y, sy / s + half) + 1,
  };
}

/** Render to an RGBA canvas (row 0 = top = largest y) and return a data URL. */
export function fieldDataUrl(
  d: FieldData,
  g: FieldGrid,
  crop: Crop = { i0: 0, i1: g.nx, j0: 0, j1: g.ny },
  dark = prefersDark(),
): string {
  const R = RAMPS[dark ? 'dark' : 'light'];
  const w = crop.i1 - crop.i0;
  const h = crop.j1 - crop.j0;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let j = crop.j0; j < crop.j1; j++) {
    const row = crop.j1 - 1 - j;
    for (let i = crop.i0; i < crop.i1; i++) {
      const v = d.values[j * g.nx + i];
      const t = Math.abs(v);
      const col = d.signed ? ramp(v < 0 ? R.neg : R.pos, t) : ramp(R.seq, t);
      const k = (row * w + (i - crop.i0)) * 4;
      img.data[k] = col[0];
      img.data[k + 1] = col[1];
      img.data[k + 2] = col[2];
      img.data[k + 3] = Math.round(255 * Math.min(1, 2.2 * t));
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

export interface Profiles {
  /** Displayed quantity integrated over y, as a function of x (normalised to its maximum). */
  marginalX: Float32Array;
  /** Integrated over x, as a function of y. */
  marginalY: Float32Array;
  /** Cuts through the peak (row and column of the maximum), normalised to the peak. */
  cutX: Float32Array;
  cutY: Float32Array;
  /** 1/e² extent of each cut: [start, end] coordinates in µm (outermost crossings), or null. */
  widthX: [number, number] | null;
  widthY: [number, number] | null;
}

/**
 * Outermost points where a peak-normalised cut crosses 1/e² (linear interpolation between
 * samples). Same definition as the solver's MFD (solver_py/modesolver/fd.py).
 */
export function e2Extent(cut: Float32Array, coords: Float64Array): [number, number] | null {
  const level = Math.exp(-2);
  let a = -1;
  let b = -1;
  for (let i = 0; i < cut.length; i++) {
    if (cut[i] >= level) {
      if (a < 0) a = i;
      b = i;
    }
  }
  if (a < 0) return null;
  const half = (coords[1] - coords[0]) / 2;
  const edge = (inside: number, outside: number) => {
    if (outside < 0 || outside >= cut.length) return coords[inside] + (outside > inside ? half : -half);
    const t = (cut[inside] - level) / (cut[inside] - cut[outside]);
    return coords[inside] + t * (coords[outside] - coords[inside]);
  };
  return [edge(a, a - 1), edge(b, b + 1)];
}

/**
 * Marginal profiles and peak cuts of what the canvas shows: |E|² for the intensity view, or
 * the squared magnitude of the selected field component.
 */
export function profiles(m: ModeResult, g: FieldGrid, view: FieldView): Profiles | null {
  let q: Float32Array;
  if (view === 'E2') q = intensity(m);
  else {
    const f = m.fields[view];
    if (!f) return null;
    q = new Float32Array(f.re.length);
    for (let i = 0; i < q.length; i++) q[i] = f.re[i] ** 2 + f.im[i] ** 2;
  }
  const { nx, ny } = g;
  const marginalX = new Float32Array(nx);
  const marginalY = new Float32Array(ny);
  let peak = 0;
  let ip = 0;
  let jp = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = q[j * nx + i];
      marginalX[i] += v;
      marginalY[j] += v;
      if (v > peak) {
        peak = v;
        ip = i;
        jp = j;
      }
    }
  }
  if (peak <= 0) return null;
  const norm = (a: Float32Array) => {
    let mx = 0;
    for (const v of a) mx = Math.max(mx, v);
    return a.map((v) => v / mx);
  };
  const cutX = new Float32Array(nx);
  const cutY = new Float32Array(ny);
  for (let i = 0; i < nx; i++) cutX[i] = q[jp * nx + i] / peak;
  for (let j = 0; j < ny; j++) cutY[j] = q[j * nx + ip] / peak;
  return {
    marginalX: norm(marginalX), marginalY: norm(marginalY), cutX, cutY,
    widthX: e2Extent(cutX, g.x), widthY: e2Extent(cutY, g.y),
  };
}

/** 1/e² intensity contour as polylines in absolute µm. */
export function e2Contour(m: ModeResult, g: FieldGrid): [number, number][][] {
  const I = intensity(m);
  let max = 0;
  for (const v of I) max = Math.max(max, v);
  if (max <= 0) return [];
  const dx = g.x[1] - g.x[0];
  const dy = g.y[1] - g.y[0];
  // d3-contour treats values as samples at integer coordinates; map index → cell centre.
  const [c] = contours().size([g.nx, g.ny]).thresholds([max * Math.exp(-2)])(Array.from(I));
  const lines: [number, number][][] = [];
  for (const poly of c.coordinates) {
    for (const ring of poly) {
      lines.push(ring.map(([gx, gy]) => [g.x[0] + (gx - 0.5) * dx, g.y[0] + (gy - 0.5) * dy]));
    }
  }
  return lines;
}
