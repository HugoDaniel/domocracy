// The intent layer without a browser. What a plan means when it holds more than
// one operation is decided here: which region executes each of them, how far a
// plan got when one fails, and what a scope's handle owns. The browser suite
// covers what needs real events and a real document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { op, region } from '../../domocracy.js';
import { scope, intent, effect } from '../../intent.js';
import { element, documentTree, recorder } from './tree.mjs';

// A room in a document, with a region inside it and a control to raise from.
function room(adapter = recorder()) {
  const doc = documentTree(), host = element('div'), control = element('span');
  doc.append(host);
  host.append(control);
  const list = region(element('ul'), adapter);
  host.append(list.container);
  return { doc, host, control, list };
}
const plan = (...operations) => ({ disposition: 'consume', operations });

// An adapter that says which region rendered a node, so a test can see which one
// executed an operation.
const rendering = tag => ({
  create(spec) { const node = element('li'); node.spec = spec; node.rendered = tag + ':' + spec.name; return node; },
  update(node, data) { node.rendered = tag + ':' + data; },
});
const names = list => Array.from(list.nodes, node => node.spec?.name);

test('a plan can update one node and remove another', () => {
  const { host, control, list } = room();
  list.insert([{ name: 'a' }, { name: 'b' }]);
  const [a, b] = [list.nodes[0], list.nodes[1]];
  const here = scope(host);
  here.handle('edit', () => plan(op.update(a, 'fresh'), op.remove([b])));
  const result = intent(control, 'edit');
  assert.equal(result.operations.length, 2);
  assert.equal(a.data, 'fresh');
  assert.deepEqual(names(list), ['a']);
  here.dispose();
});

test('a plan can remove a node and insert in its place', () => {
  const { host, control, list } = room();
  list.insert([{ name: 'a' }, { name: 'b' }]);
  const a = list.nodes[0];
  const here = scope(host);
  here.handle('edit', () => plan(op.remove([a]), op.insert(list.container, list.nodes[1], [{ name: 'c' }])));
  intent(control, 'edit');
  assert.deepEqual(names(list), ['c', 'b']);
  here.dispose();
});

test('a plan that names a container with no region changes nothing', () => {
  const { host, control, list } = room();
  list.insert([{ name: 'a' }]);
  const loose = element('ul'), stray = element('li');
  loose.append(stray);
  const here = scope(host);
  here.handle('edit', () => plan(op.update(list.nodes[0], 'fresh'), op.remove([stray])));
  assert.throws(() => intent(control, 'edit'), /names a container with no region/);
  assert.equal(list.nodes[0].data, undefined, 'the operation before it did not run either');
  here.dispose();
});

test('a plan that clears a region and then names a child of it is refused first', () => {
  const { host, control, list } = room();
  list.insert([{ name: 'a' }]);
  const a = list.nodes[0];
  const here = scope(host);
  here.handle('edit', () => plan(op.clear(list.container), op.update(a, 1)));
  // The clear empties the region, so the update names a node that will be
  // nowhere. The plan was wrong when it was written and nothing of it runs.
  assert.throws(() => intent(control, 'edit'), /names a container with no region/);
  assert.equal(list.length, 1, 'the region was not cleared on the way to finding out');
  here.dispose();
});

test('a failing plan says how many of its operations committed', () => {
  const { host, control, list } = room({ create: () => element('li'), update() { throw new Error('render failed'); } });
  list.insert([{}, {}]);
  const [first, second] = [list.nodes[0], list.nodes[1]];
  const here = scope(host);
  here.handle('edit', () => plan(op.remove([first]), op.update(second, 1)));
  let error = null;
  try { intent(control, 'edit'); } catch (thrown) { error = thrown; }
  assert.match(error.message, /render failed/);
  assert.equal(error.committed, 1, 'the index counts the plan, not the group of one it ran in');
  assert.equal(list.length, 1);
  here.dispose();
});

