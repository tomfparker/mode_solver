// Plain-language warnings derived from (project, result). Pure: tested in warnings.test.ts.

import { effectivePadding, usedMaterials } from '../geometry/geometry';
import type { Project } from '../geometry/types';
import { indexAt, materialInfo } from '../materials/library';
import { fmtWavelengthNm } from '../state/format';
import type { SolveResult } from '../solver/types';
import { labelModes } from './modeLabels';

export type WarningAction = { kind: 'increase-padding'; label: string; padding: number };

export interface Warning {
  id: string;
  tone: 'warn' | 'info';
  text: string;
  action?: WarningAction;
}

/** |E|² at the window edge above this fraction of the peak means the window is too small. */
export const BOUNDARY_THRESHOLD = 1e-3;

function rangeText(r: [number, number]): string {
  const f = (v: number) => (v < 1 ? `${Math.round(v * 1000)} nm` : `${v} µm`);
  return `${f(r[0])}–${f(r[1])}`;
}

export function computeWarnings(p: Project, result: SolveResult | null): Warning[] {
  const out: Warning[] = [];
  const lam = fmtWavelengthNm(p.wavelength);

  // Material data validity and provenance.
  const seen = new Set<string>();
  for (const use of usedMaterials(p)) {
    if (seen.has(use.material)) continue;
    seen.add(use.material);
    const info = materialInfo(use.material, p.customMaterials);
    if (!info) {
      out.push({ id: `unknown-${use.material}`, tone: 'warn', text: `Unknown material "${use.material}". It is treated as n = 1.` });
      continue;
    }
    if (info.kind === 'custom') {
      const c = p.customMaterials.find((m) => m.id === use.material)!;
      out.push({
        id: `custom-${c.id}`,
        tone: 'info',
        text: `${c.name} uses the constant index you entered (n = ${c.n}), with no dispersion.`,
      });
      if (c.k > 0) {
        out.push({
          id: `lossy-${c.id}`,
          tone: 'warn',
          text: `${c.name} is lossy (k = ${c.k}). Results are approximate until absorbing boundaries are added.`,
        });
      }
      continue;
    }
    for (const axis of ['x', 'y', 'z'] as const) {
      const v = indexAt(use.material, p.wavelength, p.customMaterials, axis, use.opticAxis ?? 'z');
      if (v && !v.inRange && v.range) {
        out.push({
          id: `range-${use.material}`,
          tone: 'warn',
          text: `λ = ${lam} is outside the published data range for ${info.name} (${rangeText(v.range)}). Its index is extrapolated and may be wrong.`,
        });
        break;
      }
    }
  }

  // Δn values in templates are examples the user should replace.
  for (const f of p.features) {
    if (f.deltaNIsExample) {
      out.push({
        id: `example-dn-${f.id}`,
        tone: 'info',
        text: `${f.name}: Δn = ${f.deltaN} is an example value. Enter your measured or datasheet value.`,
      });
    }
  }

  if (!result) return out;

  const guided = result.modes.filter((m) => m.guided);
  if (guided.length === 0) {
    out.push({
      id: 'no-guided',
      tone: 'warn',
      text: `No guided mode at ${lam}. The core is below cut-off: make it larger or increase the index contrast.`,
    });
  } else {
    const labels = labelModes(result.modes);
    const te = guided.filter((m) => m.teFraction >= 0.5).length;
    const tm = guided.length - te;
    if (te > 1 || tm > 1) {
      const which = result.modes.map((m, i) => (m.guided ? labels[i] : null)).filter(Boolean).join(', ');
      const capped = guided.length >= p.settings.numModes;
      out.push({
        id: 'multimode',
        tone: 'warn',
        text:
          `Multimode at ${lam}: ${capped ? 'at least ' : ''}${guided.length} guided modes (${which}).` +
          (capped ? ' Raise “Modes” under Advanced to find them all.' : ''),
      });
    }
  }

  const worst = Math.max(...result.modes.filter((m) => m.guided).map((m) => m.boundaryAmplitude), 0);
  if (worst > BOUNDARY_THRESHOLD) {
    const pad = effectivePadding(p);
    const next = Math.round(pad * 1.5 * 100) / 100;
    out.push({
      id: 'boundary',
      tone: 'warn',
      text: 'A mode reaches the edge of the simulation window, so its size and n_eff may be wrong. Enlarge the window.',
      action: { kind: 'increase-padding', label: `Set padding to ${next} µm`, padding: next },
    });
  }

  return out;
}
