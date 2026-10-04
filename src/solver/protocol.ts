// Messages between the main thread (workerClient) and the Pyodide worker.

import type { SolveRequest, SolveResult, SolverStatus } from './types';

export type ToWorker =
  | { type: 'init'; pyodideBase: string; interruptBuffer?: SharedArrayBuffer }
  | { type: 'solve'; req: SolveRequest }
  | { type: 'spike'; id: string; sizes: number[]; kinds: string[]; repeats: number };

export type FromWorker =
  | { type: 'status'; status: SolverStatus }
  | { type: 'solved'; result: SolveResult }
  | { type: 'solveError'; requestId: string; message: string; interrupted: boolean }
  | { type: 'spikeDone'; id: string; json: string; transferMs: number; loadMs: number };
