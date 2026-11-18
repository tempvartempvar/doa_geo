/**
 * diagrams.js - static "anatomy" figures: every quantity drawn and labelled.
 * =====================================================================
 * Each figure is built from computed geometry (points first; angles, arcs,
 * arrowheads, right-angle marks and label positions derived from them) and
 * coloured only through the theme's CSS custom properties, so it follows the
 * light and dark themes.
 *
 * API
 * ---------------------------------------------------------------------
 *   DIAGRAM_NAMES            -> ['notation','gradient','doppler','ellipse','orbit','lighttime']
 *   diagramSvg(name)         -> SVG markup string (pure; importable in Node)
 *   diagramCaption(name)     -> caption HTML string containing $math$
 *   diagram(name)            -> <figure class="anatomy"> with the SVG and a
 *                               <p class="figure-caption"> rendered by prose()
 *   gradientCheck()          -> { cosine, residual } for the `gradient` figure:
 *                               cosine between the difference arrow and the
 *                               hyperbola's tangent at E (should be ~0), and
 *                               how far E is from the drawn branch (px).
 *
 * USAGE
 *   import { diagram } from '../ui/diagrams.js';
 *   root.append(diagram('gradient'));
 */

import { prose } from './tex.js';

export const DIAGRAM_NAMES = ['notation', 'gradient', 'doppler', 'ellipse', 'orbit', 'lighttime'];

/* ------------------------------------------------------------------ */
/* Vector helpers (points are [x, y], SVG coordinates: y grows down)   */
/* ------------------------------------------------------------------ */
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => mul(a, 1 / len(a));
const perp = (a) => [-a[1], a[0]];
const mid = (a, b) => mul(add(a, b), 0.5);
const angOf = (a) => Math.atan2(a[1], a[0]);
const dir = (t) => [Math.cos(t), Math.sin(t)];
const rot = (a, t) => [a[0] * Math.cos(t) - a[1] * Math.sin(t), a[0] * Math.sin(t) + a[1] * Math.cos(t)];
/** Unit normal to `d`, on the side of `toward` (or away from it with sign -1). */
const sideNormal = (d, toward, sign = 1) => {
  const n = unit(perp(d));
  return dot(n, toward) * sign >= 0 ? n : mul(n, -1);
};
const wrapAngle = (t) => Math.atan2(Math.sin(t), Math.cos(t));

