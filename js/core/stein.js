/**
 * How precisely can TDOA and FDOA be MEASURED? Cramer-Rao bounds for cross-ambiguity-function (CAF)
 * processing of one signal received by two collectors (S. Stein, "Algorithms for ambiguity function
 * processing", IEEE Trans. ASSP-29, 1981):
 *
 *     sigma_TDOA = 1 / ( beta * sqrt(B T gamma) )          sigma_FDOA = 1 / ( Te * sqrt(B T gamma) )
 *
 *   B      receiver noise bandwidth, Hz            T   coherent integration time, s
 *   gamma  effective input SNR of the pair:  1/gamma = (1/2) (1/g1 + 1/g2 + 1/(g1 g2))
 *   beta   rms radian bandwidth of the signal: 2 pi sqrt( int f^2 S(f) df / int S(f) df )
 *          = pi Bs / sqrt(3) ~ 1.81 Bs for a flat spectrum of width Bs
 *   Te     rms radian duration: pi T / sqrt(3) ~ 1.81 T for a constant-envelope signal of length T
 *
 * B*T is the time-bandwidth product (number of independent samples), so sqrt(B T gamma) is the
 * post-integration voltage SNR. TDOA precision is bought with BANDWIDTH, FDOA precision with DURATION.
 * SNRs are linear power ratios in the bandwidth B (use fromDb for dB).
 *
 * Two assumptions worth knowing (both confirmed by the Monte-Carlo in tests/caf.test.mjs):
 *  - The noise x noise term 1/(g1 g2) assumes the correlated noise occupies the same band as the
 *    signal. If the recordings are wider than the signal (Bs < B) and are correlated unfiltered, the
 *    delay error exceeds this bound at low per-channel SNR (by ~30 % at Bs = B/4, 10 dB). Filter the
 *    reference channel to the signal band and use B = Bs with the SNR quoted in Bs.
 *  - toaSigma / foaSigma are the high-SNR limit (they drop the noise x noise term), so below about
 *    0 dB per channel they are optimistic. For a per-collector figure that stays honest at low SNR use
 *    tdoaSigma({snr1: g, snr2: g}) / sqrt(2), and likewise for FDOA.
 */

export const fromDb = (db) => Math.pow(10, db / 10);
export const toDb = (x) => 10 * Math.log10(x);

/** Effective SNR of a collector pair (linear). For g1 = g2 = g >> 1 this is just g. */
export function effectiveSnr(g1, g2) { return 2 / (1 / g1 + 1 / g2 + 1 / (g1 * g2)); }

/** rms radian bandwidth of a flat (rectangular) spectrum of width Bs, rad/s. */
export const rmsBandwidth = (Bs) => Math.PI * Bs / Math.sqrt(3);
/** rms radian duration of a constant-envelope observation of length T, s. */
export const rmsDuration = (T) => Math.PI * T / Math.sqrt(3);

/**
 * TDOA measurement standard deviation, s.
 * @param {{B:number, T:number, snr1:number, snr2:number, Bs?:number}} p Bs = signal bandwidth (default B)
 */
export function tdoaSigma({ B, T, snr1, snr2, Bs = B }) {
  return 1 / (rmsBandwidth(Bs) * Math.sqrt(B * T * effectiveSnr(snr1, snr2)));
}
/** FDOA measurement standard deviation, Hz. */
export function fdoaSigma({ B, T, snr1, snr2 }) {
  return 1 / (rmsDuration(T) * Math.sqrt(B * T * effectiveSnr(snr1, snr2)));
}

/**
 * Per-collector equivalents (high-SNR limit): the time-of-arrival and frequency-of-arrival jitter to
 * assign to ONE collector so that differencing two of them reproduces the pair bounds above:
 * sigma_pair^2 = sigma_1^2 + sigma_2^2.
 */
export function toaSigma({ B, T, snr, Bs = B }) { return 1 / (rmsBandwidth(Bs) * Math.sqrt(2 * B * T * snr)); }
export function foaSigma({ B, T, snr }) { return 1 / (rmsDuration(T) * Math.sqrt(2 * B * T * snr)); }

/** Width of the CAF main lobe (resolution, NOT accuracy): ~1/Bs in delay and ~1/T in Doppler. */
export const delayResolution = (Bs) => 1 / Bs;
export const dopplerResolution = (T) => 1 / T;
