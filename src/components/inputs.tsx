// Shared inputs: a unit-aware number field and a material picker.

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Axis } from '../materials/types';
import { indexSummary, sourceHref, sourceTitle } from '../materials/display';
import { LIBRARY, materialInfo } from '../materials/library';
import { useStore } from '../state/store';
import { UNIT_LABEL, parseLength, toDisplay } from '../state/units';

interface NumberFieldProps {
  value: number;
  /** Commit a new value. `coalesce` groups arrow-key bursts into one undo step. */
  onCommit: (v: number, coalesce?: string) => void;
  /** 'length' values are µm shown in the user's unit; 'plain' are unitless. */
  kind?: 'length' | 'plain';
  unitLabel?: string;
  min?: number;
  max?: number;
  /** Arrow-key step (plain fields). Length fields step 1 nm (Shift: 10 nm). */
  step?: number;
  digits?: number;
  title?: string;
  ariaLabel?: string;
  width?: number;
}

export function NumberField({
  value, onCommit, kind = 'length', unitLabel, min, max, step = 0.001, digits = 4, title, ariaLabel, width,
}: NumberFieldProps) {
  const unit = useStore((s) => s.ui.lengthUnit);
  const shown = kind === 'length' ? toDisplay(value, unit) : String(Number(value.toFixed(digits)));
  // Draft text exists only while the user is editing; otherwise the field shows the store value.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? shown;
  const setText = setDraft;
  const [error, setError] = useState<string | null>(null);
  const key = useId();
  const ref = useRef<HTMLInputElement>(null);

  const parse = (t: string): number | null => {
    const v = kind === 'length' ? parseLength(t, unit) : Number(t.trim());
    // Round away float noise (2002 × 0.001 ≠ 2.002) so an unchanged field never re-commits.
    return v === null || !Number.isFinite(v) || t.trim() === '' ? null : Number(v.toFixed(9));
  };

  const check = (v: number | null): string | null => {
    if (v === null) return kind === 'length' ? 'Enter a length, e.g. 450 nm or 0.45 µm' : 'Enter a number';
    if (min !== undefined && v < min) return `Must be at least ${kind === 'length' ? toDisplay(min, unit) + ' ' + UNIT_LABEL[unit] : min}`;
    if (max !== undefined && v > max) return `Must be at most ${max}`;
    return null;
  };

  const commit = () => {
    const v = parse(text);
    const e = check(v);
    setError(e);
    if (!e && v !== null && Math.abs(v - value) > 1e-12) onCommit(v);
    if (!e) setDraft(null);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit();
      ref.current?.select();
    } else if (e.key === 'Escape') {
      setDraft(null);
      setError(null);
      ref.current?.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const s = kind === 'length' ? (e.shiftKey ? 0.01 : 0.001) : step * (e.shiftKey ? 10 : 1);
      const base = parse(text) ?? value;
      let v = base + (e.key === 'ArrowUp' ? s : -s);
      v = Math.round(v / s) * s;
      if (min !== undefined) v = Math.max(v, min);
      if (max !== undefined) v = Math.min(v, max);
      v = Number(v.toFixed(9));
      setDraft(null);
      setError(null);
      onCommit(v, `arrow-${key}`);
    }
  };

  return (
    <span className="numfield" title={error ?? title}>
      <input
        ref={ref}
        className={`field${error ? ' invalid' : ''}`}
        style={width ? { width } : undefined}
        value={text}
        aria-label={ariaLabel}
        aria-invalid={!!error}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={onKey}
        inputMode="decimal"
        spellCheck={false}
      />
      <span className="u">{kind === 'length' ? UNIT_LABEL[unit] : unitLabel}</span>
    </span>
  );
}

export function TextField({
  value, onCommit, ariaLabel, className = 'field',
}: { value: string; onCommit: (v: string) => void; ariaLabel?: string; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={className}
      value={draft ?? value}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const t = draft?.trim();
        if (t && t !== value) onCommit(t);
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

interface MaterialSelectProps {
  material: string;
  opticAxis?: Axis;
  onChange: (material: string, opticAxis?: Axis) => void;
  ariaLabel?: string;
  compact?: boolean;
}

const AXIS_HINT: Record<Axis, string> = {
  x: 'x (horizontal): e.g. X/Y-cut film, TE sees n_e',
  y: 'y (vertical): e.g. Z-cut, TM sees n_e',
  z: 'z (along the guide): both TE and TM see n_o',
};

export function MaterialSelect({ material, opticAxis, onChange, ariaLabel, compact }: MaterialSelectProps) {
  const project = useStore((s) => s.project);
  const { wavelength: lam, customMaterials: custom } = project;
  const info = materialInfo(material, custom);
  const href = sourceHref(material, custom);
  return (
    <>
      <span style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }}>
        <select
          className="field"
          value={material}
          aria-label={ariaLabel ?? 'Material'}
          onChange={(e) => {
            const id = e.target.value;
            const uni = materialInfo(id, custom)?.kind === 'uniaxial';
            onChange(id, uni ? (opticAxis ?? 'z') : undefined);
          }}
        >
          {!info && <option value={material}>{material} (unknown)</option>}
          <optgroup label="Library (sourced)">
            {LIBRARY.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {indexSummary(m.id, lam, custom)}
              </option>
            ))}
          </optgroup>
          {custom.length > 0 && (
            <optgroup label="Custom (constant n)">
              {custom.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {indexSummary(m.id, lam, custom)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {href && (
          <a className="source-link" href={href} target="_blank" rel="noreferrer" title={sourceTitle(material, custom)}>
            ⓘ
          </a>
        )}
      </span>
      {info?.kind === 'uniaxial' && !compact && (
        <>
          <label>Optic axis</label>
          <select
            className="field"
            value={opticAxis ?? 'z'}
            onChange={(e) => onChange(material, e.target.value as Axis)}
            aria-label="Crystal optic axis"
          >
            {(['x', 'y', 'z'] as Axis[]).map((a) => (
              <option key={a} value={a}>
                {AXIS_HINT[a]}
              </option>
            ))}
          </select>
        </>
      )}
    </>
  );
}