function num(n) {
  if (!Number.isFinite(n)) throw new Error(`diagrams: non-finite coordinate ${n}`);
  return String(Math.round(n * 10) / 10);
}
const pt = (p) => `${num(p[0])} ${num(p[1])}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------------ */
/* Drawing primitives                                                  */
/* ------------------------------------------------------------------ */
function strokeAttrs({ stroke = 'var(--text)', w = 1.4, dash = null, opacity = null } = {}) {
  return `fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"` +
    (dash ? ` stroke-dasharray="${dash}"` : '') + (opacity != null ? ` stroke-opacity="${opacity}"` : '');
}
function line(p, q, o) { return `<path d="M${pt(p)} L${pt(q)}" ${strokeAttrs(o)}/>`; }
function polyline(pts, o) { return `<path d="M${pts.map(pt).join(' L')}" ${strokeAttrs(o)}/>`; }
function head(tip, d, color, size = 9) {
  const base = sub(tip, mul(d, size));
  const n = mul(perp(d), size * 0.42);
  return `<polygon points="${[tip, add(base, n), sub(base, n)].map((p) => `${num(p[0])},${num(p[1])}`).join(' ')}" fill="${color}"/>`;
}
function arrow(p, q, o = {}) {
  const color = o.stroke || 'var(--text)';
  const size = o.head || 9;
  const d = unit(sub(q, p));
  return line(p, sub(q, mul(d, size * 0.7)), o) + head(q, d, color, size);
}
function dblArrow(p, q, o = {}) {
  const color = o.stroke || 'var(--text)';
  const size = o.head || 7;
  const d = unit(sub(q, p));
  return line(add(p, mul(d, size * 0.7)), sub(q, mul(d, size * 0.7)), o) + head(q, d, color, size) + head(p, mul(d, -1), color, size);
}
/** Arc of radius r about c from angle a0 to a1 (the short way round). */
function arc(c, r, a0, a1, o) {
  const delta = wrapAngle(a1 - a0);
  const p0 = add(c, mul(dir(a0), r));
  const p1 = add(c, mul(dir(a0 + delta), r));
  return `<path d="M${pt(p0)} A${num(r)} ${num(r)} 0 0 ${delta > 0 ? 1 : 0} ${pt(p1)}" ${strokeAttrs(o)}/>`;
}
function rightMark(corner, u1, u2, s = 8, o = { stroke: 'var(--muted)', w: 1 }) {
  const a = add(corner, mul(u1, s));
  const b = add(a, mul(u2, s));
  return polyline([a, b, add(corner, mul(u2, s))], o);
}
/** Collector: filled (or hollow) triangle centred on p, same shape as lesson 1. */
function tri(p, color, { s = 1, hollow = false } = {}) {
  const pts = [[0, -10], [9, 6], [-9, 6]].map(([x, y]) => add(p, [x * s, y * s]));
  const paint = hollow ? `fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"` : `fill="${color}"`;
  return `<polygon points="${pts.map((q) => `${num(q[0])},${num(q[1])}`).join(' ')}" ${paint}/>`;
}
function diamond(p, color = 'var(--emitter)', s = 1) {
  const pts = [[0, -9.2], [8.2, 0], [0, 9.2], [-8.2, 0]].map(([x, y]) => add(p, [x * s, y * s]));
  return `<polygon points="${pts.map((q) => `${num(q[0])},${num(q[1])}`).join(' ')}" fill="${color}"/>`;
}
function disc(p, r, color, extra = '') {
  return `<circle cx="${num(p[0])}" cy="${num(p[1])}" r="${num(r)}" fill="${color}"${extra ? ' ' + extra : ''}/>`;
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */
const FS = 14;      // label size (viewBox units)
const SUB = 10.5;   // subscript size
const TAG = 12;     // plain-word tag size
const it = (s) => `<tspan font-style="italic">${s}</tspan>`;
const bf = (s) => `<tspan font-weight="bold">${s}</tspan>`;
/** Subscript; `after` (if any) is shifted back up to the baseline. */
const sb = (s, after = '') => `<tspan dy="4" font-size="${SUB}" font-style="normal" font-weight="normal">${s}</tspan>` +
  (after ? `<tspan dy="-4">${after}</tspan>` : '');
const tag = (s) => `<tspan font-size="${TAG}" fill="var(--muted)">${s}</tspan>`;

function text(x, y, content, { anchor = 'start', size = FS, fill = 'var(--text)' } = {}) {
  return `<text x="${num(x)}" y="${num(y)}" font-size="${size}" text-anchor="${anchor}" fill="${fill}">${content}</text>`;
}
/** Label beside point p, pushed `gap` along unit n; anchor and baseline follow n. */
function labelAt(p, n, gap, content, o = {}) {
  const q = add(p, mul(n, gap));
  const anchor = n[0] > 0.35 ? 'start' : n[0] < -0.35 ? 'end' : 'middle';
  const dy = n[1] > 0.35 ? 10 : n[1] < -0.35 ? 0 : 5;
  return text(q[0], q[1] + dy, content, { anchor, ...o });
}

/*
 * Accented symbols. Combining accents sit unreliably on italic/bold glyphs in
 * system fonts, so the accent is drawn: the symbol is the first glyph of a
 * start-anchored <text>, which fixes where its ink is. Offsets are for 14px
 * Segoe UI / system-ui (ink centre from the pen position, accent height).
 */
const GLYPH = {
  l: { w: 4.2, cx: 2.1, top: 10.4, bold: true, italic: false }, // bold upright l
  n: { w: 8.6, cx: 4.3, top: 7.4, bold: true, italic: false },  // bold upright n
  ρ: { w: 8.0, cx: 4.6, top: 7.4, bold: false, italic: true },  // italic rho
};
/** Width estimate of an accented symbol plus its subscript, for layout. */
const accentedWidth = (ch, subText = '') => GLYPH[ch].w + subText.length * 6;
function accented(x, y, ch, accent, { subText = '', rest = '', fill = 'var(--text)', anchor = 'start' } = {}) {
  const g = GLYPH[ch];
  const x0 = anchor === 'end' ? x - accentedWidth(ch, subText) : x;
  let glyph = ch;
  if (g.bold) glyph = bf(ch);
  if (g.italic) glyph = it(ch);
  const content = glyph + (subText ? sb(subText, rest) : rest);
  const cx = x0 + g.cx;
  const top = y - g.top;
  const mark = accent === 'hat'
    ? polyline([[cx - 3, top - 1.6], [cx, top - 4.6], [cx + 3, top - 1.6]], { stroke: fill, w: 1.15 })
    : disc([cx, top - 2.9], 1.2, fill);
  return text(x0, y, content, { fill }) + mark;
}

function svgWrap(w, h, aria, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" ` +
    `style="display:block;width:100%;max-width:440px;height:auto;margin:0.6em auto 0.2em" ` +
    `aria-label="${esc(aria)}">${body}</svg>`;
}

/* ------------------------------------------------------------------ */
/* 1. notation - the cast                                              */
/* ------------------------------------------------------------------ */
function notation() {
  const W = 400, H = 300;
  const A = [80, 240], B = [300, 240], E = [215, 52];
  const out = [];
  out.push(line(E, A, { stroke: 'var(--muted)', w: 1.3, dash: '5 4' }));
  out.push(line(E, B, { stroke: 'var(--muted)', w: 1.3, dash: '5 4' }));
  out.push(line(A, B, { stroke: 'var(--text)', w: 2 }));
  // velocities
  const vA = unit([-0.42, -0.9]), vB = unit([0.55, -0.83]);
  const vAs = add(A, mul(vA, 12)), vAe = add(vAs, mul(vA, 46));
  const vBs = add(B, mul(vB, 12)), vBe = add(vBs, mul(vB, 46));
  out.push(arrow(vAs, vAe, { stroke: 'var(--text-2)', w: 1.8 }));
  out.push(arrow(vBs, vBe, { stroke: 'var(--text-2)', w: 1.8 }));
  out.push(tri(A, 'var(--collector-a)'), tri(B, 'var(--collector-b)'), diamond(E));
  // labels
  out.push(text(A[0], A[1] + 26, 'A', { anchor: 'middle' }));
  out.push(text(B[0], B[1] + 26, 'B', { anchor: 'middle' }));
  out.push(text(E[0] + 13, E[1] + 5, 'E'));
  const mAB = mid(A, B);
  out.push(text(mAB[0], mAB[1] + 22, `${it('d')}<tspan dx="6">${tag('baseline')}</tspan>`, { anchor: 'middle' }));
  const nA = sideNormal(sub(E, A), sub(mid(E, A), B));
  const nB = sideNormal(sub(E, B), sub(mid(E, B), A));
  out.push(labelAt(mid(E, A), nA, 14, `${tag('range')}<tspan dx="5" font-style="italic">ρ</tspan>${sb('A')}`));
  out.push(labelAt(mid(E, B), nB, 14, `${it('ρ')}${sb('B', '&#8202;')}<tspan dx="5">${tag('range')}</tspan>`));
  out.push(labelAt(vAe, vA, 6, `${bf('v')}${sb('A')}`));
  out.push(labelAt(vBe, vB, 6, `${bf('v')}${sb('B')}`));
  return svgWrap(W, H, 'Collectors A and B joined by a solid baseline of length d; dashed lines from the emitter E to each collector are the ranges rho A and rho B; an arrow on each collector is its velocity, v A and v B.', out.join(''));
}

/* ------------------------------------------------------------------ */
/* 2. gradient - why the TDOA curve moves the way it does              */
/* ------------------------------------------------------------------ */
function gradientGeometry() {
  const W = 400, H = 305;
  const A = [80, 262], B = [320, 262], E = [150, 92];
  const M = mid(A, B), c = len(sub(B, A)) / 2;
  const k = (P) => len(sub(P, B)) - len(sub(P, A)); // rho_B - rho_A
  const kE = k(E);
  const branch = (kk) => {
    const a = kk / 2, b = Math.sqrt(c * c - a * a);
    return { a, b, at: (t) => [M[0] - a * Math.cosh(t), M[1] + b * Math.sinh(t)], d: (t) => [-a * Math.sinh(t), b * Math.cosh(t)] };
  };
  const lA = unit(sub(A, E)), lB = unit(sub(B, E));
  const g = sub(lA, lB); // gradient of rho_B - rho_A at E
  const br1 = branch(kE);
  const tE = Math.asinh((E[1] - M[1]) / br1.b);
  const tangent = unit(br1.d(tE));
  return { W, H, A, B, E, M, k, kE, branch, lA, lB, g, br1, tE, tangent };
}

export function gradientCheck() {
  const G = gradientGeometry();
  return { cosine: dot(G.tangent, unit(G.g)), residual: len(sub(G.br1.at(G.tE), G.E)) };
}

function gradient() {
  const G = gradientGeometry();
  const { W, H, A, B, E, k, kE, branch, lA, lB, g, br1 } = G;
  const chk = gradientCheck();
  if (Math.abs(chk.cosine) > 1e-9 || chk.residual > 1e-6) throw new Error('gradient: difference arrow not normal to the curve');
  const L = 62;
  const shift = 26;                       // delta n at E, px
  const k2 = kE + shift * len(g);         // the "slightly larger" range difference
  const br2 = branch(k2);
  const curve = (br, o) => {
    const t0 = Math.asinh((8 - G.M[1]) / br.b), t1 = Math.asinh((H - 8 - G.M[1]) / br.b);
    const pts = [];
    for (let i = 0; i <= 90; i++) pts.push(br.at(t0 + (t1 - t0) * i / 90));
    return polyline(pts, o);
  };
  const out = [];
  out.push(line(A, B, { stroke: 'var(--border-strong)', w: 1.5 }));
  out.push(line(E, A, { stroke: 'var(--border-strong)', w: 1, dash: '4 4' }));
  out.push(line(E, B, { stroke: 'var(--border-strong)', w: 1, dash: '4 4' }));
  out.push(curve(br2, { stroke: 'var(--tdoa)', w: 1.6, opacity: 0.45, dash: '6 4' }));
  out.push(curve(br1, { stroke: 'var(--tdoa)', w: 2.4 }));
  // delta n between the two curves, higher up
  const t1 = Math.asinh((52 - G.M[1]) / br1.b);
  const P1 = br1.at(t1);
  const n1 = unit(sub(unit(sub(A, P1)), unit(sub(B, P1))));
  let lo = 0, hi = 120;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (k(add(P1, mul(n1, m))) < k2) lo = m; else hi = m; }
  const P2 = add(P1, mul(n1, lo));
  out.push(dblArrow(P1, P2, { stroke: 'var(--text-2)', w: 1.3, head: 6 }));
  const tUp = unit(br1.d(t1)); // dt>0 moves down; take the upward direction
  const up = tUp[1] < 0 ? tUp : mul(tUp, -1);
  out.push(labelAt(mid(P1, P2), up, 8, `${it('δn')}`));
  // angle theta
  const aA = angOf(lA), aB = angOf(lB);
  const theta = Math.acos(dot(lA, lB));
  out.push(arc(E, 30, aA, aB, { stroke: 'var(--text-2)', w: 1.2 }));
  const bis = aA + wrapAngle(aB - aA) / 2;
  const thetaDir = dir(bis + wrapAngle(aB - bis) * 0.5);
  const thetaC = add(E, mul(thetaDir, 44));
  out.push(text(thetaC[0], thetaC[1] + 5, it('θ'), { anchor: 'middle' }));
  // arrows
  const tipA = add(E, mul(lA, L)), tipB = add(E, mul(lB, L)), tipG = add(E, mul(g, L));
  out.push(arrow(E, tipA, { stroke: 'var(--text)', w: 1.8 }));
  out.push(arrow(E, tipB, { stroke: 'var(--text)', w: 1.8 }));
  out.push(arrow(E, tipG, { stroke: 'var(--accent)', w: 2.4, head: 10 }));
  out.push(tri(A, 'var(--collector-a)'), tri(B, 'var(--collector-b)'), diamond(E));
  // labels
  out.push(text(A[0], A[1] + 26, 'A', { anchor: 'middle' }));
  out.push(text(B[0], B[1] + 26, 'B', { anchor: 'middle' }));
  out.push(text(E[0] + 12, E[1] - 8, 'E'));
  // l-hat labels beside the arrow tips, on the side away from the angle
  // (beyond the tips would sit on the dashed lines to the collectors)
  const qA = add(tipA, mul(sideNormal(lA, lB, -1), 9)), qB = add(tipB, mul(sideNormal(lB, lA, -1), 9));
  out.push(accented(qA[0], qA[1] + 5, 'l', 'hat', { subText: 'A', anchor: 'end' }));
  out.push(accented(qB[0], qB[1] + 5, 'l', 'hat', { subText: 'B' }));
  // difference label, to the left of its tip
  const gU = unit(g);
  const right = add(tipG, mul(gU, 6));
  const wl = accentedWidth('l', 'A');
  const x0 = right[0] - (2 * wl + 16), y0 = right[1] + 5;
  out.push(accented(x0, y0, 'l', 'hat', { subText: 'A', fill: 'var(--accent)' }));
  out.push(text(x0 + wl + 8, y0, '−', { anchor: 'middle', fill: 'var(--accent)' }));
  out.push(accented(x0 + wl + 16, y0, 'l', 'hat', { subText: 'B', fill: 'var(--accent)' }));
  void theta;
  return svgWrap(W, H, 'Collectors A and B on a baseline and emitter E above it. The hyperbola through E, foci A and B. At E, unit arrows l-hat A and l-hat B point at the collectors with angle theta between them; their difference points straight across the curve, towards a second, fainter hyperbola for a slightly larger range difference. The gap between the curves is delta n.', out.join(''));
}

