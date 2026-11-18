/**
 * _orbitview.js - glue for lesson 07 (orbit-3d): scenario building, map-field sampling, contour lifting,
 * mirror-fix search, sweeps and tables.
 *
 * Pure functions (no DOM), so everything here can be checked in Node. All physics numbers come from
 * the core (`scenario`); this file only samples, converts units (km on maps, µs / Hz for display) and
 * packages results.
 */
import { scenario, frames, constants } from '../core/index.js';
import { contourLines } from '../ui/plot2d.js';

export const C = constants.C;
export const KM = 1000;
const DEG = Math.PI / 180;

/** The measurement sets of the map figure. n = number of collectors it needs. */
export const SETS = [
  { key: 'pair', n: 2, label: '2 balls — TDOA + FDOA + surface', use: { tdoa: true, fdoa: true, altitude: true } },
  { key: 'tri-t', n: 3, label: '3 balls — 2 TDOA + surface', use: { tdoa: true, fdoa: false, altitude: true } },
  { key: 'tri-tf', n: 3, label: '3 balls — 2 TDOA + 2 FDOA + surface', use: { tdoa: true, fdoa: true, altitude: true } },
  { key: 'four-t', n: 4, label: '4 balls — 3 TDOA, free 3-D (no surface)', use: { tdoa: true, fdoa: false, altitude: false } },
  { key: 'four-tf', n: 4, label: '4 balls — 3 TDOA + 3 FDOA, free 3-D', use: { tdoa: true, fdoa: true, altitude: false } },
  { key: 'four-all', n: 4, label: '4 balls — everything + surface', use: { tdoa: true, fdoa: true, altitude: true } },
];

/** Formation shapes and how many collectors each has. */
export const SHAPES = [
  { value: 'pair', label: 'Pair (2)', n: 2 },
  { value: 'triangle', label: 'Triangle (3)', n: 3 },
  { value: 'tri+1', label: 'Triangle + 1 (4)', n: 4 },
  { value: 'diamond', label: 'Diamond (4)', n: 4 },
  { value: 'string', label: 'String (4)', n: 4 },
];
export const shapeN = (shape) => (SHAPES.find((s) => s.value === shape) || SHAPES[2]).n;

/** Scenario config for the lesson's shared state. */
export function configFor({ shape, baselineKm, overhead }, use) {
  const over = { formation: { shape, baselineKm } };
  if (overhead) over.orbit = { passOffsetKm: { east: 0, north: 0 } };
  if (use) over.use = { ...use };
  return scenario.defaultConfig(over);
}

const sCache = new Map();
/** Built scenario for the state (memoised; building is cheap but the cache keeps object identity). */
export function scenarioFor(st, use) {
  const key = [st.shape, st.baselineKm, st.overhead ? 1 : 0, use ? `${+use.tdoa}${+use.fdoa}${+use.altitude}` : '-'].join('|');
  let S = sCache.get(key);
  if (!S) {
    if (sCache.size > 60) sCache.clear();
    S = scenario.buildScenario(configFor(st, use));
    sCache.set(key, S);
  }
  return S;
}

/**
 * Sample scenario.mapField on a regular east/north grid (km).
 * @returns {{nx, ny, x0, y0, dx, dy, tdoa: Field[], fdoa: Field[], minEl: Field}}  Field = {nx, ny, x0, y0,
 *          dx, dy, data}; tdoa in µs, fdoa in Hz, minEl in degrees; one Field per collector (reference
 *          entry included, all zeros). Points beyond the limb are NaN.
 */
export function sampleGrid(S, t, view, nx, ny) {
  const f = scenario.mapField(S, t);
  const x0 = view.xmin, y0 = view.ymin;
  const dx = (view.xmax - view.xmin) / (nx - 1), dy = (view.ymax - view.ymin) / (ny - 1);
  const mk = () => ({ nx, ny, x0, y0, dx, dy, data: new Float64Array(nx * ny) });
  const tdoa = Array.from({ length: S.n }, mk), fdoa = Array.from({ length: S.n }, mk), minEl = mk();
  for (let j = 0; j < ny; j++) {
    const n = (y0 + j * dy) * KM;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const v = f((x0 + i * dx) * KM, n);
      if (!v) {
        for (let c = 0; c < S.n; c++) { tdoa[c].data[k] = NaN; fdoa[c].data[k] = NaN; }
        minEl.data[k] = NaN;
        continue;
      }
      for (let c = 0; c < S.n; c++) { tdoa[c].data[k] = v.tdoa[c] * 1e6; fdoa[c].data[k] = v.fdoa[c]; }
      minEl.data[k] = v.minElevation / DEG;
    }
  }
  return { nx, ny, x0, y0, dx, dy, tdoa, fdoa, minEl };
}

