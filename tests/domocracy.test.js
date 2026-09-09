// Browser tests for domocracy.js. Open tests/index.html over HTTP, or run
// `node tests/run.mjs`, which does that in headless Chrome and prints the
// results. Each test gets an empty sandbox element in the document.
import { region, regionOf, op, validate, guard, on, dispatch } from '../domocracy.js';
import { test, assert, equal, throws } from './harness.js';

const texts = el => Array.from(el.children, child => child.textContent);
const detached = () => document.createElement('li');

// A <ul> region over strings that counts create and update calls.
function ul(sandbox, adapter = {}) {
  const el = document.createElement('ul');
  sandbox.appendChild(el);
  const calls = { create: 0, update: 0 };
  const r = region(el, {
    create(spec) { calls.create++; const li = document.createElement('li'); li.textContent = spec; return li; },
    update(node, data) { calls.update++; node.textContent = data; },
    ...adapter,
  });
  return { el, region: r, calls };
}

test('the five operations are the only way the children change', sandbox => {
  const { el, region: r, calls } = ul(sandbox);
  const group = r.insert(['a', 'b', 'c']);
  equal(texts(el), ['a', 'b', 'c'], 'insert at the end of an empty region');
  assert(Object.isFrozen(group) && Object.isFrozen(group[0]) && Object.isFrozen(group[0].specs), 'the group, its operations and their arrays are frozen');
  equal(group.length, 1, 'one operation');
  r.insert(['x', 'y'], el.children[1]);
  equal(texts(el), ['a', 'x', 'y', 'b', 'c'], 'insert before a child');
  r.insert(['z']);
  r.insert(['w'], el.children[0]);
  equal(texts(el), ['w', 'a', 'x', 'y', 'b', 'c', 'z'], 'insert at both ends');
  r.remove([el.children[1], el.children[2], el.children[3]]);
  r.remove(el.children[0]);
  equal(texts(el), ['b', 'c', 'z'], 'remove an array of nodes and a single node');
  const nodes = Array.from(el.children);
  r.swap(0, 2);
  assert(el.children[0] === nodes[2] && el.children[1] === nodes[1] && el.children[2] === nodes[0], 'swap moves the nodes');
  equal(texts(el), ['z', 'c', 'b'], 'swap by position');
  r.swap(el.children[2], el.children[0]);
  equal(texts(el), ['b', 'c', 'z'], 'swap by node restores');
  r.swap(1, 1);
  equal(texts(el), ['b', 'c', 'z'], 'swapping a node with itself changes nothing');
  r.swap(0, 1);
  equal(texts(el), ['c', 'b', 'z'], 'adjacent children');
  r.swap(1, 0);
  equal(texts(el), ['b', 'c', 'z'], 'adjacent children the other way round');
  r.update(el.children[1], 'C');
  equal(texts(el), ['b', 'C', 'z'], 'update goes through the adapter');
  equal(calls.update, 1, 'one update call');
  const created = calls.create;
  r.clear();
  equal(el.children.length, 0, 'clear empties the container');
  equal(calls.create, created, 'clear creates nothing');
  assert(r.length === 0 && r.nodes === el.children && r.container === el, 'the region reads the live children');
});

test('bad arguments throw before anything changes', sandbox => {
  const { el, region: r } = ul(sandbox);
  r.insert(['a', 'b']);
  const outside = detached();
  throws(() => r.insert('a'), TypeError, 'insert with a non-array');
  throws(() => r.insert(['c'], outside), RangeError, 'insert before a node of another parent');
  throws(() => r.remove(outside), RangeError, 'remove a node with no parent');
  throws(() => r.move(el.children[0], outside), RangeError, 'move before a node of another parent');
  throws(() => r.move(el.children[0], el.children[0]), RangeError, 'move a node before itself');
  throws(() => r.swap(0, 9), RangeError, 'swap out of range');
  throws(() => r.execute({ op: 'explode' }), TypeError, 'an unknown operation');
  throws(() => r.execute([{ op: 'explode' }, op.clear(el)]), TypeError, 'an unknown operation in a group');
  equal(texts(el), ['a', 'b'], 'children unchanged');
});

