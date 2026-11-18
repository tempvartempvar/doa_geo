/**
 * Estimation machinery shared by the flat-world lessons and the orbital simulator.
 * Dimension-agnostic: the unknown x is any real vector, the measurement z = h(x) + noise, noise ~ N(0, R).
 *
 *   Fisher information        J = H^T R^-1 H          (H = dh/dx, the Jacobian)
 *   Cramer-Rao lower bound    P = J^-1                (covariance of the best unbiased estimator)
 *   Estimator gain            K = P H^T R^-1          (a small measurement error dz moves the fix by K dz)
 */
import {
  zeros, transpose, matMul, matVec, inverse, cholesky, solveLower, solveLowerMat, symEig, chiRadius, vnorm,
} from './linalg.js';

/**
 * Whitened Jacobian and residual: with R = L L^T, returns L^-1 H and L^-1 r.
 * Whitening (rather than forming R^-1) keeps mixed-unit problems (seconds, hertz, metres) well conditioned.
 * @returns {{Hw:number[][], rw:number[]|null}|null} null if R is not positive definite
 */
export function whiten(H, R, r = null) {
  const L = cholesky(R);
  if (!L) return null;
  return { Hw: solveLowerMat(L, H), rw: r ? solveLower(L, r) : null, L };
}

/**
 * Fisher information matrix J = H^T R^-1 H.
 * @param {number[][]} H m x n Jacobian
 * @param {number[][]} R m x m measurement covariance
 */
export function fisher(H, R) {
  const w = whiten(H, R);
  if (!w) return null;
  return matMul(transpose(w.Hw), w.Hw);
}

/**
 * Solve the information equations robustly. The normal matrix A = H^T R^-1 H is rescaled to unit
 * diagonal before the rank test and inversion, so mixed-strength problems (a millimetre-tight altitude
 * constraint next to a kilometre-loose cross-range direction) do not lose precision.
 * @returns {{P:number[][], K:number[][], J:number[][]}|null} covariance P = A^-1, gain K = P H^T R^-1,
 *          information J = A; null if the unknowns are not all observable.
 */
export function information(H, R) {
  if (!H.length) return null;
  const w = whiten(H, R);
  if (!w) return null;
  const Ht = transpose(w.Hw);
  const A = matMul(Ht, w.Hw);
  const n = A.length;
  const d = A.map((row, i) => Math.sqrt(row[i]));
  if (d.some((v) => !(v > 0) || !isFinite(v))) return null;
  const As = A.map((row, i) => row.map((v, j) => v / (d[i] * d[j])));
  const ev = symEig(As).values;
  if (!(ev[n - 1] > 1e-11 * ev[0])) return null;
  const Pi = inverse(As);
  if (!Pi) return null;
  const P = Pi.map((row, i) => row.map((v, j) => v / (d[i] * d[j])));
  // K = P Hw^T L^-1 : column k = P Hw^T (L^-1 e_k)
  const m = H.length, PHt = matMul(P, Ht), K = zeros(n, m);
  for (let k = 0; k < m; k++) {
    const e = new Array(m).fill(0); e[k] = 1;
    const col = matVec(PHt, solveLower(w.L, e));
    for (let i = 0; i < n; i++) K[i][k] = col[i];
  }
  return { P, K, J: A };
}

/**
 * Cramer-Rao bound P = (H^T R^-1 H)^-1.
 * @returns {number[][]|null} null when the geometry is unobservable (information matrix singular).
 */
export function crlb(H, R) { const r = information(H, R); return r ? r.P : null; }

/**
 * Weighted-least-squares gain K = (H^T R^-1 H)^-1 H^T R^-1 (n x m).
 * Column k of K is the displacement of the position fix per unit error in measurement k:
 * this is the exact answer to "what does 1 ns / 1 Hz on this measurement cost me?" (to first order).
 */
export function gain(H, R) { const r = information(H, R); return r ? r.K : null; }

/**
 * Covariance of differenced measurements. Each collector i makes an independent raw measurement q_i with
 * variance var[i] (a time of arrival, or a received frequency). Measurement k is q_{i_k} - q_{j_k}.
 * Then R[k][l] = sum over collectors of the signed incidence products - i.e. two TDOAs that share the
 * reference collector are correlated through the reference's noise.
 * @param {{i:number,j:number}[]} pairs
 * @param {number[]} varPerCollector
 */
