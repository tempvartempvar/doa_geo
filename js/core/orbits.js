/**
 * Collector trajectories.
 *
 * A "trajectory" is any object with   state(t) -> { r:[x,y,z], v:[vx,vy,vz] }   in the ECI frame
 * (metres, metres/second, t in seconds). REQUIREMENT: v must be the exact time-derivative of r.
 * The Doppler model differentiates the light-time equation analytically and relies on that.
 *
 * Orbits are two-body Keplerian (no J2, drag, or third bodies). That is a statement about how the
 * satellites are flown in this simulator, not about measurement accuracy: geolocation uses each
 * collector's position and velocity at the instant of reception, wherever its orbit took it, and those
 * states are self-consistent here to floating-point precision.
 */
import { GM, OMEGA_E, WGS84_A, WGS84_E2, DEG, TWO_PI } from './constants.js';
import { cross3, vnorm, vdot, vscale, vsub } from './linalg.js';

/**
 * Keplerian elements: { a (m), e, i, raan, argp, M0 (rad, mean anomaly at t = 0) }.
 * @returns {{r:number[], v:number[]}} ECI state at time t
 */
export function keplerState(el, t) {
  const { a, e, i, raan, argp, M0 } = el;
  const n = Math.sqrt(GM / (a * a * a));
  let M = (M0 + n * t) % TWO_PI;
  // Solve Kepler's equation E - e sin E = M (Newton; quadratic convergence, e < 1).
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-15) break;
  }
  const cE = Math.cos(E), sE = Math.sin(E), b = Math.sqrt(1 - e * e);
  const x = a * (cE - e), y = a * b * sE;
  const Edot = n / (1 - e * cE);
  const xd = -a * sE * Edot, yd = a * b * cE * Edot;
  const cO = Math.cos(raan), sO = Math.sin(raan), cw = Math.cos(argp), sw = Math.sin(argp), ci = Math.cos(i), si = Math.sin(i);
  const P = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
  const Q = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];
  return {
    r: [x * P[0] + y * Q[0], x * P[1] + y * Q[1], x * P[2] + y * Q[2]],
    v: [xd * P[0] + yd * Q[0], xd * P[1] + yd * Q[1], xd * P[2] + yd * Q[2]],
  };
}

/** Trajectory object for a Keplerian orbit. */
export function keplerTrajectory(elements) {
  return { elements, state: (t) => keplerState(elements, t) };
}

/** Orbital period, s. */
export function period(a) { return TWO_PI * Math.sqrt(a * a * a / GM); }

/**
 * Local polynomial copy of a trajectory around time tc (4th-order Taylor series using two-body
 * acceleration, jerk and snap). Within +-0.2 s of tc it reproduces a LEO Kepler orbit to about 2 nm
 * (floating-point rounding; the truncation error is ~1e-13 m), its velocity is the exact derivative of
 * its position, and it is ~20x cheaper to evaluate - which is what makes Monte-Carlo runs and maps
 * interactive.
 */
export function freezeTrajectory(traj, tc) {
  const { r, v } = traj.state(tc);
  const r2 = vdot(r, r), rm = Math.sqrt(r2), r3 = r2 * rm, r5 = r3 * r2, r7 = r5 * r2;
  const rv = vdot(r, v), v2 = vdot(v, v);
  const a = vscale(r, -GM / r3);
  const j = [0, 1, 2].map((k) => -GM * (v[k] / r3 - 3 * rv * r[k] / r5));
  const ra = vdot(r, a);
  const s = [0, 1, 2].map((k) => -GM * (a[k] / r3 - 6 * rv * v[k] / r5 - 3 * (v2 + ra) * r[k] / r5 + 15 * rv * rv * r[k] / r7));
  return {
    elements: traj.elements, frozenAt: tc,
    state(t) {
      const d = t - tc, d2 = d * d / 2, d3 = d2 * d / 3, d4 = d3 * d / 4;
      return {
        r: [r[0] + v[0] * d + a[0] * d2 + j[0] * d3 + s[0] * d4, r[1] + v[1] * d + a[1] * d2 + j[1] * d3 + s[1] * d4, r[2] + v[2] * d + a[2] * d2 + j[2] * d3 + s[2] * d4],
        v: [v[0] + a[0] * d + j[0] * d2 + s[0] * d3, v[1] + a[1] * d + j[1] * d2 + s[1] * d3, v[2] + a[2] * d + j[2] * d2 + s[2] * d3],
      };
    },
  };
}

/**
 * A trajectory with an ephemeris (knowledge) error: position offset dr (m) and velocity offset dv (m/s),
 * both constant in ECI, applied about time tc. This is what the geolocation processor BELIEVES the
 * collector did; v stays the exact derivative of r.
 */
export function offsetTrajectory(traj, dr, dv, tc) {
  return {
    elements: traj.elements,
    state(t) {
      const s = traj.state(t), d = t - tc;
      return {
        r: [s.r[0] + dr[0] + dv[0] * d, s.r[1] + dr[1] + dv[1] * d, s.r[2] + dr[2] + dv[2] * d],
        v: [s.v[0] + dv[0], s.v[1] + dv[1], s.v[2] + dv[2]],
      };
    },
  };
}

/**
 * Radial / in-track / cross-track unit vectors of an ECI state.
 * R = along the position vector (up), C = along the orbital angular momentum (left of the direction of
 * travel), I = C x R (the direction of travel for a circular orbit).
 */
export function ricBasis(r, v) {
  const R = vscale(r, 1 / vnorm(r));
  const h = cross3(r, v);
  const Cn = vscale(h, 1 / vnorm(h));
  return { R, I: cross3(Cn, R), C: Cn };
}

