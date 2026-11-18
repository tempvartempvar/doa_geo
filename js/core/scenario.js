/**
 * Scenario engine for the orbital lessons: build a collection geometry from a plain config object, then
 * ask questions of it - what is measured, how precisely can the emitter be located, what does each
 * physical effect or each collector error do to the fix.
 *
 * Typical use
 *   const S = buildScenario(defaultConfig());       // or defaultConfig({ formation: { shape: 'pair' } })
 *   const obs = truthObservation(S);                // ranges, elevations, TDOAs, FDOAs, per-effect terms
 *   const cov = covariance(S);                      // CRLB: error ellipse, CEP, sigma E/N/U, gain matrix
 *   const mc  = monteCarlo(S, { trials: 300 });     // cloud of actual fixes to compare with the bound
 *   const fx  = effectsTable(S);                    // cost of ignoring light-time, Sagnac, atmosphere ...
 *   const sn  = sensitivityTable(S);                // metres per ns, per Hz, per metre of ephemeris ...
 *
 * All functions take the built scenario S and an optional time t (seconds; default S.cfg.t). Time zero
 * is the instant the formation's reference point passes over the configured pass point.
 */
import { C, DEG } from './constants.js';
import { zeros, matMul, transpose, makeRng, symEig, vsub, vnorm, vdot } from './linalg.js';
import {
  geodeticToEcef, ecefToGeodeticDeg, enuVecToEcef, ecefVecToEnu, enuMatrix, localMap, heightOf,
  offsetLatLonDeg, eciToEcef, stateEciToEcef,
} from './frames.js';
import { keplerTrajectory, freezeTrajectory, offsetTrajectory, orbitOverPoint, makeFormation, FORMATIONS, ricBasis } from './orbits.js';
import { observe, measurementLayout, measurementVector, FULL_MODEL } from './measure.js';
import { differencingCov, numericJacobian, information, gaussNewton, errorEllipse, errorEllipsoid, cep, sampleStats } from './estimate.js';
import { inverse } from './linalg.js';

const IDS = 'ABCDEFGH';
const ZERO3 = [0, 0, 0];

/**
 * Default configuration; pass a partial object to override (merged one level deep per section).
 *
 * emitter    latDeg, lonDeg, altM (height above ellipsoid), f0 (carrier, Hz), velEnu (m/s over the ground)
 * orbit      altKm, incDeg, ascending; passOffsetKm {east, north}: where the formation's ground track
 *            passes, relative to the emitter (0,0 = straight overhead)
 * formation  shape: one of FORMATIONS ('pair','triangle','tri+1','diamond','string'), baselineKm;
 *            or offsets: [{alongKm, crossKm, radialKm}, ...] to place each collector by hand
 * t          time relative to the pass, s (negative = approaching)
 * ref        index of the reference collector
 * use        which measurements feed the fix: tdoa, fdoa, altitude (the Earth-surface constraint)
 * noise      1-sigma values. sigmaToa / sigmaFoa: per-collector measurement noise (s, Hz; number or array)
 *            sigmaClock: time-sync error per collector (s);  sigmaLo: fractional frequency-reference error
 *            sigmaPos / sigmaVel: ephemeris knowledge error per axis (m, m/s);  sigmaAlt: how well the
 *            emitter's altitude is known (m)
 * bias       deterministic errors for "what if" experiments: clock[i] (s), freq[i] (Hz, collector i's
 *            frequency reading is this much high), posRic[i] / velRic[i] ([radial, in-track, cross-track]
 *            ephemeris error, m and m/s), alt (m, assumed minus true emitter altitude)
 * env        tropo {zhd, zwd} (zenith delays, m), iono {vtec (TECU), shellKm}
 * truth      model switches used to generate the measurements (see measure.js FULL_MODEL)
 * solver     model switches the geolocation processor uses
 */
export function defaultConfig(over = {}) {
  const base = {
    emitter: { latDeg: 38.9, lonDeg: -77.0, altM: 50, f0: 1.0e9, velEnu: [0, 0, 0] },
    orbit: { altKm: 550, incDeg: 53, ascending: true, passOffsetKm: { east: 400, north: 0 } },
    formation: { shape: 'tri+1', baselineKm: 150, offsets: null },
    t: 0,
    ref: 0,
    use: { tdoa: true, fdoa: true, altitude: true },
    noise: { sigmaToa: 20e-9, sigmaFoa: 0.05, sigmaClock: 5e-9, sigmaLo: 2e-11, sigmaPos: 1.0, sigmaVel: 0.005, sigmaAlt: 10 },
    bias: { clock: [], freq: [], posRic: [], velRic: [], alt: 0 },
    env: { tropo: { zhd: 2.3, zwd: 0.15 }, iono: { vtec: 20, shellKm: 350 } },
    truth: { ...FULL_MODEL },
    solver: { ...FULL_MODEL },
  };
  const out = {};
  for (const k of Object.keys(base)) {
    const b = base[k], o = over[k];
    out[k] = (b && typeof b === 'object' && !Array.isArray(b)) ? { ...b, ...(o || {}) } : (o === undefined ? b : o);
  }
  if (over.orbit && over.orbit.passOffsetKm) out.orbit.passOffsetKm = { ...base.orbit.passOffsetKm, ...over.orbit.passOffsetKm };
  if (over.env) out.env = { tropo: { ...base.env.tropo, ...(over.env.tropo || {}) }, iono: { ...base.env.iono, ...(over.env.iono || {}) } };
  if (over.elements) out.elements = over.elements; // advanced: explicit Keplerian elements per collector
  return out;
}

