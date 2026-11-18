/**
 * 02-fdoa-plane.js - "FDOA: Doppler differences".
 *
 * Section A: one moving collector; the Doppler shift an emitter at each point would produce
 * (iso-Doppler lines are rays). Section B: two moving collectors, the FDOA nu_BA, its iso-curves, how far
 * a 1 Hz error moves the curve, and (Careful) what an emitter that is not stationary does to it.
 */
import { slider, toggle, readout, controlGroup, segmented, fmtSI } from '../ui/controls.js';
import { el, lessonHeader, section, figure, callout, takeaways, nextLesson } from '../ui/layout.js';
import { questionSet } from '../ui/quiz.js';
import { diagram } from '../ui/diagrams.js';
import QUESTIONS from './questions.js';
import { planar } from '../core/index.js';
import {
  KM, mapPlot, addCollector, addEmitter, addVelocity, collectorOf, posM, fieldKm, rangeLines,
  decadeRange, STYLE, fixed, fmtM, injectStyle,
} from './_plane.js';

const RR_STEP = 25; // family spacing in m/s of range-rate difference
const freqFmt = (v) => fmtSI(v, 'Hz');

/** Presets for the two-collector figure: velocities in m/s. */
const PRESETS = {
  trail: { A: [250, 0], B: [250, 0] },
  abreast: { A: [0, 250], B: [0, 250] },
  crossing: { A: [177, 177], B: [177, -177] },
};

