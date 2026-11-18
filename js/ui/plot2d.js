/**
 * plot2d.js - canvas plotting toolkit for the TDOA/FDOA course.
 * =====================================================================
 * One class, `Plot2D`, for both geometry "maps" (equal aspect, world
 * units) and ordinary XY charts (independent axes, optional log axes).
 * Drawing is immediate-mode: you supply `plot.onDraw = (g) => {...}` and it
 * is re-run on every redraw (window resize, theme change, pan/zoom, handle
 * drag, or your own `plot.requestRedraw()`).
 *
 * USAGE
 * ---------------------------------------------------------------------
 *   import { Plot2D, palette } from '../ui/plot2d.js';
 *
 *   const plot = new Plot2D(containerEl, {
 *     height: 460, equalAspect: true,
 *     view: { xmin: -100, xmax: 100, ymin: -60, ymax: 60 },
 *     xLabel: 'East (km)', yLabel: 'North (km)',
 *   });
 *   const A = plot.addHandle({ x: -40, y: 0, color: '--collector-a', label: 'A', shape: 'square' });
 *   const E = plot.addHandle({ x: 20, y: 30, color: '--emitter', label: 'E',
 *                              onDrag: (x, y) => update() });
 *   plot.onDraw = (g) => {
 *     const f = g.sampleField((x, y) => Math.hypot(x - A.x, y - A.y));
 *     g.heatmap(f, { colormap: 'sequential', min: 0, max: 200 });
 *     g.contour(f, [25, 50, 75, 100], { color: '--tdoa', width: 1, alpha: 0.6 });
 *   };
 *   plot.onHover = (x, y) => `x ${x.toFixed(1)} km\ny ${y.toFixed(1)} km`;
 *   // ...in the lesson's cleanup function:
 *   plot.destroy();
 *
 * CONSTRUCTOR  new Plot2D(container, options)
 * ---------------------------------------------------------------------
 *   height       CSS px (default 420). Width follows the container (ResizeObserver).
 *                Canvas is HiDPI aware (devicePixelRatio).
 *   equalAspect  true: 1 world unit = same pixels in x and y. The view box is fitted
 *                and centred (expanded in one direction), never stretched. Ignored
 *                when either axis is logarithmic. Default false.
 *   view         { xmin, xmax, ymin, ymax } initial view in data units. Default unit box.
 *   xLabel, yLabel  axis titles (strings).
 *   xLog, yLog   logarithmic axes (data must be > 0). Default false.
 *   pan, zoom    drag background to pan; wheel (or pinch) to zoom about the cursor;
 *                double-click resets the view. Default true for both.
 *   grid, axes   draw grid lines / tick labels and axis titles. Default true.
 *   hoverMode    'cursor' (readout follows pointer, default) | 'corner' (top-left).
 *   minSpan, maxSpan  optional zoom limits as a fraction/multiple of the initial span
 *                (defaults 1e-6 and 1e6).
 *
 * PROPERTIES / METHODS
 * ---------------------------------------------------------------------
 *   plot.el                     wrapper element (div.plot2d) appended to container
 *   plot.canvas                 the <canvas>
 *   plot.onDraw = (g) => {}     draw callback, g in WORLD coordinates (see below)
 *   plot.onHover = (x, y) => string|null   readout text ('\n' for multiple lines)
 *   plot.onClick = (x, y, event) => {}     click on background (not after a pan)
 *   plot.onViewChange = (view) => {}       after pan / zoom / setView / reset / resize
 *   plot.requestRedraw()        coalesced with requestAnimationFrame
 *   plot.redraw()               draw synchronously now
 *   plot.setView({xmin,xmax,ymin,ymax}); plot.getView() -> effective (fitted) view
 *   plot.resetView()            back to the initial view
 *   plot.toPixel(x, y) -> [px, py]   CSS px relative to the canvas top-left
 *   plot.toWorld(px, py) -> [x, y]
 *   plot.sampleField(fn, opts)  same as g.sampleField but callable outside onDraw
 *   plot.destroy()              remove DOM, observers and listeners
 *
 * HANDLES (retained objects drawn on top of onDraw output by the plot itself)
 * ---------------------------------------------------------------------
 *   const h = plot.addHandle({
 *     x, y, color: '--collector-a', label: 'A',
 *     shape: 'circle' | 'square' | 'triangle' | 'diamond',  radius: 8 (px),
 *     draggable: true, visible: true, hitRadius (px, default radius + 8; 22 for touch),
 *     onDrag: (x, y, h) => {}, onDragEnd: (x, y, h) => {},
 *     constrain: (x, y) => [x, y],   // e.g. snap or keep on a track
 *   });
 *   h.x, h.y are mutable (call plot.requestRedraw() after changing them), or use
 *   h.setPosition(x, y) which redraws. h.remove().  h.dragging is true mid-drag.
 *
 *   Vector handle: an arrow from a base handle to a draggable tip.
 *   const v = plot.addVectorHandle({ base: h, vx, vy,
 *     scale: 10,          // world units of arrow per 1 velocity unit
 *     color, label: 'v', width: 2, draggable: true,
 *     onDrag: (vx, vy, v) => {}, onDragEnd, constrain: (vx, vy) => [vx, vy] });
 *   v.vx, v.vy (mutable), v.setVector(vx, vy), v.remove().
 *
 * DRAWING CONTEXT  g  (passed to onDraw)
 * ---------------------------------------------------------------------
 * All coordinates are world/data units unless the name says px. Style args are
 * option objects. `color` accepts any CSS color or a CSS variable name such as
 * '--series-1' or '--tdoa' (resolved from :root, re-read on theme change).
 *   Line style:   { color, width = 1.5, dash: [6, 4], alpha = 1, cap, join }
 *   Closed shapes (polygon, circle, circleWorld, ellipse, band) also take
 *                 { fill: color | true (= color), fillAlpha = 1, stroke: false }.
 *                 polygon/circle/ellipse stroke by default and fill only if `fill`
 *                 is set; band fills by default (fillAlpha 0.18) and strokes only
 *                 if `stroke: true`.
 *
 *   g.line(points, style)            polyline [[x,y],...]; NaN points break the line
 *   g.polygon(points, style)
 *   g.segment(x1, y1, x2, y2, style)
 *   g.arrow(x1, y1, x2, y2, style)   style.head = arrow-head length px (default 9)
 *   g.circle(x, y, rPx, style)       radius in PIXELS
 *   g.circleWorld(x, y, r, style)    radius in world units (drawn as ellipse on unequal axes)
 *   g.ellipse(cx, cy, semiA, semiB, angleRad, style)   angle of the a-axis CCW from +x
 *   g.marker(x, y, shape, sizePx, style)  shapes: circle square triangle diamond cross plus.
 *                                    Filled with `color`, 1.5 px surface ring (ring: false to omit)
 *   g.points(pts, { color, size = 1.6 (px radius), alpha = 0.6 })
 *                                    fast scatter; pts = [[x,y],...] or flat [x0,y0,x1,y1,...]
 *   g.text(x, y, str, { color, align = 'left', baseline = 'middle', dx, dy (px),
 *                       size = 12, weight, font, mono, halo = true })
 *   g.band(upper, lower, style)      filled region between two polylines
 *
 *   Scalar fields:
 *   const f = g.sampleField((x, y) => value, { nx = 160, ny = 120, view })
 *        -> { nx, ny, x0, y0, dx, dy, data: Float64Array, xLog, yLog }
 *        Sample (i, j) is at x = x0 + i*dx, y = y0 + j*dy and stored at data[j*nx + i].
 *        Spans the current view exactly. On a log axis x0/dx are in log10 units.
 *        NaN values are allowed and skipped everywhere.
 *   g.contour(field, levels, style)  marching squares, linear interpolation, saddle-correct.
 *        style.color / style.width / style.dash may be functions (level, index) -> value.
 *        style.labels: true | (level) => string  draws a label on each long-enough line.
 *   g.contourBand(field, lo, hi, { fill/color, fillAlpha = 0.25, alpha })
 *        exact filled region lo <= value <= hi (piecewise-linear, smooth edges).
 *   g.heatmap(field, { colormap: 'sequential' | 'diverging' | 'mono' | fn,
 *                      min, max, log = false, alpha = 0.85 })
 *        smooth (bilinear) image; values clamp to [min, max]; NaN transparent;
 *        with log, non-positive values are transparent.
 *   g.image(matrix {nx, ny, data}, x0, x1, y0, y1, { colormap, min, max, log, alpha = 1,
 *                      smooth = true })  gridded data whose cells span [x0,x1]x[y0,y1];
 *        data[j*nx + i] with row j = 0 at y0.
 *   g.colorbar({ colormap, min, max, log, label, position: 'right' | 'left' })
 *   g.legend([{ label, color, dash, width, marker, fill }], { position: 'top-left' |
 *        'top-right' | 'bottom-left' | 'bottom-right' })
 *        colorbar and legend are drawn after handles, on top of everything.
 *
 *   Raw access: g.ctx (CanvasRenderingContext2D, CSS-px units), g.toPixel(x, y),
 *   g.toWorld(px, py), g.pxPerUnit (x scale; = y scale on equal-aspect plots),
 *   g.pxPerUnitY, g.view, g.area {left, top, width, height}, g.color(c) -> CSS color,
 *   g.palette (= palette()), g.plot.
 *
 * OTHER EXPORTS
 * ---------------------------------------------------------------------
 *   contourLines(field, level) -> Array<Array<[x, y]>>   joined polylines (closed loops
 *                                  repeat their first point at the end)
 *   colormaps.sequential(t) / .diverging(t) / .mono(t) -> [r, g, b] (0-255), t in [0,1]
 *   colormaps.css(cmap, t)      -> 'rgb(r, g, b)'; cmap = name or function
 *   niceTicks(min, max, n = 5) -> number[]   "nice" 1/2/5 x 10^k ticks within [min, max]
 *   seriesColor(i)            i-th categorical color (0-based) from --series-1..--series-8
 *   palette()                 { A, B, C, D, collectors: [..4], emitter, estimate, tdoa, fdoa,
 *                               series: [..8], bg, grid, axis, text, textStrong, halo }
 *   cssColor(c)               resolve '--var' or CSS color to a concrete color string
 *   onThemeChange(fn) -> unsubscribe   called after the light/dark theme switches
 */

