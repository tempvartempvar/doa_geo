/**
 * glossary.js - every symbol and term the course uses, defined once, in plain words.
 * =====================================================================================
 * Rendered by symbolsBox() in ../ui/symbols.js as the "Symbols and terms in this lesson"
 * box under each lesson's header. Each lesson lists the keys it uses, in the order in
 * which they appear, so that a reader who jumps into a later lesson can still look up a
 * symbol that was introduced earlier.
 *
 *   TERMS[key] = { sym?, name, def, unit? }
 *       sym   TeX for the symbol, without dollar signs. Omit it for a word or phrase.
 *       name  what the thing is called (plain text).
 *       def   one or two sentences; HTML with $math$.
 *       unit  SI unit as plain text, where there is one.
 *
 *   BY_LESSON[lessonId] = [key, ...]
 *
 * A symbol that means different things in different lessons has one entry per meaning
 * (for example beta_bandwidth and beta_angle); each lesson lists the one it uses.
 */

const R = String.raw;

export const TERMS = {
  // ---------------------------------------------------------------- who and where
  collectors: { sym: R`A,\ B,\ C,\ D`, name: 'collectors', def: R`The receivers that record the emitter's signal, drawn as triangles. Satellite collectors are also called "balls".` },
  emitter: { sym: R`E`, name: 'emitter', def: R`The transmitter being located, drawn as a diamond. It does not cooperate: it reveals neither when nor on exactly what frequency it transmits.` },
  positions: { sym: R`\mathbf r_e,\ \mathbf r_i`, name: 'positions', def: R`Position of the emitter and of collector $i$. Bold letters are vectors.`, unit: 'm' },
  xy: { sym: R`(x,\ y)`, name: 'map coordinates', def: R`East and north position on the flat map of Parts I and II.`, unit: 'km' },
  N: { sym: R`N`, name: 'number of collectors', def: R`$N$ collectors give $N-1$ independent TDOAs and $N-1$ independent FDOAs.` },
  fix: { name: 'fix', def: R`An estimate of the emitter's position.` },

  // ---------------------------------------------------------------- time and frequency
  c: { sym: R`c`, name: 'speed of light', def: R`299 792 458 m/s, about 0.30 m per nanosecond.`, unit: 'm/s' },
  t0: { sym: R`t_0`, name: 'transmit time', def: R`When the emitter sent the signal. Unknown to a passive system.`, unit: 's' },
  ti: { sym: R`t_i`, name: 'arrival time', def: R`When the signal reaches collector $i$: $t_i = t_0 + \rho_i/c$.`, unit: 's' },
  f0: { sym: R`f_0`, name: 'carrier frequency', def: R`The frequency the emitter transmits on.`, unit: 'Hz' },
  fi: { sym: R`f_i`, name: 'received frequency', def: R`The frequency collector $i$ receives: $f_0$ shifted by the Doppler effect.`, unit: 'Hz' },
  lambda: { sym: R`\lambda`, name: 'wavelength', def: R`$\lambda = c/f_0$: 0.30 m at 1 GHz, 3 cm at 10 GHz.`, unit: 'm' },

  // ---------------------------------------------------------------- ranges and the two measurements
  rho_i: { sym: R`\rho_i`, name: 'range', def: R`Straight-line distance between the emitter and collector $i$.`, unit: 'm' },
  rho: { sym: R`\rho`, name: 'range, no subscript', def: R`Distance from the emitter to a pair or cluster as a whole. Used when the emitter is far away, so that the individual ranges are nearly equal.`, unit: 'm' },
  rhodot: { sym: R`\dot\rho_i`, name: 'range rate', def: R`How fast the range is changing, $\mathrm d\rho_i/\mathrm dt$: negative while closing, positive while separating. A dot over any symbol means its rate of change with time.`, unit: 'm/s' },
  tau: { sym: R`\tau_{ij}`, name: 'TDOA', def: R`Time difference of arrival, collector $i$ minus collector $j$: $\tau_{ij} = t_i - t_j = (\rho_i - \rho_j)/c$. A range difference in disguise.`, unit: 's' },
  nu: { sym: R`\nu_{ij}`, name: 'FDOA', def: R`Frequency difference of arrival, collector $i$ minus collector $j$: $\nu_{ij} = f_i - f_j = -(\dot\rho_i - \dot\rho_j)/\lambda$. A range-rate difference in disguise.`, unit: 'Hz' },
  ref: { name: 'reference collector', def: R`The collector that every TDOA and FDOA is measured against: A in $\tau_{BA}$ and $\nu_{BA}$.` },

  // ---------------------------------------------------------------- geometry of a pair
  los: { name: 'line of sight', def: R`The straight line from the emitter to a collector.` },
  lhat: { sym: R`\hat{\mathbf l}_i`, name: 'line-of-sight unit vector', def: R`A vector of length 1 pointing from the emitter toward collector $i$. It carries a direction and nothing else.` },
  baseline: { sym: R`d`, name: 'baseline', def: R`The straight line joining two collectors; $d$ is its length, the distance between them.`, unit: 'm' },
  dperp: { sym: R`d_\perp`, name: 'projected baseline', def: R`The part of the baseline that lies across the line of sight: how wide the pair looks from the emitter. $d_\perp = d\sin\varphi$.`, unit: 'm' },
  phi: { sym: R`\varphi`, name: 'angle to the baseline', def: R`The angle between the line of sight and the baseline: 90° broadside, 0° end-on.` },
  theta: { sym: R`\theta`, name: 'subtended angle', def: R`The angle between the two lines of sight, measured at the emitter. Far away, $\theta \approx d_\perp/\rho$ (in radians).` },
  bisector: { name: 'perpendicular bisector', def: R`The line through the middle of the baseline at right angles to it. Every point on it is equally far from both collectors.` },
  broadside: { name: 'broadside, end-on', def: R`Broadside: the emitter lies in a direction at right angles to the baseline. End-on: it lies along the extension of the baseline.` },
  hyperbola: { name: 'hyperbola', def: R`The curve of points whose distances to two fixed points (its foci; here the two collectors) differ by a constant amount.` },
  ghost: { name: 'ghost', def: R`A wrong position that reproduces the measurements exactly, so that nothing in them can rule it out.` },

  // ---------------------------------------------------------------- sensitivity
  nabla: { sym: R`\nabla`, name: 'gradient', def: R`The derivative with respect to the emitter's position, with the collectors held fixed. $\nabla z$ points the way the emitter would have to move to raise $z$ fastest, and its length is the rate of change per metre.` },
  delta: { sym: R`\delta`, name: 'a small error or change', def: R`$\delta\tau$ is a small error in $\tau$, $\delta\nu$ in $\nu$, and so on. $\delta n$ is the distance a curve moves sideways, along its normal (at right angles to itself).` },
  lever: { name: 'lever arm', def: R`Metres of curve movement per unit of measurement error, $1/\lVert\nabla z\rVert$. For TDOA it is about range ÷ baseline.` },

  // ---------------------------------------------------------------- motion
  v: { sym: R`\mathbf v_i,\ v`, name: 'collector velocity and speed', def: R`The velocity of collector $i$, and its magnitude.`, unit: 'm/s' },
  alpha: { sym: R`\alpha`, name: 'angle off the nose', def: R`The angle between a collector's velocity and its line of sight to the emitter.` },
  vperp: { sym: R`\mathbf v_{\perp i}`, name: 'cross-range velocity', def: R`The part of collector $i$'s velocity at right angles to its line of sight. $v_\perp/\rho$ is the rate at which that line of sight rotates.`, unit: 'm/s' },
  u: { sym: R`\mathbf u`, name: 'emitter velocity', def: R`Zero in the standard model. A moving emitter adds its own Doppler shift, which a processor that assumes it is stationary mistakes for geometry.`, unit: 'm/s' },
  trail: { name: 'in trail, abreast', def: R`In trail: the collectors fly one behind the other, along their baseline. Abreast: side by side, across it.` },

  // ---------------------------------------------------------------- errors and estimation
  sigma: { sym: R`\sigma`, name: 'standard deviation', def: R`The typical size of a random error ("1 sigma"). About two thirds of the errors in one dimension are smaller than this.` },
  sigmaT: { sym: R`\sigma_T`, name: 'per-collector timing error', def: R`Standard deviation of the error in one collector's arrival time.`, unit: 's' },
  sigmaF: { sym: R`\sigma_F`, name: 'per-collector frequency error', def: R`Standard deviation of the error in one collector's received frequency.`, unit: 'Hz' },
  sigmaDiff: { sym: R`\sigma_\tau,\ \sigma_\nu`, name: 'TDOA and FDOA errors', def: R`Errors of the differences. With two like collectors, $\sigma_\tau = \sqrt2\,\sigma_T$ and $\sigma_\nu = \sqrt2\,\sigma_F$.`, unit: 's, Hz' },
  z: { sym: R`\mathbf z`, name: 'measurement vector', def: R`All the TDOAs and FDOAs in use, stacked into one list.` },
  x: { sym: R`\mathbf x,\ \hat{\mathbf x}`, name: 'emitter position and its estimate', def: R`The unknowns being solved for. A hat on a quantity that is being estimated ($\hat{\mathbf x}$, $\hat\tau$) marks the estimate; on $\hat{\mathbf l}$ it marks a unit vector.` },
  H: { sym: R`H`, name: 'Jacobian', def: R`A matrix with one row per measurement: that measurement's gradient. It says how every measurement changes when the emitter moves a little. $H^{\mathsf T}$ is its transpose.` },
  Rcov: { sym: R`R`, name: 'measurement covariance', def: R`A matrix holding how large the measurement errors are and how they are correlated with one another.` },
  P: { sym: R`P`, name: 'position covariance', def: R`A matrix holding the spread of the position estimate. $P = (H^{\mathsf T}R^{-1}H)^{-1}$ is the best achievable.` },
  K: { sym: R`K`, name: 'estimator gain', def: R`Converts a small measurement error into the position error it causes: $\delta\mathbf x = K\,\delta\mathbf z$.` },
  crlb: { name: 'Cramér–Rao lower bound (CRLB)', def: R`The smallest spread that any estimator whose errors average to zero can achieve from the given measurements and noise.` },
  wls: { name: 'weighted least squares', def: R`The fix that makes the predicted measurements match the measured ones as closely as possible, counting each mismatch in proportion to how precise that measurement is. The quantity it minimises is the cost.` },
  mc: { name: 'Monte-Carlo', def: R`Repeating a simulated measurement and fix many times, each with fresh random errors, to see the scatter directly.` },
  ellipse: { name: 'error ellipse', def: R`The region around the truth that contains a stated share of the fixes: 39 % for the 1-sigma ellipse, 95 % for one 2.448 times larger.` },
  axes: { sym: R`\sigma_{major},\ \sigma_{minor}`, name: 'ellipse semi-axes', def: R`The 1-sigma errors along the long and the short axis of the error ellipse.`, unit: 'm' },
  eig: { sym: R`\lambda_1,\ \lambda_2`, name: 'eigenvalues of P', def: R`The variances ($\sigma^2$) along the two axes of the error ellipse. Not the wavelength.`, unit: 'm²' },
  k: { sym: R`k`, name: 'ellipse scale factor', def: R`The ellipse that contains a share $p$ of the fixes is $k = \sqrt{-2\ln(1-p)}$ sigmas across: 2.448 for 95 %.` },
  drms: { name: 'DRMS', def: R`Distance root-mean-square: the rms miss distance, $\sqrt{\sigma_x^2 + \sigma_y^2}$.`, unit: 'm' },
  cep: { name: 'CEP', def: R`Circular error probable: the radius of the circle, centred on the truth, that contains half the fixes.`, unit: 'm' },
  dop: { name: 'DOP', def: R`Dilution of precision: rms position error per unit of per-collector range error $c\,\sigma_T$. A pure number that depends on geometry alone.` },
  bias: { name: 'bias, noise', def: R`Noise differs from one measurement to the next and averages down. A bias is the same every time and does not.` },
  y: { sym: R`y`, name: 'fractional frequency error', def: R`An oscillator's frequency error divided by its frequency. It shifts a measured frequency by $y\,f_0$: $10^{-9}$ is 1 Hz at 1 GHz.` },
  ephemeris: { name: 'ephemeris', def: R`A collector's own position and velocity, as known to the processor.` },

  // ---------------------------------------------------------------- measuring TDOA and FDOA
  recordings: { sym: R`x_1(t),\ x_2(t)`, name: 'recordings', def: R`What the two collectors record: the signal $s(t)$ plus each receiver's own noise $n_i(t)$, as complex samples.` },
  chi: { sym: R`\chi(\tau',\nu')`, name: 'cross-ambiguity function (CAF)', def: R`How well the two recordings match when one is shifted by a trial delay $\tau'$ and a trial Doppler shift $\nu'$. The location of its peak is the measured TDOA and FDOA.` },
  T: { sym: R`T`, name: 'integration time', def: R`How long the two recordings are that get compared.`, unit: 's' },
  Bs: { sym: R`B_s`, name: 'signal bandwidth', def: R`The width of the band of frequencies the signal occupies.`, unit: 'Hz' },
  B: { sym: R`B`, name: 'processed noise bandwidth', def: R`The width of the band that the processing lets noise through. Here it is filtered down to $B = B_s$.`, unit: 'Hz' },
  fs: { sym: R`f_s`, name: 'sampling rate', def: R`The number of samples recorded per second.`, unit: 'Hz' },
  snr: { sym: R`\gamma_1,\ \gamma_2,\ \gamma`, name: 'signal-to-noise ratio (SNR)', def: R`Signal power divided by noise power in the band $B$, at each collector, and the effective value for the pair: $1/\gamma = \tfrac12\big(1/\gamma_1 + 1/\gamma_2 + 1/(\gamma_1\gamma_2)\big)$.` },
  BTg: { sym: R`BT\gamma`, name: 'post-integration SNR', def: R`The SNR after combining the roughly $BT$ independent samples in the recording.` },
  beta_bandwidth: { sym: R`\beta`, name: 'rms radian bandwidth', def: R`A measure of how spread out the signal's spectrum is: $\pi B_s/\sqrt3$ for a flat spectrum.`, unit: 'rad/s' },
  Te: { sym: R`T_e`, name: 'rms radian duration', def: R`The same measure for the recording's extent in time: $\pi T/\sqrt3$.`, unit: 's' },
  lobe: { name: 'main lobe', def: R`The central peak of the CAF: about $1/B_s$ wide in delay and $1/T$ wide in Doppler.` },
  resolution: { name: 'resolution, accuracy', def: R`Resolution: how close two emitters can be and still give separate peaks. Accuracy: how well the centre of one peak can be located. Accuracy can be far finer than resolution.` },
  threshold: { name: 'threshold', def: R`The SNR below which a noise peak is sometimes mistaken for the true one.` },

  // ---------------------------------------------------------------- orbit and 3-D
  hyperboloid: { name: 'hyperboloid', def: R`The 3-D surface made by spinning a hyperbola about the line through its foci. It has two separate halves (sheets); a TDOA puts the emitter on one of them.` },
  wgs84: { name: 'WGS-84 ellipsoid', def: R`The standard, slightly flattened model of the Earth's shape. Heights are measured from it.` },
  surface: { name: 'surface constraint', def: R`The extra equation which says that the emitter sits at a known height above the ellipsoid.` },
  lop: { name: 'line of position', def: R`Where a measurement's surface cuts the Earth's surface. The emitter is somewhere along it.` },
  frames: { name: 'ECI, ECEF', def: R`Two coordinate frames centred on the Earth. ECI (inertial) does not rotate; ECEF (Earth-fixed) turns with the Earth.` },
  enu: { sym: R`\sigma_E,\ \sigma_N,\ \sigma_U`, name: 'east, north and up errors', def: R`1-sigma errors in the local east, north and vertical directions at the emitter. $\sigma_h$ is the horizontal total.`, unit: 'm' },
  hdop: { name: 'HDOP, VDOP', def: R`Horizontal and vertical dilution of precision: DOP split into its horizontal and vertical parts.` },
  L: { sym: R`L`, name: 'formation baseline', def: R`The size of a cluster of collectors: the typical separation between them.`, unit: 'km' },
  beta_angle: { sym: R`\beta`, name: 'angular size of the cluster', def: R`How large the cluster looks from the emitter, $\beta \approx L/\rho$ in radians. (In lesson 6 the same letter is a bandwidth.)` },
  elevation: { sym: R`\epsilon`, name: 'elevation', def: R`The angle of a line of sight above the emitter's horizon: 90° is straight overhead.` },
  track: { name: 'sub-satellite point, ground track', def: R`The sub-satellite point is the spot on the ground directly beneath a satellite. The ground track is the path it traces as the satellite moves.` },
  tpass: { sym: R`t`, name: 'time in the pass', def: R`Seconds from the formation's closest approach to the emitter, which is $t = 0$.`, unit: 's' },
  orbits: { name: 'LEO, MEO, GEO', def: R`Low, medium and geostationary Earth orbit: a few hundred to 2000 km up, around 20 000 km, and 35 786 km.` },
  Q: { sym: R`\mathbf Q`, name: 'rotation matrix', def: R`Turns Earth-centred coordinates into local east, north and up at the emitter.` },

  // ---------------------------------------------------------------- physics
  te: { sym: R`t_e`, name: 'emission time', def: R`When the wavefront left the emitter. The same instant as $t_0$ in Part I.`, unit: 's' },
  lighttime: { name: 'light-time equation', def: R`$t_i = t_e + \lVert\mathbf r_i(t_i) - \mathbf r_e(t_e)\rVert/c$: each collector is taken where it is when the signal arrives, not where it was when the signal left.` },
  nhat: { sym: R`\hat{\mathbf n}_i`, name: 'ray direction', def: R`A vector of length 1 along the signal's path from the emitter to collector $i$.` },
  sagnac: { name: 'Sagnac effect', def: R`The change in path length that appears when distances are measured in the rotating, Earth-fixed frame as if it were inertial.` },
  omegaE: { sym: R`\omega_E`, name: "Earth's rotation rate", def: R`$7.292\times10^{-5}$ rad/s, one turn per sidereal day.`, unit: 'rad/s' },
  areaA: { sym: R`\mathbf A`, name: 'area vector', def: R`Of the triangle Earth's centre, emitter, collector, in the Sagnac formula. Not collector A.`, unit: 'm²' },
  clockRate: { sym: R`\mathrm d\tau/\mathrm dt`, name: 'clock rate', def: R`The rate of a clock's own (proper) time $\tau$ against coordinate time $t$. In this formula $\tau$ is not a TDOA.` },
  potential: { sym: R`U,\ W_0`, name: 'gravitational potential', def: R`At the clock, and on the geoid (mean sea level).`, unit: 'm²/s²' },
  GM: { sym: R`GM`, name: "Earth's gravitational parameter", def: R`$3.986\times10^{14}$ m³/s².`, unit: 'm³/s²' },
  shapiro: { name: 'Shapiro delay', def: R`The extra travel time that arises because gravity slows light slightly.` },
  radii: { sym: R`r_e,\ r_c`, name: 'geocentric distances', def: R`Distances of the emitter and the collector from the Earth's centre, in the Shapiro formula.`, unit: 'm' },
  gnss: { name: 'GNSS', def: R`Global navigation satellite systems such as GPS. Collectors take their time, frequency and position from them.` },
  dispersive: { name: 'dispersive', def: R`Having a delay that depends on frequency. The ionosphere is dispersive; the troposphere is not.` },
  tec: { name: 'TEC, STEC, VTEC, TECU', def: R`Total electron content: the number of free electrons in a column of 1 m² through the ionosphere, along the slanting signal path (STEC) or vertically (VTEC). One TEC unit is $10^{16}$ electrons/m².` },
  ionoPath: { sym: R`I`, name: 'ionospheric excess path', def: R`$40.3\,\text{STEC}/f^2$ metres: a delay on the signal's envelope (TDOA) and an equal advance on its carrier phase (FDOA).`, unit: 'm' },
  orbitShape: { sym: R`e,\ a`, name: 'eccentricity, semi-major axis', def: R`How elongated the orbit is, and half its longest diameter.` },

  // ---------------------------------------------------------------- lab
  processor: { name: 'processor', def: R`The software that turns measurements into a position. It may model less physics than the simulator that produced the measurements.` },
  model: { sym: R`\mathbf h(\mathbf x)`, name: 'measurement model', def: R`The measurements the processor predicts for an emitter at $\mathbf x$.` },
  sigmaMeas: { sym: R`\sigma_{TOA},\ \sigma_{FOA}`, name: 'measurement noise', def: R`Error in one collector's time of arrival and frequency of arrival from receiver noise alone.`, unit: 's, Hz' },
  sigmaClk: { sym: R`\sigma_{clk}`, name: 'clock synchronisation error', def: R`How well one collector's clock is aligned with the others'.`, unit: 's' },
  sigmaLO: { sym: R`\sigma_{LO}`, name: 'oscillator error', def: R`Fractional frequency error of a collector's local oscillator. It adds $f_0\,\sigma_{LO}$ hertz.` },
  sigmaEph: { sym: R`\sigma_{pos},\ \sigma_{vel}`, name: 'ephemeris errors', def: R`Uncertainty in a collector's own position and velocity.`, unit: 'm, m/s' },
  sigmaAlt: { sym: R`\sigma_{alt}`, name: 'altitude uncertainty', def: R`How well the emitter's height is known when the surface constraint is used.`, unit: 'm' },
  pseudo: { name: 'altitude pseudo-measurement', def: R`The emitter's known height treated as one more measurement, with error $\sigma_{alt}$.` },
  snapshot: { name: 'snapshot', def: R`One collection, at one instant of the pass.` },
};

