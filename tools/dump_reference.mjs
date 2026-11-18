// Runs the JS physics engine on a fixed set of scenarios and writes tools/reference.json
// (all inputs + all JS outputs) for the independent high-precision cross-check in crosscheck.py.
//   node tools/dump_reference.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scenario, measure, orbits, frames, constants, stein } from '../js/core/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEG = constants.DEG;

const MODELS = {
  full: { ...measure.FULL_MODEL, properTimeLO: false },
  properTime: { ...measure.FULL_MODEL, properTimeLO: true },
  vacuum: { ...measure.FULL_MODEL, properTimeLO: false, shapiro: false, troposphere: false, ionosphere: false },
  noRetard: { ...measure.FULL_MODEL, properTimeLO: false, retarded: false },
  noRotation: { ...measure.FULL_MODEL, properTimeLO: false, earthRotation: false },
  firstOrder: { ...measure.FULL_MODEL, properTimeLO: false, dopplerExact: false },
};

const plain = (x) => JSON.parse(JSON.stringify(x));

function runScenario(name, over, times) {
  const cfg = scenario.defaultConfig(over);
  const S = scenario.buildScenario(cfg);
  const out = {
    name, over: plain(over),
    emitter: { ecef: S.emitter.ecef, velEcef: S.emitter.velEcef, f0: S.emitter.f0, latDeg: S.emitter.latDeg, lonDeg: S.emitter.lonDeg, altM: S.emitter.altM },
    elements: plain(S.elements), env: plain(cfg.env), runs: [],
  };
  for (const t of times) {
    for (const [mname, model] of Object.entries(MODELS)) {
      const obs = measure.observe(S.emitter, S.trajs, t, { model, env: cfg.env, ref: 0 });
      out.runs.push({
        t0: t, model: mname, switches: model, te: obs.te, tdoa: obs.tdoa, fdoa: obs.fdoa, ratio: obs.ratio,
        collectors: obs.collectors.map((c) => ({
          delay: c.delay, tr: c.tr, range: c.range, rangeRate: c.rangeRate, elevation: c.elevation, azimuth: c.azimuth,
          visible: c.visible, dopplerFactor: c.dopplerFactor, clockRate: c.clockRate, ratio: c.ratio, freq: c.freq,
          tropo: c.tropo, iono: c.iono, shapiro: c.shapiro, phaseRate: c.phaseRate, sagnac: c.sagnac,
          rEci: c.rEci, vEci: c.vEci, rEcef: c.rEcef, vEcef: c.vEcef,
        })),
      });
    }
  }
  return { out, S };
}

const scen = [];
const A = runScenario('A_default', {}, [-120, 0, 90]);
scen.push(A.out);
scen.push(runScenario('B_wide', { formation: { shape: 'tri+1', baselineKm: 1500 } }, [0]).out);
scen.push(runScenario('C_highlat', {
  emitter: { latDeg: 68, lonDeg: 23, altM: 800, f0: 4.0e8, velEnu: [0, 0, 0] },
  orbit: { altKm: 800, incDeg: 98, ascending: false, passOffsetKm: { east: -600, north: 100 } },
}, [30]).out);
scen.push(runScenario('D_moving', { emitter: { velEnu: [20, -15, 0], f0: 1.0e10 } }, [0]).out);
// E: mixed altitudes. MEO placed near (40N, -77E) at t = 0: u = asin(sin40/sin55), dlon = atan(cos55 tan u).
const u = Math.asin(Math.sin(40 * DEG) / Math.sin(55 * DEG));
const dlon = Math.atan(Math.cos(55 * DEG) * Math.tan(u));
const meo = { a: 26560e3, e: 0.01, i: 55 * DEG, raan: -77 * DEG - dlon, argp: 30 * DEG, M0: u - 30 * DEG };
const geo = { a: 42164.17e3, e: 0.0002, i: 0.05 * DEG, raan: 0, argp: 0, M0: -75 * DEG };
scen.push(runScenario('E_mixed', { elements: [A.S.elements[0], meo, geo] }, [0]).out);

