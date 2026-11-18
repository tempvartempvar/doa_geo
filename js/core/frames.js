/**
 * Reference frames and geodesy.
 *
 *   ECEF  Earth-centred Earth-fixed (rotates with the Earth). +X: lat 0, lon 0. +Z: north pole.
 *   ECI   Earth-centred inertial (non-rotating). Light travels in straight lines at c in THIS frame.
 *
 * The two are related by a rotation about Z through the Earth rotation angle theta = OMEGA_E * t
 * (the frames coincide at t = 0). Precession, nutation and polar motion are ignored: they change which
 * way the axes point over days to years but not the physics of a milliseconds-long signal flight.
 *
 * Angles are in radians unless the name ends in "Deg".
 */
import { OMEGA_E, WGS84_A, WGS84_B, WGS84_E2, DEG } from './constants.js';

/** Rotate a 3-vector about +Z by angle a (counter-clockwise seen from +Z). */
export function rotZ(a, v) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

/** ECEF position -> ECI position at time t (s). */
export function ecefToEci(r, t) { return rotZ(OMEGA_E * t, r); }
/** ECI position -> ECEF position at time t (s). */
export function eciToEcef(r, t) { return rotZ(-OMEGA_E * t, r); }

/** ECEF state -> ECI state. The inertial velocity includes the frame rotation: v_eci = R (v_ecef + w x r). */
export function stateEcefToEci(r, v, t) {
  const vv = [v[0] - OMEGA_E * r[1], v[1] + OMEGA_E * r[0], v[2]];
  return { r: rotZ(OMEGA_E * t, r), v: rotZ(OMEGA_E * t, vv) };
}
/** ECI state -> ECEF state: v_ecef = R^T v_eci - w x r_ecef. */
export function stateEciToEcef(r, v, t) {
  const re = rotZ(-OMEGA_E * t, r), ve = rotZ(-OMEGA_E * t, v);
  return { r: re, v: [ve[0] + OMEGA_E * re[1], ve[1] - OMEGA_E * re[0], ve[2]] };
}

/** Geodetic latitude/longitude (rad) and ellipsoidal height (m) -> ECEF (m), WGS-84. */
export function geodeticToEcef(lat, lon, h = 0) {
  const sl = Math.sin(lat), cl = Math.cos(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sl * sl);
  return [(N + h) * cl * Math.cos(lon), (N + h) * cl * Math.sin(lon), (N * (1 - WGS84_E2) + h) * sl];
}
export function geodeticDegToEcef(latDeg, lonDeg, h = 0) { return geodeticToEcef(latDeg * DEG, lonDeg * DEG, h); }

/**
 * ECEF -> geodetic (WGS-84). Fixed-point iteration on latitude; converges to < 1e-12 rad in a few steps
 * for any point from the Earth's surface to beyond GEO.
 * @returns {{lat:number, lon:number, h:number}} radians, metres
 */
export function ecefToGeodetic(r) {
  const x = r[0], y = r[1], z = r[2];
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);
  if (p < 1e-9) return { lat: Math.sign(z) * Math.PI / 2, lon: 0, h: Math.abs(z) - WGS84_B };
  let lat = Math.atan2(z, p * (1 - WGS84_E2));
  let N = WGS84_A, h = 0;
  for (let i = 0; i < 12; i++) {
    const sl = Math.sin(lat);
    N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sl * sl);
    h = p / Math.cos(lat) - N;
    const next = Math.atan2(z, p * (1 - WGS84_E2 * N / (N + h)));
    if (Math.abs(next - lat) < 1e-14) { lat = next; break; }
    lat = next;
  }
  const sl = Math.sin(lat);
  N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sl * sl);
  // Height formula that stays well conditioned near the poles.
  h = Math.abs(lat) < Math.PI / 4 ? p / Math.cos(lat) - N : z / sl - N * (1 - WGS84_E2);
  return { lat, lon, h };
}
export function ecefToGeodeticDeg(r) { const g = ecefToGeodetic(r); return { latDeg: g.lat / DEG, lonDeg: g.lon / DEG, h: g.h }; }

/** Ellipsoidal height of an ECEF point, m. */
export function heightOf(r) { return ecefToGeodetic(r).h; }

/**
 * Local east / north / up unit vectors at geodetic (lat, lon), expressed in ECEF.
 * "Up" is the ellipsoid normal (not the geocentric radial direction).
 */
