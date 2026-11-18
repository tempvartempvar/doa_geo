# TDOA / FDOA geolocation — an interactive course

A browser-based learning tool for passive geolocation by time difference of arrival (TDOA) and
frequency difference of arrival (FDOA). It starts with two receivers on a flat plane and ends with a
physically rigorous simulation of a four-satellite ("4-ball") collection, with every step interactive.

## Run it

```bash
npm start
```

then open <http://localhost:8137>. There is nothing to install: the site is static ES modules served
by a tiny zero-dependency Node script (`serve.mjs`; any static file server works, e.g.
`python -m http.server`). It runs fully offline: the two libraries it uses — KaTeX 0.16.9 (equations)
and three.js 0.160.0 (the 3-D globe) — are vendored in `vendor/`, unmodified, with their MIT licence
files alongside.

## The lessons

| | Lesson | What it answers |
|---|---|---|
| **Part I — flat world** | Start here | Why differences? Notation and the two rules of thumb. |
| | TDOA: time differences draw hyperbolas | What one TDOA tells you; why "range ÷ baseline" is the lever arm. |
| | FDOA: Doppler differences | What one FDOA tells you; why it scales with the carrier. |
| | Two collectors, one fix | Intersecting a TDOA and an FDOA curve; ghosts; how a solver finds the fix. |
| **Part II — errors** | Error ellipses and dilution of precision | From measurement noise to an error ellipse; DOP maps. |
| | What does 1 ns or 1 Hz cost? | Unit conversion × geometry; a per-collector bias explorer; where a hertz comes from. |
| | The cross-ambiguity function | How TDOA/FDOA are measured and how precisely (Stein's bounds). |
| **Part III — from orbit** | Into 3-D: from 2 balls to 4 | Hyperboloids, the Earth as a constraint, what each number of collectors can do. |
| | Real physics | Light-time, Sagnac, exact Doppler, relativistic clock rates, Shapiro, troposphere, ionosphere — each quantified. |
| | The 4-ball collection lab | A full sandbox: geometry, error budget, processor fidelity, Monte-Carlo vs CRLB, sensitivities. |

## How it is put together

```
index.html, css/app.css, js/main.js    app shell and router
js/lessons/                            one module per lesson (registry.js lists them); questions.js holds
                                       the "Check your understanding" questions for all of them;
                                       glossary.js defines every symbol and term, listed per lesson
js/ui/                                 plot2d.js (canvas plots), controls.js, layout.js, tex.js, globe3d.js,
                                       quiz.js (self-checking questions), symbols.js (the "Symbols and
                                       terms" box in each lesson and the Symbols panel in the top bar),
                                       diagrams.js (labelled diagrams of the quantities)
dev/diagrams.html                      preview of the diagrams (?theme=dark, ?only=name)
js/core/                               the physics engine (no DOM; runs in Node as well)
tests/                                 Node test suite for the engine
tools/                                 independent extended-precision cross-check (Python + mpmath)
vendor/                                third-party libraries: katex/ (CSS, JS, woff2 fonts) and
                                       three/ (core module, OrbitControls, wide-line addons)
```

### The physics engine (`js/core/`)

| Module | Contents |
|---|---|
| `planar.js` | Idealised 2-D model for Parts I–II: TDOA/FDOA, analytic gradients, CRLB, solver, DOP. |
| `frames.js`, `orbits.js` | WGS-84 geodesy, ECI↔ECEF, Kepler orbits, satellite formations. |
| `measure.js` | The measurement model: light-time equation solved in the inertial frame, exact Doppler ratio, clock rates, Shapiro, atmosphere. Its header comment is the physics specification. |
| `atmosphere.js` | Troposphere (zenith delay × Black–Eisner mapping) and single-layer ionosphere. |
| `estimate.js` | Weighted least squares (Gauss–Newton/Levenberg–Marquardt), CRLB, gain matrix, error ellipses, CEP. |
| `scenario.js` | High-level engine for Part III: covariance, DOP, Monte-Carlo, cost of each physical effect, sensitivity to each collector error, pass time-series. |
| `stein.js`, `caf.js` | Measurement-precision bounds and a cross-ambiguity-function simulator. |

Conventions used everywhere: collectors are A, B, C, D; ρᵢ is the emitter–collector range;
TDOA τᵢⱼ = tᵢ − tⱼ = (ρᵢ − ρⱼ)/c; Doppler fᵢ − f₀ = −(f₀/c)·ρ̇ᵢ; FDOA νᵢⱼ = fᵢ − fⱼ. The engine is SI throughout.

### What "physically accurate" means here

For the orbital lessons the truth model works in the Earth-centred **inertial** frame:

- **Finite light-time.** Each collector is evaluated at its own reception time and the emitter at the
  emission time (implicit light-time equation, iterated to floating-point precision).
- **Earth rotation / Sagnac.** Included automatically by propagating in the inertial frame; the engine
  can also compute in ECEF-as-if-inertial to show the error of omitting the Sagnac term.
- **Exact Doppler.** The received/transmitted frequency ratio is the exact derivative of the light-time
  equation, not `f₀(1 − ρ̇/c)`; FDOA is formed as a ratio so the unknown carrier cancels.
- **Relativity.** Time dilation and gravitational red-shift of collector oscillators (if they
  free-run), Shapiro delay.
- **Atmosphere.** Troposphere (non-dispersive) and ionosphere (group delay on TDOA, phase advance on
  FDOA, ∝ 1/f²).
- **Error budget.** Per-collector measurement noise, clock sync, oscillator stability, ephemeris
  position/velocity, terrain-height uncertainty; correlated correctly through the differencing.

Not modelled (and said so in the lessons): perturbed orbits (irrelevant to the measurement physics —
geolocation uses the collector state at reception), precession/nutation/polar motion, ionospheric
gradients/scintillation/higher-order terms and ray bending, multipath, carrier phase wind-up, antenna
and hardware delays, and variation of delay/Doppler inside the integration window.

## Verification

```bash
npm test
```

runs the engine's numerical tests: geodesy round-trips, orbit invariants, analytic-vs-numerical
gradients, the Sagnac identity, the exact Doppler factor against numerical differentiation of the
light-time solution, solver recovery of the truth, Monte-Carlo scatter against the Cramér–Rao bound,
the sensitivity table against deliberately injected errors, the cross-ambiguity-function simulator
against Stein's measurement bounds, and the lesson questions: every numeric answer, and every engine
number quoted in an explanation, is recomputed from the engine. It also checks that every glossary
entry is well formed and renders, and that the diagrams are drawn consistently (55 tests in all).

```bash
node tools/dump_reference.mjs
```

```bash
python tools/crosscheck.py
```

re-derive the measurement model independently in 50-digit arithmetic (requires `mpmath`) and compare
it with the JavaScript for LEO, MEO and GEO collectors, static and moving emitters, and every reduced
model. Current worst-case agreement: delays and TDOAs 2×10⁻¹⁷ s, frequency ratios 8×10⁻¹⁶, FDOA
4×10⁻⁷ Hz at 1 GHz.
