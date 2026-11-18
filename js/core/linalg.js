/**
 * Small dense linear algebra + random numbers. Vectors are plain arrays, matrices are arrays of rows.
 * Everything here is dimension-agnostic unless the name ends in "3".
 */

// ---------- vectors (any length) ----------
export function vadd(a, b) { const o = new Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] + b[i]; return o; }
export function vsub(a, b) { const o = new Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] - b[i]; return o; }
export function vscale(a, s) { const o = new Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * s; return o; }
export function vdot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
export function vnorm(a) { return Math.sqrt(vdot(a, a)); }
export function vunit(a) { const n = vnorm(a); return vscale(a, 1 / n); }
export function vdist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }
/** a + s*b */
export function vaxpy(a, s, b) { const o = new Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] + s * b[i]; return o; }

// ---------- 3-vectors ----------
export function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// ---------- matrices ----------
export function zeros(n, m) { const A = new Array(n); for (let i = 0; i < n; i++) A[i] = new Array(m).fill(0); return A; }
export function identity(n) { const A = zeros(n, n); for (let i = 0; i < n; i++) A[i][i] = 1; return A; }
export function diag(d) { const A = zeros(d.length, d.length); for (let i = 0; i < d.length; i++) A[i][i] = d[i]; return A; }
export function transpose(A) {
  const n = A.length, m = n ? A[0].length : 0, T = zeros(m, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) T[j][i] = A[i][j];
  return T;
}
export function matMul(A, B) {
  const n = A.length, m = B[0].length, k = B.length, O = zeros(n, m);
  for (let i = 0; i < n; i++) {
    const Ai = A[i], Oi = O[i];
    for (let l = 0; l < k; l++) { const a = Ai[l]; if (a === 0) continue; const Bl = B[l]; for (let j = 0; j < m; j++) Oi[j] += a * Bl[j]; }
  }
  return O;
}
export function matVec(A, x) { const o = new Array(A.length); for (let i = 0; i < A.length; i++) o[i] = vdot(A[i], x); return o; }
export function matAdd(A, B) { return A.map((r, i) => r.map((v, j) => v + B[i][j])); }
export function matScale(A, s) { return A.map((r) => r.map((v) => v * s)); }
export function trace(A) { let s = 0; for (let i = 0; i < A.length; i++) s += A[i][i]; return s; }
/** Sub-matrix with the given row and column index lists. */
export function submatrix(A, rows, cols) { return rows.map((i) => cols.map((j) => A[i][j])); }

/**
 * Inverse by Gauss-Jordan elimination with partial pivoting.
 * @returns {number[][]|null} null if the matrix is singular to working precision.
 */
export function inverse(A) {
  const n = A.length;
  const M = A.map((r, i) => { const row = r.slice(); for (let j = 0; j < n; j++) row.push(i === j ? 1 : 0); return row; });
  for (let c = 0; c < n; c++) {
    let p = c, best = Math.abs(M[c][c]);
    for (let r = c + 1; r < n; r++) { const v = Math.abs(M[r][c]); if (v > best) { best = v; p = r; } }
    // Scale-aware singularity test: compare the pivot to the largest entry of its original row.
    let rowScale = 0; for (let j = 0; j < n; j++) rowScale = Math.max(rowScale, Math.abs(A[p][j]));
    if (!(best > 1e-13 * rowScale) || !isFinite(best)) return null;
    if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
    const piv = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c]; if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r) => r.slice(n));
}

/**
 * Cholesky factor of a symmetric positive-definite matrix: A = L L^T, L lower-triangular.
 * @returns {number[][]|null} null if A is not positive definite.
 */
export function cholesky(A) {
  const n = A.length, L = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (!(s > 0)) return null; L[i][i] = Math.sqrt(s); }
      else L[i][j] = s / L[j][j];
    }
  }
  return L;
}
/** Solve L y = b for lower-triangular L. */
export function solveLower(L, b) {
  const n = L.length, y = new Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
  return y;
}
/** Apply L^{-1} to every column of M (i.e. return L^{-1} M). */
export function solveLowerMat(L, M) {
  const cols = transpose(M).map((col) => solveLower(L, col));
  return transpose(cols);
}

/**
 * Eigen-decomposition of a real symmetric matrix by cyclic Jacobi rotations.
 * @returns {{values:number[], vectors:number[][]}} eigenvalues sorted descending; vectors[k] is the unit
 *          eigenvector belonging to values[k].
 */
export function symEig(A) {
  const n = A.length;
  const a = A.map((r) => r.slice());
  const V = identity(n);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0, dg = 0;
    for (let i = 0; i < n; i++) { dg += a[i][i] * a[i][i]; for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j]; }
    if (off <= 1e-30 * dg || off === 0) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (a[p][q] === 0) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
      }
    }
  }
  const order = [...Array(n).keys()].sort((i, j) => a[j][j] - a[i][i]);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => V.map((row) => row[i])) };
}

// ---------- special functions ----------
/** Error function, |error| < 1.2e-7 (Numerical Recipes erfc Chebyshev fit). */
export function erf(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? 1 - r : r - 1;
}

/**
 * Radius multiplier k such that a zero-mean Gaussian with identity covariance in `dof` dimensions lies
 * inside the ball of radius k with probability `prob` (the square root of the chi-square quantile).
 * dof = 1, 2 or 3.
 */
export function chiRadius(prob, dof) {
  if (dof === 2) return Math.sqrt(-2 * Math.log(1 - prob));
  const cdf = dof === 1
    ? (k) => erf(k / Math.SQRT2)
    : (k) => erf(k / Math.SQRT2) - Math.sqrt(2 / Math.PI) * k * Math.exp(-k * k / 2);
  let lo = 0, hi = 10;
  for (let i = 0; i < 80; i++) { const mid = 0.5 * (lo + hi); if (cdf(mid) < prob) lo = mid; else hi = mid; }
  return 0.5 * (lo + hi);
}

// ---------- random numbers ----------
/**
 * Seeded pseudo-random generator (mulberry32) with a Gaussian sampler.
 * @param {number} seed integer
 * @returns {{uniform:()=>number, normal:()=>number, normalVec:(n:number)=>number[]}}
 */
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  const uniform = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const normal = () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u, v, r;
    do { u = 2 * uniform() - 1; v = 2 * uniform() - 1; r = u * u + v * v; } while (r >= 1 || r === 0);
    const f = Math.sqrt(-2 * Math.log(r) / r);
    spare = v * f;
    return u * f;
  };
  return { uniform, normal, normalVec: (n) => Array.from({ length: n }, normal) };
}
