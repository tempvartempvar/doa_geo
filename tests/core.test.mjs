// Numerical tests for the physics core. Run with:  npm test   (or: node --test tests/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  constants, linalg, estimate, planar, frames, orbits, measure, scenario, stein, atmosphere,
} from '../js/core/index.js';

const { C, GM, OMEGA_E, DEG, WGS84_A, WGS84_B } = constants;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a} (tol ${tol})`);
const rel = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg || ''} expected ${b}, got ${a} (rel tol ${tol})`);

// ---------------------------------------------------------------- linear algebra
test('linalg: inverse, cholesky, eigen, chi radii', () => {
  const A = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]];
  const Ai = linalg.inverse(A);
  const I = linalg.matMul(A, Ai);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(I[i][j], i === j ? 1 : 0, 1e-14);
  const L = linalg.cholesky(A);
  const LLt = linalg.matMul(L, linalg.transpose(L));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(LLt[i][j], A[i][j], 1e-14);
  const { values, vectors } = linalg.symEig(A);
  for (let k = 0; k < 3; k++) {
    const Av = linalg.matVec(A, vectors[k]);
    for (let i = 0; i < 3; i++) close(Av[i], values[k] * vectors[k][i], 1e-12);
  }
  assert.ok(values[0] >= values[1] && values[1] >= values[2]);
  assert.equal(linalg.inverse([[1, 2], [2, 4]]), null);
  close(linalg.chiRadius(0.95, 2), 2.447747, 1e-5);
  close(linalg.chiRadius(0.95, 3), 2.795483, 1e-5);
  close(linalg.chiRadius(0.6827, 1), 1.0, 1e-3);
});

test('estimate: CEP of a circular Gaussian is 1.1774 sigma; elongated limit is 0.6745 sigma', () => {
  close(estimate.cep([[1, 0], [0, 1]]), 1.17741, 1e-4);
  close(estimate.cep([[1, 0], [0, 1e-12]]), 0.67449, 1e-4);
  const e = estimate.errorEllipse([[4, 0], [0, 1]], 0.95);
  close(e.semiMajor, 2 * 2.447747, 1e-5); close(e.semiMinor, 2.447747, 1e-5); close(e.angle, 0, 1e-12);
});

// ---------------------------------------------------------------- frames
test('frames: geodetic round trip and known points', () => {
  const p = frames.geodeticToEcef(0, 0, 0);
  close(p[0], WGS84_A, 1e-9); close(p[1], 0, 1e-9); close(p[2], 0, 1e-9);
  close(frames.geodeticToEcef(Math.PI / 2, 0, 0)[2], WGS84_B, 1e-8);
  for (const lat of [-89.9, -45, -1, 0, 0.5, 38.9, 67, 89.999]) {
    for (const lon of [-179, -77, 0, 23, 140]) {
      for (const h of [-400, 0, 800, 550e3, 20200e3, 35786e3]) {
        const g = frames.ecefToGeodetic(frames.geodeticToEcef(lat * DEG, lon * DEG, h));
        close(g.lat, lat * DEG, 1e-12, 'lat'); close(g.lon, lon * DEG, 1e-12, 'lon'); close(g.h, h, 2e-8, `h at lat ${lat}`);
      }
    }
  }
});

test('frames: ECI<->ECEF state round trip; a point fixed on the Earth moves east at omega*r in ECI', () => {
  const r = frames.geodeticToEcef(30 * DEG, 50 * DEG, 0);
  const s = frames.stateEcefToEci(r, [0, 0, 0], 1234.5);
  rel(Math.hypot(...s.v), OMEGA_E * Math.hypot(r[0], r[1]), 1e-14);
  const b = frames.stateEciToEcef(s.r, s.v, 1234.5);
  for (let k = 0; k < 3; k++) { close(b.r[k], r[k], 1e-8); close(b.v[k], 0, 1e-11); }
});

test('frames: localMap surfacePoint lies on the requested height and round-trips', () => {
  const m = frames.localMap(38.9, -77, 120);
  for (const [e, n] of [[0, 0], [1e3, -2e3], [250e3, 100e3], [-600e3, 400e3]]) {
    const p = m.surfacePoint(e, n);
    close(frames.heightOf(p), 120, 1e-5);
    const enu = m.toEnu(p);
    close(enu[0], e, 1e-6); close(enu[1], n, 1e-6);
  }
});

