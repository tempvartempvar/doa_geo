/**
 * symbols.js - "Symbols and terms" box and lookup panel, built from ../lessons/glossary.js.
 * =====================================================================================
 *   symbolsList(lessonId)   -> <dl class="symbols-list"> or null if the lesson has no entries
 *   symbolsBox(lessonId)    -> <details class="symbols"> (collapsed by default; the
 *                              open/closed choice is remembered in localStorage)
 *   refreshSymbolsPanel(id) -> creates the topbar "Symbols" button and the side panel on
 *                              first call, then replaces the panel content for lesson `id`.
 *                              The panel is non-modal; Escape or the close button hides it.
 */
import { TERMS, BY_LESSON } from '../lessons/glossary.js';
import { tex, prose } from './tex.js';
import { el } from './layout.js';

const OPEN_KEY = 'tdoa-fdoa:symbols-open';
const PANEL_ID = 'symbols-panel';

function keysFor(lessonId) {
  return (BY_LESSON[lessonId] || []).filter((k) => TERMS[k]);
}

export function symbolsList(lessonId) {
  const keys = keysFor(lessonId);
  if (!keys.length) return null;
  const dl = el('dl', 'symbols-list');
  for (const k of keys) {
    const t = TERMS[k];
    const def = prose(t.def);
    def.classList.add('symbols-def');
    if (t.unit) def.append(' ', el('span', 'symbols-unit', t.unit));
    dl.append(el('div', { class: 'symbols-row', dataset: { key: k } },
      el('dt', 'symbols-sym', t.sym ? tex(t.sym) : el('strong', null, t.name)),
      el('dd', 'symbols-body', t.sym ? el('span', 'symbols-name', t.name) : null, def)));
  }
  return dl;
}

function loadOpen() {
  try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}
function saveOpen(open) {
  try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* storage unavailable */ }
}

export function symbolsBox(lessonId) {
  const list = symbolsList(lessonId);
  if (!list) return null;
  const n = list.children.length;
  const box = el('details', 'symbols',
    el('summary', null, 'Symbols and terms in this lesson ', el('span', 'symbols-count', `(${n})`)),
    list);
  box.open = loadOpen();
  box.addEventListener('toggle', () => saveOpen(box.open));
  return box;
}

// ------------------------------------------------------------ lookup panel
let btn = null;
let panel = null;
let panelBody = null;

function setPanel(open) {
  if (!panel) return;
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('symbols-panel-open', open);
}

function ensurePanel() {
  if (panel) return true;
  const nav = document.querySelector('.topbar-nav');
  if (!nav) return false;
  btn = el('button', {
    class: 'btn btn-ghost symbols-btn', type: 'button', 'aria-controls': PANEL_ID,
    'aria-expanded': 'false', title: 'Symbols and terms in this lesson',
    html: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M17 5H7l6 7-6 7h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="btn-text">Symbols</span>',
  });
  btn.addEventListener('click', () => setPanel(panel.hidden));
  nav.prepend(btn);

  const close = el('button', {
    class: 'icon-btn symbols-close', type: 'button', 'aria-label': 'Close symbols panel',
    html: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  });
  close.addEventListener('click', () => { setPanel(false); btn.focus(); });
  panelBody = el('div', 'symbols-panel-body');
  panel = el('aside', { id: PANEL_ID, class: 'symbols-panel', 'aria-label': 'Symbols and terms', hidden: true },
    el('div', 'symbols-panel-head', el('h2', null, 'Symbols and terms'), close),
    panelBody);
  document.body.append(panel);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || panel.hidden) return;
    const inside = panel.contains(document.activeElement);
    setPanel(false);
    if (inside) btn.focus();
  });
  return true;
}

export function refreshSymbolsPanel(lessonId) {
  if (!ensurePanel()) return;
  const list = symbolsList(lessonId);
  panelBody.replaceChildren(...(list ? [list] : []));
  btn.hidden = !list;
  if (!list) setPanel(false);}