/* ------------------------------------------------------------------ */
/* 3. doppler - resolving the velocity along and across the line of sight */
/* ------------------------------------------------------------------ */
function doppler() {
  const W = 400, H = 262;
  const A = [72, 226], E = [322, 58];
  const vdir = unit([1, 0]), vlen = 178;
  const V = add(A, mul(vdir, vlen));
  const u = unit(sub(E, A));
  const cosA = dot(u, vdir), alpha = Math.acos(cosA);
  const P = add(A, mul(u, vlen * cosA));
  const out = [];
  out.push(line(add(A, mul(u, 10)), sub(E, mul(u, 10)), { stroke: 'var(--muted)', w: 1.3, dash: '5 4' }));
  out.push(rightMark(P, unit(sub(A, P)), unit(sub(V, P))));
  out.push(arc(A, 38, angOf(vdir), angOf(u), { stroke: 'var(--text-2)', w: 1.2 }));
  out.push(arrow(A, V, { stroke: 'var(--text)', w: 2 }));
  out.push(arrow(A, P, { stroke: 'var(--accent)', w: 2.6 }));
  out.push(arrow(P, V, { stroke: 'var(--good)', w: 2 }));
  out.push(tri(A, 'var(--collector-a)'), diamond(E));
  out.push(text(A[0] - 14, A[1] + 5, 'A', { anchor: 'end' }));
  out.push(text(E[0] + 13, E[1] + 5, 'E'));
  // alpha
  const aC = add(A, mul(dir((angOf(vdir) + angOf(u)) / 2), 52));
  out.push(text(aC[0], aC[1] + 5, it('α'), { anchor: 'middle' }));
  // v
  out.push(labelAt(mid(A, V), [0, 1], 8, bf('v')));
  // along the line of sight: label above-left of A-P, tag above it
  const nUp = sideNormal(u, sub(A, V));
  const q = add(mid(A, P), mul(nUp, 18));
  const wr = accentedWidth('ρ', 'A');
  out.push(text(q[0] - wr - 1, q[1], `${it('v')} cos ${it('α')} = −`, { anchor: 'end', fill: 'var(--accent)' }));
  out.push(accented(q[0] - wr, q[1], 'ρ', 'dot', { subText: 'A', fill: 'var(--accent)' }));
  out.push(text(q[0], q[1] - 17, tag('closing speed'), { anchor: 'end' }));
  // range label on the rest of the line of sight
  out.push(labelAt(mid(P, E), nUp, 12, `${it('ρ')}${sb('A')}`));
  // across: beside P-V, away from A
  const across = unit(sub(V, P));
  const nOut = sideNormal(across, sub(mid(P, V), A));
  out.push(labelAt(mid(P, V), nOut, 12, `${it('v')}${sb('⊥', ' = ')}${it('v')} sin ${it('α')}`, { fill: 'var(--good)' }));
  void alpha;
  return svgWrap(W, H, 'Collector A moving with velocity v, emitter E ahead and to one side, the dashed line of sight rho A from A to E, and the angle alpha between them. The velocity splits into v cos alpha along the line of sight, equal to minus rho-dot A, and v-perpendicular equal to v sin alpha across it, at a right angle.', out.join(''));
}