// ---------------------------------------------------------------- orbits
test('orbits: Kepler state conserves energy and angular momentum; v is dr/dt', () => {
  const el = { a: 7000e3, e: 0.3, i: 63 * DEG, raan: 40 * DEG, argp: 270 * DEG, M0: 0.3 };
  const energy = (s) => 0.5 * linalg.vdot(s.v, s.v) - GM / linalg.vnorm(s.r);
  const s0 = orbits.keplerState(el, 0);
  const h0 = linalg.cross3(s0.r, s0.v);
  for (const t of [10, 500, 3000, 9000]) {
    const s = orbits.keplerState(el, t);
    rel(energy(s), -GM / (2 * el.a), 1e-13);
    const h = linalg.cross3(s.r, s.v);
    for (let k = 0; k < 3; k++) close(h[k], h0[k], 1e-4 /* m^2/s out of ~5e10 */);
    const dt = 1e-2, p = orbits.keplerState(el, t + dt), m = orbits.keplerState(el, t - dt);
    for (let k = 0; k < 3; k++) close((p.r[k] - m.r[k]) / (2 * dt), s.v[k], 2e-5);
  }
  rel(orbits.period(el.a), 2 * Math.PI * Math.sqrt(el.a ** 3 / GM), 1e-15);
});

test('orbits: frozen (Taylor) trajectory matches Kepler to < 1e-7 m within +-0.2 s', () => {
  const el = { a: WGS84_A + 550e3, e: 0.002, i: 53 * DEG, raan: 1, argp: 2, M0: 0.5 };
  const traj = orbits.keplerTrajectory(el), fz = orbits.freezeTrajectory(traj, 100);
  for (const dt of [-0.2, -0.05, 0.01, 0.2]) {
    const a = traj.state(100 + dt), b = fz.state(100 + dt);
    assert.ok(linalg.vdist(a.r, b.r) < 1e-7, `pos err ${linalg.vdist(a.r, b.r)}`);
    assert.ok(linalg.vdist(a.v, b.v) < 1e-9, `vel err ${linalg.vdist(a.v, b.v)}`);
  }
});

test('orbits: pass geometry and formation offsets come out as requested', () => {
  const ref = orbits.orbitOverPoint({ latDeg: 38.9, lonDeg: -77, altKm: 550, incDeg: 53, ascending: true, tPass: 0 });
  assert.ok(ref.overhead);
  const sub = frames.ecefToGeodetic(frames.eciToEcef(orbits.keplerState(ref, 0).r, 0));
  // Sub-satellite direction passes through the point (compare geocentric directions).
  const target = frames.geodeticToEcef(38.9 * DEG, -77 * DEG, 0);
  const satDir = linalg.vunit(orbits.keplerState(ref, 0).r), tgtDir = linalg.vunit(target);
  assert.ok(Math.acos(Math.min(1, linalg.vdot(satDir, tgtDir))) < 1e-9, 'not overhead');
  close(sub.lon, -77 * DEG, 1e-9);
  const want = [{ along: 80e3 }, { along: -40e3, cross: 60e3 }, { cross: -70e3, radial: 15e3 }];
  const els = orbits.makeFormation(ref, 0, want);
  const s0 = orbits.keplerState(ref, 0);
  els.forEach((el, k) => {
    const d = orbits.relativeRic(s0, orbits.keplerState(el, 0));
    close(d.along, want[k].along || 0, 900, 'along');   // first-order element offsets: sub-km accuracy at ~100 km
    close(d.cross, want[k].cross || 0, 900, 'cross');
    close(d.radial, want[k].radial || 0, 900, 'radial');
    rel(el.a, ref.a, 1e-15); // identical period: the formation does not drift apart
  });
});

