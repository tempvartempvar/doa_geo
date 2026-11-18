/**
 * main.js - application shell: sidebar, hash router, lesson lifecycle.
 *
 * Routes are `#/<lesson-id>`. On navigation the current lesson's cleanup is
 * called, the next lesson module is import()ed lazily and its mount(root, ctx)
 * is called. Import / mount failures render a friendly error panel; a lesson
 * whose file does not exist yet renders a "not built yet" panel.
 */
import { lessons, parts, getLesson, lessonIndex } from './lessons/registry.js';

const STORAGE_KEY = 'tdoa-fdoa:last-lesson';
const LESSON_BASE = new URL('./lessons/', import.meta.url);

const $ = (id) => document.getElementById(id);
const appEl = $('app');
const navEl = $('lesson-nav');
const mainEl = $('main');
const titleEl = $('topbar-title');
const countEl = $('topbar-count');
const prevBtn = $('prev-btn');
const nextBtn = $('next-btn');
const scrim = $('scrim');
const drawerOpenBtn = $('drawer-open');

let currentId = null;
let currentCleanup = null;
let navToken = 0;

const ctx = Object.freeze({
  navigate(id) {
    if (!getLesson(id)) { console.warn('navigate: unknown lesson', id); return; }
    if (location.hash === `#/${id}`) route();
    else location.hash = `#/${id}`;
  },
});

// ------------------------------------------------------------ storage
function loadLast() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function saveLast(id) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* storage unavailable */ }
}

// ------------------------------------------------------------ helpers
function h(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
const num = (i) => String(i).padStart(2, '0');
function partOf(entry) { return parts.find((p) => p.id === entry.part); }
function kickerFor(entry) {
  const i = lessonIndex(entry.id);
  const p = partOf(entry);
  return `Part ${p ? p.id : '?'} · Lesson ${i}`;
}

// ------------------------------------------------------------ sidebar
function buildSidebar() {
  const frag = document.createDocumentFragment();
  for (const p of parts) {
    const items = lessons.filter((l) => l.part === p.id);
    if (!items.length) continue;
    const list = h('ol', 'nav-list');
    for (const l of items) {
      const a = h('a', 'nav-link', h('span', 'nav-num', num(lessonIndex(l.id))), h('span', 'nav-title', l.title));
      a.href = `#/${l.id}`;
      a.dataset.id = l.id;
      a.addEventListener('click', () => closeDrawer());
      list.append(h('li', null, a));
    }
    frag.append(h('div', 'nav-part', h('div', 'nav-part-title', `Part ${p.id} · ${p.title}`), list));
  }
  navEl.replaceChildren(frag);
}

function markActive(id) {
  for (const a of navEl.querySelectorAll('.nav-link')) {
    if (a.dataset.id === id) {
      a.setAttribute('aria-current', 'page');
      a.scrollIntoView({ block: 'nearest' });
    } else a.removeAttribute('aria-current');
  }
}

// ------------------------------------------------------------ drawer
function openDrawer() {
  appEl.classList.add('drawer-is-open');
  scrim.hidden = false;
  drawerOpenBtn.setAttribute('aria-expanded', 'true');
  const cur = navEl.querySelector('[aria-current="page"]') || navEl.querySelector('a');
  if (cur) cur.focus({ preventScroll: true });
}
function closeDrawer() {
  if (!appEl.classList.contains('drawer-is-open')) return;
  appEl.classList.remove('drawer-is-open');
  scrim.hidden = true;
  drawerOpenBtn.setAttribute('aria-expanded', 'false');
}

// ------------------------------------------------------------ topbar
function updateChrome(entry) {
  const i = lessonIndex(entry.id);
  titleEl.replaceChildren(h('span', null, `${kickerFor(entry)} · `), h('strong', null, entry.title));
  countEl.textContent = `${i + 1} / ${lessons.length}`;
  prevBtn.disabled = i <= 0;
  nextBtn.disabled = i >= lessons.length - 1;
  prevBtn.title = i > 0 ? `Previous: ${lessons[i - 1].title}` : '';
  nextBtn.title = i < lessons.length - 1 ? `Next: ${lessons[i + 1].title}` : '';
  document.title = `${entry.title} · TDOA / FDOA`;
  markActive(entry.id);
}

function step(delta) {
  const i = lessonIndex(currentId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= lessons.length) return;
  ctx.navigate(lessons[j].id);
}

// ------------------------------------------------------------ panels
function panel({ kicker, title, body, actions = [], error = null, cls = '' }) {
  const p = h('div', `panel ${cls}`);
  if (kicker) p.append(h('div', 'panel-kicker', kicker));
  p.append(h('h2', null, title));
  for (const para of [].concat(body || [])) p.append(para instanceof Node ? para : h('p', null, para));
  if (error) {
    const msg = h('p', null, h('code', null, String(error && error.message ? error.message : error)));
    const det = h('details', null, h('summary', null, 'Technical details'), h('pre', null, String((error && error.stack) || error)));
    p.append(msg, det);
  }
  if (actions.length) {
    const row = h('div', 'panel-actions');
    for (const a of actions) {
      const b = h('button', `btn ${a.primary ? 'btn-primary' : ''}`, a.label);
      b.type = 'button';
      b.addEventListener('click', a.onClick);
      row.append(b);
    }
    p.append(row);
  }
  return p;
}

function navActions(entry) {
  const i = lessonIndex(entry.id);
  const acts = [];
  if (i > 0) acts.push({ label: `← ${lessons[i - 1].title}`, onClick: () => step(-1) });
  if (i < lessons.length - 1) acts.push({ label: `${lessons[i + 1].title} →`, onClick: () => step(1), primary: true });
  return acts;
}

function showNotBuilt(entry, url) {
  const rel = new URL(url).pathname;
  mainEl.replaceChildren(panel({
    kicker: kickerFor(entry),
    title: entry.title,
    body: [
      'This lesson has not been built yet. Its content is still being written; check back soon.',
      h('p', null, 'Expected module: ', h('code', null, rel)),
    ],
    actions: navActions(entry),
  }));
}

function showError(entry, err, phase) {
  console.error(`Lesson "${entry ? entry.id : '?'}" failed during ${phase}:`, err);
  mainEl.replaceChildren(panel({
    cls: 'panel-error',
    kicker: entry ? kickerFor(entry) : 'Error',
    title: 'Something went wrong in this lesson',
    body: [`The lesson could not be ${phase === 'import' ? 'loaded' : 'started'}. The rest of the course still works; use the sidebar or the buttons below to continue.`],
    error: err,
    actions: [{ label: 'Try again', onClick: () => route(true), primary: true }, ...(entry ? navActions(entry) : [])],
  }));
}

function showNotFound(id) {
  mainEl.replaceChildren(panel({
    kicker: 'Not found',
    title: 'No such lesson',
    body: [h('p', null, 'There is no lesson called ', h('code', null, id), '.')],
    actions: [{ label: 'Go to the start', primary: true, onClick: () => ctx.navigate(lessons[0].id) }],
  }));
}

// ------------------------------------------------------------ lifecycle
function runCleanup() {
  const fn = currentCleanup;
  currentCleanup = null;
  if (typeof fn === 'function') {
    try { fn(); } catch (err) { console.error('Lesson cleanup failed:', err); }
  }
}

async function fileExists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return r.ok;
  } catch {
    return true; // network trouble: report the original error instead
  }
}

