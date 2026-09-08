// What domocracy decides at load, and the two names that need events.
//
// `move` and `isSection` are chosen once, from globals, so the rest of the pure
// suite always takes the branch a bare Node process gives: insertBefore, and
// no table sections. This file installs the other side of both before the
// module is evaluated, which is why domocracy arrives through `await import`
// and not through a static one.
//
// `on` and `dispatch` are here for the same reason: they need events that
// bubble, and the fake tree bubbles them. The browser suite covers what only
// Blink can answer; what is covered here is the matching itself, and the three
// targets that are not an element to match from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './platform.mjs';
import { element, text, documentTree, recorder } from './tree.mjs';

const { op, region, on, dispatch } = await import('../../domocracy.js');

const specs = (...names) => names.map(name => ({ name }));

test('a move inside one root keeps the node, and one between roots inserts it', () => {
  const doc = documentTree(), here = element('ul'), there = element('ul');
  doc.append(here);
  const mine = region(here, recorder()), theirs = region(there, recorder());
  mine.insert(specs('a', 'b'));
  theirs.insert(specs('o'));
  mine.moveAt(0, 1);
  assert.equal(here.moved, 1, 'moveBefore, the one that keeps focus and animations');
  // `there` is loose, so the two ends are in different roots and moveBefore
  // would refuse the node. The transfer inserts instead.
  theirs.move(there.children[0], null, mine);
  assert.equal(here.moved, 1, 'a transfer between roots is an insert');
  assert.equal(here.children.length, 3);
  assert.equal(there.children.length, 0);
});

test('a table section indexes its rows by the index the platform keeps', () => {
  const section = element('tbody');
  const rows = region(section, {
    create(spec) { const row = element('tr'); row.spec = spec; return row; },
    update(row, data) { row.data = data; },
  }, { items: [] });
  rows.insert(specs('one', 'two', 'three'));
  const second = section.children[1];
  assert.equal(second.sectionRowIndex, 1);
  assert.deepEqual(rows.at(second), { node: second, index: 1, item: { name: 'two' } });
  rows.updateAt(1, 'fresh');
  assert.equal(second.data, 'fresh');
  assert.deepEqual(rows.items, [{ name: 'one' }, 'fresh', { name: 'three' }]);
  // The mirror's own position refuses a node of another container, which a row
  // index would answer for.
  const loose = element('tr');
  element('tbody').append(loose);
  rows.execute(op.update(loose, 'elsewhere'));
  assert.equal(loose.data, 'elsewhere');
  assert.deepEqual(rows.items, [{ name: 'one' }, 'fresh', { name: 'three' }]);
});

test('on matches by selector, inside the root, in registration order', () => {
  const doc = documentTree(), section = element('section'), card = element('div', { class: 'card' }), button = element('button');
  doc.append(section);
  section.append(card);
  card.append(button);
  const seen = [];
  const off = on(section, 'click', 'button', (event, match) => seen.push('button:' + match.tag));
  on(section, 'click', '.card', (event, match) => seen.push('card:' + match.getAttribute('class')));
  // A rule whose match is above its own root never runs: the selector finds the
  // section, and the card does not contain it.
  on(card, 'click', 'section', () => seen.push('above the root'));
  dispatch(button, 'click');
  assert.deepEqual(seen, ['button:button', 'card:card']);
  seen.length = 0;
  off();
  dispatch(button, 'click');
  assert.deepEqual(seen, ['card:card'], 'a removed rule is gone');
  seen.length = 0;
  on(section, 'other', 'button', () => seen.push('other'));
  dispatch(button, 'other');
  assert.deepEqual(seen, ['other'], 'a second type on a root that already has one');
});

test('a rule that stops the event ends the matching', () => {
  const doc = documentTree(), section = element('section'), button = element('button');
  doc.append(section);
  section.append(button);
  const seen = [];
  on(section, 'click', 'button', event => { seen.push('first'); event.stopPropagation(); });
  on(section, 'click', 'button', () => seen.push('second'));
  on(doc, 'click', 'button', () => seen.push('the document'));
  dispatch(button, 'click');
  assert.deepEqual(seen, ['first'], 'the rules after it and the roots above it');
});

test('a target that is not an element is matched from its parent, or not at all', () => {
  const doc = documentTree(), section = element('section'), button = element('button');
  doc.append(section);
  section.append(button);
  const seen = [];
  on(doc, 'click', 'button', (event, match) => seen.push(match.tag));
  dispatch(text('go', button), 'click');
  assert.deepEqual(seen, ['button'], 'the text inside a control is the control');
  seen.length = 0;
  // The document is not an element and answers no selector, so an event raised
  // on the text directly under it matches nothing.
  dispatch(text('loose', doc), 'click');
  assert.deepEqual(seen, []);
  // The path is read when the dispatch starts, so a listener may detach the
  // target before the rules are asked about it.
  const going = text('going', button);
  on(section, 'click', 'button', () => going.remove());
  dispatch(going, 'click');
  assert.deepEqual(seen, [], 'a target detached in flight is nowhere');
});

test('dispatch bubbles an action and says whether a room took it up', () => {
  const doc = documentTree(), music = element('div'), research = element('div'), card = element('div', { class: 'card' });
  doc.append(music, research);
  const played = [], opened = [];
  on(music, 'activate', '.card', event => { played.push(event.detail); event.preventDefault(); });
  on(research, 'activate', '.card', event => { opened.push(event.detail); });
  music.append(card);
  assert.equal(dispatch(card, 'activate', 'sample'), false, 'a handled action returns false');
  research.append(card);
  assert.equal(dispatch(card, 'activate', 'source'), true, 'a handler that does not take it up leaves it true');
  assert.deepEqual([played, opened], [['sample'], ['source']], 'the same card means what the room says');
  doc.append(card);
  assert.equal(dispatch(card, 'activate', 'nowhere'), true, 'an action nobody handles');
  assert.deepEqual([played, opened], [['sample'], ['source']]);
});
