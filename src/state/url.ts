// Project ⇄ URL hash. The hash is "#p=" + lz-string-compressed JSON. Decoding always goes
// through the zod schema, so a hand-edited or truncated link can't put bad state in the store.

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { parseProject } from '../geometry/schema';
import type { Project } from '../geometry/types';

const KEY = 'p=';

/** Round floats to 1e-6 µm (1 pm) so the URL doesn't carry float noise. */
function tidy(_key: string, v: unknown) {
  return typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v;
}

export function encodeProject(p: Project): string {
  return KEY + compressToEncodedURIComponent(JSON.stringify(p, tidy));
}

export type DecodeResult = { ok: true; project: Project } | { ok: false; error: string } | { ok: 'empty' };

export function decodeHash(hash: string): DecodeResult {
  const h = hash.replace(/^#/, '');
  if (!h.startsWith(KEY)) return { ok: 'empty' };
  const json = decompressFromEncodedURIComponent(h.slice(KEY.length));
  if (!json) return { ok: false, error: 'link is truncated or not a project link' };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'link data is not valid JSON' };
  }
  return parseProject(raw);
}
