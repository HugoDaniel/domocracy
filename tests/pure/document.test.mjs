// The stand-in bridge, on its own. The editing surface is only as honest as
// this fake, so the five verbs it performs, the notifications it sends, its
// refusal of a stale revision and its undo are checked here, without a DOM.
// tests/surface.test.js then trusts them and tests the controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDocument, action, parse, format } from '../fake-document.mjs';

const VELOCITY = 'world:dust/velocity';
const LAYERS = 'world:dust/layers';
const NOISE = LAYERS + '/noise', GRAIN = LAYERS + '/grain', DRIFT = LAYERS + '/drift';

const bridge = () => fakeDocument({
  world: { dust: { velocity: 3, layers: { noise: 1, grain: 2, drift: 3 } } },
  program: { dust: { velocity: 7 } },
});

// The commit's own notification, so a test can read what the surface would.
const commit = (doc, ...actions) => doc.commit(actions, doc.revision);
const order = (doc, address) => Object.keys(doc.resolve(address).value);

test('an address names a root and a path', () => {
  assert.deepEqual(parse(NOISE), { root: 'world', path: ['dust', 'layers', 'noise'] });
  assert.equal(format('world', ['dust', 'layers', 'noise']), NOISE);
  assert.throws(() => parse('dust/velocity'), TypeError);
});

test('the same path in two roots is two addresses', () => {
  const doc = bridge();
  assert.equal(doc.resolve(VELOCITY).value, 3);
  assert.equal(doc.resolve('program:dust/velocity').value, 7);
  assert.equal(doc.resolve('world:dust/nothing'), null);
});

test('inspect answers with a lens or a refusal', () => {
  const doc = bridge();
  assert.equal(doc.inspect(VELOCITY).lens, 'number');
  assert.equal(doc.inspect(LAYERS).lens, 'form');
  assert.deepEqual(doc.inspect(LAYERS).offers, ['insert_positional', 'remove_positional']);
  const refusal = doc.inspect('world:dust/nothing').refused;
  assert.equal(refusal.what, 'world:dust/nothing');
  assert.deepEqual(refusal.offers, []);
});

test('replace commits a value and says what changed', () => {
  const doc = bridge();
  const heard = [];
  doc.subscribe(notification => heard.push(notification));
  const result = commit(doc, action('replace', VELOCITY, { value: 9 }));
  assert.equal(result.ok, true);
  assert.equal(result.revision, 2);
  assert.deepEqual(result.changes, [{ kind: 'value', address: VELOCITY, value: 9 }]);
  assert.equal(doc.resolve(VELOCITY).value, 9);
  assert.equal(heard.length, 1);
  assert.equal(heard[0].revision, 2);
});

test('set_keyword is replace with the keyword lens', () => {
  const doc = fakeDocument({ world: { dust: { mode: 'still' } } });
  commit(doc, action('set_keyword', 'world:dust/mode', { value: 'drifting' }));
  assert.equal(doc.resolve('world:dust/mode').value, 'drifting');
  assert.equal(doc.inspect('world:dust/mode').lens, 'keyword');
});

test('insert_positional adds a form at a position', () => {
  const doc = bridge();
  const result = commit(doc, action('insert_positional', LAYERS + '/haze', { position: 1, value: 5 }));
  assert.deepEqual(order(doc, LAYERS), ['noise', 'haze', 'grain', 'drift']);
  assert.deepEqual(result.changes, [{ kind: 'insert', address: LAYERS + '/haze', parent: LAYERS, position: 1, value: 5 }]);
});

test('insert_positional on a form that is there is a reorder', () => {
  const doc = bridge();
  const result = commit(doc, action('insert_positional', DRIFT, { position: 0 }));
  assert.deepEqual(order(doc, LAYERS), ['drift', 'noise', 'grain']);
  assert.equal(doc.resolve(DRIFT).value, 3);   // the form keeps its value
  assert.deepEqual(result.changes, [{ kind: 'move', address: DRIFT, parent: LAYERS, position: 0 }]);
});

test('remove_positional and remove_keyword take a form away', () => {
  const doc = bridge();
  const result = commit(doc, action('remove_positional', GRAIN));
  assert.deepEqual(order(doc, LAYERS), ['noise', 'drift']);
  assert.deepEqual(result.changes, [{ kind: 'remove', address: GRAIN }]);
  commit(doc, action('remove_keyword', NOISE));
  assert.deepEqual(order(doc, LAYERS), ['drift']);
});

