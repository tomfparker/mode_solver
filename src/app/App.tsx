// Three zones: structure (left) | canvas (centre) | results + coupling (right).

import { useEffect } from 'react';
import { CanvasView } from '../components/canvas/CanvasView';
import { ResultsPanel } from '../components/ResultsPanel';
import { StructurePanel } from '../components/StructurePanel';
import { TopBar } from '../components/TopBar';
import { useStore } from '../state/store';
import { useLiveSolve, useShortcuts, useUrlSync } from './hooks';
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
  const { result, stale, error, status, isMock } = useLiveSolve(project);

  return (
    <div className="app">
      <TopBar status={status} mock={isMock} />
      <StructurePanel />
      <CanvasView result={result} stale={stale} />
      <ResultsPanel result={result} stale={stale} error={error} />
      <NoticeToast />
    </div>
  );
}
