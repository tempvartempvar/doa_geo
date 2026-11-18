/**
 * controls.js - control widgets and number formatters.
 * =====================================================================
 * Every factory returns an object with `.el` (append it), a `.value`
 * getter/setter, `.set(v, fire = false)` and `.setDisabled(bool)` where
 * relevant. Setting `.value` (or `.set(v)`) never fires the callback;
 * `.set(v, true)` does. Labels are plain strings; any `$...$` in a label is
 * rendered as inline TeX. A label may also be a DOM Node.
 *
 * FACTORIES
 * ---------------------------------------------------------------------
 *   slider({ label, min, max, step, value, unit, log = false,
 *            format = v => string, onInput: v => {}, hint })
 *       Label left, live formatted value + unit right, range input below.
 *       log: true maps the thumb logarithmically between min and max (> 0);
 *       `step` is then ignored. Double-click the value to reset to the
 *       initial value (fires onInput).
 *   numberInput({ label, value, unit, min, max, step, onChange, hint })
 *       onChange fires on commit (blur / Enter), value clamped to [min, max].
 *   toggle({ label, value = false, onChange: bool => {}, hint })
 *   select({ label, options: [{ value, label }], value, onChange })
 *   segmented({ label, options: [{ value, label }], value, onChange })
 *       options may also be plain strings.
 *   button({ label, onClick, kind: 'primary' | 'ghost' | undefined })
 *       -> { el, setDisabled, setLabel }
 *   controlGroup(title, [controlsOrElements], { collapsible = false, collapsed = false })
 *       -> HTMLElement
 *   readout([{ key, label, unit, hint }], { block = true })
 *       -> { el, set({ key: valueStringOrNumber, ... }) }
 *       Numbers are formatted with fmt(v, 4); strings are shown as-is.
 *       Updates only touch text nodes whose content changed (cheap at 60 Hz).
 *   dataTable({ columns: [{ key, label, unit, align: 'left'|'right'|'center',
 *               format: (value, row) => string }], rows, caption })
 *       -> { el, setRows(rows) }. A row may carry `className` (e.g. 'total')
 *       and/or `highlight: true`.
 *
 * FORMATTERS
 * ---------------------------------------------------------------------
 *   fmt(value, sig = 3)        significant-figure formatting; very large or
 *                              small numbers as 1.23x10^-9 (Unicode superscripts)
 *   fmtSI(value, unit, sig=3)  1.23e-9, 's' -> "1.23 ns"; 1.5e9, 'Hz' -> "1.50 GHz"
 *   fmtDist(meters, sig = 3)   auto mm / m / km: 0.0123 -> "12.3 mm", 4200 -> "4.20 km"
 *
 * USAGE
 * ---------------------------------------------------------------------
 *   import { slider, toggle, readout, controlGroup, fmtSI } from '../ui/controls.js';
 *   const sigma = slider({ label: 'Timing noise', min: 1e-9, max: 1e-5, value: 1e-8,
 *                          log: true, format: (v) => fmtSI(v, 's'),
 *                          onInput: (v) => { state.sigma = v; plot.requestRedraw(); } });
 *   const ro = readout([{ key: 'tau', label: '$\\tau_{BA}$', unit: 'µs' }]);
 *   panel.append(controlGroup('Noise', [sigma, ro]));
 *   ro.set({ tau: 12.3456 });
 */

import { tex } from './tex.js';

// ------------------------------------------------------------ formatters
const MINUS = '−';
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n) => String(n).split('').map((c) => SUP[c] ?? c).join('');
const minus = (s) => s.replace(/^-/, MINUS);

