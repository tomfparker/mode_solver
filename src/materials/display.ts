// Display helpers for materials: index summaries and source tooltips/links.

import { fmtIndex } from '../state/format';
import { indexAt, materialInfo } from './library';
import type { CustomMaterial } from './types';

/** Short source summary for tooltips: "Malitson 1965 (doi…)". */
export function sourceTitle(id: string, custom: CustomMaterial[]): string {
  const info = materialInfo(id, custom);
  if (!info) return 'Unknown material';
  if (info.kind === 'custom') return 'User-entered constant index (no dispersion, no source)';
  return info.sources
    .map((s) => `${s.citation}${s.conditions ? ` — ${s.conditions}` : ''} [${s.url}]`)
    .join('\n');
}

export function sourceHref(id: string, custom: CustomMaterial[]): string | undefined {
  const s = materialInfo(id, custom)?.sources[0];
  return s ? (s.doi ? `https://doi.org/${s.doi}` : s.url) : undefined;
}

/** "1.4440" or "n_o 2.2111 / n_e 2.1376" at the current wavelength. */
export function indexSummary(id: string, lambda: number, custom: CustomMaterial[]): string {
  const info = materialInfo(id, custom);
  if (!info) return '?';
  if (info.kind === 'uniaxial') {
    const no = indexAt(id, lambda, custom, 'x', 'z')!.n;
    const ne = indexAt(id, lambda, custom, 'z', 'z')!.n;
    return `n_o ${fmtIndex(no)} / n_e ${fmtIndex(ne)}`;
  }
  const v = indexAt(id, lambda, custom)!;
  return v.k > 0 ? `${fmtIndex(v.n)} + ${v.k}i` : fmtIndex(v.n);
}