export function enuBasis(lat, lon) {
  const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
  return { e: [-so, co, 0], n: [-sl * co, -sl * so, cl], u: [cl * co, cl * so, sl] };
}

/** Express an ECEF vector (a difference, not a position) in the local ENU frame at (lat, lon). */
export function ecefVecToEnu(d, lat, lon) {
  const b = enuBasis(lat, lon);
  return [
    b.e[0] * d[0] + b.e[1] * d[1] + b.e[2] * d[2],
    b.n[0] * d[0] + b.n[1] * d[1] + b.n[2] * d[2],
    b.u[0] * d[0] + b.u[1] * d[1] + b.u[2] * d[2],
  ];
}
/** Convert a local ENU vector at (lat, lon) to ECEF components. */
export function enuVecToEcef(v, lat, lon) {
  const b = enuBasis(lat, lon);
  return [
    b.e[0] * v[0] + b.n[0] * v[1] + b.u[0] * v[2],
    b.e[1] * v[0] + b.n[1] * v[1] + b.u[1] * v[2],
    b.e[2] * v[0] + b.n[2] * v[1] + b.u[2] * v[2],
  ];
}
/** 3 x 3 rotation matrix whose rows are e, n, u (so enu = Q * ecef, and P_enu = Q P_ecef Q^T). */
export function enuMatrix(lat, lon) { const b = enuBasis(lat, lon); return [b.e, b.n, b.u]; }

/**
 * A local map around a reference point, for drawing things on the Earth's surface in a flat picture.
 * Map coordinates (east, north) are the horizontal ENU components relative to the reference point
 * (an orthographic projection onto the tangent plane): exact, invertible, and for points within a few
 * hundred km indistinguishable from a conventional map.
 *
 * @param {number} latDeg reference latitude
 * @param {number} lonDeg reference longitude
 * @param {number} [h=0] reference height above the ellipsoid, m
 */
export function localMap(latDeg, lonDeg, h = 0) {
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  const origin = geodeticToEcef(lat, lon, h);
  const b = enuBasis(lat, lon);
  return {
    latDeg, lonDeg, h, origin, basis: b,
    /** ECEF point -> [east, north, up] in metres relative to the reference point. */
    toEnu(r) { return ecefVecToEnu([r[0] - origin[0], r[1] - origin[1], r[2] - origin[2]], lat, lon); },
    /** [east, north, up] (m) -> ECEF point. */
    fromEnu(enu) { const d = enuVecToEcef(enu, lat, lon); return [origin[0] + d[0], origin[1] + d[1], origin[2] + d[2]]; },
    /**
     * Map point (east, north) -> the ECEF point directly "below/above" it (along the reference up
     * direction) that lies at ellipsoidal height `height` (default: the reference height).
     * Returns null if the map point is beyond the limb of the Earth.
     */
    surfacePoint(east, north, height = h) {
      const base = [origin[0] + b.e[0] * east + b.n[0] * north, origin[1] + b.e[1] * east + b.n[1] * north, origin[2] + b.e[2] * east + b.n[2] * north];
      let s = -(east * east + north * north) / (2 * WGS84_A); // first guess: drop below the tangent plane
      for (let i = 0; i < 20; i++) {
        const p = [base[0] + b.u[0] * s, base[1] + b.u[1] * s, base[2] + b.u[2] * s];
        const g = ecefToGeodetic(p);
        const err = g.h - height;
        if (Math.abs(err) < 1e-6) return p;
        const nb = enuBasis(g.lat, g.lon);
        const slope = nb.u[0] * b.u[0] + nb.u[1] * b.u[1] + nb.u[2] * b.u[2]; // d(height)/ds
        if (!(slope > 0.05)) return null;
        s -= err / slope;
      }
      return null;
    },
  };
}

/**
 * Move a geodetic point by a small horizontal offset (east, north in metres); returns degrees.
 * Good to ~0.1 % for offsets up to a few hundred km; used only to lay out scenarios.
 */
export function offsetLatLonDeg(latDeg, lonDeg, eastM, northM) {
  const m = localMap(latDeg, lonDeg, 0);
  const p = m.surfacePoint(eastM, northM, 0);
  const g = ecefToGeodeticDeg(p);
  return { latDeg: g.latDeg, lonDeg: g.lonDeg };
}
