import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../geometry/templates';
import { formatLength, parseLength, toDisplay } from './units';
import { decodeHash, encodeProject } from './url';
import { compressToEncodedURIComponent } from 'lz-string';

describe('parseLength', () => {
  it.each([
    ['450', 'nm', 0.45],
    ['450 nm', 'um', 0.45],
    ['450nm', 'um', 0.45],
    ['0.45', 'um', 0.45],
    ['0.45um', 'nm', 0.45],
    ['0.45 µm', 'nm', 0.45],
    ['0.45 μm', 'nm', 0.45],
    ['.5', 'um', 0.5],
    ['1e-3 mm', 'nm', 1],
    ['-20 nm', 'um', -0.02],
    ['  1.55  ', 'um', 1.55],
  ] as const)('%s (default %s) → %f µm', (text, unit, um) => {
    expect(parseLength(text, unit)).toBeCloseTo(um, 12);
  });

  it.each(['', 'abc', '1..2', '5 furlongs', 'nm'])('rejects %j', (t) => {
    expect(parseLength(t, 'um')).toBeNull();
  });
});

describe('display', () => {
  it('rounds to 0.1 nm and trims zeros', () => {
    expect(toDisplay(0.45, 'nm')).toBe('450');
    expect(toDisplay(0.12345, 'nm')).toBe('123.5');
    expect(toDisplay(1.2, 'um')).toBe('1.2');
    expect(toDisplay(0.0000001, 'um')).toBe('0');
    expect(formatLength(1.55, 'nm')).toBe('1550 nm');
  });
});

describe('URL round-trip', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s survives encode → decode', (_id, t) => {
    const p = t.build();
    const r = decodeHash('#' + encodeProject(p));
    expect(r.ok).toBe(true);
    if (r.ok === true) expect(r.project).toEqual(JSON.parse(JSON.stringify(p, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v))));
  });

  it('keeps links short for typical projects', () => {
    for (const t of TEMPLATES) expect(encodeProject(t.build()).length).toBeLessThan(1000);
  });

  it('reports an empty hash as empty, and garbage as an error', () => {
    expect(decodeHash('')).toEqual({ ok: 'empty' });
    expect(decodeHash('#p=%%%').ok).toBe(false);
  });

  it('rejects structurally invalid projects (schema-checked)', () => {
    const p = TEMPLATES[0].build() as unknown as Record<string, unknown>;
    const bad = { ...p, wavelength: -1 };
    const r = decodeHash('#p=' + compressToEncodedURIComponent(JSON.stringify(bad)));
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toContain('wavelength');
  });
});
