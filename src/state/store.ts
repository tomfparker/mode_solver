// Single app store. `project` is the serialisable source of truth; everything else is UI state.
// Results are derived (see useLiveSolve) and never stored here.

import { create } from 'zustand';
import { anchorY, uid } from '../geometry/geometry';
import { DEFAULT_TEMPLATE_ID, buildTemplate } from '../geometry/templates';
import type { Feature, FeatureKind, Layer, Project } from '../geometry/types';
import type { LengthUnit } from './units';

export type Selection =
  | { type: 'feature'; id: string }
  | { type: 'layer'; id: string }
  | { type: 'substrate' }
  | { type: 'cladding' }
  | null;

export type FieldView = 'E2' | 'Ex' | 'Ey' | 'Ez' | 'Hx' | 'Hy' | 'Hz';

export interface UiState {
  lengthUnit: LengthUnit;
  fieldView: FieldView;
  fieldOpacity: number;
  showContour: boolean;
  selectedMode: number;
  advancedOpen: boolean;
}

export interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'warn';
}

const HISTORY_LIMIT = 200;
const COALESCE_MS = 1500;

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  lastEdit: { key: string; at: number } | null;
  selection: Selection;
  ui: UiState;
  notice: Notice | null;

  /** Apply an edit. Edits sharing a `coalesce` key within a short window form one undo step. */
  update: (recipe: (draft: Project) => void, coalesce?: string) => void;
  replaceProject: (p: Project, opts?: { keepHistory?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  setUi: (patch: Partial<UiState>) => void;
  notify: (text: string, tone?: Notice['tone']) => void;
  dismissNotice: () => void;
}

function loadUnit(): LengthUnit {
  try {
    return localStorage.getItem('lengthUnit') === 'um' ? 'um' : 'nm';
  } catch {
    return 'nm';
  }
}

export const useStore = create<State>((set, get) => ({
  project: buildTemplate(DEFAULT_TEMPLATE_ID),
  past: [],
  future: [],
  lastEdit: null,
  selection: null,
  ui: { lengthUnit: loadUnit(), fieldView: 'E2', fieldOpacity: 0.85, showContour: true, selectedMode: 0, advancedOpen: false },
  notice: null,

  update: (recipe, coalesce) => {
    const { project, past, lastEdit } = get();
    const draft = structuredClone(project);
    recipe(draft);
    const now = Date.now();
    const merge = coalesce !== undefined && lastEdit?.key === coalesce && now - lastEdit.at < COALESCE_MS;
    set({
      project: draft,
      past: merge ? past : [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      lastEdit: coalesce !== undefined ? { key: coalesce, at: now } : null,
    });
  },

  replaceProject: (p, opts) => {
    const { project, past } = get();
    set({
      project: p,
      past: opts?.keepHistory ? [...past, project].slice(-HISTORY_LIMIT) : [],
      future: [],
      lastEdit: null,
      selection: null,
      ui: { ...get().ui, selectedMode: 0 },
    });
  },

  undo: () => {
    const { past, project, future } = get();
    if (past.length === 0) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], lastEdit: null });
    fixSelection(get, set);
  },

  redo: () => {
    const { past, project, future } = get();
    if (future.length === 0) return;
    set({ project: future[0], past: [...past, project], future: future.slice(1), lastEdit: null });
    fixSelection(get, set);
  },

  select: (s) => set({ selection: s }),
  setUi: (patch) => {
    if (patch.lengthUnit) {
      try {
        localStorage.setItem('lengthUnit', patch.lengthUnit);
      } catch {
        /* storage unavailable: preference just isn't remembered */
      }
    }
    set({ ui: { ...get().ui, ...patch } });
  },
  notify: (text, tone = 'info') => set({ notice: { id: Date.now(), text, tone } }),
  dismissNotice: () => set({ notice: null }),
}));

/** Drop a selection whose object no longer exists (after undo/redo/delete). */
function fixSelection(get: () => State, set: (s: Partial<State>) => void) {
  const { selection, project } = get();
  if (selection?.type === 'feature' && !project.features.some((f) => f.id === selection.id)) set({ selection: null });
  if (selection?.type === 'layer' && !project.stack.layers.some((l) => l.id === selection.id)) set({ selection: null });
}

// ---- Edit helpers -------------------------------------------------------------------------

export function patchFeature(id: string, patch: Partial<Feature>, coalesce?: string) {
  useStore.getState().update((p) => {
    const i = p.features.findIndex((f) => f.id === id);
    if (i >= 0) p.features[i] = { ...p.features[i], ...patch } as Feature;
  }, coalesce);
}

