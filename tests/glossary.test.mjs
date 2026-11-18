// Tests for the glossary (js/lessons/glossary.js) behind the "Symbols and terms" box:
// every lesson has a list, every list names real entries, every entry is well formed,
// and every piece of TeX renders in the vendored KaTeX.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TERMS, BY_LESSON } from '../js/lessons/glossary.js';
import { lessons } from '../js/lessons/registry.js';

// The vendored KaTeX is a UMD bundle; package.json's "type": "module" stops require() from
// treating it as CommonJS, so evaluate it with a CommonJS-style module object instead.
const katex = (() => {
  const mod = { exports: {} };
  new Function('module', 'exports', readFileSync(new URL('../vendor/katex/katex.min.js', import.meta.url), 'utf8'))(mod, mod.exports);
  return mod.exports.default || mod.exports;
})();

// $...$ spans of a def, as prose() in js/ui/tex.js finds them (skips <code>/<pre>, honours \$).
function mathSpans(html) {
  const s = html.replace(/<(code|pre)\b[\s\S]*?<\/\1>/gi, '').replace(/\\\$/g, '');
  const out = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
  let m;
  while ((m = re.exec(s))) out.push((m[1] ?? m[2]).trim().replace(/&(lt|gt|amp|nbsp);/g, (_, e) => ({ lt: '<', gt: '>', amp: '&', nbsp: ' ' }[e])));
  return out;
}

test('glossary: every lesson has a list of at least 8 known, distinct keys', () => {
  for (const l of lessons) {
    const keys = BY_LESSON[l.id];
    assert.ok(Array.isArray(keys) && keys.length >= 8, `lesson ${l.id} lists at least 8 terms`);
    for (const k of keys) assert.ok(TERMS[k], `lesson ${l.id} names unknown key "${k}"`);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(dup, [], `lesson ${l.id} has duplicate keys`);
  }
});

test('glossary: every term is used by at least one lesson', () => {
  const used = new Set(Object.values(BY_LESSON).flat());
  const unused = Object.keys(TERMS).filter((k) => !used.has(k));
  assert.deepEqual(unused, [], 'terms not listed by any lesson');
});

test('glossary: every entry has a name and a def ending in a full stop, with balanced dollars', () => {
  for (const [k, t] of Object.entries(TERMS)) {
    assert.ok(typeof t.name === 'string' && t.name.trim(), `${k}: name`);
    assert.ok(typeof t.def === 'string' && t.def.trim(), `${k}: def`);
    assert.match(t.def.trim().replace(/<\/[a-z]+>$/i, ''), /\.\)?$/, `${k}: def ends with a full stop`);
    const dollars = (t.def.replace(/\\\$/g, '').match(/\$/g) || []).length;
    assert.equal(dollars % 2, 0, `${k}: unbalanced $ in def`);
  }
});

test('glossary: every sym and every $math$ in a def renders in KaTeX', () => {
  const bad = [];
  const check = (k, src) => {
    try { katex.renderToString(src, { throwOnError: true, strict: 'ignore' }); } catch (e) { bad.push(`${k}: ${src} -> ${e.message}`); }
  };
  for (const [k, t] of Object.entries(TERMS)) {
    if (t.sym != null) check(k, t.sym);
    for (const src of mathSpans(t.def)) check(k, src);
  }
  assert.deepEqual(bad, [], 'TeX that KaTeX rejects');
});
