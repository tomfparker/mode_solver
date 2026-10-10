// Right zone: headline numbers, warnings, mode thumbnails, mode table,
// and (below) the coupling-path strip.

import { useMemo } from 'react';
import { labelModes } from '../analysis/modeLabels';
import { computeWarnings, type Warning } from '../analysis/warnings';
import { SOLVER_KIND_LABELS } from '../solver/kinds';
import { fmtArea, fmtIndex, fmtMfd, fmtPercent, fmtWavelengthNm } from '../state/format';
import { useStore } from '../state/store';
import type { ModeResult, SolveResult } from '../solver/types';
import { fieldData, fieldDataUrl, modeCrop } from './canvas/fieldImage';
import { usePrefersDark } from './usePrefersDark';

interface Props {
  result: SolveResult | null;
  stale: boolean;
  /** What the solver is doing (loading, solving), or null when idle. */
  busy: string | null;
  error: string | null;
}

export function ResultsPanel({ result, stale, busy, error }: Props) {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.ui.selectedMode);
  const setUi = useStore((s) => s.setUi);
  const warnings = useMemo(() => computeWarnings(project, result), [project, result]);
  const labels = result ? labelModes(result.modes) : [];
  const sel = result ? Math.min(selected, result.modes.length - 1) : 0;
  const m = result?.modes[sel];

  return (
    <aside className="panel-right" aria-label="Results">
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Modes at {fmtWavelengthNm(project.wavelength)}</h2>
          <span className="results-status">{error ? 'Solver error' : busy ? (busy.startsWith('Loading') ? 'Loading solver…' : 'Solving…') : stale ? 'Out of date' : result ? (result.isMock ? 'Preview (mock)' : 'Up to date') : 'Not solved yet'}</span>
        </div>
        {error && <div className="warning"><span className="icon">!</span><span>{error}</span></div>}
        {m && (
          <div className={`hero${stale ? ' stale' : ''}`}>
            <div>
              <span className="k">{labels[sel]} n_eff</span>
              <span className="v">{fmtIndex(m.neff.re)}</span>
            </div>
            <div>
              <span className="k">MFD (1/e²) x × y</span>
              <span className="v">
                {fmtMfd(m.mfd.x)} × {fmtMfd(m.mfd.y)}
                <small>µm</small>
              </span>
            </div>
          </div>
        )}
        <Warnings warnings={warnings} />
      </section>

      {result && (
        <section className={`section${stale ? ' stale' : ''}`}>
          <div className="thumbs" role="listbox" aria-label="Modes">
            {result.modes.map((mode, i) => (
              <Thumb key={i} mode={mode} result={result} label={labels[i]} selected={i === sel} onClick={() => setUi({ selectedMode: i })} />
            ))}
          </div>
          <table className="modes" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Mode</th>
                <th>n_eff</th>
                <th title="Group index: needs a wavelength sweep (coming in M5)">n_g</th>
                <th title="1/e² intensity diameter, µm">MFD x</th>
                <th title="1/e² intensity diameter, µm">MFD y</th>
                <th title="Effective area, µm²">A_eff</th>
                <th title="Fraction of transverse power in Ex">TE</th>
              </tr>
            </thead>
            <tbody className="num">
              {result.modes.map((mode, i) => (
                <tr
                  key={i}
                  className={`${i === sel ? 'selected' : ''}${mode.guided ? '' : ' unguided'}`}
                  onClick={() => setUi({ selectedMode: i })}
                  title={mode.guided ? undefined : 'Below cut-off: not guided'}
                >
                  <td>{labels[i]}{mode.guided ? '' : ' ✕'}</td>
                  <td>{fmtIndex(mode.neff.re)}</td>
                  <td>{mode.ng !== undefined ? fmtIndex(mode.ng) : '—'}</td>
                  <td>{fmtMfd(mode.mfd.x)}</td>
                  <td>{fmtMfd(mode.mfd.y)}</td>
                  <td>{fmtArea(mode.aEff)}</td>
                  <td>{fmtPercent(mode.teFraction)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="limits" style={{ marginTop: 6 }}>
            MFD: 1/e² intensity width through the peak, µm. A_eff in µm². n_g arrives with wavelength sweeps.
            {result.modes.some((x) => !x.guided) && ' ✕ = not guided (below cut-off, or a mode of the window walls).'}
          </p>
          {!result.isMock && <SolveInfo result={result} />}
        </section>
      )}

      <section className="section">
        <h2 className="section-title" style={{ marginBottom: 8 }}>Coupling</h2>
        <div className="coupling-strip" aria-label="Coupling path (coming soon)">
          <span className="node">Waveguide</span>→<span className="node">Lens(es)</span>→<span className="node">Fibre</span>
        </div>
        <p className="limits" style={{ marginTop: 6 }}>Fibre butt-coupling and ideal-lens coupling are coming in the next milestones.</p>
      </section>

      <section className="section limits">
        <p><b>Quick-estimate tool.</b> Target accuracy: n_eff within ~1e-3, mode size within ~10% (checked against femwell and Tidy3D on standard strips).</p>
        <p>Not modelled: bends, 3D propagation (tapers, EME/FDTD), real lens aberrations, design-grade accuracy.</p>
      </section>
    </aside>
  );
}

function SolveInfo({ result }: { result: SolveResult }) {
  const d = result.diagnostics;
  const ms = d.timingsMs.python ?? d.timingsMs.total;
  return (
    <p className="limits">
      {SOLVER_KIND_LABELS[d.solverKind]} solver
      {d.mesh && ` · mesh ${d.mesh.nx} × ${d.mesh.ny} cells (smallest ${Math.round(d.mesh.minCell * 1000)} nm)`}
      {ms !== undefined && ` · ${ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`}`}
    </p>
  );
}

function Warnings({ warnings }: { warnings: Warning[] }) {
  const update = useStore((s) => s.update);
  if (warnings.length === 0) return null;
  return (
    <div className="warnings" role="status">
      {warnings.map((w) => (
        <div key={w.id} className={`warning${w.tone === 'info' ? ' info' : ''}`}>
          <span className="icon" aria-hidden>{w.tone === 'info' ? 'i' : '!'}</span>
          <span>
            {w.text}
            {w.action && (
              <>
                <br />
                <button
                  className="btn small"
                  onClick={() => {
                    const a = w.action!;
                    update((p) => {
                      if (a.kind === 'increase-padding') p.settings.padding = a.padding;
                      else p.settings.window = a.window;
                    });
                    window.dispatchEvent(new Event('solve-now'));
                  }}
                >
                  {w.action.label}
                </button>
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function Thumb({ mode, result, label, selected, onClick }: { mode: ModeResult; result: SolveResult; label: string; selected: boolean; onClick: () => void }) {
  const dark = usePrefersDark();
  const crop = useMemo(() => modeCrop(mode, result.grid), [mode, result]);
  const url = useMemo(() => {
    const d = fieldData(mode, 'E2');
    return d ? fieldDataUrl(d, result.grid, crop, dark) : '';
  }, [mode, result, crop, dark]);
  return (
    <button
      className={`thumb${selected ? ' selected' : ''}${mode.guided ? '' : ' unguided'}`}
      onClick={onClick}
      role="option"
      aria-selected={selected}
      title={mode.guided ? label : `${label}: below cut-off`}
    >
      <img className="img" src={url} alt={`${label} intensity`} />
      <span className="lbl">
        <b>{label}</b>
        <span className="num">{fmtIndex(mode.neff.re)}</span>
      </span>
    </button>
  );
}
