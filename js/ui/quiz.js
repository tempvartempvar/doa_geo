/**
 * quiz.js - "Check your understanding" question widget.
 * =====================================================================
 * Renders a lesson's question set (schema: ../lessons/questions.js) as a
 * section of self-checking cards. No persistence, no timers, no global
 * listeners, so it needs no cleanup.
 *
 * API
 * ---------------------------------------------------------------------
 *   questionSet(items, opts = {}) -> <section class="lesson-section quiz">
 *       items: [{ type: 'choice' | 'number' | 'think', ... }] (see questions.js).
 *       Returns an empty DocumentFragment when items is missing or empty, so
 *       root.append(questionSet(undefined)) renders nothing.
 *       opts.title overrides the heading ("Check your understanding").
 *       Every string (prompt, option text, why, hint, explain, unit) is HTML with
 *       $math$, rendered through prose(). Choice options are shown in a random
 *       order on each visit unless the question sets ordered: true.
 *   parseNumber(str) -> number | NaN
 *       Lenient parser used by 'number' questions: 1e-9, 1.2E3, +/-/U+2212 sign,
 *       space or comma thousands separators, 1.5×10^-9 / 1.5x10^-9.
 *
 * USAGE
 * ---------------------------------------------------------------------
 *   import { questionSet } from '../ui/quiz.js';
 *   import QUESTIONS from './questions.js';
 *   root.append(..., questionSet(QUESTIONS['tdoa-plane']), takeaways([...]));
 */

import { prose } from './tex.js';
import { el } from './layout.js';

let uid = 0;

/** prose() without the div wrapper, for inline slots (buttons, units). */
function inline(html) {
  const p = prose(html);
  const frag = document.createDocumentFragment();
  while (p.firstChild) frag.append(p.firstChild);
  return frag;
}

/** Replace a node's children, skipping null/false (replaceChildren would print "null"). */
function fill(node, ...kids) {
  node.replaceChildren(...kids.filter((k) => k != null && k !== false));
}

const PLAIN = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

export function parseNumber(str) {
  let s = String(str ?? '').trim()
    .replace(/[−‒–]/g, '-')
    .replace(/[\s   ,]/g, '');
  if (!s) return NaN;
  const m = /^(.+?)[x×*·]10\^?\(?([+-]?\d+)\)?$/i.exec(s);
  if (m) s = `${m[1]}e${m[2]}`;
  return PLAIN.test(s) ? Number(s) : NaN;
}

function fmtAnswer(a) {
  return Math.abs(a) >= 1e-3 && Math.abs(a) < 1e7 ? String(+a.toPrecision(6)) : a.toExponential(3);
}

export function questionSet(items, opts = {}) {
  if (!Array.isArray(items) || items.length === 0) return document.createDocumentFragment();

  const graded = items.filter((q) => q.type === 'choice' || q.type === 'number').length;
  let correct = 0;
  const progress = el('p', { class: 'quiz-progress', 'aria-live': 'polite' });
  const updateProgress = () => { progress.textContent = `${correct} of ${graded} correct`; };
  const markCorrect = () => { correct += 1; updateProgress(); };
  updateProgress();

  const list = el('ol', 'quiz-list');
  items.forEach((q, i) => {
    const builder = q.type === 'choice' ? choiceQ : q.type === 'number' ? numberQ : thinkQ;
    list.append(builder(q, i + 1, markCorrect));
  });

  return el('section', 'lesson-section quiz',
    el('h2', null, opts.title || 'Check your understanding'),
    el('p', 'quiz-intro', 'Commit to an answer before you reveal it.'),
    list,
    graded ? progress : null);
}

function card(q, n, kind) {
  const pid = `quiz-p${++uid}`;
  const prompt = prose(q.prompt || '');
  prompt.id = pid;
  prompt.classList.add('quiz-prompt');
  const feedback = el('div', { class: 'quiz-feedback', 'aria-live': 'polite' });
  const li = el('li', `quiz-q quiz-${kind}`,
    el('div', { class: 'quiz-num', 'aria-hidden': 'true' }, String(n)), prompt);
  return { li, pid, feedback };
}

function verdict(ok, text) {
  return el('p', `quiz-verdict ${ok ? 'is-right' : 'is-wrong'}`,
    el('span', { class: 'quiz-mark', 'aria-hidden': 'true' }, ok ? '✓' : '✗'), text);
}