test('an observer that invalidates the rest of a plan fails it where it stands', () => {
  const { host, control, list } = room();
  list.insert([{ name: 'a' }, { name: 'b' }]);
  const [a, b] = [list.nodes[0], list.nodes[1]];
  // The rule: a write from an observer is allowed and every operation is
  // checked again as it runs, so a plan the write invalidates fails there.
  const off = list.observe(group => { if (group[0].op === 'update') list.remove(b); });
  const here = scope(host);
  here.handle('edit', () => plan(op.update(a, 'fresh'), op.insert(list.container, b, [{ name: 'c' }])));
  let error = null;
  try { intent(control, 'edit'); } catch (thrown) { error = thrown; }
  assert.ok(error instanceof RangeError);
  assert.equal(error.committed, 1, 'the update ran, the insert never started');
  assert.equal(a.data, 'fresh');
  assert.deepEqual(names(list), ['a']);
  off();
  here.dispose();
});

test('an observer that moves a node hands the next operation to its new region', () => {
  // A write from inside a plan is allowed, so the plan cannot also assume the
  // tree it was written against: the region that owns each operation is read
  // when its turn comes.
  const { host, control, list } = room(rendering('A'));
  const other = region(element('ul'), rendering('B'), { items: [] });
  host.append(other.container);
  list.insert([{ name: 'trigger' }, { name: 'x' }]);
  const [trigger, x] = [list.nodes[0], list.nodes[1]];
  const off = list.observe(group => { if (group[0].op === 'update' && group[0].entity === trigger) list.move(x, null, other); });
  const here = scope(host);
  here.handle('edit', () => plan(op.update(trigger, 'go'), op.update(x, 'new')));
  intent(control, 'edit');
  assert.equal(x.parentNode, other.container, 'the observer moved it');
  assert.equal(x.rendered, 'B:new', 'and the region it landed in rendered the update');
  assert.deepEqual(other.items, ['new'], 'in the mirror it landed in');
  off();
  here.dispose();
});

test('an observer that throws leaves its operation committed', () => {
  const { host, control, list } = room();
  list.insert([{ name: 'a' }, { name: 'b' }]);
  const [a, b] = [list.nodes[0], list.nodes[1]];
  const off = list.observe(group => { if (group[0].entity === b) throw new Error('observer failed'); });
  const here = scope(host);
  here.handle('edit', () => plan(op.update(a, 1), op.update(b, 2)));
  let error = null;
  try { intent(control, 'edit'); } catch (thrown) { error = thrown; }
  assert.match(error.message, /observer failed/);
  assert.equal(error.committed, 2, 'both updates ran; the second one\'s notification is what failed');
  assert.equal(b.data, 2);
  off();
  here.dispose();
});

test('a plan whose removal an observer scattered is refused, not divided', () => {
  const { host, control, list } = room();
  const other = region(element('ul'), recorder());
  host.append(other.container);
  list.insert([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
  const [a, b, c] = [list.nodes[0], list.nodes[1], list.nodes[2]];
  const off = list.observe(group => { if (group[0].op === 'update') list.move(c, null, other); });
  const here = scope(host);
  here.handle('edit', () => plan(op.update(a, 1), op.remove([b, c])));
  let error = null;
  try { intent(control, 'edit'); } catch (thrown) { error = thrown; }
  assert.match(error.message, /removes nodes from more than one container/);
  assert.equal(error.committed, 1, 'the update ran and the removal never started');
  assert.equal(list.length, 2, 'both nodes it named are still where they are');
  off();
  here.dispose();
});

test('a disposed handle does not take the scope that replaced it', () => {
  const { host, control } = room();
  const first = scope(host);
  first.dispose();
  const second = scope(host);
  second.handle('edit', () => ({ disposition: 'consume' }));
  first.dispose();
  assert.equal(intent(control, 'edit').disposition, 'consumed');
  second.dispose();
});

test('an interpreter cannot write, and an effect runs after the operations', () => {
  const { host, control, list } = room();
  list.insert([{ name: 'a' }]);
  const here = scope(host);
  here.handle('bad', () => { list.insert([{ name: 'x' }]); return plan(); });
  assert.throws(() => intent(control, 'bad'), /no writes while interpreting/);
  here.handle('good', () => ({ disposition: 'consume', operations: [op.update(list.nodes[0], 1)], effects: [{ type: 'save' }] }));
  const seen = [];
  const off = effect('save', () => { seen.push(list.nodes[0].data); return 'saved'; });
  const result = intent(control, 'good');
  assert.deepEqual(seen, [1], 'the effect saw the operations already applied');
  assert.equal(result.effects[0].status, 'done');
  off();
  here.dispose();
});