export function differencingCov(pairs, varPerCollector) {
  const m = pairs.length, R = zeros(m, m);
  for (let k = 0; k < m; k++) {
    for (let l = 0; l < m; l++) {
      let s = 0;
      const a = pairs[k], b = pairs[l];
      if (a.i === b.i) s += varPerCollector[a.i];
      if (a.j === b.j) s += varPerCollector[a.j];
      if (a.i === b.j) s -= varPerCollector[a.i];
      if (a.j === b.i) s -= varPerCollector[a.j];
      R[k][l] = s;
    }
  }
  return R;
}

/** Central-difference Jacobian of h at x. `steps` is a scalar or per-component array. */
export function numericJacobian(h, x, steps) {
  const n = x.length;
  let H = null;
  for (let j = 0; j < n; j++) {
    const s = Array.isArray(steps) ? steps[j] : steps;
    const xp = x.slice(), xm = x.slice();
    xp[j] += s; xm[j] -= s;
    const hp = h(xp), hm = h(xm);
    if (!H) H = zeros(hp.length, n);
    for (let i = 0; i < hp.length; i++) H[i][j] = (hp[i] - hm[i]) / (2 * s);
  }
  return H;
}

/**
 * Iterative weighted least squares (Gauss-Newton with Levenberg-Marquardt damping).
 * Minimises (z - h(x))^T R^-1 (z - h(x)).
 *
 * @param {object} o
 * @param {(x:number[])=>number[]} o.h      measurement model
 * @param {number[]} o.z                    measured values
 * @param {number[][]} o.R                  measurement covariance
 * @param {number[]} o.x0                   starting guess
 * @param {(x:number[])=>number[][]} [o.jac] Jacobian; defaults to central differences with o.step
 * @param {number|number[]} [o.step=1]      finite-difference step (units of x)
 * @param {number} [o.maxIter=60]
 * @param {number} [o.tol=1e-6]             stop when the update is shorter than this (units of x)
 * @param {number} [o.lambda0=1e-3]         initial LM damping; 0 gives plain Gauss-Newton
 * @returns {{x:number[], cost:number, iterations:number, converged:boolean,
 *            path:{x:number[],cost:number}[], P:number[][]|null, H:number[][]}}
 *          `path` lists every accepted iterate (useful for animating convergence); P is the CRLB evaluated
 *          at the solution; cost is the weighted sum of squared residuals (chi-square if R is right).
 */
export function gaussNewton({ h, z, R, x0, jac, step = 1, maxIter = 60, tol = 1e-6, lambda0 = 1e-3 }) {
  const L = cholesky(R);
  if (!L) throw new Error('gaussNewton: measurement covariance is not positive definite');
  const J = jac || ((x) => numericJacobian(h, x, step));
  const resid = (x) => { const hx = h(x); return solveLower(L, z.map((v, i) => v - hx[i])); };
  const sumsq = (r) => { let s = 0; for (const v of r) s += v * v; return s; };

  let x = x0.slice();
  let r = resid(x);
  let cost = sumsq(r);
  let lambda = lambda0;
  const path = [{ x: x.slice(), cost }];
  let converged = false, it = 0, H = null;

  for (it = 0; it < maxIter; it++) {
    H = J(x);
    const Hw = solveLowerMat(L, H);
    const Ht = transpose(Hw);
    const A = matMul(Ht, Hw);
    const g = matVec(Ht, r);
    let accepted = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      // Damped normal equations, rescaled to unit diagonal (Jacobi preconditioning) before inversion.
      const dsc = A.map((row, i) => Math.sqrt(row[i] * (1 + lambda)) || 1);
      const Ad = A.map((row, i) => row.map((v, j) => (i === j ? 1 : v / (dsc[i] * dsc[j]))));
      const Ainv = inverse(Ad);
      if (!Ainv) { lambda = Math.max(lambda * 10, 1e-6); continue; }
      const dx = matVec(Ainv, g.map((v, i) => v / dsc[i])).map((v, i) => v / dsc[i]);
      const xn = x.map((v, i) => v + dx[i]);
      const rn = resid(xn);
      const cn = sumsq(rn);
      if (isFinite(cn) && cn <= cost * (1 + 1e-12)) {
        x = xn; r = rn;
        const improved = cost - cn;
        cost = cn;
        lambda = Math.max(lambda / 4, 1e-14);
        path.push({ x: x.slice(), cost });
        accepted = true;
        // Converged when the step is negligible, or the cost has stopped changing to rounding level.
        if (vnorm(dx) < tol || improved <= 1e-13 * cost) converged = true;
        break;
      }
      lambda = Math.max(lambda * 6, 1e-6);
    }
    // No damped step lowers the cost any further: we are sitting on a (local) minimum.
    if (!accepted) { converged = true; break; }
    if (converged) break;
  }
  H = J(x);
  const P = crlb(H, R);
  return { x, cost, iterations: it + 1, converged, path, P, H };
}

