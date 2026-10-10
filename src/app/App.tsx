// Three zones: structure (left) | canvas (centre) | results + coupling (right).

import { useEffect } from 'react';
import { CanvasView } from '../components/canvas/CanvasView';
import { ResultsPanel } from '../components/ResultsPanel';
import { StructurePanel } from '../components/StructurePanel';
import { TopBar } from '../components/TopBar';
import { useStore } from '../state/store';
import { useShortcuts, useSolver, useUrlSync } from './hooks';
import './app.css';

function NoticeToast() {
  const notice = useStore((s) => s.notice);
  const dismiss = useStore((s) => s.dismissNotice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismiss, notice.tone === 'warn' ? 8000 : 3500);
    return () => clearTimeout(t);
  }, [notice, dismiss]);
  if (!notice) return null;
  return (
    <div className={`notice${notice.tone === 'warn' ? ' warn' : ''}`} role="status">
      {notice.text}
      <button onClick={dismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

export function App() {
  useUrlSync();
  useShortcuts();
  const project = useStore((s) => s.project);
  const { result, outOfDate, solving, solve, cancel, error, status, isMock } = useSolver(project);
  // What the solver is doing right now, if anything (shown on the canvas and in the results header).
  const busy =
    status.state === 'loading'
      ? `Loading solver: ${status.stage.toLowerCase()} (${Math.round(status.progress * 100)}%). First visit downloads ~30 MB.`
      : solving
        ? 'Solving…'
        : null;

  return (
    <div className="app">
      <TopBar status={status} mock={isMock} solving={solving} outOfDate={outOfDate} onSolve={solve} onCancel={cancel} />
      <StructurePanel />
      <CanvasView result={result} stale={outOfDate} busy={busy} />
      <ResultsPanel result={result} stale={outOfDate} busy={busy} error={error ?? (status.state === 'error' ? status.message : null)} />
      <NoticeToast />
    </div>
  );
}
