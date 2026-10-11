// Three zones: structure (left) | canvas (centre) | results + coupling (right).

import { useEffect, useRef, useState } from 'react';
import { AboutPage } from '../components/AboutPage';
import { CanvasView } from '../components/canvas/CanvasView';
import { LoadingScreen } from '../components/LoadingScreen';
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

/** Solves expected, or found, to run longer than this get the full loading screen. */
const LONG_SOLVE_MS = 5000;

/** Seconds a solve has been running (0 when idle), and how long the last finished one took. */
function useSolveClock(solving: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const lastDuration = useRef(0);
  useEffect(() => {
    if (!solving) return;
    const t0 = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - t0), 250);
    return () => {
      clearInterval(timer);
      lastDuration.current = performance.now() - t0;
      setElapsed(0);
    };
  }, [solving]);
  return { elapsed, lastDuration };
}

export function App() {
  useUrlSync();
  useShortcuts();
  const project = useStore((s) => s.project);
  const page = useStore((s) => s.ui.page);
  const { result, outOfDate, solving, solve, cancel, error, status, isMock } = useSolver(project);
  // What the solver is doing right now, if anything (shown on the canvas and in the results header).
  const busy =
    status.state === 'loading'
      ? `Loading solver: ${status.stage.toLowerCase()} (${Math.round(status.progress * 100)}%). First visit downloads ~30 MB.`
      : solving
        ? 'Solving…'
        : null;

  const { elapsed, lastDuration } = useSolveClock(solving);
  // First load: stay on the loading screen until the first result is on screen.
  const firstLoad = !isMock && !result && !error && (status.state === 'loading' || solving);
  // Long solves: once one has run 5 s, or straight away if the previous one took that long.
  const longSolve = solving && !firstLoad && (elapsed > LONG_SOLVE_MS || lastDuration.current > LONG_SOLVE_MS);

  return (
    <div className="app">
      {firstLoad && (
        <LoadingScreen
          title="Loading solver"
          progress={status.state === 'loading' ? status.progress : 1}
          detail={status.state === 'loading' ? `${status.stage}. First visit downloads about 30 MB.` : 'Solving the example'}
        />
      )}
      {longSolve && <LoadingScreen title="Solving" detail={`${Math.round(elapsed / 1000)} s elapsed`} onCancel={cancel} />}
      <div className="art-strip" aria-hidden="true" />
      <TopBar status={status} mock={isMock} solving={solving} outOfDate={outOfDate} onSolve={solve} onCancel={cancel} />
      {page === 'about' ? (
        <AboutPage />
      ) : (
        <>
          <StructurePanel />
          {/* The loading screen already says what is happening; don't repeat it on the canvas behind. */}
          <CanvasView result={result} stale={outOfDate} busy={firstLoad || longSolve ? null : busy} />
          <ResultsPanel result={result} stale={outOfDate} busy={busy} error={error ?? (status.state === 'error' ? status.message : null)} />
        </>
      )}
      <div className="art-strip bottom" aria-hidden="true" />
      <NoticeToast />
    </div>
  );
}
