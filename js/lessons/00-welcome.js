/**
 * 00-welcome.js - "Start here".
 *
 * This file is also the reference exemplar for lesson authors. The pattern:
 *   1. Keep lesson state in one plain object (`state`).
 *   2. Build the page top-down with layout helpers (lessonHeader, section, figure,
 *      callout, takeaways, nextLesson). Write explanatory text as HTML strings with
 *      $inline$ / $$display$$ math. String.raw`...` saves doubling every backslash.
 *   3. Create plots AFTER their host element exists; put all drawing in plot.onDraw
 *      and call plot.requestRedraw() whenever state changes.
 *   4. Wire controls: each control's callback updates `state`, then calls update().
 *   5. Return a cleanup function that destroys every plot and removes anything
 *      global (timers, rAF, window/document listeners).
 */
import { Plot2D, niceTicks } from '../ui/plot2d.js';
import { slider, toggle, readout, controlGroup, dataTable, fmt } from '../ui/controls.js';
import { el, lessonHeader, section, figure, callout, takeaways, nextLesson, lessonLink } from '../ui/layout.js';
import { questionSet } from '../ui/quiz.js';
import { diagram } from '../ui/diagrams.js';
import QUESTIONS from './questions.js';
import { lessons, parts } from './registry.js';

const C_KM_S = 299792.458; // speed of light, km/s

/** One-line summaries for the road map, keyed by lesson id. */
const ROADMAP = {
  welcome: 'The problem, the notation and the two rules of thumb (this page).',
  'tdoa-plane': 'One time difference confines the emitter to one branch of a hyperbola; timing noise widens it into a band.',
  'fdoa-plane': 'Moving collectors see different Doppler shifts. A frequency difference draws a second, quite different family of curves.',
  'fusion-plane': 'With two moving collectors the TDOA curve and the FDOA curve cross: a position fix from a single pair.',
  dop: 'How measurement noise maps into an error ellipse, and why some geometries amplify it enormously.',
  'error-budget': 'Turn nanoseconds and hertz into kilometres for realistic geometries and see which error term dominates.',
  caf: 'How TDOA and FDOA are actually measured: correlate the two recordings over delay and Doppler.',
  'orbit-3d': 'In 3-D each measurement is a surface. Count what 2, 3 and 4 satellites can locate, with and without the Earth.',
  physics: 'Light-time, Earth rotation (Sagnac), relativistic clock effects and atmospheric delay: the corrections that matter at the nanosecond level.',
  lab: 'Fly four satellites, collect, solve, and compare the fix with its predicted error ellipse.',
};

