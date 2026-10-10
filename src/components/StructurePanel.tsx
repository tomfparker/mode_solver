// Left zone: one structure list (read top → bottom like the cross-section), properties of
// the selection, custom materials. Shapes sit on the nearest layer below them in the list;
// drag rows (or use Move up/down) to restack.

import { useState, type DragEvent } from 'react';
import { anchorLabel, uid } from '../geometry/geometry';
import { itemKey, listItems, type ListItem } from '../geometry/stackList';
import type { Feature, FeatureKind, Layer, MaterialUse, Project } from '../geometry/types';
import { indexSummary } from '../materials/display';
import { maxIndexAt, materialInfo } from '../materials/library';
import {
  addFeature, addLayer, deleteFeature, deleteLayer, duplicateFeature, moveInList, patchFeature, patchLayer,
  stepInList, useStore, type Selection,
} from '../state/store';
import { formatLength } from '../state/units';
import { geoFill } from './geoFill';
import { MaterialSelect, NumberField, TextField } from './inputs';

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

function toSelection(it: ListItem): Selection {
  return it.type === 'layer' || it.type === 'feature' ? { type: it.type, id: it.id } : { type: it.type };
}

function isSelected(sel: Selection, it: ListItem): boolean {
  if (!sel || sel.type !== it.type) return false;
  return !('id' in it) || (sel as { id: string }).id === it.id;
}

function Row({ p, it, unit }: { p: Project; it: ListItem; unit: 'nm' | 'um' }) {
  if (it.type === 'cladding' || it.type === 'substrate') {
    const use = p.stack[it.type];
    return (
      <>
        <Swatch p={p} use={use} />
        <span className="name">{it.type === 'cladding' ? 'Cladding' : 'Substrate'} · {materialName(p, use.material)}</span>
        <span className="meta">∞</span>
      </>
    );
  }
  if (it.type === 'layer') {
    const l = p.stack.layers.find((x) => x.id === it.id)!;
    return (
      <>
        <Swatch p={p} use={l} />
        <span className="name">{l.name} · {materialName(p, l.material)}</span>
        <span className="meta num">{formatLength(l.thickness, unit)}</span>
      </>
    );
  }
  const f = p.features.find((x) => x.id === it.id)!;
  return (
    <>
      <Swatch p={p} use={f.kind === 'graded' ? undefined : f} />
      <span className="name">{f.name}</span>
      <span className="meta">{f.kind === 'graded' ? `Δn ${f.deltaN}` : materialName(p, f.material)}</span>
    </>
  );
}

export function StructurePanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const unit = useStore((s) => s.ui.lengthUnit);
  const select = useStore((s) => s.select);
  const items = listItems(project);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const onDragOver = (e: DragEvent<HTMLDivElement>, i: number) => {
    if (!dragKey) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const at = e.clientY < r.top + r.height / 2 ? i : i + 1;
    setDropAt(Math.min(Math.max(at, 1), items.length - 1));
  };
  const endDrag = () => {
    setDragKey(null);
    setDropAt(null);
  };

  const selLayer = selection?.type === 'layer' ? selection.id : undefined;

  return (
    <aside className="panel-left" aria-label="Structure">
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Structure</h2>
          <button className="btn small" onClick={() => addLayer(selLayer)} title="Add a layer above the selected one (or at the top)">
            + Layer
          </button>
        </div>
        <p className="limits" style={{ margin: '0 0 6px' }}>Top to bottom as in the cross-section. Shapes sit on the layer below them; drag to restack.</p>
        <div className="rows" role="list" onDragLeave={(e) => e.currentTarget === e.target && setDropAt(null)}>
          {items.map((it, i) => {
            const key = itemKey(it);
            const pinned = it.type === 'cladding' || it.type === 'substrate';
            const f = it.type === 'feature' ? project.features.find((x) => x.id === it.id) : undefined;
            const cls = [
              'row',
              pinned ? 'semi' : '',
              it.type === 'feature' ? 'shape' : '',
              isSelected(selection, it) ? 'selected' : '',
              dragKey === key ? 'dragging' : '',
              dropAt === i ? 'drop-before' : '',
            ].join(' ');
            return (
              <div
                role="listitem"
                key={key}
                className={cls}
                draggable={!pinned}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', key);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragKey(key);
                }}
                onDragOver={(e) => onDragOver(e, i)}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragKey && dropAt !== null) moveInList(dragKey, dropAt);
                  endDrag();
                }}
                onDragEnd={endDrag}
                onClick={() => select(toSelection(it))}
                title={f ? `${KIND_LABEL[f.kind]} on ${anchorLabel(project, f.anchor)}` : undefined}
              >
                <Row p={project} it={it} unit={unit} />
              </div>
            );
          })}
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

function MoveButtons({ itemKeyStr }: { itemKeyStr: string }) {
  return (
    <>
      <button className="btn small" onClick={() => stepInList(itemKeyStr, -1)} title="Move up in the structure list">
        ↑ Move up
      </button>
      <button className="btn small" onClick={() => stepInList(itemKeyStr, 1)} title="Move down in the structure list">
        ↓ Move down
      </button>
    </>
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
    return <LayerProps l={l} />;
  }

  const f = project.features.find((x) => x.id === selection.id);
  if (!f) return null;
  return <FeatureProps f={f} />;
}

function LayerProps({ l }: { l: Layer }) {
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
        <MoveButtons itemKeyStr={`layer:${l.id}`} />
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
    <select className="field" value={f.anchor} onChange={(e) => patchFeature(f.id, { anchor: e.target.value })} aria-label="Sits on">
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
        <MoveButtons itemKeyStr={`feature:${f.id}`} />
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
