// Tests for the "Check your understanding" question bank (js/lessons/questions.js):
// the schema is well formed, and every numeric answer and every engine number quoted in
// an explanation is recomputed here from the physics engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import QUESTIONS from '../js/lessons/questions.js';
import { lessons } from '../js/lessons/registry.js';
import { constants, planar, scenario, stein } from '../js/core/index.js';
import { analyse, presetUi, sanitizeUi, deepMerge, DEFAULT_UI } from '../js/lessons/_lab-model.js';

const { C } = constants;
const lam = (f) => C / f;
const rel = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg}: expected ${b}, got ${a} (rel tol ${tol})`);

const all = Object.entries(QUESTIONS).flatMap(([id, qs]) => qs.map((q, i) => ({ id, i, q })));
const strings = (q) => [q.prompt, q.explain, q.hint, q.unit, ...(q.options || []).flatMap((o) => [o.text, o.why])].filter((s) => s != null);

test('questions: every lesson has a well-formed question set', () => {
  for (const l of lessons) {
    assert.ok(Array.isArray(QUESTIONS[l.id]) && QUESTIONS[l.id].length >= 4, `lesson ${l.id} has at least four questions`);
  }
  for (const id of Object.keys(QUESTIONS)) assert.ok(lessons.some((l) => l.id === id), `question set "${id}" belongs to a lesson`);

  const keys = new Set();
  for (const { id, i, q } of all) {
    const where = `${id}[${i}]`;
    assert.ok(['choice', 'number', 'think'].includes(q.type), `${where}: type`);
    assert.ok(typeof q.prompt === 'string' && q.prompt.length > 20, `${where}: prompt`);
    assert.ok(typeof q.explain === 'string' && q.explain.length > 40, `${where}: explain`);
    for (const s of strings(q)) {
      assert.equal(typeof s, 'string', `${where}: strings only`);
      // math delimiters must pair up, or the rest of the string would render as TeX
      const dollars = (s.replace(/\\\$/g, '').match(/\$/g) || []).length;
      assert.equal(dollars % 2, 0, `${where}: unbalanced $ in "${s.slice(0, 50)}"`);
      assert.ok(!/\$\{/.test(s), `${where}: stray template placeholder`);
    }
    if (q.type === 'choice') {
      assert.ok(q.options.length >= 3, `${where}: at least three options`);
      assert.equal(q.options.filter((o) => o.correct).length, 1, `${where}: exactly one correct option`);
      for (const o of q.options) if (!o.correct) assert.ok(o.why && o.why.length > 15, `${where}: wrong option "${o.text.slice(0, 30)}" explains why`);
    }
    if (q.type === 'number') {
      assert.ok(Number.isFinite(q.answer), `${where}: answer`);
      assert.ok(q.key && !keys.has(q.key), `${where}: unique key`);
      keys.add(q.key);
      assert.ok(q.hint, `${where}: hint`);
    }
  }
});

test('questions: every numeric answer agrees with the engine', () => {
  const pair = (d, v = [0, 0]) => [{ p: [-d / 2, 0], v }, { p: [d / 2, 0], v }];
  const S = scenario.buildScenario(scenario.defaultConfig());

  const truth = {
    'welcome.tau': () => (430e3 - 400e3) / C * 1e6,
    'welcome.fdoa': () => {
      // A at the origin flying +x at an emitter on the +x axis; B flying across its line of sight
      const A = { p: [0, 0], v: [200, 0] }, B = { p: [0, 0], v: [0, 200] };
      return planar.fdoa(A, B, [50e3, 0], 1e9);
    },
    'welcome.lambda3': () => lam(3e9),
    'tdoa.max': () => {
      const [A, B] = pair(60e3);
      return Math.abs(planar.tdoa(B, A, [-500e3, 0])) * 1e6; // on the axis, beyond A
    },
    'tdoa.lever': () => {
      const [A, B] = pair(50e3);
      const g = planar.gradTdoa(B, A, [0, Math.sqrt(500e3 ** 2 - 25e3 ** 2)]);
      return 10e-9 / Math.hypot(...g);
    },
    'fdoa.doppler60': () => {
      const a = 60 * Math.PI / 180;
      return planar.doppler({ p: [0, 0], v: [250, 0] }, [80e3 * Math.cos(a), 80e3 * Math.sin(a)], 1e9);
    },
    'fdoa.moving': () => {
      const [A, B] = pair(80e3, [250, 0]);
      return planar.fdoa(B, A, [0, 30e3], 1e9, [5, 0]) - planar.fdoa(B, A, [0, 30e3], 1e9);
    },
    'fusion.sin5': () => 1 / Math.sin(5 * Math.PI / 180),
    'dop.drms': () => 12 * C * 30e-9,
    'dop.oneSigma': () => (1 - Math.exp(-0.5)) * 100,
    'dop.fdoa': () => 2000 * lam(1e9) * 0.1,
    'budget.rule': () => lam(1e9) * 100e3 ** 2 / (200 * 30e3),
    'budget.velocity': () => 0.03 / lam(1e10),
    'caf.sigmaTau': () => 1e9 / (stein.rmsBandwidth(1e6) * Math.sqrt(1e6 * 10e-3 * 1)),
    'caf.gamma': () => stein.toDb(stein.effectiveSnr(stein.fromDb(20), stein.fromDb(-10))),
    'orbit.equations': () => 3 + 3 + 1,
    'orbit.scaling': () => (300 / 150) ** 2,
    'physics.move': () => 1000e3 / C * 7600,
    'physics.iono': () => 4 * (1e9 / 250e6) ** 2,
    'lab.oneHz': () => {
      const enu = scenario.sensitivityTable(S).perCollector[1].items.find((x) => x.kind === 'freq').enu;
      return Math.hypot(enu[0], enu[1]);
    },
  };

  const numeric = all.filter(({ q }) => q.type === 'number');
  for (const { id, i, q } of numeric) {
    assert.ok(truth[q.key], `${id}[${i}]: no engine check for key "${q.key}"`);
    const t = truth[q.key]();
    // the stated answer must sit well inside its own acceptance band around the true value
    const band = q.absTol != null ? q.absTol : (q.tol ?? 0.05) * Math.abs(t);
    assert.ok(Math.abs(q.answer - t) <= band / 3, `${q.key}: stated ${q.answer}, engine ${t}, band ${band}`);
  }
  assert.equal(Object.keys(truth).length, numeric.length, 'no unused engine checks');
});

test('questions: engine numbers quoted in explanations and options are current', () => {
  // welcome / tdoa / error budget: one-line facts
  rel(C * 10e-9, 3.0, 0.01, '10 ns in metres');
  rel(C * 50e-9, 15, 0.01, '50 ns in metres');
  rel(C * 1e-9 * 100e3 / 30e3, 1.0, 0.01, 'aircraft pair: metres per ns');
  rel(1e-6 / (1e9 / (stein.rmsBandwidth(1e6) * 100) * 1e-9), 181, 0.02, 'lobe width over accuracy');
  rel(1 / (stein.rmsDuration(10e-3) * 100), 0.55, 0.01, 'sigma_nu of the CAF example');
  rel(stein.fdoaSigma({ B: 1e6, T: 10e-3, snr1: 10, snr2: 10 }) / stein.fdoaSigma({ B: 1e6, T: 20e-3, snr1: 10, snr2: 10 }), 2 * Math.SQRT2, 1e-9, 'sigma_nu vs T');
  rel(stein.tdoaSigma({ B: 1e6, T: 10e-3, snr1: 10, snr2: 10 }) / stein.tdoaSigma({ B: 1e6, T: 20e-3, snr1: 10, snr2: 10 }), Math.SQRT2, 1e-9, 'sigma_tau vs T');

  // fdoa-plane: metres per hertz at 400 km and 800 km; carrier scaling
  const A = { p: [-40e3, 0], v: [250, 0] }, B = { p: [40e3, 0], v: [250, 0] };
  const mPerHz = (y, f0 = 1e9) => 1 / Math.hypot(...planar.gradFdoa(B, A, [0, y], f0));
  rel(mPerHz(400e3), 2400, 0.03, 'm per Hz at 400 km');
  rel(mPerHz(800e3), 9600, 0.03, 'm per Hz at 800 km');
  rel(mPerHz(400e3) / mPerHz(400e3, 1e10), 10, 1e-9, 'carrier scaling of the FDOA gradient');

  // fusion: the mirror image across the track reproduces both measurements; across the bisector it does not
  const e = [15e3, 60e3];
  rel(planar.tdoa(B, A, [15e3, -60e3]), planar.tdoa(B, A, e), 1e-12, 'ghost TDOA');
  rel(planar.fdoa(B, A, [15e3, -60e3], 1e9), planar.fdoa(B, A, e, 1e9), 1e-12, 'ghost FDOA');
  rel(planar.tdoa(B, A, [-15e3, 60e3]), -planar.tdoa(B, A, e), 1e-12, 'bisector mirror flips the TDOA');

  // dop: doubling an 80 km triangle seen from 600 km
  const tri = (s) => [[-40e3 * s, -23e3 * s], [40e3 * s, -23e3 * s], [0, 46e3 * s]];
  const d1 = planar.tdoaDop(tri(1), [0, 600e3]), d2 = planar.tdoaDop(tri(2), [0, 600e3]);
  rel(d1, 596, 0.01, 'DOP before'); rel(d2, 162, 0.01, 'DOP after'); rel(d1 / d2, 3.7, 0.02, 'DOP ratio');

  // physics lesson: cost of ignoring each effect in the default scenario
  const S = scenario.buildScenario(scenario.defaultConfig());
  const fx = Object.fromEntries(scenario.effectsTable(S).map((r) => [r.key, r]));
  const quoted = { instant: 6.9, sagnac: 0.31, shapiro: 0.00065, tropo: 2.5, iono: 5.7, clock: 0.40, motion: 72, altitude: 21 };
  for (const [k, v] of Object.entries(quoted)) rel(fx[k].biasHoriz, v, 0.03, `fix bias, ${k}`);
  rel(fx.instant.maxTdoa, 3.2e-9, 0.03, 'light-time TDOA change');
  rel(fx.motion.maxFdoa, 0.46, 0.03, 'moving-emitter FDOA change');
  const worst = Object.keys(quoted).filter((k) => ['shapiro', 'sagnac', 'clock', 'motion'].includes(k)).sort((a, b) => fx[b].biasHoriz - fx[a].biasHoriz)[0];
  assert.equal(worst, 'motion', 'the moving emitter is the worst of the four options offered');

  // lab: numbers from the guided experiments
  const ui = (p) => sanitizeUi(deepMerge(DEFAULT_UI, p));
  const base = analyse(presetUi('tight'));
  const oneHz = (a) => a.sens.perCollector[1].items.find((x) => x.kind === 'freq').horiz;
  rel(base.cov.cep50, 31, 0.02, 'default CEP');
  rel(oneHz(base) / base.cov.cep50, 5, 0.1, '1 Hz in CEPs');
  rel(oneHz(analyse(ui({ emitter: { f0: 1e10 } }))), 21, 0.03, '1 Hz at 10 GHz');
  rel(analyse(ui({ formation: { baselineKm: 1200 } })).cov.cep50, 5, 0.1, 'CEP at 1200 km');

  const naive = analyse(presetUi('naive'));
  rel(naive.bias.errHoriz, 6.9, 0.02, 'naive-processor bias');
  const times = Array.from({ length: 61 }, (_, k) => -300 + 10 * k); // the lab's pass timeline
  const last = [...scenario.passSeries(naive.S, times)].reverse().find((p) => Number.isFinite(p.cumDrms));
  rel(last.cumDrms, 5.7, 0.03, 'cumulative noise floor');
  assert.ok(last.cumDrms < naive.bias.errHoriz, 'the noise floor ends below the bias');

  const io = (f0) => analyse(ui({ emitter: { f0 }, solver: { ionosphere: false } })).bias.errHoriz;
  rel(io(400e6), 41, 0.03, 'ionosphere bias at 400 MHz');
  rel(io(4e9), 0.36, 0.03, 'ionosphere bias at 4 GHz');
  rel(io(400e6) / io(4e9), 115, 0.02, 'ionosphere ratio');

  const moving = { emitter: { speed: 10, headingDeg: 0 } };
  const tdoaOnly = { tdoa: true, fdoa: false, altitude: true };
  rel(analyse(ui(moving)).bias.errHoriz, 894, 0.02, 'moving-emitter bias');
  const t = analyse(ui({ ...moving, use: tdoaOnly }));
  assert.ok(t.bias.errHoriz < 0.1, `TDOA-only bias is centimetres: ${t.bias.errHoriz}`);
  rel(t.cov.cep50, 62, 0.02, 'TDOA-only CEP');
  rel(analyse(ui({ ...moving, use: tdoaOnly, formation: { baselineKm: 1200 } })).cov.cep50, 9, 0.05, 'TDOA-only CEP, wide baseline');
});