test('a group is validated as a whole, so a group that could not finish never starts', sandbox => {
  const { el, region: r, calls } = ul(sandbox);
  r.insert(['a', 'b', 'c']);
  const [a, b] = el.children;
  throws(() => r.execute([op.update(a, 'A'), op.remove([detached()]), op.update(b, 'B')]), RangeError, 'a bad operation in position 2 of 3');
  equal(calls.update, 0, 'the earlier operations of a rejected group never ran');
  equal(texts(el), ['a', 'b', 'c'], 'nothing changed');
  throws(() => r.execute([op.remove([b]), op.insert(el, b, ['x'])]), RangeError, 'insert before a node an earlier operation removed');
  throws(() => r.execute([op.clear(el), op.move(a, el, b)]), RangeError, 'move before a child an earlier clear took away');
  equal(texts(el), ['a', 'b', 'c'], 'still nothing changed');
  // A cycle that exists only after the first move of the same group.
  const boxes = document.createElement('div'), outer = document.createElement('div'), inner = document.createElement('div');
  boxes.append(outer, inner);
  sandbox.appendChild(boxes);
  const box = region(boxes, { create: () => document.createElement('div') });
  throws(() => box.execute([op.move(outer, inner, null), op.move(inner, outer, null)]), RangeError, 'a cycle the group would create');
  assert(outer.parentNode === boxes && inner.parentNode === boxes, 'neither move ran');
});

test('an adapter that throws leaves a prepared insert without a trace, and says how far a group got', sandbox => {
  let made = 0;
  const heard = [];
  const { el, region: r } = ul(sandbox, { create(spec) { if (++made === 3) throw new Error('boom'); const li = document.createElement('li'); li.textContent = spec; return li; } });
  r.observe(group => heard.push(group));
  throws(() => r.insert(['a', 'b', 'c']), Error, 'the third create throws');
  equal(el.children.length, 0, 'every node is created before the tree is touched');
  equal(heard.length, 0, 'no observer runs');
  made = 0;
  const error = throws(() => r.execute([op.insert(el, null, ['a', 'b']), op.insert(el, null, ['c', 'd', 'e'])]), Error, 'the second operation throws');
  equal(error.committed, 1, 'the index of the operation that failed');
  equal(texts(el), ['a', 'b'], 'the operations before it stay applied; the core does not roll back');
  equal(heard.length, 0, 'and the observers still do not run');
});

test('observers receive every committed group, and a cross-region move reaches both', sandbox => {
  const A = ul(sandbox), B = ul(sandbox);
  const seenA = [], seenB = [];
  const off = A.region.observe((group, source) => { assert(source === A.region, 'the observer is told which region'); seenA.push(group); });
  B.region.observe(group => seenB.push(group));
  A.region.insert(['a1', 'a2']);
  B.region.insert(['b1']);
  equal([seenA.length, seenB.length], [1, 1], 'one group per operation');
  equal(seenA[0][0].op, 'insert', 'the group holds the operation that ran');
  const node = A.el.children[1];
  const group = A.region.move(node, B.el.children[0], B.region);
  assert(node.parentNode === B.el, 'the node moved');
  equal([texts(A.el), texts(B.el)], [['a1'], ['a2', 'b1']], 'both containers');
  assert(seenA[1] === group && seenB[1] === group, 'both regions hear the same group');
  off();
  A.region.insert(['a3']);
  equal(seenA.length, 2, 'a removed observer hears nothing');
});

test('an observer may remove itself or another while the group is being delivered', sandbox => {
  const { region: r } = ul(sandbox);
  const seen = [];
  let offSelf, offThird;
  offSelf = r.observe(() => { offSelf(); offThird(); seen.push('first'); });
  r.observe(() => seen.push('second'));
  offThird = r.observe(() => seen.push('third'));
  r.insert(['a']);
  equal(seen, ['first', 'second', 'third'], 'the delivery in progress runs the observers it started with');
  r.insert(['b']);
  equal(seen, ['first', 'second', 'third', 'second'], 'the removals take effect for the next group');
});

test('operation values copy the arrays they are given and reference everything else', sandbox => {
  const { region: r } = ul(sandbox, { create: spec => Object.assign(document.createElement('li'), { textContent: spec.label }) });
  let group = null;
  r.observe(committed => group = committed);
  const specs = [{ label: 'a' }];
  r.insert(specs);
  specs.push({ label: 'b' });
  equal(group[0].specs.length, 1, 'pushing onto the specs array afterwards changes nothing');
  specs[0].label = 'z';
  equal(group[0].specs[0].label, 'z', 'a spec object is referenced, not copied: freeze what you hand over');
});

test('one region per container, and regionOf finds it', sandbox => {
  const { el, region: r } = ul(sandbox);
  assert(regionOf(el) === r, 'regionOf');
  assert(regionOf(sandbox) === null, 'a container without a region');
  throws(() => region(el, { create: detached }), Error, 'a second region over the same container');
});

