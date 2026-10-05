// Evaluate refractiveindex.info dispersion formulas. Definitions are from the database's
// "Dispersion formulas" document (see data/materials/refractiveindex/README.md). λ in µm.

import type { Dispersion } from './types';

/** Refractive index n(λ) and whether λ lies within the source's published range. */
export function evaluate(d: Dispersion, lambda: number): { n: number; inRange: boolean } {
  const inRange = lambda >= d.range[0] && lambda <= d.range[1];
  switch (d.model) {
    case 'sellmeier1':
    case 'sellmeier2': {
      // n² − 1 = C1 + Σ C_{2i} λ² / (λ² − P_i), P_i = C_{2i+1}² (formula 1) or C_{2i+1} (formula 2)
      const c = d.coefficients;
      const l2 = lambda * lambda;
      let n2m1 = c[0];
      for (let i = 1; i + 1 < c.length; i += 2) {
        const pole = d.model === 'sellmeier1' ? c[i + 1] * c[i + 1] : c[i + 1];
        n2m1 += (c[i] * l2) / (l2 - pole);
      }
      return { n: Math.sqrt(1 + n2m1), inRange };
    }
    case 'gases': {
      // n − 1 = C1 + Σ C_{2i} / (C_{2i+1} − λ⁻²)
      const c = d.coefficients;
      const il2 = 1 / (lambda * lambda);
      let nm1 = c[0];
      for (let i = 1; i + 1 < c.length; i += 2) nm1 += c[i] / (c[i + 1] - il2);
      return { n: 1 + nm1, inRange };
    }
    case 'tabulated': {
      // Linear interpolation; clamped to the end values outside the table.
      const t = d.table;
      if (lambda <= t[0][0]) return { n: t[0][1], inRange };
      if (lambda >= t[t.length - 1][0]) return { n: t[t.length - 1][1], inRange };
      let lo = 0;
      let hi = t.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (t[mid][0] <= lambda) lo = mid;
        else hi = mid;
      }
      const f = (lambda - t[lo][0]) / (t[hi][0] - t[lo][0]);
      return { n: t[lo][1] + f * (t[hi][1] - t[lo][1]), inRange };
    }
  }
}
