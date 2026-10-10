// Centre zone: geometry + field overlay. Numbers stay the source of truth: every drag here
// writes the same store fields the numeric inputs edit.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  anchorY, featureBox, gradedExtent, indexAtPoint, layerBounds, shapePolygon, solveDomain, stackTop, uid,
} from '../../geometry/geometry';
import type { Feature, MaterialUse, Project } from '../../geometry/types';
import { maxIndexAt, materialInfo } from '../../materials/library';
import { fmtIndex } from '../../state/format';
import { patchFeature, patchLayer, useStore, type FieldView } from '../../state/store';
import { formatLength } from '../../state/units';
import type { SolveResult } from '../../solver/types';
import { geoFill } from '../geoFill';
import { usePrefersDark } from '../usePrefersDark';
import { e2Contour, fieldData, fieldDataUrl } from './fieldImage';
import { applyDrag, dragLayerTop, handlesFor, snapTargets, type SnapContext } from './handles';
import { fitView, niceStep, scaleBar, toPx, toUm, zoomAt, type Size, type View } from './view';

type Drag =
  | { type: 'feature'; id: string; handle: string; start: Feature; x0: number; y0: number; key: string; targets: { xs: number[]; ys: number[] } }
  | { type: 'layer-edge'; id: string; key: string; targets: { xs: number[]; ys: number[] } }
  | { type: 'pan'; px: number; py: number; view: View; moved: boolean; onClick?: () => void };

const FIELD_VIEWS: { id: FieldView; label: string }[] = [
  { id: 'E2', label: '|E|²' },
  { id: 'Ex', label: 'Ex' },
  { id: 'Ey', label: 'Ey' },
  { id: 'Ez', label: 'Ez' },
  { id: 'Hx', label: 'Hx' },
  { id: 'Hy', label: 'Hy' },
  { id: 'Hz', label: 'Hz' },
];

function fillFor(p: Project, use: MaterialUse, deltaN = 0) {
  return geoFill(maxIndexAt(use.material, p.wavelength, p.customMaterials) + deltaN);
}

function matName(p: Project, id: string) {
  return materialInfo(id, p.customMaterials)?.name ?? id;
}

