// The structure as one ordered list, read top → bottom like the cross-section:
//
//   Cladding
//     Core          ← shapes sit on the nearest layer below them in the list
//   BOX
//   Substrate
//
// The list is a view of (layers order, feature anchors, feature paint order). Moving an item
// in the list rewrites those three things, so list order is the single source of truth:
// higher in the list = on top (sits above, and wins where shapes overlap).

import type { Project } from './types';

export type ListItem =
  | { type: 'cladding' }
  | { type: 'layer'; id: string }
  | { type: 'feature'; id: string }
  | { type: 'substrate' };

export function itemKey(it: ListItem): string {
  return it.type === 'layer' || it.type === 'feature' ? `${it.type}:${it.id}` : it.type;
}

export function listItems(p: Project): ListItem[] {
  const layerIds = new Set(p.stack.layers.map((l) => l.id));
  const anchorOf = (a: string) => (layerIds.has(a) ? a : 'substrate');
  // Later in paint order = drawn on top = higher in the list.
  const shapesOn = (a: string): ListItem[] =>
    p.features
      .filter((f) => anchorOf(f.anchor) === a)
      .reverse()
      .map((f) => ({ type: 'feature', id: f.id }));
  const out: ListItem[] = [{ type: 'cladding' }];
  for (const l of [...p.stack.layers].reverse()) {
    out.push(...shapesOn(l.id), { type: 'layer', id: l.id });
  }
  out.push(...shapesOn('substrate'), { type: 'substrate' });
  return out;
}

/** Rewrite layer order, feature anchors and feature paint order from a list (mutates `p`). */
export function applyList(p: Project, items: ListItem[]): void {
  const layers = new Map(p.stack.layers.map((l) => [l.id, l]));
  const features = new Map(p.features.map((f) => [f.id, f]));
  const newLayers = [];
  const newFeatures = [];
  let anchor = 'substrate';
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.type === 'layer') {
      const l = layers.get(it.id);
      if (l) {
        newLayers.push(l);
        anchor = l.id;
      }
    } else if (it.type === 'feature') {
      const f = features.get(it.id);
      if (f) {
        f.anchor = anchor;
        newFeatures.push(f);
      }
    }
  }
  p.stack.layers = newLayers;
  p.features = newFeatures;
}

/** Index range [start, end] of what moves with item `i`: a layer drags its shapes along. */
function blockOf(items: ListItem[], i: number): [number, number] {
  if (items[i].type !== 'layer') return [i, i];
  let s = i;
  while (s > 0 && items[s - 1].type === 'feature') s--;
  return [s, i];
}

/**
 * Move the item with `key` so it lands before position `to` (an index into the current list,
 * 0..length). Cladding and substrate stay pinned at the ends. Returns a new list.
 */
export function moveItem(items: ListItem[], key: string, to: number): ListItem[] {
  const i = items.findIndex((it) => itemKey(it) === key);
  if (i < 0 || items[i].type === 'cladding' || items[i].type === 'substrate') return items;
  const [s, e] = blockOf(items, i);
  if (to >= s && to <= e + 1) return items; // dropped onto itself
  const block = items.slice(s, e + 1);
  const rest = [...items.slice(0, s), ...items.slice(e + 1)];
  let at = to > e ? to - block.length : to;
  at = Math.min(Math.max(at, 1), rest.length - 1); // below cladding, above substrate
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/** Move one step up (−1) or down (+1); a layer jumps over a whole neighbouring layer group. */
export function stepItem(items: ListItem[], key: string, dir: -1 | 1): ListItem[] {
  const i = items.findIndex((it) => itemKey(it) === key);
  if (i < 0) return items;
  const [s, e] = blockOf(items, i);
  if (items[i].type === 'feature') return moveItem(items, key, dir < 0 ? s - 1 : e + 2);
  if (dir < 0) {
    if (s <= 1) return items;
    // Jump above the neighbouring block that ends at s − 1.
    const above = items[s - 1];
    const [ps] = above.type === 'layer' ? blockOf(items, s - 1) : [s - 1];
    return moveItem(items, key, ps);
  }
  if (e + 1 >= items.length - 1) return items;
  // Jump below the next layer's block (its shapes, then the layer itself).
  let k = e + 1;
  while (k < items.length - 1 && items[k].type === 'feature') k++;
  return moveItem(items, key, items[k].type === 'layer' ? k + 1 : k);
}
