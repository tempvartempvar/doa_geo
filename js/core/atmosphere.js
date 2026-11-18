/**
 * Propagation-medium models for a ground emitter observed from above the atmosphere.
 * Both return an EXCESS PATH LENGTH in metres as a function of the elevation angle of the collector
 * seen from the emitter. They are deliberately simple, smooth, textbook models: good to roughly
 * 5-10 % of the troposphere term above 5 deg elevation and a single-layer (thin-shell) ionosphere with a
 * uniform vertical TEC. Real systems use meteorological data, global TEC maps or dual-frequency
 * measurements; the point here is to get magnitudes, elevation dependence and signs right.
 *
 *   Troposphere: non-dispersive. Delays the envelope (TDOA) and the carrier phase equally.
 *   Ionosphere:  dispersive, proportional to 1/f^2. Delays the envelope (group delay, +I) but ADVANCES the
 *                carrier phase by the same amount (-I). TDOA is measured on the envelope, FDOA on the
 *                phase rate, so the ionosphere enters them with opposite signs.
 */
import { R_MEAN } from './constants.js';

/**
 * Tropospheric excess path, m.
 * Zenith delay = hydrostatic (about 2.3 m at sea level, pressure scale height ~8 km) + wet (5-40 cm,
 * scale height ~2 km); mapped to the slant path with the Black & Eisner (1984) function
 * m(el) = 1.001 / sqrt(0.002001 + sin^2 el), which stays finite at the horizon (m(5 deg) = 10.2).
 *
 * @param {number} el elevation at the emitter, rad
 * @param {number} hEmitter emitter height above the ellipsoid, m
 * @param {{zhd?:number, zwd?:number}} [p] sea-level zenith hydrostatic / wet delays, m
 */
export function troposphereDelay(el, hEmitter = 0, p = {}) {
  const zhd = p.zhd ?? 2.3, zwd = p.zwd ?? 0.15;
  const h = Math.max(hEmitter, -500);
  const zenith = zhd * Math.exp(-h / 8000) + zwd * Math.exp(-h / 2000);
  const s = Math.sin(Math.max(el, 0));
  return zenith * 1.001 / Math.sqrt(0.002001 + s * s);
}

/**
 * Ionospheric excess GROUP path, m (the carrier-phase path changes by minus this amount).
 *   I = 40.308 * STEC / f^2,   STEC = VTEC * M(el),
 *   M(el) = 1 / sqrt(1 - (R cos el / (R + h_shell))^2)   (single-layer obliquity factor)
 *
 * @param {number} el elevation at the emitter, rad
 * @param {number} f0 carrier frequency, Hz
 * @param {{vtec?:number, shellKm?:number}} [p] vtec = vertical total electron content between the emitter
 *        and the collector, in TEC units (1 TECU = 1e16 electrons/m^2; quiet night ~5, mid-latitude day
 *        ~20-50, disturbed low latitudes 100+). A LEO collector flies inside the topside ionosphere, so
 *        it sees only the part of the TEC below it. shellKm = effective height of the layer.
 */
export function ionosphereDelay(el, f0, p = {}) {
  const vtec = p.vtec ?? 20, shell = (p.shellKm ?? 350) * 1000;
  const c = R_MEAN * Math.cos(Math.max(el, 0)) / (R_MEAN + shell);
  return 40.308 * vtec * 1e16 / (f0 * f0) / Math.sqrt(1 - c * c);
}