/** Format a number to `sig` significant figures (keeps trailing zeros). */
export function fmt(value, sig = 3) {
  const v = Number(value);
  if (Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : MINUS + '∞';
  if (v === 0) return '0';
  const av = Math.abs(v);
  if (av >= 1e9 || av < 1e-3) {
    let e = Math.floor(Math.log10(av));
    let m = (v / Math.pow(10, e)).toPrecision(sig);
    if (Math.abs(parseFloat(m)) >= 10) { e += 1; m = (v / Math.pow(10, e)).toPrecision(sig); }
    return minus(m) + '×10' + sup(e);
  }
  if (av >= Math.pow(10, sig)) return minus(Math.round(v).toLocaleString('en-US'));
  let s = v.toPrecision(sig);
  if (s.includes('e')) s = String(Number(s));
  return minus(s);
}

const PREFIX = { '-24': 'y', '-21': 'z', '-18': 'a', '-15': 'f', '-12': 'p', '-9': 'n', '-6': 'µ', '-3': 'm', 0: '', 3: 'k', 6: 'M', 9: 'G', 12: 'T', 15: 'P', 18: 'E', 21: 'Z', 24: 'Y' };

/** Format with an SI prefix: fmtSI(1.23e-9, 's') -> "1.23 ns". */
export function fmtSI(value, unit = '', sig = 3) {
  const v = Number(value);
  if (!Number.isFinite(v)) return fmt(v) + (unit ? ' ' + unit : '');
  if (v === 0) return '0' + (unit ? ' ' + unit : '');
  let e3 = Math.floor(Math.log10(Math.abs(v)) / 3) * 3;
  e3 = Math.max(-24, Math.min(24, e3));
  let m = (v / Math.pow(10, e3)).toPrecision(sig);
  if (Math.abs(parseFloat(m)) >= 1000 && e3 < 24) {
    e3 += 3;
    m = (v / Math.pow(10, e3)).toPrecision(sig);
  }
  if (m.includes('e')) m = String(Number(m));
  const tail = PREFIX[e3] + unit;
  return minus(m) + (tail ? ' ' + tail : '');
}

/** Distance in metres with automatic mm / m / km. */
export function fmtDist(meters, sig = 3) {
  const v = Number(meters);
  if (!Number.isFinite(v)) return fmt(v);
  const av = Math.abs(v);
  if (av === 0) return '0 m';
  if (av < 1) return fmt(v * 1000, sig) + ' mm';
  if (av < 1000) return fmt(v, sig) + ' m';
  return fmt(v / 1000, sig) + ' km';
}

// --------------------------------------------------------------- helpers
let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

function h(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

/** Plain string, string with $tex$ segments, or a Node. */
function richLabel(label) {
  if (label == null) return document.createTextNode('');
  if (label instanceof Node) return label;
  const s = String(label);
  if (!s.includes('$')) return document.createTextNode(s);
  const frag = document.createDocumentFragment();
  s.split(/(\$[^$]+\$)/g).forEach((part) => {
    if (!part) return;
    if (part.length > 2 && part.startsWith('$') && part.endsWith('$')) frag.append(tex(part.slice(1, -1)));
    else frag.append(document.createTextNode(part));
  });
  return frag;
}

function hintEl(hint) {
  return hint ? h('div', 'ctrl-hint', richLabel(hint)) : null;
}

const defaultFormat = (v) => fmt(v, 3);

// ---------------------------------------------------------------- slider
export function slider({ label = '', min = 0, max = 1, step = 'any', value, unit = '', log = false,
  format = defaultFormat, onInput = null, hint = '' } = {}) {
  if (log && !(min > 0 && max > min)) throw new Error('slider: log scale needs 0 < min < max');
  const initial = value ?? min;
  let current = initial;
  const id = nextId('sl');
  const RES = 1000;

  const lab = h('label', 'ctrl-label', richLabel(label));
  lab.htmlFor = id;
  const valEl = h('span', 'ctrl-value');
  valEl.title = 'Double-click to reset';
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'ctrl-range';
  input.id = id;
  if (log) {
    input.min = '0'; input.max = String(RES); input.step = '1';
  } else {
    input.min = String(min); input.max = String(max); input.step = String(step ?? 'any');
  }
  const el = h('div', 'ctrl ctrl-slider', h('div', 'ctrl-row', lab, valEl), input, hintEl(hint));

  const toPos = (v) => (log ? Math.round((Math.log(v / min) / Math.log(max / min)) * RES) : v);
  const fromPos = (p) => (log ? min * Math.pow(max / min, p / RES) : p);
  const render = () => {
    const txt = format(current) + (unit ? ' ' + unit : '');
    if (valEl.textContent !== txt) valEl.textContent = txt;
    const frac = log ? Number(input.value) / RES : (current - min) / (max - min || 1);
    input.style.setProperty('--fill', `${Math.max(0, Math.min(1, frac)) * 100}%`);
    input.setAttribute('aria-valuetext', txt);
  };
  const set = (v, fire = false) => {
    v = Math.max(min, Math.min(max, Number(v)));
    current = v;
    input.value = String(toPos(v));
    render();
    if (fire && onInput) onInput(current);
  };
  input.addEventListener('input', () => {
    current = Number(fromPos(Number(input.value)));
    if (log) current = Math.max(min, Math.min(max, current));
    render();
    if (onInput) onInput(current);
  });
  valEl.addEventListener('dblclick', () => set(initial, true));
  set(initial);

  return {
    el, input,
    get value() { return current; },
    set value(v) { set(v, false); },
    set,
    reset() { set(initial, true); },
    setDisabled(d) { input.disabled = !!d; el.classList.toggle('is-disabled', !!d); },
  };
}

// ----------------------------------------------------------- numberInput
export function numberInput({ label = '', value = 0, unit = '', min = -Infinity, max = Infinity, step = 'any',
  onChange = null, hint = '' } = {}) {
  const id = nextId('ni');
  const lab = h('label', 'ctrl-label', richLabel(label));
  lab.htmlFor = id;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'ctrl-number';
  input.id = id;
  if (Number.isFinite(min)) input.min = String(min);
  if (Number.isFinite(max)) input.max = String(max);
  input.step = String(step);
  let current = Number(value);
  input.value = String(current);
  const el = h('div', 'ctrl ctrl-numberinput', lab,
    h('div', 'ctrl-input-wrap', input, unit ? h('span', 'ctrl-unit', richLabel(unit)) : null), hintEl(hint));
  const set = (v, fire = false) => {
    let n = Number(v);
    if (!Number.isFinite(n)) n = current;
    n = Math.max(min, Math.min(max, n));
    current = n;
    input.value = String(n);
    if (fire && onChange) onChange(current);
  };
  input.addEventListener('change', () => set(input.value, true));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  return {
    el, input,
    get value() { return current; },
    set value(v) { set(v, false); },
    set,
    setDisabled(d) { input.disabled = !!d; el.classList.toggle('is-disabled', !!d); },
  };
}

// ---------------------------------------------------------------- toggle
export function toggle({ label = '', value = false, onChange = null, hint = '' } = {}) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = !!value;
  const el = h('label', 'ctrl ctrl-toggle', input, h('span', 'ctrl-switch'), h('span', 'ctrl-label', richLabel(label)), hintEl(hint));
  input.addEventListener('change', () => { if (onChange) onChange(input.checked); });
  const set = (v, fire = false) => { input.checked = !!v; if (fire && onChange) onChange(input.checked); };
  return {
    el, input,
    get value() { return input.checked; },
    set value(v) { set(v, false); },
    set,
    setDisabled(d) { input.disabled = !!d; el.classList.toggle('is-disabled', !!d); },
  };
}

const normOptions = (options) => (options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));

