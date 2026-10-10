// Main-thread side of the Pyodide worker. Implements Solver; also exposes the M0 spike.

import { LatestWins } from './latestWins';
import type { FromWorker, ToWorker } from './protocol';
import { PYODIDE_BASE } from './pyodideConfig';
import { abortError, type Solver, type SolveRequest, type SolveResult, type SolverStatus } from './types';

interface Waiter {
  resolve: (r: SolveResult) => void;
  reject: (e: unknown) => void;
}

export class PyodideSolver implements Solver {
  readonly name = 'pyodide';
  private worker: Worker;
  private current: SolverStatus = { state: 'loading', stage: 'Starting', progress: 0 };
  private listeners = new Set<(s: SolverStatus) => void>();
  private waiters = new Map<string, Waiter>();
  private spikeWaiters = new Map<string, (r: SpikeResult) => void>();
  private interrupt?: Int32Array;
  private queue: LatestWins<SolveRequest, SolveResult>;

  constructor(pyodideBase = PYODIDE_BASE) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.handle(ev.data);
    // Mid-solve interrupts need SharedArrayBuffer, i.e. a cross-origin-isolated page.
    // On GitHub Pages this is false and cancellation is latest-wins only.
    let sab: SharedArrayBuffer | undefined;
    if (globalThis.crossOriginIsolated) {
      sab = new SharedArrayBuffer(4);
      this.interrupt = new Int32Array(sab);
    }
    this.send({ type: 'init', pyodideBase, interruptBuffer: sab });
    this.queue = new LatestWins((req, signal) => this.exec(req, signal));
  }

  get canInterrupt(): boolean {
    return this.interrupt !== undefined;
  }

  status(): SolverStatus {
    return this.current;
  }

  onStatus(cb: (s: SolverStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.current);
    return () => this.listeners.delete(cb);
  }

  solve(req: SolveRequest, signal?: AbortSignal): Promise<SolveResult> {
    return this.queue.submit(req, signal);
  }

  /** M0 feasibility spike: times sparse eigensolves inside Pyodide. */
  runSpike(sizes: number[], kinds: string[], repeats: number): Promise<SpikeResult> {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      this.spikeWaiters.set(id, resolve);
      this.send({ type: 'spike', id, sizes, kinds, repeats });
    });
  }

  dispose() {
    this.worker.terminate();
    this.listeners.clear();
  }

  /** Resolves once the Python runtime is loaded (rejects if loading failed). */
  private whenReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const off = this.onStatus((s) => {
        if (s.state === 'ready') resolve();
        else if (s.state === 'error') reject(new Error(s.message));
        else return;
        queueMicrotask(() => off());
      });
    });
  }

  private async exec(req: SolveRequest, signal: AbortSignal): Promise<SolveResult> {
    await this.whenReady();
    if (signal.aborted) throw abortError();
    return new Promise((resolve, reject) => {
      this.waiters.set(req.id, { resolve, reject });
      signal.addEventListener(
        'abort',
        () => {
          // Ask Python to raise KeyboardInterrupt (2 = SIGINT). Without SAB the solve runs
          // to completion and LatestWins discards its result.
          if (this.interrupt) Atomics.store(this.interrupt, 0, 2);
        },
        { once: true },
      );
      if (this.interrupt) Atomics.store(this.interrupt, 0, 0);
      this.send({ type: 'solve', req });
    });
  }

  private handle(msg: FromWorker) {
    switch (msg.type) {
      case 'status':
        this.current = msg.status;
        this.listeners.forEach((cb) => cb(msg.status));
        break;
      case 'solved': {
        const w = this.waiters.get(msg.result.requestId);
        this.waiters.delete(msg.result.requestId);
        w?.resolve(msg.result);
        break;
      }
      case 'solveError': {
        const w = this.waiters.get(msg.requestId);
        this.waiters.delete(msg.requestId);
        w?.reject(new Error(msg.message));
        break;
      }
      case 'spikeDone': {
        const w = this.spikeWaiters.get(msg.id);
        this.spikeWaiters.delete(msg.id);
        w?.({ results: JSON.parse(msg.json), transferMs: msg.transferMs, loadMs: msg.loadMs });
        break;
      }
    }
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }
}

export interface SpikeResult {
  results: Record<string, unknown>[];
  transferMs: number;
  loadMs: number;
}
