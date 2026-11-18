/**
 * 06-caf.js - "Where the numbers come from: the cross-ambiguity function".
 *
 * How TDOA and FDOA are measured (the peak of the cross-ambiguity function of two recordings) and how
 * precise that measurement can be (Stein's bounds). Signal processing lives in js/core/caf.js (imported
 * directly); every bound shown comes from js/core/stein.js.
 *
 * Figures:
 *   1. Live simulation: CAF heat map over (delay, Doppler) plus the two cuts through the peak.
 *   2. Monte-Carlo: 200 trials, error scatter with Stein ellipses, empirical vs predicted sigma.
 *   3. Calculator in real units (no simulation) with sigma-vs-T scaling charts.
 */
import { Plot2D } from '../ui/plot2d.js';
import { slider, segmented, button, readout, controlGroup, dataTable, fmt, fmtSI } from '../ui/controls.js';
import { el, lessonHeader, section, figure, callout, takeaways, nextLesson, lessonLink } from '../ui/layout.js';
import { questionSet } from '../ui/quiz.js';
import QUESTIONS from './questions.js';
import { stein, linalg } from '../core/index.js';
import * as cafm from '../core/caf.js';

const FS = 64000;                    // simulation sample rate, Hz (= receiver noise bandwidth before filtering)
const T_OPTIONS = [1024, 2048, 4096, 8192]; // record lengths N -> T = N / FS = 16 ... 128 ms
const MC_TRIALS = 200;

const CSS = `
.caf-lesson .caf-cuts { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 700px) { .caf-lesson .caf-cuts { grid-template-columns: 1fr; } }
.caf-lesson .caf-status { font-size: 13.5px; color: var(--text-2); min-height: 1.4em; }
.caf-lesson .caf-status.bad { color: var(--warning); }
.caf-lesson .caf-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.caf-lesson .caf-presets .btn { font-size: 13px; padding: 5px 9px; }
`;

const dbStr = (x) => (Number.isFinite(x) ? `${x >= 0 ? '' : '−'}${Math.abs(x).toFixed(1)}` : '—');
const sgn = (s) => s.replace(/^-/, '−');

