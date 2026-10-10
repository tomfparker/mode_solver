// Right zone: headline numbers, warnings, mode thumbnails, mode table, Advanced settings,
// and (below) the coupling-path strip.

import { useMemo } from 'react';
import { labelModes } from '../analysis/modeLabels';
import { computeWarnings, type Warning } from '../analysis/warnings';
import { effectiveMeshStep, effectivePadding, maxIndex, solveDomain } from '../geometry/geometry';
import type { Auto, SolverSettings } from '../geometry/types';
import { SOLVER_KIND_LABELS, type SolverKind } from '../solver/kinds';
import { fmtArea, fmtIndex, fmtMfd, fmtPercent, fmtWavelengthNm } from '../state/format';
import { useStore } from '../state/store';
import { formatLength } from '../state/units';
import type { ModeResult, SolveResult } from '../solver/types';
import { fieldData, fieldDataUrl, modeCrop } from './canvas/fieldImage';
import { NumberField } from './inputs';
import { usePrefersDark } from './usePrefersDark';

interface Props {
  result: SolveResult | null;
  stale: boolean;
  solving: boolean;
  error: string | null;
}

export function ResultsPanel({ result, stale, solving, error }: Props) {
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
          <span className="results-status">{error ? 'Solver error' : solving ? 'Solving…' : stale ? 'Out of date' : result ? (result.isMock ? 'Preview (mock)' : 'Up to date') : 'Not solved yet'}</span>
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
          <p className="limits" style={{ marginTop: 6 }}>MFD and A_eff in µm / µm². n_g arrives with wavelength sweeps.</p>
        </section>
      )}

      <section className="section">
        <h2 className="section-title" style={{ marginBottom: 8 }}>Coupling</h2>
        <div className="coupling-strip" aria-label="Coupling path (coming soon)">
          <span className="node">Waveguide</span>→<span className="node">Lens(es)</span>→<span className="node">Fibre</span>
        </div>
        <p className="limits" style={{ marginTop: 6 }}>Fibre butt-coupling and ideal-lens coupling are coming in the next milestones.</p>
      </section>

      <section className="section">
        <Advanced />
      </section>

      <section className="section limits">
        <p><b>Quick-estimate tool.</b> Target accuracy once the real solver lands: n_eff within ~1e-3, mode size within ~10%.</p>
        <p>Not modelled: bends, 3D propagation (tapers, EME/FDTD), real lens aberrations, design-grade accuracy.</p>
      </section>
    </aside>
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
            {w.action?.kind === 'increase-padding' && (
              <>
                <br />
                <button
                  className="btn small"
                  onClick={() => {
                    update((p) => void (p.settings.padding = w.action!.padding));
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
  const aspect = (crop.i1 - crop.i0) / (crop.j1 - crop.j0);
  return (
    <button
      className={`thumb${selected ? ' selected' : ''}${mode.guided ? '' : ' unguided'}`}
      onClick={onClick}
      role="option"
      aria-selected={selected}
      title={mode.guided ? label : `${label}: below cut-off`}
    >
      <img className="img" src={url} alt={`${label} intensity`} style={{ aspectRatio: String(aspect) }} />
      <span className="lbl">
        <b>{label}</b>
        <span className="num">{fmtIndex(mode.neff.re)}</span>
      </span>
    </button>
  );
}

function AutoNumber({
  label, value, effective, onChange, title, kind = 'length', unitLabel, min,
}: {
  label: string;
  value: Auto<number>;
  effective: number;
  onChange: (v: Auto<number>) => void;
  title?: string;
  kind?: 'length' | 'plain';
  unitLabel?: string;
  min?: number;
}) {
  const isAuto = value === 'auto';
  return (
    <>
      <label title={title}>{label}</label>
      <span className="auto-row">
        <NumberField kind={kind} unitLabel={unitLabel} value={isAuto ? effective : value} min={min} onCommit={(v) => onChange(v)} ariaLabel={label} />
        <label>
          <input type="checkbox" checked={isAuto} onChange={(e) => onChange(e.target.checked ? 'auto' : effective)} /> auto
        </label>
      </span>
    </>
  );
}

function Advanced() {
  const project = useStore((s) => s.project);
  const open = useStore((s) => s.ui.advancedOpen);
  const setUi = useStore((s) => s.setUi);
  const update = useStore((s) => s.update);
  const unit = useStore((s) => s.ui.lengthUnit);
  const st = project.settings;
  const set = <K extends keyof SolverSettings>(k: K, v: SolverSettings[K]) => update((p) => void (p.settings[k] = v));
  const d = solveDomain(project);
  const step = effectiveMeshStep(project);
  const nx = Math.round((d.x1 - d.x0) / step);
  const ny = Math.round((d.y1 - d.y0) / step);

  return (
    <details className="advanced" open={open} onToggle={(e) => setUi({ advancedOpen: (e.target as HTMLDetailsElement).open })}>
      <summary>Advanced: solver, mesh, window</summary>
      <div className="props">
        <label>Solver</label>
        <select className="field" value={st.solverKind} onChange={(e) => set('solverKind', e.target.value as Auto<SolverKind>)}>
          <option value="auto">Auto (full-vector)</option>
          {(Object.keys(SOLVER_KIND_LABELS) as SolverKind[]).map((k) => (
            <option key={k} value={k}>
              {SOLVER_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <label>Modes</label>
        <NumberField kind="plain" value={st.numModes} min={1} max={12} step={1} digits={0} onCommit={(v) => set('numModes', Math.round(v))} ariaLabel="Number of modes" />
        <AutoNumber label="Mesh step" value={st.meshStep} effective={step} min={0.001} onChange={(v) => set('meshStep', v)} title="Grid spacing. Auto: ~100 cells along the longer side." />
        <span className="hint">
          Grid {nx} × {ny} cells
          {nx * ny > 40000 ? ': large grids are slow in the browser' : ''}
        </span>
        <AutoNumber label="Padding" value={st.padding} effective={effectivePadding(project)} min={0.01} onChange={(v) => set('padding', v)} title="Space between the structure and the window edge" />
        <span className="hint">
          Window {formatLength(d.x1 - d.x0, unit)} × {formatLength(d.y1 - d.y0, unit)}
        </span>
        <label>Boundary</label>
        <select className="field" value={st.boundary} onChange={(e) => set('boundary', e.target.value as Auto<'pec' | 'pmc'>)}>
          <option value="auto">Auto</option>
          <option value="pec">PEC (metal walls)</option>
          <option value="pmc">PMC</option>
        </select>
        <AutoNumber
          label="n guess"
          kind="plain"
          value={st.nGuess}
          effective={Number(maxIndex(project).toFixed(4))}
          min={1}
          onChange={(v) => set('nGuess', v)}
          title="Eigensolver shift. Auto: the highest index in the window."
        />
      </div>
      <p className="limits" style={{ marginTop: 8 }}>
        Absorbing (PML) boundaries for leaky and lossy modes are planned; until then, lossy results are approximate.
      </p>
    </details>
  );
}
