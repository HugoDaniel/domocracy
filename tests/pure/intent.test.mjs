// The intent layer without a browser. What a plan means when it holds more than
// one operation is decided here: which region executes each of them, how far a
// plan got when one fails, and what a scope's handle owns. The browser suite
// covers what needs real events and a real document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { op, region } from '../../domocracy.js';
import { scope, intent, effect } from '../../intent.js';
import { element, documentTree, recorder, text, fragment } from './tree.mjs';

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

test('a scope owns an element once, an intent type once, and an effect type once', () => {
  const { host, control } = room();
  const here = scope(host);
  assert.throws(() => scope(host), /already has a scope/);
  const off = here.handle('edit', () => plan());
  assert.throws(() => here.handle('edit', () => plan()), /already has an interpreter here/);
  off();
  off();   // the interpreter is already gone, and removing it again takes nothing
  here.handle('edit', () => ({ disposition: 'consume' }));
  assert.equal(intent(control, 'edit').disposition, 'consumed', 'the type is free again');
  const stop = effect('save', () => 'saved');
  assert.throws(() => effect('save', () => 'other'), /already has an adapter/);
  stop();
  stop();
  effect('save', () => 'the type is free again')();
  here.dispose();
});

test('an intent is raised from an element in the document, and never from inside an interpreter', () => {
  const { host, control } = room();
  const here = scope(host);
  assert.throws(() => intent(null, 'edit'), TypeError, 'no source at all');
  assert.throws(() => intent(text('go', control), 'edit'), TypeError, 'a node that is not an element');
  assert.throws(() => intent(element('span'), 'edit'), TypeError, 'an element in no document');
  here.handle('nested', () => { intent(control, 'edit'); });
  assert.throws(() => intent(control, 'nested'), /no intents while interpreting/);
  here.dispose();
});

test('an interpreter answers with one of three dispositions, and a passing plan proposes nothing', () => {
  const { host, control, list } = room();
  const here = scope(host);
  here.handle('bad', () => ({ disposition: 'maybe' }));
  assert.throws(() => intent(control, 'bad'), /returned the disposition "maybe"/);
  here.handle('operations', () => ({ disposition: 'pass', operations: [op.clear(list.container)] }));
  assert.throws(() => intent(control, 'operations'), /a passing plan proposed operations/);
  here.handle('effects', () => ({ disposition: 'pass', effects: [{ type: 'save' }] }));
  assert.throws(() => intent(control, 'effects'), /a passing plan proposed effects/);
  // A plan that passes and proposes nothing is what passing looks like, and so
  // are the two ways of answering with no plan at all.
  here.handle('empty', () => ({ disposition: 'pass', operations: [], effects: [] }));
  here.handle('nothing', () => null);
  here.handle('quiet', () => undefined);
  for (const type of ['empty', 'nothing', 'quiet']) {
    const result = intent(control, type);
    assert.equal(result.disposition, 'passed');
    assert.deepEqual(result.trace.map(step => step.disposition), ['pass'], type);
    assert.equal(result.operations.length, 0);
  }
  assert.equal(intent(control, 'unhandled').trace.length, 0, 'a scope with no interpreter for the type answers nothing');
  here.dispose();
});

test('a plan that moves a node then names it hands it to the region it lands in', () => {
  const { host, control, list } = room(rendering('A'));
  const other = region(element('ul'), rendering('B'), { items: [] });
  host.append(other.container);
  list.insert([{ name: 'a' }]);
  const a = list.nodes[0];
  const here = scope(host);
  here.handle('edit', () => plan(op.move(a, other.container, null), op.update(a, 'fresh')));
  intent(control, 'edit');
  assert.equal(a.parentNode, other.container);
  assert.equal(a.rendered, 'B:fresh', 'the region it landed in rendered the update');
  assert.deepEqual(other.items, ['fresh']);
  here.dispose();
});

test('a plan that clears the region an earlier operation moved a node into is refused', () => {
  const { host, control, list } = room();
  const other = region(element('ul'), recorder());
  host.append(other.container);
  list.insert([{ name: 'a' }]);
  const a = list.nodes[0];
  const here = scope(host);
  here.handle('edit', () => plan(op.move(a, other.container, null), op.clear(other.container), op.update(a, 'fresh')));
  // The clear empties the region the move put the node in, so by the third
  // operation the node is nowhere, and the plan changes nothing.
  assert.throws(() => intent(control, 'edit'), /operation 2 \(update\) names a container with no region/);
  assert.equal(a.parentNode, list.container, 'the move never ran');
  here.dispose();
});

