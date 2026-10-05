// Left zone: layer stack (first), shapes (second), properties of the selection, custom materials.

import { anchorLabel, uid } from '../geometry/geometry';
import type { Feature, FeatureKind, Layer, MaterialUse, Project } from '../geometry/types';
import { maxIndexAt, materialInfo } from '../materials/library';
import {
  addFeature, addLayer, deleteFeature, deleteLayer, duplicateFeature, moveLayer, patchFeature, patchLayer,
  reorderFeature, setAnchorKeepPosition, useStore,
} from '../state/store';
import { formatLength } from '../state/units';
import { geoFill } from './geoFill';
import { MaterialSelect, NumberField, TextField } from './inputs';
import { indexSummary } from '../materials/display';

const KIND_LABEL: Record<FeatureKind, string> = {
  rect: 'Rectangle',
  trapezoid: 'Trapezoid',
  circle: 'Circle',
  polygon: 'Polygon',
  graded: 'Graded index',
};

function materialName(p: Project, id: string) {
  return materialInfo(id, p.customMaterials)?.name ?? id;
}

function Swatch({ p, use }: { p: Project; use?: MaterialUse }) {
  const n = use ? maxIndexAt(use.material, p.wavelength, p.customMaterials) : 1;
  return <span className="swatch" style={{ background: use ? geoFill(n) : 'repeating-linear-gradient(45deg, var(--accent-soft) 0 3px, transparent 3px 6px)' }} />;
}

