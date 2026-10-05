/** Neutral grey that darkens with refractive index (used by the canvas and the layer list). */
export function geoFill(n: number): string {
  const t = Math.min(Math.max((n - 1) / 2.6, 0), 1);
  return `color-mix(in oklab, var(--geo-hi) ${Math.round(t * 100)}%, var(--geo-lo))`;
}
