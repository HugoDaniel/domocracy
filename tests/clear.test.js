// Browser tests for the clear example: one Clear button, two places. What is
// here needs a real tree: a button that moves between two scopes and keeps its
// node, captions read from `interpret`, and the delegated rules on a real root.
import { interpret } from '../intent.js';
import { test, assert, equal } from './harness.js';
import { mountClearDemo, TASKS } from '../examples/clear/main.js';

const same = (actual, expected, message) => assert(actual === expected, `${message}: not the same node`);

const captionOf = demo => document.getElementById(demo.button.getAttribute('aria-describedby')).textContent;
const refused = demo => demo.button.getAttribute('aria-disabled') === 'true';
const place = (demo, key) => demo.element.querySelector(`.place[data-place="${key}"]`);
const pressed = (demo, key) => place(demo, key).getAttribute('aria-pressed') === 'true';
const titles = demo => Array.from(demo.list.children, task => task.querySelector('span').textContent);
const box = (demo, i) => demo.list.children[i].querySelector('input');
const type = (demo, text) => {
  demo.field.value = text;
  demo.field.dispatchEvent(new InputEvent('input', { bubbles: true }));
};

test('beside the search, the caption says what Clear would do, and pressing it empties the field', sandbox => {
  const demo = mountClearDemo(sandbox);
  same(demo.control.parentElement, demo.slots.search.container, 'Clear starts beside the search');
  assert(pressed(demo, 'search') && !pressed(demo, 'todos'), 'and the places say so');
  equal(captionOf(demo), 'Clear “domocracy” from the search field.', 'the caption names the value the field holds');
  equal(refused(demo), false, 'and the button is available');

  demo.button.click();
  equal(demo.field.value, '', 'pressing Clear emptied the field');
  equal(captionOf(demo), 'The search field is already empty.', 'and the caption now refuses');
  equal(refused(demo), true, 'so the button is marked refused');

  demo.button.click();
  equal(demo.field.value, '', 'a refused press runs nothing');
  equal(captionOf(demo), 'The search field is already empty.', 'and says the same');

  type(demo, 'grid');
  equal(captionOf(demo), 'Clear “grid” from the search field.', 'typing changed the caption');
  equal(refused(demo), false, 'and the button is available again');
  demo.dispose();
  equal(sandbox.children.length, 0, 'dispose takes the demo out of the page');
});

test('in the todo list, the caption counts the completed tasks and Clear removes them', sandbox => {
  const demo = mountClearDemo(sandbox);
  equal(titles(demo), TASKS.map(task => task.title), 'the list starts with the fixture');
  place(demo, 'todos').click();
  same(demo.control.parentElement, demo.slots.todos.container, 'Clear is in the todo list');
  assert(pressed(demo, 'todos') && !pressed(demo, 'search'), 'and the places say so');
  equal(captionOf(demo), 'Remove the 4 completed tasks.', 'the caption counts the ticked tasks');

  box(demo, 0).click();
  equal(captionOf(demo), 'Remove the 3 completed tasks.', 'unticking one counted again');
  box(demo, 0).click();
  equal(captionOf(demo), 'Remove the 4 completed tasks.', 'and ticking it back too');
  box(demo, 1).click();

  demo.button.click();
  equal(titles(demo), ['Pick a name', 'Ship it', 'Tell people'], 'the ticked tasks went and the others stayed');
  equal(captionOf(demo), 'No task is completed, so there is nothing to clear.', 'the caption says why Clear is refused');
  equal(refused(demo), true);

  demo.element.querySelector('.add').click();
  equal(titles(demo).length, 4, 'a task was added');
  equal(refused(demo), true, 'unticked, so Clear is still refused');
  box(demo, 3).click();
  equal(captionOf(demo), 'Remove the completed task.', 'one ticked task is said in the singular');
  demo.button.click();
  equal(titles(demo), ['Pick a name', 'Ship it', 'Tell people'], 'and Clear removed it');

  for (let i = 0; i < 3; i++) { box(demo, 0).click(); demo.button.click(); }
  equal(titles(demo), [], 'the list can be emptied one task at a time');
  equal(captionOf(demo), 'The list is empty.', 'and an empty list says so');
  demo.dispose();
});

test('the same button moves between the places and asks whichever it is in', sandbox => {
  const demo = mountClearDemo(sandbox);
  const button = demo.button;
  const control = demo.control;
  place(demo, 'todos').click();
  same(demo.element.querySelector('.clear'), button, 'the button is the same node in the todo list');
  same(control.parentElement, demo.slots.todos.container, 'inside the same control');
  equal(interpret(button, 'ui:clear').route.length, 1, 'with one scope above it');
  same(interpret(button, 'ui:clear').route[0], demo.element.querySelector('[data-room="todos"]'), 'which is the todo section');

  place(demo, 'todos').click();
  same(control.parentElement, demo.slots.todos.container, 'pressing the place it is in changes nothing');

  place(demo, 'search').click();
  same(demo.element.querySelector('.clear'), button, 'back beside the search, still the same node');
  same(interpret(button, 'ui:clear').route[0], demo.element.querySelector('[data-room="search"]'), 'and the search section answers');
  equal(captionOf(demo), 'Clear “domocracy” from the search field.', 'with the form\'s own words');
  assert(pressed(demo, 'search') && !pressed(demo, 'todos'));
  demo.dispose();
});

