/**
 * questions.js - "Check your understanding" questions for every lesson, keyed by lesson id.
 * =====================================================================================
 * Rendered by questionSet() in ../ui/quiz.js, just above each lesson's takeaways.
 * Every string is HTML with $inline$ / $$display$$ math (use String.raw for TeX).
 *
 * Three kinds of question:
 *
 *   { type: 'choice', prompt, options: [{ text, correct?: true, why? }, ...], explain, ordered? }
 *       Exactly one option has correct: true. `why` is shown when that option is picked
 *       (for a wrong option: what is wrong with it). `explain` is shown once the right
 *       option has been picked. Options are shuffled on each visit, so their order here
 *       does not matter; set ordered: true to keep it when they form a natural scale.
 *
 *   { type: 'number', key, prompt, answer, tol?, absTol?, unit?, hint?, explain }
 *       The reader types a number. It is accepted when |x - answer| <= tol * |answer|
 *       (tol is relative, default 0.05) or |x - answer| <= absTol when absTol is given.
 *       `unit` is printed after the input box. `hint` is shown after a wrong attempt.
 *       `explain` is the worked solution, shown when the answer is accepted or revealed.
 *       `key` is not displayed: tests/questions.test.mjs uses it to recompute the answer
 *       from the physics engine, so every number question must have a unique one.
 *
 *   { type: 'think', prompt, explain }
 *       No input: the reader decides on an answer, then reveals `explain`.
 *
 * The questions are meant to make the reader commit: most can only be answered by
 * calculating something or by going back to a figure, and every wrong option says why
 * it is wrong. Numbers quoted in explanations come from the engine (see the test).
 */

const R = String.raw;

// ============================================================================ 0 · welcome
const welcome = [
  {
    type: 'choice',
    prompt: R`Why does a passive system work with the <em>difference</em> of two arrival times instead of each arrival time on its own?`,
    options: [
      {
        text: R`A difference of two measurements is less noisy than either one.`,
        why: R`It is the other way round: subtracting two independent measurements adds their noise, so the difference is noisier by $\sqrt2$.`,
      },
      { text: R`The unknown transmit time $t_0$ is the same in both arrival times, so it cancels.`, correct: true },
      {
        text: R`The collectors then no longer need synchronised clocks.`,
        why: R`They still do. Any timing offset between the two collectors goes straight into the TDOA; that is one of the main error sources in Part II.`,
      },
      {
        text: R`The speed of light cancels out of the difference.`,
        why: R`$c$ is still there: $\tau_{ij} = (\rho_i - \rho_j)/c$. What cancels is $t_0$.`,
      },
    ],
    explain: R`Each arrival time is $t_i = t_0 + \rho_i/c$. The emitter never tells you $t_0$, but it is common to every collector, so $t_i - t_j = (\rho_i - \rho_j)/c$ depends only on geometry.`,
  },
  {
    type: 'number',
    key: 'welcome.tau',
    prompt: R`Collector A is 400 km from the emitter and collector B is 430 km from it. What is $\tau_{BA} = t_B - t_A$?`,
    answer: 100.07,
    tol: 0.02,
    unit: 'µs',
    hint: R`The range difference is $\rho_B - \rho_A$. Divide it by $c \approx 299\,792$ km/s, and mind the order of the subscripts.`,
    explain: R`$\tau_{BA} = (\rho_B - \rho_A)/c = 30\ \text{km} / 299\,792\ \text{km/s} = 100.07\ \mu\text{s}$. It is positive because the signal reaches B later. A handy number: light covers about 300 m per microsecond.`,
  },
  {
    type: 'number',
    key: 'welcome.fdoa',
    prompt: R`A stationary emitter transmits at $f_0 = 1$ GHz. Collector A flies straight at it at 200 m/s. Collector B also flies at 200 m/s, but exactly at right angles to its line of sight to the emitter. What is the FDOA $\nu_{AB} = f_A - f_B$?`,
    answer: 667.1,
    tol: 0.02,
    unit: 'Hz',
    hint: R`Find each range rate first. Only motion along the line of sight changes the range, and closing means $\dot\rho < 0$.`,
    explain: R`A is closing at 200 m/s, so $\dot\rho_A = -200$ m/s. B's distance to the emitter is momentarily not changing, so $\dot\rho_B = 0$. Then $\nu_{AB} = -\tfrac{f_0}{c}(\dot\rho_A - \dot\rho_B) = -\tfrac{10^9}{2.998\times10^8}\,(-200) = +667$ Hz. Both collectors have the same speed; what differs is how fast each one's <em>range</em> is changing.`,
  },
  {
    type: 'number',
    key: 'welcome.lambda3',
    prompt: R`At a carrier of 3 GHz, a 1 Hz error in FDOA corresponds to what error in range-rate difference?`,
    answer: 0.0999,
    tol: 0.03,
    unit: 'm/s',
    hint: R`1 Hz of FDOA is one wavelength per second. What is $\lambda = c/f_0$ at 3 GHz?`,
    explain: R`$\lambda = c/f_0 = 2.998\times10^8 / 3\times10^9 = 0.0999$ m, so 1 Hz is 0.10 m/s of range-rate difference. At 300 MHz the same hertz would be 1 m/s: the lower the carrier, the more range rate each hertz stands for.`,
  },
  {
    type: 'choice',
    ordered: true,
    prompt: R`A third collector C joins the pair A, B. You can now form $\tau_{BA}$, $\tau_{CA}$ and $\tau_{CB}$. How many of these are independent?`,
    options: [
      { text: R`One`, why: R`Each new collector adds one new arrival time, so it adds one new independent difference.` },
      { text: R`Two`, correct: true },
      { text: R`Three`, why: R`The third is fixed by the other two: $\tau_{CB} = \tau_{CA} - \tau_{BA}$. It adds no information.` },
    ],
    explain: R`Three arrival times, one unknown $t_0$ removed: two independent differences. In general $N$ collectors give $N-1$ independent TDOAs (and $N-1$ FDOAs). Two curves on a plane cross at a point, which is why three collectors can fix an emitter with TDOA alone.`,
  },
];

