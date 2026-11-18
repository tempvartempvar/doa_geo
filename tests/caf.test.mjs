// Tests for the CAF signal-processing module (lesson 6). Run with:  node --test tests/caf.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as caf from '../js/core/caf.js';
import { stein, linalg } from '../js/core/index.js';

const rel = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg || ''} expected ${b}, got ${a} (rel tol ${tol})`);

test('fft / ifft agree with a direct DFT and invert exactly', () => {
  const rng = linalg.makeRng(1);
  for (const N of [1, 2, 8, 64, 256]) {
    const re = Float64Array.from({ length: N }, rng.normal), im = Float64Array.from({ length: N }, rng.normal);
    const Xr = Float64Array.from(re), Xi = Float64Array.from(im);
    caf.fft(Xr, Xi);
    let err = 0;
    for (let k = 0; k < N; k++) {
      let sr = 0, si = 0;
      for (let n = 0; n < N; n++) {
        const a = (-2 * Math.PI * k * n) / N;
        sr += re[n] * Math.cos(a) - im[n] * Math.sin(a);
        si += re[n] * Math.sin(a) + im[n] * Math.cos(a);
      }
      err = Math.max(err, Math.abs(sr - Xr[k]), Math.abs(si - Xi[k]));
    }
    assert.ok(err < 1e-9 * Math.max(1, N), `DFT mismatch ${err} at N=${N}`);
    caf.ifft(Xr, Xi);
    for (let n = 0; n < N; n++) assert.ok(Math.abs(Xr[n] - re[n]) < 1e-12 && Math.abs(Xi[n] - im[n]) < 1e-12);
  }
  assert.throws(() => caf.fft(new Float64Array(12), new Float64Array(12)));
});

test('makeSignal: unit power, flat spectrum, rms bandwidth = pi Bs / sqrt 3', () => {
  const fs = 64000, N = 8192, rng = linalg.makeRng(2);
  for (const Bs of [1000, 8000, 25000, 64000]) {
    const s = caf.makeSignal({ N, fs, Bs, rng });
    let p = 0;
    for (let m = 0; m < N; m++) p += s.re[m] ** 2 + s.im[m] ** 2;
    rel(p / N, 1, 1e-9, 'power');
    rel(s.Bs, Bs, 0.02, 'occupied bandwidth');
    rel(caf.rmsBandwidthOf(s, fs), stein.rmsBandwidth(s.Bs), 0.02, `beta at Bs=${Bs}`);
  }
});

test('fracDelay is exact for band-limited signals (delay then undo)', () => {
  const fs = 64000, N = 1024;
  const s = caf.makeSignal({ N, fs, Bs: 20000, rng: linalg.makeRng(3) });
  const back = caf.fracDelay(caf.fracDelay(s, 3.37), -3.37);
  for (let m = 0; m < N; m++) assert.ok(Math.abs(back.re[m] - s.re[m]) < 1e-10);
});

test('noise-free CAF: grid peak near truth, refined estimate to a tiny fraction of a cell', () => {
  const fs = 64000;
  for (const [N, Bs, tau, nu] of [[8192, 16000, 123.37e-6, 7.31], [4096, 64000, -211.9e-6, -23.4], [8192, 3000, 0.61e-3, 2.2]]) {
    const T = N / fs;
    const rng = linalg.makeRng(4);
    const s = caf.makeSignal({ N, fs, Bs, rng });
    const { x1, x2 } = caf.receive({ s, fs, delay: tau, doppler: nu, snr1: Infinity, snr2: Infinity, rng });
    const lagStep = Math.max(1, Math.floor(fs / s.Bs / 4));
    const grid = caf.caf({ x1, x2, fs, maxLagSamples: 64 * lagStep, lagStep, dopplerSpan: 8 / T + 30 });
    // decimated grid agrees with the full-FFT grid
    const full = caf.caf({ x1, x2, fs, maxLagSamples: 64 * lagStep, lagStep, dopplerSpan: 8 / T + 30, decimate: false });
    let md = 0;
    for (let i = 0; i < grid.mag.length; i++) md = Math.max(md, Math.abs(grid.mag[i] - full.mag[i]));
    assert.ok(md < 0.005, `decimation error ${md}`);
    const e = caf.estimatePeak({ x1, x2, fs, Bs: s.Bs, grid });
    assert.ok(Math.abs(e.coarseDelay - tau) <= lagStep / fs && Math.abs(e.coarseDoppler - nu) <= 0.5 / T, 'coarse cell');
    assert.ok(Math.abs(e.delay - tau) < 1e-4 / s.Bs, `delay error ${(e.delay - tau) * 1e9} ns`);
    assert.ok(Math.abs(e.doppler - nu) < 1e-4 / T, `doppler error ${(e.doppler - nu) * 1e3} mHz`);
    rel(e.peak, 1, 1e-6, 'peak');
  }
});

test('estimator bias is far below the Stein sigma at 20 dB post-integration SNR', () => {
  // noise-free error vs the sigma the bound gives at B T gamma = 100
  const fs = 64000, N = 4096, T = N / fs;
  const s = caf.makeSignal({ N, fs, Bs: 8000, rng: linalg.makeRng(5) });
  const { x1, x2 } = caf.receive({ s, fs, delay: 77.7e-6, doppler: -4.4, snr1: Infinity, snr2: Infinity, rng: linalg.makeRng(6) });
  const grid = caf.caf({ x1, x2, fs, maxLagSamples: 40, lagStep: 2, dopplerSpan: 6 / T });
  const e = caf.estimatePeak({ x1, x2, fs, Bs: s.Bs, grid });
  const g = 100 / (fs * T); // gamma such that B T gamma = 100 with B = fs
  const sT = 1 / (stein.rmsBandwidth(s.Bs) * Math.sqrt(100)), sF = 1 / (stein.rmsDuration(T) * Math.sqrt(100));
  assert.ok(g > 0 && Math.abs(e.delay - 77.7e-6) < 0.01 * sT, 'delay bias');
  assert.ok(Math.abs(e.doppler + 4.4) < 0.01 * sF, 'doppler bias');
});

// Monte-Carlo vs Stein. 300 trials: the sample sigma has a relative standard error of ~4 %, so a 15 %
// tolerance is a ~3.5-sigma test.
const mcCases = [
  // Bs = B = fs: no filtering question at all
  { name: 'Bs = fs, 5 dB per channel', N: 4096, Bs: 64000, snrDb: 5, prefilter: false, B: (Bs) => 64000 },
  // Bs < fs: reference channel filtered to the signal band, compare at B = Bs with SNR quoted in Bs
  { name: 'Bs = fs/8, 0 dB in fs (9 dB in Bs), prefiltered', N: 8192, Bs: 8000, snrDb: 0, prefilter: true, B: (Bs) => Bs },
  // Bs < fs without filtering but at high per-sample SNR: stein with B = fs
  { name: 'Bs = fs/4, 20 dB in fs, no filter', N: 4096, Bs: 16000, snrDb: 20, prefilter: false, B: (Bs) => 64000 },
];
for (const c of mcCases) {
  test(`Monte-Carlo sigma matches Stein (${c.name})`, () => {
    const fs = 64000, T = c.N / fs, snr = stein.fromDb(c.snrDb);
    const mc = caf.monteCarlo({ trials: 300, N: c.N, fs, Bs: c.Bs, delay: 61.3e-6, doppler: 3.3, snr1: snr, snr2: snr, rng: linalg.makeRng(21), prefilter: c.prefilter });
    const B = c.B(mc.Bs), k = fs / B;
    const p = { B, Bs: mc.Bs, T, snr1: snr * k, snr2: snr * k };
    const post = stein.toDb(B * T * stein.effectiveSnr(p.snr1, p.snr2));
    assert.ok(post >= 25, `post-integration SNR ${post} dB`);
    assert.equal(mc.nOutliers, 0);
    const sd = caf.errorStats(mc.delayErr), sn = caf.errorStats(mc.dopplerErr);
    const st = stein.tdoaSigma(p), sf = stein.fdoaSigma(p);
    rel(sd.std, st, 0.15, 'TDOA sigma');
    rel(sn.std, sf, 0.15, 'FDOA sigma');
    assert.ok(Math.abs(sd.mean) < 0.25 * st && Math.abs(sn.mean) < 0.25 * sf, 'unbiased');
  });
}

test('without the band filter, the noise x noise term inflates the TDOA error at low per-sample SNR', () => {
  // Bs = fs/4 at 10 dB in fs: the delay-domain cross term is weighted by the rms bandwidth of the
  // NOISE (fs) rather than of the signal, so sigma_tau exceeds stein(B = fs) by ~sqrt(1.7); filtering
  // x1 to the signal band removes the excess.
  const fs = 64000, N = 4096, T = N / fs, snr = 10;
  const run = (prefilter) => caf.monteCarlo({ trials: 300, N, fs, Bs: 16000, delay: 0, doppler: 0, snr1: snr, snr2: snr, rng: linalg.makeRng(33), prefilter });
  const raw = run(false), filt = run(true);
  const pFs = { B: fs, Bs: raw.Bs, T, snr1: snr, snr2: snr };
  const rRaw = caf.errorStats(raw.delayErr).std / stein.tdoaSigma(pFs);
  const rFilt = caf.errorStats(filt.delayErr).std / stein.tdoaSigma({ B: filt.Bs, Bs: filt.Bs, T, snr1: snr * fs / filt.Bs, snr2: snr * fs / filt.Bs });
  assert.ok(rRaw > 1.15, `raw ratio ${rRaw}`);
  assert.ok(Math.abs(rFilt - 1) < 0.15, `filtered ratio ${rFilt}`);
});

test('low SNR produces outliers (threshold effect)', () => {
  const fs = 64000, N = 2048, snr = stein.fromDb(-17);
  const mc = caf.monteCarlo({ trials: 60, N, fs, Bs: 16000, delay: 0, doppler: 0, snr1: snr, snr2: snr, rng: linalg.makeRng(9) });
  assert.ok(mc.nOutliers > 3, `outliers ${mc.nOutliers}`);
});