/* ------------------------------------------------------------------ */
/* 4. ellipse - a cloud of fixes, its error ellipses and the CEP       */
/* ------------------------------------------------------------------ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussPairs(seed) {
  const r = mulberry32(seed);
  return () => {
    const u1 = Math.max(r(), 1e-12), u2 = r();
    const m = Math.sqrt(-2 * Math.log(u1));
    return [m * Math.cos(2 * Math.PI * u2), m * Math.sin(2 * Math.PI * u2)];
  };
}
const ELL = { sMaj: 58, sMin: 23.2, tilt: -30 * Math.PI / 180 };
let cepCache = null;
/** Median miss distance (px) for the ellipse figure's Gaussian, from 200 000 seeded draws. */
export function ellipseCep() {
  if (cepCache != null) return cepCache;
  const g = gaussPairs(20240611);
  const n = 200000, d = new Float64Array(n);
  for (let i = 0; i < n; i++) { const [z1, z2] = g(); d[i] = Math.hypot(ELL.sMaj * z1, ELL.sMin * z2); }
  d.sort();
  cepCache = (d[n / 2 - 1] + d[n / 2]) / 2;
  return cepCache;
}

function ellipse() {
  const W = 400, H = 272;
  const C = [200, 152];
  const { sMaj, sMin, tilt } = ELL;
  const u = dir(tilt), w = perp(u);
  const k95 = Math.sqrt(-2 * Math.log(0.05)); // 2.448
  const rayR = (d, s) => 1 / Math.hypot(dot(d, u) / (sMaj * s), dot(d, w) / (sMin * s));
  const cep = ellipseCep();
  const out = [];
  const g = gaussPairs(7);
  const dots = [];
  for (let i = 0; i < 150; i++) {
    const [z1, z2] = g();
    const p = add(C, add(mul(u, sMaj * z1), mul(w, sMin * z2)));
    if (p[0] > 3 && p[0] < W - 3 && p[1] > 3 && p[1] < H - 3) dots.push(disc(p, 1.8, 'var(--muted)', 'fill-opacity="0.6"'));
  }
  out.push(dots.join(''));
  const deg = num(tilt * 180 / Math.PI);
  const ell = (s, o) => `<ellipse cx="${num(C[0])}" cy="${num(C[1])}" rx="${num(sMaj * s)}" ry="${num(sMin * s)}" transform="rotate(${deg} ${num(C[0])} ${num(C[1])})" ${strokeAttrs(o)}/>`;
  out.push(ell(k95, { stroke: 'var(--tdoa)', w: 1.4, dash: '6 4' }));
  out.push(ell(1, { stroke: 'var(--tdoa)', w: 2 }));
  out.push(`<circle cx="${num(C[0])}" cy="${num(C[1])}" r="${num(cep)}" ${strokeAttrs({ stroke: 'var(--good)', w: 1.6, dash: '2 3' })}/>`);
  // semi-axes
  const majEnd = add(C, mul(u, sMaj)), minDir = mul(w, -1), minEnd = add(C, mul(minDir, sMin));
  out.push(arrow(C, majEnd, { stroke: 'var(--accent)', w: 2, head: 7 }));
  out.push(arrow(C, minEnd, { stroke: 'var(--collector-b)', w: 2, head: 6 }));
  out.push(diamond(C, 'var(--emitter)', 0.7));
  // labels with leaders, outside the 95 % ellipse
  const leader = (from, to, color) => line(from, to, { stroke: color, w: 0.9, dash: '2 2' }) + disc(from, 1.6, color);
  const place = (d, extra) => add(C, mul(d, rayR(d, k95) + extra));
  // 95 %
  {
    const d = unit([0.55, -0.83]);
    const T = add(C, mul(d, rayR(d, k95))), Lp = place(d, 14);
    out.push(leader(T, sub(Lp, mul(d, 3)), 'var(--tdoa)'));
    out.push(labelAt(Lp, d, 2, '95 %', { fill: 'var(--tdoa)' }));
  }
  // 1 sigma
  {
    const d = unit([-0.85, -0.53]);
    const T = add(C, mul(d, rayR(d, 1))), Lp = place(d, 14);
    out.push(leader(T, sub(Lp, mul(d, 3)), 'var(--tdoa)'));
    out.push(labelAt(Lp, d, 2, `1${it('σ')} (39 %)`, { fill: 'var(--tdoa)' }));
  }
  // sigma minor: leader from the middle of the minor semi-axis, straight up
  {
    const d = [0, -1];
    const T = mid(C, minEnd), Lp = add(T, mul(d, rayR(d, k95) + 18 + (C[1] - T[1])));
    out.push(leader(T, sub(Lp, mul(d, 8)), 'var(--collector-b)')); // clear the subscript
    out.push(labelAt(Lp, d, 2, `${it('σ')}${sb('minor')}`, { fill: 'var(--collector-b)' }));
  }
  // sigma major: leader from 60 % along the major semi-axis, down and right
  {
    const d = unit([0.8, 0.6]);
    const T = add(C, mul(u, sMaj * 0.6)), Lp = place(d, 22);
    out.push(leader(T, sub(Lp, mul(d, 3)), 'var(--accent)'));
    out.push(labelAt(Lp, d, 2, `${it('σ')}${sb('major')}`, { fill: 'var(--accent)' }));
  }
  // CEP
  {
    const d = unit([-0.33, 0.94]);
    const T = add(C, mul(d, cep)), Lp = place(d, 14);
    out.push(leader(T, sub(Lp, mul(d, 3)), 'var(--good)'));
    out.push(labelAt(Lp, d, 2, 'CEP', { fill: 'var(--good)' }));
  }
  return svgWrap(W, H, 'About 150 dots, one per fix, scattered around the true emitter position. The 1-sigma error ellipse and the larger 95 percent ellipse, tilted 30 degrees, with the semi-axes sigma major and sigma minor drawn from the centre, and the CEP circle that holds half the fixes.', out.join(''));
}

