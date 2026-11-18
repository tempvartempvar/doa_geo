/**
 * 08-physics.js - "Real physics: light-time, Sagnac, relativity, atmosphere".
 *
 * One scenario panel (sticky on large screens) drives the whole page. Every number in the text is a live
 * readout computed from the core for the reader's scenario:
 *   - scenario.effectsTable : the cost (TDOA, FDOA, fix bias) of omitting each effect
 *   - scenario.covariance   : the random-error CEP used as the yardstick
 *   - scenario.truthObservation / measure.observe : per-collector delays, Sagnac, atmosphere, Doppler
 *   - measure.clockRate on orbits.keplerState states : relativistic clock rates
 *   - atmosphere.troposphereDelay / ionosphereDelay : the elevation and frequency laws
 * This file only converts units, draws, and arranges text.
 */
import { scenario, measure, orbits, constants, frames, atmosphere } from '../core/index.js';
import { Plot2D } from '../ui/plot2d.js';
import { slider, toggle, select, readout, controlGroup, dataTable, fmt, fmtSI, fmtDist } from '../ui/controls.js';
import { el, lessonHeader, section, figure, callout, takeaways, nextLesson, lessonLink } from '../ui/layout.js';
import { questionSet } from '../ui/quiz.js';
import { diagram } from '../ui/diagrams.js';
import QUESTIONS from './questions.js';

const { C, GM, DEG, WGS84_A, OMEGA_E } = constants;

const VAC = { ...measure.FULL_MODEL, shapiro: false, troposphere: false, ionosphere: false };
const FIRST_ORDER = { ...measure.FULL_MODEL, dopplerExact: false };
const COLORS = ['--collector-a', '--collector-b', '--collector-c', '--collector-d'];
const SHAPES = [
  { value: 'pair', label: 'pair (2 collectors)' },
  { value: 'triangle', label: 'triangle (3)' },
  { value: 'tri+1', label: 'tri+1 (4)' },
  { value: 'diamond', label: 'diamond (4)' },
  { value: 'string', label: 'string (4)' },
];
/** Which section explains each effects-table row. */
const SECTION_OF = {
  instant: 'light', sagnac: 'sagnac', doppler2: 'doppler', shapiro: 'clock', tropo: 'tropo',
  iono: 'iono', clock: 'clock', motion: 'dwarf', altitude: 'dwarf', carrier: 'doppler',
};
/** Carriers for the bias-versus-frequency chart. */
const SWEEP_F = [1e8, 2e8, 5e8, 1e9, 2e9, 5e9, 1e10, 3e10];

const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fT = (s) => fmtSI(s, 's', 2);           // a time difference
const fF = (hz) => fmtSI(hz, 'Hz', 2);        // a frequency difference
const fM = (m) => (m == null ? 'no fix' : fmtDist(m, 2));
const fGHz = (f) => fmtSI(f, 'Hz', 3);
const pct = (b, cep) => (b == null || !cep ? '—' : `${fmt(100 * b / cep, 2)} %`);
const signed = (s) => (s > 0 ? '+' : '') + s;
/** Live text placeholder inside prose; filled by setLive(). */
const L = (k) => `<span class="ph8-live" data-k="${k}">—</span>`;

const STYLE = `
.ph8 .ph8-panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 10px 14px 12px; box-shadow: var(--shadow); }
.ph8 .ph8-panel-head { display: flex; align-items: center; gap: 6px 12px; flex-wrap: wrap; }
.ph8 .ph8-panel-title { font-weight: 650; font-size: 14px; }
.ph8 .ph8-summary { flex: 1; min-width: 0; font-size: 12.5px; color: var(--text-2); font-family: var(--font-mono);
  font-variant-numeric: tabular-nums; }
.ph8 .ph8-panel-body { display: grid; grid-template-columns: repeat(auto-fill, minmax(185px, 1fr)); gap: 8px 20px; margin-top: 8px; }
.ph8 .ph8-panel.collapsed .ph8-panel-body { display: none; }
.ph8 .ph8-panel .ctrl { font-size: 13px; gap: 2px; }
.ph8 .ph8-meas { display: grid; gap: 4px; font-size: 13px; }
.ph8 .ph8-meas-row { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.ph8 .ph8-meas .ctrl-label { font-size: 13px; }
.ph8 .ph8-banner { border-left: 3px solid var(--warning); background: var(--surface); padding: 8px 12px; font-size: 14px;
  border-radius: var(--radius-sm); max-width: var(--measure); line-height: 1.5; }
.ph8 .ph8-banner.crit { border-left-color: var(--critical); }
.ph8 .ph8-bar { position: relative; overflow: hidden; height: 14px; min-width: 130px; background: var(--surface-2); border-radius: 3px; }
.ph8 .ph8-bar-fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); border-radius: 3px; }
.ph8 .ph8-bar-fill.over { background: var(--critical); }
.ph8 .ph8-bar-ref { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--text); }
.ph8 .ph8-bar-na { font-size: 12.5px; color: var(--muted); }
.ph8 .ph8-live { font-variant-numeric: tabular-nums; font-weight: 600; }
.ph8 .ph8-note { font-size: 13px; color: var(--text-2); max-width: var(--measure); line-height: 1.55; }
.ph8 .ph8-rowlink { color: var(--text); text-decoration: none; border-bottom: 1px dotted var(--muted); }
.ph8 .ph8-rowlink:hover { color: var(--accent); border-bottom-color: var(--accent); }
.ph8 .ph8-verdict { border: 2px solid var(--accent); border-radius: var(--radius); padding: 14px 18px; background: var(--accent-soft);
  max-width: var(--measure); }
.ph8 .ph8-verdict h3 { font-size: 16px; margin: 0 0 8px; }
.ph8 .ph8-verdict p { margin: 0 0 8px; line-height: 1.6; font-size: 15.5px; }
.ph8 .ph8-verdict p:last-child { margin-bottom: 0; }
.ph8 .lesson-section { scroll-margin-top: 72px; }
.ph8 .tex-display, .ph8 .katex-display, .ph8 .katex { position: relative; } /* keep KaTeX's hidden MathML inside its scroll box */
.ph8 .ph8-collapse { padding: 3px 10px; min-height: 0; font-size: 12.5px; }
@media (min-width: 900px) and (min-height: 700px) {
  .ph8 .ph8-panel { position: sticky; top: calc(var(--topbar-h) + 8px); z-index: 20; }
  .ph8 .lesson-section { scroll-margin-top: 270px; }
}
`;

