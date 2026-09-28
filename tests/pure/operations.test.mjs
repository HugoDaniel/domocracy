// The kernel without a browser. `validate` is the whole checking half of an
// execute, and a region over the fake tree drives the mirror, so the three
// pieces that decide whether a group is legal and what it leaves behind are
// tested here in milliseconds. The browser suite covers what only Blink can
// answer: moveBefore, shadow roots, custom element reactions, table sections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { op, validate, apply, region, regionOf, ownerOf, divide, guard } from '../../domocracy.js';
import { element, branch, recorder } from './tree.mjs';

const specs = (...names) => names.map(name => ({ name }));

test('validate freezes what it returns and wraps a single operation', () => {
  const parent = branch(1);
  const one = validate(op.clear(parent));
  assert.equal(one.length, 1);
  assert.ok(Object.isFrozen(one));
  assert.ok(Object.isFrozen(one[0]));
  const many = validate([op.remove([parent.children[0]]), op.clear(parent)]);
  assert.equal(many.length, 2);
  assert.ok(Object.isFrozen(many));
});

test('an operation names the specs and entities it was built with', () => {
  const parent = branch(1), child = parent.children[0];
  const mine = specs('a');
  const insert = op.insert(parent, null, mine);
  mine.push({ name: 'b' });
  assert.equal(insert.specs.length, 1);
  const entities = [child];
  const remove = op.remove(entities);
  entities.length = 0;
  assert.equal(remove.entities.length, 1);
});

test('check refuses the operations that cannot run', () => {
  const parent = branch(2), [first, second] = parent.children;
  const orphan = element('li'), elsewhere = branch(1);
  assert.throws(() => op.insert(parent, null, 'nope'), TypeError, 'a builder refuses a non-array where it enters');
  assert.throws(() => op.remove('nope'), TypeError);
  assert.throws(() => validate(op.insert(parent, elsewhere.children[0], specs('a'))), RangeError);
  assert.throws(() => validate(op.move(first, parent, first)), RangeError);
  assert.throws(() => validate(op.move(parent, first, null)), RangeError);
  assert.throws(() => validate(op.remove([orphan])), RangeError);
  assert.throws(() => validate(op.remove([first, orphan])), RangeError);
  assert.throws(() => validate({ op: 'paint', region: parent }), TypeError);
  // The ones that are legal say nothing and change nothing.
  assert.equal(validate(op.move(second, parent, first)).length, 1);
  assert.equal(parent.children[0], first);
});

test('validate reads the tree and changes nothing', () => {
  const parent = branch(1), child = parent.children[0];
  validate(op.remove([child]));
  assert.equal(child.parentNode, parent);   // checking is not doing
  child.remove();
  assert.throws(() => validate(op.remove([child])), RangeError);
});

test('a group is checked as the operations before it would leave things', () => {
  const parent = branch(3), [first, second, third] = parent.children;
  // The anchor is gone by the time the insert would run, so the group is
  // refused before the remove is applied.
  assert.throws(() => validate([op.remove([second]), op.insert(parent, second, specs('a'))]), RangeError);
  assert.equal(parent.children.length, 3);
  // The same two the other way round is fine: the anchor is still there.
  assert.equal(validate([op.insert(parent, second, specs('a')), op.remove([second])]).length, 2);
  // A clear empties the container, so a later anchor inside it is gone too.
  assert.throws(() => validate([op.clear(parent), op.insert(parent, third, specs('a'))]), RangeError);
  assert.throws(() => validate([op.clear(parent), op.remove([first])]), RangeError);
});

test('a group sees a cycle that only exists after an earlier move', () => {
  const outer = element('ul'), middle = element('li'), inner = element('ul');
  outer.append(middle);
  const loose = element('ul');
  loose.append(inner);
  // Moving inner under middle makes outer an ancestor of inner, so moving
  // outer into inner afterwards would be a cycle. Neither move is a cycle on
  // its own against the live tree.
  assert.throws(() => validate([op.move(inner, middle, null), op.move(outer, inner, null)]), RangeError);
  assert.equal(inner.parentNode, loose);
});

test('a group cannot name the nodes an insert would create', () => {
  const parent = branch(1);
  const group = validate([op.insert(parent, null, specs('a')), op.clear(parent)]);
  assert.equal(group.length, 2);
});