/**
 * Resolve a config into geometry.
 * @returns {{cfg:object, n:number, ids:string[], emitter:{ecef,velEcef,f0,latDeg,lonDeg,altM,lat,lon},
 *            map:object, trajs:object[], elements:object[], refElements:object, overhead:boolean}}
 *          map = frames.localMap centred on the emitter; trajs = Keplerian collector trajectories (ECI).
 */
export function buildScenario(cfg) {
  const em = cfg.emitter;
  const lat = em.latDeg * DEG, lon = em.lonDeg * DEG;
  const emitter = {
    ecef: geodeticToEcef(lat, lon, em.altM), velEcef: enuVecToEcef(em.velEnu || ZERO3, lat, lon),
    f0: em.f0, latDeg: em.latDeg, lonDeg: em.lonDeg, altM: em.altM, lat, lon,
  };
  let elements, refElements = null, overhead = true;
  if (cfg.elements) {
    elements = cfg.elements;
  } else {
    const off = cfg.orbit.passOffsetKm || { east: 0, north: 0 };
    const pass = offsetLatLonDeg(em.latDeg, em.lonDeg, (off.east || 0) * 1000, (off.north || 0) * 1000);
    refElements = orbitOverPoint({ latDeg: pass.latDeg, lonDeg: pass.lonDeg, altKm: cfg.orbit.altKm, incDeg: cfg.orbit.incDeg, ascending: cfg.orbit.ascending, tPass: 0 });
    overhead = refElements.overhead;
    const f = cfg.formation;
    const offsets = f.offsets
      ? f.offsets.map((o) => ({ along: (o.alongKm || 0) * 1000, cross: (o.crossKm || 0) * 1000, radial: (o.radialKm || 0) * 1000 }))
      : (FORMATIONS[f.shape] || FORMATIONS['tri+1'])(f.baselineKm * 1000);
    elements = makeFormation(refElements, 0, offsets);
  }
  const trajs = elements.map(keplerTrajectory);
  return {
    cfg, n: trajs.length, ids: IDS.slice(0, trajs.length).split(''), emitter,
    map: localMap(em.latDeg, em.lonDeg, em.altM), trajs, elements, refElements, overhead,
  };
}

const perCol = (v, i) => (Array.isArray(v) ? (v[i] ?? v[v.length - 1] ?? 0) : (v ?? 0));
const timeOf = (S, t) => (t === undefined || t === null ? S.cfg.t : t);
const layoutOf = (S, use = S.cfg.use) => measurementLayout(S.n, use, S.cfg.ref, IDS);

/** Noise-free observation with the scenario's truth model: see measure.observe for the fields. */
export function truthObservation(S, t) {
  return observe(S.emitter, S.trajs, timeOf(S, t), { model: S.cfg.truth, env: S.cfg.env, ref: S.cfg.ref });
}

/**
 * Display-friendly geometry at time t.
 * @returns {{t:number, emitter:{ecef,latDeg,lonDeg,altM}, collectors:{id, ecef, velEcef, latDeg, lonDeg,
 *            altKm, enu:number[], rangeKm, elevationDeg, azimuthDeg, visible, speed}[]}}
 *          enu = collector position relative to the emitter in local east/north/up metres.
 */
export function geometry(S, t) {
  const obs = truthObservation(S, t);
  return {
    t: obs.t0,
    emitter: { ecef: S.emitter.ecef, latDeg: S.emitter.latDeg, lonDeg: S.emitter.lonDeg, altM: S.emitter.altM },
    collectors: obs.collectors.map((c, i) => {
      const g = ecefToGeodeticDeg(c.rEcef);
      return {
        id: S.ids[i], ecef: c.rEcef, velEcef: c.vEcef, latDeg: g.latDeg, lonDeg: g.lonDeg, altKm: g.h / 1000,
        enu: S.map.toEnu(c.rEcef), rangeKm: c.range / 1000, elevationDeg: c.elevation / DEG,
        azimuthDeg: ((c.azimuth / DEG) + 360) % 360, visible: c.visible, speed: vnorm(c.vEcef),
      };
    }),
  };
}

/** Collector positions in ECEF over a list of times (for drawing orbit tracks on the globe). */
export function trackEcef(S, i, times) { return times.map((t) => eciToEcef(S.trajs[i].state(t).r, t)); }

/**
 * Per-collector equivalent error variances. Every random error source is expressed as an equivalent
 * time-of-arrival error (s^2) or frequency-of-arrival error (Hz^2) at one collector:
 *   TOA: measurement noise, clock-sync error, ephemeris position error along the line of sight (/c)
 *   FOA: measurement noise, frequency-reference error (f0 * sigmaLo), ephemeris velocity error along the
 *        line of sight (f0/c * sigmaVel), ephemeris position error across it (it tilts the line of sight)
 * @returns {{varT:number[], varF:number[], parts:object[]}} parts[i] itemises the contributions (1-sigma)
 */
