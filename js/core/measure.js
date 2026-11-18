/**
 * High-fidelity TDOA / FDOA measurement model: a ground emitter observed by orbiting collectors.
 *
 * THE PHYSICS
 * ----------
 * Work in the Earth-centred INERTIAL frame, where light travels in straight lines at c.
 * A wavefront leaves the emitter at coordinate time te from r_e(te) - the emitter is carried eastward by
 * the Earth's rotation - and reaches collector i at time t_i where it then is:
 *
 *     t_i = te + ( |r_i(t_i) - r_e(te)| + X_i ) / c                      (light-time equation)
 *
 * X_i is the excess path from the troposphere, the ionosphere and the Sun-independent Shapiro delay of
 * the Earth's gravity. The equation is implicit (a LEO collector moves ~20 m while the signal is in
 * flight) and is solved by fixed-point iteration to floating-point precision.
 *
 *     TDOA_ij = t_i - t_j                    for the SAME wavefront.
 *
 * Differentiating the light-time equation gives the exact rate at which emitted cycles arrive:
 *
 *     D_i = dte/dt_i = (1 - n_i.v_i/c) / (1 - n_i.v_e/c + Xdot_i/c)      (n_i: unit vector emitter->collector)
 *
 * so collector i receives f_i = f0 * D_i and  FDOA_ij = f_i - f_j.  v_e is the emitter's INERTIAL
 * velocity (Earth rotation, ~465 m/s at the equator, plus any motion over the ground), v_i the
 * collector's velocity at reception. Xdot_i is the rate of change of the carrier-phase excess path.
 *
 * Where the famous corrections live
 *   - "Sagnac effect": nothing is added for it. It is what you must ADD if you instead compute ranges in
 *     the rotating ECEF frame; done in ECI as here, it is automatically included. Turn `earthRotation`
 *     off to see the error made by treating ECEF as if it were inertial.
 *   - Second-order Doppler / time dilation / gravitational red-shift: these change the RATE of clocks.
 *     They matter for a collector whose frequency reference free-runs on its own proper time
 *     (`properTimeLO`). A GPS-disciplined reference is steered to coordinate time and does not show them.
 *     The emitter's own clock rate only rescales its (unknown) carrier and cancels out of FDOA ratios.
 *
 * Time tags: collectors are assumed to time-tag in a common coordinate time scale (e.g. GPS time), which
 * is what disciplined clocks deliver. Clock synchronisation ERRORS are part of the error budget
 * (scenario.js), not of this deterministic model.
 *
 * Verified independently (tools/crosscheck.py, 50-digit arithmetic): delays and TDOAs agree to
 * < 2e-17 s, frequency ratios to < 1e-15, FDOA to < 1e-6 Hz at 1 GHz, for LEO/MEO/GEO collectors.
 * Known conventions below that level, none of which is physically significant:
 *   - the frequency ratio is evaluated for the wavefront defined by the GROUP delay, while the carrier
 *     phase that arrives at the same instant left ~2I/c (tens of ns) earlier: < 1e-6 Hz at 1 GHz;
 *   - elevation for the atmosphere models uses the inertial-frame line of sight rather than the
 *     aberrated Earth-fixed one (differs by ~1e-6 rad, ~10 micrometres of tropospheric path);
 *   - coordinate time here is the geocentric inertial-frame time; clock rates are normalised to the
 *     geoid (Terrestrial Time). The constant 7e-10 rate difference rescales every frequency equally.
 * Not modelled at all: second-order (1/f^3) ionospheric terms and ray bending (metres at 100 MHz, low
 * elevation), TEC gradients and scintillation, carrier phase wind-up of circularly polarised links
 * (milli-hertz, carrier independent), antenna phase-centre and hardware group-delay variations.
 */
import { C, GM, OMEGA_E, WGS84_A, J2, W0 } from './constants.js';
import { stateEcefToEci, stateEciToEcef, ecefToGeodetic, enuBasis, rotZ } from './frames.js';
import { troposphereDelay, ionosphereDelay } from './atmosphere.js';