// ============================================================================ 1 · TDOA on a plane
const tdoaPlane = [
  {
    type: 'choice',
    prompt: R`A and B lie on an east–west line. The emitter is somewhere on the perpendicular bisector of AB. What does the pair measure, and what is the curve of constant TDOA through the emitter?`,
    options: [
      { text: R`$\tau_{BA} = 0$, and the curve is the bisector itself: a straight line.`, correct: true },
      {
        text: R`$\tau_{BA} = 0$, and the curve is a circle through A and B.`,
        why: R`The points at equal distance from A and B form the perpendicular bisector, not a circle.`,
      },
      {
        text: R`$\lvert\tau_{BA}\rvert$ is at its maximum, $d/c$.`,
        why: R`The maximum is on the line through A and B, outside the pair, where one collector is closer by the whole baseline. On the bisector the ranges are equal.`,
      },
      {
        text: R`It depends on how far along the bisector the emitter is.`,
        why: R`Every point of the bisector is equidistant from A and B, so $\tau_{BA} = 0$ all the way along it. That is exactly why one TDOA cannot tell you the range.`,
      },
    ],
    explain: R`Equal ranges give zero time difference, and the zero-TDOA hyperbola degenerates into the straight bisector. The pair tells you the emitter is on that line and nothing about where on it.`,
  },
  {
    type: 'number',
    key: 'tdoa.max',
    prompt: R`A and B are 60 km apart. What is the largest $\lvert\tau_{BA}\rvert$ that any emitter, anywhere, can produce?`,
    answer: 200.1,
    tol: 0.02,
    unit: 'µs',
    hint: R`The range difference can never exceed the baseline (triangle inequality).`,
    explain: R`$\lvert\rho_B - \rho_A\rvert \le d$, so $\lvert\tau_{BA}\rvert \le d/c = 60/299\,792\ \text{s} = 200.1\ \mu\text{s}$. The extreme is reached only on the line through A and B, outside the pair. A measured value beyond $d/c$ cannot come from geometry: suspect the clocks, or a correlation peak that belongs to a different signal.`,
  },
  {
    type: 'number',
    key: 'tdoa.lever',
    prompt: R`An emitter is 500 km from each of two collectors that are 50 km apart, so it is on their bisector. The measured TDOA is wrong by 10 ns. How far does the curve move at the emitter?`,
    answer: 30,
    tol: 0.05,
    unit: 'm',
    hint: R`Convert the 10 ns into metres of range difference, then multiply by the lever arm: range over baseline.`,
    explain: R`10 ns is $c\,\delta\tau = 3.0$ m of range difference. The lever arm is $\rho/d = 500/50 = 10$, so the curve moves $3.0\times10 = 30$ m. On the bisector this rule is exact: $\delta n = c\,\delta\tau/(2\sin(\theta/2))$ with $\sin(\theta/2) = (d/2)/\rho$. Halve the baseline, or double the range, and the same 10 ns costs 60 m.`,
  },
  {
    type: 'choice',
    prompt: R`The emitter is on the line through A and B, out beyond B. Why can this pair say almost nothing about how far beyond B it is?`,
    options: [
      {
        text: R`Both lines of sight point the same way, so sliding the emitter along the line changes both ranges equally and their difference stays at $-d$.`,
        correct: true,
      },
      {
        text: R`Because $\tau_{BA}$ is zero there.`,
        why: R`It is at its extreme, $-d/c$: B is closer by the full baseline. Zero belongs to the bisector.`,
      },
      {
        text: R`Because B blocks the signal on its way to A.`,
        why: R`Nothing is blocked. The problem is geometric: the measurement stops changing as the emitter moves.`,
      },
      {
        text: R`Because timing noise is larger in that direction.`,
        why: R`The noise is the same everywhere. What changes is how much position error each nanosecond of it buys, and here the gradient of $\tau_{BA}$ is zero.`,
      },
    ],
    explain: R`$\nabla\tau_{BA} = (\hat{\mathbf l}_A - \hat{\mathbf l}_B)/c$ vanishes when the two lines of sight coincide. The hyperbola collapses onto the ray from B outward, and a 1 ns error moves it without bound. A pair is blind along its own axis, which is why you want collectors spread <em>across</em> the line of sight to the emitter.`,
  },
];

