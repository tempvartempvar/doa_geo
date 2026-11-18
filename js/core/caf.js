/**
 * caf.js - cross-ambiguity function (CAF) signal processing for lesson 6.
 * =====================================================================
 * A small, self-contained simulator of how TDOA and FDOA are MEASURED: one emitter waveform s(t) is
 * recorded by two collectors with independent noise; the second copy is delayed by the TDOA tau and
 * frequency-shifted by the FDOA nu. The cross-ambiguity function of the two recordings peaks at
 * (tau, nu). Pure functions, no DOM, SI units (s, Hz). Imported directly by the lesson (deliberately
 * not re-exported from core/index.js).
 *
 * Complex sequences are { re: Float64Array, im: Float64Array } of a power-of-two length N, sampled at
 * fs. Sample m is at time t = m / fs; the record length is T = N / fs. All sequences are treated as
 * PERIODIC with period N (circular model): the signal is generated as an exactly band-limited periodic
 * waveform and delayed by a circular, band-limited (frequency-domain) shift, so there are no edge
 * effects - the price is that a delay wraps around the end of the record, harmless for delays << T.
 *
 * SIGNAL MODEL (receive)
 *     x1[m] = s[m] + n1[m]
 *     x2[m] = a s(m/fs - tau) e^{j(2 pi nu m/fs + phi)} + n2[m]
 *   s: unit average power, flat spectrum of width Bs centred on 0 Hz (makeSignal).
 *   n1, n2: independent circular complex white Gaussian noise over the whole sampled band, so the
 *   receiver noise bandwidth is B = fs and snr_i = (signal power) / (noise power in fs).
 *
 * DISCRETE CAF (what caf() and cafEvaluator() compute)
 *     chi(tau', nu') = (1/N) sum_{m=0}^{N-1} conj( x1(m/fs - tau') ) x2[m] e^{-j 2 pi nu' m/fs}
 *   where x1(t - tau') is x1 delayed by tau' with the band-limited circular shift (exact for any
 *   fractional tau'). This is the continuous chi = int x1*(t) x2(t + tau') e^{-j 2 pi nu' t} dt after
 *   the substitution t -> t - tau', which only changes the phase by e^{j 2 pi nu' tau'}; |chi| is the
 *   same. With the model above |chi| peaks at tau' = tau, nu' = nu, and the noise-free peak is a = 1.
 *   Shifting x1 (which carries no Doppler) instead of x2 keeps the band-limited interpolation exact.
 *
 * NOISE BANDWIDTH. Stein's formula (stein.js) assumes the processed noise has the same band as the
 * signal. If Bs < fs and the CAF is formed from the raw recordings, the noise x noise term of the CAF
 * comes from the whole band fs and (for the delay) is weighted by f^2, so at modest per-sample SNR the
 * delay error exceeds stein.tdoaSigma({ B: fs, ... }). A sensible processor filters to the signal band
 * (bandLimit). Filtering the reference channel x1 alone is enough, and avoids clipping the
 * Doppler-shifted band edge of x2: the CAF only pairs components of x2 with components of x1 (offset
 * by nu'), so the noise x noise term is then confined to Bs. The processed noise bandwidth is B = Bs and the bound to compare
 * with is stein.tdoaSigma({ B: Bs, Bs, T, snr1: snr1 * fs / Bs, snr2: snr2 * fs / Bs }). At high
 * per-sample SNR both agree, because the linear terms depend only on B T gamma = (S/N0) T.
 */
import { makeRng } from './linalg.js';

// ------------------------------------------------------------------ FFT

const fftCache = new Map();
function fftTables(N) {
  let t = fftCache.get(N);
  if (t) return t;
  if (N < 1 || (N & (N - 1)) !== 0) throw new Error(`FFT length ${N} is not a power of two`);
  const rev = new Uint32Array(N);
  let bits = 0;
  while ((1 << bits) < N) bits++;
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
    rev[i] = r;
  }
  const half = Math.max(1, N / 2);
  const cos = new Float64Array(half), sin = new Float64Array(half);
  for (let k = 0; k < N / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / N);
    sin[k] = Math.sin((2 * Math.PI * k) / N);
  }
  t = { rev, cos, sin };
  fftCache.set(N, t);
  return t;
}