test('no region writes while an interpreter runs', sandbox => {
  const { el, region: r } = ul(sandbox);
  r.insert(['a']);
  guard.reason = 'interpreting';
  try {
    throws(() => r.insert(['b']), Error, 'a write during interpretation');
    equal(texts(el), ['a'], 'nothing changed');
  } finally {
    guard.reason = null;
  }
  r.insert(['b']);
  equal(texts(el), ['a', 'b'], 'and writes are allowed again after');
});

test('validate is the pure half: it accepts a sequence across containers and returns the frozen group', sandbox => {
  const A = ul(sandbox), B = ul(sandbox);
  A.region.insert(['a1', 'a2']);
  B.region.insert(['b1']);
  const ops = [op.move(A.el.children[0], B.el, null), op.update(B.el.children[0], 'B1')];
  const group = validate(ops);
  assert(Object.isFrozen(group) && group.length === 2, 'a frozen copy of the sequence');
  equal([texts(A.el), texts(B.el)], [['a1', 'a2'], ['b1']], 'validating changes nothing');
  ops.push(op.clear(A.el));
  equal(group.length, 2, 'the group is a copy of the array it was given');
  throws(() => validate([op.remove([detached()])]), RangeError, 'and it throws what execute would throw');
});

test('a region adopts the children it finds, and at() resolves rows, children and text nodes', sandbox => {
  const el = document.createElement('ul');
  el.innerHTML = '<li>a</li><li>b</li>';
  sandbox.appendChild(el);
  const r = region(el, { create: spec => Object.assign(document.createElement('li'), { textContent: spec }) });
  equal(r.length, 2, 'the children that were already there');
  assert(r.at(el.children[1]).index === 1, 'adopted children resolve');
  r.insert(['c']);
  equal(texts(el), ['a', 'b', 'c'], 'operations continue from the adopted state');
  assert(r.at(el.children[1].firstChild).node === el.children[1], 'a text node inside a child');
  assert(r.at(sandbox) === null && r.at(null) === null, 'outside the region');

  const table = document.createElement('table'), tbody = document.createElement('tbody');
  table.appendChild(tbody);
  sandbox.appendChild(table);
  const row = spec => { const tr = document.createElement('tr'); tr.innerHTML = `<td>${spec}</td><td><a>x</a></td>`; return tr; };
  const rows = region(tbody, { create: row });
  rows.insert(['r0', 'r1', 'r2']);
  const hit = rows.at(tbody.children[2].lastChild.firstChild);
  assert(hit.index === 2 && hit.node === tbody.children[2], 'a row through sectionRowIndex');
  const bare = document.createElement('table');
  sandbox.appendChild(bare);
  const bareRows = region(bare, { create: row });
  bareRows.insert(['b0', 'b1']);
  assert(bareRows.at(bare.children[1].firstChild).index === 1, 'rows directly under a table');
  const groups = region(table, { create: spec => { const body = document.createElement('tbody'); body.innerHTML = `<tr><td>${spec}</td></tr>`; return body; } });
  groups.insert(['g1', 'g2']);
  assert(groups.at(table.children[2].firstChild.firstChild).index === 2, 'non-row children fall back to the child index');
});

test('move reorders within a region and keeps the node', sandbox => {
  const { el, region: r } = ul(sandbox);
  r.insert(['a', 'b', 'c', 'd']);
  const nodes = Array.from(el.children);
  r.move(nodes[0], nodes[3]);
  equal(texts(el), ['b', 'c', 'a', 'd'], 'forward move');
  assert(el.children[2] === nodes[0], 'the same node moved');
  r.move(el.children[0]);
  equal(texts(el), ['c', 'a', 'd', 'b'], 'move to the end by default');
  r.move(el.children[2], el.children[0]);
  equal(texts(el), ['d', 'c', 'a', 'b'], 'backward move');
  r.move(el.children[1], el.children[2]);
  equal(texts(el), ['d', 'c', 'a', 'b'], 'move to the place it already holds');
  assert(new Set(el.children).size === 4 && nodes.every(node => node.parentNode === el), 'no node was recreated');
});

test('move transfers a node to another region without losing focus', sandbox => {
  const create = spec => { const li = document.createElement('li'); li.innerHTML = `<input value="${spec}">`; return li; };
  const A = ul(sandbox, { create }), B = ul(sandbox, { create });
  A.region.insert(['a1', 'a2', 'a3']);
  B.region.insert(['b1']);
  const node = A.el.children[1], input = node.firstChild;
  input.focus();
  assert(document.activeElement === input, 'focused before the move');
  A.region.move(node, B.el.children[0], B.region);
  assert(B.el.children[0] === node && node.parentNode === B.el, 'the node itself moved');
  if ('moveBefore' in Element.prototype) assert(document.activeElement === input, 'focus survives the move');
  A.region.move(A.el.children[0], null, B.region);
  equal(B.region.length, 3, 'defaults to the end of the destination');
  assert(B.region.at(node).index === 0 && A.region.at(node) === null, 'at() follows the transfer');
});

