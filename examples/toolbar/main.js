// The page: the dock, the four rooms, the travel between them, the status line
// and the two panels. This file is where the intents get their outer meaning
// and where the effects are run.
//
// The route an action takes:
//
//   a button in the toolbar raises an intent
//     the rooms above it answer, nearest first, each with a plan
//     the plans run as one sequence, then the effects
//     the toolbar reports what happened and the log shows it
//
// The rehearsal panel takes the first two steps and stops: it calls `interpret`,
// which is the half of `intent` that writes nothing, and shows the answer room
// by room. When the button is pressed, `intent` interprets again, because the
// tree may have changed since the panel asked.
import { on, op, region } from 'domocracy';
import { effect } from 'domocracy/intent';
import { createToolbar } from './toolbar.js';
import { SLOT, createBoard, createDialog, createForm, createListbox } from './rooms.js';
import { describe, explain, nameOf, raise, rehearse, room } from './scopes.js';

// Effect names are this demo's: an adapter is registered once for the whole
// page, and a name like "say" would be a claim on everybody's.
const SAY = 'toolbar-demo.say';
const TALLY = 'toolbar-demo.tally';

const KEEP = 8;   // log rows

const MEANING = {
  dock: 'Nothing answers here.',
  form: 'Apply commits the fields and Cancel reverts them.',
  listbox: 'Up, Down and Remove act on the selected option.',
  dialog: 'Apply confirms and Cancel dismisses.',
  board: 'Apply ticks the card, Up and Down move it, Remove takes it.',
};

const VERDICT = {
  consume: 'consume: adds its contribution and stops the collection. What nearer rooms added stays.',
  continue: 'continue: adds its contribution and lets the next room add more',
  pass: 'pass: proposes nothing and lets the next room answer',
  skipped: 'not asked: no interpreter for this intent here',
  unreached: 'not reached: a nearer room consumed',
};

const SHORT = { consume: 'consume', continue: 'continue', pass: 'pass', skipped: 'no interpreter', unreached: 'unreached' };

// What a plan does to a node, as the word the highlight uses. A node can
// collect more than one.
const ROLE = { moves: 'moves', receives: 'receives', changes: 'changes', leaves: 'leaves', empties: 'empties' };

// One adapter per effect type for the whole page, registered when the first
// demo mounts and removed when the last goes. The request names its instance,
// because nothing about a global adapter says which demo asked.
const mounted = new Map();
let release = null;
let counter = 0;

function instanceOf(request) {
  const demo = mounted.get(request.instance);
  if (demo === undefined) throw new RangeError(`toolbar-demo: no instance named ${JSON.stringify(request.instance)}`);
  return demo;
}

