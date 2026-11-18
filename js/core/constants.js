/**
 * Physical and geodetic constants (SI units throughout the core).
 */

/** Speed of light in vacuum, m/s (exact, SI definition). */
export const C = 299792458;

/** Earth's gravitational parameter GM, m^3/s^2 (WGS-84, includes the atmosphere). */
export const GM = 3.986004418e14;

/** Earth's inertial rotation rate, rad/s (WGS-84). */
export const OMEGA_E = 7.292115e-5;

/** WGS-84 ellipsoid. */
export const WGS84_A = 6378137.0;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_B = WGS84_A * (1 - WGS84_F);
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);

/** Second zonal harmonic of the geopotential (used only in the gravitational red-shift term). */
export const J2 = 1.08262668e-3;

/**
 * Geoid potential W0, m^2/s^2 (gravitational + centrifugal, IAU/IERS conventional value;
 * W0/c^2 = L_G = 6.969290134e-10). A clock at rest on the geoid ticks at the rate of Terrestrial
 * Time; subtracting W0 makes clock-rate factors read "relative to a ground clock".
 */
export const W0 = 62636856.0;

/** Mean Earth radius used by the single-layer ionosphere mapping function, m. */
export const R_MEAN = 6371000.0;

export const DEG = Math.PI / 180;
export const TWO_PI = 2 * Math.PI;

/** Wavelength in metres for a carrier in Hz. */
export const wavelength = (f0) => C / f0;