/**
 * Confidence ellipse of a 2 x 2 covariance.
 * @param {number[][]} P 2 x 2 covariance
 * @param {number} [prob=0.95] containment probability
 * @returns {{semiMajor:number, semiMinor:number, angle:number, sigmaMajor:number, sigmaMinor:number, k:number}}
 *          angle = direction of the major axis, radians counter-clockwise from the +x axis.
 */
export function errorEllipse(P, prob = 0.95) {
  const a = P[0][0], b = P[0][1], d = P[1][1];
  const mean = 0.5 * (a + d), diff = 0.5 * (a - d);
  const rad = Math.sqrt(diff * diff + b * b);
  const l1 = mean + rad, l2 = Math.max(mean - rad, 0);
  const angle = 0.5 * Math.atan2(2 * b, a - d);
  const k = chiRadius(prob, 2);
  const s1 = Math.sqrt(l1), s2 = Math.sqrt(l2);
  return { semiMajor: k * s1, semiMinor: k * s2, angle, sigmaMajor: s1, sigmaMinor: s2, k };
}

/**
 * Confidence ellipsoid of a 3 x 3 covariance.
 * @returns {{axes:number[][], sigmas:number[], k:number, semiAxes:number[][]}} axes[k] = unit eigenvector,
 *          sigmas descending, semiAxes[k] = k * sigma_k * axes[k] (the three semi-axis vectors).
 */
export function errorEllipsoid(P, prob = 0.95) {
  const { values, vectors } = symEig(P);
  const k = chiRadius(prob, 3);
  const sigmas = values.map((v) => Math.sqrt(Math.max(v, 0)));
  return { axes: vectors, sigmas, k, semiAxes: vectors.map((v, i) => v.map((c) => c * k * sigmas[i])) };
}

/**
 * Circular error probable: radius of the circle centred on the truth that contains the estimate with
 * probability p, for a zero-mean bivariate Gaussian with covariance P (exact, by quadrature + bisection).
 */
export function cep(P, p = 0.5) {
  const e = errorEllipse(P, 0.5);
  const sx = e.sigmaMajor, sy = e.sigmaMinor;
  if (!(sx > 0)) return 0;
  const N = 720;
  const prob = (Rr) => {
    let s = 0;
    for (let i = 0; i < N; i++) {
      const phi = (i + 0.5) * 2 * Math.PI / N, c = Math.cos(phi), sn = Math.sin(phi);
      s += 1 - Math.exp(-Rr * Rr / (2 * (sx * sx * c * c + sy * sy * sn * sn)));
    }
    return s / N;
  };
  let lo = 0, hi = 6 * sx;
  for (let i = 0; i < 60; i++) { const mid = 0.5 * (lo + hi); if (prob(mid) < p) lo = mid; else hi = mid; }
  return 0.5 * (lo + hi);
}

/** Root-sum-square position error: sqrt(trace(P)) (DRMS in 2-D, MRSE in 3-D). */
export function rss(P) { let s = 0; for (let i = 0; i < P.length; i++) s += P[i][i]; return Math.sqrt(s); }

/** Sample mean and covariance of a list of vectors. */
export function sampleStats(samples) {
  const n = samples.length, d = samples[0].length;
  const mean = new Array(d).fill(0);
  for (const s of samples) for (let i = 0; i < d; i++) mean[i] += s[i] / n;
  const cov = zeros(d, d);
  for (const s of samples) for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) cov[i][j] += (s[i] - mean[i]) * (s[j] - mean[j]) / (n - 1);
  return { mean, cov, n };
}