/**
 * Elements of a circular orbit whose ground track passes directly over a point on the Earth.
 *
 * @param {object} o
 * @param {number} o.latDeg  geodetic latitude of the point
 * @param {number} o.lonDeg  longitude of the point
 * @param {number} o.altKm   orbit altitude above the equatorial radius
 * @param {number} o.incDeg  inclination (0-180)
 * @param {boolean} [o.ascending=true]  northbound (true) or southbound pass
 * @param {number} [o.tPass=0]  time (s) at which the satellite is over the point
 * @returns {{a,e,i,raan,argp,M0, uPass:number, overhead:boolean}} `overhead` is false when the latitude is
 *          beyond the reach of the inclination; the orbit then passes at its closest latitude instead.
 */
export function orbitOverPoint({ latDeg, lonDeg, altKm, incDeg, ascending = true, tPass = 0 }) {
  const a = WGS84_A + altKm * 1000;
  const i = incDeg * DEG;
  const n = Math.sqrt(GM / (a * a * a));
  const latGc = Math.atan((1 - WGS84_E2) * Math.tan(latDeg * DEG)); // geocentric latitude of the point
  let s = Math.sin(latGc) / Math.sin(i);
  const overhead = Math.abs(s) <= 1;
  s = Math.max(-1, Math.min(1, s));
  let u = Math.asin(s);
  if (!ascending) u = Math.PI - u;
  const raan = lonDeg * DEG + OMEGA_E * tPass - Math.atan2(Math.sin(u) * Math.cos(i), Math.cos(u));
  return { a, e: 0, i, raan, argp: 0, M0: u - n * tPass, uPass: u, overhead };
}

/**
 * Build a formation around a circular reference orbit. Each satellite is given an offset from the
 * reference position at the design time tDesign:
 *     along  (m)  + = ahead, in the direction of travel
 *     cross  (m)  + = to the left of the direction of travel (along the orbit normal)
 *     radial (m)  + = higher
 * Offsets are realised with small differences in the orbital elements (phase for along-track,
 * inclination + node for cross-track, eccentricity for radial) at an identical semi-major axis, so the
 * formation is a set of genuine orbits that stay together: it breathes and rotates over each
 * revolution as real formations do, but does not drift apart.
 *
 * @param {{a,i,raan,M0}} ref   circular reference elements (argp = 0, e = 0)
 * @param {number} tDesign      time at which the offsets hold, s
 * @param {{along?:number, cross?:number, radial?:number}[]} offsets
 * @returns {object[]} Keplerian elements, one per satellite
 */
export function makeFormation(ref, tDesign, offsets) {
  const { a, i, raan } = ref;
  const n = Math.sqrt(GM / (a * a * a));
  const uP = ref.M0 + (ref.argp || 0) + n * tDesign; // reference argument of latitude at tDesign
  return offsets.map((o) => {
    const along = o.along || 0, cross = o.cross || 0, radial = o.radial || 0;
    const di = (cross / a) * Math.sin(uP);
    const dO = -(cross / a) * Math.cos(uP) / Math.sin(i);
    const e = Math.abs(radial) / a;
    const u = uP + along / a - dO * Math.cos(i); // argument of latitude of this satellite at tDesign
    let argp = 0, M;
    if (e > 0) {
      argp = radial > 0 ? uP - Math.PI : uP; // apogee (or perigee) at the design point
      const nu = u - argp;
      const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
      M = E - e * Math.sin(E);
    } else {
      M = u;
    }
    return { a, e, i: i + di, raan: raan + dO, argp, M0: M - n * tDesign };
  });
}

/**
 * Named formation shapes. Each returns offsets (metres) for a characteristic baseline L (metres).
 * 'pair'      2 collectors in trail
 * 'triangle'  3 collectors, equilateral in the local horizontal plane
 * 'tri+1'     triangle plus a fourth collector at the centre, 0.15 L higher  (robust 4-ball geometry)
 * 'diamond'   4 collectors at +-along / +-cross. Instructive: seen from directly below its centre the
 *             four lines of sight lie on one cone and the TDOA-only 3-D fix degenerates.
 * 'string'    4 collectors in trail (nearly useless for cross-track TDOA; good along-track FDOA)
 */
export const FORMATIONS = {
  pair: (L) => [{ along: L / 2 }, { along: -L / 2 }],
  triangle: (L) => [
    { along: L / Math.sqrt(3) },
    { along: -L / (2 * Math.sqrt(3)), cross: L / 2 },
    { along: -L / (2 * Math.sqrt(3)), cross: -L / 2 },
  ],
  'tri+1': (L) => [
    { along: L / Math.sqrt(3) },
    { along: -L / (2 * Math.sqrt(3)), cross: L / 2 },
    { along: -L / (2 * Math.sqrt(3)), cross: -L / 2 },
    { radial: 0.15 * L },
  ],
  diamond: (L) => [{ along: L / 2 }, { along: -L / 2 }, { cross: L / 2 }, { cross: -L / 2 }],
  string: (L) => [{ along: 1.5 * L }, { along: 0.5 * L }, { along: -0.5 * L }, { along: -1.5 * L }],
};

/** Offset of satellite state s relative to reference state ref, in the reference's R/I/C frame (m). */
export function relativeRic(ref, s) {
  const b = ricBasis(ref.r, ref.v), d = vsub(s.r, ref.r);
  return { radial: vdot(d, b.R), along: vdot(d, b.I), cross: vdot(d, b.C) };
}