// ============================================================================ 2 · FDOA on a plane
const fdoaPlane = [
  {
    type: 'number',
    key: 'fdoa.doppler60',
    prompt: R`Collector A flies at 250 m/s. A stationary 1 GHz emitter is 60° off its nose. What Doppler shift $f_A - f_0$ does A see?`,
    answer: 417,
    tol: 0.03,
    unit: 'Hz',
    hint: R`Only the velocity component along the line of sight counts, $v\cos\alpha$. Divide it by the wavelength.`,
    explain: R`$f_A - f_0 = (v/\lambda)\cos\alpha = (250/0.2998)\times0.5 = 417$ Hz. It is positive because the emitter is ahead and the range is closing at 125 m/s. Notice what is absent: the distance to the emitter. One collector's Doppler shift gives a direction relative to its velocity, not a range.`,
  },
  {
    type: 'choice',
    prompt: R`Where can the emitter be when A measures exactly zero Doppler shift?`,
    options: [
      { text: R`Anywhere on the line through A at right angles to its velocity, at any distance.`, correct: true },
      { text: R`Only directly ahead of A.`, why: R`Dead ahead the range closes at the full speed $v$, which gives the largest shift, $+v/\lambda$.` },
      {
        text: R`Only at one particular point, the point of closest approach.`,
        why: R`"Closest approach" is the right idea, but it is not one point: every emitter that is abeam of A right now, near or far, is at its closest approach right now.`,
      },
      { text: R`Only very far away.`, why: R`Distance does not enter: the shift is $(v/\lambda)\cos\alpha$, which depends on direction only.` },
    ],
    explain: R`Zero shift means zero range rate, so the velocity is perpendicular to the line of sight ($\cos\alpha = 0$). For one collector the lines of constant Doppler are rays from the collector, and the zero-Doppler ones point abeam.`,
  },
  {
    type: 'choice',
    prompt: R`Nothing moves on the map, but the emitter's carrier is 10 GHz instead of 1 GHz. What happens to the FDOA curves, and to the position cost of a 1 Hz measurement error?`,
    options: [
      { text: R`The curves stay where they are, each is labelled with ten times as many hertz, and 1 Hz costs ten times fewer metres.`, correct: true },
      {
        text: R`The curves move ten times closer to the collectors.`,
        why: R`The curves are sets of constant range-rate difference, which is pure geometry. The carrier only converts that into hertz.`,
      },
      {
        text: R`Nothing changes at all.`,
        why: R`The geometry does not change, but the hertz do: $\nu = -(\dot\rho_B - \dot\rho_A)/\lambda$, and $\lambda$ is now ten times shorter.`,
      },
      { text: R`1 Hz costs ten times more metres.`, why: R`The other way round: a shorter wavelength makes each hertz a smaller range-rate error.` },
    ],
    explain: R`FDOA in hertz is a range-rate difference divided by $\lambda$. Raise $f_0$ tenfold and every FDOA value, and the gradient $\lVert\nabla\nu\rVert$, grows tenfold, so a 1 Hz error moves the curve one tenth as far. FDOA is a strong measurement at high carriers and a weak one at VHF.`,
  },
  {
    type: 'choice',
    prompt: R`Two collectors fly in formation with identical velocities. The emitter's range doubles (it was already much larger than their separation). Roughly what happens to the metres of curve movement per hertz of FDOA error?`,
    options: [
      { text: R`It doubles.`, why: R`That is the TDOA law, range over baseline. FDOA is worse.` },
      { text: R`It quadruples.`, correct: true },
      { text: R`It stays the same.`, why: R`The lines of sight rotate more slowly at longer range, so the same hertz stands for a larger move.` },
      { text: R`It halves.`, why: R`Longer range never helps: both lines of sight rotate more slowly and more nearly alike.` },
    ],
    explain: R`Each line of sight rotates at $v_\perp/\rho$, and FDOA senses the <em>difference</em> of the two rotation rates, about $(v/\rho)(d/\rho)$. So metres per hertz go as $\lambda\rho^2/(v\,d)$: range hurts TDOA linearly and FDOA quadratically. For a pair 80 km apart flying in trail at 250 m/s, at 1 GHz, the engine gives 2.4 km per hertz broadside at 400 km and 9.6 km per hertz at 800 km.`,
  },
  {
    type: 'number',
    key: 'fdoa.moving',
    prompt: R`A is at $(-40, 0)$ km and B at $(40, 0)$ km. The emitter, at $(0, 30)$ km, is not stationary: it moves east at 5 m/s. The carrier is 1 GHz. By how much does the emitter's own motion change $\nu_{BA}$?`,
    answer: 26.7,
    tol: 0.03,
    unit: 'Hz',
    hint: R`Use $\Delta\nu_{BA} = \tfrac1\lambda\,\mathbf u\cdot(\hat{\mathbf l}_B - \hat{\mathbf l}_A)$. The triangles are 3-4-5, so the unit vectors from the emitter to the collectors are $(\pm0.8,\,-0.6)$.`,
    explain: R`$\hat{\mathbf l}_B - \hat{\mathbf l}_A = (0.8, -0.6) - (-0.8, -0.6) = (1.6, 0)$, so $\mathbf u\cdot(\hat{\mathbf l}_B - \hat{\mathbf l}_A) = 5\times1.6 = 8$ m/s and $\Delta\nu_{BA} = 8/0.2998 = +26.7$ Hz: the emitter closes on B at 4 m/s and opens from A at 4 m/s. A jogging emitter puts tens of hertz into a measurement that can be made to millihertz, and a processor that assumes a stationary emitter turns all of it into position error.`,
  },
];

// ============================================================================ 3 · TDOA + FDOA from one pair
const fusionPlane = [
  {
    type: 'choice',
    prompt: R`Two fixed towers receive a stationary emitter. How many useful measurements does this pair give for a position fix?`,
    options: [
      {
        text: R`Two: a TDOA and an FDOA.`,
        why: R`Nothing is moving, so no range is changing: every range rate is zero and the FDOA is zero wherever the emitter is. It says nothing about position.`,
      },
      { text: R`One: the TDOA. The FDOA is zero wherever the emitter is.`, correct: true },
      { text: R`None.`, why: R`The TDOA is still a perfectly good measurement; it confines the emitter to a hyperbola.` },
    ],
    explain: R`FDOA information comes from the collectors' motion: it is the difference of the rates at which the two lines of sight rotate. No motion, no FDOA curve, and the pair is back to a single hyperbola. That is why systems that fix with one pair fly it on aircraft or satellites.`,
  },
  {
    type: 'number',
    key: 'fusion.sin5',
    prompt: R`The fix lies where the TDOA band and the FDOA band overlap: a parallelogram whose long diagonal grows like $1/\sin(\text{crossing angle})$. By what factor does it grow when the curves cross at 5° instead of 90°?`,
    answer: 11.5,
    tol: 0.05,
    unit: '×',
    hint: R`Evaluate $1/\sin 5^\circ$.`,
    explain: R`$1/\sin 5^\circ = 11.5$. Neither measurement has become any worse; the same two bands simply overlap in a long sliver. The in-trail pair with E at about (90, 10) km shows it in the first figure: the ellipse stretches to kilometres along two nearly parallel curves.`,
  },
  {
    type: 'choice',
    prompt: R`The collectors fly in trail along the $x$ axis and the emitter is at (15, 60) km. Which other point produces exactly the same TDOA <em>and</em> the same FDOA?`,
    options: [
      { text: R`(15, −60) km, the mirror image across the collectors' track.`, correct: true },
      {
        text: R`(−15, 60) km, the mirror image across the perpendicular bisector.`,
        why: R`That swaps which collector is closer, so the TDOA changes sign.`,
      },
      { text: R`(−15, −60) km.`, why: R`That is also on the other side of the bisector, so the TDOA has the opposite sign.` },
      { text: R`No other point.`, why: R`Check the symmetry: reflecting across the track leaves both ranges and both range rates unchanged.` },
    ],
    explain: R`Reflecting the emitter across the line the collectors fly along changes neither its distance to A or B nor the rate at which those distances change, so both measurements are identical. Two collectors alone cannot tell left from right. Something else has to: a third collector, the antenna's field of view, the horizon, or a later look.`,
  },
  {
    type: 'choice',
    prompt: R`A solver returns a position whose predicted TDOA and FDOA match the measurements essentially perfectly (cost ≈ 0). Does that show it has found the emitter?`,
    options: [
      {
        text: R`Yes: zero residual means the answer is right.`,
        why: R`Zero residual means the answer is <em>consistent</em> with the measurements. A ghost is consistent too.`,
      },
      { text: R`No: a ghost fits equally well, and which solution the solver reaches depends on where it started.`, correct: true },
      {
        text: R`No: zero residual means the solver failed to converge.`,
        why: R`It did converge, and to a genuine solution of the equations. The trouble is that the equations have more than one.`,
      },
    ],
    explain: R`The curves cross in more than one place and each crossing sits at the bottom of its own basin. Residuals test fit, not uniqueness. Try it in the solver figure: from the default start it lands on the ghost, and from about (−30, 40) km on E, with the same final cost.`,
  },
];