export default {
  id: 'caf',
  title: 'Where the numbers come from: the cross-ambiguity function',

  mount(root, ctx) {
    root.classList.add('caf-lesson');
    const style = el('style', null, CSS);
    document.head.append(style);
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
    const cancel = (id) => { clearTimeout(id); timers.delete(id); };

    // ------------------------------------------------------------ state
    const state = {
      BsKHz: 16,        // signal bandwidth, kHz
      N: 4096,          // samples -> T = N / FS
      snr1Db: 0,        // SNR at collector A in the signal band, dB
      snr2Db: 0,        // SNR at collector B in the signal band, dB
      tauUs: 180,       // true TDOA, µs
      nuHz: 12,         // true FDOA, Hz
      seed: 1,
    };
    let sim = null;     // results of the last simulation

    /** Stein inputs for the simulation: processed noise bandwidth = signal band (reference channel filtered). */
    function simStein(BsAct) {
      const T = state.N / FS;
      const p = { B: BsAct, Bs: BsAct, T, snr1: stein.fromDb(state.snr1Db), snr2: stein.fromDb(state.snr2Db) };
      const gamma = stein.effectiveSnr(p.snr1, p.snr2);
      return { p, T, gamma, BT: BsAct * T, post: BsAct * T * gamma, sT: stein.tdoaSigma(p), sF: stein.fdoaSigma(p) };
    }

    // ------------------------------------------------------------ header + section A text
    root.append(
      lessonHeader({
        kicker: 'Part II · Lesson 6',
        title: 'Where the numbers come from: the cross-ambiguity function',
        lede: 'So far a TDOA or FDOA measurement simply arrived with some error $\\sigma$. Here you will see how the two collectors actually measure them, by correlating their recordings over delay and Doppler, and you will be able to predict how precise that measurement is from bandwidth, integration time and signal-to-noise ratio.',
      }),
      section('The idea: slide and spin one recording against the other', String.raw`
        <p>Two collectors record the same emitter. Each receiver shifts the signal down from its carrier frequency
        and samples it, so a recording is a list of complex numbers, each holding an amplitude and a phase (complex
        baseband). Collector A records $x_1(t) = s(t) + n_1(t)$ and collector B records
        $$x_2(t) = a\,s(t-\tau)\,e^{j2\pi\nu t} + n_2(t).$$
        Here $s(t)$ is the emitter's waveform and $n_1(t)$, $n_2(t)$ are the two receivers' own, independent
        noise. B hears the same waveform delayed by the TDOA $\tau = \tau_{BA}$, shifted in frequency by the FDOA
        $\nu = \nu_{BA}$ (the factor $e^{j2\pi\nu t}$ is a steady rotation of the phase at $\nu$ turns per second;
        $j = \sqrt{-1}$), and at a different strength and phase, the constant $a$. Nobody knows $s(t)$ &mdash; it is
        whatever the emitter happened to transmit &mdash; so the only thing to compare B's recording with is
        A's recording.</p>
        <p>The comparison is the <strong>cross-ambiguity function</strong> (CAF), written $\chi$: shift one recording by a trial
        delay $\tau'$, remove a trial frequency offset $\nu'$, multiply by the other and integrate over the
        <strong>integration time</strong> $T$, the length of the recordings:
        $$\chi(\tau',\nu') = \int_0^T x_1^*(t)\,x_2(t+\tau')\,e^{-j2\pi\nu' t}\,dt$$
        (the star is the complex conjugate). Only at $\tau'=\tau,\ \nu'=\nu$ do the two copies of the signal line up in time <em>and</em> stop
        rotating against each other. Their product then adds up in step (coherently) over the whole recording,
        while the noise products add with random phases and largely cancel. A recording of bandwidth $B$ and
        length $T$ contains roughly $B\,T$ independent samples, which is why that product keeps appearing below. The location of the peak of
        $|\chi|$ is the measurement: its delay coordinate is the TDOA, its Doppler coordinate the FDOA.</p>
      `),
    );

    // ------------------------------------------------------------ figure 1 controls
    const bsCtl = slider({
      label: 'Signal bandwidth $B_s$', min: 1, max: 64, log: true, value: state.BsKHz, unit: 'kHz',
      hint: 'Width of the band of frequencies the signal occupies.',
      format: (v) => fmt(v, 3), onInput: (v) => { state.BsKHz = v; scheduleSim(); },
    });
    const tCtl = segmented({
      label: 'Integration time $T$',
      options: T_OPTIONS.map((N) => ({ value: String(N), label: `${(N / FS) * 1000} ms` })),
      value: String(state.N), onChange: (v) => { state.N = Number(v); scheduleSim(); },
      hint: 'Length of the two recordings that are compared.',
    });
    const snr1Ctl = slider({
      label: 'SNR at A (in $B_s$)', min: -20, max: 30, step: 1, value: state.snr1Db, unit: 'dB',
      hint: 'Signal power ÷ noise power inside the signal band. In decibels: 0 dB is equal, 10 dB is 10 times, −10 dB a tenth.',
      format: (v) => dbStr(v), onInput: (v) => { state.snr1Db = v; scheduleSim(); },
    });
    const snr2Ctl = slider({
      label: 'SNR at B (in $B_s$)', min: -20, max: 30, step: 1, value: state.snr2Db, unit: 'dB',
      format: (v) => dbStr(v), onInput: (v) => { state.snr2Db = v; scheduleSim(); },
    });
    const tauCtl = slider({
      label: 'True TDOA $\\tau$', min: -600, max: 600, step: 1, value: state.tauUs, unit: 'µs',
      format: (v) => sgn(v.toFixed(0)), onInput: (v) => { state.tauUs = v; scheduleSim(); },
    });
    const nuCtl = slider({
      label: 'True FDOA $\\nu$', min: -40, max: 40, step: 0.5, value: state.nuHz, unit: 'Hz',
      format: (v) => sgn(v.toFixed(1)), onInput: (v) => { state.nuHz = v; scheduleSim(); },
    });
    const noiseBtn = button({ label: 'New noise', onClick: () => { state.seed++; scheduleSim(0); } });
    const simRo = readout([
      { key: 'bt', label: 'Time-bandwidth $B_sT$', hint: 'Number of independent samples integrated' },
      { key: 'gamma', label: 'Effective SNR $\\gamma$', unit: 'dB', hint: 'The two collectors\' SNRs combined into one figure for the pair (formula below)' },
      { key: 'post', label: 'Post-integration $B_sT\\gamma$', unit: 'dB', hint: 'SNR after adding up all the independent samples' },
      { key: 'dtau', label: 'Error $\\hat\\tau-\\tau$', hint: 'Estimated TDOA (hat) minus the true one, for this particular noise' },
      { key: 'dnu', label: 'Error $\\hat\\nu-\\nu$', hint: 'Estimated FDOA minus the true one' },
      { key: 'st', label: 'Stein $\\sigma_\\tau$', hint: 'Predicted standard deviation of the TDOA error (Stein\'s bound, below)' },
      { key: 'sf', label: 'Stein $\\sigma_\\nu$', hint: 'Predicted standard deviation of the FDOA error' },
    ]);
    const simStatus = el('div', 'caf-status');

    const heatHost = el('div');
    const cutTauHost = el('div');
    const cutNuHost = el('div');

    root.append(
      section('', figure({
        plot: [heatHost, el('div', 'caf-cuts', cutTauHost, cutNuHost), simStatus],
        controls: [
          controlGroup('Readout', [simRo]),
          controlGroup('Signal', [bsCtl, tCtl, snr1Ctl, snr2Ctl, noiseBtn]),
          controlGroup('Geometry (truth)', [tauCtl, nuCtl]),
        ],
        caption: String.raw`Top: $|\chi(\tau',\nu')|$ computed from one simulated pair of recordings (bright = large). The
          diamond is the truth $(\tau,\nu)$, the cross is the estimated peak $(\hat\tau,\hat\nu)$; a hat marks an
          estimate. Bottom: cuts through the estimated peak along
          delay and along Doppler, with the nominal widths of the main lobe (the central peak), $1/B_s$ and $1/T$,
          marked. The simulation samples at a rate of
          $f_s = 64$ kHz so that it finishes in a few tens of milliseconds; nothing depends on that choice except through
          the products $B_sT$ and the SNRs, so read the axes as an illustrative scale.`,
      }),
      callout('math', 'What is computed, exactly', String.raw`
        <p>The recordings are samples $x[m]$ taken at times $t = m/f_s$, where $f_s$ is the sampling rate and
        $m = 0\ldots N-1$ counts the $N$ samples, so $T = N/f_s$. The page evaluates
        $$\chi(\tau',\nu') = \frac1N\sum_{m=0}^{N-1} x_1^*\!\big(m/f_s-\tau'\big)\;x_2[m]\;e^{-j2\pi\nu' m/f_s},$$
        which is the integral above after the substitution $t\to t-\tau'$ (that changes only the phase of $\chi$,
        not $|\chi|$). The fractional delay of $x_1$ is applied exactly in the frequency domain (a phase ramp
        $e^{-j2\pi f\tau'}$ on its spectrum), treating the record as periodic; delays here are far shorter than $T$, so
        the wrap-around is harmless. The coarse map uses integer lags (delays of a whole number of samples): for each lag the product sequence is
        Fourier-transformed, which gives every Doppler bin at once. The peak is then refined on the exact $\chi$.</p>
        <p>The signal is complex Gaussian noise-like with a flat spectrum exactly $B_s$ wide and unit power. Receiver
        noise is white (equal power at every frequency) over the whole sampled band $f_s$; the SNR sliders give the
        signal-to-noise ratio <em>within the signal band</em>
        $B_s$. A's recording is filtered to the signal band before correlating, so the <strong>processed noise
        bandwidth</strong> $B$, the width of the band through which noise reaches the correlator, is
        $B = B_s$, the case Stein's formula describes (see the last "Careful" box for why that matters).</p>
      `),
      callout('idea', 'Resolution: about $1/B_s$ by $1/T$', String.raw`
        <p>Write $\Delta\tau$ and $\Delta\nu$ for the distance from the peak in delay and in Doppler, and
        $\operatorname{sinc}(x) = \sin(\pi x)/(\pi x)$. For a flat spectrum the delay cut is $|\chi| \propto |\operatorname{sinc}(B_s\,\Delta\tau)|$, first nulls at
        $\pm 1/B_s$; the Doppler cut is roughly $|\operatorname{sinc}(T\,\Delta\nu)|$, first nulls near $\pm 1/T$
        (only roughly, because a noise-like signal's envelope is not constant). Two emitters closer than about one
        lobe in both coordinates merge into one peak: that is <strong>resolution</strong>. It is set by bandwidth and
        duration alone, not by SNR.</p>
      `),
      callout('try', 'Bandwidth sharpens delay, duration sharpens Doppler', String.raw`
        <p>Drag $B_s$ from 64 kHz down to 1 kHz: the ridge stretches along the delay axis (the delay scale of the plot
        follows it) while the Doppler width does not change. Switch $T$ from 16 ms to 128 ms: the peak narrows in
        Doppler eightfold and the delay width is untouched. Then lower both SNRs to about $-15$ dB and press
        <em>New noise</em> a few times: whenever $B_sT\gamma$ drops below roughly 10&ndash;13 dB the brightest cell is
        sometimes a noise peak far from the diamond.</p>
      `),
      ),
    );

    // ------------------------------------------------------------ figure 1 plots
    const heat = new Plot2D(heatHost, {
      height: 360, xLabel: 'Trial delay τ′ (µs)', yLabel: 'Trial Doppler ν′ (Hz)',
      view: { xmin: -1000, xmax: 1000, ymin: -60, ymax: 60 },
      ariaLabel: 'Heat map of the cross-ambiguity magnitude over trial delay and trial Doppler.',
    });
    const cutTau = new Plot2D(cutTauHost, {
      height: 210, xLabel: 'τ′ (µs), at ν′ = ν̂', yLabel: '|χ|',
      view: { xmin: -1000, xmax: 1000, ymin: 0, ymax: 1.1 }, ariaLabel: 'Delay cut through the peak.',
    });
    const cutNu = new Plot2D(cutNuHost, {
      height: 210, xLabel: 'ν′ (Hz), at τ′ = τ̂', yLabel: '|χ|',
      view: { xmin: -60, xmax: 60, ymin: 0, ymax: 1.1 }, ariaLabel: 'Doppler cut through the peak.',
    });

    function runSim() {
      const N = state.N, T = N / FS;
      const rng = linalg.makeRng(1000 + state.seed);
      const s = cafm.makeSignal({ N, fs: FS, Bs: state.BsKHz * 1000, rng });
      const Bs = s.Bs;
      const st = simStein(Bs);
      // SNR in the signal band -> SNR in the sampled band fs
      const k = Bs / FS;
      const { x1: x1raw, x2 } = cafm.receive({
        s, fs: FS, delay: state.tauUs * 1e-6, doppler: state.nuHz,
        snr1: st.p.snr1 * k, snr2: st.p.snr2 * k, rng,
      });
      const x1 = Bs < FS * (1 - 1.5 / N) ? cafm.bandLimit(x1raw, FS, Bs) : x1raw;
      const lobe = FS / Bs; // samples per 1/Bs
      const lagStep = Math.max(1, Math.floor(lobe / 8));
      const grid = cafm.caf({
        x1, x2, fs: FS, maxLagSamples: 64 * lagStep, lagStep,
        dopplerSpan: Math.max(60, 8 / T), dopplerOversample: 2,
      });
      const ev = cafm.cafEvaluator({ x1, x2, fs: FS });
      const est = cafm.estimatePeak({ x1, x2, fs: FS, Bs, grid, evaluator: ev });
      const d0 = grid.delays[0], d1 = grid.delays[grid.nDelay - 1];
      const n0 = grid.dopplers[0], n1 = grid.dopplers[grid.nDoppler - 1];
      const nc = 320;
      const cutDelays = Float64Array.from({ length: nc }, (_, i) => d0 + ((d1 - d0) * i) / (nc - 1));
      const cutDopplers = Float64Array.from({ length: 200 }, (_, i) => n0 + ((n1 - n0) * i) / 199);
      const cd = ev.delayCut(est.doppler, cutDelays);
      const cn = ev.dopplerCut(est.delay, cutDopplers);
      sim = { grid, est, Bs, T, st, cutDelays, cutDopplers, cd, cn, lagStep };
      heat.setView({ xmin: d0 * 1e6, xmax: d1 * 1e6, ymin: n0, ymax: n1 });
      cutTau.setView({ xmin: d0 * 1e6, xmax: d1 * 1e6, ymin: 0, ymax: 1.15 });
      cutNu.setView({ xmin: n0, xmax: n1, ymin: 0, ymax: 1.15 });
      updateSimReadout();
      heat.requestRedraw(); cutTau.requestRedraw(); cutNu.requestRedraw();
    }

    function updateSimReadout() {
      const { est, st, Bs, T } = sim;
      const dTau = est.delay - state.tauUs * 1e-6, dNu = est.doppler - state.nuHz;
      simRo.set({
        bt: fmt(st.BT, 3),
        gamma: dbStr(stein.toDb(st.gamma)),
        post: dbStr(stein.toDb(st.post)),
        dtau: sgn(fmtSI(dTau, 's', 2)),
        dnu: sgn(fmtSI(dNu, 'Hz', 2)),
        st: fmtSI(st.sT, 's', 2),
        sf: fmtSI(st.sF, 'Hz', 2),
      });
      const outlier = Math.abs(dTau) > 0.5 / Bs || Math.abs(dNu) > 0.5 / T;
      simStatus.className = outlier ? 'caf-status bad' : 'caf-status';
      simStatus.textContent = outlier
        ? 'Outlier: the highest peak in the search window is not the main lobe at the truth (threshold effect). The error is now unrelated to the Stein bound.'
        : `Errors are ${fmt(Math.abs(dTau) / st.sT, 2)}στ and ${fmt(Math.abs(dNu) / st.sF, 2)}σν for this realisation; the main lobe is ${fmtSI(1 / Bs, 's', 2)} by ${fmtSI(1 / T, 'Hz', 2)} wide.`;
    }

    let simTimer = null;
    function scheduleSim(ms = 70) {
      if (simTimer != null) cancel(simTimer);
      simTimer = later(() => { simTimer = null; runSim(); }, ms);
    }

    heat.onDraw = (g) => {
      if (!sim) return;
      const { grid, est } = sim;
      const { nDelay: nx, nDoppler: ny, delays, dopplers } = grid;
      const hx = (delays[1] - delays[0] || 1 / FS) * 0.5e6, hy = (dopplers[1] - dopplers[0]) * 0.5;
      let mx = 0;
      for (let i = 0; i < grid.mag.length; i++) mx = Math.max(mx, grid.mag[i]);
      g.image({ nx, ny, data: grid.mag }, delays[0] * 1e6 - hx, delays[nx - 1] * 1e6 + hx, dopplers[0] - hy, dopplers[ny - 1] + hy,
        { colormap: 'sequential', min: 0, max: mx || 1 });
      g.marker(state.tauUs, state.nuHz, 'diamond', 7, { color: '--emitter' });
      g.marker(est.delay * 1e6, est.doppler, 'cross', 8, { color: '--estimate' });
      g.colorbar({ colormap: 'sequential', min: 0, max: mx || 1, label: '|χ|' });
      g.legend([
        { label: 'Truth (τ, ν)', color: '--emitter', marker: 'diamond' },
        { label: 'Estimated peak', color: '--estimate', marker: 'cross' },
      ], { position: 'top-left' });
    };
    heat.onHover = (x, y) => {
      if (!sim) return null;
      const { grid } = sim;
      const i = Math.round((x * 1e-6 - grid.delays[0]) / ((grid.delays[1] - grid.delays[0]) || 1));
      const j = Math.round((y - grid.dopplers[0]) / (grid.dopplers[1] - grid.dopplers[0]));
      if (i < 0 || j < 0 || i >= grid.nDelay || j >= grid.nDoppler) return null;
      return `τ′ ${fmt(x, 4)} µs\nν′ ${fmt(y, 3)} Hz\n|χ| ${fmt(grid.mag[j * grid.nDelay + i], 3)}`;
    };

    function drawCut(g, xs, ys, xScale, truth, estX, width, widthLabel) {
      const pts = Array.from(xs, (x, i) => [x * xScale, ys[i]]);
      g.segment(truth, 0, truth, 1.15, { color: '--emitter', width: 1.25, dash: [5, 4] });
      g.line(pts, { color: '--series-1', width: 1.75 });
      g.segment(estX, 0, estX, 1.15, { color: '--estimate', width: 1.25 });
      // nominal width: the sinc is at 0.637 of its peak half a width either side of the centre
      const pk = sim.est.peak, h = (2 / Math.PI) * pk;
      g.segment(estX - width / 2, h, estX + width / 2, h, { color: '--plot-text-strong', width: 2 });
      g.text(estX + width / 2, h, widthLabel, { dx: 6, size: 12 });
    }
    cutTau.onDraw = (g) => {
      if (!sim) return;
      drawCut(g, sim.cutDelays, sim.cd, 1e6, state.tauUs, sim.est.delay * 1e6, 1e6 / sim.Bs, `1/Bs = ${fmtSI(1 / sim.Bs, 's', 2)}`);
    };
    cutNu.onDraw = (g) => {
      if (!sim) return;
      drawCut(g, sim.cutDopplers, sim.cn, 1, state.nuHz, sim.est.doppler, 1 / sim.T, `1/T = ${fmtSI(1 / sim.T, 'Hz', 2)}`);
    };

    // ------------------------------------------------------------ section B: Monte-Carlo
    const mcHost = el('div');
    const mcBtn = button({ label: `Run ${MC_TRIALS} trials`, kind: 'primary', onClick: () => runMc() });
    const mcStatus = el('div', 'caf-status', 'Uses the settings of the figure above (bandwidth, T, both SNRs, truth).');
    const mcTable = dataTable({
      columns: [
        { key: 'q', label: '' },
        { key: 'emp', label: 'Empirical $\\sigma$', align: 'right' },
        { key: 'pred', label: 'Stein $\\sigma$', align: 'right' },
        { key: 'ratio', label: 'Ratio', align: 'right' },
        { key: 'bias', label: 'Mean error', align: 'right' },
      ],
      rows: [{ q: 'TDOA', emp: '—', pred: '—', ratio: '—', bias: '—' }, { q: 'FDOA', emp: '—', pred: '—', ratio: '—', bias: '—' }],
    });
    let mc = null;      // { dT: [], dF: [], out: [], sT, sF, done, total }
    let mcToken = 0;

    root.append(
      section('Resolution is not accuracy',
        String.raw`<p>The main lobe is $1/B_s$ wide in delay, yet the estimate above usually lands within a small
        fraction of that. Locating the <em>centre</em> of a lobe is a much easier job than separating two lobes: with a
        high post-integration SNR the noise barely perturbs the lobe's shape. Stein (1981) derived the Cram&eacute;r-Rao
        bound (the smallest error any unbiased estimator can achieve) for exactly this measurement. $\sigma_\tau$ and
        $\sigma_\nu$ are the standard deviations of the TDOA and FDOA errors:</p>`,
        callout('math', 'Stein’s bounds', String.raw`
          $$\sigma_\tau = \frac{1}{\beta\sqrt{BT\gamma}},\qquad \sigma_\nu = \frac{1}{T_e\sqrt{BT\gamma}},\qquad
          \frac1\gamma = \frac12\Big(\frac1{\gamma_1}+\frac1{\gamma_2}+\frac1{\gamma_1\gamma_2}\Big)$$
          <p>$B$ is the processed noise bandwidth, $T$ the integration time, and $\gamma_1,\gamma_2$ the SNRs (signal
          power ÷ noise power, as plain ratios, not decibels) in $B$ at the two collectors; $\gamma$, defined by the
          third formula, is the <strong>effective SNR</strong> of the pair. $\beta$ is the <strong>rms radian
          bandwidth</strong> of the signal, a measure of how spread out its spectrum is:
          $\beta = 2\pi\big(\int f^2S(f)\,df/\int S(f)\,df\big)^{1/2}$, where $S(f)$ is the signal's power at
          frequency $f$, measured from the centre of its band. That
          is $\pi B_s/\sqrt3 \approx 1.81\,B_s$ for a flat spectrum of width $B_s$. $T_e = \pi T/\sqrt3$ is the
          same measure for the recording's extent in time, the rms
          radian duration. Hence
          $\sigma_\tau \approx 0.55/(B_s\sqrt{BT\gamma})$ and $\sigma_\nu \approx 0.55/(T\sqrt{BT\gamma})$: the lobe
          width divided by $\sqrt{BT\gamma}$, times about one half. $BT\gamma$ is the <strong>post-integration
          SNR</strong>, the SNR after the $BT$ independent samples have been added up; its square root is the
          same thing as an amplitude (voltage) ratio.</p>`),
        figure({
          plot: [mcHost, mcStatus],
          controls: [controlGroup('Monte-Carlo', [mcBtn, mcTable])],
          caption: String.raw`Each dot is the error $(\hat\tau-\tau,\ \hat\nu-\nu)$ of one independent trial: new signal, new
            noise, full search over $\pm4$ lobe widths around the truth, peak refinement. Ellipses: Stein's $1\sigma$ and
            95 % contours, axes $\sigma_\tau$ and $\sigma_\nu$ (the two errors are uncorrelated for this signal model).
            Outliers, errors larger than half a lobe width, are counted and excluded from the empirical $\sigma$ and drawn
            at the edge of the plot.`,
        }),
        callout('try', 'Find the threshold', String.raw`<p>Run with the defaults (0 dB at both collectors, so $\gamma$ is
          about $-1.8$ dB): the ratios come out near 1. Now set both SNRs to $-15$ dB and run again. While $B_sT\gamma$ is
          above roughly 15 dB the scatter simply grows as the bound says; somewhere around 10 dB outliers appear, and
          below that they dominate. The bound describes small errors around the right peak; it says nothing about picking
          the wrong peak. A wider search window (more cells for noise to win in) moves the threshold up.</p>`),
      ),
    );

    const mcPlot = new Plot2D(mcHost, {
      height: 380, xLabel: 'TDOA error τ̂ − τ (ns)', yLabel: 'FDOA error ν̂ − ν (Hz)',
      view: { xmin: -1, xmax: 1, ymin: -1, ymax: 1 },
      ariaLabel: 'Scatter of Monte-Carlo TDOA and FDOA errors with Stein error ellipses.',
    });
    mcPlot.onDraw = (g) => {
      if (!mc) {
        g.text(0, 0, 'Press “Run trials”', { align: 'center', size: 14 });
        return;
      }
      const sTn = mc.sT * 1e9, sF = mc.sF;
      const v = g.view;
      const pts = [];
      const outs = [];
      for (let i = 0; i < mc.dT.length; i++) {
        const x = mc.dT[i] * 1e9, y = mc.dF[i];
        if (mc.out[i]) outs.push([Math.max(v.xmin, Math.min(v.xmax, x)), Math.max(v.ymin, Math.min(v.ymax, y))]);
        else pts.push([x, y]);
      }
      g.ellipse(0, 0, 2.448 * sTn, 2.448 * sF, 0, { color: '--estimate', width: 1.5, dash: [6, 4] });
      g.ellipse(0, 0, sTn, sF, 0, { color: '--estimate', width: 2 });
      g.points(pts, { color: '--series-1', size: 2.2, alpha: 0.75 });
      for (const [x, y] of outs) g.marker(x, y, 'cross', 6, { color: '--critical' });
      g.legend([
        { label: 'Trial (inlier)', color: '--series-1', marker: 'circle' },
        ...(outs.length ? [{ label: 'Outlier (clipped to edge)', color: '--critical', marker: 'cross' }] : []),
        { label: 'Stein 1σ', color: '--estimate', width: 2 },
        { label: 'Stein 95 %', color: '--estimate', width: 1.5, dash: [6, 4] },
      ], { position: 'top-right' });
    };

    function runMc() {
      const token = ++mcToken;
      const N = state.N, Bs0 = cafm.bandBins(N, FS, state.BsKHz * 1000).Bs;
      const st = simStein(Bs0);
      const k = Bs0 / FS;
      const rng = linalg.makeRng(77 + state.seed * 31 + Math.floor(Math.random() * 1e6));
      mc = { dT: [], dF: [], out: [], sT: st.sT, sF: st.sF, Bs: Bs0, T: st.T, post: st.post };
      mcPlot.setView({ xmin: -4.2 * st.sT * 1e9, xmax: 4.2 * st.sT * 1e9, ymin: -4.2 * st.sF, ymax: 4.2 * st.sF });
      mcBtn.setLabel('Running…');
      const step = () => {
        if (token !== mcToken) return;
        const t0 = performance.now();
        while (mc.dT.length < MC_TRIALS && performance.now() - t0 < 40) {
          const r = cafm.monteCarlo({
            trials: 1, N, fs: FS, Bs: state.BsKHz * 1000, delay: state.tauUs * 1e-6, doppler: state.nuHz,
            snr1: st.p.snr1 * k, snr2: st.p.snr2 * k, rng,
          });
          mc.dT.push(r.delayErr[0]); mc.dF.push(r.dopplerErr[0]); mc.out.push(r.outlier[0]);
        }
        updateMcTable();
        mcPlot.requestRedraw();
        if (mc.dT.length < MC_TRIALS) later(step, 0);
        else mcBtn.setLabel(`Run ${MC_TRIALS} trials`);
      };
      later(step, 0);
    }

    function updateMcTable() {
      const sT = cafm.errorStats(mc.dT, mc.out), sF = cafm.errorStats(mc.dF, mc.out);
      const nOut = mc.out.reduce((a, b) => a + b, 0);
      const row = (q, s, pred, unit) => ({
        q,
        emp: Number.isFinite(s.stdInlier) ? fmtSI(s.stdInlier, unit, 3) : '—',
        pred: fmtSI(pred, unit, 3),
        ratio: Number.isFinite(s.stdInlier) ? fmt(s.stdInlier / pred, 3) : '—',
        bias: Number.isFinite(s.meanInlier) ? sgn(fmtSI(s.meanInlier, unit, 2)) : '—',
      });
      mcTable.setRows([row('TDOA', sT, mc.sT, 's'), row('FDOA', sF, mc.sF, 'Hz')]);
      const n = mc.dT.length;
      const bad = nOut > 0;
      mcStatus.className = bad ? 'caf-status bad' : 'caf-status';
      mcStatus.textContent = `${n} / ${MC_TRIALS} trials, BₛTγ = ${dbStr(stein.toDb(mc.post))} dB. Outliers: ${nOut}` +
        (bad ? ' — below threshold the empirical σ of the inliers is no longer a fair test of the bound.' : '.') +
        (n > 20 && !bad ? ` (With ${n} trials the empirical σ itself is uncertain by about ±${Math.round(100 / Math.sqrt(2 * (n - 1)))} %.)` : '');
    }

    // ------------------------------------------------------------ section C: calculator
    const calc = { B: 12.5e3, Bs: 12.5e3, T: 1, s1: 10, s2: 10 };
    const fmtHz = (v) => fmtSI(v, 'Hz', 3);
    const cB = slider({ label: 'Noise bandwidth $B$', min: 1e3, max: 1e8, log: true, value: calc.B, unit: '', format: fmtHz,
      hint: 'Width of the band through which noise reaches the correlator. Collectors 1 and 2 are A and B.',
      onInput: (v) => { calc.B = v; if (calc.Bs > v) { calc.Bs = v; cBs.value = v; } updateCalc(); } });
    const cBs = slider({ label: 'Signal bandwidth $B_s$ (≤ B)', min: 1e3, max: 1e8, log: true, value: calc.Bs, unit: '', format: fmtHz,
      onInput: (v) => { calc.Bs = Math.min(v, calc.B); if (v > calc.B) cBs.value = calc.B; updateCalc(); } });
    const cT = slider({ label: 'Integration time $T$', min: 1e-3, max: 10, log: true, value: calc.T, unit: '', format: (v) => fmtSI(v, 's', 3),
      onInput: (v) => { calc.T = v; updateCalc(); } });
    const cS1 = slider({ label: 'SNR at collector 1 (in $B$)', min: -20, max: 30, step: 1, value: calc.s1, unit: 'dB', format: dbStr,
      onInput: (v) => { calc.s1 = v; updateCalc(); } });
    const cS2 = slider({ label: 'SNR at collector 2 (in $B$)', min: -20, max: 30, step: 1, value: calc.s2, unit: 'dB', format: dbStr,
      onInput: (v) => { calc.s2 = v; updateCalc(); } });
    const PRESETS = [
      { label: '12.5 kHz voice channel, 1 s', B: 12.5e3, Bs: 12.5e3, T: 1, s1: 10, s2: 10 },
      { label: '1 MHz data link, 100 ms', B: 1e6, Bs: 1e6, T: 0.1, s1: 0, s2: 0 },
      { label: '10 MHz radar/wideband, 10 ms', B: 1e7, Bs: 1e7, T: 0.01, s1: -10, s2: -10 },
      { label: 'Weak signal: −10 dB and +10 dB', B: 1e6, Bs: 1e6, T: 0.1, s1: -10, s2: 10 },
    ];
    const presetBox = el('div', 'caf-presets');
    for (const p of PRESETS) {
      presetBox.append(button({ label: p.label, kind: 'ghost', onClick: () => {
        Object.assign(calc, { B: p.B, Bs: p.Bs, T: p.T, s1: p.s1, s2: p.s2 });
        cB.value = p.B; cBs.value = p.Bs; cT.value = p.T; cS1.value = p.s1; cS2.value = p.s2;
        updateCalc();
      } }).el);
    }
    const calcRo = readout([
      { key: 'st', label: 'TDOA $\\sigma_\\tau$' },
      { key: 'sf', label: 'FDOA $\\sigma_\\nu$' },
      { key: 'g', label: 'Effective SNR $\\gamma$', unit: 'dB' },
      { key: 'g2', label: '$2\\min(\\gamma_1,\\gamma_2)$', unit: 'dB', hint: 'The limit when the other collector is clean' },
      { key: 'post', label: '$BT\\gamma$', unit: 'dB' },
      { key: 'bt', label: '$BT$' },
      { key: 'tT1', label: 'Per-collector $\\sigma_{T,1}$', hint: 'Share of the timing error that belongs to collector 1: the sigma_T of earlier lessons' },
      { key: 'tT2', label: 'Per-collector $\\sigma_{T,2}$', hint: 'The same for collector 2' },
      { key: 'tF1', label: 'Per-collector $\\sigma_{F,1}$', hint: 'Share of the frequency error that belongs to collector 1: the sigma_F of earlier lessons' },
      { key: 'tF2', label: 'Per-collector $\\sigma_{F,2}$', hint: 'The same for collector 2' },
    ]);
    const exTable = dataTable({
      caption: 'Worked examples (B = B_s, equal SNR at both collectors), computed live from the core',
      columns: [
        { key: 'case', label: 'Case' },
        { key: 'post', label: '$BT\\gamma$', align: 'right' },
        { key: 'st', label: '$\\sigma_\\tau$', align: 'right' },
        { key: 'sf', label: '$\\sigma_\\nu$', align: 'right' },
      ],
      rows: [
        ['B = 25 kHz, T = 1 s, 10 dB', 25e3, 1, 10],
        ['B = 1 MHz, T = 0.1 s, 0 dB', 1e6, 0.1, 0],
        ['B = 10 MHz, T = 10 ms, −10 dB', 1e7, 0.01, -10],
      ].map(([c, B, T, db]) => {
        const p = { B, Bs: B, T, snr1: stein.fromDb(db), snr2: stein.fromDb(db) };
        return { case: c, post: `${dbStr(stein.toDb(B * T * stein.effectiveSnr(p.snr1, p.snr2)))} dB`, st: fmtSI(stein.tdoaSigma(p), 's', 2), sf: fmtSI(stein.fdoaSigma(p), 'Hz', 2) };
      }),
    });
    const sTHost = el('div'), sFHost = el('div');

    root.append(
      section('The bounds as a calculator',
        String.raw`<p>No simulation here: just Stein's formulas from the core, in real units. The consequences are worth
        spelling out. <strong>TDOA precision is bought with bandwidth</strong> ($\sigma_\tau \propto B_s^{-1}(BT)^{-1/2}$)
        and <strong>FDOA precision with duration</strong> ($\sigma_\nu \propto T^{-3/2}$ for fixed $B$). A narrowband
        voice channel gives mediocre TDOA however long you integrate, but superb FDOA &mdash; which is why FDOA matters
        at all. A short wideband pulse gives the opposite.</p>`,
        exTable,
        figure({
          plot: [el('div', 'caf-cuts', sTHost, sFHost)],
          controls: [
            controlGroup('Result', [calcRo]),
            controlGroup('Inputs', [cB, cBs, cT, cS1, cS2]),
            controlGroup('Presets', [presetBox]),
          ],
          caption: String.raw`Left: $\sigma_\tau$ versus integration time for the current $B$, $B_s$ and SNRs (slope $-1/2$:
            ten times longer buys only $\sqrt{10}$). Right: $\sigma_\nu$ versus $T$ (slope $-3/2$: the lobe narrows as $1/T$
            and the SNR grows as $\sqrt T$). The dot marks the current $T$. Per-collector values are the high-SNR split
            $\sigma_{T,i} = 1/(\beta\sqrt{2BT\gamma_i})$, so that $\sigma_\tau^2 \approx \sigma_{T,1}^2+\sigma_{T,2}^2$.`,
        }),
        callout('idea', 'The cross term: one clean channel rescues a weak one', String.raw`<p>The $1/(\gamma_1\gamma_2)$
          term is the noise-times-noise product in $\chi$. When both SNRs are well above 0 dB it is negligible and
          $\gamma$ is the harmonic mean of $\gamma_1$ and $\gamma_2$. When both are below 0 dB it dominates and $\gamma
          \approx 2\gamma_1\gamma_2$: two $-10$ dB channels give $\gamma \approx -17$ dB. But if one channel is strong,
          $\gamma \to 2\gamma_\text{weak}$: compare the $\gamma$ and $2\min(\gamma_1,\gamma_2)$ readouts with the
          "weak signal" preset. A big dish at one end of the baseline pays off.</p>`),
        callout('caution', 'Which bandwidth is B?', String.raw`<p>$B$ is the noise bandwidth that goes into the
          correlator and $\gamma_i$ is the SNR in that bandwidth. In the linear (high-SNR) terms only the product
          $B\gamma_i = S_i/N_0$ appears (signal power $S_i$ over $N_0$, the noise power per hertz), so $B$ cancels. It matters only through the cross term, and there Stein's
          derivation assumes the noise occupies the same band as the signal. If you correlate the raw recordings with
          $B > B_s$, the out-of-band noise products add a delay error larger than this formula's cross term (the
          simulation on this page reproduces that); filter to the signal band first and use $B = B_s$, with each SNR
          quoted in $B_s$. That is what the simulation above does.</p>`),
      ),
    );

    const sTPlot = new Plot2D(sTHost, { height: 230, xLog: true, yLog: true, xLabel: 'T (s)', yLabel: 'στ (ns)', pan: false, zoom: false,
      view: { xmin: 1e-3, xmax: 10, ymin: 0.01, ymax: 1e4 }, ariaLabel: 'TDOA sigma versus integration time, log-log.' });
    const sFPlot = new Plot2D(sFHost, { height: 230, xLog: true, yLog: true, xLabel: 'T (s)', yLabel: 'σν (Hz)', pan: false, zoom: false,
      view: { xmin: 1e-3, xmax: 10, ymin: 1e-5, ymax: 100 }, ariaLabel: 'FDOA sigma versus integration time, log-log.' });
    const calcP = (T) => ({ B: calc.B, Bs: calc.Bs, T, snr1: stein.fromDb(calc.s1), snr2: stein.fromDb(calc.s2) });
    const Ts = Array.from({ length: 81 }, (_, i) => 1e-3 * Math.pow(10, (4 * i) / 80));
    function drawScaling(g, fn, yScale, color) {
      const pts = Ts.map((T) => [T, fn(calcP(T)) * yScale]);
      g.line(pts, { color, width: 2 });
      g.marker(calc.T, fn(calcP(calc.T)) * yScale, 'circle', 5, { color });
    }
    sTPlot.onDraw = (g) => drawScaling(g, stein.tdoaSigma, 1e9, '--tdoa');
    sFPlot.onDraw = (g) => drawScaling(g, stein.fdoaSigma, 1, '--fdoa');

    function fitLogView(plot, fn, yScale) {
      const ys = Ts.map((T) => fn(calcP(T)) * yScale);
      const lo = Math.min(...ys), hi = Math.max(...ys);
      plot.setView({ xmin: 1e-3, xmax: 10, ymin: Math.pow(10, Math.floor(Math.log10(lo))), ymax: Math.pow(10, Math.ceil(Math.log10(hi))) });
    }

    function updateCalc() {
      const p = calcP(calc.T);
      const g = stein.effectiveSnr(p.snr1, p.snr2);
      const q1 = { B: p.B, Bs: p.Bs, T: p.T, snr: p.snr1 }, q2 = { B: p.B, Bs: p.Bs, T: p.T, snr: p.snr2 };
      calcRo.set({
        st: fmtSI(stein.tdoaSigma(p), 's', 3),
        sf: fmtSI(stein.fdoaSigma(p), 'Hz', 3),
        g: dbStr(stein.toDb(g)),
        g2: dbStr(stein.toDb(2 * Math.min(p.snr1, p.snr2))),
        post: dbStr(stein.toDb(p.B * p.T * g)),
        bt: fmt(p.B * p.T, 3),
        tT1: fmtSI(stein.toaSigma(q1), 's', 3), tT2: fmtSI(stein.toaSigma(q2), 's', 3),
        tF1: fmtSI(stein.foaSigma(q1), 'Hz', 3), tF2: fmtSI(stein.foaSigma(q2), 'Hz', 3),
      });
      fitLogView(sTPlot, stein.tdoaSigma, 1e9);
      fitLogView(sFPlot, stein.fdoaSigma, 1);
      sTPlot.requestRedraw(); sFPlot.requestRedraw();
    }

    // ------------------------------------------------------------ section D: caveats
    root.append(
      section('Careful: what the bound does not cover',
        callout('caution', '1. The threshold effect', String.raw`<p>The bound is a small-error result: it assumes the
          estimate is somewhere on the right lobe. Below a post-integration SNR $BT\gamma$ of very roughly 10&ndash;13 dB
          the highest point of $|\chi|$ in the search window is sometimes a noise peak, and those errors are as large as
          the window. The Monte-Carlo above shows it; the exact threshold depends on how many cells are searched.</p>`),
        callout('caution', '2. Delay and Doppler are not constant over T', String.raw`<p>The model holds $\tau$ and
          $\nu$ fixed during the integration. From orbit they are not: the FDOA changes at a rate $\dot\nu$, in hertz
          per second (the dot again means a rate of change with time; from orbit,
          tens of Hz per second is typical). During $T$ it moves by $\dot\nu T$, which is $\dot\nu T^2$ Doppler cells of
          width $1/T$: at $20$ Hz/s and $T = 1$ s the peak is smeared over 20 cells, and the $T^{-3/2}$ law fails unless the
          processor compensates the drift (searches over $\dot\nu$ too, or removes a known drift before correlating).
          The delay drifts as well, at the rate
          $\dot\tau = -\nu/f_0$ ($f_0$ is the carrier frequency), moving by $|\nu|T/f_0$, i.e. $B\,T\,|\nu|/f_0$ delay cells; that matters once it
          approaches 1.</p>`),
        callout('caution', '3. Structured signals give ambiguous peaks', String.raw`<p>The noise-like signal here has one
          clean peak. A periodic signal (a pulse train, a repeated preamble, a carrier with little modulation) has an
          ambiguity function with repeated peaks at multiples of its period in delay, or of its line spacing in Doppler;
          the processor must decide which one is right from other information.</p>`),
        callout('caution', '4. Thermal noise only', String.raw`<p>These are the errors caused by receiver (thermal) noise. Clock
          offsets, oscillator frequency errors and ephemeris errors (errors in the collectors' own positions and
          velocities) come on top and do not shrink with $B$, $T$ or SNR
          (see ${'LINK'}).</p>`.replace('LINK', '<a href="#/error-budget">the previous lesson</a>')),
        String.raw`<p><strong>Bridge to Part III.</strong> The per-collector values $\sigma_{T,i}$ and $\sigma_{F,i}$ in
        the calculator are exactly the per-collector noise inputs of the 4-ball lab: the lab differences them in pairs,
        which reproduces $\sigma_\tau^2 = \sigma_{T,i}^2+\sigma_{T,j}^2$, and adds the clock, oscillator and ephemeris
        terms on top.</p>`,
      ),
      questionSet(QUESTIONS['caf']),
      takeaways([
        'TDOA and FDOA are measured together, as the location of the peak of the cross-ambiguity function $|\\chi(\\tau\',\\nu\')|$ of two recordings of an unknown signal.',
        'Resolution (the lobe size) is about $1/B_s$ in delay and $1/T$ in Doppler; accuracy is that width divided by roughly twice the post-integration voltage SNR $\\sqrt{BT\\gamma}$.',
        'Stein: $\\sigma_\\tau = 1/(\\beta\\sqrt{BT\\gamma})$ and $\\sigma_\\nu = 1/(T_e\\sqrt{BT\\gamma})$ with $\\beta = \\pi B_s/\\sqrt3$, $T_e = \\pi T/\\sqrt3$. Bandwidth buys TDOA, duration buys FDOA ($T^{-3/2}$).',
        'With both SNRs below 0 dB the effective SNR collapses like their product; one clean collector restores $\\gamma \\approx 2\\gamma_\\text{weak}$.',
        'The bound holds only above threshold (post-integration SNR of very roughly 10–13 dB or more), for constant $\\tau$ and $\\nu$ over $T$, and for thermal noise alone.',
      ]),
      nextLesson(ctx, 'orbit-3d'),
    );

    // in-page link to the previous lesson must navigate through ctx
    const prev = root.querySelector('a[href="#/error-budget"]');
    if (prev) prev.replaceWith(lessonLink(ctx, 'error-budget', 'the previous lesson'));

    runSim();
    updateCalc();
    mcPlot.requestRedraw();

    // ------------------------------------------------------------ cleanup
    return () => {
      mcToken++;
      for (const id of timers) clearTimeout(id);
      timers.clear();
      for (const p of [heat, cutTau, cutNu, mcPlot, sTPlot, sFPlot]) p.destroy();
      style.remove();
      root.classList.remove('caf-lesson');
    };
  },
};