/* ------------------------------------------------------------------ */
/* 5. orbit - side view of a formation above the Earth                 */
/* ------------------------------------------------------------------ */
function orbit() {
  const W = 400, H = 252;
  const O = [200, 1105], R = 900;           // Earth centre and radius (not to scale)
  const surf = (t) => add(O, mul([Math.sin(t), -Math.cos(t)], R)); // t: angle from straight up
  const E = surf(-0.12);
  const upE = unit(sub(E, O));
  const hzn = [-upE[1], upE[0]];            // horizon, pointing right
  const S = [300, 72];                      // middle of the formation
  const rho = len(sub(S, E));
  const s = unit(sub(S, E));
  const p = sideNormal(s, [1, 1]);          // across the line of sight
  const Lf = 54;                            // formation size
  const out = [];
  // Earth: filled disc segment and its outline
  const tA = -Math.asin((O[0] + 20) / R), tB = Math.asin((W - O[0] + 20) / R);
  const e0 = surf(tA), e1 = surf(tB);
  out.push(`<path d="M${pt(e0)} A${R} ${R} 0 0 1 ${pt(e1)} L${num(W + 20)} ${num(H + 20)} L-20 ${num(H + 20)} Z" fill="var(--surface-2)" stroke="var(--border-strong)" stroke-width="1.6"/>`);
  // horizon and up
  out.push(line(add(E, mul(hzn, -80)), add(E, mul(hzn, 150)), { stroke: 'var(--muted)', w: 1.2, dash: '5 4' }));
  out.push(arrow(add(E, mul(upE, 11)), add(E, mul(upE, 48)), { stroke: 'var(--text-2)', w: 1.5, head: 7 }));
  // beta lines to the edges of the formation
  const edge1 = add(S, mul(p, -Lf / 2)), edge2 = add(S, mul(p, Lf / 2));
  out.push(line(E, edge1, { stroke: 'var(--muted)', w: 0.9, opacity: 0.7 }));
  out.push(line(E, edge2, { stroke: 'var(--muted)', w: 0.9, opacity: 0.7 }));
  out.push(line(E, S, { stroke: 'var(--text)', w: 1.6 }));
  // epsilon
  out.push(arc(E, 50, angOf(hzn), angOf(s), { stroke: 'var(--text-2)', w: 1.2 }));
  const eps = add(E, mul(dir(angOf(hzn) + wrapAngle(angOf(s) - angOf(hzn)) / 2), 66));
  out.push(text(eps[0], eps[1] + 5, it('ϵ'), { anchor: 'middle' }));
  // beta arc and label (outside the wedge, on the upper-left side)
  const rb = rho * 0.6;
  out.push(arc(E, rb, angOf(sub(edge1, E)), angOf(sub(edge2, E)), { stroke: 'var(--text-2)', w: 1.1 }));
  const halfB = Math.atan2(Lf / 2, rho);
  const bq = add(add(E, mul(s, rb)), mul(p, -(rb * Math.tan(halfB) + 10)));
  out.push(labelAt(bq, mul(p, -1), 0, it('β')));
  // rho label, below-right of the line E-S
  out.push(labelAt(mid(E, S), p, 14, it('ρ')));
  // sub-satellite point, altitude and ground track
  const toC = unit(sub(O, S));
  const Q = add(O, mul(toC, -R));
  const h = len(sub(Q, S));
  out.push(line(add(S, mul(toC, 14)), sub(Q, mul(toC, 4)), { stroke: 'var(--muted)', w: 1.2, dash: '4 4' }));
  out.push(disc(Q, 3.4, 'var(--text)'));
  out.push(text(Q[0], Q[1] + 24, tag('sub-satellite point'), { anchor: 'middle' }));
  out.push(labelAt(add(S, mul(toC, 14 + (h - 14) * 0.5)), sideNormal(toC, [1, 0]), 8, it('h')));
  const tQ = Math.atan2(Q[0] - O[0], O[1] - Q[1]);
  const tT = tQ + 62 / R;
  const gt0 = surf(tQ + 7 / R);
  const gt1 = surf(tT);
  const gtDir = unit([Math.cos(tT), Math.sin(tT)]);
  out.push(`<path d="M${pt(gt0)} A${R} ${R} 0 0 1 ${pt(sub(gt1, mul(gtDir, 6)))}" ${strokeAttrs({ stroke: 'var(--text-2)', w: 1.6 })}/>`);
  out.push(head(gt1, gtDir, 'var(--text-2)', 8));
  const gtl = surf(tQ + 40 / R);
  out.push(text(gtl[0] + 6, gtl[1] - 12, tag('ground track'), { anchor: 'start' }));
  // formation: four collectors spread across the line of sight
  const cols = ['var(--collector-a)', 'var(--collector-b)', 'var(--collector-c)', 'var(--collector-d)'];
  const names = ['A', 'B', 'C', 'D'];
  const jit = [3, -4, 4, -2];
  cols.forEach((col, i) => {
    const c = add(add(S, mul(p, Lf * (i / 3 - 0.5))), mul(s, jit[i]));
    out.push(tri(c, col, { s: 0.55 }));
    const lp = add(c, mul(s, 14));
    out.push(text(lp[0], lp[1] + 4, names[i], { anchor: 'middle', size: 10.5, fill: 'var(--text-2)' }));
  });
  // dimension line L, beyond the formation
  const off = mul(s, 34);
  const d1 = add(edge1, off), d2 = add(edge2, off);
  out.push(line(add(edge1, mul(s, 24)), add(edge1, mul(s, 39)), { stroke: 'var(--muted)', w: 0.9 }));
  out.push(line(add(edge2, mul(s, 24)), add(edge2, mul(s, 39)), { stroke: 'var(--muted)', w: 0.9 }));
  out.push(dblArrow(d1, d2, { stroke: 'var(--text-2)', w: 1.1, head: 6 }));
  out.push(labelAt(mid(d1, d2), s, 8, it('L')));
  // velocity of the formation, parallel to the ground track
  const vdir = unit([-toC[1], toC[0]]);
  const vd = vdir[0] > 0 ? vdir : mul(vdir, -1);
  const v0 = add(edge2, mul(vd, 22)), v1 = add(v0, mul(vd, 42));
  out.push(arrow(v0, v1, { stroke: 'var(--text)', w: 1.8, head: 8 }));
  out.push(labelAt(v1, vd, 6, bf('v')));
  // emitter
  out.push(diamond(E));
  out.push(text(E[0], E[1] + 26, 'E', { anchor: 'middle' }));
  out.push(text(add(E, mul(hzn, -48))[0], add(E, mul(hzn, -48))[1] - 8, tag('horizon'), { anchor: 'middle' }));
  const upT = add(E, mul(upE, 48));
  out.push(text(upT[0] - 8, upT[1] + 2, tag('up'), { anchor: 'end' }));
  return svgWrap(W, H, 'Side view, not to scale: the Earth along the bottom, the emitter E on its surface with its horizon and an up arrow, and four collectors A to D high up to the right. The line from E to the formation is the range rho, at elevation epsilon above the horizon; the formation has size L and subtends the small angle beta at E. Straight below the formation is the sub-satellite point, at altitude h beneath it, moving along the ground track in the same sense as the formation velocity v.', out.join(''));
}

