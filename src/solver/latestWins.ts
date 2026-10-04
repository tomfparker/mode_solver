// Latest-wins scheduler shared by all Solver implementations.
// At most one job runs and at most one waits. A new submission rejects the waiting job and
// aborts the running one (whose result is then discarded), so the newest edit is solved next.

import { abortError } from './types';

type Exec<Req, Res> = (req: Req, signal: AbortSignal) => Promise<Res>;

interface Entry<Req, Res> {
  req: Req;
  signal?: AbortSignal;
  resolve: (r: Res) => void;
  reject: (e: unknown) => void;
}

export class LatestWins<Req, Res> {
  private running: { entry: Entry<Req, Res>; ac: AbortController } | null = null;
  private pending: Entry<Req, Res> | null = null;
  private exec: Exec<Req, Res>;

  constructor(exec: Exec<Req, Res>) {
    this.exec = exec;
  }

  submit(req: Req, signal?: AbortSignal): Promise<Res> {
    return new Promise<Res>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const entry: Entry<Req, Res> = { req, signal, resolve, reject };
      if (this.pending) this.pending.reject(abortError());
      this.pending = entry;
      this.running?.ac.abort();
      signal?.addEventListener(
        'abort',
        () => {
          if (this.pending === entry) {
            this.pending = null;
            reject(abortError());
          } else if (this.running?.entry === entry) {
            this.running.ac.abort();
          }
        },
        { once: true },
      );
      this.pump();
    });
  }

  /** True while a job is executing (useful for "updating…" UI). */
  get busy(): boolean {
    return this.running !== null;
  }

  private pump() {
    if (this.running || !this.pending) return;
    const entry = this.pending;
    this.pending = null;
    const ac = new AbortController();
    this.running = { entry, ac };
    this.exec(entry.req, ac.signal)
      .then(
        (res) => (ac.signal.aborted ? entry.reject(abortError()) : entry.resolve(res)),
        (err) => entry.reject(ac.signal.aborted ? abortError() : err),
      )
      .finally(() => {
        this.running = null;
        this.pump();
      });
  }
}
