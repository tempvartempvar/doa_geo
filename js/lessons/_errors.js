/**
 * _errors.js - shared glue for the Part II error lessons (04-dop.js, 05-error-budget.js).
 *
 * Pure functions only (no DOM except injectStyle), so they can be checked in Node.
 * Every physics number comes from the core (planar / estimate); this file only converts
 * units, builds geometries and packages results.
 *
 * Units: the core is SI. Maps in the lessons are in km; helpers that take "handles"
 * expect km positions and m/s velocities.
 */
import { planar, estimate, constants } from '../core/index.js';

export const C = constants.C;
export const KM = 1000;
export const CHI95 = Math.sqrt(-2 * Math.log(1 - 0.95)); // 2.4477, 2-D 95 % radius in sigmas

/** Default flat-world layout (km, m/s) shared by both lessons: up to four collectors. */
export const LAYOUT = [
  { x: -40, y: -10, vx: 250, vy: 0 },
  { x: 40, y: -10, vx: 0, vy: 250 },
  { x: 0, y: 45, vx: -177, vy: -177 },
  { x: 0, y: -60, vx: 177, vy: -177 },
];
export const NAMES = ['A', 'B', 'C', 'D'];
export const COLL_VARS = ['--collector-a', '--collector-b', '--collector-c', '--collector-d'];

