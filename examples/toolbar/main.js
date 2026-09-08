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
import { describe, nameOf, raise, rehearse, room } from './scopes.js';

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
  consume: 'consume: answers and ends the walk',
  continue: 'continue: adds to the plan and lets the next room add more',
  pass: 'pass: proposes nothing',
  skipped: 'not asked: no interpreter for this intent',
  unreached: 'not reached: a nearer room consumed',
  error: 'threw while interpreting',
};

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
    { key: 'dock', name: 'Dock', element: dockHost, get slot() { return dockHost; } },
    ...Object.entries(rooms).map(([key, each]) => ({ key, name: each.name, element: each.element, get slot() { return each.slot; } })),
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
  rehearsalPanel.append(element('h3', null, 'What this control would do'), head, answersHost, check);
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

  const showNothing = () => {
    head.textContent = 'Hover or focus a control to see what it would do.';
    check.textContent = '';
    answers.clear();
  };

  const show = control => {
    const asked = intentOf(control);
    const rehearsed = rehearse(control, asked.type, asked.args);
    const seen = rehearsed.interpreted;
    head.textContent = seen === null
      ? `“${labelOf(control)}” would raise ${asked.type}, and interpreting it failed.`
      : seen.route.length === 0
        ? `“${labelOf(control)}” would raise ${asked.type}, and no scope is above it: the intent would pass with nobody answering.`
        : `“${labelOf(control)}” would raise ${asked.type}. The route is ${seen.route.map(each => nameOf(each) ?? 'a scope').join(' → ')}.`;
    // One group: the old rows go and the new ones arrive as a single change.
    answers.execute([op.clear(answersHost), op.insert(answersHost, null, rehearsed.answers)]);
    check.textContent = seen === null
      ? `The intent would be refused before anything ran: ${rehearsed.error.message}`
      : seen.route.length === 0 ? ''
        : `${plural(seen.operations.length, 'operation')} and ${plural(seen.effects.length, 'effect')}, checked as one sequence: it would run. Nothing has.`;
  };

  let previewed = null, stale = true;
  const preview = control => {
    if (control === previewed && !stale) return;
    previewed = control;
    stale = false;
    show(control);
  };

  // --------------------------------------------------------------------- log
  const report = ({ type, result, error }) => {
    let entry;
    if (error !== undefined) {
      entry = { state: 'error', text: `${type} failed: ${error.message} ${error.committed === undefined ? 'Nothing ran.' : `${plural(error.committed, 'operation')} ran before it.`}` };
    } else {
      const trace = result.trace.map(each => `${nameOf(each.scope) ?? 'a scope'}: ${each.disposition}`).join(', ');
      const effects = result.effects.map(each => `${each.type} ${each.status}${each.status === 'failed' ? ` (${each.error.message})` : ''}`).join(', ');
      entry = { state: result.disposition, text: `#${result.id} ${type} → ${result.disposition}. ${trace || 'Nobody answered'}. ${plural(result.operations.length, 'operation')} ran${effects ? `; effects: ${effects}` : ''}.` };
    }
    // The newest row goes first and the oldest go, as one group.
    const group = [op.insert(resultsHost, resultsHost.firstElementChild, [entry])];
    if (results.length >= KEEP) group.push(op.remove(Array.prototype.slice.call(results.nodes, KEEP - 1)));
    results.execute(group);
  };

  // ------------------------------------------------------------------ travel
  const stopOf = () => stops.find(stop => stop.element.contains(toolbar.element)) ?? null;

  const travel = stop => {
    if (stop === null) return { disposition: 'consume', effects: [say('There is no such room.')] };
    const slot = stop.slot;
    if (slot === null) return { disposition: 'consume', effects: [say(`The ${stop.name} has no card to hold the toolbar. Add one first.`)] };
    if (toolbar.element.parentElement === slot) return { disposition: 'consume', effects: [say(`The toolbar is already in the ${stop.name}.`)] };
    return {
      disposition: 'consume',
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
        if (stop.slot !== null) return travel(stop);
      }
      return { disposition: 'consume', effects: [say('Nowhere to go.')] };
    },
    'toolbar:go': raised => travel(stops.find(stop => stop.key === raised.args?.room) ?? null),
  });

  // The tree changed, so what a control would do may have too.
  const refresh = () => {
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
    on(places, 'click', '.place', (event, button) => raise(button, 'toolbar:go', { room: button.dataset.room })),
    on(demo, 'intent:raised', '*', event => { report(event.detail); sync(); }),
    // A rehearsal is an answer about the tree as it was asked. Typing in a
    // field, selecting an option or adding a card changes the tree without an
    // intent, so any input or click inside the demo asks again, after the
    // handlers below this root have run. A click on a control that raises is
    // already covered by the report of its intent.
    on(demo, 'input', '*', () => refresh()),
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
