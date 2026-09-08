// The page: the regions, the scope that interprets what the controls ask for,
// the effect adapters that change the document, and the subscription that turns
// a committed change back into pixels and control states.
//
// One action takes this route, and the order matters:
//
//   a control or the canvas raises an intent
//     the scope above it returns a plan whose only content is an effect request
//     the effect runs and asks the document to commit, undo, redo or replay
//     the document notifies
//     the subscriber updates the canvas region and the controls
//
// The interpreter proposes the effect and never touches the document, so the
// plan can be read without anything happening. The document validates again
// before it changes, because the scene it was asked about may have moved since.
// Undo, redo, replay and the history list are this example's code: domocracy
// has no history, and removing one of these controls would not take an inverse
// operation with it.
import { on, op, region } from 'domocracy';
import { effect, intent, scope } from 'domocracy/intent';
import {
  COLORS, applied, canRedo, canUndo, circleOf, clamp,
  createDocument, describeAction, initialHistory,
} from './scene.js';
import { createStage } from './canvas.js';
import { createReplay, replayPlan } from './replay.js';

// Effect names are this demo's, because an effect adapter is registered once for
// the whole page and a name like "commit" would be a claim on everybody's.
const COMMIT = 'canvas-demo.commit';
const HISTORY = 'canvas-demo.history';
const REPLAY = 'canvas-demo.replay';
const SAY = 'canvas-demo.say';

const NUDGE = 10;

// One adapter per effect type for the whole page, registered when the first demo
// mounts and removed when the last one goes. Which demo a request is for is in
// the request, because a second demo on the page shares these adapters and
// nothing about a global adapter says which instance asked.
const mounted = new Map();
let release = null;

function instanceOf(request) {
  const demo = mounted.get(request.instance);
  if (demo === undefined) throw new RangeError(`canvas-demo: no instance named ${JSON.stringify(request.instance)}`);
  return demo;
}

function registerEffects() {
  if (release !== null) return;
  const offs = [
    effect(COMMIT, request => instanceOf(request).commit(request.action)),
    effect(HISTORY, request => instanceOf(request).history(request.command)),
    effect(REPLAY, request => instanceOf(request).replay(request.command)),
    effect(SAY, request => instanceOf(request).say(request.message)),
  ];
  release = () => { for (const off of offs) off(); release = null; };
}

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const commandButton = (className, label, type, extra = {}) => {
  const node = element('button', className, label);
  node.type = 'button';
  node.dataset.intent = type;
  Object.assign(node.dataset, extra);
  return node;
};

let counter = 0;