export function collectorErrorBudget(S, obs) {
  const nz = S.cfg.noise, f0 = S.emitter.f0;
  const varT = [], varF = [], parts = [];
  obs.collectors.forEach((c, i) => {
    const vl = vdot(c.vEcef, c.los);
    const vperp = Math.sqrt(Math.max(vdot(c.vEcef, c.vEcef) - vl * vl, 0));
    const p = {
      toaNoise: perCol(nz.sigmaToa, i), clock: nz.sigmaClock || 0, posAsTime: (nz.sigmaPos || 0) / C,
      foaNoise: perCol(nz.sigmaFoa, i), lo: f0 * (nz.sigmaLo || 0), velAsFreq: (f0 / C) * (nz.sigmaVel || 0),
      posAsFreq: (f0 / C) * (vperp / c.range) * (nz.sigmaPos || 0),
    };
    p.toaTotal = Math.hypot(p.toaNoise, p.clock, p.posAsTime);
    p.foaTotal = Math.hypot(p.foaNoise, p.lo, p.velAsFreq, p.posAsFreq);
    parts.push(p);
    varT.push(Math.max(p.toaTotal * p.toaTotal, 1e-30));
    varF.push(Math.max(p.foaTotal * p.foaTotal, 1e-18));
  });
  return { varT, varF, parts };
}

/** Measurement covariance R for a layout, from per-collector variances (+ altitude variance). */
function measCov(layout, varT, varF, sigmaAlt) {
  const m = layout.length, R = zeros(m, m);
  const idx = (type) => layout.map((q, k) => (q.type === type ? k : -1)).filter((k) => k >= 0);
  const fill = (ix, v) => {
    const sub = differencingCov(ix.map((k) => layout[k]), v);
    ix.forEach((ka, a) => ix.forEach((kb, b) => { R[ka][kb] = sub[a][b]; }));
  };
  fill(idx('tdoa'), varT); fill(idx('fdoa'), varF);
  for (const k of idx('alt')) R[k][k] = Math.max(sigmaAlt * sigmaAlt, 1e-6);
  return R;
}

/** The processor's measurement function h(x): emitter ECEF position -> predicted measurement vector. */
function predictor(S, t, layout, { model = S.cfg.solver, trajs = S.trajs, fRef, velEcef = ZERO3 } = {}) {
  const opts = { model, env: S.cfg.env, ref: S.cfg.ref };
  const hasAlt = layout.some((m) => m.type === 'alt');
  return (x) => {
    const obs = observe({ ecef: x, velEcef, f0: S.emitter.f0 }, trajs, t, opts);
    return measurementVector(obs, layout, { fRef, altitude: hasAlt ? heightOf(x) : 0 });
  };
}

function frozen(S, t) { return { ...S, trajs: S.trajs.map((tr) => freezeTrajectory(tr, t)) }; }

function enuCovariance(S, P) {
  const Q = enuMatrix(S.emitter.lat, S.emitter.lon);
  return matMul(matMul(Q, P), transpose(Q));
}

/**
 * Location precision (Cramer-Rao bound) at time t for the configured measurements and error budget.
 *
 * @param {object} S
 * @param {number} [t]
 * @param {{use?:object, prob?:number}} [o] override which measurements are used; ellipse probability
 * @returns {{
 *   observable:boolean, layout:object[], R:number[][], H:number[][], Henu:number[][],
 *   P:number[][], Penu:number[][], K:number[][], Kenu:number[][],
 *   sigmaE:number, sigmaN:number, sigmaU:number, drms:number, mrse:number, cep50:number,
 *   ellipse:{semiMajor,semiMinor,angle,sigmaMajor,sigmaMinor}, ellipsoid:{axes,sigmas,semiAxes},
 *   budget:object }}
 * H: Jacobian d(measurement)/d(emitter ECEF) (rows follow layout; units s/m, Hz/m, m/m). Henu: same in
 * local east/north/up. P / Penu: position covariance (m^2). K / Kenu: estimator gain (3 x m): column k is
 * the fix displacement per unit error of measurement k. ellipse: horizontal error ellipse in the local
 * east(x)/north(y) plane, angle counter-clockwise from east. ellipsoid: 3-D, axes in ECEF.
 * drms = horizontal rms error, mrse = 3-D rms error, cep50 = horizontal 50 % radius.
 * minElevationDeg / allVisible: lowest collector elevation seen from the emitter. The mathematics does not
 * stop a signal passing through the Earth - check allVisible (or apply your own elevation mask).
 * When observable is false the measurement set cannot fix the position and only layout/R/H/budget and the
 * visibility fields are returned.
 */
export function covariance(S, t, o = {}) {
  t = timeOf(S, t);
  const F = frozen(S, t);
  const layout = layoutOf(S, o.use);
  const obs = truthObservation(F, t);
  const budget = collectorErrorBudget(S, obs);
  const R = measCov(layout, budget.varT, budget.varF, S.cfg.noise.sigmaAlt);
  const h = predictor(F, t, layout, { fRef: obs.collectors[S.cfg.ref].freq });
  // Differentiate along local east / north / up, and solve there: the altitude constraint is then
  // (almost) a pure "up" row, which keeps the problem well conditioned however tight it is.
  const Q = enuMatrix(S.emitter.lat, S.emitter.lon);
  const Henu = layout.length ? numericJacobian((d) => h(S.map.fromEnu(d)), [0, 0, 0], 10) : [];
  const H = Henu.length ? matMul(Henu, Q) : [];
  const minElevationDeg = Math.min(...obs.collectors.map((c) => c.elevation)) / DEG;
  const fail = { observable: false, layout, R, H, Henu, budget, minElevationDeg, allVisible: minElevationDeg > 0 };
  if (layout.length < 3) return fail;
  const info = information(Henu, R);
  if (!info) return fail;
  const Penu = info.P, Kenu = info.K;
  if (!(Penu[0][0] > 0 && Penu[1][1] > 0 && Penu[2][2] > 0)) return fail;
  if (!(Math.sqrt(Penu[0][0] + Penu[1][1] + Penu[2][2]) < 5e7)) return fail;
  const Qt = transpose(Q);
  const P = matMul(matMul(Qt, Penu), Q);
  const K = matMul(Qt, Kenu);
  const Ph = [[Penu[0][0], Penu[0][1]], [Penu[1][0], Penu[1][1]]];
  return {
    observable: true, layout, R, H, Henu, P, Penu, K, Kenu,
    sigmaE: Math.sqrt(Penu[0][0]), sigmaN: Math.sqrt(Penu[1][1]), sigmaU: Math.sqrt(Penu[2][2]),
    drms: Math.sqrt(Penu[0][0] + Penu[1][1]), mrse: Math.sqrt(Penu[0][0] + Penu[1][1] + Penu[2][2]),
    cep50: cep(Ph, 0.5), ellipse: errorEllipse(Ph, o.prob ?? 0.95), ellipsoid: errorEllipsoid(P, o.prob ?? 0.95),
    budget, minElevationDeg, allVisible: minElevationDeg > 0,
  };
}

