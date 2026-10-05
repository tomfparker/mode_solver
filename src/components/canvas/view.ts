// Canvas view transform: µm (y up) ⇄ screen px (y down). True aspect ratio: one scale for x and y.

import type { Box } from '../../geometry/geometry';

export interface View {
  scale: number; // px per µm
  cx: number; // µm at the centre of the canvas
  cy: number;
}

export interface Size {
  w: number;
  h: number;
}

export function toPx(v: View, s: Size, x: number, y: number): [number, number] {
  return [s.w / 2 + (x - v.cx) * v.scale, s.h / 2 - (y - v.cy) * v.scale];
}

export function toUm(v: View, s: Size, px: number, py: number): [number, number] {
  return [v.cx + (px - s.w / 2) / v.scale, v.cy - (py - s.h / 2) / v.scale];
}

/** View that fits `box` with a margin, keeping true aspect ratio. */
export function fitView(box: Box, s: Size, marginPx = 32): View {
  const bw = Math.max(box.x1 - box.x0, 1e-3);
  const bh = Math.max(box.y1 - box.y0, 1e-3);
  const scale = Math.min((s.w - 2 * marginPx) / bw, (s.h - 2 * marginPx) / bh);
  return { scale: Math.max(scale, 1e-3), cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2 };
}

/** Zoom by `factor` keeping the µm point under (px, py) fixed. */
export function zoomAt(v: View, s: Size, px: number, py: number, factor: number): View {
  const [ux, uy] = toUm(v, s, px, py);
  const scale = Math.min(Math.max(v.scale * factor, 0.5), 1e6);
  return { scale, cx: ux - (px - s.w / 2) / scale, cy: uy + (py - s.h / 2) / scale };
}

/** Largest 1-2-5 step (µm) not exceeding `maxUm`, never below 1 nm. */
export function niceStep(maxUm: number): number {
  const m = Math.max(maxUm, 1e-3);
  const p = 10 ** Math.floor(Math.log10(m));
  for (const f of [5, 2, 1]) if (f * p <= m) return f * p;
  return p;
}

/** Scale-bar length (µm) for a bar of at most `maxPx` pixels, plus its label. */
export function scaleBar(v: View, maxPx = 120): { um: number; px: number; label: string } {
  const um = niceStep(maxPx / v.scale);
  const label = um < 1 ? `${Math.round(um * 1000)} nm` : `${um} µm`;
  return { um, px: um * v.scale, label };
}
