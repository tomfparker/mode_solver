import { beforeEach, describe, expect, it, vi } from 'vitest';
import { anchorY } from '../geometry/geometry';
import type { RectFeature } from '../geometry/types';
import { buildTemplate } from '../geometry/templates';
import { addFeature, deleteLayer, patchFeature, patchLayer, setAnchorKeepPosition, useStore } from './store';

beforeEach(() => {
  useStore.getState().replaceProject(buildTemplate('sin-strip'));
});

const core = () => useStore.getState().project.features[0];

describe('undo/redo', () => {
  it('undoes and redoes a single edit', () => {
    const w0 = (core() as RectFeature).width;
    patchFeature(core().id, { width: 2 });
    expect(core()).toMatchObject({ width: 2 });
    useStore.getState().undo();
    expect(core()).toMatchObject({ width: w0 });
    useStore.getState().redo();
    expect(core()).toMatchObject({ width: 2 });
  });

  it('coalesces a drag (same key) into one undo step', () => {
    const id = core().id;
    for (let i = 1; i <= 10; i++) patchFeature(id, { x: i * 0.1 }, 'drag-1');
    expect(useStore.getState().past).toHaveLength(1);
    useStore.getState().undo();
    expect(core()).toMatchObject({ x: 0 });
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

describe('layer-anchored features', () => {
  it('move with their layer when its thickness changes', () => {
    const p0 = useStore.getState().project;
    const box = p0.stack.layers[0];
    patchLayer(box.id, { thickness: box.thickness + 1 });
    const p1 = useStore.getState().project;
    expect(anchorY(p1, core().anchor)).toBeCloseTo(anchorY(p0, core().anchor) + 1, 12);
  });

  it('drop onto the surface below when their layer is deleted', () => {
    const box = useStore.getState().project.stack.layers[0];
    deleteLayer(box.id);
    expect(core().anchor).toBe('substrate');
  });

  it('keep their absolute position when re-anchored', () => {
    const p0 = useStore.getState().project;
    const abs0 = anchorY(p0, core().anchor) + core().y;
    setAnchorKeepPosition(core().id, 'substrate');
    const p1 = useStore.getState().project;
    expect(anchorY(p1, core().anchor) + core().y).toBeCloseTo(abs0, 9);
  });
});

it('addFeature selects the new feature', () => {
  addFeature('circle');
  const s = useStore.getState();
  expect(s.selection).toEqual({ type: 'feature', id: s.project.features.at(-1)!.id });
});