export function CanvasView({ result, stale, solving }: { result: SolveResult | null; stale: boolean; solving: boolean }) {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const ui = useStore((s) => s.ui);
  const viewEpoch = useStore((s) => s.viewEpoch);
  const select = useStore((s) => s.select);
  const setUi = useStore((s) => s.setUi);

  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<Size>({ w: 800, h: 600 });
  const [view, setView] = useState<View | null>(null);
  const [readout, setReadout] = useState<{ x: number; y: number; n: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  /** True once the user zooms or pans; auto-fit then leaves their view alone until they press Fit. */
  const userAdjusted = useRef(false);

  const domain = useMemo(() => solveDomain(project), [project]);

  // Track container size.
  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    userAdjusted.current = false;
    setView(fitView(domain, size, 48));
  }, [domain, size]);

  // Re-fit when the window no longer fits on screen (e.g. a shape was added), unless the user
  // has set their own view. Never during a drag: the view must not move under the pointer.
  const contained = (v: View | null) => {
    if (!v) return false;
    const [x0, y0] = toUm(v, size, 0, size.h);
    const [x1, y1] = toUm(v, size, size.w, 0);
    return domain.x0 >= x0 && domain.x1 <= x1 && domain.y0 >= y0 && domain.y1 <= y1;
  };
  useEffect(() => {
    if (view && !userAdjusted.current && !drag.current && !contained(view)) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, size]);

  // Fit on first layout and whenever a new project is loaded.
  const fittedEpoch = useRef(-1);
  useEffect(() => {
    if (size.w < 10) return;
    if (fittedEpoch.current !== viewEpoch || !view) {
      fittedEpoch.current = viewEpoch;
      fit();
    }
  }, [viewEpoch, size, fit, view]);

  // Keyboard "f" fits the view (App dispatches this event).
  useEffect(() => {
    const h = () => fit();
    window.addEventListener('fit-view', h);
    return () => window.removeEventListener('fit-view', h);
  }, [fit]);

  // Wheel zoom (needs a non-passive listener to prevent page scroll).
  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      userAdjusted.current = true;
      setView((v) => (v ? zoomAt(v, size, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)) : v));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [size]);

  const dark = usePrefersDark();
  const mode = result?.modes[Math.min(ui.selectedMode, (result?.modes.length ?? 1) - 1)];
  const image = useMemo(() => {
    if (!result || !mode) return null;
    const d = fieldData(mode, ui.fieldView);
    if (!d) return null;
    return { url: fieldDataUrl(d, result.grid, undefined, dark), part: d.part };
  }, [result, mode, ui.fieldView, dark]);
  const contour = useMemo(() => (result && mode ? e2Contour(mode, result.grid) : []), [result, mode]);

  if (!view) return <div className="canvas-zone" ref={wrap}><svg ref={svgRef} /></div>;

  const P = (x: number, y: number) => toPx(view, size, x, y);
  const [vx0, vy0] = toUm(view, size, 0, size.h);
  const [vx1, vy1] = toUm(view, size, size.w, 0);
  const path = (pts: [number, number][]) => pts.map((q, i) => `${i ? 'L' : 'M'}${P(q[0], q[1]).join(',')}`).join('') + 'Z';

  const local = (e: PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const snapCtx = (e: PointerEvent, targets: { xs: number[]; ys: number[] }): SnapContext => ({
    enabled: !e.shiftKey,
    step: niceStep(10 / view.scale),
    threshold: 6 / view.scale,
    ...targets,
  });

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const [px, py] = local(e);
    const [x, y] = toUm(view, size, px, py);
    const el = (e.target as Element).closest('[data-kind]') as SVGElement | null;
    const kind = el?.dataset.kind;
    const id = el?.dataset.id ?? '';
    svgRef.current!.setPointerCapture(e.pointerId);

    if (e.button === 1 || e.button === 2 || !kind) {
      drag.current = { type: 'pan', px, py, view, moved: false };
      return;
    }
    if (kind === 'feature' || kind === 'handle') {
      const fid = kind === 'handle' ? el!.dataset.feature! : id;
      const f = project.features.find((q) => q.id === fid)!;
      select({ type: 'feature', id: fid });
      drag.current = {
        type: 'feature', id: fid, handle: kind === 'handle' ? id : 'move', start: structuredClone(f),
        x0: x, y0: y, key: uid('drag'), targets: snapTargets(project, fid),
      };
      return;
    }
    if (kind === 'layer-edge') {
      select({ type: 'layer', id });
      drag.current = { type: 'layer-edge', id, key: uid('drag'), targets: snapTargets(project, null) };
      return;
    }
    // Clicking a layer/substrate/cladding selects it; dragging pans.
    const target =
      kind === 'layer' ? ({ type: 'layer', id } as const) : kind === 'substrate' ? ({ type: 'substrate' } as const) : ({ type: 'cladding' } as const);
    drag.current = { type: 'pan', px, py, view, moved: false, onClick: () => select(target) };
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const [px, py] = local(e);
    const [x, y] = toUm(view, size, px, py);
    setReadout({ x, y, n: indexAtPoint(project, x, y, 'x') });
    const d = drag.current;
    if (!d) return;
    if (d.type === 'pan') {
      const dx = px - d.px;
      const dy = py - d.py;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        d.moved = true;
        userAdjusted.current = true;
      }
      if (d.moved) setView({ ...d.view, cx: d.view.cx - dx / d.view.scale, cy: d.view.cy + dy / d.view.scale });
    } else if (d.type === 'feature') {
      const patch = applyDrag(project, d.start, d.handle, x, y, x - d.x0, y - d.y0, snapCtx(e, d.targets));
      patchFeature(d.id, patch, d.key);
    } else if (d.type === 'layer-edge') {
      const t = dragLayerTop(project, d.id, y, snapCtx(e, d.targets));
      if (t !== null) patchLayer(d.id, { thickness: t }, d.key);
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (d?.type === 'pan' && !d.moved) {
      if (d.onClick) d.onClick();
      else select(null);
    }
    drag.current = null;
    if (d && d.type !== 'pan' && !userAdjusted.current && !contained(view)) fit();
  };

  // ---- Geometry ------------------------------------------------------------------------
  const top = stackTop(project);
  const bounds = layerBounds(project);
  const W = Math.max(0, size.w);
  const band = (yA: number, yB: number) => {
    const [, pyA] = P(0, yA);
    const [, pyB] = P(0, yB);
    return { y: Math.min(pyA, pyB), h: Math.abs(pyB - pyA) };
  };
  const sub = band(Math.min(vy0, 0), 0);
  const clad = band(top, Math.max(vy1, top));

  const featureShape = (f: Feature, props: Record<string, unknown>) => {
    if (f.kind === 'circle') {
      const [cx, cy] = P(f.x, anchorY(project, f.anchor) + f.y);
      return <circle cx={cx} cy={cy} r={f.radius * view.scale} {...props} />;
    }
    if (f.kind === 'graded') {
      const e = gradedExtent(f);
      const yc = anchorY(project, f.anchor) + f.y;
      const [cx, cy] = P(f.x, yc);
      const rx = e.hx * view.scale;
      const ryDown = e.hyDown * view.scale;
      const d =
        f.profileY === 'half-gaussian'
          ? `M${cx - rx},${cy} A${rx},${ryDown} 0 0 0 ${cx + rx},${cy} Z`
          : `M${cx - rx},${cy} A${rx},${ryDown} 0 1 0 ${cx + rx},${cy} A${rx},${ryDown} 0 1 0 ${cx - rx},${cy} Z`;
      return <path d={d} strokeDasharray="5 4" {...props} />;
    }
    return <path d={path(shapePolygon(project, f)!)} {...props} />;
  };

  const selFeature = selection?.type === 'feature' ? project.features.find((f) => f.id === selection.id) : undefined;
  const sb = scaleBar(view);

  // Image placement: grid cell edges.
  let imgRect: { x: number; y: number; w: number; h: number } | null = null;
  if (result && image) {
    const g = result.grid;
    const dx = g.x[1] - g.x[0];
    const dy = g.y[1] - g.y[0];
    const [ax, ay] = P(g.x[0] - dx / 2, g.y[g.ny - 1] + dy / 2);
    const [bx, by] = P(g.x[g.nx - 1] + dx / 2, g.y[0] - dy / 2);
    imgRect = { x: ax, y: ay, w: bx - ax, h: by - ay };
  }
  const [dx0, dy1] = P(domain.x0, domain.y1);
  const [dx1, dy0] = P(domain.x1, domain.y0);

  return (
    <div className="canvas-zone" ref={wrap}>
      {result?.isMock && (
        <div className="mock-banner" role="status" title="The real finite-difference solver arrives in the next milestone. Geometry and refractive indices are already real.">
          Preview: modes are <b>simulated placeholders</b>, not physical results
        </div>
      )}

      <div className="canvas-tools" aria-label="Field display">
        <div className="line">
          <label htmlFor="fieldview">Show</label>
          <select id="fieldview" className="field" value={ui.fieldView} onChange={(e) => setUi({ fieldView: e.target.value as FieldView })} style={{ width: 'auto' }}>
            {FIELD_VIEWS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          {image?.part && <span className="limits">{image.part === 're' ? 'real part' : 'imag. part'}</span>}
        </div>
        <div className="line">
          <label htmlFor="opacity">Opacity</label>
          <input id="opacity" type="range" min={0} max={1} step={0.05} value={ui.fieldOpacity} onChange={(e) => setUi({ fieldOpacity: Number(e.target.value) })} />
        </div>
        <label className="line">
          <input type="checkbox" checked={ui.showContour} onChange={(e) => setUi({ showContour: e.target.checked })} /> 1/e² contour
        </label>
      </div>

      <div className="zoom-tools">
        <button className="btn icon" title="Zoom in" onClick={() => { userAdjusted.current = true; setView(zoomAt(view, size, size.w / 2, size.h / 2, 1.4)); }}>+</button>
        <button className="btn icon" title="Zoom out" onClick={() => { userAdjusted.current = true; setView(zoomAt(view, size, size.w / 2, size.h / 2, 1 / 1.4)); }}>−</button>
        <button className="btn icon" title="Fit to window (F)" onClick={fit}>⤢</button>
      </div>

      {(solving || stale) && (
        <div className="updating">{solving ? 'Solving…' : 'Out of date: press Solve (Ctrl+Enter)'}</div>
      )}

      <svg
        ref={svgRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setReadout(null)}
        onContextMenu={(e) => e.preventDefault()}
        role="img"
        aria-label="Waveguide cross-section with mode field"
      >
        {/* Infinite slabs */}
        <rect data-kind="cladding" x={0} y={clad.y} width={W} height={clad.h} fill={fillFor(project, project.stack.cladding)} />
        {bounds.map(({ layer, y0, y1 }) => {
          const b = band(y0, y1);
          return <rect key={layer.id} data-kind="layer" data-id={layer.id} x={0} y={b.y} width={W} height={b.h} fill={fillFor(project, layer)} />;
        })}
        <rect data-kind="substrate" x={0} y={sub.y} width={W} height={sub.h} fill={fillFor(project, project.stack.substrate)} />
        {[0, ...bounds.map((b) => b.y1)].map((yy, i) => (
          <line key={i} x1={0} x2={W} y1={P(0, yy)[1]} y2={P(0, yy)[1]} stroke="var(--geo-stroke)" strokeOpacity={0.5} strokeWidth={1} pointerEvents="none" />
        ))}

        {/* Shape fills */}
        {project.features.map((f) =>
          f.kind === 'graded' ? null : <g key={f.id}>{featureShape(f, { fill: fillFor(project, f, f.deltaN ?? 0), stroke: 'none' })}</g>,
        )}

        {/* Field */}
        {image && imgRect && (
          <image
            href={image.url}
            x={imgRect.x}
            y={imgRect.y}
            width={imgRect.w}
            height={imgRect.h}
            preserveAspectRatio="none"
            opacity={ui.fieldOpacity * (stale ? 0.45 : 1)}
            pointerEvents="none"
            style={{ imageRendering: 'auto' }}
          />
        )}

        {/* Simulation window */}
        <rect x={dx0} y={dy1} width={dx1 - dx0} height={dy0 - dy1} fill="none" stroke="var(--text-3)" strokeDasharray="2 4" pointerEvents="none" />
        <text className="canvas-label" x={dx1 - 6} y={dy0 - 6} textAnchor="end" style={{ pointerEvents: 'auto', cursor: 'help' }}>
          Simulation window
          <title>The solver computes modes only inside this window; its edges act as walls. Size it under Advanced → Padding.</title>
        </text>

        {/* Outlines on top of the field, also the hit areas for shapes */}
        {project.features.map((f) => (
          <g key={f.id} style={{ cursor: 'move' }}>
            {featureShape(f, {
              'data-kind': 'feature',
              'data-id': f.id,
              fill: 'transparent',
              stroke: selFeature?.id === f.id ? 'var(--sel)' : 'var(--geo-stroke)',
              strokeWidth: selFeature?.id === f.id ? 2 : 1.25,
            })}
          </g>
        ))}

        {/* Layer top edges: drag to change thickness */}
        {bounds.map(({ layer, y1 }) => {
          const yy = P(0, y1)[1];
          return (
            <line key={layer.id} data-kind="layer-edge" data-id={layer.id} x1={0} x2={W} y1={yy} y2={yy} stroke="transparent" strokeWidth={9} style={{ cursor: 'ns-resize' }}>
              <title>Drag to change {layer.name} thickness</title>
            </line>
          );
        })}

        {/* 1/e² contour */}
        {ui.showContour && contour.length > 0 && (
          <path
            d={contour.map((ring) => ring.map((q, i) => `${i ? 'L' : 'M'}${P(q[0], q[1]).join(',')}`).join('') + 'Z').join('')}
            fill="none"
            stroke="var(--contour)"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            opacity={stale ? 0.4 : 1}
            pointerEvents="none"
          />
        )}

        {/* Labels */}
        {clad.h > 18 && (
          <text className="canvas-label" x={W - 12} y={clad.y + clad.h - 6} textAnchor="end">
            Cladding · {matName(project, project.stack.cladding.material)}
          </text>
        )}
        {bounds.map(({ layer, y0, y1 }) => {
          const b = band(y0, y1);
          if (b.h < 14) return null;
          return (
            <text key={layer.id} className="canvas-label" x={W - 12} y={Math.max(b.y, 0) + 15} textAnchor="end">
              {layer.name} · {matName(project, layer.material)} · {formatLength(layer.thickness, ui.lengthUnit)}
            </text>
          );
        })}
        {sub.h > 18 && (
          <text className="canvas-label" x={W - 12} y={sub.y + 15} textAnchor="end">
            Substrate · {matName(project, project.stack.substrate.material)}
          </text>
        )}
        {project.features.map((f) => {
          const b = featureBox(project, f);
          const [cx, cyTop] = P((b.x0 + b.x1) / 2, b.y1);
          const wide = (b.x1 - b.x0) * view.scale > 40;
          if (!wide && selFeature?.id !== f.id) return null;
          return (
            <text key={f.id} className={`canvas-label${selFeature?.id === f.id ? ' strong' : ''}`} x={cx} y={cyTop - 6} textAnchor="middle">
              {f.name}
            </text>
          );
        })}

        {/* Handles */}
        {selFeature &&
          handlesFor(project, selFeature).map((h) => {
            const [hx, hy] = P(h.x, h.y);
            return (
              <circle
                key={h.name}
                className="handle"
                data-kind="handle"
                data-id={h.name}
                data-feature={selFeature.id}
                cx={hx}
                cy={hy}
                r={5}
                style={{ cursor: h.cursor }}
              />
            );
          })}
      </svg>

      <div className="scalebar" aria-label={`Scale bar ${sb.label}`}>
        <span>{sb.label}</span>
        <div className="bar" style={{ width: sb.px }} />
      </div>

      <div className="readout num">
        {readout
          ? `x ${readout.x.toFixed(3)}  y ${readout.y.toFixed(3)} µm  ·  n ${fmtIndex(readout.n)}`
          : `view ${(vx1 - vx0).toFixed(1)} × ${(vy1 - vy0).toFixed(1)} µm`}
      </div>
    </div>
  );
}