export function patchLayer(id: string, patch: Partial<Layer>, coalesce?: string) {
  useStore.getState().update((p) => {
    const l = p.stack.layers.find((x) => x.id === id);
    if (l) Object.assign(l, patch);
  }, coalesce);
}

function topAnchor(p: Project): string {
  const ls = p.stack.layers;
  return ls.length ? ls[ls.length - 1].id : 'substrate';
}

export function newFeature(p: Project, kind: FeatureKind): Feature {
  const anchor = topAnchor(p);
  const material = p.features.find((f) => f.kind !== 'graded')?.material ?? 'Si3N4';
  const id = uid('f');
  const count = p.features.length + 1;
  switch (kind) {
    case 'rect':
      return { id, kind, name: `Rectangle ${count}`, material, anchor, x: 0, y: 0, width: 0.6, height: 0.4 };
    case 'trapezoid':
      return { id, kind, name: `Trapezoid ${count}`, material, anchor, x: 0, y: 0, widthBottom: 0.8, widthTop: 0.5, height: 0.4 };
    case 'circle':
      return { id, kind, name: `Circle ${count}`, material, anchor, x: 0, y: 0.5, radius: 0.5 };
    case 'polygon':
      return { id, kind, name: `Polygon ${count}`, material, anchor, x: 0, y: 0, points: [[-0.4, 0], [0.4, 0], [0.2, 0.4], [-0.2, 0.4]] };
    case 'graded':
      return {
        id, kind, name: `Graded index ${count}`, anchor, x: 0, y: 0, deltaN: 0.01,
        profileX: 'gaussian', stripWidth: 0, wx: 1, wy: 1, profileY: 'gaussian',
      };
  }
}

export function addFeature(kind: FeatureKind) {
  const s = useStore.getState();
  const f = newFeature(s.project, kind);
  s.update((p) => void p.features.push(f));
  s.select({ type: 'feature', id: f.id });
}

export function deleteFeature(id: string) {
  const s = useStore.getState();
  s.update((p) => void (p.features = p.features.filter((f) => f.id !== id)));
  if (s.selection?.type === 'feature' && s.selection.id === id) s.select(null);
}

export function duplicateFeature(id: string) {
  const s = useStore.getState();
  const f = s.project.features.find((x) => x.id === id);
  if (!f) return;
  const copy = { ...structuredClone(f), id: uid('f'), name: `${f.name} copy`, x: f.x + 0.2 } as Feature;
  s.update((p) => void p.features.splice(p.features.indexOf(p.features.find((x) => x.id === id)!) + 1, 0, copy));
  s.select({ type: 'feature', id: copy.id });
}

/** Move a feature up/down in paint order (later features win where shapes overlap). */
export function reorderFeature(id: string, dir: -1 | 1) {
  useStore.getState().update((p) => {
    const i = p.features.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.features.length) return;
    [p.features[i], p.features[j]] = [p.features[j], p.features[i]];
  });
}

/** Insert a layer above `belowId` (or at the top). */
export function addLayer(aboveOf?: string) {
  const s = useStore.getState();
  const id = uid('l');
  s.update((p) => {
    const i = aboveOf ? p.stack.layers.findIndex((l) => l.id === aboveOf) + 1 : p.stack.layers.length;
    p.stack.layers.splice(i, 0, { id, name: `Layer ${p.stack.layers.length + 1}`, material: 'SiO2', thickness: 0.5 });
  });
  s.select({ type: 'layer', id });
}

/** Delete a layer. Features sitting on it move to the surface below, keeping their offsets. */
export function deleteLayer(id: string) {
  const s = useStore.getState();
  s.update((p) => {
    const i = p.stack.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    const below = i > 0 ? p.stack.layers[i - 1].id : 'substrate';
    for (const f of p.features) if (f.anchor === id) f.anchor = below;
    p.stack.layers.splice(i, 1);
  });
  if (s.selection?.type === 'layer' && s.selection.id === id) s.select(null);
}

/** Swap a layer with its neighbour. Features keep their anchors (they move with their layer). */
export function moveLayer(id: string, dir: -1 | 1) {
  useStore.getState().update((p) => {
    const i = p.stack.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.stack.layers.length) return;
    [p.stack.layers[i], p.stack.layers[j]] = [p.stack.layers[j], p.stack.layers[i]];
  });
}

/** Re-anchor a feature while keeping its absolute position. */
export function setAnchorKeepPosition(id: string, anchor: string) {
  useStore.getState().update((p) => {
    const f = p.features.find((x) => x.id === id);
    if (!f) return;
    const abs = anchorY(p, f.anchor) + f.y;
    f.anchor = anchor;
    f.y = Math.round((abs - anchorY(p, anchor)) * 1e6) / 1e6;
  });
}