// ------------------------------------------------------------------ theme
const colorCache = new Map();
let themeVersion = 0;
const livePlots = new Set();
const themeListeners = new Set();

/** Resolve a CSS color or CSS custom property name ('--x') to a concrete color string. */
export function cssColor(c, fallback = '#888') {
  if (c == null) return fallback;
  if (typeof c !== 'string' || !c.startsWith('--')) return c;
  let v = colorCache.get(c);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(c).trim() || fallback;
    colorCache.set(c, v);
  }
  return v;
}

function themeChanged() {
  colorCache.clear();
  lutCache.clear();
  themeVersion++;
  for (const fn of themeListeners) {
    try { fn(); } catch (e) { console.error(e); }
  }
  for (const p of livePlots) p.requestRedraw();
}

/** Subscribe to light/dark theme switches. Returns an unsubscribe function. */
export function onThemeChange(fn) {
  themeListeners.add(fn);
  return () => themeListeners.delete(fn);
}

if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', themeChanged);
  new MutationObserver(themeChanged).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme', 'class', 'style'],
  });
}

function isDarkTheme() {
  const bg = parseColor(cssColor('--plot-bg', '#fff'));
  return (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) < 128;
}

/** i-th categorical colour (0-based, wraps after 8) from --series-1..--series-8. */
export function seriesColor(i) {
  const n = ((Math.floor(i) % 8) + 8) % 8;
  return cssColor(`--series-${n + 1}`);
}

/** Resolve the course's semantic colour roles to concrete colour strings. */
export function palette() {
  const A = cssColor('--collector-a'), B = cssColor('--collector-b');
  const C = cssColor('--collector-c'), D = cssColor('--collector-d');
  return {
    A, B, C, D,
    collectors: [A, B, C, D],
    emitter: cssColor('--emitter'),
    estimate: cssColor('--estimate'),
    tdoa: cssColor('--tdoa'),
    fdoa: cssColor('--fdoa'),
    series: Array.from({ length: 8 }, (_, i) => seriesColor(i)),
    bg: cssColor('--plot-bg', '#fff'),
    grid: cssColor('--plot-grid', '#ddd'),
    axis: cssColor('--plot-axis', '#999'),
    text: cssColor('--plot-text', '#555'),
    textStrong: cssColor('--plot-text-strong', '#111'),
    halo: cssColor('--plot-halo', 'rgba(255,255,255,0.9)'),
  };
}

// --------------------------------------------------------------- colours
let parseCtx = null;
const parsedCache = new Map();
/** Parse any CSS colour to [r, g, b, a(0-1)]. */
function parseColor(c) {
  if (Array.isArray(c)) return [c[0], c[1], c[2], c[3] ?? 1];
  let v = parsedCache.get(c);
  if (v) return v;
  const m = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((ch) => ch + ch).join('');
    v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16),
      h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  } else {
    if (!parseCtx) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      parseCtx = cv.getContext('2d', { willReadFrequently: true });
    }
    parseCtx.clearRect(0, 0, 1, 1);
    parseCtx.fillStyle = '#000';
    parseCtx.fillStyle = c;
    parseCtx.fillRect(0, 0, 1, 1);
    const d = parseCtx.getImageData(0, 0, 1, 1).data;
    v = [d[0], d[1], d[2], d[3] / 255];
  }
  parsedCache.set(c, v);
  return v;
}

function hexToRgb(h) { return parseColor(h).slice(0, 3); }
function rampFn(stops) {
  const rgb = stops.map(hexToRgb);
  const n = rgb.length - 1;
  return (t) => {
    t = t < 0 ? 0 : t > 1 ? 1 : (t || 0);
    const s = t * n, i = Math.min(n - 1, Math.floor(s)), f = s - i;
    const a = rgb[i], b = rgb[i + 1];
    return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
  };
}

const viridis = rampFn(['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725']);
// Diverging blue <-> red with a neutral grey midpoint; stepped separately for each theme
// so that "large magnitude" always means "far from the surface colour".
const divLight = rampFn(['#0d366b', '#2a78d6', '#86b6ef', '#f0efec', '#f2a3a2', '#e34948', '#8a1c1c']);
const divDark = rampFn(['#b7d3f6', '#3987e5', '#1c4f8f', '#383835', '#8f3333', '#e66767', '#f9c2c2']);
const monoLight = rampFn(['#f3f6fb', '#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b']);
const monoDark = rampFn(['#1d2129', '#104281', '#1c5cab', '#3987e5', '#86b6ef', '#cde2fb']);

export const colormaps = {
  /** Viridis-like perceptual ramp, dark violet -> yellow. */
  sequential: viridis,
  /** Blue - neutral - red. Theme-aware: extremes contrast with the page surface. */
  diverging: (t) => (isDarkTheme() ? divDark(t) : divLight(t)),
  /** Single-hue blue ramp from near-surface to strong. Theme-aware. */
  mono: (t) => (isDarkTheme() ? monoDark(t) : monoLight(t)),
  /** CSS string for colormap (name or function) at t. */
  css(cmap, t) {
    const f = typeof cmap === 'function' ? cmap : colormaps[cmap] || viridis;
    const c = f(t);
    if (typeof c === 'string') return c;
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  },
};

const lutCache = new Map();
/** 256-entry RGB lookup table for a colormap (name or function returning [r,g,b] or CSS). */
function getLut(cmap) {
  const key = cmap || 'sequential';
  let lut = lutCache.get(key);
  if (lut) return lut;
  const f = typeof key === 'function' ? key : colormaps[key] || viridis;
  lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    let c = f(i / 255);
    if (typeof c === 'string') c = parseColor(c);
    lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2];
  }
  if (lutCache.size > 64) lutCache.clear(); // guard against per-frame inline colormap functions
  lutCache.set(key, lut);
  return lut;
}

