/**
 * registry.js - the ordered list of lessons.
 * =====================================================================
 * The app shell (js/main.js) builds the sidebar from this list, routes
 * `#/<id>` to the lesson, and lazily import()s `file` (relative to this
 * directory) the first time the lesson is opened. A lesson whose file does
 * not exist yet shows a "not built yet" panel.
 *
 * LESSON MODULE CONTRACT
 * ---------------------------------------------------------------------
 * Each lesson file default-exports an object:
 *
 *   export default {
 *     id: 'tdoa-plane',
 *     title: 'TDOA: time differences draw hyperbolas',
 *     mount(root, ctx) {
 *       // root: an empty <div class="lesson"> owned by this lesson.
 *       // ctx:  { navigate(id) }  - go to another lesson by id.
 *       // Build DOM under root (see js/ui/layout.js, controls.js, plot2d.js, tex.js).
 *       return () => {
 *         // cleanup, called before the next lesson mounts:
 *         // cancel rAF / timers, remove global listeners (window, document),
 *         // plot.destroy() every Plot2D, dispose WebGL renderers / geometries.
 *       };
 *     },
 *   };
 *
 * Rules: never touch DOM outside `root` except through cleanup-tracked global
 * listeners; never assume the lesson is mounted only once (users navigate
 * back and forth); mount() may be async (return a Promise of the cleanup).
 * See js/lessons/00-welcome.js for the reference exemplar.
 */

export const parts = [
  { id: 'I', title: 'Flat-world intuition' },
  { id: 'II', title: 'Errors' },
  { id: 'III', title: 'From orbit' },
];

export const lessons = [
  // Part I - Flat-world intuition
  { id: 'welcome', file: './00-welcome.js', part: 'I', title: 'Start here' },
  { id: 'tdoa-plane', file: './01-tdoa-plane.js', part: 'I', title: 'TDOA: time differences draw hyperbolas' },
  { id: 'fdoa-plane', file: './02-fdoa-plane.js', part: 'I', title: 'FDOA: Doppler differences' },
  { id: 'fusion-plane', file: './03-fusion-plane.js', part: 'I', title: 'Two collectors, one fix: TDOA + FDOA' },
  // Part II - Errors
  { id: 'dop', file: './04-dop.js', part: 'II', title: 'Error ellipses and dilution of precision' },
  { id: 'error-budget', file: './05-error-budget.js', part: 'II', title: 'What does 1 ns or 1 Hz cost?' },
  { id: 'caf', file: './06-caf.js', part: 'II', title: 'Where the numbers come from: the cross-ambiguity function' },
  // Part III - From orbit
  { id: 'orbit-3d', file: './07-orbit-3d.js', part: 'III', title: 'Into 3-D: from 2 balls to 4' },
  { id: 'physics', file: './08-physics.js', part: 'III', title: 'Real physics: light-time, Sagnac, relativity, atmosphere' },
  { id: 'lab', file: './09-lab.js', part: 'III', title: 'The 4-ball collection lab' },
];

/** Lesson entry by id, or undefined. */
export function getLesson(id) {
  return lessons.find((l) => l.id === id);
}

/** Zero-based position of a lesson in the course, or -1. */
export function lessonIndex(id) {
  return lessons.findIndex((l) => l.id === id);
}
