// The Solver interface. UI code depends only on this file, never on Pyodide.
// It must stay swappable for a future Rust→WASM backend. If it changes, update the mock
// solver and the worker together (CLAUDE.md).

import type { MeshQuality, Project, WindowBox } from '../geometry/types';
import type { SolverKind } from './kinds';

export type FieldComponent = 'Ex' | 'Ey' | 'Ez' | 'Hx' | 'Hy' | 'Hz';

export interface ComplexField {
  re: Float32Array; // row-major, length nx*ny, x fastest
  im: Float32Array;
}

export interface FieldGrid {
  x: Float64Array; // cell-centre coordinates, µm, length nx
  y: Float64Array; // length ny
  nx: number;
  ny: number;
}

export interface ModeResult {
  /** Effective index. Imaginary part is non-zero only for lossy materials (approximate until PML exists). */
  neff: { re: number; im: number };
  /** Group index, if computed (needs a λ derivative; may be absent). */
  ng?: number;
  /** 1/e² intensity diameters, µm. */
  mfd: { x: number; y: number };
  /** Effective area, µm². */
  aEff: number;
  /** Fraction of transverse power in Ex (0..1). TE-like ≈ 1 in our x-horizontal convention. */
  teFraction: number;
  /** Fields normalised to unit power: Re∫(E×H*)·ẑ dA / 2 = 1. Components may be omitted (e.g. scalar solve). */
  fields: Partial<Record<FieldComponent, ComplexField>>;
  /** Peak |E|² within the outer boundary cells relative to the global peak (0..1). Drives the boundary warning. */
  boundaryAmplitude: number;
  /** False for modes at or below cut-off, or living against the window walls (e.g. in a substrate slice). */
  guided: boolean;
  /** Second-moment (D4σ) diameters, µm: equal to `mfd` for a Gaussian. */
  mfdD4s?: { x: number; y: number };
}

export interface SolveRequest {
  /** Unique per request. Used for latest-wins bookkeeping and stale-result detection. */
  id: string;
  project: Project;
  /** Simulation window (resolved by the caller: fixed, or auto-sized to the structure). */
  window: WindowBox;
  meshQuality?: MeshQuality;
  numModes: number;
  /** Shift guess. Default: max index in the domain. Sweeps pass the previous mode's n_eff. */
  nGuess?: number;
}

export interface SolveResult {
  requestId: string;
  grid: FieldGrid;
  modes: ModeResult[]; // sorted by descending Re(n_eff)
  /** Rasterised refractive index (real part) on the grid, for overlays/debug. */
  indexMap?: Float32Array;
  diagnostics: {
    solverKind: SolverKind;
    timingsMs: Record<string, number>;
    notes: string[];
    /** Solver mesh actually used (cells, and the smallest cell size in µm). */
    mesh?: { nx: number; ny: number; minCell: number };
  };
  /** True when the numbers are not physical (mock solver). The UI must say so. */
  isMock: boolean;
}

export type SolverStatus =
  | { state: 'loading'; stage: string; progress: number } // progress 0..1
  | { state: 'ready' }
  | { state: 'error'; message: string };

/**
 * Cancellation contract:
 * - `solve` rejects with a DOMException named 'AbortError' if `signal` aborts or if a newer
 *   `solve` call supersedes it before it starts (latest wins).
 * - A solve already running may not stop immediately (no SharedArrayBuffer on static hosts
 *   like GitHub Pages); its result is then discarded and the promise still rejects.
 */
export interface Solver {
  readonly name: string;
  status(): SolverStatus;
  onStatus(cb: (s: SolverStatus) => void): () => void;
  solve(req: SolveRequest, signal?: AbortSignal): Promise<SolveResult>;
  dispose(): void;
}

export function abortError(message = 'Solve superseded or cancelled'): DOMException {
  return new DOMException(message, 'AbortError');
}

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}