/**
 * In-place radix-2 complex FFT. Forward: X[k] = sum_n x[n] e^{-j 2 pi k n / N}.
 * Inverse (inverse = true): x[n] = (1/N) sum_k X[k] e^{+j 2 pi k n / N}.
 * @param {Float64Array} re real parts (length N, a power of two)
 * @param {Float64Array} im imaginary parts
 * @param {boolean} [inverse=false]
 */
export function fft(re, im, inverse = false) {
  const N = re.length;
  if (N <= 1) return;
  const { rev, cos, sin } = fftTables(N);
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const sgn = inverse ? 1 : -1;
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const step = N / size;
    for (let start = 0; start < N; start += size) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const wr = cos[w], wi = sgn * sin[w];
        const a = start + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inverse) {
    const s = 1 / N;
    for (let i = 0; i < N; i++) { re[i] *= s; im[i] *= s; }
  }
}

/** In-place inverse FFT (includes the 1/N factor). @param {Float64Array} re @param {Float64Array} im */
export function ifft(re, im) { fft(re, im, true); }

/** Signed frequency index of DFT bin k: k for k < N/2, k - N otherwise (Nyquist bin counted negative). */
const signedBin = (k, N) => (k < N / 2 ? k : k - N);

/** Copy of a complex sequence. */
const cloneC = (x) => ({ re: Float64Array.from(x.re), im: Float64Array.from(x.im) });

/**
 * Phasor table e^{j (phase0 + 2 pi cyc (m + m0))}, m = 0..n-1, by rotation (re-seeded every 512
 * steps so rounding never accumulates).
 */
function phasors(n, cyc, phase0 = 0, m0 = 0) {
  const c = new Float64Array(n), s = new Float64Array(n);
  const th = 2 * Math.PI * cyc;
  const cs = Math.cos(th), sn = Math.sin(th);
  let pr = 1, pi = 0;
  for (let m = 0; m < n; m++) {
    if ((m & 511) === 0) { const a = phase0 + th * (m + m0); pr = Math.cos(a); pi = Math.sin(a); }
    c[m] = pr; s[m] = pi;
    const t = pr * cs - pi * sn; pi = pr * sn + pi * cs; pr = t;
  }
  return { c, s };
}

/** Multiply X[k] by e^{-j 2 pi k_s d / N} in place (band-limited delay by d samples, spectrum side). */
function applyDelayRamp(X, d) {
  const N = X.re.length;
  const h = N / 2;
  const pos = phasors(h, -d / N, 0, 0);   // k_s = 0 .. N/2-1  at k = 0 .. N/2-1
  const neg = phasors(h, -d / N, 0, -h);  // k_s = -N/2 .. -1  at k = N/2 .. N-1
  for (let k = 0; k < N; k++) {
    const c = k < h ? pos.c[k] : neg.c[k - h];
    const s = k < h ? pos.s[k] : neg.s[k - h];
    const r = X.re[k], i = X.im[k];
    X.re[k] = r * c - i * s;
    X.im[k] = r * s + i * c;
  }
}

/**
 * Band-limited circular delay of a sequence by `d` samples (any real d), via the phase ramp
 * e^{-j 2 pi k_s d / N} on its spectrum. Returns a new sequence.
 * @param {{re:Float64Array, im:Float64Array}} x
 * @param {number} d delay in samples
 */
export function fracDelay(x, d) {
  const y = cloneC(x);
  fft(y.re, y.im);
  applyDelayRamp(y, d);
  ifft(y.re, y.im);
  return y;
}

// ------------------------------------------------------------------ signals

/**
 * The DFT bins occupied by a flat spectrum of (requested) width Bs: |k_s| <= K, i.e. 2K+1 bins.
 * @param {number} N @param {number} fs @param {number} Bs
 * @returns {{K:number, Bs:number}} Bs = actual occupied bandwidth (2K+1) fs / N, Hz
 */
