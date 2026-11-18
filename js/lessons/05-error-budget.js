/**
 * 05-error-budget.js - "What does 1 ns or 1 Hz cost?" (Part II, lesson 5).
 *
 * Section A: unit conversion (ns -> m of range difference, Hz -> m/s of range-rate difference).
 * Section B: lever-arm calculator on an actual two-collector geometry (planar.gradTdoa / gradFdoa).
 * Section C: bias explorer - one collector's clock or frequency reference is off; exact solve vs K dz.
 * Section D: where a hertz or a nanosecond comes from - an editable error budget.
 *
 * Physics from the core (planar.*, constants.wavelength); glue in ./_errors.js.
 */
import { Plot2D } from '../ui/plot2d.js';
import { slider, toggle, segmented, readout, controlGroup, dataTable, fmt, fmtSI, fmtDist } from '../ui/controls.js';
import { el, lessonHeader, section, figure, callout, takeaways, nextLesson } from '../ui/layout.js';
import { questionSet } from '../ui/quiz.js';
import QUESTIONS from './questions.js';
import { planar, constants } from '../core/index.js';
import * as X from './_errors.js';

const { KM, C, NAMES, COLL_VARS } = X;
const lam = (f0) => constants.wavelength(f0);

const CSS = `
.l-eb .twin { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 14px; }
@media (max-width: 760px) { .l-eb .twin { grid-template-columns: minmax(0, 1fr); } }
.l-eb .plot-title { font-size: 12.5px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); margin: 0 0 6px 2px; }
.l-eb .nofix { position: absolute; inset: 10px 14px 40px 50px; display: none; align-items: center; justify-content: center;
  text-align: center; padding: 18px; font-size: 14px; line-height: 1.55; color: var(--text-2); background: var(--surface);
  border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); pointer-events: none; }
.l-eb .nofix.show { display: flex; }
.l-eb .nofix strong { color: var(--text); display: block; margin-bottom: 4px; }
.l-eb .budget input { width: 7.5em; min-height: 30px; padding: 4px 6px; }
.l-eb .budget .unit { color: var(--muted); font-size: 12.5px; margin-left: 6px; white-space: nowrap; }
.l-eb .budget td { vertical-align: middle; }
.l-eb .budget .mag { white-space: nowrap; }
.l-eb .budget .note { font-size: 12.5px; color: var(--text-2); min-width: 14em; }
.l-eb .budget tr.hl td { background: var(--accent-soft); }
.l-eb .geom-line { font-size: 14px; color: var(--text-2); max-width: var(--measure); }
.l-eb .geom-line strong { color: var(--text); font-variant-numeric: tabular-nums; }
.l-eb .big { font-size: 17px; }
`;

const CARRIERS = [1e8, 4e8, 1e9, 3e9, 1e10, 3e10];
const fHz = (f) => fmtSI(f, 'Hz', 3).replace('.00 ', ' ').replace(/\.0 /, ' ');

