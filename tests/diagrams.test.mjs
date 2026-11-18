import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIAGRAM_NAMES, diagramSvg, diagramCaption, gradientCheck, ellipseCep } from '../js/ui/diagrams.js';

function tagBalance(svg) {
  const counts = {};
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)) {
    const [, close, name, self] = m;
    if (self) continue;
    counts[name] = (counts[name] || 0) + (close ? -1 : 1);
  }
  return Object.entries(counts).filter(([, v]) => v !== 0);
}

test('six diagrams are listed', () => {
  assert.deepEqual(DIAGRAM_NAMES, ['notation', 'gradient', 'doppler', 'ellipse', 'orbit', 'lighttime']);
});

for (const name of DIAGRAM_NAMES) {
  test(`diagram "${name}": well-formed SVG with labels inside the viewBox`, () => {
    const svg = diagramSvg(name);
    assert.ok(svg.length > 200);
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
    for (const bad of ['NaN', 'undefined', 'Infinity']) assert.ok(!svg.includes(bad), `contains ${bad}`);
    assert.deepEqual(tagBalance(svg), [], 'unbalanced tags');
    assert.match(svg, /role="img"/);
    assert.match(svg, /aria-label="[^"]{20,}"/);
    const vb = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/);
    assert.ok(vb, 'has a viewBox');
    const [x0, y0, w, h] = vb.slice(1).map(Number);
    const texts = [...svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"/g)];
    assert.ok(texts.length > 0, 'has labels');
    for (const [, xs, ys] of texts) {
      const x = Number(xs), y = Number(ys);
      assert.ok(x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h, `text anchor (${x}, ${y}) outside viewBox`);
    }
    // colours only through theme variables
    for (const m of svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)) {
      assert.ok(m[1] === 'none' || /^var\(--[\w-]+\)$/.test(m[1]), `literal colour ${m[1]}`);
    }
  });

  test(`caption "${name}": balanced dollar signs`, () => {
    const cap = diagramCaption(name);
    assert.ok(cap.length > 40);
    const dollars = (cap.match(/(?<!\\)\$/g) || []).length;
    assert.equal(dollars % 2, 0);
  });
}

test('gradient: the difference arrow is perpendicular to the hyperbola at E', () => {
  const { cosine, residual } = gradientCheck();
  assert.ok(Math.abs(cosine) < 1e-9, `cosine ${cosine}`);
  assert.ok(residual < 1e-6, `E is ${residual} px off the curve`);
});

test('ellipse: CEP matches the usual approximation 0.562 sigma_major + 0.615 sigma_minor', () => {
  const cep = ellipseCep();
  const approx = 0.562 * 58 + 0.615 * 23.2;
  assert.ok(Math.abs(cep - approx) / approx < 0.02, `CEP ${cep} vs ${approx}`);
});

test('unknown name throws', () => {
  assert.throws(() => diagramSvg('nope'));
});