test('reading the caption changes nothing, and pressing runs exactly the plan it showed', sandbox => {
  const demo = mountClearDemo(sandbox);
  place(demo, 'todos').click();
  const before = Array.from(demo.list.children);

  const seen = interpret(demo.button, 'ui:clear');
  equal(seen.disposition, 'consumed', 'the list consumed');
  equal(seen.operations.map(o => o.op), ['remove'], 'proposing one remove');
  equal(seen.operations[0].entities.length, 4, 'of the four ticked tasks');
  equal(seen.trace[0].plan.meaning, 'Remove the 4 completed tasks.', 'and the plan carries the words the caption shows');
  before.forEach((task, i) => same(demo.list.children[i], task, 'nothing moved'));
  equal(before.filter(task => task.querySelector('input').checked).length, 4, 'and nothing was unticked');

  demo.button.click();
  equal(demo.list.children.length, 2, 'pressing removed those four');
  before.slice(4).forEach((task, i) => same(demo.list.children[i], task, 'and kept the rest as the same nodes'));
  demo.dispose();
});

const drag = (type, init = {}) => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer(), ...init });

test('Clear can be dropped into the other slot, and the slot says what that would mean before the drop', sandbox => {
  const demo = mountClearDemo(sandbox);
  const searchSlot = demo.slots.search.container, todoSlot = demo.slots.todos.container;
  const before = Array.from(demo.list.children);

  demo.control.dispatchEvent(drag('dragstart'));
  equal(demo.element.dataset.dragging, 'true', 'the page knows a drag is on');
  const own = drag('dragover');
  searchSlot.dispatchEvent(own);
  equal(own.defaultPrevented, false, 'the slot Clear is in takes no drop');
  equal(searchSlot.dataset.would, undefined, 'and says nothing');

  const over = drag('dragover');
  todoSlot.dispatchEvent(over);
  equal(over.defaultPrevented, true, 'the other slot takes the drop');
  equal(todoSlot.dataset.would, 'Remove the 4 completed tasks.', 'and says what Clear would do there, before anything moved');
  same(demo.control.parentElement, searchSlot, 'the control has not moved');
  before.forEach((task, i) => same(demo.list.children[i], task, 'and the list is untouched'));

  todoSlot.dispatchEvent(drag('drop'));
  same(demo.control.parentElement, todoSlot, 'dropping moved the control');
  equal(todoSlot.dataset.would, undefined, 'the slot\'s words are cleared');
  equal(demo.element.dataset.dragging, undefined, 'and so is the drag');
  equal(captionOf(demo), 'Remove the 4 completed tasks.', 'the caption under the button says what the slot said');
  assert(pressed(demo, 'todos'), 'and the place buttons followed');
  demo.control.dispatchEvent(drag('dragend'));

  // Leaving a slot takes its words away, and ending the drag takes everything.
  demo.control.dispatchEvent(drag('dragstart'));
  searchSlot.dispatchEvent(drag('dragover'));
  equal(searchSlot.dataset.would, 'Clear “domocracy” from the search field.', 'over the search slot, the form answers');
  searchSlot.dispatchEvent(drag('dragleave', { relatedTarget: demo.element }));
  equal(searchSlot.dataset.would, undefined, 'leaving the slot cleared its words');
  searchSlot.dispatchEvent(drag('dragover'));
  searchSlot.dispatchEvent(drag('dragleave', { relatedTarget: searchSlot.firstElementChild ?? searchSlot }));
  equal(searchSlot.dataset.would, 'Clear “domocracy” from the search field.', 'moving within the slot keeps them');
  demo.control.dispatchEvent(drag('dragend'));
  equal(searchSlot.dataset.would, undefined, 'the end of the drag clears them');
  equal(demo.element.dataset.dragging, undefined);
  same(demo.control.parentElement, todoSlot, 'and a drag that ends without a drop moves nothing');
  demo.dispose();
});

test('two demos keep their own answers, and one can go while the other stays', sandbox => {
  const one = mountClearDemo(sandbox);
  const two = mountClearDemo(sandbox);
  assert(one.caption.id !== two.caption.id, 'each caption has its own id');
  place(two, 'todos').click();
  equal(captionOf(one), 'Clear “domocracy” from the search field.', 'the first is still beside its search');
  equal(captionOf(two), 'Remove the 4 completed tasks.', 'and the second is in its todo list');

  one.button.click();
  equal(one.field.value, '', 'Clear in the first emptied its field');
  equal(two.field.value, 'domocracy', 'and left the second alone');
  equal(two.list.children.length, 6, 'as it left its tasks');

  one.dispose();
  two.button.click();
  equal(two.list.children.length, 2, 'the surviving demo still clears');
  two.dispose();
  equal(sandbox.children.length, 0, 'both demos left the page');
});