// ---------------------------------------------------------------- flat-world model
test('planar: analytic gradients match finite differences', () => {
  const A = { p: [-40e3, 0], v: [200, 30] }, B = { p: [35e3, 10e3], v: [-50, 180] };
  const e = [12e3, 55e3], f0 = 1.2e9, h = 1;
  const gT = planar.gradTdoa(A, B, e), gF = planar.gradFdoa(A, B, e, f0);
  const fdT = [(planar.tdoa(A, B, [e[0] + h, e[1]]) - planar.tdoa(A, B, [e[0] - h, e[1]])) / (2 * h),
    (planar.tdoa(A, B, [e[0], e[1] + h]) - planar.tdoa(A, B, [e[0], e[1] - h])) / (2 * h)];
  const fdF = [(planar.fdoa(A, B, [e[0] + h, e[1]], f0) - planar.fdoa(A, B, [e[0] - h, e[1]], f0)) / (2 * h),
    (planar.fdoa(A, B, [e[0], e[1] + h], f0) - planar.fdoa(A, B, [e[0], e[1] - h], f0)) / (2 * h)];
  for (let k = 0; k < 2; k++) { rel(gT[k], fdT[k], 1e-7); rel(gF[k], fdF[k], 1e-6); }
  // Sign conventions: emitter nearer B -> tau_AB = t_A - t_B > 0 ; A closing on the emitter -> positive Doppler.
  assert.ok(planar.tdoa(A, B, [30e3, 10e3]) > 0);
  assert.ok(planar.doppler({ p: [0, 0], v: [100, 0] }, [1e4, 0], 1e9) > 0);
  rel(planar.doppler({ p: [0, 0], v: [100, 0] }, [1e4, 0], 1e9), 1e9 * 100 / C, 1e-14);
});

test('planar: solver recovers the emitter; Monte-Carlo scatter matches the CRLB; DOP is reference-free', () => {
  const cs = [{ p: [-50e3, 0], v: [250, 0] }, { p: [50e3, 5e3], v: [240, 40] }, { p: [0, -60e3], v: [0, 260] }];
  const e = [20e3, 70e3], f0 = 1e9, noise = { sigmaT: 30e-9, sigmaF: 0.5 };
  const meas = planar.measurementList(3);
  const z = planar.predict(meas, cs, e, f0);
  const res = planar.locate({ meas, collectors: cs, z, f0, noise, x0: [0, 20e3] });
  assert.ok(res.converged);
  close(res.x[0], e[0], 1e-3); close(res.x[1], e[1], 1e-3);
  const P = planar.crlb(meas, cs, e, f0, noise);
  const mc = planar.monteCarlo({ meas, collectors: cs, e, f0, noise, trials: 4000, seed: 7 });
  assert.equal(mc.failures, 0);
  const st = estimate.sampleStats(mc.points);
  rel(st.cov[0][0], P[0][0], 0.08); rel(st.cov[1][1], P[1][1], 0.08);
  close(st.cov[0][1] / Math.sqrt(P[0][0] * P[1][1]), P[0][1] / Math.sqrt(P[0][0] * P[1][1]), 0.05);
  // TDOA-only CRLB with per-collector noise equals DOP * c * sigma, whichever collector is the reference.
  const dop = planar.tdoaDop(cs.map((c) => c.p), e);
  for (const ref of [0, 1, 2]) {
    const Pt = planar.crlb(planar.measurementList(3, { fdoa: false, ref }), cs, e, f0, noise);
    rel(Math.sqrt(Pt[0][0] + Pt[1][1]), dop * C * noise.sigmaT, 1e-9);
  }
  // gain: a 1 Hz error on the first FDOA moves the fix by column K[:,2]
  const K = planar.gainMatrix(meas, cs, e, f0, noise);
  const z2 = z.slice(); z2[2] += 1e-3;
  const r2 = planar.locate({ meas, collectors: cs, z: z2, f0, noise, x0: e });
  rel(r2.x[0] - e[0], K[0][2] * 1e-3, 1e-3); rel(r2.x[1] - e[1], K[1][2] * 1e-3, 1e-3);
});

// ---------------------------------------------------------------- full measurement model
const VAC = { ...measure.FULL_MODEL, shapiro: false, troposphere: false, ionosphere: false };