// ============================================================================ 4 · DOP
const dop = [
  {
    type: 'number',
    key: 'dop.drms',
    prompt: R`At some emitter position the TDOA DOP is 12. Every collector has a timing error of $\sigma_T = 30$ ns. What is the rms position error (DRMS)?`,
    answer: 108,
    tol: 0.03,
    unit: 'm',
    hint: R`Express $\sigma_T$ as a distance first: $c\,\sigma_T$.`,
    explain: R`$c\,\sigma_T = 0.2998\ \text{m/ns}\times30\ \text{ns} = 9.0$ m, and DRMS $= \text{DOP}\times c\,\sigma_T = 12\times9.0 = 108$ m. The 9 m is what the receivers deliver; the factor 12 is what the geometry does to it.`,
  },
  {
    type: 'choice',
    prompt: R`For a TDOA-only fix, you replace every receiver so that $\sigma_T$ is halved. Nothing moves. What happens to the DOP and to the error ellipse?`,
    options: [
      { text: R`The DOP is unchanged; the ellipse keeps its shape and orientation and shrinks to half the size.`, correct: true },
      { text: R`The DOP halves; the ellipse is unchanged.`, why: R`DOP contains no noise at all: it is the position error per unit of $c\,\sigma_T$.` },
      {
        text: R`The DOP halves and the ellipse shrinks to a quarter.`,
        why: R`The improvement is counted once, in $c\,\sigma_T$. DOP depends only on where things are.`,
      },
      {
        text: R`The ellipse becomes rounder.`,
        why: R`Its shape is set by the directions of the measurement gradients, and those have not changed.`,
      },
    ],
    explain: R`Shape is geometry; size is noise. That separation is the point of DOP: you can ask where a set of collectors works well before knowing anything about the receivers, and you can see at once that better receivers will not rescue a bad geometry.`,
  },
  {
    type: 'number',
    key: 'dop.oneSigma',
    prompt: R`In two dimensions, what percentage of fixes fall inside the 1-sigma error ellipse?`,
    answer: 39.3,
    absTol: 1.5,
    unit: '%',
    hint: R`The ellipse containing probability $p$ has $k = \sqrt{-2\ln(1-p)}$. Solve for $p$ at $k = 1$.`,
    explain: R`$p = 1 - e^{-k^2/2} = 1 - e^{-1/2} = 39\,\%$, not the 68 % of a one-dimensional Gaussian. A "1-sigma ellipse" misses the truth more often than it contains it, which is why 2-D results are quoted as a 95 % ellipse ($k = 2.448$) or a CEP (50 %).`,
  },
  {
    type: 'choice',
    prompt: R`The emitter is far outside the polygon of collectors. You double every baseline. What happens to the TDOA DOP?`,
    options: [
      { text: R`It is unchanged.`, why: R`DOP depends on the geometry, and the collectors now subtend twice the angle at the emitter.` },
      {
        text: R`It halves.`,
        why: R`Across the line of sight the error does go as range/baseline, which would halve it. But the DRMS is dominated by the long axis, along the line of sight.`,
      },
      { text: R`It falls nearly fourfold.`, correct: true },
      { text: R`It doubles.`, why: R`Wider baselines always help: the lever arm gets shorter.` },
    ],
    explain: R`Far away, the error across the line of sight goes as range/baseline and the error along it as (range/baseline)$^2$. The long axis dominates the DRMS, so doubling the baselines cuts the DOP by nearly 4. For an 80 km triangle and an emitter 600 km away the engine gives 596 before and 162 after, a factor of 3.7. Check it yourself with "Spread × 2" on the DOP map.`,
  },
  {
    type: 'number',
    key: 'dop.fdoa',
    prompt: R`In "FDOA only" mode the DOP map reads 2000 s at the emitter. Each collector measures frequency to $\sigma_F = 0.1$ Hz and the carrier is 1 GHz. What is the rms position error?`,
    answer: 60,
    tol: 0.03,
    unit: 'm',
    hint: R`The map is in metres per (m/s). Convert 0.1 Hz into a range-rate error, $\lambda\,\sigma_F$.`,
    explain: R`$\lambda\,\sigma_F = 0.2998\ \text{m}\times0.1\ \text{Hz} = 0.030$ m/s, and $2000\ \text{s}\times0.030\ \text{m/s} = 60$ m. FDOA "DOP" has units of seconds because its natural unit error is a range rate. At 10 GHz the same 0.1 Hz is a tenth of the range-rate error and costs 6 m.`,
  },
];