/**
 * The emitter's own map-field values (µs, Hz): the levels whose contours pass exactly through it.
 * (mapField uses vacuum propagation, so these differ from truthObservation by the few-ns atmosphere.)
 */
export function emitterLevels(S, t) {
  const v = scenario.mapField(S, t)(0, 0);
  return { tdoa: v.tdoa.map((x) => x * 1e6), fdoa: v.fdoa.slice() };
}

/** Lift km contour polylines onto the Earth (ECEF) at the emitter altitude. */
export function liftLines(S, lines) {
  const out = [];
  for (const l of lines) {
    const pts = [];
    for (const [e, n] of l) {
      const p = S.map.surfacePoint(e * KM, n * KM);
      if (p) pts.push(p);
      else if (pts.length > 1) { out.push(pts.splice(0)); }
    }
    if (pts.length > 1) out.push(pts);
  }
  return out;
}

/**
 * Iso-TDOA / iso-FDOA lines through the emitter, lifted to ECEF, for every non-reference collector.
 * @returns {{kind:'tdoa'|'fdoa', i:number, points:number[][]}[]}
 */
export function groundLinesEcef(S, t, halfKm = 1200, n = 64) {
  const g = sampleGrid(S, t, { xmin: -halfKm, xmax: halfKm, ymin: -halfKm, ymax: halfKm }, n, n);
  const lv = emitterLevels(S, t);
  const out = [];
  for (let i = 0; i < S.n; i++) {
    if (i === S.cfg.ref) continue;
    for (const kind of ['tdoa', 'fdoa']) {
      for (const pts of liftLines(S, contourLines(g[kind][i], lv[kind][i]))) out.push({ kind, i, points: pts });
    }
  }
  return out;
}

/** Map (east, north) in km of the point on the ground below an ECEF position. */
export function groundEnuKm(S, r) {
  const g = frames.ecefToGeodeticDeg(r);
  const p = frames.geodeticToEcef(g.latDeg * DEG, g.lonDeg * DEG, 0);
  const enu = S.map.toEnu(p);
  return [enu[0] / KM, enu[1] / KM];
}

/** Sub-satellite points (km) and unit ground-heading vectors on the map for every collector at time t. */
export function subSatellite(S, t) {
  return S.ids.map((id, i) => {
    const [a, b] = scenario.trackEcef(S, i, [t, t + 5]);
    const p = groundEnuKm(S, a), q = groundEnuKm(S, b);
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return { id, x: p[0], y: p[1], hx: (q[0] - p[0]) / d, hy: (q[1] - p[1]) / d };
  });
}

/** Ground track (km) of collector i over the given times. */
export function groundTrack(S, i, times) {
  return scenario.trackEcef(S, i, times).map((r) => groundEnuKm(S, r));
}

/**
 * The second ("mirror") crossing of the pair's iso-TDOA and iso-FDOA lines: Newton iteration on
 * mapField, started from the emitter reflected across the formation's ground track.
 * @returns {{x:number, y:number, tdoa:number, fdoa:number, converged:boolean}|null} km, µs, Hz
 */
