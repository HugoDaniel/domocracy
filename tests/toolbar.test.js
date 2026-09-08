// Browser tests for the toolbar example: one toolbar, four rooms. What is here
// needs a real tree: focus across a move, the walk through nested scopes, the
// guard during a rehearsal and the delegated rules on a real root.
import { region } from '../domocracy.js';
import { test, assert, equal, note } from './harness.js';
import { mountToolbarDemo } from '../examples/toolbar/main.js';
import { rehearse, room } from '../examples/toolbar/scopes.js';

const same = (actual, expected, message) => assert(actual === expected, `${message}: not the same node`);
const moves = 'moveBefore' in Element.prototype;
note(`moveBefore: ${moves ? 'available, so focus across a move is asserted' : 'missing, so focus across a move is not asserted'}`);

const button = (demo, type) => demo.toolbar.element.querySelector(`[data-intent="${type}"]`);
const place = (demo, key) => demo.element.querySelector(`.place[data-room="${key}"]`);
const status = demo => demo.status.textContent;
const latest = demo => demo.results.firstElementChild?.textContent ?? '';
const go = (demo, key) => place(demo, key).click();

test('in the dock nobody answers, and the log says so', sandbox => {
  const demo = mountToolbarDemo(sandbox);
  same(demo.toolbar.element.parentElement, demo.dock, 'the toolbar starts in the dock');
  equal(place(demo, 'dock').getAttribute('aria-pressed'), 'true', 'and the dock is the pressed place');
  button(demo, 'ui:apply').click();
  assert(latest(demo).includes('passed') && latest(demo).includes('Nobody answered'), `the log reports a pass: ${latest(demo)}`);
  demo.dispose();
  equal(sandbox.children.length, 0, 'dispose takes the demo out of the page');
});

test('the toolbar changes rooms by intent, and the button that asked keeps its focus', sandbox => {
  const demo = mountToolbarDemo(sandbox);
  go(demo, 'form');
  same(demo.toolbar.element.parentElement, demo.rooms.form.slot, 'the place strip moved the toolbar into the form');
  equal(place(demo, 'form').getAttribute('aria-pressed'), 'true', 'and now says so');
  const next = button(demo, 'toolbar:next');
  next.focus();
  next.click();
  same(demo.toolbar.element.parentElement, demo.rooms.listbox.slot, 'Next room went from the form to the listbox');
  if (moves) same(document.activeElement, next, 'and the button kept its focus through the move');
  next.click();
  next.click();
  same(demo.toolbar.element.parentElement, demo.rooms.board.slot, 'then the dialog, then the board');
  next.click();
  same(demo.toolbar.element.parentElement, demo.dock, 'and back to the dock');
  go(demo, 'dock');
  assert(status(demo).includes('already'), 'going where it already is changes nothing and says so');
  demo.dispose();
});

test('the same Apply commits a form, closes a dialog and ticks a card', sandbox => {
  const demo = mountToolbarDemo(sandbox);
  const apply = button(demo, 'ui:apply');

  go(demo, 'form');
  const name = demo.rooms.form.element.querySelector('input[name="name"]');
  name.value = 'Grace';
  apply.click();
  equal(name.defaultValue, 'Grace', 'Apply committed the field');
  assert(demo.rooms.form.element.querySelector('.readout').textContent.includes('Grace'), 'and the readout shows it');
  name.value = 'Nobody';
  button(demo, 'ui:cancel').click();
  equal(name.value, 'Grace', 'Cancel reverted to the committed value');
  name.value = '';
  apply.click();
  equal(name.value, '', 'a refused apply changes nothing');
  assert(status(demo).includes('refused'), `and the status says why: ${status(demo)}`);

  go(demo, 'dialog');
  const verdict = () => demo.rooms.dialog.element.querySelector('.verdict-text').dataset.state;
  apply.click();
  equal(verdict(), 'confirmed', 'Apply confirmed the dialog');
  apply.click();
  assert(status(demo).includes('closed'), 'a second Apply is refused because the dialog is closed');
  demo.rooms.dialog.element.querySelector('[data-action="reopen"]').click();
  equal(verdict(), 'open', 'Reopen opens it again');

  go(demo, 'board');
  const card = demo.toolbar.element.closest('.card');
  apply.click();
  equal(card.dataset.done, 'true', 'Apply ticked the card the toolbar is in');
  assert(latest(demo).includes('continue') && latest(demo).includes('consume'), `the trace has the card and the board: ${latest(demo)}`);
  equal(status(demo), '1 of 3 cards done.', 'and the board tallied after the tick');
  demo.dispose();
});

