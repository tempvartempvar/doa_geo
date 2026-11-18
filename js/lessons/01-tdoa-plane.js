/**
 * 01-tdoa-plane.js - "TDOA: time differences draw hyperbolas".
 *
 * Section A: one pair (A, B), one TDOA, one hyperbola branch; how far a timing error moves the curve.
 * Section B: three collectors, two independent TDOAs, a fix; timing noise, CRLB ellipse and a
 * Monte-Carlo cloud of fixes (shown in a zoom inset around the emitter, where metres are visible).
 */
import { slider, toggle, readout, controlGroup, button, fmtSI } from '../ui/controls.js';
import { el, lessonHeader, section, figure, callout, takeaways, nextLesson } from '../ui/layout.js';
import { questionSet } from '../ui/quiz.js';
import { diagramSvg, diagramCaption } from '../ui/diagrams.js';
import QUESTIONS from './questions.js';
import { planar, linalg } from '../core/index.js';
import {
  KM, mapPlot, addCollector, addEmitter, collectorOf, posM, fieldKm, rangeLines, drawLines, drawGhost,
  drawFixes, mahal2, solutionsInView, ZoomInset, insetHalfWidth, STYLE, fixed, fmtM,
} from './_plane.js';
import { contourLines } from '../ui/plot2d.js';

const TAU_STEP = 25e-6; // spacing of the faint iso-TDOA family, s
const SENS_MIN = 0.1, SENS_MAX = 10; // colour range of the m-per-ns map