// ---------------------------------------------------------------- select
export function select({ label = '', options = [], value, onChange = null, hint = '' } = {}) {
  const opts = normOptions(options);
  const id = nextId('se');
  const lab = h('label', 'ctrl-label', richLabel(label));
  lab.htmlFor = id;
  const sel = document.createElement('select');
  sel.className = 'ctrl-select';
  sel.id = id;
  opts.forEach((o, i) => {
    const op = document.createElement('option');
    op.value = String(i);
    op.textContent = o.label;
    sel.append(op);
  });
  let current = value ?? opts[0]?.value;
  const idxOf = (v) => Math.max(0, opts.findIndex((o) => o.value === v));
  sel.value = String(idxOf(current));
  const el = h('div', 'ctrl ctrl-selectbox', label ? lab : null, sel, hintEl(hint));
  sel.addEventListener('change', () => {
    current = opts[Number(sel.value)].value;
    if (onChange) onChange(current);
  });
  const set = (v, fire = false) => {
    current = v;
    sel.value = String(idxOf(v));
    if (fire && onChange) onChange(current);
  };
  return {
    el, input: sel,
    get value() { return current; },
    set value(v) { set(v, false); },
    set,
    setDisabled(d) { sel.disabled = !!d; el.classList.toggle('is-disabled', !!d); },
  };
}

// ------------------------------------------------------------- segmented
export function segmented({ label = '', options = [], value, onChange = null, hint = '' } = {}) {
  const opts = normOptions(options);
  let current = value ?? opts[0]?.value;
  const labId = nextId('sg');
  const group = h('div', 'ctrl-seg');
  group.setAttribute('role', 'group');
  if (label) group.setAttribute('aria-labelledby', labId);
  const buttons = opts.map((o) => {
    const b = h('button', null, richLabel(o.label));
    b.type = 'button';
    b.addEventListener('click', () => {
      if (current === o.value) return;
      set(o.value, true);
    });
    group.append(b);
    return b;
  });
  const lab = label ? h('span', 'ctrl-label', richLabel(label)) : null;
  if (lab) lab.id = labId;
  const el = h('div', 'ctrl ctrl-segmented', lab, group, hintEl(hint));
  const render = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(opts[i].value === current)));
  function set(v, fire = false) {
    current = v;
    render();
    if (fire && onChange) onChange(current);
  }
  render();
  return {
    el,
    get value() { return current; },
    set value(v) { set(v, false); },
    set,
    setDisabled(d) { buttons.forEach((b) => (b.disabled = !!d)); el.classList.toggle('is-disabled', !!d); },
  };
}

