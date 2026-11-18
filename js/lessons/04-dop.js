/**
 * 04-dop.js - "Error ellipses and dilution of precision" (Part II, lesson 4).
 *
 * Section A: measurement noise -> CRLB error ellipse, checked against a Monte-Carlo cloud of real fixes.
 * Section B: dilution of precision maps (TDOA DOP, FDOA-only sensitivity, combined DRMS).
 *
 * All physics comes from the core: planar.precision / monteCarlo / tdoaDop / crlb / jacobian / noiseCov,
 * estimate.crlb / gain. Glue lives in ./_errors.js.
 */
import { Plot2D } from '../ui/plot2d.js';
import { slider, toggle, segmented, button, readout, controlGroup, fmt, fmtSI, fmtDist } from '../ui/controls.js';
import { el, lessonHeader, section, figure, callout, takeaways, nextLesson } from '../ui/layout.js';
import { questionSet } from '../ui/quiz.js';
import { diagram } from '../ui/diagrams.js';
import QUESTIONS from './questions.js';
import { planar } from '../core/index.js';
import * as X from './_errors.js';

const { KM, C, NAMES, COLL_VARS } = X;

const CSS = `
.l-dop .twin { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 14px; }
@media (max-width: 760px) { .l-dop .twin { grid-template-columns: minmax(0, 1fr); } }
.l-dop .plot-title { font-size: 12.5px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); margin: 0 0 6px 2px; }
.l-dop .nofix { position: absolute; inset: 10px 14px 40px 50px; display: none; align-items: center; justify-content: center;
  text-align: center; padding: 18px; font-size: 14px; line-height: 1.55; color: var(--text-2); background: var(--surface);
  border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); pointer-events: none; }
.l-dop .nofix.show { display: flex; }
.l-dop .nofix strong { color: var(--text); display: block; margin-bottom: 4px; }
.l-dop .btn-row { display: flex; flex-wrap: wrap; gap: 6px; }
.l-dop .btn-row .btn { flex: 1 1 auto; padding: 6px 8px; font-size: 13px; }
.l-dop .ro-note { font-size: 12.5px; color: var(--muted); line-height: 1.45; margin-top: 6px; }
`;

/** Slider factories shared by both figures (kept in sync). */
const SIG_T = { min: 1e-9, max: 1e-6, log: true, format: (v) => fmtSI(v, 's') };
const SIG_F = { min: 1e-3, max: 10, log: true, format: (v) => fmtSI(v, 'Hz') };
const CARRIER = { min: 1e8, max: 3e10, log: true, format: (v) => fmtSI(v, 'Hz') };

