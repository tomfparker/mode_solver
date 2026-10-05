// App-level hooks: live solving, URL sync, keyboard shortcuts.

import { useEffect, useMemo, useRef, useState } from 'react';
import { uid } from '../geometry/geometry';
import type { Project } from '../geometry/types';
import { MockSolver } from '../solver/mockSolver';
import { isAbortError, type Solver, type SolveResult, type SolverStatus } from '../solver/types';
import { deleteFeature, deleteLayer, patchFeature, useStore } from '../state/store';
import { decodeHash, encodeProject } from '../state/url';

const DEBOUNCE_MS = 150;

/**
 * Debounced, latest-wins solve on every project change. The previous result stays visible
 * (dimmed via `stale`) until the new one arrives, so editing never blocks.
 */
export function useLiveSolve(project: Project) {
  const solver: Solver = useMemo(() => new MockSolver(), []);
  const [status, setStatus] = useState<SolverStatus>(solver.status());
  const [state, setState] = useState<{ result: SolveResult; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = useMemo(() => JSON.stringify(project), [project]);

  useEffect(() => solver.onStatus(setStatus), [solver]);
  useEffect(() => () => solver.dispose(), [solver]);

  useEffect(() => {
    const timer = setTimeout(() => {
      solver
        .solve({ id: uid('solve'), project, numModes: project.settings.numModes })
        .then(
          (result) => {
            setState({ result, key });
            setError(null);
          },
          (e) => {
            if (!isAbortError(e)) setError(e instanceof Error ? e.message : String(e));
          },
        );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `key` captures every project change; `project` is the same data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, solver]);

  return {
    result: state?.result ?? null,
    stale: state !== null && state.key !== key,
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
      if (inTextInput(e.target) || mod || e.altKey) return;

      const sel = s.selection;
      if (e.key === 'Escape') s.select(null);
      else if (e.key === 'f' || e.key === 'F') window.dispatchEvent(new Event('fit-view'));
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel?.type === 'feature') deleteFeature(sel.id);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel?.type === 'layer') deleteLayer(sel.id);
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