// ---------------------------------------------------------------- button
export function button({ label = '', onClick = null, kind } = {}) {
  const el = h('button', 'btn' + (kind ? ` btn-${kind}` : ''), richLabel(label));
  el.type = 'button';
  if (onClick) el.addEventListener('click', (e) => onClick(e));
  return {
    el,
    setDisabled(d) { el.disabled = !!d; },
    setLabel(l) { el.replaceChildren(richLabel(l)); },
  };
}

// ---------------------------------------------------------- controlGroup
export function controlGroup(title, controls = [], { collapsible = false, collapsed = false } = {}) {
  const body = h('div', 'ctrl-group-body');
  for (const c of controls) {
    if (c == null) continue;
    body.append(c instanceof Node ? c : c.el);
  }
  const el = h('section', 'ctrl-group' + (collapsible && collapsed ? ' collapsed' : ''));
  if (title || collapsible) {
    let head;
    if (collapsible) {
      head = h('button', 'ctrl-group-title', h('span', null, richLabel(title)));
      head.type = 'button';
      const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chev.setAttribute('viewBox', '0 0 24 24');
      chev.setAttribute('width', '14');
      chev.setAttribute('height', '14');
      chev.setAttribute('class', 'chev');
      chev.setAttribute('aria-hidden', 'true');
      chev.innerHTML = '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
      head.append(chev);
      body.id = nextId('cg');
      head.setAttribute('aria-controls', body.id);
      head.setAttribute('aria-expanded', String(!collapsed));
      head.addEventListener('click', () => {
        const c = el.classList.toggle('collapsed');
        head.setAttribute('aria-expanded', String(!c));
      });
    } else {
      head = h('h3', 'ctrl-group-title', richLabel(title));
    }
    el.append(head);
  } else {
    body.style.paddingTop = '12px';
  }
  el.append(body);
  return el;
}

// --------------------------------------------------------------- readout
export function readout(items = [], { block = true } = {}) {
  const dl = h('dl', 'readout');
  const cells = new Map();
  for (const it of items) {
    const dt = h('dt', null, richLabel(it.label ?? it.key));
    if (it.hint) dt.title = it.hint;
    const val = document.createTextNode('—');
    const dd = h('dd', null, val);
    if (it.unit) dd.append(h('span', 'ro-unit', richLabel(it.unit)));
    dl.append(dt, dd);
    cells.set(it.key, val);
  }
  const el = block ? h('div', 'readout-block', dl) : dl;
  return {
    el,
    set(values) {
      for (const k in values) {
        const node = cells.get(k);
        if (!node) continue;
        const v = values[k];
        const s = typeof v === 'number' ? fmt(v, 4) : v == null ? '—' : String(v);
        if (node.data !== s) node.data = s;
      }
    },
  };
}

// ------------------------------------------------------------- dataTable
export function dataTable({ columns = [], rows = [], caption = '' } = {}) {
  const table = h('table', 'data-table');
  if (caption) table.append(h('caption', null, richLabel(caption)));
  const alignClass = (c) => (c.align === 'right' ? 'num' : c.align === 'center' ? 'center' : '');
  const thead = h('thead');
  const trh = h('tr');
  for (const c of columns) {
    const th = h('th', alignClass(c), richLabel(c.label ?? c.key));
    th.scope = 'col';
    if (c.unit) th.append(h('span', 'th-unit', richLabel(`(${c.unit})`)));
    trh.append(th);
  }
  thead.append(trh);
  const tbody = h('tbody');
  table.append(thead, tbody);
  const setRows = (rs) => {
    const frag = document.createDocumentFragment();
    for (const r of rs || []) {
      const tr = h('tr', [r.className, r.highlight ? 'highlight' : ''].filter(Boolean).join(' ') || null);
      for (const c of columns) {
        const raw = r[c.key];
        let content;
        if (c.format) content = c.format(raw, r);
        else if (typeof raw === 'number') content = fmt(raw, 3);
        else content = raw ?? '';
        const td = h('td', alignClass(c), content instanceof Node ? content : richLabel(String(content)));
        tr.append(td);
      }
      frag.append(tr);
    }
    tbody.replaceChildren(frag);
  };
  setRows(rows);
  return { el: h('div', 'data-table-wrap', table), table, setRows };
}