export default {
  id: 'dop',
  title: 'Error ellipses and dilution of precision',

  mount(root, ctx) {
    root.classList.add('l-dop');
    const removeStyle = X.injectStyle(CSS);
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    const cancel = (t) => { if (t) { clearTimeout(t); timers.delete(t); } };

    // ------------------------------------------------------------ shared noise state
    const noise = { sigmaT: 30e-9, sigmaF: 0.1, f0: 1e9 };
    const synced = { sigmaT: [], sigmaF: [], f0: [] };
    function setNoise(key, v, from) {
      noise[key] = v;
      for (const s of synced[key]) if (s !== from) s.value = v;
      updateA(true);
      updateB();
    }
    function noiseSliders() {
      const t = slider({ label: 'Per-collector timing error $\\sigma_T$', value: noise.sigmaT, ...SIG_T,
        hint: 'Standard deviation of the error in each collector\'s arrival time.',
        onInput: (v) => setNoise('sigmaT', v, t) });
      const f = slider({ label: 'Per-collector frequency error $\\sigma_F$', value: noise.sigmaF, ...SIG_F,
        hint: 'Standard deviation of the error in each collector\'s received frequency.',
        onInput: (v) => setNoise('sigmaF', v, f) });
      const c = slider({ label: 'Carrier $f_0$', value: noise.f0, ...CARRIER,
        onInput: (v) => setNoise('f0', v, c) });
      synced.sigmaT.push(t); synced.sigmaF.push(f); synced.f0.push(c);
      return [t, f, c];
    }
    const noiseObj = () => ({ sigmaT: noise.sigmaT, sigmaF: noise.sigmaF });

    // ------------------------------------------------------------ header
    root.append(
      lessonHeader({
        kicker: 'Part II · Lesson 4',
        title: 'Error ellipses and dilution of precision',
        lede: 'Measurement errors are set by the electronics; position errors are measurement errors multiplied by geometry. This lesson separates the two, so that you can read an error ellipse and say how much of it is the receiver and how much is where the collectors happen to be.',
      }),
    );

    // ================================================================ SECTION A
    const A = { n: 3, useT: true, useF: true };
    const hostMapA = el('div'), hostErrA = el('div');
    const nofixA = el('div', 'nofix');

    const nCtlA = segmented({ label: 'Collectors', options: [{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }],
      value: A.n, onChange: (v) => { A.n = v; updateA(true); } });
    const tCtlA = toggle({ label: 'Use TDOA', value: A.useT, onChange: (v) => { A.useT = v; updateA(true); } });
    const fCtlA = toggle({ label: 'Use FDOA', value: A.useF, onChange: (v) => { A.useF = v; updateA(true); } });
    const roA = readout([
      { key: 'smaj', label: '$\\sigma_{major}$', hint: 'One-sigma error along the long axis of the ellipse (square root of the larger eigenvalue of P)' },
      { key: 'smin', label: '$\\sigma_{minor}$', hint: 'One-sigma error along the short axis' },
      { key: 'orient', label: 'Major axis bearing', hint: 'Compass bearing of the long axis (0 = north, clockwise; the axis has two ends, so 0-180)' },
      { key: 'drms', label: 'DRMS', hint: 'Root-mean-square miss distance: sqrt(sigma_x^2 + sigma_y^2) = sqrt(trace P)' },
      { key: 'cep', label: 'CEP (50 %)', hint: 'Radius of the circle, centred on the truth, that contains half the fixes' },
      { key: 'cepr', label: 'CEP / $\\sigma_{major}$', hint: '1.18 for a round ellipse, falling to 0.67 for a very long thin one' },
      { key: 'a95', label: '95 % semi-axes', hint: 'Half-length and half-width of the 95 % ellipse: 2.448 times the one-sigma values' },
      { key: 'inside', label: 'MC fixes inside 95 %', hint: 'Fraction of the 400 Monte-Carlo fixes inside the CRLB 95 % ellipse' },
    ]);

    root.append(
      section('From measurement noise to an error ellipse', String.raw`
        <p>Each collector timestamps the signal with a random error of standard deviation $\sigma_T$ and measures
        its frequency with a random error of standard deviation $\sigma_F$. Those are properties of the receivers:
        bandwidth, integration time, signal-to-noise ratio, oscillators (lesson 6 says where they come from).
        Differencing turns them into TDOA and FDOA
        errors, and the solver turns those into a position error. The figure does that last step two ways at
        once. Analytically: the <strong>95 % error ellipse</strong>, the region around the truth that should contain
        95 % of the fixes, computed from the Cramér–Rao bound (the best any estimator can do; more below). And by
        brute force, a <strong>Monte-Carlo</strong> simulation: a cloud of 400 fixes, each solved by least squares
        from its own randomly corrupted measurements.</p>`,
        figure({
          plot: el('div', 'twin',
            el('div', null, el('div', 'plot-title', 'Geometry (km)'), hostMapA),
            el('div', null, el('div', 'plot-title', 'Fix errors around the true emitter (m)'), hostErrA)),
          controls: [
            controlGroup('Precision', [roA]),
            controlGroup('Measurements', [nCtlA, tCtlA, fCtlA]),
            controlGroup('Per-collector noise', noiseSliders()),
          ],
          caption: String.raw`Left: drag the collectors (triangles), their velocity arrows and the emitter E. Right: the
          same emitter, magnified, with the true position at the centre. Dots are Monte-Carlo fixes (recomputed when
          you pause); the solid ellipse is the 95 % ellipse from the Cramér–Rao lower bound (CRLB), the dashed
          ellipse is one sigma (it holds 39 % of the fixes) and the dotted circle is the CEP, the circle that holds
          half of them. The right-hand plot rescales itself to fit the ellipse.`,
        }),
      ),
    );

    const mapA = new Plot2D(hostMapA, {
      height: 400, equalAspect: true, view: { xmin: -90, xmax: 130, ymin: -80, ymax: 150 },
      xLabel: 'East (km)', yLabel: 'North (km)',
      ariaLabel: 'Map of collectors, their velocities and the emitter, with the TDOA and FDOA curves through the emitter.',
    });
    const errA = new Plot2D(hostErrA, {
      height: 400, equalAspect: true, pan: false, zoom: false, view: { xmin: -500, xmax: 500, ymin: -500, ymax: 500 },
      xLabel: 'East error (m)', yLabel: 'North error (m)',
      ariaLabel: 'Monte-Carlo fixes and the 95 percent error ellipse around the true emitter position.',
    });
    errA.el.append(nofixA);

    const onGeomA = () => updateA(false);
    const onGeomEndA = () => updateA(true);
    const colsA = X.LAYOUT.map((L, i) => mapA.addHandle({ x: L.x, y: L.y, color: COLL_VARS[i], label: NAMES[i], shape: 'triangle',
      onDrag: onGeomA, onDragEnd: onGeomEndA }));
    const velA = colsA.map((h, i) => mapA.addVectorHandle({ base: h, vx: X.LAYOUT[i].vx, vy: X.LAYOUT[i].vy, scale: 0.1,
      color: COLL_VARS[i], onDrag: onGeomA, onDragEnd: onGeomEndA, constrain: clampSpeed }));
    const emA = mapA.addHandle({ x: 60, y: 110, color: '--emitter', label: 'E', shape: 'diamond', onDrag: onGeomA, onDragEnd: onGeomEndA });

    let precA = null, reasonA = '', mcA = null, mcTimer = 0, mcStale = true, errSpan = 500;

    const collectorsA = () => X.toCollectors(colsA.slice(0, A.n).map((h, i) => ({ x: h.x, y: h.y, vx: velA[i].vx, vy: velA[i].vy })));
    const measA = () => planar.measurementList(A.n, { tdoa: A.useT, fdoa: A.useF });
    const eA = () => [emA.x * KM, emA.y * KM];

    function updateA(heavy) {
      colsA.forEach((h, i) => { h.visible = i < A.n; velA[i].visible = i < A.n && A.useF; });
      const cs = collectorsA(), e = eA();
      precA = null; reasonA = '';
      if (!X.countOk(A.n, A.useT, A.useF)) reasonA = 'count';
      else {
        precA = planar.precision(measA(), cs, e, noise.f0, noiseObj());
        if (!precA) reasonA = 'singular';
      }
      showNofixA();
      mcStale = true;
      cancel(mcTimer);
      if (precA) mcTimer = later(runMC, heavy ? 30 : 160);
      writeReadoutA();
      fitErr();
      mapA.requestRedraw();
      errA.requestRedraw();
    }

    function showNofixA() {
      if (!reasonA) { nofixA.classList.remove('show'); return; }
      const m = (A.useT ? A.n - 1 : 0) + (A.useF ? A.n - 1 : 0);
      let html;
      if (reasonA === 'count') {
        html = m === 0
          ? '<strong>No measurements selected.</strong>Switch on TDOA, FDOA or both.'
          : `<strong>No fix possible with these measurements.</strong>${A.n} collectors give ${m} independent
             measurement${m === 1 ? '' : 's'}: one curve, not a point. A 2-D fix needs two. Add a collector or switch on
             the other measurement type.`;
      } else {
        html = `<strong>No fix possible in this geometry.</strong>The measurement curves through E are parallel here (for example,
          the emitter sits on the extension of a baseline, or two velocity vectors make the FDOA gradients vanish), so the
          information matrix is singular. Move something.`;
      }
      nofixA.innerHTML = html;
      nofixA.classList.add('show');
    }

    function runMC() {
      if (!precA) return;
      const e = eA();
      const res = planar.monteCarlo({ meas: measA(), collectors: collectorsA(), e, f0: noise.f0, noise: noiseObj(), trials: 400, seed: 1 });
      mcA = { points: res.points.map((p) => [p[0] - e[0], p[1] - e[1]]), failures: res.failures,
        inside: X.fractionInside(res.points, e, precA.P) };
      mcStale = false;
      writeReadoutA();
      errA.requestRedraw();
    }

    function writeReadoutA() {
      if (!precA) {
        roA.set({ smaj: '—', smin: '—', orient: '—', drms: '—', cep: '—', cepr: '—', a95: '—', inside: '—' });
        return;
      }
      const el95 = precA.ellipse;
      const bearing = ((90 - (el95.angle * 180) / Math.PI) % 180 + 180) % 180;
      let inside = '…';
      if (!mcStale && mcA) {
        inside = `${(100 * mcA.inside).toFixed(1)} %` + (mcA.failures ? ` (${mcA.failures} failed)` : '');
      }
      roA.set({
        smaj: fmtDist(el95.sigmaMajor), smin: fmtDist(el95.sigmaMinor),
        orient: `${bearing.toFixed(0)}°`,
        drms: fmtDist(precA.drms), cep: fmtDist(precA.cep50),
        cepr: fmt(precA.cep50 / el95.sigmaMajor, 3),
        a95: `${fmtDist(el95.semiMajor)} × ${fmtDist(el95.semiMinor)}`,
        inside,
      });
    }

    function fitErr() {
      if (!precA) return;
      const need = Math.max(precA.ellipse.semiMajor * 1.45, 1e-3);
      if (need > errSpan || need < errSpan * 0.45) {
        errSpan = need * 1.15;
        errA.setView({ xmin: -errSpan, xmax: errSpan, ymin: -errSpan, ymax: errSpan });
      }
    }

    mapA.onDraw = (g) => {
      const cs = collectorsA(), e = eA(), n = A.n;
      const ref = cs[0];
      for (let i = 0; i < n; i++) g.segment(emA.x, emA.y, colsA[i].x, colsA[i].y, { color: COLL_VARS[i], width: 1, dash: [4, 4], alpha: 0.55 });
      const items = [];
      if (A.useT) {
        for (let i = 1; i < n; i++) {
          const ci = cs[i];
          const v0 = planar.tdoa(ci, ref, e);
          const f = g.sampleField((x, y) => planar.tdoa(ci, ref, [x * KM, y * KM]), { nx: 120, ny: 100 });
          g.contour(f, [v0], { color: '--tdoa', width: 2 });
        }
        items.push({ label: 'TDOA curves through E', color: '--tdoa', width: 2 });
      }
      if (A.useF) {
        for (let i = 1; i < n; i++) {
          const ci = cs[i];
          const v0 = planar.fdoa(ci, ref, e, noise.f0);
          const f = g.sampleField((x, y) => planar.fdoa(ci, ref, [x * KM, y * KM], noise.f0), { nx: 120, ny: 100 });
          g.contour(f, [v0], { color: '--fdoa', width: 2, dash: [7, 4] });
        }
        items.push({ label: 'FDOA curves through E', color: '--fdoa', width: 2, dash: [7, 4] });
      }
      if (items.length) g.legend(items, { position: 'bottom-left' });
    };
    mapA.onHover = (x, y) => `x ${x.toFixed(1)} km   y ${y.toFixed(1)} km`;

    errA.onDraw = (g) => {
      if (!precA) return;
      const el95 = precA.ellipse;
      if (mcA && !mcStale) g.points(mcA.points, { color: '--series-1', size: 1.6, alpha: 0.55 });
      const ca = Math.cos(el95.angle), sa = Math.sin(el95.angle);
      g.segment(-el95.semiMajor * ca, -el95.semiMajor * sa, el95.semiMajor * ca, el95.semiMajor * sa, { color: '--plot-text', width: 1, alpha: 0.6 });
      g.segment(el95.semiMinor * sa, -el95.semiMinor * ca, -el95.semiMinor * sa, el95.semiMinor * ca, { color: '--plot-text', width: 1, alpha: 0.6 });
      g.ellipse(0, 0, el95.semiMajor, el95.semiMinor, el95.angle, { color: '--estimate', width: 2.2 });
      g.ellipse(0, 0, el95.sigmaMajor, el95.sigmaMinor, el95.angle, { color: '--estimate', width: 1.3, dash: [5, 4] });
      g.circleWorld(0, 0, precA.cep50, { color: '--series-3', width: 1.6, dash: [2, 3] });
      g.marker(0, 0, 'diamond', 6, { color: '--emitter' });
      g.legend([
        { label: mcStale ? 'MC fixes (updating…)' : 'Monte-Carlo fixes', color: '--series-1', marker: 'circle' },
        { label: '95 % CRLB ellipse', color: '--estimate', width: 2.2 },
        { label: '1-sigma ellipse', color: '--estimate', width: 1.3, dash: [5, 4] },
        { label: 'CEP circle', color: '--series-3', width: 1.6, dash: [2, 3] },
      ], { position: 'top-left' });
    };
    errA.onHover = (x, y) => `ΔE ${fmtDist(x)}   ΔN ${fmtDist(y)}`;

    updateA(true);

    root.append(
      section(null,
        diagram('ellipse'),
        callout('math', 'From noise to ellipse', String.raw`
          <p>Stack the measurements in one list, the vector $\mathbf z$ (seconds for TDOA rows, hertz for FDOA rows),
          and write $\mathbf x = (x, y)$ for the emitter's position. Near the
          truth, a small position change $\delta\mathbf x$ changes the measurements by $H\,\delta\mathbf x$. $H$ is the
          <strong>Jacobian</strong>: a matrix with one row per measurement, that row being the measurement's
          gradient $\nabla\tau_{ij}$ or $\nabla\nu_{ij}$. The measurement errors are described by their
          <strong>covariance</strong> matrix $R$ (variances on the diagonal; off the diagonal, how the errors of two
          measurements move together). The best achievable covariance of the position estimate is then
          $$P = \left(H^{\mathsf T} R^{-1} H\right)^{-1},$$
          where $^{\mathsf T}$ is the transpose and $^{-1}$ the matrix inverse.
          $R$ is built from the per-collector errors, so it is not diagonal (see below). $P$ is a symmetric 2×2
          matrix: its diagonal holds $\sigma_x^2$ and $\sigma_y^2$, the variances of the east and north errors. Its
          eigenvectors are the directions of the axes of the error ellipse, and its eigenvalues
          $\lambda_1 \ge \lambda_2$ are the variances along them (in m²; this $\lambda$ has nothing to do with the
          wavelength): $\sigma_{major}=\sqrt{\lambda_1}$, $\sigma_{minor}=\sqrt{\lambda_2}$.</p>
          <p>For errors with a Gaussian (bell-curve) distribution in two dimensions, the ellipse that contains a
          share $p$ of the fixes has semi-axes $k\sqrt{\lambda_i}$ with
          $$k=\sqrt{-2\ln(1-p)},\qquad k_{95\%}=2.448 .$$
          Two single-number summaries are common. $\text{DRMS}=\sqrt{\sigma_x^2+\sigma_y^2}=\sqrt{\operatorname{tr}P}$
          (tr, the trace, is the sum of the diagonal entries) is the distance root-mean-square: the rms miss
          distance. The <strong>CEP</strong>, circular error probable, is the radius of the circle, centred on the truth,
          that contains half the fixes. It is $1.18\,\sigma$ for a circular distribution and falls towards
          $0.67\,\sigma_{major}$ as the ellipse becomes very elongated (the median of $|x|$ for a 1-D Gaussian); the
          readout CEP$/\sigma_{major}$ shows where you are between the two.</p>`),
        callout('idea', 'What the Cramér–Rao bound is', String.raw`
          <p>The <strong>Cramér–Rao lower bound</strong> (CRLB) is the smallest covariance that <em>any</em> unbiased
          estimator (one whose errors average to zero) can achieve from the given measurements and noise. It is a property of the problem, not of an
          algorithm: no cleverness can beat it. Weighted least squares reaches it when the errors are small compared
          with the scale over which the measurement curves bend, because then the problem is effectively linear. That
          is why the cloud of real least-squares fixes fills the CRLB ellipse and about 95 % of the dots fall inside
          it. When the cloud visibly bends into a curved "banana" along a TDOA or FDOA curve, the linearisation behind
          the ellipse is failing; the ellipse then understates the true spread along the curve, and the fraction
          inside drops.</p>`),
        callout('try', 'Read the ellipse', String.raw`
          <ul>
            <li>Drag E inside the triangle of collectors: the ellipse becomes small and nearly round
            (CEP$/\sigma_{major}$ near 1.1). Drag E far outside: it stretches along the line of sight, because the
            collectors see E from nearly the same direction and range differences hardly change as E slides away from
            them.</li>
            <li>Switch FDOA off with 3 collectors: the ellipse is the TDOA-only one, usually much longer along the
            line of sight. Switch it back on: the FDOA curves cross the TDOA curves at a different angle and cut the
            long axis down.</li>
            <li>Choose 2 collectors and switch FDOA off. Two collectors give one TDOA, one curve, so the panel
            explains that no fix exists. Switch FDOA on: one TDOA plus one FDOA is enough.</li>
            <li>Move $\sigma_T$ by a factor of 10 with FDOA off: every length in the readout scales by exactly 10. The
            ellipse's <em>shape</em> does not change. Shape is geometry; size is noise.</li>
            <li>Push $\sigma_T$ to 1 µs with 2 collectors and E far away: if the dots start to curve away from the
            ellipse, you are watching the linear approximation fail.</li>
          </ul>`),
      ),
    );

    // ================================================================ SECTION B
    const B = { n: 3, mode: 'tdoa', ref: 0 };
    const hostMapB = el('div');
    const nofixB = el('div', 'nofix');

    const modeCtl = segmented({ label: 'Map shows', options: [
      { value: 'tdoa', label: 'TDOA DOP' }, { value: 'fdoa', label: 'FDOA only' }, { value: 'both', label: 'TDOA+FDOA' }],
    value: B.mode, onChange: (v) => { B.mode = v; updateB(); } });
    const nCtlB = segmented({ label: 'Collectors', options: [{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }],
      value: B.n, onChange: (v) => { B.n = v; if (B.ref >= v) { B.ref = 0; refCtl.value = 0; } updateB(); } });
    const refCtl = segmented({ label: 'Reference collector', options: NAMES.map((nm, i) => ({ value: i, label: nm })),
      value: B.ref, onChange: (v) => { if (v >= B.n) { refCtl.value = B.ref; return; } B.ref = v; updateB(); },
      hint: 'TDOAs and FDOAs are formed as "collector minus reference".' });
    const btnWide = button({ label: 'Spread × 2', onClick: () => spread(2) });
    const btnNarrow = button({ label: 'Spread × ½', onClick: () => spread(0.5) });
    const btnSame = button({ label: 'All velocities = A’s', onClick: sameVelocity });
    const btnReset = button({ label: 'Reset layout', onClick: resetB });
    const roB = readout([
      { key: 'dop', label: 'TDOA DOP at E', hint: 'planar.tdoaDop' },
      { key: 'dopc', label: 'DOP × $c\\,\\sigma_T$', unit: '' },
      { key: 'crlbT', label: 'TDOA-only DRMS (CRLB)', hint: 'sqrt(trace P) from planar.crlb with TDOA rows only and the chosen reference' },
      { key: 'naiveA', label: 'diagonal R: actual', hint: 'True rms of a fix weighted as if the TDOAs were independent: K_d R K_d^T' },
      { key: 'naiveC', label: 'diagonal R: claimed', hint: 'What that mis-weighted estimator believes its rms is' },
      { key: 'fdopE', label: 'FDOA-only at E', unit: 's', hint: 'metres rms per m/s of per-collector range-rate error' },
      { key: 'bothE', label: 'TDOA+FDOA DRMS at E' },
    ]);
    const roBNote = el('div', 'ro-note');

    root.append(
      section('Dilution of precision', String.raw`
        <p>The ellipse above mixes two things: how noisy the measurements are, and how the geometry amplifies that
        noise. For a TDOA system they can be separated exactly. If every collector has the same timing error
        $\sigma_T$, then</p>
        $$\sigma_{pos}(\text{rms}) = \text{DOP}\times c\,\sigma_T ,$$
        <p>where $\sigma_{pos}(\text{rms})$ is the DRMS and the <strong>dilution of precision</strong> DOP is a pure number
        that depends only on where the collectors and the emitter are. $c\,\sigma_T$ is the timing error expressed as
        a distance (30 ns is 9.0 m); DOP says how many times larger the position error is. The map shows the DOP an
        emitter would have at every point of the plane, for the collectors where you put them.</p>`,
        figure({
          plot: hostMapB,
          controls: [
            controlGroup('Map', [modeCtl, nCtlB, refCtl]),
            controlGroup('At the emitter E', [roB, roBNote]),
            controlGroup('Geometry', [el('div', 'btn-row', btnWide.el, btnNarrow.el), el('div', 'btn-row', btnSame.el, btnReset.el)]),
            controlGroup('Noise (shared with the figure above)', noiseSliders(), { collapsible: true, collapsed: true }),
          ],
          caption: String.raw`Colour is log-scaled (see the colour bar); the labelled lines are contours. Hover anywhere for
          the value there. Drag the collectors, the velocity arrows (FDOA and combined modes) and the probe emitter E,
          whose numbers appear in the panel. The dashed outline is the convex hull of the collectors (the shape a
          rubber band stretched around them would take). The reference collector is the one every TDOA and FDOA is
          measured against: A in $\tau_{BA}$. In the
          FDOA-only and combined modes the map is computed from <code>planar.crlb</code> with the chosen reference
          collector; the TDOA DOP map uses <code>planar.tdoaDop</code>, which has no reference at all.`,
        }),
      ),
    );

    const mapB = new Plot2D(hostMapB, {
      height: 500, equalAspect: true, view: { xmin: -260, xmax: 260, ymin: -200, ymax: 260 },
      xLabel: 'East (km)', yLabel: 'North (km)',
      ariaLabel: 'Heat map of dilution of precision over the plane, with draggable collectors and a probe emitter.',
    });
    mapB.el.append(nofixB);
    const colsB = X.LAYOUT.map((L, i) => mapB.addHandle({ x: L.x, y: L.y, color: COLL_VARS[i], label: NAMES[i], shape: 'triangle',
      onDrag: () => interactB(), onDragEnd: () => settleB() }));
    const velB = colsB.map((h, i) => mapB.addVectorHandle({ base: h, vx: X.LAYOUT[i].vx, vy: X.LAYOUT[i].vy, scale: 0.12,
      color: COLL_VARS[i], onDrag: () => interactB(), onDragEnd: () => settleB(), constrain: clampSpeed }));
    const emB = mapB.addHandle({ x: 60, y: 110, color: '--emitter', label: 'E', shape: 'diamond',
      onDrag: () => writeReadoutB(), onDragEnd: () => writeReadoutB() });

    let coarse = false, idleTimer = 0, fieldCache = null;
    function interactB() {
      coarse = true;
      cancel(idleTimer);
      idleTimer = later(() => { coarse = false; mapB.requestRedraw(); }, 220);
      writeReadoutB();
      mapB.requestRedraw();
    }
    function settleB() { cancel(idleTimer); coarse = false; writeReadoutB(); mapB.requestRedraw(); }
    mapB.onViewChange = () => { if (fieldCache) interactB(); };

    const collectorsB = () => X.toCollectors(colsB.slice(0, B.n).map((h, i) => ({ x: h.x, y: h.y, vx: velB[i].vx, vy: velB[i].vy })));
    const modePossible = () => (B.mode === 'both' ? B.n >= 2 : B.n >= 3);

    function spread(k) {
      const n = B.n;
      const cx = colsB.slice(0, n).reduce((s, h) => s + h.x, 0) / n, cy = colsB.slice(0, n).reduce((s, h) => s + h.y, 0) / n;
      for (let i = 0; i < n; i++) { colsB[i].x = cx + k * (colsB[i].x - cx); colsB[i].y = cy + k * (colsB[i].y - cy); }
      updateB();
    }
    function sameVelocity() {
      for (let i = 1; i < 4; i++) { velB[i].vx = velB[0].vx; velB[i].vy = velB[0].vy; }
      updateB();
    }
    function resetB() {
      X.LAYOUT.forEach((L, i) => { colsB[i].x = L.x; colsB[i].y = L.y; velB[i].vx = L.vx; velB[i].vy = L.vy; });
      emB.x = 60; emB.y = 110;
      updateB();
    }

    function updateB() {
      colsB.forEach((h, i) => { h.visible = i < B.n; velB[i].visible = i < B.n && B.mode !== 'tdoa'; });
      if (!modePossible()) {
        nofixB.innerHTML = B.mode === 'tdoa'
          ? '<strong>Two collectors give a single TDOA.</strong>One curve cannot fix a point anywhere on the plane, so the DOP is infinite everywhere. Choose 3 or 4 collectors, or the combined TDOA+FDOA mode.'
          : '<strong>Two collectors give a single FDOA.</strong>One curve cannot fix a point anywhere. Choose 3 or 4 collectors, or the combined TDOA+FDOA mode.';
        nofixB.classList.add('show');
      } else nofixB.classList.remove('show');
      writeReadoutB();
      mapB.requestRedraw();
    }

    const dopOpts = () => ({ f0: noise.f0, sigmaT: noise.sigmaT, sigmaF: noise.sigmaF, ref: B.ref });

    function writeReadoutB() {
      const cs = collectorsB(), e = [emB.x * KM, emB.y * KM];
      const vals = {};
      if (B.n >= 3) {
        const chk = X.dopCheck(cs, e, noise.sigmaT, B.ref);
        const ok = isFinite(chk.dop) && chk.drmsCrlb != null;
        vals.dop = ok ? fmt(chk.dop, 4) : '∞';
        vals.dopc = ok ? fmtDist(chk.drmsDop, 5) : '—';
        vals.crlbT = ok ? fmtDist(chk.drmsCrlb, 5) : '—';
        const w = X.weightingCompare(planar.measurementList(B.n, { tdoa: true, fdoa: false, ref: B.ref }), cs, e, noise.f0, noiseObj());
        vals.naiveA = w ? fmtDist(w.naiveActual, 4) : '—';
        vals.naiveC = w ? fmtDist(w.naiveClaimed, 4) : '—';
        const fv = X.dopValue('fdoa', cs, e, dopOpts());
        vals.fdopE = isFinite(fv) ? fmt(fv, 3) : '—';
      } else {
        Object.assign(vals, { dop: '∞', dopc: '—', crlbT: '—', naiveA: '—', naiveC: '—', fdopE: '—' });
      }
      const bv = X.dopValue('both', cs, e, dopOpts());
      vals.bothE = isFinite(bv) ? fmtDist(bv) : '—';
      roB.set(vals);
      roBNote.textContent = B.n >= 3
        ? `Reference = ${NAMES[B.ref]}, per-collector σT = ${fmtSI(noise.sigmaT, 's')}. The first three lines use only TDOA.`
        : 'The TDOA-only lines need at least 3 collectors.';
    }

    function levelsFor(lo, hi) {
      const out = [];
      const mant = hi / lo > 2000 ? [1] : [1, 2, 5];
      for (let d = Math.floor(Math.log10(lo)); d <= Math.ceil(Math.log10(hi)); d++) {
        for (const m of mant) { const v = m * 10 ** d; if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); }
      }
      return out;
    }
    /** Compact contour label: 20000 -> "20k", 1e6 -> "1M". */
    const shortNum = (v) => (v >= 1e6 ? `${+(v / 1e6).toPrecision(2)}M` : v >= 1e3 ? `${+(v / 1e3).toPrecision(2)}k` : `${+v.toPrecision(2)}`);

    mapB.onDraw = (g) => {
      const n = B.n;
      const pts = colsB.slice(0, n).map((h) => [h.x, h.y]);
      if (modePossible()) {
        const cs = collectorsB(), opts = dopOpts();
        const res = coarse ? [60, 46] : [124, 96];
        const v = g.view;
        const key = JSON.stringify([B.mode, n, B.ref, pts, B.mode === 'tdoa' ? 0 : cs.map((c) => c.v),
          B.mode === 'both' ? [noise.sigmaT, noise.sigmaF, noise.f0] : B.mode === 'fdoa' ? noise.f0 : 0,
          [v.xmin, v.xmax, v.ymin, v.ymax].map((q) => q.toPrecision(7)), res]);
        if (!fieldCache || fieldCache.key !== key) {
          const field = g.sampleField((x, y) => {
            const d = X.dopValue(B.mode, cs, [x * KM, y * KM], opts);
            return d > 0 ? Math.log10(d) : NaN;
          }, { nx: res[0], ny: res[1] });
          let lo, hi;
          if (B.mode === 'tdoa') { lo = 1; hi = 1000; } else {
            const s = Array.from(field.data).filter((q) => q === q).sort((a, b) => a - b);
            if (s.length) {
              lo = 10 ** Math.floor(s[Math.floor(s.length * 0.02)]);
              hi = 10 ** Math.ceil(s[Math.floor(s.length * 0.98)]);
              if (hi / lo < 100) hi = lo * 100;
              if (hi / lo > 1e5) lo = hi / 1e5;
            } else { lo = 1; hi = 100; }
          }
          fieldCache = { key, field, lo, hi };
        }
        const { field, lo, hi } = fieldCache;
        g.heatmap(field, { colormap: 'sequential', min: Math.log10(lo), max: Math.log10(hi), alpha: 0.85 });
        const lv = B.mode === 'tdoa' ? [1, 2, 5, 10, 20, 50, 100] : levelsFor(lo, hi);
        g.contour(field, lv.map(Math.log10), { color: '--plot-text-strong', width: 1, alpha: 0.6,
          labels: (_, i) => (B.mode === 'both' ? fmtDist(lv[i], 2) : shortNum(lv[i])) });
        g.colorbar({ colormap: 'sequential', min: lo, max: hi, log: true,
          label: B.mode === 'tdoa' ? 'TDOA DOP' : B.mode === 'fdoa' ? 'm per m/s  (s)' : 'DRMS (m)' });
      }
      if (n >= 2) g.polygon(X.hull(pts), { color: '--plot-text-strong', width: 1.2, dash: [5, 4], alpha: 0.8 });
    };
    mapB.onHover = (x, y) => {
      if (!modePossible()) return `x ${x.toFixed(0)} km   y ${y.toFixed(0)} km`;
      const v = X.dopValue(B.mode, collectorsB(), [x * KM, y * KM], dopOpts());
      if (!isFinite(v)) return 'No fix possible here';
      if (B.mode === 'tdoa') return `DOP here = ${fmt(v, 3)}\nso 10 ns per collector → ${fmtDist(v * C * 10e-9)} rms`;
      if (B.mode === 'fdoa') return `${fmt(v, 3)} m per m/s here\nso 1 cm/s per collector → ${fmtDist(v * 0.01)} rms`;
      return `DRMS here = ${fmtDist(v)}`;
    };

    updateB();

    // numbers quoted in the text, computed from the core for the default layout
    const csDef = X.toCollectors(X.LAYOUT.slice(0, 3));
    const cen = [0, (X.LAYOUT[0].y + X.LAYOUT[1].y + X.LAYOUT[2].y) / 3];
    const csWide = X.toCollectors(X.LAYOUT.slice(0, 3).map((L) => ({ ...L, x: cen[0] + 2 * (L.x - cen[0]), y: cen[1] + 2 * (L.y - cen[1]) })));
    const dAt = (cs, x, y) => planar.tdoaDop(cs.map((c) => c.p), [x * KM, y * KM]);
    const q = { in: dAt(csDef, 0, 10), r300: dAt(csDef, 0, 300), r600: dAt(csDef, 0, 600), w300: dAt(csWide, 0, 300), w600: dAt(csWide, 0, 600) };
    const ell = (x, y) => estimate2(csDef, x, y);
    function estimate2(cs, x, y) {
      const P = planar.crlb(planar.measurementList(3, { fdoa: false }), cs, [x * KM, y * KM], 1e9, { sigmaT: 1 / C, sigmaF: 1 });
      const a = 0.5 * (P[0][0] + P[1][1]), b = Math.sqrt(0.25 * (P[0][0] - P[1][1]) ** 2 + P[0][1] ** 2);
      return { maj: Math.sqrt(a + b), min: Math.sqrt(Math.max(a - b, 0)) };
    }
    const e300 = ell(0, 300), e600 = ell(0, 600);

    root.append(
      section(null, String.raw`
        <h3>What the map says</h3>
        <ul>
          <li><strong>Inside the polygon of collectors the TDOA DOP is of order 1; outside it grows.</strong> With the
          default layout, hover at (0, 10 km), inside the triangle: DOP ${fmt(q.in, 3)}. Directly north at 300 km it is
          ${fmt(q.r300, 3)}, at 600 km ${fmt(q.r600, 3)}. The growth is anisotropic. Across the line of sight the
          error grows roughly like (range/baseline); along it, roughly like (range/baseline)$^2$, because distant
          collectors all see the emitter from nearly the same direction: moving the emitter radially changes every
          range by almost the same amount, and the differences barely notice. For the default layout the one-sigma
          semi-axes per unit $c\,\sigma_T$ are ${fmt(e300.maj, 3)} × ${fmt(e300.min, 3)} at 300 km and
          ${fmt(e600.maj, 3)} × ${fmt(e600.min, 3)} at 600 km: doubling the range multiplies the long axis by about 4
          and the short axis by about 2.</li>
          <li><strong>This is the GPS idea.</strong> GPS users know HDOP, VDOP, PDOP and GDOP (horizontal, vertical,
          position and geometric DOP). GPS is the
          time-of-arrival problem turned around: the unknown is the receiver's position <em>and</em> its clock offset,
          and DOP is the square root of the trace of $(H^{\mathsf T}H)^{-1}$ when every range has an error of one
          unit. TDOA with $N$
          collectors is mathematically identical to time-of-arrival with an unknown emission time: write each arrival
          time as $t_i = t_0 + \rho_i/c$ and estimate $t_0$ along with the position. Differencing against a reference
          is just one way of eliminating $t_0$, and with the noise correlations handled correctly the answer cannot
          depend on which collector you call the reference. The core computes TDOA DOP exactly that way, with rows
          $[-\hat{\mathbf l}_i^{\mathsf T},\,1]$ ($\hat{\mathbf l}_i$ is the unit vector from the emitter to
          collector $i$, and the 1 belongs to $t_0$) and no reference at all. Change the reference in the panel: the
          TDOA-only DRMS from <code>planar.crlb</code> (which does use differences against the reference) does not
          move, and it equals DOP × $c\,\sigma_T$ to every digit shown.</li>
          <li><strong>Differencing correlates the errors.</strong> $\tau_{BA}$ and $\tau_{CA}$ both contain A's timing
          error, so they are positively correlated, and with per-collector errors $\sigma_T$
          $$R = \sigma_T^2\begin{pmatrix}2&1\\1&2\end{pmatrix}\quad\text{(3 collectors, reference A)},$$
          not $2\sigma_T^2 I$ ($I$ is the identity matrix; that would be two independent errors). The panel compares
          the correct weighting with a "naive" one that pretends $R$ is
          diagonal. With 3 collectors the two TDOAs are exactly enough for a fix, so any weighting gives the same fix
          and the <em>actual</em> rms is unchanged; but the naive estimator <em>claims</em> the wrong accuracy, and the
          claim changes when you change the reference. With 4 collectors the system is overdetermined (more
          measurements than unknowns), and the naive
          fix is also genuinely worse than the correct one.</li>
          <li><strong>There is no single dimensionless DOP for a mixed TDOA+FDOA fix.</strong> TDOA errors are
          seconds and FDOA errors are hertz; one multiplier cannot serve both, and their ratio depends on the noise
          levels you assume. So one reports the weighted covariance itself, in metres, as the third map mode does.
          This is why the rest of the course quotes metres rather than DOP.</li>
        </ul>
        <h3>The FDOA-only map</h3>
        <p>An FDOA error of $\delta\nu$ hertz is a range-rate error of $\lambda\,\delta\nu$ metres per second, where
        $\lambda = c/f_0$ is the wavelength. The second
        mode therefore uses $\sigma_F = 1/\lambda$ per collector, i.e. $\lambda\sigma_F = 1$ m/s, and maps the resulting
        DRMS. The answer is in metres per (m/s), which is <strong>seconds</strong>, and it does not depend on the
        carrier. It is roughly (range ÷ collector speed) × a geometry factor: FDOA senses how fast each line of sight
        rotates, $v_\perp/\rho$ (a collector's speed across its line of sight, divided by its range $\rho$), so a
        range-rate error $\delta\dot\rho$ is mistaken for a position change of order
        $\delta\dot\rho\,\rho/v$ ($v$ is the collector's speed), amplified when the collectors' rotation rates are similar. Multiply the map value by
        $\lambda\sigma_F$ to get metres: at 1 GHz, 0.1 Hz is 0.030 m/s.</p>`,
        callout('try', 'Experiments with the DOP map', String.raw`
          <ul>
            <li><strong>Collectors in a line.</strong> Drag A, B and C onto one east–west line. Beyond the ends of the
            line, along its extension, the map goes blank (infinite DOP): there all collectors see the emitter in the
            same direction and the TDOAs do not change as it moves along the line. Broadside to the line the DOP
            stays finite, but a line of collectors also cannot tell which side of the line the emitter is on, an
            ambiguity no DOP map shows.</li>
            <li><strong>Inside versus outside.</strong> Drag E around the map and watch the panel: the TDOA DOP is
            near 1 inside the dashed hull and climbs steeply outside it.</li>
            <li><strong>Widening the baseline.</strong> Press Reset layout, hover at (0, 300 km) and note the DOP
            (${fmt(q.r300, 3)}); press Spread × 2 and hover again: ${fmt(q.w300, 3)}. At 600 km it goes from
            ${fmt(q.r600, 3)} to ${fmt(q.w600, 3)}. Far from the collectors, doubling every baseline cuts the DOP by
            nearly 4, the $(\text{range}/\text{baseline})^2$ law at work, because the long axis dominates the DRMS.</li>
            <li><strong>Reference independence.</strong> Click through references A, B, C. The TDOA map and the
            CRLB lines in the panel do not move; only the "diagonal R: claimed" line does.</li>
            <li><strong>FDOA with identical velocities.</strong> Switch to FDOA only, press Reset layout, then
            All velocities = A's (everyone flies east). A blank line appears along the east–west line through A and
            B: those two now lie on a line parallel to their common velocity, so an emitter anywhere on that line is
            dead ahead or dead astern of both, neither line of sight rotates, and the B–A FDOA carries no position
            information; one remaining FDOA cannot fix a point. Further ridges of very poor geometry sharpen to the
            north, where the remaining FDOA curves run nearly parallel. Press Reset layout (different velocities): the
            blank line is gone. FDOA geometry depends on the velocities as much as on the positions.</li>
            <li><strong>Combined mode.</strong> With 2 collectors only the TDOA+FDOA mode gives a map: one TDOA and one
            FDOA per point. Change $\sigma_F$ in the noise group and watch where the map improves: near the
            collectors, where lines of sight rotate fastest, FDOA dominates.</li>
          </ul>`),
        questionSet(QUESTIONS['dop']),
        takeaways([
          'The CRLB $P=(H^{\\mathsf T}R^{-1}H)^{-1}$ is the best covariance any unbiased estimator can reach; least squares reaches it when errors are small compared with the curvature of the geometry. A bent, banana-shaped cloud means the ellipse no longer tells the whole story.',
          'The 95 % ellipse has semi-axes $2.448\\sqrt{\\lambda_i}$ along the eigenvectors of $P$; DRMS $=\\sqrt{\\operatorname{tr}P}$; CEP lies between $0.67\\,\\sigma_{major}$ (very elongated) and $1.18\\,\\sigma$ (circular).',
          'For TDOA, position rms $=\\text{DOP}\\times c\\,\\sigma_T$: noise sets the scale, geometry sets the multiplier. DOP is of order 1 inside the collector polygon and grows like (range/baseline) across and (range/baseline)$^2$ along the line of sight outside it.',
          'TDOA is time-of-arrival with an unknown emission time, so DOP does not depend on the reference collector, provided the correlations that differencing creates are put into $R$.',
          'A mixed TDOA+FDOA fix has no single dimensionless DOP; quote the covariance in metres.',
        ]),
        nextLesson(ctx, 'error-budget'),
      ),
    );

    // ------------------------------------------------------------ cleanup
    return () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      mapA.destroy();
      errA.destroy();
      mapB.destroy();
      removeStyle();
      root.classList.remove('l-dop');
    };
  },
};

/** Keep dragged velocity arrows to a sensible range (m/s). */
function clampSpeed(vx, vy) {
  const s = Math.hypot(vx, vy);
  if (s > 600) return [(vx * 600) / s, (vy * 600) / s];
  if (s < 5) return s > 0 ? [(vx * 5) / s, (vy * 5) / s] : [5, 0];
  return [vx, vy];
}