/**
 * Dilution of precision: position error per unit of per-collector measurement error, geometry only.
 *   TDOA DOP is dimensionless:  sigma_position = DOP x (c x sigma_TOA)
 *   FDOA DOP is in seconds:     sigma_position = DOP x (lambda x sigma_FOA)   (lambda*sigma_f = range-rate error)
 * Each is given for a free 3-D fix (h, v, p = horizontal, vertical, total; null if the geometry cannot
 * support it) and for a fix constrained to the known-altitude surface (horizontal only).
 * @returns {{tdoa3d:{h,v,p}|null, tdoaSurface:number|null, fdoa3d:{h,v,p}|null, fdoaSurface:number|null}}
 */
export function dops(S, t) {
  t = timeOf(S, t);
  const F = frozen(S, t);
  const obs = truthObservation(F, t);
  const fRef = obs.collectors[S.cfg.ref].freq;
  const one = (use, varT, varF) => {
    const layout = measurementLayout(S.n, use, S.cfg.ref, IDS);
    if (layout.length < 3) return null;
    const R = measCov(layout, new Array(S.n).fill(varT), new Array(S.n).fill(varF), 1e-3);
    const hh = predictor(F, t, layout, { fRef });
    const info = information(numericJacobian((d) => hh(S.map.fromEnu(d)), [0, 0, 0], 10), R);
    if (!info) return null;
    const E = info.P;
    if (!(E[0][0] > 0 && E[1][1] > 0 && E[2][2] > 0)) return null;
    const h = Math.sqrt(E[0][0] + E[1][1]), v = Math.sqrt(E[2][2]);
    return h < 1e9 ? { h, v, p: Math.hypot(h, v) } : null;
  };
  const vT = 1 / (C * C);                       // 1 m of range-equivalent TOA error
  const vF = (S.emitter.f0 / C) ** 2;           // 1 m/s of range-rate-equivalent FOA error
  const surf = (d) => (d ? d.h : null);
  return {
    tdoa3d: one({ tdoa: true, fdoa: false, altitude: false }, vT, vF),
    tdoaSurface: surf(one({ tdoa: true, fdoa: false, altitude: true }, vT, vF)),
    fdoa3d: one({ tdoa: false, fdoa: true, altitude: false }, vT, vF),
    fdoaSurface: surf(one({ tdoa: false, fdoa: true, altitude: true }, vT, vF)),
  };
}

function ricToEci(traj, t, ric) {
  if (!ric) return ZERO3;
  const s = traj.state(t), b = ricBasis(s.r, s.v);
  return [0, 1, 2].map((k) => b.R[k] * ric[0] + b.I[k] * ric[1] + b.C[k] * ric[2]);
}

/**
 * Generate one set of measurements as the processor would receive them: truth + random errors drawn from
 * the noise budget + the configured deterministic biases.
 * @param {object} S
 * @param {number} [t]
 * @param {{normal:()=>number}|null} [rng]  null -> no random errors (biases only)
 * @returns {{layout, z:number[], zTrue:number[], fRef:number, altAssumed:number, trajs:object[], obs:object}}
 *          trajs = the ephemerides the processor believes (true trajectories + knowledge errors).
 */
export function simulateMeasurements(S, t, rng = null) {
  t = timeOf(S, t);
  const layout = layoutOf(S);
  const obs = truthObservation(S, t);
  const nz = S.cfg.noise, bias = S.cfg.bias || {}, f0 = S.emitter.f0;
  const g = () => (rng ? rng.normal() : 0);
  const dT = [], dF = [], trajs = [];
  for (let i = 0; i < S.n; i++) {
    dT.push(perCol(nz.sigmaToa, i) * g() + (nz.sigmaClock || 0) * g() + ((bias.clock || [])[i] || 0));
    dF.push(perCol(nz.sigmaFoa, i) * g() + f0 * (nz.sigmaLo || 0) * g() + ((bias.freq || [])[i] || 0));
    const dr = ricToEci(S.trajs[i], t, (bias.posRic || [])[i]).map((b) => b + (nz.sigmaPos || 0) * g());
    const dv = ricToEci(S.trajs[i], t, (bias.velRic || [])[i]).map((b) => b + (nz.sigmaVel || 0) * g());
    const moved = dr.some((v) => v !== 0) || dv.some((v) => v !== 0);
    trajs.push(moved ? offsetTrajectory(S.trajs[i], dr, dv, t) : S.trajs[i]);
  }
  const altAssumed = S.emitter.altM + (bias.alt || 0) + (nz.sigmaAlt || 0) * g();
  const zTrue = measurementVector(obs, layout, { altitude: S.emitter.altM });
  const z = layout.map((m, k) => {
    if (m.type === 'tdoa') return zTrue[k] + dT[m.i] - dT[m.j];
    if (m.type === 'fdoa') return zTrue[k] + dF[m.i] - dF[m.j];
    return altAssumed;
  });
  return { layout, z, zTrue, fRef: obs.collectors[S.cfg.ref].freq + dF[S.cfg.ref], altAssumed, trajs, obs };
}