test('Up, Down and Remove act on the selected option in the listbox', sandbox => {
  const demo = mountToolbarDemo(sandbox);
  go(demo, 'listbox');
  const list = demo.rooms.listbox.element.querySelector('.options');
  const texts = () => Array.from(list.children, option => option.textContent);
  button(demo, 'ui:up').click();
  assert(status(demo).includes('Select'), 'with nothing selected, Up is refused');
  list.children[1].click();
  const blueberry = list.children[1];
  button(demo, 'ui:up').click();
  equal(texts(), ['Blueberry', 'Apple', 'Cherry', 'Damson'], 'Up moved the selected option');
  same(list.children[0], blueberry, 'and it is the same node');
  button(demo, 'ui:up').click();
  assert(status(demo).includes('already first'), 'Up at the top is refused');
  button(demo, 'ui:down').click();
  equal(texts(), ['Apple', 'Blueberry', 'Cherry', 'Damson'], 'Down moved it back');
  button(demo, 'ui:remove').click();
  equal(texts(), ['Apple', 'Cherry', 'Damson'], 'Remove took it');
  equal(list.children[1].getAttribute('aria-selected'), 'true', 'and the next option took the selection in the same group');
  demo.dispose();
});

test('removing the card that holds the toolbar hands the toolbar back first', sandbox => {
  const demo = mountToolbarDemo(sandbox);
  go(demo, 'board');
  const list = demo.rooms.board.element.querySelector('.cards');
  const card = demo.toolbar.element.closest('.card');
  button(demo, 'ui:down').click();
  same(list.children[1], card, 'Down moved the card');
  same(demo.toolbar.element.closest('.card'), card, 'with the toolbar inside it');

  const remove = button(demo, 'ui:remove');
  remove.focus();
  remove.click();
  equal(card.isConnected, false, 'the card is gone');
  same(demo.toolbar.element.parentElement, demo.dock, 'and the toolbar is back in the dock');
  if (moves) same(document.activeElement, remove, 'with focus still on Remove');
  equal(list.children.length, 2, 'two cards remain');
  assert(latest(demo).includes('2 operations'), `the plan ran the move and the remove: ${latest(demo)}`);
  assert(latest(demo).includes('Card “Write the docs”: continue'), `the log names the card that answered although it is gone: ${latest(demo)}`);

  list.children[0].querySelector('.card-remove').click();
  equal(list.children.length, 1, 'the × on a card raises ui:remove into the same rooms');
  demo.dispose();
});

test('a rehearsal says what a control would do and changes nothing', sandbox => {
  const demo = mountToolbarDemo(sandbox);
  go(demo, 'board');
  const list = demo.rooms.board.element.querySelector('.cards');
  const order = Array.from(list.children);
  const down = button(demo, 'ui:down');

  const rehearsed = rehearse(down, 'ui:down');
  equal(rehearsed.route.map(each => each.name), ['Card “Write the docs”', 'Board', 'Page'], 'the route is the card, the board and the page');
  equal(rehearsed.answers.map(each => each.state), ['skipped', 'consume', 'unreached'], 'the card has no interpreter, the board consumes, the page is not reached');
  equal(rehearsed.operations.map(each => each.op), ['move'], 'one move is proposed');
  equal(rehearsed.check.ok, true, 'and the plan checks out');
  order.forEach((node, i) => same(list.children[i], node, 'nothing moved'));

  down.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  const rows = demo.rehearsal.querySelectorAll('.answer');
  equal(rows.length, 3, 'the panel shows the three rooms');
  equal(rows[1].dataset.state, 'consume', 'with the board consuming');
  assert(rows[1].textContent.includes('move'), 'and the row describes the move');
  order.forEach((node, i) => same(list.children[i], node, 'and still nothing moved'));
  demo.dispose();
});

test('a rehearsal sets the guard, so an interpreter that writes is caught', sandbox => {
  const host = document.createElement('div');
  const list = document.createElement('ul');
  const control = document.createElement('button');
  host.append(list, control);
  sandbox.append(host);
  const rows = region(list, { create: text => Object.assign(document.createElement('li'), { textContent: text }) });
  const sloppy = room(host, 'Sloppy', { 'x': () => { rows.insert(['oops']); return { disposition: 'consume' }; } });

  const rehearsed = rehearse(control, 'x');
  equal(rehearsed.answers[0].state, 'error', 'the interpreter threw');
  assert(rehearsed.answers[0].error.message.includes('rehearsing'), `because the guard was set: ${rehearsed.answers[0].error.message}`);
  equal(list.children.length, 0, 'and nothing was inserted');
  sloppy.dispose();
});