// ---------------------------------------------------------------- choice
function choiceQ(q, n, markCorrect) {
  const { li, pid, feedback } = card(q, n, 'choice');
  const group = el('div', { class: 'quiz-options', role: 'group', 'aria-labelledby': pid });
  // Shuffle so that position carries no hint, unless the options form a natural scale.
  const options = [...(q.options || [])];
  if (!q.ordered) {
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
  }
  const buttons = options.map((opt) => {
    const mark = el('span', { class: 'quiz-mark', 'aria-hidden': 'true' });
    const state = el('span', 'quiz-sr');
    const b = el('button', { type: 'button', class: 'quiz-option' },
      mark, el('span', 'quiz-opt-text', inline(opt.text || '')), state);
    b.addEventListener('click', () => {
      if (opt.correct) {
        b.classList.add('is-right');
        mark.textContent = '✓';
        state.textContent = ' (correct)';
        fill(feedback, verdict(true, 'Correct.'),
          opt.why ? prose(opt.why) : null, q.explain ? prose(q.explain) : null);
        for (const o of buttons) o.disabled = true;
        li.classList.add('is-done');
        markCorrect();
      } else {
        b.classList.add('is-wrong');
        mark.textContent = '✗';
        state.textContent = ' (wrong)';
        fill(feedback, verdict(false, 'Not quite. Try another option.'),
          opt.why ? prose(opt.why) : null);
      }
    });
    return b;
  });
  group.append(...buttons);
  li.append(group, feedback);
  return li;
}

// ---------------------------------------------------------------- number
function numberQ(q, n, markCorrect) {
  const { li, pid, feedback } = card(q, n, 'number');
  const answer = Number(q.answer);
  const tol = q.tol ?? 0.05;
  const close = (x, a) => (q.absTol != null ? Math.abs(x - a) <= q.absTol : Math.abs(x - a) <= tol * Math.abs(a));

  const input = el('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
    class: 'ctrl-number quiz-input', 'aria-labelledby': pid,
  });
  const check = el('button', { type: 'button', class: 'btn btn-primary' }, 'Check');
  const show = el('button', { type: 'button', class: 'btn btn-ghost', hidden: true }, 'Show answer');
  const unitText = q.unit ? `${fmtAnswer(answer)} ${q.unit}` : fmtAnswer(answer);

  const lock = (ok) => {
    input.disabled = true;
    check.disabled = true;
    show.hidden = true;
    li.classList.add('is-done');
    fill(feedback, 
      ok ? verdict(true, el('span', null, 'Correct: ', inline(unitText)))
        : el('p', 'quiz-verdict is-revealed', 'Answer: ', inline(unitText)),
      q.explain ? prose(q.explain) : null);
  };

  const doCheck = () => {
    if (input.disabled) return;
    const x = parseNumber(input.value);
    if (!Number.isFinite(x)) {
      fill(feedback, el('p', 'quiz-verdict', 'Enter a number.'));
      return;
    }
    if (close(x, answer)) { lock(true); markCorrect(); return; }
    let tip = null;
    if (x !== 0 && Math.sign(x) !== Math.sign(answer) && close(Math.abs(x), Math.abs(answer))) {
      tip = 'Right size, wrong sign.';
    } else if (x !== 0 && answer !== 0 && x / answer > 0) {
      const r = x / answer;
      const k = Math.round(Math.log10(r));
      if (k !== 0 && Math.abs(k) <= 12 && Math.abs(r / 10 ** k - 1) <= tol) tip = 'Off by a power of ten: check your units.';
    }
    fill(feedback, verdict(false, tip ? `Not quite. ${tip}` : 'Not quite.'),
      !tip && q.hint ? prose(q.hint) : null);
    show.hidden = false;
  };

  check.addEventListener('click', doCheck);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doCheck(); } });
  show.addEventListener('click', () => lock(false));

  li.append(
    el('div', 'quiz-answer-row',
      el('span', 'quiz-input-wrap', input, q.unit ? el('span', 'ctrl-unit quiz-unit', inline(q.unit)) : null),
      check, show),
    feedback);
  return li;
}

// ---------------------------------------------------------------- think
function thinkQ(q, n) {
  const { li, feedback } = card(q, n, 'think');
  const reveal = el('button', { type: 'button', class: 'btn', 'aria-expanded': 'false' }, 'Reveal answer');
  reveal.addEventListener('click', () => {
    reveal.setAttribute('aria-expanded', 'true');
    reveal.hidden = true;
    li.classList.add('is-done');
    fill(feedback, q.explain ? prose(q.explain) : null);
  });
  li.append(el('div', 'quiz-answer-row', reveal), feedback);
  return li;
}
