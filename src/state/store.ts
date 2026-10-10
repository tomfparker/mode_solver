// Single app store. `project` is the serialisable source of truth; everything else is UI state.
// Results are derived (see useLiveSolve) and never stored here.

import { create } from 'zustand';
import { isFullWidth, structureBox, uid } from '../geometry/geometry';
import { DEFAULT_TEMPLATE_ID, buildTemplate } from '../geometry/templates';
import type { Feature, FeatureKind, Project, ShapeFeature } from '../geometry/types';
import type { LengthUnit } from './units';

export type Selection = { type: 'feature'; id: string } | { type: 'background' } | null;

export type FieldView = 'E2' | 'Ex' | 'Ey' | 'Ez' | 'Hx' | 'Hy' | 'Hz';

export interface UiState {
  lengthUnit: LengthUnit;
  fieldView: FieldView;
  fieldOpacity: number;
  showContour: boolean;
  /** Marginal profiles and peak cuts along the canvas edges. */
  showProfiles: boolean;
  selectedMode: number;
  advancedOpen: boolean;
  /** Pop-up editor for the selected shape (or background) is open. */
  editorOpen: boolean;
  /** Which page is showing: the solver workspace or the About page. */
  page: 'solver' | 'about';
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
  /** Bumped when a whole new project is loaded (template, link), so the canvas re-fits. */
  viewEpoch: number;

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
  ui: { lengthUnit: loadUnit(), fieldView: 'E2', fieldOpacity: 0.85, showContour: true, showProfiles: false, selectedMode: 0, advancedOpen: false, editorOpen: false, page: 'solver' },
  notice: null,
  viewEpoch: 0,

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
      viewEpoch: get().viewEpoch + 1,
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
}

// ---- Edit helpers -------------------------------------------------------------------------

export function patchFeature(id: string, patch: Partial<Feature>, coalesce?: string) {
  useStore.getState().update((p) => {
    const i = p.features.findIndex((f) => f.id === id);
    if (i >= 0) p.features[i] = { ...p.features[i], ...patch } as Feature;
  }, coalesce);
}

/** Place new shapes on y = 0 (the usual top surface), beside the existing finite shapes. */
export function newFeature(p: Project, kind: FeatureKind): Feature {
  const material = p.features.find((f): f is ShapeFeature => f.kind !== 'graded' && !isFullWidth(f))?.material ?? 'Si3N4';
  const id = uid('f');
  const n = p.features.length + 1;
  const hasFinite = p.features.some((f) => !isFullWidth(f));
  const b = structureBox(p);
  const half = kind === 'circle' ? 0.5 : kind === 'graded' ? 1 : 0.4;
  const x = hasFinite ? Math.round((b.x1 + 0.3 + half) * 1000) / 1000 : 0;
  switch (kind) {
    case 'rect':
      return { id, kind, name: `Rectangle ${n}`, material, x, y: 0, width: 0.6, height: 0.4 };
    case 'trapezoid':
      return { id, kind, name: `Trapezoid ${n}`, material, x, y: 0, widthBottom: 0.8, widthTop: 0.5, height: 0.4 };
    case 'circle':
      return { id, kind, name: `Circle ${n}`, material, x, y: 0.5, radius: 0.5 };
    case 'polygon':
      return { id, kind, name: `Polygon ${n}`, material, x, y: 0, points: [[-0.4, 0], [0.4, 0], [0.2, 0.4], [-0.2, 0.4]] };
    case 'graded':
      return {
        id, kind, name: `Graded index ${n}`, x, y: 0, deltaN: 0.01,
        profileX: 'gaussian', stripWidth: 0, wx: 1, wy: 1, profileY: 'gaussian',
      };
  }
}

function selectAndEdit(id: string) {
  const s = useStore.getState();
  s.select({ type: 'feature', id });
  s.setUi({ editorOpen: true });
}

export function addFeature(kind: FeatureKind) {
  const s = useStore.getState();
  const f = newFeature(s.project, kind);
  s.update((p) => void p.features.push(f));
  selectAndEdit(f.id);
}

/**
 * Add a full-width layer on top of the existing layers (e.g. a film or upper cladding),
 * listed above them but below any finite shapes so it doesn't cover the core.
 */
export function addLayer() {
  const s = useStore.getState();
  const id = uid('f');
  s.update((p) => {
    const slabs = p.features.filter(isFullWidth);
    const top = slabs.length ? Math.max(...slabs.map((f) => f.y + f.height)) : 0;
    const lastSlab = slabs.length ? p.features.indexOf(slabs[slabs.length - 1]) : -1;
    p.features.splice(lastSlab + 1, 0, {
      id, kind: 'rect', name: `Layer ${slabs.length + 1}`, material: 'SiO2', x: 0, y: top, width: 10, height: 0.5, fullWidth: true,
    });
  });
  selectAndEdit(id);
}

export function deleteFeature(id: string) {
  const s = useStore.getState();
  s.update((p) => void (p.features = p.features.filter((f) => f.id !== id)));
  if (s.selection?.type === 'feature' && s.selection.id === id) {
    s.select(null);
    s.setUi({ editorOpen: false });
  }
}

export function duplicateFeature(id: string) {
  const s = useStore.getState();
  const f = s.project.features.find((x) => x.id === id);
  if (!f) return;
  const copy = { ...structuredClone(f), id: uid('f'), name: `${f.name} copy` } as Feature;
  if (isFullWidth(f)) copy.y = f.y + f.height; // stack a copied layer on top of the original
  else copy.x = f.x + 0.2;
  s.update((p) => void p.features.splice(p.features.findIndex((x) => x.id === id) + 1, 0, copy));
  selectAndEdit(copy.id);
}

/** Move a shape to `index` in the bottom → top order (list order shown top → bottom). */
export function moveFeature(id: string, index: number) {
  useStore.getState().update((p) => {
    const i = p.features.findIndex((f) => f.id === id);
    if (i < 0) return;
    const [f] = p.features.splice(i, 1);
    p.features.splice(Math.min(Math.max(index, 0), p.features.length), 0, f);
  });
}

/** One step towards the top of the list (+1: drawn over more shapes) or the bottom (−1). */
export function stepFeature(id: string, dir: 1 | -1) {
  const i = useStore.getState().project.features.findIndex((f) => f.id === id);
  if (i >= 0) moveFeature(id, i + dir);
}