export function bandBins(N, fs, Bs) {
  const nb = Math.min(N - 1, Math.max(1, Math.round((Bs * N) / fs)));
  const K = Math.max(0, Math.floor((nb - 1) / 2));
  return { K, Bs: ((2 * K + 1) * fs) / N };
}

/**
 * Complex baseband noise-like emitter waveform with an exactly rectangular spectrum: the 2K+1 bins
 * |k_s| <= K have unit magnitude and independent uniformly random phase, every other bin is zero.
 * So the rms radian bandwidth is exactly 2 pi (fs/N) sqrt(K(K+1)/3) ~ pi Bs / sqrt(3), and the
 * average power over the record is exactly 1. (Its envelope still fluctuates like noise.)
 * @param {{N:number, fs:number, Bs:number, rng?:{normal:()=>number}}} o
 *   N power of two; fs sample rate, Hz; Bs requested bandwidth, Hz (clamped to [fs/N, fs)).
 * @returns {{re:Float64Array, im:Float64Array, Bs:number, K:number}} Bs = actual occupied
 *   bandwidth (2K+1) fs / N - pass THIS to the Stein bounds.
 */
export function makeSignal({ N, fs, Bs, rng = makeRng(1) }) {
  const { K, Bs: BsAct } = bandBins(N, fs, Bs);
  const re = new Float64Array(N), im = new Float64Array(N);
  const amp = N / Math.sqrt(2 * K + 1);
  for (let ks = -K; ks <= K; ks++) {
    const k = ks < 0 ? ks + N : ks;
    // uniformly distributed phase = direction of a circular Gaussian pair
    let a, b, r;
    do { a = rng.normal(); b = rng.normal(); r = Math.hypot(a, b); } while (r < 1e-12);
    re[k] = (amp * a) / r;
    im[k] = (amp * b) / r;
  }
  ifft(re, im);
  return { re, im, Bs: BsAct, K };
}

/**
 * rms radian bandwidth beta = 2 pi sqrt( sum f^2 |X(f)|^2 / sum |X(f)|^2 ) of a sequence, rad/s,
 * using signed bin frequencies f = k_s fs / N.
 * @param {{re:Float64Array, im:Float64Array}} x
 * @param {number} fs
 */
export function rmsBandwidthOf(x, fs) {
  const N = x.re.length;
  const X = cloneC(x);
  fft(X.re, X.im);
  let num = 0, den = 0;
  for (let k = 0; k < N; k++) {
    const p = X.re[k] * X.re[k] + X.im[k] * X.im[k];
    const f = (signedBin(k, N) * fs) / N;
    num += f * f * p; den += p;
  }
  return 2 * Math.PI * Math.sqrt(num / den);
}

/**
 * Simulate the two collectors' recordings of signal s (see SIGNAL MODEL in the header).
 * The delay is applied exactly (band-limited circular shift), then the Doppler shift and a random
 * carrier phase; then independent complex white Gaussian noise of power 1/snr_i is added to each
 * channel (signal power is 1, noise bandwidth B = fs). snr = Infinity gives a noise-free channel.
 * @param {{s:{re:Float64Array, im:Float64Array}, fs:number, delay:number, doppler:number,
 *   snr1:number, snr2:number, rng?:{uniform:()=>number, normal:()=>number}, amplitude?:number}} o
 *   delay = TDOA tau, s; doppler = FDOA nu, Hz; snr1, snr2 linear power ratios in fs.
 * @returns {{x1:{re:Float64Array, im:Float64Array}, x2:{re:Float64Array, im:Float64Array}}}
 */
export function receive({ s, fs, delay, doppler, snr1, snr2, rng = makeRng(2), amplitude = 1 }) {
  const N = s.re.length;
  const x2 = fracDelay(s, delay * fs);
  const ph = phasors(N, doppler / fs, 2 * Math.PI * rng.uniform());
  for (let m = 0; m < N; m++) {
    const c = amplitude * ph.c[m], sn = amplitude * ph.s[m];
    const r = x2.re[m], i = x2.im[m];
    x2.re[m] = r * c - i * sn;
    x2.im[m] = r * sn + i * c;
  }
  const x1 = cloneC(s);
  addNoise(x1, snr1, rng);
  addNoise(x2, snr2, rng);
  return { x1, x2 };
}

