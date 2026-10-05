// Material library: sourced data from data/materials/*.json plus the project's custom materials.

import { evaluate } from './dispersion';
import type { Axis, CustomMaterial, Dispersion, IndexValue, MaterialData, Source } from './types';

const files = import.meta.glob('../../data/materials/*.json', { eager: true, import: 'default' }) as Record<
  string,
  MaterialData
>;

/** Library materials in a fixed display order (unknown ids go last). */
const ORDER = ['SiO2', 'Si', 'Si3N4', 'LiNbO3', 'Air'];
export const LIBRARY: MaterialData[] = Object.values(files).sort(
  (a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99),
);
const byId = new Map(LIBRARY.map((m) => [m.id, m]));

export function libraryMaterial(id: string): MaterialData | undefined {
  return byId.get(id);
}

export function isCustomId(id: string): boolean {
  return id.startsWith('custom:');
}

export interface MaterialInfo {
  id: string;
  name: string;
  kind: 'isotropic' | 'uniaxial' | 'custom';
  sources: Source[];
}

export function materialInfo(id: string, custom: CustomMaterial[]): MaterialInfo | undefined {
  const c = custom.find((m) => m.id === id);
  if (c) return { id, name: c.name, kind: 'custom', sources: [] };
  const m = byId.get(id);
  if (!m) return undefined;
  const sources = m.kind === 'isotropic' ? [m.n.source] : [m.ordinary.source, m.extraordinary.source];
  return { id, name: m.name, kind: m.kind, sources };
}

/**
 * Index seen by a field polarised along `axis` (lab frame: x horizontal, y vertical, z propagation).
 * Uniaxial materials use n_e when `axis` equals the crystal optic axis, else n_o.
 * Returns undefined for unknown ids.
 */
export function indexAt(
  id: string,
  lambda: number,
  custom: CustomMaterial[],
  axis: Axis = 'x',
  opticAxis: Axis = 'z',
): IndexValue | undefined {
  const c = custom.find((m) => m.id === id);
  if (c) return { n: c.n, k: c.k, inRange: true };
  const m = byId.get(id);
  if (!m) return undefined;
  const d: Dispersion = m.kind === 'isotropic' ? m.n : axis === opticAxis ? m.extraordinary : m.ordinary;
  const { n, inRange } = evaluate(d, lambda);
  return { n, k: 0, inRange, range: d.range };
}

/** Largest principal index of a material at λ (for uniaxial: max(n_o, n_e)). */
export function maxIndexAt(id: string, lambda: number, custom: CustomMaterial[]): number {
  const vals = (['x', 'y', 'z'] as Axis[]).map((a) => indexAt(id, lambda, custom, a, 'z')?.n ?? 1);
  return Math.max(...vals);
}
