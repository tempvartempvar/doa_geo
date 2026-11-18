/**
 * 03-fusion-plane.js - "Two collectors, one fix: TDOA + FDOA".
 *
 * Section A: two moving collectors; the TDOA hyperbola and the FDOA curve through the emitter, their
 * +/-1 sigma bands (zoom inset), the 95 % CRLB ellipse and every solution in view (true and ghost).
 * Section B: the iterative solver from a draggable initial guess, animated, over the cost surface.
 */
import { slider, toggle, readout, controlGroup, segmented, button, fmtSI } from '../ui/controls.js';
import { el, lessonHeader, section, figure, callout, takeaways, nextLesson } from '../ui/layout.js';
import { questionSet } from '../ui/quiz.js';
import QUESTIONS from './questions.js';
import { planar } from '../core/index.js';
import { contourLines } from '../ui/plot2d.js';
import {
  KM, mapPlot, addCollector, addEmitter, addVelocity, collectorOf, posM, fieldKm, rangeLines, drawLines,
  drawGhost, solutionsInView, crossingAngleDeg, decadeRange, ZoomInset, insetHalfWidth, STYLE, fixed, fmtM,
  injectStyle,
} from './_plane.js';

const PRESETS = {
  trail: { A: [250, 0], B: [250, 0] },
  abreast: { A: [0, 250], B: [0, 250] },
  crossing: { A: [177, 177], B: [177, -177] },
};
const MEAS = [{ type: 'tdoa', i: 1, j: 0 }, { type: 'fdoa', i: 1, j: 0 }];
const freqFmt = (v) => fmtSI(v, 'Hz');