function addNoise(x, snr, rng) {
  if (!(snr < Infinity)) return;
  const sd = Math.sqrt(1 / (2 * snr));
  for (let m = 0; m < x.re.length; m++) {
    x.re[m] += sd * rng.normal();
    x.im[m] += sd * rng.normal();
  }
}

/**
 * Processor-side band filter: keep only the DFT bins of the signal band |k_s| <= K (bandBins(N, fs, Bs)),
 * an ideal filter matched to the flat signal spectrum. Returns a new sequence. After it the processed
 * noise bandwidth is B = Bs (see NOISE BANDWIDTH in the header).
 * @param {{re:Float64Array, im:Float64Array}} x @param {number} fs @param {number} Bs
 */
export function bandLimit(x, fs, Bs) {
  const N = x.re.length;
  const { K } = bandBins(N, fs, Bs);
  const y = cloneC(x);
  fft(y.re, y.im);
  for (let k = 0; k < N; k++) {
    if (Math.abs(signedBin(k, N)) > K) { y.re[k] = 0; y.im[k] = 0; }
  }
  ifft(y.re, y.im);
  return y;
}

// ------------------------------------------------------------------ CAF on a grid

/**
 * The CAF magnitude |chi(tau', nu')| (normalised so a noise-free, perfectly aligned peak is 1) on a
 * grid of integer lags x Doppler bins. For each lag L the product sequence
 * p_L[m] = conj(x1[(m - L) mod N]) x2[m] is FFT'd (zero-padded to N * dopplerOversample), which gives
 * every Doppler bin nu' = dopplerCenter + k fs / (N * dopplerOversample) at once; only
 * |nu' - dopplerCenter| <= dopplerSpan is kept.
 * Speed-up (decimate, default true): because only a narrow Doppler window is wanted, p_L is first
 * mixed down by dopplerCenter and summed in blocks of Q samples (Q a power of two with
 * fs/Q >= 32 dopplerSpan) before a short FFT. This 1/Q-rate integrate-and-dump scales |chi| by at
 * most sinc(1/32) = 0.998 at the window edge and is exact at the centre; decimate:false gives the
 * full-length FFT. estimatePeak() re-evaluates chi exactly in any case.
 * @param {{x1:{re:Float64Array, im:Float64Array}, x2:{re:Float64Array, im:Float64Array}, fs:number,
 *   maxLagSamples:number, dopplerSpan:number, dopplerOversample?:number, lagStep?:number,
 *   lagCenter?:number, dopplerCenter?:number, decimate?:boolean}} o
 *   Lags are round(lagCenter) + i * lagStep for |i * lagStep| <= maxLagSamples (integer samples).
 *   dopplerOversample: zero-padding factor (power of two, default 2: bins every 1/(2T)).
 * @returns {{delays:Float64Array, dopplers:Float64Array, mag:Float32Array, nDelay:number,
 *   nDoppler:number}} delays in s, dopplers in Hz (both ascending); mag is row-major with one ROW
 *   per Doppler: mag[j * nDelay + i] is at (delays[i], dopplers[j]).
 */