/**
 * Model switches. The full model is the simulator's "truth"; switching items off produces the simpler
 * models a geolocation processor might use, so their cost can be measured.
 *
 * retarded       solve the light-time equation (each collector evaluated at its own reception time).
 *                false = "instantaneous" geometry: everything frozen at the reference time tag.
 * earthRotation  propagate in the inertial frame. false = compute in ECEF as if it were inertial
 *                (i.e. omit the Sagnac correction). Only meaningful when `retarded` is true.
 * dopplerExact   use the exact ratio D above. false = first-order Doppler, f0 (1 - rangeRate/c).
 * shapiro / troposphere / ionosphere   include that excess path.
 * properTimeLO   collector frequency references run on proper time (free-running oscillators).
 */
export const FULL_MODEL = Object.freeze({
  retarded: true, earthRotation: true, dopplerExact: true,
  shapiro: true, troposphere: true, ionosphere: true, properTimeLO: false,
});
/** The textbook model: instantaneous geometry, first-order Doppler, vacuum. */
export const NAIVE_MODEL = Object.freeze({
  retarded: false, earthRotation: false, dopplerExact: false,
  shapiro: false, troposphere: false, ionosphere: false, properTimeLO: false,
});

const ZERO3 = [0, 0, 0];
const FD_DT = 0.05; // s, half-step for the finite-difference rate of the (small, smooth) excess paths

function emitterState(em, t, t0, inertial) {
  const ve = em.velEcef || ZERO3, dt = t - t0;
  const p = [em.ecef[0] + ve[0] * dt, em.ecef[1] + ve[1] * dt, em.ecef[2] + ve[2] * dt];
  const s = inertial ? stateEcefToEci(p, ve, t) : { r: p, v: ve };
  s.pEcef = p;
  return s;
}
function collectorState(traj, t, inertial) {
  const s = traj.state(t);
  return inertial ? s : stateEciToEcef(s.r, s.v, t);
}

/** Geometry + excess paths for one emitter/collector position pair expressed in a common frame. */
function link(re, rc, vert, ctx) {
  const up = vert.up;
  const dx = rc[0] - re[0], dy = rc[1] - re[1], dz = rc[2] - re[2];
  const rho = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const n = [dx / rho, dy / rho, dz / rho];
  const sinEl = n[0] * up[0] + n[1] * up[1] + n[2] * up[2];
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const { model, env } = ctx;
  const tropo = model.troposphere ? troposphereDelay(el, vert.hE, env.tropo) : 0;
  const iono = model.ionosphere ? ionosphereDelay(el, ctx.f0, env.iono) : 0;
  let shapiro = 0;
  if (model.shapiro) {
    const a = Math.hypot(re[0], re[1], re[2]), b = Math.hypot(rc[0], rc[1], rc[2]);
    shapiro = (2 * GM / (C * C)) * Math.log((a + b + rho) / (a + b - rho));
  }
  return { rho, n, el, tropo, iono, shapiro, group: tropo + iono + shapiro, phase: tropo - iono + shapiro };
}

/**
 * Local vertical (ellipsoid normal, in the working frame) and height of the emitter at emission time te.
 * For an emitter fixed to the Earth these never change; for one moving over the ground they are
 * re-evaluated where the emitter actually is when the wavefront leaves.
 */
function vertical(ctx, te, E) {
  let upE = ctx.upEcef, hE = ctx.hE;
  if (ctx.moving) { const g = ecefToGeodetic(E.pEcef); upE = enuBasis(g.lat, g.lon).u; hE = g.h; }
  return { up: ctx.inertial ? rotZ(OMEGA_E * te, upE) : upE, hE };
}

