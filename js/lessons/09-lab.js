/**
 * 09-lab.js - "The 4-ball collection lab": the course's capstone sandbox.
 *
 * The reader configures an emitter, a formation of 2-4 collectors, the error budget and the processor's
 * modelling fidelity, and sees the resulting geolocation precision (CRLB and Monte-Carlo), deterministic
 * biases and sensitivities. Every physics number comes from js/core/scenario.js and stein.js; the pure
 * glue (settings model, presets, unit conversion) lives in _lab-model.js so it can be checked in Node.
 *
 * Work scheduling (engine timings on a laptop: covariance ~10 ms, sensitivityTable ~5 ms, effectsTable
 * ~30 ms, monteCarlo ~1.3 ms per trial, mapField ~8 us per point, passSeries 61 samples ~160 ms):
 *   live (next animation frame):  geometry, CRLB, sensitivities, DOPs, deterministic bias, globe markers
 *   debounced:                    pass series, effects table, lines of position on the globe
 *   chunked:                      Monte-Carlo, 25 trials per task, up to 1000, restarted on any change
 * Every timer / frame / listener / plot / globe is released in the cleanup function.
 */
import { scenario as SC, measure } from '../core/index.js';
import { Plot2D, palette, contourLines, niceTicks } from '../ui/plot2d.js';
import {
  slider, toggle, select, segmented, button, numberInput, readout, controlGroup, dataTable, fmt, fmtSI, fmtDist,
} from '../ui/controls.js';
import { el, lessonHeader, section, callout, takeaways, nextLesson, lessonLink } from '../ui/layout.js';
import { questionSet } from '../ui/quiz.js';
import QUESTIONS from './questions.js';
import { createGlobe } from '../ui/globe3d.js';
import {
  DEFAULT_UI, PRESETS, IDS, SHAPES, MASK_DEG, C, sanitizeUi, presetUi, deepMerge, nCollectors, shapeOffsetsKm,
  derivedNoise, analyse, mcAccumulate, mcChunk, biasSources,
} from './_lab-model.js';

const STORAGE_KEY = 'tdoa-fdoa:lab-config-v1';
const COLL = ['--collector-a', '--collector-b', '--collector-c', '--collector-d'];
const MC_MAX = 1000, MC_CHUNK = 25;
const PLAY_RATE = 30; // seconds of pass per second of real time
const TIMES = Array.from({ length: 61 }, (_, k) => -300 + 10 * k);

const SWITCHES = [
  { key: 'retarded', label: 'Retarded light-time', hint: 'Each collector is evaluated where it was when the wavefront reached it (the satellites move ~7 m per ms of flight).' },
  { key: 'earthRotation', label: 'Earth rotation (Sagnac)', hint: 'Light-time solved in the inertial frame; off = Earth-fixed coordinates treated as if they were inertial.' },
  { key: 'dopplerExact', label: 'Exact Doppler', hint: 'The exact ratio of received to emitted frequency; off = first order, f0(1 − ρ̇/c).' },
  { key: 'shapiro', label: 'Shapiro delay', hint: 'Extra light-time from the Earth’s gravity (centimetres).' },
  { key: 'troposphere', label: 'Troposphere', hint: 'Neutral-atmosphere delay near the emitter, the same for envelope and carrier.' },
  { key: 'ionosphere', label: 'Ionosphere', hint: 'Dispersive: group delay on TDOA, phase advance on FDOA, both ∝ 1/f0².' },
];
// effectsTable row key -> what switches it on the error map
const EFFECT_SWITCH = { instant: 'retarded', sagnac: 'earthRotation', doppler2: 'dopplerExact', shapiro: 'shapiro', tropo: 'troposphere', iono: 'ionosphere' };

const STYLE = `
.lab-page .lab-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.lab-page .lab-presets .btn { font-size: 13px; padding: 6px 10px; }
.lab-page .lab-presets .btn[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.lab-page .lab-preset-desc { font-size: 14px; color: var(--text-2); margin-top: 8px; min-height: 1.5em; max-width: var(--measure); }
.lab-page .lab-ws { display: grid; grid-template-columns: 330px minmax(0, 1fr); gap: 20px; align-items: start; }
.lab-page .lab-controls { position: sticky; top: calc(var(--topbar-h) + 10px); max-height: calc(100vh - var(--topbar-h) - 20px);
  overflow-y: auto; overscroll-behavior: contain; display: grid; gap: 10px; padding: 2px 6px 12px 2px; min-width: 0; }
.lab-page .lab-ctl-head { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.lab-page .lab-ctl-head strong { font-size: 14px; }
.lab-page .lab-results { display: grid; gap: 18px; min-width: 0; }
.lab-page .lab-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; min-width: 0; }
.lab-page .lab-card > h3 { font-size: 15px; margin: 0 0 10px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.lab-page .lab-card > h3 small { font-weight: 400; color: var(--muted); font-size: 12.5px; }
.lab-page .lab-status { display: flex; flex-wrap: wrap; gap: 6px; }
.lab-page .lab-chip { border: 1px solid var(--border-strong); border-radius: 999px; padding: 4px 10px; font-size: 13px; background: var(--surface);
  font-variant-numeric: tabular-nums; white-space: nowrap; }
.lab-page .lab-chip b { font-weight: 650; }
.lab-page .lab-chip.good { border-color: color-mix(in srgb, var(--good) 55%, transparent); color: var(--good); }
.lab-page .lab-chip.warn { border-color: color-mix(in srgb, var(--warning) 60%, transparent); color: var(--warning); }
.lab-page .lab-chip.bad { border-color: color-mix(in srgb, var(--critical) 60%, transparent); color: var(--critical); }
.lab-page .lab-banner { border-left: 3px solid var(--critical); background: var(--surface-2); padding: 8px 12px; border-radius: var(--radius-sm); font-size: 14px; margin-top: 8px; }
.lab-page .lab-banner.warn { border-left-color: var(--warning); }
.lab-page .lab-banner:empty { display: none; }
.lab-page .lab-toolbar { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin-top: 10px; }
.lab-page .lab-toolbar .ctrl-toggle { font-size: 13px; }
.lab-page .lab-toolbar .btn { font-size: 13px; padding: 5px 10px; }
.lab-page .lab-note { font-size: 13px; color: var(--text-2); line-height: 1.5; margin-top: 8px; }
.lab-page .lab-globe { min-height: 120px; border-radius: var(--radius-sm); overflow: hidden; }
.lab-page .lab-globe-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12.5px; color: var(--text-2); margin-top: 6px; }
.lab-page .lab-swatch { display: inline-block; width: 14px; height: 3px; vertical-align: middle; margin-right: 5px; border-radius: 2px; }
.lab-page .lab-tabs .ctrl-seg button { flex: 1 1 auto; }
.lab-page .lab-panel { margin-top: 12px; display: grid; gap: 10px; min-width: 0; }
.lab-page .lab-panel[hidden] { display: none; }
.lab-page .lab-dom { color: var(--critical); font-weight: 700; }
.lab-page .lab-sentence { font-size: 15px; line-height: 1.6; background: var(--surface-2); border-radius: var(--radius-sm); padding: 10px 12px; }
.lab-page .lab-sentence:empty { display: none; }
.lab-page .lab-offsets { display: grid; gap: 8px; }
.lab-page .lab-offrow { display: grid; grid-template-columns: 22px repeat(3, minmax(0, 1fr)); gap: 6px; align-items: end; }
.lab-page .lab-offrow .ctrl { font-size: 12px; gap: 2px; }
.lab-page .lab-offrow .ctrl-number { padding: 4px 6px; min-height: 30px; font-size: 13px; }
.lab-page .lab-offid { font-weight: 700; padding-bottom: 7px; }
.lab-page .lab-row { display: flex; gap: 8px; flex-wrap: wrap; }
.lab-page .lab-live { font-family: var(--font-mono); font-size: 0.95em; background: var(--surface-2); padding: 0 4px; border-radius: 4px; white-space: nowrap; }
.lab-page .lab-exp { display: grid; gap: 12px; }
.lab-page .lab-exp .btn { font-size: 13px; padding: 5px 10px; margin-top: 4px; }
.lab-page .lab-mc-prog { font-size: 12.5px; color: var(--muted); }
@media (max-width: 1000px) {
  .lab-page .lab-ws { grid-template-columns: minmax(0, 1fr); }
  .lab-page .lab-controls { position: static; max-height: none; overflow: visible; padding: 0; }
}
@media (max-width: 520px) {
  .lab-page .lab-card { padding: 10px; margin-left: -6px; margin-right: -6px; }
}
`;