test('apply is the only half that writes', () => {
  const parent = element('ul'), adapter = recorder();
  apply(op.insert(parent, null, specs('a', 'b')), adapter);
  assert.deepEqual(parent.children.map(node => node.spec.name), ['a', 'b']);
  apply(op.move(parent.children[1], parent, parent.children[0]), adapter);
  assert.deepEqual(parent.children.map(node => node.spec.name), ['b', 'a']);
  apply(op.update(parent.children[0], 'fresh'), adapter);
  assert.equal(parent.children[0].data, 'fresh');
  apply(op.remove([parent.children[0]]), adapter);
  assert.equal(parent.children.length, 1);
  apply(op.clear(parent), adapter);
  assert.equal(parent.children.length, 0);
});

test('an insert that throws halfway leaves no trace', () => {
  const parent = branch(1);
  const adapter = { create(spec) { if (spec.name === 'b') throw new Error('no'); return element('li'); } };
  assert.throws(() => apply(op.insert(parent, null, specs('a', 'b', 'c')), adapter), /no/);
  assert.equal(parent.children.length, 1);
});

test('one region per container', () => {
  const parent = element('ul');
  const first = region(parent, recorder());
  assert.throws(() => region(parent, recorder()), /already has a region/);
  assert.equal(regionOf(parent), first);
  assert.equal(regionOf(element('ul')), null);
});

test('a region without a mirror keeps nothing', () => {
  const list = region(element('ul'), recorder());
  list.insert(specs('a', 'b'));
  assert.equal(list.items, null);
  assert.equal(list.length, 2);
  assert.equal(list.at(list.nodes[1]).index, 1);
  assert.equal(list.at(list.nodes[1]).item, undefined);
});

test('the mirror counts as the children do', () => {
  const parent = branch(2);
  assert.throws(() => region(parent, recorder(), { items: ['only one'] }), RangeError);
  assert.throws(() => region(parent, recorder(), { items: 'two' }), TypeError);
  const kept = region(parent, recorder(), { items: ['a', 'b'] });
  assert.deepEqual(kept.items, ['a', 'b']);
  assert.ok(Object.isFrozen(kept.items));
});

test('the mirror follows every operation', () => {
  const list = region(element('ul'), recorder(), { items: [] });
  list.insert(specs('a', 'c'));
  assert.deepEqual(list.items.map(item => item.name), ['a', 'c']);
  list.insert(specs('b'), list.nodes[1]);
  assert.deepEqual(list.items.map(item => item.name), ['a', 'b', 'c']);
  list.update(list.nodes[0], { name: 'A' });
  assert.deepEqual(list.items.map(item => item.name), ['A', 'b', 'c']);
  list.move(list.nodes[0], null);
  assert.deepEqual(list.items.map(item => item.name), ['b', 'c', 'A']);
  list.remove([list.nodes[0], list.nodes[2]]);
  assert.deepEqual(list.items.map(item => item.name), ['c']);
  list.clear();
  assert.deepEqual(list.items, []);
  assert.ok(Object.isFrozen(list.items));
});

test('a swap is one group of two moves and the mirror follows both', () => {
  const list = region(element('ul'), recorder(), { items: [] });
  list.insert(specs('a', 'b', 'c', 'd'));
  const seen = [];
  list.observe(group => seen.push(group.length));
  list.swap(0, 3);
  assert.deepEqual(list.items.map(item => item.name), ['d', 'b', 'c', 'a']);
  assert.deepEqual(list.nodes.map(node => node.spec.name), ['d', 'b', 'c', 'a']);
  list.swap(2, 1);   // said the other way round, the same exchange
  assert.deepEqual(list.items.map(item => item.name), ['d', 'c', 'b', 'a']);
  list.swap(list.nodes[0], list.nodes[0]);
  assert.deepEqual(seen, [2, 2, 0]);
});

test('the item travels with a move between regions', () => {
  const here = region(element('ul'), recorder(), { items: [] });
  const there = region(element('ul'), recorder(), { items: [] });
  here.insert(specs('a', 'b'));
  there.insert(specs('x'));
  here.move(here.nodes[1], there.nodes[0], there);
  assert.deepEqual(here.items.map(item => item.name), ['a']);
  assert.deepEqual(there.items.map(item => item.name), ['b', 'x']);
  assert.equal(there.length, 2);
});