/** Wavefront emitted at te: when and where does this collector receive it? */
function solveForward(em, traj, te, ctx) {
  const E = emitterState(em, te, ctx.t0, ctx.inertial);
  const vert = vertical(ctx, te, E);
  let delay = 0, S = null, L = null;
  for (let k = 0; k < 12; k++) {
    S = collectorState(traj, te + delay, ctx.inertial);
    L = link(E.r, S.r, vert, ctx);
    const next = (L.rho + L.group) / C;
    const change = Math.abs(next - delay);
    delay = next;
    if (change < 1e-18) break;
  }
  return { te, tr: te + delay, delay, E, S, L };
}

/** Wavefront received by this collector at tr: when did it leave the emitter? */
function solveBackward(em, traj, tr, ctx) {
  const S = collectorState(traj, tr, ctx.inertial);
  let delay = 0, E = null, L = null, te = tr;
  for (let k = 0; k < 12; k++) {
    te = tr - delay;
    E = emitterState(em, te, ctx.t0, ctx.inertial);
    L = link(E.r, S.r, vertical(ctx, te, E), ctx);
    const next = (L.rho + L.group) / C;
    const change = Math.abs(next - delay);
    delay = next;
    if (change < 1e-18) break;
  }
  return { te: tr - delay, tr, delay, E, S, L };
}

/** Everything evaluated at one instant (no light-time). */
function solveInstant(em, traj, t, ctx) {
  const E = emitterState(em, t, ctx.t0, true);
  const S = traj.state(t);
  const L = link(E.r, S.r, vertical(ctx, t, E), ctx);
  return { te: t, tr: t, delay: (L.rho + L.group) / C, E, S, L };
}

/**
 * Rate of a clock at ECI position r moving with ECI velocity v, relative to a clock at rest on the
 * geoid:  d(tau)/dt = 1 + (W0 - U)/c^2 - v^2/(2 c^2),  U = GM/r [1 - J2 (a/r)^2 (3 sin^2(lat) - 1)/2].
 * (LEO at 550 km: about -2.5e-10, i.e. the clock loses ~22 microseconds per day; GEO: +5.4e-10.)
 */
export function clockRate(r, v) {
  const rm = Math.hypot(r[0], r[1], r[2]);
  const s = r[2] / rm, q = WGS84_A / rm;
  const U = (GM / rm) * (1 - J2 * q * q * (3 * s * s - 1) / 2);
  const v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  return 1 + (W0 - U) / (C * C) - v2 / (2 * C * C);
}

/**
 * Sagnac term for an ECEF emitter position and ECEF collector position (at reception), seconds:
 *     (omega/c^2) (x_e y_c - y_e x_c)  =  2 omega . A / c^2
 * the amount by which the true light-time exceeds |r_c - r_e|/c computed from ECEF coordinates.
 */
export function sagnacDelay(emitterEcef, collectorEcef) {
  return (OMEGA_E / (C * C)) * (emitterEcef[0] * collectorEcef[1] - emitterEcef[1] * collectorEcef[0]);
}

/**
 * Simulate what the collectors observe for one wavefront.
 *
 * @param {{ecef:number[], velEcef?:number[], f0:number}} emitter  ECEF position (m) at time t0, velocity
 *        over the ground (m/s, ECEF), carrier frequency (Hz, on the coordinate time scale)
 * @param {{state:(t:number)=>{r:number[],v:number[]}}[]} trajs  collector trajectories (ECI)
 * @param {number} t0   reception time of the wavefront at the REFERENCE collector, s
 * @param {object} [opts]
 * @param {object} [opts.model=FULL_MODEL]
 * @param {{tropo?:object, iono?:object}} [opts.env]  atmosphere parameters (see atmosphere.js)
 * @param {number} [opts.ref=0]  index of the reference collector
 * @returns {{
 *   t0:number, te:number, ref:number, f0:number,
 *   tdoa:number[],  // t_i - t_ref, seconds (0 for the reference)
 *   fdoa:number[],  // f_i - f_ref, Hz (0 for the reference)
 *   ratio:number[], // f_i / f0 as measured by collector i
 *   collectors:{
 *     delay:number, range:number, rangeRate:number, elevation:number, azimuth:number, visible:boolean,
 *     dopplerFactor:number, clockRate:number, freq:number, dopplerShift:number,
 *     tropo:number, iono:number, shapiro:number, sagnac:number,
 *     tr:number, rEci:number[], vEci:number[], rEcef:number[], vEcef:number[], los:number[] }[]
 * }}
 * Per collector: delay = time of flight (s); range (m) and rangeRate (m/s, first order) along the line of
 * sight; elevation/azimuth of the collector seen from the emitter (rad; azimuth clockwise from north);
 * visible = above the emitter's horizon; tropo/iono/shapiro = excess group paths (m); sagnac (s) is
 * informational (see sagnacDelay); los = unit vector emitter->collector in ECEF at reception.
 */