/**
 * Solve for the emitter position from a measurement set (iterative weighted least squares in ECEF).
 * @param {object} S
 * @param {number} [t]
 * @param {object} meas   from simulateMeasurements()
 * @param {{x0?:number[], model?:object, maxIter?:number}} [o] x0 = starting ECEF guess (default: the truth,
 *        appropriate for error studies; pass something else to test convergence)
 * @returns {{x:number[], errEnu:number[], errHoriz:number, err3d:number, latDeg, lonDeg, altM,
 *            converged:boolean, iterations:number, cost:number, path:{x,enu,cost}[]}}
 *          errEnu = fix minus true emitter position in local east/north/up (m); path = solver iterates.
 */
export function solveFix(S, t, meas, o = {}) {
  t = timeOf(S, t);
  const obs = meas.obs || truthObservation(S, t);
  const budget = collectorErrorBudget(S, obs);
  const R = measCov(meas.layout, budget.varT, budget.varF, S.cfg.noise.sigmaAlt);
  const h = predictor({ ...S, trajs: meas.trajs || S.trajs }, t, meas.layout, { model: o.model || S.cfg.solver, trajs: meas.trajs || S.trajs, fRef: meas.fRef });
  // Iterate in local east/north/up coordinates about the map origin (a pure change of variables).
  const res = solveEnu(S, h, meas.z, R, o.x0 ? S.map.toEnu(o.x0) : [0, 0, 0], o.maxIter || 40);
  const x = S.map.fromEnu(res.x), errEnu = res.x;
  const g = ecefToGeodeticDeg(x);
  return {
    x, errEnu, errHoriz: Math.hypot(errEnu[0], errEnu[1]), err3d: vnorm(errEnu),
    latDeg: g.latDeg, lonDeg: g.lonDeg, altM: g.h,
    converged: res.converged, iterations: res.iterations, cost: res.cost,
    path: res.path.map((q) => ({ x: S.map.fromEnu(q.x), enu: q.x, cost: q.cost })),
  };
}

function solveEnu(S, h, z, R, d0, maxIter = 40) {
  return gaussNewton({ h: (d) => h(S.map.fromEnu(d)), z, R, x0: d0, step: 10, tol: 1e-5, maxIter });
}

/**
 * Monte-Carlo: repeat simulate + solve with fresh random errors.
 * @param {object} S
 * @param {{t?:number, trials?:number, seed?:number}} [o]
 * @returns {{errors:number[][], mean:number[], cov:number[][], rmsHoriz:number, rmsUp:number,
 *            cep50:number, failures:number}} errors = [east, north, up] fix errors in metres.
 */
export function monteCarlo(S, o = {}) {
  const t = timeOf(S, o.t);
  const F = frozen(S, t);
  const rng = makeRng(o.seed ?? 1);
  const errors = []; let failures = 0;
  const trials = o.trials ?? 300;
  for (let k = 0; k < trials; k++) {
    const meas = simulateMeasurements(F, t, rng);
    let fix;
    try { fix = solveFix(F, t, meas, { maxIter: 15 }); } catch (e) { failures++; continue; }
    if (fix.converged && fix.err3d < 1e7) errors.push(fix.errEnu); else failures++;
  }
  if (errors.length < 2) return { errors, mean: [0, 0, 0], cov: zeros(3, 3), rmsHoriz: NaN, rmsUp: NaN, cep50: NaN, failures };
  const st = sampleStats(errors);
  const radii = errors.map((e) => Math.hypot(e[0], e[1])).sort((a, b) => a - b);
  const ms = (f) => Math.sqrt(errors.reduce((s, e) => s + f(e), 0) / errors.length);
  return {
    errors, mean: st.mean, cov: st.cov,
    rmsHoriz: ms((e) => e[0] * e[0] + e[1] * e[1]), rmsUp: ms((e) => e[2] * e[2]),
    cep50: radii[Math.floor(radii.length / 2)], failures,
  };
}

/**
 * The cost of each physical effect: how much it changes the measurements, and how far the position fix
 * moves if the processor leaves it out of its model while everything else is perfect.
 *
 * @param {object} S
 * @param {number} [t]
 * @param {{emitterSpeed?:number, altError?:number, carrierError?:number}} [o]  sizes of the three
 *        "knowledge" rows: unmodelled emitter speed (m/s, default 1, eastward), emitter altitude error
 *        (m, default 30), fractional carrier-frequency error (default 1e-6)
 * @returns {{key:string, label:string, note:string, dTdoa:number[], dFdoa:number[], maxTdoa:number,
 *            maxFdoa:number, biasEnu:number[]|null, biasHoriz:number|null, bias3d:number|null}[]}
 *          dTdoa (s) / dFdoa (Hz): change of each TDOA / FDOA (collector minus reference, reference entry
 *          omitted) caused by the effect; maxTdoa / maxFdoa: largest magnitudes; biasEnu: resulting
 *          fix error (m) with the scenario's measurement selection, null if no fix is possible.
 */
