/**
 * tex.js - KaTeX helpers.
 * =====================================================================
 * KaTeX is loaded by a classic <script defer> in index.html. These helpers
 * work whether KaTeX arrived before or after they are called: until it is
 * available the raw TeX is shown in a <code class="tex-fallback">, and every
 * pending node is re-rendered as soon as KaTeX loads. If the vendored copy
 * (vendor/katex) is missing the raw TeX simply stays visible.
 *
 * API
 * ---------------------------------------------------------------------
 *   tex(src, { display = false }) -> HTMLElement
 *       Inline: <span class="tex">, display: <div class="tex tex-display">.
 *   prose(htmlString) -> HTMLElement (div.prose)
 *       HTML in which $...$ is inline math and $$...$$ is display math.
 *       Dollar signs inside <code> or <pre> are left alone; write \$ for a
 *       literal dollar sign elsewhere. Math may contain < and > freely.
 *       Rendered with throwOnError: false (bad TeX shows in red, never throws).
 *   renderTexString(src, display) -> HTML string (KaTeX markup, or escaped fallback)
 *   katexReady -> Promise<boolean>   resolves true when KaTeX is available,
 *                                    false if it has not loaded after 20 s
 *
 * USAGE
 * ---------------------------------------------------------------------
 *   import { tex, prose } from '../ui/tex.js';
 *   root.append(prose(`
 *     <p>The range from the emitter to collector $i$ is
 *        $\\rho_i = \\lVert \\mathbf r_i - \\mathbf r_e \\rVert$.</p>
 *     $$\\tau_{ij} = \\frac{\\rho_i - \\rho_j}{c}$$
 *     <p>Code is untouched: <code>cost = $5</code>.</p>`));
 *   label.append(tex('\\tau_{BA}'));
 *   // Remember: in a JS string literal a TeX backslash is written twice.
 */

const pending = new Map(); // element -> { src, display }

function getKatex() {
  return typeof window !== 'undefined' && window.katex && typeof window.katex.render === 'function' ? window.katex : null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function decodeEntities(s) {
  return s.replace(/&(lt|gt|amp|nbsp|quot|#39);/g, (_, e) => ({ lt: '<', gt: '>', amp: '&', nbsp: ' ', quot: '"', '#39': "'" }[e]));
}

function renderInto(el, src, display) {
  const k = getKatex();
  if (k) {
    try {
      k.render(src, el, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' });
      return true;
    } catch (err) {
      console.warn('KaTeX failed on', src, err);
    }
  }
  const code = document.createElement('code');
  code.className = 'tex-fallback';
  code.textContent = src;
  el.replaceChildren(code);
  return false;
}

function flushPending() {
  if (!getKatex()) return;
  for (const [el, { src, display }] of pending) renderInto(el, src, display);
  pending.clear();
}

export const katexReady = new Promise((resolve) => {
  if (typeof window === 'undefined') return resolve(false);
  if (getKatex()) return resolve(true);
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    clearInterval(timer);
    if (ok) flushPending();
    resolve(ok);
  };
  const check = () => { if (getKatex()) finish(true); };
  const script = document.querySelector('script[src*="katex"]');
  if (script) {
    script.addEventListener('load', check);
    script.addEventListener('error', () => finish(false));
  }
  window.addEventListener('DOMContentLoaded', check);
  window.addEventListener('load', check);
  const started = Date.now();
  const timer = setInterval(() => {
    check();
    if (Date.now() - started > 20000) finish(false);
  }, 150);
});

/** Render TeX to an element. Falls back to raw TeX in a <code>-styled span. */
export function tex(src, { display = false } = {}) {
  const el = document.createElement(display ? 'div' : 'span');
  el.className = display ? 'tex tex-display' : 'tex';
  const ok = renderInto(el, String(src), display);
  if (!ok && !getKatex()) pending.set(el, { src: String(src), display });
  return el;
}

/** KaTeX HTML for a TeX string (or escaped fallback markup). Does not register for later rendering. */
export function renderTexString(src, display = false) {
  const k = getKatex();
  if (k) {
    try { return k.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore' }); } catch { /* fall through */ }
  }
  return `<code class="tex-fallback">${escapeHtml(src)}</code>`;
}

/**
 * Split an HTML string into HTML with math placeholders. Skips <code>, <pre>,
 * <script> and <style> blocks; handles \$ escapes.
 */
function extractMath(html) {
  const maths = [];
  let out = '';
  let i = 0;
  const n = html.length;
  const lower = html.toLowerCase();
  while (i < n) {
    const ch = html[i];
    if (ch === '<') {
      const m = /^<(code|pre|script|style)\b/.exec(lower.slice(i, i + 8));
      if (m) {
        const close = lower.indexOf(`</${m[1]}>`, i);
        const end = close < 0 ? n : close + m[1].length + 3;
        out += html.slice(i, end);
        i = end;
        continue;
      }
      // copy the whole tag verbatim (attributes may contain $)
      const gt = html.indexOf('>', i);
      if (gt > i && /^<\/?[a-z!]/i.test(html.slice(i, i + 2))) {
        out += html.slice(i, gt + 1);
        i = gt + 1;
        continue;
      }
      out += ch;
      i++;
      continue;
    }
    if (ch === '\\' && html[i + 1] === '$') {
      out += '&#36;';
      i += 2;
      continue;
    }
    if (ch === '$') {
      const display = html[i + 1] === '$';
      const open = display ? 2 : 1;
      let j = i + open;
      let close = -1;
      while (j < n) {
        if (html[j] === '\\') { j += 2; continue; }
        if (html[j] === '$' && (!display || html[j + 1] === '$')) { close = j; break; }
        j++;
      }
      if (close < 0 || close === i + open) {
        out += html.slice(i, i + open);
        i += open;
        continue;
      }
      const src = decodeEntities(html.slice(i + open, close).trim());
      maths.push({ src, display });
      out += `<span data-tex-slot="${maths.length - 1}"></span>`;
      i = close + open;
      continue;
    }
    out += ch;
    i++;
  }
  return { html: out, maths };
}

/** Build a div.prose from an HTML string with $inline$ and $$display$$ math. */
export function prose(htmlString) {
  const div = document.createElement('div');
  div.className = 'prose';
  const { html, maths } = extractMath(String(htmlString ?? ''));
  div.innerHTML = html;
  for (const slot of div.querySelectorAll('span[data-tex-slot]')) {
    const m = maths[Number(slot.dataset.texSlot)];
    if (!m) continue;
    const node = tex(m.src, { display: m.display });
    slot.replaceWith(node);
  }
  // A display block directly inside <p> is invalid HTML flow but renders fine;
  // unwrap paragraphs that contain only a display equation for cleaner spacing.
  for (const p of div.querySelectorAll('p')) {
    if (p.childNodes.length === 1 && p.firstChild.classList && p.firstChild.classList.contains('tex-display')) {
      p.replaceWith(p.firstChild);
    }
  }
  return div;
}
