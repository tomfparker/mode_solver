// Project model. All lengths in µm, wavelength is vacuum wavelength.
// M0: minimal shape so the Solver interface and mock can be typed. Extended (zod schema,
// URL versioning, graded features, coupling path) in M1.

export type MaterialRef = string; // id into the material library, e.g. "SiO2"

export interface Layer {
  id: string;
  name: string;
  material: MaterialRef;
  thickness: number; // µm
}

export interface LayerStack {
  substrate: MaterialRef; // semi-infinite below
  layers: Layer[]; // bottom → top
  cladding: MaterialRef; // semi-infinite above
}

interface FeatureBase {
  id: string;
  name: string;
  material: MaterialRef;
}

export interface RectFeature extends FeatureBase {
  kind: 'rect';
  cx: number;
  cy: number;
  width: number;
  height: number;
}

export type Feature = RectFeature;

export type SolverKind = 'scalar' | 'semivector-te' | 'semivector-tm' | 'fullvector';

export interface SolverSettings {
  solverKind: SolverKind | 'auto';
  numModes: number;
}

export interface Project {
  version: 1;
  wavelength: number; // µm
  stack: LayerStack;
  features: Feature[];
  settings: SolverSettings;
}