test('the mirrors follow a move whichever region runs it', () => {
  const here = region(element('ul'), recorder(), { items: [] });
  const there = region(element('ul'), recorder(), { items: [] });
  here.insert(specs('a'));
  const a = here.nodes[0];
  // The region a group is executed on is not necessarily the one the node is in
  // when each operation runs, so ownership is read from the tree per operation.
  here.execute([op.move(a, there.container, null), op.move(a, here.container, null)]);
  assert.equal(a.parentNode, here.container);
  assert.deepEqual(here.items.map(item => item?.name), ['a']);
  assert.deepEqual(there.items, []);
  // The same round trip said from the other side means the same thing.
  there.execute([op.move(a, there.container, null), op.move(a, here.container, null)]);
  assert.deepEqual(here.items.map(item => item?.name), ['a']);
  assert.deepEqual(there.items, []);
});

test('a move whose two ends are one region is a reorder, not a transfer', () => {
  const here = region(element('ul'), recorder(), { items: [] });
  const there = region(element('ul'), recorder(), { items: [] });
  const runner = region(element('ul'), recorder(), { items: [] });
  here.insert(specs('x'));
  there.insert(specs('y'));
  const x = here.nodes[0], y = there.nodes[0];
  // The first move is a transfer, the second a reorder inside the destination.
  // Read as a transfer, the second would take the item out at one position and
  // put it back at another, both counted in the array as it was, and x would be
  // in the mirror twice.
  runner.execute([op.move(x, there.container, null), op.move(x, there.container, y)]);
  assert.deepEqual(there.nodes.map(node => node.spec.name), ['x', 'y']);
  assert.deepEqual(there.items.map(item => item.name), ['x', 'y']);
  assert.deepEqual(here.items, []);
});

test('an observer that throws is a failure after the group applied', () => {
  const list = region(element('ul'), recorder(), { items: [] });
  list.insert(specs('a'));
  const off = list.observe(() => { throw new Error('observer failed'); });
  let error = null;
  try { list.execute([op.update(list.nodes[0], 'fresh'), op.update(list.nodes[0], 'fresher')]); } catch (thrown) { error = thrown; }
  assert.match(error.message, /observer failed/);
  assert.equal(error.committed, 2, 'both operations applied; it was the notification that failed');
  assert.equal(list.nodes[0].data, 'fresher');
  off();
});

test('a group is validated once, so a write from inside it is outside that check', () => {
  // The contract of a group, said as a test: one dry run for the whole group,
  // and an adapter that writes is beyond what the dry run saw. A plan and a
  // notification are the sequences that check each operation as it runs.
  const list = region(element('ul'), { create: () => element('li'), update(node) { node.nextSibling?.remove(); } });
  list.insert([{}, {}]);
  const doomed = list.nodes[1];
  list.execute([op.update(list.nodes[0], 1), op.remove([doomed])]);
  assert.equal(list.length, 1);
  assert.equal(doomed.parentNode, null, 'the adapter had already taken it; the remove did nothing');
});

test('ownerOf answers who would execute one operation, from the tree as it is', () => {
  const here = region(element('ul'), recorder());
  const there = region(element('ul'), recorder());
  const loose = element('ul'), stray = element('li');
  loose.append(stray);
  here.insert(specs('a', 'b'));
  const [a, b] = [here.nodes[0], here.nodes[1]];

  assert.equal(ownerOf(op.insert(here.container, null, specs('c'))), here);
  assert.equal(ownerOf(op.clear(here.container)), here);
  assert.equal(ownerOf(op.update(a, 1)), here);
  assert.equal(ownerOf(op.remove([a, b])), here);
  assert.equal(ownerOf(op.move(a, there.container, null)), here, 'the region a move leaves');
  assert.equal(ownerOf(op.move(stray, there.container, null)), there, 'or the one it lands in, when it comes from nowhere managed');

  assert.equal(ownerOf(op.insert(loose, null, specs('c'))), null);
  assert.equal(ownerOf(op.update(stray, 1)), null);
  assert.equal(ownerOf(op.remove([])), null, 'a remove of nothing is owned by nobody');
  assert.equal(ownerOf(op.remove([a, stray])), null, 'and so is one whose nodes are in two containers');

  // The answer follows the tree: the same operation, asked again after a move.
  const update = op.update(a, 1);
  here.move(a, null, there);
  assert.equal(ownerOf(update), there);
});

