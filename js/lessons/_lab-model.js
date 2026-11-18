/**
 * _lab-model.js - configuration model and pure glue for the 4-ball lab (09-lab.js).
 *
 * No DOM. Everything here can be imported and checked in Node:
 *   - DEFAULT_UI: the lab's user-facing settings in display units (km, ns, Hz, dB, ...)
 *   - PRESETS: one-click scenarios, each a partial patch over DEFAULT_UI
 *   - sanitizeUi(): restore a saved settings object safely (unknown / malformed values fall back)
 *   - toConfig(): settings -> scenario.defaultConfig() input (SI units)
 *   - derivedNoise(): per-collector sigma_TOA / sigma_FOA from the signal parameters (stein.js)
 *   - biasSources(): which deterministic error sources are active, in words
 *   - analyse(): one engine pass for the cheap, live part of the page
 *   - mcAccumulate(): sample statistics of an accumulated Monte-Carlo cloud
 *
 * All physics numbers come from the core (scenario.js, stein.js); this file converts units and packages.
 */
import { scenario as SC, stein, orbits, measure, constants, estimate } from '../core/index.js';

export const C = constants.C;
export const MASK_DEG = 5;                 // elevation mask used for "can collect"
export const K95 = Math.sqrt(-2 * Math.log(0.05)); // 2.4477: 95 % radius of a 2-D Gaussian, in sigmas
export const IDS = ['A', 'B', 'C', 'D'];
export const SHAPES = ['pair', 'triangle', 'tri+1', 'diamond', 'string'];
export const SHAPE_N = { pair: 2, triangle: 3, 'tri+1': 4, diamond: 4, string: 4 };
export const SOLVER_KEYS = ['retarded', 'earthRotation', 'dopplerExact', 'shapiro', 'troposphere', 'ionosphere'];

/** The lab's settings, in display units. Mirrors scenario.defaultConfig() (the default scenario). */
export const DEFAULT_UI = Object.freeze({
  emitter: { latDeg: 38.9, lonDeg: -77.0, altM: 50, f0: 1.0e9, speed: 0, headingDeg: 0 },
  orbit: { altKm: 550, incDeg: 53, ascending: true, passEastKm: 400, passNorthKm: 0 },
  t: 0,
  formation: { shape: 'tri+1', baselineKm: 150, custom: false, offsets: null },
  ref: 0,
  use: { tdoa: true, fdoa: true, altitude: true },
  sigmaAltM: 10,
  budget: {
    mode: 'direct',                       // 'direct' | 'signal'
    sigmaToaNs: 20, sigmaFoaHz: 0.05,
    noiseBwHz: 200e3, signalBwHz: 200e3, intT: 0.05, snrDb: [0, 0, 0, 0],
    clockNs: 5, lo: 2e-11, ephPosM: 1.0, ephVelMms: 5,
  },
  env: { vtec: 20, zwd: 0.15 },
  solver: { retarded: true, earthRotation: true, dopplerExact: true, shapiro: true, troposphere: true, ionosphere: true, properTimeLO: false },
  truthProperTimeLO: false,
  bias: { clockNs: [0, 0, 0, 0], freqHz: [0, 0, 0, 0], inTrackM: [0, 0, 0, 0], altM: 0 },
});

const clone = (o) => JSON.parse(JSON.stringify(o));

/** Recursive merge of plain objects; arrays and scalars in `patch` replace. */
export function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return clone(patch === undefined ? base : patch);
  const out = clone(base);
  for (const k of Object.keys(patch)) {
    const b = out[k], p = patch[k];
    out[k] = (b && typeof b === 'object' && !Array.isArray(b) && p && typeof p === 'object' && !Array.isArray(p)) ? deepMerge(b, p) : clone(p);
  }
  return out;
}

