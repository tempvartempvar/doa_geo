/**
 * _plane.js - shared scene code for the three flat-world lessons (01-03).
 *
 * Maps are drawn in kilometres; the physics core (planar.js) works in metres. Everything here is glue:
 * unit conversion, handle factories with the course's marker conventions, standard curve styles, a
 * zoom inset centred on the emitter (where metre-scale error bands become visible), and geometry
 * helpers (polyline crossings, Mahalanobis tests). No physics numbers are computed here.
 */
import { Plot2D, contourLines } from '../ui/plot2d.js';
import { fmt } from '../ui/controls.js';
import { planar } from '../core/index.js';

export const KM = 1000;
export const C = planar.C;

/** Arrow length on the map per m/s of velocity: 250 m/s draws a 30 km arrow. */
export const VEL_SCALE = 30 / 250;
/** Largest speed a velocity handle can be dragged to, m/s. */
export const VMAX = 600;
export const VMIN = 10;

/** Faint family / bold curve / band styles shared by every lesson. */
export const STYLE = {
  family: { width: 1, alpha: 0.32 },
  bold: { width: 2.6 },
  range: { width: 1.2, dash: [5, 4], alpha: 0.75 },
  band: { fillAlpha: 0.24 },
};

const COLLECTOR_VAR = { A: '--collector-a', B: '--collector-b', C: '--collector-c', D: '--collector-d' };

/** Standard equal-aspect map in km. */
export function mapPlot(host, opts = {}) {
  return new Plot2D(host, {
    height: 470,
    equalAspect: true,
    view: { xmin: -100, xmax: 100, ymin: -80, ymax: 95 },
    xLabel: 'East (km)',
    yLabel: 'North (km)',
    ...opts,
  });
}

/** A collector handle (triangle in the collector's colour). */
export function addCollector(plot, name, x, y, opts = {}) {
  return plot.addHandle({ x, y, color: COLLECTOR_VAR[name], label: name, shape: 'triangle', ...opts });
}

/** The emitter handle (red diamond). */
export function addEmitter(plot, x, y, opts = {}) {
  return plot.addHandle({ x, y, color: '--emitter', label: 'E', shape: 'diamond', ...opts });
}

/** Keep a dragged velocity between VMIN and VMAX m/s. */
export function clampSpeed(vx, vy) {
  const s = Math.hypot(vx, vy);
  if (s > VMAX) return [vx * VMAX / s, vy * VMAX / s];
  if (s < VMIN) return s > 0 ? [vx * VMIN / s, vy * VMIN / s] : [VMIN, 0];
  return [vx, vy];
}

/** Velocity arrow (m/s) with a draggable tip, in the base handle's colour. */
export function addVelocity(plot, base, vx, vy, opts = {}) {
  return plot.addVectorHandle({ base, vx, vy, scale: VEL_SCALE, color: base.color, width: 2, constrain: clampSpeed, ...opts });
}

/** Position of a handle in metres. */
export const posM = (h) => [h.x * KM, h.y * KM];

/** planar collector object { p (m), v (m/s) } from a position handle and an optional vector handle. */
export function collectorOf(h, vh = null) {
  return { p: [h.x * KM, h.y * KM], v: vh ? [vh.vx, vh.vy] : [0, 0] };
}

/**
 * Sample a field on the map. fn receives the emitter position in METRES (a reused array: do not keep it).
 */
export function fieldKm(g, fn, opts = {}) {
  const e = [0, 0];
  return g.sampleField((x, y) => { e[0] = x * KM; e[1] = y * KM; return fn(e); }, opts);
}

/** Dashed lines of sight from the emitter to each collector handle. */
export function rangeLines(g, E, handles) {
  for (const h of handles) g.segment(E.x, E.y, h.x, h.y, { ...STYLE.range, color: h.color });
}

/** Draw contour polylines (from contourLines) with a style. */
export function drawLines(g, lines, style) {
  for (const l of lines) g.line(l, style);
}

/** Marker for a "ghost" solution: hollow ring and a label. */
export function drawGhost(g, x, y, label = 'ghost') {
  g.circle(x, y, 9, { color: '--emitter', width: 2, dash: [3, 3] });
  g.marker(x, y, 'diamond', 4, { color: '--emitter', ring: false });
  g.text(x, y, label, { dx: 12, dy: 10, size: 12, baseline: 'top', color: '--emitter' });
}

