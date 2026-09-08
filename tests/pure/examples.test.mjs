// The two example models without a browser: the scene document the canvas
// example edits, and the replay evaluation that plays its history back.
//
// Both are plain values and pure functions, which is the point of keeping them
// out of the DOM code. What a browser has to answer for is pointer capture,
// focus, layout and pixels, and those are in tests/examples.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOUNDS, RADIUS, applied, applyAction, canRedo, canUndo, circleOf, clamp, commit,
  createDocument, describeAction, initialHistory, initialScene, isNoop, redo, undo, validateAction,
} from '../../examples/canvas-history/scene.js';
import { STEP, createReplay, replayPlan, sceneAt } from '../../examples/canvas-history/replay.js';

const move = (id, x, y) => ({ kind: 'move', id, x, y });
const color = (id, value) => ({ kind: 'color', id, color: value });
const positionOf = (scene, id) => { const circle = circleOf(scene, id); return [circle.x, circle.y]; };

test('the initial scene is the same three circles every time, and it is frozen', () => {
  const one = initialScene(), two = initialScene();
  assert.deepEqual(one, two);
  assert.ok(Object.isFrozen(one));
  assert.ok(Object.isFrozen(one.circles));
  assert.ok(Object.isFrozen(one.circles[0]));
  assert.equal(circleOf(one, 'nothing'), null);
});

test('an action names a circle that exists, a finite position inside the scene, and a colour', () => {
  const scene = initialScene();
  assert.throws(() => validateAction(scene, move('nope', 100, 100)), RangeError);
  assert.throws(() => validateAction(scene, move('ash', Number.NaN, 100)), TypeError);
  assert.throws(() => validateAction(scene, move('ash', 5, 100)), RangeError);
  assert.throws(() => validateAction(scene, move('ash', 100, BOUNDS.height)), RangeError);
  assert.throws(() => validateAction(scene, color('ash', 'red')), TypeError);
  assert.throws(() => validateAction(scene, { kind: 'rotate', id: 'ash' }), TypeError);
  assert.throws(() => validateAction(scene, null), TypeError);
  assert.equal(validateAction(scene, move('ash', 100, 100)).id, 'ash');
});

test('a centre is clamped to the scene and rounded, whatever the pointer said', () => {
  assert.deepEqual(clamp(-40, -40), { x: RADIUS, y: RADIUS });
  assert.deepEqual(clamp(9999, 9999), { x: BOUNDS.width - RADIUS, y: BOUNDS.height - RADIUS });
  assert.deepEqual(clamp(100.4, 100.6), { x: 100, y: 101 });
});

test('applying an action leaves the scene it was applied to alone', () => {
  const scene = initialScene();
  const next = applyAction(scene, move('ash', 200, 200));
  assert.deepEqual(positionOf(scene, 'ash'), [150, 140]);
  assert.deepEqual(positionOf(next, 'ash'), [200, 200]);
  assert.equal(circleOf(next, 'birch'), circleOf(scene, 'birch'));
});

test('a commit records the scene before it and the scene after it, both frozen', () => {
  const history = commit(initialHistory(), move('ash', 200, 200));
  const [entry] = history.entries;
  assert.equal(history.entries.length, 1);
  assert.equal(history.cursor, 1);
  assert.equal(history.revision, 1);
  assert.ok(Object.isFrozen(entry.before) && Object.isFrozen(entry.after));
  assert.deepEqual(entry.before, initialScene());
  assert.equal(history.scene, entry.after);
  // A later commit does not reach back into the entry the first one wrote.
  const later = commit(history, color('ash', '#1a7f37'));
  assert.deepEqual(later.entries[0], entry);
});

test('a move to the same place and a colour a circle already has write nothing', () => {
  const history = initialHistory();
  const ash = circleOf(history.scene, 'ash');
  assert.ok(isNoop(history.scene, move('ash', ash.x, ash.y)));
  assert.ok(isNoop(history.scene, color('ash', ash.color)));
  assert.ok(!isNoop(history.scene, move('ash', ash.x + 1, ash.y)));
  assert.ok(!isNoop(history.scene, { kind: 'rotate', id: 'ash' }));
  assert.ok(!isNoop(history.scene, move('nope', 1, 1)));
  assert.equal(commit(history, move('ash', ash.x, ash.y)), history);
  assert.equal(commit(history, color('ash', ash.color)), history);
});

