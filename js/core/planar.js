/**
 * Flat-world (2-D) TDOA / FDOA model used by the introductory lessons.
 *
 * Deliberately idealised: a Euclidean plane, signals travel in straight lines at c with no medium,
 * collectors move in straight lines, Doppler is first order in v/c. The orbital model in measure.js
 * removes every one of those simplifications.
 *
 * Units: metres, seconds, hertz. Lessons usually display km, ns/us and Hz.
 *
 * Conventions (identical everywhere in the app)
 *   collector      { p:[x,y], v:[vx,vy] }           position (m) and velocity (m/s)
 *   emitter        e = [x,y], optional velocity ve
 *   range          rho_i  = |p_i - e|
 *   range rate     rhoDot_i = (v_i - v_e) . (p_i - e)/rho_i          (positive = opening)
 *   TDOA           tau_ij = t_i - t_j = (rho_i - rho_j)/c            (s)
 *   Doppler        f_i - f0 = -(f0/c) rhoDot_i                       (closing -> positive)
 *   FDOA           nu_ij  = f_i - f_j = -(f0/c)(rhoDot_i - rhoDot_j) (Hz)
 *
 * A "measurement list" is an array of { type:'tdoa'|'fdoa', i, j } (indices into the collector array).
 */
import { C } from './constants.js';
import { vsub, vnorm, vdot, zeros, makeRng, cholesky, matVec } from './linalg.js';
import { differencingCov, crlb as crlbHR, gain as gainHR, gaussNewton, errorEllipse, cep } from './estimate.js';

export { C };

/** Range from emitter e to collector c, m. */
export function range(c, e) { return Math.hypot(c.p[0] - e[0], c.p[1] - e[1]); }

/** Range rate (m/s), positive when the collector-emitter distance is growing. */
export function rangeRate(c, e, ve = null) {
  const dx = c.p[0] - e[0], dy = c.p[1] - e[1], rho = Math.hypot(dx, dy);
  const vx = c.v[0] - (ve ? ve[0] : 0), vy = c.v[1] - (ve ? ve[1] : 0);
  return (vx * dx + vy * dy) / rho;
}

/** TDOA tau_ij = (rho_i - rho_j)/c in seconds. */
export function tdoa(ci, cj, e) { return (range(ci, e) - range(cj, e)) / C; }

/** Doppler shift seen by collector c, Hz. */
export function doppler(c, e, f0, ve = null) { return -(f0 / C) * rangeRate(c, e, ve); }

/** FDOA nu_ij = f_i - f_j in Hz. */
export function fdoa(ci, cj, e, f0, ve = null) { return doppler(ci, e, f0, ve) - doppler(cj, e, f0, ve); }

/**
 * Gradient of TDOA with respect to emitter position, s/m:  (l_j - l_i)/c, where l_i is the unit vector
 * from the emitter to collector i. Its length is (2/c) sin(half the angle the pair subtends at the emitter).
 */
export function gradTdoa(ci, cj, e) {
  const ri = range(ci, e), rj = range(cj, e);
  return [
    ((cj.p[0] - e[0]) / rj - (ci.p[0] - e[0]) / ri) / C,
    ((cj.p[1] - e[1]) / rj - (ci.p[1] - e[1]) / ri) / C,
  ];
}

/** Component of collector velocity perpendicular to the line of sight, divided by range (1/s vector). */
function vPerpOverRange(c, e, ve) {
  const dx = c.p[0] - e[0], dy = c.p[1] - e[1], rho = Math.hypot(dx, dy);
  const lx = dx / rho, ly = dy / rho;
  const vx = c.v[0] - (ve ? ve[0] : 0), vy = c.v[1] - (ve ? ve[1] : 0);
  const vl = vx * lx + vy * ly;
  return [(vx - vl * lx) / rho, (vy - vl * ly) / rho];
}

/**
 * Gradient of FDOA with respect to emitter position, Hz/m:
 *   (f0/c) ( vperp_i/rho_i - vperp_j/rho_j ),   vperp = velocity component across the line of sight.
 * Each term is (1/lambda) x (angular rate of the line of sight); FDOA responds to the DIFFERENCE of the
 * two collectors' line-of-sight rotation rates.
 */
export function gradFdoa(ci, cj, e, f0, ve = null) {
  const a = vPerpOverRange(ci, e, ve), b = vPerpOverRange(cj, e, ve);
  return [(f0 / C) * (a[0] - b[0]), (f0 / C) * (a[1] - b[1])];
}

/**
 * Build the standard measurement list for n collectors against a reference collector:
 * n-1 TDOAs and/or n-1 FDOAs, each "collector i minus reference".
 * @param {number} n number of collectors
 * @param {{tdoa?:boolean, fdoa?:boolean, ref?:number}} [o]
 */