export function mirrorFix(S, t, i = 1) {
  const f = scenario.mapField(S, t);
  const target = f(0, 0);
  if (!target) return null;
  const subs = subSatellite(S, t);
  const cx = subs.reduce((s, q) => s + q.x, 0) / subs.length, cy = subs.reduce((s, q) => s + q.y, 0) / subs.length;
  const hx = subs[0].hx, hy = subs[0].hy;
  // reflect the origin across the line through (cx, cy) along (hx, hy)
  const along = -cx * hx - cy * hy;
  const fx = cx + along * hx, fy = cy + along * hy;
  let x = [2 * fx * KM, 2 * fy * KM];
  const res = (p) => {
    const v = f(p[0], p[1]);
    return v ? [(v.tdoa[i] - target.tdoa[i]) * C, (v.fdoa[i] - target.fdoa[i]) * (C / S.emitter.f0)] : null;
  };
  let converged = false;
  for (let k = 0; k < 25; k++) {
    const r = res(x);
    if (!r) return null;
    if (Math.hypot(r[0], r[1]) < 1e-4) { converged = true; break; }
    const h = 50;
    const rx = res([x[0] + h, x[1]]), ry = res([x[0], x[1] + h]);
    if (!rx || !ry) return null;
    const J = [[(rx[0] - r[0]) / h, (ry[0] - r[0]) / h], [(rx[1] - r[1]) / h, (ry[1] - r[1]) / h]];
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    if (!(Math.abs(det) > 0)) return null;
    let sx = (J[1][1] * r[0] - J[0][1] * r[1]) / det, sy = (-J[1][0] * r[0] + J[0][0] * r[1]) / det;
    const step = Math.hypot(sx, sy), maxStep = 3e5;
    if (step > maxStep) { sx *= maxStep / step; sy *= maxStep / step; }
    x = [x[0] - sx, x[1] - sy];
  }
  // reject a "mirror" that collapsed onto the emitter itself
  if (Math.hypot(x[0], x[1]) < 5 * KM) return null;
  const v = f(x[0], x[1]);
  if (!v) return null;
  return { x: x[0] / KM, y: x[1] / KM, tdoa: v.tdoa[i] * 1e6, fdoa: v.fdoa[i], converged };
}

/** Round a positive factor down to 1, 2 or 5 x 10^k. */
export function niceFactor(x) {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const e = Math.floor(Math.log10(x)), m = x / Math.pow(10, e);
  const s = m >= 5 ? 5 : m >= 2 ? 2 : 1;
  return s * Math.pow(10, e);
}

/** Log-spaced values between a and b inclusive. */
export function logspace(a, b, n) {
  return Array.from({ length: n }, (_, k) => a * Math.pow(b / a, k / (n - 1)));
}

/** scenario.dops for the state's formation at each baseline. */
export function dopSweep(st, t, baselines) {
  return baselines.map((L) => ({ L, d: scenario.dops(scenarioFor({ ...st, baselineKm: L }), t) }));
}

/**
 * Observability table: for N = 2, 3, 4 collectors and TDOA only / FDOA only / both, the covariance
 * with and without the Earth-surface constraint. The 4-collector row uses `shape4`.
 */
export function observabilityTable(st, t, shape4 = 'tri+1') {
  const rows = [];
  for (const [n, shape] of [[2, 'pair'], [3, 'triangle'], [4, shape4]]) {
    const S = scenarioFor({ ...st, shape });
    for (const kind of ['tdoa', 'fdoa', 'both']) {
      const tdoa = kind !== 'fdoa', fdoa = kind !== 'tdoa';
      const cell = (altitude) => {
        const c = scenario.covariance(S, t, { use: { tdoa, fdoa, altitude } });
        return c.observable ? { observable: true, cep: c.cep50, sigmaU: c.sigmaU, sigmaE: c.sigmaE, sigmaN: c.sigmaN } : { observable: false };
      };
      const eq = (tdoa ? n - 1 : 0) + (fdoa ? n - 1 : 0);
      rows.push({ n, shape, kind, eq, free: cell(false), surface: cell(true) });
    }
  }
  return rows;
}

/** Unit vector from the emitter towards the centroid of the collectors' lines of sight. */
export function meanLos(obs) {
  const m = [0, 0, 0];
  obs.collectors.forEach((q) => q.los.forEach((v, k) => { m[k] += v; }));
  const n = Math.hypot(m[0], m[1], m[2]) || 1;
  return m.map((v) => v / n);
}

/** Angle (deg, 0..90) between the ellipsoid's longest axis and the mean line of sight. */
export function longAxisAngleDeg(cov, obs) {
  if (!cov || !cov.observable) return null;
  const ax = cov.ellipsoid.axes[0], l = meanLos(obs);
  const d = Math.abs(ax[0] * l[0] + ax[1] * l[1] + ax[2] * l[2]);
  return Math.acos(Math.min(1, d)) / DEG;
}

/** Perpendicular distance (m) from point p to the line through a and b. */
export function distToLine(p, a, b) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const L = Math.hypot(...u) || 1;
  const cx = u[1] * w[2] - u[2] * w[1], cy = u[2] * w[0] - u[0] * w[2], cz = u[0] * w[1] - u[1] * w[0];
  return Math.hypot(cx, cy, cz) / L;
}