export function StructurePanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const unit = useStore((s) => s.ui.lengthUnit);
  const select = useStore((s) => s.select);
  const layersTopDown = [...project.stack.layers].reverse();

  return (
    <aside className="panel-left" aria-label="Structure">
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Layer stack</h2>
          <button className="btn small" onClick={() => addLayer(selection?.type === 'layer' ? selection.id : undefined)} title="Add a layer above the selected one (or at the top)">
            + Layer
          </button>
        </div>
        <div className="rows" role="list">
          <div
            role="listitem"
            className={`row semi${selection?.type === 'cladding' ? ' selected' : ''}`}
            onClick={() => select({ type: 'cladding' })}
          >
            <Swatch p={project} use={project.stack.cladding} />
            <span className="name">Cladding · {materialName(project, project.stack.cladding.material)}</span>
            <span className="meta">∞</span>
          </div>
          {layersTopDown.map((l) => (
            <div
              role="listitem"
              key={l.id}
              className={`row${selection?.type === 'layer' && selection.id === l.id ? ' selected' : ''}`}
              onClick={() => select({ type: 'layer', id: l.id })}
            >
              <Swatch p={project} use={l} />
              <span className="name">
                {l.name} · {materialName(project, l.material)}
              </span>
              <span className="meta num">{formatLength(l.thickness, unit)}</span>
            </div>
          ))}
          <div
            role="listitem"
            className={`row semi${selection?.type === 'substrate' ? ' selected' : ''}`}
            onClick={() => select({ type: 'substrate' })}
          >
            <Swatch p={project} use={project.stack.substrate} />
            <span className="name">Substrate · {materialName(project, project.stack.substrate.material)}</span>
            <span className="meta">∞</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Shapes</h2>
        </div>
        {project.features.length === 0 && <p className="limits">No shapes: the structure is just the layer stack (a slab guide).</p>}
        <div className="rows" role="list">
          {[...project.features].reverse().map((f) => (
            <div
              role="listitem"
              key={f.id}
              className={`row${selection?.type === 'feature' && selection.id === f.id ? ' selected' : ''}`}
              onClick={() => select({ type: 'feature', id: f.id })}
              title={`${KIND_LABEL[f.kind]} on ${anchorLabel(project, f.anchor)}`}
            >
              <Swatch p={project} use={f.kind === 'graded' ? undefined : f} />
              <span className="name">{f.name}</span>
              <span className="meta">{f.kind === 'graded' ? `Δn ${f.deltaN}` : materialName(project, f.material)}</span>
            </div>
          ))}
        </div>
        <div className="add-menu">
          {(Object.keys(KIND_LABEL) as FeatureKind[]).map((k) => (
            <button key={k} className="btn small" onClick={() => addFeature(k)}>
              + {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Properties</h2>
        </div>
        <Properties />
      </section>

      <CustomMaterials />
    </aside>
  );
}

function Properties() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const update = useStore((s) => s.update);

  if (!selection) return <p className="limits">Select a layer or shape (in the list or on the canvas) to edit it.</p>;

  if (selection.type === 'substrate' || selection.type === 'cladding') {
    const which = selection.type;
    const use = project.stack[which];
    return (
      <div className="props">
        <label>Material</label>
        <MaterialSelect
          material={use.material}
          opticAxis={use.opticAxis}
          onChange={(material, opticAxis) => update((p) => void (p.stack[which] = { material, opticAxis }))}
        />
        <span className="hint full" style={{ gridColumn: '1 / -1' }}>
          {which === 'substrate' ? 'Fills everything below the first layer.' : 'Fills everything above the top layer.'}
        </span>
      </div>
    );
  }

  if (selection.type === 'layer') {
    const l = project.stack.layers.find((x) => x.id === selection.id);
    if (!l) return null;
    return <LayerProps l={l} index={project.stack.layers.indexOf(l)} count={project.stack.layers.length} />;
  }

  const f = project.features.find((x) => x.id === selection.id);
  if (!f) return null;
  return <FeatureProps f={f} />;
}

function LayerProps({ l, index, count }: { l: Layer; index: number; count: number }) {
  return (
    <>
      <div className="props">
        <label>Name</label>
        <TextField value={l.name} onCommit={(name) => patchLayer(l.id, { name })} ariaLabel="Layer name" />
        <label>Material</label>
        <MaterialSelect material={l.material} opticAxis={l.opticAxis} onChange={(material, opticAxis) => patchLayer(l.id, { material, opticAxis })} />
        <label>Thickness</label>
        <NumberField value={l.thickness} min={0.001} onCommit={(thickness, c) => patchLayer(l.id, { thickness }, c)} ariaLabel="Layer thickness" />
      </div>
      <div className="props-actions">
        <button className="btn small" disabled={index === count - 1} onClick={() => moveLayer(l.id, 1)}>
          ↑ Move up
        </button>
        <button className="btn small" disabled={index === 0} onClick={() => moveLayer(l.id, -1)}>
          ↓ Move down
        </button>
        <button className="btn small" onClick={() => deleteLayer(l.id)}>
          Delete
        </button>
      </div>
      <p className="limits" style={{ marginTop: 8 }}>
        Tip: drag the layer’s top edge on the canvas to change its thickness.
      </p>
    </>
  );
}

function AnchorSelect({ f }: { f: Feature }) {
  const project = useStore((s) => s.project);
  return (
    <select className="field" value={f.anchor} onChange={(e) => setAnchorKeepPosition(f.id, e.target.value)} aria-label="Sits on">
      <option value="substrate">top of substrate (y = 0)</option>
      {project.stack.layers.map((l) => (
        <option key={l.id} value={l.id}>
          top of {l.name}
        </option>
      ))}
    </select>
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
        <label>Sits on</label>
        <AnchorSelect f={f} />
        {L('x (centre)', f.x, 'x')}
        {L(f.kind === 'circle' || f.kind === 'graded' ? 'y (centre)' : 'y (bottom)', f.y, 'y', undefined, 'Height above the surface it sits on')}

        {f.kind === 'rect' && (
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
        <button className="btn small" onClick={() => reorderFeature(f.id, 1)} title="Draw on top of overlapping shapes">Bring forward</button>
        <button className="btn small" onClick={() => reorderFeature(f.id, -1)}>Send back</button>
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

function CustomMaterials() {
  const custom = useStore((s) => s.project.customMaterials);
  const update = useStore((s) => s.update);
  return (
    <section className="section">
      <details className="advanced">
        <summary>Custom materials ({custom.length})</summary>
        <p className="limits">A constant index you enter yourself, e.g. a measured polymer or doped glass. No dispersion.</p>
        {custom.map((m, i) => (
          <div className="props" key={m.id} style={{ marginBottom: 8 }}>
            <label>Name</label>
            <TextField value={m.name} onCommit={(name) => update((p) => void (p.customMaterials[i].name = name))} />
            <label>n</label>
            <NumberField kind="plain" value={m.n} min={1e-6} step={0.001} onCommit={(v, c) => update((p) => void (p.customMaterials[i].n = v), c)} />
            <label title="Extinction coefficient; > 0 means lossy">k</label>
            <NumberField kind="plain" value={m.k} min={0} step={0.0001} digits={6} onCommit={(v, c) => update((p) => void (p.customMaterials[i].k = v), c)} />
          </div>
        ))}
        <button
          className="btn small"
          onClick={() =>
            update((p) => void p.customMaterials.push({ id: `custom:${uid('m')}`, name: `Custom ${p.customMaterials.length + 1}`, n: 1.5, k: 0 }))
          }
        >
          + Custom material
        </button>
      </details>
    </section>
  );
}