export default {
  id: 'fusion-plane',
  title: 'Two collectors, one fix: TDOA + FDOA',

  mount(root, ctx) {
    const cleanups = [];
    root.classList.add('lesson-fusion-plane');
    cleanups.push(() => root.classList.remove('lesson-fusion-plane'));
    cleanups.push(injectStyle(`
      .lesson-fusion-plane .fu-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
      .lesson-fusion-plane .fu-status { margin: 0; font-size: 13px; color: var(--critical); }
      .lesson-fusion-plane .fu-status:empty { display: none; }
    `));

    const S = { f0: 1e9, sigmaT: 50e-9, sigmaF: 0.05, preset: 'trail' };
    const noise = () => ({ sigmaT: S.sigmaT, sigmaF: S.sigmaF });
    let prec = null;

    root.append(lessonHeader({
      kicker: 'Part I · Lesson 3',
      title: 'Two collectors, one fix: TDOA + FDOA',
      lede: 'Two moving collectors measure one TDOA and one FDOA: two different curves that cross at the emitter. After this lesson you can predict how good that fix is from the angle at which the curves cross, and why a pair alone can be fooled by a mirror image.',
    }));

    // ============================================================ section A
    const hostM = el('div');
    const hostZ = el('div');
    const presetCtl = segmented({
      label: 'Collector velocities',
      options: [{ value: 'trail', label: 'In trail' }, { value: 'abreast', label: 'Abreast' }, { value: 'crossing', label: 'Crossing' }],
      value: S.preset, onChange: (v) => applyPreset(v),
    });
    const f0Ctl = slider({
      label: 'Carrier $f_0$', min: 1e8, max: 3e10, value: S.f0, log: true, format: freqFmt,
      onInput: (v) => { S.f0 = v; update(); },
    });
    const sTCtl = slider({
      label: 'Per-collector timing error $\\sigma_T$', min: 1e-9, max: 1e-6, value: S.sigmaT, log: true,
      format: (v) => fmtSI(v, 's'), onInput: (v) => { S.sigmaT = v; update(); },
      hint: 'Standard deviation of the error in each collector\'s arrival time.',
    });
    const sFCtl = slider({
      label: 'Per-collector frequency error $\\sigma_F$', min: 1e-3, max: 10, value: S.sigmaF, log: true,
      format: freqFmt, onInput: (v) => { S.sigmaF = v; update(); },
      hint: 'Standard deviation of the error in each collector\'s received frequency.',
    });
    const ro = readout([
      { key: 'tau', label: '$\\tau_{BA}$', unit: 'µs' },
      { key: 'nu', label: '$\\nu_{BA}$', unit: '' },
      { key: 'ang', label: 'Crossing angle', unit: '°', hint: 'Angle between the two gradients at E, folded to 0-90 degrees' },
      { key: 'a', label: '95 % ellipse, semi-major', unit: '', hint: 'Half the length of the ellipse' },
      { key: 'b', label: '95 % ellipse, semi-minor', unit: '', hint: 'Half its width' },
      { key: 'drms', label: 'DRMS', unit: '', hint: 'Root-mean-square miss distance' },
      { key: 'nsol', label: 'Solutions in view', unit: '', hint: 'Points that reproduce both measurements: the emitter plus any ghosts' },
    ]);
    const status = el('p', 'fu-status');

    root.append(section('Two curves from one pair',
      String.raw`<p>In lesson 1 a single pair gave one TDOA and therefore one curve. If the two collectors are
      moving, the same pair also measures an FDOA, which draws a different curve. Two measurements, two unknowns:
      where the violet TDOA hyperbola crosses the ochre FDOA curve, there is the emitter.</p>
      <p>Drag E, the collectors or their velocity arrows. The lower panel zooms in on E, where the
      $\pm1\sigma$ bands of the two measurements (the strip each curve could lie in, for a measurement error of
      one standard deviation) and the 95 % error ellipse become visible. As before, $\sigma_T$ and $\sigma_F$ are
      the standard deviations of the errors in <em>one collector's</em> arrival time and received frequency.</p>`,
      figure({
        plot: [hostM, hostZ],
        controls: [
          controlGroup('Measurements', [ro, status]),
          controlGroup('Geometry', [presetCtl, f0Ctl]),
          controlGroup('Noise', [sTCtl, sFCtl]),
        ],
        caption: String.raw`Upper: the TDOA curve (violet) and the FDOA curve (ochre) through E; a ringed marker
        labelled "ghost" is another point that reproduces both measurements exactly. Lower: the same curves near E,
        their $\pm1\sigma$ bands (the TDOA and FDOA errors are $\sigma_\tau = \sqrt2\,\sigma_T$ and
        $\sigma_\nu = \sqrt2\,\sigma_F$, each being a difference of two collectors' values) and the 95 % error
        ellipse from the Cramér–Rao lower bound (CRLB); the zoom rescales itself, so read the scale off its axes.`,
      }),
      callout('math', 'From two curves to an error ellipse', String.raw`
        <p>Write $\mathbf x = (x, y)$ for the emitter's true position and $\mathbf z = (\tau_{BA}, \nu_{BA})$ for
        the two measurements stacked into one list. A small error in the measurements,
        $\delta\mathbf z = (\delta\tau, \delta\nu)$, and the small displacement $\delta\mathbf x$ of the emitter
        that would explain it are related linearly:
        $$\delta\mathbf z = H\,\delta\mathbf x,\qquad H = \begin{pmatrix}\nabla\tau_{BA}^T\\ \nabla\nu_{BA}^T\end{pmatrix}.$$
        $H$ is a 2 × 2 matrix whose rows are the two gradients from lessons 1 and 2 (the superscript $T$ is the
        transpose: it lays a vector on its side, or swaps a matrix's rows and columns). The size of the measurement
        errors is held in their <strong>covariance</strong> matrix $R$; for one pair it has $\sigma_\tau^2$ and
        $\sigma_\nu^2$ on its diagonal and zeros elsewhere. <strong>Weighted least squares</strong>, which picks
        the position whose predicted measurements best match the measured ones and trusts each measurement
        according to its precision, gives the estimate
        $$\hat{\mathbf x} = \mathbf x + (H^TR^{-1}H)^{-1}H^TR^{-1}\,\delta\mathbf z$$
        (a hat marks an estimate). The spread of that estimate is the position covariance
        $P = (H^TR^{-1}H)^{-1}$, a 2 × 2 matrix with the variances of the $x$ and $y$ errors on its diagonal. It is
        also the Cramér–Rao lower bound: no estimator whose errors average to zero can do better. The ellipse is
        $P$ scaled to contain 95 % of the fixes.</p>
        <p>Geometrically: each measurement defines a band of half-width $\sigma/\lVert\nabla\rVert$ around its curve
        (its standard deviation divided by the length of its gradient, as in lessons 1 and 2), and
        the fix lives where the two bands overlap, a parallelogram. Its long diagonal grows like
        $1/\sin(\text{crossing angle})$: curves that cross at right angles give a compact fix, nearly tangent curves a
        long thin one, and exactly tangent curves no fix at all.</p>`),
      callout('idea', 'Ghosts: why a pair can be fooled', String.raw`<p>With the collectors in trail (same velocity,
        along the line joining them) the whole picture is mirror-symmetric about their track, the line they fly
        along. A <strong>ghost</strong> is a wrong position that reproduces the measurements exactly. The mirror image of E
        across that line has the same two ranges and the same two range rates, so it produces exactly the same TDOA
        and FDOA: the ghost in the default view, at $(15, -60)$ km. Two collectors alone cannot tell left from right.
        Real systems break the tie with a third collector, antenna pointing, the Earth's surface and horizon, or a
        second look after the geometry has changed. With other velocities the symmetry is broken and the ghosts move
        or disappear; count them in the readout.</p>`),
      callout('try', 'Crossing angles', String.raw`<ul>
        <li><strong>Right angles.</strong> In trail, drag E onto the perpendicular bisector ($x = 0$): the TDOA curve is
        the straight bisector, the FDOA curve crosses it at 90°, and the ellipse is as compact as it gets for that
        range.</li>
        <li><strong>Nearly tangent.</strong> In trail, drag E low and beyond B, for instance to (90, 10) km: the two
        curves run almost parallel (about 5°) and the ellipse stretches to kilometres along them.</li>
        <li><strong>Carrier.</strong> Raise $f_0$: the FDOA band narrows in proportion (its gradient scales with $f_0$,
        $\sigma_F$ does not) while the TDOA band stays put, so the ellipse shrinks across the FDOA curve.</li>
        <li><strong>Abreast.</strong> The pattern changes completely. On the perpendicular bisector both measurements
        are zero and both curves are the bisector itself: they coincide, and the panel reports that no fix is possible.
        Move E sideways and the crossing angle opens up.</li>
      </ul>`),
    ));

    const plotM = mapPlot(hostM, {
      height: 440, ariaLabel: 'Map with two moving collectors, a draggable emitter, the TDOA and FDOA curves through it and their intersections.',
    });
    const zoom = new ZoomInset(hostZ, { height: 300, ariaLabel: 'Zoom around the emitter: TDOA and FDOA bands and the error ellipse.' });
    const onVel = () => { presetCtl.set('custom'); update(); };
    const A = addCollector(plotM, 'A', -40, 0, { onDrag: () => update() });
    const B = addCollector(plotM, 'B', 40, 0, { onDrag: () => update() });
    const VA = addVelocity(plotM, A, 250, 0, { onDrag: onVel });
    const VB = addVelocity(plotM, B, 250, 0, { onDrag: onVel });
    const E = addEmitter(plotM, 15, 60, { onDrag: () => update() });

    const cols = () => [collectorOf(A, VA), collectorOf(B, VB)];
    let sols = [];

    function applyPreset(name) {
      const p = PRESETS[name];
      if (!p) return;
      S.preset = name;
      VA.vx = p.A[0]; VA.vy = p.A[1]; VB.vx = p.B[0]; VB.vy = p.B[1];
      update();
    }

    plotM.onDraw = (g) => {
      const [cA, cB] = cols(), e = posM(E), f0 = S.f0;
      const tf = fieldKm(g, (p) => planar.tdoa(cB, cA, p));
      const ff = fieldKm(g, (p) => planar.fdoa(cB, cA, p, f0));
      const tE = planar.tdoa(cB, cA, e), nE = planar.fdoa(cB, cA, e, f0);
      const sT = Math.SQRT2 * S.sigmaT, sF = Math.SQRT2 * S.sigmaF;
      g.contourBand(tf, tE - sT, tE + sT, { fill: '--tdoa', ...STYLE.band });
      g.contourBand(ff, nE - sF, nE + sF, { fill: '--fdoa', ...STYLE.band });
      rangeLines(g, E, [A, B]);
      drawLines(g, contourLines(tf, tE), { color: '--tdoa', ...STYLE.bold });
      drawLines(g, contourLines(ff, nE), { color: '--fdoa', ...STYLE.bold });
      if (prec) g.ellipse(E.x, E.y, prec.ellipse.semiMajor / KM, prec.ellipse.semiMinor / KM, prec.ellipse.angle, { color: '--estimate', width: 1.5 });
      sols = solutionsInView({
        fieldA: tf, levelA: tE, fieldB: ff, levelB: nE, meas: MEAS, collectors: [cA, cB], z: [tE, nE], f0,
        noise: noise(), eKm: [E.x, E.y], view: g.view,
      });
      if (!sols.some((s) => s.isTrue)) sols.unshift({ x: E.x, y: E.y, isTrue: true });
      for (const s of sols) if (!s.isTrue) drawGhost(g, s.x, s.y);
      ro.set({ nsol: prec ? String(sols.length) : '—' });
      g.legend([
        { label: 'TDOA τBA through E', color: '--tdoa', width: 2.6 },
        { label: 'FDOA νBA through E', color: '--fdoa', width: 2.6 },
      ], { position: 'bottom-left' });
    };
    plotM.onHover = (x, y) => {
      const [cA, cB] = cols(), p = [x * KM, y * KM];
      return `x ${x.toFixed(1)} km  y ${y.toFixed(1)} km\nτBA ${fixed(planar.tdoa(cB, cA, p) * 1e6, 2)} µs\nνBA ${freqFmt(planar.fdoa(cB, cA, p, S.f0))}`;
    };

    zoom.plot.onDraw = (g) => {
      const [cA, cB] = cols(), e = posM(E), f0 = S.f0;
      const tE = planar.tdoa(cB, cA, e), nE = planar.fdoa(cB, cA, e, f0);
      const sT = Math.SQRT2 * S.sigmaT, sF = Math.SQRT2 * S.sigmaF;
      const v = g.view, R = Math.hypot(v.xmax - v.xmin, v.ymax - v.ymin);
      for (const h of [A, B]) {
        const dx = h.x * KM - e[0], dy = h.y * KM - e[1], r = Math.hypot(dx, dy);
        if (r > 0) g.segment(0, 0, dx / r * R, dy / r * R, { ...STYLE.range, color: h.color, alpha: 0.5 });
      }
      const tf = zoom.field(g, (p) => planar.tdoa(cB, cA, p));
      const ff = zoom.field(g, (p) => planar.fdoa(cB, cA, p, f0));
      g.contourBand(tf, tE - sT, tE + sT, { fill: '--tdoa', ...STYLE.band });
      g.contourBand(ff, nE - sF, nE + sF, { fill: '--fdoa', ...STYLE.band });
      g.contour(tf, [tE], { color: '--tdoa', width: 2 });
      g.contour(ff, [nE], { color: '--fdoa', width: 2 });
      if (prec) zoom.ellipse(g, prec.ellipse, { color: '--estimate', width: 1.8 });
      else g.text(0, 0, 'No fix possible with these measurements', { align: 'center', dy: -18, size: 13, color: '--plot-text-strong' });
      g.marker(0, 0, 'diamond', 6, { color: '--emitter' });
      g.legend([
        { label: 'TDOA ±1σ', fill: '--tdoa', fillAlpha: 0.3 },
        { label: 'FDOA ±1σ', fill: '--fdoa', fillAlpha: 0.3 },
        { label: '95 % ellipse', color: '--estimate', width: 1.8 },
      ], { position: 'top-left' });
    };

    function update() {
      const [cA, cB] = cols(), e = posM(E), f0 = S.f0;
      prec = planar.precision(MEAS, [cA, cB], e, f0, noise());
      const ang = crossingAngleDeg(planar.gradTdoa(cB, cA, e), planar.gradFdoa(cB, cA, e, f0));
      ro.set({
        tau: fixed(planar.tdoa(cB, cA, e) * 1e6, 3),
        nu: freqFmt(planar.fdoa(cB, cA, e, f0)),
        ang: ang == null ? '—' : ang.toFixed(1),
        a: prec ? fmtM(prec.ellipse.semiMajor) : '—',
        b: prec ? fmtM(prec.ellipse.semiMinor) : '—',
        drms: prec ? fmtM(prec.drms) : '—',
      });
      status.textContent = prec ? '' : 'No fix possible with these measurements: the two curves are tangent at E.';
      zoom.setFrame(e[0], e[1], insetHalfWidth(prec && prec.ellipse));
      plotM.requestRedraw();
      zoom.plot.requestRedraw();
      syncSolver();
    }

    // ============================================================ section B: solver
    const T = { heat: false, path: null, step: 0, timer: 0, result: null, costField: null, costRange: null, costTimer: 0 };
    const hostS = el('div');
    const btnSolve = button({ label: 'Solve', kind: 'primary', onClick: () => solve() });
    const heatCtl = toggle({
      label: 'Map: cost surface', value: false,
      hint: 'Weighted sum of squared residuals at each trial position (log colour scale).',
      onChange: (v) => { T.heat = v; scheduleCost(); plotS.requestRedraw(); },
    });
    const roS = readout([
      { key: 'it', label: 'Iteration', unit: '' },
      { key: 'cost', label: 'Cost', unit: '' },
      { key: 'res', label: 'Converged to', unit: '' },
      { key: 'err', label: 'Distance from E', unit: '' },
    ]);

    root.append(section('Solving: the answer depends on where you start',
      String.raw`<p>A solver starts from a guess and improves it step by step. What it drives down is the
      <strong>cost</strong>: the sum of the squared mismatches between the measured values and the values a trial
      position would produce, each divided by its variance. The cost is zero at any position that reproduces
      the measurements exactly. The curves cross in more than one place, so a solver that walks downhill from a
      starting guess can end at either crossing. This figure uses the geometry above (drag E here or there) and
      noise-free measurements, so the true emitter and any ghost both fit perfectly. Drag the "start" marker and
      press Solve: the solver is replayed one iteration at a time. (It is Gauss–Newton with Levenberg–Marquardt
      damping, <code>planar.locate</code>: each step treats the curves as straight lines near the current
      position, jumps to where those lines cross, and shortens the jump if the cost went up.)</p>`,
      figure({
        plot: hostS,
        controls: [controlGroup('Solver', [el('div', 'fu-buttons', btnSolve.el), roS]), controlGroup('Background', [heatCtl])],
        caption: String.raw`Faint curves: the TDOA and FDOA curves through E. Black dots: the solver's successive
        trial positions (iterates) from the start marker. With the cost map on, dark valleys are low cost; each
        solution sits at the bottom of its own basin, the set of starting points that lead to it.`,
      }),
      callout('try', 'Two basins', String.raw`<p>With the default in-trail geometry, press Solve from the default start
        at (40, −40) km: the solver lands on the mirror-image ghost at (15, −60) km. Drag the start to about (−30, 40) km
        and it finds E, with the same, essentially zero, final cost. Nothing in the two measurements prefers one answer:
        the starting point decides. The boundary between the basins is not simply the track: starts close to it, or
        far to the side, can go either way, so try a few. Turn on the cost map to see the two valleys.</p>`),
    ));

    const plotS = mapPlot(hostS, { height: 420, ariaLabel: 'Solver figure: start marker, solver iterates and optional cost surface.' });
    const SA = addCollector(plotS, 'A', A.x, A.y, { draggable: false });
    const SB = addCollector(plotS, 'B', B.x, B.y, { draggable: false });
    const SVA = addVelocity(plotS, SA, VA.vx, VA.vy, { draggable: false });
    const SVB = addVelocity(plotS, SB, VB.vx, VB.vy, { draggable: false });
    const SE = addEmitter(plotS, E.x, E.y, { onDrag: (x, y) => { E.x = x; E.y = y; update(); } });
    const G = plotS.addHandle({ x: 40, y: -40, color: '--estimate', label: 'start', shape: 'circle', radius: 7, onDrag: () => clearPath() });

    function syncSolver() {
      SA.x = A.x; SA.y = A.y; SB.x = B.x; SB.y = B.y;
      SVA.vx = VA.vx; SVA.vy = VA.vy; SVB.vx = VB.vx; SVB.vy = VB.vy;
      if (!SE.dragging) { SE.x = E.x; SE.y = E.y; }
      clearPath();
      scheduleCost();
    }

    function clearPath() {
      if (T.timer) { clearInterval(T.timer); T.timer = 0; }
      T.path = null; T.result = null; T.step = 0;
      roS.set({ it: '—', cost: '—', res: '—', err: '—' });
      plotS.requestRedraw();
    }

    const truthZ = () => { const [cA, cB] = cols(); const e = posM(E); return [planar.tdoa(cB, cA, e), planar.fdoa(cB, cA, e, S.f0)]; };

    function scheduleCost() {
      T.costField = null;
      if (T.costTimer) clearTimeout(T.costTimer);
      if (!T.heat) return;
      T.costTimer = setTimeout(() => {
        T.costTimer = 0;
        const c = cols(), z = truthZ(), nz = noise(), x = [0, 0];
        T.costField = plotS.sampleField((px, py) => { x[0] = px * KM; x[1] = py * KM; return planar.cost(MEAS, c, z, S.f0, nz, x); }, { nx: 110, ny: 85 });
        T.costRange = decadeRange(T.costField, { lo: 0.01, hi: 0.99, minDecades: 3 });
        plotS.requestRedraw();
      }, 150);
    }
    plotS.onViewChange = () => scheduleCost();

    function solve() {
      clearPath();
      const c = cols();
      let res;
      try {
        res = planar.locate({ meas: MEAS, collectors: c, z: truthZ(), f0: S.f0, noise: noise(), x0: [G.x * KM, G.y * KM] });
      } catch { return; }
      T.result = res; T.path = res.path; T.step = 0;
      const show = () => {
        const p = T.path[T.step];
        const last = T.step === T.path.length - 1;
        const x = p.x[0] / KM, y = p.x[1] / KM;
        const dE = Math.hypot(p.x[0] - E.x * KM, p.x[1] - E.y * KM);
        roS.set({
          it: `${T.step} / ${T.path.length - 1}`,
          cost: p.cost < 1e-6 ? '< 10⁻⁶' : p.cost.toPrecision(3),
          res: last ? (dE < 50 ? 'the emitter' : (sols.some((s) => !s.isTrue && Math.hypot(s.x - x, s.y - y) < 0.1) ? 'a ghost' : (res.cost < 1e-3 ? 'another exact solution' : 'a local minimum (not a solution)'))) : '…',
          err: fmtM(dE),
        });
        plotS.requestRedraw();
        if (last && T.timer) { clearInterval(T.timer); T.timer = 0; }
        T.step = Math.min(T.step + 1, T.path.length - 1);
      };
      show();
      if (T.path.length > 1) T.timer = setInterval(show, 350);
    }

    plotS.onDraw = (g) => {
      const [cA, cB] = cols(), e = posM(E), f0 = S.f0;
      if (T.heat && T.costField) {
        g.heatmap(T.costField, { colormap: 'sequential', log: true, ...T.costRange, alpha: 0.8 });
        g.colorbar({ colormap: 'sequential', log: true, ...T.costRange, label: 'cost' });
      }
      const tf = fieldKm(g, (p) => planar.tdoa(cB, cA, p), { nx: 140, ny: 105 });
      const ff = fieldKm(g, (p) => planar.fdoa(cB, cA, p, f0), { nx: 140, ny: 105 });
      g.contour(tf, [planar.tdoa(cB, cA, e)], { color: '--tdoa', width: 1.6, alpha: 0.7 });
      g.contour(ff, [planar.fdoa(cB, cA, e, f0)], { color: '--fdoa', width: 1.6, alpha: 0.7 });
      if (T.path) {
        const shown = T.path.slice(0, T.step + 1).map((p) => [p.x[0] / KM, p.x[1] / KM]);
        g.line([[G.x, G.y], ...shown], { color: '--estimate', width: 1.3, alpha: 0.8 });
        for (const p of shown) g.circle(p[0], p[1], 3, { color: '--estimate', fill: '--estimate' });
        const last = shown[shown.length - 1];
        g.marker(last[0], last[1], 'cross', 7, { color: '--estimate' });
      }
    };

    applyPreset('trail');
    cleanups.push(() => {
      if (T.timer) clearInterval(T.timer);
      if (T.costTimer) clearTimeout(T.costTimer);
      plotM.destroy(); zoom.destroy(); plotS.destroy();
    });

    root.append(
      questionSet(QUESTIONS['fusion-plane']),
      takeaways([
        'Two moving collectors measure a TDOA and an FDOA; the hyperbola and the FDOA curve cross at the emitter, so a single pair can fix a position in the plane.',
        'The precision follows from the gradients: $P = (H^TR^{-1}H)^{-1}$ with the two gradients as the rows of $H$. Geometrically the fix is the overlap of two bands of half-width $\\sigma/\\lVert\\nabla\\rVert$, stretched by $1/\\sin$ of the crossing angle.',
        'Curves crossing near 90° give a compact ellipse; nearly tangent curves give a long one, and tangent curves give no fix.',
        'The curves can cross more than once. In trail, the mirror image across the track reproduces both measurements exactly; extra information (a third collector, pointing, the Earth, a second look) is needed to reject it.',
        'An iterative solver finds the solution in whose basin it starts. How noise turns into error ellipses, and which geometries amplify it, is the subject of Part II.',
      ]),
      nextLesson(ctx, 'dop'),
    );

    return () => { for (const f of cleanups) f(); };
  },
};