test('divide answers with the operations the current owners would each execute', () => {
  const here = region(element('ul'), recorder());
  const there = region(element('ul'), recorder());
  here.insert(specs('a', 'b', 'c'));
  const [a, b, c] = [here.nodes[0], here.nodes[1], here.nodes[2]];

  const one = op.remove([a, b]);
  assert.deepEqual(divide(one), [one], 'nodes in one container are one operation, the same one');
  assert.deepEqual(divide(op.clear(here.container)).length, 1);
  assert.deepEqual(divide(op.update(a, 1)).length, 1);
  assert.deepEqual(divide(op.remove([])).length, 1);

  // Something moves one of them after the operation was built.
  here.move(b, null, there);
  const parts = divide(one);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(part => part.entities), [[a], [b]]);
  assert.deepEqual(parts.map(part => ownerOf(part)), [here, there], 'and each part has an owner again');
  assert.equal(ownerOf(one), null, 'while the undivided operation has none');
  assert.equal(c.parentNode, here.container, 'nothing was moved by asking');
});

test('a region that only witnesses a move keeps its own mirror', () => {
  const here = region(element('ul'), recorder(), { items: [] });
  const there = region(element('ul'), recorder(), { items: [] });
  const bystander = region(element('ul'), recorder(), { items: [] });
  here.insert(specs('a'));
  bystander.insert(specs('z'));
  const seen = [];
  here.observe(() => seen.push('here'));
  there.observe(() => seen.push('there'));
  bystander.observe(() => seen.push('bystander'));
  bystander.execute(op.move(here.nodes[0], there.container, null));
  assert.deepEqual(here.items, []);
  assert.deepEqual(there.items.map(item => item.name), ['a']);
  assert.deepEqual(bystander.items.map(item => item.name), ['z'], 'the region that ran it is untouched');
  assert.deepEqual(seen, ['bystander', 'here', 'there'], 'the region that ran it hears first, then the two ends of the move');
});

test('a node moved in from outside arrives as undefined', () => {
  const loose = branch(1), stray = loose.children[0];
  const list = region(element('ul'), recorder(), { items: [] });
  list.insert(specs('a'));
  list.execute(op.move(stray, list.container, null));
  assert.deepEqual(list.items.map(item => item?.name), ['a', undefined]);
});

test('a region hands every committed group to its observers', () => {
  const list = region(element('ul'), recorder());
  const seen = [];
  const off = list.observe(group => seen.push(group[0].op));
  list.insert(specs('a'));
  list.clear();
  off();
  list.insert(specs('b'));
  assert.deepEqual(seen, ['insert', 'clear']);
});

test('both regions of a transfer hear about it, once each', () => {
  const here = region(element('ul'), recorder());
  const there = region(element('ul'), recorder());
  const seen = [];
  here.observe(() => seen.push('here'));
  there.observe(() => seen.push('there'));
  here.insert(specs('a'));
  here.move(here.nodes[0], null, there);
  assert.deepEqual(seen, ['here', 'here', 'there']);
});

test('an adapter that throws says how far the group got', () => {
  const list = region(element('ul'), { create: () => element('li'), update() { throw new Error('render failed'); } });
  list.insert(specs('a', 'b'));
  let error = null;
  try { list.execute([op.remove([list.nodes[0]]), op.update(list.nodes[1], 1)]); } catch (thrown) { error = thrown; }
  assert.match(error.message, /render failed/);
  assert.equal(error.committed, 1);
  assert.equal(list.length, 1);
});

test('the positional sugar answers before it builds an operation', () => {
  const list = region(element('ul'), recorder(), { items: [] });
  list.insert(specs('a', 'b', 'c'));
  assert.throws(() => list.insertAt(4, specs('x')), RangeError);
  assert.throws(() => list.removeAt(2, 2), RangeError);
  assert.throws(() => list.updateAt(3, 1), RangeError);
  assert.throws(() => list.moveAt(3), RangeError);
  assert.throws(() => list.moveAt(0, 3), RangeError);
  list.insertAt(1, specs('x'));
  assert.deepEqual(list.items.map(item => item.name), ['a', 'x', 'b', 'c']);
  list.moveAt(0, 2);
  assert.deepEqual(list.items.map(item => item.name), ['x', 'b', 'a', 'c']);
  list.removeAt(1, 2);
  assert.deepEqual(list.items.map(item => item.name), ['x', 'c']);
});

test('no region writes while an interpreter runs', () => {
  const list = region(element('ul'), recorder());
  guard.reason = 'an intent is being interpreted';
  try {
    assert.throws(() => list.insert(specs('a')), /no writes while/);
  } finally {
    guard.reason = null;
  }
  assert.equal(list.insert(specs('a')).length, 1);
});