test('undo and redo walk the entries and refuse to walk past the ends', () => {
  let history = initialHistory();
  history = commit(history, move('ash', 200, 200));
  history = commit(history, color('birch', '#8250df'));
  const final = history.scene;

  assert.ok(canUndo(history) && !canRedo(history));
  const undone = undo(undo(history));
  assert.deepEqual(undone.scene, initialScene());
  assert.equal(undone.cursor, 0);
  assert.ok(!canUndo(undone) && canRedo(undone));
  assert.throws(() => undo(undone), RangeError);

  const redone = redo(redo(undone));
  assert.deepEqual(redone.scene, final);
  assert.equal(redone.cursor, 2);
  assert.throws(() => redo(redone), RangeError);

  // Four moves through the list, and the revision counted every one of them.
  assert.equal(redone.revision, 6);
  assert.deepEqual(redone.entries, history.entries);
});

test('a commit after an undo drops the redo tail', () => {
  let history = initialHistory();
  history = commit(history, move('ash', 200, 200));
  history = commit(history, move('birch', 100, 100));
  const branched = commit(undo(history), color('cedar', '#3a3f4b'));
  assert.equal(branched.entries.length, 2);
  assert.equal(branched.cursor, 2);
  assert.ok(!canRedo(branched));
  assert.equal(branched.entries[1].action.kind, 'color');
  assert.deepEqual(positionOf(branched.scene, 'birch'), positionOf(initialScene(), 'birch'));
});

test('applied entries are the ones before the cursor, and describe says what they were', () => {
  let history = initialHistory();
  history = commit(history, move('ash', 200, 200));
  history = commit(history, color('birch', '#8250df'));
  assert.equal(applied(history).length, 2);
  assert.equal(applied(undo(history)).length, 1);
  assert.equal(describeAction(move('ash', 200, 200), history.scene), 'Ash to (200, 200)');
  assert.equal(describeAction(color('birch', '#8250df'), history.scene), 'Birch in #8250df');
  assert.equal(describeAction(move('gone', 1, 2), history.scene), 'gone to (1, 2)');
});

test('the document notifies what changed and says nothing for a no-op', () => {
  const doc = createDocument();
  const seen = [];
  const off = doc.subscribe(change => seen.push(change.kind));
  const ash = circleOf(doc.get().scene, 'ash');

  assert.equal(doc.commit(move('ash', 200, 200)).kind, 'commit');
  assert.equal(doc.commit(move('ash', 200, 200)).kind, 'noop');
  assert.equal(doc.undo().kind, 'undo');
  assert.equal(doc.redo().kind, 'redo');
  assert.deepEqual(seen, ['commit', 'undo', 'redo']);
  assert.equal(doc.get().revision, 3);
  assert.deepEqual(positionOf(doc.get().scene, 'ash'), [200, 200]);

  off();
  doc.commit(move('ash', ash.x, ash.y));
  assert.equal(seen.length, 3);
  assert.throws(() => doc.commit(move('nope', 100, 100)), RangeError);
  assert.throws(() => doc.redo(), RangeError);
  assert.equal(doc.get().revision, 4);
});

// The plan a replay runs, built from two committed edits.
function played() {
  let history = initialHistory();
  history = commit(history, move('ash', 250, 300));
  history = commit(history, color('birch', '#8250df'));
  return { history, plan: replayPlan(history) };
}

test('a replay plan holds the applied prefix and nothing after the cursor', () => {
  const { history } = played();
  assert.equal(replayPlan(history).entries.length, 2);
  assert.equal(replayPlan(history).duration, 2 * STEP);
  assert.equal(replayPlan(undo(history)).entries.length, 1);
  assert.equal(replayPlan(initialHistory()).entries.length, 0);
});

