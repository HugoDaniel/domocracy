// The editing surface without a browser. What a change record turns into is
// decided against the tree as the call finds it, so the questions here are
// which controls a record names, where a position lands, and what a
// notification leaves behind when one of its records cannot run. The browser
// suite drives the same module through real controls and a real bridge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { region, regionOf, guard } from '../../domocracy.js';
import { addressOf, controlsFor, operationsFor, apply } from '../../surface.js';
import { element, documentTree } from './tree.mjs';

const VELOCITY = 'world:dust/velocity';
const LAYERS = 'world:dust/layers';
const NOISE = LAYERS + '/noise', GRAIN = LAYERS + '/grain', DRIFT = LAYERS + '/drift';

// A control is an element that says which address it presents.
const control = (tag, address) => element(tag, { 'data-address': address });

// What a form container renders through. The record is the payload both ways:
// `create` reads the value of a new form and writes the address into the node,
// `update` takes the value of one that is already there.
const rendering = () => ({
  create(record) { const node = control('li', record.address); node.value = record.value; return node; },
  update(node, record) { node.value = record.value; },
});

const addresses = nodes => Array.from(nodes, node => node.dataset.address);
const values = nodes => Array.from(nodes, node => node.value);

// A surface: the document, an inspector holding two presentations of one
// address, and a region whose children are the forms under another. The label
// presents the same address as the region and is not a container.
function surface() {
  const doc = documentTree();
  const app = element('div');
  doc.append(app);
  const knob = control('div', VELOCITY), readout = control('span', VELOCITY);
  const forms = control('ul', LAYERS), label = control('span', LAYERS);
  app.append(knob, readout, forms, label);
  const list = region(forms, rendering());
  list.insert([{ address: NOISE, value: 1 }, { address: GRAIN, value: 2 }, { address: DRIFT, value: 3 }]);
  return { doc, app, knob, readout, forms, label, list };
}

test('controlsFor finds every presentation of an address, whatever it spells', () => {
  const { doc, knob, readout, forms, label } = surface();
  const quoted = control('div', 'world:say/"hi"\\there');
  doc.children[0].append(quoted);
  assert.deepEqual(controlsFor(doc, VELOCITY), [knob, readout], 'a knob and the number beside it');
  assert.deepEqual(controlsFor(doc, LAYERS), [forms, label]);
  assert.deepEqual(controlsFor(doc, 'world:say/"hi"\\there'), [quoted], 'a quote and a backslash survive the quoting');
  assert.deepEqual(controlsFor(doc, 'world:dust/nothing'), [], 'an address this surface does not present');
});

test('addressOf answers with the control an element is in, or null', () => {
  const { app, knob } = surface();
  const grip = element('span');
  knob.append(grip);
  assert.equal(addressOf(grip), VELOCITY, 'a pointer landing inside a knob');
  assert.equal(addressOf(knob), VELOCITY, 'the control is inside itself');
  assert.equal(addressOf(app), null, 'an element in no control');
});

test('a value record updates every control of its address and nothing else', () => {
  const { doc, knob, readout, list } = surface();
  const operations = operationsFor(doc, [{ kind: 'value', address: VELOCITY, value: 7 }]);
  assert.equal(operations.length, 2);
  assert.deepEqual(operations.map(o => o.op), ['update', 'update']);
  assert.deepEqual(operations.map(o => o.entity), [knob, readout]);
  assert.equal(operationsFor(doc, [{ kind: 'value', address: 'world:dust/nothing', value: 7 }]).length, 0);
  // A form inside a region is a control like any other, and its update is one
  // the region executes.
  const one = operationsFor(doc, [{ kind: 'value', address: GRAIN, value: 9 }]);
  assert.deepEqual(one.map(o => o.entity), [list.nodes[1]]);
});

test('an insert names the regions presenting the parent, and a position is an anchor', () => {
  const { doc, forms } = surface();
  const record = { kind: 'insert', address: 'world:dust/layers/haze', parent: LAYERS, position: 1, value: 4 };
  const operations = operationsFor(doc, [record]);
  assert.equal(operations.length, 1, 'the label presenting the same address is not a container');
  assert.equal(operations[0].region, forms);
  assert.equal(operations[0].before, forms.children[1]);
  assert.deepEqual(operations[0].specs, [record], 'the record is the spec');
  const atEnd = operationsFor(doc, [{ ...record, position: 3 }]);
  assert.equal(atEnd[0].before, null, 'the end of the region has no anchor');
  assert.equal(operationsFor(doc, [{ ...record, parent: 'world:dust/nothing' }]).length, 0);
});

