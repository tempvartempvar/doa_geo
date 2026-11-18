/**
 * layout.js - lesson page layout helpers.
 * =====================================================================
 * Small helpers so every lesson has the same structure and look. The root
 * element passed to a lesson's mount() already has class "lesson" (a centred
 * column with consistent vertical rhythm); just append these blocks to it.
 *
 * API
 * ---------------------------------------------------------------------
 *   el(tag, attrsOrClass, ...children) -> HTMLElement
 *       attrsOrClass: 'class names' | { class, style (string|object), dataset,
 *       onclick / onInput... (functions become listeners), any attribute } | null.
 *       children: Node | string (text) | number | array | object with .el | null.
 *   lessonHeader({ kicker: 'Part I · Lesson 1', title, lede }) -> <header>
 *       lede is an HTML string with $math$.
 *   section(title, ...children) -> <section class="lesson-section">
 *       String children go through prose() ($...$ / $$...$$ math); objects with
 *       .el (controls, plots) are unwrapped.
 *   figure({ plot: el | els, controls: el | els, caption, layout: 'side' | 'stack' })
 *       -> <figure>. 'side' (default): plot left, controls in a 300 px column on
 *       the right, stacked below 1100 px. 'stack': controls under the plot.
 *       caption is an HTML string with $math$.
 *   callout(kind: 'idea' | 'try' | 'caution' | 'math', title, bodyHtml) -> <aside>
 *       Header reads "Key idea" / "Try this" / "Careful" / "The math", followed by
 *       the optional title. bodyHtml is an HTML string (with math) or a Node.
 *   takeaways([html, ...]) -> numbered "Takeaways" box
 *   nextLesson(ctx, id, label?) -> link card to the next lesson (label defaults
 *       to the registry title)
 *   lessonLink(ctx, id, label?) -> inline <a> that navigates via ctx.navigate
 *
 * USAGE
 * ---------------------------------------------------------------------
 *   import { el, lessonHeader, section, figure, callout, takeaways, nextLesson } from '../ui/layout.js';
 *   const plotHost = el('div');
 *   root.append(
 *     lessonHeader({ kicker: 'Part I · Lesson 1', title: 'TDOA', lede: 'A time difference...' }),
 *     section('The idea', '<p>Range difference $\\rho_A - \\rho_B$ ...</p>'),
 *     figure({ plot: plotHost, controls: [mySlider.el, myReadout.el], caption: 'Drag the emitter.' }),
 *     callout('try', 'Move B', '<p>What happens to the curves?</p>'),
 *     takeaways(['One TDOA = one hyperbola.']),
 *     nextLesson(ctx, 'fdoa-plane'),
 *   );
 *   const plot = new Plot2D(plotHost, { ... });   // create plots after the host exists
 */

import { prose } from './tex.js';
import { lessons } from '../lessons/registry.js';

/** Tiny DOM helper. */
export function el(tag, attrsOrClass, ...children) {
  const e = document.createElement(tag);
  if (typeof attrsOrClass === 'string') {
    if (attrsOrClass) e.className = attrsOrClass;
  } else if (attrsOrClass && typeof attrsOrClass === 'object' && !(attrsOrClass instanceof Node) && !Array.isArray(attrsOrClass) && !('el' in attrsOrClass)) {
    for (const [k, v] of Object.entries(attrsOrClass)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') e.innerHTML = v;
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, String(v));
    }
  } else if (attrsOrClass != null) {
    children.unshift(attrsOrClass);
  }
  appendChildren(e, children);
  return e;
}

function appendChildren(parent, children, stringsAsProse = false) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    if (c instanceof Node) parent.append(c);
    else if (typeof c === 'object' && c.el instanceof Node) parent.append(c.el);
    else if (stringsAsProse && typeof c === 'string') parent.append(prose(c));
    else parent.append(document.createTextNode(String(c)));
  }
}

/** Inline HTML (with math) as a fragment, without the div.prose wrapper. */
function inlineHtml(html) {
  const p = prose(html);
  const frag = document.createDocumentFragment();
  while (p.firstChild) frag.append(p.firstChild);
  return frag;
}

export function lessonHeader({ kicker = '', title = '', lede = '' } = {}) {
  return el('header', 'lesson-header',
    kicker ? el('div', 'lesson-kicker', kicker) : null,
    el('h1', 'lesson-title', title),
    lede ? el('p', 'lesson-lede', inlineHtml(lede)) : null);
}

export function section(title, ...children) {
  const s = el('section', 'lesson-section');
  if (title) s.append(el('h2', null, inlineHtml(title)));
  appendChildren(s, children, true);
  return s;
}

export function figure({ plot, controls, caption, layout = 'side' } = {}) {
  const plotBox = el('div', 'figure-plot');
  appendChildren(plotBox, [plot]);
  const hasControls = controls != null && (!Array.isArray(controls) || controls.length > 0);
  const body = el('div', 'figure-body', plotBox);
  if (hasControls) {
    const ctl = el('div', 'figure-controls');
    appendChildren(ctl, [controls]);
    body.append(ctl);
  }
  const fig = el('figure', `figure layout-${hasControls ? layout : 'stack'}`, body);
  fig.style.margin = '0';
  if (caption) {
    const cap = el('figcaption', 'figure-caption', caption instanceof Node ? caption : inlineHtml(caption));
    fig.append(cap);
  }
  return fig;
}

const CALLOUT_NAMES = { idea: 'Key idea', try: 'Try this', caution: 'Careful', math: 'The math' };

export function callout(kind, title, bodyHtml) {
  const k = CALLOUT_NAMES[kind] ? kind : 'idea';
  const head = el('div', 'callout-title', CALLOUT_NAMES[k]);
  if (title) head.append(el('span', 'callout-name', inlineHtml(title)));
  const body = bodyHtml instanceof Node ? bodyHtml : prose(bodyHtml || '');
  return el('aside', { class: `callout callout-${k}`, 'aria-label': CALLOUT_NAMES[k] }, head, body);
}

export function takeaways(items = []) {
  return el('section', 'takeaways',
    el('h2', null, 'Takeaways'),
    el('ol', null, items.map((html) => el('li', null, inlineHtml(html)))));
}

function lessonTitle(id) {
  const l = lessons.find((x) => x.id === id);
  return l ? l.title : id;
}

export function lessonLink(ctx, id, label) {
  return el('a', {
    href: `#/${id}`,
    onclick: (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      ctx.navigate(id);
    },
  }, label ?? lessonTitle(id));
}

export function nextLesson(ctx, id, label) {
  const a = lessonLink(ctx, id, '');
  a.className = 'next-lesson';
  a.replaceChildren(
    el('span', null, el('small', null, 'Next lesson'), el('span', 'next-label', label ?? lessonTitle(id))),
    el('span', { class: 'arrow', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
  );
  return a;
}
