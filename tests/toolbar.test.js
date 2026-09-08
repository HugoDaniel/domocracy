// Browser tests for the toolbar example: one toolbar, four rooms. What is here
// needs a real tree: focus across a move, the walk through nested scopes, the
// guard during a rehearsal and the delegated rules on a real root.
import { region } from '../domocracy.js';
import { test, assert, equal, note } from './harness.js';
import { mountToolbarDemo } from '../examples/toolbar/main.js';
import { explain, nameOf, rehearse, room } from '../examples/toolbar/scopes.js';

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
  assert(status(demo).includes('empty'), `and the status says why: ${status(demo)}`);

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
  equal(rehearsed.error, null, 'the plan checks out');
  equal(rehearsed.interpreted.route.map(nameOf), ['Card “Write the docs”', 'Board', 'Page'], 'the route is the card, the board and the page');
  equal(rehearsed.answers.map(each => each.state), ['skipped', 'consume', 'unreached'], 'the card has no interpreter, the board consumes, the page is not reached');
  equal(rehearsed.interpreted.operations.map(each => each.op), ['move'], 'one move is proposed');
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
  assert(rehearsed.error !== null, 'the interpreter threw and the rehearsal says so');
  assert(rehearsed.error.message.includes('no writes while interpreting'), `because the guard was set: ${rehearsed.error.message}`);
  equal(rehearsed.interpreted, null, 'there is no interpretation to show');
  equal(rehearsed.answers.length, 0, 'and no answers');
  equal(list.children.length, 0, 'and nothing was inserted');
  sloppy.dispose();
});

test('a rehearsal follows the tree: typing, selecting and adding all change the answer', sandbox => {
  const demo = mountToolbarDemo(sandbox);
  const head = () => demo.rehearsal.parentElement.querySelector('.rehearsal-check').textContent;
  const verdicts = () => Array.from(demo.rehearsal.querySelectorAll('.answer-plan li'), row => row.textContent);
  const over = control => control.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));

  go(demo, 'form');
  over(button(demo, 'ui:apply'));
  assert(verdicts().some(text => text.includes('as committed')), `a clean form refuses Apply: ${verdicts()}`);
  const name = demo.rooms.form.element.querySelector('input[name="name"]');
  name.value = 'Grace';
  name.dispatchEvent(new InputEvent('input', { bubbles: true }));
  assert(verdicts().some(text => text.includes('commit')), `typing changed the answer to a commit: ${verdicts()}`);
  assert(head().includes('2 operations'), `two operations would run: ${head()}`);

  go(demo, 'listbox');
  over(button(demo, 'ui:up'));
  assert(verdicts().some(text => text.includes('Select an option')), `nothing is selected: ${verdicts()}`);
  demo.rooms.listbox.element.querySelectorAll('.option')[1].click();
  assert(verdicts().some(text => text.startsWith('move')), `selecting by a direct group changed the answer to a move: ${verdicts()}`);

  go(demo, 'board');
  const cards = demo.rooms.board.element.querySelector('.cards');
  over(button(demo, 'ui:down'));
  cards.lastElementChild.querySelector('.card-remove').click();
  cards.lastElementChild.querySelector('.card-remove').click();
  assert(verdicts().some(text => text.includes('already at the bottom')), `with the other cards gone, Down is refused: ${verdicts()}`);
  demo.rooms.board.element.querySelector('[data-action="add"]').click();
  assert(verdicts().some(text => text.startsWith('move')), `adding a card made Down a move again: ${verdicts()}`);
  demo.dispose();
});

test('the arrow keys reach a button that arrived after the toolbar was made', sandbox => {
  const demo = mountToolbarDemo(sandbox);
  const toolbar = demo.toolbar.element;
  const late = document.createElement('button');
  late.type = 'button';
  late.className = 'tb-button';
  late.dataset.intent = 'ui:late';
  late.textContent = 'Late';
  toolbar.querySelector('.tb-buttons').append(late);
  const last = button(demo, 'toolbar:next');
  last.focus();
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  same(document.activeElement, late, 'ArrowRight from the old last button reaches the new one');
  equal(late.tabIndex, 0, 'and it is the tab stop now');
  equal(last.tabIndex, -1, 'while the one before is not');
  late.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  same(document.activeElement, button(demo, 'ui:apply'), 'and the wrap goes round through it');
  demo.dispose();
});

const over = control => control.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
// The page's scope is the demo root itself, which a query from the root leaves out.
const routeOf = demo => [demo.element, ...demo.element.querySelectorAll('[data-route]')].filter(node => node.hasAttribute('data-route')).map(node => `${nameOf(node)}: ${node.dataset.route}`);
const affected = demo => Array.from(demo.element.querySelectorAll('[data-affected]'), node => `${node.dataset.label ?? node.className}: ${node.dataset.affected}`);