export function effectsTable(S, t, o = {}) {
  t = timeOf(S, t);
  const F = frozen(S, t);
  const ref = S.cfg.ref;
  const full = { ...FULL_MODEL, properTimeLO: !!S.cfg.truth.properTimeLO };
  const env = S.cfg.env;
  const layout = layoutOf(S);
  const others = [...Array(S.n).keys()].filter((i) => i !== ref);
  const obsFull = observe(F.emitter, F.trajs, t, { model: full, env, ref });
  const fRef = obsFull.collectors[ref].freq;
  const budget = collectorErrorBudget(S, obsFull);
  const R = layout.length ? measCov(layout, budget.varT, budget.varF, S.cfg.noise.sigmaAlt) : null;
  const zFull = measurementVector(obsFull, layout, { altitude: S.emitter.altM });
  const canFix = covariance(S, t).observable;

  const bias = (z, model, fR = fRef) => {
    if (!canFix) return null;
    try {
      const h = predictor(F, t, layout, { model, fRef: fR });
      return solveEnu(S, h, z, R, [0, 0, 0]).x;
    } catch (e) { return null; }
  };
  const row = (key, label, note, dT, dF, b) => ({
    key, label, note, dTdoa: dT, dFdoa: dF,
    maxTdoa: Math.max(0, ...dT.map(Math.abs)), maxFdoa: Math.max(0, ...dF.map(Math.abs)),
    biasEnu: b, biasHoriz: b ? Math.hypot(b[0], b[1]) : null, bias3d: b ? vnorm(b) : null,
  });
  const diff = (a, b) => ({ dT: others.map((i) => a.tdoa[i] - b.tdoa[i]), dF: others.map((i) => a.fdoa[i] - b.fdoa[i]) });

  const rows = [];
  // --- modelling shortcuts: truth = full model, processor omits one thing ---
  const shortcut = (key, label, note, change) => {
    const model = { ...full, ...change };
    const d = diff(obsFull, observe(F.emitter, F.trajs, t, { model, env, ref }));
    rows.push(row(key, label, note, d.dT, d.dF, bias(zFull, model)));
  };
  shortcut('instant', 'Finite light-time ignored', 'All collectors frozen at one instant instead of each at its own reception time.', { retarded: false });
  shortcut('sagnac', 'Earth rotation during flight (Sagnac)', 'Light-time solved in Earth-fixed coordinates as if they were inertial.', { earthRotation: false });
  shortcut('doppler2', 'Doppler beyond first order', 'f0(1 - rangeRate/c) used instead of the exact ratio.', { dopplerExact: false });
  shortcut('shapiro', 'Gravitational (Shapiro) delay', 'Extra light-time from the Earth\'s gravity.', { shapiro: false });
  shortcut('tropo', 'Troposphere', 'Neutral-atmosphere delay near the emitter (delays envelope and phase alike).', { troposphere: false });
  shortcut('iono', 'Ionosphere', 'Dispersive: group delay on TDOA, phase advance on FDOA, both scale as 1/f0^2.', { ionosphere: false });

  // --- clock physics: collectors' oscillators free-running on proper time, processor assumes coordinate time ---
  {
    const obsP = observe(F.emitter, F.trajs, t, { model: { ...full, properTimeLO: true }, env, ref });
    const obsC = observe(F.emitter, F.trajs, t, { model: { ...full, properTimeLO: false }, env, ref });
    const d = diff(obsP, obsC);
    const zP = measurementVector(obsP, layout, { altitude: S.emitter.altM });
    rows.push(row('clock', 'Relativistic clock rates', 'Time dilation + gravitational red-shift of free-running collector oscillators (zero if GPS-disciplined).',
      d.dT, d.dF, bias(zP, { ...full, properTimeLO: false }, obsP.collectors[ref].freq)));
  }
  // --- knowledge errors ---
  {
    const speed = o.emitterSpeed ?? 1;
    const em = { ...F.emitter, velEcef: enuVecToEcef([speed, 0, 0], S.emitter.lat, S.emitter.lon) };
    const obsM = observe(em, F.trajs, t, { model: full, env, ref });
    const d = diff(obsM, obsFull);
    const zM = measurementVector(obsM, layout, { altitude: S.emitter.altM });
    rows.push(row('motion', `Emitter moving ${speed} m/s (unmodelled)`, 'The processor assumes a stationary emitter; this one drives east.', d.dT, d.dF, bias(zM, full, obsM.collectors[ref].freq)));
  }
  {
    const dh = o.altError ?? 30;
    const hasAlt = layout.some((m) => m.type === 'alt');
    const z = zFull.map((v, k) => (layout[k].type === 'alt' ? v + dh : v));
    rows.push(row('altitude', `Emitter altitude wrong by ${dh} m`, hasAlt ? 'Error in the terrain height used for the Earth-surface constraint.' : 'Not applicable: the altitude constraint is not in use.',
      others.map(() => 0), others.map(() => 0), hasAlt ? bias(z, full) : (canFix ? [0, 0, 0] : null)));
  }
  {
    const frac = o.carrierError ?? 1e-6;
    const scaled = obsFull.fdoa.map((v) => v * frac);
    rows.push(row('carrier', `Carrier frequency wrong by ${(frac * 1e6).toPrecision(2)} ppm`, 'FDOA scales with the carrier, so a fractional carrier error is the same fractional FDOA error.',
      others.map(() => 0), others.map((i) => scaled[i]), bias(zFull, full, fRef * (1 - frac))));
  }
  return rows;
}

