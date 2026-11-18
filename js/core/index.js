/**
 * Physics core - single import point for lessons.
 *
 *   import { planar, scenario, stein, frames, constants, ... } from '../core/index.js';
 *
 *   constants  C, GM, OMEGA_E, WGS-84, DEG, wavelength()
 *   linalg     small vector/matrix helpers, symEig, makeRng (seeded Gaussian RNG)
 *   estimate   crlb, gain, gaussNewton, errorEllipse, errorEllipsoid, cep, differencingCov
 *   planar     flat-world 2-D TDOA/FDOA model (lessons 1-5)
 *   frames     ECEF/ECI/geodetic/ENU conversions, localMap
 *   orbits     Kepler trajectories, formations
 *   atmosphere troposphere / ionosphere excess paths
 *   measure    the full light-time / Doppler measurement model, observe()
 *   scenario   high-level engine for the orbital lessons (7-9)
 *   stein      CAF measurement-precision bounds (lesson 6)
 */
export * as constants from './constants.js';
export * as linalg from './linalg.js';
export * as estimate from './estimate.js';
export * as planar from './planar.js';
export * as frames from './frames.js';
export * as orbits from './orbits.js';
export * as atmosphere from './atmosphere.js';
export * as measure from './measure.js';
export * as scenario from './scenario.js';
export * as stein from './stein.js';