// ----------------------------------------------------------------- ticks
/** "Nice" tick values (1, 2, 5 x 10^k steps) inside [min, max], about n of them. */
export function niceTicks(min, max, n = 5) {
  if (!isFinite(min) || !isFinite(max)) return [];
  if (min > max) [min, max] = [max, min];
  const span = max - min;
  if (span === 0) return [min];
  const raw = span / Math.max(1, n);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const start = Math.ceil(min / step - 1e-9);
  const end = Math.floor(max / step + 1e-9);
  const out = [];
  for (let k = start; k <= end && out.length < 1000; k++) {
    const v = +(k * step).toPrecision(12);
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  out.step = step;
  return out;
}

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const MINUS = '−';
function sup(n) { return String(n).split('').map((c) => SUP[c] ?? c).join(''); }

function fmtTick(v, step) {
  if (v === 0) return '0';
  const av = Math.abs(v);
  if (av >= 1e6 || step < 1e-4) {
    const e = Math.floor(Math.log10(av));
    let m = +(v / Math.pow(10, e)).toPrecision(3);
    const ms = String(m).replace('-', MINUS);
    return (m === 1 ? '' : m === -1 ? MINUS : ms + '×') + '10' + sup(e);
  }
  const dec = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  return v.toFixed(dec).replace('-', MINUS);
}

function logTicks(t0, t1, maxN) {
  // t0, t1 in log10 units. Returns { major: [values], minor: [values] }
  const lo = Math.floor(t0), hi = Math.ceil(t1);
  const decades = t1 - t0;
  let every = 1;
  while ((hi - lo) / every > maxN) every *= 2;
  const major = [], minor = [];
  for (let e = lo; e <= hi; e++) {
    const base = Math.pow(10, e);
    if (e % every === 0 && e >= t0 - 1e-9 && e <= t1 + 1e-9) major.push(base);
    if (every === 1 && decades < 6) {
      for (let k = 2; k <= 9; k++) {
        const v = k * base, tv = Math.log10(v);
        if (tv < t0 || tv > t1) continue;
        if (decades < 1.6 && (k === 2 || k === 5)) major.push(v);
        else minor.push(v);
      }
    }
  }
  major.sort((a, b) => a - b);
  return { major, minor };
}
function fmtLogTick(v) {
  const e = Math.log10(v);
  if (Math.abs(e - Math.round(e)) < 1e-9) {
    const k = Math.round(e);
    if (k >= 0 && k <= 3) return String(Math.pow(10, k));
    if (k === -1) return '0.1';
    if (k === -2) return '0.01';
    return '10' + sup(k);
  }
  const ee = Math.floor(e + 1e-9);
  const m = Math.round(v / Math.pow(10, ee));
  if (ee >= 0 && ee <= 3) return String(m * Math.pow(10, ee));
  if (ee >= -2 && ee < 0) return (m * Math.pow(10, ee)).toFixed(-ee);
  return m + '×10' + sup(ee);
}

// -------------------------------------------------------------- contours
/**
 * Marching-squares contour of `field` at `level`, joined into polylines.
 * Returns Array<Array<[x, y]>> in world units. Cells with a NaN corner are skipped.
 */
export function contourLines(field, level) {
  const { nx, ny, data } = field;
  const segA = [], segB = [];
  const pts = new Map(); // edgeId -> [tx, ty] in field (possibly log) coordinates
  const x0 = field.x0, y0 = field.y0, dx = field.dx, dy = field.dy;

  const hId = (i, j) => 2 * (j * nx + i);       // edge (i,j)-(i+1,j)
  const vId = (i, j) => 2 * (j * nx + i) + 1;   // edge (i,j)-(i,j+1)
  const addPt = (id, xa, ya, xb, yb, va, vb) => {
    if (pts.has(id)) return;
    let t = (level - va) / (vb - va);
    if (!(t >= 0)) t = 0; else if (t > 1) t = 1;
    pts.set(id, [xa + (xb - xa) * t, ya + (yb - ya) * t]);
  };

  for (let j = 0; j < ny - 1; j++) {
    const yA = y0 + j * dy, yB = yA + dy;
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      const v0 = data[k], v1 = data[k + 1], v3 = data[k + nx], v2 = data[k + nx + 1];
      if (v0 !== v0 || v1 !== v1 || v2 !== v2 || v3 !== v3) continue; // NaN
      const c = (v0 >= level ? 1 : 0) | (v1 >= level ? 2 : 0) | (v2 >= level ? 4 : 0) | (v3 >= level ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const xA = x0 + i * dx, xB = xA + dx;
      const e0 = hId(i, j), e1 = vId(i + 1, j), e2 = hId(i, j + 1), e3 = vId(i, j);
      const P = (e) => {
        if (e === e0) addPt(e, xA, yA, xB, yA, v0, v1);
        else if (e === e1) addPt(e, xB, yA, xB, yB, v1, v2);
        else if (e === e2) addPt(e, xA, yB, xB, yB, v3, v2);
        else addPt(e, xA, yA, xA, yB, v0, v3);
        return e;
      };
      const seg = (a, b) => { segA.push(P(a)); segB.push(P(b)); };
      switch (c) {
        case 1: case 14: seg(e3, e0); break;
        case 2: case 13: seg(e0, e1); break;
        case 3: case 12: seg(e3, e1); break;
        case 4: case 11: seg(e1, e2); break;
        case 6: case 9: seg(e0, e2); break;
        case 7: case 8: seg(e3, e2); break;
        case 5: {
          const centre = (v0 + v1 + v2 + v3) / 4;
          if (centre >= level) { seg(e0, e1); seg(e2, e3); } else { seg(e3, e0); seg(e1, e2); }
          break;
        }
        case 10: {
          const centre = (v0 + v1 + v2 + v3) / 4;
          if (centre >= level) { seg(e3, e0); seg(e1, e2); } else { seg(e0, e1); seg(e2, e3); }
          break;
        }
      }
    }
  }

  // Join segments into polylines through shared edge points.
  const n = segA.length;
  const adj = new Map();
  const link = (e, s) => { const l = adj.get(e); if (l) l.push(s); else adj.set(e, [s]); };
  for (let s = 0; s < n; s++) { link(segA[s], s); link(segB[s], s); }
  const used = new Uint8Array(n);
  const walk = (start, out) => {
    let cur = start;
    for (;;) {
      const l = adj.get(cur);
      let next = -1;
      if (l) for (const s of l) if (!used[s]) { next = s; break; }
      if (next < 0) return;
      used[next] = 1;
      cur = segA[next] === cur ? segB[next] : segA[next];
      out.push(cur);
    }
  };
  const xl = field.xLog, yl = field.yLog;
  const toWorld = (e) => {
    const p = pts.get(e);
    return [xl ? Math.pow(10, p[0]) : p[0], yl ? Math.pow(10, p[1]) : p[1]];
  };
  const lines = [];
  for (let s = 0; s < n; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const fwd = [segB[s]];
    walk(segB[s], fwd);
    const back = [];
    walk(segA[s], back);
    const ids = back.reverse();
    ids.push(segA[s]);
    for (const e of fwd) ids.push(e);
    lines.push(ids.map(toWorld));
  }
  return lines;
}

// Sutherland-Hodgman clip of a polygon (flat arrays px, py, val) against val >= t (sign=1)
// or val <= t (sign=-1). Returns new flat arrays.
function clipPoly(px, py, pv, t, sign) {
  const ox = [], oy = [], ov = [];
  const n = px.length;
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    const a = (pv[k] - t) * sign, b = (pv[k2] - t) * sign;
    if (a >= 0) { ox.push(px[k]); oy.push(py[k]); ov.push(pv[k]); }
    if ((a >= 0) !== (b >= 0)) {
      const f = a / (a - b);
      ox.push(px[k] + (px[k2] - px[k]) * f);
      oy.push(py[k] + (py[k2] - py[k]) * f);
      ov.push(t);
    }
  }
  return [ox, oy, ov];
}

// --------------------------------------------------------------- helpers
const clampPx = (v) => (v > 1e6 ? 1e6 : v < -1e6 ? -1e6 : v);
const DEFAULT_SPAN = { xmin: -1, xmax: 1, ymin: -1, ymax: 1 };

function markerPath(ctx, px, py, shape, r) {
  switch (shape) {
    case 'square': {
      const s = r * 0.9;
      ctx.rect(px - s, py - s, 2 * s, 2 * s);
      break;
    }
    case 'triangle': {
      const s = r * 1.2;
      ctx.moveTo(px, py - s);
      ctx.lineTo(px + s * 0.866, py + s * 0.5);
      ctx.lineTo(px - s * 0.866, py + s * 0.5);
      ctx.closePath();
      break;
    }
    case 'diamond': {
      const s = r * 1.25;
      ctx.moveTo(px, py - s); ctx.lineTo(px + s, py); ctx.lineTo(px, py + s); ctx.lineTo(px - s, py);
      ctx.closePath();
      break;
    }
    case 'cross': case 'x': {
      const s = r * 0.8;
      ctx.moveTo(px - s, py - s); ctx.lineTo(px + s, py + s);
      ctx.moveTo(px + s, py - s); ctx.lineTo(px - s, py + s);
      break;
    }
    case 'plus': {
      ctx.moveTo(px - r, py); ctx.lineTo(px + r, py);
      ctx.moveTo(px, py - r); ctx.lineTo(px, py + r);
      break;
    }
    default:
      ctx.moveTo(px + r, py);
      ctx.arc(px, py, r, 0, Math.PI * 2);
  }
}
const isStrokeOnlyMarker = (s) => s === 'cross' || s === 'x' || s === 'plus';