/**
 * What a unit error costs: displacement of the fix (local east/north/up, metres) for
 *   - each measurement: +1 ns on a TDOA, +1 Hz on an FDOA, +1 m on the altitude constraint
 *   - each collector: clock +1 ns, frequency reading +1 Hz, ephemeris position +1 m and velocity
 *     +1 cm/s along radial / in-track / cross-track.
 * Linear (first-order) and therefore scalable: 5 ns costs five times the 1 ns figure.
 * @returns {{observable:boolean,
 *   perMeasurement:{label:string, per:string, enu:number[], horiz:number, total:number}[],
 *   perCollector:{id:string, items:{kind:string, label:string, enu:number[], horiz:number, total:number}[]}[] }}
 */
export function sensitivityTable(S, t) {
  t = timeOf(S, t);
  const cov = covariance(S, t);
  if (!cov.observable) return { observable: false, perMeasurement: [], perCollector: [] };
  const F = frozen(S, t);
  const { layout, Kenu } = cov;
  const m = layout.length;
  const move = (dz) => [0, 1, 2].map((r) => { let s = 0; for (let k = 0; k < m; k++) s += Kenu[r][k] * dz[k]; return s; });
  const pack = (extra, enu) => ({ ...extra, enu, horiz: Math.hypot(enu[0], enu[1]), total: vnorm(enu) });
  const unit = { tdoa: 1e-9, fdoa: 1, alt: 1 }, unitLabel = { tdoa: '1 ns', fdoa: '1 Hz', alt: '1 m' };
  const perMeasurement = layout.map((q, k) => {
    const dz = new Array(m).fill(0); dz[k] = unit[q.type];
    return pack({ label: q.label, per: unitLabel[q.type] }, move(dz));
  });
  const obs = truthObservation(F, t);
  const fRef = obs.collectors[S.cfg.ref].freq;
  const h0 = predictor(F, t, layout, { fRef })(S.emitter.ecef);
  const perCollector = S.ids.map((id, c) => {
    const items = [];
    const diffRow = (type, val) => layout.map((q) => (q.type !== type ? 0 : (q.i === c ? val : 0) - (q.j === c ? val : 0)));
    items.push(pack({ kind: 'clock', label: 'clock +1 ns' }, move(diffRow('tdoa', 1e-9))));
    items.push(pack({ kind: 'freq', label: 'frequency +1 Hz' }, move(diffRow('fdoa', 1))));
    const eph = (kind, label, ric, isVel) => {
      const d = ricToEci(F.trajs[c], t, ric);
      const trajs = F.trajs.slice();
      trajs[c] = offsetTrajectory(F.trajs[c], isVel ? ZERO3 : d, isVel ? d : ZERO3, t);
      const h1 = predictor({ ...F, trajs }, t, layout, { trajs, fRef })(S.emitter.ecef);
      // The processor believes the wrong ephemeris, so it mis-predicts by (h1 - h0); the fix moves to compensate.
      items.push(pack({ kind, label }, move(h1.map((v, k) => -(v - h0[k])))));
    };
    eph('posR', 'position +1 m radial', [1, 0, 0], false);
    eph('posI', 'position +1 m in-track', [0, 1, 0], false);
    eph('posC', 'position +1 m cross-track', [0, 0, 1], false);
    eph('velR', 'velocity +1 cm/s radial', [0.01, 0, 0], true);
    eph('velI', 'velocity +1 cm/s in-track', [0, 0.01, 0], true);
    eph('velC', 'velocity +1 cm/s cross-track', [0, 0, 0.01], true);
    return { id, items };
  });
  return { observable: true, perMeasurement, perCollector };
}

/**
 * Time history through a pass.
 * @param {object} S
 * @param {number[]} times
 * @returns {{t:number, elevationDeg:number[], rangeKm:number[], tdoa:number[], fdoa:number[],
 *            allVisible:boolean, observable:boolean, drms:number, cep50:number, sigmaU:number,
 *            cumDrms:number, cumSigmaU:number}[]}
 *          tdoa/fdoa are per collector relative to the reference (reference entry = 0). drms/cep50/sigmaU:
 *          single-snapshot precision at that time. cumDrms/cumSigmaU: precision when all snapshots so far
 *          are combined, assuming their errors are independent (true for thermal noise; NOT true for
 *          slowly varying errors such as clock, oscillator and ephemeris biases - so this is optimistic).
 */
export function passSeries(S, times) {
  let Jsum = zeros(3, 3);
  return times.map((t) => {
    const obs = truthObservation(S, t);
    const cov = covariance(S, t);
    const allVisible = obs.collectors.every((c) => c.elevation > 5 * DEG);
    let cumDrms = NaN, cumSigmaU = NaN;
    if (cov.observable && allVisible) {
      const J = inverse(cov.P);
      if (J) Jsum = Jsum.map((r, i) => r.map((v, j) => v + J[i][j]));
    }
    const Pc = inverse(Jsum);
    if (Pc && Pc[0][0] > 0) { const E = enuCovariance(S, Pc); cumDrms = Math.sqrt(E[0][0] + E[1][1]); cumSigmaU = Math.sqrt(E[2][2]); }
    return {
      t, elevationDeg: obs.collectors.map((c) => c.elevation / DEG), rangeKm: obs.collectors.map((c) => c.range / 1000),
      tdoa: obs.tdoa, fdoa: obs.fdoa, allVisible, observable: cov.observable,
      drms: cov.observable ? cov.drms : NaN, cep50: cov.observable ? cov.cep50 : NaN, sigmaU: cov.observable ? cov.sigmaU : NaN,
      cumDrms, cumSigmaU,
    };
  });
}