test('a node moved out to a container with no region is dropped from the mirror', () => {
  const list = region(element('ul'), recorder(), { items: [] });
  const loose = element('ul');
  list.insert(specs('a', 'b'));
  const a = list.nodes[0];
  const seen = [];
  list.observe(group => seen.push(group.length));
  list.execute(op.move(a, loose, null));
  assert.equal(a.parentNode, loose, 'the node leaves');
  assert.deepEqual(list.items.map(item => item.name), ['b'], 'and its item goes with it');
  assert.deepEqual(seen, [1], 'the region that ran it hears about it, and there is nobody else to tell');
});

test('a region runs a move between two containers that have no region', () => {
  const list = region(element('ul'), recorder(), { items: [] });
  const here = element('ul'), there = element('ul'), node = element('li');
  here.append(node);
  const seen = [];
  list.observe(group => seen.push(group.length));
  list.execute(op.move(node, there, null));
  assert.equal(node.parentNode, there, 'the node moves');
  assert.deepEqual(list.items, [], 'no mirror is involved');
  assert.deepEqual(seen, [1], 'the region that ran it hears about it');
});

test('swap says the same exchange by position or by node', () => {
  const list = region(element('ul'), recorder(), { items: [] });
  list.insert(specs('a', 'b', 'c'));
  const [a, , c] = list.nodes;
  // Nodes have to ask the tree which of the two comes first, and the answer
  // decides which move runs first. Both ways round are the one exchange.
  list.swap(c, a);
  assert.deepEqual(list.items.map(item => item.name), ['c', 'b', 'a']);
  list.swap(c, a);
  assert.deepEqual(list.items.map(item => item.name), ['a', 'b', 'c']);
  assert.throws(() => list.swap(0, 3), RangeError, 'the second position is not a child');
  assert.throws(() => list.swap(3, 4), RangeError, 'neither is the first');
});

test('the sugar counts a position in the region the node lands in', () => {
  const here = region(element('ul'), recorder(), { items: [] });
  const there = region(element('ul'), recorder(), { items: [] });
  here.insert(specs('a', 'b', 'c'));
  there.insert(specs('x', 'y'));
  assert.throws(() => here.insertAt(-1, specs('z')), RangeError);
  assert.throws(() => here.moveAt(0, -1), RangeError);
  assert.throws(() => here.moveAt(0, 3, there), RangeError, 'a position past the destination');
  // A transfer counts in the destination as it is; a reorder counts in this
  // region without the node that is leaving, and the end by default.
  here.moveAt(0, 1, there);
  assert.deepEqual(there.items.map(item => item.name), ['x', 'a', 'y']);
  here.moveAt(0);
  assert.deepEqual(here.items.map(item => item.name), ['c', 'b']);
  here.updateAt(1, 'fresh');
  assert.deepEqual(here.items, [{ name: 'c' }, 'fresh']);
  // The position one past the last child is the end, which is an insert with no
  // anchor rather than a range error.
  here.insertAt(2, specs('z'));
  assert.deepEqual(here.items.map(item => item.name ?? item), ['c', 'fresh', 'z']);
  assert.equal(here.at(element('li')), null, 'an element outside the region is in none of its children');
});

test('ownerOf answers null for the operations no region owns', () => {
  const loose = element('ul'), stray = element('li'), detached = element('li');
  loose.append(stray);
  assert.equal(ownerOf(op.update(detached, 1)), null, 'a node that is nowhere');
  assert.equal(ownerOf(op.move(detached, loose, null)), null, 'nowhere, into a container with no region');
  assert.equal(ownerOf(op.remove([detached])), null, 'a remove of a node with no parent');
  assert.equal(ownerOf(op.remove([stray])), null, 'a remove from a container with no region');
  assert.equal(ownerOf({ op: 'nothing' }), null, 'an operation that is none of the five');
});

test('a scattered removal is divided by the container each node is in now', () => {
  const here = region(element('ul'), recorder());
  const there = region(element('ul'), recorder());
  here.insert(specs('a', 'b', 'c'));
  const [a, b, c] = here.nodes;
  const all = op.remove([a, b, c]);
  here.move(b, null, there);
  const parts = divide(all);
  assert.deepEqual(parts.map(part => part.entities), [[a, c], [b]], 'the two that stayed together are one operation');
});