// ================================================================= Plot2D
export class Plot2D {
  constructor(container, options = {}) {
    if (!container) throw new Error('Plot2D: container element is required');
    this.opts = {
      height: 420, equalAspect: false, view: null, xLabel: '', yLabel: '',
      xLog: false, yLog: false, pan: true, zoom: true, grid: true, axes: true,
      hoverMode: 'cursor', minSpan: 1e-6, maxSpan: 1e6,
      ...options,
    };
    const o = this.opts;
    this.xLog = !!o.xLog;
    this.yLog = !!o.yLog;
    this.equalAspect = !!o.equalAspect && !this.xLog && !this.yLog;

    this.onDraw = null;
    this.onHover = null;
    this.onClick = null;
    this.onViewChange = null;

    this.handles = [];
    this.vectors = [];

    // DOM
    this.el = document.createElement('div');
    this.el.className = 'plot2d' + (o.pan ? ' pannable' : '');
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    if (o.ariaLabel) this.canvas.setAttribute('aria-label', o.ariaLabel);
    this.canvas.style.height = o.height + 'px';
    this.hoverEl = document.createElement('div');
    this.hoverEl.className = 'plot2d-hover';
    this.hoverEl.hidden = true;
    this.el.append(this.canvas, this.hoverEl);
    // The wheel zooms only once the plot has been clicked (or with Ctrl/Cmd held, which is also what a
    // trackpad pinch sends); otherwise it scrolls the page as usual and this hint appears briefly.
    this._wheelArmed = false;
    this._hintTimer = 0;
    if (o.zoom) {
      this.hintEl = document.createElement('div');
      this.hintEl.className = 'plot2d-hint';
      this.hintEl.textContent = 'Click the plot, then scroll to zoom (or hold Ctrl and scroll)';
      this.hintEl.hidden = true;
      this.el.append(this.hintEl);
    }
    if (o.pan || o.zoom) {
      this.resetBtn = document.createElement('button');
      this.resetBtn.type = 'button';
      this.resetBtn.className = 'btn plot2d-reset';
      this.resetBtn.textContent = 'Reset view';
      this.resetBtn.hidden = true;
      this.resetBtn.addEventListener('click', () => this.resetView());
      this.el.append(this.resetBtn);
    }
    container.append(this.el);
    this.ctx = this.canvas.getContext('2d');

    // view state (internally in "t-space": log10 for log axes)
    const v = o.view || DEFAULT_SPAN;
    this._initT = this._toT(v);
    this._reqT = { ...this._initT };
    this._userChanged = false;

    this.cssW = 0;
    this.cssH = o.height;
    this.dpr = 1;
    this.area = { left: 0, top: 0, width: 1, height: 1 };
    this._ml = 50;
    this._eff = { ...this._reqT };
    this._raf = 0;
    this._destroyed = false;
    this._overlays = [];
    this._off = null;

    this._g = new DrawContext(this);
    this._bindEvents();

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.el);
    livePlots.add(this);
    this._resize();
  }

  // ---------------------------------------------------------- view math
  _toT(v) {
    const tx = (x) => (this.xLog ? Math.log10(Math.max(x, 1e-300)) : x);
    const ty = (y) => (this.yLog ? Math.log10(Math.max(y, 1e-300)) : y);
    let x0 = tx(v.xmin), x1 = tx(v.xmax), y0 = ty(v.ymin), y1 = ty(v.ymax);
    if (!(x1 > x0)) { x1 = x0 + 1; }
    if (!(y1 > y0)) { y1 = y0 + 1; }
    return { x0, x1, y0, y1 };
  }
  _fromT(t) {
    const fx = (x) => (this.xLog ? Math.pow(10, x) : x);
    const fy = (y) => (this.yLog ? Math.pow(10, y) : y);
    return { xmin: fx(t.x0), xmax: fx(t.x1), ymin: fy(t.y0), ymax: fy(t.y1) };
  }
  _fit(req, w, h) {
    if (!this.equalAspect || w <= 0 || h <= 0) return { ...req };
    const sx = w / (req.x1 - req.x0), sy = h / (req.y1 - req.y0);
    const s = Math.min(sx, sy);
    const cx = (req.x0 + req.x1) / 2, cy = (req.y0 + req.y1) / 2;
    const hw = w / s / 2, hh = h / s / 2;
    return { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
  }

  toPixel(x, y) {
    const e = this._eff, a = this.area;
    const tx = this.xLog ? Math.log10(x) : x;
    const ty = this.yLog ? Math.log10(y) : y;
    return [
      a.left + ((tx - e.x0) / (e.x1 - e.x0)) * a.width,
      a.top + (1 - (ty - e.y0) / (e.y1 - e.y0)) * a.height,
    ];
  }
  toWorld(px, py) {
    const e = this._eff, a = this.area;
    const tx = e.x0 + ((px - a.left) / a.width) * (e.x1 - e.x0);
    const ty = e.y0 + (1 - (py - a.top) / a.height) * (e.y1 - e.y0);
    return [this.xLog ? Math.pow(10, tx) : tx, this.yLog ? Math.pow(10, ty) : ty];
  }
  _pxToT(px, py) {
    const e = this._eff, a = this.area;
    return [e.x0 + ((px - a.left) / a.width) * (e.x1 - e.x0), e.y0 + (1 - (py - a.top) / a.height) * (e.y1 - e.y0)];
  }

  getView() { return this._fromT(this._eff); }
  setView(v) {
    this._reqT = this._toT(v);
    this._userChanged = true;
    this._layout();
    this._viewChanged();
    this.requestRedraw();
  }
  resetView() {
    this._reqT = { ...this._initT };
    this._userChanged = false;
    this._layout();
    this._viewChanged();
    this.requestRedraw();
  }
  _viewChanged() {
    if (this.resetBtn) this.resetBtn.hidden = !this._userChanged;
    if (this.onViewChange) {
      try { this.onViewChange(this.getView()); } catch (e) { console.error(e); }
    }
  }

  _clampZoom(k) {
    const r = this._reqT, i = this._initT;
    const ratio = (r.x1 - r.x0) * k / (i.x1 - i.x0);
    if (ratio < this.opts.minSpan) return this.opts.minSpan * (i.x1 - i.x0) / (r.x1 - r.x0);
    if (ratio > this.opts.maxSpan) return this.opts.maxSpan * (i.x1 - i.x0) / (r.x1 - r.x0);
    return k;
  }
  _zoomReqAbout(req, k, tx, ty) {
    return { x0: tx + (req.x0 - tx) * k, x1: tx + (req.x1 - tx) * k, y0: ty + (req.y0 - ty) * k, y1: ty + (req.y1 - ty) * k };
  }

  // -------------------------------------------------------------- layout
  _resize() {
    if (this._destroyed) return;
    const w = Math.round(this.el.clientWidth);
    const dpr = window.devicePixelRatio || 1;
    if (w === this.cssW && dpr === this.dpr && this.canvas.width) return;
    this.cssW = w;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.cssH * dpr));
    this._layout();
    if (this.onViewChange && w > 0) {
      try { this.onViewChange(this.getView()); } catch (e) { console.error(e); }
    }
    this.redraw();
  }

  _fonts() {
    if (this._fontVersion !== themeVersion || !this._fontSans) {
      const cs = getComputedStyle(document.documentElement);
      this._fontSans = cs.getPropertyValue('--font-sans').trim() || 'system-ui, sans-serif';
      this._fontMono = cs.getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace';
      this._fontVersion = themeVersion;
    }
  }

  _layout() {
    const o = this.opts;
    const W = this.cssW, H = this.cssH;
    this._fonts();
    const compact = W < 420;
    const tickFont = `${compact ? 10.5 : 11.5}px ${this._fontSans}`;
    this._tickFont = tickFont;
    let ml, mr, mt, mb;
    if (o.axes) {
      mt = 10; mr = 14;
      mb = 22 + (o.xLabel ? 18 : 0);
      ml = this._ml;
    } else {
      mt = mr = mb = ml = 1;
    }
    const ctx = this.ctx;
    for (let iter = 0; iter < 3; iter++) {
      const w = Math.max(10, W - ml - mr), h = Math.max(10, H - mt - mb);
      this.area = { left: ml, top: mt, width: w, height: h };
      this._eff = this._fit(this._reqT, w, h);
      if (!o.axes) break;
      this._computeTicks();
      ctx.font = tickFont;
      let maxW = 0;
      for (const t of this._yTicks) maxW = Math.max(maxW, ctx.measureText(t.label).width);
      const want = Math.ceil(maxW + 9 + (o.yLabel ? 18 : 0) + 4);
      if (Math.abs(want - ml) < 1) break;
      ml = want;
    }
    this._ml = ml;
  }

  _computeTicks() {
    const a = this.area, e = this._eff;
    const nx = Math.max(2, Math.floor(a.width / (this.cssW < 420 ? 70 : 90)));
    const ny = Math.max(2, Math.floor(a.height / 50));
    const mk = (log, t0, t1, n) => {
      if (log) {
        const { major, minor } = logTicks(t0, t1, n + 1);
        return { ticks: major.map((v) => ({ v, t: Math.log10(v), label: fmtLogTick(v) })), minor: minor.map((v) => Math.log10(v)) };
      }
      const tk = niceTicks(t0, t1, n);
      return { ticks: tk.map((v) => ({ v, t: v, label: fmtTick(v, tk.step) })), minor: [] };
    };
    const X = mk(this.xLog, e.x0, e.x1, nx);
    const Y = mk(this.yLog, e.y0, e.y1, ny);
    this._xTicks = X.ticks; this._xMinor = X.minor;
    this._yTicks = Y.ticks; this._yMinor = Y.minor;
  }

  // ---------------------------------------------------------------- draw
  requestRedraw() {
    if (this._raf || this._destroyed) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.redraw(); });
  }

  redraw() {
    if (this._destroyed) return;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    if ((window.devicePixelRatio || 1) !== this.dpr) { this._resize(); return; }
    if (this.cssW <= 0) return;
    this._layout();
    const ctx = this.ctx, o = this.opts, a = this.area;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    const pal = palette();
    ctx.fillStyle = pal.bg;
    ctx.fillRect(a.left, a.top, a.width, a.height);

    if (o.grid && o.axes !== false) this._drawGrid(pal);

    // user content, clipped to plot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.left, a.top, a.width, a.height);
    ctx.clip();
    const g = this._g;
    g._begin(pal);
    if (this.onDraw) {
      try { this.onDraw(g); } catch (err) {
        console.error('Plot2D onDraw error:', err);
        ctx.restore(); ctx.save();
        ctx.fillStyle = pal.textStrong;
        ctx.font = `12px ${this._fontSans}`;
        ctx.fillText('Plot error: ' + (err && err.message), a.left + 8, a.top + 18);
      }
    }
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.left - 12, a.top - 12, a.width + 24, a.height + 24);
    ctx.clip();
    this._drawHandles(pal);
    ctx.restore();

    if (o.axes) this._drawAxes(pal);

    // overlays (legend, colorbar) on top
    ctx.save();
    for (const fn of this._overlays) {
      try { fn(); } catch (err) { console.error(err); }
    }
    ctx.restore();
    this._overlays.length = 0;
  }

  _drawGrid(pal) {
    const ctx = this.ctx, a = this.area;
    ctx.save();
    ctx.lineWidth = 1;
    const e = this._eff;
    const X = (t) => Math.round(a.left + ((t - e.x0) / (e.x1 - e.x0)) * a.width) + 0.5;
    const Y = (t) => Math.round(a.top + (1 - (t - e.y0) / (e.y1 - e.y0)) * a.height) + 0.5;
    if (this._xMinor.length || this._yMinor.length) {
      ctx.strokeStyle = pal.grid;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      for (const t of this._xMinor) { const x = X(t); ctx.moveTo(x, a.top); ctx.lineTo(x, a.top + a.height); }
      for (const t of this._yMinor) { const y = Y(t); ctx.moveTo(a.left, y); ctx.lineTo(a.left + a.width, y); }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = pal.grid;
    ctx.beginPath();
    for (const tk of this._xTicks) { const x = X(tk.t); ctx.moveTo(x, a.top); ctx.lineTo(x, a.top + a.height); }
    for (const tk of this._yTicks) { const y = Y(tk.t); ctx.moveTo(a.left, y); ctx.lineTo(a.left + a.width, y); }
    ctx.stroke();
    ctx.restore();
  }

  _drawAxes(pal) {
    const ctx = this.ctx, a = this.area, o = this.opts, e = this._eff;
    ctx.save();
    // frame: recessive grid colour, baseline/left axis slightly stronger
    ctx.lineWidth = 1;
    ctx.strokeStyle = pal.grid;
    ctx.strokeRect(a.left + 0.5, a.top + 0.5, a.width - 1, a.height - 1);
    ctx.strokeStyle = pal.axis;
    ctx.beginPath();
    ctx.moveTo(a.left + 0.5, a.top);
    ctx.lineTo(a.left + 0.5, a.top + a.height - 0.5);
    ctx.lineTo(a.left + a.width, a.top + a.height - 0.5);
    ctx.stroke();

    ctx.font = this._tickFont;
    ctx.fillStyle = pal.text;
    // x tick labels, thinned so they never collide
    const xs = this._xTicks.map((tk) => ({ ...tk, px: a.left + ((tk.t - e.x0) / (e.x1 - e.x0)) * a.width, w: ctx.measureText(tk.label).width }));
    let stride = 1;
    if (xs.length > 1) {
      const sp = Math.abs(xs[1].px - xs[0].px);
      const maxW = Math.max(...xs.map((t) => t.w));
      while (sp * stride < maxW + 10 && stride < xs.length) stride++;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    xs.forEach((tk, i) => {
      if (i % stride) return;
      let x = tk.px;
      x = Math.max(tk.w / 2 + 1, Math.min(this.cssW - tk.w / 2 - 1, x));
      ctx.fillText(tk.label, x, a.top + a.height + 5);
    });
    // y tick labels
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    let lastY = Infinity;
    for (const tk of this._yTicks) {
      const y = a.top + (1 - (tk.t - e.y0) / (e.y1 - e.y0)) * a.height;
      if (Math.abs(lastY - y) < 13) continue;
      ctx.fillText(tk.label, a.left - 7, Math.max(a.top + 5, Math.min(a.top + a.height - 4, y)));
      lastY = y;
    }
    // axis titles
    ctx.fillStyle = pal.text;
    ctx.font = `500 12px ${this._fontSans}`;
    if (o.xLabel) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(o.xLabel, a.left + a.width / 2, this.cssH - 2);
    }
    if (o.yLabel) {
      ctx.translate(12, a.top + a.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.yLabel, 0, 0);
    }
    ctx.restore();
  }

  _drawHandles(pal) {
    const ctx = this.ctx;
    for (const v of this.vectors) {
      if (!v.visible || !v.base.visible) continue;
      const [bx, by] = this.toPixel(v.base.x, v.base.y);
      const [tx, ty] = this.toPixel(v.tipX, v.tipY);
      const col = cssColor(v.color);
      this._g._arrowPx(bx, by, tx, ty, { color: col, width: v.width, head: 10 });
      const active = v === this._hot || v.dragging;
      ctx.beginPath();
      ctx.arc(tx, ty, active ? 6.5 : 5, 0, Math.PI * 2);
      ctx.fillStyle = pal.bg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = col;
      ctx.stroke();
      if (v.label) this._label(v.label, tx, ty, 9, pal);
    }
    for (const h of this.handles) {
      if (!h.visible) continue;
      const [px, py] = this.toPixel(h.x, h.y);
      if (!isFinite(px) || !isFinite(py)) continue;
      const col = cssColor(h.color);
      const active = h === this._hot || h.dragging;
      if (active && h.draggable) {
        ctx.beginPath();
        ctx.arc(px, py, h.radius + 7, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.18;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      markerPath(ctx, px, py, h.shape, h.radius);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = pal.bg;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fill();
      if (h.label) this._label(h.label, px, py, h.radius + 3, pal);
    }
  }
  _label(text, px, py, off, pal) {
    const ctx = this.ctx;
    ctx.font = `600 13px ${this._fontSans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const x = px + off * 0.75, y = py - off * 0.75;
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = pal.halo;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = pal.textStrong;
    ctx.fillText(text, x, y);
  }

  // -------------------------------------------------------------- handles
  addHandle(opts = {}) {
    const h = new Handle(this, opts);
    this.handles.push(h);
    this.requestRedraw();
    return h;
  }
  addVectorHandle(opts = {}) {
    if (!opts.base) throw new Error('addVectorHandle: base handle required');
    const v = new VectorHandle(this, opts);
    this.vectors.push(v);
    this.requestRedraw();
    return v;
  }
  _remove(obj) {
    this.handles = this.handles.filter((h) => h !== obj);
    this.vectors = this.vectors.filter((v) => v !== obj && v.base !== obj);
    if (this._hot === obj) this._hot = null;
    this.requestRedraw();
  }
  _hitTest(px, py, touch) {
    let best = null, bestD = Infinity;
    const consider = (obj, x, y, r) => {
      const [hx, hy] = this.toPixel(x, y);
      const d = Math.hypot(hx - px, hy - py);
      const lim = Math.max(r, touch ? 22 : 0);
      if (d <= lim && d < bestD) { best = obj; bestD = d; }
    };
    for (const h of this.handles) if (h.visible && h.draggable) consider(h, h.x, h.y, h.hitRadius ?? h.radius + 8);
    for (const v of this.vectors) if (v.visible && v.draggable && v.base.visible) consider(v, v.tipX, v.tipY, v.hitRadius ?? 13);
    return best;
  }

  // --------------------------------------------------------------- events
  _bindEvents() {
    const cv = this.canvas;
    const pointers = new Map();
    let mode = null; // 'drag' | 'pan' | 'pinch'
    let drag = null;
    let panStart = null;
    let pinch = null;
    let downPos = null, moved = false;

    const local = (e) => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const inArea = (px, py) => {
      const a = this.area;
      return px >= a.left && px <= a.left + a.width && py >= a.top && py <= a.top + a.height;
    };

    this._onPointerDown = (e) => {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      this._wheelArmed = true;
      if (this.hintEl) this.hintEl.hidden = true;
      const [px, py] = local(e);
      pointers.set(e.pointerId, [px, py]);
      try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      downPos = [px, py]; moved = false;

      if (pointers.size === 2 && this.opts.zoom && mode !== 'drag') {
        const [p1, p2] = [...pointers.values()];
        pinch = {
          d0: Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1,
          m0: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2],
          req0: { ...this._reqT },
          eff0: { ...this._eff },
        };
        mode = 'pinch';
        return;
      }
      if (pointers.size > 1) return;

      const hit = this._hitTest(px, py, e.pointerType === 'touch');
      if (hit) {
        e.preventDefault();
        mode = 'drag';
        if (hit instanceof VectorHandle) {
          const [tpx, tpy] = this.toPixel(hit.tipX, hit.tipY);
          drag = { obj: hit, offPx: [tpx - px, tpy - py] };
        } else {
          const [hpx, hpy] = this.toPixel(hit.x, hit.y);
          drag = { obj: hit, offPx: [hpx - px, hpy - py] };
        }
        hit.dragging = true;
        this._hot = hit;
        this.el.classList.add('dragging');
        this.requestRedraw();
      } else if (inArea(px, py)) {
        if (this.opts.pan) {
          mode = 'pan';
          panStart = { px, py, req0: { ...this._reqT }, eff0: { ...this._eff } };
          this.el.classList.add('panning');
        } else {
          mode = 'click';
        }
      }
    };

    this._onPointerMove = (e) => {
      const [px, py] = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [px, py]);
      if (downPos && Math.hypot(px - downPos[0], py - downPos[1]) > 4) moved = true;

      if (mode === 'drag' && drag) {
        const obj = drag.obj;
        const tx = px + drag.offPx[0], ty = py + drag.offPx[1];
        let [x, y] = this.toWorld(tx, ty);
        if (obj instanceof VectorHandle) {
          let vx = (x - obj.base.x) / obj.scale, vy = (y - obj.base.y) / obj.scale;
          if (obj.constrain) [vx, vy] = obj.constrain(vx, vy);
          obj.vx = vx; obj.vy = vy;
          if (obj.onDrag) obj.onDrag(vx, vy, obj);
        } else {
          if (obj.constrain) [x, y] = obj.constrain(x, y);
          obj.x = x; obj.y = y;
          if (obj.onDrag) obj.onDrag(x, y, obj);
        }
        this.requestRedraw();
        this._showHover(px, py);
        return;
      }
      if (mode === 'pinch' && pinch && pointers.size >= 2) {
        const [p1, p2] = [...pointers.values()];
        const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
        const m = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
        const a = this.area, e0 = pinch.eff0;
        const tW = [e0.x0 + ((pinch.m0[0] - a.left) / a.width) * (e0.x1 - e0.x0), e0.y0 + (1 - (pinch.m0[1] - a.top) / a.height) * (e0.y1 - e0.y0)];
        this._reqT = pinch.req0;
        const k = this._clampZoom(pinch.d0 / d);
        let req = this._zoomReqAbout(pinch.req0, k, tW[0], tW[1]);
        const eff = this._fit(req, a.width, a.height);
        const sx = (eff.x1 - eff.x0) / a.width, sy = (eff.y1 - eff.y0) / a.height;
        const ddx = (m[0] - pinch.m0[0]) * sx, ddy = (m[1] - pinch.m0[1]) * sy;
        req = { x0: req.x0 - ddx, x1: req.x1 - ddx, y0: req.y0 + ddy, y1: req.y1 + ddy };
        this._reqT = req;
        this._userChanged = true;
        this._layout();
        this._viewChanged();
        this.requestRedraw();
        return;
      }
      if (mode === 'pan' && panStart) {
        if (!moved) return;
        const a = this.area, e0 = panStart.eff0;
        const sx = (e0.x1 - e0.x0) / a.width, sy = (e0.y1 - e0.y0) / a.height;
        const ddx = (px - panStart.px) * sx, ddy = (py - panStart.py) * sy;
        const r = panStart.req0;
        this._reqT = { x0: r.x0 - ddx, x1: r.x1 - ddx, y0: r.y0 + ddy, y1: r.y1 + ddy };
        this._userChanged = true;
        this._layout();
        this._viewChanged();
        this.requestRedraw();
        return;
      }
      // hover
      if (e.pointerType !== 'touch' || pointers.size === 0) {
        const hit = this._hitTest(px, py, false);
        if (hit !== this._hot) {
          this._hot = hit;
          this.el.classList.toggle('over-handle', !!hit);
          this.requestRedraw();
        }
        this._showHover(px, py);
      }
    };

    const end = (e) => {
      const had = pointers.has(e.pointerId);
      pointers.delete(e.pointerId);
      try { cv.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (!had) return;
      if (mode === 'drag' && drag) {
        const obj = drag.obj;
        obj.dragging = false;
        this.el.classList.remove('dragging');
        if (obj.onDragEnd) {
          if (obj instanceof VectorHandle) obj.onDragEnd(obj.vx, obj.vy, obj);
          else obj.onDragEnd(obj.x, obj.y, obj);
        }
        drag = null;
        if (e.pointerType === 'touch') this._hot = null;
        this.requestRedraw();
      } else if ((mode === 'pan' || mode === 'click') && !moved && e.type === 'pointerup' && this.onClick && downPos) {
        const [x, y] = this.toWorld(downPos[0], downPos[1]);
        try { this.onClick(x, y, e); } catch (err) { console.error(err); }
      }
      if (pointers.size === 0) {
        mode = null; panStart = null; pinch = null; downPos = null;
        this.el.classList.remove('panning');
      } else if (mode === 'pinch' && pointers.size === 1) {
        // continue as pan with the remaining finger
        const [p] = [...pointers.values()];
        mode = this.opts.pan ? 'pan' : null;
        panStart = { px: p[0], py: p[1], req0: { ...this._reqT }, eff0: { ...this._eff } };
        moved = true;
        pinch = null;
      }
    };
    this._onPointerUp = end;
    this._onPointerLeave = () => {
      if (!pointers.size) {
        this._wheelArmed = false;
        this.hoverEl.hidden = true;
        if (this._hot) { this._hot = null; this.el.classList.remove('over-handle'); this.requestRedraw(); }
      }
    };
    this._onWheel = (e) => {
      if (!this.opts.zoom) return;
      const [px, py] = local(e);
      if (!inArea(px, py)) return;
      if (!(this._wheelArmed || e.ctrlKey || e.metaKey)) {
        // Not armed: let the page scroll, and say how to zoom.
        if (this.hintEl) {
          this.hintEl.hidden = false;
          clearTimeout(this._hintTimer);
          this._hintTimer = setTimeout(() => { if (this.hintEl) this.hintEl.hidden = true; }, 1600);
        }
        return;
      }
      e.preventDefault();
      if (this.hintEl) this.hintEl.hidden = true;
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
      dy = Math.max(-300, Math.min(300, dy));
      const k = this._clampZoom(Math.exp(dy * 0.0015));
      const [tx, ty] = this._pxToT(px, py);
      this._reqT = this._zoomReqAbout(this._reqT, k, tx, ty);
      this._userChanged = true;
      this._layout();
      this._viewChanged();
      this.requestRedraw();
      this._showHover(px, py);
    };
    this._onDblClick = (e) => {
      if (!(this.opts.pan || this.opts.zoom)) return;
      const [px, py] = local(e);
      if (this._hitTest(px, py, false)) return;
      this.resetView();
    };

    cv.addEventListener('pointerdown', this._onPointerDown);
    cv.addEventListener('pointermove', this._onPointerMove);
    cv.addEventListener('pointerup', this._onPointerUp);
    cv.addEventListener('pointercancel', this._onPointerUp);
    cv.addEventListener('pointerleave', this._onPointerLeave);
    cv.addEventListener('wheel', this._onWheel, { passive: false });
    cv.addEventListener('dblclick', this._onDblClick);
  }

  _showHover(px, py) {
    if (!this.onHover) return;
    const a = this.area;
    const inside = px >= a.left && px <= a.left + a.width && py >= a.top && py <= a.top + a.height;
    let text = null;
    if (inside) {
      const [x, y] = this.toWorld(px, py);
      try { text = this.onHover(x, y); } catch (err) { console.error(err); }
    }
    const el = this.hoverEl;
    if (text == null || text === '') { el.hidden = true; return; }
    if (el.textContent !== text) el.textContent = text;
    el.hidden = false;
    if (this.opts.hoverMode === 'corner') {
      el.style.left = a.left + 8 + 'px';
      el.style.top = a.top + 8 + 'px';
      return;
    }
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = px + 14, top = py + 14;
    if (left + w > this.cssW - 4) left = px - 14 - w;
    if (top + h > this.cssH - 4) top = py - 14 - h;
    el.style.left = Math.max(2, left) + 'px';
    el.style.top = Math.max(2, top) + 'px';
  }

  // ---------------------------------------------------------------- fields
  sampleField(fn, opts = {}) {
    if (!this.cssW) this._layout();
    const nx = Math.max(2, opts.nx | 0 || 160), ny = Math.max(2, opts.ny | 0 || 120);
    const t = opts.view ? this._toT(opts.view) : this._eff;
    const dx = (t.x1 - t.x0) / (nx - 1), dy = (t.y1 - t.y0) / (ny - 1);
    const data = new Float64Array(nx * ny);
    const xs = new Float64Array(nx);
    for (let i = 0; i < nx; i++) { const tx = t.x0 + i * dx; xs[i] = this.xLog ? Math.pow(10, tx) : tx; }
    for (let j = 0; j < ny; j++) {
      const ty = t.y0 + j * dy;
      const y = this.yLog ? Math.pow(10, ty) : ty;
      const row = j * nx;
      for (let i = 0; i < nx; i++) {
        const v = fn(xs[i], y);
        data[row + i] = typeof v === 'number' ? v : NaN;
      }
    }
    return { nx, ny, x0: t.x0, y0: t.y0, dx, dy, data, xLog: this.xLog, yLog: this.yLog };
  }

  _offscreen(w, h) {
    if (!this._off) this._off = document.createElement('canvas');
    const c = this._off;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    clearTimeout(this._hintTimer);
    this._ro.disconnect();
    const cv = this.canvas;
    cv.removeEventListener('pointerdown', this._onPointerDown);
    cv.removeEventListener('pointermove', this._onPointerMove);
    cv.removeEventListener('pointerup', this._onPointerUp);
    cv.removeEventListener('pointercancel', this._onPointerUp);
    cv.removeEventListener('pointerleave', this._onPointerLeave);
    cv.removeEventListener('wheel', this._onWheel);
    cv.removeEventListener('dblclick', this._onDblClick);
    livePlots.delete(this);
    this.handles = [];
    this.vectors = [];
    this.onDraw = this.onHover = this.onClick = this.onViewChange = null;
    this.el.remove();
  }
}

// ================================================================ handles
class Handle {
  constructor(plot, o) {
    this.plot = plot;
    this.x = o.x ?? 0;
    this.y = o.y ?? 0;
    this.color = o.color || '--plot-text-strong';
    this.label = o.label || '';
    this.shape = o.shape || 'circle';
    this.radius = o.radius ?? 8;
    this.hitRadius = o.hitRadius;
    this.draggable = o.draggable !== false;
    this.visible = o.visible !== false;
    this.onDrag = o.onDrag || null;
    this.onDragEnd = o.onDragEnd || null;
    this.constrain = o.constrain || null;
    this.dragging = false;
  }
  setPosition(x, y) { this.x = x; this.y = y; this.plot.requestRedraw(); }
  remove() { this.plot._remove(this); }
}

class VectorHandle {
  constructor(plot, o) {
    this.plot = plot;
    this.base = o.base;
    this.vx = o.vx ?? 0;
    this.vy = o.vy ?? 0;
    this.scale = o.scale ?? 1;
    this.color = o.color || o.base.color;
    this.label = o.label || '';
    this.width = o.width ?? 2;
    this.hitRadius = o.hitRadius;
    this.draggable = o.draggable !== false;
    this.visible = o.visible !== false;
    this.onDrag = o.onDrag || null;
    this.onDragEnd = o.onDragEnd || null;
    this.constrain = o.constrain || null;
    this.dragging = false;
  }
  get tipX() { return this.base.x + this.vx * this.scale; }
  get tipY() { return this.base.y + this.vy * this.scale; }
  setVector(vx, vy) { this.vx = vx; this.vy = vy; this.plot.requestRedraw(); }
  remove() { this.plot._remove(this); }
}

// ========================================================= drawing context
class DrawContext {
  constructor(plot) {
    this.plot = plot;
    this.ctx = plot.ctx;
    this.toPixel = (x, y) => plot.toPixel(x, y);
    this.toWorld = (px, py) => plot.toWorld(px, py);
  }
  _begin(pal) {
    const p = this.plot, e = p._eff, a = p.area;
    this.palette = pal;
    this.area = { ...a };
    this.view = p.getView();
    this.pxPerUnit = a.width / (e.x1 - e.x0);
    this.pxPerUnitY = a.height / (e.y1 - e.y0);
  }
  color(c, fallback) { return cssColor(c, fallback); }

  _stroke(style, def) {
    const ctx = this.ctx;
    ctx.strokeStyle = cssColor(style.color ?? def ?? '--plot-text-strong');
    ctx.lineWidth = style.width ?? 1.5;
    ctx.setLineDash(style.dash || []);
    ctx.lineCap = style.cap || (style.dash ? 'butt' : 'round');
    ctx.lineJoin = style.join || 'round';
    ctx.globalAlpha = style.alpha ?? 1;
  }
  _paintClosed(style, { fillDefault = false, strokeDefault = true, fillAlphaDefault = 1 } = {}) {
    const ctx = this.ctx;
    let fill = style.fill ?? (fillDefault ? true : null);
    if (fill === true) fill = style.color ?? '--plot-text-strong';
    const alpha = style.alpha ?? 1;
    if (fill) {
      ctx.fillStyle = cssColor(fill);
      ctx.globalAlpha = alpha * (style.fillAlpha ?? fillAlphaDefault);
      ctx.fill(style.fillRule || 'nonzero');
    }
    let stroke = style.stroke ?? strokeDefault;
    if (stroke) {
      this._stroke(typeof stroke === 'string' ? { ...style, color: stroke } : style);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _tracePolyline(points, close) {
    const ctx = this.ctx, p = this.plot;
    let pen = false;
    const flat = !Array.isArray(points[0]);
    const n = flat ? points.length / 2 : points.length;
    for (let k = 0; k < n; k++) {
      const x = flat ? points[2 * k] : points[k][0];
      const y = flat ? points[2 * k + 1] : points[k][1];
      if (!isFinite(x) || !isFinite(y)) { pen = false; continue; }
      const [px, py] = p.toPixel(x, y);
      if (!isFinite(px) || !isFinite(py)) { pen = false; continue; }
      if (pen) ctx.lineTo(clampPx(px), clampPx(py));
      else { ctx.moveTo(clampPx(px), clampPx(py)); pen = true; }
    }
    if (close) ctx.closePath();
  }

  line(points, style = {}) {
    if (!points || !points.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    this._tracePolyline(points, false);
    this._stroke(style);
    ctx.stroke();
    ctx.restore();
  }
  polygon(points, style = {}) {
    if (!points || points.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    this._tracePolyline(points, true);
    this._paintClosed(style);
    ctx.restore();
  }
  segment(x1, y1, x2, y2, style = {}) { this.line([[x1, y1], [x2, y2]], style); }

  _arrowPx(x1, y1, x2, y2, style = {}) {
    const ctx = this.ctx;
    const head = style.head ?? 9;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const hl = Math.min(head, len * 0.6);
    ctx.save();
    this._stroke(style);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - Math.cos(ang) * hl * 0.7, y2 - Math.sin(ang) * hl * 0.7);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - hl * Math.cos(ang - 0.42), y2 - hl * Math.sin(ang - 0.42));
    ctx.lineTo(x2 - hl * Math.cos(ang + 0.42), y2 - hl * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    ctx.restore();
  }
  arrow(x1, y1, x2, y2, style = {}) {
    const [a, b] = this.plot.toPixel(x1, y1);
    const [c, d] = this.plot.toPixel(x2, y2);
    if (![a, b, c, d].every(isFinite)) return;
    this._arrowPx(clampPx(a), clampPx(b), clampPx(c), clampPx(d), style);
  }

  circle(x, y, rPx, style = {}) {
    const [px, py] = this.plot.toPixel(x, y);
    if (!isFinite(px) || !isFinite(py)) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, Math.max(0, rPx), 0, Math.PI * 2);
    this._paintClosed(style);
    ctx.restore();
  }
  circleWorld(x, y, r, style = {}) { this.ellipse(x, y, r, r, 0, style); }

  ellipse(cx, cy, a, b, ang, style = {}) {
    const n = 96, ca = Math.cos(ang || 0), sa = Math.sin(ang || 0);
    const pts = new Array(n);
    for (let k = 0; k < n; k++) {
      const t = (k / n) * Math.PI * 2;
      const u = a * Math.cos(t), v = b * Math.sin(t);
      pts[k] = [cx + u * ca - v * sa, cy + u * sa + v * ca];
    }
    this.polygon(pts, style);
  }

  marker(x, y, shape = 'circle', size = 5, style = {}) {
    const [px, py] = this.plot.toPixel(x, y);
    if (!isFinite(px) || !isFinite(py)) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = style.alpha ?? 1;
    ctx.beginPath();
    markerPath(ctx, px, py, shape, size);
    const col = cssColor(style.color ?? '--plot-text-strong');
    if (isStrokeOnlyMarker(shape)) {
      if (style.ring !== false) { ctx.lineWidth = (style.width ?? 2) + 3; ctx.strokeStyle = this.palette.halo; ctx.lineCap = 'round'; ctx.stroke(); }
      ctx.lineWidth = style.width ?? 2;
      ctx.strokeStyle = col;
      ctx.lineCap = 'round';
      ctx.stroke();
    } else {
      if (style.ring !== false) { ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = this.palette.bg; ctx.stroke(); }
      ctx.fillStyle = style.fill ? cssColor(style.fill === true ? col : style.fill) : col;
      ctx.fill();
      if (style.stroke) { ctx.lineWidth = style.width ?? 1.5; ctx.strokeStyle = cssColor(style.stroke === true ? col : style.stroke); ctx.stroke(); }
    }
    ctx.restore();
  }

  points(pts, style = {}) {
    if (!pts || !pts.length) return;
    const ctx = this.ctx, p = this.plot;
    const flat = !Array.isArray(pts[0]);
    const n = flat ? pts.length / 2 : pts.length;
    const r = style.size ?? 1.6;
    ctx.save();
    ctx.globalAlpha = style.alpha ?? 0.6;
    ctx.fillStyle = cssColor(style.color ?? '--series-1');
    const e = p._eff, a = p.area;
    const sx = a.width / (e.x1 - e.x0), sy = a.height / (e.y1 - e.y0);
    const lx = p.xLog, ly = p.yLog;
    const xmin = a.left - r, xmax = a.left + a.width + r, ymin = a.top - r, ymax = a.top + a.height + r;
    if (r <= 1.6) {
      const s = r * 2;
      for (let k = 0; k < n; k++) {
        let x = flat ? pts[2 * k] : pts[k][0], y = flat ? pts[2 * k + 1] : pts[k][1];
        if (lx) x = Math.log10(x);
        if (ly) y = Math.log10(y);
        const px = a.left + (x - e.x0) * sx, py = a.top + a.height - (y - e.y0) * sy;
        if (px < xmin || px > xmax || py < ymin || py > ymax || px !== px || py !== py) continue;
        ctx.fillRect(px - r, py - r, s, s);
      }
    } else {
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        let x = flat ? pts[2 * k] : pts[k][0], y = flat ? pts[2 * k + 1] : pts[k][1];
        if (lx) x = Math.log10(x);
        if (ly) y = Math.log10(y);
        const px = a.left + (x - e.x0) * sx, py = a.top + a.height - (y - e.y0) * sy;
        if (px < xmin || px > xmax || py < ymin || py > ymax || px !== px || py !== py) continue;
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  text(x, y, str, style = {}) {
    const [px, py] = this.plot.toPixel(x, y);
    if (!isFinite(px) || !isFinite(py)) return;
    this._textPx(px + (style.dx || 0), py + (style.dy || 0), str, style);
  }
  _textPx(px, py, str, style = {}) {
    const ctx = this.ctx, p = this.plot;
    ctx.save();
    const fam = style.mono ? p._fontMono : p._fontSans;
    ctx.font = style.font || `${style.weight || 500} ${style.size || 12}px ${fam}`;
    ctx.textAlign = style.align || 'left';
    ctx.textBaseline = style.baseline || 'middle';
    ctx.globalAlpha = style.alpha ?? 1;
    if (style.halo !== false) {
      ctx.lineWidth = 3.5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = this.palette.halo;
      ctx.strokeText(String(str), px, py);
    }
    ctx.fillStyle = cssColor(style.color ?? '--plot-text-strong');
    ctx.fillText(String(str), px, py);
    ctx.restore();
  }

  band(upper, lower, style = {}) {
    if (!upper || !lower || !upper.length || !lower.length) return;
    const pts = upper.concat(lower.slice().reverse());
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    this._tracePolyline(pts, true);
    this._paintClosed(style, { fillDefault: true, strokeDefault: false, fillAlphaDefault: 0.18 });
    ctx.restore();
  }

  // ----------------------------------------------------------- fields
  sampleField(fn, opts) { return this.plot.sampleField(fn, opts); }

  contour(field, levels, style = {}) {
    if (!field || !levels) return;
    const ctx = this.ctx;
    const lv = Array.isArray(levels) ? levels : [levels];
    const pick = (v, level, i) => (typeof v === 'function' ? v(level, i) : v);
    ctx.save();
    lv.forEach((level, i) => {
      if (!isFinite(level)) return;
      const lines = contourLines(field, level);
      if (!lines.length) return;
      const st = {
        ...style,
        color: pick(style.color, level, i),
        width: pick(style.width, level, i),
        dash: pick(style.dash, level, i),
        alpha: pick(style.alpha, level, i),
      };
      ctx.beginPath();
      for (const l of lines) this._tracePolyline(l, false);
      this._stroke(st);
      ctx.stroke();
      if (style.labels) {
        const txt = typeof style.labels === 'function' ? style.labels(level, i) : fmtTick(level, Math.abs(level) / 100 || 1);
        if (txt != null && txt !== '') {
          for (const l of lines) {
            if (l.length < 12) continue;
            const m = l[Math.floor(l.length / 2)];
            this.text(m[0], m[1], txt, { color: '--plot-text', size: 11, align: 'center', baseline: 'middle' });
          }
        }
      }
    });
    ctx.restore();
  }

  contourBand(field, lo, hi, style = {}) {
    if (!field || !(hi >= lo)) return;
    const { nx, ny, data } = field;
    const p = this.plot, e = p._eff, a = p.area;
    // pixel position of every grid node (field may be in log units, as is _eff)
    const PX = new Float64Array(nx), PY = new Float64Array(ny);
    for (let i = 0; i < nx; i++) PX[i] = a.left + ((field.x0 + i * field.dx - e.x0) / (e.x1 - e.x0)) * a.width;
    for (let j = 0; j < ny; j++) PY[j] = a.top + (1 - (field.y0 + j * field.dy - e.y0) / (e.y1 - e.y0)) * a.height;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    const emit = (xs, ys) => {
      if (xs.length < 3) return;
      ctx.moveTo(xs[0], ys[0]);
      for (let k = 1; k < xs.length; k++) ctx.lineTo(xs[k], ys[k]);
      ctx.closePath();
    };
    const tri = (xs, ys, vs) => {
      let vmin = Math.min(vs[0], vs[1], vs[2]), vmax = Math.max(vs[0], vs[1], vs[2]);
      if (vmax < lo || vmin > hi) return;
      let P = [xs, ys, vs];
      if (vmin < lo) P = clipPoly(P[0], P[1], P[2], lo, 1);
      if (vmax > hi && P[0].length) P = clipPoly(P[0], P[1], P[2], hi, -1);
      emit(P[0], P[1]);
    };
    for (let j = 0; j < ny - 1; j++) {
      const ya = PY[j], yb = PY[j + 1];
      for (let i = 0; i < nx - 1; i++) {
        const k = j * nx + i;
        const v0 = data[k], v1 = data[k + 1], v3 = data[k + nx], v2 = data[k + nx + 1];
        if (v0 !== v0 || v1 !== v1 || v2 !== v2 || v3 !== v3) continue;
        const mn = Math.min(v0, v1, v2, v3), mx = Math.max(v0, v1, v2, v3);
        if (mx < lo || mn > hi) continue;
        const xa = PX[i], xb = PX[i + 1];
        if (mn >= lo && mx <= hi) {
          ctx.moveTo(xa, ya); ctx.lineTo(xb, ya); ctx.lineTo(xb, yb); ctx.lineTo(xa, yb); ctx.closePath();
          continue;
        }
        tri([xa, xb, xb], [ya, ya, yb], [v0, v1, v2]);
        tri([xa, xb, xa], [ya, yb, yb], [v0, v2, v3]);
      }
    }
    let fill = style.fill ?? style.color ?? '--tdoa';
    if (fill === true) fill = style.color ?? '--tdoa';
    ctx.fillStyle = cssColor(fill);
    ctx.globalAlpha = (style.alpha ?? 1) * (style.fillAlpha ?? 0.25);
    ctx.fill('nonzero');
    ctx.restore();
  }

  /** Draw an nx x ny RGBA image whose pixel centres sit at the given world coordinates. */
  _blitGrid(nx, ny, data, opts, placeT) {
    const lut = getLut(opts.colormap);
    let min = opts.min, max = opts.max;
    const log = !!opts.log;
    if (min == null || max == null) {
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < data.length; k++) {
        const v = data[k];
        if (v !== v || (log && v <= 0)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (min == null) min = lo;
      if (max == null) max = hi;
    }
    if (!isFinite(min) || !isFinite(max)) return;
    let a = log ? Math.log10(min) : min, b = log ? Math.log10(max) : max;
    if (b === a) b = a + 1;
    const inv = 255 / (b - a);
    const off = this.plot._offscreen(nx, ny);
    const octx = off.getContext('2d');
    const img = octx.createImageData(nx, ny);
    const px = img.data;
    for (let j = 0; j < ny; j++) {
      const row = (ny - 1 - j) * nx; // image row 0 = top = highest y
      for (let i = 0; i < nx; i++) {
        let v = data[j * nx + i];
        const o = (row + i) * 4;
        if (v !== v || (log && v <= 0)) { px[o + 3] = 0; continue; }
        if (log) v = Math.log10(v);
        let idx = ((v - a) * inv) | 0;
        if (idx < 0) idx = 0; else if (idx > 255) idx = 255;
        px[o] = lut[idx * 3]; px[o + 1] = lut[idx * 3 + 1]; px[o + 2] = lut[idx * 3 + 2]; px[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    const p = this.plot, e = p._eff, ar = p.area;
    const X = (t) => ar.left + ((t - e.x0) / (e.x1 - e.x0)) * ar.width;
    const Y = (t) => ar.top + (1 - (t - e.y0) / (e.y1 - e.y0)) * ar.height;
    const [tx0, tx1, ty0, ty1] = placeT; // t-space edges of the image
    const left = X(tx0), right = X(tx1), top = Y(ty1), bottom = Y(ty0);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = opts.alpha ?? 0.85;
    ctx.imageSmoothingEnabled = opts.smooth !== false;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, nx, ny, left, top, right - left, bottom - top);
    ctx.restore();
  }

  heatmap(field, opts = {}) {
    if (!field) return;
    const { nx, ny, x0, y0, dx, dy } = field;
    // pixel centres at nodes -> image edges half a cell outside
    this._blitGrid(nx, ny, field.data, { alpha: 0.85, ...opts },
      [x0 - dx / 2, x0 + (nx - 0.5) * dx, y0 - dy / 2, y0 + (ny - 0.5) * dy]);
  }

  image(matrix, x0, x1, y0, y1, opts = {}) {
    if (!matrix) return;
    const p = this.plot;
    const tx = (x) => (p.xLog ? Math.log10(x) : x), ty = (y) => (p.yLog ? Math.log10(y) : y);
    this._blitGrid(matrix.nx, matrix.ny, matrix.data, { alpha: 1, ...opts }, [tx(x0), tx(x1), ty(y0), ty(y1)]);
  }

  // ---------------------------------------------------------- overlays
  colorbar(opts = {}) {
    this.plot._overlays.push(() => this._drawColorbar(opts));
  }
  _drawColorbar({ colormap, min = 0, max = 1, log = false, label = '', position = 'right' } = {}) {
    const ctx = this.ctx, p = this.plot, a = p.area, pal = this.palette;
    const barW = 10, barH = Math.max(60, Math.min(180, a.height * 0.55));
    ctx.font = `11px ${p._fontSans}`;
    const lo = log ? Math.log10(min) : min, hi = log ? Math.log10(max) : max;
    let ticks;
    if (log) ticks = logTicks(lo, hi, 4).major.map((v) => ({ t: Math.log10(v), label: fmtLogTick(v) }));
    else { const tk = niceTicks(min, max, 4); ticks = tk.map((v) => ({ t: v, label: fmtTick(v, tk.step) })); }
    const tw = Math.max(0, ...ticks.map((t) => ctx.measureText(t.label).width));
    ctx.font = `500 11px ${p._fontSans}`;
    const lw = label ? ctx.measureText(label).width : 0;
    const boxW = Math.max(barW + 8 + tw, lw) + 16;
    const boxH = barH + 16 + (label ? 18 : 0);
    const bx = position === 'left' ? a.left + 8 : a.left + a.width - boxW - 8;
    const by = a.top + Math.max(8, (a.height - boxH) / 2);
    ctx.save();
    ctx.fillStyle = pal.halo;
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    roundRect(ctx, bx + 0.5, by + 0.5, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();
    let y = by + 8;
    if (label) {
      ctx.fillStyle = pal.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(label, bx + 8, y);
      y += 18;
    }
    const barX = bx + 8;
    const lut = getLut(colormap);
    for (let k = 0; k < barH; k++) {
      const idx = Math.round((1 - k / (barH - 1)) * 255);
      ctx.fillStyle = `rgb(${lut[idx * 3]},${lut[idx * 3 + 1]},${lut[idx * 3 + 2]})`;
      ctx.fillRect(barX, y + k, barW, 1.2);
    }
    ctx.strokeStyle = pal.axis;
    ctx.strokeRect(barX + 0.5, y + 0.5, barW - 1, barH - 1);
    ctx.font = `11px ${p._fontSans}`;
    ctx.fillStyle = pal.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const t of ticks) {
      const ty = y + (1 - (t.t - lo) / (hi - lo || 1)) * barH;
      ctx.fillText(t.label, barX + barW + 5, ty);
    }
    ctx.restore();
  }

  legend(items, opts = {}) {
    this.plot._overlays.push(() => this._drawLegend(items, opts));
  }
  _drawLegend(items, { position = 'top-left' } = {}) {
    if (!items || !items.length) return;
    const ctx = this.ctx, p = this.plot, a = p.area, pal = this.palette;
    ctx.save();
    ctx.font = `12px ${p._fontSans}`;
    const rowH = 18, sw = 22;
    const w = Math.max(...items.map((it) => ctx.measureText(it.label).width)) + sw + 22;
    const h = items.length * rowH + 10;
    const right = position.includes('right'), bottom = position.includes('bottom');
    const x = right ? a.left + a.width - w - 8 : a.left + 8;
    const y = bottom ? a.top + a.height - h - 8 : a.top + 8;
    ctx.fillStyle = pal.halo;
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w, h, 6);
    ctx.fill();
    ctx.stroke();
    items.forEach((it, i) => {
      const cy = y + 5 + rowH * i + rowH / 2;
      const col = cssColor(it.color ?? '--plot-text-strong');
      const sx = x + 8;
      if (it.fill) {
        ctx.fillStyle = cssColor(it.fill === true ? col : it.fill);
        ctx.globalAlpha = it.fillAlpha ?? 0.35;
        ctx.fillRect(sx, cy - 5, sw, 10);
        ctx.globalAlpha = 1;
      }
      if (!it.marker || it.line) {
        if (!it.fill || it.line) {
          ctx.strokeStyle = col;
          ctx.lineWidth = it.width ?? 2;
          ctx.setLineDash(it.dash || []);
          ctx.beginPath();
          ctx.moveTo(sx, cy);
          ctx.lineTo(sx + sw, cy);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (it.marker) {
        ctx.beginPath();
        markerPath(ctx, sx + sw / 2, cy, it.marker, 4.5);
        if (isStrokeOnlyMarker(it.marker)) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); }
        else { ctx.fillStyle = col; ctx.fill(); }
      }
      ctx.fillStyle = pal.textStrong;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.label, sx + sw + 8, cy + 0.5);
    });
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