/** Position-fix dots. pts in any units already converted by the caller. */
export function drawFixes(g, pts) {
  if (pts.length) g.points(pts, { color: '--estimate', size: 1.8, alpha: 0.55 });
}

/** Squared Mahalanobis distance of (dx, dy) under 2x2 covariance P. */
export function mahal2(P, dx, dy) {
  const a = P[0][0], b = P[0][1], d = P[1][1];
  const det = a * d - b * b;
  if (!(det > 0)) return Infinity;
  return (d * dx * dx - 2 * b * dx * dy + a * dy * dy) / det;
}

/** Angle between two 2-vectors folded to 0..90 degrees (null if either is zero). */
export function crossingAngleDeg(g1, g2) {
  const n1 = Math.hypot(g1[0], g1[1]), n2 = Math.hypot(g2[0], g2[1]);
  if (!(n1 > 0 && n2 > 0)) return null;
  const c = Math.min(1, Math.abs(g1[0] * g2[0] + g1[1] * g2[1]) / (n1 * n2));
  return Math.acos(c) * 180 / Math.PI;
}

/** Positive finite range of a field rounded out to whole decades (for log colour scales). */
export function decadeRange(field, { lo = 0.02, hi = 0.98, minDecades = 1 } = {}) {
  const vals = [];
  const d = field.data;
  for (let k = 0; k < d.length; k += 3) { const v = d[k]; if (v > 0 && isFinite(v)) vals.push(v); }
  if (!vals.length) return { min: 1, max: 10 };
  vals.sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(p * (vals.length - 1))))];
  let a = Math.floor(Math.log10(q(lo))), b = Math.ceil(Math.log10(q(hi)));
  if (b - a < minDecades) b = a + minDecades;
  return { min: Math.pow(10, a), max: Math.pow(10, b) };
}

/**
 * Crossing points of two sets of polylines (segment-segment intersection with bounding-box rejection).
 * Returns [[x, y], ...] in the polylines' units.
 */
export function polylineCrossings(linesA, linesB) {
  const segs = (lines) => {
    const out = [];
    for (const l of lines) {
      for (let k = 0; k + 1 < l.length; k++) {
        const p = l[k], q = l[k + 1];
        out.push([p[0], p[1], q[0], q[1], Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])]);
      }
    }
    return out;
  };
  const SA = segs(linesA), SB = segs(linesB);
  const pts = [];
  for (const a of SA) {
    for (const b of SB) {
      if (a[5] < b[4] || b[5] < a[4] || a[7] < b[6] || b[7] < a[6]) continue;
      const rx = a[2] - a[0], ry = a[3] - a[1], sx = b[2] - b[0], sy = b[3] - b[1];
      const den = rx * sy - ry * sx;
      if (den === 0) continue;
      const qx = b[0] - a[0], qy = b[1] - a[1];
      const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) pts.push([a[0] + t * rx, a[1] + t * ry]);
    }
  }
  return pts;
}

/** Merge points closer than tol (same units). */
export function dedupe(pts, tol) {
  const out = [];
  for (const p of pts) if (!out.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < tol)) out.push(p);
  return out;
}

/**
 * All solutions in view of a two-measurement problem: intersect the contour lines of two fields at the
 * given levels, then polish each crossing with planar.locate (noise-free z). Returns positions in km
 * that reproduce both measurements, each flagged `isTrue` when it is the emitter itself.
 * @param {object} o  { fieldA, levelA, fieldB, levelB, meas, collectors, z, f0, noise, eKm:[x,y], view }
 */
export function solutionsInView({ fieldA, levelA, fieldB, levelB, meas, collectors, z, f0, noise, eKm, view }) {
  const raw = polylineCrossings(contourLines(fieldA, levelA), contourLines(fieldB, levelB));
  const found = [];
  for (const p of dedupe(raw, 0.5).slice(0, 12)) {
    let res;
    try {
      res = planar.locate({ meas, collectors, z, f0, noise, x0: [p[0] * KM, p[1] * KM], maxIter: 30 });
    } catch { continue; }
    const x = res.x[0] / KM, y = res.x[1] / KM;
    if (!isFinite(x) || !isFinite(y) || !(res.cost < 1e-3)) continue;
    if (Math.hypot(x - p[0], y - p[1]) > 15) continue; // wandered off to another solution
    if (view && (x < view.xmin || x > view.xmax || y < view.ymin || y > view.ymax)) continue;
    found.push([x, y]);
  }
  return dedupe(found, 0.05).map(([x, y]) => ({ x, y, isTrue: Math.hypot(x - eKm[0], y - eKm[1]) < 0.05 }));
}