test('a region keeps a mirror only when it is asked to, and it stays in step through every operation', sandbox => {
  assert(ul(sandbox).region.items === null, 'no mirror by default');
  const el = document.createElement('ul');
  el.innerHTML = '<li>a</li>';
  sandbox.appendChild(el);
  throws(() => region(el, { create: detached }, { items: [] }), RangeError, 'the items must count as the children do');
  const r = region(el, {
    create: spec => Object.assign(document.createElement('li'), { textContent: spec }),
    update: (node, data) => { node.textContent = data; },
  }, { items: ['a'] });
  equal(r.items, ['a'], 'the children it adopted');
  assert(Object.isFrozen(r.items), 'the mirror is frozen');
  r.insert(['b', 'c']);
  equal(r.items, ['a', 'b', 'c'], 'insert at the end');
  r.insert(['x'], el.children[1]);
  equal(r.items, ['a', 'x', 'b', 'c'], 'insert before a child');
  r.update(el.children[0], 'A');
  equal(r.items, ['A', 'x', 'b', 'c'], "update replaces the item at the entity's position");
  r.move(el.children[0], null);
  equal(r.items, ['x', 'b', 'c', 'A'], 'move to the end');
  r.move(el.children[3], el.children[0]);
  equal(r.items, ['A', 'x', 'b', 'c'], 'move back to the front');
  r.move(el.children[1], el.children[2]);
  equal(r.items, ['A', 'x', 'b', 'c'], 'move to the place it already holds');
  r.swap(0, 2);
  equal([texts(el), r.items], [['b', 'x', 'A', 'c'], ['b', 'x', 'A', 'c']], 'swap is two moves and the mirror follows both');
  r.remove(el.children[1]);
  equal(r.items, ['b', 'A', 'c'], 'remove one');
  r.remove([el.children[0], el.children[2]]);
  equal(r.items, ['A'], 'remove several');
  equal(texts(el), ['A'], 'the DOM says the same');
  const hit = r.at(el.children[0].firstChild);
  assert(hit.node === el.children[0] && hit.index === 0 && hit.item === 'A', 'at() answers with the item');
  r.clear();
  equal(r.items, [], 'clear empties the mirror');
});

test('a move between regions carries the item, and one from outside arrives as undefined', sandbox => {
  const create = spec => Object.assign(document.createElement('li'), { textContent: spec });
  const a = document.createElement('ul'), b = document.createElement('ul'), plain = document.createElement('ul');
  sandbox.append(a, b, plain);
  const A = region(a, { create }, { items: [] }), B = region(b, { create }, { items: [] }), P = region(plain, { create });
  A.insert(['a1', 'a2', 'a3']);
  B.insert(['b1']);
  A.move(a.children[1], b.children[0], B);
  equal([A.items, B.items], [['a1', 'a3'], ['a2', 'b1']], "the item leaves at the entity's position and arrives at the anchor's");
  P.insert(['p1']);
  P.move(plain.children[0], null, B);
  equal(B.items, ['a2', 'b1', undefined], 'a node from a region without a mirror arrives as undefined');
  B.move(b.children[0], null, P);
  equal([B.items, P.items], [['b1', undefined], null], 'and one that leaves for a region without a mirror is dropped');
  const bare = document.createElement('div');
  sandbox.appendChild(bare);
  B.execute(op.move(b.children[0], bare, null));
  equal([B.items, texts(bare)], [[undefined], ['b1']], 'a container that is no region takes the node and not the item');
});