export default {
  id: 'physics',
  title: 'Real physics: light-time, Sagnac, relativity, atmosphere',

  mount(root, ctx) {
    // ------------------------------------------------------------ state
    const state = {
      f0: 1e9, shape: 'tri+1', baselineKm: 150, altKm: 550, t: 0, vtec: 20,
      use: { tdoa: true, fdoa: true, altitude: true },
    };
    let M = null;               // latest computed model (see compute())
    let raf = 0, sweepTimer = 0, destroyed = false;
    let sweep = { key: null, pts: [], done: false };

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    root.classList.add('ph8');

    const cfgOf = (f0) => scenario.defaultConfig({
      emitter: { f0 },
      formation: { shape: state.shape, baselineKm: state.baselineKm },
      orbit: { altKm: state.altKm },
      t: state.t,
      use: { ...state.use },
      env: { iono: { vtec: state.vtec } },
    });

    // Reference orbits for the clock-rate table: circular, from orbits.keplerState (state at the node).
    const circ = (a, incDeg) => orbits.keplerState({ a, e: 0, i: incDeg * DEG, raan: 0, argp: 0, M0: 0 }, 0);
    const rateOf = (s) => measure.clockRate(s.r, s.v) - 1;
    const REF = {
      leo: rateOf(circ(WGS84_A + 550e3, 53)),
      gps: rateOf(circ(26560e3, 55)),
      geo: rateOf(circ(42164.17e3, 0)),
    };
    // Largest Sagnac term for a satellite at the horizon of an equatorial emitter, both in the equatorial plane.
    const emEq = frames.geodeticToEcef(0, 0, 0);
    const sagnacMax = (a) => {
      const th = Math.acos(WGS84_A / a);
      return measure.sagnacDelay(emEq, [a * Math.cos(th), a * Math.sin(th), 0]);
    };
    const SAG_GPS = sagnacMax(26560e3);

    // ------------------------------------------------------------ physics (all from the core)
    function compute() {
      const S = scenario.buildScenario(cfgOf(state.f0));
      const t = state.t, f0 = state.f0, env = S.cfg.env, ref = S.cfg.ref;
      const fx = scenario.effectsTable(S, t);
      const R = Object.fromEntries(fx.map((r) => [r.key, r]));
      const cov = scenario.covariance(S, t);
      const cep = cov.observable ? cov.cep50 : null;
      const obs = scenario.truthObservation(S, t);
      const obsVac = measure.observe(S.emitter, S.trajs, t, { model: VAC, env, ref });
      const obs1 = measure.observe(S.emitter, S.trajs, t, { model: FIRST_ORDER, env, ref });
      const te = obs.te;
      const ve = norm(frames.stateEcefToEci(S.emitter.ecef, S.emitter.velEcef, te).v);
      const cRef = obs.collectors[ref];
      // Inertial positions, expressed in axes that coincide with ECEF at the emission time, then local ENU.
      const toEnuI = (r) => S.map.toEnu(frames.eciToEcef(r, te));
      const cols = obs.collectors.map((c, i) => {
        const v = norm(c.vEci);
        const cv = obsVac.collectors[i];
        const dVac = Math.hypot(cv.rEcef[0] - S.emitter.ecef[0], cv.rEcef[1] - S.emitter.ecef[1], cv.rEcef[2] - S.emitter.ecef[2]);
        return {
          id: S.ids[i], color: COLORS[i], delay: c.delay, v, travel: v * c.delay,
          sagnac: c.sagnac, dSag: c.sagnac - cRef.sagnac, tropo: c.tropo, iono: c.iono, shapiro: c.shapiro,
          dop: c.dopplerShift, el: c.elevation / DEG, visible: c.visible,
          pStart: toEnuI(S.trajs[i].state(te).r), pEnd: toEnuI(c.rEci),
          rate: measure.clockRate(c.rEci, c.vEci) - 1, alt: frames.heightOf(c.rEcef),
          dop2: c.freq - obs1.collectors[i].freq, bound: (ve * v / (C * C)) * f0,
          sagRes: cv.delay - dVac / C - cv.sagnac,
          ecc: S.elements[i].e, a: S.elements[i].a,
        };
      });
      const emStart = toEnuI(frames.ecefToEci(S.emitter.ecef, te));
      const emEnd = toEnuI(frames.ecefToEci(S.emitter.ecef, te + cRef.delay));
      const scenOrbitRate = rateOf(circ(WGS84_A + state.altKm * 1e3, 53));
      return { S, fx, R, cov, cep, obs, cols, ve, emStart, emEnd, ref, f0, scenOrbitRate };
    }

    // ------------------------------------------------------------ scenario panel
    const summary = el('span', 'ph8-summary');
    const panelBody = el('div', 'ph8-panel-body');
    const collapseBtn = el('button', { class: 'btn btn-ghost ph8-collapse', type: 'button', 'aria-expanded': 'true' }, 'Hide controls');
    const panel = el('div', { class: 'ph8-panel', role: 'region', 'aria-label': 'Scenario for this page' },
      el('div', 'ph8-panel-head', el('span', 'ph8-panel-title', 'Your scenario'), summary, collapseBtn),
      panelBody);
    collapseBtn.addEventListener('click', () => {
      const c = panel.classList.toggle('collapsed');
      collapseBtn.textContent = c ? 'Show controls' : 'Hide controls';
      collapseBtn.setAttribute('aria-expanded', String(!c));
    });

    const changed = (heavy = true) => { if (heavy) schedule(); };
    const f0Ctl = slider({ label: 'Carrier $f_0$', min: 1e8, max: 3e10, log: true, value: state.f0, format: (v) => fGHz(v),
      onInput: (v) => { state.f0 = v; changed(); } });
    const shapeCtl = select({ label: 'Formation', options: SHAPES, value: state.shape,
      onChange: (v) => { state.shape = v; changed(); } });
    const baseCtl = slider({ label: 'Baseline', min: 30, max: 2000, log: true, value: state.baselineKm, unit: 'km',
      hint: 'Size of the formation: the spacing of the collectors.',
      format: (v) => v.toFixed(0), onInput: (v) => { state.baselineKm = v; changed(); } });
    const altCtl = slider({ label: 'Orbit altitude', min: 400, max: 1500, step: 10, value: state.altKm, unit: 'km',
      format: (v) => v.toFixed(0), onInput: (v) => { state.altKm = v; changed(); } });
    const tCtl = slider({ label: 'Time in pass', min: -240, max: 240, step: 5, value: state.t, unit: 's',
      hint: 'Seconds from the formation\'s closest approach to the emitter.',
      format: (v) => signed(v.toFixed(0)), onInput: (v) => { state.t = v; changed(); } });
    const vtecCtl = slider({ label: 'Ionosphere VTEC', min: 1, max: 150, log: true, value: state.vtec, unit: 'TECU',
      hint: 'Vertical total electron content: free electrons in a 1 m² column straight up. 1 TECU = 10¹⁶ per m².',
      format: (v) => (v < 10 ? v.toFixed(1) : v.toFixed(0)), onInput: (v) => { state.vtec = v; changed(); } });
    const useTdoa = toggle({ label: 'TDOA', value: true, onChange: (v) => { state.use.tdoa = v; changed(); } });
    const useFdoa = toggle({ label: 'FDOA', value: true, onChange: (v) => { state.use.fdoa = v; changed(); } });
    const useAlt = toggle({ label: 'Altitude constraint', value: true, hint: 'Use the emitter\'s known height as one more measurement.',
      onChange: (v) => { state.use.altitude = v; changed(); } });
    panelBody.append(f0Ctl.el, shapeCtl.el, baseCtl.el, altCtl.el, tCtl.el, vtecCtl.el,
      el('div', 'ph8-meas', el('span', 'ctrl-label', 'Measurements in the fix'),
        el('div', 'ph8-meas-row', useTdoa.el, useFdoa.el, useAlt.el)));

    root.append(
      lessonHeader({
        kicker: 'Part III · Lesson 8',
        title: 'Real physics: light-time, Sagnac, relativity, atmosphere',
        lede: 'A satellite collection is a millisecond event in which everything moves, the Earth turns, clocks tick at different rates and the atmosphere delays whatever passes through it. After this lesson you can say, for your own scenario and with numbers, which of these effects a geolocation processor must model and which it may ignore.',
      }),
      panel,
    );

    // ------------------------------------------------------------ section 0: master table
    const banner = el('div', 'ph8-banner');
    const effectsTbl = dataTable({
      caption: 'What it costs to ignore each effect (truth: full model; processor: full model minus that one item; no noise)',
      columns: [
        { key: 'label', label: 'Effect', format: (v, r) => rowLink(r) },
        { key: 'maxTdoa', label: 'Largest TDOA change', align: 'right', format: (v, r) => r.tdoaTxt },
        { key: 'maxFdoa', label: 'Largest FDOA change', align: 'right', format: (v, r) => r.fdoaTxt },
        { key: 'bias', label: 'Horizontal fix bias', align: 'right', format: (v, r) => r.biasTxt },
        { key: 'pct', label: 'Bias / CEP', align: 'right' },
        { key: 'bar', label: 'Bias, log scale 1 mm – 10 km (line = CEP)', format: (v, r) => biasBar(r.b, M && M.cep) },
      ],
      rows: [],
    });
    const detailTbl = dataTable({
      caption: 'Per collector, for the wavefront received by the reference collector at the chosen time',
      columns: [
        { key: 'id', label: 'Collector' },
        { key: 'el', label: 'Elevation', unit: '°', align: 'right' },
        { key: 'tof', label: 'Time of flight', unit: 'ms', align: 'right' },
        { key: 'travel', label: 'Moves during flight', unit: 'm', align: 'right' },
        { key: 'sag', label: 'Sagnac term', unit: 'ns', align: 'right' },
        { key: 'tropo', label: 'Troposphere', unit: 'm', align: 'right' },
        { key: 'iono', label: 'Ionosphere (group)', unit: 'm', align: 'right' },
        { key: 'shap', label: 'Shapiro', unit: 'mm', align: 'right' },
        { key: 'dop', label: 'Doppler shift', unit: 'Hz', align: 'right' },
      ],
      rows: [],
    });

    function rowLink(r) {
      const target = SECTION_OF[r.key];
      return el('a', {
        class: 'ph8-rowlink', href: `#/physics`,
        onclick: (e) => { e.preventDefault(); const s = root.querySelector(`#ph8-${target}`); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
      }, r.label);
    }
    function biasBar(b, cep) {
      if (b == null) return el('span', 'ph8-bar-na', 'no fix possible');
      const pos = (v) => clamp((Math.log10(Math.max(v, 1e-9)) + 3) / 7, 0, 1) * 100;
      const bar = el('div', { class: 'ph8-bar', role: 'img', 'aria-label': `bias ${fmtDist(b, 2)}` });
      bar.append(el('div', { class: `ph8-bar-fill${cep && b >= cep ? ' over' : ''}`, style: { width: `${b > 0 ? pos(b) : 0}%` } }));
      if (cep) bar.append(el('div', { class: 'ph8-bar-ref', style: { left: `${pos(cep)}%` }, title: `CEP ${fmtDist(cep, 2)}` }));
      return bar;
    }

    const s0 = section('What it costs to ignore each effect',
      String.raw`<p>Every row of this table is one numerical experiment. The simulator generates the measurements with
      its <strong>full</strong> physical model: light-time, Earth rotation, exact Doppler, Shapiro delay, troposphere and
      ionosphere (each has its own section below). A geolocation <strong>processor</strong>, the software that turns
      measurements into a position, then solves for the emitter with a model that is perfect except for
      <strong>one</strong> missing item. There is no noise at all, so whatever error remains in the fix is caused by that
      one omission: it is a <strong>bias</strong>. The columns give the largest change the omission makes to any
      TDOA ($\tau_{iA}$, collector $i$ against the reference collector A) and any FDOA
      ($\nu_{iA}$), and how far it moves the horizontal position fix.</p>
      <p>The yardstick is the random error: the bar's vertical line marks the CEP (radius containing 50 % of fixes) from
      this scenario's error budget, ${L('cep')}. A deterministic bias is not like noise: it is the same in every snapshot
      (one collection, at one instant),
      so it <strong>does not average away</strong> when you combine many measurements. A bias that is 10 % of the CEP
      today is the whole error after a hundred snapshots have beaten the noise down. Click an effect to jump to its
      explanation. The last three rows are not physics but knowledge errors, for comparison.</p>`,
      banner, effectsTbl,
      el('p', 'ph8-note', 'Bias / CEP compares the horizontal bias with the horizontal 50 % radius of the random error. A "0" means the engine produces no change at all in that measurement type by construction (for example, a clock-rate offset does not alter arrival times). Red bars are biases at least as large as the CEP.'),
      detailTbl,
      el('p', 'ph8-note', 'Moves during flight = collector inertial speed × time of flight. Sagnac term = the amount by which the true light-time exceeds the straight-line Earth-fixed distance divided by c (section 2). Troposphere and ionosphere are excess group paths; Shapiro is the gravitational excess path. Doppler shift is the received minus the transmitted carrier.'),
    );
    root.append(s0);

    // ------------------------------------------------------------ section 1: light-time
    const ltHost = el('div');
    const ltRo = readout([
      { key: 'tofA', label: 'Time of flight to A', unit: 'ms' },
      { key: 'travelA', label: 'A moves during it', unit: 'm' },
      { key: 've', label: 'Emitter inertial speed', unit: 'm/s', hint: 'Earth rotation at this latitude' },
      { key: 'emShift', label: 'Emitter moves (until A receives)', unit: 'm' },
      { key: 'vc', label: 'Max $|\\mathbf v_i|/c$', unit: '', hint: 'Fastest collector\'s speed as a fraction of the speed of light' },
      { key: 'instT', label: 'Freeze-at-one-time: $\\Delta\\tau$', unit: '', hint: 'Largest change in any TDOA if every position is taken at a single instant' },
      { key: 'instB', label: '… fix bias', unit: '' },
    ]);
    const s1 = section('1 · Finite light-time',
      String.raw`<p>From low orbit the signal is in flight for ${L('tofRange')}. Light covers 0.30 m per nanosecond, and
      in those milliseconds things move by far more: each collector, at about ${L('vMax')}, travels ${L('travelRange')}
      while the wavefront is on its way, and, seen from a non-rotating frame, the Earth's rotation carries the emitter
      ${L('emShift')} (it moves at ${L('ve')} at this latitude; 465 m/s at the equator).</p>
      <p>So "where was everything?" has a different answer for each participant. The emitter must be taken where it
      was when the wavefront <em>left</em>, at the emission time $t_e$. Each collector must be taken where it is when
      that same wavefront <em>arrives</em>, at its own reception time $t_i$, which differs from collector to collector
      by the TDOA itself (up to ${L('tdoaMax')} here).</p>`,
      diagram('lighttime'),
      figure({
        plot: ltHost,
        controls: [controlGroup('Light-time', [ltRo])],
        caption: String.raw`Seen from above (local east/north, km, in the inertial frame frozen at $t_e$). Dashed lines: the
        rays from the emission event to each reception event. Faint triangles: where each collector was when the
        wavefront left the emitter; solid triangles: where it is when the wavefront reaches it. <strong>The displacement
        arrows are exaggerated</strong> by the factor printed on the plot so that they are visible at all; the emitter's
        own displacement is drawn with the same factor.`,
      }),
      callout('math', 'The light-time equation and how it is solved', String.raw`
        $$t_i = t_e + \frac{\lVert \mathbf r_i(t_i) - \mathbf r_e(t_e)\rVert}{c}$$
        <p>Here $\mathbf r_e(t_e)$ is the emitter's position at the emission time and $\mathbf r_i(t_i)$ is collector
        $i$'s position at its own reception time, both in the inertial frame; the double bars are the distance
        between them. (Excess paths from the atmosphere and gravity are added in sections 4 to 6.) The equation is
        <strong>implicit</strong> in $t_i$:
        the collector's position depends on the time you are trying to find. Fixed-point iteration solves it: start with
        a guess for the delay, evaluate $\mathbf r_i$ there, recompute the delay, repeat. Each pass shrinks the error by
        the factor $\hat{\mathbf n}_i\cdot\mathbf v_i/c$, where $\hat{\mathbf n}_i$ is the unit vector along the ray
        from the emitter to collector $i$ and $\mathbf v_i$ is the collector's velocity; that factor is at most
        $|\mathbf v_i|/c$ = ${L('vc')}. Starting from zero delay, the
        error after one, two and three passes is at most about ${L('iter1')}, ${L('iter2')} and ${L('iter3')}: three passes are
        already far below anything measurable. The simulator keeps iterating until the change is below $10^{-18}$ s.</p>`),
      callout('caution', 'The naive alternative', String.raw`<p>Freeze every position at one time tag and divide the
        straight-line distance by $c$. That is the first row of the table: it changes the TDOAs by up to ${L('instT')}
        and the FDOAs by up to ${L('instF')}, and moves the fix by ${L('instB')} (${L('instP')} of the CEP).</p>`),
    );
    s1.id = 'ph8-light';
    root.append(s1);

    // ------------------------------------------------------------ section 2: Sagnac
    const sagTbl = dataTable({
      columns: [
        { key: 'id', label: 'Collector' },
        { key: 'east', label: 'East of emitter', unit: 'km', align: 'right' },
        { key: 'sag', label: 'Sagnac term', unit: 'ns', align: 'right' },
        { key: 'dsag', label: 'Minus reference', unit: 'ns', align: 'right' },
      ],
      rows: [],
    });
    const s2 = section('2 · Earth rotation during the flight: the Sagnac effect',
      String.raw`<p>The light-time equation holds in a <strong>non-rotating</strong> (inertial) frame: only there does light
      travel in straight lines at $c$. Positions, however, usually arrive in ECEF (Earth-centred, Earth-fixed)
      coordinates, which turn with the Earth. If you take
      the straight-line ECEF distance between emitter and collector and divide by $c$, you have treated a rotating frame
      as if it were inertial. During the flight the Earth turns, and the true path is longer or shorter than the ECEF
      distance by</p>
      $$\Delta t = \frac{\omega_E}{c^2}\,\big(x_e\,y_c - y_e\,x_c\big) = \frac{2\,\boldsymbol\omega_E\cdot\mathbf A}{c^2},$$
      <p>where $\Delta t$ is the extra travel time, $\omega_E = 7.292\times10^{-5}$ rad/s is the Earth's rotation rate
      ($\boldsymbol\omega_E$ is the same thing as a vector along the rotation axis), and $(x_e, y_e)$ and $(x_c, y_c)$
      are the equatorial-plane ECEF coordinates of the emitter and the collector. $\mathbf A$ is the area vector
      of the triangle Earth-centre, emitter, collector: a vector at right angles to the triangle whose length is the
      triangle's area (nothing to do with collector A). Only the projection of that triangle onto the equatorial plane
      counts. The term is positive (a longer path) when the collector is east of the emitter. The reason: the Earth
      turns eastward, so at the moment of emission the emitter was further west, in inertial space, than its Earth-fixed
      coordinates place it at the moment of reception; seen from a collector to the east, the true path is longer.</p>
      <p>For a single link it is a few nanoseconds from LEO (low Earth orbit; up to ${L('sagLeo')} for a satellite at this altitude on the
      horizon of an equatorial emitter, and up to ${L('sagGps')} for a GPS satellite). TDOA only sees the
      <strong>difference</strong> between collectors, which is smaller for a tight cluster and larger for a wide one:</p>`,
      sagTbl,
      String.raw`<p>Here the largest difference from the reference is ${L('sagDiff')}; omitting the correction changes the
      TDOAs by up to ${L('sagT')} and moves the fix by ${L('sagB')} (${L('sagP')} of the CEP). Increase the baseline to see
      the differences grow.</p>`,
      callout('idea', 'The simulator contains no Sagnac term, and that is the point', String.raw`<p>The core solves the
        light-time equation in the inertial frame, where the effect is automatically included; there is nothing to
        add. The table row shows the mistake a processor makes if it works in ECEF and forgets the correction. The term
        is first order in $v/c$ and is "relativistic" only in the sense that it expresses that light travels at $c$ in the
        inertial frame, not in the rotating one.</p>
        <p>The closed form above is itself a first-order expression. Compared with the exact inertial solution (vacuum,
        this scenario), it is off by at most ${L('sagRes')}, against Sagnac terms of nanoseconds. That femtosecond
        agreement (about 1 to 5 fs) holds for LEO; the second-order residual grows to about 0.2 ps for MEO (medium
        Earth orbit, where GPS flies) and 0.8 ps for GEO (geostationary orbit). Separately, the engine has been cross-checked against an independent 50-digit re-derivation
        (<code>tools/crosscheck.py</code>): delays and TDOAs agree to $2\times10^{-17}$ s, frequency ratios to
        $8\times10^{-16}$, and FDOAs to $4\times10^{-7}$ Hz at 1 GHz, for LEO, MEO and GEO collectors.</p>`),
    );
    s2.id = 'ph8-sagnac';
    root.append(s2);

    // ------------------------------------------------------------ section 3: exact Doppler
    const dopTbl = dataTable({
      columns: [
        { key: 'id', label: 'Collector' },
        { key: 'dop', label: 'Doppler shift', unit: 'Hz', align: 'right' },
        { key: 'd2', label: 'Exact minus first-order', unit: 'Hz', align: 'right' },
        { key: 'bound', label: '$f_0\\,v_e v_i/c^2$', unit: 'Hz', align: 'right' },
      ],
      rows: [],
    });
    const s3 = section('3 · Exact Doppler',
      String.raw`<p>The received frequency is the rate at which emitted cycles arrive, $f_i = f_0\,dt_e/dt_i$:
      the transmitted frequency $f_0$ times the rate at which emission time advances per second of reception time.
      Differentiating the light-time equation gives it exactly (vacuum):</p>
      $$\frac{f_i}{f_0} = \frac{1-\hat{\mathbf n}_i\cdot\mathbf v_i/c}{1-\hat{\mathbf n}_i\cdot\mathbf v_e/c},$$
      <p>with $\hat{\mathbf n}_i$ the unit vector from the emitter to collector $i$, $\mathbf v_e$ the emitter's
      <strong>inertial</strong> velocity at emission (including the Earth's rotation, ${L('ve2')} here) and
      $\mathbf v_i$ the collector's velocity at reception. Expanding to first order gives the familiar
      $f_0(1-\dot\rho_i/c)$ of Part I, with $\dot\rho_i$ the range rate. The next term is of order $(v_e/c)(v_i/c)$
      (the two speeds as fractions of $c$), at most a few $\times10^{-11}$, i.e. at most a
      few hundredths of a hertz per gigahertz on one link:</p>`,
      dopTbl,
      String.raw`<p>The last column is the size scale $f_0 v_e v_i/c^2$ (both speeds fully along the line of sight); the
      actual terms are smaller because only line-of-sight components enter. In an FDOA, much of the term is common to
      both collectors and cancels: using first-order Doppler changes the FDOAs by up to ${L('d2F')} and moves the fix by
      ${L('d2B')} (${L('d2P')} of the CEP).</p>`,
      callout('idea', 'Why the unknown carrier hardly matters', String.raw`<p>The emitter's carrier $f_0$ is not known
        exactly, and its oscillator has its own rate. Both multiply every $f_i$ by the same factor. A processor therefore
        forms FDOA from the <strong>ratio</strong> of received frequencies, $\nu_{iA} = f_A\,(f_i/f_A - 1)$, using the
        carrier actually received at A as the scale. The geometry lives in the ratio; the carrier only sets the scale. The
        "${L('carrierLabel')}" row confirms it: an error of one part per million in the assumed carrier changes the
        FDOAs by up to ${L('carF')} and moves the fix by ${L('carB')}.</p>`),
    );
    s3.id = 'ph8-doppler';
    root.append(s3);

    // ------------------------------------------------------------ section 4: clocks
    const clkTbl = dataTable({
      caption: 'Clock rates of the scenario’s collectors (from measure.clockRate at reception)',
      columns: [
        { key: 'id', label: 'Collector' },
        { key: 'alt', label: 'Altitude', unit: 'km', align: 'right' },
        { key: 'rate', label: '$d\\tau/dt - 1$', align: 'right' },
        { key: 'day', label: 'Per day', unit: 'µs', align: 'right' },
        { key: 'drate', label: 'Minus reference', align: 'right' },
        { key: 'dhz', label: '… at $f_0$', unit: 'Hz', align: 'right' },
      ],
      rows: [],
    });
    const orbTbl = dataTable({
      caption: 'Reference circular orbits (states from orbits.keplerState, rates from measure.clockRate)',
      columns: [
        { key: 'name', label: 'Orbit' },
        { key: 'rate', label: '$d\\tau/dt - 1$', align: 'right' },
        { key: 'day', label: 'Per day', unit: 'µs', align: 'right' },
        { key: 'hz', label: 'Offset at $f_0$', unit: 'Hz', align: 'right' },
      ],
      rows: [],
    });
    const verdict = el('div', { class: 'ph8-verdict', role: 'note' });
    const s4 = section('4 · Relativity proper: clock rates, Shapiro delay',
      String.raw`<p>In this section only, $\tau$ is not a TDOA: it is a clock's own <strong>proper time</strong>, the
      time that clock itself shows, and $t$ is coordinate time, the time shown by a good clock at rest on the geoid
      (mean sea level). $d\tau/dt$ is therefore the clock's rate: 1 means it keeps step with the ground. It is</p>
      $$\frac{d\tau}{dt} = 1 + \frac{W_0 - U}{c^2} - \frac{v^2}{2c^2},$$
      <p>where $U$ is the gravitational potential at the clock (including the Earth's oblateness), $W_0$ the potential of
      the geoid and $v$ the clock's inertial speed. The second term is the gravitational blue-shift of a clock higher up
      (it runs fast); the third is time dilation (a moving clock runs slow). In low orbit time dilation wins; higher up
      gravity wins:</p>`,
      orbTbl, clkTbl,
      String.raw`<h3>What this does to geolocation</h3>
      <p><strong>Time tags.</strong> A LEO clock set once and left alone would drift by ${L('leoDay')} per day relative to
      the ground, ${L('leoKm')} of range per day. Nobody flies collectors like that: they are steered continuously to GNSS
      time (the time kept by navigation satellite systems such as GPS), which already contains these corrections. What TDOA suffers from is the <em>residual</em> synchronisation
      error, an item in the error budget of the next lesson, not relativity.</p>
      <p><strong>Frequency.</strong> An oscillator that free-runs on its own proper time reads every frequency with a
      fractional offset equal to its rate offset. FDOA sees only the <strong>difference</strong> between two collectors.
      In this formation the largest altitude difference is ${L('altDiff')} and the largest rate difference
      ${L('rateDiff')}, i.e. ${L('rateHz')} at $f_0$; the "relativistic clock rates" row (free-running oscillators,
      processor assuming coordinate time) moves the fix by ${L('clkB')}. Mixed altitudes are another matter: a LEO (550 km)
      and a GEO collector differ by ${L('leoGeo')} in rate, ${L('leoGeoHz')} at $f_0$. GPS-disciplined oscillators are
      steered to coordinate time and show none of this.</p>
      <p><strong>Orbit eccentricity</strong> adds a periodic clock term of amplitude $2e\sqrt{GM\,a}/c^2$, where $e$
      is the orbit's eccentricity (how far from circular it is), $a$ its semi-major axis (half its longest diameter)
      and $GM = 3.986\times10^{14}$ m³/s² the Earth's gravitational parameter:
      ${L('eccNs')} per 0.001 of eccentricity at this altitude${L('eccD')}. GNSS steering absorbs it as well.</p>
      <p><strong>Shapiro delay.</strong> Gravity also slows the light itself, adding a path</p>
      $$\Delta_{\text{Shapiro}} = \frac{2GM}{c^2}\,\ln\frac{r_e + r_c + \rho}{r_e + r_c - \rho}$$
      <p>where $r_e$ and $r_c$ are the distances of the emitter and the collector from the Earth's centre and $\rho$
      is the range between them (the time delay is this path divided by $c$): ${L('shapRange')} per link here, changing the TDOAs by up to
      ${L('shapT')} and the fix by ${L('shapB')}. The bending of the ray by gravity is far smaller still.</p>`,
      verdict,
    );
    s4.id = 'ph8-clock';
    root.append(s4);

    // ------------------------------------------------------------ section 5: troposphere
    const atmHost = el('div');
    const tropoRo = readout([
      { key: 'zen', label: 'Zenith excess path', unit: 'm', hint: 'Extra path length for a ray going straight up' },
      { key: 'at5', label: 'At 5° elevation', unit: 'm' },
      { key: 'ratio', label: 'Ratio', unit: '' },
      { key: 'dTropo', label: 'Largest difference from A', unit: 'm' },
      { key: 'tropoT', label: 'Omitting it: $\\Delta\\tau$', unit: '' },
      { key: 'tropoF', label: '… $\\Delta\\nu$', unit: '' },
      { key: 'tropoB', label: '… fix bias', unit: '' },
    ]);
    const s5 = section('5 · Troposphere',
      String.raw`<p>The neutral atmosphere slows radio waves slightly, as if the path were a little longer: the
      <strong>excess path</strong>. It is about ${L('zen')} at the zenith (straight up)
      for an emitter at this height (mostly the dry, hydrostatic part, plus some water vapour), and grows roughly as
      $1/\sin(\text{elevation})$ because a ray at a low elevation (angle above the horizon) crosses more air: at 5° it is ${L('ratio')} times the zenith value. It is
      <strong>non-dispersive</strong> at radio frequencies, meaning that the delay does not depend on frequency: it
      delays the envelope (the signal's modulation, which is what TDOA measures) and the carrier
      phase (whose rate of change is what FDOA measures) by the same amount.</p>
      <p>What matters is not the delay itself but how it differs. TDOA sees the <strong>difference</strong> between
      collectors' delays, which comes from their different elevations; FDOA sees the <strong>rate of change</strong> of
      each delay as the collectors' elevations change during the pass.</p>`,
      figure({
        plot: atmHost,
        controls: [controlGroup('Troposphere', [tropoRo])],
        caption: String.raw`Excess path versus elevation for this scenario's emitter (log scale): troposphere
        (<code>atmosphere.troposphereDelay</code>) and, for comparison, the ionospheric group path at the chosen carrier and
        VTEC (<code>atmosphere.ionosphereDelay</code>). Triangles mark the collectors' current elevations.`,
      }),
    );
    s5.id = 'ph8-tropo';
    root.append(s5);

    // ------------------------------------------------------------ section 6: ionosphere
    const sweepHost = el('div');
    const ionoRo = readout([
      { key: 'l1', label: '1 TECU at 1.575 GHz, zenith', unit: '' },
      { key: 'vhf', label: '1 TECU at 100 MHz, zenith', unit: '' },
      { key: 'here', label: '1 TECU at $f_0$, zenith', unit: '' },
      { key: 'dIono', label: 'Largest difference from A', unit: '' },
      { key: 'ionoT', label: 'Omitting it: $\\Delta\\tau$', unit: '' },
      { key: 'ionoF', label: '… $\\Delta\\nu$', unit: '' },
      { key: 'ionoB', label: '… fix bias', unit: '' },
    ]);
    const s6 = section('6 · Ionosphere',
      String.raw`<p>The ionosphere is a plasma (a gas of free electrons and ions), and a plasma is
      <strong>dispersive</strong>: its delay depends on frequency. The excess path of the signal's envelope (the
      "group" path) is</p>
      $$I = \frac{40.3\,\text{STEC}}{f^2}\ \text{m}\qquad(\text{STEC in electrons/m}^2),$$
      <p>where $f$ is the carrier frequency in hertz and STEC, the slant total electron content, is the number of free
      electrons in a column of 1 m² cross-section along the slanting signal path. It equals the vertical content
      (VTEC, the same count straight up) times an obliquity factor, which is larger than 1 for a slanting path. One TEC
      unit (TECU, $10^{16}$ electrons/m²) at the zenith is ${L('l1')} at 1.575 GHz (GPS L1), ${L('vhf')} at 100 MHz and ${L('here')}
      at your carrier. With ${L('vtec')} the collectors see ${L('ionoRange')} of excess path.</p>
      <p>Crucially, the ionosphere <strong>delays the envelope but advances the carrier phase</strong> by the same
      amount: the group velocity (at which the envelope travels) is below $c$ and the phase velocity (at which the
      carrier's wave crests travel) is above it. TDOA is measured on the envelope and FDOA on
      the phase rate, so the ionosphere enters them with <strong>opposite signs</strong>. Because $I \propto 1/f^2$, the
      TDOA term scales as $1/f^2$ and the FDOA term in hertz as $1/f$ (the rate of a path change times $f/c$); both
      scalings hold in the simulator to a fraction of a percent, as you can check by changing the carrier. The resulting
      position bias falls roughly as $1/f^2$ (not exactly, because the weighting of TDOA against FDOA also shifts with
      the carrier, see below): negligible at 10 GHz, dominant at VHF and UHF (tens to hundreds of megahertz).</p>`,
      figure({
        plot: sweepHost,
        controls: [controlGroup('Ionosphere', [ionoRo])],
        caption: String.raw`Horizontal fix bias versus carrier for the ionosphere, troposphere and unmodelled-emitter-motion
        rows of the table, with this scenario's other settings (effectsTable at eight carriers, recomputed when you
        change anything but the carrier). Dashed: the random-error CEP at each carrier. Vertical line: your carrier.`,
      }),
      callout('caution', 'Why the troposphere and motion curves are not flat', String.raw`<p>The tropospheric delay is
        the same at every frequency, yet its curve is not perfectly flat. The reason is the fix, not the delay: the error
        budget gives every collector a fixed frequency-measurement noise in hertz, which is a smaller range-rate error at a
        higher carrier, so the solution leans more on FDOA as $f_0$ grows. A bias that enters TDOA and FDOA differently
        therefore lands differently as the weighting shifts. Compare the ranges: across this chart the ionosphere curve
        spans ${L('ionoSpan')}, the troposphere curve ${L('tropoSpan')}.</p>`),
      callout('idea', 'What real systems do', String.raw`<p>Real processors take the ionosphere from global TEC maps, or
        measure it with two carriers (the $1/f^2$ law makes the difference of two group delays proportional to STEC).
        A LEO collector flies inside the topside ionosphere and sees only the electrons below it; the VTEC control here
        is that partial content.</p>`),
    );
    s6.id = 'ph8-iono';
    root.append(s6);

    // ------------------------------------------------------------ section 7: what dwarfs it
    const s7 = section('7 · What dwarfs all of the above',
      String.raw`<p>Put the physics in proportion with the last rows of the table, which are not physics at all:</p>
      <ul>
        <li><strong>Unmodelled emitter motion.</strong> FDOA assumes a stationary emitter. One emitter moving at
        1 m/s east changes the FDOAs by up to ${L('motF')} and moves the fix by ${L('motB')} (${L('motP')} of the CEP).
        ${L('motCmp')}</li>
        <li><strong>Terrain height.</strong> An emitter altitude wrong by 30 m in the surface constraint moves the fix by
        ${L('altB')}. ${L('altNote')}</li>
        <li><strong>Collector errors.</strong> Clock synchronisation, oscillator frequency and ephemeris errors are the
        subject of the ${L('labLink')}. With the default budget (per collector: 20 ns and 0.05 Hz of measurement noise,
        5 ns of clock error, $2\times10^{-11}$ oscillator error, 1 m and 5 mm/s of ephemeris error) they make up the CEP of
        ${L('cep2')}.</li>
      </ul>`,
    );
    s7.id = 'ph8-dwarf';
    // the lab link is a real navigation link
    root.append(s7);

    // ------------------------------------------------------------ section 8: not modelled
    root.append(section('What this simulator does not model',
      String.raw`<p>Being specific about the gaps is part of knowing the error budget:</p>
      <ul>
        <li><strong>Orbits are two-body Keplerian</strong> (no $J_2$, the effect of the Earth's equatorial bulge, and no drag or third bodies). This is irrelevant to the
        measurement physics: geolocation uses each collector's position and velocity at the instant of reception, and
        those are self-consistent here to floating-point precision, whatever orbit produced them.</li>
        <li><strong>No precession, nutation, polar motion or UT1</strong> (the slow wobbles of the Earth's axis and the
        small irregularities of its rotation). They change where the axes point, not the physics
        of a millisecond flight.</li>
        <li><strong>The ionosphere is a single thin layer with uniform VTEC.</strong> Real differential delays between
        nearby collectors depend on TEC gradients and can be larger or smaller than here. No scintillation (rapid
        flickering caused by small-scale irregularities). No
        second-order ($1/f^3$) terms or ray bending, which reach metres at 100 MHz and low elevation and are negligible
        above about 1 GHz.</li>
        <li><strong>The troposphere model is climatological</strong> (fixed zenith delays and a simple mapping function),
        good to roughly 5 to 10 % above 5° elevation.</li>
        <li><strong>No multipath, terrain masking, antenna phase-centre or hardware group-delay errors.</strong> No carrier
        phase wind-up: on circularly polarised links the relative rotation of the antennas adds a carrier-independent
        frequency offset of order millihertz.</li>
        <li><strong>Time scales.</strong> Propagation uses geocentric inertial-frame coordinate time (like TCG,
        geocentric coordinate time), while
        clock rates are normalised to the geoid (TT, terrestrial time); UTC differs from TT only by a constant offset and leap seconds. The
        constant $7\times10^{-10}$ TCG/TT rate difference rescales all frequencies equally and is immaterial to FDOA, and
        none of these distinctions matters for time differences taken over a fraction of a second.</li>
        <li><strong>The emitter's oscillator is assumed stable over the snapshot</strong>, and the variation of delay and
        Doppler within the integration window is not simulated (the ${L('cafLink')} lesson discusses it).</li>
      </ul>`,
    ));

    root.append(
      questionSet(QUESTIONS['physics']),
      takeaways([
        'Do the geometry in the inertial frame: the emitter where it was at emission, each collector where it is at its own reception. Ignoring the light-time costs metres from LEO.',
        'The Sagnac correction is what you must add if you compute ranges in Earth-fixed coordinates; solved in the inertial frame it is automatically included. It is nanoseconds per link, and its difference between collectors grows with the baseline.',
        'Exact versus first-order Doppler differs by order $(v_e/c)(v_i/c)$; FDOA is a ratio of received frequencies, so the unknown carrier only sets the scale.',
        'Relativistic clock rates are tens of microseconds per day, but GNSS-steered clocks absorb them. They matter for free-running oscillators at different altitudes; Shapiro delay is a millimetre.',
        'Troposphere (non-dispersive) and ionosphere (dispersive, $1/f^2$, opposite signs in TDOA and FDOA) are metre-level effects at gigahertz carriers; the ionosphere grows to hundreds of metres at VHF.',
        'At gigahertz carriers an emitter moving at walking pace (when FDOA is in the fix), or a terrain height error of tens of metres, outweighs all of the propagation physics.',
      ]),
      nextLesson(ctx, 'lab'),
    );

    // replace the two link placeholders with real navigation links
    for (const [k, id, label] of [['labLink', 'lab', 'next lesson, the collection lab'], ['cafLink', 'caf', 'cross-ambiguity function']]) {
      root.querySelectorAll(`[data-k="${k}"]`).forEach((n) => n.replaceWith(lessonLink(ctx, id, label)));
    }
    const live = new Map();
    root.querySelectorAll('.ph8-live[data-k]').forEach((n) => {
      const k = n.dataset.k;
      if (!live.has(k)) live.set(k, []);
      live.get(k).push(n);
    });
    const setLive = (o) => {
      for (const k in o) for (const n of live.get(k) || []) if (n.textContent !== o[k]) n.textContent = o[k];
    };

    // ------------------------------------------------------------ plots
    const ltPlot = new Plot2D(ltHost, {
      height: 420, equalAspect: true, view: { xmin: -100, xmax: 700, ymin: -300, ymax: 300 },
      xLabel: 'East (km)', yLabel: 'North (km)',
      ariaLabel: 'Plan view of the emission event, the reception events and the collectors’ displacements during the flight.',
    });
    const atmPlot = new Plot2D(atmHost, {
      height: 320, yLog: true, view: { xmin: 0, xmax: 90, ymin: 0.5, ymax: 100 },
      xLabel: 'Elevation of the collector seen from the emitter (°)', yLabel: 'Excess path (m)',
      ariaLabel: 'Tropospheric and ionospheric excess path versus elevation.',
    });
    const sweepPlot = new Plot2D(sweepHost, {
      height: 340, xLog: true, yLog: true, view: { xmin: 8e7, xmax: 3.5e10, ymin: 1e-3, ymax: 1e3 },
      xLabel: 'Carrier frequency (Hz)', yLabel: 'Horizontal fix bias (m)',
      ariaLabel: 'Position bias versus carrier frequency for ionosphere, troposphere and emitter motion.',
    });

    let ltK = 1, ltViewKey = null;
    ltPlot.onDraw = (g) => {
      if (!M) return;
      const { cols, emStart, emEnd } = M;
      const km = (p) => [p[0] / 1000, p[1] / 1000];
      const K = ltK;
      const E0 = km(emStart);
      const dE = [(emEnd[0] - emStart[0]) * K / 1000, (emEnd[1] - emStart[1]) * K / 1000];
      cols.forEach((c) => {
        const end = km(c.pEnd);
        const d = [(c.pEnd[0] - c.pStart[0]) * K / 1000, (c.pEnd[1] - c.pStart[1]) * K / 1000];
        const ghost = [end[0] - d[0], end[1] - d[1]];
        g.segment(E0[0], E0[1], end[0], end[1], { color: c.color, width: 1.25, dash: [5, 4], alpha: 0.75 });
        g.marker(ghost[0], ghost[1], 'triangle', 7, { color: c.color, alpha: 0.35 });
        g.arrow(ghost[0], ghost[1], end[0], end[1], { color: c.color, width: 2 });
        g.marker(end[0], end[1], 'triangle', 9, { color: c.color });
        g.text(end[0], end[1], `${c.id}: ${fmt(c.travel, 3)} m in ${(c.delay * 1e3).toFixed(3)} ms`, { dx: 0, dy: 12, size: 11.5, baseline: 'top', align: 'center' });
      });
      g.arrow(E0[0], E0[1], E0[0] + dE[0], E0[1] + dE[1], { color: '--emitter', width: 2, head: 7 });
      g.marker(E0[0], E0[1], 'diamond', 9, { color: '--emitter' });
      g.text(E0[0], E0[1], `E  moves ${fmt(norm([emEnd[0] - emStart[0], emEnd[1] - emStart[1], emEnd[2] - emStart[2]]), 2)} m (Earth rotation)`,
        { dx: -8, dy: 14, size: 11.5, baseline: 'top', align: 'left' });
      g.text(g.view.xmin, g.view.ymax, `displacements × ${ltK.toLocaleString('en-US')}`,
        { dx: 10, dy: 12, size: 12, weight: 600, baseline: 'top' });
    };

    atmPlot.onDraw = (g) => {
      if (!M) return;
      const S = M.S;
      const xs = []; for (let e = 0.5; e <= 90.001; e += 0.5) xs.push(e);
      const tro = xs.map((e) => [e, atmosphere.troposphereDelay(e * DEG, S.emitter.altM, S.cfg.env.tropo)]);
      const ion = xs.map((e) => [e, atmosphere.ionosphereDelay(e * DEG, state.f0, S.cfg.env.iono)]);
      g.line(tro, { color: '--series-6', width: 2.25 });
      g.line(ion, { color: '--series-8', width: 2.25, dash: [7, 4] });
      M.cols.forEach((c) => {
        if (c.el <= 0) return;
        g.marker(c.el, c.tropo, 'triangle', 8, { color: c.color });
        g.marker(c.el, c.iono, 'triangle', 8, { color: c.color });
      });
      g.legend([
        { label: 'Troposphere', color: '--series-6', width: 2.25 },
        { label: `Ionosphere (group), ${fGHz(state.f0)}, ${fmt(state.vtec, 2)} TECU`, color: '--series-8', width: 2.25, dash: [7, 4] },
      ], { position: 'top-right' });
    };
    atmPlot.onHover = (x) => {
      if (!M || x <= 0 || x > 90) return null;
      const S = M.S;
      return `elevation ${x.toFixed(1)}°\ntroposphere ${fmtDist(atmosphere.troposphereDelay(x * DEG, S.emitter.altM, S.cfg.env.tropo), 3)}\nionosphere ${fmtDist(atmosphere.ionosphereDelay(x * DEG, state.f0, S.cfg.env.iono), 3)}`;
    };

    sweepPlot.onDraw = (g) => {
      const pts = sweep.pts;
      const series = [
        { k: 'iono', color: '--series-8', label: 'Ionosphere' },
        { k: 'tropo', color: '--series-6', label: 'Troposphere' },
        { k: 'motion', color: '--series-4', label: 'Emitter moving 1 m/s' },
      ];
      g.segment(state.f0, g.view.ymin, state.f0, g.view.ymax, { color: '--accent', width: 1.25, dash: [3, 3] });
      if (pts.length) {
        g.line(pts.map((p) => [p.f, p.cep ?? NaN]), { color: '--plot-text', width: 1.5, dash: [6, 4] });
        for (const s of series) {
          const line = pts.map((p) => [p.f, p[s.k] > 0 ? p[s.k] : NaN]);
          g.line(line, { color: s.color, width: 2.25 });
          line.forEach(([x, y]) => { if (Number.isFinite(y)) g.marker(x, y, 'circle', 4, { color: s.color }); });
        }
      }
      if (!sweep.done) g.text(g.view.xmin, g.view.ymax, sweep.pts.length ? 'computing…' : 'computing the sweep…', { dx: 10, dy: 12, size: 12, baseline: 'top' });
      else if (!pts.some((p) => p.iono != null)) g.text(g.view.xmin, g.view.ymax, 'No fix possible with these measurements', { dx: 10, dy: 12, size: 12, baseline: 'top' });
      g.legend([
        ...series.map((s) => ({ label: s.label, color: s.color, width: 2.25 })),
        { label: 'Random-error CEP', color: '--plot-text', width: 1.5, dash: [6, 4] },
      ], { position: 'bottom-left' });
    };
    sweepPlot.onHover = (x) => {
      if (!sweep.pts.length) return null;
      let best = sweep.pts[0];
      for (const p of sweep.pts) if (Math.abs(Math.log(p.f / x)) < Math.abs(Math.log(best.f / x))) best = p;
      return `${fGHz(best.f)}\nionosphere ${fM(best.iono)}\ntroposphere ${fM(best.tropo)}\nmotion ${fM(best.motion)}\nCEP ${fM(best.cep)}`;
    };

    // ------------------------------------------------------------ frequency sweep (debounced, chunked)
    const sweepKey = () => JSON.stringify([state.shape, state.baselineKm, state.altKm, state.t, state.vtec, state.use]);
    function scheduleSweep() {
      const key = sweepKey();
      if (sweep.key === key && sweep.done) { sweepPlot.requestRedraw(); return; }
      clearTimeout(sweepTimer);
      sweep = { key: null, pts: [], done: false };
      sweepPlot.requestRedraw();
      sweepTimer = setTimeout(() => runSweep(key), 300);
    }
    function runSweep(key) {
      const pts = [];
      let k = 0;
      const step = () => {
        if (destroyed || sweepKey() !== key) return;
        const f = SWEEP_F[k];
        const S = scenario.buildScenario(cfgOf(f));
        const R = Object.fromEntries(scenario.effectsTable(S, state.t).map((r) => [r.key, r]));
        const cov = scenario.covariance(S, state.t);
        pts.push({ f, iono: R.iono.biasHoriz, tropo: R.tropo.biasHoriz, motion: R.motion.biasHoriz, cep: cov.observable ? cov.cep50 : null });
        k++;
        sweep = { key, pts: pts.slice(), done: k === SWEEP_F.length };
        if (sweep.done) fitSweepView();
        sweepPlot.requestRedraw();
        if (k < SWEEP_F.length) sweepTimer = setTimeout(step, 0);
        else updateSpans();
      };
      step();
    }
    function fitSweepView() {
      const ys = [];
      for (const p of sweep.pts) for (const v of [p.iono, p.tropo, p.motion, p.cep]) if (v > 0) ys.push(v);
      if (!ys.length) return;
      const lo = Math.pow(10, Math.floor(Math.log10(Math.min(...ys)) - 0.3));
      const hi = Math.pow(10, Math.ceil(Math.log10(Math.max(...ys)) + 0.3));
      sweepPlot.setView({ xmin: 8e7, xmax: 3.5e10, ymin: lo, ymax: hi });
    }

    // ------------------------------------------------------------ update
    function schedule() {
      if (raf) return;
      // A short timer rather than rAF: it coalesces bursts of slider events and still runs in background tabs.
      raf = setTimeout(() => { raf = 0; if (!destroyed) update(); }, 16);
    }

    function updateSpans() {
      if (!M) return;
      const span = (k) => {
        const v = sweep.pts.map((p) => p[k]).filter((x) => x > 0);
        if (!sweep.done || v.length < 2) return '—';
        return `${fmtDist(Math.min(...v), 2)} to ${fmtDist(Math.max(...v), 2)}`;
      };
      setLive({ ionoSpan: span('iono'), tropoSpan: span('tropo') });
    }

    function update() {
      M = compute();
      const { S, R, cep, cols, ve, f0 } = M;
      const ref = cols[M.ref];
      const fixOk = M.cov.observable;
      const dash = '—';

      // summary line
      summary.textContent = `${fGHz(f0)} · ${state.shape}, ${state.baselineKm.toFixed(0)} km · ${state.altKm.toFixed(0)} km alt · t = ${signed(state.t.toFixed(0))} s · ${fmt(state.vtec, 2)} TECU · CEP ${cep ? fmtDist(cep, 3) : 'no fix'}`;

      // banner
      const below = cols.filter((c) => c.el <= 0).map((c) => c.id);
      const low = cols.filter((c) => c.el > 0 && c.el < 10).map((c) => c.id);
      const msgs = [];
      if (!fixOk) msgs.push('No fix is possible with these measurements in this geometry (the fix columns show "no fix"); add a measurement type or change the formation. The measurement changes are still shown.');
      if (below.length) msgs.push(`Collector${below.length > 1 ? 's' : ''} ${below.join(', ')} ${below.length > 1 ? 'are' : 'is'} below the emitter's horizon at this time and could not hear it; the numbers are computed geometrically all the same, but no real collection would produce them.`);
      else if (low.length) msgs.push(`Collector${low.length > 1 ? 's' : ''} ${low.join(', ')} ${low.length > 1 ? 'are' : 'is'} below 10° elevation, where the atmospheric terms grow quickly.`);
      banner.hidden = !msgs.length;
      banner.className = `ph8-banner${!fixOk || below.length ? ' crit' : ''}`;
      banner.textContent = msgs.join(' ');

      // master table
      effectsTbl.setRows(M.fx.map((r) => {
        const b = !fixOk ? null : (r.key === 'altitude' && !state.use.altitude ? 0 : r.biasHoriz);
        const na = r.key === 'altitude' && !state.use.altitude;
        return {
          key: r.key, label: r.label, b: na ? null : b,
          tdoaTxt: r.maxTdoa === 0 ? '0' : fT(r.maxTdoa),
          fdoaTxt: r.maxFdoa === 0 ? '0' : fF(r.maxFdoa),
          biasTxt: na ? 'n/a (constraint off)' : fM(b),
          pct: na ? dash : pct(b, cep),
          className: na ? 'ph8-na' : null,
        };
      }));
      detailTbl.setRows(cols.map((c) => ({
        id: c.id, el: c.el.toFixed(1), tof: (c.delay * 1e3).toFixed(4), travel: c.travel.toFixed(2),
        sag: fmt(c.sagnac * 1e9, 3), tropo: c.tropo.toFixed(2), iono: fmt(c.iono, 3), shap: (c.shapiro * 1e3).toFixed(3),
        dop: fmt(c.dop, 5),
      })));

      // section 1
      const tofs = cols.map((c) => c.delay), travels = cols.map((c) => c.travel);
      const vMax = Math.max(...cols.map((c) => c.v));
      const emShift = norm([M.emEnd[0] - M.emStart[0], M.emEnd[1] - M.emStart[1], M.emEnd[2] - M.emStart[2]]);
      const vc = vMax / C;
      const range = (a, f) => (Math.min(...a) === Math.max(...a) ? f(a[0]) : `${f(Math.min(...a))} to ${f(Math.max(...a))}`);
      const tdoaMax = Math.max(...cols.map((c) => Math.abs(c.delay - ref.delay)));
      const bOf = (k) => (fixOk ? R[k].biasHoriz : null);
      ltRo.set({
        tofA: (ref.delay * 1e3).toFixed(4), travelA: ref.travel.toFixed(2), ve: ve.toFixed(1), emShift: emShift.toFixed(2),
        vc: fmt(vc, 2), instT: fT(R.instant.maxTdoa), instB: fM(bOf('instant')),
      });
      // Displacement exaggeration: a 1-2-5 factor that makes the largest collector displacement ~7 % of the view.
      const xs = [0, ...cols.map((c) => c.pEnd[0] / 1000)], ys = [0, ...cols.map((c) => c.pEnd[1] / 1000)];
      const spanKm = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 50);
      const want = 0.07 * spanKm * 1000 / Math.max(...cols.map((c) => Math.hypot(c.pEnd[0] - c.pStart[0], c.pEnd[1] - c.pStart[1])), 1e-6);
      const p10 = Math.pow(10, Math.floor(Math.log10(want)));
      ltK = [5, 2, 1].map((m) => m * p10).find((v) => v <= want) || p10;
      const pad = 0.18 * spanKm;
      const geomKey = JSON.stringify([state.shape, state.baselineKm, state.altKm, state.t]);
      if (geomKey !== ltViewKey) {
        ltViewKey = geomKey;
        ltPlot.setView({ xmin: Math.min(...xs) - pad, xmax: Math.max(...xs) + 1.6 * pad, ymin: Math.min(...ys) - pad, ymax: Math.max(...ys) + pad });
      }
      const iterErr = (k) => fT(Math.max(...tofs) * Math.pow(vc, k));

      // section 2 / 3 / 4 / 5 / 6 tables
      sagTbl.setRows(cols.map((c, i) => ({
        id: c.id, east: (S.map.toEnu(M.obs.collectors[i].rEcef)[0] / 1000).toFixed(1),
        sag: fmt(c.sagnac * 1e9, 4), dsag: i === M.ref ? '0 (reference)' : fmt(c.dSag * 1e9, 3), highlight: false,
      })));
      dopTbl.setRows(cols.map((c) => ({ id: c.id, dop: fmt(c.dop, 6), d2: fmt(c.dop2, 2), bound: fmt(c.bound, 2) })));
      const day = (k) => fmt(k * 86400e6, 3);
      clkTbl.setRows(cols.map((c, i) => ({
        id: c.id, alt: (c.alt / 1000).toFixed(2), rate: fmt(c.rate, 4), day: day(c.rate),
        drate: i === M.ref ? '0 (reference)' : fmt(c.rate - ref.rate, 2), dhz: i === M.ref ? dash : fF((c.rate - ref.rate) * f0),
      })));
      orbTbl.setRows([
        { name: 'LEO, 550 km', rate: fmt(REF.leo, 4), day: day(REF.leo), hz: fF(REF.leo * f0) },
        { name: `This scenario’s orbit, ${state.altKm.toFixed(0)} km`, rate: fmt(M.scenOrbitRate, 4), day: day(M.scenOrbitRate), hz: fF(M.scenOrbitRate * f0), highlight: true },
        { name: 'GPS, a = 26 560 km', rate: fmt(REF.gps, 4), day: day(REF.gps), hz: fF(REF.gps * f0) },
        { name: 'GEO, a = 42 164 km', rate: fmt(REF.geo, 4), day: day(REF.geo), hz: fF(REF.geo * f0) },
      ]);

      const rates = cols.map((c) => c.rate), alts = cols.map((c) => c.alt);
      const rateDiff = Math.max(...rates) - Math.min(...rates);
      const altDiff = Math.max(...alts) - Math.min(...alts);
      const aScen = WGS84_A + state.altKm * 1e3;
      const eccNs = 2 * 0.001 * Math.sqrt(GM * aScen) / (C * C);
      const eMax = Math.max(...cols.map((c) => c.ecc));
      const iD = cols.findIndex((c) => c.ecc === eMax);
      const eccD = eMax > 0
        ? `; collector ${cols[iD].id}, offset radially in this formation, has $e$ = ${fmt(eMax, 2)}, an amplitude of ${fmtSI(2 * eMax * Math.sqrt(GM * cols[iD].a) / (C * C), 's', 2)}`
        : '';
      const shap = cols.map((c) => c.shapiro);
      const tropoZen = atmosphere.troposphereDelay(Math.PI / 2, S.emitter.altM, S.cfg.env.tropo);
      const tropo5 = atmosphere.troposphereDelay(5 * DEG, S.emitter.altM, S.cfg.env.tropo);
      const maxDiff = (k) => Math.max(...cols.map((c) => Math.abs(c[k] - ref[k])));
      const ion1 = (f) => atmosphere.ionosphereDelay(Math.PI / 2, f, { vtec: 1, shellKm: S.cfg.env.iono.shellKm });

      tropoRo.set({
        zen: tropoZen.toFixed(2), at5: tropo5.toFixed(1), ratio: fmt(tropo5 / tropoZen, 3), dTropo: fmt(maxDiff('tropo'), 3),
        tropoT: fT(R.tropo.maxTdoa), tropoF: fF(R.tropo.maxFdoa), tropoB: fM(bOf('tropo')),
      });
      ionoRo.set({
        l1: fmtDist(ion1(1575.42e6), 3), vhf: fmtDist(ion1(1e8), 3), here: fmtDist(ion1(f0), 3), dIono: fmtDist(maxDiff('iono'), 3),
        ionoT: fT(R.iono.maxTdoa), ionoF: fF(R.iono.maxFdoa), ionoB: fM(bOf('iono')),
      });

      setLive({
        cep: cep ? fmtDist(cep, 3) : 'not defined (no fix)', cep2: cep ? fmtDist(cep, 3) : 'not defined here (no fix)',
        tofRange: range(tofs, (v) => `${(v * 1e3).toFixed(2)} ms`), vMax: `${(vMax / 1000).toFixed(2)} km/s`,
        travelRange: range(travels, (v) => `${v.toFixed(1)} m`), emShift: `${emShift.toFixed(2)} m`, ve: `${ve.toFixed(0)} m/s`,
        ve2: `${ve.toFixed(0)} m/s`, tdoaMax: fT(tdoaMax), vc: fmt(vc, 2),
        iter1: iterErr(1), iter2: iterErr(2), iter3: iterErr(3),
        instT: fT(R.instant.maxTdoa), instF: fF(R.instant.maxFdoa), instB: fM(bOf('instant')), instP: pct(bOf('instant'), cep),
        sagLeo: fmtSI(sagnacMax(aScen), 's', 3), sagGps: fmtSI(SAG_GPS, 's', 3),
        sagDiff: fT(Math.max(...cols.map((c) => Math.abs(c.dSag)))), sagT: fT(R.sagnac.maxTdoa), sagB: fM(bOf('sagnac')),
        sagP: pct(bOf('sagnac'), cep), sagRes: fmtSI(Math.max(...cols.map((c) => Math.abs(c.sagRes))), 's', 2),
        d2F: fF(R.doppler2.maxFdoa), d2B: fM(bOf('doppler2')), d2P: pct(bOf('doppler2'), cep),
        carrierLabel: R.carrier.label, carF: fF(R.carrier.maxFdoa), carB: fM(bOf('carrier')),
        leoDay: `${fmt(Math.abs(REF.leo) * 86400e6, 3)} µs`, leoKm: fmtDist(Math.abs(REF.leo) * 86400 * C, 2),
        altDiff: fmtDist(altDiff, 3), rateDiff: fmt(rateDiff, 2), rateHz: fF(rateDiff * f0), clkB: fM(bOf('clock')),
        leoGeo: fmt(REF.geo - REF.leo, 3), leoGeoHz: fF((REF.geo - REF.leo) * f0),
        eccNs: fmtSI(eccNs, 's', 2),
        shapRange: range(shap, (v) => fmtDist(v, 2)), shapT: fT(R.shapiro.maxTdoa), shapB: fM(bOf('shapiro')),
        zen: `${tropoZen.toFixed(2)} m`, ratio: fmt(tropo5 / tropoZen, 3),
        l1: fmtDist(ion1(1575.42e6), 3), vhf: fmtDist(ion1(1e8), 3), here: fmtDist(ion1(f0), 3),
        vtec: `${fmt(state.vtec, 2)} TECU`, ionoRange: range(cols.map((c) => c.iono), (v) => fmtDist(v, 3)),
        motF: fF(R.motion.maxFdoa), motB: fM(bOf('motion')), motP: pct(bOf('motion'), cep),
        altB: state.use.altitude ? fM(bOf('altitude')) : 'nothing here',
        altNote: state.use.altitude
          ? 'The surface constraint couples height to horizontal position, so a height error becomes a horizontal one.'
          : 'The altitude constraint is switched off in your scenario, so terrain height does not enter the fix at all (switch it on to see this row).',
        motCmp: (() => {
          if (!fixOk) return '';
          const phys = ['instant', 'sagnac', 'doppler2', 'shapiro', 'tropo', 'iono', 'clock'].map((k) => R[k]);
          const top = phys.reduce((a, b) => (b.biasHoriz > a.biasHoriz ? b : a));
          const r = R.motion.biasHoriz / top.biasHoriz;
          return r >= 1
            ? `That is ${fmt(r, 2)} times the largest physics bias above (${top.label.toLowerCase()}, ${fmtDist(top.biasHoriz, 2)}).`
            : `Here it is smaller than the largest physics bias (${top.label.toLowerCase()}, ${fmtDist(top.biasHoriz, 2)}): at this carrier and with these measurements the ionosphere or geometry dominates.`;
        })(),
      });
      // eccD contains math: render it through the live node as text, with e written plainly
      setLive({ eccD: eccD.replace('$e$', 'e') });
      updateSpans();
      renderVerdict();

      ltPlot.requestRedraw();
      atmPlot.requestRedraw();
      scheduleSweep();
    }

    function renderVerdict() {
      const { R, cep } = M;
      const fixOk = M.cov.observable;
      const word = (b) => {
        if (b == null || !cep) return '';
        const r = Number((b / cep).toPrecision(2)); // classify the value as displayed
        return r >= 0.1 ? 'significant' : r >= 0.01 ? 'small but not negligible in a bias budget' : 'negligible';
      };
      const part = (k) => (fixOk ? `${fmtDist(R[k].biasHoriz, 2)} (${pct(R[k].biasHoriz, cep)} of the CEP, ${word(R[k].biasHoriz)})` : 'not computable (no fix)');
      verdict.replaceChildren(
        el('h3', null, 'Is relativity big enough to matter? For this scenario:'),
        el('p', null, el('strong', null, 'Kinematics: metres, so model it. '),
          `Ignoring the finite light-time costs ${part('instant')}; ignoring the Earth's rotation during the flight (Sagnac) costs ${part('sagnac')}. These must be modelled, and they are: by solving the light-time equation in the inertial frame, which includes both automatically.`),
        el('p', null, el('strong', null, 'Clock rates, only in special cases. '),
          `Free-running oscillators on these collectors would move the fix by ${part('clock')}. A LEO–GEO pair would see ${fF((REF.geo - REF.leo) * M.f0)} of relativistic FDOA offset at this carrier. GPS-disciplined oscillators show none of it, and time tags are steered to GNSS time anyway.`),
        el('p', null, el('strong', null, 'Shapiro delay: never. '),
          `It moves the fix by ${part('shapiro')}.`),
      );
    }

    update();

    // ------------------------------------------------------------ cleanup
    return () => {
      destroyed = true;
      if (raf) clearTimeout(raf);
      clearTimeout(sweepTimer);
      ltPlot.destroy();
      atmPlot.destroy();
      sweepPlot.destroy();
      style.remove();
      root.classList.remove('ph8');
    };
  },
};
