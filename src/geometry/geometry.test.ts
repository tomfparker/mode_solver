import { compressToEncodedURIComponent } from 'lz-string';
import { describe, expect, it } from 'vitest';
import { decodeHash } from '../state/url';
import { indexAtPoint, materialAt, solveDomain, structureBox } from './geometry';
import { MIGRATED_SUBSTRATE_DEPTH } from './schema';
import { buildTemplate } from './templates';
import type { RectFeature } from './types';

describe('background + shapes', () => {
  const p = buildTemplate('sin-strip');

  it('background fills the plane where there is no shape', () => {
    expect(materialAt(p, 0, 50).use.material).toBe('SiO2');
  });

  it('full-width layers span any x', () => {
    expect(materialAt(p, 1e3, -10).use.material).toBe('Si');
  });

  it('later shapes win where shapes overlap', () => {
    const q = structuredClone(p);
    q.features.push({ id: 'z', name: 'Top', kind: 'rect', material: 'Air', x: 0, y: 0, width: 0.2, height: 0.2 });
    expect(materialAt(q, 0, 0.1).use.material).toBe('Air');
    expect(materialAt(q, 0.4, 0.1).use.material).toBe('Si3N4');
  });

  it('the window is sized from finite shapes, not from deep full-width layers', () => {
    const b = structureBox(p);
    expect(b).toEqual({ x0: -0.6, x1: 0.6, y0: 0, y1: 0.8 });
    const d = solveDomain(p);
    expect(d.y0).toBeGreaterThan(-4); // the substrate (top at −4 µm) is not pulled in
  });

  it('graded index adds Δn on top of whatever is there', () => {
    const q = buildTemplate('diffused');
    expect(indexAtPoint(q, 0, -0.01)).toBeGreaterThan(indexAtPoint(q, 20, -0.01));
    expect(indexAtPoint(q, 0, 0.5)).toBeCloseTo(1, 3); // air above the surface
  });
});

describe('v1 links (layer stack) are migrated', () => {
  const v1 = {
    version: 1,
    name: 'Old',
    wavelength: 1.55,
    stack: {
      substrate: { material: 'Si' },
      layers: [{ id: 'box', name: 'BOX', material: 'SiO2', thickness: 3 }],
      cladding: { material: 'Air' },
    },
    features: [{ id: 'c', name: 'Core', kind: 'rect', material: 'Si3N4', anchor: 'box', x: 0, y: 0.1, width: 1, height: 0.5 }],
    customMaterials: [],
    settings: { solverKind: 'auto', meshStep: 'auto', padding: 'auto', boundary: 'auto', numModes: 4, nGuess: 'auto' },
  };

  it('to background + full-width layers + absolute shapes', () => {
    const r = decodeHash('#p=' + compressToEncodedURIComponent(JSON.stringify(v1)));
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    const p = r.project;
    expect(p.version).toBe(2);
    expect(p.background).toEqual({ material: 'Air' });
    const [sub, box, core] = p.features as RectFeature[];
    expect(sub).toMatchObject({ material: 'Si', fullWidth: true, y: -MIGRATED_SUBSTRATE_DEPTH, height: MIGRATED_SUBSTRATE_DEPTH });
    expect(box).toMatchObject({ material: 'SiO2', fullWidth: true, y: 0, height: 3 });
    expect(core).toMatchObject({ material: 'Si3N4', y: 3.1 });
    expect('anchor' in core).toBe(false);
  });
});
