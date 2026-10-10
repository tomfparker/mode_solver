// Left zone: the structure list (top of the list = drawn on top) and custom materials.
// Click a row (or a shape on the canvas) to open its pop-up editor; drag rows to restack.

import { useState, type DragEvent } from 'react';
import { isFullWidth, uid } from '../geometry/geometry';
import type { Feature, FeatureKind, MaterialUse, Project } from '../geometry/types';
import { maxIndexAt, materialInfo } from '../materials/library';
import { addFeature, addLayer, moveFeature, useStore } from '../state/store';
import { formatLength } from '../state/units';
import { geoFill } from './geoFill';
import { NumberField, TextField } from './inputs';
import { SimulationPanel } from './SimulationPanel';

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

/** "SiO₂ (fused silica)" → "SiO₂" for compact list rows. */
function shortName(p: Project, id: string) {
  return materialName(p, id).replace(/\s*\(.*\)\s*$/, '');
}

function Swatch({ p, use }: { p: Project; use?: MaterialUse }) {
  const n = use ? maxIndexAt(use.material, p.wavelength, p.customMaterials) : 1;
  return <span className="swatch" style={{ background: use ? geoFill(n) : 'repeating-linear-gradient(45deg, var(--accent-soft) 0 3px, transparent 3px 6px)' }} />;
}

function meta(p: Project, f: Feature, unit: 'nm' | 'um'): string {
  if (f.kind === 'graded') return `Δn ${f.deltaN}`;
  if (isFullWidth(f)) return `${shortName(p, f.material)} · ${f.height >= 10 ? 'deep' : formatLength(f.height, unit)}`;
  return shortName(p, f.material);
}

export function StructurePanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const unit = useStore((s) => s.ui.lengthUnit);
  const select = useStore((s) => s.select);
  const setUi = useStore((s) => s.setUi);
  const topDown = [...project.features].reverse();
  const [dragId, setDragId] = useState<string | null>(null);
  // Drop position as an index into topDown (insert before that row; length = at the bottom).
  const [dropAt, setDropAt] = useState<number | null>(null);

  const open = (s: NonNullable<typeof selection>) => {
    select(s);
    setUi({ editorOpen: true });
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>, i: number) => {
    if (!dragId) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (dragId && dropAt !== null) {
      // topDown index → bottom-up array index (after removing the dragged shape).
      const from = topDown.findIndex((f) => f.id === dragId);
      const at = dropAt > from ? dropAt - 1 : dropAt;
      moveFeature(dragId, topDown.length - 1 - at);
    }
    setDragId(null);
    setDropAt(null);
  };

  return (
    <aside className="panel-left" aria-label="Structure">
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Structure</h2>
        </div>
        <p className="limits" style={{ margin: '0 0 6px' }}>Higher in the list is drawn on top. Click to edit; drag to reorder.</p>
        <div className="rows" role="list">
          {topDown.map((f, i) => (
            <div
              role="listitem"
              key={f.id}
              className={[
                'row',
                selection?.type === 'feature' && selection.id === f.id ? 'selected' : '',
                dragId === f.id ? 'dragging' : '',
                dropAt === i ? 'drop-before' : '',
                dropAt === topDown.length && i === topDown.length - 1 ? 'drop-after' : '',
              ].join(' ')}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', f.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragId(f.id);
              }}
              onDragOver={(e) => onDragOver(e, i)}
              onDrop={onDrop}
              onDragEnd={() => {
                setDragId(null);
                setDropAt(null);
              }}
              onClick={() => open({ type: 'feature', id: f.id })}
              title={isFullWidth(f) ? 'Layer: spans the whole width' : KIND_LABEL[f.kind]}
            >
              <Swatch p={project} use={f.kind === 'graded' ? undefined : f} />
              <span className="name">
                {isFullWidth(f) && <span className="layer-tag" aria-label="full-width layer">▭</span>}
                {f.name}
              </span>
              <span className="meta">{meta(project, f, unit)}</span>
            </div>
          ))}
          <div
            role="listitem"
            className={`row semi${selection?.type === 'background' ? ' selected' : ''}`}
            onClick={() => open({ type: 'background' })}
            title="Fills the whole plane wherever there is no shape"
          >
            <Swatch p={project} use={project.background} />
            <span className="name">Background · {shortName(project, project.background.material)}</span>
            <span className="meta">everywhere</span>
          </div>
        </div>
        <div className="add-menu">
          <button className="btn small" onClick={addLayer} title="A full-width rectangle: substrate, BOX, film…">
            + Layer
          </button>
          {(Object.keys(KIND_LABEL) as FeatureKind[]).map((k) => (
            <button key={k} className="btn small" onClick={() => addFeature(k)}>
              + {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </section>

      <SimulationPanel />

      <CustomMaterials />
    </aside>
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