test('measure: light-time equation is satisfied and the Sagnac identity holds', () => {
  const S = scenario.buildScenario(scenario.defaultConfig({ formation: { shape: 'tri+1', baselineKm: 800 } }));
  const t0 = 37;
  const obs = measure.observe(S.emitter, S.trajs, t0, { model: VAC });
  const emEci = frames.ecefToEci(S.emitter.ecef, obs.te);
  obs.collectors.forEach((c, i) => {
    // (1) straight-line inertial distance from emission event to reception event equals c * delay
    const rc = S.trajs[i].state(obs.te + c.delay).r;
    close(linalg.vdist(rc, emEci), C * c.delay, 2e-8, 'light-time residual (m)');
    // (2) the same delay from Earth-fixed coordinates needs the Sagnac term
    const ecefRange = linalg.vdist(c.rEcef, S.emitter.ecef);
    //     The closed form (omega/c^2)(x_e y_c - y_e x_c) is first order in omega*delay; what is left over is
    //     of order (omega*delay)^2 R / c + (omega R delay)^2 / (2 rho c) ~ 5e-15 s (a micrometre or two).
    close(c.delay - ecefRange / C, c.sagnac, 2e-14, 'Sagnac identity (s)');
    assert.ok(Math.abs(c.sagnac) > 1e-10 && Math.abs(c.sagnac) < 1e-7);
  });
  close(obs.te + obs.collectors[0].delay, t0, 1e-12);
});

test('measure: exact Doppler factor equals d(te)/d(t_receive) by numerical differentiation', () => {
  const S = scenario.buildScenario(scenario.defaultConfig({ emitter: { latDeg: -20, lonDeg: 130, altM: 300, f0: 2e9, velEnu: [15, -8, 0] } }));
  for (const model of [VAC, measure.FULL_MODEL]) {
    for (let i = 0; i < S.n; i++) {
      // Make collector i the reference so that its reception time is the independent variable.
      const f = (tr) => measure.observe(S.emitter, S.trajs, tr, { model, env: S.cfg.env, ref: i });
      const t0 = 12, h = 0.02;
      // te(tr) = tr - delay(tr): differentiate the delay (a small number) to keep precision.
      // NB the emitter position is defined at the epoch passed to observe(), so hold it fixed:
      const em0 = S.emitter;
      const emAt = (tr) => ({ ...em0, ecef: em0.ecef.map((v, k) => v + em0.velEcef[k] * (tr - t0)) });
      const d = (tr) => {
        const o = measure.observe(emAt(tr), S.trajs, tr, { model, env: S.cfg.env, ref: i });
        const c = o.collectors[i];
        // group delay -> phase delay (the carrier sees tropo - iono, the envelope tropo + iono)
        return c.delay - 2 * c.iono / C;
      };
      const dDelay = (d(t0 + h) - d(t0 - h)) / (2 * h);
      const D = f(t0).collectors[i].dopplerFactor;
      close(D, 1 - dDelay, 3e-13, `collector ${i} ${model === VAC ? 'vacuum' : 'full'}`);
    }
  }
});

test('measure: first-order sanity - Doppler shift ~ -f0/c * range rate, TDOA ~ range difference / c', () => {
  const S = scenario.buildScenario(scenario.defaultConfig());
  const obs = measure.observe(S.emitter, S.trajs, 0, { model: VAC });
  obs.collectors.forEach((c, i) => {
    rel(c.dopplerShift, -S.emitter.f0 * c.rangeRate / C, 2e-4);
    close(obs.tdoa[i], (c.range - obs.collectors[0].range) / C, 1e-15);
    assert.ok(c.visible && c.elevation > 20 * DEG);
  });
  // changing the reference collector only re-bases the differences
  const o2 = measure.observe(S.emitter, S.trajs, 0, { model: VAC, ref: 2 });
  // (same wavefront only if it reaches collector 2 at the same instant; compare a re-timed run)
  const o3 = measure.observe(S.emitter, S.trajs, o2.te + o2.collectors[0].delay, { model: VAC, ref: 0 });
  for (let i = 0; i < S.n; i++) close(o2.tdoa[i] - o2.tdoa[0], o3.tdoa[i], 1e-13);
});

test('measure: clock rates - LEO runs slow, GEO runs fast, a geoid clock keeps coordinate time', () => {
  const leo = orbits.keplerState({ a: WGS84_A + 550e3, e: 0, i: 0.9, raan: 0, argp: 0, M0: 0 }, 0);
  const geo = orbits.keplerState({ a: 42164.17e3, e: 0, i: 0, raan: 0, argp: 0, M0: 0 }, 0);
  const kLeo = measure.clockRate(leo.r, leo.v) - 1, kGeo = measure.clockRate(geo.r, geo.v) - 1;
  assert.ok(kLeo < -2.0e-10 && kLeo > -3.2e-10, `LEO ${kLeo}`);
  assert.ok(kGeo > 5.0e-10 && kGeo < 5.8e-10, `GEO ${kGeo}`);
  const g = frames.stateEcefToEci(frames.geodeticToEcef(0, 0, 0), [0, 0, 0], 0);
  assert.ok(Math.abs(measure.clockRate(g.r, g.v) - 1) < 5e-15);
});