function parseHash() {
  const m = /^#\/?([^?#]*)/.exec(location.hash || '');
  return m && m[1] ? decodeURIComponent(m[1]) : '';
}

async function route(force = false) {
  let id = parseHash();
  if (!id) {
    const last = loadLast();
    id = last && getLesson(last) ? last : lessons[0].id;
    history.replaceState(null, '', `#/${id}`);
  }
  if (id === currentId && !force) return;

  const token = ++navToken;
  runCleanup();
  closeDrawer();
  const entry = getLesson(id);
  currentId = id;
  if (!entry) {
    markActive(null);
    titleEl.textContent = 'Not found';
    showNotFound(id);
    return;
  }
  updateChrome(entry);
  saveLast(id);
  mainEl.replaceChildren(h('div', 'loading', 'Loading lesson…'));
  window.scrollTo(0, 0);

  const url = new URL(entry.file, LESSON_BASE).href;
  let mod;
  try {
    mod = await import(url);
  } catch (err) {
    if (token !== navToken) return;
    if (!(await fileExists(url))) { if (token === navToken) showNotBuilt(entry, url); return; }
    if (token === navToken) showError(entry, err, 'import');
    return;
  }
  if (token !== navToken) return;

  const lesson = mod && mod.default;
  if (!lesson || typeof lesson.mount !== 'function') {
    showError(entry, new Error(`${entry.file} does not default-export an object with a mount(root, ctx) function.`), 'import');
    return;
  }

  const root = h('div', 'lesson');
  root.dataset.lesson = entry.id;
  mainEl.replaceChildren(root);
  try {
    const cleanup = await lesson.mount(root, ctx);
    if (token !== navToken) {
      // user navigated away while an async mount was running
      if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error(e); } }
      return;
    }
    currentCleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (err) {
    if (token !== navToken) return;
    showError(entry, err, 'mount');
    return;
  }
  try { // glossary box + lookup panel; imported lazily so a broken glossary cannot break the app
    const sym = await import('./ui/symbols.js');
    if (token !== navToken) return;
    const box = sym.symbolsBox(entry.id);
    const head = root.querySelector('.lesson-header');
    if (box) { if (head) head.after(box); else root.prepend(box); }
    sym.refreshSymbolsPanel(entry.id);
  } catch (err) { console.error('Symbols and terms failed:', err); }
  mainEl.focus({ preventScroll: true });
}

// ------------------------------------------------------------ events
function isTyping(t) {
  if (!t || !(t instanceof Element)) return false;
  if (t.isContentEditable) return true;
  return !!t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeDrawer(); return; }
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (isTyping(e.target) || isTyping(document.activeElement)) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
});

prevBtn.addEventListener('click', () => step(-1));
nextBtn.addEventListener('click', () => step(1));
drawerOpenBtn.addEventListener('click', openDrawer);
$('drawer-close').addEventListener('click', closeDrawer);
scrim.addEventListener('click', closeDrawer);
window.addEventListener('hashchange', () => route());

buildSidebar();
route();