test('a move counts its position in the container without the node that leaves', () => {
  const { doc, app, list } = surface();
  const [noise, , drift] = list.nodes;
  const forwards = operationsFor(doc, [{ kind: 'move', address: NOISE, parent: LAYERS, position: 2 }]);
  assert.equal(forwards[0].before, null, 'the last position, counted without the node itself');
  const backwards = operationsFor(doc, [{ kind: 'move', address: DRIFT, parent: LAYERS, position: 0 }]);
  assert.equal(backwards[0].before, noise);
  const middle = operationsFor(doc, [{ kind: 'move', address: DRIFT, parent: LAYERS, position: 1 }]);
  assert.equal(middle[0].before, list.nodes[1]);
  assert.equal(drift.parentNode, list.container, 'asking moved nothing');
  // Two presentations a move says nothing about: one whose container is not a
  // region, and one whose parent is not an element at all.
  const loose = control('li', NOISE);
  app.append(loose);
  const stray = control('div', NOISE);
  doc.append(stray);
  assert.equal(operationsFor(doc, [{ kind: 'move', address: NOISE, parent: LAYERS, position: 1 }]).length, 1);
});

test('a remove names the controls that go, grouped by the container they leave', () => {
  const { doc, app, list } = surface();
  const [noise] = list.nodes;
  const elsewhere = region(control('ul', LAYERS), rendering());
  app.append(elsewhere.container);
  elsewhere.insert([{ address: NOISE, value: 1 }]);
  const stray = control('div', NOISE);
  doc.append(stray);   // a control whose parent is not an element is in no container
  const operations = operationsFor(doc, [{ kind: 'remove', address: NOISE }]);
  assert.deepEqual(operations.map(o => o.op), ['remove', 'remove']);
  assert.deepEqual(operations.map(o => o.entities), [[noise], [elsewhere.nodes[0]]]);
  // Two presentations of one address in one container are one operation.
  list.insert([{ address: NOISE, value: 1 }]);
  const grouped = operationsFor(doc, [{ kind: 'remove', address: NOISE }]);
  assert.deepEqual(grouped.map(o => o.entities.length), [2, 1]);
});

test('a record the surface cannot read is a failure, not a change', () => {
  const { doc } = surface();
  assert.throws(() => operationsFor(doc, [{ kind: 'rename', address: NOISE }]), /unknown change "rename"/);
});

test('apply resolves each record against the tree the records before it left', () => {
  const { doc, list } = surface();
  const ran = apply(doc, [
    { kind: 'insert', address: 'world:dust/layers/haze', parent: LAYERS, position: 1, value: 4 },
    { kind: 'value', address: 'world:dust/layers/haze', value: 5 },
    { kind: 'move', address: NOISE, parent: LAYERS, position: 3 },
    { kind: 'remove', address: GRAIN },
  ]);
  assert.deepEqual(addresses(list.nodes), ['world:dust/layers/haze', DRIFT, NOISE]);
  assert.deepEqual(values(list.nodes), [5, 3, 1]);
  assert.deepEqual(ran.map(o => o.op), ['insert', 'update', 'move', 'remove']);
  assert.ok(Object.isFrozen(ran));
});

test('a control outside every region is rendered through the surface adapter', () => {
  const { doc, knob, readout } = surface();
  const seen = [];
  const ran = apply(doc, [{ kind: 'value', address: VELOCITY, value: 7 }], {
    create() { throw new Error('nothing here creates'); },
    update(node, record) { seen.push(node); node.value = record.value; },
  });
  assert.deepEqual(seen, [knob, readout]);
  assert.deepEqual(values([knob, readout]), [7, 7]);
  assert.equal(ran.length, 2);
  assert.throws(() => apply(doc, [{ kind: 'value', address: VELOCITY, value: 8 }]), /needs an adapter to update a control outside a region/);
});

test('a notification that fails partway says how many operations ran', () => {
  const { doc, list } = surface();
  let error = null;
  try {
    apply(doc, [
      { kind: 'value', address: NOISE, value: 9 },
      { kind: 'rename', address: GRAIN },
      { kind: 'value', address: DRIFT, value: 9 },
    ]);
  } catch (thrown) { error = thrown; }
  assert.match(error.message, /unknown change "rename"/);
  assert.equal(error.committed, 1, 'the record before it is applied and the one after it never ran');
  assert.deepEqual(values(list.nodes), [9, 2, 3]);
});

test('a removal scattered by an observer leaves each control through the region it is in now', () => {
  const { doc, app, list } = surface();
  const elsewhere = region(element('ul'), rendering());
  app.append(elsewhere.container);
  const twin = control('li', NOISE);
  list.container.append(twin);
  const [noise] = list.nodes;
  // The record names both presentations as one operation. Moving one of them
  // between the two removes is what `divide` is for.
  const off = list.observe(() => { if (twin.parentNode === list.container) elsewhere.container.append(twin); });
  apply(doc, [{ kind: 'remove', address: NOISE }]);
  assert.equal(noise.parentNode, null);
  assert.equal(twin.parentNode, null);
  off();
});

test('no surface writes while an interpreter runs', () => {
  const { doc } = surface();
  guard.reason = 'an intent is being interpreted';
  try {
    assert.throws(() => apply(doc, [{ kind: 'value', address: NOISE, value: 9 }]), /no writes while/);
  } finally {
    guard.reason = null;
  }
  assert.equal(regionOf(element('ul')), null);
});