test('a rehearsal outlines the route in place and marks the nodes the plan names, then clears them', sandbox => {
  const demo = mountToolbarDemo(sandbox);
  go(demo, 'board');
  const cards = demo.rooms.board.element.querySelector('.cards');
  const [first, second] = cards.children;
  const order = Array.from(cards.children);

  over(button(demo, 'ui:down'));
  equal(routeOf(demo), ['Page: unreached', 'Board: consume', 'Card “Write the docs”: skipped'], 'the route is on the scopes, in document order');
  equal(affected(demo), ['the cards: receives', 'Write the docs: moves'], 'the card would move and the list would receive it');
  order.forEach((node, i) => same(cards.children[i], node, 'and nothing moved'));

  over(button(demo, 'ui:apply'));
  equal(routeOf(demo), ['Page: unreached', 'Board: consume', 'Card “Write the docs”: continue'], 'Apply reaches the card and the board');
  equal(affected(demo), ['Write the docs: changes'], 'and the card would change');
  assert(demo.rehearsal.parentElement.querySelector('.rehearsal-head').textContent.includes('Card “Write the docs”: continue (1 operation) → Board: consume (1 effect) → Page: unreached'), 'the head is the route in one line');

  over(button(demo, 'ui:remove'));
  equal(affected(demo), ['the dock: receives', 'Write the docs: leaves', 'the toolbar: moves'], 'Remove would move the toolbar home and take the card');

  const cross = second.querySelector('.card-remove');
  over(cross);
  equal(affected(demo), ['Ship it: leaves'], 'the × on another card names only that card');
  cross.click();
  equal(second.isConnected, false, 'the card went');
  equal(routeOf(demo), [], 'the control that was rehearsed is gone, so the route is cleared');
  equal(affected(demo), [], 'and so are the marks');
  same(first.parentElement, cards, 'the first card is untouched');
  demo.dispose();
});

test('the toolbar can be put in any card, and Up then means that card', sandbox => {
  const demo = mountToolbarDemo(sandbox);
  go(demo, 'board');
  const cards = demo.rooms.board.element.querySelector('.cards');
  const [first, second] = cards.children;
  same(demo.toolbar.element.closest('.card'), first, 'from the place strip the toolbar lands in the first card');

  const dock = second.querySelector('.card-dock');
  over(dock);
  equal(routeOf(demo), ['Page: consume', 'Board: skipped', 'Card “Ship it”: skipped'], 'Toolbar here walks up through the card and the board to the page');
  equal(affected(demo), ['the toolbar: moves', 'the slot of “Ship it”: receives'], 'and would move the toolbar into this card');
  dock.click();
  same(demo.toolbar.element.closest('.card'), second, 'the toolbar is in the second card');
  equal(place(demo, 'board').getAttribute('aria-pressed'), 'true', 'and the board is still the pressed place');

  over(button(demo, 'ui:up'));
  equal(affected(demo), ['the cards: receives', 'Ship it: moves'], 'Up now marks the second card');
  button(demo, 'ui:up').click();
  same(cards.children[0], second, 'and moves it to the top');
  demo.dispose();
});

test('a lock on the slot consumes Remove before the card and the board, and unlocking gives them back', sandbox => {
  const demo = mountToolbarDemo(sandbox);
  go(demo, 'board');
  const cards = demo.rooms.board.element.querySelector('.cards');
  const card = demo.toolbar.element.closest('.card');
  const box = card.querySelector('.card-lock input');
  box.click();
  equal(box.checked, true, 'the card is locked');

  const remove = button(demo, 'ui:remove');
  const locked = rehearse(remove, 'ui:remove');
  equal(locked.interpreted.route.map(nameOf), ['Lock on “Write the docs”', 'Card “Write the docs”', 'Board', 'Page'], 'the lock is nearest');
  equal(locked.answers.map(each => each.state), ['consume', 'unreached', 'unreached', 'unreached'], 'it consumes, and nothing beyond it is asked');
  equal(locked.interpreted.operations.length, 0, 'with no operations');
  remove.click();
  same(card.parentElement, cards, 'the card stays');
  assert(status(demo).includes('locked'), `and the status says why: ${status(demo)}`);

  over(card.querySelector('.card-remove'));
  equal(routeOf(demo), ['Page: unreached', 'Board: consume', 'Card “Write the docs”: continue'], 'the × is beside the slot, so the lock is not on its route');

  box.click();
  const open = rehearse(remove, 'ui:remove');
  equal(open.answers.map(each => `${each.name}: ${each.state}`), ['Card “Write the docs”: continue', 'Board: consume', 'Page: unreached'], 'unlocked, the card continues and the board consumes');
  equal(open.interpreted.operations.map(each => each.op), ['move', 'remove'], "and the board's consume keeps the card's move ahead of its own remove");
  remove.click();
  equal(card.isConnected, false, 'the card went');
  same(demo.toolbar.element.parentElement, demo.dock, 'and the toolbar is home');
  demo.dispose();
});

const caption = (demo, type) => demo.toolbar.element.querySelector(`[data-intent="${type}"]`).getAttribute('aria-describedby');
const captionText = (demo, type) => document.getElementById(caption(demo, type)).textContent;
const refused = (demo, type) => button(demo, type).getAttribute('aria-disabled') === 'true';

