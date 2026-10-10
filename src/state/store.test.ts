import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTemplate } from '../geometry/templates';
import type { RectFeature } from '../geometry/types';
import { addFeature, addLayer, deleteFeature, duplicateFeature, patchFeature, stepFeature, useStore } from './store';

beforeEach(() => {
  useStore.getState().replaceProject(buildTemplate('sin-strip'));
});

const core = () => useStore.getState().project.features.find((f) => f.name === 'Core') as RectFeature;
const ids = () => useStore.getState().project.features.map((f) => f.id);

describe('undo/redo', () => {
  it('undoes and redoes a single edit', () => {
    const w0 = core().width;
    patchFeature(core().id, { width: 2 });
    expect(core().width).toBe(2);
    useStore.getState().undo();
    expect(core().width).toBe(w0);
    useStore.getState().redo();
    expect(core().width).toBe(2);
  });

  it('coalesces a drag (same key) into one undo step', () => {
    const id = core().id;
    for (let i = 1; i <= 10; i++) patchFeature(id, { x: i * 0.1 }, 'drag-1');
    expect(useStore.getState().past).toHaveLength(1);
    useStore.getState().undo();
    expect(core().x).toBe(0);
  });

  it('does not coalesce different keys or edits after the time window', () => {
    vi.useFakeTimers();
    const id = core().id;
    patchFeature(id, { x: 0.1 }, 'k');
    vi.advanceTimersByTime(5000);
    patchFeature(id, { x: 0.2 }, 'k');
    patchFeature(id, { x: 0.3 }, 'other');
    expect(useStore.getState().past).toHaveLength(3);
    vi.useRealTimers();
  });

  it('a new edit clears the redo stack', () => {
    patchFeature(core().id, { x: 1 });
    useStore.getState().undo();
    patchFeature(core().id, { x: 2 });
    expect(useStore.getState().future).toHaveLength(0);
  });
});

describe('structure list', () => {
  it('stepping a shape changes what is drawn on top', () => {
    const before = ids();
    stepFeature(core().id, -1);
    expect(ids().indexOf(core().id)).toBe(before.indexOf(core().id) - 1);
    stepFeature(core().id, -1);
    stepFeature(core().id, -1);
    expect(ids()[0]).toBe(core().id); // clamps at the bottom
  });

  it('addLayer puts a full-width layer on top of the existing layers, below finite shapes', () => {
    addLayer();
    const fs = useStore.getState().project.features;
    const added = fs.find((f) => f.name.startsWith('Layer')) as RectFeature;
    expect(added.fullWidth).toBe(true);
    expect(added.y).toBe(0); // top of the BOX
    expect(fs.indexOf(added)).toBeLessThan(fs.findIndex((f) => f.name === 'Core'));
  });

  it('addFeature selects the new shape and opens its editor', () => {
    addFeature('circle');
    const s = useStore.getState();
    expect(s.selection).toEqual({ type: 'feature', id: s.project.features.at(-1)!.id });
    expect(s.ui.editorOpen).toBe(true);
  });

  it('duplicating a layer stacks the copy on top of it', () => {
    const box = useStore.getState().project.features.find((f) => f.name === 'BOX') as RectFeature;
    duplicateFeature(box.id);
    const copy = useStore.getState().project.features.find((f) => f.name === 'BOX copy') as RectFeature;
    expect(copy.y).toBeCloseTo(box.y + box.height, 9);
  });

  it('deleting the selected shape closes its editor', () => {
    useStore.getState().select({ type: 'feature', id: core().id });
    useStore.getState().setUi({ editorOpen: true });
    deleteFeature(core().id);
    expect(useStore.getState().selection).toBeNull();
    expect(useStore.getState().ui.editorOpen).toBe(false);
  });
});
