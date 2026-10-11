import { compressToEncodedURIComponent } from 'lz-string';
import { describe, expect, it } from 'vitest';
import { buildTemplate } from '../geometry/templates';
import { decodeHash, encodeProject } from '../state/url';
import { DEFAULT_MATERIAL_COLORS, materialColor, materialFill } from './colors';

describe('material colours', () => {
  const p = buildTemplate('sin-strip');

  it('every library material has its own default colour', () => {
    const cols = Object.values(DEFAULT_MATERIAL_COLORS);
    expect(new Set(cols).size).toBe(cols.length);
    expect(materialColor(p, 'Si3N4')).toBe(DEFAULT_MATERIAL_COLORS.Si3N4);
  });

  it('a project override wins, and applies to that material only', () => {
    const q = { ...p, materialColors: { Si3N4: '#ff0000' } };
    expect(materialColor(q, 'Si3N4')).toBe('#ff0000');
    expect(materialColor(q, 'SiO2')).toBe(DEFAULT_MATERIAL_COLORS.SiO2);
  });

  it('custom materials get distinct defaults in order', () => {
    const q = structuredClone(p);
    q.customMaterials.push({ id: 'custom:a', name: 'A', n: 1.5, k: 0 }, { id: 'custom:b', name: 'B', n: 1.6, k: 0 });
    expect(materialColor(q, 'custom:a')).not.toBe(materialColor(q, 'custom:b'));
  });

  it('a non-zero Δn tints the fill so a doped core differs from its cladding', () => {
    expect(materialFill(p, 'SiO2', 0.005)).not.toBe(materialFill(p, 'SiO2'));
  });

  it('overrides survive the share link, and bad colours are rejected', () => {
    const q = { ...p, materialColors: { Si3N4: '#12ab34' } };
    const r = decodeHash('#' + encodeProject(q));
    expect(r.ok === true && r.project.materialColors).toEqual({ Si3N4: '#12ab34' });
    const bad = { ...p, materialColors: { Si3N4: 'red; background:url(x)' } };
    expect(decodeHash('#p=' + compressToEncodedURIComponent(JSON.stringify(bad))).ok).toBe(false);
  });
});