test('the index sugar says the same operations by position', sandbox => {
  const { el, region: r } = ul(sandbox);
  r.insert(['a', 'b', 'c']);
  r.insertAt(0, ['start']);
  r.insertAt(4, ['end']);
  equal(texts(el), ['start', 'a', 'b', 'c', 'end'], 'insert at a position and at the end');
  throws(() => r.insertAt(9, ['x']), RangeError, 'insertAt out of range');
  r.updateAt(1, 'A');
  equal(texts(el), ['start', 'A', 'b', 'c', 'end'], 'updateAt');
  throws(() => r.updateAt(9, 'x'), RangeError, 'updateAt out of range');
  r.removeAt(3, 2);
  equal(texts(el), ['start', 'A', 'b'], 'removeAt a range');
  throws(() => r.removeAt(2, 2), RangeError, 'removeAt past the end');
  r.moveAt(0, 2);
  equal(texts(el), ['A', 'b', 'start'], 'moveAt counts the position the node holds afterwards');
  r.moveAt(2, 0);
  equal(texts(el), ['start', 'A', 'b'], 'and back');
  r.moveAt(0);
  equal(texts(el), ['A', 'b', 'start'], 'to the end by default');
  throws(() => r.moveAt(0, 3), RangeError, 'moveAt out of range');
  const other = ul(sandbox);
  other.region.insert(['o']);
  r.moveAt(0, 0, other.region);
  equal([texts(el), texts(other.el)], [['b', 'start'], ['A', 'o']], 'into another region at a position');
});

test('on() matches by selector in registration order, removes rules, stops on stopPropagation', sandbox => {
  sandbox.innerHTML = '<section><article class="card"><button>go</button></article></section>';
  const section = sandbox.firstChild, article = section.firstChild, button = article.firstChild;
  const seen = [];
  const off1 = on(sandbox, 'click', 'button', (event, match) => seen.push('button:' + match.tagName));
  on(sandbox, 'click', '.card', (event, match) => seen.push('card:' + match.className));
  on(sandbox, 'click', 'section', () => seen.push('section'));
  on(article, 'click', 'section', () => seen.push('outside the root'));
  button.click();
  equal(seen, ['button:BUTTON', 'card:card', 'section'], 'registration order, matches only inside the root');
  seen.length = 0;
  off1();
  button.click();
  equal(seen, ['card:card', 'section'], 'removed rule');
  seen.length = 0;
  let offSelf;
  offSelf = on(sandbox, 'click', 'button', () => { offSelf(); seen.push('once'); });
  on(sandbox, 'click', 'button', () => seen.push('after'));
  button.click();
  equal(seen, ['card:card', 'section', 'once', 'after'], 'a rule may remove itself while running');
  seen.length = 0;
  button.click();
  equal(seen, ['card:card', 'section', 'after'], 'and is gone next time');
  seen.length = 0;
  const offDoc = on(document, 'click', 'article', () => seen.push('document'));
  button.click();
  equal(seen, ['card:card', 'section', 'after', 'document'], 'the document is a valid root');
  offDoc();
  seen.length = 0;
  on(sandbox, 'poke', 'button', (event, match) => seen.push('poke:' + match.tagName));
  button.firstChild.dispatchEvent(new CustomEvent('poke', { bubbles: true }));
  equal(seen, ['poke:BUTTON'], 'a text node target resolves to its parent');
  seen.length = 0;
  on(section, 'click', 'button', event => { seen.push('first'); event.stopPropagation(); });
  on(section, 'click', '.card', () => seen.push('second'));
  button.click();
  equal(seen, ['first'], 'stopPropagation ends the matching and the bubbling');
});

test('rules apply to elements a region creates or moves in later', sandbox => {
  const seen = [];
  on(sandbox, 'click', 'li', (event, match) => seen.push(match.textContent));
  const { el, region: r } = ul(sandbox);
  r.insert(['a', 'b']);
  el.children[1].click();
  equal(seen, ['b'], 'created later');
  const other = document.createElement('div');
  document.body.appendChild(other);
  const O = ul(other);
  O.region.insert(['o']);
  O.region.move(O.el.children[0], null, r);
  el.children[2].click();
  equal(seen, ['b', 'o'], 'moved in from another root');
  other.remove();
});

test('dispatch bubbles an action whose meaning the room decides, and reports whether it was taken up', sandbox => {
  sandbox.innerHTML = '<div class="room music"></div><div class="room research"></div>';
  const [music, research] = sandbox.children;
  const card = document.createElement('div');
  card.className = 'card';
  const played = [], opened = [];
  on(music, 'activate', '.card', event => { played.push(event.detail); event.preventDefault(); });
  on(research, 'activate', '.card', event => { opened.push(event.detail); event.preventDefault(); });
  music.appendChild(card);
  assert(dispatch(card, 'activate', 'sample') === false, 'a handled action returns false');
  equal([played, opened], [['sample'], []], 'the music room played it');
  research.appendChild(card);
  assert(dispatch(card, 'activate', 'source') === false, 'handled in the other room');
  equal([played, opened], [['sample'], ['source']], 'the research room opened it');
  sandbox.appendChild(card);
  assert(dispatch(card, 'activate', 'nowhere') === true, 'an action nobody takes up returns true');
});