// ---- frames round trips
const geod = [];
for (const latDeg of [-89.999, -60, -33.3, 0, 12.5, 45, 77.7, 89.999]) {
  for (const h of [-400, 0, 1234.5, 550e3, 20200e3, 36000e3]) {
    const lonDeg = -170 + ((latDeg * 7 + h / 1000) % 340 + 340) % 340;
    const ecef = frames.geodeticToEcef(latDeg * DEG, lonDeg * DEG, h);
    const back = frames.ecefToGeodetic(ecef);
    geod.push({ lat: latDeg * DEG, lon: lonDeg * DEG, h, ecef, back });
  }
}

// ---- Kepler states
const kepEls = [
  A.S.elements[0],
  { a: 7000e3, e: 0.05, i: 0.9, raan: 1.1, argp: 2.2, M0: 0.3 },
  { a: 12000e3, e: 0.3, i: 1.2, raan: -0.7, argp: 0.4, M0: 3.0 },
  { a: 26560e3, e: 0.7, i: 1.1, raan: 4.0, argp: -1.3, M0: 0.05 },
  { a: 26560e3, e: 0.7, i: 1.1, raan: 4.0, argp: -1.3, M0: 3.1 },
  meo, geo,
];
const kepTimes = [-5000, -120, 0, 0.37, 90, 3333.3, 86400];
const kep = kepEls.map((el) => ({ el, states: kepTimes.map((t) => ({ t, ...orbits.keplerState(el, t) })) }));
// derivative check data: JS position at t +- h
const kepDeriv = kepEls.map((el) => ({ el, t: 90, h: 1e-3, rp: orbits.keplerState(el, 90 + 1e-3).r, rm: orbits.keplerState(el, 90 - 1e-3).r, v: orbits.keplerState(el, 90).v }));

// ---- frozen trajectories
const frozen = [];
for (const tc of [0, 90]) {
  const traj = orbits.keplerTrajectory(A.S.elements[0]);
  const fz = orbits.freezeTrajectory(traj, tc);
  for (const dt of [-0.2, -0.05, -0.01, 0.01, 0.05, 0.2]) { const k = traj.state(tc + dt); frozen.push({ el: A.S.elements[0], tc, dt, ...fz.state(tc + dt), rk: k.r, vk: k.v }); }
}

// ---- clock rates
const Re = constants.WGS84_A;
const leoEl = { a: Re + 550e3, e: 0, i: 53 * DEG, raan: 0.3, argp: 0, M0: 0.8 };
const geoEl = { a: 42164.17e3, e: 0, i: 0, raan: 0, argp: 0, M0: 0 };
const clocks = [];
for (const [name, st] of [['LEO550', orbits.keplerState(leoEl, 0)], ['GEO', orbits.keplerState(geoEl, 0)],
  ['equatorRest', { r: [Re, 0, 0], v: [0, constants.OMEGA_E * Re, 0] }]]) {
  clocks.push({ name, r: st.r, v: st.v, rate: measure.clockRate(st.r, st.v) });
}

// ---- Stein
const steinCases = [
  { B: 1e6, T: 0.1, snr1: 10, snr2: 10 },
  { B: 5e6, T: 1.0, snr1: 0.5, snr2: 3, Bs: 2e6 },
  { B: 25e3, T: 0.01, snr1: 100, snr2: 1 },
].map((p) => ({ p, tdoa: stein.tdoaSigma(p), fdoa: stein.fdoaSigma(p) }));

const constOut = { C: constants.C, GM: constants.GM, OMEGA_E: constants.OMEGA_E, A: constants.WGS84_A, F: constants.WGS84_F, J2: constants.J2, W0: constants.W0, R_MEAN: constants.R_MEAN };
writeFileSync(join(here, 'reference.json'), JSON.stringify({ constants: constOut, scenarios: scen, geod, kep, kepDeriv, frozen, clocks, stein: steinCases }, null, 1));
console.log('wrote tools/reference.json:', scen.length, 'scenarios');
