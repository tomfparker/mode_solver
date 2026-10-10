// App-level hooks: live solving, URL sync, keyboard shortcuts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { solveDomain, uid } from '../geometry/geometry';
import type { Project } from '../geometry/types';
import { MockSolver } from '../solver/mockSolver';
import { PyodideSolver } from '../solver/workerClient';
import { isAbortError, type Solver, type SolveResult, type SolverStatus } from '../solver/types';
import { deleteFeature, patchFeature, useStore } from '../state/store';
import { decodeHash, encodeProject } from '../state/url';

/**
 * Solve on demand (Solve button / Ctrl+Enter). Edits mark the shown result out of date
 * rather than re-solving. A new project (first load, template, shared link) solves by itself
 * so the canvas is never blank.
 */
let solverInstance: Solver | null = null;

/**
 * The page's solver: the real (Pyodide) one, or the mock with `?solver=mock` in the URL (for
 * UI work and demos). Created once and kept for the page's lifetime: loading Pyodide takes
 * seconds, and React StrictMode re-runs effects, so it must not be tied to a component.
 */
function getSolver(): Solver {
  if (!solverInstance) {
    const mock = typeof location !== 'undefined' && new URLSearchParams(location.search).get('solver') === 'mock';
    solverInstance = mock ? new MockSolver() : new PyodideSolver();
  }
  return solverInstance;
}

export function useSolver(project: Project) {
  const solver = getSolver();
  const [status, setStatus] = useState<SolverStatus>(solver.status());
  const [state, setState] = useState<{ result: SolveResult; key: string } | null>(null);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useMemo(() => JSON.stringify(project), [project]);
  const running = useRef<AbortController | null>(null);
  const viewEpoch = useStore((s) => s.viewEpoch);

  useEffect(() => solver.onStatus(setStatus), [solver]);

  const solve = useCallback(() => {
    running.current?.abort();
    const ac = new AbortController();
    running.current = ac;
    const p = useStore.getState().project; // solve what is in the store right now
    const k = JSON.stringify(p);
    setSolving(true);
    setError(null);
    solver
      .solve(
        {
          id: uid('solve'),
          project: p,
          window: solveDomain(p),
          meshQuality: p.settings.meshQuality,
          numModes: p.settings.numModes,
          nGuess: p.settings.nGuess === 'auto' ? undefined : p.settings.nGuess,
        },
        ac.signal,
      )
      .then(
        (result) => setState({ result, key: k }),
        (e) => {
          if (!isAbortError(e)) setError(e instanceof Error ? e.message : String(e));
        },
      )
      .finally(() => {
        if (running.current === ac) {
          running.current = null;
          setSolving(false);
        }
      });
  }, [solver]);

  const cancel = useCallback(() => {
    running.current?.abort();
    running.current = null;
    setSolving(false);
  }, []);

  // New project loaded (including the first one): solve it straight away.
  useEffect(() => {
    const t = setTimeout(solve, 0);
    return () => clearTimeout(t);
  }, [viewEpoch, solve]);

  // Ctrl+Enter and "fix" actions ask for a solve via this event.
  useEffect(() => {
    window.addEventListener('solve-now', solve);
    return () => window.removeEventListener('solve-now', solve);
  }, [solve]);

  return {
    result: state?.result ?? null,
    outOfDate: state !== null && state.key !== key,
    solving,
    solve,
    cancel,
    error,
    status,
    isMock: solver.name === 'mock',
  };
}

/** Keep the URL hash in sync with the project, and load projects from links. */
export function useUrlSync() {
  const lastWritten = useRef<string>('');

  useEffect(() => {
    const load = (keepHistory: boolean) => {
      const r = decodeHash(location.hash);
      const s = useStore.getState();
      if (r.ok === true) {
        s.replaceProject(r.project, { keepHistory });
        lastWritten.current = location.hash;
      } else if (r.ok === false) {
        s.notify(`Couldn’t read the shared link (${r.error}). Showing the default example instead.`, 'warn');
      }
    };
    load(false);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useStore.subscribe((s, prev) => {
      if (s.project === prev.project) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const h = '#' + encodeProject(s.project);
        if (location.hash !== h) {
          history.replaceState(null, '', h);
          lastWritten.current = h;
        }
      }, 400);
    });
    const onHash = () => {
      if (location.hash !== lastWritten.current) load(true);
    };
    window.addEventListener('hashchange', onHash);
    // Write the initial state so the address bar is shareable immediately.
    if (!location.hash) {
      const h = '#' + encodeProject(useStore.getState().project);
      history.replaceState(null, '', h);
      lastWritten.current = h;
    }
    return () => {
      unsub();
      clearTimeout(timer);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);
}

function inTextInput(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      // Undo/redo are app-level even inside our fields: blur first so any typed value commits,
      // then step history (so Ctrl+Z after typing reverts what was typed).
      const k = e.key.toLowerCase();
      if (mod && (k === 'z' || k === 'y')) {
        e.preventDefault();
        if (inTextInput(e.target)) (e.target as HTMLElement).blur();
        const st = useStore.getState();
        if (k === 'y' || e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        if (inTextInput(e.target)) (e.target as HTMLElement).blur(); // commit the typed value first
        window.dispatchEvent(new Event('solve-now'));
        return;
      }
      if (inTextInput(e.target) || mod || e.altKey) return;

      const sel = s.selection;
      if (e.key === 'Escape') {
        // First Escape closes the pop-up editor, the second clears the selection.
        if (s.ui.editorOpen) s.setUi({ editorOpen: false });
        else s.select(null);
      } else if (e.key === 'f' || e.key === 'F') window.dispatchEvent(new Event('fit-view'));
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel?.type === 'feature') deleteFeature(sel.id);
      else if (sel?.type === 'feature' && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const f = s.project.features.find((x) => x.id === sel.id);
        if (!f) return;
        const step = e.shiftKey ? 0.01 : 0.001;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0;
        patchFeature(f.id, { x: Math.round((f.x + dx) * 1e6) / 1e6, y: Math.round((f.y + dy) * 1e6) / 1e6 }, `nudge-${f.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