test('the scene at a moment is a function of that moment alone', () => {
  const { plan } = played();
  const start = sceneAt(plan, 0);
  assert.equal(start.index, 0);
  assert.equal(start.done, false);
  assert.deepEqual(positionOf(start.scene, 'ash'), [150, 140]);

  // A move is interpolated between its endpoints.
  const half = sceneAt(plan, STEP / 2);
  assert.deepEqual(positionOf(half.scene, 'ash'), [200, 220]);

  // A colour change applies at the boundary of its own entry, by which time the
  // move before it has finished.
  const second = sceneAt(plan, STEP);
  assert.equal(second.index, 1);
  assert.deepEqual(positionOf(second.scene, 'ash'), [250, 300]);
  assert.equal(circleOf(second.scene, 'birch').color, '#8250df');

  // Skipping frames costs nothing: the answer at a time is the same whether or
  // not anything asked for the times before it.
  assert.deepEqual(sceneAt(plan, STEP * 1.5), sceneAt(plan, STEP * 1.5));
  const end = sceneAt(plan, STEP * 40);
  assert.equal(end.done, true);
  assert.equal(end.index, 1);
  assert.deepEqual(end.scene, played().history.scene);
  // Negative time is the start, which is what a clock that jumps backwards gets.
  assert.deepEqual(sceneAt(plan, -100).scene, start.scene);
});

test('an empty plan is finished before it starts', () => {
  const plan = replayPlan(initialHistory());
  const state = sceneAt(plan, 0);
  assert.equal(state.done, true);
  assert.equal(state.index, -1);
  assert.deepEqual(state.scene, initialScene());
});

// The controller with its clock and its scheduler supplied, so a frame happens
// when this test says it does.
function controller() {
  const frames = [], reasons = [];
  let time = 0, queued = null, cancelled = 0;
  const player = createReplay({
    frame: state => frames.push(state),
    done: reason => reasons.push(reason),
    now: () => time,
    schedule: fn => { queued = fn; return 'handle'; },
    cancel: handle => { cancelled++; assert.equal(handle, 'handle'); queued = null; },
  });
  return {
    player, frames, reasons,
    at(next) { time = next; const fn = queued; queued = null; fn(); },
    get waiting() { return queued !== null; },
    get cancelled() { return cancelled; },
  };
}

test('the replay loop draws the frame it is asked for and finishes once', () => {
  const { plan } = played();
  const run = controller();
  assert.equal(run.player.start(plan), true);
  assert.equal(run.player.running, true);
  assert.equal(run.frames.length, 1);
  assert.throws(() => run.player.start(plan), /already running/);

  run.at(STEP / 2);
  assert.equal(run.frames.length, 2);
  assert.equal(run.frames[1].index, 0);
  assert.ok(run.waiting);

  // One long frame gap lands past the end, and the last frame drawn is the
  // final scene rather than wherever a step counter would have reached.
  run.at(STEP * 9);
  assert.deepEqual(run.frames.at(-1).scene, played().history.scene);
  assert.deepEqual(run.reasons, ['finished']);
  assert.equal(run.player.running, false);
  assert.equal(run.waiting, false);
});

test('stopping cancels the frame, and stopping twice is not an error', () => {
  const { plan } = played();
  const run = controller();
  run.player.start(plan);
  assert.equal(run.player.stop(), true);
  assert.equal(run.cancelled, 1);
  assert.equal(run.player.running, false);
  assert.deepEqual(run.reasons, ['stopped']);
  assert.equal(run.player.stop(), false);
  assert.deepEqual(run.reasons, ['stopped']);
});

test('a replay controller refuses an empty plan and refuses to run after disposal', () => {
  const run = controller();
  assert.throws(() => run.player.start(replayPlan(initialHistory())), RangeError);
  run.player.start(played().plan);
  run.player.dispose();
  assert.equal(run.cancelled, 1);
  assert.equal(run.player.running, false);
  assert.deepEqual(run.reasons, []);
  assert.throws(() => run.player.start(played().plan), /disposed/);
});