test('atmosphere: magnitudes and elevation dependence', () => {
  close(atmosphere.troposphereDelay(Math.PI / 2, 0), 2.45, 0.01);
  rel(atmosphere.troposphereDelay(30 * DEG, 0), 2 * 2.45, 0.01);
  // 1 TECU at L1 (1575.42 MHz) is 0.1624 m at zenith
  close(atmosphere.ionosphereDelay(Math.PI / 2, 1575.42e6, { vtec: 1 }), 0.1624, 1e-4);
  assert.ok(atmosphere.ionosphereDelay(10 * DEG, 1e9) / atmosphere.ionosphereDelay(Math.PI / 2, 1e9) > 2.3);
});

// ---------------------------------------------------------------- scenario engine
test('scenario: noise-free solve returns the truth, from 30 km away, for 2-, 3- and 4-ball sets', () => {
  for (const shape of ['pair', 'triangle', 'tri+1']) {
    const S = scenario.buildScenario(scenario.defaultConfig({ formation: { shape, baselineKm: 200 } }));
    const meas = scenario.simulateMeasurements(S, 0, null);
    const x0 = S.map.surfacePoint(22e3, -20e3);
    const fix = scenario.solveFix(S, 0, meas, { x0 });
    assert.ok(fix.converged, shape);
    assert.ok(fix.err3d < 1e-3, `${shape}: residual error ${fix.err3d} m`);
  }
});

test('scenario: 4-ball TDOA-only 3-D fix works with no altitude constraint; fewer balls are unobservable', () => {
  const use = { tdoa: true, fdoa: false, altitude: false };
  const S4 = scenario.buildScenario(scenario.defaultConfig({ use, formation: { shape: 'tri+1', baselineKm: 600 } }));
  assert.ok(scenario.covariance(S4).observable);
  const fix = scenario.solveFix(S4, 0, scenario.simulateMeasurements(S4, 0, null), { x0: S4.map.fromEnu([4e3, -3e3, 2e3]) });
  assert.ok(fix.err3d < 1e-2, `err ${fix.err3d}`);
  const S3 = scenario.buildScenario(scenario.defaultConfig({ use, formation: { shape: 'triangle', baselineKm: 600 } }));
  assert.equal(scenario.covariance(S3).observable, false);
});

test('scenario: Monte-Carlo errors agree with the Cramer-Rao covariance', () => {
  const S = scenario.buildScenario(scenario.defaultConfig());
  const cov = scenario.covariance(S);
  const mc = scenario.monteCarlo(S, { trials: 3000, seed: 11 });
  assert.ok(mc.failures === 0);
  rel(mc.cov[0][0], cov.Penu[0][0], 0.1, 'var E'); rel(mc.cov[1][1], cov.Penu[1][1], 0.1, 'var N'); rel(mc.cov[2][2], cov.Penu[2][2], 0.1, 'var U');
  rel(mc.cep50, cov.cep50, 0.06, 'CEP');
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(mc.mean[k]) < 4 * Math.sqrt(cov.Penu[k][k] / mc.errors.length), `bias in component ${k}`);
});

test('scenario: sensitivity table predicts the effect of a deliberate 1 Hz / 5 ns collector error', () => {
  const base = scenario.defaultConfig();
  const S = scenario.buildScenario(base);
  const sn = scenario.sensitivityTable(S);
  const Sb = scenario.buildScenario(scenario.defaultConfig({ bias: { clock: [0, 5e-9, 0, 0], freq: [0, 0, 1, 0], posRic: [], velRic: [], alt: 0 } }));
  const fix = scenario.solveFix(Sb, 0, scenario.simulateMeasurements(Sb, 0, null));
  const clk = sn.perCollector[1].items.find((q) => q.kind === 'clock').enu;
  const frq = sn.perCollector[2].items.find((q) => q.kind === 'freq').enu;
  for (let k = 0; k < 3; k++) close(fix.errEnu[k], 5 * clk[k] + frq[k], 0.02 * (Math.abs(5 * clk[k] + frq[k]) + 1));
  // ephemeris: collector D believed 3 m too far along-track
  const Se = scenario.buildScenario(scenario.defaultConfig({ bias: { clock: [], freq: [], posRic: [null, null, null, [0, 3, 0]], velRic: [], alt: 0 } }));
  const fe = scenario.solveFix(Se, 0, scenario.simulateMeasurements(Se, 0, null));
  const pI = sn.perCollector[3].items.find((q) => q.kind === 'posI').enu;
  for (let k = 0; k < 3; k++) close(fe.errEnu[k], 3 * pI[k], 0.02 * (Math.abs(3 * pI[k]) + 1));
});