// ============================================================================ 5 · error budget
const errorBudget = [
  {
    type: 'number',
    key: 'budget.rule',
    prompt: R`Apply the rule of thumb to the "Aircraft pair" preset ($v = 200$ m/s, $d = 30$ km, $\rho = 100$ km) at 1 GHz. About how far does a 1 Hz FDOA error move the curve?`,
    answer: 500,
    tol: 0.05,
    unit: 'm',
    hint: R`$\lambda\,\rho^2/(v\,d)$, with everything in SI units.`,
    explain: R`$\lambda\rho^2/(v\,d) = 0.2998\times(10^5)^2/(200\times3\times10^4) = 500$ m. Now select that preset in the Step 2 calculator and compare with the exact value: the rule is an order-of-magnitude guide, and the exact factor depends on whether the pair flies in trail or abreast. For the same geometry 1 ns of TDOA costs only $c\,\delta\tau\,\rho/d = 1$ m.`,
  },
  {
    type: 'number',
    key: 'budget.velocity',
    prompt: R`A collector's velocity along the line of sight is known to 3 cm/s. At 10 GHz, what FDOA error does that cause?`,
    answer: 1,
    tol: 0.03,
    unit: 'Hz',
    hint: R`$\delta\nu = \delta v/\lambda$.`,
    explain: R`$\lambda = 0.030$ m at 10 GHz, so $\delta\nu = 0.03/0.030 = 1.0$ Hz. A hertz at X-band is a few centimetres per second of velocity knowledge, which is why the ephemeris velocity appears in every FDOA error budget.`,
  },
  {
    type: 'choice',
    ordered: true,
    prompt: R`Which fractional frequency error $y$ in one collector's reference oscillator produces a 1 Hz FDOA error at 10 GHz?`,
    options: [
      { text: R`$10^{-6}$`, why: R`$y\,f_0 = 10^{-6}\times10^{10}$ Hz is 10 kHz.` },
      { text: R`$10^{-8}$`, why: R`That is 100 Hz at 10 GHz.` },
      { text: R`$10^{-10}$`, correct: true },
      { text: R`$10^{-12}$`, why: R`That is 0.01 Hz at 10 GHz.` },
    ],
    explain: R`$\delta\nu = y\,f_0$, so $y = 1\ \text{Hz}/10^{10}\ \text{Hz} = 10^{-10}$. That is better than an oven-controlled crystal and about what a chip-scale atomic clock offers, which is why collectors discipline their oscillators to GNSS. Remember that only the <em>difference</em> between two collectors' oscillators matters.`,
  },
  {
    type: 'choice',
    prompt: R`All four collectors' clocks are late by the same 50 ns. What happens to the fix?`,
    options: [
      { text: R`Nothing: an offset common to every collector cancels in every difference.`, correct: true },
      {
        text: R`It moves by about 15 m times the DOP.`,
        why: R`That would be the cost of 50 ns on <em>one</em> collector. Here every arrival time is late by the same amount.`,
      },
      { text: R`It moves by 15 m.`, why: R`50 ns is 15 m of range, but every range is longer by the same 15 m, and TDOA sees only differences.` },
      { text: R`The solver fails.`, why: R`The measurements it receives are exactly the ones a perfect system would produce.` },
    ],
    explain: R`A common delay is indistinguishable from the emitter having transmitted 50 ns later, and $t_0$ was never known anyway. Only differences between collectors' clocks hurt. The same holds for a common fractional frequency offset $y$, up to a tiny residual $y\,\nu_{ij}$.`,
  },
  {
    type: 'choice',
    prompt: R`Collector B's oscillator reads 1 Hz high for the whole pass. You average 100 independent fixes. What do you get?`,
    options: [
      { text: R`A fix ten times closer to the truth.`, why: R`The random part improves tenfold. The 1 Hz is not random.` },
      { text: R`A cluster ten times tighter, centred on the wrong place: the bias is untouched.`, correct: true },
      {
        text: R`The offset averages out, because errors are as often positive as negative.`,
        why: R`That is true of noise. This offset has the same sign every time.`,
      },
      { text: R`No improvement at all.`, why: R`The random scatter still shrinks as $1/\sqrt N$.` },
    ],
    explain: R`Averaging reduces random error as $1/\sqrt N$ and does nothing to a constant offset, which moves every fix by the same $K\,\delta\mathbf z$. Once the noise has been averaged down, biases set the floor. They are removed by calibrating against emitters at known positions, not by integrating for longer.`,
  },
];

