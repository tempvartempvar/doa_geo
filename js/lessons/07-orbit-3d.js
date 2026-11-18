/**
 * 07-orbit-3d.js - "Into 3-D: from 2 balls to 4".
 *
 * From the flat world to satellites in orbit: hyperboloid sheets, the Earth as a constraint surface,
 * lines of position on the ground, counting unknowns, and why a tight 4-ball cluster measures range
 * poorly on its own.
 *
 * One shared state drives every figure (formation, baseline, pass geometry, time in the pass, measurement
 * set). Cheap work (geometry, covariance, readouts, globe objects) runs on every input; the map-field
 * grids are computed coarse while sliding and fine ~0.2 s after the last change; pass series, the
 * observability table and the DOP-vs-baseline sweep are debounced. All physics comes from core/scenario.
 */
import { scenario } from '../core/index.js';
import { Plot2D, niceTicks } from '../ui/plot2d.js';
import { createGlobe } from '../ui/globe3d.js';
import { slider, toggle, select, segmented, button, readout, controlGroup, dataTable, fmt, fmtSI, fmtDist } from '../ui/controls.js';
import { el, lessonHeader, section, figure, callout, takeaways, nextLesson, lessonLink } from '../ui/layout.js';
import { questionSet } from '../ui/quiz.js';
import { diagram } from '../ui/diagrams.js';
import QUESTIONS from './questions.js';
import {
  C, SETS, SHAPES, shapeN, scenarioFor, sampleGrid, emitterLevels, groundLinesEcef, subSatellite, groundTrack,
  mirrorFix, niceFactor, logspace, dopSweep, observabilityTable, longAxisAngleDeg, distToLine,
} from './_orbitview.js';

const COL = ['--collector-a', '--collector-b', '--collector-c', '--collector-d'];
const DASH = [null, null, [9, 5], [2, 4]];       // per non-reference collector B, C, D on the map
const T_MIN = -300, T_MAX = 300;
const PASS_TIMES = Array.from({ length: 51 }, (_, k) => T_MIN + k * 12);
const DOP_BASELINES = logspace(30, 2000, 33);
const STYLE_ID = 'o3d-style';

const CSS = `
.o3d .o3d-globe { position: relative; min-height: 470px; border-radius: var(--radius-sm); overflow: hidden; background: var(--surface-2); }
.o3d .o3d-note { font-size: 0.85rem; color: var(--muted); margin: 6px 0 0; line-height: 1.4; }
.o3d .o3d-status { font-size: 0.88rem; margin: 8px 0 0; line-height: 1.4; color: var(--text-2); }
.o3d .o3d-status.is-warn { color: var(--warning); }
.o3d .o3d-status.is-bad { color: var(--critical); font-weight: 600; }
.o3d .o3d-btnrow { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 2px; }
.o3d .o3d-sub { margin-top: 14px; }
.o3d .o3d-noise { font-size: 0.92rem; }
.o3d .o3d-noise td, .o3d .o3d-noise th { padding: 2px 10px 2px 0; text-align: left; vertical-align: top; }
`;

const fmtUs = (s) => `${fmt(s * 1e6, 6)}`;
const signed = (v, d) => (v < 0 ? '\u2212' : '+') + Math.abs(v).toFixed(d);