export function measurementList(n, { tdoa: useT = true, fdoa: useF = true, ref = 0 } = {}) {
  const list = [];
  if (useT) for (let i = 0; i < n; i++) if (i !== ref) list.push({ type: 'tdoa', i, j: ref });
  if (useF) for (let i = 0; i < n; i++) if (i !== ref) list.push({ type: 'fdoa', i, j: ref });
  return list;
}

/** Noise-free measurement vector (s for TDOA rows, Hz for FDOA rows). */
export function predict(meas, collectors, e, f0, ve = null) {
  return meas.map((m) => (m.type === 'tdoa'
    ? tdoa(collectors[m.i], collectors[m.j], e)
    : fdoa(collectors[m.i], collectors[m.j], e, f0, ve)));
}

/** Analytic Jacobian d(measurement)/d(emitter x,y): one row per measurement. */
export function jacobian(meas, collectors, e, f0) {
  return meas.map((m) => (m.type === 'tdoa'
    ? gradTdoa(collectors[m.i], collectors[m.j], e)
    : gradFdoa(collectors[m.i], collectors[m.j], e, f0)));
}

/**
 * Measurement covariance R for a measurement list.
 * Noise is specified PER COLLECTOR - each collector's time-of-arrival jitter sigmaT (s) and
 * frequency-of-arrival jitter sigmaF (Hz) - and propagated through the differencing, so a TDOA has
 * variance sigmaT_i^2 + sigmaT_j^2 and measurements sharing a collector are correlated.
 * @param {{sigmaT:number|number[], sigmaF:number|number[]}} noise scalar = same for every collector
 */
export function noiseCov(meas, n, noise) {
  // Floors keep R positive definite if a slider is dragged to zero (1e-15 s, 1e-9 Hz).
  const per = (s, floor) => Array.from({ length: n }, (_, i) => { const v = Array.isArray(s) ? s[i] : s; return Math.max(v * v, floor); });
  const vT = per(noise.sigmaT ?? 0, 1e-30), vF = per(noise.sigmaF ?? 0, 1e-18);
  const m = meas.length, R = zeros(m, m);
  const tIdx = [], fIdx = [];
  meas.forEach((q, k) => (q.type === 'tdoa' ? tIdx : fIdx).push(k));
  const fill = (idx, v) => {
    const sub = differencingCov(idx.map((k) => meas[k]), v);
    idx.forEach((ka, a) => idx.forEach((kb, b) => { R[ka][kb] = sub[a][b]; }));
  };
  fill(tIdx, vT); fill(fIdx, vF);
  return R;
}

/**
 * Cramer-Rao bound on emitter position: the 2 x 2 covariance (m^2) of the best unbiased estimator.
 * @returns {number[][]|null} null if the measurement set cannot fix the position (singular geometry)
 */
export function crlb(meas, collectors, e, f0, noise) {
  const H = jacobian(meas, collectors, e, f0);
  if (H.length < 2) return null;
  const P = crlbHR(H, noiseCov(meas, collectors.length, noise));
  if (!P || !isFinite(P[0][0]) || !isFinite(P[1][1]) || P[0][0] < 0 || P[1][1] < 0) return null;
  return P;
}

/**
 * Estimator gain K (2 x m): column k is the displacement of the fix (m) per unit error in measurement k
 * (per second for TDOA rows, per hertz for FDOA rows).
 */
export function gainMatrix(meas, collectors, e, f0, noise) {
  return gainHR(jacobian(meas, collectors, e, f0), noiseCov(meas, collectors.length, noise));
}

/**
 * Measurement-vector change caused by an error at ONE collector: a clock offset (s) shifts every TDOA
 * that involves it, a frequency-reference offset (Hz) shifts every FDOA that involves it.
 * @param {'clock'|'freq'} kind
 * @returns {number[]} delta-z, same length as meas
 */
export function collectorErrorToMeas(meas, collectorIndex, kind, value) {
  const type = kind === 'clock' ? 'tdoa' : 'fdoa';
  return meas.map((m) => (m.type !== type ? 0 : (m.i === collectorIndex ? value : 0) - (m.j === collectorIndex ? value : 0)));
}

/**
 * Simulate one set of noisy measurements. Per-collector Gaussian errors are drawn and differenced
 * (so correlations are physically right). Optional deterministic per-collector biases can be added.
 * @param {object} o
 * @param {object[]} o.meas
 * @param {object[]} o.collectors
 * @param {number[]} o.e            true emitter position
 * @param {number} o.f0
 * @param {{sigmaT:number|number[], sigmaF:number|number[]}} o.noise
 * @param {{normal:()=>number}} o.rng  from makeRng(seed)
 * @param {number[]} [o.ve]         true emitter velocity (the solver assumes a stationary emitter)
 * @param {number[]} [o.clockBias]  per-collector clock error, s
 * @param {number[]} [o.freqBias]   per-collector frequency-reference error, Hz
 */