// ============================================================================ 6 · cross-ambiguity function
const caf = [
  {
    type: 'choice',
    prompt: R`You need a more precise TDOA and a more precise FDOA from the same pair. Which property of the collection helps which?`,
    options: [
      { text: R`Signal bandwidth sharpens TDOA; integration time sharpens FDOA.`, correct: true },
      {
        text: R`Integration time sharpens TDOA; bandwidth sharpens FDOA.`,
        why: R`Reversed: the delay lobe is $1/B_s$ wide and the Doppler lobe $1/T$ wide.`,
      },
      {
        text: R`Only the SNR matters, for both.`,
        why: R`SNR scales both through $\sqrt{BT\gamma}$, but the lobe widths it divides are set by $B_s$ and $T$.`,
      },
      {
        text: R`A higher carrier frequency sharpens both.`,
        why: R`The carrier does not appear in Stein's bounds. (It changes what a hertz is worth in metres, which is a different question.)`,
      },
    ],
    explain: R`The CAF peak is about $1/B_s$ wide in delay and $1/T$ wide in Doppler, and the accuracy is that width divided by the post-integration voltage SNR $\sqrt{BT\gamma}$, times about one half. So a narrowband signal is a poor TDOA source and a short burst a poor FDOA source, whatever the SNR.`,
  },
  {
    type: 'number',
    key: 'caf.sigmaTau',
    prompt: R`A flat-spectrum signal with $B = B_s = 1$ MHz is integrated for $T = 10$ ms at an effective SNR of $\gamma = 1$ (0 dB). What is Stein's bound on the TDOA error?`,
    answer: 5.5,
    tol: 0.05,
    unit: 'ns',
    hint: R`$\sigma_\tau \approx 0.55/(B_s\sqrt{BT\gamma})$. Work out $BT\gamma$ first.`,
    explain: R`$BT\gamma = 10^6\times10^{-2}\times1 = 10^4$, so $\sqrt{BT\gamma} = 100$ and $\sigma_\tau = 0.55/(10^6\times100) = 5.5$ ns. The lobe is $1/B_s = 1\ \mu\text{s}$ wide, so the peak is located to about 1/180 of its width: resolution is not accuracy. The same collection gives $\sigma_\nu = 0.55/(T\sqrt{BT\gamma}) = 0.55$ Hz.`,
  },
  {
    type: 'choice',
    ordered: true,
    prompt: R`Everything else equal, you double the integration time $T$. By what factor does the FDOA bound $\sigma_\nu$ improve?`,
    options: [
      { text: R`$\sqrt2 \approx 1.4$`, why: R`That is what TDOA gains: only the $\sqrt{BT\gamma}$ term. FDOA gains from $T$ twice.` },
      { text: R`$2$`, why: R`The Doppler lobe is half as wide, but there is also more energy in the peak.` },
      { text: R`$2\sqrt2 \approx 2.8$`, correct: true },
      { text: R`$4$`, why: R`The lobe width goes as $1/T$ and the voltage SNR as $\sqrt T$: together $T^{3/2}$, not $T^2$.` },
    ],
    explain: R`$\sigma_\nu \propto 1/(T\sqrt{BT\gamma}) \propto T^{-3/2}$: the Doppler lobe is half as wide <em>and</em> the post-integration SNR is $\sqrt2$ higher. Long coherent integration is the route to millihertz FDOA, for as long as the geometry and the oscillators stay coherent.`,
  },
  {
    type: 'number',
    key: 'caf.gamma',
    prompt: R`Collector 1 hears the emitter at +20 dB SNR and collector 2 at −10 dB. What is the effective SNR $\gamma$ in Stein's formula, in dB?`,
    answer: -7,
    absTol: 0.3,
    unit: 'dB',
    hint: R`Convert to linear (100 and 0.1), use $1/\gamma = \tfrac12\big(1/\gamma_1 + 1/\gamma_2 + 1/(\gamma_1\gamma_2)\big)$, and convert back.`,
    explain: R`$1/\gamma = \tfrac12(0.01 + 10 + 0.1) = 5.06$, so $\gamma = 0.198$, which is $-7.0$ dB. The weak channel dominates: with one clean channel, $\gamma$ approaches twice the weaker SNR (+3 dB) and no more. A high-gain reference collector helps, but it cannot rescue a link in which the other collector hears almost nothing.`,
  },
  {
    type: 'choice',
    prompt: R`With $B_sT\gamma$ around 8 dB, the Monte-Carlo errors are far larger than Stein's bound predicts. Why?`,
    options: [
      {
        text: R`Below threshold a noise peak is sometimes higher than the true one; the bound only describes small errors around the right peak.`,
        correct: true,
      },
      {
        text: R`The bound uses the wrong SNR at low signal levels.`,
        why: R`The $1/(\gamma_1\gamma_2)$ term in $\gamma$ is exactly the low-SNR (noise × noise) correction. The bound is right about what it describes.`,
      },
      { text: R`The sampling rate is too low.`, why: R`The signal is sampled well above its bandwidth, and the peak is refined between samples.` },
      {
        text: R`The estimator is biased.`,
        why: R`Around the true peak it is not. The large errors are outliers: picks of an entirely different peak.`,
      },
    ],
    explain: R`The Cramér–Rao bound is a local statement: it assumes you are on the correct lobe. Below roughly 10 to 13 dB of $B_sT\gamma$ the search sometimes picks a noise peak anywhere in the search window. More search cells give the noise more chances, so a wider search raises the threshold, which is one reason real systems narrow the search with a coarse first estimate.`,
  },
];

// ============================================================================ 7 · orbit, 3-D
const orbit3d = [
  {
    type: 'choice',
    prompt: R`Two balls measure one TDOA and one FDOA. In 3-D that is two equations for three unknowns. Where does the third equation come from?`,
    options: [
      { text: R`The emitter is on the Earth's surface: its height above the ellipsoid is known, or assumed.`, correct: true },
      { text: R`From the pair's second FDOA.`, why: R`A pair has only one independent FDOA: $N - 1$ with $N = 2$.` },
      { text: R`From the emitter's transmit time.`, why: R`That is unknown, and differencing was the way to do without it.` },
      { text: R`No third equation is needed: two surfaces meet in a point.`, why: R`Two surfaces in 3-D meet in a curve, not a point.` },
    ],
    explain: R`One TDOA surface and one FDOA surface intersect in a curve; the Earth's surface cuts that curve at a point (and at its mirror image across the ground track). The price is that the assumed terrain height is now part of the measurement: in the default scenario a 30 m height error moves the fix by about 21 m.`,
  },
  {
    type: 'number',
    key: 'orbit.equations',
    prompt: R`Four balls use every independent TDOA, every independent FDOA and the surface constraint. How many equations is that, for the three unknowns of position?`,
    answer: 7,
    absTol: 0.01,
    unit: 'equations',
    hint: R`$N - 1$ of each kind, plus one.`,
    explain: R`$3 + 3 + 1 = 7$ equations for 3 unknowns. The four spare equations are what let least squares average down the noise, and what make the residuals a real consistency check: with exactly three equations the residuals are zero whatever the errors.`,
  },
  {
    type: 'choice',
    prompt: R`Four balls in a tight cluster, TDOA only, no surface constraint. The fix is good across the line of sight and poor along it. Why?`,
    options: [
      {
        text: R`The vectors $\hat{\mathbf l}_j - \hat{\mathbf l}_i$ lie almost perpendicular to the line of sight, so the TDOAs barely respond when the emitter moves toward or away from the cluster.`,
        correct: true,
      },
      { text: R`Timing noise is larger along the line of sight.`, why: R`Timing noise has no direction. The geometry decides where it lands.` },
      { text: R`The signal is weaker at longer range.`, why: R`That would enlarge the whole ellipsoid, not stretch it in one direction.` },
      {
        text: R`Three TDOAs are too few equations for three unknowns.`,
        why: R`Three are enough in principle, and the fix exists. Counting is necessary but not sufficient: here the equations are nearly dependent in one direction.`,
      },
    ],
    explain: R`$\nabla\tau_{ij} = (\hat{\mathbf l}_j - \hat{\mathbf l}_i)/c$. For a cluster that subtends a small angle $\beta \approx L/\rho$, these differences have length about $\beta$ across the line of sight but only about $\beta^2/2$ along it: range is sensed only through the curvature of the wavefront. The cluster is a superb direction finder and a poor range finder.`,
  },
  {
    type: 'number',
    key: 'orbit.scaling',
    prompt: R`For a tight cluster the along-line-of-sight error of a TDOA-only 3-D fix scales as $(\rho/L)^2$. If the baseline $L$ grows from 150 km to 300 km at the same range, by what factor does that error shrink?`,
    answer: 4,
    tol: 0.1,
    unit: '×',
    hint: R`Doubling $L$ halves $\rho/L$.`,
    explain: R`$(1/2)^2 = 1/4$: the along-range error falls fourfold, while the cross-range error, which goes as $\rho/L$, only halves. Press "Wide triangle + 1 (1000 km)" in the last figure to see where this leads: once the cluster spans a large patch of sky, four balls alone measure range well.`,
  },
  {
    type: 'choice',
    prompt: R`A symmetric diamond of four balls passes directly over the emitter. With TDOA only and no surface constraint, which direction can it not measure, and why?`,
    options: [
      {
        text: R`Up and down: all four lines of sight lie on one cone, so raising the emitter changes all four ranges equally and no TDOA changes.`,
        correct: true,
      },
      { text: R`East–west, because the satellites fly north.`, why: R`The diamond has collectors spread both along and across the track, so both horizontal directions are measured.` },
      { text: R`Along the ground track, because the Doppler is zero overhead.`, why: R`Doppler is not used here: this is a TDOA-only fix.` },
      {
        text: R`None: four balls always give a 3-D fix.`,
        why: R`Counting says a fix is possible. This geometry makes the three equations dependent.`,
      },
    ],
    explain: R`An equal change in every range is exactly what differencing removes. The cure is anything that breaks the symmetry or supplies height: a few tens of seconds of orbital motion, the FDOAs, or the surface constraint, which measures the missing direction directly.`,
  },
];

