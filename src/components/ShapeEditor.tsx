// Pop-up editor for the selected shape (or the background), shown beside it on the canvas.

import { isFullWidth } from '../geometry/geometry';
import type { Feature } from '../geometry/types';
import { materialColor } from '../materials/colors';
import { indexSummary } from '../materials/display';
import { materialInfo } from '../materials/library';
import { deleteFeature, duplicateFeature, patchFeature, stepFeature, useStore } from '../state/store';
import { MaterialSelect, NumberField, TextField } from './inputs';

export function ShapeEditor() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const setUi = useStore((s) => s.setUi);
  const update = useStore((s) => s.update);
  const close = () => setUi({ editorOpen: false });
  const f = selection?.type === 'feature' ? project.features.find((x) => x.id === selection.id) : undefined;
  if (!f && selection?.type !== 'background') return null;

  return (
    <div role="dialog" aria-label={f ? `Edit ${f.name}` : 'Edit background'} onPointerDown={(e) => e.stopPropagation()}>
      <div className="editor-head">
        <b>{f ? f.name : 'Background'}</b>
        <button className="btn ghost icon small" onClick={close} aria-label="Close editor" title="Close (Esc)">
          ✕
        </button>
      </div>
      {f ? (
        <FeatureProps f={f} />
      ) : (
        <div className="props">
          <label>Material</label>
          <MaterialSelect
            material={project.background.material}
            opticAxis={project.background.opticAxis}
            onChange={(material, opticAxis) => update((p) => void (p.background = { material, opticAxis }))}
          />
          <MaterialColour material={project.background.material} />
          <span className="hint" style={{ gridColumn: '1 / -1' }}>Fills the whole plane wherever there is no shape (usually the cladding).</span>
        </div>
      )}
    </div>
  );
}

/** Colour picker for a material. The colour belongs to the material, so every shape made of it changes. */
function MaterialColour({ material }: { material: string }) {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const name = materialInfo(material, project.customMaterials)?.name ?? material;
  const overridden = project.materialColors?.[material] !== undefined;
  return (
    <>
      <label title={`Display colour of ${name} everywhere it is used`}>Colour</label>
      <span className="colour-row">
        <input
          type="color"
          value={materialColor(project, material)}
          aria-label={`Colour of ${name}`}
          onChange={(e) => update((p) => void (p.materialColors = { ...p.materialColors, [material]: e.target.value }), `colour-${material}`)}
        />
        <span className="limits">all {name.replace(/\s*\(.*\)\s*$/, '')}</span>
        {overridden && (
          <button
            className="btn small ghost"
            onClick={() =>
              update((p) => {
                const rest = { ...p.materialColors };
                delete rest[material];
                p.materialColors = Object.keys(rest).length ? rest : undefined;
              })
            }
          >
            Reset
          </button>
        )}
      </span>
    </>
  );
}