export default {
  id: 'error-budget',
  title: 'What does 1 ns or 1 Hz cost?',

  mount(root, ctx) {
    root.classList.add('l-eb');
    const removeStyle = X.injectStyle(CSS);
    const plots = [];

    root.append(lessonHeader({
      kicker: 'Part II · Lesson 5',
      title: 'What does 1 ns or 1 Hz cost?',
      lede: 'A hertz or a nanosecond is not large or small in itself. Its cost in metres is (unit conversion) × (geometry). This lesson makes both factors concrete, then asks where real hertz and nanoseconds come from.',
    }));

    // ================================================================ SECTION A
    const lam3 = lam(3e9), lam01 = lam(1e8);
    const tableA = dataTable({
      caption: 'What 1 Hz of FDOA error means at different carriers',
      columns: [
        { key: 'f', label: 'Carrier $f_0$' },
        { key: 'lambda', label: 'Wavelength $\\lambda$', align: 'right' },
        { key: 'rate', label: '1 Hz of FDOA =', align: 'right' },
        { key: 'rel', label: 'relative to 3 GHz', align: 'right' },
      ],
      rows: [],
    });
    const rowsA = (hl) => CARRIERS.map((f) => ({
      f: fHz(f), lambda: fmtDist(lam(f), 3), rate: `${fmt(lam(f), 3)} m/s`, rel: `× ${fmt(lam(f) / lam3, 3)}`,
      highlight: Math.abs(Math.log10(f / hl)) < 0.12,
    }));

    root.append(section('Step 1: unit conversion', String.raw`
      <p>Throughout this lesson a $\delta$ in front of a symbol means a small error in it: $\delta\tau$ is an error
      in a TDOA, $\delta\nu$ an error in an FDOA.</p>
      <p><strong>Time.</strong> TDOA measures a range difference, $\rho_i-\rho_j = c\,\tau_{ij}$ ($\rho_i$ is the
      range from the emitter to collector $i$, $c$ the speed of light). An error of
      $\delta\tau = 1$ ns is therefore a range-difference error of $c \times 1\,\text{ns} = ${fmt(C * 1e-9, 4)}$ m,
      whatever the carrier, bandwidth or geometry.</p>
      <p><strong>Frequency.</strong> FDOA measures a range-rate difference,
      $\nu_{ij} = -(\dot\rho_i-\dot\rho_j)/\lambda$, where $\dot\rho_i$ is the range rate (how fast $\rho_i$ is
      changing) and $\lambda = c/f_0$ is the wavelength at the carrier frequency $f_0$. An error $\delta\nu$ is a
      range-rate-difference error of</p>
      $$\delta\dot\rho = \lambda\,\delta\nu ,$$
      <p>one wavelength per second for every hertz. Unlike the time conversion, this one depends on the carrier.
      The same 1 Hz is ${fmt(lam01 / lam3, 2)} times more harmful at 100 MHz than at 3 GHz, simply because the
      wavelength is ${fmt(lam01 / lam3, 2)} times longer. (The table highlights the carrier selected in the calculator
      below.)</p>`,
    tableA));

    // ================================================================ SECTION B
    const L = { preset: 'leo', f0: 1e9, rho: 800e3, d: 150e3, v: 7500, geom: 'trail' };
    const hostSchem = el('div');
    const presetCtl = segmented({ label: 'Preset', options: [
      { value: 'aircraft', label: 'Aircraft pair' }, { value: 'leo', label: 'LEO cluster' }, { value: 'leoWide', label: 'LEO wide pair' },
      { value: 'custom', label: 'Custom' }], value: L.preset, onChange: (v) => applyPreset(v) });
    const fCtl = slider({ label: 'Carrier $f_0$', min: 1e8, max: 3e10, log: true, value: L.f0, format: (v) => fmtSI(v, 'Hz'),
      onInput: (v) => { L.f0 = v; updateB(); } });
    const rhoCtl = slider({ label: 'Range $\\rho$', min: 10e3, max: 3000e3, log: true, value: L.rho, format: (v) => fmtDist(v),
      hint: 'Distance from the emitter to the middle of the pair.',
      onInput: (v) => { L.rho = v; custom(); } });
    const dCtl = slider({ label: 'Baseline $d$', min: 1e3, max: 2000e3, log: true, value: L.d, format: (v) => fmtDist(v),
      hint: 'Distance between the two collectors.',
      onInput: (v) => { L.d = v; custom(); } });
    const vCtl = slider({ label: 'Collector speed $v$', min: 10, max: 10000, log: true, value: L.v,
      format: (v) => (v >= 1000 ? `${fmt(v / 1000, 3)} km/s` : `${fmt(v, 3)} m/s`), onInput: (v) => { L.v = v; custom(); } });
    const geomCtl = segmented({ label: 'Geometry', options: [{ value: 'trail', label: 'Pair in trail' }, { value: 'abreast', label: 'Pair abreast' }],
      value: L.geom, onChange: (v) => { L.geom = v; updateB(); },
      hint: 'Trail: both fly along the baseline. Abreast: both fly across it. Emitter broadside to the baseline in both.' });
    const roT = readout([
      { key: 'exact', label: 'Exact (core gradient)', unit: 'm per ns', hint: '1 ns divided by the length of the TDOA gradient' },
      { key: 'rule', label: 'Rule $c\\,\\delta\\tau\\,\\rho/d_\\perp$', unit: 'm per ns', hint: 'Far-away rule; d-perp is the part of the baseline across the line of sight (all of it here, the emitter being broadside)' },
      { key: 'rule2', label: '$c\\,\\delta\\tau/(2\\sin\\frac{\\theta}{2})$', unit: 'm per ns', hint: 'The exact formula from lesson 1' },
      { key: 'theta', label: 'Angle subtended $\\theta$', unit: '°', hint: 'Angle between the two lines of sight, measured at the emitter' },
    ]);
    const roF = readout([
      { key: 'exact', label: 'Exact (core gradient)', unit: 'm per Hz', hint: '1 Hz divided by the length of the FDOA gradient' },
      { key: 'rule', label: 'Rule $\\lambda\\,\\delta\\nu\\,\\rho^2/(v\\,d)$', unit: 'm per Hz', hint: 'Order-of-magnitude rule from lesson 2' },
      { key: 'ratio', label: 'Exact ÷ rule' },
      { key: 'lambda', label: 'Wavelength $\\lambda$', unit: 'm', hint: 'Speed of light divided by the carrier frequency' },
      { key: 'cross', label: 'TDOA/FDOA curves cross at', hint: 'Angle between the two curves at the emitter; 90 degrees is best' },
    ]);

    let lever = null;
    const presetNow = X.leverArm({ f0: 1e9, ...X.PRESETS.leo, geom: 'trail' });

    root.append(section('Step 2: the lever arm', String.raw`
      <p>A measurement error does not move the emitter; it moves the <em>curve</em> the emitter is thought to lie on.
      Let $z$ stand for either measurement, $\tau$ or $\nu$. Its gradient $\nabla z$ with respect to the emitter's
      position says how fast $z$ changes per metre of emitter movement, so an error $\delta z$ slides
      the curve sideways by $\delta z/\lVert\nabla z\rVert$ ($\lVert\nabla z\rVert$ is the length of the gradient).
      Metres of curve movement per unit of measurement error, $1/\lVert\nabla z\rVert$, is the
      <strong>lever arm</strong>. Take a pair of collectors a distance $d$ apart (their baseline), seen from an
      emitter at range $\rho$ (its distance from the pair), so that the two lines of sight make an angle $\theta$
      at the emitter:</p>
      <ul>
        <li><strong>TDOA.</strong> $\lVert\nabla\tau\rVert = (2/c)\sin(\theta/2)$, so the curve moves
        $c\,\delta\tau/(2\sin(\theta/2)) \approx c\,\delta\tau\,\rho/d_\perp$, where $d_\perp$ is the part of the
        baseline that lies across the line of sight (lesson 1 has the picture).</li>
        <li><strong>FDOA.</strong> $\lVert\nabla\nu\rVert = \frac1\lambda\lVert \mathbf v_{\perp i}/\rho_i-\mathbf v_{\perp j}/\rho_j\rVert$,
        where $\mathbf v_{\perp i}$ is the part of collector $i$'s velocity across its line of sight and $\rho_i$ its
        range. This is the difference of the two lines of sight's rotation rates, divided by $\lambda$. Two collectors a distance
        $d$ apart, both moving at speed $v$, have rotation rates that differ by about $v\,d/\rho^2$, so the curve moves
        about $\lambda\,\delta\nu\,\rho^2/(v\,d)$. This is an order-of-magnitude rule; the exact factor depends on
        the geometry.</li>
      </ul>
      <p>The calculator builds the actual two-collector geometry and takes the exact values from the core's
      gradients (<code>planar.gradTdoa</code>, <code>planar.gradFdoa</code>) for the measurements
      $\tau_{BA}$ and $\nu_{BA}$, with the rules of thumb alongside. In the presets, LEO is low Earth orbit:
      satellites a few hundred kilometres up, moving at about 7.5 km/s. "In trail" means flying one behind the
      other along the baseline; "abreast" means side by side, across it.</p>`,
    figure({
      plot: [hostSchem],
      controls: [
        controlGroup('Geometry', [presetCtl, geomCtl, rhoCtl, dCtl, vCtl, fCtl]),
      ],
      caption: 'Schematic of the two-collector geometry (to scale unless the baseline is tiny compared with the range, in which case it is drawn exaggerated and says so). Arrows are the collector velocities; dashed lines are the lines of sight.',
    }),
    el('div', 'twin',
      controlGroup('TDOA: curve displacement per 1 ns', [roT]),
      controlGroup('FDOA: curve displacement per 1 Hz', [roF])),
    String.raw`
      <p>For orientation: the LEO-cluster preset at 1 GHz gives ${fmt(presetNow.mPerNs, 3)} m per ns (rule
      ${fmt(presetNow.ruleT, 3)} m) and ${fmt(presetNow.mPerHz, 3)} m per Hz (rule ${fmt(presetNow.ruleF, 3)} m). The
      TDOA rule is excellent whenever the baseline is small compared with the range. The FDOA rule is good for the
      compact presets and is off by tens of percent for the LEO wide pair, whose baseline is comparable with its
      range.</p>`,
    callout('idea', 'Trail and abreast: same lever arms, different fixes', String.raw`
      <p>Switch between <em>pair in trail</em> and <em>pair abreast</em>: the lever arms do not change. In both cases
      the two lines of sight rotate at rates that differ by about $v\,d/\rho^2$; only the direction of the FDOA
      gradient changes. In trail the FDOA gradient points along the line of sight and the TDOA gradient across
      it, so the curves cross at 90° and each curve displacement is also the displacement of the fix. Abreast,
      both gradients point across the line of sight: the curves are parallel at the emitter and a lone pair cannot
      fix it at all (the crossing-angle readout drops to 0°). Lever arm and crossing angle are separate questions,
      which is why the previous lesson's covariance, not a single number, is the full answer.</p>`),
    ));

    const schem = new Plot2D(hostSchem, { height: 260, equalAspect: true, pan: false, zoom: false, axes: false, grid: false,
      view: { xmin: -1, xmax: 1, ymin: -1, ymax: 0.2 }, ariaLabel: 'Schematic of two collectors and an emitter.' });
    plots.push(schem);

    function custom() {
      if (L.preset !== 'custom') { L.preset = 'custom'; presetCtl.value = 'custom'; }
      updateB();
    }
    function applyPreset(p) {
      L.preset = p;
      if (X.PRESETS[p]) {
        Object.assign(L, { rho: X.PRESETS[p].rho, d: X.PRESETS[p].d, v: X.PRESETS[p].v });
        rhoCtl.value = L.rho; dCtl.value = L.d; vCtl.value = L.v;
      }
      updateB();
    }

    function updateB() {
      lever = X.leverArm({ f0: L.f0, rho: L.rho, d: L.d, v: L.v, geom: L.geom });
      roT.set({ exact: fmt(lever.mPerNs, 4), rule: fmt(lever.ruleT, 4), rule2: fmt(lever.ruleTExact, 4),
        theta: fmt((lever.theta * 180) / Math.PI, 3) });
      roF.set({ exact: fmt(lever.mPerHz, 4), rule: fmt(lever.ruleF, 4), ratio: fmt(lever.mPerHz / lever.ruleF, 3),
        lambda: fmt(lever.lambda, 4), cross: isFinite(lever.crossDeg)
          ? lever.crossDeg.toFixed(1) + '°' + (lever.crossDeg < 1 ? ' (parallel: a lone pair cannot fix)' : '') : '—' });
      tableA.setRows(rowsA(L.f0));
      schem.requestRedraw();
      updateD();
    }

    schem.onDraw = (g) => {
      const { rho, d, geom } = L;
      const dd = Math.max(d, 0.12 * rho);
      const exag = dd > d;
      const half = Math.max(dd / 2, 0.25 * rho);
      g.plot.setView({ xmin: -half * 1.35, xmax: half * 1.35, ymin: -rho * 1.12, ymax: rho * 0.22 });
      const A = [-dd / 2, 0], Bp = [dd / 2, 0], E = [0, -rho];
      g.segment(E[0], E[1], A[0], A[1], { color: '--collector-a', width: 1.2, dash: [5, 4] });
      g.segment(E[0], E[1], Bp[0], Bp[1], { color: '--collector-b', width: 1.2, dash: [5, 4] });
      g.segment(A[0], A[1], Bp[0], Bp[1], { color: '--plot-text', width: 1 });
      const al = 0.16 * rho;
      const dir = geom === 'trail' ? [1, 0] : [0, 1];
      g.arrow(A[0], A[1], A[0] + dir[0] * al, A[1] + dir[1] * al, { color: '--collector-a', width: 2 });
      g.arrow(Bp[0], Bp[1], Bp[0] + dir[0] * al, Bp[1] + dir[1] * al, { color: '--collector-b', width: 2 });
      g.marker(A[0], A[1], 'triangle', 7, { color: '--collector-a' });
      g.marker(Bp[0], Bp[1], 'triangle', 7, { color: '--collector-b' });
      g.marker(E[0], E[1], 'diamond', 7, { color: '--emitter' });
      g.text(A[0], A[1], 'A', { dx: -10, dy: -12, align: 'right', weight: 650 });
      g.text(Bp[0], Bp[1], 'B', { dx: 10, dy: -12, weight: 650 });
      g.text(E[0], E[1], 'E', { dx: 12, weight: 650 });
      g.text(0, 0, `d = ${fmtDist(d)}${exag ? ' (drawn exaggerated)' : ''}`, { dy: -14, align: 'center', size: 12 });
      g.text(0, -rho / 2, `ρ = ${fmtDist(rho)}`, { dx: 8, size: 12 });
      g.segment(0, 0, 0, -rho, { color: '--plot-text', width: 1, dash: [2, 3], alpha: 0.6 });
      g.text(E[0], E[1], `θ = ${fmt((lever.theta * 180) / Math.PI, 3)}°`, { dy: 18, align: 'center', size: 12 });
    };

    // ================================================================ SECTION C
    const S = { n: 3, who: 1, clock: 50e-9, freq: 0.5, all: false, sigmaT: 30e-9, sigmaF: 0.1, f0: 1e9 };
    const hostMapC = el('div'), hostErrC = el('div');
    const nofixC = el('div', 'nofix');
    const nCtlC = segmented({ label: 'Collectors (TDOA + FDOA)', options: [{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }],
      value: S.n, onChange: (v) => { S.n = v; if (S.who >= v) { S.who = 0; whoCtl.value = 0; } updateC(); } });
    const whoCtl = segmented({ label: 'Collector with the error', options: NAMES.map((nm, i) => ({ value: i, label: nm })), value: S.who,
      onChange: (v) => { if (v >= S.n) { whoCtl.value = S.who; return; } S.who = v; updateC(); } });
    const clkCtl = slider({ label: 'Clock offset', min: -200, max: 200, step: 1, value: S.clock * 1e9, unit: 'ns',
      format: (v) => v.toFixed(0), onInput: (v) => { S.clock = v * 1e-9; updateC(); } });
    const frqCtl = slider({ label: 'Frequency-reference offset', min: -5, max: 5, step: 0.01, value: S.freq, unit: 'Hz',
      format: (v) => v.toFixed(2), onInput: (v) => { S.freq = v; updateC(); } });
    const allCtl = toggle({ label: 'Apply to all collectors', value: S.all, onChange: (v) => { S.all = v; updateC(); },
      hint: 'The same offsets at every collector at once.' });
    const sTCtl = slider({ label: 'Per-collector $\\sigma_T$', min: 1e-9, max: 1e-6, log: true, value: S.sigmaT, format: (v) => fmtSI(v, 's'),
      onInput: (v) => { S.sigmaT = v; updateC(); } });
    const sFCtl = slider({ label: 'Per-collector $\\sigma_F$', min: 1e-3, max: 10, log: true, value: S.sigmaF, format: (v) => fmtSI(v, 'Hz'),
      onInput: (v) => { S.sigmaF = v; updateC(); } });
    const f0CCtl = slider({ label: 'Carrier $f_0$', min: 1e8, max: 3e10, log: true, value: S.f0, format: (v) => fmtSI(v, 'Hz'),
      onInput: (v) => { S.f0 = v; updateC(); } });
    const roC = readout([
      { key: 'fix', label: 'Exact solve: shift', hint: 'planar.simulate (zero noise, biases only) then planar.locate' },
      { key: 'fixDir', label: ' direction' },
      { key: 'pred', label: 'First order $K\\,\\delta\\mathbf z$' },
      { key: 'gap', label: 'Gap exact ↔ linear' },
      { key: 'ell', label: 'Random 95 % semi-axes' },
      { key: 'sig', label: 'Bias in sigmas', hint: 'Mahalanobis distance sqrt(b^T P^-1 b); the 95 % ellipse is at 2.448' },
    ]);
    const tableC = dataTable({
      caption: 'Fix displacement per unit error at each collector (first order, $K\\,\\delta\\mathbf z$)',
      columns: [
        { key: 'who', label: 'Error at' },
        { key: 'ns', label: 'per 1 ns clock', align: 'right' },
        { key: 'nsDir', label: 'toward', align: 'center' },
        { key: 'hz', label: 'per 1 Hz frequency', align: 'right' },
        { key: 'hzDir', label: 'toward', align: 'center' },
      ],
      rows: [],
    });

    root.append(section('Step 3: one collector is off', String.raw`
      <p>Now put the error where it physically lives: in one collector's clock or in its frequency reference (the
      oscillator it measures frequency against). Pick a
      collector and inject a clock offset (every time it stamps is late by that much) and a frequency-reference
      offset (every frequency it measures is high by that much). Such an error is a <strong>bias</strong>: unlike
      noise it is the same every time, so averaging does not remove it. The figure solves for the emitter from the
      corrupted measurements, with no random noise at all, and compares the result with the first-order
      prediction $K\,\delta\mathbf z$. Here $\delta\mathbf z$ is the change the offsets cause in the list of
      measurements $\mathbf z$, and $K=(H^{\mathsf T}R^{-1}H)^{-1}H^{\mathsf T}R^{-1}$ is the
      <strong>estimator gain</strong>: the matrix that converts a small measurement error into the position error
      it causes ($H$ is the Jacobian and $R$ the measurement covariance, both from the last lesson). The
      random-error ellipse (from the per-collector noise $\sigma_T$, $\sigma_F$) is drawn for scale.</p>`,
    figure({
      plot: el('div', 'twin',
        el('div', null, el('div', 'plot-title', 'Geometry (km)'), hostMapC),
        el('div', null, el('div', 'plot-title', 'Shift of the fix from the truth (m)'), hostErrC)),
      controls: [
        controlGroup('Result', [roC]),
        controlGroup('Inject an error', [nCtlC, whoCtl, clkCtl, frqCtl, allCtl]),
        controlGroup('Random noise (for the ellipse and the weights)', [sTCtl, sFCtl, f0CCtl], { collapsible: true, collapsed: true }),
      ],
      caption: String.raw`Right: the true emitter at the centre, the exact biased fix (cross, solid arrow), the first-order
      prediction (ring, dashed arrow), and the 95 % random-error ellipse. Double-click a slider's value to reset it.
      Measurements: all TDOAs and FDOAs against reference A.`,
    }),
    tableC,
    ));

    const mapC = new Plot2D(hostMapC, { height: 380, equalAspect: true, view: { xmin: -80, xmax: 90, ymin: -80, ymax: 110 },
      xLabel: 'East (km)', yLabel: 'North (km)', ariaLabel: 'Collectors, velocities and emitter for the bias explorer.' });
    const errC = new Plot2D(hostErrC, { height: 380, equalAspect: true, pan: false, zoom: false,
      view: { xmin: -300, xmax: 300, ymin: -300, ymax: 300 }, xLabel: 'East (m)', yLabel: 'North (m)',
      ariaLabel: 'Biased fix, first-order prediction and random-error ellipse around the true emitter.' });
    plots.push(mapC, errC);
    errC.el.append(nofixC);
    const colsC = X.LAYOUT.map((Lc, i) => mapC.addHandle({ x: Lc.x, y: Lc.y, color: COLL_VARS[i], label: NAMES[i], shape: 'triangle',
      onDrag: () => updateC() }));
    const velC = colsC.map((h, i) => mapC.addVectorHandle({ base: h, vx: X.LAYOUT[i].vx, vy: X.LAYOUT[i].vy, scale: 0.1,
      color: COLL_VARS[i], onDrag: () => updateC(), constrain: clampSpeed }));
    const emC = mapC.addHandle({ x: 30, y: 80, color: '--emitter', label: 'E', shape: 'diamond', onDrag: () => updateC() });

    let resC = null, precC = null, spanC = 300;
    const collectorsC = () => X.toCollectors(colsC.slice(0, S.n).map((h, i) => ({ x: h.x, y: h.y, vx: velC[i].vx, vy: velC[i].vy })));

    function updateC() {
      colsC.forEach((h, i) => { h.visible = i < S.n; velC[i].visible = i < S.n; });
      const cs = collectorsC(), e = [emC.x * KM, emC.y * KM];
      const meas = planar.measurementList(S.n);
      const noise = { sigmaT: S.sigmaT, sigmaF: S.sigmaF };
      const on = (i) => S.all || i === S.who;
      const clockBias = cs.map((_, i) => (on(i) ? S.clock : 0));
      const freqBias = cs.map((_, i) => (on(i) ? S.freq : 0));
      precC = planar.precision(meas, cs, e, S.f0, noise);
      resC = precC ? X.biasSolve({ meas, collectors: cs, e, f0: S.f0, noise, clockBias, freqBias }) : null;
      if (!precC) {
        nofixC.innerHTML = '<strong>No fix possible in this geometry.</strong>The TDOA and FDOA curves through E are parallel here, so neither the fix nor its shift is defined. Move something.';
        nofixC.classList.add('show');
      } else nofixC.classList.remove('show');
      // readouts
      if (resC && resC.pred) {
        const pm = Math.hypot(...resC.pred);
        const fm = resC.fix ? Math.hypot(...resC.fix) : NaN;
        const gap = resC.fix ? Math.hypot(resC.fix[0] - resC.pred[0], resC.fix[1] - resC.pred[1]) : NaN;
        const Pi = X.inv2(precC.P);
        const b = resC.fix || resC.pred;
        const sig = Pi ? Math.sqrt(b[0] * (Pi[0][0] * b[0] + Pi[0][1] * b[1]) + b[1] * (Pi[1][0] * b[0] + Pi[1][1] * b[1])) : NaN;
        const zero = pm < 1e-9 && (!resC.fix || fm < 1e-6);
        roC.set({
          fix: resC.fix ? fmtDist(fm) : 'did not converge',
          fixDir: resC.fix && fm > 1e-6 ? `${X.compass(resC.fix)} (${X.bearingDeg(resC.fix).toFixed(0)}°)` : '—',
          pred: fmtDist(pm),
          gap: zero ? '0' : resC.fix ? `${fmtDist(gap)} (${fmt((100 * gap) / Math.max(pm, 1e-12), 2)} %)` : '—',
          ell: `${fmtDist(precC.ellipse.semiMajor)} × ${fmtDist(precC.ellipse.semiMinor)}`,
          sig: zero ? '0' : `${fmt(sig, 3)} → ${sig > X.CHI95 ? 'outside' : 'inside'}`,
        });
        const sens = X.perCollectorSensitivity(meas, cs, resC.K);
        const rows = sens.map((s, i) => ({
          who: NAMES[i] + (i === 0 ? ' (reference)' : ''),
          ns: fmtDist(Math.hypot(...s.clock)), nsDir: X.compass(s.clock),
          hz: fmtDist(Math.hypot(...s.freq)), hzDir: X.compass(s.freq),
          highlight: !S.all && i === S.who,
        }));
        const sum = (k) => sens.reduce((a, s) => [a[0] + s[k][0], a[1] + s[k][1]], [0, 0]);
        const sc = sum('clock'), sf = sum('freq');
        // Common offsets cancel exactly; anything below a nanometre here is floating-point residue.
        const zeroed = (v) => fmtDist(Math.hypot(...v) < 1e-9 ? 0 : Math.hypot(...v));
        rows.push({ who: 'All collectors together', ns: zeroed(sc), nsDir: '—', hz: zeroed(sf), hzDir: '—',
          highlight: S.all, className: 'total' });
        tableC.setRows(rows);
        const need = Math.max(precC.ellipse.semiMajor, resC.fix ? fm : 0, pm) * 1.35 + 1e-6;
        if (need > spanC || need < spanC * 0.4) { spanC = need * 1.1; errC.setView({ xmin: -spanC, xmax: spanC, ymin: -spanC, ymax: spanC }); }
      } else {
        roC.set({ fix: '—', fixDir: '—', pred: '—', gap: '—', ell: '—', sig: '—' });
        tableC.setRows([]);
      }
      mapC.requestRedraw();
      errC.requestRedraw();
    }

    mapC.onDraw = (g) => {
      for (let i = 0; i < S.n; i++) {
        const on = S.all || i === S.who;
        g.segment(emC.x, emC.y, colsC[i].x, colsC[i].y, { color: COLL_VARS[i], width: on ? 1.6 : 1, dash: [4, 4], alpha: on ? 0.9 : 0.45 });
        if (on) g.circle(colsC[i].x, colsC[i].y, 15, { color: '--critical', width: 2, dash: [3, 3] });
      }
      g.legend([{ label: 'Collector(s) with the error', color: '--critical', width: 2, dash: [3, 3] }], { position: 'bottom-left' });
    };
    mapC.onHover = (x, y) => `x ${x.toFixed(1)} km   y ${y.toFixed(1)} km`;
    errC.onDraw = (g) => {
      if (!precC) return;
      const el95 = precC.ellipse;
      g.ellipse(0, 0, el95.semiMajor, el95.semiMinor, el95.angle, { color: '--estimate', width: 1.6, fill: '--estimate', fillAlpha: 0.06 });
      g.marker(0, 0, 'diamond', 6, { color: '--emitter' });
      const items = [{ label: '95 % random-error ellipse', color: '--estimate', width: 1.6 }];
      if (resC && resC.pred) {
        const p = resC.pred;
        if (Math.hypot(...p) > 0) {
          g.arrow(0, 0, p[0], p[1], { color: '--series-4', width: 2, dash: [6, 4] });
          g.circle(p[0], p[1], 7, { color: '--series-4', width: 2 });
        }
        items.push({ label: 'First order Kδz', color: '--series-4', width: 2, dash: [6, 4] });
        if (resC.fix) {
          const f = resC.fix;
          if (Math.hypot(...f) > 0) g.arrow(0, 0, f[0], f[1], { color: '--estimate', width: 2.2 });
          g.marker(f[0], f[1], 'cross', 6, { color: '--estimate', width: 2.5 });
          items.push({ label: 'Exact biased fix', color: '--estimate', marker: 'cross', line: true, width: 2.2 });
        }
      }
      g.legend(items, { position: 'top-left' });
    };
    errC.onHover = (x, y) => `ΔE ${fmtDist(x)}   ΔN ${fmtDist(y)}`;

    root.append(section(null, String.raw`
      <p><strong>Exact versus first order.</strong> For the default offsets the cross sits inside the ring: the gap
      readout is a fraction of a percent of the shift. The linear prediction is the tangent-plane approximation of
      the curved measurement surfaces, so the gap grows faster than the shift: push both offsets to their extremes,
      or drag E far away (where the shift becomes kilometres while the curves bend on a scale of the range), and
      the gap grows to several percent, and more for a two-collector fix. Below that, $K\,\delta\mathbf z$ is the
      whole story and the table is exact enough to budget with.</p>
      <p><strong>Why the reference collector is special.</strong> The measurements are $\tau_{iA}=t_i-t_A$ and
      $\nu_{iA}=f_i-f_A$. A clock error at B shifts only $\tau_{BA}$; a clock error $\delta t_A$ at A shifts <em>every</em>
      $\tau_{iA}$ at once, all by $-\delta t_A$. Its table row is therefore not just "another collector": it is
      the combined effect of moving all the curves together. (Nothing physical singles out A, of course: had we
      used differences against B, B's row would play that role and every displacement would be the same, as the
      previous lesson showed for the covariance.)</p>
      <p><strong>Common offsets cancel.</strong> Switch on <em>Apply to all collectors</em>. Whatever offsets you
      set, the fix does not move, and the last table row reads zero: a clock offset common to all collectors
      cancels in every time difference, and a frequency offset common to all collectors cancels in every frequency
      difference. That is the whole point of differencing. (In this model the cancellation is exact. In hardware a
      shared fractional frequency error $y$ (an oscillator's frequency error divided by its frequency) shifts each
      received frequency by $y f_i$, so a residual $y\,\nu_{ij}$
      survives: $10^{-8}$ of a 10 kHz FDOA is 0.1 mHz.) What hurts is the <em>difference</em> between collectors'
      clocks and oscillators.</p>`,
    callout('try', 'Bias or noise?', String.raw`
      <ul>
        <li>With the defaults, read "Bias in sigmas": a value above 2.448 means the bias pushes the fix outside the
        95 % ellipse. Reduce the clock offset until it falls inside: below that level the bias hides in the noise.</li>
        <li>Set the clock offset to zero and sweep the frequency offset: the shift is exactly proportional to the
        offset (the cross rides on the ring). Then select collector A instead of B and compare directions.</li>
        <li>Raise the carrier in the noise group. A fixed number of hertz now costs fewer metres, because FDOA
        gradients scale with $f_0$ while the hertz stay hertz. With 2 collectors (one TDOA and one FDOA, exactly
        enough for a fix) the clock-offset shift does not change at all. With 3 or 4 there are more measurements
        than unknowns, the solver leans harder on the FDOAs as they become more informative, and the clock-offset
        shift changes a little as well.</li>
        <li>Drag E inside the triangle: every number in the table drops, because the geometry multiplier does.</li>
      </ul>`),
    ));

    // ================================================================ SECTION D
    const budget = [
      { key: 'y', label: 'Frequency reference, fractional error $y$', value: 1e-9, unit: '', kind: 'F',
        conv: (y) => y * L.f0, note: 'TCXO ~10⁻⁶, OCXO 10⁻⁸–10⁻⁹, chip-scale atomic ~10⁻¹⁰, GPS-disciplined 10⁻¹¹–10⁻¹² (typical orders; check real hardware)' },
      { key: 'dv', label: 'Collector velocity knowledge, along the line of sight', value: 1, unit: 'cm/s', kind: 'F',
        conv: (v) => (v / 100) / lam(L.f0), note: '$\\delta\\nu=\\delta v/\\lambda$' },
      { key: 'dr', label: 'Collector position knowledge, along the line of sight', value: 1, unit: 'm', kind: 'T',
        conv: (r) => r / C, note: '$\\delta\\tau=\\delta r/c$' },
      { key: 'sync', label: 'Clock synchronisation between collectors', value: 10, unit: 'ns', kind: 'T',
        conv: (t) => t * 1e-9, note: 'Tens of ns uncalibrated, a few ns with care (typical)' },
      { key: 'u', label: 'Emitter motion (worst direction), speed $u$', value: 1, unit: 'm/s', kind: 'F',
        conv: (u) => u * Math.abs(lever.dNuPerMps), note: 'Adds $\\frac1\\lambda\\,\\mathbf u\\cdot(\\hat{\\mathbf l}_B-\\hat{\\mathbf l}_A)$ to $\\nu_{BA}$' },
      { key: 'nT', label: 'Measurement noise, TDOA', value: 1, unit: 'ns', kind: 'T',
        conv: (t) => t * 1e-9, note: 'Achievable with enough bandwidth, integration time and signal-to-noise ratio (next lesson)' },
      { key: 'nF', label: 'Measurement noise, FDOA', value: 1, unit: 'mHz', kind: 'F',
        conv: (f) => f * 1e-3, note: 'Likewise (next lesson)' },
    ];
    const geomLine = el('p', 'geom-line');
    const tbody = el('tbody');
    for (const r of budget) {
      const input = el('input', { type: 'number', class: 'ctrl-number', value: String(r.value), min: '0', step: 'any',
        'aria-label': r.label.replace(/\$[^$]*\$/g, '').trim() });
      input.addEventListener('input', () => { const v = Number(input.value); if (isFinite(v) && v >= 0) { r.value = v; updateD(); } });
      r.meas = el('td', 'num'); r.out = el('td', 'num');
      const labelCell = el('td'); labelCell.append(section(null, r.label).querySelector('.prose') || r.label);
      const noteCell = el('td', 'note'); noteCell.append(section(null, r.note).querySelector('.prose') || r.note);
      r.tr = el('tr', null, labelCell, el('td', 'mag', input, r.unit ? el('span', 'unit', r.unit) : null), r.meas, r.out, noteCell);
      tbody.append(r.tr);
    }
    const budgetTable = el('div', 'data-table-wrap budget',
      el('table', 'data-table',
        el('thead', null, el('tr', null, el('th', null, 'Error source'), el('th', null, 'Magnitude'),
          el('th', 'num', 'As a measurement error'), el('th', 'num', 'Curve displacement'), el('th', null, 'Notes'))),
        tbody));
    const oscTable = dataTable({
      caption: 'Oscillator classes at the current carrier and geometry (one collector off by $y$; typical orders of magnitude)',
      columns: [{ key: 'cls', label: 'Reference' }, { key: 'y', label: '$y$', align: 'right' }, { key: 'dnu', label: '$\\delta\\nu = y f_0$', align: 'right' },
        { key: 'm', label: 'Curve displacement', align: 'right' }],
      rows: [],
    });
    const OSC = [['TCXO', 1e-6], ['OCXO', 1e-8], ['OCXO (good)', 1e-9], ['Chip-scale atomic clock', 1e-10], ['GPS-disciplined', 1e-11], ['GPS-disciplined (good)', 1e-12]];
    const motionBox = el('div');

    function updateD() {
      if (!lever) return;
      geomLine.innerHTML = `Using the Step 2 geometry: <strong>${L.preset === 'custom' ? 'custom' : X.PRESETS[L.preset].label}</strong>,
        ${L.geom === 'trail' ? 'pair in trail' : 'pair abreast'}, ρ = <strong>${fmtDist(L.rho)}</strong>,
        d = <strong>${fmtDist(L.d)}</strong>, v = <strong>${fmt(L.v, 3)} m/s</strong>, f₀ = <strong>${fmtSI(L.f0, 'Hz')}</strong>:
        <strong>${fmt(lever.mPerNs, 3)} m per ns</strong> and <strong>${fmt(lever.mPerHz, 3)} m per Hz</strong>.`;
      for (const r of budget) {
        const q = r.conv(r.value);
        if (r.kind === 'F') { r.meas.textContent = fmtSI(q, 'Hz'); r.out.textContent = fmtDist(q * lever.mPerHz); }
        else { r.meas.textContent = fmtSI(q, 's'); r.out.textContent = fmtDist((q / 1e-9) * lever.mPerNs); }
        r.tr.classList.toggle('hl', r.key === 'u');
      }
      oscTable.setRows(OSC.map(([cls, y]) => ({ cls, y: fmt(y, 1), dnu: fmtSI(y * L.f0, 'Hz'), m: fmtDist(y * L.f0 * lever.mPerHz) })));
      motionBox.replaceChildren(callout('idea', 'A moving emitter costs about $u\\,\\rho/v$, whatever the carrier and baseline', String.raw`
        <p>The solver assumes the emitter is stationary. If it moves at $\mathbf u$, every Doppler shift changes and
        $\nu_{ij}$ picks up $\frac1\lambda\,\mathbf u\cdot(\hat{\mathbf l}_i-\hat{\mathbf l}_j)$ (sign checked against
        <code>planar.fdoa</code> with an emitter velocity). Since $\lVert\hat{\mathbf l}_i-\hat{\mathbf l}_j\rVert = 2\sin(\theta/2)
        \approx d_\perp/\rho$, that is at most about $(u/\lambda)(d_\perp/\rho)$, where $u$ is the emitter's speed.
        Multiply by the FDOA lever arm
        $\lambda\rho^2/(v\,d)$ and both $\lambda$ and $d$ cancel, leaving a position error $\delta x$ of</p>
        $$\delta x \approx u\,\frac{\rho}{v}.$$
        <p class="big">For the current geometry: <strong>${fmt(lever.mPerMpsEmitter, 3)} m per m/s</strong> of emitter
        speed (exact, worst direction), against $\rho/v$ = ${fmt(lever.ruleU, 3)} s. For the LEO-cluster preset,
        ${fmt(presetNow.mPerMpsEmitter, 3)} m per m/s ($\rho/v$ = ${fmt(presetNow.ruleU, 3)} s). A ship at 5 m/s
        would be misplaced by ${fmtDist(5 * presetNow.mPerMpsEmitter)} in that geometry: the dominant term in many
        budgets, and one that no better oscillator removes. Change the carrier or the baseline in Step 2 and watch
        this number stay put; change the range or the speed and it moves.</p>`));
    }

    // "Is 1 Hz a lot?" table: presets x carriers
    const BANDS = [1.5e8, 1e9, 1e10];
    const hzRows = Object.entries(X.PRESETS).map(([k, p]) => {
      const row = { name: p.label };
      BANDS.forEach((f, j) => { row['f' + j] = X.leverArm({ f0: f, ...p, geom: 'trail' }).mPerHz; });
      return row;
    });
    const allHz = hzRows.flatMap((r) => BANDS.map((_, j) => r['f' + j]));
    const hzMin = Math.min(...allHz), hzMax = Math.max(...allHz);
    const minRow = hzRows.find((r) => BANDS.some((_, j) => r['f' + j] === hzMin));
    const maxRow = hzRows.find((r) => BANDS.some((_, j) => r['f' + j] === hzMax));
    const hzTable = dataTable({
      caption: 'Curve displacement for 1 Hz of FDOA error (trail geometry, exact, from the calculator)',
      columns: [{ key: 'name', label: 'Preset' }, ...BANDS.map((f, j) => ({ key: 'f' + j, label: fHz(f), align: 'right', format: (v) => fmtDist(v) }))],
      rows: hzRows,
    });

    const oneCm = 0.01 / lam(1e9), oneM = 1 / C;
    root.append(
      section('Step 4: where a hertz or a nanosecond comes from', String.raw`
        <p>Real errors start as hardware or knowledge errors, not as hertz and nanoseconds. Each row below converts one
        source into a measurement error and then, through the lever arms of the geometry selected in Step 2, into
        metres. Edit any magnitude. Two conversions worth memorising: collector velocity known to 1 cm/s along the
        line of sight is $\delta\nu = \delta v/\lambda$ = ${fmt(oneCm, 3)} Hz at 1 GHz; collector position known to
        1 m along the line of sight is $\delta\tau=\delta r/c$ = ${fmt(oneM * 1e9, 3)} ns ($\delta v$ and $\delta r$
        are the errors in what the collector believes its own velocity and position to be). A fractional
        frequency error $y$ of the reference is $\delta\nu = y\,f_0$: $10^{-6}$ is 1 kHz at 1 GHz,
        $10^{-9}$ is 1 Hz. In the tables, TCXO and OCXO are temperature-compensated and oven-controlled crystal
        oscillators, and "GPS-disciplined" means an oscillator continuously steered to GPS time.</p>`,
      geomLine, budgetTable, oscTable, motionBox,
      String.raw`
        <h3>So, is 1 Hz a lot?</h3>
        <p>Against what the measurement itself can resolve, enormously so. With enough bandwidth, integration time and
        signal-to-noise ratio an FDOA can be measured to milli-hertz (the next lesson shows how), so a 1 Hz FDOA error
        is almost never noise: it is an oscillator, a velocity error or a moving emitter. In metres, the table below
        (exact values from the Step 2 calculator) runs from ${fmtDist(hzMin)} (${minRow.name}, 10 GHz) to
        ${fmtDist(hzMax)} (${maxRow.name}, 150 MHz): a factor of ${fmt(hzMax / hzMin, 2)} between the kindest and the
        harshest of these cases.</p>`,
      hzTable,
      callout('caution', 'Calibration removes offsets, not drift', String.raw`<p>A static per-collector clock or
        frequency offset can be measured and removed by observing emitters at known locations (reference emitters):
        solve for the offsets instead of the position. What calibration cannot remove is the part that changes
        between the calibration and the measurement: oscillator drift, temperature effects, ephemeris errors
        (errors in the collectors' own positions and velocities) that
        evolve along the orbit. Budget for the drift over that interval, not for the raw offset.</p>`),
      questionSet(QUESTIONS['error-budget']),
      takeaways([
        'Unit conversion: 1 ns of TDOA is 0.2998 m of range difference; 1 Hz of FDOA is $\\lambda$ metres per second of range-rate difference, so the same hertz costs 30 times more at 100 MHz than at 3 GHz.',
        'Geometry: a TDOA curve moves about $c\\,\\delta\\tau\\,\\rho/d_\\perp$; an FDOA curve moves about $\\lambda\\,\\delta\\nu\\,\\rho^2/(v\\,d)$. Range hurts TDOA linearly and FDOA quadratically.',
        'One collector\'s clock or oscillator error moves the fix by $K\\,\\delta\\mathbf z$; offsets common to all collectors cancel exactly in the differences.',
        'A moving emitter at speed $u$ biases an FDOA fix by about $u\\,\\rho/v$, independent of carrier and baseline: about 100 m per m/s for a LEO collector 800 km away.',
        'A 1 Hz FDOA error is far above measurement noise; it comes from oscillators, velocity knowledge or emitter motion, and static parts of it can be calibrated out.',
      ]),
      nextLesson(ctx, 'caf'),
      ),
    );

    updateB();
    updateC();

    return () => {
      for (const p of plots) p.destroy();
      removeStyle();
      root.classList.remove('l-eb');
    };
  },
};

function clampSpeed(vx, vy) {
  const s = Math.hypot(vx, vy);
  if (s > 600) return [(vx * 600) / s, (vy * 600) / s];
  if (s < 5) return s > 0 ? [(vx * 5) / s, (vy * 5) / s] : [5, 0];
  return [vx, vy];
}