/**
 * Zoom inset: an equal-aspect plot centred on the emitter, in metres (or km when the window is large),
 * re-scaled by the lesson so that metre-scale error bands, ellipses and fix clouds are visible.
 * Pan and zoom are off: the lesson owns the view.
 */
export class ZoomInset {
  constructor(host, { height = 300, ariaLabel = 'Zoomed view around the emitter' } = {}) {
    this.plot = new Plot2D(host, {
      height, equalAspect: true, pan: false, zoom: false,
      view: { xmin: -100, xmax: 100, ymin: -100, ymax: 100 },
      xLabel: 'East of E (m)', yLabel: 'North of E (m)', ariaLabel,
    });
    this.cx = 0; this.cy = 0; this.unit = 1; this.half = 100;
    this._e = [0, 0];
  }
  /** Centre (m) and half-width of the window (m). */
  setFrame(cxM, cyM, halfM) {
    this.cx = cxM; this.cy = cyM;
    const unit = halfM >= 5000 ? 1000 : 1;
    const label = unit === 1 ? 'm' : 'km';
    this.plot.opts.xLabel = `East of E (${label})`;
    this.plot.opts.yLabel = `North of E (${label})`;
    const changed = unit !== this.unit || Math.abs(halfM / this.half - 1) > 1e-9;
    this.unit = unit; this.half = halfM;
    const h = halfM / unit;
    if (changed) this.plot.setView({ xmin: -h, xmax: h, ymin: -h, ymax: h });
    else this.plot.requestRedraw();
  }
  get unitLabel() { return this.unit === 1 ? 'm' : 'km'; }
  /** Absolute position (m) -> inset coordinates. */
  local(xm, ym) { return [(xm - this.cx) / this.unit, (ym - this.cy) / this.unit]; }
  /** Sample fn(absolute position in metres) over the inset window. */
  field(g, fn, opts = {}) {
    const e = this._e, u = this.unit, cx = this.cx, cy = this.cy;
    return g.sampleField((x, y) => { e[0] = cx + x * u; e[1] = cy + y * u; return fn(e); }, { nx: 90, ny: 70, ...opts });
  }
  /** Error ellipse (semi-axes in metres, from estimate.errorEllipse) centred on the emitter. */
  ellipse(g, ell, style) { g.ellipse(0, 0, ell.semiMajor / this.unit, ell.semiMinor / this.unit, ell.angle, style); }
  destroy() { this.plot.destroy(); }
}

/** Half-width (m) for an inset that frames a 95 % ellipse with some margin, clamped to a sane range. */
export function insetHalfWidth(ell, factor = 1.6) {
  if (!ell) return 1000;
  const h = ell.semiMajor * factor;
  // round up to a 1-2-5 step so the view does not jitter while dragging
  const steps = [1, 1.5, 2, 3, 5, 7];
  const dec = Math.pow(10, Math.floor(Math.log10(Math.max(h, 1e-3))));
  for (const s of steps) if (s * dec >= h) return Math.min(2e5, s * dec);
  return Math.min(2e5, 10 * dec);
}

/** Inject lesson-scoped CSS; returns a remover for the cleanup function. */
export function injectStyle(css) {
  const s = document.createElement('style');
  s.textContent = css;
  document.head.append(s);
  return () => s.remove();
}

/** Distance in metres (below 1 km) or km, 3 significant figures; never millimetres. */
export function fmtM(m, sig = 3) {
  if (!isFinite(m)) return '—';
  return Math.abs(m) < 1000 ? `${fmt(m, sig)} m` : `${fmt(m / 1000, sig)} km`;
}

/** Signed number with a proper minus sign and fixed decimals. */
export function fixed(v, d) {
  if (!isFinite(v)) return '—';
  const s = v.toFixed(d);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s.replace('-', '−');
}