export default {
  id: 'tdoa-plane',
  title: 'TDOA: time differences draw hyperbolas',

  mount(root, ctx) {
    const cleanups = [];

    // ============================================================ header
    root.append(
      lessonHeader({
        kicker: 'Part I · Lesson 1',
        title: 'TDOA: time differences draw hyperbolas',
        lede: 'One time difference puts the emitter somewhere on a curve. After this lesson you can look at a layout of collectors and say where a timing error hurts and where it hardly matters.',
      }),
      callout('caution', 'An idealised world', String.raw`<p>Part I uses a flat plane, straight-line
        propagation at exactly $c$ (the speed of light), first-order Doppler and a stationary emitter unless stated otherwise. That is
        enough for the geometry, which is what these lessons are about. Part III
        (${'<a href="#/physics" data-nav="physics">Real physics</a>'}) puts back light-time, Earth rotation,
        relativity and the atmosphere.</p>`),
    );
    // make the inline link use the router
    root.querySelectorAll('a[data-nav]').forEach((a) => a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault(); ctx.navigate(a.dataset.nav);
    }));

    // ============================================================ section A
    const stateA = { heat: false };
    const hostA = el('div');
    const roA = readout([
      { key: 'rhoA', label: '$\\rho_A$', unit: 'km', hint: 'Range from E to A' },
      { key: 'rhoB', label: '$\\rho_B$', unit: 'km', hint: 'Range from E to B' },
      { key: 'drho', label: '$\\rho_B-\\rho_A$', unit: 'km' },
      { key: 'tau', label: '$\\tau_{BA}$', unit: 'µs' },
      { key: 'theta', label: 'Angle $\\theta$ at E', unit: '°', hint: 'Angle the pair A-B subtends at the emitter' },
      { key: 'sens', label: '1 ns moves the curve by', unit: '', hint: '1 ns / |grad tau|, measured along the normal to the curve at E' },
    ]);
    const heatCtl = toggle({
      label: 'Map: metres of curve shift per ns', value: stateA.heat,
      hint: 'How far a 1 ns TDOA error moves the curve through each point (log colour scale).',
      onChange: (v) => { stateA.heat = v; plotA.requestRedraw(); },
    });

    root.append(section('One pair, one curve',
      String.raw`<p>Two collectors A and B record the same signal. Neither knows when it was sent, but the
      difference of the arrival times, $\tau_{BA} = t_B - t_A$ (B's arrival time minus A's), does not depend on
      that. Because the signal
      travels at $c$, $\tau_{BA}$ is a <strong>range difference</strong> in disguise:
      $c\,\tau_{BA} = \rho_B - \rho_A$, where the <strong>range</strong> $\rho_i$ is the distance from the emitter E
      to collector $i$.</p>
      <p>Drag E, A or B. The bold violet curve is every position that would give the same $\tau_{BA}$ as E does;
      the faint curves are the same construction for other values, every 25 µs.</p>`,
      figure({
        plot: hostA,
        controls: [controlGroup('Measurement', [roA]), controlGroup('Background', [heatCtl])],
        caption: String.raw`Iso-TDOA curves: curves of equal $\tau_{BA}$ (faint: every 25 µs; bold: through E).
        Dashed lines are the lines of sight, the straight lines from E to each collector. $\theta$ is the angle
        between them. The last readout is how far the bold curve moves, at E, if the measured
        $\tau_{BA}$ is wrong by 1 ns. Click the map and scroll to zoom, drag the background to pan, double-click to reset.`,
      }),
      callout('math', 'Why a hyperbola, and how far it moves', String.raw`
        <p>The set of points whose distances to two fixed points differ by a constant,
        $\rho_B - \rho_A = c\,\tau_{BA}$, is one branch of a <strong>hyperbola</strong>. The two fixed points, here
        A and B, are its foci.</p>
        <p>The straight line joining the two collectors is called their <strong>baseline</strong>, and $d$ is its
        length: the distance from A to B, $d = \lVert\mathbf r_B - \mathbf r_A\rVert$ (80 km in the default view;
        $\mathbf r_A$ and $\mathbf r_B$ are the collectors' positions, and double bars mean the length of a vector).
        E, A and B are the corners of a triangle with sides $\rho_A$, $\rho_B$ and $d$. No side of a triangle is longer
        than the other two together, so $\rho_B \le \rho_A + d$ and $\rho_A \le \rho_B + d$: the two ranges can never
        differ by more than the collectors' own separation. Hence $\lvert\rho_B-\rho_A\rvert \le d$ and
        $$\lvert\tau_{BA}\rvert \le d/c .$$</p>
        <p>How far does the curve move if the measurement is a little wrong? That depends on how quickly
        $\tau_{BA}$ changes as the emitter moves, which is its <strong>gradient</strong>. Here, and everywhere in
        this course, $\nabla$ is the gradient with respect to the <em>emitter's position</em>, with the collectors
        held where they are: $\nabla\tau_{BA} = (\partial\tau_{BA}/\partial x,\ \partial\tau_{BA}/\partial y)$. It is
        a vector that points in the direction in which moving the emitter raises $\tau_{BA}$ fastest, and its length
        is that rate, in seconds per metre.</p>
        <p>Let $\hat{\mathbf l}_i$ be the <strong>unit vector</strong> from the emitter to collector $i$: an arrow of
        length 1 along the line of sight, which carries a direction and nothing else. Moving the emitter a
        small step towards collector $i$ shortens $\rho_i$ by that step, so $\nabla\rho_i = -\hat{\mathbf l}_i$ and
        $$\nabla\tau_{BA} = \frac{\hat{\mathbf l}_A - \hat{\mathbf l}_B}{c},\qquad
        \lVert\nabla\tau_{BA}\rVert = \frac{2}{c}\sin\frac{\theta}{2},$$
        where $\theta$ is the angle between the two lines of sight (the angle the pair subtends at E). The gradient
        is normal to the curve (at right angles to it), because along the curve $\tau_{BA}$ does not change at all.
        Now let $\delta\tau$ be a small timing error: the measured $\tau_{BA}$ minus the true one. It moves the
        curve sideways, along its normal, by a distance $\delta n$:
        $$\delta n = \frac{\delta\tau}{\lVert\nabla\tau\rVert} = \frac{c\,\delta\tau}{2\sin(\theta/2)} .$$</p>
        ${diagramSvg('gradient')}
        <p class="figure-caption">${diagramCaption('gradient')}</p>
        <p>At best ($\theta = 180^\circ$, E between the collectors) this is $c\,\delta\tau/2$: 0.15 m per ns.</p>
        <p><strong>Far away</strong>, when the emitter is much farther off than the baseline is long, two things
        simplify. First, the two ranges $\rho_A$ and $\rho_B$ are nearly equal, so we stop telling them apart and
        write a single $\rho$ with no subscript: the distance from the emitter to the pair (to the middle of the
        baseline, say). Second, $\theta$ is a small angle, and a small angle is just how wide something looks
        divided by how far away it is. How wide the pair looks from the emitter is $d_\perp$: the part of the
        baseline that lies <em>across</em> the line of sight. If the line of sight makes an angle $\varphi$ with the
        baseline, $d_\perp = d\,\sin\varphi$. That is the full $d$ when the emitter is broadside to the pair, and
        zero when it is on the extension of the baseline, where the pair is seen end-on.</p>
        <svg viewBox="0 0 400 330" role="img" style="display:block;width:100%;max-width:420px;height:auto;margin:0.6em auto 0.2em"
          aria-label="Collectors A and B joined by the baseline d, an emitter E at distance rho from its midpoint, the angle theta that the pair subtends at E, and d-perpendicular, the baseline projected across the line of sight.">
          <g fill="none" stroke-linecap="round">
            <path d="M332.8 30.2 L60 260 M332.8 30.2 L220 260" stroke="var(--muted)" stroke-width="1.2" stroke-dasharray="5 4"/>
            <path d="M60 260 L93.05 220.6 M220 260 L186.95 299.4" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3"/>
            <path d="M332.8 30.2 L140 260" stroke="var(--text-2)" stroke-width="1.4"/>
            <path d="M60 260 L220 260" stroke="var(--text)" stroke-width="2"/>
            <path d="M93.05 220.6 L186.95 299.4" stroke="var(--tdoa)" stroke-width="3.2"/>
            <path d="M146.4 252.3 L138.8 245.9 L132.3 253.6" stroke="var(--muted)" stroke-width="1"/>
            <path d="M297.6 59.8 A46 46 0 0 0 312.5 71.5" stroke="var(--text-2)" stroke-width="1.3"/>
            <path d="M166 260 A26 26 0 0 0 156.7 240.1" stroke="var(--text-2)" stroke-width="1.3"/>
          </g>
          <polygon points="60,250 69,266 51,266" fill="var(--collector-a)"/>
          <polygon points="220,250 229,266 211,266" fill="var(--collector-b)"/>
          <polygon points="332.8,21 341,30.2 332.8,39.4 324.6,30.2" fill="var(--emitter)"/>
          <g fill="var(--text)" font-size="15">
            <text x="36" y="266">A</text>
            <text x="236" y="266">B</text>
            <text x="347" y="27">E</text>
            <text x="98" y="280" font-style="italic">d</text>
            <text x="250" y="150" font-style="italic">ρ</text>
            <text x="274" y="56" font-style="italic">θ</text>
            <text x="172" y="250" font-style="italic">φ</text>
            <text x="128" y="304" font-style="italic" fill="var(--tdoa)">d<tspan dy="4" font-size="11" font-style="normal">⊥</tspan></text>
          </g>
        </svg>
        <p class="figure-caption">Seen from E, the pair looks $d_\perp$ wide at a distance $\rho$, so it subtends
        $\theta \approx d_\perp/\rho$. Not to scale: the approximation is for $\rho$ much larger than $d$.</p>
        <p>So $\theta \approx d_\perp/\rho$ (in radians), and because $2\sin(\theta/2) \approx \theta$ for a small angle,
        $$\delta n \approx \frac{c\,\delta\tau}{\theta} \approx c\,\delta\tau\,\frac{\rho}{d_\perp}.$$
        For example, take $d = 80$ km and an emitter 400 km away, in a direction 60° from the baseline. Then
        $d_\perp = 80\sin 60^\circ = 69$ km, $\theta \approx 69/400 = 0.17$ rad (about 10°), and a 1 ns error moves
        the curve by $0.30\times400/69 = 1.7$ m. The ratio "range over baseline" is the lever arm of every TDOA
        system.</p>`),
      callout('try', 'Four experiments', String.raw`<ol>
        <li><strong>Perpendicular bisector.</strong> Drag E to $x = 0$ (with the default collectors). $\tau_{BA}$ reads
        0 and the bold curve is a straight line: equal ranges to A and B.</li>
        <li><strong>Out along the bisector.</strong> Keep $x = 0$ and drag E north. The faint curves fan apart and the
        last readout grows in proportion to range; on the bisector it equals $c\cdot 1\,\text{ns}\cdot\rho_A/d$
        exactly, where $\rho_A = \rho_B$ is the range to either collector
        (try $y = 100$ km: $\rho_A = 107.7$ km, so $0.2998 \times 107.7/80 = 0.40$ m).</li>
        <li><strong>On the pair's own axis.</strong> Drag E onto the line through A and B, beyond B. B is now closer
        by exactly $d$, so $t_B < t_A$ and $\tau_{BA}$ sits at its extreme, $-d/c$ ($-266.9$ µs for 80 km). The
        hyperbola collapses onto the ray from B outward, $\hat{\mathbf l}_A = \hat{\mathbf l}_B$, the gradient vanishes
        and the shift per nanosecond grows without bound. A pair cannot see along its own axis. (Beyond A the extreme
        is $+d/c$.)</li>
        <li><strong>Shorter baseline.</strong> Drag A and B towards each other. Fewer faint curves fit
        (because $\lvert\tau\rvert \le d/c$), and at a fixed emitter the metres-per-nanosecond readout grows roughly
        as $1/d$. Switch on the map to see the whole picture at once.</li>
      </ol>`),
    ));

    const plotA = mapPlot(hostA, {
      ariaLabel: 'Map with collectors A and B, a draggable emitter, and curves of constant TDOA.',
    });
    const A1 = addCollector(plotA, 'A', -40, 0, { onDrag: () => updateA() });
    const B1 = addCollector(plotA, 'B', 40, 0, { onDrag: () => updateA() });
    const E1 = addEmitter(plotA, 15, 60, { onDrag: () => updateA() });

    const sensAt = (cA, cB, e) => {
      const g = planar.gradTdoa(cB, cA, e);
      const n = Math.hypot(g[0], g[1]);
      return n > 0 ? 1e-9 / n : Infinity;
    };

    plotA.onDraw = (g) => {
      const cA = collectorOf(A1), cB = collectorOf(B1), e = posM(E1);
      if (stateA.heat) {
        const sf = fieldKm(g, (p) => { const v = sensAt(cA, cB, p); return isFinite(v) ? v : NaN; }, { nx: 130, ny: 100 });
        g.heatmap(sf, { colormap: 'sequential', log: true, min: SENS_MIN, max: SENS_MAX, alpha: 0.8 });
        g.colorbar({ colormap: 'sequential', log: true, min: SENS_MIN, max: SENS_MAX, label: 'm per ns' });
      }
      const tf = fieldKm(g, (p) => planar.tdoa(cB, cA, p));
      const dMax = Math.hypot(B1.x - A1.x, B1.y - A1.y) * KM / planar.C;
      const levels = [];
      for (let k = -Math.floor(dMax / TAU_STEP); k * TAU_STEP <= dMax; k++) levels.push(k * TAU_STEP);
      g.contour(tf, levels, { color: '--tdoa', ...STYLE.family });
      rangeLines(g, E1, [A1, B1]);
      const tauE = planar.tdoa(cB, cA, e);
      g.contour(tf, [tauE], { color: '--tdoa', ...STYLE.bold });
      g.legend([
        { label: 'Same τBA as E', color: '--tdoa', width: 2.6 },
        { label: 'Every 25 µs', color: '--tdoa', width: 1 },
      ], { position: 'bottom-left' });
    };
    plotA.onHover = (x, y) => {
      const cA = collectorOf(A1), cB = collectorOf(B1), p = [x * KM, y * KM];
      const s = sensAt(cA, cB, p);
      return `x ${x.toFixed(1)} km  y ${y.toFixed(1)} km\nτBA ${fixed(planar.tdoa(cB, cA, p) * 1e6, 2)} µs\n1 ns → ${isFinite(s) ? fmtM(s) : '∞'}`;
    };

    function updateA() {
      const cA = collectorOf(A1), cB = collectorOf(B1), e = posM(E1);
      const rA = planar.range(cA, e), rB = planar.range(cB, e);
      const g = planar.gradTdoa(cB, cA, e);
      const lA = [(cA.p[0] - e[0]) / rA, (cA.p[1] - e[1]) / rA], lB = [(cB.p[0] - e[0]) / rB, (cB.p[1] - e[1]) / rB];
      const theta = Math.acos(Math.max(-1, Math.min(1, lA[0] * lB[0] + lA[1] * lB[1]))) * 180 / Math.PI;
      const n = Math.hypot(g[0], g[1]);
      const sens = n > 0 ? 1e-9 / n : Infinity;
      roA.set({
        rhoA: fixed(rA / KM, 2), rhoB: fixed(rB / KM, 2), drho: fixed((rB - rA) / KM, 2),
        tau: fixed(planar.tdoa(cB, cA, e) * 1e6, 3),
        theta: isFinite(theta) ? theta.toFixed(1) : '—',
        sens: rA > 0 && rB > 0 ? (sens < 1e7 ? fmtM(sens) : 'unbounded') : '—',
      });
      plotA.requestRedraw();
    }
    updateA();
    cleanups.push(() => plotA.destroy());

    // ============================================================ section B
    const stateB = { sigmaT: 50e-9, showCB: false, fixes: [], inside: 0 };
    const measT = planar.measurementList(3, { fdoa: false }); // tau_BA, tau_CA
    const rng = linalg.makeRng(20241);
    let precB = null;

    const hostB = el('div');
    const hostZ = el('div');
    const sigmaCtl = slider({
      label: 'Per-collector timing error $\\sigma_T$', min: 1e-9, max: 1e-6, value: stateB.sigmaT, log: true,
      format: (v) => fmtSI(v, 's'),
      hint: 'Each TDOA then has $\\sigma_\\tau = \\sqrt2\\,\\sigma_T$.',
      onInput: (v) => { stateB.sigmaT = v; clearFixes(); updateB(); },
    });
    const cbCtl = toggle({
      label: 'Show the third pair, $\\tau_{CB}$', value: false,
      onChange: (v) => { stateB.showCB = v; plotB.requestRedraw(); zoom.plot.requestRedraw(); },
    });
    const btnOne = button({ label: 'Take a measurement', kind: 'primary', onClick: () => takeFixes(1) });
    const btnMany = button({ label: '×100', onClick: () => takeFixes(100) });
    const btnClear = button({ label: 'Clear', kind: 'ghost', onClick: () => { clearFixes(); updateB(); } });
    const roB = readout([
      { key: 'tBA', label: '$\\tau_{BA}$', unit: 'µs' },
      { key: 'tCA', label: '$\\tau_{CA}$', unit: 'µs' },
      { key: 'sTau', label: '$\\sigma_\\tau$ per TDOA', unit: '', hint: 'Standard deviation of one TDOA' },
      { key: 'a', label: '95 % ellipse, semi-major', unit: '', hint: 'Half the length of the ellipse' },
      { key: 'b', label: '95 % ellipse, semi-minor', unit: '', hint: 'Half its width' },
      { key: 'drms', label: 'DRMS', unit: '', hint: 'Root-mean-square miss distance' },
      { key: 'n', label: 'Fixes taken', unit: '' },
      { key: 'inside', label: 'Inside the 95 % ellipse', unit: '' },
    ]);
    const statusB = el('p', 'tp-status');

    root.append(section('Three collectors, a fix',
      String.raw`<p>One TDOA leaves a whole curve. Add a third collector C and form a second TDOA,
      $\tau_{CA}$: its hyperbola crosses the first one at the emitter. Two independent measurements, two
      unknowns (the emitter's east and north coordinates $x$ and $y$), one point. A position estimated this way
      is called a <strong>fix</strong>.</p>
      <p>The upper map is the geometry; the lower panel zooms in on E so that you can see what timing noise does.
      There each TDOA becomes a band, and a "Take a measurement" press simulates noisy arrival times at all three
      collectors and solves for the position. The ellipse is the 95 % <strong>error ellipse</strong> given by the
      Cramér–Rao bound: the smallest region that any estimator whose errors average to zero can promise will
      contain 95 % of the fixes.</p>`,
      figure({
        plot: [hostB, hostZ],
        controls: [
          controlGroup('Measurements', [roB, statusB]),
          controlGroup('Noise', [sigmaCtl]),
          controlGroup('Simulate', [el('div', 'tp-buttons', btnOne.el, btnMany.el, btnClear.el)]),
          controlGroup('Display', [cbCtl]),
        ],
        caption: String.raw`Upper: hyperbolas of $\tau_{BA}$ (solid) and $\tau_{CA}$ (dashed) through E; a ringed
        marker labelled "ghost" is a second point that fits both TDOAs exactly. Lower: the same curves near E,
        their $\pm1\sigma$ bands (where each curve could lie for a timing error of one standard deviation), the
        95 % error ellipse and the simulated fixes (dots). The zoom rescales itself to
        the ellipse; read the scale off its axes. Fixes are cleared whenever the geometry or the noise changes.`,
      }),
      callout('math', 'Counting measurements, and the noise model', String.raw`
        <p>Three collectors form three pairs, but
        $$\tau_{CB} = \frac{\rho_C - \rho_B}{c} = \frac{\rho_C-\rho_A}{c} - \frac{\rho_B-\rho_A}{c} = \tau_{CA} - \tau_{BA},$$
        so the third hyperbola always passes through the same intersection and adds nothing: <strong>$N$ collectors
        give $N-1$ independent TDOAs</strong>. Toggle $\tau_{CB}$ to see it go through the fix.</p>
        <p>Noise is specified per collector: each arrival time is off by an independent random error whose
        standard deviation (typical size) is $\sigma_T$. A TDOA is a difference of two arrival times, so its
        standard deviation is $\sigma_\tau = \sqrt2\,\sigma_T$, and
        $\tau_{BA}$ and $\tau_{CA}$ are correlated (correlation $\tfrac12$) because both contain A's error. The
        bands in the zoom have half-width $\sigma_\tau$ in TDOA, which is $\sigma_\tau/\lVert\nabla\tau\rVert$ in
        metres. The ellipse comes from the full calculation with the correlation included; Part II explains it.</p>`),
      callout('try', 'Where is TDOA good?', String.raw`<ul>
        <li><strong>Inside the triangle</strong> (try E at about (0, −15) km): the lines of sight point in very
        different directions, both bands are narrow and cross steeply, and the ellipse is compact and nearly round.</li>
        <li><strong>Far outside</strong> (drag E to the top corners): the ellipse stretches along the line of sight
        towards the collectors. Seen from far away all three collectors lie in a narrow cone, so the bearing (the
        direction to the emitter) is well determined but the range is not.</li>
        <li><strong>Collectors nearly in a line</strong> (drag C up onto the A–B line, to within about a kilometre):
        the ellipse at E hardly changes, but a ghost appears near the mirror image of E across that line. With
        exactly collinear collectors the mirror image gives identical TDOAs, and nothing in the measurements can tell
        them apart. Lift C off the line and the ghost slides away south, out of the view.</li>
        <li><strong>On a baseline extension</strong> (drag E onto the line through A and B, beyond B): that pair is
        blind there, as in the first figure, so only one useful direction is left and the ellipse becomes enormously
        long. Exactly on the line the bound is infinite and the panel says that no fix is possible. Just off the line
        a ghost usually sits close beside E, because the $\tau_{BA}$ hyperbola has folded into a narrow hairpin
        around the axis that the $\tau_{CA}$ curve crosses twice.</li>
        <li><strong>Noise.</strong> Move $\sigma_T$: every length in the zoom scales in proportion, while the shape
        of the ellipse is set by geometry alone. At large $\sigma_T$ in poor geometry the fraction of fixes inside
        the ellipse can drop below 95 %: the curves are no longer straight across the ellipse and the linear
        theory behind it starts to fail.</li>
      </ul>`),
    ));

    const plotB = mapPlot(hostB, {
      height: 430,
      ariaLabel: 'Map with three collectors, a draggable emitter and the two TDOA hyperbolas through it.',
    });
    const zoom = new ZoomInset(hostZ, { height: 320, ariaLabel: 'Zoom around the emitter: TDOA bands, error ellipse and simulated fixes.' });
    const onGeom = () => { clearFixes(); updateB(); };
    const A2 = addCollector(plotB, 'A', -40, 0, { onDrag: onGeom });
    const B2 = addCollector(plotB, 'B', 40, 0, { onDrag: onGeom });
    const C2 = addCollector(plotB, 'C', 0, -50, { onDrag: onGeom });
    const E2 = addEmitter(plotB, 15, 60, { onDrag: onGeom });

    const colsB = () => [collectorOf(A2), collectorOf(B2), collectorOf(C2)];
    const noiseB = () => ({ sigmaT: stateB.sigmaT, sigmaF: 0 });
    const DASH_CA = [9, 5], DASH_CB = [2, 4];

    plotB.onDraw = (g) => {
      const cols = colsB(), e = posM(E2);
      const sT = Math.SQRT2 * stateB.sigmaT;
      const fBA = fieldKm(g, (p) => planar.tdoa(cols[1], cols[0], p));
      const fCA = fieldKm(g, (p) => planar.tdoa(cols[2], cols[0], p));
      const tBA = planar.tdoa(cols[1], cols[0], e), tCA = planar.tdoa(cols[2], cols[0], e);
      g.contourBand(fBA, tBA - sT, tBA + sT, { fill: '--tdoa', ...STYLE.band });
      g.contourBand(fCA, tCA - sT, tCA + sT, { fill: '--tdoa', ...STYLE.band });
      rangeLines(g, E2, [A2, B2, C2]);
      const lBA = contourLines(fBA, tBA), lCA = contourLines(fCA, tCA);
      drawLines(g, lBA, { color: '--tdoa', ...STYLE.bold });
      drawLines(g, lCA, { color: '--tdoa', ...STYLE.bold, width: 2.2, dash: DASH_CA });
      if (stateB.showCB) {
        const fCB = fieldKm(g, (p) => planar.tdoa(cols[2], cols[1], p), { nx: 120, ny: 90 });
        g.contour(fCB, [planar.tdoa(cols[2], cols[1], e)], { color: '--tdoa', width: 2, dash: DASH_CB });
      }
      if (precB) {
        const el2 = precB.ellipse;
        g.ellipse(E2.x, E2.y, el2.semiMajor / KM, el2.semiMinor / KM, el2.angle, { color: '--estimate', width: 1.5 });
      }
      drawFixes(g, stateB.fixes.map((p) => [p[0] / KM, p[1] / KM]));
      // ghosts: other points that reproduce both TDOAs
      const z = [tBA, tCA];
      const sols = solutionsInView({
        fieldA: fBA, levelA: tBA, fieldB: fCA, levelB: tCA, meas: measT, collectors: cols, z, f0: 1e9,
        noise: noiseB(), eKm: [E2.x, E2.y], view: g.view,
      });
      for (const s of sols) if (!s.isTrue) drawGhost(g, s.x, s.y);
      g.legend([
        { label: 'τBA', color: '--tdoa', width: 2.6 },
        { label: 'τCA', color: '--tdoa', width: 2.2, dash: DASH_CA },
        ...(stateB.showCB ? [{ label: 'τCB (redundant)', color: '--tdoa', width: 2, dash: DASH_CB }] : []),
      ], { position: 'bottom-left' });
    };
    plotB.onHover = (x, y) => {
      const cols = colsB(), p = [x * KM, y * KM];
      return `x ${x.toFixed(1)} km  y ${y.toFixed(1)} km\nτBA ${fixed(planar.tdoa(cols[1], cols[0], p) * 1e6, 2)} µs\nτCA ${fixed(planar.tdoa(cols[2], cols[0], p) * 1e6, 2)} µs`;
    };

    zoom.plot.onDraw = (g) => {
      const cols = colsB(), e = posM(E2);
      if (!precB) {
        g.text(0, 0, 'No fix possible with these measurements', { align: 'center', size: 13, color: '--plot-text-strong' });
        return;
      }
      const sT = Math.SQRT2 * stateB.sigmaT;
      const tBA = planar.tdoa(cols[1], cols[0], e), tCA = planar.tdoa(cols[2], cols[0], e);
      const fBA = zoom.field(g, (p) => planar.tdoa(cols[1], cols[0], p));
      const fCA = zoom.field(g, (p) => planar.tdoa(cols[2], cols[0], p));
      // directions to the collectors
      const v = g.view, R = Math.hypot(v.xmax - v.xmin, v.ymax - v.ymin);
      for (const h of [A2, B2, C2]) {
        const dx = h.x * KM - e[0], dy = h.y * KM - e[1], r = Math.hypot(dx, dy);
        if (r > 0) g.segment(0, 0, dx / r * R, dy / r * R, { ...STYLE.range, color: h.color, alpha: 0.5 });
      }
      g.contourBand(fBA, tBA - sT, tBA + sT, { fill: '--tdoa', ...STYLE.band });
      g.contourBand(fCA, tCA - sT, tCA + sT, { fill: '--tdoa', ...STYLE.band });
      g.contour(fBA, [tBA], { color: '--tdoa', width: 2 });
      g.contour(fCA, [tCA], { color: '--tdoa', width: 2, dash: DASH_CA });
      if (stateB.showCB) {
        const fCB = zoom.field(g, (p) => planar.tdoa(cols[2], cols[1], p));
        g.contour(fCB, [planar.tdoa(cols[2], cols[1], e)], { color: '--tdoa', width: 2, dash: DASH_CB });
      }
      zoom.ellipse(g, precB.ellipse, { color: '--estimate', width: 1.8 });
      drawFixes(g, stateB.fixes.map((p) => zoom.local(p[0], p[1])));
      g.marker(0, 0, 'diamond', 6, { color: '--emitter' });
      g.legend([
        { label: '±1σ band', fill: '--tdoa', fillAlpha: 0.3 },
        { label: '95 % ellipse', color: '--estimate', width: 1.8 },
        ...(stateB.fixes.length ? [{ label: 'Fixes', marker: 'circle', color: '--estimate' }] : []),
      ], { position: 'top-left' });
    };

    function clearFixes() { stateB.fixes = []; stateB.inside = 0; }

    function takeFixes(n) {
      if (!precB) return;
      const cols = colsB(), e = posM(E2), noise = noiseB();
      const k2 = precB.ellipse.k * precB.ellipse.k;
      for (let t = 0; t < n; t++) {
        const z = planar.simulate({ meas: measT, collectors: cols, e, f0: 1e9, noise, rng });
        let res;
        try { res = planar.locate({ meas: measT, collectors: cols, z, f0: 1e9, noise, x0: e, maxIter: 30 }); } catch { continue; }
        if (!isFinite(res.x[0]) || !isFinite(res.x[1])) continue;
        stateB.fixes.push(res.x);
        if (mahal2(precB.P, res.x[0] - e[0], res.x[1] - e[1]) <= k2) stateB.inside++;
      }
      if (stateB.fixes.length > 5000) {
        // keep memory bounded; recount
        stateB.fixes = stateB.fixes.slice(-5000);
        stateB.inside = stateB.fixes.filter((p) => mahal2(precB.P, p[0] - e[0], p[1] - e[1]) <= k2).length;
      }
      updateB();
    }

    function updateB() {
      const cols = colsB(), e = posM(E2);
      precB = planar.precision(measT, cols, e, 1e9, noiseB());
      const nF = stateB.fixes.length;
      roB.set({
        tBA: fixed(planar.tdoa(cols[1], cols[0], e) * 1e6, 3),
        tCA: fixed(planar.tdoa(cols[2], cols[0], e) * 1e6, 3),
        sTau: fmtSI(Math.SQRT2 * stateB.sigmaT, 's'),
        a: precB ? fmtM(precB.ellipse.semiMajor) : '—',
        b: precB ? fmtM(precB.ellipse.semiMinor) : '—',
        drms: precB ? fmtM(precB.drms) : '—',
        n: String(nF),
        inside: nF ? `${(100 * stateB.inside / nF).toFixed(1)} %` : '—',
      });
      statusB.textContent = precB ? '' : 'No fix possible with these measurements: here the two TDOAs change in the same direction only, so one direction is unobservable.';
      btnOne.setDisabled(!precB); btnMany.setDisabled(!precB);
      zoom.setFrame(e[0], e[1], insetHalfWidth(precB && precB.ellipse));
      plotB.requestRedraw();
      zoom.plot.requestRedraw();
    }
    updateB();
    cleanups.push(() => { plotB.destroy(); zoom.destroy(); });

    // ============================================================ wrap-up
    root.append(
      questionSet(QUESTIONS['tdoa-plane']),
      takeaways([
        'A TDOA is a range difference, $c\\,\\tau_{BA} = \\rho_B - \\rho_A$, and confines the emitter to one branch of a hyperbola whose foci are the two collectors; $\\lvert\\tau_{BA}\\rvert \\le d/c$.',
        'A timing error $\\delta\\tau$ moves that curve by $c\\,\\delta\\tau / (2\\sin(\\theta/2))$, where $\\theta$ is the angle the pair subtends at the emitter: 0.15 m per ns at best, unbounded along the pair\'s own axis.',
        'Far from the collectors the shift grows like $c\\,\\delta\\tau\\,\\rho/d_\\perp$: range over projected baseline is the lever arm of TDOA.',
        '$N$ collectors give $N-1$ independent TDOAs; any other pair is a difference of those.',
        'Three collectors fix a position in the plane, but the accuracy depends on direction: far away, bearing is good and range is poor, and near a baseline extension the fix degrades sharply.',
      ]),
      nextLesson(ctx, 'fdoa-plane'),
    );

    // lesson-scoped styles
    const style = document.createElement('style');
    style.textContent = `
      .tp-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
      .tp-status { margin: 0; font-size: 13px; color: var(--critical); }
      .tp-status:empty { display: none; }
    `;
    document.head.append(style);
    cleanups.push(() => style.remove());

    return () => { for (const f of cleanups) f(); };
  },
};