export function caf({ x1, x2, fs, maxLagSamples, dopplerSpan, dopplerOversample = 2, lagStep = 1, lagCenter = 0, dopplerCenter = 0, decimate = true }) {
  const N = x1.re.length;
  const step = Math.max(1, Math.round(lagStep));
  const nHalf = Math.floor(maxLagSamples / step);
  const lags = [];
  for (let i = -nHalf; i <= nHalf; i++) lags.push(Math.round(lagCenter) + i * step);
  let Q = 1;
  if (decimate) while (Q * 2 <= N / 16 && fs / (Q * 2) >= 32 * dopplerSpan) Q *= 2;
  const Nd = N / Q;
  const Md = Nd * dopplerOversample;
  const df = fs / (N * dopplerOversample);
  const kMax = Math.max(0, Math.min(Math.floor(dopplerSpan / df), Md / 2 - 1));
  const nDelay = lags.length, nDoppler = 2 * kMax + 1;
  const mag = new Float32Array(nDelay * nDoppler);
  // x2 mixed down by the window centre once
  const mix = phasors(N, -dopplerCenter / fs);
  const yr = new Float64Array(N), yi = new Float64Array(N);
  for (let m = 0; m < N; m++) {
    yr[m] = x2.re[m] * mix.c[m] - x2.im[m] * mix.s[m];
    yi[m] = x2.re[m] * mix.s[m] + x2.im[m] * mix.c[m];
  }
  const re = new Float64Array(Md), im = new Float64Array(Md);
  const ar = x1.re, ai = x1.im;
  for (let i = 0; i < nDelay; i++) {
    const L = lags[i];
    re.fill(0); im.fill(0);
    let q = (((-L) % N) + N) % N;
    for (let b = 0, m = 0; b < Nd; b++) {
      let sr = 0, si = 0;
      for (let e = 0; e < Q; e++, m++) {
        // conj(x1[q]) * y[m]
        sr += ar[q] * yr[m] + ai[q] * yi[m];
        si += ar[q] * yi[m] - ai[q] * yr[m];
        if (++q === N) q = 0;
      }
      re[b] = sr; im[b] = si;
    }
    fft(re, im);
    for (let j = 0; j < nDoppler; j++) {
      const k = j - kMax;
      const kk = k < 0 ? k + Md : k;
      mag[j * nDelay + i] = Math.hypot(re[kk], im[kk]) / N;
    }
  }
  return {
    delays: Float64Array.from(lags, (L) => L / fs),
    dopplers: Float64Array.from({ length: nDoppler }, (_, j) => dopplerCenter + (j - kMax) * df),
    mag, nDelay, nDoppler,
  };
}

// ------------------------------------------------------------------ exact CAF evaluator

/**
 * Exact evaluator of chi(tau', nu') at arbitrary (fractional) delay and Doppler, using
 * chi = (1/N^2) sum_k conj(X1[k]) W[k] e^{+j 2 pi k_s d / N},  W = FFT( x2 e^{-j 2 pi nu' m / fs} ),
 * d = tau' fs. One FFT per distinct Doppler value (cached), then O(nonzero bins of X1) per delay.
 * @param {{x1:{re:Float64Array, im:Float64Array}, x2:{re:Float64Array, im:Float64Array}, fs:number}} o
 * @returns {{ at:(delay:number, doppler:number)=>{re:number, im:number, mag:number},
 *   delayCut:(doppler:number, delays:ArrayLike<number>)=>Float64Array,
 *   dopplerCut:(delay:number, dopplers:ArrayLike<number>)=>Float64Array }}
 *   at(): chi normalised like caf() (noise-free aligned peak = 1). delayCut()/dopplerCut(): |chi|
 *   along one line through the (tau', nu') plane.
 */
