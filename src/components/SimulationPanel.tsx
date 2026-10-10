// Left-panel "Simulation" section: the simulation window (fixed by default, or auto-sized to
// the structure) and solver options.

import { autoDomain, effectiveMeshStep, effectivePadding, isAutoWindow, maxIndex, solveDomain } from '../geometry/geometry';
import type { Auto, SolverSettings, WindowBox } from '../geometry/types';
import { SOLVER_KIND_LABELS, type SolverKind } from '../solver/kinds';
import { useStore } from '../state/store';
import { NumberField } from './inputs';

const r = (v: number) => Math.round(v * 1e6) / 1e6;

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

export function SimulationPanel() {
  const project = useStore((s) => s.project);
  const open = useStore((s) => s.ui.advancedOpen);
  const setUi = useStore((s) => s.setUi);
  const update = useStore((s) => s.update);
  const st = project.settings;
  const set = <K extends keyof SolverSettings>(k: K, v: SolverSettings[K]) => update((p) => void (p.settings[k] = v));
  const auto = isAutoWindow(project);
  const d = solveDomain(project);
  const w = d.x1 - d.x0;
  const h = d.y1 - d.y0;
  const cx = (d.x0 + d.x1) / 2;
  const cy = (d.y0 + d.y1) / 2;
  const step = effectiveMeshStep(project);
  const nx = Math.round(w / step);
  const ny = Math.round(h / step);

  /** Rewrite the fixed window from centre and size. */
  const setBox = (c: { cx?: number; cy?: number; w?: number; h?: number }, coalesce?: string) => {
    const ncx = c.cx ?? cx;
    const ncy = c.cy ?? cy;
    const nw = c.w ?? w;
    const nh = c.h ?? h;
    const box: WindowBox = { x0: r(ncx - nw / 2), x1: r(ncx + nw / 2), y0: r(ncy - nh / 2), y1: r(ncy + nh / 2) };
    update((p) => void (p.settings.window = box), coalesce);
  };

  return (
    <section className="section" aria-label="Simulation settings">
      <div className="section-head">
        <h2 className="section-title">Simulation</h2>
      </div>
      <div className="props">
        <label title="The solver only computes inside this window; its edges act as walls">Window</label>
        <label className="check" title="Resize the window to the structure plus padding whenever shapes change">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => set('window', e.target.checked ? 'auto' : solveDomain(project))}
            aria-label="Auto-size window to structure"
          />{' '}
          auto-size to structure
        </label>
        {auto ? (
          <>
            <AutoNumber label="Padding" value={st.padding} effective={effectivePadding(project)} min={0.01} onChange={(v) => set('padding', v)} title="Space between the structure and the window edge" />
            <span className="hint">
              Currently {r(w)} × {r(h)} µm
            </span>
          </>
        ) : (
          <>
            <label>Width</label>
            <NumberField value={w} min={0.01} onCommit={(v, c) => setBox({ w: v }, c)} ariaLabel="Window width" />
            <label>Height</label>
            <NumberField value={h} min={0.01} onCommit={(v, c) => setBox({ h: v }, c)} ariaLabel="Window height" />
            <label>Centre x</label>
            <NumberField value={cx} onCommit={(v, c) => setBox({ cx: v }, c)} ariaLabel="Window centre x" />
            <label>Centre y</label>
            <NumberField value={cy} onCommit={(v, c) => setBox({ cy: v }, c)} ariaLabel="Window centre y" />
            <span />
            <span>
              <button className="btn small" onClick={() => set('window', autoDomain(project))} title="Resize once to the structure plus padding">
                Fit to structure
              </button>
            </span>
          </>
        )}
        <label>Modes</label>
        <NumberField kind="plain" value={st.numModes} min={1} max={12} step={1} digits={0} onCommit={(v) => set('numModes', Math.round(v))} ariaLabel="Number of modes" />
      </div>

      <details className="advanced" open={open} onToggle={(e) => setUi({ advancedOpen: (e.target as HTMLDetailsElement).open })} style={{ marginTop: 10 }}>
        <summary>Solver and mesh</summary>
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
          <AutoNumber label="Mesh step" value={st.meshStep} effective={step} min={0.001} onChange={(v) => set('meshStep', v)} title="Grid spacing. Auto: ~100 cells along the longer side." />
          <span className="hint">
            Grid {nx} × {ny} cells
            {nx * ny > 40000 ? ': large grids are slow in the browser' : ''}
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
    </section>
  );
}