/* ------------------------------------------------------------------ */
/* 6. lighttime - the collector moves while the signal is in flight    */
/* ------------------------------------------------------------------ */
function lighttime() {
  const W = 400, H = 272;
  const E = [200, 246];
  const y = 66;
  const Pe = [128, y], Pi = [272, y];
  const out = [];
  out.push(arrow([22, y], [386, y], { stroke: 'var(--border-strong)', w: 1.2, dash: '3 4', head: 7 }));
  out.push(line(E, Pe, { stroke: 'var(--muted)', w: 1.4, dash: '5 4' }));
  out.push(line(E, Pi, { stroke: 'var(--text)', w: 1.8 }));
  const n = unit(sub(Pi, E));
  out.push(arrow(E, add(E, mul(n, 44)), { stroke: 'var(--accent)', w: 2.8, head: 10 }));
  // displacement arrow above the path
  const dy = -22;
  out.push(arrow(add(Pe, [12, dy]), add(Pi, [-12, dy]), { stroke: 'var(--text-2)', w: 1.6 }));
  out.push(text((Pe[0] + Pi[0]) / 2, y + dy - 9,
    `${bf('v')}${sb('i', ' (')}${it('t')}${sb('i', ' − ')}${it('t')}${sb('e', ')')}`, { anchor: 'middle' }));
  out.push(tri(Pe, 'var(--collector-a)', { hollow: true }), tri(Pi, 'var(--collector-a)'), diamond(E));
  out.push(text(Pe[0] - 14, y + 22, `${tag('collector at')} ${it('t')}${sb('e')}`, { anchor: 'end', size: 13 }));
  out.push(text(Pi[0] + 14, y + 22, `${tag('collector at')} ${it('t')}${sb('i')}`, { anchor: 'start', size: 13 }));
  out.push(text(E[0] + 13, E[1] + 5, 'E'));
  // n-hat beside its arrow
  const nOut = sideNormal(n, [1, 0]);
  const nq = add(add(E, mul(n, 26)), mul(nOut, 9));
  out.push(accented(nq[0], nq[1] + 5, 'n', 'hat', { subText: 'i', fill: 'var(--accent)' }));
  // line tags
  const mS = mid(E, Pi), mD = mid(E, Pe);
  out.push(labelAt(mS, sideNormal(n, [1, 0]), 12, tag('signal path')));
  const dOut = sideNormal(sub(Pe, E), [-1, 0]);
  const dq = add(mD, mul(dOut, 12));
  out.push(text(dq[0], dq[1], tag('instantaneous'), { anchor: 'end' }));
  out.push(text(dq[0], dq[1] + 15, tag('geometry'), { anchor: 'end' }));
  return svgWrap(W, H, 'Emitter E at the bottom and a collector moving left to right across the top. The hollow triangle is the collector at the emission time t e, the solid one is the collector at the arrival time t i, displaced by v i times (t i minus t e). A solid line from E to the solid triangle is the path the signal really takes, with the unit vector n-hat i along it; a dashed line from E to the hollow triangle is the instantaneous geometry.', out.join(''));
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */
const BUILDERS = { notation, gradient, doppler, ellipse, orbit, lighttime };

const CAPTIONS = {
  notation: 'The cast. The ranges $\\rho_A$ and $\\rho_B$ are the straight-line distances from the emitter E to each collector. The baseline is the line joining the collectors, and $d$ is its length. $\\mathbf v_A$ and $\\mathbf v_B$ are the collectors\' velocities. The range rate $\\dot\\rho_A$ is how fast the dashed line to A is getting longer.',
  gradient: 'At E, $\\hat{\\mathbf l}_A$ and $\\hat{\\mathbf l}_B$ are arrows of length 1 pointing at the two collectors, and $\\theta$ is the angle between them. Their difference points straight across the curve: that is the direction of $\\nabla\\tau_{BA}$, the way E would have to move to change $\\tau_{BA}$ fastest. A timing error $\\delta\\tau$ shifts the whole curve sideways by $\\delta n$.',
  doppler: 'Only the part of the velocity that points along the line of sight changes the range: $\\dot\\rho_A = -v\\cos\\alpha$, negative while closing, which gives the Doppler shift $f_A - f_0 = (v/\\lambda)\\cos\\alpha$. The part across the line of sight, $v_\\perp = v\\sin\\alpha$, leaves the range alone for the moment and instead turns the line of sight, at the rate $v_\\perp/\\rho_A$.',
  ellipse: 'Each dot is one fix; the diamond is the truth. The $1\\sigma$ ellipse holds 39 % of the fixes and the 95 % ellipse is 2.448 times larger. $\\sigma_{major}$ and $\\sigma_{minor}$ are the $1\\sigma$ errors along its long and short axes. CEP is the radius of the circle that holds half the fixes.',
  orbit: 'Side view, not to scale. $\\rho$ is the range from the emitter to the formation and $\\epsilon$ is its elevation above the emitter\'s horizon. $L$ is the size of the formation; seen from E it subtends the small angle $\\beta \\approx L/\\rho$, which plays the part that $\\theta$ played on the flat map. The sub-satellite point is the spot on the ground directly beneath the formation, and the path it traces is the ground track.',
  lighttime: 'While the signal is in flight (a few milliseconds) the collector moves tens of metres. The signal arrives where the collector is at $t_i$, not where it was at $t_e$. $\\hat{\\mathbf n}_i$ is the unit vector along the path actually taken. Not to scale.',
};

function check(name) {
  if (!BUILDERS[name]) throw new Error(`diagrams: unknown diagram "${name}"`);
}
export function diagramSvg(name) { check(name); return BUILDERS[name](); }
export function diagramCaption(name) { check(name); return CAPTIONS[name]; }

/** <figure class="anatomy"> with the SVG and its rendered caption. */
export function diagram(name) {
  const fig = document.createElement('figure');
  fig.className = 'anatomy';
  fig.style.margin = '1em 0';
  fig.innerHTML = diagramSvg(name);
  const cap = document.createElement('p');
  cap.className = 'figure-caption';
  cap.append(...prose(diagramCaption(name)).childNodes);
  fig.append(cap);
  return fig;
}