export function cafEvaluator({ x1, x2, fs }) {
  const N = x1.re.length;
  const X1 = cloneC(x1);
  fft(X1.re, X1.im);
  // keep only bins where X1 is nonzero (all of them unless x1 was band-limited)
  let maxAbs = 0;
  for (let k = 0; k < N; k++) maxAbs = Math.max(maxAbs, Math.abs(X1.re[k]) + Math.abs(X1.im[k]));
  const tiny = maxAbs * 1e-13;
  const nz = [];
  for (let k = 0; k < N; k++) if (Math.abs(X1.re[k]) + Math.abs(X1.im[k]) > tiny) nz.push(k);
  const bins = Int32Array.from(nz);
  const ks = Float64Array.from(nz, (k) => signedBin(k, N));
  const cache = new Map();
  const tmpRe = new Float64Array(N), tmpIm = new Float64Array(N);

  function crossSpectrum(doppler) {
    let C = cache.get(doppler);
    if (C) return C;
    const ph = phasors(N, -doppler / fs);
    for (let m = 0; m < N; m++) {
      tmpRe[m] = x2.re[m] * ph.c[m] - x2.im[m] * ph.s[m];
      tmpIm[m] = x2.re[m] * ph.s[m] + x2.im[m] * ph.c[m];
    }
    fft(tmpRe, tmpIm);
    C = { re: new Float64Array(bins.length), im: new Float64Array(bins.length) };
    for (let n = 0; n < bins.length; n++) {
      const k = bins[n];
      const xr = X1.re[k], xi = -X1.im[k];
      C.re[n] = xr * tmpRe[k] - xi * tmpIm[k];
      C.im[n] = xr * tmpIm[k] + xi * tmpRe[k];
    }
    if (cache.size > 48) cache.clear();
    cache.set(doppler, C);
    return C;
  }

  function sumAt(C, delay) {
    const th = (2 * Math.PI * delay * fs) / N;
    const cs = Math.cos(th), sn = Math.sin(th);
    let sr = 0, si = 0, pr = 1, pi = 0, run = 0;
    for (let n = 0; n < ks.length; n++) {
      // phasor e^{j th ks[n]} by rotation along runs of consecutive bins, re-seeded otherwise
      if (n === 0 || ks[n] !== ks[n - 1] + 1 || ++run >= 512) {
        run = 0; pr = Math.cos(th * ks[n]); pi = Math.sin(th * ks[n]);
      } else {
        const t = pr * cs - pi * sn; pi = pr * sn + pi * cs; pr = t;
      }
      sr += C.re[n] * pr - C.im[n] * pi;
      si += C.re[n] * pi + C.im[n] * pr;
    }
    const sc = 1 / (N * N);
    return { re: sr * sc, im: si * sc };
  }

  function at(delay, doppler) {
    const r = sumAt(crossSpectrum(doppler), delay);
    return { re: r.re, im: r.im, mag: Math.hypot(r.re, r.im) };
  }

  function delayCut(doppler, delays) {
    const C = crossSpectrum(doppler);
    return Float64Array.from(delays, (d) => { const r = sumAt(C, d); return Math.hypot(r.re, r.im); });
  }

  /** |chi(delay, .)| as a function of Doppler: one IFFT now, O(N) per call. */
  function dopplerLine(delay) {
    const Y = cloneC(X1);
    applyDelayRamp(Y, delay * fs);
    ifft(Y.re, Y.im);
    const pr = new Float64Array(N), pim = new Float64Array(N);
    for (let m = 0; m < N; m++) {
      const yr = Y.re[m], yi = -Y.im[m];
      pr[m] = yr * x2.re[m] - yi * x2.im[m];
      pim[m] = yr * x2.im[m] + yi * x2.re[m];
    }
    return (doppler) => {
      const th = (-2 * Math.PI * doppler) / fs;
      const cs = Math.cos(th), sn = Math.sin(th);
      let sr = 0, si = 0, wr = 1, wi = 0;
      for (let m = 0; m < N; m++) {
        if ((m & 511) === 0) { wr = Math.cos(th * m); wi = Math.sin(th * m); }
        sr += pr[m] * wr - pim[m] * wi;
        si += pr[m] * wi + pim[m] * wr;
        const t = wr * cs - wi * sn; wi = wr * sn + wi * cs; wr = t;
      }
      return Math.hypot(sr, si) / N;
    };
  }

  /** |chi(., doppler)| as a function of delay: one FFT now (cached), O(bins) per call. */
  function delayLine(doppler) {
    const C = crossSpectrum(doppler);
    return (delay) => { const r = sumAt(C, delay); return Math.hypot(r.re, r.im); };
  }

  function dopplerCut(delay, dopplers) {
    const f = dopplerLine(delay);
    return Float64Array.from(dopplers, f);
  }

  return { at, delayCut, dopplerCut, delayLine, dopplerLine };
}

// ------------------------------------------------------------------ peak estimation

