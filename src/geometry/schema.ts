// zod schema for Project: validates anything decoded from a URL before it reaches the store.

import { z } from 'zod';
import type { Project } from './types';

const finite = z.number().refine(Number.isFinite, 'must be finite');
const positive = finite.refine((v) => v > 0, 'must be > 0');
const nonneg = finite.refine((v) => v >= 0, 'must be ≥ 0');
const axis = z.enum(['x', 'y', 'z']);
const auto = <T extends z.ZodTypeAny>(t: T) => z.union([t, z.literal('auto')]);

const materialUse = { material: z.string().min(1), opticAxis: axis.optional() };

const layer = z.object({ id: z.string(), name: z.string(), thickness: positive, ...materialUse });

const shapeBase = {
  id: z.string(),
  name: z.string(),
  anchor: z.string(),
  deltaN: finite.optional(),
  deltaNIsExample: z.boolean().optional(),
  ...materialUse,
};

const feature = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rect'), x: finite, y: finite, width: positive, height: positive, ...shapeBase }),
  z.object({
    kind: z.literal('trapezoid'),
    x: finite,
    y: finite,
    widthBottom: nonneg,
    widthTop: nonneg,
    height: positive,
    ...shapeBase,
  }),
  z.object({ kind: z.literal('circle'), x: finite, y: finite, radius: positive, ...shapeBase }),
  z.object({
    kind: z.literal('polygon'),
    x: finite,
    y: finite,
    points: z.array(z.tuple([finite, finite])).min(3),
    ...shapeBase,
  }),
  z.object({
    kind: z.literal('graded'),
    id: z.string(),
    name: z.string(),
    anchor: z.string(),
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
  version: z.literal(1),
  name: z.string(),
  wavelength: positive,
  stack: z.object({
    substrate: z.object(materialUse),
    layers: z.array(layer),
    cladding: z.object(materialUse),
  }),
  features: z.array(feature),
  customMaterials: z.array(
    z.object({ id: z.string().startsWith('custom:'), name: z.string(), n: positive, k: nonneg }),
  ),
  settings: z.object({
    solverKind: auto(z.enum(['scalar', 'semivector-te', 'semivector-tm', 'fullvector'])),
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

/** Bring an older decoded object up to the current version. No older versions exist yet. */
export function migrate(raw: unknown): unknown {
  return raw;
}

export function parseProject(raw: unknown): { ok: true; project: Project } | { ok: false; error: string } {
  const r = projectSchema.safeParse(migrate(raw));
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { ok: true, project: r.data as Project };
}