function FeatureProps({ f }: { f: Feature }) {
  const project = useStore((s) => s.project);
  const set = (patch: Partial<Feature>, c?: string) => patchFeature(f.id, patch, c);
  const L = (label: string, value: number, key: string, min?: number, title?: string) => (
    <>
      <label title={title}>{label}</label>
      <NumberField value={value} min={min} title={title} onCommit={(v, c) => set({ [key]: v } as Partial<Feature>, c)} ariaLabel={label} />
    </>
  );

  return (
    <>
      <div className="props">
        <label>Name</label>
        <TextField value={f.name} onCommit={(name) => set({ name })} ariaLabel="Shape name" />
        {f.kind !== 'graded' && (
          <>
            <label>Material</label>
            <MaterialSelect material={f.material} opticAxis={f.opticAxis} onChange={(material, opticAxis) => set({ material, opticAxis })} />
            <MaterialColour material={f.material} />
            <label title="Index offset added to the material, e.g. a doped core">Δn</label>
            <NumberField
              kind="plain"
              value={f.deltaN ?? 0}
              step={0.0001}
              digits={5}
              onCommit={(v, c) => set({ deltaN: v, deltaNIsExample: false }, c)}
              ariaLabel="Index offset"
            />
            {f.deltaNIsExample && <span className="hint">Example value: enter your fibre’s or measured Δn.</span>}
          </>
        )}
        {f.kind === 'rect' && (
          <>
            <label title="Spans the whole plane horizontally, like a substrate, BOX or film">Full width</label>
            <label className="check">
              <input type="checkbox" checked={!!f.fullWidth} onChange={(e) => set({ fullWidth: e.target.checked })} /> layer (spans whole width)
            </label>
          </>
        )}
        {isFullWidth(f) ? (
          <>
            {L('Bottom (y)', f.y, 'y')}
            <label>Top (y)</label>
            <NumberField value={f.y + f.height} min={f.y + 0.001} onCommit={(v, c) => set({ height: Math.round((v - f.y) * 1e6) / 1e6 }, c)} ariaLabel="Top (y)" />
            {L('Thickness', f.height, 'height', 0.001)}
          </>
        ) : (
          <>
            {L('x (centre)', f.x, 'x')}
            {L(f.kind === 'circle' || f.kind === 'graded' ? 'y (centre)' : 'y (bottom)', f.y, 'y', undefined, f.kind === 'graded' && f.profileY === 'half-gaussian' ? 'Surface the diffusion goes down from' : undefined)}
          </>
        )}

        {f.kind === 'rect' && !f.fullWidth && (
          <>
            {L('Width', f.width, 'width', 0.001)}
            {L('Height', f.height, 'height', 0.001)}
          </>
        )}

        {f.kind === 'trapezoid' && (
          <>
            {L('Top width', f.widthTop, 'widthTop', 0)}
            {L('Bottom width', f.widthBottom, 'widthBottom', 0)}
            {L('Height', f.height, 'height', 0.001)}
            <label title="Sidewall angle from horizontal; editing it changes the bottom width">Sidewall</label>
            <NumberField
              kind="plain"
              unitLabel="°"
              step={1}
              digits={1}
              min={1}
              max={179}
              value={(Math.atan2(f.height, (f.widthBottom - f.widthTop) / 2) * 180) / Math.PI}
              onCommit={(deg, c) => {
                const wb = f.widthTop + (2 * f.height) / Math.tan((deg * Math.PI) / 180);
                set({ widthBottom: Math.max(0, Math.round(wb * 1000) / 1000) }, c);
              }}
              ariaLabel="Sidewall angle"
            />
          </>
        )}

        {f.kind === 'circle' && L('Radius', f.radius, 'radius', 0.001)}

        {f.kind === 'graded' && (
          <>
            <label>Peak Δn</label>
            <NumberField kind="plain" value={f.deltaN} step={0.0001} digits={5} onCommit={(v, c) => set({ deltaN: v, deltaNIsExample: false }, c)} ariaLabel="Peak index change" />
            {f.deltaNIsExample && <span className="hint">Example value: enter your measured Δn.</span>}
            <label>Lateral profile</label>
            <select className="field" value={f.profileX} onChange={(e) => set({ profileX: e.target.value as 'gaussian' | 'erf-strip' })}>
              <option value="gaussian">Gaussian</option>
              <option value="erf-strip">Diffused stripe (erf)</option>
            </select>
            {f.profileX === 'erf-strip' && L('Stripe width', f.stripWidth, 'stripWidth', 0, 'Width of the diffusion source stripe')}
            {L('Lateral 1/e', f.wx, 'wx', 0.001, 'Lateral diffusion length: Δn falls to 1/e this far beyond the stripe edge')}
            <label>Depth profile</label>
            <select className="field" value={f.profileY} onChange={(e) => set({ profileY: e.target.value as 'gaussian' | 'half-gaussian' })}>
              <option value="half-gaussian">Half-Gaussian below the surface</option>
              <option value="gaussian">Gaussian (buried)</option>
            </select>
            {L('Depth 1/e', f.wy, 'wy', 0.001, 'Δn falls to 1/e at this depth')}
          </>
        )}
      </div>

      {f.kind === 'polygon' && <VertexTable f={f} />}

      <div className="props-actions">
        <button className="btn small" onClick={() => duplicateFeature(f.id)}>Duplicate</button>
        <button className="btn small" onClick={() => stepFeature(f.id, 1)} title="Move up the list: drawn over the shapes below it">↑ Up</button>
        <button className="btn small" onClick={() => stepFeature(f.id, -1)} title="Move down the list">↓ Down</button>
        <button className="btn small" onClick={() => deleteFeature(f.id)}>Delete</button>
      </div>
      {f.kind !== 'graded' && (
        <p className="limits" style={{ marginTop: 8 }}>
          n at {Math.round(project.wavelength * 1000)} nm: {indexSummary(f.material, project.wavelength, project.customMaterials)}
          {f.deltaN ? ` (+ Δn ${f.deltaN})` : ''}
        </p>
      )}
    </>
  );
}

function VertexTable({ f }: { f: Extract<Feature, { kind: 'polygon' }> }) {
  const setPt = (i: number, j: 0 | 1, v: number, c?: string) => {
    const pts = f.points.map((q) => [...q] as [number, number]);
    pts[i][j] = v;
    patchFeature(f.id, { points: pts }, c);
  };
  return (
    <div style={{ marginTop: 8 }}>
      <div className="section-head">
        <span className="limits">Vertices (relative to x, y)</span>
        <button
          className="btn small"
          onClick={() => {
            const last = f.points[f.points.length - 1];
            patchFeature(f.id, { points: [...f.points, [last[0] + 0.1, last[1]]] });
          }}
        >
          + Vertex
        </button>
      </div>
      <table className="vertex-table">
        <tbody>
          {f.points.map((pt, i) => (
            <tr key={i}>
              <td className="limits">{i + 1}</td>
              <td><NumberField value={pt[0]} onCommit={(v, c) => setPt(i, 0, v, c)} ariaLabel={`Vertex ${i + 1} x`} /></td>
              <td><NumberField value={pt[1]} onCommit={(v, c) => setPt(i, 1, v, c)} ariaLabel={`Vertex ${i + 1} y`} /></td>
              <td>
                <button
                  className="btn ghost icon small"
                  disabled={f.points.length <= 3}
                  onClick={() => patchFeature(f.id, { points: f.points.filter((_, k) => k !== i) })}
                  aria-label={`Remove vertex ${i + 1}`}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