/** One-click scenarios: patches over DEFAULT_UI. */
export const PRESETS = [
  { id: 'tight', name: 'Tight 4-ball cluster, 1 GHz', desc: 'The default: a 150 km triangle plus a raised centre satellite at 550 km, passing 400 km east of an emitter near Washington, D.C., using TDOA, FDOA and the Earth-surface constraint.', patch: {} },
  { id: 'wide', name: 'Wide 4-ball formation', desc: 'The same formation stretched to a 1200 km baseline: the lines of position cross far more steeply, so the same per-collector errors give a much smaller fix error.', patch: { formation: { baselineKm: 1200 } } },
  { id: 'pair', name: '2 balls: TDOA + FDOA', desc: 'Two satellites 200 km apart in trail. One TDOA and one FDOA plus the Earth-surface constraint are just enough for a fix.', patch: { formation: { shape: 'pair', baselineKm: 200 } } },
  { id: 'tri', name: '3 balls: TDOA only + surface', desc: 'A 300 km triangle without Doppler: two TDOAs and the known emitter altitude make the fix.', patch: { formation: { shape: 'triangle', baselineKm: 300 }, use: { tdoa: true, fdoa: false, altitude: true } } },
  { id: 'noalt', name: '4 balls, no altitude assumption', desc: 'Four satellites with TDOA and FDOA and no Earth-surface constraint: a genuine 3-D fix, so the vertical error is no longer pinned by the assumed altitude.', patch: { use: { tdoa: true, fdoa: true, altitude: false } } },
  { id: 'uhf', name: 'UHF emitter under an active ionosphere', desc: 'A 400 MHz emitter under 80 TECU with a processor that ignores the ionosphere: the dispersive delay, which scales as 1/f0², biases the fix.', patch: { emitter: { f0: 400e6 }, env: { vtec: 80 }, solver: { ionosphere: false } } },
  { id: 'naive', name: 'Naive processor', desc: 'The processor freezes all satellites at one instant (no light-time) and computes in Earth-fixed coordinates (no Sagnac): a deterministic bias appears.', patch: { solver: { retarded: false, earthRotation: false } } },
  { id: 'moving', name: 'Moving emitter', desc: 'The emitter drives north-east at 15 m/s while the processor assumes it is stationary; its own Doppler is mistaken for geometry.', patch: { emitter: { speed: 15, headingDeg: 45 } } },
  { id: 'osc', name: 'One oscillator 1 Hz off', desc: "Collector B's frequency reading is 1 Hz high. Compare the shift of the cloud with the sensitivity table's 'frequency +1 Hz' row for B.", patch: { bias: { freqHz: [0, 1, 0, 0] } } },
];

/** Default per-collector offsets (km) for a named shape. */
export function shapeOffsetsKm(shape, baselineKm) {
  const f = orbits.FORMATIONS[shape] || orbits.FORMATIONS['tri+1'];
  return f(baselineKm * 1000).map((o) => ({ alongKm: (o.along || 0) / 1000, crossKm: (o.cross || 0) / 1000, radialKm: (o.radial || 0) / 1000 }));
}