export default {
  id: 'orbit-3d',
  title: 'Into 3-D: from 2 balls to 4',

  mount(root, ctx) {
    // ------------------------------------------------------------ style
    let styleEl = document.getElementById(STYLE_ID);
    const ownStyle = !styleEl;
    if (ownStyle) {
      styleEl = el('style', { id: STYLE_ID });
      styleEl.textContent = CSS;
      document.head.append(styleEl);
    }
    root.classList.add('o3d');

    // ------------------------------------------------------------ state
    const state = {
      shape: 'tri+1', baselineKm: 150, overhead: false, t: 0,
      setIdx: 5,                 // measurement set on the map (index into SETS)
      showHyp: true, showLop: true, showEll: false, showFamily: false,
      playing: false,
    };
    let alive = true;
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms); timers.add(id); return id; };
    const cancel = (id) => { if (id) { clearTimeout(id); timers.delete(id); } };

    // Derived quantities, refreshed by refreshLight().
    let D = null;
    // Cached heavy results.
    let grid = null;          // map-field grid for the map plot
    let globeLines = [];      // lifted ground lines for the globe
    let series = null, seriesKey = '';
    let sweep = null;

    const curSet = () => SETS[state.setIdx];
    const geomKey = () => `${state.shape}|${state.baselineKm}|${state.overhead}`;

    // ------------------------------------------------------------ header + section A text
    root.append(
      lessonHeader({
        kicker: 'Part III \u00b7 Lesson 7',
        title: 'Into 3-D: from 2 balls to 4',
        lede: 'In space every curve of Part I becomes a surface, three unknowns replace two, and the Earth itself becomes a measurement. By the end of this page you will be able to say what 2, 3 and 4 collectors can and cannot locate, with and without the Earth, and why a tight cluster of four measures range so poorly on its own.',
      }),
      section('Surfaces instead of curves', String.raw`
        <p>On the flat plane of Part I a TDOA confined the emitter to one branch of a hyperbola. In space the
        same condition, $\rho_i - \rho_A = c\,\tau_{iA}$ (the range to collector $i$ minus the range to the
        reference collector A), holds on a <strong>hyperboloid of revolution</strong>: the surface made by spinning
        that hyperbola about the line through its two foci, the collectors $i$ and A. It comes in two separate
        halves, called sheets, and the sign of $\tau_{iA}$ says which one the emitter is on. An FDOA confines it to a more complicated
        surface: the set of points with a given difference of range rates. Neither surface alone says where on it the
        emitter is, and there are now three coordinates to find instead of two.</p>
        <p>There is a third kind of surface, and it is free: <strong>the emitter is on the Earth</strong>. A ground
        emitter lies on the WGS-84 ellipsoid (the standard, slightly flattened model of the Earth's shape) raised by
        the local terrain height $h_{\text{terrain}}$. Used as a measurement ("the height
        is $h_{\text{terrain}}$, give or take a few metres") it removes one unknown. A surface-constrained fix is the
        point where the measurement surfaces cut the Earth; each cut is a curve on the ground called a
        <strong>line of position</strong>.</p>
        <p>The scenario below is the course's standard pass: collectors at 550 km altitude whose
        <strong>ground track</strong> (the path traced on the ground by the point directly beneath them, their
        <strong>sub-satellite point</strong>) passes
        400 km east of an emitter near Washington, D.C. Time $t$ is measured from the moment the formation's centre
        is abeam of the emitter, at its closest: that is $t = 0$.</p>
      `, diagram('orbit')),
    );

    // ------------------------------------------------------------ figure A: globe
    const globeHost = el('div', 'o3d-globe');
    const globeNote = el('p', 'o3d-note', 'Loading the 3-D view\u2026');

    const shapeCtl = select({
      label: 'Formation', options: SHAPES.map((s) => ({ value: s.value, label: s.label })), value: state.shape,
      onChange: (v) => setShape(v),
    });
    const baselineCtl = slider({
      label: 'Baseline $L$', min: 30, max: 2000, log: true, value: state.baselineKm, unit: 'km',
      format: (v) => v.toFixed(0),
      hint: 'Size of the formation (side of the triangle, spacing of the pair).',
      onInput: (v) => { state.baselineKm = Math.round(v); changed('geom'); },
    });
    const passCtl = segmented({
      label: 'Ground track', options: [{ value: 'east', label: '400 km east' }, { value: 'over', label: 'Overhead' }],
      value: 'east', onChange: (v) => { state.overhead = v === 'over'; changed('geom'); },
    });
    const timeCtlA = slider({
      label: 'Time in pass $t$', min: T_MIN, max: T_MAX, step: 1, value: state.t, unit: 's',
      format: (v) => signed(v, 0), onInput: (v) => setTime(v),
    });
    const playA = button({ label: 'Play', onClick: () => setPlaying(!state.playing) });
    const recentre = button({ label: 'Re-centre view', kind: 'ghost', onClick: () => fitGlobe(true) });
    const hypCtl = toggle({
      label: 'TDOA hyperboloid sheets', value: state.showHyp,
      hint: 'One sheet per TDOA $\\tau_{iA}$, foci at $i$ and A.',
      onChange: (v) => { state.showHyp = v; updateGlobe(); },
    });
    const lopCtl = toggle({
      label: 'Lines of position on the ground', value: state.showLop,
      hint: 'Iso-TDOA and iso-FDOA lines through the emitter.',
      onChange: (v) => { state.showLop = v; updateGlobe(); },
    });
    const ellCtl = toggle({
      label: '3-D 95 % error ellipsoid', value: state.showEll,
      hint: 'For the measurement set chosen under the map below; drawn magnified (factor shown).',
      onChange: (v) => { state.showEll = v; updateGlobe(); },
    });
    const globeRo = readout([
      { key: 'rng', label: 'Ranges $\\rho_i$', unit: 'km', hint: 'Distance from the emitter to each collector, in the order A / B / C / D' },
      { key: 'el', label: 'Elevations', unit: '\u00b0', hint: 'Angle of each collector above the emitter\u2019s horizon (90 = straight overhead)' },
      { key: 'ell', label: 'Ellipsoid scale', hint: 'How much the error ellipsoid is magnified so that it can be seen' },
    ]);

    root.append(
      section(null,
        figure({
          plot: [globeHost, globeNote],
          controls: [
            controlGroup('Geometry', [shapeCtl, baselineCtl, passCtl]),
            controlGroup('Time', [timeCtlA, el('div', 'o3d-btnrow', playA.el, recentre.el)]),
            controlGroup('Show', [hypCtl, lopCtl, ellCtl]),
            controlGroup('Readout', [globeRo]),
          ],
          caption: `Collectors are labelled dots with velocity arrows and dashed lines down to their sub-satellite points;
          thin coloured curves are their orbit tracks for four minutes either side of now; dashed lines from the emitter are
          the lines of sight. Violet sheets are TDOA hyperboloids, and where they meet the ground the violet lines of position
          are drawn; ochre lines are the iso-FDOA lines. Drag to rotate; click, then scroll to zoom.`,
        }),
        callout('math', 'The three kinds of surface', String.raw`
          <p>Write $\mathbf r_e$ for the emitter's position, $\mathbf r_i$ and $\mathbf v_i$ for collector $i$'s
          position and velocity, and $\rho_i = \lVert\mathbf r_i - \mathbf r_e\rVert$ for the range between them. With
          the collectors frozen at their reception positions (where they are when the signal arrives):</p>
          $$\text{TDOA:}\quad \lVert\mathbf r_i - \mathbf r_e\rVert - \lVert\mathbf r_A - \mathbf r_e\rVert = c\,\tau_{iA}$$
          <p>is a hyperboloid of revolution about the line through $\mathbf r_i$ and $\mathbf r_A$. Its two sheets are
          $|c\,\tau_{iA}|$ apart where they come closest, and its foci are $\lVert\mathbf r_i - \mathbf r_A\rVert$
          apart (the baseline). The sign of
          $\tau_{iA}$ picks the sheet (negative: the sheet that wraps around $i$).</p>
          $$\text{FDOA:}\quad -\frac{f_0}{c}\left(\dot\rho_i - \dot\rho_A\right) = \nu_{iA},\qquad
            \dot\rho_i = \frac{(\mathbf r_i - \mathbf r_e)\cdot\mathbf v_i}{\rho_i}$$
          <p>($f_0$ is the carrier frequency and $\dot\rho_i$ the range rate) depends on where the emitter sits
          relative to each collector's velocity, so it is not a surface of
          revolution about anything simple.</p>
          $$\text{Earth:}\quad h(\mathbf r_e) = h_{\text{terrain}}$$
          <p>where $h(\mathbf r_e)$ is the emitter's height above the WGS-84 ellipsoid.</p>
          <p>The hyperboloid drawn from the two reception positions is an excellent picture but not the exact model:
          the collectors move while the signal is in flight and the Earth rotates under it, which the
          <a href="#/physics" data-o3d-link="physics">next lesson</a> deals with.</p>
        `),
        callout('try', 'Rotate the globe, then scrub time', `<p>Zoom in on the emitter: the violet sheets are nearly
          cones opening away from the collectors, because the foci are only a baseline apart while the emitter is hundreds of
          kilometres away. Each sheet slices the Earth along one violet line, and all of them pass through the emitter.
          Now drag the time slider or press Play: the collectors fly along their tracks, and the sheets and the lines on the
          ground swing round with them. Switch the formation to <em>Pair</em>: one TDOA sheet and one FDOA line are left, and they
          still cross at the emitter.</p>`),
      ),
    );

    // ------------------------------------------------------------ section B: map
    const mapHost = el('div');
    const cepHost = el('div', 'o3d-sub');
    const setCtl = select({
      label: 'Measurement set', options: SETS.map((s, i) => ({ value: i, label: s.label })), value: state.setIdx,
      onChange: (v) => setSet(v),
    });
    const timeCtlB = slider({
      label: 'Time in pass $t$', min: T_MIN, max: T_MAX, step: 1, value: state.t, unit: 's',
      format: (v) => signed(v, 0), onInput: (v) => setTime(v),
    });
    const playB = button({ label: 'Play', onClick: () => setPlaying(!state.playing) });
    const familyCtl = toggle({
      label: 'Neighbouring lines', value: state.showFamily,
      hint: 'Faint lines at evenly spaced values of each measurement in use.',
      onChange: (v) => { state.showFamily = v; plot.requestRedraw(); },
    });
    const viewCtl = segmented({
      label: 'Map half-width', options: [{ value: 300, label: '300 km' }, { value: 700, label: '700 km' }, { value: 1500, label: '1500 km' }],
      value: 300, onChange: (v) => setMapHalf(v),
    });
    const measRo = readout([
      { key: 't1', label: '$\\tau_{BA}$', unit: '\u00b5s' },
      { key: 't2', label: '$\\tau_{CA}$', unit: '\u00b5s' },
      { key: 't3', label: '$\\tau_{DA}$', unit: '\u00b5s' },
      { key: 'f1', label: '$\\nu_{BA}$', unit: 'Hz' },
      { key: 'f2', label: '$\\nu_{CA}$', unit: 'Hz' },
      { key: 'f3', label: '$\\nu_{DA}$', unit: 'Hz' },
    ]);
    const precRo = readout([
      { key: 'sE', label: '$\\sigma_E$', hint: '1-sigma east error' },
      { key: 'sN', label: '$\\sigma_N$', hint: '1-sigma north error' },
      { key: 'sU', label: '$\\sigma_U$', hint: '1-sigma vertical error' },
      { key: 'cep', label: 'CEP', hint: 'Radius containing 50 % of horizontal fixes' },
      { key: 'ea', label: '95 % ellipse', hint: 'True semi-axes of the horizontal 95 % ellipse' },
    ]);
    const statusEl = el('p', 'o3d-status');
    const ellNote = el('p', 'o3d-note');
    const mirrorRo = readout([
      { key: 'pos', label: 'Mirror crossing', unit: 'km' },
      { key: 'tau', label: '$\\tau_{BA}$ there', unit: '\u00b5s' },
      { key: 'nu', label: '$\\nu_{BA}$ there', unit: 'Hz' },
      { key: 'tauE', label: '$\\tau_{BA}$ at E', unit: '\u00b5s' },
      { key: 'nuE', label: '$\\nu_{BA}$ at E', unit: 'Hz' },
    ]);
    const mirrorGroup = controlGroup('Mirror fix (pair)', [mirrorRo, el('p', 'o3d-note', 'Map-field values (vacuum propagation) at the second crossing, next to the same values at the emitter.')]);

    const noise = scenario.defaultConfig().noise;
    const budgetRo = readout([
      { key: 'toa', label: 'Per-collector timing $\\sigma_T$', hint: 'Root-sum-square of noise, clock and ephemeris terms' },
      { key: 'foa', label: 'Per-collector frequency $\\sigma_F$', hint: 'Root-sum-square of noise, oscillator and ephemeris terms' },
    ]);

    root.append(
      section('Lines of position on the ground', String.raw`
        <p>Flatten the picture: look straight down on a map centred on the emitter E (east and north in km). For each
        measurement in use the map shows its line of position through E: violet for TDOAs, ochre for FDOAs. Solid,
        dashed and dotted lines belong to collectors B, C and D (each measured against A). The triangles are the
        collectors' sub-satellite points (the points on the ground directly beneath them) with their headings, and
        the thin dashed curves their ground tracks. Where any
        collector is below E's horizon the map is greyed: an emitter there could not be heard by all of them.</p>
        <p>The ellipse at E is the 95 % horizontal error ellipse from the Cramér–Rao bound (the best any unbiased
        estimator can do) for the chosen measurement set. In the readout, $\sigma_E$, $\sigma_N$ and $\sigma_U$ are
        the 1-sigma errors in the east, north and up (vertical) directions at the emitter, and CEP is the radius of
        the circle that holds half the fixes.
        It is usually far smaller than the map, so it is drawn magnified by the factor printed under the map; the
        readout gives its true size.</p>
      `,
        figure({
          plot: [mapHost, ellNote, cepHost],
          controls: [
            controlGroup('Measurements', [setCtl, statusEl]),
            controlGroup('Time', [timeCtlB, el('div', 'o3d-btnrow', playB.el)]),
            controlGroup('Map', [viewCtl, familyCtl]),
            controlGroup('Values at the emitter', [measRo]),
            controlGroup('Precision', [precRo]),
            mirrorGroup,
          ],
          caption: `Hover over the map to read the measurements a hypothetical emitter at that point would produce. Click the map and scroll to zoom
          (out to \u00b11500 km), drag to pan, double-click to reset. Below: the CEP through the pass for the selected measurement
          set, with the current time marked; grey bands are times when some collector is below 5\u00b0 elevation.`,
        }),
        callout('math', 'What noise is assumed', el('div', 'o3d-noise',
          el('p', null, 'Every collector is given the same 1-sigma errors:'),
          noiseTable(noise),
          budgetRo.el,
          el('p', 'o3d-note', 'These are the defaults of the scenario engine; the collection lab lets you change them. Each TDOA between two collectors has the two collectors\u2019 timing errors combined, and TDOAs sharing the reference collector are correlated; the core accounts for both.'),
        )),
        callout('try', 'Two balls: one fix, and its mirror image', el('div', null,
          el('div', { html: `<p>Choose <em>2 balls</em> and zoom out to about \u00b1700 km (or press the button). The TDOA line and the
            FDOA line cross at E, and cross <em>again</em> on the far side of the ground track, near 355 km east and 380 km south
            at <em>t</em> = 0 (marked with a ring; the readout shows that the map field there reproduces both measurements). Two
            measurements plus the surface give a fix, but with this mirror ambiguity: something else has to decide which crossing
            is real \u2014 which side the antenna was looking, a second look later in the pass, or the horizon.</p>` }),
          el('div', 'o3d-btnrow', button({ label: 'Show me: 2 balls at \u00b1700 km', kind: 'primary', onClick: () => { setSet(0); setTime(0); setMapHalf(700); } }).el),
        )),
        callout('try', 'Watch the crossing angle', `<p>With any set selected, press Play. The lines of position rotate as the
          collectors fly past and the angle between them changes; the CEP curve under the map follows it. Precision is best
          where the lines cross steeply and degrades where they run nearly parallel. For the pair the CEP is smallest some
          tens of seconds before $t = 0$ rather than at it; compare the crossing angle at the two times.</p>`),
      ),
    );

    // ------------------------------------------------------------ section C: counting
    const tableNote = el('p', 'o3d-note');
    const obsTable = dataTable({
      caption: 'What each combination can fix, computed live at the current time and baseline',
      columns: [
        { key: 'balls', label: 'Balls' },
        { key: 'meas', label: 'Measurements' },
        { key: 'eq', label: 'Equations (free / +surface)', align: 'center' },
        { key: 'free', label: 'No surface constraint', align: 'right' },
        { key: 'surf', label: 'With surface constraint', align: 'right' },
      ],
      rows: [],
    });
    root.append(
      section('Counting unknowns', String.raw`
        <p>Position has three unknowns. $N$ collectors give $N-1$ independent TDOAs and $N-1$ independent FDOAs, and the
        Earth-surface constraint adds one more equation. Counting is necessary but not sufficient: the equations must also
        be independent at the emitter, which is what the table checks by asking the core whether the information matrix
        ($H^{\mathsf T}R^{-1}H$ from lesson 4, whose inverse is the position covariance) can be inverted. Each cell
        shows the CEP and the vertical error $\sigma_U$, or "no fix".</p>
      `,
        obsTable, tableNote,
        callout('idea', 'What the table shows at the default settings', `<p>At the defaults ($t = 0$, 150 km baseline,
          triangle + 1) the pattern is:</p>
          <ul>
            <li><strong>2 balls</strong> fix nothing unless they use <em>both</em> kinds of measurement <em>and</em> the surface:
            one TDOA + one FDOA + the Earth = 3 equations.</li>
            <li><strong>3 balls</strong>: two TDOAs plus the surface work, and so do two FDOAs plus the surface. TDOA + FDOA
            together (4 equations) work even without the surface.</li>
            <li><strong>4 balls</strong>: three TDOAs alone give a full 3-D fix with no altitude assumption, but a weak one:
            hundreds of metres, mostly east and up, which here is roughly the direction of the line of sight. FDOA alone or both
            together are far better, and adding the surface to the three TDOAs shrinks the error by close to an order of magnitude.</li>
          </ul>
          <p>With the surface, $\\sigma_U$ is essentially the assumed 10 m terrain-height uncertainty. Change the baseline, the
          time or the formation above and the numbers move; the pattern of which cells say "no fix" depends only on counting,
          except in the degenerate geometries of the next section.</p>`),
      ),
    );

    // ------------------------------------------------------------ section D: DOP
    const dopHost = el('div');
    const dopRo = readout([
      { key: 'h', label: 'TDOA 3-D HDOP', hint: 'Horizontal dilution of precision of the free 3-D fix from TDOAs alone' },
      { key: 'v', label: 'TDOA 3-D VDOP', hint: 'Vertical dilution of precision of the same fix' },
      { key: 's', label: 'TDOA + surface HDOP', hint: 'Horizontal DOP when the terrain height is used as well' },
      { key: 'vh', label: 'VDOP / HDOP', hint: 'Compare with tan(elevation) when the along-line-of-sight error dominates' },
      { key: 'tanel', label: 'tan(mean elevation)' },
      { key: 'ct', label: '$c\\,\\sigma_T$ per collector', hint: 'Per-collector timing error expressed as a range' },
    ]);
    const dopMRo = readout([
      { key: 'mh', label: '$\\sigma_h$, 3-D TDOA', hint: 'HDOP x c sigma_T' },
      { key: 'mv', label: '$\\sigma_U$, 3-D TDOA', hint: 'VDOP x c sigma_T' },
      { key: 'ms', label: '$\\sigma_h$, TDOA + surface', hint: 'Surface HDOP x c sigma_T' },
      { key: 'ch', label: 'covariance(): $\\sigma_h$, 3-D TDOA', hint: 'Direct CRLB, TDOA only, no surface' },
      { key: 'ang', label: 'Long axis vs line of sight', unit: '\u00b0', hint: 'Angle between the longest axis of the TDOA-only 3-D ellipsoid and the mean line of sight' },
    ]);
    const fdopRo = readout([
      { key: 'fh', label: 'FDOA 3-D HDOP', unit: 's' },
      { key: 'fv', label: 'FDOA 3-D VDOP', unit: 's' },
      { key: 'fs', label: 'FDOA + surface HDOP', unit: 's' },
      { key: 'lf', label: '$\\lambda\\,\\sigma_F$ per collector', hint: 'Per-collector frequency error expressed as a range rate' },
    ]);
    const demo = (label, patch) => button({ label, onClick: () => applyDemo(patch) }).el;

    root.append(
      section('Why four balls alone measure range poorly', String.raw`
        <p>The 4-ball TDOA-only fix needs no altitude assumption, yet the table shows it is several times worse than three
        or four balls with the surface. The reason is the heart of this lesson.</p>
        <p>How a TDOA responds to a small move of the emitter depends only on the <em>directions</em> of the two lines of
        sight, not on the ranges. As in lesson 1, let $\hat{\mathbf l}_i$ be the unit vector (length 1) from the emitter
        towards collector $i$, and $\nabla$ the gradient with respect to the emitter's position $\mathbf r_e$, now
        in three dimensions. Differentiate
        $\tau_{ij} = (\rho_i - \rho_j)/c$, using $\nabla\rho_i = -\hat{\mathbf l}_i$:</p>
        $$\nabla\tau_{ij} = \frac{\hat{\mathbf l}_j - \hat{\mathbf l}_i}{c}$$
        <p>Seen from the emitter a tight cluster occupies a small patch of sky. Its angular size is about
        $\beta \approx L/\rho$ radians, where $L$ is the formation's baseline (its size) and $\rho$ the range from the
        emitter to the cluster (both are drawn in the side view near the top of this page). All the difference vectors $\hat{\mathbf l}_j - \hat{\mathbf l}_i$ then lie almost
        in one plane, the plane <strong>perpendicular to the line of sight</strong>; their length is about $\beta$. Across
        the line of sight the cluster therefore measures well: it is in effect a very large direction finder, and the error
        grows like $\rho/L$. <strong>Along</strong> the line of sight the component of $\hat{\mathbf l}_j - \hat{\mathbf l}_i$
        is only of order $\beta^2/2$: moving the emitter straight toward the cluster changes the range differences only
        through the curvature of the arriving wavefront, a second-order effect. The error in that direction grows like
        $(\rho/L)^2$.</p>
        <p>The Earth-surface constraint supplies exactly that missing direction: the line of sight is steep (its
        elevation, the angle it makes with the emitter's horizon, is about 50° in the default pass), so knowing the
        height pins down most of the along-line-of-sight position. That is why three or four
        balls plus a terrain height do so much better than four balls alone, until the baseline becomes comparable with the
        range.</p>
      `,
        figure({
          plot: dopHost,
          controls: [
            controlGroup('One-click geometries', [el('div', 'o3d-btnrow',
              demo('Tight triangle + 1', { shape: 'tri+1', baselineKm: 150, overhead: false }),
              demo('Wide triangle + 1 (1000 km)', { shape: 'tri+1', baselineKm: 1000, overhead: false }),
              demo('Diamond, overhead', { shape: 'diamond', baselineKm: 150, overhead: true }),
              demo('String of four', { shape: 'string', baselineKm: 150, overhead: false }),
            ), el('p', 'o3d-note', 'Each sets t = 0, selects "4 balls \u2014 3 TDOA, free 3-D" and shows the 3-D ellipsoid on the globe.')]),
            controlGroup('DOP at the current baseline', [dopRo]),
            controlGroup('In metres', [dopMRo]),
            controlGroup('FDOA DOP', [fdopRo], { collapsible: true, collapsed: true }),
          ],
          caption: `Dilution of precision versus baseline for the current formation and time (log-log). Violet: TDOA-only free 3-D fix,
          horizontal (solid) and vertical (dashed); green: TDOA with the Earth-surface constraint (horizontal). The marker is the
          current baseline. Multiply a DOP by the per-collector range error $c\\,\\sigma_T$ to get metres.`,
        }),
        callout('math', 'HDOP, VDOP and the units of DOP', String.raw`
          <p>Compute the position covariance $\mathbf P$ (now a 3 × 3 matrix) for a per-collector range error of
          exactly 1 m (that is, $c\,\sigma_T = 1$ m at every collector, $\sigma_T$ being the per-collector timing
          error) and rotate it into local east/north/up at the emitter,
          $\mathbf P_{\text{ENU}} = \mathbf Q\,\mathbf P\,\mathbf Q^{\mathsf T}$, where $\mathbf Q$ is the rotation
          matrix from Earth-centred axes to east, north and up. Its diagonal entries $P_{EE}$, $P_{NN}$ and $P_{UU}$
          are the variances of the east, north and up errors. Then HDOP and VDOP, the horizontal and vertical
          dilutions of precision,</p>
          $$\text{HDOP} = \sqrt{P_{EE} + P_{NN}},\qquad \text{VDOP} = \sqrt{P_{UU}}$$
          <p>are dimensionless, and the horizontal and vertical errors are $\sigma_h = \text{HDOP}\cdot c\,\sigma_T$ and
          $\sigma_U = \text{VDOP}\cdot c\,\sigma_T$.
          For FDOA the natural unit error is a range-rate error of 1 m/s per collector ($\lambda\,\sigma_F = 1$ m/s,
          with $\lambda$ the wavelength and $\sigma_F$ the per-collector frequency error), so
          "FDOA DOP" is metres per (m/s): it has units of <strong>seconds</strong>.</p>
          <p>When the along-line-of-sight error dominates, it splits between horizontal and vertical according to the
          elevation $\epsilon$ of the line of sight (its angle above the emitter's horizon), so $\text{VDOP}/\text{HDOP} \approx \tan\epsilon$; the readout lets you
          check this.</p>
        `),
        callout('try', 'Degenerate geometries', `<p><strong>Diamond, overhead.</strong> When a symmetric diamond passes
          over the emitter at $t = 0$ all four collectors are at the same range and elevation: the four lines of sight lie on one
          cone. Every TDOA is then unchanged if the emitter moves straight up, and the vertical DOP explodes (the readouts run
          to millions). The surface-constrained DOP stays small. Move the time a few tens of seconds either way and the symmetry,
          and the vertical DOP, recover.</p>
          <p><strong>String of four.</strong> Collinear collectors have every hyperboloid about the same axis, so the TDOAs cannot
          tell where the emitter is <em>around</em> that axis. The 3-D DOP is in the thousands (only the slight curvature of the
          orbit keeps it finite), and even the surface-constrained DOP is several times worse than for the triangle. Note the
          long-axis angle readout: for the string the weak direction is across the line of sight, not along it.</p>
          <p><strong>Wide formation.</strong> At 1000 km baseline the 3-D TDOA DOP falls to a few, close to the
          surface-constrained value: once the cluster spans a large patch of sky, four balls alone measure range well.</p>`),
      ),
    );

    root.append(
      questionSet(QUESTIONS['orbit-3d']),
      takeaways([
        'In 3-D a TDOA puts the emitter on one sheet of a hyperboloid of revolution with the two collectors as foci; an FDOA on a more complicated surface; a known terrain height on a third surface, the raised WGS-84 ellipsoid.',
        'A surface-constrained fix is where the measurement surfaces cut the Earth: the lines of position. Two balls (one TDOA, one FDOA, the surface) give a fix with a mirror ambiguity across the ground track.',
        'Position has 3 unknowns; $N$ collectors give $N-1$ TDOAs and $N-1$ FDOAs, and the surface adds one equation. Counting says what is possible; geometry says how well.',
        'How a TDOA responds to a small move of the emitter depends only on the directions of the two lines of sight, $\\nabla\\tau_{ij} = (\\hat{\\mathbf l}_j - \\hat{\\mathbf l}_i)/c$. A tight cluster measures across the line of sight with error $\\propto \\rho/L$ but along it with error $\\propto (\\rho/L)^2$.',
        'The Earth-surface constraint replaces exactly that weak direction, which is why 3 or 4 balls plus a terrain height beat 4 balls alone unless the baseline is very large.',
        'Symmetric geometries can remove a direction altogether: a diamond overhead loses the vertical, a collinear string loses the rotation about its own axis.',
      ]),
      nextLesson(ctx, 'physics'),
    );

    // in-prose link to the next lesson (prose HTML cannot carry a click handler)
    const onLinkClick = (e) => {
      const a = e.target.closest && e.target.closest('a[data-o3d-link]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      ctx.navigate(a.getAttribute('data-o3d-link'));
    };
    root.addEventListener('click', onLinkClick);

    // ------------------------------------------------------------ plots
    const plot = new Plot2D(mapHost, {
      height: 470, equalAspect: true,
      view: { xmin: -300, xmax: 300, ymin: -300, ymax: 300 },
      xLabel: 'East (km)', yLabel: 'North (km)', maxSpan: 6, minSpan: 0.01,
      ariaLabel: 'Map centred on the emitter showing lines of position, collector ground tracks and the error ellipse.',
    });
    plot.addHandle({ x: 0, y: 0, color: '--emitter', label: 'E', shape: 'diamond', draggable: false });
    const colHandles = COL.map((c, i) => plot.addHandle({ x: 0, y: 0, color: c, label: 'ABCD'[i], shape: 'triangle', draggable: false, visible: false }));

    const cepPlot = new Plot2D(cepHost, {
      height: 200, yLog: true, pan: false, zoom: false,
      view: { xmin: T_MIN, xmax: T_MAX, ymin: 10, ymax: 1000 },
      xLabel: 'Time in pass t (s)', yLabel: 'CEP (m)',
      ariaLabel: 'CEP versus time in the pass for the selected measurement set.',
    });
    const dopPlot = new Plot2D(dopHost, {
      height: 380, xLog: true, yLog: true, pan: false, zoom: false,
      view: { xmin: 30, xmax: 2000, ymin: 0.5, ymax: 5000 },
      xLabel: 'Baseline (km)', yLabel: 'DOP',
      ariaLabel: 'Dilution of precision versus formation baseline.',
    });

    // ------------------------------------------------------------ derived state
    function refreshDerived() {
      const S = scenarioFor(state);
      const set = curSet();
      const t = state.t;
      const obs = scenario.truthObservation(S, t);
      const geo = scenario.geometry(S, t);
      const cov = scenario.covariance(S, t, { use: set.use });
      const covT3 = S.n >= 4 ? scenario.covariance(S, t, { use: { tdoa: true, fdoa: false, altitude: false } }) : null;
      const dops = scenario.dops(S, t);
      const subs = subSatellite(S, t);
      const times = Array.from({ length: 25 }, (_, k) => t - 240 + k * 20);
      const tracks = S.ids.map((_, i) => groundTrack(S, i, times));
      const mirror = set.key === 'pair' ? mirrorFix(S, t, 1) : null;
      const levels = emitterLevels(S, t);
      D = { S, set, t, obs, geo, cov, covT3, dops, subs, tracks, times, mirror, levels };
    }

    // ------------------------------------------------------------ readouts
    function updateReadouts() {
      const { S, set, obs, geo, cov, covT3, dops, mirror, levels } = D;
      // globe readout
      globeRo.set({
        rng: geo.collectors.map((c) => c.rangeKm.toFixed(0)).join(' / '),
        el: geo.collectors.map((c) => c.elevationDeg.toFixed(1)).join(' / '),
      });
      // measurements in use
      const vals = {};
      for (let k = 1; k <= 3; k++) {
        const here = k < S.n;
        vals['t' + k] = !here ? '\u2014' : set.use.tdoa ? fmtUs(obs.tdoa[k]) : `(${fmtUs(obs.tdoa[k])}, not used)`;
        vals['f' + k] = !here ? '\u2014' : set.use.fdoa ? fmt(obs.fdoa[k], 6) : `(${fmt(obs.fdoa[k], 6)}, not used)`;
      }
      measRo.set(vals);
      // precision
      if (cov.observable) {
        precRo.set({
          sE: fmtDist(cov.sigmaE), sN: fmtDist(cov.sigmaN), sU: fmtDist(cov.sigmaU), cep: fmtDist(cov.cep50),
          ea: `${fmtDist(cov.ellipse.semiMajor)} \u00d7 ${fmtDist(cov.ellipse.semiMinor)}`,
        });
      } else {
        precRo.set({ sE: '\u2014', sN: '\u2014', sU: '\u2014', cep: '\u2014', ea: '\u2014' });
      }
      const below = geo.collectors.filter((c) => c.elevationDeg < 0).map((c) => c.id);
      let msg, cls = '';
      if (!cov.observable) { msg = 'Not observable: these measurements cannot fix the position in this geometry.'; cls = 'is-bad'; }
      else if (set.use.altitude) msg = `Surface-constrained fix (${cov.layout.length - 1} measurements + the terrain height).`;
      else msg = `Free 3-D fix from ${cov.layout.length} measurements, no altitude assumption. The ellipse is the horizontal part of the 3-D error.`;
      if (below.length) { msg += ` Collector ${below.join(', ')} is below the emitter\u2019s horizon: it could not actually hear the signal, though the numbers assume it could.`; if (!cls) cls = 'is-warn'; }
      if (statusEl.textContent !== msg) statusEl.textContent = msg;
      statusEl.className = 'o3d-status ' + cls;
      // per-collector budget
      const p = cov.budget.parts[0];
      budgetRo.set({ toa: fmtSI(p.toaTotal, 's'), foa: fmtSI(p.foaTotal, 'Hz') });
      // mirror
      mirrorGroup.style.display = set.key === 'pair' ? '' : 'none';
      if (mirror) {
        mirrorRo.set({
          pos: `${Math.abs(mirror.x).toFixed(1)} ${mirror.x >= 0 ? 'E' : 'W'}, ${Math.abs(mirror.y).toFixed(1)} ${mirror.y >= 0 ? 'N' : 'S'}`, tau: fmt(mirror.tdoa, 7), nu: fmt(mirror.fdoa, 7),
          tauE: fmt(levels.tdoa[1], 7), nuE: fmt(levels.fdoa[1], 7),
        });
      } else mirrorRo.set({ pos: 'not found', tau: '\u2014', nu: '\u2014', tauE: '\u2014', nuE: '\u2014' });
      // DOP
      const ct = C * p.toaTotal;
      const lam = C / S.emitter.f0, lf = lam * p.foaTotal;
      const meanEl = geo.collectors.reduce((s, c) => s + c.elevationDeg, 0) / geo.collectors.length;
      const t3 = dops.tdoa3d;
      dopRo.set({
        h: t3 ? fmt(t3.h, 4) : 'no fix', v: t3 ? fmt(t3.v, 4) : 'no fix',
        s: dops.tdoaSurface != null ? fmt(dops.tdoaSurface, 4) : 'no fix',
        vh: t3 ? fmt(t3.v / t3.h, 3) : '\u2014', tanel: fmt(Math.tan(meanEl * Math.PI / 180), 3),
        ct: fmtDist(ct),
      });
      dopMRo.set({
        mh: t3 ? fmtDist(t3.h * ct) : 'no fix', mv: t3 ? fmtDist(t3.v * ct) : 'no fix',
        ms: dops.tdoaSurface != null ? fmtDist(dops.tdoaSurface * ct) : 'no fix',
        ch: covT3 && covT3.observable ? fmtDist(Math.hypot(covT3.sigmaE, covT3.sigmaN)) : 'no fix',
        ang: covT3 && covT3.observable ? fmt(longAxisAngleDeg(covT3, obs), 3) : '\u2014',
      });
      const f3 = dops.fdoa3d;
      fdopRo.set({
        fh: f3 ? fmt(f3.h, 4) : 'no fix', fv: f3 ? fmt(f3.v, 4) : 'no fix',
        fs: dops.fdoaSurface != null ? fmt(dops.fdoaSurface, 4) : 'no fix',
        lf: `${fmt(lf, 3)} m/s`,
      });
    }

    // ------------------------------------------------------------ map-field grids
    let fieldRaf = 0, fineTimer = 0;
    function computeFields(coarse) {
      if (!alive || !D) return;
      const v = plot.getView();
      const w = v.xmax - v.xmin, h = v.ymax - v.ymin;
      const nx = coarse ? 56 : 128;
      const ny = Math.max(16, Math.round(nx * h / w));
      const pad = 0.02;
      grid = {
        key: `${geomKey()}|${state.t}`,
        g: sampleGrid(D.S, D.t, { xmin: v.xmin - pad * w, xmax: v.xmax + pad * w, ymin: v.ymin - pad * h, ymax: v.ymax + pad * h }, nx, ny),
      };
      globeLines = groundLinesEcef(D.S, D.t, 1200, coarse ? 40 : 72);
      plot.requestRedraw();
      updateGlobeLines();
    }
    function requestFields() {
      if (!fieldRaf) fieldRaf = requestAnimationFrame(() => { fieldRaf = 0; computeFields(true); });
      cancel(fineTimer);
      fineTimer = later(() => computeFields(false), 220);
    }
    let viewTimer = 0;
    plot.onViewChange = () => {
      cancel(viewTimer);
      viewTimer = later(() => computeFields(false), 140);
    };

    // ------------------------------------------------------------ map drawing
    const kindLabel = (kind, i) => `${kind === 'tdoa' ? '\u03c4' : '\u03bd'}${'ABCD'[i]}A`;
    plot.onDraw = (g) => {
      if (!D) return;
      const { S, set, cov, subs, tracks, mirror, levels } = D;
      const G = grid && grid.g;
      // horizon mask
      if (G) g.contourBand(G.minEl, -90, 0, { fill: '--muted', fillAlpha: 0.22 });
      // ground tracks
      tracks.forEach((tr, i) => g.line(tr, { color: COL[i], width: 1.2, alpha: 0.55, dash: [5, 4] }));
      // lines of position
      const kinds = [];
      if (set.use.tdoa) kinds.push('tdoa');
      if (set.use.fdoa) kinds.push('fdoa');
      if (G) {
        for (const kind of kinds) {
          for (let i = 1; i < S.n; i++) {
            const f = G[kind][i];
            const color = kind === 'tdoa' ? '--tdoa' : '--fdoa';
            if (state.showFamily) {
              let lo = Infinity, hi = -Infinity;
              for (const v of f.data) if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
              if (hi > lo) {
                const lv = niceTicks(lo, hi, 14).filter((x) => Math.abs(x - levels[kind][i]) > 1e-9 * (Math.abs(x) + 1));
                g.contour(f, lv, { color, width: 1, alpha: 0.28, dash: DASH[i] || undefined });
              }
            }
            g.contour(f, [levels[kind][i]], { color, width: 2.4, dash: DASH[i] || undefined, labels: () => kindLabel(kind, i) });
          }
        }
      }
      // heading arrows at the sub-satellite points
      const L = 34 / g.pxPerUnit;
      subs.forEach((s, i) => g.arrow(s.x, s.y, s.x + s.hx * L, s.y + s.hy * L, { color: COL[i], width: 2, head: 8 }));
      // error ellipse (magnified when it would be invisible)
      let note = '';
      if (cov.observable) {
        const a = cov.ellipse.semiMajor / 1000, b = cov.ellipse.semiMinor / 1000;
        const px = a * g.pxPerUnit;
        const k = px < 30 ? niceFactor(40 / Math.max(px, 1e-9)) : 1;
        g.ellipse(0, 0, a * k, b * k, cov.ellipse.angle, { color: '--estimate', width: 2, fill: '--estimate', fillAlpha: 0.12 });
        note = `95 % error ellipse drawn ${k > 1 ? `magnified \u00d7${fmt(k, 3)}` : 'to scale'}; true semi-axes ${fmtDist(cov.ellipse.semiMajor)} \u00d7 ${fmtDist(cov.ellipse.semiMinor)}.`;
      } else {
        note = 'No error ellipse: these measurements cannot fix the position.';
        g.text(0, 0, 'no fix', { dx: 12, dy: -14, color: '--critical', size: 12, weight: 600 });
      }
      if (ellNote.textContent !== note) ellNote.textContent = note;
      // mirror fix
      if (mirror) {
        g.circle(mirror.x, mirror.y, 10, { color: '--estimate', width: 2 });
        g.text(mirror.x, mirror.y, 'mirror crossing', { dx: 14, dy: 0, size: 12 });
      }
      const items = [];
      if (set.use.tdoa) items.push({ label: 'iso-TDOA through E', color: '--tdoa', width: 2.4 });
      if (set.use.fdoa) items.push({ label: 'iso-FDOA through E', color: '--fdoa', width: 2.4 });
      items.push({ label: 'B solid, C dashed, D dotted', color: '--plot-text', width: 1 });
      items.push({ label: 'Below a collector\u2019s horizon', color: '--muted', fill: true });
      g.legend(items, { position: 'bottom-left' });
    };

    let hoverF = null, hoverKey = '';
    plot.onHover = (x, y) => {
      if (!D) return null;
      const key = `${geomKey()}|${state.t}`;
      if (key !== hoverKey) { hoverF = scenario.mapField(D.S, D.t); hoverKey = key; }
      const v = hoverF(x * 1000, y * 1000);
      if (!v) return `${x.toFixed(0)} km E, ${y.toFixed(0)} km N\nbeyond the limb`;
      const lines = [`${x.toFixed(0)} km E, ${y.toFixed(0)} km N`];
      for (let i = 1; i < D.S.n; i++) {
        lines.push(`\u03c4${'ABCD'[i]}A ${fmt(v.tdoa[i] * 1e6, 6)} \u00b5s   \u03bd${'ABCD'[i]}A ${fmt(v.fdoa[i], 5)} Hz`);
      }
      if (v.minElevation < 0) lines.push('a collector is below the horizon');
      return lines.join('\n');
    };

    function updateMapHandles() {
      const { subs } = D;
      colHandles.forEach((h, i) => {
        const s = subs[i];
        h.visible = !!s;
        if (s) { h.x = s.x; h.y = s.y; }
      });
      plot.requestRedraw();
    }

    function setMapHalf(half) {
      viewCtl.value = half;
      plot.setView({ xmin: -half, xmax: half, ymin: -half, ymax: half });
    }

    // ------------------------------------------------------------ CEP chart
    cepPlot.onDraw = (g) => {
      if (!series || !D) return;
      const v = g.view;
      // grey where a collector is below 5 degrees
      for (let k = 0; k < series.length; k++) {
        if (series[k].allVisible) continue;
        const t0 = Math.max(T_MIN, series[k].t - 6), t1 = Math.min(T_MAX, series[k].t + 6);
        g.polygon([[t0, v.ymin], [t1, v.ymin], [t1, v.ymax], [t0, v.ymax]], { fill: '--muted', fillAlpha: 0.18, stroke: false });
      }
      const pts = series.map((p) => [p.t, p.cep50 > 0 ? p.cep50 : NaN]);
      g.line(pts, { color: '--series-1', width: 2 });
      g.segment(D.t, v.ymin, D.t, v.ymax, { color: '--plot-text', width: 1, dash: [4, 3] });
      if (D.cov.observable) {
        g.marker(D.t, D.cov.cep50, 'circle', 5, { color: '--series-1' });
        g.text(D.t, D.cov.cep50, `CEP ${fmtDist(D.cov.cep50)}`, { dx: 8, dy: -10, size: 12 });
      } else {
        g.text(D.t, Math.sqrt(v.ymin * v.ymax), 'no fix', { dx: 6, size: 12, color: '--critical' });
      }
      if (!series.some((p) => p.cep50 > 0)) g.text(0, Math.sqrt(v.ymin * v.ymax), 'No fix at any time with this measurement set', { align: 'center', size: 13 });
    };
    function computeSeries() {
      const set = curSet();
      const key = `${geomKey()}|${state.setIdx}`;
      if (key === seriesKey && series) return;
      const S = scenarioFor(state, set.use);
      series = scenario.passSeries(S, PASS_TIMES);
      seriesKey = key;
      const ok = series.map((p) => p.cep50).filter((x) => x > 0);
      if (ok.length) {
        const lo = Math.pow(10, Math.floor(Math.log10(Math.min(...ok)))), hi = Math.pow(10, Math.ceil(Math.log10(Math.max(...ok)) + 1e-9));
        cepPlot.setView({ xmin: T_MIN, xmax: T_MAX, ymin: lo, ymax: Math.max(hi, lo * 10) });
      }
      cepPlot.requestRedraw();
    }

    // ------------------------------------------------------------ DOP chart
    dopPlot.onDraw = (g) => {
      if (!sweep || !D) return;
      const tdoaH = sweep.map((s) => [s.L, s.d.tdoa3d ? s.d.tdoa3d.h : NaN]);
      const tdoaV = sweep.map((s) => [s.L, s.d.tdoa3d ? s.d.tdoa3d.v : NaN]);
      const surf = sweep.map((s) => [s.L, s.d.tdoaSurface ?? NaN]);
      g.line(tdoaH, { color: '--tdoa', width: 2.2 });
      g.line(tdoaV, { color: '--tdoa', width: 2.2, dash: [7, 5] });
      g.line(surf, { color: '--series-3', width: 2.2 });
      const v = g.view, L = state.baselineKm;
      g.segment(L, v.ymin, L, v.ymax, { color: '--plot-text', width: 1, dash: [4, 3] });
      const d = D.dops;
      const clampY = (y) => Math.min(v.ymax, Math.max(v.ymin, y));
      if (d.tdoa3d) {
        g.marker(L, clampY(d.tdoa3d.h), 'circle', 5, { color: '--tdoa' });
        g.marker(L, clampY(d.tdoa3d.v), 'square', 5, { color: '--tdoa' });
      }
      if (d.tdoaSurface != null) g.marker(L, clampY(d.tdoaSurface), 'circle', 5, { color: '--series-3' });
      g.text(L, v.ymax, `${L.toFixed(0)} km`, { dx: 4, dy: 10, size: 11, baseline: 'top' });
      if (D.S.n < 4) g.text(Math.sqrt(v.xmin * v.xmax), Math.sqrt(v.ymin * v.ymax) * 6, 'A TDOA-only 3-D fix needs 4 collectors: choose a 4-ball formation', { align: 'center', size: 13 });
      g.legend([
        { label: 'TDOA, free 3-D: HDOP', color: '--tdoa', width: 2.2 },
        { label: 'TDOA, free 3-D: VDOP', color: '--tdoa', width: 2.2, dash: [7, 5] },
        { label: 'TDOA + surface: HDOP', color: '--series-3', width: 2.2 },
      ], { position: 'top-right' });
    };
    function computeSweep() {
      sweep = dopSweep(state, state.t, DOP_BASELINES);
      const ys = [];
      for (const s of sweep) {
        if (s.d.tdoa3d) ys.push(s.d.tdoa3d.h, s.d.tdoa3d.v);
        if (s.d.tdoaSurface != null) ys.push(s.d.tdoaSurface);
      }
      const ok = ys.filter((y) => y > 0 && Number.isFinite(y));
      if (ok.length) {
        const lo = Math.pow(10, Math.floor(Math.log10(Math.min(...ok))));
        const hi = Math.min(1e8, Math.pow(10, Math.ceil(Math.log10(Math.max(...ok)) + 1e-9)));
        dopPlot.setView({ xmin: 30, xmax: 2000, ymin: lo, ymax: Math.max(hi, lo * 100) });
      }
      dopPlot.requestRedraw();
    }

    // ------------------------------------------------------------ observability table
    const KIND_LABEL = { tdoa: 'TDOA only', fdoa: 'FDOA only', both: 'TDOA + FDOA' };
    const cellText = (c) => (c.observable ? `CEP ${fmtDist(c.cep)}, \u03c3U ${fmtDist(c.sigmaU)}` : 'no fix');
    function computeTable() {
      const shape4 = shapeN(state.shape) === 4 ? state.shape : 'tri+1';
      const rows = observabilityTable(state, state.t, shape4);
      const set = curSet();
      const setKind = set.use.tdoa && set.use.fdoa ? 'both' : set.use.tdoa ? 'tdoa' : 'fdoa';
      obsTable.setRows(rows.map((r) => ({
        balls: `${r.n} (${SHAPES.find((s) => s.value === r.shape).label.replace(/ \(\d\)$/, '').toLowerCase()})`,
        meas: KIND_LABEL[r.kind],
        eq: `${r.eq} / ${r.eq + 1}`,
        free: cellText(r.free),
        surf: cellText(r.surface),
        highlight: r.n === set.n && r.kind === setKind,
      })));
      const note = `Computed at t = ${signed(state.t, 0)} s, baseline ${state.baselineKm} km, ground track ${state.overhead ? 'overhead' : '400 km east'}; the 4-ball rows use the ${shape4} formation. Unknowns: 3. The highlighted row contains the measurement set selected under the map.`;
      if (tableNote.textContent !== note) tableNote.textContent = note;
    }

    let slowTimer = 0;
    function scheduleSlow(ms = 260) {
      cancel(slowTimer);
      slowTimer = later(() => { computeSeries(); computeTable(); computeSweep(); }, ms);
    }

    // ------------------------------------------------------------ globe
    let globe = null;
    createGlobe(globeHost, { height: 470 }).then((g) => {
      if (!alive) { g.dispose(); return; }
      globe = g;
      globeNote.textContent = '';
      globeNote.style.display = 'none';
      updateGlobe();
      fitGlobe(false);
    }).catch(() => {
      if (alive) globeNote.textContent = 'The 3-D view could not start (WebGL or the three.js library is unavailable). Everything else on this page works without it; the map below shows the same lines of position.';
    });

    function fitGlobe(animate) {
      if (!globe || !D) return;
      globe.fit([D.S.emitter.ecef, ...D.obs.collectors.map((c) => c.rEcef)], { animate });
    }

    function updateGlobeLines() {
      if (!globe) return;
      globe.setPolylines('lop', state.showLop ? globeLines.map((l) => ({
        points: l.points, color: l.kind === 'tdoa' ? '--tdoa' : '--fdoa', width: 2.2, opacity: 0.95,
      })) : []);
    }

    function updateGlobe() {
      if (!globe || !D) return;
      const { S, obs, geo, times, cov, set } = D;
      globe.setEmitter({ ecef: S.emitter.ecef, label: 'E', color: '--emitter' });
      globe.setSatellites(geo.collectors.map((c, i) => ({ id: c.id, ecef: c.ecef, velEcef: c.velEcef, label: c.id, color: COL[i] })));
      globe.setPolylines('los', obs.collectors.map((c, i) => ({ points: [S.emitter.ecef, c.rEcef], color: COL[i], width: 1.2, dashed: true, opacity: 0.8 })));
      globe.setPolylines('tracks', S.ids.map((_, i) => ({ points: scenario.trackEcef(S, i, times), color: COL[i], width: 1.4, opacity: 0.6 })));
      // hyperboloid sheets, foci at the reception positions
      for (let i = 1; i < 4; i++) {
        let mesh = null;
        if (state.showHyp && i < S.n) {
          const Fi = obs.collectors[i].rEcef, Fr = obs.collectors[S.cfg.ref].rEcef;
          const d = distToLine(S.emitter.ecef, Fi, Fr);
          mesh = scenario.hyperboloidMesh(Fi, Fr, C * obs.tdoa[i], { extent: Math.max(3e5, 1.35 * d), nu: 32, nphi: 64 });
        }
        globe.setMesh(`hyp-${i}`, mesh ? { ...mesh, color: '--tdoa', opacity: 0.18, doubleSided: true } : null);
      }
      updateGlobeLines();
      // 3-D ellipsoid
      let ellTxt = state.showEll ? 'off (no fix)' : 'off';
      if (state.showEll && cov.observable) {
        const sAx = cov.ellipsoid.semiAxes;
        const maxLen = Math.max(...sAx.map((v) => Math.hypot(v[0], v[1], v[2])));
        const k = niceFactor(80e3 / Math.max(maxLen, 1e-6));
        globe.setEllipsoid('ell', { center: S.emitter.ecef, axes: sAx, scale: k, color: '--estimate', opacity: 0.3 });
        ellTxt = k >= 1 ? `\u00d7${fmt(k, 3)} (${set.label.split(' \u2014 ')[1]})` : `\u00d7${fmt(k, 3)}, i.e. shrunk (${set.label.split(' \u2014 ')[1]})`;
      } else {
        globe.setEllipsoid('ell', null);
      }
      globeRo.set({ ell: ellTxt });
    }

    // ------------------------------------------------------------ change handling
    function refreshLight() {
      refreshDerived();
      updateReadouts();
      updateMapHandles();
      updateGlobe();
      cepPlot.requestRedraw();
      dopPlot.requestRedraw();
    }
    function changed(what) {
      refreshLight();
      requestFields();
      if (what !== 'time' || !state.playing) scheduleSlow();
    }

    function setTime(v) {
      state.t = Math.max(T_MIN, Math.min(T_MAX, Math.round(v)));
      timeCtlA.value = state.t;
      timeCtlB.value = state.t;
      changed('time');
    }
    function setShape(v) {
      state.shape = v;
      shapeCtl.value = v;
      const n = shapeN(v);
      if (SETS[state.setIdx].n !== n) {
        state.setIdx = n === 2 ? 0 : n === 3 ? 2 : 5;
        setCtl.value = state.setIdx;
      }
      changed('geom');
    }
    function setSet(idx) {
      state.setIdx = idx;
      setCtl.value = idx;
      const n = SETS[idx].n;
      if (shapeN(state.shape) !== n) {
        state.shape = n === 2 ? 'pair' : n === 3 ? 'triangle' : 'tri+1';
        shapeCtl.value = state.shape;
      }
      changed('geom');
    }
    function applyDemo(patch) {
      setPlaying(false);
      Object.assign(state, patch, { t: 0, setIdx: 3, showEll: true });
      shapeCtl.value = state.shape;
      baselineCtl.value = state.baselineKm;
      passCtl.value = state.overhead ? 'over' : 'east';
      timeCtlA.value = 0; timeCtlB.value = 0;
      setCtl.value = 3;
      ellCtl.value = true;
      changed('geom');
      if (globe) fitGlobe(true);
    }

    // play / pause
    let playTimer = 0;
    function setPlaying(on) {
      state.playing = on;
      playA.setLabel(on ? 'Pause' : 'Play');
      playB.setLabel(on ? 'Pause' : 'Play');
      if (playTimer) { clearInterval(playTimer); playTimer = 0; }
      if (on) {
        playTimer = setInterval(() => {
          if (!alive) return;
          let t = state.t + 2;
          if (t > T_MAX) t = T_MIN;
          setTime(t);
        }, 80);
      } else {
        scheduleSlow(120);
      }
    }

    // ------------------------------------------------------------ initial render
    refreshLight();
    computeFields(false);
    computeSeries();
    computeTable();
    computeSweep();

    // ------------------------------------------------------------ cleanup
    return () => {
      alive = false;
      if (playTimer) clearInterval(playTimer);
      if (fieldRaf) cancelAnimationFrame(fieldRaf);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      root.removeEventListener('click', onLinkClick);
      plot.destroy();
      cepPlot.destroy();
      dopPlot.destroy();
      if (globe) { globe.dispose(); globe = null; }
      root.classList.remove('o3d');
      if (ownStyle && styleEl.parentNode) styleEl.remove();
    };
  },
};

/** Table of the default per-collector noise settings. */
function noiseTable(n) {
  const row = (name, val, what) => el('tr', null, el('td', null, name), el('td', null, val), el('td', null, what));
  return el('table', null, el('tbody', null,
    row('Time of arrival', fmtSI(n.sigmaToa, 's'), 'measurement noise on each collector\u2019s arrival time'),
    row('Clock sync', fmtSI(n.sigmaClock, 's'), 'error of each collector\u2019s time tag'),
    row('Frequency of arrival', fmtSI(n.sigmaFoa, 'Hz'), 'measurement noise on each received frequency'),
    row('Oscillator', fmt(n.sigmaLo, 2), 'fractional frequency-reference error (\u00d7 f\u2080 = 1 GHz)'),
    row('Ephemeris position', fmtDist(n.sigmaPos), 'per axis, how well each collector\u2019s position is known'),
    row('Ephemeris velocity', `${fmtDist(n.sigmaVel)}/s`, 'per axis'),
    row('Terrain height', fmtDist(n.sigmaAlt), 'uncertainty of the Earth-surface constraint'),
  ));
}
