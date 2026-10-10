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

export interface SolverSettings {
  solverKind: Auto<SolverKind>;
  /** Grid step, µm. Auto: ~100 cells along the longer side of the domain. */
  meshStep: Auto<number>;
  /** Space between the structure and the window edge, µm. Auto grows with λ. */
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
  settings: SolverSettings;
}