export function observe(emitter, trajs, t0, opts = {}) {
  const model = opts.model || FULL_MODEL;
  const ref = opts.ref || 0;
  const geo = ecefToGeodetic(emitter.ecef);
  const basis = enuBasis(geo.lat, geo.lon);
  const ctx = {
    t0, model, env: opts.env || {}, f0: emitter.f0, hE: geo.h, upEcef: basis.u,
    inertial: model.retarded ? !!model.earthRotation : true,
    moving: !!(emitter.velEcef && (emitter.velEcef[0] || emitter.velEcef[1] || emitter.velEcef[2])),
  };
  const needRate = model.troposphere || model.ionosphere || model.shapiro;
  const n = trajs.length;
  const sols = new Array(n), xdot = new Array(n).fill(0);
  let te;

  if (model.retarded) {
    sols[ref] = solveBackward(emitter, trajs[ref], t0, ctx);
    te = sols[ref].te;
    for (let i = 0; i < n; i++) if (i !== ref) sols[i] = solveForward(emitter, trajs[i], te, ctx);
    if (needRate) {
      for (let i = 0; i < n; i++) {
        const p = solveForward(emitter, trajs[i], te + FD_DT, ctx).L.phase;
        const m = solveForward(emitter, trajs[i], te - FD_DT, ctx).L.phase;
        xdot[i] = (p - m) / (2 * FD_DT);
      }
    }
  } else {
    te = t0;
    for (let i = 0; i < n; i++) sols[i] = solveInstant(emitter, trajs[i], t0, ctx);
    if (needRate) {
      for (let i = 0; i < n; i++) {
        const p = solveInstant(emitter, trajs[i], t0 + FD_DT, ctx).L.phase;
        const m = solveInstant(emitter, trajs[i], t0 - FD_DT, ctx).L.phase;
        xdot[i] = (p - m) / (2 * FD_DT);
      }
    }
  }

  const emEcefAtTe = (() => {
    const ve = emitter.velEcef || ZERO3, dt = te - t0;
    return [emitter.ecef[0] + ve[0] * dt, emitter.ecef[1] + ve[1] * dt, emitter.ecef[2] + ve[2] * dt];
  })();

  const collectors = sols.map((s, i) => {
    const nvc = (s.L.n[0] * s.S.v[0] + s.L.n[1] * s.S.v[1] + s.L.n[2] * s.S.v[2]) / C;
    const nve = (s.L.n[0] * s.E.v[0] + s.L.n[1] * s.E.v[1] + s.L.n[2] * s.E.v[2]) / C;
    const D = model.dopplerExact ? (1 - nvc) / (1 - nve + xdot[i] / C) : 1 - nvc + nve - xdot[i] / C;
    // True inertial and Earth-fixed states at the reception instant (for clocks, display, Sagnac info).
    const eci = trajs[i].state(s.tr);
    const ecef = stateEciToEcef(eci.r, eci.v, s.tr);
    const k = model.properTimeLO ? clockRate(eci.r, eci.v) : 1;
    const losEcef = (() => {
      const d = [ecef.r[0] - emEcefAtTe[0], ecef.r[1] - emEcefAtTe[1], ecef.r[2] - emEcefAtTe[2]];
      const m = Math.hypot(d[0], d[1], d[2]);
      return [d[0] / m, d[1] / m, d[2] / m];
    })();
    const east = losEcef[0] * basis.e[0] + losEcef[1] * basis.e[1] + losEcef[2] * basis.e[2];
    const north = losEcef[0] * basis.n[0] + losEcef[1] * basis.n[1] + losEcef[2] * basis.n[2];
    const ratio = D / k;
    return {
      delay: s.delay, range: s.L.rho, rangeRate: (nvc - nve) * C,
      elevation: s.L.el, azimuth: Math.atan2(east, north), visible: s.L.el > 0,
      dopplerFactor: D, clockRate: k, ratio, freq: emitter.f0 * ratio, dopplerShift: emitter.f0 * (ratio - 1),
      tropo: s.L.tropo, iono: s.L.iono, shapiro: s.L.shapiro, phaseRate: xdot[i],
      sagnac: sagnacDelay(emEcefAtTe, ecef.r),
      tr: s.tr, rEci: eci.r, vEci: eci.v, rEcef: ecef.r, vEcef: ecef.v, los: losEcef,
    };
  });

  const dRef = collectors[ref];
  return {
    t0, te, ref, f0: emitter.f0,
    // Differences of delays (small numbers) rather than of absolute times: keeps ~1e-18 s resolution.
    tdoa: collectors.map((c) => c.delay - dRef.delay),
    fdoa: collectors.map((c) => emitter.f0 * (c.ratio - dRef.ratio)),
    ratio: collectors.map((c) => c.ratio),
    collectors,
  };
}