export default {
  id: 'fdoa-plane',
  title: 'FDOA: Doppler differences',

  mount(root, ctx) {
    const cleanups = [];
    root.classList.add('lesson-fdoa-plane');
    cleanups.push(() => root.classList.remove('lesson-fdoa-plane'));
    cleanups.push(injectStyle(`
      .lesson-fdoa-plane .fp-note { margin: 0; font-size: 13px; color: var(--text-2); line-height: 1.5; }
    `));

    root.append(lessonHeader({
      kicker: 'Part I · Lesson 2',
      title: 'FDOA: Doppler differences',
      lede: 'Moving collectors hear the emitter at slightly different frequencies. After this lesson you can predict the shape of the curves a frequency difference draws, and say what makes FDOA sensitive and what makes it blind.',
    }));

    // ============================================================ section A: one collector
    const sA = { f0: 1e9 };
    const hostA = el('div');
    const f0A = slider({
      label: 'Carrier $f_0$', min: 1e8, max: 3e10, value: sA.f0, log: true, format: freqFmt,
      onInput: (v) => { sA.f0 = v; updateA(); },
    });
    const roA = readout([
      { key: 'speed', label: 'Speed $v$', unit: 'm/s' },
      { key: 'lam', label: 'Wavelength $\\lambda$', unit: '' },
      { key: 'vmax', label: '$v/\\lambda$ (largest shift)', unit: '' },
      { key: 'alpha', label: 'Angle $\\alpha$', unit: '°', hint: 'Between the velocity and the direction from A to E' },
      { key: 'rdot', label: 'Range rate $\\dot\\rho_A$', unit: 'm/s' },
      { key: 'dop', label: 'Doppler $f_A - f_0$', unit: '' },
    ]);

    root.append(section('Doppler from one moving collector',
      String.raw`<p>Collector A flies east at 250 m/s. A stationary emitter transmits at the carrier frequency $f_0$;
      because the range $\rho_A$ between them changes, A receives a slightly different frequency,
      $f_A = f_0 - \frac{f_0}{c}\dot\rho_A$. Here $c$ is the speed of light and
      $\dot\rho_A = \mathrm d\rho_A/\mathrm dt$ is the <strong>range rate</strong>: how fast the distance between A and the emitter
      is changing, positive when it is growing. The background shows the Doppler shift
      $f_A - f_0$ that an emitter at each point would produce. Drag E, or drag the tip of A's velocity arrow.</p>`,
      figure({
        plot: hostA,
        controls: [controlGroup('Measurement', [roA]), controlGroup('Signal', [f0A])],
        caption: String.raw`Doppler shift seen by A for an emitter at each point (diverging colour scale, $\pm v/\lambda$).
        Thin lines: equal shift, every 15° of the angle $\alpha$. Bold line: the shift E produces. Positive (closing)
        ahead of A, negative behind, zero on the line through A perpendicular to its velocity.`,
      }),
      diagram('doppler'),
      callout('math', 'Why the iso-Doppler lines are rays', String.raw`
        <p>The <strong>line of sight</strong> is the straight line between the collector and the emitter. Only the
        part of the velocity that points along it changes the range. Let $\mathbf v$ be A's velocity and $v$ its
        speed, $\alpha$ the angle between $\mathbf v$ and the direction from A to the emitter, and
        $\lambda = c/f_0$ the wavelength. Then
        $$\dot\rho_A = -v\cos\alpha,\qquad f_A - f_0 = -\frac{\dot\rho_A}{\lambda} = \frac{v}{\lambda}\cos\alpha .$$
        The shift depends only on the <em>direction</em> to the emitter, not on its distance, so every line of
        equal Doppler shift (an iso-Doppler line) is a ray from the collector. The largest shift, $v/\lambda$, is
        straight ahead ($\alpha = 0$); the shift is zero when the emitter is directly to one side
        ($\alpha = 90^\circ$) and $-v/\lambda$ straight behind.</p>`),
      callout('idea', 'One collector is not enough', String.raw`<p>To use this the collector would have to know
        $f_0$ to a small fraction of $v/\lambda$, and an uncooperative emitter's oscillator is not known to a fraction
        of a hertz: an oscillator good to one part in a million is still uncertain by 1 kHz at 1 GHz, more than the
        largest shift $v/\lambda$ in this figure at the default settings. But the unknown offset is the same
        for every collector that hears the same signal, so it <strong>cancels in the difference</strong> between two
        collectors. That difference is the FDOA.</p>`),
    ));

    const plotA = mapPlot(hostA, {
      height: 440,
      ariaLabel: 'Map with one moving collector A, its velocity arrow, a draggable emitter, and the Doppler shift field.',
    });
    const A0 = addCollector(plotA, 'A', 0, 0, { draggable: false });
    const VA0 = addVelocity(plotA, A0, 250, 0, { label: 'v', onDrag: () => updateA() });
    const E0 = addEmitter(plotA, 45, 55, { onDrag: () => updateA() });

    plotA.onDraw = (g) => {
      const c = collectorOf(A0, VA0), f0 = sA.f0, lam = planar.C / f0;
      const vmax = Math.hypot(VA0.vx, VA0.vy) / lam;
      const df = fieldKm(g, (p) => planar.doppler(c, p, f0), { nx: 150, ny: 115 });
      g.heatmap(df, { colormap: 'diverging', min: -vmax, max: vmax, alpha: 0.7 });
      g.colorbar({ colormap: 'diverging', min: -vmax, max: vmax, label: 'Doppler (Hz)' });
      const levels = [];
      for (let k = 1; k < 12; k++) levels.push(vmax * Math.cos(k * Math.PI / 12));
      g.contour(df, levels, { color: '--plot-text', width: 1, alpha: 0.55 });
      g.segment(E0.x, E0.y, A0.x, A0.y, { ...STYLE.range, color: A0.color });
      g.contour(df, [planar.doppler(c, posM(E0), f0)], { color: '--plot-text-strong', width: 2.4 });
    };
    plotA.onHover = (x, y) => {
      const c = collectorOf(A0, VA0);
      return `x ${x.toFixed(1)} km  y ${y.toFixed(1)} km\nDoppler ${freqFmt(planar.doppler(c, [x * KM, y * KM], sA.f0))}`;
    };

    function updateA() {
      const c = collectorOf(A0, VA0), e = posM(E0), f0 = sA.f0, lam = planar.C / f0;
      const v = Math.hypot(c.v[0], c.v[1]);
      const dx = e[0] - c.p[0], dy = e[1] - c.p[1], r = Math.hypot(dx, dy);
      const alpha = r > 0 ? Math.acos(Math.max(-1, Math.min(1, (c.v[0] * dx + c.v[1] * dy) / (v * r)))) * 180 / Math.PI : NaN;
      roA.set({
        speed: v.toFixed(0),
        lam: fmtM(lam),
        vmax: freqFmt(v / lam),
        alpha: isFinite(alpha) ? alpha.toFixed(1) : '—',
        rdot: r > 0 ? fixed(planar.rangeRate(c, e), 1) : '—',
        dop: r > 0 ? freqFmt(planar.doppler(c, e, f0)) : '—',
      });
      plotA.requestRedraw();
    }
    updateA();
    cleanups.push(() => plotA.destroy());

    // ============================================================ section B: FDOA
    const sB = { f0: 1e9, preset: 'trail', heat: false, u: 0 };
    const hostB = el('div');
    const presetCtl = segmented({
      label: 'Collector velocities',
      options: [{ value: 'trail', label: 'In trail' }, { value: 'abreast', label: 'Abreast' }, { value: 'crossing', label: 'Crossing' }],
      value: sB.preset,
      onChange: (v) => applyPreset(v),
    });
    const f0B = slider({
      label: 'Carrier $f_0$', min: 1e8, max: 3e10, value: sB.f0, log: true, format: freqFmt,
      onInput: (v) => { sB.f0 = v; updateB(); },
    });
    const heatCtl = toggle({
      label: 'Map: metres of curve shift per Hz', value: false,
      hint: 'How far a 1 Hz FDOA error moves the curve through each point (log colour scale).',
      onChange: (v) => { sB.heat = v; plotB.requestRedraw(); },
    });
    const uCtl = slider({
      label: 'Emitter speed (heading east)', min: 0, max: 20, step: 0.5, value: 0, unit: 'm/s',
      format: (v) => v.toFixed(1),
      onInput: (v) => { sB.u = v; updateB(); },
    });
    const roB = readout([
      { key: 'rdA', label: '$\\dot\\rho_A$', unit: 'm/s' },
      { key: 'rdB', label: '$\\dot\\rho_B$', unit: 'm/s' },
      { key: 'nu', label: '$\\nu_{BA}$', unit: '' },
      { key: 'step', label: 'Faint curves every', unit: '' },
      { key: 'sens', label: '1 Hz moves the curve by', unit: '', hint: '1 Hz / |grad nu|, along the normal to the curve at E' },
    ]);
    const roU = readout([
      { key: 'dnu', label: 'FDOA change from motion', unit: '' },
      { key: 'shift', label: 'Curve moved at E by', unit: '' },
    ]);

    root.append(section('FDOA: the difference of two Doppler shifts',
      String.raw`<p>Now two collectors, A and B, both moving. Each sees its own Doppler shift; the difference
      $$\nu_{BA} = f_B - f_A = -\frac{f_0}{c}\,\big(\dot\rho_B - \dot\rho_A\big)$$
      no longer contains the emitter's unknown frequency offset. It is a <strong>range-rate difference</strong>,
      just as TDOA is a range difference. The bold ochre curve is every emitter position that would give the same
      $\nu_{BA}$ as E. Drag E, the collectors, or the tips of their velocity arrows, and try the presets:
      <strong>in trail</strong> (one behind the other, flying along the line that joins them),
      <strong>abreast</strong> (side by side, flying across it) and <strong>crossing</strong> (headings 90° apart).</p>`,
      figure({
        plot: hostB,
        controls: [
          controlGroup('Measurement', [roB]),
          controlGroup('Geometry', [presetCtl, f0B]),
          controlGroup('Background', [heatCtl]),
          controlGroup('Emitter motion (see "Careful" below)', [uCtl, roU]),
        ],
        caption: String.raw`Iso-FDOA curves of $\nu_{BA}$: faint ones every 25 m/s of range-rate difference (the
        spacing in hertz is in the readout), bold through E. With the emitter moving, the dashed curve is the one a
        processor that assumes a stationary emitter would draw for the FDOA it actually measures.`,
      }),
      callout('math', 'What FDOA responds to', String.raw`
        <p>The range rate is the velocity component along the line of sight, $\dot\rho_i = \mathbf v_i\cdot\hat{\mathbf l}_i$,
        where $\mathbf v_i$ is collector $i$'s velocity and $\hat{\mathbf l}_i$ is the unit vector (length 1) pointing
        from the emitter to collector $i$. Moving the emitter turns the lines of sight. Taking the gradient
        $\nabla$ with respect to the emitter's position, as in the last lesson, gives
        $$\nabla\nu_{BA} = \frac{1}{\lambda}\left(\frac{\mathbf v_{\perp B}}{\rho_B} - \frac{\mathbf v_{\perp A}}{\rho_A}\right),$$
        where $\mathbf v_{\perp i}$ is the part of collector $i$'s velocity perpendicular to its line of sight and
        $\rho_i$ is its range. Each term
        $\mathbf v_\perp/\rho$ is the rate at which that collector's line of sight rotates, so <strong>FDOA responds to
        the difference of the two rotation rates</strong>. $\lVert\nabla\nu\rVert$, the length of the gradient, is
        in hertz per metre, so a 1 Hz error moves the curve by $1/\lVert\nabla\nu\rVert$ metres along its normal
        (at right angles to itself): the last readout.</p>
        <p>Now take two collectors with the same velocity, of magnitude $v$, a baseline $d$ apart, and an emitter
        much farther away than that, at a range $\rho \gg d$ from the pair (so $\rho_A \approx \rho_B \approx \rho$). The
        two rotation rates differ by roughly $\frac{v}{\rho}\cdot\frac{d}{\rho}$, so
        $$\lVert\nabla\nu\rVert \sim \frac{1}{\lambda}\,\frac{v}{\rho}\,\frac{d}{\rho},\qquad
        \text{1 Hz} \;\leftrightarrow\; \text{about } \frac{\lambda\,\rho^2}{v\,d}\ \text{metres}.$$
        Treat this as an order-of-magnitude rule (the exact value depends on the directions involved); the readout
        is exact.</p>`),
      callout('try', 'What to look for', String.raw`<ul>
        <li><strong>Carrier.</strong> Move $f_0$. The curves do not move at all; only the numbers on them change,
        in proportion to $f_0$. So the same 1 Hz error costs ten times less position at 10 GHz than at 1 GHz:
        watch the last readout.</li>
        <li><strong>Not hyperbolas.</strong> Drag a velocity arrow or switch presets: the family is reshaped
        completely. FDOA curves depend on the velocities as well as the positions, and a single value can have
        several separate branches: with "Abreast" the curve through E comes in two pieces, one ending at each
        collector.</li>
        <li><strong>Far away it fades.</strong> In trail or abreast (identical velocities), zoom out (click the map, then scroll) and
        drag E far from the collectors. $\nu_{BA}$ goes towards zero and the metres per hertz grow roughly as
        $\rho^2$: the two lines of sight become parallel and rotate at the same rate. With "Crossing" the
        velocities differ, so far away $\nu_{BA}$ tends to $-(\mathbf v_B - \mathbf v_A)\cdot\hat{\mathbf l}/\lambda$, which
        depends on the direction $\hat{\mathbf l}$ but not on the range: the gradient across the curves still fades.</li>
        <li><strong>Abreast, on the perpendicular bisector</strong> (the line $x = 0$ here, equally far from A and
        B). By symmetry $\nu_{BA} = 0$ on the whole bisector,
        which is the TDOA curve $\tau_{BA}=0$ as well. Remember this for the next lesson.</li>
      </ul>`),
      callout('caution', 'The emitter is assumed to be stationary', String.raw`
        <p>The processor converts a measured FDOA into a curve assuming the emitter does not move. If it does move,
        with velocity $\mathbf u$, every range rate becomes $\dot\rho_i = (\mathbf v_i - \mathbf u)\cdot\hat{\mathbf l}_i$
        and the FDOA changes by an amount $\Delta\nu_{BA}$,
        $$\Delta\nu_{BA} = \frac{1}{\lambda}\,\mathbf u\cdot\big(\hat{\mathbf l}_B - \hat{\mathbf l}_A\big).$$
        Set an emitter speed with the slider in the figure. The dashed curve, which is where the processor now
        believes the emitter is, no longer passes through E; the readouts give the FDOA change and how far the curve
        moved at E. In the default geometry 5 m/s, a jogging pace, already moves it by more than a kilometre,
        because the collectors' own motion produces only a small difference in rotation rates and the emitter's
        motion competes with it directly. Part III and the lab treat moving emitters properly.</p>`),
    ));

    const plotB = mapPlot(hostB, {
      ariaLabel: 'Map with two moving collectors, a draggable emitter, and curves of constant FDOA.',
    });
    const onVel = () => { presetCtl.set('custom'); updateB(); };
    const A1 = addCollector(plotB, 'A', -40, 0, { onDrag: () => updateB() });
    const B1 = addCollector(plotB, 'B', 40, 0, { onDrag: () => updateB() });
    const VA1 = addVelocity(plotB, A1, 250, 0, { onDrag: onVel });
    const VB1 = addVelocity(plotB, B1, 250, 0, { onDrag: onVel });
    const E1 = addEmitter(plotB, 15, 60, { onDrag: () => updateB() });

    function applyPreset(name) {
      const p = PRESETS[name];
      if (!p) return;
      sB.preset = name;
      VA1.vx = p.A[0]; VA1.vy = p.A[1]; VB1.vx = p.B[0]; VB1.vy = p.B[1];
      updateB();
    }

    const colsB = () => [collectorOf(A1, VA1), collectorOf(B1, VB1)];
    let movingNu = null; // FDOA the processor measures when the emitter moves (Hz), or null

    plotB.onDraw = (g) => {
      const [cA, cB] = colsB(), f0 = sB.f0, lam = planar.C / f0, e = posM(E1);
      if (sB.heat) {
        const sf = fieldKm(g, (p) => {
          const gr = planar.gradFdoa(cB, cA, p, f0);
          const n = Math.hypot(gr[0], gr[1]);
          return n > 0 ? 1 / n : NaN;
        }, { nx: 130, ny: 100 });
        const rg = decadeRange(sf, { minDecades: 2 });
        g.heatmap(sf, { colormap: 'sequential', log: true, ...rg, alpha: 0.8 });
        g.colorbar({ colormap: 'sequential', log: true, ...rg, label: 'm per Hz' });
      }
      const ff = fieldKm(g, (p) => planar.fdoa(cB, cA, p, f0));
      const step = RR_STEP / lam;
      const vmax = (Math.hypot(cA.v[0], cA.v[1]) + Math.hypot(cB.v[0], cB.v[1])) / lam;
      const levels = [];
      for (let k = -Math.floor(vmax / step); k * step <= vmax; k++) levels.push(k * step);
      g.contour(ff, levels, { color: '--fdoa', ...STYLE.family });
      rangeLines(g, E1, [A1, B1]);
      g.contour(ff, [planar.fdoa(cB, cA, e, f0)], { color: '--fdoa', ...STYLE.bold });
      if (movingNu != null) g.contour(ff, [movingNu], { color: '--fdoa', width: 2.2, dash: [8, 5] });
      g.legend([
        { label: 'Same νBA as E', color: '--fdoa', width: 2.6 },
        { label: 'Every 25 m/s of range-rate difference', color: '--fdoa', width: 1 },
        ...(movingNu != null ? [{ label: 'Curve for the measured νBA (moving E)', color: '--fdoa', width: 2.2, dash: [8, 5] }] : []),
      ], { position: 'bottom-left' });
    };
    plotB.onHover = (x, y) => {
      const [cA, cB] = colsB();
      return `x ${x.toFixed(1)} km  y ${y.toFixed(1)} km\nνBA ${freqFmt(planar.fdoa(cB, cA, [x * KM, y * KM], sB.f0))}`;
    };

    /** Distance (m) along the curve normal at E to the static iso-FDOA curve of value nuT (Newton). */
    function shiftAlongNormal(cA, cB, e, f0, nuT) {
      const g0 = planar.gradFdoa(cB, cA, e, f0);
      const n0 = Math.hypot(g0[0], g0[1]);
      if (!(n0 > 0)) return NaN;
      const ux = g0[0] / n0, uy = g0[1] / n0;
      let s = (nuT - planar.fdoa(cB, cA, e, f0)) / n0;
      for (let it = 0; it < 30; it++) {
        const p = [e[0] + s * ux, e[1] + s * uy];
        const r = planar.fdoa(cB, cA, p, f0) - nuT;
        const gp = planar.gradFdoa(cB, cA, p, f0);
        const d = gp[0] * ux + gp[1] * uy;
        if (!(Math.abs(d) > 1e-12)) return NaN;
        const ds = r / d;
        s -= ds;
        if (Math.abs(ds) < 0.01) return Math.abs(s);
      }
      return NaN;
    }

    function updateB() {
      const [cA, cB] = colsB(), f0 = sB.f0, lam = planar.C / f0, e = posM(E1);
      const ok = planar.range(cA, e) > 0 && planar.range(cB, e) > 0;
      const nu = planar.fdoa(cB, cA, e, f0);
      const gr = planar.gradFdoa(cB, cA, e, f0);
      const n = Math.hypot(gr[0], gr[1]);
      roB.set({
        rdA: ok ? fixed(planar.rangeRate(cA, e), 1) : '—',
        rdB: ok ? fixed(planar.rangeRate(cB, e), 1) : '—',
        nu: ok ? freqFmt(nu) : '—',
        step: freqFmt(RR_STEP / lam),
        sens: ok && n > 0 ? fmtM(1 / n) : '—',
      });
      if (sB.u > 0 && ok) {
        const ve = [sB.u, 0];
        movingNu = planar.fdoa(cB, cA, e, f0, ve);
        const sh = shiftAlongNormal(cA, cB, e, f0, movingNu);
        roU.set({ dnu: freqFmt(movingNu - nu), shift: isFinite(sh) ? fmtM(sh) : 'off the map' });
      } else {
        movingNu = null;
        roU.set({ dnu: '0 Hz', shift: '0 m' });
      }
      plotB.requestRedraw();
    }
    updateB();
    cleanups.push(() => plotB.destroy());

    root.append(
      questionSet(QUESTIONS['fdoa-plane']),
      takeaways([
        'One moving collector sees a Doppler shift $\\frac{v}{\\lambda}\\cos\\alpha$ that depends only on the direction to the emitter, but the emitter\'s unknown frequency offset hides it; the difference between two collectors, the FDOA, cancels that offset.',
        'FDOA is a range-rate difference, $\\nu_{BA} = -\\frac{f_0}{c}(\\dot\\rho_B - \\dot\\rho_A)$, and its gradient is $\\frac1\\lambda$ times the difference of the two lines of sight\'s rotation rates, $\\mathbf v_\\perp/\\rho$.',
        'The curves depend on the collectors\' velocities, are not conic sections and can have several branches; their shape does not depend on $f_0$, but the hertz on them scale with $f_0$, so FDOA gets more precise at higher carriers.',
        'As an order of magnitude, 1 Hz of FDOA corresponds to $\\lambda\\rho^2/(v\\,d)$ metres: FDOA weakens with the square of range. With identical velocities and a distant emitter it fades to nothing.',
        'The standard model assumes a stationary emitter; emitter motion $\\mathbf u$ adds $\\frac1\\lambda\\mathbf u\\cdot(\\hat{\\mathbf l}_B-\\hat{\\mathbf l}_A)$, and metres per second of it can move the curve by kilometres.',
      ]),
      nextLesson(ctx, 'fusion-plane'),
    );

    return () => { for (const f of cleanups) f(); };
  },
};
