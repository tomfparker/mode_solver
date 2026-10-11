// Project model. All lengths in µm; wavelength is the vacuum wavelength.
// Coordinates: x horizontal, y vertical (growth direction), z propagation. All shape
// coordinates are absolute.
//
// The structure is a background material filling the plane plus an ordered list of shapes.
// Later shapes are on top (they win where shapes overlap). Substrates, BOX layers and films
// are full-width rectangles: they span the whole plane horizontally.

import type { Axis, CustomMaterial } from '../materials/types';
import type { SolverKind } from '../solver/kinds';

export type { SolverKind };

export type MaterialRef = string; // library id ("SiO2") or custom id ("custom:…")

export interface MaterialUse {
  material: MaterialRef;
  /** Crystal optic axis in the lab frame. Only used for uniaxial materials. */
  opticAxis?: Axis;
}

interface ShapeBase extends MaterialUse {
  id: string;
  name: string;
  /** Index offset added to the material index (e.g. a doped fibre core). Default 0. */
  deltaN?: number;
  /** True while deltaN is a template's example value the user hasn't replaced yet. */
  deltaNIsExample?: boolean;
  /** Optional index gradient across the shape (diffused / exchanged regions). */
  gradient?: IndexGradient;
}

/**
 * An index change that varies across a shape along one axis, added to the shape's own index.
 * With d = distance into the shape from the chosen edge of its bounding box and L = `length`:
 *   exponential  Δn·exp(−d/L)          gaussian  Δn·exp(−(d/L)²)
 *   erfc         Δn·erfc(d/L)          linear    Δn·max(0, 1 − d/L)
 */
export interface IndexGradient {
  from: 'top' | 'bottom' | 'left' | 'right';
  profile: 'exponential' | 'gaussian' | 'erfc' | 'linear';
  /** Index change at the starting edge. */
  deltaN: number;
  /** Characteristic length L, µm. */
  length: number;
}

/** Rectangle. (x, y) = bottom-centre. With fullWidth it spans the whole plane horizontally (a layer). */
export interface RectFeature extends ShapeBase {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  fullWidth?: boolean;
}

/** Symmetric trapezoid (etched ridge). (x, y) = bottom-centre. */
export interface TrapezoidFeature extends ShapeBase {
  kind: 'trapezoid';
  x: number;
  y: number;
  widthBottom: number;
  widthTop: number;
  height: number;
}

/** Circle. (x, y) = centre. */
export interface CircleFeature extends ShapeBase {
  kind: 'circle';
  x: number;
  y: number;
  radius: number;
}

/** Polygon. Vertices relative to (x, y). */
export interface PolygonFeature extends ShapeBase {
  kind: 'polygon';
  x: number;
  y: number;
  points: [number, number][];
}

/**
 * Graded-index region (diffused / laser-written guides): adds Δn·f(x)·g(y) to whatever is
 * there. f is a Gaussian exp(−(x/wx)²), or an erf-broadened strip of `stripWidth` (in-diffused
 * stripe). g is a Gaussian exp(−(y/wy)²), or a half-Gaussian only below y (surface diffusion).
 */
export interface GradedFeature {
  kind: 'graded';
  id: string;
  name: string;
  x: number;
  y: number;
  deltaN: number;
  deltaNIsExample?: boolean;
  profileX: 'gaussian' | 'erf-strip';
  stripWidth: number;
  wx: number;
  wy: number;
  profileY: 'gaussian' | 'half-gaussian';
}

export type ShapeFeature = RectFeature | TrapezoidFeature | CircleFeature | PolygonFeature;
export type Feature = ShapeFeature | GradedFeature;
export type FeatureKind = Feature['kind'];

export type Auto<T> = T | 'auto';

/** Axis-aligned window, µm. */
export interface WindowBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Mesh presets (cell-size scale 2.0 / 1.3 / 0.8; see solver_py/modesolver/ui.py and docs/benchmarks-m2.md). */
export type MeshQuality = 'fast' | 'standard' | 'fine';

export interface SolverSettings {
  /**
   * Simulation window. A fixed box stays put while shapes are edited; 'auto' resizes it to the
   * structure plus `padding` on every change. Absent (older links) means 'auto'.
   */
  window?: Auto<WindowBox>;
  solverKind: Auto<SolverKind>;
  /** Mesh preset for the real solver (graded mesh). Absent means 'standard'. */
  meshQuality?: MeshQuality;
  /** Legacy uniform grid step, µm (used by the mock solver only). */
  meshStep: Auto<number>;
  /** Auto-sized window only: space between the structure and the window edge, µm. Auto grows with λ. */
  padding: Auto<number>;
  boundary: Auto<'pec' | 'pmc'>;
  numModes: number;
  /** Shift guess for the eigensolver. Auto: max index in the domain. */
  nGuess: Auto<number>;
}

export const PROJECT_VERSION = 2;

export interface Project {
  version: typeof PROJECT_VERSION;
  name: string;
  wavelength: number;
  /** Fills the whole plane wherever no shape is. */
  background: MaterialUse;
  /** Bottom → top: later shapes are drawn over (and replace) earlier ones. */
  features: Feature[];
  customMaterials: CustomMaterial[];
  /** Display colour overrides by material id ("#rrggbb"). Absent entries use the defaults. */
  materialColors?: Record<string, string>;
  settings: SolverSettings;
}