test('a remove and an insert of the same address fuse into a move', () => {
  const doc = bridge();
  const result = commit(doc, action('remove_positional', NOISE), action('insert_positional', NOISE, { position: 2, value: 1 }));
  assert.deepEqual(result.changes, [{ kind: 'move', address: NOISE, parent: LAYERS, position: 2 }]);
  assert.deepEqual(order(doc, LAYERS), ['grain', 'drift', 'noise']);
});

test('a batch is one revision and one notification', () => {
  const doc = bridge();
  const heard = [];
  doc.subscribe(notification => heard.push(notification));
  commit(doc, action('replace', NOISE, { value: 10 }), action('replace', GRAIN, { value: 20 }));
  assert.equal(heard.length, 1);
  assert.equal(heard[0].changes.length, 2);
  assert.equal(doc.revision, 2);
});

test('a stale revision is a diagnostic and nothing is applied', () => {
  const doc = bridge();
  commit(doc, action('replace', VELOCITY, { value: 9 }));
  const result = doc.commit([action('replace', VELOCITY, { value: 11 })], 1);
  assert.equal(result.ok, false);
  assert.equal(result.revision, 2);
  assert.equal(result.diagnostics[0].code, 'stale-revision');
  assert.deepEqual(result.diagnostics[0].path, [VELOCITY]);
  assert.equal(doc.resolve(VELOCITY).value, 9);
});

test('an address with no parent is refused', () => {
  const doc = bridge();
  assert.throws(() => commit(doc, action('replace', 'world:nowhere/deep/value', { value: 1 })), RangeError);
  assert.throws(() => commit(doc, action('wrap', VELOCITY, { value: 1 })), TypeError);
});

test('a preview overrides without committing, over a checkpoint', () => {
  const doc = bridge();
  const heard = [];
  doc.subscribe(notification => heard.push(notification));
  const shown = doc.preview(VELOCITY, 42);
  assert.deepEqual(shown, { kind: 'value', address: VELOCITY, value: 42, preview: true });
  assert.equal(doc.previewing(VELOCITY), true);
  assert.equal(doc.resolve(VELOCITY).value, 3);   // the document is untouched
  assert.equal(doc.revision, 1);
  assert.equal(heard.length, 0);
  const back = doc.discard(VELOCITY);
  assert.deepEqual(back, { kind: 'value', address: VELOCITY, value: 3 });
  assert.equal(doc.previewing(VELOCITY), false);
  assert.deepEqual(doc.log, [{ call: 'checkpoint', address: VELOCITY }, { call: 'restore', address: VELOCITY }]);
});

test('undo is a commit like any other', () => {
  const doc = bridge();
  const heard = [];
  doc.subscribe(notification => heard.push(notification));
  commit(doc, action('replace', VELOCITY, { value: 9 }));
  const result = doc.undo();
  assert.equal(result.ok, true);
  assert.equal(result.revision, 3);          // undo moves time forward
  assert.deepEqual(result.changes, [{ kind: 'value', address: VELOCITY, value: 3 }]);
  assert.equal(doc.resolve(VELOCITY).value, 3);
  assert.equal(heard.length, 2);
});

test('undo puts a removed form back where it was', () => {
  const doc = bridge();
  commit(doc, action('remove_positional', GRAIN));
  assert.deepEqual(order(doc, LAYERS), ['noise', 'drift']);
  doc.undo();
  assert.deepEqual(order(doc, LAYERS), ['noise', 'grain', 'drift']);
  assert.equal(doc.resolve(GRAIN).value, 2);
});

test('undo reverses a batch in the order that restores it', () => {
  const doc = bridge();
  commit(doc, action('replace', NOISE, { value: 10 }), action('insert_positional', DRIFT, { position: 0 }));
  assert.deepEqual(order(doc, LAYERS), ['drift', 'noise', 'grain']);
  doc.undo();
  assert.deepEqual(order(doc, LAYERS), ['noise', 'grain', 'drift']);
  assert.equal(doc.resolve(NOISE).value, 1);
});

test('undo with nothing behind it is an info diagnostic', () => {
  const doc = bridge();
  const result = doc.undo();
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'nothing-to-undo');
  assert.equal(result.diagnostics[0].severity, 'info');
  assert.equal(doc.revision, 1);
});

test('unsubscribing stops the notifications', () => {
  const doc = bridge();
  const heard = [];
  const off = doc.subscribe(notification => heard.push(notification));
  commit(doc, action('replace', VELOCITY, { value: 9 }));
  off();
  commit(doc, action('replace', VELOCITY, { value: 11 }));
  assert.equal(heard.length, 1);
});
