// Display colours for materials. Each material has a default; the project can override any of
// them (Project.materialColors), and the override travels with the share link.

import type { Project } from '../geometry/types';

/** Soft defaults for the library materials, chosen to stay readable under the field overlay. */
export const DEFAULT_MATERIAL_COLORS: Record<string, string> = {
  SiO2: '#cfd8e6',
  Si: '#8b8fa8',
  Si3N4: '#a9cdb9',
  LiNbO3: '#f0d9a0',
  Air: '#fbfaf6',
};

/** Defaults for anything else (custom materials), assigned in order of first use. */
const EXTRA = ['#e3b5a8', '#c9b8e0', '#b8dbe0', '#e6c7dd', '#d6dba8', '#bfc9a0'];

export function defaultMaterialColor(p: Project, id: string): string {
  if (DEFAULT_MATERIAL_COLORS[id]) return DEFAULT_MATERIAL_COLORS[id];
  const i = p.customMaterials.findIndex((m) => m.id === id);
  return EXTRA[(i < 0 ? 0 : i) % EXTRA.length];
}

export function materialColor(p: Project, id: string): string {
  return p.materialColors?.[id] ?? defaultMaterialColor(p, id);
}

/**
 * CSS fill for a region of `id`. A non-zero Δn (e.g. a doped core in the same glass as its
 * cladding) is tinted so it stays distinguishable. `--geo-dim` tones fills down in dark mode.
 */
export function materialFill(p: Project, id: string, deltaN = 0): string {
  const c = materialColor(p, id);
  const base = deltaN ? `color-mix(in oklab, ${c} 78%, #3e486b)` : c;
  return `color-mix(in oklab, ${base}, var(--surface) var(--geo-dim, 0%))`;
}