/** Number of collectors the settings describe (2..4). */
export function nCollectors(ui) {
  if (ui.formation.custom && Array.isArray(ui.formation.offsets)) return Math.max(2, Math.min(4, ui.formation.offsets.length));
  return SHAPE_N[ui.formation.shape] || 4;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Restore a saved settings object: keep only well-typed values for known keys. */
export function sanitizeUi(saved) {
  const walk = (def, s) => {
    if (Array.isArray(def)) {
      if (!Array.isArray(s)) return clone(def);
      return def.map((d, i) => (isNum(d) ? (isNum(s[i]) ? s[i] : d) : d));
    }
    if (def && typeof def === 'object') {
      const out = {};
      for (const k of Object.keys(def)) out[k] = walk(def[k], s && typeof s === 'object' ? s[k] : undefined);
      return out;
    }
    if (def === null) return s === undefined ? null : s;
    return typeof s === typeof def && (typeof s !== 'number' || Number.isFinite(s)) ? s : def;
  };
  const ui = walk(DEFAULT_UI, saved || {});
  if (!SHAPES.includes(ui.formation.shape)) ui.formation.shape = 'tri+1';
  if (!['direct', 'signal'].includes(ui.budget.mode)) ui.budget.mode = 'direct';
  const off = saved && saved.formation && saved.formation.offsets;
  ui.formation.offsets = Array.isArray(off) && off.length >= 2 && off.length <= 4
    ? off.map((o) => ({ alongKm: isNum(o && o.alongKm) ? o.alongKm : 0, crossKm: isNum(o && o.crossKm) ? o.crossKm : 0, radialKm: isNum(o && o.radialKm) ? o.radialKm : 0 }))
    : null;
  if (!ui.formation.offsets) ui.formation.custom = false;
  ui.ref = Math.max(0, Math.min(nCollectors(ui) - 1, Math.round(ui.ref)));
  ui.t = Math.max(-300, Math.min(300, ui.t));
  return ui;
}

/** Settings for a preset (everything not in the patch is the default). */
export function presetUi(id) {
  const p = PRESETS.find((q) => q.id === id) || PRESETS[0];
  return sanitizeUi(deepMerge(DEFAULT_UI, p.patch));
}

/**
 * Per-collector measurement noise from the signal parameters (Stein's CAF bounds, stein.js).
 *
 * stein.toaSigma / foaSigma are the HIGH-SNR per-collector equivalents: they drop the noise-times-noise
 * term 1/(g1 g2) of the pair's effective SNR, which dominates below about 0 dB. To stay valid at low SNR
 * the lab assigns collector i half the variance of a pair of two collectors that both had its SNR:
 *     sigma_T,i = stein.tdoaSigma({snr1: g_i, snr2: g_i}) / sqrt(2)     (same for FOA)
 * This reproduces the pair bound exactly when the SNRs are equal, is slightly conservative when they are
 * not, and equals toaSigma / foaSigma in the high-SNR limit (both are returned, for display).
 * @returns {{sigmaToa:number[], sigmaFoa:number[], hiToa:number[], hiFoa:number[], pairToa:(number|null)[],
 *            pairFoa:(number|null)[], postSnrDb:number[], Bs:number}}
 *          pairToa / pairFoa: exact pair bound against the reference collector (null for the reference).
 *          postSnrDb: post-integration SNR B*T*gamma of the pair with the reference, dB.
 */
export function derivedNoise(ui, n = nCollectors(ui)) {
  const b = ui.budget;
  const B = b.noiseBwHz, T = b.intT, Bs = Math.min(b.signalBwHz, b.noiseBwHz);
  const snr = IDS.slice(0, n).map((_, i) => stein.fromDb(b.snrDb[i] ?? 0));
  const sigmaToa = snr.map((g) => stein.tdoaSigma({ B, T, snr1: g, snr2: g, Bs }) / Math.SQRT2);
  const sigmaFoa = snr.map((g) => stein.fdoaSigma({ B, T, snr1: g, snr2: g }) / Math.SQRT2);
  const hiToa = snr.map((g) => stein.toaSigma({ B, T, snr: g, Bs }));
  const hiFoa = snr.map((g) => stein.foaSigma({ B, T, snr: g }));
  const r = Math.min(ui.ref, n - 1);
  const pairToa = snr.map((g, i) => (i === r ? null : stein.tdoaSigma({ B, T, snr1: g, snr2: snr[r], Bs })));
  const pairFoa = snr.map((g, i) => (i === r ? null : stein.fdoaSigma({ B, T, snr1: g, snr2: snr[r] })));
  const postSnrDb = snr.map((g, i) => stein.toDb(B * T * stein.effectiveSnr(g, snr[i === r ? (r === 0 ? 1 : 0) : r])));
  return { sigmaToa, sigmaFoa, hiToa, hiFoa, pairToa, pairFoa, postSnrDb, Bs };
}

/** Settings -> scenario config (SI). */
export function toConfig(ui) {
  const n = nCollectors(ui);
  const e = ui.emitter, b = ui.budget, h = (e.headingDeg * Math.PI) / 180;
  const noise = derivedOrDirect(ui, n);
  const full = measure.FULL_MODEL;
  const offsets = ui.formation.custom && ui.formation.offsets ? ui.formation.offsets.slice(0, 4).map((o) => ({ ...o })) : null;
  return SC.defaultConfig({
    emitter: { latDeg: e.latDeg, lonDeg: e.lonDeg, altM: e.altM, f0: e.f0, velEnu: [e.speed * Math.sin(h), e.speed * Math.cos(h), 0] },
    orbit: { altKm: ui.orbit.altKm, incDeg: ui.orbit.incDeg, ascending: !!ui.orbit.ascending, passOffsetKm: { east: ui.orbit.passEastKm, north: ui.orbit.passNorthKm } },
    formation: { shape: ui.formation.shape, baselineKm: ui.formation.baselineKm, offsets },
    t: ui.t,
    ref: Math.min(ui.ref, n - 1),
    use: { ...ui.use },
    noise: {
      sigmaToa: noise.sigmaToa, sigmaFoa: noise.sigmaFoa, sigmaClock: b.clockNs * 1e-9, sigmaLo: b.lo,
      sigmaPos: b.ephPosM, sigmaVel: b.ephVelMms * 1e-3, sigmaAlt: ui.sigmaAltM,
    },
    bias: {
      clock: ui.bias.clockNs.slice(0, n).map((v) => v * 1e-9),
      freq: ui.bias.freqHz.slice(0, n),
      posRic: ui.bias.inTrackM.slice(0, n).map((v) => [0, v, 0]),
      velRic: [],
      alt: ui.bias.altM,
    },
    env: { tropo: { zwd: ui.env.zwd }, iono: { vtec: ui.env.vtec } },
    truth: { ...full, properTimeLO: !!ui.truthProperTimeLO },
    solver: { ...full, ...ui.solver },
  });
}

function derivedOrDirect(ui, n) {
  if (ui.budget.mode === 'signal') {
    const d = derivedNoise(ui, n);
    return { sigmaToa: d.sigmaToa, sigmaFoa: d.sigmaFoa };
  }
  return { sigmaToa: ui.budget.sigmaToaNs * 1e-9, sigmaFoa: ui.budget.sigmaFoaHz };
}

const SOLVER_WORDS = {
  retarded: 'light-time', earthRotation: 'Earth rotation (Sagnac)', dopplerExact: 'exact Doppler',
  shapiro: 'Shapiro delay', troposphere: 'troposphere', ionosphere: 'ionosphere',
};

/** Active deterministic error sources, as short phrases (empty = processor matches truth, no biases). */
export function biasSources(ui) {
  const n = nCollectors(ui), out = [];
  const off = SOLVER_KEYS.filter((k) => !ui.solver[k]);
  if (off.length) out.push(`processor ignores ${off.map((k) => SOLVER_WORDS[k]).join(', ')}`);
  if (!!ui.truthProperTimeLO !== !!ui.solver.properTimeLO) {
    out.push(ui.truthProperTimeLO ? 'free-running oscillators not corrected' : 'processor corrects clock rates that are not there');
  }
  if (ui.emitter.speed > 0) out.push(`emitter moving ${ui.emitter.speed.toFixed(1)} m/s`);
  for (let i = 0; i < n; i++) {
    if (ui.bias.clockNs[i]) out.push(`${IDS[i]} clock ${fmtSigned(ui.bias.clockNs[i])} ns`);
    if (ui.bias.freqHz[i]) out.push(`${IDS[i]} frequency ${fmtSigned(ui.bias.freqHz[i])} Hz`);
    if (ui.bias.inTrackM[i]) out.push(`${IDS[i]} in-track ephemeris ${fmtSigned(ui.bias.inTrackM[i])} m`);
  }
  if (ui.bias.altM && ui.use.altitude) out.push(`assumed altitude ${fmtSigned(ui.bias.altM)} m`);
  return out;
}
const fmtSigned = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + String(Math.abs(Math.round(v * 1000) / 1000));

/**
 * The live engine pass: geometry, observation, CRLB, sensitivities, DOPs and the deterministic bias.
 * Never throws; `error` is set if the engine failed.
 */
export function analyse(ui) {
  const out = { ui, cfg: null, S: null, geo: null, obs: null, cov: null, sens: null, dop: null, bias: null, sources: biasSources(ui), error: null };
  try {
    out.cfg = toConfig(ui);
    out.S = SC.buildScenario(out.cfg);
    out.geo = SC.geometry(out.S);
    out.obs = SC.truthObservation(out.S);
    out.below = out.geo.collectors.filter((c) => !(c.elevationDeg > MASK_DEG)).map((c) => c.id);
    out.allVisible = out.below.length === 0;
    out.cov = SC.covariance(out.S);
    out.dop = SC.dops(out.S);
    out.canFix = out.allVisible && out.cov.observable;
    if (out.canFix) {
      out.sens = SC.sensitivityTable(out.S);
      const meas = SC.simulateMeasurements(out.S, undefined, null);
      const fix = SC.solveFix(out.S, undefined, meas);
      out.bias = fix.converged && Number.isFinite(fix.err3d) ? fix : null;
      out.biasFailed = !out.bias;
    }
  } catch (e) {
    out.error = e;
    out.canFix = false;
  }
  return out;
}

/** Sample statistics of an accumulated Monte-Carlo cloud ([east, north, up] errors, m). */
export function mcAccumulate(errors, failures, Penu) {
  const n = errors.length;
  if (n < 2) return { n, failures, mean: null };
  const st = estimate.sampleStats(errors);
  const radii = errors.map((e) => Math.hypot(e[0], e[1])).sort((a, b) => a - b);
  const ms = (f) => Math.sqrt(errors.reduce((s, e) => s + f(e), 0) / n);
  // fraction inside the CRLB 95 % ellipse centred on the truth
  let inside = null;
  if (Penu) {
    const a = Penu[0][0], b = Penu[0][1], d = Penu[1][1], det = a * d - b * b;
    if (det > 0) {
      let k = 0;
      for (const e of errors) {
        const q = (d * e[0] * e[0] - 2 * b * e[0] * e[1] + a * e[1] * e[1]) / det;
        if (q <= K95 * K95) k++;
      }
      inside = k / n;
    }
  }
  return {
    n, failures, mean: st.mean, cov: st.cov,
    rmsHoriz: ms((e) => e[0] * e[0] + e[1] * e[1]), rmsUp: ms((e) => e[2] * e[2]),
    cep50: radii[Math.floor(n / 2)], inside,
  };
}

/** Run one Monte-Carlo chunk; returns the core's result (errors, failures). */
export function mcChunk(S, trials, seed) {
  return SC.monteCarlo(S, { trials, seed });
}