/**
 * Describe the measurement vector for n collectors: n-1 TDOAs and/or n-1 FDOAs against the reference,
 * optionally followed by an emitter-altitude pseudo-measurement (the "it is on the Earth's surface"
 * constraint, with an uncertainty).
 * @returns {{type:'tdoa'|'fdoa'|'alt', i?:number, j?:number, unit:string, label:string}[]}
 */
export function measurementLayout(n, { tdoa = true, fdoa = true, altitude = false } = {}, ref = 0, ids = 'ABCDEFGH') {
  const rows = [];
  if (tdoa) for (let i = 0; i < n; i++) if (i !== ref) rows.push({ type: 'tdoa', i, j: ref, unit: 's', label: `TDOA ${ids[i]}−${ids[ref]}` });
  if (fdoa) for (let i = 0; i < n; i++) if (i !== ref) rows.push({ type: 'fdoa', i, j: ref, unit: 'Hz', label: `FDOA ${ids[i]}−${ids[ref]}` });
  if (altitude) rows.push({ type: 'alt', unit: 'm', label: 'Emitter altitude' });
  return rows;
}

/**
 * Turn an observation into a measurement vector (seconds, hertz, metres) following `layout`.
 *
 * FDOA rows are formed as  fRef * (ratio_i / ratio_ref - 1), where fRef is the carrier frequency actually
 * measured at the reference collector. With fRef omitted the exact simulated value is used, which gives
 * f_i - f_ref. This is how a real processor copes with not knowing the transmit frequency: only the
 * RATIO of received frequencies depends on geometry, and the scale comes from what was received.
 *
 * @param {object} obs      result of observe()
 * @param {object[]} layout from measurementLayout()
 * @param {{fRef?:number, altitude?:number}} [o]  altitude = value for the 'alt' row (m)
 */
export function measurementVector(obs, layout, o = {}) {
  const fRef = o.fRef ?? obs.collectors[obs.ref].freq;
  const rr = obs.ratio[obs.ref];
  return layout.map((m) => {
    if (m.type === 'tdoa') return obs.tdoa[m.i] - obs.tdoa[m.j];
    if (m.type === 'fdoa') return fRef * (obs.ratio[m.i] - obs.ratio[m.j]) / rr;
    return o.altitude ?? 0;
  });
}
