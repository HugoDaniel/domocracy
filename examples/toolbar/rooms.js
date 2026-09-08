// The four rooms. Each is a section with a scope on it, some content the scope
// reads, and a slot the toolbar can be moved into.
//
//   createForm(options)      Apply commits the fields, Cancel reverts them
//   createListbox(options)   Up, Down and Remove act on the selected option
//   createDialog(options)    Apply confirms, Cancel dismisses, and then it is closed
//   createBoard(options)     cards, each a scope of its own inside the board's
//
// Every room returns { element, name, slot, dispose }. A slot is a region whose
// only child, when it has one, is the toolbar; the toolbar arrives by a move and
// is never created here, which is why the slot adapter's create throws.
//
// Interpreters read the tree and return plans. None of them writes, none of them
// knows what a toolbar is, and none of them registers an effect: `options.say`
// builds the request for the page's status line and the page runs it. The
// rooms are told nothing about each other.
import { on, op, region } from 'domocracy';
import { raise, room } from './scopes.js';

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const SLOT = { create() { throw new Error('slot: the toolbar is moved in, never created'); } };

function slotIn(parent, label) {
  const slot = element('div', 'slot');
  slot.dataset.label = label;
  region(slot, SLOT);
  parent.append(slot);
  return slot;
}

function section(kind, name) {
  const host = element('section', 'room');
  host.dataset.room = kind;
  const heading = element('h3', null, name);
  heading.id = `room-${kind}-${++headings}`;
  host.setAttribute('aria-labelledby', heading.id);
  host.append(heading);
  return host;
}
let headings = 0;

const consume = (operations, effects) => ({ disposition: 'consume', operations, effects });
const refuse = effect => ({ disposition: 'consume', effects: [effect] });

// ------------------------------------------------------------------- form

// Two fields and a readout of what was last committed. The committed value of a
// field is its input's defaultValue, so the form's whole state is in the DOM and
// "dirty" is a comparison the interpreter can make.
export function createForm({ say }) {
  const host = section('form', 'Form');
  const fields = element('div', 'fields');
  fields.dataset.label = 'the fields';
  const readout = element('p', 'readout');
  host.append(fields, readout);
  const slot = slotIn(host, "the Form's slot");

  const fieldRegion = region(fields, {
    create(spec) {
      const label = element('label', 'field', `${spec.label} `);
      const input = element('input');
      input.name = spec.name;
      input.type = spec.type ?? 'text';
      input.value = spec.value;
      input.defaultValue = spec.value;
      label.append(input);
      return label;
    },
    update(node, data) {
      const input = node.querySelector('input');
      if ('value' in data) input.value = data.value;
      if (data.commit === true) input.defaultValue = input.value;
    },
  });
  fieldRegion.insert([
    { name: 'name', label: 'Name', value: 'Ada' },
    { name: 'email', label: 'Email', value: 'ada@example.com', type: 'email' },
  ]);

  const committed = data => `Committed: ${data.name}, ${data.email}`;
  const readoutRegion = region(readout, {
    create(data) {
      const line = element('span', 'readout-text', committed(data));
      line.dataset.label = 'the readout';
      return line;
    },
    update(node, data) { node.textContent = committed(data); },
  });
  readoutRegion.insert([{ name: 'Ada', email: 'ada@example.com' }]);

  const inputs = () => Array.from(fields.querySelectorAll('input'));
  const dirty = () => inputs().filter(input => input.value !== input.defaultValue);
  const fieldOf = input => input.closest('.field');
  const plural = n => `${n} field${n === 1 ? '' : 's'}`;

  const here = room(host, 'Form', {
    'ui:apply': () => {
      const [name, email] = inputs();
      if (name.value.trim() === '') return refuse(say('The form refused: the name is empty.'));
      if (!email.value.includes('@')) return refuse(say('The form refused: the email needs an @.'));
      const changed = dirty();
      if (changed.length === 0) return refuse(say('Nothing to apply: the form is as committed.'));
      return consume(
        [...changed.map(input => op.update(fieldOf(input), { commit: true })),
          op.update(readout.firstElementChild, { name: name.value, email: email.value })],
        [say(`The form committed ${plural(changed.length)}.`)],
      );
    },
    'ui:cancel': () => {
      const changed = dirty();
      if (changed.length === 0) return refuse(say('Nothing to cancel: the form is clean.'));
      return consume(
        changed.map(input => op.update(fieldOf(input), { value: input.defaultValue })),
        [say(`The form reverted ${plural(changed.length)}.`)],
      );
    },
  });

  return { element: host, name: 'Form', get slot() { return slot; }, dispose() { here.dispose(); host.remove(); } };
}

// ---------------------------------------------------------------- listbox