/** Convex hull (monotone chain) of [[x,y],...], counter-clockwise. */
export function hull(pts) {
  const p = pts.map((q) => q.slice()).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** An rng whose normal() is always 0: makes planar.simulate deterministic (biases only). */
export const zeroRng = { normal: () => 0, uniform: () => 0.5 };

/** Handles (km positions, m/s velocities) -> core collectors { p:[m,m], v:[m/s,m/s] }. */
export function toCollectors(list) {
  return list.map((h) => ({ p: [h.x * KM, h.y * KM], v: [h.vx ?? 0, h.vy ?? 0] }));
}

/** Per-collector noise object for the core. */
export const noiseOf = (sigmaT, sigmaF) => ({ sigmaT, sigmaF });

/** Inverse of a 2 x 2 matrix, or null. */
export function inv2(P) {
  const det = P[0][0] * P[1][1] - P[0][1] * P[1][0];
  if (!(Math.abs(det) > 0) || !isFinite(det)) return null;
  return [[P[1][1] / det, -P[0][1] / det], [-P[1][0] / det, P[0][0] / det]];
}

/** Fraction of points (absolute positions, m) inside the k-sigma ellipse of P centred on e. */
export function fractionInside(points, e, P, k = CHI95) {
  const Pi = inv2(P);
  if (!Pi || !points.length) return NaN;
  let n = 0;
  const k2 = k * k;
  for (const p of points) {
    const dx = p[0] - e[0], dy = p[1] - e[1];
    const d2 = dx * (Pi[0][0] * dx + Pi[0][1] * dy) + dy * (Pi[1][0] * dx + Pi[1][1] * dy);
    if (d2 <= k2) n++;
  }
  return n / points.length;
}

/** Can this measurement selection fix a 2-D position at all? (counting only) */
export function countOk(n, useT, useF) {
  const m = (useT ? n - 1 : 0) + (useF ? n - 1 : 0);
  return m >= 2;
}

/**
 * TDOA DOP and the TDOA-only CRLB DRMS for the same geometry, to show they agree:
 *   drms(TDOA-only crlb, per-collector sigmaT) == tdoaDop * c * sigmaT
 * @returns {{dop:number, drmsDop:number, drmsCrlb:number|null}}
 */
export function dopCheck(collectors, e, sigmaT, ref = 0) {
  const dop = planar.tdoaDop(collectors.map((c) => c.p), e);
  const meas = planar.measurementList(collectors.length, { tdoa: true, fdoa: false, ref });
  const P = planar.crlb(meas, collectors, e, 1e9, { sigmaT, sigmaF: 1 });
  return { dop, drmsDop: dop * C * sigmaT, drmsCrlb: P ? Math.sqrt(P[0][0] + P[1][1]) : null };
}

/**
 * Correct (full, correlated R) versus naive (diagonal R) weighting for a measurement set.
 * naive.actual is the true scatter of the naively weighted estimator, K_d R K_d^T;
 * naive.claimed is what the naive estimator believes, (H^T R_d^-1 H)^-1.
 */
export function weightingCompare(meas, collectors, e, f0, noise) {
  const H = planar.jacobian(meas, collectors, e, f0);
  const R = planar.noiseCov(meas, collectors.length, noise);
  const Rd = R.map((row, i) => row.map((v, j) => (i === j ? v : 0)));
  const Pc = estimate.crlb(H, R);
  const Kd = estimate.gain(H, Rd);
  const Pd = estimate.crlb(H, Rd);
  if (!Pc || !Kd || !Pd) return null;
  // actual = Kd R Kd^T
  const m = R.length;
  const KR = Kd.map((row) => Array.from({ length: m }, (_, j) => row.reduce((s, v, k) => s + v * R[k][j], 0)));
  const act = KR.map((row) => Kd.map((r2) => row.reduce((s, v, k) => s + v * r2[k], 0)));
  const tr = (P) => Math.sqrt(P[0][0] + P[1][1]);
  return { correct: tr(Pc), naiveActual: tr(act), naiveClaimed: tr(Pd) };
}

/**
 * Bias explorer: inject per-collector clock / frequency offsets, solve exactly (zero noise), and
 * compare with the first-order prediction K dz.
 * @returns {{fix:number[]|null, converged:boolean, pred:number[]|null, dz:number[], prec:object|null}}
 *          fix / pred are displacements from the truth in metres.
 */
export function biasSolve({ meas, collectors, e, f0, noise, clockBias, freqBias }) {
  const z = planar.simulate({ meas, collectors, e, f0, noise, rng: zeroRng, clockBias, freqBias });
  let fix = null, converged = false;
  try {
    const res = planar.locate({ meas, collectors, z, f0, noise, x0: e.slice(), maxIter: 80 });
    converged = res.converged && isFinite(res.x[0]) && isFinite(res.x[1]);
    if (converged) fix = [res.x[0] - e[0], res.x[1] - e[1]];
  } catch { /* singular: leave fix null */ }
  const K = planar.gainMatrix(meas, collectors, e, f0, noise);
  // dz from the biases through the core's own mapping
  const dz = meas.map(() => 0);
  collectors.forEach((_, i) => {
    const a = planar.collectorErrorToMeas(meas, i, 'clock', clockBias ? clockBias[i] || 0 : 0);
    const b = planar.collectorErrorToMeas(meas, i, 'freq', freqBias ? freqBias[i] || 0 : 0);
    for (let k = 0; k < dz.length; k++) dz[k] += a[k] + b[k];
  });
  const pred = K ? [0, 1].map((r) => K[r].reduce((s, v, k) => s + v * dz[k], 0)) : null;
  return { fix, converged, pred, dz, K };
}

/** Per-collector sensitivity: metres of fix displacement per 1 ns clock and per 1 Hz frequency error. */
export function perCollectorSensitivity(meas, collectors, K) {
  if (!K) return null;
  const apply = (dz) => [0, 1].map((r) => K[r].reduce((s, v, k) => s + v * dz[k], 0));
  return collectors.map((_, i) => ({
    clock: apply(planar.collectorErrorToMeas(meas, i, 'clock', 1e-9)),
    freq: apply(planar.collectorErrorToMeas(meas, i, 'freq', 1)),
  }));
}

/** Compass bearing (deg, 0 = north, clockwise) of a 2-D vector. */
export const bearingDeg = (v) => ((Math.atan2(v[0], v[1]) * 180) / Math.PI + 360) % 360;
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (v) => COMPASS[Math.round(bearingDeg(v) / 22.5) % 16];

// ------------------------------------------------------------------ lever arm (lesson 5, section B)
export const PRESETS = {
  aircraft: { label: 'Aircraft pair', v: 200, rho: 100e3, d: 30e3 },
  leo: { label: 'LEO cluster', v: 7500, rho: 800e3, d: 150e3 },
  leoWide: { label: 'LEO wide pair', v: 7500, rho: 1200e3, d: 1000e3 },
};

/**
 * Two-collector geometry for the lever-arm calculator.
 * 'trail':   A and B on the x axis, both flying +x (along the baseline); emitter broadside at (0, -rho).
 * 'abreast': A and B on the x axis, both flying +y (across the baseline); emitter broadside at (0, -rho),
 *            i.e. straight behind the pair along its track.
 * Measurements: tau_BA and nu_BA.
 */
export function pairGeometry({ rho, d, v, geom = 'trail' }) {
  const vel = geom === 'trail' ? [v, 0] : [0, v];
  const A = { p: [-d / 2, 0], v: vel.slice() };
  const B = { p: [d / 2, 0], v: vel.slice() };
  return { collectors: [A, B], e: [0, -rho] };
}

/**
 * Exact lever arms from the core gradients plus the rules of thumb.
 * @returns {{mPerNs, mPerHz, ruleT, ruleTExact, ruleF, crossDeg, theta, lambda,
 *            dNuPerMps, mPerMpsEmitter, ruleU, gT, gF, collectors, e}}
 */
export function leverArm({ f0, rho, d, v, geom = 'trail' }) {
  const { collectors, e } = pairGeometry({ rho, d, v, geom });
  const [A, B] = collectors;
  const lambda = constants.wavelength(f0);
  const gT = planar.gradTdoa(B, A, e);           // s/m
  const gF = planar.gradFdoa(B, A, e, f0);       // Hz/m
  const nT = Math.hypot(gT[0], gT[1]), nF = Math.hypot(gF[0], gF[1]);
  const mPerNs = nT > 0 ? 1e-9 / nT : Infinity;
  const mPerHz = nF > 0 ? 1 / nF : Infinity;
  const theta = 2 * Math.atan(d / (2 * rho));    // angle the pair subtends at the emitter (broadside)
  const ruleT = (C * 1e-9 * rho) / d;
  const ruleTExact = (C * 1e-9) / (2 * Math.sin(theta / 2));
  const ruleF = (lambda * rho * rho) / (v * d);
  let crossDeg = NaN;
  if (nT > 0 && nF > 0) {
    const c = Math.abs(gT[0] * gF[0] + gT[1] * gF[1]) / (nT * nF);
    crossDeg = (Math.acos(Math.min(1, c)) * 180) / Math.PI; // angle between the gradients = crossing angle of the curves
  }
  // Emitter motion: worst-case direction is along (l_B - l_A); FDOA change from the core's own model.
  const lA = [(A.p[0] - e[0]) / planar.range(A, e), (A.p[1] - e[1]) / planar.range(A, e)];
  const lB = [(B.p[0] - e[0]) / planar.range(B, e), (B.p[1] - e[1]) / planar.range(B, e)];
  const dl = [lB[0] - lA[0], lB[1] - lA[1]], ndl = Math.hypot(dl[0], dl[1]);
  const ve = [dl[0] / ndl, dl[1] / ndl]; // 1 m/s
  const dNuPerMps = planar.fdoa(B, A, e, f0, ve) - planar.fdoa(B, A, e, f0);
  const mPerMpsEmitter = Math.abs(dNuPerMps) * mPerHz;
  const ruleU = rho / v;
  return { mPerNs, mPerHz, ruleT, ruleTExact, ruleF, crossDeg, theta, lambda, dNuPerMps,
    dNuRule: ndl / lambda, mPerMpsEmitter, ruleU, gT, gF, collectors, e };
}

// ------------------------------------------------------------------ DOP map values (lesson 4, section B)
/**
 * Value of the DOP map at emitter position e (m).
 *  'tdoa': dimensionless TDOA DOP (planar.tdoaDop)
 *  'fdoa': metres of position rms per m/s of per-collector range-rate error (seconds),
 *          from planar.crlb with FDOA rows only and sigmaF = 1/lambda (lambda * sigmaF = 1 m/s)
 *  'both': combined TDOA+FDOA DRMS in metres for the given noise
 * Returns NaN where no fix is possible.
 */
export function dopValue(mode, collectors, e, { f0, sigmaT, sigmaF, ref = 0 }) {
  const n = collectors.length;
  if (mode === 'tdoa') {
    const v = planar.tdoaDop(collectors.map((c) => c.p), e);
    return isFinite(v) ? v : NaN;
  }
  const meas = mode === 'fdoa'
    ? planar.measurementList(n, { tdoa: false, fdoa: true, ref })
    : planar.measurementList(n, { tdoa: true, fdoa: true, ref });
  const noise = mode === 'fdoa' ? { sigmaT: 1, sigmaF: f0 / C } : { sigmaT, sigmaF };
  const P = planar.crlb(meas, collectors, e, f0, noise);
  if (!P) return NaN;
  const v = Math.sqrt(P[0][0] + P[1][1]);
  return isFinite(v) ? v : NaN;
}

// ------------------------------------------------------------------ DOM
/** Inject a <style> element; returns a function that removes it. */
export function injectStyle(css) {
  const s = document.createElement('style');
  s.textContent = css;
  document.head.append(s);
  return () => s.remove();
}