// ------------------------------------------------------------------ small helpers
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const dist = (m) => (fin(m) ? fmtDist(m) : '—');
const signedDist = (m) => (fin(m) ? (m > 0 ? '+' : '') + fmtDist(m) : '—');
const fixed = (v, d) => (fin(v) ? v.toFixed(d).replace(/^-(?=.*[1-9])/, '−').replace(/^-/, '') : '—');
const freqLabel = (f) => fmtSI(f, 'Hz', 3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function niceFloor(x) {
  if (!(x > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / e;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e;
}

export default {
  id: 'lab',
  title: 'The 4-ball collection lab',

  mount(root, ctx) {
    root.classList.add('lab-page');
    const styleEl = document.createElement('style');
    styleEl.textContent = STYLE;
    document.head.append(styleEl);

    // ------------------------------------------------------------ state
    let ui = loadUi();
    let A = null;                       // latest analyse() result
    let disposed = false;
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms); timers.add(id); return id; };
    const cancel = (id) => { if (id != null) { clearTimeout(id); timers.delete(id); } };
    let rafId = 0;
    const view = {
      tab: 'geometry', sensCollector: 1, biasCollector: 1, chartMode: 'elevation',
      globeLop: true, globeEll: true, globeLabels: true, mapLop: true, autoScale: true, activePreset: null,
    };

    function loadUi() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return sanitizeUi(JSON.parse(raw));
      } catch (e) { /* storage unavailable or corrupt: use defaults */ }
      return sanitizeUi(deepMerge(DEFAULT_UI, {}));
    }
    let saveTimer = null;
    function saveSoon() {
      cancel(saveTimer);
      saveTimer = later(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ui)); } catch (e) { /* ignore */ } }, 400);
    }

    // ------------------------------------------------------------ page: header, intro, presets
    root.append(
      lessonHeader({
        kicker: 'Part III · Lesson 9',
        title: 'The 4-ball collection lab',
        lede: 'Fly a formation of two to four satellites over an emitter, choose the error budget and how much physics the processor models, and see what the fix is worth: its predicted precision, the cloud of actual fixes, any systematic bias, and which error to fix first.',
      }),
      section('How to use the lab', String.raw`
        <p>Everything you met in the course is switched on here at once. The simulator always generates the
        measurements with the full physical model (light-time, Earth rotation, exact Doppler, gravity,
        troposphere, ionosphere). The <strong>processor</strong>, which turns measurements back into a position,
        uses whatever model you allow it in "Processor fidelity". Random errors (noise, different every time) come
        from the per-collector
        error budget; deliberate, fixed errors (biases: "what if collector B's oscillator is 1 Hz off?") come from the
        "Deliberate errors" group.</p>
        <p>The results pane answers four questions: <em>How precise is the fix?</em> (the Cramér–Rao bound, which is
        the best any unbiased estimator can do, with the CEP, the radius of the circle that holds half the fixes,
        and the 95 % ellipse; all checked by Monte-Carlo, that is, by repeating the collection many times with fresh
        random errors); <em>Is it biased?</em> (the cloud's mean against the
        truth); <em>What limits it?</em> (the error-budget and sensitivity tables); and <em>When in the pass is it
        best?</em> (the timeline). Pick a preset to start, or change anything; your settings are remembered on
        this device.</p>
      `),
    );

    const presetDesc = el('div', 'lab-preset-desc');
    const presetButtons = PRESETS.map((p) => {
      const b = button({ label: p.name, onClick: () => applyUi(presetUi(p.id), p.id) });
      b.el.title = p.desc;
      b.el.setAttribute('aria-pressed', 'false');
      return { p, b };
    });
    root.append(section('Presets', el('div', 'lab-presets', presetButtons.map((x) => x.b.el)), presetDesc));
    function markPreset(id) {
      view.activePreset = id;
      presetButtons.forEach(({ p, b }) => b.el.setAttribute('aria-pressed', String(p.id === id)));
      const p = PRESETS.find((q) => q.id === id);
      presetDesc.textContent = p ? p.desc : 'Custom settings. Pick a preset above, or press Reset to return to the default scenario.';
    }

    // ------------------------------------------------------------ controls
    const bindings = [];
    const bind = (ctrl, get) => { bindings.push({ ctrl, get }); return ctrl; };
    const sl = (label, path, opts = {}) => bind(slider({
      label, value: getPath(ui, path), ...opts,
      onInput: (v) => { setPath(ui, path, opts.map ? opts.map(v) : v); changed(); },
    }), () => getPath(ui, path));
    const tg = (label, path, hint, after) => bind(toggle({
      label, value: !!getPath(ui, path), hint,
      onChange: (v) => { setPath(ui, path, v); if (after) after(v); changed(); },
    }), () => !!getPath(ui, path));

    // Emitter
    const gEmitter = controlGroup('Emitter', [
      sl('Latitude', 'emitter.latDeg', { min: -80, max: 80, step: 0.1, unit: '°', format: (v) => v.toFixed(1) }),
      sl('Longitude', 'emitter.lonDeg', { min: -180, max: 180, step: 0.1, unit: '°', format: (v) => v.toFixed(1) }),
      sl('Altitude (above ellipsoid)', 'emitter.altM', { min: 0, max: 5000, step: 10, unit: 'm', format: (v) => v.toFixed(0) }),
      sl('Carrier $f_0$', 'emitter.f0', { min: 1e8, max: 3e10, log: true, format: freqLabel }),
      sl('Ground speed', 'emitter.speed', { min: 0, max: 30, step: 0.5, unit: 'm/s', format: (v) => v.toFixed(1), hint: 'The processor always assumes a stationary emitter.' }),
      sl('Heading', 'emitter.headingDeg', { min: 0, max: 359, step: 1, unit: '°', format: (v) => v.toFixed(0), hint: 'Clockwise from north.' }),
    ], { collapsible: true });

    // Orbit & pass
    const timeCtl = sl('Time in pass', 't', { min: -300, max: 300, step: 1, unit: 's', format: (v) => (v > 0 ? '+' : '') + v.toFixed(0), hint: 'Seconds from the formation’s closest approach to the emitter.' });
    const playBtn = button({ label: 'Play', onClick: () => togglePlay() });
    const overheadNote = el('div', 'ctrl-hint');
    const gOrbit = controlGroup('Orbit & pass', [
      sl('Orbit altitude', 'orbit.altKm', { min: 400, max: 1500, step: 10, unit: 'km', format: (v) => v.toFixed(0) }),
      sl('Inclination', 'orbit.incDeg', { min: 0, max: 180, step: 0.5, unit: '°', format: (v) => v.toFixed(1), hint: 'Tilt of the orbit’s plane from the equator.' }),
      bind(segmented({ label: 'Pass direction', options: [{ value: true, label: 'Ascending (northbound)' }, { value: false, label: 'Descending' }], value: ui.orbit.ascending, onChange: (v) => { ui.orbit.ascending = v; changed(); } }), () => ui.orbit.ascending),
      sl('Ground track offset east', 'orbit.passEastKm', { min: -1500, max: 1500, step: 10, unit: 'km', format: (v) => v.toFixed(0), hint: 'Where the formation’s reference point passes relative to the emitter (0, 0 = overhead).' }),
      sl('Ground track offset north', 'orbit.passNorthKm', { min: -1500, max: 1500, step: 10, unit: 'km', format: (v) => v.toFixed(0) }),
      overheadNote,
      timeCtl,
      el('div', 'lab-row', playBtn.el, button({ label: 'Closest approach (t = 0)', kind: 'ghost', onClick: () => setTime(0) }).el),
    ], { collapsible: true });

    // Formation
    const shapeCtl = bind(select({
      label: 'Shape', options: SHAPES.map((s) => ({ value: s, label: { pair: 'pair (2)', triangle: 'triangle (3)', 'tri+1': 'tri+1 (4)', diamond: 'diamond (4)', string: 'string (4)' }[s] })),
      value: ui.formation.shape, onChange: (v) => { ui.formation.shape = v; structural(); },
    }), () => ui.formation.shape);
    const baselineCtl = sl('Baseline $L$', 'formation.baselineKm', { min: 30, max: 2000, log: true, unit: 'km', format: (v) => v.toFixed(0), hint: 'Size of the formation: the spacing between collectors.' });
    const customCtl = tg('Edit collectors individually', 'formation.custom', 'Along-track (+ ahead), cross-track (+ left of travel), radial (+ up) offsets, km.', (v) => {
      if (v && !(ui.formation.offsets && ui.formation.offsets.length >= 2)) ui.formation.offsets = shapeOffsetsKm(ui.formation.shape, ui.formation.baselineKm);
      if (v) ui.formation.offsets = shapeOffsetsKm(ui.formation.shape, ui.formation.baselineKm);
      structuralNoChange();
    });
    const offsetsHost = el('div', 'lab-offsets');
    const refHost = el('div');
    const gFormation = controlGroup('Formation', [shapeCtl, baselineCtl, customCtl, offsetsHost, refHost], { collapsible: true });

    // Measurements
    const sigmaAltCtl = sl('Altitude uncertainty $\\sigma_{alt}$', 'sigmaAltM', { min: 0.1, max: 1000, log: true, unit: 'm', format: (v) => fmt(v, 2), hint: 'How well the emitter’s height is known (1σ).' });
    const gMeas = controlGroup('Measurements used by the fix', [
      tg('TDOA', 'use.tdoa', 'Time differences against the reference collector.'),
      tg('FDOA', 'use.fdoa', 'Frequency differences against the reference collector.'),
      tg('Altitude (Earth-surface) constraint', 'use.altitude', 'The emitter is assumed to be at its altitude, ± σalt.'),
      sigmaAltCtl,
    ], { collapsible: true });

    // Error budget
    const loHint = el('div', 'ctrl-hint');
    const directBox = el('div', { style: 'display:grid;gap:14px' },
      sl('Per-collector $\\sigma_{TOA}$ (measurement)', 'budget.sigmaToaNs', { min: 0.1, max: 10000, log: true, unit: 'ns', format: (v) => fmt(v, 3), hint: 'Error in one collector’s time of arrival (TOA) from receiver noise alone.' }).el,
      sl('Per-collector $\\sigma_{FOA}$ (measurement)', 'budget.sigmaFoaHz', { min: 1e-4, max: 100, log: true, unit: 'Hz', format: (v) => fmt(v, 3), hint: 'Error in one collector’s frequency of arrival (FOA) from receiver noise alone.' }).el,
    );
    const snrHost = el('div', { style: 'display:grid;gap:14px' });
    const derivedRo = el('div');
    const signalBox = el('div', { style: 'display:grid;gap:14px' },
      sl('Noise bandwidth $B$', 'budget.noiseBwHz', { min: 1e3, max: 1e8, log: true, format: freqLabel, hint: 'Width of the band through which noise reaches the correlator (lesson 6).' }).el,
      sl('Signal bandwidth $B_s$', 'budget.signalBwHz', { min: 1e3, max: 1e8, log: true, format: freqLabel, hint: 'Used up to B (the receiver cannot see more than its bandwidth).' }).el,
      sl('Integration time $T$', 'budget.intT', { min: 1e-4, max: 10, log: true, format: (v) => fmtSI(v, 's'), hint: 'Length of the recordings that are correlated.' }).el,
      snrHost, derivedRo,
    );
    const modeCtl = bind(segmented({
      label: 'Measurement noise', options: [{ value: 'direct', label: 'Typed directly' }, { value: 'signal', label: 'From the signal' }],
      value: ui.budget.mode, onChange: (v) => { ui.budget.mode = v; showBudgetMode(); changed(); },
    }), () => ui.budget.mode);
    const gBudget = controlGroup('Error budget (1σ, per collector)', [
      modeCtl, directBox, signalBox,
      sl('Clock synchronisation $\\sigma_{clk}$', 'budget.clockNs', { min: 0, max: 100, step: 0.5, unit: 'ns', format: (v) => v.toFixed(1), hint: 'How well each collector’s clock is aligned with the others’.' }),
      sl('Frequency-reference stability $\\sigma_{LO}$', 'budget.lo', { min: 1e-13, max: 1e-7, log: true, format: (v) => fmt(v, 2), hint: 'Fractional frequency error of each collector’s local oscillator (LO).' }),
      loHint,
      sl('Ephemeris position $\\sigma_{pos}$ (per axis)', 'budget.ephPosM', { min: 0.01, max: 100, log: true, unit: 'm', format: (v) => fmt(v, 2), hint: 'How well each collector’s own position is known.' }),
      sl('Ephemeris velocity $\\sigma_{vel}$ (per axis)', 'budget.ephVelMms', { min: 0.01, max: 100, log: true, unit: 'mm/s', format: (v) => fmt(v, 2), hint: 'How well each collector’s own velocity is known.' }),
    ], { collapsible: true });

    // Atmosphere
    const gAtmos = controlGroup('Atmosphere', [
      sl('Vertical TEC', 'env.vtec', { min: 0, max: 200, step: 1, unit: 'TECU', format: (v) => v.toFixed(0), hint: '1 TECU = 10¹⁶ electrons/m². Quiet night ~5, active day 50–150.' }),
      sl('Tropospheric zenith wet delay', 'env.zwd', { min: 0, max: 0.5, step: 0.01, unit: 'm', format: (v) => v.toFixed(2), hint: 'The dry (hydrostatic) part is fixed at 2.3 m.' }),
    ], { collapsible: true, collapsed: true });

    // Processor fidelity
    const gProc = controlGroup('Processor fidelity', [
      el('div', 'ctrl-hint', 'What the geolocation processor models. The simulated truth always uses the full model.'),
      ...SWITCHES.map((s) => tg(s.label, `solver.${s.key}`, s.hint)),
      tg('Collector oscillators free-run on proper time', 'truthProperTimeLO', 'Truth: the satellites’ frequency references tick at their own relativistic rate (off = GPS-disciplined).'),
      tg('Processor corrects for relativistic clock rates', 'solver.properTimeLO', 'Processor: assumes the oscillators free-run and removes time dilation and gravitational red-shift.'),
      button({ label: 'Full model', kind: 'ghost', onClick: () => { SWITCHES.forEach((s) => { ui.solver[s.key] = true; }); ui.solver.properTimeLO = ui.truthProperTimeLO; syncControls(); changed(); } }),
    ], { collapsible: true, collapsed: true });

    // Deliberate errors
    const biasHost = el('div', { style: 'display:grid;gap:14px' });
    const biasSummary = el('div', 'ctrl-hint');
    const gBias = controlGroup('Deliberate errors ("what if")', [
      biasHost,
      sl('Emitter altitude error (assumed − true)', 'bias.altM', { min: -200, max: 200, step: 1, unit: 'm', format: (v) => v.toFixed(0), hint: 'Only matters with the altitude constraint on.' }),
      biasSummary,
      button({ label: 'Clear all deliberate errors', kind: 'ghost', onClick: () => { ui.bias = deepMerge(DEFAULT_UI.bias, {}); syncControls(); changed(); } }),
    ], { collapsible: true, collapsed: true });

    const groups = [gEmitter, gOrbit, gFormation, gMeas, gBudget, gAtmos, gProc, gBias];
    if (typeof window !== 'undefined' && window.innerWidth < 700) groups.forEach((g) => collapseGroup(g, true));
    function collapseGroup(g, on) {
      g.classList.toggle('collapsed', on);
      const h = g.querySelector('.ctrl-group-title');
      if (h) h.setAttribute('aria-expanded', String(!on));
    }

    const resetBtn = button({ label: 'Reset', kind: 'primary', onClick: () => applyUi(presetUi('tight'), 'tight') });
    const controlsCol = el('aside', { class: 'lab-controls', 'aria-label': 'Lab settings' },
      el('div', 'lab-ctl-head', el('strong', null, 'Settings'), el('div', 'lab-row',
        button({ label: 'Collapse all', kind: 'ghost', onClick: () => groups.forEach((g) => collapseGroup(g, true)) }).el, resetBtn.el)),
      groups);

    // ------------------------------------------------------------ results pane
    const statusEl = el('div', { class: 'lab-status', 'aria-live': 'polite' });
    const bannerEl = el('div', 'lab-banner');
    const statusCard = el('div', 'lab-card', el('h3', null, 'Status'), statusEl, bannerEl);

    // globe
    const globeHost = el('div', 'lab-globe');
    const globeNote = el('div', 'lab-note');
    const globeLegend = el('div', 'lab-globe-legend');
    const globeCard = el('div', 'lab-card',
      el('h3', null, 'The collection', el('small', null, 'drag to rotate; click, then scroll to zoom')),
      globeHost, globeLegend,
      el('div', 'lab-toolbar',
        button({ label: 'Frame formation', onClick: () => frameFormation() }).el,
        button({ label: 'Frame emitter', onClick: () => frameEmitter() }).el,
        toggle({ label: 'Lines of position', value: view.globeLop, onChange: (v) => { view.globeLop = v; lopKey = ''; scheduleGlobeLop(); } }).el,
        toggle({ label: 'Error ellipsoid', value: view.globeEll, onChange: (v) => { view.globeEll = v; updateGlobe(); } }).el,
        toggle({ label: 'Labels', value: view.globeLabels, onChange: (v) => { view.globeLabels = v; if (globe) globe.setLabelsVisible(v); } }).el),
      globeNote);

    // error map
    const mapHost = el('div');
    const mcProg = el('div', 'lab-mc-prog');
    const mapTable = dataTable({
      columns: [
        { key: 'q', label: 'Quantity' },
        { key: 'crlb', label: 'Predicted (CRLB / engine)', align: 'right' },
        { key: 'mc', label: 'Monte-Carlo', align: 'right' },
      ],
      rows: [],
    });
    const autoCtl = toggle({ label: 'Auto-scale', value: view.autoScale, onChange: (v) => { view.autoScale = v; if (v) fitMap(true); } });
    const mapCard = el('div', 'lab-card',
      el('h3', null, 'Error map', el('small', null, 'local east / north around the true emitter, metres')),
      mapHost,
      el('div', 'lab-toolbar',
        toggle({ label: 'Lines of position (±1σ bands)', value: view.mapLop, onChange: (v) => { view.mapLop = v; mapPlot.requestRedraw(); } }).el,
        autoCtl.el,
        button({ label: 'Fit view', onClick: () => { view.autoScale = true; autoCtl.set(true); fitMap(true); } }).el,
        button({ label: 'Restart Monte-Carlo', kind: 'ghost', onClick: () => restartMc(0) }).el,
        mcProg),
      mapTable,
      el('div', 'lab-note', 'Each grey dot is one complete simulated collection: fresh random errors drawn from the budget, the deliberate errors, then the processor’s iterative least-squares fix. The ellipse and the CEP circle are the Cramér-Rao prediction centred on the truth. With nothing deliberate switched on, the cloud should fill the ellipse with about 95 % of its points inside.'));

    // tables
    const tabCtl = segmented({
      options: [
        { value: 'geometry', label: 'Geometry' }, { value: 'budget', label: 'Error budget' },
        { value: 'sensitivity', label: 'Sensitivity' }, { value: 'physics', label: 'Physics' }, { value: 'dop', label: 'DOP' },
      ],
      value: view.tab, onChange: (v) => { view.tab = v; showTab(); renderTables(); if (v === 'physics') scheduleEffects(0); },
    });
    const geomTable = dataTable({
      columns: [
        { key: 'id', label: 'Collector' }, { key: 'range', label: 'Range', unit: 'km', align: 'right' },
        { key: 'el', label: 'Elevation', unit: '°', align: 'right' }, { key: 'az', label: 'Azimuth', unit: '°', align: 'right' },
        { key: 'tof', label: 'Time of flight', unit: 'ms', align: 'right' }, { key: 'dop', label: 'Doppler shift', unit: 'kHz', align: 'right' },
        { key: 'tdoa', label: 'TDOA vs ref', unit: 'µs', align: 'right' }, { key: 'fdoa', label: 'FDOA vs ref', unit: 'Hz', align: 'right' },
        { key: 'vis', label: `Above ${MASK_DEG}°`, align: 'center' },
      ],
    });
    const geomNote = el('div', 'lab-note');
    const budgetTable = dataTable({
      columns: [
        { key: 'id', label: 'Collector' },
        { key: 'tn', label: 'TOA: noise', unit: 'ns', align: 'right', format: domFmt('tn') }, { key: 'tc', label: 'clock', unit: 'ns', align: 'right', format: domFmt('tc') },
        { key: 'tp', label: 'eph. pos.', unit: 'ns', align: 'right', format: domFmt('tp') }, { key: 'tt', label: 'TOA total', unit: 'ns', align: 'right' },
        { key: 'fn', label: 'FOA: noise', unit: 'Hz', align: 'right', format: domFmt('fn') }, { key: 'fo', label: 'oscillator', unit: 'Hz', align: 'right', format: domFmt('fo') },
        { key: 'fv', label: 'eph. vel.', unit: 'Hz', align: 'right', format: domFmt('fv') }, { key: 'fp', label: 'eph. pos.', unit: 'Hz', align: 'right', format: domFmt('fp') },
        { key: 'ft', label: 'FOA total', unit: 'Hz', align: 'right' },
      ],
    });
    const budgetNote = el('div', 'lab-sentence');
    const sensSentence = el('div', 'lab-sentence');
    const sensSelHost = el('div');
    const sensMeasTable = dataTable({
      caption: 'Per measurement: fix displacement for a unit error on one measurement',
      columns: [
        { key: 'label', label: 'Measurement' }, { key: 'per', label: 'Error', align: 'right' },
        { key: 'e', label: 'East', unit: 'm', align: 'right' }, { key: 'n', label: 'North', unit: 'm', align: 'right' },
        { key: 'u', label: 'Up', unit: 'm', align: 'right' }, { key: 'h', label: 'Horizontal', unit: 'm', align: 'right' },
      ],
    });
    const sensColTable = dataTable({
      caption: 'Per collector: fix displacement for a unit error of the selected collector',
      columns: [
        { key: 'label', label: 'Error' },
        { key: 'e', label: 'East', unit: 'm', align: 'right' }, { key: 'n', label: 'North', unit: 'm', align: 'right' },
        { key: 'u', label: 'Up', unit: 'm', align: 'right' }, { key: 'h', label: 'Horizontal', unit: 'm', align: 'right' },
      ],
    });
    const physTable = dataTable({
      columns: [
        { key: 'label', label: 'Effect' }, { key: 'dt', label: 'max |ΔTDOA|', unit: 'ns', align: 'right' },
        { key: 'df', label: 'max |ΔFDOA|', unit: 'Hz', align: 'right' },
        { key: 'bh', label: 'Fix error if ignored: horiz.', unit: 'm', align: 'right' }, { key: 'bu', label: 'up', unit: 'm', align: 'right' },
        { key: 'state', label: 'This processor', align: 'center' },
      ],
    });
    const physNote = el('div', 'lab-sentence');
    const dopTable = dataTable({
      columns: [
        { key: 'm', label: 'Measurements' }, { key: 'fix', label: 'Fix' },
        { key: 'h', label: 'HDOP', align: 'right' }, { key: 'v', label: 'VDOP', align: 'right' }, { key: 'unit', label: 'DOP unit' },
        { key: 'mh', label: '→ horizontal', unit: 'm', align: 'right' }, { key: 'mv', label: '→ vertical', unit: 'm', align: 'right' },
      ],
    });
    const dopNote = el('div', 'lab-note');
    const panels = {
      geometry: el('div', 'lab-panel', geomTable, geomNote),
      budget: el('div', 'lab-panel', budgetNote, budgetTable,
        el('div', 'lab-note', 'Each source is expressed as an equivalent time-of-arrival (TOA) or frequency-of-arrival (FOA) error at one collector, 1σ: ephemeris position along the line of sight shifts the arrival time by σpos/c; across the line of sight it tilts the line of sight and so changes the Doppler by (f0/c)(v⊥/ρ)σpos. The largest term in each half of a row is marked in red: that is what to improve first for that collector. Totals are root-sum-squares.')),
      sensitivity: el('div', 'lab-panel', sensSelHost, sensSentence, sensColTable, sensMeasTable,
        el('div', 'lab-note', 'First-order (linear) sensitivities from the estimator gain: scale them for other sizes (5 ns costs five times the 1 ns figure). The ephemeris rows are what happens when the processor believes collector positions or velocities that are wrong by that much.')),
      physics: el('div', 'lab-panel', physNote, physTable,
        el('div', 'lab-note', 'Each row: how much the effect changes the measurements, and how far the fix moves if the processor leaves only that effect out of its model while everything else is perfect and noise-free. Highlighted rows are the ones this processor currently gets wrong; together they make up the deterministic bias on the error map (they add up approximately, since each is small).')),
      dop: el('div', 'lab-panel', dopTable, dopNote),
    };
    const tablesCard = el('div', 'lab-card', el('h3', null, 'Tables'), el('div', 'lab-tabs', tabCtl.el), Object.values(panels));

    // pass timeline
    const passHost = el('div');
    const geoChartHost = el('div');
    const passNote = el('div', 'lab-note');
    const chartModeCtl = segmented({
      options: [{ value: 'elevation', label: 'Elevations' }, { value: 'tdoa', label: 'TDOAs' }, { value: 'fdoa', label: 'FDOAs' }],
      value: view.chartMode, onChange: (v) => { view.chartMode = v; fitGeoChart(); },
    });
    const passCard = el('div', 'lab-card',
      el('h3', null, 'Pass timeline', el('small', null, 'click or drag the marker to set the time')),
      passHost, el('div', { style: 'margin-top:10px' }, chartModeCtl.el), geoChartHost, passNote,
      el('div', 'lab-note', 'The cumulative curve combines all snapshots so far as if their errors were independent. That is true of thermal noise, but not of clock, oscillator and ephemeris errors, which change slowly and repeat from one snapshot to the next; nor does averaging remove any deterministic bias. The cumulative curve is therefore optimistic: treat it as a floor set by noise alone.'));

    const resultsCol = el('div', 'lab-results', statusCard, globeCard, mapCard, tablesCard, passCard);
    root.append(el('section', 'lesson-section', el('h2', null, 'Workspace'), el('div', 'lab-ws', controlsCol, resultsCol)));

    // ------------------------------------------------------------ math, experiments, takeaways
    root.append(section('What the lab computes',
      callout('math', 'Precision, bias and sensitivity', String.raw`
        <p>Stack the measurements in one list, the vector $\mathbf z$: $N-1$ TDOAs and $N-1$ FDOAs for $N$ collectors,
        and optionally the altitude pseudo-measurement (the emitter's known height, treated as one more measurement
        with error $\sigma_{alt}$). Write the processor's model as $\mathbf z = \mathbf h(\mathbf x) + \mathbf n$, where
        $\mathbf x$ is the emitter's position, $\mathbf h(\mathbf x)$ the measurements the processor predicts for an
        emitter there, and $\mathbf n$ the random errors. Each collector $i$ carries a total time-of-arrival error
        $\sigma_{T,i}$ and a total frequency-of-arrival error $\sigma_{F,i}$, the per-collector errors of Part II:</p>
        $$\sigma_{T,i}^2 = \sigma_{TOA,i}^2 + \sigma_{clk}^2 + (\sigma_{pos}/c)^2,$$
        $$\sigma_{F,i}^2 = \sigma_{FOA,i}^2 + (f_0\sigma_{LO})^2 + \Big(\tfrac{f_0}{c}\sigma_{vel}\Big)^2 + \Big(\tfrac{f_0}{c}\tfrac{v_{\perp,i}}{\rho_i}\sigma_{pos}\Big)^2.$$
        <p>Each term is one slider of the error budget: $\sigma_{TOA,i}$ and $\sigma_{FOA,i}$ are the measurement noise
        (from receiver noise, lesson 6), $\sigma_{clk}$ the clock synchronisation error, $\sigma_{LO}$ the
        fractional frequency error of the local oscillator, and $\sigma_{pos}$ and $\sigma_{vel}$ the ephemeris
        errors (how well the collector's own position and velocity are known). $f_0$ is the carrier frequency,
        $\rho_i$ the collector's range to the emitter and $v_{\perp,i}$ its speed across the line of sight; the last
        term is the Doppler error caused by having the collector in slightly the wrong place.</p>
        <p>Differencing against the reference collector gives the measurement covariance $\mathbf R$ (pairs that
        share the reference are correlated). With $\mathbf H = \partial\mathbf h/\partial\mathbf x$ at the truth
        (the Jacobian: how each measurement changes when the emitter moves), the
        Cramér–Rao bound on the position covariance and the estimator gain are</p>
        $$\mathbf P = \big(\mathbf H^{\mathsf T}\mathbf R^{-1}\mathbf H\big)^{-1},\qquad \mathbf K = \mathbf P\,\mathbf H^{\mathsf T}\mathbf R^{-1}.$$
        <p>$\mathbf P$ gives the east, north and up errors $\sigma_E,\sigma_N,\sigma_U$, the 95 % ellipse (the horizontal block scaled by 2.448) and the
        CEP. A small deterministic measurement error $\delta\mathbf z$ moves the fix by $\delta\mathbf x = \mathbf K\,\delta\mathbf z$:
        each column of $\mathbf K$ is one row of the sensitivity table. The bias on the error map is computed without
        linearising: the processor solves noise-free measurements that contain the deliberate errors and the physics
        its model leaves out. The Monte-Carlo cloud repeats the whole collection with random errors drawn from the budget.</p>
      `)));

    const live = {};
    const L = (key) => { const s = el('span', 'lab-live', '…'); (live[key] = live[key] || []).push(s); return s; };
    const EXPERIMENTS = [
      {
        title: 'One collector 1 Hz off', setup: { patch: {}, tab: 'sensitivity', sens: 1 },
        body: () => [
          'Open the Sensitivity tab with collector B selected: its "frequency +1 Hz" row predicts how far a 1 Hz error in B’s frequency reading moves the fix (', L('e1base'), ' horizontally in the default scenario). Now set B’s frequency error to +1 Hz under "Deliberate errors" (or use the preset). The cloud on the error map jumps by that amount in that direction, and the arrow from the truth to the cloud’s mean matches the predicted bias. Then raise the carrier to 10 GHz: the same 1 Hz now costs ', L('e1ghz'), '. That is close to, but not exactly, ten times less: the FDOA gradient grows tenfold, but so do the oscillator and ephemeris terms of the FOA budget, so the processor trusts the FDOAs relatively less. Widen the baseline to 1200 km as well and it drops to ', L('e1wide'), ': with a longer baseline the two collectors’ Doppler histories differ more, so the same frequency error corresponds to a smaller move of the emitter.',
        ],
      },
      {
        title: 'Tight versus wide', setup: { patch: {}, tab: 'budget' },
        body: () => [
          'Drag the baseline from 150 km to 1200 km. The CEP falls from ', L('e2cep1'), ' to ', L('e2cep2'), ', and the surface-constrained TDOA DOP from ', L('e2dop1'), ' to ', L('e2dop2'), '. Watch the Error budget tab while you drag: the per-collector budget hardly changes (the largest TOA term is ', L('e2dom1'), ' at 150 km and ', L('e2dom2'), ' at 1200 km). The improvement is almost all geometry, which is what DOP measures. Look also at the elevations in the Geometry tab: the wide formation’s outer satellites sit much lower in the sky.',
        ],
      },
      {
        title: 'Four balls, TDOA only, no altitude', setup: { patch: { use: { tdoa: true, fdoa: false, altitude: false } } },
        body: () => [
          'Three TDOAs alone fix the emitter in 3-D, but poorly: the longest axis of the 95 % ellipsoid is ', L('e3ax'), ' and σU is ', L('e3su'), ', because from 550 km up all four lines of sight point in nearly the same direction and range differences say little about distance along them. Look at the globe with the ellipsoid on: it is a needle pointing roughly towards the formation. Switch FDOA back on: each line of sight turns at a rate that depends on range, so the Doppler differences supply the along-the-line-of-sight information the TDOAs lack, and the longest axis collapses to', L('e3axf'), '. Then also switch the altitude constraint on.',
        ],
      },
      {
        title: 'A processor without light-time and Sagnac', setup: { patch: { solver: { retarded: false, earthRotation: false } }, tab: 'physics' },
        body: () => [
          'This processor freezes the satellites at one instant and treats Earth-fixed coordinates as inertial. The fix acquires a deterministic bias of ', L('e4bias'), ' (horizontal). One snapshot’s CEP is ', L('e4cep'), ', so the bias looks harmless, but it is the same in every snapshot: integrate over the pass and the noise floor drops to ', L('e4cum'), ' (the last point of the cumulative curve), while the bias stays. The Physics tab shows which of the two omissions does most of the damage.',
        ],
      },
      {
        title: 'The ionosphere at 400 MHz and at 4 GHz', setup: { patch: { emitter: { f0: 400e6 }, solver: { ionosphere: false } }, tab: 'physics' },
        body: () => [
          'With the processor’s ionosphere switch off and the default 20 TECU, a 400 MHz emitter is located with a bias of ', L('e5lo'), '. Move the carrier to 4 GHz and the bias shrinks to ', L('e5hi'), ': the ionospheric group delay (on TDOA) and phase advance (on FDOA) are excess paths that both scale as 1/f₀², so ten times the carrier means about a hundred times less error. Raise the VTEC to see the low-frequency bias grow in proportion.',
        ],
      },
      {
        title: 'A moving emitter', setup: { patch: { emitter: { speed: 10, headingDeg: 0 } } },
        body: () => [
          'Let the emitter drive north at 10 m/s. The fix is now off by ', L('e6bias'), ', many times its CEP. The processor assumes a stationary emitter, so the emitter’s own Doppler, which differs between collectors by up to the range-rate projected on each line of sight, is interpreted as geometry. FDOA is the culprit: switch FDOA off (keep TDOA and the altitude constraint) and the bias falls to ', L('e6tdoa'), ', at the price of a CEP of ', L('e6tdoacep'), '. Turn the heading to see the bias swing round.',
        ],
      },
      {
        title: 'Scrub through the pass', setup: { patch: {} },
        body: () => [
          'Press Play, or drag the marker in the pass timeline. In the default scenario the best single snapshot is at t = ', L('e7t'), ' s, with a CEP of ', L('e7cep'), ', and the fix degrades sharply near the ends of the pass, where it reaches ', L('e7end'), ' at t = −300 s. Two things drive it: the elevation (the minimum elevation curve) and the angle at which the lines of position cross (switch on lines of position on the error map and watch them rotate). Note that the best snapshot is not at closest approach.',
        ],
      },
      {
        title: 'The degenerate cone', setup: { patch: { formation: { shape: 'diamond' }, orbit: { passEastKm: 0, passNorthKm: 0 }, use: { tdoa: true, fdoa: false, altitude: false } } },
        body: () => [
          'A diamond formation directly overhead, TDOA only, no altitude constraint. Seen from the emitter the four satellites lie on a circle, so all four lines of sight lie on one cone around the vertical, and moving the emitter up or down changes all four ranges almost equally: the TDOAs cannot see height. σU is ', L('e8su'), ' and the Monte-Carlo solver fails on most trials. Move the time slider to +60 s and σU falls to ', L('e8su60'), ' as the symmetry breaks; or, at t = 0, switch the altitude constraint on (CEP ', L('e8alt'), ').',
        ],
      },
    ];
    const expNodes = EXPERIMENTS.map((x, i) => {
      const body = el('div', 'prose');
      const p = el('p');
      for (const part of x.body()) p.append(part instanceof Node ? part : document.createTextNode(part));
      body.append(p);
      const b = button({ label: 'Set this up', onClick: () => setupExperiment(x.setup) });
      body.append(b.el);
      return callout('try', `${i + 1}. ${x.title}`, body);
    });
    root.append(
      section('Guided experiments',
        '<p>Each experiment starts from the scenario its button sets up. The numbers quoted in the text are computed live by the engine when the page loads, for exactly that set-up.</p>',
        el('div', 'lab-exp', expNodes)),
      questionSet(QUESTIONS['lab']),
      takeaways([
        'Location precision is a lever arm: a timing error becomes a position error in proportion to range ÷ baseline, a frequency error in proportion to wavelength × range² ÷ (speed × baseline), so wider formations and steeper crossing angles buy precision that no amount of receiver quality can.',
        'TDOA precision is bought with signal bandwidth and FDOA precision with integration time and carrier frequency; which one dominates depends on the signal, and the two together fix far better than either alone.',
        'Geometry multiplies everything: dilution of precision converts per-collector errors into metres, and it changes through the pass as the lines of position rotate and the elevations fall.',
        'Random noise integrates down over a pass; clock, oscillator and ephemeris biases and unmodelled physics do not, so once noise has been averaged away the systematic errors set the floor.',
        'Light-time, Earth rotation and the atmosphere (above all the ionosphere at low frequencies) are worth modelling: they cost decimetres to hundreds of metres. Second-order Doppler and relativistic clock rates cost decimetres and matter only for the most precise systems or free-running oscillators; Shapiro delay costs a millimetre and can be ignored.',
        'The Earth itself is a measurement: the known altitude of the emitter replaces a fourth satellite and pins the weakest direction of the fix, provided the altitude is right.',
      ]),
      nextLesson(ctx, 'welcome', 'Back to the start of the course'),
    );

    // ------------------------------------------------------------ plots
    const pal = () => palette();
    const mapPlot = new Plot2D(mapHost, {
      height: 440, equalAspect: true, view: { xmin: -150, xmax: 150, ymin: -110, ymax: 110 },
      xLabel: 'East of true emitter (m)', yLabel: 'North (m)',
      ariaLabel: 'Error map: Monte-Carlo fixes, CRLB 95 percent ellipse, CEP circle and bias arrow around the true emitter.',
    });
    let settingView = false;
    mapPlot.onViewChange = () => { if (!settingView && view.autoScale) { view.autoScale = false; autoCtl.set(false); } };
    const passPlot = new Plot2D(passHost, {
      height: 240, yLog: true, view: { xmin: -300, xmax: 300, ymin: 1, ymax: 1000 }, pan: false, zoom: false,
      xLabel: 'Time in pass (s)', yLabel: 'Horizontal error (m)', ariaLabel: 'Fix precision versus time through the pass.',
    });
    const geoChart = new Plot2D(geoChartHost, {
      height: 200, view: { xmin: -300, xmax: 300, ymin: 0, ymax: 90 }, pan: false, zoom: false,
      xLabel: 'Time in pass (s)', yLabel: 'Elevation (°)', ariaLabel: 'Collector elevations or measurements versus time.',
    });
    const passHandle = passPlot.addHandle({ x: ui.t, y: 30, color: '--accent', shape: 'diamond', radius: 7, label: 't',
      constrain: (x) => [clamp(Math.round(x), -300, 300), passHandle ? passHandle.y : 30], onDrag: (x) => setTime(x) });
    const geoHandle = geoChart.addHandle({ x: ui.t, y: 45, color: '--accent', shape: 'diamond', radius: 7, label: 't',
      constrain: (x) => [clamp(Math.round(x), -300, 300), geoHandle ? geoHandle.y : 45], onDrag: (x) => setTime(x) });
    passPlot.onClick = (x) => setTime(x);
    geoChart.onClick = (x) => setTime(x);

    // ------------------------------------------------------------ globe (async, optional)
    let globe = null;
    globeHost.style.height = '420px';
    createGlobe(globeHost, { height: 420 }).then((g) => {
      if (disposed) { g.dispose(); return; }
      globe = g;
      globeHost.style.height = '';
      globe.setLabelsVisible(view.globeLabels);
      trackKey = ''; lopKey = '';
      updateGlobe();
      scheduleGlobeLop();
      frameFormation(false);
    }).catch(() => {
      if (disposed) return;
      globeHost.style.height = '';
      globeNote.textContent = 'The 3-D view needs WebGL and the three.js library; it is unavailable here. Everything else on the page works without it.';
    });

    // ------------------------------------------------------------ dynamic controls
    let dynN = -1;
    const dyn = { refCtl: null, biasSel: null, sensSel: null };
    function rebuildDynamic(force = false) {
      const n = nCollectors(ui);
      ui.ref = Math.min(ui.ref, n - 1);
      view.sensCollector = Math.min(view.sensCollector, n - 1);
      view.biasCollector = Math.min(view.biasCollector, n - 1);
      if (n !== dynN || force) {
        dynN = n;
        const opts = IDS.slice(0, n).map((id, i) => ({ value: i, label: id }));
        dyn.refCtl = segmented({ label: 'Reference collector', options: opts, value: ui.ref, onChange: (v) => { ui.ref = v; changed(); } });
        refHost.replaceChildren(dyn.refCtl.el);
        dyn.biasSel = segmented({ label: 'Collector', options: opts, value: view.biasCollector, onChange: (v) => { view.biasCollector = v; buildBiasSliders(); } });
        dyn.sensSel = segmented({ label: 'Collector', options: opts, value: view.sensCollector, onChange: (v) => { view.sensCollector = v; renderTables(); } });
        sensSelHost.replaceChildren(dyn.sensSel.el);
        // SNR sliders
        snrHost.replaceChildren(...IDS.slice(0, n).map((id, i) => slider({
          label: `SNR at ${id} (in $B$)`, min: -20, max: 40, step: 0.5, value: ui.budget.snrDb[i], unit: 'dB', format: (v) => v.toFixed(1),
          onInput: (v) => { ui.budget.snrDb[i] = v; changed(); },
        }).el));
      } else {
        dyn.refCtl.set(ui.ref); dyn.biasSel.set(view.biasCollector); dyn.sensSel.set(view.sensCollector);
      }
      buildBiasSliders();
      buildOffsets(force);
    }
    function buildBiasSliders() {
      const i = view.biasCollector, id = IDS[i];
      biasHost.replaceChildren(dyn.biasSel.el,
        slider({ label: `${id}: clock offset`, min: -100, max: 100, step: 0.5, value: ui.bias.clockNs[i], unit: 'ns', format: (v) => v.toFixed(1), onInput: (v) => { ui.bias.clockNs[i] = v; changed(); } }).el,
        slider({ label: `${id}: frequency offset`, min: -5, max: 5, step: 0.01, value: ui.bias.freqHz[i], unit: 'Hz', format: (v) => v.toFixed(2), hint: 'Positive: this collector reads the frequency high.', onInput: (v) => { ui.bias.freqHz[i] = v; changed(); } }).el,
        slider({ label: `${id}: ephemeris in-track error`, min: -50, max: 50, step: 0.5, value: ui.bias.inTrackM[i], unit: 'm', format: (v) => v.toFixed(1), hint: 'The processor believes the satellite is this far ahead of where it is.', onInput: (v) => { ui.bias.inTrackM[i] = v; changed(); } }).el);
    }
    let offsetsShown = null;
    function buildOffsets(force) {
      const custom = ui.formation.custom && Array.isArray(ui.formation.offsets);
      shapeCtl.setDisabled(custom);
      baselineCtl.setDisabled(custom);
      const sig = custom ? JSON.stringify(ui.formation.offsets) : '';
      if (!force && sig === offsetsShown) return;
      offsetsShown = sig;
      if (!custom) { offsetsHost.replaceChildren(); return; }
      const rows = ui.formation.offsets.map((o, i) => {
        const ni = (lab, key) => numberInput({ label: lab, value: Number(o[key].toFixed(2)), min: key === 'radialKm' ? -300 : -3000, max: key === 'radialKm' ? 300 : 3000, step: 1,
          onChange: (v) => { ui.formation.offsets[i][key] = v; offsetsShown = JSON.stringify(ui.formation.offsets); changed(); } });
        return el('div', 'lab-offrow', el('span', { class: 'lab-offid', style: `color:var(${COLL[i]})` }, IDS[i]),
          ni('along', 'alongKm').el, ni('cross', 'crossKm').el, ni('radial', 'radialKm').el);
      });
      const n = ui.formation.offsets.length;
      const add = button({ label: 'Add collector', kind: 'ghost', onClick: () => { ui.formation.offsets.push({ alongKm: 0, crossKm: 0, radialKm: 50 }); structuralNoChange(); } });
      const rem = button({ label: 'Remove last', kind: 'ghost', onClick: () => { ui.formation.offsets.pop(); structuralNoChange(); } });
      add.setDisabled(n >= 4); rem.setDisabled(n <= 2);
      offsetsHost.replaceChildren(...rows, el('div', 'lab-row', add.el, rem.el),
        el('div', 'ctrl-hint', 'Offsets hold at t = 0; the formation then breathes along its genuine orbits. Two collectors at the same point make the geometry singular.'));
    }
    function showBudgetMode() {
      const sig = ui.budget.mode === 'signal';
      directBox.style.display = sig ? 'none' : 'grid';
      signalBox.style.display = sig ? 'grid' : 'none';
    }

    function syncControls() {
      for (const b of bindings) b.ctrl.set(b.get());
      showBudgetMode();
      rebuildDynamic(true);
      playBtn.setLabel(playing ? 'Pause' : 'Play');
    }

    function applyUi(next, presetId = null) {
      stopPlay();
      ui = sanitizeUi(next);
      syncControls();
      markPreset(presetId);
      changed(true);
      if (globe) frameFormation(true);
      view.autoScale = true; autoCtl.set(true);
    }
    function setupExperiment(s) {
      applyUi(presetUi('tight') && sanitizeUi(deepMerge(DEFAULT_UI, s.patch || {})), null);
      if (s.tab) { view.tab = s.tab; tabCtl.set(s.tab); showTab(); }
      if (s.sens != null) { view.sensCollector = s.sens; dyn.sensSel.set(s.sens); }
      renderTables();
      if (view.tab === 'physics') scheduleEffects(0);
      workspaceTop();
    }
    function workspaceTop() {
      const ws = controlsCol.parentElement;
      if (ws && ws.scrollIntoView) ws.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ------------------------------------------------------------ change handling
    function structural() { changed(); }
    function structuralNoChange() { rebuildDynamic(true); changed(); }

    function changed(keepPreset = false) {
      if (!keepPreset && view.activePreset !== null) markPreset(null);
      saveSoon();
      if (rafId) return;
      // rAF coalesces work while sliders move; the timer fallback covers background tabs where rAF pauses.
      let fallback = null;
      const run = () => { if (!rafId) return; cancelAnimationFrame(rafId); rafId = 0; cancel(fallback); if (!disposed) recompute(); };
      rafId = requestAnimationFrame(run);
      fallback = later(run, 120);
    }

    let playing = false, playRaf = 0, lastTs = 0;
    function togglePlay() { if (playing) stopPlay(); else startPlay(); }
    function startPlay() {
      playing = true; playBtn.setLabel('Pause'); lastTs = 0;
      const step = (ts) => {
        playRaf = 0;
        if (!playing || disposed) return;
        const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
        lastTs = ts;
        let t = ui.t + dt * PLAY_RATE;
        if (t > 300) t = -300;
        ui.t = Math.round(t * 10) / 10;
        timeCtl.set(ui.t);
        changed();
        playRaf = requestAnimationFrame(step);
      };
      playRaf = requestAnimationFrame(step);
    }
    function stopPlay() {
      playing = false;
      if (playRaf) cancelAnimationFrame(playRaf);
      playRaf = 0;
      playBtn.setLabel('Play');
    }
    function setTime(t) {
      ui.t = clamp(Math.round(t), -300, 300);
      timeCtl.set(ui.t);
      changed();
    }

    // ------------------------------------------------------------ the live pass
    let cfgKey = '', cfgKeyNoT = '';
    function recompute() {
      rebuildDynamic();
      A = analyse(ui);
      const keyCfg = A.cfg ? JSON.stringify(A.cfg) : String(Math.random());
      const keyNoT = A.cfg ? JSON.stringify({ ...A.cfg, t: 0 }) : keyCfg;
      const cfgChanged = keyCfg !== cfgKey;
      cfgKey = keyCfg;
      if (keyNoT !== cfgKeyNoT) { cfgKeyNoT = keyNoT; schedulePass(); }
      if (A.error) console.warn('lab: engine error', A.error);
      renderSideHints();
      renderStatus();
      renderTables();
      updateGlobe();
      if (cfgChanged) {
        restartMc(playing ? 600 : 220);
        effects = null; scheduleEffects(view.tab === 'physics' ? 250 : -1);
        if (globe && view.globeLop) { globe.setPolylines('lop', []); scheduleGlobeLop(); }
      }
      if (view.autoScale) fitMap(false);
      mapPlot.requestRedraw();
      passHandle.x = ui.t; geoHandle.x = ui.t;
      passPlot.requestRedraw(); geoChart.requestRedraw();
    }

    function renderSideHints() {
      const f0 = ui.emitter.f0;
      loHint.textContent = `= ${fmtSI(f0 * ui.budget.lo, 'Hz')} (1σ) at the ${freqLabel(f0)} carrier`;
      overheadNote.textContent = A.S && A.S.overhead === false
        ? `An orbit inclined ${ui.orbit.incDeg.toFixed(1)}° cannot reach the pass point’s latitude; the track passes at its highest latitude instead, so the offsets no longer mean what they say.`
        : '';
      const src = biasSources(ui);
      biasSummary.textContent = src.length ? `Active: ${src.join('; ')}.` : 'No deterministic errors are active.';
      if (ui.budget.mode === 'signal') {
        const n = nCollectors(ui), d = derivedNoise(ui, n);
        const ro = el('div', 'readout-block');
        const dl = el('dl', 'readout');
        IDS.slice(0, n).forEach((id, i) => {
          dl.append(el('dt', null, `${id}: σTOA, σFOA`), el('dd', null, `${fmtSI(d.sigmaToa[i], 's')}, ${fmtSI(d.sigmaFoa[i], 'Hz')}`));
        });
        const r = Math.min(ui.ref, n - 1);
        IDS.slice(0, n).forEach((id, i) => {
          if (i === r) return;
          dl.append(el('dt', null, `pair ${id}–${IDS[r]}: BTγ`), el('dd', null, `${d.postSnrDb[i].toFixed(1)} dB`));
        });
        ro.append(dl);
        const low = d.postSnrDb.some((v, i) => i !== r && v < 13);
        derivedRo.replaceChildren(ro, el('div', 'ctrl-hint',
          'Per-collector equivalents of Stein’s CAF bounds: σT,i = σTDOA(γi, γi)/√2, which keeps the noise×noise term that matters at low SNR. ' +
          (ui.budget.signalBwHz > ui.budget.noiseBwHz ? 'Signal bandwidth is limited to B. ' : '') +
          (low ? 'Careful: a post-integration SNR B·T·γ below about 13 dB is near the CAF detection threshold, where the Cramér-Rao bound is optimistic.' : '')));
      } else derivedRo.replaceChildren();
      sigmaAltCtl.setDisabled(!ui.use.altitude);
    }

    function chip(text, cls = '') { return el('span', `lab-chip ${cls}`, ...text); }
    function renderStatus() {
      const chips = [];
      const banners = [];
      if (A.error || !A.geo) {
        chips.push(chip(['Engine error'], 'bad'));
        banners.push(`The engine could not evaluate this configuration (${A.error ? A.error.message : 'unknown error'}). Try different settings or press Reset.`);
        statusEl.replaceChildren(...chips); bannerEl.textContent = banners.join(' '); bannerEl.className = 'lab-banner';
        return;
      }
      const n = A.S.n;
      chips.push(chip([el('b', null, String(n)), ` collector${n > 1 ? 's' : ''}`]));
      if (A.allVisible) chips.push(chip([`All above ${MASK_DEG}°`], 'good'));
      else chips.push(chip([`${A.below.join(', ')} below ${MASK_DEG}° mask`], 'bad'));
      if (!A.allVisible) chips.push(chip(['No collection: no fix'], 'bad'));
      else if (!A.cov.observable) chips.push(chip(['No fix possible'], 'bad'));
      else chips.push(chip(['Fix observable'], 'good'));
      if (A.canFix) {
        const c = A.cov;
        chips.push(chip(['CEP ', el('b', null, dist(c.cep50))]));
        chips.push(chip(['95 % ellipse ', el('b', null, `${dist(c.ellipse.semiMajor)} × ${dist(c.ellipse.semiMinor)}`)]));
        chips.push(chip(['σU ', el('b', null, dist(c.sigmaU))]));
        if (A.sources.length) {
          if (A.bias) chips.push(chip(['Bias ', el('b', null, dist(Math.hypot(A.bias.errEnu[0], A.bias.errEnu[1]))), ' horiz., ', el('b', null, signedDist(A.bias.errEnu[2])), ' up'], 'warn'));
          else chips.push(chip(['Bias: solver did not converge'], 'bad'));
        } else chips.push(chip(['No deterministic bias']));
        if (c.mrse > 1e5) banners.push(`The geometry is nearly degenerate: the fix exists in principle but its 3-D rms error is ${dist(c.mrse)}. Expect the Monte-Carlo solver to fail on many trials.`);
      }
      if (!A.allVisible) {
        banners.push(`Collector${A.below.length > 1 ? 's' : ''} ${A.below.join(', ')} ${A.below.length > 1 ? 'are' : 'is'} below the ${MASK_DEG}° elevation mask at t = ${ui.t.toFixed(0)} s: no collection is possible at this instant. Move the time slider towards the middle of the pass or bring the ground track closer to the emitter.`);
      } else if (!A.cov.observable) {
        const u = ui.use, nm = (u.tdoa ? n - 1 : 0) + (u.fdoa ? n - 1 : 0) + (u.altitude ? 1 : 0);
        banners.push(`No fix possible with these measurements: ${nm} measurement${nm === 1 ? '' : 's'} for 3 unknowns${nm >= 3 ? ', and they do not constrain all three directions in this geometry' : ''}. ` +
          (n === 2 ? 'With two collectors you need TDOA, FDOA and the altitude constraint together.' : 'Switch on more measurements (FDOA or the altitude constraint).'));
      }
      statusEl.replaceChildren(...chips);
      bannerEl.textContent = banners.join(' ');
      bannerEl.className = A.canFix ? 'lab-banner warn' : 'lab-banner';
    }

    // ------------------------------------------------------------ tables
    let budgetDom = [];
    function domFmt(key) {
      return (v, row) => {
        const s = fixed(v, key[0] === 't' ? 2 : 4);
        return row.dom && row.dom.includes(key) ? el('span', 'lab-dom', s) : s;
      };
    }
    function showTab() { for (const [k, p] of Object.entries(panels)) p.hidden = k !== view.tab; }

    function renderTables() {
      if (!A || !A.geo) {
        for (const t of [geomTable, budgetTable, sensMeasTable, sensColTable, dopTable]) t.setRows([]);
        return;
      }
      const ref = A.S.cfg.ref;
      if (view.tab === 'geometry') {
        geomTable.setRows(A.geo.collectors.map((c, i) => {
          const o = A.obs.collectors[i];
          return {
            id: `${c.id}${i === ref ? ' (ref)' : ''}`, range: fixed(c.rangeKm, 1), el: fixed(c.elevationDeg, 1), az: fixed(c.azimuthDeg, 1),
            tof: fixed(o.delay * 1e3, 4), dop: fixed(o.dopplerShift / 1e3, 3),
            tdoa: i === ref ? '—' : fixed(A.obs.tdoa[i] * 1e6, 4), fdoa: i === ref ? '—' : fixed(A.obs.fdoa[i], 2),
            vis: c.elevationDeg > MASK_DEG ? 'yes' : 'no', highlight: !(c.elevationDeg > MASK_DEG),
          };
        }));
        geomNote.textContent = `Truth at t = ${ui.t.toFixed(0)} s with the full physical model. Azimuth is clockwise from north as seen from the emitter; Doppler shift is the received minus the transmitted carrier (positive while the range closes). TDOA and FDOA are "collector minus reference": τ = t(i) − t(ref), ν = f(i) − f(ref).`;
      }
      if (view.tab === 'budget') {
        const parts = A.cov.budget.parts;
        let worst = null;
        budgetTable.setRows(parts.map((p, i) => {
          const t = { tn: p.toaNoise, tc: p.clock, tp: p.posAsTime };
          const f = { fn: p.foaNoise, fo: p.lo, fv: p.velAsFreq, fp: p.posAsFreq };
          const tk = Object.keys(t).reduce((a, b) => (t[b] > t[a] ? b : a));
          const fk = Object.keys(f).reduce((a, b) => (f[b] > f[a] ? b : a));
          if (!worst || p.toaTotal > worst.p.toaTotal) worst = { i, p, tk, fk };
          return {
            id: A.S.ids[i], tn: p.toaNoise * 1e9, tc: p.clock * 1e9, tp: p.posAsTime * 1e9, tt: fixed(p.toaTotal * 1e9, 2),
            fn: p.foaNoise, fo: p.lo, fv: p.velAsFreq, fp: p.posAsFreq, ft: fixed(p.foaTotal, 4), dom: [tk, fk],
          };
        }));
        const NAMES = { tn: 'measurement noise', tc: 'clock synchronisation', tp: 'ephemeris position', fn: 'measurement noise', fo: 'the frequency reference', fv: 'ephemeris velocity', fp: 'ephemeris position (line-of-sight tilt)' };
        const w = worst;
        const tv = { tn: w.p.toaNoise, tc: w.p.clock, tp: w.p.posAsTime }[w.tk];
        const fv = { fn: w.p.foaNoise, fo: w.p.lo, fv: w.p.velAsFreq, fp: w.p.posAsFreq }[w.fk];
        budgetNote.textContent = `Collector ${A.S.ids[w.i]}: the time-of-arrival error is dominated by ${NAMES[w.tk]} (${fmtSI(tv, 's')} of ${fmtSI(w.p.toaTotal, 's')} total), the frequency-of-arrival error by ${NAMES[w.fk]} (${fmtSI(fv, 'Hz')} of ${fmtSI(w.p.foaTotal, 'Hz')}).` +
          (ui.use.tdoa || ui.use.fdoa ? '' : ' (Neither TDOA nor FDOA is in use.)');
      }
      if (view.tab === 'sensitivity') renderSensitivity();
      if (view.tab === 'physics') renderPhysics();
      if (view.tab === 'dop') renderDop();
    }

    function renderSensitivity() {
      const s = A.sens;
      if (!A.canFix || !s || !s.observable) {
        sensSentence.textContent = A.allVisible ? 'No fix is possible with these measurements, so there is nothing to be sensitive.' : 'A collector is below the elevation mask: no fix at this instant.';
        sensMeasTable.setRows([]); sensColTable.setRows([]);
        return;
      }
      const ci = Math.min(view.sensCollector, s.perCollector.length - 1);
      const pc = s.perCollector[ci];
      const row = (it) => ({ label: it.label, per: it.per, e: fixed(it.enu[0], 3), n: fixed(it.enu[1], 3), u: fixed(it.enu[2], 3), h: fixed(it.horiz, 3) });
      sensColTable.setRows(pc.items.map((it) => ({ ...row(it), highlight: it.kind === 'freq' })));
      sensMeasTable.setRows(s.perMeasurement.map((it) => ({ ...row(it), label: it.label.replace('−', '−') })));
      const fq = pc.items.find((x) => x.kind === 'freq'), ck = pc.items.find((x) => x.kind === 'clock');
      const id = pc.id;
      const dir = (enu) => `${fmtDist(Math.abs(enu[0]))} ${enu[0] >= 0 ? 'east' : 'west'}, ${fmtDist(Math.abs(enu[1]))} ${enu[1] >= 0 ? 'north' : 'south'} and ${fmtDist(Math.abs(enu[2]))} ${enu[2] >= 0 ? 'up' : 'down'}`;
      const parts = [];
      if (ui.use.fdoa && fq.total > 1e-9) parts.push(`If collector ${id} reads the frequency 1 Hz high, the fix moves ${dir(fq.enu)}: ${fmtDist(fq.horiz)} horizontally.`);
      else parts.push(`FDOA is not used, so a frequency error at collector ${id} does not move the fix.`);
      if (ui.use.tdoa && ck.total > 1e-9) parts.push(`A 1 ns clock error at ${id} moves it ${fmtDist(ck.horiz)} horizontally (${dir(ck.enu)}).`);
      else parts.push(`TDOA is not used, so a clock error at ${id} does not move the fix.`);
      sensSentence.textContent = parts.join(' ');
    }

    let effects = null, effectsTimer = null, effectsKey = '';
    function scheduleEffects(ms) {
      cancel(effectsTimer);
      if (ms < 0) return;
      effectsTimer = later(() => {
        if (!A || !A.S || view.tab !== 'physics') return;
        if (effectsKey === cfgKey && effects) { renderPhysics(); return; }
        try {
          effects = SC.effectsTable(A.S, undefined, {
            emitterSpeed: ui.emitter.speed > 0 ? ui.emitter.speed : 1,
            altError: ui.bias.altM !== 0 ? ui.bias.altM : 30,
          });
          effectsKey = cfgKey;
        } catch (e) { effects = null; }
        renderPhysics();
      }, ms);
    }
    function renderPhysics() {
      if (!effects || effectsKey !== cfgKey) {
        physNote.textContent = 'Computing…';
        if (effectsKey !== cfgKey) scheduleEffects(200);
        return;
      }
      const fixOk = A.canFix;
      const offs = [];
      physTable.setRows(effects.map((r) => {
        let state = '', on = true;
        if (EFFECT_SWITCH[r.key]) { on = !!ui.solver[EFFECT_SWITCH[r.key]]; state = on ? 'modelled' : 'IGNORED'; }
        else if (r.key === 'clock') { on = !!ui.truthProperTimeLO === !!ui.solver.properTimeLO; state = ui.truthProperTimeLO ? (on ? 'corrected' : 'IGNORED') : (on ? 'n/a (disciplined)' : 'WRONGLY corrected'); }
        else if (r.key === 'motion') { on = !(ui.emitter.speed > 0); state = on ? 'stationary' : 'MOVING'; }
        else if (r.key === 'altitude') { on = !(ui.bias.altM !== 0 && ui.use.altitude); state = ui.use.altitude ? (on ? 'correct' : 'WRONG') : 'not used'; }
        else if (r.key === 'carrier') { state = 'known'; }
        if (!on) offs.push(r.label);
        return {
          label: el('span', { title: r.note }, r.label), dt: fixed(r.maxTdoa * 1e9, 3), df: fixed(r.maxFdoa, 4),
          bh: fixOk && r.biasEnu ? fixed(r.biasHoriz, 3) : '—', bu: fixOk && r.biasEnu ? fixed(r.biasEnu[2], 3) : '—',
          state, highlight: !on,
        };
      }).map((r) => ({ ...r, label: r.label })));
      const total = A.bias ? Math.hypot(A.bias.errEnu[0], A.bias.errEnu[1]) : null;
      physNote.textContent = (offs.length
        ? `This processor currently gets wrong: ${offs.join('; ')}. Together, with any deliberate errors, they put the fix ${total != null ? fmtDist(total) : '(no fix)'} from the truth horizontally (the bias on the error map).`
        : 'This processor models every effect the simulator includes, so none of these rows contributes a bias.') +
        (ui.emitter.speed > 0 && Math.abs(ui.emitter.headingDeg - 90) > 1 ? ' (The motion row assumes eastward motion at the current speed; the error map uses the actual heading.)' : '') +
        (!fixOk ? ' No fix is possible right now, so the fix-error columns are empty.' : '');
    }

    function renderDop() {
      const d = A.dop;
      const parts = A.cov.budget.parts;
      const rms = (f) => Math.sqrt(parts.reduce((s, p) => s + f(p) ** 2, 0) / parts.length);
      const sT = rms((p) => p.toaTotal), sF = rms((p) => p.foaTotal);
      const lam = C / ui.emitter.f0;
      const mT = C * sT, mF = lam * sF;
      const rows = [];
      const add = (m, fix, x, isT) => {
        const k = isT ? mT : mF;
        if (x == null) { rows.push({ m, fix, h: 'no fix', v: '—', unit: isT ? '—' : 's', mh: '—', mv: '—' }); return; }
        const h = typeof x === 'number' ? x : x.h, v = typeof x === 'number' ? null : x.v;
        rows.push({ m, fix, h: fmt(h, 3), v: v == null ? '—' : fmt(v, 3), unit: isT ? 'dimensionless' : 'seconds', mh: dist(h * k), mv: v == null ? '—' : dist(v * k) });
      };
      add('TDOA', '3-D', d.tdoa3d, true);
      add('TDOA', 'on the surface', d.tdoaSurface, true);
      add('FDOA', '3-D', d.fdoa3d, false);
      add('FDOA', 'on the surface', d.fdoaSurface, false);
      dopTable.setRows(rows);
      dopNote.textContent = `DOP is the position error per unit of per-collector error, from geometry alone (all collectors equally noisy). TDOA DOP multiplies the range-equivalent timing error c·σT; FDOA DOP (in seconds) multiplies the range-rate-equivalent frequency error λ·σF. Conversions use the rms per-collector totals of the current budget: c·σT = ${dist(mT)}, λ·σF = ${fmt(mF, 3)} m/s. Each row is one measurement type on its own; the CRLB in the status strip combines everything selected, with the actual altitude uncertainty.`;
    }

    // ------------------------------------------------------------ Monte-Carlo (chunked)
    const mc = { gen: 0, errors: [], failures: 0, chunks: 0, stats: null, key: '', timer: null, Penu: null };
    function restartMc(delay) {
      mc.gen++;
      cancel(mc.timer);
      mc.errors = []; mc.failures = 0; mc.chunks = 0; mc.stats = null;
      if (!A || !A.canFix) { mcProg.textContent = 'Monte-Carlo: no fix possible.'; renderMapTable(); mapPlot.requestRedraw(); return; }
      mcProg.textContent = playing ? 'Monte-Carlo: waits until the pass is paused.' : 'Monte-Carlo: starting…';
      renderMapTable();
      const gen = mc.gen, S = A.S, Penu = A.cov.Penu;
      mc.Penu = Penu;
      const run = () => {
        if (gen !== mc.gen || disposed) return;
        if (playing) { mc.timer = later(run, 300); return; }
        let r;
        try { r = mcChunk(S, MC_CHUNK, 1 + mc.chunks * 7919); } catch (e) { r = { errors: [], failures: MC_CHUNK }; }
        if (gen !== mc.gen) return;
        mc.chunks++;
        for (const e of r.errors) mc.errors.push(e);
        mc.failures += r.failures;
        mc.stats = mcAccumulate(mc.errors, mc.failures, Penu);
        const done = mc.errors.length + mc.failures;
        mcProg.textContent = `Monte-Carlo: ${done} / ${MC_MAX} trials${mc.failures ? `, ${mc.failures} failed` : ''}${done >= MC_MAX ? '' : '…'}`;
        renderMapTable();
        mapPlot.requestRedraw();
        if (done < MC_MAX) mc.timer = later(run, 0);
      };
      mc.timer = later(run, delay);
    }

    function renderMapTable() {
      if (!A || !A.canFix) { mapTable.setRows([{ q: 'No fix possible at this instant', crlb: '—', mc: '—' }]); return; }
      const c = A.cov, s = mc.stats, b = A.bias ? A.bias.errEnu : null;
      const se = (k) => (s && s.cov ? 2 * Math.sqrt(Math.max(s.cov[k][k], 0) / s.n) : null);
      const meanTxt = (k) => (s && s.mean ? `${signedDist(s.mean[k])} ± ${dist(se(k))}` : '—');
      mapTable.setRows([
        { q: 'CEP (50 %)', crlb: dist(c.cep50), mc: s ? dist(s.cep50) : '—' },
        { q: 'rms horizontal (DRMS)', crlb: dist(c.drms), mc: s ? dist(s.rmsHoriz) : '—' },
        { q: 'rms vertical', crlb: dist(c.sigmaU), mc: s ? dist(s.rmsUp) : '—' },
        { q: 'bias east (mean ± 2 s.e.)', crlb: b ? signedDist(b[0]) : '—', mc: meanTxt(0), highlight: !!A.sources.length },
        { q: 'bias north', crlb: b ? signedDist(b[1]) : '—', mc: meanTxt(1), highlight: !!A.sources.length },
        { q: 'bias up', crlb: b ? signedDist(b[2]) : '—', mc: meanTxt(2), highlight: !!A.sources.length },
        { q: 'inside the 95 % ellipse', crlb: '95 %', mc: s && s.inside != null ? `${(s.inside * 100).toFixed(1)} %` : '—' },
        { q: 'trials / failures', crlb: '', mc: s ? `${s.n} / ${mc.failures}` : `0 / ${mc.failures}` },
      ]);
    }

    // ------------------------------------------------------------ error map
    function fitMap(force) {
      if (!A || !A.canFix) return;
      const c = A.cov, b = A.bias ? A.bias.errEnu : [0, 0, 0];
      const bh = Math.hypot(b[0], b[1]);
      const big = c.ellipse.semiMajor;
      const half = Math.max(1.35 * big, 3.2 * c.cep50, bh / 2 + 1.25 * big, 1);
      const cx = bh > 0.3 * big ? b[0] / 2 : 0, cy = bh > 0.3 * big ? b[1] / 2 : 0;
      const v = mapPlot.getView();
      const span = Math.max(v.xmax - v.xmin, v.ymax - v.ymin) / 2;
      const off = Math.hypot((v.xmin + v.xmax) / 2 - cx, (v.ymin + v.ymax) / 2 - cy);
      if (!force && span > 0 && half / span > 0.6 && half / span < 1.6 && off < 0.3 * span) return;
      settingView = true;
      mapPlot.setView({ xmin: cx - half, xmax: cx + half, ymin: cy - half * 0.75, ymax: cy + half * 0.75 });
      settingView = false;
    }

    let lopCache = { key: '', fields: null };
    function mapLopFields(g) {
      const v = g.view;
      const key = `${cfgKey}|${v.xmin.toFixed(3)},${v.xmax.toFixed(3)},${v.ymin.toFixed(3)},${v.ymax.toFixed(3)}`;
      if (lopCache.key === key) return lopCache.fields;
      const S = A.S, ref = S.cfg.ref, layout = A.cov.layout;
      const meas = layout.map((q, k) => ({ q, k })).filter(({ q }) => q.type === 'tdoa' || q.type === 'fdoa');
      let fields = [];
      try {
        const f = SC.mapField(S);
        const c0 = f(0, 0);
        const nx = 26, ny = 20;
        const dx = (v.xmax - v.xmin) / (nx - 1), dy = (v.ymax - v.ymin) / (ny - 1);
        fields = meas.map(({ q, k }) => ({ q, sigma: Math.sqrt(A.cov.R[k][k]), f: { nx, ny, x0: v.xmin, y0: v.ymin, dx, dy, data: new Float64Array(nx * ny), xLog: false, yLog: false } }));
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const r = f(v.xmin + i * dx, v.ymin + j * dy);
            fields.forEach((F) => {
              const arr = F.q.type === 'tdoa' ? 'tdoa' : 'fdoa';
              F.f.data[j * nx + i] = r ? (r[arr][F.q.i] - r[arr][ref]) - (c0[arr][F.q.i] - c0[arr][ref]) : NaN;
            });
          }
        }
      } catch (e) { fields = []; }
      lopCache = { key, fields };
      return fields;
    }

    mapPlot.onDraw = (g) => {
      const P = pal();
      if (!A || !A.canFix) {
        g.marker(0, 0, 'diamond', 12, { color: '--emitter' });
        const v = g.view;
        g.text((v.xmin + v.xmax) / 2, v.ymax - (v.ymax - v.ymin) * 0.1, A && !A.allVisible ? 'A collector is below the elevation mask: no fix' : 'No fix possible with these measurements', { align: 'center', size: 14, color: '--critical' });
        return;
      }
      const c = A.cov;
      if (view.mapLop) {
        for (const F of mapLopFields(g)) {
          const col = F.q.type === 'tdoa' ? '--tdoa' : '--fdoa';
          g.contourBand(F.f, -F.sigma, F.sigma, { fill: col, fillAlpha: 0.07 });
          const name = (F.q.type === 'tdoa' ? 'τ' : 'ν') + IDS[F.q.i] + IDS[F.q.j];
          g.contour(F.f, [0], { color: col, width: 1.4, alpha: 0.85, labels: () => name });
        }
      }
      if (mc.errors.length) g.points(mc.errors.map((e) => [e[0], e[1]]), { color: '--plot-text', size: 1.7, alpha: 0.45 });
      g.ellipse(0, 0, c.ellipse.semiMajor, c.ellipse.semiMinor, c.ellipse.angle, { color: '--accent', width: 2 });
      g.circleWorld(0, 0, c.cep50, { color: '--accent', width: 1.2, dash: [5, 4] });
      const b = A.bias ? A.bias.errEnu : null;
      const bh = b ? Math.hypot(b[0], b[1]) : 0;
      if (b && A.sources.length && bh > 1e-3) {
        g.ellipse(b[0], b[1], c.ellipse.semiMajor, c.ellipse.semiMinor, c.ellipse.angle, { color: '--accent', width: 1, dash: [3, 4], alpha: 0.6 });
        g.arrow(0, 0, b[0], b[1], { color: '--estimate', width: 2 });
        g.marker(b[0], b[1], 'cross', 12, { color: '--estimate' });
      }
      const s = mc.stats;
      if (s && s.mean) g.marker(s.mean[0], s.mean[1], 'circle', 8, { color: '--series-4' });
      g.marker(0, 0, 'diamond', 12, { color: '--emitter' });
      const items = [
        { label: 'True emitter', color: '--emitter', marker: 'diamond' },
        { label: 'Monte-Carlo fixes', color: '--plot-text', marker: 'circle' },
        { label: 'CRLB 95 % ellipse', color: '--accent', width: 2 },
        { label: 'CEP (CRLB)', color: '--accent', width: 1.2, dash: [5, 4] },
      ];
      if (s && s.mean) items.push({ label: 'Mean of the cloud', color: '--series-4', marker: 'circle' });
      if (b && A.sources.length && bh > 1e-3) items.push({ label: 'Predicted bias', color: '--estimate', marker: 'cross' });
      if (view.mapLop && ui.use.tdoa) items.push({ label: 'TDOA line ±1σ', color: '--tdoa', width: 1.4 });
      if (view.mapLop && ui.use.fdoa) items.push({ label: 'FDOA line ±1σ', color: '--fdoa', width: 1.4 });
      g.legend(items, { position: 'bottom-left' });
      void P;
    };
    mapPlot.onHover = (x, y) => `E ${fmt(x, 4)} m   N ${fmt(y, 4)} m\nr ${fmtDist(Math.hypot(x, y))}`;

    // ------------------------------------------------------------ pass timeline
    let pass = null, passTimer = null;
    function schedulePass() {
      cancel(passTimer);
      passTimer = later(() => {
        if (!A || !A.S) { pass = null; return; }
        try { pass = SC.passSeries(A.S, TIMES); } catch (e) { pass = null; }
        fitPassChart();
        fitGeoChart();
        renderPassNote();
      }, playing ? 50 : 350);
    }
    function fitPassChart() {
      let lo = Infinity, hi = -Infinity;
      if (pass) for (const p of pass) for (const v of [p.cep50, p.drms, p.cumDrms]) if (fin(v) && v > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (!(hi > 0)) { lo = 1; hi = 1000; }
      hi = Math.min(hi, 1e8);
      lo = Math.max(lo, 1e-4);
      const ymin = Math.pow(10, Math.floor(Math.log10(lo))), ymax = Math.pow(10, Math.ceil(Math.log10(hi * 1.01)));
      passPlot.setView({ xmin: -300, xmax: 300, ymin, ymax: ymax > ymin ? ymax : ymin * 10 });
      passHandle.y = Math.sqrt(ymin * ymax);
      passPlot.requestRedraw();
    }
    function fitGeoChart() {
      let ymin = 0, ymax = 90;
      if (pass && view.chartMode !== 'elevation') {
        const k = view.chartMode;
        const sc = k === 'tdoa' ? 1e6 : 1;
        let lo = Infinity, hi = -Infinity;
        for (const p of pass) p[k].forEach((v) => { if (fin(v)) { lo = Math.min(lo, v * sc); hi = Math.max(hi, v * sc); } });
        if (!(hi >= lo)) { lo = -1; hi = 1; }
        const pad = Math.max((hi - lo) * 0.08, 1e-6);
        ymin = lo - pad; ymax = hi + pad;
      }
      geoChart.setView({ xmin: -300, xmax: 300, ymin, ymax });
      geoHandle.y = (ymin + ymax) / 2;
      geoChart.requestRedraw();
    }
    function renderPassNote() {
      if (!pass) { passNote.textContent = ''; return; }
      let best = null;
      for (const p of pass) if (p.allVisible && fin(p.cep50) && (!best || p.cep50 < best.cep50)) best = p;
      const last = [...pass].reverse().find((p) => fin(p.cumDrms));
      passNote.textContent = best
        ? `Best single snapshot: t = ${best.t} s, CEP ${fmtDist(best.cep50)} (minimum elevation ${Math.min(...best.elevationDeg).toFixed(1)}°). All snapshots with every collector above ${MASK_DEG}°, combined: horizontal rms ${last ? fmtDist(last.cumDrms) : '—'}.`
        : `No instant in this pass has every collector above ${MASK_DEG}° with an observable fix.`;
    }
    passPlot.onDraw = (g) => {
      const v = g.view;
      g.segment(ui.t, v.ymin, ui.t, v.ymax, { color: '--accent', width: 1.5, alpha: 0.8 });
      if (!pass) { g.text(0, Math.sqrt(v.ymin * v.ymax), 'Computing…', { align: 'center' }); return; }
      // shade instants where some collector is below the mask
      for (const p of pass) if (!p.allVisible) g.polygon([[p.t - 5, v.ymin], [p.t + 5, v.ymin], [p.t + 5, v.ymax], [p.t - 5, v.ymax]], { fill: '--critical', fillAlpha: 0.08, stroke: false });
      const ln = (k) => pass.map((p) => [p.t, p.allVisible && fin(p[k]) && p[k] > 0 ? p[k] : NaN]);
      g.line(ln('drms'), { color: '--series-1', width: 1.2, dash: [5, 4] });
      g.line(ln('cep50'), { color: '--series-1', width: 2 });
      g.line(pass.map((p) => [p.t, fin(p.cumDrms) && p.cumDrms > 0 ? p.cumDrms : NaN]), { color: '--series-3', width: 2.5 });
      g.legend([
        { label: 'Snapshot CEP', color: '--series-1', width: 2 },
        { label: 'Snapshot DRMS', color: '--series-1', width: 1.2, dash: [5, 4] },
        { label: 'Cumulative DRMS (optimistic)', color: '--series-3', width: 2.5 },
        { label: `Some collector below ${MASK_DEG}°`, color: '--critical', fill: true },
      ], { position: 'top-right' });
    };
    passPlot.onHover = (x) => {
      if (!pass) return null;
      const p = pass[clamp(Math.round((x + 300) / 10), 0, pass.length - 1)];
      return `t ${p.t} s\nCEP ${p.allVisible && fin(p.cep50) ? fmtDist(p.cep50) : '—'}\ncumulative DRMS ${fin(p.cumDrms) ? fmtDist(p.cumDrms) : '—'}`;
    };
    geoChart.onDraw = (g) => {
      const v = g.view;
      g.segment(ui.t, v.ymin, ui.t, v.ymax, { color: '--accent', width: 1.5, alpha: 0.8 });
      if (!pass) return;
      const n = pass[0].elevationDeg.length, ref = A && A.S ? A.S.cfg.ref : 0;
      if (view.chartMode === 'elevation') {
        g.segment(-300, MASK_DEG, 300, MASK_DEG, { color: '--critical', width: 1, dash: [4, 4] });
        g.text(-295, MASK_DEG, `${MASK_DEG}° mask`, { dy: -8, size: 11, color: '--critical' });
        for (let i = 0; i < n; i++) g.line(pass.map((p) => [p.t, p.elevationDeg[i]]), { color: COLL[i], width: 1.8 });
        g.legend(IDS.slice(0, n).map((id, i) => ({ label: id, color: COLL[i], width: 1.8 })), { position: 'top-right' });
      } else {
        const k = view.chartMode, sc = k === 'tdoa' ? 1e6 : 1;
        const items = [];
        for (let i = 0; i < n; i++) {
          if (i === ref) continue;
          g.line(pass.map((p) => [p.t, p[k][i] * sc]), { color: COLL[i], width: 1.8 });
          items.push({ label: `${k === 'tdoa' ? 'τ' : 'ν'}${IDS[i]}${IDS[ref]} (${k === 'tdoa' ? 'µs' : 'Hz'})`, color: COLL[i], width: 1.8 });
        }
        g.legend(items, { position: 'top-right' });
      }
    };
    geoChart.onHover = (x, y) => `t ${x.toFixed(0)} s\n${view.chartMode === 'elevation' ? `${y.toFixed(1)}°` : view.chartMode === 'tdoa' ? `${fmt(y, 4)} µs` : `${fmt(y, 4)} Hz`}`;

    // ------------------------------------------------------------ globe drawing
    let trackKey = '', lopKey = '', lopTimer = null;
    function orbitKey() { return A && A.cfg ? JSON.stringify([A.cfg.emitter, A.cfg.orbit, A.cfg.formation, A.cfg.ref]) : ''; }
    function updateGlobe() {
      if (!globe || !A || !A.geo) return;
      const S = A.S, ref = S.cfg.ref;
      globe.setEmitter({ ecef: S.emitter.ecef, label: 'Emitter', color: '--emitter' });
      globe.setSatellites(A.geo.collectors.map((c, i) => ({ id: c.id, ecef: c.ecef, velEcef: c.velEcef, label: c.id + (i === ref ? ' (ref)' : ''), color: COLL[i] })));
      globe.setPolylines('los', A.geo.collectors.map((c, i) => ({ points: [S.emitter.ecef, c.ecef], color: COLL[i], width: 1.5, dashed: !(c.elevationDeg > MASK_DEG), opacity: c.elevationDeg > MASK_DEG ? 0.85 : 0.35 })));
      const ok = orbitKey();
      if (ok !== trackKey) {
        trackKey = ok;
        const times = Array.from({ length: 61 }, (_, k) => -900 + 30 * k);
        try { globe.setPolylines('tracks', A.geo.collectors.map((c, i) => ({ points: SC.trackEcef(S, i, times), color: COLL[i], width: 1, opacity: 0.45 }))); } catch (e) { globe.setPolylines('tracks', []); }
      }
      // exaggerated 95 % error ellipsoid
      let note = '';
      if (view.globeEll && A.canFix) {
        const ax = A.cov.ellipsoid.semiAxes;
        const big = Math.max(...ax.map((v) => Math.hypot(v[0], v[1], v[2])));
        if (big > 1.5e6) { globe.setEllipsoid('err', null); note = 'The 95 % error ellipsoid is too large to draw.'; }
        else {
          const k = Math.max(1, niceFloor(60e3 / big));
          const ctr = A.bias && A.sources.length ? A.bias.x : S.emitter.ecef;
          globe.setEllipsoid('err', { center: S.emitter.ecef, axes: ax, scale: k, color: '--accent', opacity: 0.3 });
          note = `The 95 % error ellipsoid (CRLB, centred on the truth) is drawn ${k > 1 ? `enlarged ×${fmt(k, 3)}` : 'to scale'}: longest semi-axis ${fmtDist(big)}.`;
          void ctr;
        }
      } else globe.setEllipsoid('err', null);
      globeNote.textContent = note + (view.globeLop ? ' Lines of position on the surface pass through the emitter: TDOA in violet, FDOA in ochre.' : '');
      globeLegend.replaceChildren(
        ...A.geo.collectors.map((c, i) => el('span', null, el('span', { class: 'lab-swatch', style: `background:var(${COLL[i]})` }), `${c.id}: el ${c.elevationDeg.toFixed(1)}°`)),
        el('span', null, el('span', { class: 'lab-swatch', style: 'background:var(--emitter)' }), 'emitter'));
    }
    function scheduleGlobeLop() {
      cancel(lopTimer);
      if (!globe) return;
      if (!view.globeLop) { globe.setPolylines('lop', []); lopKey = ''; return; }
      lopTimer = later(() => {
        if (!globe || !A || !A.S || lopKey === cfgKey) return;
        lopKey = cfgKey;
        const S = A.S, ref = S.cfg.ref;
        const lines = [];
        try {
          const ext = clamp(1.6 * Math.max(...A.geo.collectors.map((c) => Math.hypot(c.enu[0], c.enu[1]))), 6e5, 2.5e6);
          const f = SC.mapField(S), c0 = f(0, 0);
          const nx = 44, ny = 44, dx = (2 * ext) / (nx - 1), dy = dx;
          const grid = [];
          for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) grid.push(f(-ext + i * dx, -ext + j * dy));
          const kinds = [];
          for (let i = 0; i < S.n; i++) {
            if (i === ref) continue;
            if (ui.use.tdoa) kinds.push(['tdoa', i, '--tdoa']);
            if (ui.use.fdoa) kinds.push(['fdoa', i, '--fdoa']);
          }
          for (const [arr, i, col] of kinds) {
            const data = new Float64Array(nx * ny);
            grid.forEach((r, k) => { data[k] = r ? (r[arr][i] - r[arr][ref]) - (c0[arr][i] - c0[arr][ref]) : NaN; });
            const field = { nx, ny, x0: -ext, y0: -ext, dx, dy, data, xLog: false, yLog: false };
            for (const pl of contourLines(field, 0)) {
              const pts = pl.map(([x, y]) => S.map.surfacePoint(x, y, 0)).filter(Boolean);
              if (pts.length > 1) lines.push({ points: pts, color: col, width: 2, opacity: 0.9 });
            }
          }
        } catch (e) { /* leave lines empty */ }
        if (globe && !disposed) globe.setPolylines('lop', lines);
      }, playing ? 400 : 300);
    }
    function frameFormation(animate = true) {
      if (!globe || !A || !A.geo) return;
      globe.fit([A.S.emitter.ecef, ...A.geo.collectors.map((c) => c.ecef)], { animate });
    }
    function frameEmitter() {
      if (!globe || !A || !A.S) return;
      globe.lookAt({ ecef: A.S.emitter.ecef, distance: 2.2e6, animate: true });
    }

    // ------------------------------------------------------------ live numbers for the experiments
    const expQueue = [
      () => {
        const a = analyse(presetUi('tight'));
        const g = (aa) => (aa.sens && aa.sens.observable ? aa.sens.perCollector[1].items.find((x) => x.kind === 'freq').horiz : NaN);
        fill('e1base', dist(g(a)));
        fill('e1ghz', dist(g(analyse(sanitizeUi(deepMerge(DEFAULT_UI, { emitter: { f0: 1e10 } }))))));
        fill('e1wide', dist(g(analyse(sanitizeUi(deepMerge(DEFAULT_UI, { emitter: { f0: 1e10 }, formation: { baselineKm: 1200 } }))))));
      },
      () => {
        const NAMES = { toaNoise: 'measurement noise', clock: 'clock synchronisation', posAsTime: 'ephemeris position' };
        const dom = (aa) => { const p = aa.cov.budget.parts; const sum = (k) => p.reduce((s, x) => s + x[k], 0); return NAMES[Object.keys(NAMES).reduce((x, y) => (sum(y) > sum(x) ? y : x))]; };
        const a1 = analyse(presetUi('tight')), a2 = analyse(sanitizeUi(deepMerge(DEFAULT_UI, { formation: { baselineKm: 1200 } })));
        fill('e2cep1', dist(a1.cov.cep50)); fill('e2cep2', dist(a2.cov.cep50));
        fill('e2dop1', fmt(a1.dop.tdoaSurface, 3)); fill('e2dop2', fmt(a2.dop.tdoaSurface, 3));
        fill('e2dom1', dom(a1)); fill('e2dom2', dom(a2));
      },
      () => {
        const big = (aa) => (aa.cov.observable ? Math.max(...aa.cov.ellipsoid.semiAxes.map((v) => Math.hypot(...v))) : NaN);
        const a = analyse(sanitizeUi(deepMerge(DEFAULT_UI, { use: { tdoa: true, fdoa: false, altitude: false } })));
        const b = analyse(sanitizeUi(deepMerge(DEFAULT_UI, { use: { tdoa: true, fdoa: true, altitude: false } })));
        fill('e3ax', dist(big(a))); fill('e3su', dist(a.cov.sigmaU)); fill('e3axf', dist(big(b)));
      },
      () => {
        const a = analyse(presetUi('naive'));
        fill('e4bias', a.bias ? dist(a.bias.errHoriz) : '—'); fill('e4cep', dist(a.cov.cep50));
      },
      () => {
        const a = analyse(presetUi('naive'));
        let ps = null;
        try { ps = SC.passSeries(a.S, TIMES); } catch (e) { ps = null; }
        const last = ps ? [...ps].reverse().find((p) => fin(p.cumDrms)) : null;
        fill('e4cum', last ? dist(last.cumDrms) : '—');
        // same pass geometry and budget as the default (the processor model does not change the CRLB materially)
        const dps = (() => { try { return SC.passSeries(analyse(presetUi('tight')).S, TIMES); } catch (e) { return null; } })();
        if (dps) {
          let best = null;
          for (const p of dps) if (p.allVisible && fin(p.cep50) && (!best || p.cep50 < best.cep50)) best = p;
          fill('e7t', best ? String(best.t) : '—'); fill('e7cep', best ? dist(best.cep50) : '—');
          fill('e7end', dps[0].allVisible ? dist(dps[0].cep50) : 'below the mask');
        }
      },
      () => {
        const lo = analyse(sanitizeUi(deepMerge(DEFAULT_UI, { emitter: { f0: 400e6 }, solver: { ionosphere: false } })));
        const hi = analyse(sanitizeUi(deepMerge(DEFAULT_UI, { emitter: { f0: 4e9 }, solver: { ionosphere: false } })));
        fill('e5lo', lo.bias ? dist(lo.bias.errHoriz) : '—'); fill('e5hi', hi.bias ? dist(hi.bias.errHoriz) : '—');
      },
      () => {
        const m = analyse(sanitizeUi(deepMerge(DEFAULT_UI, { emitter: { speed: 10, headingDeg: 0 } })));
        const t = analyse(sanitizeUi(deepMerge(DEFAULT_UI, { emitter: { speed: 10, headingDeg: 0 }, use: { tdoa: true, fdoa: false, altitude: true } })));
        fill('e6bias', m.bias ? dist(m.bias.errHoriz) : '—');
        fill('e6tdoa', t.bias ? dist(t.bias.errHoriz) : '—'); fill('e6tdoacep', t.cov.observable ? dist(t.cov.cep50) : '—');
      },
      () => {
        const base = { formation: { shape: 'diamond' }, orbit: { passEastKm: 0, passNorthKm: 0 }, use: { tdoa: true, fdoa: false, altitude: false } };
        const a = analyse(sanitizeUi(deepMerge(DEFAULT_UI, base)));
        const b = analyse(sanitizeUi(deepMerge(DEFAULT_UI, { ...base, t: 60 })));
        const c = analyse(sanitizeUi(deepMerge(DEFAULT_UI, { ...base, use: { tdoa: true, fdoa: false, altitude: true } })));
        fill('e8su', a.cov.observable ? dist(a.cov.sigmaU) : 'unbounded'); fill('e8su60', b.cov.observable ? dist(b.cov.sigmaU) : 'unbounded');
        fill('e8alt', c.cov.observable ? dist(c.cov.cep50) : '—');
      },
    ];
    function fill(key, text) { (live[key] || []).forEach((s) => { s.textContent = text; }); }
    const runExp = () => {
      const job = expQueue.shift();
      if (!job) return;
      try { job(); } catch (e) { /* leave the placeholder */ }
      if (expQueue.length) later(runExp, 30);
    };
    later(runExp, 900);

    // ------------------------------------------------------------ start
    syncControls();
    markPreset(PRESETS.find((p) => JSON.stringify(presetUi(p.id)) === JSON.stringify(ui))?.id ?? null);
    showTab();
    recompute();

    // ------------------------------------------------------------ cleanup
    return () => {
      disposed = true;
      stopPlay();
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      mc.gen++;
      for (const id of timers) clearTimeout(id);
      timers.clear();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ui)); } catch (e) { /* ignore */ }
      mapPlot.destroy(); passPlot.destroy(); geoChart.destroy();
      if (globe) { globe.dispose(); globe = null; }
      styleEl.remove();
    };
  },
};
