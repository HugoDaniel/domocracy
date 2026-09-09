// One Clear button, two places.
//
//   mountClearDemo(root)   { element, button, caption, control, field, list, slots, dispose }
//
// The button has one click handler, which raises the intent `ui:clear` from
// the button and nothing else. The section the button is in answers: beside
// the search field, the form proposes emptying the field; in the todo list,
// the list proposes removing the completed tasks. Each answer is a plan. The
// caption under the button is that plan read with `interpret`, which runs
// nothing, and pressing the button asks again with `intent`, which runs it.
//
// The button travels by drag and drop, the browser's own, with two place
// buttons for the keyboard. While it is over a slot, the slot says what Clear
// would do there: the same interpreter, asked from the slot instead of the
// button, because the slot sits under the same section the button would.
//
// Two words on a plan are this page's convention and not the library's:
// `meaning` says what the plan does, and `refused` says why it does nothing.
// The trace keeps the plan as returned, so the caption reads them from there.
import { on, op, region } from 'domocracy';
import { intent, interpret, scope } from 'domocracy/intent';

export const TASKS = Object.freeze([
  { title: 'Write the docs', done: true },
  { title: 'Pick a name', done: true },
  { title: 'Draw a logo', done: true },
  { title: 'Set up the tests', done: true },
  { title: 'Ship it', done: false },
  { title: 'Tell people', done: false },
]);

// The fixed markup. The control is the button with its caption, so the two
// move together, and it starts in the search slot.
const MARKUP = `
  <div class="places" role="group" aria-label="Where Clear is">
    <span class="places-label">Clear is</span>
    <button type="button" class="place" data-place="search" aria-pressed="true">beside the search</button>
    <button type="button" class="place" data-place="todos" aria-pressed="false">in the todo list</button>
  </div>
  <div class="rooms">
    <section class="room" data-room="search" aria-label="Search">
      <h3>Search</h3>
      <div class="row">
        <div class="fields">
          <label class="field">Search <input type="text" name="query" value="domocracy" autocomplete="off"></label>
        </div>
        <div class="slot" data-slot="search">
          <div class="control" draggable="true">
            <button type="button" class="clear">Clear</button>
            <p class="caption"></p>
          </div>
        </div>
      </div>
    </section>
    <section class="room" data-room="todos" aria-label="Todo list">
      <h3>Todo list</h3>
      <ul class="tasks"></ul>
      <button type="button" class="add">Add a task</button>
      <div class="slot" data-slot="todos"></div>
    </section>
  </div>
`;

// The slots and the field row are adopted as they are in the markup. Nothing
// creates a child for them, so the adapter says so.
const ADOPTED = { create() { throw new Error('clear-demo: this region adopts its children and never creates one'); } };

// The two plan shapes of this page. Both consume: the nearest section that
// answers has the last word.
const act = (meaning, operations) => ({ disposition: 'consume', meaning, operations });
const refuse = refused => ({ disposition: 'consume', refused });

// What Clear would do, raised from `source`, in the words of the plan it would
// get. One scope answers on either route, so its plan is the first entry of
// the trace, and nothing has run.
const wordsOf = source => {
  const plan = interpret(source, 'ui:clear').trace[0]?.plan;
  return { text: plan?.refused ?? plan?.meaning ?? 'Nothing here answers Clear.', refused: plan?.refused !== undefined };
};

let instances = 0;

