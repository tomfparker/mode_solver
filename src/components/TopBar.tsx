// Top bar: project name, the global wavelength control, templates, undo/redo, units, share.

import { useState, type KeyboardEvent } from 'react';
import { TextField } from './inputs';
import { TEMPLATES } from '../geometry/templates';
import { useStore } from '../state/store';
import { parseLength } from '../state/units';
import type { SolverStatus } from '../solver/types';

function WavelengthControl() {
  const lam = useStore((s) => s.project.wavelength);
  const update = useStore((s) => s.update);
  const nm = Math.round(lam * 1e4) / 10;
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(nm);
  const setText = setDraft;
  const [error, setError] = useState(false);

  const setLam = (um: number, coalesce?: string) => update((p) => void (p.wavelength = um), coalesce);

  const commit = () => {
    const v = parseLength(text, 'nm');
    if (v === null || v < 0.2 || v > 20) {
      setError(true);
      return;
    }
    setError(false);
    setDraft(null);
    if (Math.abs(v - lam) > 1e-9) setLam(Math.round(v * 1e4) / 1e4);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') {
      setDraft(null);
      setError(false);
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      setDraft(null);
      const step = e.shiftKey ? 0.01 : 0.001;
      setLam(Math.round((lam + (e.key === 'ArrowUp' ? step : -step)) * 1e4) / 1e4, 'wavelength-arrow');
    }
  };

  return (
    <div className="wavelength" title="Vacuum wavelength. Type nm or µm (e.g. 1.55 µm); arrow keys step 1 nm (Shift: 10 nm).">
      <label htmlFor="wavelength">λ</label>
      <input
        id="wavelength"
        className={error ? 'invalid' : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        onFocus={(e) => e.target.select()}
        inputMode="decimal"
        aria-invalid={error}
        aria-label="Wavelength in nm"
      />
      <span className="unit">nm</span>
    </div>
  );
}

function StatusChip({ status, mock }: { status: SolverStatus; mock: boolean }) {
  if (mock) {
    return (
      <span className="status-chip mock" title="Mock solver (?solver=mock): results are placeholders, not physical. Remove it from the URL for the real solver.">
        <span className="dot" /> Mock solver
      </span>
    );
  }
  const text = status.state === 'loading' ? `Loading solver ${Math.round(status.progress * 100)}%` : status.state === 'ready' ? 'Solver ready' : 'Solver error';
  return (
    <span className="status-chip">
      <span className="dot" /> {text}
    </span>
  );
}

interface TopBarProps {
  status: SolverStatus;
  mock: boolean;
  solving: boolean;
  outOfDate: boolean;
  onSolve: () => void;
  onCancel: () => void;
}

export function TopBar({ status, mock, solving, outOfDate, onSolve, onCancel }: TopBarProps) {
  const name = useStore((s) => s.project.name);
  const update = useStore((s) => s.update);
  const replace = useStore((s) => s.replaceProject);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const unit = useStore((s) => s.ui.lengthUnit);
  const setUi = useStore((s) => s.setUi);
  const notify = useStore((s) => s.notify);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      notify('Link copied. It reproduces this exact structure and settings.');
    } catch {
      notify('Copy the address bar URL to share this structure.', 'warn');
    }
  };

  return (
    <header className="topbar">
      <span className="brand">
        Mode solver
      </span>
      <TextField className="project-name" value={name} ariaLabel="Project name" onCommit={(v) => update((p) => void (p.name = v))} />
      <WavelengthControl />
      {solving ? (
        <button className="btn solve" onClick={onCancel} title="Stop this solve">
          Cancel
        </button>
      ) : (
        <button
          className={`btn solve${outOfDate ? ' primary attention' : ''}`}
          onClick={onSolve}
          title="Run the mode solver on the current structure (Ctrl+Enter)"
        >
          ▶ Run
        </button>
      )}
      <select
        className="field"
        style={{ width: 130 }}
        value=""
        aria-label="Start from a template"
        onChange={(e) => {
          const t = TEMPLATES.find((x) => x.id === e.target.value);
          if (t) {
            replace(t.build(), { keepHistory: true });
            notify(`Loaded “${t.name}”. Undo (Ctrl+Z) to go back.`);
          }
        }}
      >
        <option value="" disabled>
          Templates…
        </option>
        {TEMPLATES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.description})
          </option>
        ))}
      </select>
      <span className="spacer" />
      <div className="toolbar-group">
        <button className="btn icon ghost" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo">
          ↶
        </button>
        <button className="btn icon ghost" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          ↷
        </button>
      </div>
      <div className="seg" role="group" aria-label="Length unit">
        <button className={unit === 'nm' ? 'on' : ''} onClick={() => setUi({ lengthUnit: 'nm' })}>
          nm
        </button>
        <button className={unit === 'um' ? 'on' : ''} onClick={() => setUi({ lengthUnit: 'um' })}>
          µm
        </button>
      </div>
      <button className="btn primary" onClick={share} title="Copy a link that reproduces this structure">
        Share link
      </button>
      <StatusChip status={status} mock={mock} />
    </header>
  );
}