test('scenario: effects table - orders of magnitude are physical', () => {
  const S = scenario.buildScenario(scenario.defaultConfig());
  const fx = Object.fromEntries(scenario.effectsTable(S).map((r) => [r.key, r]));
  assert.ok(fx.instant.maxTdoa > 1e-10 && fx.instant.maxTdoa < 1e-7);
  assert.ok(fx.sagnac.maxTdoa > 1e-11 && fx.sagnac.maxTdoa < 1e-8);
  assert.ok(fx.shapiro.maxTdoa < 1e-11);
  assert.ok(fx.iono.maxTdoa > fx.shapiro.maxTdoa * 100);
  assert.ok(fx.motion.maxFdoa > 0.05 && fx.motion.maxFdoa < 3.4, `1 m/s at 1 GHz is at most 3.3 Hz: ${fx.motion.maxFdoa}`);
  for (const k of Object.keys(fx)) assert.ok(fx[k].biasHoriz !== null && isFinite(fx[k].biasHoriz), k);
  // Ionosphere scales as 1/f^2
  const S2 = scenario.buildScenario(scenario.defaultConfig({ emitter: { ...S.cfg.emitter, f0: 2e9 } }));
  const fx2 = Object.fromEntries(scenario.effectsTable(S2).map((r) => [r.key, r]));
  rel(fx2.iono.maxTdoa, fx.iono.maxTdoa / 4, 1e-3);
});

test('scenario: lines of position pass through the emitter; hyperboloid mesh has the right range difference', () => {
  const S = scenario.buildScenario(scenario.defaultConfig());
  const f = scenario.mapField(S)(0, 0);
  const obs = measure.observe(S.emitter, S.trajs, 0, { model: VAC });
  for (let i = 0; i < S.n; i++) { close(f.tdoa[i], obs.tdoa[i], 1e-13); close(f.fdoa[i], obs.fdoa[i], 1e-6); }
  const Fi = [7e6, 0, 0], Fj = [6.9e6, 3e5, 1e5];
  for (const delta of [1.2e5, -2.0e5]) {
    const m = scenario.hyperboloidMesh(Fi, Fj, delta, { nu: 6, nphi: 8 });
    for (let k = 0; k < m.positions.length; k += 3) {
      const p = m.positions.slice(k, k + 3);
      close(linalg.vdist(p, Fi) - linalg.vdist(p, Fj), delta, 1e-4);
    }
  }
});

// ---------------------------------------------------------------- CAF bounds
test('stein: worked example and scaling laws', () => {
  const p = { B: 25e3, T: 1, snr1: 10, snr2: 10 };
  const g = stein.effectiveSnr(10, 10);
  close(g, 2 / (0.1 + 0.1 + 0.01), 1e-12);
  rel(stein.tdoaSigma(p), Math.sqrt(3) / (Math.PI * 25e3 * Math.sqrt(25e3 * g)), 1e-12);
  rel(stein.fdoaSigma(p), Math.sqrt(3) / (Math.PI * Math.sqrt(25e3 * g)), 1e-12);
  rel(stein.fdoaSigma({ ...p, T: 4 }), stein.fdoaSigma(p) / 8, 1e-12);       // T^-3/2
  rel(stein.tdoaSigma({ ...p, B: 100e3 }), stein.tdoaSigma(p) / 8, 1e-12);    // B^-3/2 when Bs = B
  rel(Math.hypot(stein.toaSigma({ B: 25e3, T: 1, snr: 1e4 }), stein.toaSigma({ B: 25e3, T: 1, snr: 1e4 })), stein.tdoaSigma({ B: 25e3, T: 1, snr1: 1e4, snr2: 1e4 }), 1e-3);
});