/**
 * Lines of position: returns a function (east, north) -> { tdoa:number[], fdoa:number[] } | null giving
 * the TDOAs and FDOAs (per collector, relative to the reference) that an emitter sitting at that map
 * point - on the surface at the scenario's emitter altitude - would produce. Contour one component of it
 * to draw an iso-TDOA or iso-FDOA line on the Earth. (east, north) are metres in S.map coordinates.
 * Uses vacuum propagation for speed; the atmosphere shifts these curves by far less than a line width.
 */
export function mapField(S, t, o = {}) {
  t = timeOf(S, t);
  const F = frozen(S, t);
  const model = o.model || { ...FULL_MODEL, troposphere: false, ionosphere: false, shapiro: false };
  const opts = { model, env: S.cfg.env, ref: S.cfg.ref };
  const alt = o.altM ?? S.emitter.altM;
  return (east, north) => {
    const p = S.map.surfacePoint(east, north, alt);
    if (!p) return null;
    const obs = observe({ ecef: p, velEcef: ZERO3, f0: S.emitter.f0 }, F.trajs, t, opts);
    return { tdoa: obs.tdoa, fdoa: obs.fdoa, minElevation: Math.min(...obs.collectors.map((c) => c.elevation)) };
  };
}

/**
 * Weighted least-squares cost (chi-square) of a measurement set for a hypothesised emitter position at
 * map point (east, north) on the assumed-altitude surface: the "likelihood landscape" the solver descends.
 * @returns {(east:number, north:number)=>number} NaN where the point is off the Earth
 */
export function costField(S, t, meas) {
  t = timeOf(S, t);
  const F = frozen({ ...S, trajs: meas.trajs || S.trajs }, t);
  const layout = meas.layout.filter((m) => m.type !== 'alt');
  const keep = meas.layout.map((m, k) => (m.type !== 'alt' ? k : -1)).filter((k) => k >= 0);
  const z = keep.map((k) => meas.z[k]);
  const obs = meas.obs || truthObservation(S, t);
  const budget = collectorErrorBudget(S, obs);
  const R = measCov(layout, budget.varT, budget.varF, S.cfg.noise.sigmaAlt);
  const Rinv = inverse(R);
  const h = predictor(F, t, layout, { model: { ...S.cfg.solver, troposphere: false, ionosphere: false, shapiro: false }, trajs: F.trajs, fRef: meas.fRef });
  return (east, north) => {
    const p = S.map.surfacePoint(east, north, meas.altAssumed ?? S.emitter.altM);
    if (!p || !Rinv) return NaN;
    const hx = h(p);
    let s = 0;
    for (let i = 0; i < z.length; i++) for (let j = 0; j < z.length; j++) s += (z[i] - hx[i]) * Rinv[i][j] * (z[j] - hx[j]);
    return s;
  };
}

/**
 * One sheet of the hyperboloid of constant range difference |P - Fi| - |P - Fj| = delta, as a triangle
 * mesh in the same coordinates as the foci (use collector ECEF positions and delta = c * TDOA_ij).
 * @param {number[]} Fi
 * @param {number[]} Fj
 * @param {number} delta   range difference, m (|delta| must be less than the distance between the foci)
 * @param {{extent?:number, nu?:number, nphi?:number}} [o] extent = how far the sheet extends from the axis, m
 * @returns {{positions:number[], indices:number[]}|null}
 */
export function hyperboloidMesh(Fi, Fj, delta, o = {}) {
  const extent = o.extent ?? 3.0e6, nu = o.nu ?? 28, nphi = o.nphi ?? 48;
  const axisV = vsub(Fj, Fi), D = vnorm(axisV);
  const a = Math.abs(delta) / 2, cf = D / 2;
  if (!(a < cf)) return null;
  const b = Math.sqrt(cf * cf - a * a);
  const ax = axisV.map((v) => v / D);
  // Any two unit vectors perpendicular to the axis.
  const tmp = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let e1 = [ax[1] * tmp[2] - ax[2] * tmp[1], ax[2] * tmp[0] - ax[0] * tmp[2], ax[0] * tmp[1] - ax[1] * tmp[0]];
  const n1 = vnorm(e1); e1 = e1.map((v) => v / n1);
  const e2 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
  const centre = [(Fi[0] + Fj[0]) / 2, (Fi[1] + Fj[1]) / 2, (Fi[2] + Fj[2]) / 2];
  const sgn = delta >= 0 ? 1 : -1; // delta > 0: farther from Fi, i.e. the sheet wrapped around Fj
  const uMax = Math.asinh(extent / b);
  const positions = [], indices = [];
  for (let iu = 0; iu <= nu; iu++) {
    const u = uMax * iu / nu, along = sgn * a * Math.cosh(u), rad = b * Math.sinh(u);
    for (let ip = 0; ip < nphi; ip++) {
      const phi = 2 * Math.PI * ip / nphi, cph = Math.cos(phi), sph = Math.sin(phi);
      for (let k = 0; k < 3; k++) positions.push(centre[k] + ax[k] * along + rad * (cph * e1[k] + sph * e2[k]));
    }
  }
  for (let iu = 0; iu < nu; iu++) {
    for (let ip = 0; ip < nphi; ip++) {
      const a0 = iu * nphi + ip, a1 = iu * nphi + (ip + 1) % nphi, b0 = a0 + nphi, b1 = a1 + nphi;
      indices.push(a0, b0, a1, a1, b0, b1);
    }
  }
  return { positions, indices };
}

export { IDS, stateEciToEcef, ecefVecToEnu };
