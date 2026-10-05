// Length units. Internal unit is µm everywhere; the UI shows nm or µm and accepts either.

export type LengthUnit = 'nm' | 'um';

export const UNIT_LABEL: Record<LengthUnit, string> = { nm: 'nm', um: 'µm' };

const SCALE: Record<string, number> = {
  nm: 1e-3,
  um: 1,
  µm: 1,
  μm: 1, // Greek mu as well as the micro sign
  micron: 1,
  microns: 1,
  mm: 1e3,
};

/**
 * Parse a user-entered length, returning µm, or null if it can't be read.
 * Bare numbers are in `defaultUnit`. Examples: "450", "450 nm", "0.45um", "0.45 µm", "1e-3 mm".
 */
export function parseLength(text: string, defaultUnit: LengthUnit): number | null {
  const m = text.trim().match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([a-zµμ]*)$/i);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = m[2].toLowerCase() || defaultUnit;
  const scale = SCALE[unit];
  if (scale === undefined || !Number.isFinite(value)) return null;
  return value * scale;
}

/** Value in µm → display number in `unit`, rounded to 0.1 nm and with trailing zeros trimmed. */
export function toDisplay(um: number, unit: LengthUnit): string {
  const v = unit === 'nm' ? Math.round(um * 1e4) / 10 : Math.round(um * 1e4) / 1e4;
  return String(Object.is(v, -0) ? 0 : v);
}

export function formatLength(um: number, unit: LengthUnit): string {
  return `${toDisplay(um, unit)} ${UNIT_LABEL[unit]}`;
}

/** Round to the nearest nm (nm-level entry is the finest the UI deals in). */
export function roundNm(um: number): number {
  return Math.round(um * 1000) / 1000;
}