// ============================================================================ 8 · physics
const physics = [
  {
    type: 'number',
    key: 'physics.move',
    prompt: R`A signal travels 1000 km to a LEO collector moving at 7.6 km/s. How far does the collector move while the signal is in flight?`,
    answer: 25.4,
    tol: 0.05,
    unit: 'm',
    hint: R`Time of flight first: distance over $c$.`,
    explain: R`The flight takes $10^6\ \text{m}/c = 3.34$ ms, and $3.34\ \text{ms}\times7600\ \text{m/s} = 25$ m. Timing is good to nanoseconds, which is decimetres, so freezing the collector at the emission instant is not an option. Much of the displacement is common to a tight cluster and cancels in the differences: in the default scenario ignoring light-time changes the TDOAs by up to 3.2 ns and moves the fix by 6.9 m.`,
  },
  {
    type: 'choice',
    prompt: R`A processor solves the light-time equation in an inertial (non-rotating) frame. What Sagnac correction should it add?`,
    options: [
      {
        text: R`None. In the inertial frame the Earth's rotation is just part of where the emitter and the collectors are at each instant.`,
        correct: true,
      },
      {
        text: R`$\omega_E(x_e y_c - y_e x_c)/c^2$ for each link.`,
        why: R`That term is what you add when distances are measured in Earth-fixed coordinates as if they were inertial. Adding it to an inertial-frame solution counts the effect twice.`,
      },
      { text: R`Twice that term, one for each link of a TDOA.`, why: R`An inertial-frame solution already contains the whole effect; nothing is added.` },
      {
        text: R`A relativistic correction of order $v^2/c^2$.`,
        why: R`Sagnac is first order in $v/c$, and needs no more relativity than "light travels at $c$ in the inertial frame".`,
      },
    ],
    explain: R`The Sagnac term is a bookkeeping correction for working in a rotating frame. The simulator works in the inertial frame, so it contains no such term. The table row shows what a processor loses by working in Earth-fixed coordinates and forgetting it: 0.31 m here, and more for wider formations.`,
  },
  {
    type: 'number',
    key: 'physics.iono',
    prompt: R`Ignoring the ionosphere costs 4 ns of TDOA error at 1 GHz. With the same geometry and electron content, what does it cost at 250 MHz?`,
    answer: 64,
    tol: 0.03,
    unit: 'ns',
    hint: R`The ionospheric group delay goes as $1/f^2$.`,
    explain: R`$(1000/250)^2 = 16$, so $4\ \text{ns}\times16 = 64$ ns: about 19 m of range difference before the geometry multiplies it. The dispersion that makes the ionosphere so damaging at VHF and UHF is also what lets two carriers measure it. The troposphere is non-dispersive and offers no such handle.`,
  },
  {
    type: 'choice',
    prompt: R`When do relativistic clock-rate differences between collectors show up in FDOA?`,
    options: [
      {
        text: R`When the collectors' oscillators free-run on their own proper time, and mainly when the collectors fly at different altitudes.`,
        correct: true,
      },
      {
        text: R`Always: every FDOA must be corrected for them.`,
        why: R`Oscillators disciplined to GNSS are steered to coordinate time, which already contains these corrections.`,
      },
      {
        text: R`Never: relativity is too small to matter.`,
        why: R`Between a LEO and a GEO collector with free-running oscillators the rate difference is about 0.8 Hz at 1 GHz. For FDOA that is large.`,
      },
      {
        text: R`Only for emitters moving at a good fraction of the speed of light.`,
        why: R`These are the rates of the <em>collectors'</em> clocks: orbital speed (time dilation) and altitude (gravitational shift).`,
      },
    ],
    explain: R`A free-running oscillator reads every frequency with a fractional offset equal to its own rate offset, and FDOA sees the difference between two collectors. In this lesson's tight LEO cluster that is a few millihertz (0.40 m of fix error). Between LEO and GEO it is 0.8 Hz at 1 GHz.`,
  },
  {
    type: 'choice',
    prompt: R`In the default scenario at 1 GHz, which of these does the most damage to the fix if the processor ignores it?`,
    options: [
      { text: R`The Shapiro delay`, why: R`0.65 mm of fix error: the smallest entry in the table.` },
      { text: R`The Sagnac effect`, why: R`0.31 m here. Worth modelling, but not the largest.` },
      { text: R`Relativistic clock rates of free-running oscillators`, why: R`0.40 m here, and nothing at all if the oscillators are disciplined to GNSS.` },
      { text: R`The emitter moving at walking pace, 1 m/s`, correct: true },
    ],
    explain: R`An emitter moving at 1 m/s changes the FDOAs by up to 0.46 Hz and moves the fix by 72 m, more than twice the 31 m CEP. Finite light-time (6.9 m), the ionosphere (5.7 m) and the troposphere (2.5 m) come next, and relativity proper is at the bottom of the list. The physics you can model is rarely the problem; what you do not know about the emitter and the collectors usually is.`,
  },
];