test('a button says what it would do here, and its availability is the plan it would get', sandbox => {
  const demo = mountToolbarDemo(sandbox);
  equal(captionText(demo, 'ui:apply'), 'no room answers here', 'in the dock a caption says nobody answers');
  equal(refused(demo, 'ui:apply'), false, 'and the button is not refused, because nothing refused it');
  equal(captionText(demo, 'toolbar:next'), 'Put the toolbar in the Form', 'Next room says where it would go');

  go(demo, 'form');
  equal(captionText(demo, 'ui:apply'), 'The form is as committed.', 'a clean form refuses Apply and says why');
  equal(refused(demo, 'ui:apply'), true, 'so Apply is marked refused');
  equal(captionText(demo, 'ui:up'), 'no room answers here', 'Up has no meaning in a form');
  const name = demo.rooms.form.element.querySelector('input[name="name"]');
  name.value = 'Grace';
  name.dispatchEvent(new InputEvent('input', { bubbles: true }));
  equal(captionText(demo, 'ui:apply'), 'Commit 1 changed field', 'typing changed the caption');
  equal(refused(demo, 'ui:apply'), false, 'and Apply is available again');
  equal(captionText(demo, 'ui:cancel'), 'Revert 1 changed field', 'as is Cancel, with its own words');

  // A refused button still raises, and what runs is the refusal.
  name.value = 'Ada';
  name.dispatchEvent(new InputEvent('input', { bubbles: true }));
  equal(refused(demo, 'ui:cancel'), true, 'clean again, Cancel is refused');
  button(demo, 'ui:cancel').click();
  assert(latest(demo).includes('ui:cancel → consumed'), `pressing it raised all the same: ${latest(demo)}`);
  equal(status(demo), 'The form is clean.', 'and the refusal ran, as a plan');
  demo.dispose();
});

test('meanings compose along the route, and a lock refuses in its own words', sandbox => {
  const demo = mountToolbarDemo(sandbox);
  go(demo, 'board');
  equal(captionText(demo, 'ui:apply'), 'Tick “Write the docs”', 'the card says what Apply does');
  button(demo, 'ui:apply').click();
  equal(captionText(demo, 'ui:apply'), 'Untick “Write the docs”', 'and says the opposite once ticked');
  equal(captionText(demo, 'ui:remove'), 'Hand the toolbar back to the dock, then remove “Write the docs”', 'two rooms, one sentence, nearest first');
  equal(captionText(demo, 'ui:up'), '“Write the docs” is already at the top.', 'the board refuses Up on the first card');
  equal(refused(demo, 'ui:up'), true);

  const card = demo.toolbar.element.closest('.card');
  card.querySelector('.card-lock input').click();
  equal(captionText(demo, 'ui:remove'), '“Write the docs” is locked. Unlock it first.', 'the lock speaks first and alone');
  equal(refused(demo, 'ui:remove'), true, 'so Remove is refused');
  equal(captionText(demo, 'ui:down'), 'Move “Write the docs” down', 'while Down, which the lock does not answer, keeps its meaning');

  const cross = card.querySelector('.card-remove');
  equal(cross.getAttribute('aria-disabled'), 'false', 'the × is beside the slot, so the lock does not refuse it');
  equal(cross.title, 'Hand the toolbar back to the dock, then remove “Write the docs”', 'and its title says what it would do');
  equal(place(demo, 'board').getAttribute('aria-disabled'), 'true', 'the pressed place is refused, because the toolbar is already there');
  equal(place(demo, 'board').title, 'The toolbar is already in the Board.');
  equal(place(demo, 'form').title, 'Put the toolbar in the Form', 'and the others say where they lead');
  equal(demo.rooms.board.element.querySelectorAll('.card')[1].querySelector('.card-dock').title, 'Put the toolbar in “Ship it”', 'a card\'s own button names the card');
  demo.dispose();
});

test('the panel shows each room\'s words, and explain reports what interpret refuses', sandbox => {
  const demo = mountToolbarDemo(sandbox);
  go(demo, 'listbox');
  demo.rooms.listbox.element.querySelectorAll('.option')[1].click();
  button(demo, 'ui:up').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  const rows = demo.rehearsal.querySelectorAll('.answer');
  equal(rows[0].querySelector('.answer-meaning').textContent, 'would: Move Blueberry up', 'the row carries the meaning');
  button(demo, 'ui:cancel').click();
  button(demo, 'ui:up').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  equal(demo.rehearsal.querySelector('.answer-refused').textContent, 'refuses: Select an option first.', 'and a refusal');

  const host = document.createElement('div');
  const list = document.createElement('ul');
  const control = document.createElement('button');
  host.append(list, control);
  sandbox.append(host);
  const rows2 = region(list, { create: text => Object.assign(document.createElement('li'), { textContent: text }) });
  const sloppy = room(host, 'Sloppy', { 'x': () => { rows2.insert(['oops']); return { disposition: 'consume' }; } });
  const told = explain(control, 'x');
  equal(told.meaning, null);
  assert(told.refused.includes('no writes while interpreting'), `what interpret refuses is refused: ${told.refused}`);
  equal(told.answered, false);
  sloppy.dispose();
  demo.dispose();
});
