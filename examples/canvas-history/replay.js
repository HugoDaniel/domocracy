// Replay is a presentation of committed edits at a fixed teaching pace. It is
// not a recording: nothing here knows how fast the original drag was, how the
// pointer curved on its way, or when it happened. Each entry gets the same
// number of milliseconds, a move is interpolated between its two endpoints, and
// a colour change appears at the boundary of its entry.
//
// The playback scene is a value of its own and never reaches the document. While
// it runs, no intent is raised, no effect runs and no history entry is written,
// so replaying a history twice leaves the same history both times.
//
// `sceneAt` is a pure function of the plan and one elapsed time, which is what
// makes a skipped frame harmless: the next frame asks for the scene at the time
// it actually happened rather than advancing a position by one step.
import { applied, applyAction, circleOf } from './scene.js';

const freeze = Object.freeze;

// The documented pace: one entry per this many milliseconds, whatever the entry.
export const STEP = 600;

// What Start captures: the scene the page began from and the entries that
// currently apply. Everything after the history cursor is left out, so an
// undone edit is not replayed and a later commit that truncates the redo tail
// cannot change a plan that is already running.
export function replayPlan(history) {
  const entries = freeze(applied(history));
  return freeze({ initial: history.initial, entries, duration: entries.length * STEP });
}

function sceneOfEntry(entry, t) {
  const action = entry.action;
  if (action.kind !== 'move') return entry.after;
  const from = circleOf(entry.before, action.id);
  return applyAction(entry.before, {
    kind: 'move',
    id: action.id,
    x: from.x + (action.x - from.x) * t,
    y: from.y + (action.y - from.y) * t,
  });
}

// The scene at one moment of a plan, with the entry that moment belongs to and
// whether the plan has finished. An empty plan is finished at the start.
export function sceneAt(plan, elapsed) {
  const entries = plan.entries;
  if (entries.length === 0) return freeze({ scene: plan.initial, index: -1, done: true });
  if (elapsed >= plan.duration) {
    const last = entries[entries.length - 1];
    return freeze({ scene: last.after, index: entries.length - 1, done: true });
  }
  const index = Math.max(0, Math.floor(elapsed / STEP));
  const t = Math.min(1, Math.max(0, (elapsed - index * STEP) / STEP));
  return freeze({ scene: sceneOfEntry(entries[index], t), index, done: false });
}

// One animation-frame loop, and the two callbacks around it. The clock and the
// scheduler are arguments so that a test can drive playback frame by frame; the
// page leaves them out and gets `performance.now` and `requestAnimationFrame`.
export function createReplay({ frame, done, now, schedule, cancel }) {
  const clock = now ?? (() => performance.now());
  const later = schedule ?? (fn => requestAnimationFrame(fn));
  const stopWaiting = cancel ?? (handle => cancelAnimationFrame(handle));
  let plan = null, started = 0, handle = null, disposed = false;

  const tick = () => {
    handle = null;
    const state = sceneAt(plan, clock() - started);
    frame(state);
    if (!state.done) { handle = later(tick); return; }
    plan = null;
    done('finished');
  };

  return {
    get running() { return plan !== null; },

    // Start refuses an empty plan and refuses to run twice, so the page can send
    // the intent without checking first and still get one answer it can show.
    start(next) {
      if (disposed) throw new Error('replay: this controller is disposed');
      if (plan !== null) throw new Error('replay: already running');
      if (next.entries.length === 0) throw new RangeError('replay: there is nothing to replay');
      plan = next;
      started = clock();
      frame(sceneAt(plan, 0));
      handle = later(tick);
      return true;
    },

    // Stop, Escape and disposal all land here. It answers whether it stopped
    // anything, because stopping a controller that already finished is not an
    // error, it is just nothing.
    stop(reason = 'stopped') {
      if (plan === null) return false;
      if (handle !== null) stopWaiting(handle);
      handle = null;
      plan = null;
      done(reason);
      return true;
    },

    // Teardown cancels the frame without calling back into a page that is on its
    // way out.
    dispose() {
      disposed = true;
      if (handle !== null) stopWaiting(handle);
      handle = null;
      plan = null;
    },
  };
}
