// The document this example edits, and the list of edits made to it.
//
// A scene is three circles with stable ids. An action is one edit to one circle,
// named by id and never by position on screen. A history holds the scene the
// page started from, the entries committed since, and the cursor saying how many
// of them currently apply. Every value here is frozen and every function that
// changes one returns a new value, so an entry can keep the scene before an edit
// and the scene after it without either of them changing later.
//
// Nothing here touches the DOM, which is what lets the whole model run under
// `node --test`. domocracy contributes nothing to it either: undo, redo, the
// revision counter and the snapshots are this example's code. The library moves
// and updates DOM nodes, and has no opinion about what a document is.
//
// The snapshots are whole scenes because this document is three circles. A real
// editor would store an inverse per action; this one deliberately does not,
// because a generic inverse-operation engine is the thing the example is trying
// not to smuggle in.

const freeze = Object.freeze;

// The logical coordinate system. The canvas is scaled to it, so a committed
// position means the same thing at any canvas size or pixel ratio.
export const BOUNDS = freeze({ width: 640, height: 400 });
export const RADIUS = 34;

// The colours the inspector offers. Any other well-formed colour is accepted by
// the model; the palette is the page's vocabulary, not the document's.
export const COLORS = freeze(['#2f6fed', '#e0562d', '#1a7f37', '#8250df', '#3a3f4b']);

const HEX = /^#[0-9a-f]{6}$/i;

const sceneOf = circles => freeze({ circles: freeze(circles.map(freeze)) });

// The fixture every run starts from, so a reader comparing two runs compares the
// same numbers.
export function initialScene() {
  return sceneOf([
    { id: 'ash', name: 'Ash', x: 150, y: 140, color: COLORS[0] },
    { id: 'birch', name: 'Birch', x: 320, y: 250, color: COLORS[1] },
    { id: 'cedar', name: 'Cedar', x: 490, y: 140, color: COLORS[2] },
  ]);
}

export function circleOf(scene, id) {
  return scene.circles.find(circle => circle.id === id) ?? null;
}

// A centre the circle stays inside the scene at, rounded so that a committed
// position is an integer and two runs of the same drag agree.
export function clamp(x, y) {
  const inside = (value, limit) => Math.round(Math.min(Math.max(value, RADIUS), limit - RADIUS));
  return { x: inside(x, BOUNDS.width), y: inside(y, BOUNDS.height) };
}

// The checks the document runs before it changes. The scope interpreter checks
// the shape of what a control asked for; this is the check that decides whether
// the document accepts it, and it runs again here because the interpreter read a
// scene that may have moved since.
export function validateAction(scene, action) {
  if (action === null || typeof action !== 'object') throw new TypeError('scene: an action must be an object');
  const circle = circleOf(scene, action.id);
  if (circle === null) throw new RangeError(`scene: no circle with the id ${JSON.stringify(action.id)}`);
  if (action.kind === 'move') {
    const { x, y } = action;
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('scene: a move needs finite coordinates');
    if (x < RADIUS || y < RADIUS || x > BOUNDS.width - RADIUS || y > BOUNDS.height - RADIUS) {
      throw new RangeError(`scene: (${x}, ${y}) puts ${circle.name} outside the scene`);
    }
    return circle;
  }
  if (action.kind === 'color') {
    if (typeof action.color !== 'string' || !HEX.test(action.color)) throw new TypeError(`scene: ${JSON.stringify(action.color)} is not a #rrggbb colour`);
    return circle;
  }
  throw new TypeError(`scene: unknown action ${JSON.stringify(action.kind)}`);
}

// A move to the position a circle already holds and a colour it already has
// change nothing, so they commit nothing and leave the history alone.
export function isNoop(scene, action) {
  const circle = circleOf(scene, action.id);
  if (circle === null) return false;
  if (action.kind === 'move') return circle.x === action.x && circle.y === action.y;
  if (action.kind === 'color') return circle.color === action.color;
  return false;
}

export function applyAction(scene, action) {
  validateAction(scene, action);
  const changed = circle => circle.id !== action.id ? circle
    : action.kind === 'move' ? { ...circle, x: action.x, y: action.y }
    : { ...circle, color: action.color };
  return sceneOf(scene.circles.map(changed));
}

export function describeAction(action, scene) {
  const circle = circleOf(scene, action.id);
  const name = circle === null ? action.id : circle.name;
  return action.kind === 'move' ? `${name} to (${action.x}, ${action.y})` : `${name} in ${action.color}`;
}

export function initialHistory(scene = initialScene()) {
  return freeze({ initial: scene, scene, entries: freeze([]), cursor: 0, revision: 0 });
}

export const canUndo = history => history.cursor > 0;
export const canRedo = history => history.cursor < history.entries.length;

// The entries that currently apply: everything before the cursor. Replay shows
// these and nothing else, so an undone edit is not replayed.
export const applied = history => history.entries.slice(0, history.cursor);

// A commit truncates whatever undo had left ahead of the cursor, which is what
// makes the history a list of edits rather than a tree of them.
export function commit(history, action) {
  validateAction(history.scene, action);
  if (isNoop(history.scene, action)) return history;
  const before = history.scene;
  const after = applyAction(before, action);
  const entry = freeze({ action: freeze({ ...action }), before, after });
  const entries = freeze(history.entries.slice(0, history.cursor).concat([entry]));
  return freeze({ initial: history.initial, scene: after, entries, cursor: entries.length, revision: history.revision + 1 });
}

// Undo restores the scene the preceding entry recorded as its before, and redo
// restores the next entry's after. Both advance the revision: the document has
// changed again, and code holding a revision from before wants to hear that,
// whichever direction the change went.
export function undo(history) {
  if (!canUndo(history)) throw new RangeError('history: there is nothing to undo');
  const entry = history.entries[history.cursor - 1];
  return freeze({ ...history, scene: entry.before, cursor: history.cursor - 1, revision: history.revision + 1 });
}

export function redo(history) {
  if (!canRedo(history)) throw new RangeError('history: there is nothing to redo');
  const entry = history.entries[history.cursor];
  return freeze({ ...history, scene: entry.after, cursor: history.cursor + 1, revision: history.revision + 1 });
}

// The document as the page holds it: one current history value, three ways to
// change it, and subscribers who hear what changed. A change is a value too, so
// the subscriber that redraws and the subscriber that writes a status line read
// the same record and neither has to diff anything.
export function createDocument(history = initialHistory()) {
  let current = history;
  let observers = [];
  const notify = change => { for (const observer of observers.slice()) observer(change); };
  const change = (kind, next, action) => {
    const record = freeze({ kind, action: action ?? null, previous: current, history: next });
    current = next;
    notify(record);
    return record;
  };
  return {
    get() { return current; },
    commit(action) {
      const next = commit(current, action);
      // A no-op is not a failure and not a change: nobody is notified and the
      // revision stands, so a drag that ends where it started adds no entry.
      if (next === current) return freeze({ kind: 'noop', action, previous: current, history: current });
      return change('commit', next, action);
    },
    undo() { return change('undo', undo(current), null); },
    redo() { return change('redo', redo(current), null); },
    subscribe(observer) {
      observers = observers.concat([observer]);
      return () => { observers = observers.filter(other => other !== observer); };
    },
  };
}