// A single-select listbox. Selection is aria-selected on the option, so it is
// read from the tree like everything else, and the focusable option follows it.
export function createListbox({ say }) {
  const host = section('listbox', 'Listbox');
  const list = element('ul', 'options');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Fruit');
  list.dataset.label = 'the options';
  const hint = element('p', 'hint', 'Click an option, or focus the list and use the arrow keys.');
  const add = element('button', 'room-button', 'Add an option');
  add.type = 'button';
  add.dataset.action = 'add';
  host.append(list, hint, add);
  const slot = slotIn(host, "the Listbox's slot");

  const options = region(list, {
    create(text) {
      const option = element('li', 'option', text);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.tabIndex = -1;
      return option;
    },
    update(node, data) { node.setAttribute('aria-selected', String(data.selected)); },
  });
  options.insert(['Apple', 'Blueberry', 'Cherry', 'Damson']);

  const selected = () => list.querySelector('[aria-selected="true"]');
  // One tab stop: the selected option, or the first when nothing is selected.
  const syncTabs = () => {
    const stop = selected() ?? list.firstElementChild;
    for (const option of list.children) option.tabIndex = option === stop ? 0 : -1;
  };
  syncTabs();

  // Selecting is the listbox's own, so it is a direct group and not an intent:
  // the old option and the new one change together, validated and observed as
  // one change.
  const select = option => {
    const was = selected();
    if (was === option) return;
    const group = [];
    if (was !== null) group.push(op.update(was, { selected: false }));
    group.push(op.update(option, { selected: true }));
    options.execute(group);
  };

  let made = 0;
  const offs = [
    options.observe(syncTabs),
    on(list, 'click', '[role="option"]', (event, option) => select(option)),
    on(list, 'keydown', '[role="option"]', (event, option) => {
      const to = event.key === 'ArrowDown' ? option.nextElementSibling
        : event.key === 'ArrowUp' ? option.previousElementSibling
        : event.key === 'Home' ? list.firstElementChild
        : event.key === 'End' ? list.lastElementChild
        : undefined;
      if (to === undefined) return;
      event.preventDefault();
      if (to === null) return;
      select(to);
      to.focus();
    }),
    on(host, 'click', '[data-action="add"]', () => options.insert([`Fruit ${++made}`])),
  ];

  const here = room(host, 'Listbox', {
    'ui:up': () => {
      const option = selected();
      if (option === null) return refuse(say('Select an option first.'));
      if (option.previousElementSibling === null) return refuse(say(`${option.textContent} is already first.`));
      return consume([op.move(option, list, option.previousElementSibling)], [say(`Moved ${option.textContent} up.`)]);
    },
    'ui:down': () => {
      const option = selected();
      if (option === null) return refuse(say('Select an option first.'));
      const next = option.nextElementSibling;
      if (next === null) return refuse(say(`${option.textContent} is already last.`));
      return consume([op.move(option, list, next.nextElementSibling)], [say(`Moved ${option.textContent} down.`)]);
    },
    'ui:remove': () => {
      const option = selected();
      if (option === null) return refuse(say('Select an option first.'));
      // The neighbour takes the selection in the same group, so the list never
      // shows a moment with nothing selected.
      const heir = option.nextElementSibling ?? option.previousElementSibling;
      const operations = heir === null ? [] : [op.update(heir, { selected: true })];
      operations.push(op.remove([option]));
      return consume(operations, [say(`Removed ${option.textContent}${heir === null ? '' : `; ${heir.textContent} is selected`}.`)]);
    },
    'ui:cancel': () => {
      const option = selected();
      if (option === null) return refuse(say('Nothing is selected.'));
      return consume([op.update(option, { selected: false })], [say('Cleared the selection.')]);
    },
  });

  return {
    element: host,
    name: 'Listbox',
    get slot() { return slot; },
    dispose() { for (const off of offs) off(); here.dispose(); host.remove(); },
  };
}

// ----------------------------------------------------------------- dialog

// A confirmation panel, not a modal: nothing traps focus here. Its state is the
// verdict line's data-state, which the interpreters read and one update writes.
const VERDICTS = {
  open: 'Waiting for an answer.',
  confirmed: 'Closed: confirmed. The files are archived.',
  cancelled: 'Closed: cancelled. Nothing was archived.',
};

export function createDialog({ say }) {
  const host = section('dialog', 'Dialog');
  const question = element('p', 'question', 'Archive 3 files? They can be restored for 30 days.');
  const verdict = element('p', 'verdict');
  const reopen = element('button', 'room-button', 'Reopen');
  reopen.type = 'button';
  reopen.dataset.action = 'reopen';
  host.append(question, verdict, reopen);
  const slot = slotIn(host, "the Dialog's slot");

  const line = region(verdict, {
    create(data) {
      const text = element('span', 'verdict-text', VERDICTS[data.state]);
      text.dataset.label = 'the verdict';
      text.dataset.state = data.state;
      return text;
    },
    update(node, data) {
      node.dataset.state = data.state;
      node.textContent = VERDICTS[data.state];
    },
  });
  line.insert([{ state: 'open' }]);

  const state = () => verdict.firstElementChild.dataset.state;
  const close = (result, text) => () => state() !== 'open'
    ? refuse(say('The dialog is closed. Reopen it first.'))
    : consume([op.update(verdict.firstElementChild, { state: result })], [say(text)]);

  const off = on(host, 'click', '[data-action="reopen"]', () => line.updateAt(0, { state: 'open' }));
  const here = room(host, 'Dialog', {
    'ui:apply': close('confirmed', 'The dialog closed: confirmed.'),
    'ui:cancel': close('cancelled', 'The dialog closed: cancelled.'),
  });

  return { element: host, name: 'Dialog', get slot() { return slot; }, dispose() { off(); here.dispose(); host.remove(); } };
}