export function mountClearDemo(root) {
  const demo = document.createElement('div');
  demo.className = 'clear-demo';
  demo.innerHTML = MARKUP;
  root.append(demo);

  const control = demo.querySelector('.control');
  const button = demo.querySelector('.clear');
  const caption = demo.querySelector('.caption');
  caption.id = `clear-caption-${++instances}`;
  button.setAttribute('aria-describedby', caption.id);

  const slots = {
    search: region(demo.querySelector('[data-slot="search"]'), ADOPTED),
    todos: region(demo.querySelector('[data-slot="todos"]'), ADOPTED),
  };
  const slotOf = element => slots[element.dataset.slot];

  // The search form: a scope over the section, and its answer reads the field.
  // Emptying the field is an update of the field's row, run by the region over
  // the rows, so the interpreter proposes it and the adapter below writes it.
  const search = demo.querySelector('[data-room="search"]');
  const row = search.querySelector('.field');
  const field = row.querySelector('input');
  region(row.parentElement, {
    create: ADOPTED.create,
    update(node, data) { node.querySelector('input').value = data.value; },
  });
  const searching = scope(search);
  searching.handle('ui:clear', () => {
    const value = field.value;
    if (value === '') return refuse('The search field is already empty.');
    return act(`Clear “${value}” from the search field.`, [op.update(row, { value: '' })]);
  });

  // The todo list: a scope over the section, and its answer reads the
  // checkboxes. The completed tasks are whichever are ticked right now.
  const todos = demo.querySelector('[data-room="todos"]');
  const list = todos.querySelector('.tasks');
  const tasks = region(list, {
    create(task) {
      const item = document.createElement('li');
      item.className = 'task';
      item.innerHTML = '<label><input type="checkbox"> <span></span></label>';
      item.querySelector('input').checked = task.done;
      item.querySelector('span').textContent = task.title;
      return item;
    },
  });
  tasks.insert(TASKS);
  const listing = scope(todos);
  listing.handle('ui:clear', () => {
    const completed = Array.from(list.children).filter(task => task.querySelector('input').checked);
    if (list.children.length === 0) return refuse('The list is empty.');
    if (completed.length === 0) return refuse('No task is completed, so there is nothing to clear.');
    const which = completed.length === 1 ? 'the completed task' : `the ${completed.length} completed tasks`;
    return act(`Remove ${which}.`, [op.remove(completed)]);
  });

  // The caption: the plan the button would get, read and not run. A refused
  // button is dimmed and still raises when pressed; the refusal is a plan
  // with nothing in it, so pressing it runs nothing.
  const refresh = () => {
    const said = wordsOf(button);
    caption.textContent = said.text;
    button.setAttribute('aria-disabled', String(said.refused));
    const here = control.parentElement.dataset.slot;
    for (const place of demo.querySelectorAll('.place')) place.setAttribute('aria-pressed', String(place.dataset.place === here));
  };

  // The move is the page's own, so it is a plain region call. The control
  // stays the same node, and so does the button inside it.
  const put = to => {
    const from = slotOf(control.parentElement);
    if (from !== to) from.move(control, null, to);
  };

  // A slot that is being dragged over says what Clear would do in it. The
  // words are read off again when the drag leaves or ends.
  const clearSlots = () => {
    delete demo.dataset.dragging;
    for (const slot of demo.querySelectorAll('.slot')) delete slot.dataset.would;
  };

  let made = 0;
  const offs = [
    // The whole click handler: raise from the button, and the section answers.
    on(demo, 'click', '.clear', (event, clear) => intent(clear, 'ui:clear')),
    on(demo, 'click', '.place', (event, place) => put(slots[place.dataset.place])),
    on(demo, 'click', '.add', () => tasks.insert([{ title: `Task ${++made}`, done: false }])),

    // Drag and drop, the browser's own. The control is draggable, the slots
    // take the drop, and the one the control is already in takes nothing.
    on(demo, 'dragstart', '.control', event => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', 'Clear');   // Firefox starts no drag without data
      demo.dataset.dragging = 'true';
    }),
    on(demo, 'dragover', '.slot', (event, slot) => {
      if (slot === control.parentElement) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      // Asked from the slot: the walk starts above it, at the same section
      // that would answer the button once it is here.
      slot.dataset.would = wordsOf(slot).text;
    }),
    on(demo, 'dragleave', '.slot', (event, slot) => {
      if (event.relatedTarget instanceof Node && slot.contains(event.relatedTarget)) return;
      delete slot.dataset.would;
    }),
    on(demo, 'drop', '.slot', (event, slot) => {
      event.preventDefault();
      clearSlots();
      put(slotOf(slot));
      refresh();
    }),
    on(demo, 'dragend', '.control', clearSlots),

    // The caption is as current as the last change the page saw: typing, a
    // checkbox, or a click. These are registered after the handlers above, so
    // they read what those left behind.
    on(demo, 'input', 'input', refresh),
    on(demo, 'click', 'button', refresh),
  ];
  refresh();

  return {
    element: demo,
    button,
    caption,
    control,
    field,
    list,
    slots,
    dispose() {
      for (const off of offs) off();
      searching.dispose();
      listing.dispose();
      demo.remove();
    },
  };
}