export function mountCanvasHistoryDemo(root, options = {}) {
  const instance = options.instance ?? `canvas-demo-${++counter}`;
  // The name is how a global effect adapter finds the demo that asked, so two
  // demos sharing one name would send each other's edits to the wrong document.
  // Refused here, before anything is built, so a clash leaves no half-mounted
  // page behind.
  if (mounted.has(instance)) throw new RangeError(`canvas-demo: ${JSON.stringify(instance)} is already mounted`);
  const doc = createDocument(initialHistory());

  // ------------------------------------------------------------------ markup
  const demo = element('div', 'demo');
  demo.dataset.instance = instance;

  const stageHost = element('div', 'stage');
  const help = element('p', 'stage-help', 'Drag a circle to move it. Select one and use the nudge and colour buttons for the same edits from the keyboard.');
  help.id = `${instance}-help`;

  const panels = element('div', 'panels');
  const inspector = element('section', 'inspector');
  inspector.setAttribute('aria-label', 'Inspector');
  const picksHost = element('div', 'picks');
  picksHost.setAttribute('role', 'group');
  picksHost.setAttribute('aria-label', 'Select a circle');
  const nudgeHost = element('div', 'nudge');
  nudgeHost.setAttribute('role', 'group');
  nudgeHost.setAttribute('aria-label', 'Nudge the selected circle');
  for (const [label, name, dx, dy] of [['←', 'left', -1, 0], ['↑', 'up', 0, -1], ['↓', 'down', 0, 1], ['→', 'right', 1, 0]]) {
    const button = commandButton('nudge-button', label, 'scene:move', { dx: String(dx), dy: String(dy) });
    button.setAttribute('aria-label', `Nudge ${name}`);
    nudgeHost.append(button);
  }
  const swatchHost = element('div', 'swatches');
  swatchHost.setAttribute('role', 'group');
  swatchHost.setAttribute('aria-label', 'Colour the selected circle');
  const commands = element('div', 'commands');
  const undoButton = commandButton('command', 'Undo', 'history:undo');
  const redoButton = commandButton('command', 'Redo', 'history:redo');
  const replayButton = commandButton('command', 'Replay', 'replay:start');
  const stopButton = commandButton('command', 'Stop', 'replay:stop');
  commands.append(undoButton, redoButton, replayButton, stopButton);
  inspector.append(
    element('h3', null, 'Selection'), picksHost,
    element('h3', null, 'Nudge'), nudgeHost,
    element('h3', null, 'Colour'), swatchHost,
    element('h3', null, 'History'), commands,
  );

  const historyPanel = element('section', 'history');
  historyPanel.setAttribute('aria-label', 'History');
  historyPanel.append(element('h3', null, 'Committed edits'));
  const rowHost = element('ol', 'history-list');
  historyPanel.append(rowHost);

  panels.append(inspector, historyPanel);

  const statusHost = element('p', 'status');
  statusHost.setAttribute('role', 'status');

  demo.append(stageHost, help, panels, statusHost);
  root.append(demo);

  // ----------------------------------------------------------------- regions
  let selected = null, busy = false, dragging = false, replayRow = -1, returnFocusTo = null;

  const status = region(statusHost, {
    create: text => element('span', null, text),
    update: (node, text) => { node.textContent = text; },
  });
  status.insert(['Drag a circle, or select one and edit it from the keyboard.']);
  const say = message => { status.updateAt(0, message); return message; };

  const stage = createStage(stageHost, {
    scene: () => doc.get().scene,
    revision: () => doc.get().revision,
    busy: () => busy,
    select: id => select(id),
    dragging: active => { dragging = active; syncControls(); },
    render: presentation => stageRegion.update(stage.canvas, presentation),
    restore: () => render(),
    commit: (id, x, y) => raise(stage.canvas, 'scene:move', { id, x, y }),
  });
  const stageRegion = region(stageHost, stage.adapter);
  stageRegion.insert([{}]);
  stage.canvas.setAttribute('aria-describedby', help.id);

  const picks = region(picksHost, {
    create(spec) {
      const button = element('button', 'pick', spec.name);
      button.type = 'button';
      button.dataset.id = spec.id;
      button.setAttribute('aria-pressed', 'false');
      return button;
    },
    update(node, data) { node.setAttribute('aria-pressed', String(data.pressed)); },
  });
  picks.insert(doc.get().scene.circles.map(circle => ({ id: circle.id, name: circle.name })));

  const swatches = region(swatchHost, {
    create(color) {
      const button = element('button', 'swatch');
      button.type = 'button';
      button.dataset.color = color;
      button.style.background = color;
      button.setAttribute('aria-label', `Colour ${color}`);
      button.setAttribute('aria-pressed', 'false');
      return button;
    },
    update(node, data) { node.setAttribute('aria-pressed', String(data.pressed)); },
  });
  swatches.insert(COLORS);

  // The history list keeps a mirror, because the page asks it questions: which
  // row is undone, which row is playing. Everywhere else the DOM is the answer
  // and no mirror is worth its copy.
  const rows = region(rowHost, {
    create(item) {
      const row = element('li', 'history-row', item.text);
      row.dataset.state = item.state;
      return row;
    },
    update(node, item) {
      node.textContent = item.text;
      node.dataset.state = item.state;
    },
  }, { items: [] });

  // -------------------------------------------------------------- rendering
  const render = () => stageRegion.update(stage.canvas, { scene: doc.get().scene, selected });

  const syncControls = () => {
    const history = doc.get();
    const circle = selected === null ? null : circleOf(history.scene, selected);
    const frozen = busy || dragging;
    for (let i = 0; i < picks.length; i++) {
      const node = picks.nodes[i];
      const pressed = node.dataset.id === selected;
      if (node.getAttribute('aria-pressed') !== String(pressed)) picks.update(node, { pressed });
      node.disabled = frozen;
    }
    for (let i = 0; i < swatches.length; i++) {
      const node = swatches.nodes[i];
      const pressed = circle !== null && circle.color === node.dataset.color;
      if (node.getAttribute('aria-pressed') !== String(pressed)) swatches.update(node, { pressed });
      node.disabled = frozen || circle === null;
    }
    for (const node of nudgeHost.children) node.disabled = frozen || circle === null;
    undoButton.disabled = frozen || !canUndo(history);
    redoButton.disabled = frozen || !canRedo(history);
    replayButton.disabled = frozen || applied(history).length === 0;
    // Stop is the one control replay leaves alone.
    stopButton.disabled = !busy;
  };

  const rowText = (entry, ordinal) => `${ordinal}. ${describeAction(entry.action, entry.before)}`;

  const syncRowStates = () => {
    const history = doc.get();
    for (let i = 0; i < rows.length; i++) {
      const state = i === replayRow ? 'replaying' : i < history.cursor ? 'applied' : 'undone';
      if (rows.items[i].state !== state) rows.updateAt(i, { ...rows.items[i], state });
    }
  };

  // A commit after an undo drops the rows the redo tail held. The removal and
  // the new row are one group, so the list is validated and observed as the
  // single change it is.
  const syncRows = change => {
    if (change.kind === 'commit') {
      const history = change.history;
      const keep = change.previous.cursor;
      const entry = history.entries[history.entries.length - 1];
      const ops = [];
      if (rows.length > keep) ops.push(op.remove(Array.prototype.slice.call(rows.nodes, keep)));
      ops.push(op.insert(rowHost, null, [{ text: rowText(entry, history.entries.length), state: 'applied' }]));
      rows.execute(ops);
    }
    syncRowStates();
  };

  const select = id => {
    if (id === selected) return;
    selected = id;
    syncControls();
    render();
    const circle = circleOf(doc.get().scene, id);
    if (circle !== null) say(`${circle.name} selected, at (${circle.x}, ${circle.y}).`);
  };

  // ------------------------------------------------------------------ replay
  const player = createReplay({
    frame(state) {
      replayRow = state.index;
      stageRegion.update(stage.canvas, { scene: state.scene, selected });
      syncRowStates();
    },
    done(reason) {
      // Stop is about to be disabled, so focus goes back to the control that
      // held it when playback started, or to Replay when that control is gone.
      const returning = document.activeElement === stopButton;
      busy = false;
      replayRow = -1;
      syncRowStates();
      render();
      syncControls();
      if (returning) {
        const back = returnFocusTo !== null && returnFocusTo.isConnected && !returnFocusTo.disabled ? returnFocusTo : replayButton;
        if (!back.disabled) back.focus();
      }
      returnFocusTo = null;
      say(reason === 'finished' ? 'Replay finished. The scene on screen is the committed one again.' : 'Replay stopped. The committed scene is back.');
    },
  });

  // ----------------------------------------------------------------- effects
  // What the effect adapters call, once they know which demo the request names.
  const api = {
    say,
    commit(action) {
      const change = doc.commit(action);
      if (change.kind === 'noop') say(`${describeAction(action, change.history.scene)} changes nothing, so no entry was written.`);
      return change.kind;
    },
    history(command) {
      const change = command === 'undo' ? doc.undo() : command === 'redo' ? doc.redo() : null;
      if (change === null) throw new RangeError(`canvas-demo: unknown history command ${JSON.stringify(command)}`);
      say(`${command === 'undo' ? 'Undid' : 'Redid'} one edit. Revision ${change.history.revision}.`);
      return command;
    },
    replay(command) {
      if (command === 'start') {
        // Starting is all this reports. Whether playback finishes is the
        // controller's business and arrives later, on its own frames.
        player.start(replayPlan(doc.get()));
        const held = demo.contains(document.activeElement) ? document.activeElement : null;
        busy = true;
        syncControls();
        // A disabled control cannot keep focus: the browser hands it to the
        // body, and from there the Escape that stops playback reaches nothing
        // this page listens on. Stop is the control replay leaves enabled, so
        // it takes the focus and gives it back when playback ends.
        if (held !== null && held.disabled) {
          returnFocusTo = held;
          stopButton.focus();
        }
        say('Replaying the committed edits. Stop returns to the scene as it stands.');
        return 'started';
      }
      if (command === 'stop') {
        if (!player.stop('stopped')) throw new RangeError('canvas-demo: nothing is playing');
        return 'stopped';
      }
      throw new RangeError(`canvas-demo: unknown replay command ${JSON.stringify(command)}`);
    },
  };
  registerEffects();
  mounted.set(instance, api);

  // ------------------------------------------------------------------ scopes
  // The interpreters read and return plans. Each one proposes an effect and no
  // operations: the document is what changes, and the DOM follows from the
  // notification the change produces.
  const here = scope(demo);
  const refuse = message => ({ disposition: 'consume', effects: [{ type: SAY, instance, message }] });
  const commitPlan = action => ({ disposition: 'consume', effects: [{ type: COMMIT, instance, action }] });

  const handles = [
    here.handle('scene:move', raised => {
      if (busy) return refuse('Replay is running. Stop it before editing.');
      const { id, x, y } = raised.args ?? {};
      if (typeof id !== 'string') return refuse('Select a circle first.');
      if (!Number.isFinite(x) || !Number.isFinite(y)) return refuse('That move has no position.');
      return commitPlan({ kind: 'move', id, x, y });
    }),
    here.handle('scene:color', raised => {
      if (busy) return refuse('Replay is running. Stop it before editing.');
      const { id, color } = raised.args ?? {};
      if (typeof id !== 'string') return refuse('Select a circle first.');
      return commitPlan({ kind: 'color', id, color });
    }),
    here.handle('history:undo', () => busy ? refuse('Replay is running. Stop it first.')
      : { disposition: 'consume', effects: [{ type: HISTORY, instance, command: 'undo' }] }),
    here.handle('history:redo', () => busy ? refuse('Replay is running. Stop it first.')
      : { disposition: 'consume', effects: [{ type: HISTORY, instance, command: 'redo' }] }),
    here.handle('replay:start', () => ({ disposition: 'consume', effects: [{ type: REPLAY, instance, command: 'start' }] })),
    here.handle('replay:stop', () => ({ disposition: 'consume', effects: [{ type: REPLAY, instance, command: 'stop' }] })),
  ];

  // An effect that fails leaves the document alone and says so where the reader
  // can see it, which is the whole failure story for these commands.
  const raise = (source, type, args) => {
    const result = intent(source, type, args);
    const failed = result.effects.find(outcome => outcome.status === 'failed');
    if (failed !== undefined) say(`${type} was refused: ${failed.error.message}`);
    return result;
  };

  // ---------------------------------------------------------------- handlers
  const offs = [
    on(demo, 'click', '.pick', (event, node) => select(node.dataset.id)),
    on(demo, 'click', '.swatch', (event, node) => raise(node, 'scene:color', { id: selected, color: node.dataset.color })),
    on(demo, 'click', '.nudge-button', (event, node) => {
      const circle = selected === null ? null : circleOf(doc.get().scene, selected);
      if (circle === null) return;
      const next = clamp(circle.x + Number(node.dataset.dx) * NUDGE, circle.y + Number(node.dataset.dy) * NUDGE);
      raise(node, 'scene:move', { id: circle.id, x: next.x, y: next.y });
    }),
    on(demo, 'click', '.command', (event, node) => raise(node, node.dataset.intent)),
    on(demo, 'keydown', '.demo', event => {
      // The canvas has already had its Escape if a drag was running.
      if (event.key !== 'Escape' || event.defaultPrevented || !busy) return;
      event.preventDefault();
      raise(stopButton, 'replay:stop');
    }),
    doc.subscribe(change => {
      // A document that changes under a drag invalidates the preview: it was
      // drawn against a scene that is no longer the document's.
      if (dragging) stage.cancel();
      syncRows(change);
      render();
      syncControls();
    }),
  ];

  render();
  syncControls();
  stage.resize();

  return {
    element: demo,
    instance,
    document: doc,
    get canvas() { return stage.canvas; },
    get replaying() { return busy; },
    dispose() {
      player.dispose();
      stage.dispose();
      for (const off of offs) off();
      for (const off of handles) off();
      here.dispose();
      // Only this demo's own registration, so a later mount under the same name
      // is not unregistered by a disposal that arrives after it.
      if (mounted.get(instance) === api) mounted.delete(instance);
      if (mounted.size === 0 && release !== null) release();
      demo.remove();
    },
  };
}