function registerEffects() {
  if (release !== null) return;
  const offs = [
    effect(SAY, request => instanceOf(request).say(request.text)),
    effect(TALLY, request => instanceOf(request).tally()),
  ];
  release = () => { for (const off of offs) off(); release = null; };
}

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function mountToolbarDemo(root, options = {}) {
  const instance = options.instance ?? `toolbar-demo-${++counter}`;
  if (mounted.has(instance)) throw new RangeError(`toolbar-demo: ${JSON.stringify(instance)} is already mounted`);
  const say = text => ({ type: SAY, instance, text });
  const tally = () => ({ type: TALLY, instance });

  // ------------------------------------------------------------------ markup
  const demo = element('div', 'toolbar-demo');
  demo.dataset.instance = instance;

  // The dock is the toolbar's home: a slot with no room around it. The region
  // adopts the toolbar as the child it already has.
  const dockHost = element('div', 'dock');
  dockHost.dataset.label = 'the dock';
  const toolbar = createToolbar();
  dockHost.append(toolbar.element);
  region(dockHost, SLOT);

  const rooms = {
    form: createForm({ say }),
    listbox: createListbox({ say }),
    dialog: createDialog({ say }),
    board: createBoard({ say, tally, home: dockHost }),
  };
  const stops = [
    { key: 'dock', name: 'Dock', element: dockHost, slotFor: () => dockHost },
    ...Object.entries(rooms).map(([key, each]) => ({ key, name: each.name, element: each.element, slotFor: source => each.slotFor(source) })),
  ];

  const places = element('div', 'places');
  places.setAttribute('role', 'group');
  places.setAttribute('aria-label', 'Where the toolbar is');
  places.append(element('span', 'places-label', 'Toolbar in:'));
  for (const stop of stops) {
    const button = element('button', 'place', stop.name);
    button.type = 'button';
    button.dataset.intent = 'toolbar:go';
    button.dataset.room = stop.key;
    button.setAttribute('aria-pressed', 'false');
    places.append(button);
  }

  const grid = element('div', 'rooms');
  grid.append(rooms.form.element, rooms.listbox.element, rooms.dialog.element, rooms.board.element);

  const statusHost = element('p', 'status');
  statusHost.setAttribute('role', 'status');

  const panels = element('div', 'panels');
  const rehearsalPanel = element('section', 'panel rehearsal');
  rehearsalPanel.setAttribute('aria-label', 'What a control would do');
  const head = element('p', 'rehearsal-head');
  const answersHost = element('ol', 'answers');
  const check = element('p', 'rehearsal-check');
  const legend = element('p', 'legend');
  for (const [word, kind] of [['answered', 'route'], ['no interpreter', 'route-off'], ['moves', 'moves'], ['receives', 'receives'], ['changes', 'changes'], ['leaves', 'leaves']]) {
    const key = element('span', 'legend-key', word);
    key.dataset.kind = kind;
    legend.append(key);
  }
  rehearsalPanel.append(element('h3', null, 'What this control would do'), head, answersHost, check, legend);
  const logPanel = element('section', 'panel log');
  logPanel.setAttribute('aria-label', 'What happened');
  const resultsHost = element('ol', 'results');
  logPanel.append(element('h3', null, 'What happened'), resultsHost);
  panels.append(rehearsalPanel, logPanel);

  demo.append(dockHost, places, grid, statusHost, panels);
  root.append(demo);

  // ----------------------------------------------------------------- regions
  const status = region(statusHost, {
    create: text => element('span', null, text),
    update: (node, text) => { node.textContent = text; },
  });
  status.insert(['The toolbar is in the dock, where nothing answers it. Move it into a room.']);

  const answers = region(answersHost, {
    create(answer) {
      const row = element('li', 'answer');
      row.dataset.state = answer.state;
      row.append(element('span', 'answer-room', answer.name), element('span', 'answer-verdict', VERDICT[answer.state]));
      // The plan's own words, read from the plan the trace kept.
      if (typeof answer.plan?.refused === 'string') row.append(element('span', 'answer-refused', `refuses: ${answer.plan.refused}`));
      else if (typeof answer.plan?.meaning === 'string') row.append(element('span', 'answer-meaning', `would: ${answer.plan.meaning}`));
      if (answer.operations !== undefined) {
        const plan = element('ul', 'answer-plan');
        for (const o of answer.operations) plan.append(element('li', 'answer-op', describe(o)));
        for (const e of answer.effects) plan.append(element('li', 'answer-effect', `effect ${e.type}${typeof e.text === 'string' ? `: “${e.text}”` : ''}`));
        if (plan.children.length > 0) row.append(plan);
      }
      return row;
    },
  });

  const results = region(resultsHost, {
    create(entry) {
      const row = element('li', 'result', entry.text);
      row.dataset.state = entry.state;
      return row;
    },
  });

  // --------------------------------------------------------------- rehearsal
  // Which intent a control raises, read from the control itself. The place
  // buttons carry their argument in data-room.
  const intentOf = control => control.dataset.intent === undefined ? null
    : { type: control.dataset.intent, args: control.dataset.room === undefined ? undefined : { room: control.dataset.room } };

  const labelOf = control => control.getAttribute('aria-label') ?? control.textContent.trim();

  // The highlight in place: `data-route` on each scope of the route with what
  // it did, and `data-affected` on each node a plan names with what would
  // happen to it. Both are presentation the page writes and clears before the
  // next rehearsal; no interpreter reads them, and a region does not own the
  // attributes of its children, only their order and their lifetime.
  const unmark = () => {
    // The page's own scope is the demo root, which a query from the root does
    // not return.
    for (const node of [demo, ...demo.querySelectorAll('[data-route], [data-affected]')]) {
      node.removeAttribute('data-route');
      node.removeAttribute('data-affected');
    }
  };
  const affect = (node, role) => {
    if (node === null || !demo.contains(node)) return;
    const held = node.getAttribute('data-affected');
    node.setAttribute('data-affected', held === null ? role : `${held} ${role}`);
  };
  const mark = (rehearsed) => {
    unmark();
    const seen = rehearsed.interpreted;
    if (seen === null) return;
    seen.route.forEach((scopeElement, i) => scopeElement.setAttribute('data-route', rehearsed.answers[i].state));
    for (const o of seen.operations) {
      switch (o.op) {
        case 'move': affect(o.entity, ROLE.moves); affect(o.region, ROLE.receives); break;
        case 'insert': affect(o.region, ROLE.receives); break;
        case 'update': affect(o.entity, ROLE.changes); break;
        case 'remove': for (const node of o.entities) affect(node, ROLE.leaves); break;
        case 'clear': affect(o.region, ROLE.empties); break;
      }
    }
  };

  // The route as one line: each room, what it did, and how much it added.
  const summary = answers => answers.map(answer => {
    const added = answer.operations === undefined ? [] : [
      ...(answer.operations.length > 0 ? [plural(answer.operations.length, 'operation')] : []),
      ...(answer.effects.length > 0 ? [plural(answer.effects.length, 'effect')] : []),
    ];
    return `${answer.name}: ${SHORT[answer.state]}${added.length > 0 ? ` (${added.join(', ')})` : ''}`;
  }).join(' → ');

  const showNothing = () => {
    head.textContent = 'Hover or focus a control to see what it would do.';
    check.textContent = '';
    answers.clear();
    unmark();
  };

  const show = control => {
    const asked = intentOf(control);
    const rehearsed = rehearse(control, asked.type, asked.args);
    const seen = rehearsed.interpreted;
    head.textContent = seen === null
      ? `“${labelOf(control)}” would raise ${asked.type}, and interpreting it failed.`
      : seen.route.length === 0
        ? `“${labelOf(control)}” would raise ${asked.type}, and no scope is above it: the intent would pass with nobody answering.`
        : `“${labelOf(control)}” would raise ${asked.type}. ${summary(rehearsed.answers)}.`;
    // One group: the old rows go and the new ones arrive as a single change.
    answers.execute([op.clear(answersHost), op.insert(answersHost, null, rehearsed.answers)]);
    check.textContent = seen === null
      ? `The intent would be refused before anything ran: ${rehearsed.error.message}`
      : seen.route.length === 0 ? ''
        : `${plural(seen.operations.length, 'operation')} and ${plural(seen.effects.length, 'effect')}, checked as one sequence: it would run. Nothing has.`;
    mark(rehearsed);
  };

  let previewed = null, stale = true;
  const preview = control => {
    if (control === previewed && !stale) return;
    previewed = control;
    stale = false;
    show(control);
  };

  // --------------------------------------------------------------------- log
  // The log counts what was raised here. The library numbers every
  // interpretation, and the captions and the panel interpret constantly, so
  // its ids are not a count of anything a reader did.
  let logged = 0;
  const report = ({ type, result, error }) => {
    let entry;
    if (error !== undefined) {
      entry = { state: 'error', text: `#${++logged} ${type} failed: ${error.message} ${error.committed === undefined ? 'Nothing ran.' : `${plural(error.committed, 'operation')} ran before it.`}` };
    } else {
      const trace = result.trace.map(each => `${nameOf(each.scope) ?? 'a scope'}: ${each.disposition}`).join(', ');
      const effects = result.effects.map(each => `${each.type} ${each.status}${each.status === 'failed' ? ` (${each.error.message})` : ''}`).join(', ');
      entry = { state: result.disposition, text: `#${++logged} ${type} → ${result.disposition}. ${trace || 'Nobody answered'}. ${plural(result.operations.length, 'operation')} ran${effects ? `; effects: ${effects}` : ''}.` };
    }
    // The newest row goes first and the oldest go, as one group.
    const group = [op.insert(resultsHost, resultsHost.firstElementChild, [entry])];
    if (results.length >= KEEP) group.push(op.remove(Array.prototype.slice.call(results.nodes, KEEP - 1)));
    results.execute(group);
  };

  // ------------------------------------------------------------------ travel
  const stopOf = () => stops.find(stop => stop.element.contains(toolbar.element)) ?? null;

  // Where the toolbar goes for a request raised from `source`: the room's one
  // slot, or on the board the slot of the card the request came from. The
  // page's plans follow the rooms' conventions: a meaning, or a refusal.
  const refuse = text => ({ disposition: 'consume', refused: text, effects: [say(text)] });
  const travel = (stop, source) => {
    if (stop === null) return refuse('There is no such room.');
    const slot = stop.slotFor(source);
    if (slot === null) return refuse(`The ${stop.name} has no card to hold the toolbar. Add one first.`);
    if (toolbar.element.parentElement === slot) return refuse(`The toolbar is already in the ${stop.name}.`);
    const where = stop.key === 'board' && source !== null && stop.element.contains(source) ? `“${slot.parentElement.dataset.label}”` : `the ${stop.name}`;
    return {
      disposition: 'consume',
      meaning: `Put the toolbar in ${where}`,
      operations: [op.move(toolbar.element, slot, null)],
      effects: [say(`The toolbar is in the ${stop.name}. ${MEANING[stop.key]}`)],
    };
  };

  // The page is the outermost room. The rooms have no interpreter for travel,
  // so an intent from the Next room button walks up through them to here.
  const page = room(demo, 'Page', {
    'toolbar:next': () => {
      const here = stops.indexOf(stopOf());
      for (let k = 1; k <= stops.length; k++) {
        const stop = stops[(here + k) % stops.length];
        if (stop.slotFor(null) !== null) return travel(stop, null);
      }
      return refuse('Nowhere to go.');
    },
    // The same argument from the place strip and from a card's own button; the
    // source says which card, when it is in one.
    'toolbar:go': raised => travel(stops.find(stop => stop.key === raised.args?.room) ?? null, raised.source),
  });

  // Every raising control outside the toolbar asks what it would do here, and
  // shows it the plain way: aria-disabled when refused, and the words in its
  // title. The toolbar does the same for its own buttons, with captions. A
  // refused control still raises when pressed; the refusal is what runs.
  const annotate = () => {
    for (const control of demo.querySelectorAll('[data-intent]')) {
      if (toolbar.element.contains(control)) continue;
      const asked = intentOf(control);
      const told = explain(control, asked.type, asked.args);
      control.setAttribute('aria-disabled', String(told.refused !== null));
      const words = told.refused ?? told.meaning;
      if (words === null) control.removeAttribute('title'); else control.title = words;
    }
  };

  // The tree changed, so what a control would do may have too.
  const refresh = () => {
    toolbar.refresh();
    annotate();
    stale = true;
    if (previewed !== null && previewed.isConnected) preview(previewed);
    else { previewed = null; showNothing(); }
  };

  const sync = () => {
    const here = stopOf();
    for (const button of places.querySelectorAll('.place')) button.setAttribute('aria-pressed', String(button.dataset.room === here?.key));
    demo.dataset.where = here?.key ?? '';
    refresh();
  };

  // ----------------------------------------------------------------- effects
  const api = {
    say(text) { status.updateAt(0, text); return text; },
    tally() {
      const all = demo.querySelectorAll('.card').length;
      const done = demo.querySelectorAll('.card[data-done="true"]').length;
      return api.say(`${done} of ${plural(all, 'card')} done.`);
    },
  };
  registerEffects();
  mounted.set(instance, api);

  // ---------------------------------------------------------------- handlers
  const offs = [
    on(demo, 'pointerover', '[data-intent]', (event, control) => preview(control)),
    on(demo, 'focusin', '[data-intent]', (event, control) => preview(control)),
    on(demo, 'click', '[data-intent="toolbar:go"]', (event, button) => raise(button, 'toolbar:go', intentOf(button).args)),
    on(demo, 'intent:raised', '*', event => { report(event.detail); sync(); }),
    // A rehearsal is an answer about the tree as it was asked. Typing in a
    // field, selecting an option or adding a card changes the tree without an
    // intent, so any input or click inside the demo asks again, after the
    // handlers below this root have run. A click on a control that raises is
    // already covered by the report of its intent.
    on(demo, 'input', '*', () => refresh()),
    // A checkbox fires click and input before change, and the lock is made on
    // change, so that one asks again too.
    on(demo, 'change', '*', () => refresh()),
    on(demo, 'click', '*', (event, target) => { if (target.closest('[data-intent]') === null) refresh(); }),
  ];

  sync();

  let disposed = false;
  return {
    element: demo,
    instance,
    toolbar,
    rooms,
    stops,
    dock: dockHost,
    status: statusHost,
    rehearsal: answersHost,
    results: resultsHost,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of offs) off();
      page.dispose();
      for (const each of Object.values(rooms)) each.dispose();
      toolbar.dispose();
      if (mounted.get(instance) === api) mounted.delete(instance);
      if (mounted.size === 0 && release !== null) release();
      demo.remove();
    },
  };
}