/**
 * Locate the CAF peak to sub-cell accuracy.
 * 1. Coarse: the largest cell of a caf() grid.
 * 2. Fine: coordinate ascent on the EXACT |chi| (cafEvaluator, fractional delays in the frequency
 *    domain and direct DFT sums in Doppler): maximise along delay, then along Doppler, `rounds` times,
 *    each by iterated 3-point parabolic interpolation starting from a quarter lobe width (1/(4Bs),
 *    1/(4T)). The two directions are only weakly coupled, so two or three rounds converge to far below
 *    the Stein sigma (see tests/caf.test.mjs).
 * @param {{x1:object, x2:object, fs:number, Bs:number, grid:ReturnType<typeof caf>,
 *   rounds?:number, evaluator?:ReturnType<typeof cafEvaluator>}} o
 * @returns {{delay:number, doppler:number, peak:number, noiseFloor:number,
 *   coarseDelay:number, coarseDoppler:number}}
 *   peak = |chi| at the estimate (normalised); noiseFloor = rms |chi| of the grid cells more than two
 *   lobe widths from the coarse peak (NaN if the grid has none).
 */
export function estimatePeak({ x1, x2, fs, Bs, grid, rounds = 3, evaluator = null }) {
  const N = x1.re.length;
  const T = N / fs;
  const { delays, dopplers, mag, nDelay, nDoppler } = grid;
  let best = -1, bi = 0, bj = 0;
  for (let j = 0; j < nDoppler; j++) {
    for (let i = 0; i < nDelay; i++) {
      const v = mag[j * nDelay + i];
      if (v > best) { best = v; bi = i; bj = j; }
    }
  }
  const coarseDelay = delays[bi], coarseDoppler = dopplers[bj];
  let acc = 0, cnt = 0;
  for (let j = 0; j < nDoppler; j++) {
    const farD = Math.abs(dopplers[j] - coarseDoppler) > 2 / T;
    for (let i = 0; i < nDelay; i++) {
      if (farD || Math.abs(delays[i] - coarseDelay) > 2 / Bs) {
        const v = mag[j * nDelay + i];
        acc += v * v; cnt++;
      }
    }
  }
  const noiseFloor = cnt ? Math.sqrt(acc / cnt) : NaN;
  const ev = evaluator || cafEvaluator({ x1, x2, fs });
  const r = refinePeak(ev, coarseDelay, coarseDoppler, 0.25 / Bs, 0.25 / T, rounds);
  return { ...r, noiseFloor, coarseDelay, coarseDoppler };
}

/**
 * Coordinate ascent: maximise exactly along delay (Doppler fixed), then along Doppler (delay fixed),
 * `rounds` times. Each 1-D maximisation is an iterated 3-point parabola fit with a shrinking step,
 * on exact |chi| values; each round costs one FFT and one IFFT.
 */
function refinePeak(ev, d0, n0, hd, hn, rounds) {
  let d = d0, n = n0;
  for (let r = 0; r < rounds; r++) {
    const iters = r === rounds - 1 ? 7 : 4;
    const dNew = max1D(ev.delayLine(n), d, hd, iters);
    const nNew = max1D(ev.dopplerLine(dNew), n, hn, iters);
    const moved = Math.max(Math.abs(dNew - d) / hd, Math.abs(nNew - n) / hn);
    d = dNew; n = nNew;
    if (r > 0 && moved < 1e-4) break;
  }
  return { delay: d, doppler: n, peak: ev.at(d, n).mag };
}

/** Maximise a smooth 1-D function near x0 (initial step h) by iterated parabolic interpolation. */
function max1D(f, x0, h, iters) {
  let x = x0, f0 = f(x);
  for (let it = 0; it < iters; it++) {
    const fm = f(x - h), fp = f(x + h);
    const curv = fm - 2 * f0 + fp;
    let u;
    if (curv < 0) u = Math.max(-1.5, Math.min(1.5, (0.5 * (fm - fp)) / curv));
    else u = fp > fm ? 1.5 : -1.5;
    let moved = false;
    if (u !== 0) {
      const fn = f(x + u * h);
      if (fn >= f0) { x += u * h; f0 = fn; moved = true; }
    }
    if (Math.abs(u) <= 1 || !moved) h /= 3;
  }
  return x;
}