// ============================================================================ 9 · lab
const lab = [
  {
    type: 'number',
    key: 'lab.oneHz',
    prompt: R`Press <strong>Reset</strong>, open the <strong>Sensitivity</strong> tab and select collector B. How far, horizontally, does a +1 Hz frequency error on B move the fix?`,
    answer: 159,
    tol: 0.05,
    unit: 'm',
    hint: R`Read the "frequency +1 Hz" row, Horizontal column.`,
    explain: R`159 m, against a CEP of 31 m: one hertz on one collector puts the fix five CEPs from the truth. Set B's frequency error to +1 Hz under "Deliberate errors" and the whole Monte-Carlo cloud moves by that amount. At 10 GHz the same hertz costs about 21 m.`,
  },
  {
    type: 'choice',
    prompt: R`Predict first, then run experiment 2: you widen the baseline from 150 km to 1200 km and the CEP falls from 31 m to about 5 m. Where does the improvement come from?`,
    options: [
      { text: R`Almost entirely from geometry: the DOP falls, while the per-collector error budget hardly changes.`, correct: true },
      {
        text: R`From lower measurement noise at each collector.`,
        why: R`Look at the Error budget tab while you drag: the timing and frequency errors per collector barely move.`,
      },
      { text: R`From a longer integration time.`, why: R`Nothing about the signal or how long it is integrated has changed.` },
      { text: R`From the collectors being closer to the emitter.`, why: R`If anything the outer collectors are now farther away, and lower in the sky.` },
    ],
    explain: R`The receivers deliver the same nanoseconds and hertz as before. What changes is the lever arm that converts them into metres: range ÷ baseline for TDOA, and the difference between the collectors' line-of-sight rotation rates for FDOA. The price appears in the Geometry tab: the outer satellites of the wide formation sit much lower in the sky, where the atmospheric path is longer.`,
  },
  {
    type: 'choice',
    prompt: R`A processor that ignores light-time and Earth rotation (experiment 4) has a bias of about 7 m, against a single-snapshot CEP of 31 m. Is the bias negligible?`,
    options: [
      {
        text: R`Yes: it is well inside the CEP.`,
        why: R`For one snapshot, yes. But nobody stops at one snapshot when a whole pass is available.`,
      },
      {
        text: R`No: it is the same in every snapshot, so once the noise has been averaged down over the pass the bias is what is left.`,
        correct: true,
      },
      { text: R`No: a 7 m bias makes the solver diverge.`, why: R`The solver converges happily, to a point 7 m from the truth.` },
    ],
    explain: R`Noise integrates down; a model error does not. The cumulative curve in the pass timeline falls to about 5.7 m by the end of the pass, below the 6.9 m bias, and it would keep falling with more passes while the bias stays. Compare a bias with the precision you will have <em>after</em> averaging, not with a single snapshot.`,
  },
  {
    type: 'choice',
    ordered: true,
    prompt: R`With the processor's ionosphere switch off (experiment 5), you move the carrier from 400 MHz to 4 GHz. By about what factor does the bias fall?`,
    options: [
      { text: R`10`, why: R`A $1/f$ law would give that. The excess path goes as $1/f^2$.` },
      { text: R`100`, correct: true },
      { text: R`1000`, why: R`That would need $1/f^3$. The first-order ionospheric term is $1/f^2$.` },
      { text: R`It does not change.`, why: R`That would be the troposphere, which is non-dispersive.` },
    ],
    explain: R`The ionospheric excess path is $40.3\,\text{STEC}/f^2$ metres: a delay on the envelope (TDOA) and an advance on the carrier phase (FDOA). Ten times the carrier, a hundred times less path. The engine gives 41 m at 400 MHz and 0.36 m at 4 GHz, a factor of 115 and not exactly 100, because the weighting of TDOA against FDOA shifts with the carrier too.`,
  },
  {
    type: 'think',
    prompt: R`A design question. The emitter is a vehicle driving at 10 m/s (experiment 6) and your fix is off by nearly 900 m. You may change one thing: <strong>(a)</strong> better oscillators, <strong>(b)</strong> a longer integration time, or <strong>(c)</strong> drop FDOA and fix with TDOA plus the altitude constraint. Decide which, and what it will cost you. Then try it in the lab.`,
    explain: R`<strong>(c).</strong> The 894 m is a bias, not noise: the processor assumes a stationary emitter, so the emitter's own Doppler is read as geometry. Options (a) and (b) reduce random error and leave that bias untouched: a tighter cloud in the wrong place. Dropping FDOA removes the bias almost completely (to a few centimetres), because TDOA depends on where things are and not on how they move. The cost is precision: the CEP doubles, from 31 m to 62 m, because TDOA alone has the weaker geometry from a tight cluster. Widening the baseline to 1200 km then brings it down to about 9 m. A real processor has a fourth option that the lab does not: solve for the emitter's velocity as well, which needs more measurements.`,
  },
];

export default {
  welcome,
  'tdoa-plane': tdoaPlane,
  'fdoa-plane': fdoaPlane,
  'fusion-plane': fusionPlane,
  dop,
  'error-budget': errorBudget,
  caf,
  'orbit-3d': orbit3d,
  physics,
  lab,
};