test('a plan may carry a remove of nothing, which runs nothing', () => {
  const { host, control, list } = room();
  list.insert([{ name: 'a' }]);
  const a = list.nodes[0];
  const here = scope(host);
  const seen = [];
  const off = list.observe(group => seen.push(group[0].op));
  here.handle('edit', () => plan(op.remove([]), op.update(a, 'fresh')));
  const result = intent(control, 'edit');
  assert.equal(result.operations.length, 2, 'the plan says it, and the region never hears it');
  assert.deepEqual(seen, ['update']);
  assert.equal(a.data, 'fresh');
  off();
  here.dispose();
});

test('a plan that removes nodes from two containers is refused as written', () => {
  const { host, control, list } = room();
  const other = region(element('ul'), recorder());
  host.append(other.container);
  list.insert([{ name: 'a' }, { name: 'b' }]);
  other.insert([{ name: 'o' }]);
  const [a, b] = [list.nodes[0], list.nodes[1]];
  const here = scope(host);
  here.handle('edit', () => plan(op.update(a, 1), op.remove([b, other.nodes[0]])));
  assert.throws(() => intent(control, 'edit'), /operation 1 removes nodes from more than one container/);
  assert.equal(a.data, undefined, 'the operation before it never ran');
  here.dispose();
});

test('an observer that moves a node out of every region fails the operation that names it', () => {
  const { host, control, list } = room();
  const loose = element('ul');
  list.insert([{ name: 'a' }, { name: 'b' }]);
  const [a, b] = [list.nodes[0], list.nodes[1]];
  const off = list.observe(group => { if (group[0].entity === a) loose.append(b); });
  const here = scope(host);
  here.handle('edit', () => plan(op.update(a, 1), op.update(b, 2)));
  let error = null;
  try { intent(control, 'edit'); } catch (thrown) { error = thrown; }
  assert.match(error.message, /operation 1 \(update\) names a container with no region/);
  assert.equal(error.committed, 1, 'the first update ran');
  assert.equal(b.data, undefined);
  off();
  here.dispose();
});

test('an effect with no adapter fails, so does one that throws, and the next still runs', () => {
  const { host, control } = room();
  const here = scope(host);
  const seen = [];
  const off = effect('bad', () => { throw new Error('the effect failed'); });
  const stop = effect('good', request => { seen.push(request.payload); return 'ok'; });
  here.handle('edit', () => ({
    disposition: 'consume',
    effects: [{ type: 'missing' }, { type: 'bad' }, { type: 'good', payload: 'last' }],
  }));
  const result = intent(control, 'edit');
  assert.deepEqual(result.effects.map(done => done.status), ['failed', 'failed', 'done']);
  assert.match(result.effects[0].error.message, /no adapter for missing/);
  assert.match(result.effects[1].error.message, /the effect failed/);
  assert.equal(result.effects[2].result, 'ok');
  assert.deepEqual(seen, ['last'], 'a failure before it did not stop it');
  off();
  stop();
  here.dispose();
});

test('a plan that removes a node with no container is refused', () => {
  const { host, control, list } = room();
  const held = fragment(), stray = element('li');
  held.append(stray);
  list.insert([{ name: 'a' }]);
  const here = scope(host);
  here.handle('edit', () => plan(op.update(list.nodes[0], 'fresh'), op.remove([stray])));
  // The node has a parent, so the dry run lets the removal through, and that
  // parent is not an element, so there is no container for a region to be over.
  assert.throws(() => intent(control, 'edit'), /operation 1 \(remove\) names a container with no region/);
  assert.equal(list.nodes[0].data, undefined, 'the operation before it never ran');
  here.dispose();
});

test('a plan may remove a node and then move it into another region', () => {
  const { host, control, list } = room(rendering('A'));
  const other = region(element('ul'), rendering('B'), { items: [] });
  host.append(other.container);
  list.insert([{ name: 'a' }]);
  const a = list.nodes[0];
  const here = scope(host);
  here.handle('edit', () => plan(op.remove([a]), op.move(a, other.container, null)));
  intent(control, 'edit');
  // By the move the node is nowhere, so the region it lands in is the one that
  // executes it, and the node arrives the way any node from outside does.
  assert.equal(a.parentNode, other.container);
  assert.equal(list.length, 0);
  assert.deepEqual(other.items, [undefined], 'the mirror only ever names its own region');
  here.dispose();
});