export const BY_LESSON = {
  welcome: ['collectors', 'emitter', 't0', 'ti', 'c', 'rho_i', 'f0', 'fi', 'tau', 'nu', 'positions', 'baseline', 'rhodot', 'lambda', 'N', 'dop'],
  'tdoa-plane': ['collectors', 'emitter', 'tau', 'c', 'rho_i', 'los', 'hyperbola', 'baseline', 'nabla', 'lhat', 'theta', 'delta', 'rho', 'dperp', 'phi', 'lever', 'bisector', 'broadside', 'xy', 'N', 'sigma', 'sigmaT', 'sigmaDiff', 'crlb', 'ellipse', 'fix', 'ghost'],
  'fdoa-plane': ['f0', 'fi', 'lambda', 'v', 'alpha', 'rho_i', 'rhodot', 'nu', 'los', 'lhat', 'vperp', 'nabla', 'baseline', 'rho', 'trail', 'bisector', 'u'],
  'fusion-plane': ['tau', 'nu', 'sigmaT', 'sigmaF', 'sigmaDiff', 'ellipse', 'x', 'delta', 'z', 'nabla', 'H', 'Rcov', 'wls', 'P', 'crlb', 'trail', 'ghost', 'fix'],
  dop: ['sigmaT', 'sigmaF', 'ellipse', 'crlb', 'mc', 'z', 'nabla', 'H', 'Rcov', 'P', 'eig', 'axes', 'k', 'drms', 'cep', 'dop', 'c', 'ref', 'lambda', 'vperp', 'rho', 'rhodot'],
  'error-budget': ['tau', 'nu', 'c', 'lambda', 'delta', 'nabla', 'lever', 'rho', 'baseline', 'dperp', 'theta', 'v', 'vperp', 'trail', 'sigmaT', 'sigmaF', 'z', 'H', 'Rcov', 'K', 'ref', 'bias', 'y', 'ephemeris', 'u'],
  caf: ['tau', 'nu', 'recordings', 'chi', 'T', 'Bs', 'B', 'fs', 'snr', 'BTg', 'lobe', 'resolution', 'beta_bandwidth', 'Te', 'sigmaDiff', 'crlb', 'mc', 'threshold', 'sigmaT', 'sigmaF'],
  'orbit-3d': ['collectors', 'rho_i', 'tau', 'nu', 'hyperboloid', 'positions', 'rhodot', 'wgs84', 'surface', 'lop', 'track', 'tpass', 'ellipse', 'crlb', 'cep', 'enu', 'sigmaT', 'sigmaF', 'N', 'nabla', 'lhat', 'L', 'rho', 'beta_angle', 'dop', 'hdop', 'P', 'Q', 'elevation'],
  physics: ['tau', 'nu', 'cep', 'te', 'ti', 'lighttime', 'nhat', 'frames', 'sagnac', 'omegaE', 'areaA', 'rhodot', 'clockRate', 'potential', 'orbits', 'gnss', 'orbitShape', 'GM', 'shapiro', 'radii', 'dispersive', 'tec', 'ionoPath', 'elevation'],
  lab: ['processor', 'f0', 'L', 'tpass', 'surface', 'sigmaAlt', 'pseudo', 'sigmaMeas', 'sigmaClk', 'sigmaLO', 'sigmaEph', 'ephemeris', 'Bs', 'B', 'T', 'snr', 'ref', 'z', 'model', 'x', 'H', 'Rcov', 'P', 'K', 'crlb', 'mc', 'cep', 'ellipse', 'enu', 'dop', 'hdop', 'bias', 'snapshot'],
};
