// zod schema for Project: validates anything decoded from a URL before it reaches the store.

import { z } from 'zod';
import type { Project } from './types';

const finite = z.number().refine(Number.isFinite, 'must be finite');
const positive = finite.refine((v) => v > 0, 'must be > 0');
const nonneg = finite.refine((v) => v >= 0, 'must be ≥ 0');
const axis = z.enum(['x', 'y', 'z']);
const auto = <T extends z.ZodTypeAny>(t: T) => z.union([t, z.literal('auto')]);

const materialUse = { material: z.string().min(1), opticAxis: axis.optional() };

const gradient = z.object({
  from: z.enum(['top', 'bottom', 'left', 'right']),
  profile: z.enum(['exponential', 'gaussian', 'erfc', 'linear']),
  deltaN: finite,
  length: positive,
});

const shapeBase = {
  id: z.string(),
  name: z.string(),
  deltaN: finite.optional(),
  deltaNIsExample: z.boolean().optional(),
  gradient: gradient.optional(),
  ...materialUse,
};

const feature = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rect'), x: finite, y: finite, width: positive, height: positive,
    fullWidth: z.boolean().optional(), ...shapeBase,
  }),
  z.object({
    kind: z.literal('trapezoid'), x: finite, y: finite, widthBottom: nonneg, widthTop: nonneg, height: positive, ...shapeBase,
  }),
  z.object({ kind: z.literal('circle'), x: finite, y: finite, radius: positive, ...shapeBase }),
  z.object({ kind: z.literal('polygon'), x: finite, y: finite, points: z.array(z.tuple([finite, finite])).min(3), ...shapeBase }),
  z.object({
    kind: z.literal('graded'),
    id: z.string(),
    name: z.string(),
    x: finite,
    y: finite,
    deltaN: finite,
    deltaNIsExample: z.boolean().optional(),
    profileX: z.enum(['gaussian', 'erf-strip']),
    stripWidth: nonneg,
    wx: positive,
    wy: positive,
    profileY: z.enum(['gaussian', 'half-gaussian']),
  }),
]);

export const projectSchema = z.object({
  version: z.literal(2),
  name: z.string(),
  wavelength: positive,
  background: z.object(materialUse),
  features: z.array(feature),
  customMaterials: z.array(z.object({ id: z.string().startsWith('custom:'), name: z.string(), n: positive, k: nonneg })),
  materialColors: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
  settings: z.object({
    window: auto(
      z
        .object({ x0: finite, x1: finite, y0: finite, y1: finite })
        .refine((b) => b.x1 > b.x0 && b.y1 > b.y0, 'window must have positive width and height'),
    ).optional(),
    solverKind: auto(z.enum(['scalar', 'semivector-te', 'semivector-tm', 'fullvector'])),
    meshQuality: z.enum(['fast', 'standard', 'fine']).optional(),
    meshStep: auto(positive),
    padding: auto(positive),
    boundary: auto(z.enum(['pec', 'pmc'])),
    numModes: z.number().int().min(1).max(12),
    nGuess: auto(positive),
  }),
});

// Compile-time check that the schema and the hand-written types agree.
type Parsed = z.infer<typeof projectSchema>;
export const _typecheck: [Parsed extends Project ? true : never, Project extends Parsed ? true : never] = [true, true];

/** Depth given to a migrated semi-infinite substrate: far beyond any solve window. */
export const MIGRATED_SUBSTRATE_DEPTH = 100;

type Obj = Record<string, unknown>;

/**
 * v1 → v2: the layer stack becomes shapes. Cladding → background; substrate → a full-width
 * rectangle below y = 0; layers → full-width rectangles; anchored shapes → absolute y.
 */
function migrateV1(raw: Obj): Obj {
  const stack = raw.stack as { substrate: Obj; layers: (Obj & { id: string; thickness: number; name: string })[]; cladding: Obj };
  const tops = new Map<string, number>();
  let y = 0;
  const layerShapes: Obj[] = [];
  for (const l of stack.layers) {
    layerShapes.push({
      kind: 'rect', id: l.id, name: l.name, material: l.material, opticAxis: l.opticAxis,
      x: 0, y, width: 10, height: l.thickness, fullWidth: true,
    });
    y += l.thickness;
    tops.set(l.id, y);
  }
  const substrate = {
    kind: 'rect', id: 'substrate', name: 'Substrate', ...stack.substrate,
    x: 0, y: -MIGRATED_SUBSTRATE_DEPTH, width: 10, height: MIGRATED_SUBSTRATE_DEPTH, fullWidth: true,
  };
  const features = (raw.features as (Obj & { anchor: string; y: number })[]).map(({ anchor, ...f }) => ({
    ...f,
    y: f.y + (tops.get(anchor) ?? 0),
  }));
  const { stack: _s, ...rest } = raw;
  void _s;
  return { ...rest, version: 2, background: stack.cladding, features: [substrate, ...layerShapes, ...features] };
}

/** Bring an older decoded object up to the current version. */
export function migrate(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && (raw as Obj).version === 1 && (raw as Obj).stack) return migrateV1(raw as Obj);
  return raw;
}

export function parseProject(raw: unknown): { ok: true; project: Project } | { ok: false; error: string } {
  const r = projectSchema.safeParse(migrate(raw));
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { ok: true, project: r.data as Project };
}