export function simulate({ meas, collectors, e, f0, noise, rng, ve = null, clockBias = null, freqBias = null }) {
  const n = collectors.length;
  const sig = (s, i) => (Array.isArray(s) ? s[i] : (s ?? 0));
  const dT = collectors.map((_, i) => sig(noise.sigmaT, i) * rng.normal() + (clockBias ? clockBias[i] || 0 : 0));
  const dF = collectors.map((_, i) => sig(noise.sigmaF, i) * rng.normal() + (freqBias ? freqBias[i] || 0 : 0));
  const z0 = predict(meas, collectors, e, f0, ve);
  return meas.map((m, k) => z0[k] + (m.type === 'tdoa' ? dT[m.i] - dT[m.j] : dF[m.i] - dF[m.j]));
}

/**
 * Locate the emitter from measurements by iterative weighted least squares.
 * @returns the gaussNewton result: { x:[x,y], cost, iterations, converged, path:[{x,cost}], P }
 */
export function locate({ meas, collectors, z, f0, noise, x0, maxIter = 60 }) {
  const R = noiseCov(meas, collectors.length, noise);
  return gaussNewton({
    h: (x) => predict(meas, collectors, x, f0),
    jac: (x) => jacobian(meas, collectors, x, f0),
    z, R, x0, maxIter, tol: 1e-4,
  });
}

/** Weighted sum of squared residuals at a trial position (the surface the solver walks down). */
export function cost(meas, collectors, z, f0, noise, x) {
  const R = noiseCov(meas, collectors.length, noise);
  const L = cholesky(R);
  const hx = predict(meas, collectors, x, f0);
  const r = z.map((v, i) => v - hx[i]);
  // solve L y = r
  let s = 0; const y = [];
  for (let i = 0; i < r.length; i++) { let t = r[i]; for (let k = 0; k < i; k++) t -= L[i][k] * y[k]; y[i] = t / L[i][i]; s += y[i] * y[i]; }
  return s;
}

/**
 * Classical TDOA dilution of precision at emitter position e (dimensionless):
 *     sigma_position(rms) = DOP x c x sigmaT
 * where sigmaT is the per-collector time-of-arrival error. Computed from the time-of-arrival form with an
 * unknown emission time (rows [-l_i, 1]), which is identical to TDOA with correctly correlated noise and
 * does not depend on which collector is the reference.
 * @param {number[][]} positions collector positions
 * @returns {number} DOP, or Infinity if the geometry is degenerate
 */
export function tdoaDop(positions, e) {
  const d = e.length;
  const H = positions.map((p) => { const r = vsub(p, e), n = vnorm(r); return [...r.map((c) => -c / n), 1]; });
  const R = H.map((_, i) => H.map((__, j) => (i === j ? 1 : 0)));
  const P = crlbHR(H, R);
  if (!P) return Infinity;
  let s = 0; for (let i = 0; i < d; i++) s += P[i][i];
  return s > 0 && isFinite(s) ? Math.sqrt(s) : Infinity;
}

/**
 * Everything a lesson needs about precision at one emitter position, in one call.
 * @returns {{P:number[][], ellipse:object, drms:number, cep50:number, H:number[][], K:number[][]}|null}
 *          ellipse = 95 % error ellipse {semiMajor, semiMinor, angle, sigmaMajor, sigmaMinor};
 *          drms = sqrt(sigma_x^2 + sigma_y^2); cep50 = 50 % circular error radius.
 */
export function precision(meas, collectors, e, f0, noise, prob = 0.95) {
  const P = crlb(meas, collectors, e, f0, noise);
  if (!P) return null;
  return {
    P,
    ellipse: errorEllipse(P, prob),
    drms: Math.sqrt(P[0][0] + P[1][1]),
    cep50: cep(P, 0.5),
    H: jacobian(meas, collectors, e, f0),
    K: gainMatrix(meas, collectors, e, f0, noise),
  };
}

/**
 * Monte-Carlo cloud of position fixes.
 * @returns {{points:number[][], failures:number}} points = estimated [x,y] for each successful trial
 */
export function monteCarlo({ meas, collectors, e, f0, noise, trials = 500, seed = 1, ve = null, clockBias = null, freqBias = null, x0 = null }) {
  const rng = makeRng(seed);
  const points = []; let failures = 0;
  for (let t = 0; t < trials; t++) {
    const z = simulate({ meas, collectors, e, f0, noise, rng, ve, clockBias, freqBias });
    const res = locate({ meas, collectors, z, f0, noise, x0: x0 || e, maxIter: 25 });
    if (res.converged && isFinite(res.x[0]) && isFinite(res.x[1])) points.push(res.x); else failures++;
  }
  return { points, failures };
}

export { matVec };
