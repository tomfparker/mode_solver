import { describe, expect, it } from 'vitest';
import { applyList, itemKey, listItems, moveItem, stepItem } from './stackList';
import { buildTemplate } from './templates';
import type { Project } from './types';

const keys = (p: Project) => listItems(p).map(itemKey);

/** LN ridge template plus a second shape on the BOX, with readable ids. */
function sample(): Project {
  const p = buildTemplate('ln-ridge');
  p.stack.layers[0].id = 'box';
  p.stack.layers[1].id = 'slab';
  p.features[0].id = 'ridge';
  p.features[0].anchor = 'slab';
  p.features.push({ ...structuredClone(p.features[0]), id: 'pad', anchor: 'box' });
  return p;
}

describe('structure list', () => {
  it('reads top → bottom with each shape just above the layer it sits on', () => {
    expect(keys(sample())).toEqual(['cladding', 'feature:ridge', 'layer:slab', 'feature:pad', 'layer:box', 'substrate']);
  });

  it('applying the list keeps anchors and layers, and is idempotent', () => {
    const p = sample();
    const anchors = Object.fromEntries(p.features.map((f) => [f.id, f.anchor]));
    applyList(p, listItems(p));
    expect(Object.fromEntries(p.features.map((f) => [f.id, f.anchor]))).toEqual(anchors);
    const once = structuredClone(p);
    applyList(p, listItems(p));
    expect(p).toEqual(once);
  });

  it('dragging a shape below a layer makes it sit on the next layer down', () => {
    const p = sample();
    const items = moveItem(listItems(p), 'feature:ridge', 3); // between slab and pad
    applyList(p, items);
    expect(p.features.find((f) => f.id === 'ridge')!.anchor).toBe('box');
    expect(keys(p)).toEqual(['cladding', 'layer:slab', 'feature:ridge', 'feature:pad', 'layer:box', 'substrate']);
  });

  it('higher in the list = painted later (wins overlaps)', () => {
    const p = sample();
    applyList(p, moveItem(listItems(p), 'feature:ridge', 3));
    const order = p.features.map((f) => f.id);
    expect(order.indexOf('ridge')).toBeGreaterThan(order.indexOf('pad'));
  });

  it('moving a layer carries the shapes sitting on it', () => {
    const p = sample();
    applyList(p, stepItem(listItems(p), 'layer:slab', 1));
    expect(keys(p)).toEqual(['cladding', 'feature:pad', 'layer:box', 'feature:ridge', 'layer:slab', 'substrate']);
    expect(p.stack.layers.map((l) => l.id)).toEqual(['slab', 'box']);
    expect(p.features.find((f) => f.id === 'ridge')!.anchor).toBe('slab');
  });

  it('cladding and substrate stay pinned', () => {
    const items = listItems(sample());
    expect(moveItem(items, 'cladding', 3)).toBe(items);
    const moved = moveItem(items, 'feature:pad', 0);
    expect(moved[0]).toEqual({ type: 'cladding' });
    const down = moveItem(items, 'feature:ridge', 99);
    expect(down.at(-1)).toEqual({ type: 'substrate' });
    expect(down.at(-2)).toEqual({ type: 'feature', id: 'ridge' });
  });

  it('a shape steps across a layer boundary one row at a time', () => {
    const p = sample();
    applyList(p, stepItem(listItems(p), 'feature:pad', -1));
    expect(p.features.find((f) => f.id === 'pad')!.anchor).toBe('slab');
  });

  it('shapes whose layer no longer exists list on the substrate', () => {
    const p = sample();
    p.features[1].anchor = 'gone';
    expect(keys(p).slice(-2)).toEqual(['feature:pad', 'substrate']);
  });
});