// ------------------------------------------------------------------ board

// A board of cards, and every card has a scope of its own inside the board's.
// So an intent from inside a card visits two rooms: the card answers first, and
// what it does not settle goes on to the board. Apply is the one both answer,
// the card with `continue` and the board with `consume`, and the plan carries
// both contributions in that order.
//
// A card holds a slot, so the toolbar can be in one, and a card that is removed
// takes its contents with it. That is why `ui:remove` on a card first hands
// whatever is in its slot back to `options.home`: a plan is a sequence, and the
// move comes before the remove, so the toolbar's button keeps its focus in the
// dock while the card it was in goes.
export function createBoard({ say, tally, home }) {
  const host = section('board', 'Board');
  const list = element('ul', 'cards');
  list.dataset.label = 'the cards';
  const add = element('button', 'room-button', 'Add a card');
  add.type = 'button';
  add.dataset.action = 'add';
  host.append(list, add);

  const handles = new Map();   // card element -> its room

  const cards = region(list, {
    create(spec) {
      const card = element('li', 'card');
      card.dataset.label = spec.title;
      card.dataset.done = 'false';
      const title = element('span', 'card-title', spec.title);
      const remove = element('button', 'card-remove', '×');
      remove.type = 'button';
      remove.dataset.intent = 'ui:remove';
      remove.setAttribute('aria-label', `Remove ${spec.title}`);
      card.append(title, remove);
      const slot = slotIn(card, `the slot of “${spec.title}”`);
      handles.set(card, room(card, `Card “${spec.title}”`, {
        'ui:apply': () => ({ disposition: 'continue', operations: [op.update(card, { done: card.dataset.done !== 'true' })] }),
        'ui:remove': () => {
          const held = slot.firstElementChild;
          return held === null ? null : { disposition: 'continue', operations: [op.move(held, home, null)] };
        },
      }));
      return card;
    },
    update(node, data) { node.dataset.done = String(data.done); },
  });
  cards.insert([{ title: 'Write the docs' }, { title: 'Ship it' }, { title: 'Tell people' }]);

  const titleOf = card => card.dataset.label;
  const cardOf = raised => cards.at(raised.source);

  let made = 0;
  const offs = [
    // A card learns that it left from the group that removed it.
    cards.observe(group => {
      for (const o of group) {
        if (o.op !== 'remove') continue;
        for (const card of o.entities) { handles.get(card)?.dispose(); handles.delete(card); }
      }
    }),
    // The × is a control like any other: it raises and the rooms decide. The
    // report comes from the list, because the × leaves with its card.
    on(list, 'click', '.card-remove', (event, button) => raise(button, 'ui:remove', undefined, list)),
    on(host, 'click', '[data-action="add"]', () => cards.insert([{ title: `Card ${++made}` }])),
  ];

  const here = room(host, 'Board', {
    'ui:up': raised => {
      const found = cardOf(raised);
      if (found === null) return refuse(say('Up moves a card, and this control is in none.'));
      if (found.index === 0) return refuse(say(`“${titleOf(found.node)}” is already at the top.`));
      return consume([op.move(found.node, list, list.children[found.index - 1])], [say(`Moved “${titleOf(found.node)}” up. Same card, same focus.`)]);
    },
    'ui:down': raised => {
      const found = cardOf(raised);
      if (found === null) return refuse(say('Down moves a card, and this control is in none.'));
      const next = found.node.nextElementSibling;
      if (next === null) return refuse(say(`“${titleOf(found.node)}” is already at the bottom.`));
      return consume([op.move(found.node, list, next.nextElementSibling)], [say(`Moved “${titleOf(found.node)}” down. Same card, same focus.`)]);
    },
    // The card toggles itself; the board counts afterwards. Effects run after
    // the plan's operations, so the tally sees the toggle.
    'ui:apply': () => ({ disposition: 'consume', effects: [tally()] }),
    'ui:remove': raised => {
      const found = cardOf(raised);
      if (found === null) return refuse(say('Remove takes a card, and this control is in none.'));
      return consume([op.remove([found.node])], [say(`Removed “${titleOf(found.node)}”.`)]);
    },
  });

  return {
    element: host,
    name: 'Board',
    // The toolbar goes into the first card. A board with no cards has no slot.
    get slot() { return list.firstElementChild?.querySelector('.slot') ?? null; },
    dispose() {
      for (const off of offs) off();
      for (const handle of handles.values()) handle.dispose();
      handles.clear();
      here.dispose();
      host.remove();
    },
  };
}
