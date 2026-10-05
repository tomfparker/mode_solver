// Mode names: TE-like (Ex-dominant) and TM-like (Ey-dominant) modes are numbered in order of
// decreasing n_eff within their family. Strongly hybrid modes are just numbered.

import type { ModeResult } from '../solver/types';

const HYBRID = 0.2; // te fraction within [0.2, 0.8] → hybrid

export function labelModes(modes: Pick<ModeResult, 'teFraction'>[]): string[] {
  let te = 0;
  let tm = 0;
  return modes.map((m, i) => {
    if (m.teFraction > 1 - HYBRID) return `TE${te++}`;
    if (m.teFraction < HYBRID) return `TM${tm++}`;
    return `Mode ${i} (hybrid)`;
  });
}