export default {
  id: 'welcome',
  title: 'Start here',

  mount(root, ctx) {
    // ------------------------------------------------------------ state
    const state = {
      baseline: 80,        // km between A and B
      showFamily: true,    // draw the faint family of TDOA curves
    };

    // ------------------------------------------------------------ page
    root.append(
      lessonHeader({
        kicker: 'Part I \u00b7 Lesson 0',
        title: 'Start here',
        lede: 'How do you find a radio transmitter that is not cooperating with you? You listen to it from several places at once and compare what you hear. This course builds that idea from flat-plane geometry up to satellites in orbit.',
      }),

      section('The problem: passive geolocation', String.raw`
        <p>A <strong>passive</strong> geolocation system never transmits. Its receivers, which we call
        <strong>collectors</strong>, simply record an emitter's signal. That is the whole difficulty: the
        emitter does not tell you <em>when</em> it sent the signal, and you do not know its <em>exact</em>
        transmit frequency either.</p>
        <p>If you knew the transmit time $t_0$, each collector could convert its time of arrival $t_i$ into a
        <strong>range</strong> (its distance to the emitter), $\rho_i = c\,(t_i - t_0)$, where $c$ is the speed of
        light, and a few ranges would pin the emitter down. If you knew the transmit
        frequency $f_0$, each collector could convert its received frequency $f_i$ into a range rate (how fast its
        distance to the emitter is changing). You know
        neither, so absolute time-of-flight and absolute Doppler are unavailable.</p>
        <p>The way out is to <strong>compare two collectors</strong>. Both arrival times contain the same
        unknown $t_0$, so their difference does not; both received frequencies are offsets from the same
        unknown $f_0$, so their difference cancels it:</p>
        $$t_i - t_j = \Big(t_0 + \tfrac{\rho_i}{c}\Big) - \Big(t_0 + \tfrac{\rho_j}{c}\Big) = \frac{\rho_i - \rho_j}{c}$$
        <p>That is <strong>TDOA</strong>, the time difference of arrival. Its frequency counterpart is
        <strong>FDOA</strong>, the frequency difference of arrival. ($f_0$ still appears in FDOA as a scale
        factor, but the received carrier tells you that to far better than one part in a million, which is
        plenty; what cancels is the unknown <em>offset</em>.)</p>
      `),
    );

    // ------------------------------------------------------------ figure
    const plotHost = el('div');
    const baselineCtl = slider({
      label: 'Baseline A\u2013B', min: 20, max: 160, step: 5, value: state.baseline, unit: 'km',
      format: (v) => v.toFixed(0),
      onInput: (v) => { state.baseline = v; placeCollectors(); update(); },
    });
    const familyCtl = toggle({
      label: 'Show other TDOA values', value: state.showFamily,
      hint: 'Faint curves at evenly spaced values of $\\tau_{BA}$.',
      onChange: (v) => { state.showFamily = v; update(); },
    });
    const values = readout([
      { key: 'rhoA', label: '$\\rho_A$', unit: 'km', hint: 'Range from emitter to A' },
      { key: 'rhoB', label: '$\\rho_B$', unit: 'km', hint: 'Range from emitter to B' },
      { key: 'drho', label: '$\\rho_B - \\rho_A$', unit: 'km' },
      { key: 'tauUs', label: '$\\tau_{BA}$', unit: '\u00b5s' },
      { key: 'tauNs', label: '', unit: 'ns' },
    ]);

    root.append(
      section('Try it: one time difference, one curve',
        `<p>Two collectors, A and B, sit on a flat plane. Drag the emitter E. The readout shows its ranges to A and
        B and the TDOA $\\tau_{BA} = t_B - t_A$ the collectors would measure.</p>`,
        figure({
          plot: plotHost,
          controls: [
            controlGroup('Measurement', [values]),
            controlGroup('Geometry', [baselineCtl, familyCtl]),
          ],
          caption: `The bold curve is every point with the same $\\tau_{BA}$ as the emitter. The collectors cannot tell
          these positions apart from this one measurement. Click the map and scroll to zoom, drag the background to pan, double-click to
          reset the view.`,
        }),
        callout('try', 'Slide along the curve', `<p>Drag E along the bold curve: $\\tau_{BA}$ barely changes. Drag it
          across the curves and it changes quickly. Put E on the <strong>perpendicular bisector</strong> of A and B
          (the line $x = 0$, every point of which is equally far from both) and $\\tau_{BA} = 0$. There the curve,
          which everywhere else is a hyperbola (next lesson), is a straight line.</p>`),
      ),
    );

    // Plot: equal-aspect map in km. Collectors are fixed (not draggable), the emitter is.
    const plot = new Plot2D(plotHost, {
      height: 440,
      equalAspect: true,
      view: { xmin: -110, xmax: 110, ymin: -70, ymax: 80 },
      xLabel: 'East (km)',
      yLabel: 'North (km)',
      ariaLabel: 'Map of collectors A and B, a draggable emitter, and curves of constant time difference.',
    });
    const A = plot.addHandle({ x: 0, y: 0, color: '--collector-a', label: 'A', shape: 'triangle', draggable: false });
    const B = plot.addHandle({ x: 0, y: 0, color: '--collector-b', label: 'B', shape: 'triangle', draggable: false });
    const E = plot.addHandle({
      x: 18, y: 38, color: '--emitter', label: 'E', shape: 'diamond',
      onDrag: () => update(),
    });

    function placeCollectors() {
      A.x = -state.baseline / 2; A.y = 0;
      B.x = state.baseline / 2; B.y = 0;
    }

    /** TDOA tau_BA = (rho_B - rho_A) / c in microseconds at (x, y). */
    const tauBA = (x, y) => (Math.hypot(x - B.x, y - B.y) - Math.hypot(x - A.x, y - A.y)) / C_KM_S * 1e6;

    plot.onDraw = (g) => {
      const tauE = tauBA(E.x, E.y);
      const field = g.sampleField(tauBA, { nx: 160, ny: 120 });

      if (state.showFamily) {
        const maxTau = (state.baseline / C_KM_S) * 1e6;
        const levels = niceTicks(-0.97 * maxTau, 0.97 * maxTau, 12);
        g.contour(field, levels, { color: '--tdoa', width: 1, alpha: 0.35 });
      }
      g.segment(E.x, E.y, A.x, A.y, { color: '--collector-a', width: 1.25, dash: [5, 4], alpha: 0.8 });
      g.segment(E.x, E.y, B.x, B.y, { color: '--collector-b', width: 1.25, dash: [5, 4], alpha: 0.8 });
      g.contour(field, [tauE], { color: '--tdoa', width: 2.5 });
      g.text(E.x, E.y, `\u03c4BA = ${fmt(tauE, 4)} \u00b5s`, { dx: 12, dy: 14, size: 12, baseline: 'top' });

      g.legend([
        { label: 'Same \u03c4BA as E', color: '--tdoa', width: 2.5 },
        ...(state.showFamily ? [{ label: 'Other \u03c4BA values', color: '--tdoa', width: 1 }] : []),
        { label: 'Ranges \u03c1A, \u03c1B', color: '--plot-text', width: 1.25, dash: [5, 4] },
      ], { position: 'bottom-left' });
    };

    plot.onHover = (x, y) => `x ${x.toFixed(1)} km   y ${y.toFixed(1)} km\n\u03c4BA ${fmt(tauBA(x, y), 4)} \u00b5s`;

    function update() {
      const rhoA = Math.hypot(E.x - A.x, E.y - A.y);
      const rhoB = Math.hypot(E.x - B.x, E.y - B.y);
      const tau = (rhoB - rhoA) / C_KM_S; // seconds
      values.set({
        rhoA: rhoA.toFixed(2),
        rhoB: rhoB.toFixed(2),
        drho: (rhoB - rhoA).toFixed(2),
        tauUs: (tau * 1e6).toFixed(3),
        tauNs: Math.round(tau * 1e9).toLocaleString('en-US').replace('-', '−'),
      });
      plot.requestRedraw();
    }

    placeCollectors();
    update();

    // ------------------------------------------------------------ notation
    root.append(
      section('Notation used throughout',
        diagram('notation'),
        callout('math', 'Symbols and sign conventions', String.raw`
          <ul>
            <li>Collectors are labelled <strong>A, B, C, D</strong> (we also call them "balls") and keep the same
            colours in every lesson; the emitter is <strong>E</strong>. A subscript says which collector a quantity
            belongs to: $i$ and $j$ stand for any two of them, and $e$ is the emitter. The emitter's position is
            $\mathbf r_e$ and collector $i$ is at $\mathbf r_i$ (bold letters are vectors). $c$ is the speed of
            light.</li>
            <li>The <strong>baseline</strong> of a pair is the straight line joining the two collectors, and $d$ is
            its length, the distance between them. It is the yardstick of the whole subject: what matters is always
            how long the baseline is compared with the range to the emitter.</li>
            <li>$\rho_i = \lVert \mathbf r_i - \mathbf r_e \rVert$ is the <strong>range</strong>: the straight-line
            distance between the emitter and collector $i$, in metres. It belongs to one collector. Comparing two
            collectors gives the <em>range difference</em> $\rho_i - \rho_j$, which is how much farther collector $i$
            is from the emitter than collector $j$.</li>
            <li>$\dot\rho_i = \mathrm d\rho_i/\mathrm dt$ is the <strong>range rate</strong>: how fast that distance
            is changing, in m/s. A dot over a symbol always means "rate of change with time". The range rate is
            negative while collector $i$ and the emitter are closing and positive while they are separating,
            whichever of the two is moving.</li>
            <li>TDOA between collectors $i$ and $j$:
            $$\tau_{ij} = t_i - t_j = \frac{\rho_i - \rho_j}{c}$$</li>
            <li>Doppler shift at collector $i$: the frequency it receives, $f_i$, minus the frequency transmitted,
            $f_0$. The received frequency is above $f_0$ while the range is closing:
            $$f_i - f_0 = -\frac{f_0}{c}\,\dot\rho_i = -\frac{f_0}{c}\,\frac{\mathrm d\rho_i}{\mathrm dt}$$
            For example, closing on a 1 GHz emitter at 300 m/s ($\dot\rho_i = -300$ m/s) raises the received
            frequency by about 1 kHz. (This is the first-order formula: it neglects corrections smaller by a
            factor of about speed ÷ $c$, which Part III puts back.)</li>
            <li>FDOA between collectors $i$ and $j$:
            $$\nu_{ij} = f_i - f_j = -\frac{f_0}{c}\,\big(\dot\rho_i - \dot\rho_j\big) = -\frac{\dot\rho_i - \dot\rho_j}{\lambda}$$
            where $\lambda = c/f_0$ is the <strong>wavelength</strong> (0.30 m at 1 GHz). Later lessons usually
            write $1/\lambda$ in place of $f_0/c$.</li>
            <li>The order of the subscripts matters: $\tau_{BA}$ and $\nu_{BA}$ mean "B minus A".</li>
          </ul>
          <p>So <strong>TDOA measures a range difference</strong> and <strong>FDOA measures a range-rate
          difference</strong>. Everything else in this course follows from those two lines.</p>
        `),
      ),
    );

    // ------------------------------------------------------------ rules of thumb
    const C_M_S = C_KM_S * 1000;
    const thumb = dataTable({
      caption: 'What 1 Hz of FDOA means at different carrier frequencies',
      columns: [
        { key: 'band', label: 'Carrier $f_0$' },
        { key: 'lambda', label: 'Wavelength $\\lambda = c/f_0$', align: 'right' },
        { key: 'rate', label: '1 Hz of FDOA equals', align: 'right' },
      ],
      rows: [1e8, 1e9, 1e10].map((f0) => ({
        band: f0 >= 1e9 ? `${f0 / 1e9} GHz` : `${f0 / 1e6} MHz`,
        lambda: `${fmt(C_M_S / f0, 3)} m`,
        rate: `${fmt(C_M_S / f0, 3)} m/s of range-rate difference`,
        highlight: f0 === 1e9,
      })),
    });

    root.append(
      section('Two rules of thumb',
        String.raw`
          <p><strong>1 ns of TDOA is 0.30 m of range difference.</strong> Light travels
          $c \times 1\,\text{ns} = 0.2998\,\text{m}$, so a TDOA error of 10 ns is a range-difference error of
          about 3 m, and 1 µs is about 300 m.</p>
          <p><strong>1 Hz of FDOA is one wavelength per second of range-rate difference.</strong> From
          $\nu_{ij} = -(\dot\rho_i - \dot\rho_j)/\lambda$, a 1 Hz change in $\nu_{ij}$ corresponds to a change of
          $\lambda \times 1\,\text{Hz}$ in the range-rate difference $\dot\rho_i - \dot\rho_j$, where
          $\lambda = c/f_0$ is the wavelength. A higher carrier frequency has a shorter wavelength, so it makes
          FDOA more sensitive:</p>
        `,
        thumb,
        callout('caution', 'Range difference is not position', String.raw`<p>These rules convert a measurement
          error into a <em>range-difference</em> (or range-rate-difference) error. How far that moves the
          <em>position fix</em> depends on the geometry: where the curves cross at a shallow angle, a small shift
          of one curve slides the intersection a long way. That amplification is called
          <strong>dilution of precision</strong>, and it is what Part II is about.</p>`),
      ),
    );

    // ------------------------------------------------------------ counting
    root.append(
      section('Counting measurements',
        String.raw`
          <p>Each independent measurement confines the emitter to one <strong>curve</strong> on a plane, or one
          <strong>surface</strong> in 3-D. A fix needs enough of them to intersect at a point.</p>
          <p>With $N$ collectors (so $N = 4$ for four balls) you can form many pairs, but only $N-1$ TDOAs are independent: the rest are sums of
          those, for example $\tau_{CA} = \tau_{CB} + \tau_{BA}$. Likewise there are $N-1$ independent FDOAs.</p>
          <p>From orbit, where the emitter can be anywhere in 3-D:</p>
          <ul>
            <li><strong>2 balls</strong>: one TDOA surface and one FDOA surface intersect in a curve; the
            Earth's surface cuts that curve to give a point. This needs TDOA <em>and</em> FDOA <em>and</em> an
            assumed altitude.</li>
            <li><strong>3 balls</strong>: two TDOAs and the Earth's surface give a fix without Doppler. The FDOAs
            add strength (and help with moving geometry), but are not required.</li>
            <li><strong>4 balls</strong>: three TDOAs give a full 3-D fix with no altitude assumption at all.</li>
          </ul>
        `,
      ),
    );

    // ------------------------------------------------------------ road map
    const roadmap = el('div', null);
    for (const p of parts) {
      roadmap.append(el('div', 'roadmap-part', `Part ${p.id} \u00b7 ${p.title}`));
      const list = el('ol', 'roadmap');
      for (const l of lessons.filter((x) => x.part === p.id)) {
        const i = lessons.indexOf(l);
        const link = lessonLink(ctx, l.id, '');
        link.append(
          el('span', 'rm-num', String(i).padStart(2, '0')),
          el('span', null, el('span', 'rm-title', l.title), el('span', 'rm-desc', ROADMAP[l.id] || '')),
        );
        list.append(el('li', null, link));
      }
      roadmap.append(list);
    }

    root.append(
      section('Road map', '<p>Ten short lessons. Each one has at least one figure to play with; the text is there to tell you what to look for.</p>', roadmap),
      callout('idea', 'Using this course', `<p>Drag coloured markers to move things. On a map, click it and then scroll (or pinch) to
        zoom about the cursor, drag the background to pan, and double-click to reset. Use the
        <kbd>&larr;</kbd> and <kbd>&rarr;</kbd> keys or the buttons at the top to move between lessons.</p>`),
      questionSet(QUESTIONS['welcome']),
      takeaways([
        'Passive collectors know neither the transmit time nor the exact transmit frequency, so they compare signals between pairs.',
        'TDOA $\\tau_{ij} = (\\rho_i - \\rho_j)/c$ measures a range difference; FDOA $\\nu_{ij} = -(f_0/c)(\\dot\\rho_i - \\dot\\rho_j)$ measures a range-rate difference.',
        '1 ns of TDOA is 0.30 m of range difference; 1 Hz of FDOA is one wavelength per second of range-rate difference.',
        'Each measurement is a curve (2-D) or surface (3-D); $N$ collectors give $N-1$ independent TDOAs and $N-1$ independent FDOAs.',
      ]),
      nextLesson(ctx, 'tdoa-plane'),
    );

    // ------------------------------------------------------------ cleanup
    return () => {
      plot.destroy();
    };
  },
};