// ------------------------------------------------------------------ Monte-Carlo

/**
 * Repeat signal generation, reception, (optional) band filtering, CAF search and peak estimation
 * with fresh signal and noise each trial. The coarse search covers only +-searchLobes main-lobe widths
 * around the truth (lags every half lobe, Doppler bins every half lobe), which keeps a trial cheap.
 * An estimate whose error exceeds half a lobe width (0.5/Bs in delay or 0.5/T in Doppler) is flagged
 * as an OUTLIER: the processor locked onto a noise peak or a sidelobe instead of the main lobe.
 * @param {{trials:number, N:number, fs:number, Bs:number, delay:number, doppler:number,
 *   snr1:number, snr2:number, rng?:object, searchLobes?:number, prefilter?:boolean}} o
 *   snr1, snr2: linear, in the sampled band fs (as receive()). prefilter (default true): bandLimit
 *   the reference channel x1 to the signal band before the CAF (compare with stein at B = Bs).
 * @returns {{delayErr:Float64Array, dopplerErr:Float64Array, outlier:Uint8Array, nOutliers:number,
 *   Bs:number, T:number}}  errors = estimate - truth (s, Hz); Bs = actual occupied bandwidth.
 */
export function monteCarlo({ trials, N, fs, Bs, delay, doppler, snr1, snr2, rng = makeRng(7), searchLobes = 4, prefilter = true }) {
  const T = N / fs;
  const delayErr = new Float64Array(trials), dopplerErr = new Float64Array(trials);
  const outlier = new Uint8Array(trials);
  const BsAct = bandBins(N, fs, Bs).Bs;
  let nOutliers = 0;
  for (let t = 0; t < trials; t++) {
    const s = makeSignal({ N, fs, Bs, rng });
    let { x1, x2 } = receive({ s, fs, delay, doppler, snr1, snr2, rng });
    if (prefilter && BsAct < fs * (1 - 1.5 / N)) x1 = bandLimit(x1, fs, Bs);
    const lobeSamples = fs / BsAct;
    const grid = caf({
      x1, x2, fs,
      lagCenter: Math.round(delay * fs), lagStep: Math.max(1, Math.floor(lobeSamples / 2)),
      maxLagSamples: Math.max(2, Math.ceil(searchLobes * lobeSamples)),
      dopplerCenter: doppler, dopplerSpan: searchLobes / T, dopplerOversample: 2,
    });
    const est = estimatePeak({ x1, x2, fs, Bs: BsAct, grid });
    delayErr[t] = est.delay - delay;
    dopplerErr[t] = est.doppler - doppler;
    if (Math.abs(delayErr[t]) > 0.5 / BsAct || Math.abs(dopplerErr[t]) > 0.5 / T) { outlier[t] = 1; nOutliers++; }
  }
  return { delayErr, dopplerErr, outlier, nOutliers, Bs: BsAct, T };
}

/**
 * Summary statistics of Monte-Carlo errors.
 * @param {ArrayLike<number>} err
 * @param {ArrayLike<number>|null} [outlier] 1 marks an outlier (excluded from the *Inlier stats)
 * @returns {{n:number, mean:number, std:number, rms:number, nInlier:number, meanInlier:number,
 *   stdInlier:number}} std = sample standard deviation (n - 1 normalisation).
 */
export function errorStats(err, outlier = null) {
  const st = (keep) => {
    let n = 0, s = 0, s2 = 0;
    for (let i = 0; i < err.length; i++) if (keep(i)) { n++; s += err[i]; s2 += err[i] * err[i]; }
    const mean = n ? s / n : NaN;
    const std = n > 1 ? Math.sqrt(Math.max(0, (s2 - n * mean * mean) / (n - 1))) : NaN;
    return { n, mean, std, rms: n ? Math.sqrt(s2 / n) : NaN };
  };
  const all = st(() => true);
  const inl = st((i) => !(outlier && outlier[i]));
  return { ...all, nInlier: inl.n, meanInlier: inl.mean, stdInlier: inl.std };
}
