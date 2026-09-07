// Browser tests for intent.js: scopes, intents, plans and effects on the core.
// Run them with `node tests/run.mjs`, which loads tests/index.html in headless
// Chrome. Each test gets an empty sandbox element in the document, and a scope
// dies with the element it was registered on.
import { region, op } from '../domocracy.js';
import { scope, intent, effect } from '../intent.js';
import { test, assert, equal, throws, note } from './harness.js';

const texts = el => Array.from(el.children, child => child.textContent);

// A <ul> region over strings, and the operations its observer saw.
function ul(parent) {
  const el = document.createElement('ul');
  parent.appendChild(el);
  const seen = [];
  const r = region(el, {
    create(spec) { const li = document.createElement('li'); li.textContent = spec; return li; },
    update(node, data) { node.textContent = data; },
  });
  r.observe(group => { for (const o of group) seen.push(o.op); });
  return { el, region: r, seen };
}

// An element with a scope on it, appended to `parent`.
function room(parent) {
  const el = document.createElement('div');
  parent.appendChild(el);
  return { el, scope: scope(el) };
}

// A control is anything that raises; these tests only need an element.
function control(parent) {
  const el = document.createElement('button');
  parent.appendChild(el);
  return el;
}

const plan = (disposition, operations = [], effects = []) => ({ disposition, operations, effects });

test('the same control means different things in different rooms', sandbox => {
  const inspector = room(sandbox), canvas = room(sandbox);
  const list = ul(inspector.el);
  const button = control(inspector.el);
  inspector.scope.handle('edit.propose', ({ args }) => plan('consume', [op.insert(list.el, null, ['inspector: ' + args.value])]));
  canvas.scope.handle('edit.propose', ({ args }) => plan('consume', [op.insert(list.el, null, ['canvas: ' + args.value])]));

  const first = intent(button, 'edit.propose', { value: 'v' });
  equal(first.disposition, 'consumed', 'the inspector consumed it');
  equal(first.trace.length, 1, 'one scope answered');
  assert(first.trace[0].scope === inspector.el, 'the inspector is on the trace');
  equal(texts(list.el), ['inspector: v'], 'the inspector plan ran');

  canvas.el.appendChild(button);
  const second = intent(button, 'edit.propose', { value: 'v' });
  assert(second.trace[0].scope === canvas.el, 'the canvas is on the trace after the move');
  equal(texts(list.el), ['inspector: v', 'canvas: v'], 'the canvas plan ran, into the same region');
  assert(second.id > first.id, 'intents are numbered in the order they are raised');
});

test('nested scopes answer nearest first, and consume stops the walk', sandbox => {
  const outer = room(sandbox), inner = room(outer.el);
  const list = ul(sandbox);
  const button = control(inner.el);
  outer.scope.handle('go', () => plan('consume', [op.insert(list.el, null, ['outer'])]));
  const offInner = inner.scope.handle('go', () => plan('continue', [op.insert(list.el, null, ['inner'])]));

  const both = intent(button, 'go', null);
  equal(both.trace.map(entry => entry.disposition), ['continue', 'consume'], 'inner continued, outer consumed');
  equal(texts(list.el), ['inner', 'outer'], 'the operations run inner to outer');
  equal(both.operations.length, 2, 'the result carries the whole validated sequence');

  offInner();
  inner.scope.handle('go', () => plan('consume', [op.insert(list.el, null, ['only inner'])]));
  const stopped = intent(button, 'go', null);
  equal(stopped.trace.length, 1, 'the outer scope never ran');
  equal(texts(list.el), ['inner', 'outer', 'only inner'], 'and its plan did not');
});

test('an intent nobody consumes passes, and a pass contributes nothing', sandbox => {
  const quiet = room(sandbox);
  const list = ul(sandbox);
  const button = control(quiet.el);
  quiet.scope.handle('quiet', () => undefined);
  const result = intent(button, 'quiet', null);
  equal(result.disposition, 'passed', 'nothing consumed it');
  equal(result.trace.map(entry => entry.disposition), ['pass'], 'a plan of undefined is a pass');
  equal(result.operations.length, 0, 'nothing was proposed');
  equal(list.seen, [], 'the region saw nothing');

  const other = room(sandbox);
  const another = control(other.el);
  other.scope.handle('loud', () => plan('pass', [op.clear(list.el)]));
  throws(() => intent(another, 'loud', null), TypeError, 'a passing plan that proposes operations');
  other.scope.handle('odd', () => ({ disposition: 'maybe' }));
  throws(() => intent(another, 'odd', null), TypeError, 'an unknown disposition');
  equal(list.seen, [], 'and neither changed anything');
});

test('an interpreter that writes throws, and so does one that raises', sandbox => {
  const outer = room(sandbox);
  const list = ul(outer.el);
  const button = control(outer.el);
  list.region.insert(['a']);

  outer.scope.handle('write', () => { list.region.insert(['b']); });
  throws(() => intent(button, 'write', null), Error, 'region.execute inside an interpreter');
  equal(texts(list.el), ['a'], 'the region is untouched');

  outer.scope.handle('raise', () => intent(button, 'write', null));
  throws(() => intent(button, 'raise', null), Error, 'a nested intent');
  equal(texts(list.el), ['a'], 'still untouched');

  list.region.insert(['c']);
  equal(texts(list.el), ['a', 'c'], 'the guard is cleared again however the interpreter left');
});

test('a plan is validated as one sequence over every region it touches', sandbox => {
  const outer = room(sandbox);
  const a = ul(outer.el), b = ul(outer.el);
  const button = control(outer.el);
  a.region.insert(['a0', 'a1']);
  b.region.insert(['b0']);
  a.seen.length = b.seen.length = 0;
  const moving = a.el.children[0];

  // Move the node out of A, then insert into A before it. The dependency shows
  // only against a model of the sequence, which is what rejects it.
  outer.scope.handle('bad', () => plan('consume', [
    op.move(moving, b.el, null),
    op.insert(a.el, moving, ['new']),
  ]));
  throws(() => intent(button, 'bad', null), RangeError, 'a plan whose second operation depends on the first');
  equal(texts(a.el), ['a0', 'a1'], 'region A is unchanged');
  equal(texts(b.el), ['b0'], 'region B is unchanged');
  equal([a.seen, b.seen], [[], []], 'no observer ran');

  // The same two operations the other way round are valid.
  outer.scope.handle('good', () => plan('consume', [
    op.insert(a.el, moving, ['new']),
    op.move(moving, b.el, null),
  ]));
  intent(button, 'good', null);
  equal(texts(a.el), ['new', 'a1'], 'the insert landed before the node left');
  equal(texts(b.el), ['b0', 'a0'], 'and the move followed');
});

test('an invalid last operation leaves every region unchanged', sandbox => {
  const outer = room(sandbox);
  const a = ul(outer.el), b = ul(outer.el);
  const button = control(outer.el);
  a.region.insert(['a0']);
  b.region.insert(['b0']);
  a.seen.length = b.seen.length = 0;
  const gone = document.createElement('li');

  outer.scope.handle('half', () => plan('consume', [
    op.insert(a.el, null, ['a1']),
    op.update(b.el.children[0], 'B'),
    op.remove([gone]),
  ]));
  throws(() => intent(button, 'half', null), RangeError, 'the last operation names a node with no parent');
  equal(texts(a.el), ['a0'], 'region A is unchanged');
  equal(texts(b.el), ['b0'], 'region B is unchanged');
  equal([a.seen, b.seen], [[], []], 'no observer ran');
});

test('operations reach the regions one at a time, in plan order', sandbox => {
  const outer = room(sandbox);
  const a = ul(outer.el), b = ul(outer.el);
  const order = [];
  a.region.observe(group => order.push('a:' + group[0].op));
  b.region.observe(group => order.push('b:' + group[0].op));
  const button = control(outer.el);
  a.region.insert(['a0']);
  b.region.insert(['b0']);
  order.length = 0;

  outer.scope.handle('interleave', () => plan('consume', [
    op.insert(a.el, null, ['a1']),
    op.insert(b.el, null, ['b1']),
    op.update(a.el.children[0], 'A0'),
    op.clear(b.el),
  ]));
  const result = intent(button, 'interleave', null);
  equal(order, ['a:insert', 'b:insert', 'a:update', 'b:clear'], 'each operation arrived on its own, interleaved as the plan interleaves them');
  equal(result.operations.length, 4, 'the result carries the four');
  equal(texts(a.el), ['A0', 'a1'], 'region A');
  equal(texts(b.el), [], 'region B');
});

test('a move is executed by the region the node leaves, and both mirrors follow', sandbox => {
  const outer = room(sandbox);
  const from = document.createElement('ul'), to = document.createElement('ul');
  sandbox.append(from, to);
  const create = spec => { const li = document.createElement('li'); li.textContent = spec; return li; };
  const source = region(from, { create }, { items: [] });
  const destination = region(to, { create }, { items: [] });
  source.insert(['x', 'y']);
  const button = control(outer.el);
  const moving = from.children[0];

  outer.scope.handle('hand-over', () => plan('consume', [op.move(moving, to, null)]));
  intent(button, 'hand-over', null);
  equal(source.items, ['y'], 'the source mirror lost the item');
  equal(destination.items, ['x'], 'the destination mirror gained it');
  equal(texts(to), ['x'], 'and the node is there');
});

test('a plan naming a container with no region is refused', sandbox => {
  const outer = room(sandbox);
  const plain = document.createElement('ul');
  sandbox.appendChild(plain);
  const button = control(outer.el);
  outer.scope.handle('unmanaged', () => plan('consume', [op.insert(plain, null, ['x'])]));
  throws(() => intent(button, 'unmanaged', null), RangeError, 'insert into a container without a region');
  equal(plain.children.length, 0, 'nothing was created');
});

test('the route is taken before the interpreters run', sandbox => {
  const first = room(sandbox), second = room(sandbox);
  const inner = room(first.el);
  const list = ul(sandbox);
  const button = control(inner.el);
  // Moving the room out of the first scope is the write an interpreter is not
  // allowed to make, and the one the snapshot is there for: the guard cannot
  // see it, because these containers have no regions.
  inner.scope.handle('travel', () => { second.el.appendChild(inner.el); return plan('continue'); });
  first.scope.handle('travel', () => plan('consume', [op.insert(list.el, null, ['first'])]));
  second.scope.handle('travel', () => plan('consume', [op.insert(list.el, null, ['second'])]));

  const moved = intent(button, 'travel', null);
  equal(moved.trace.map(entry => entry.disposition), ['continue', 'consume'], 'the snapshot finished the intent');
  equal(texts(list.el), ['first'], 'the scope it started under answered');
  const next = intent(button, 'travel', null);
  equal(next.trace.length, 2, 'the next intent takes the new route');
  equal(texts(list.el), ['first', 'second'], 'and the new surroundings answer');
});

test('a shadow root ends the walk, and a slotted control keeps its light ancestors', sandbox => {
  const outer = room(sandbox);
  const list = ul(sandbox);
  outer.scope.handle('reach', () => plan('consume', [op.insert(list.el, null, ['reached'])]));

  const host = document.createElement('div');
  outer.el.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div class="inside"></div><slot></slot>';
  const inside = shadow.querySelector('.inside');
  const shadowRoom = scope(inside);
  const shadowList = ul(inside);
  const deep = control(inside);
  shadowRoom.handle('reach', () => plan('consume', [op.insert(shadowList.el, null, ['shadow'])]));

  const inner = intent(deep, 'reach', null);
  equal(inner.trace.length, 1, 'only the scope inside the shadow tree answered');
  assert(inner.trace[0].scope === inside, 'the walk stopped at the shadow root');
  equal(texts(shadowList.el), ['shadow'], 'its plan ran');
  equal(texts(list.el), [], 'nothing reached the scope above the host');

  const slotted = control(host);
  const light = intent(slotted, 'reach', null);
  assert(light.trace.length === 1 && light.trace[0].scope === outer.el, 'a slotted control resolves through its light-DOM ancestors');
  equal(texts(list.el), ['reached'], 'and the outer scope answered it');
});

test('a scope owns an element once, and an intent type once', sandbox => {
  const outer = room(sandbox);
  throws(() => scope(outer.el), Error, 'a second scope over the same element');
  outer.scope.handle('twice', () => undefined);
  throws(() => outer.scope.handle('twice', () => undefined), Error, 'a second interpreter for one type');
  const button = control(outer.el);
  outer.scope.dispose();
  equal(intent(button, 'twice', null).trace.length, 0, 'a disposed scope is not on the route');
  const again = scope(outer.el);
  assert(again.element === outer.el, 'the element takes a scope again');
});

test('effects run after the operations, in plan order, and a failure does not stop the next', sandbox => {
  const outer = room(sandbox);
  const list = ul(outer.el);
  const button = control(outer.el);
  const log = [];
  const offCommit = effect('document.commit', (request, raising) => { log.push(['commit', request.actions, raising.type]); return request.actions.length; });
  const offAngry = effect('document.angry', () => { throw new Error('no'); });
  try {
    outer.scope.handle('edit.propose', () => plan('consume',
      [op.insert(list.el, null, ['row'])],
      [{ type: 'document.angry' }, { type: 'document.commit', actions: ['set'] }, { type: 'document.missing' }],
    ));
    const result = intent(button, 'edit.propose', null);
    equal(texts(list.el), ['row'], 'the operations ran first');
    equal(log, [['commit', ['set'], 'edit.propose']], 'the adapter received the request and the intent');
    equal(result.effects.map(e => [e.type, e.status]), [
      ['document.angry', 'failed'],
      ['document.commit', 'done'],
      ['document.missing', 'failed'],
    ], 'every effect is reported, in plan order');
    equal(result.effects[1].result, 1, "the adapter's return value is the result");
    assert(result.effects[2].error.message.includes('no adapter'), 'an effect with no adapter names what was missing');
    throws(() => effect('document.commit', () => {}), Error, 'a second adapter for one type');
  } finally {
    offCommit();
    offAngry();
  }
});

test('a result is frozen and says what happened', sandbox => {
  const outer = room(sandbox);
  const list = ul(outer.el);
  const button = control(outer.el);
  outer.scope.handle('freeze', () => plan('consume', [op.insert(list.el, null, ['a'])]));
  const result = intent(button, 'freeze', null);
  assert(Object.isFrozen(result) && Object.isFrozen(result.trace) && Object.isFrozen(result.operations), 'the result, its trace and its operations are frozen');
  assert(Object.isFrozen(result.trace[0]) && Object.isFrozen(result.effects), 'and every trace entry and the effects');
  throws(() => intent(document.createElement('div'), 'freeze', null), TypeError, 'a source outside the document');
  throws(() => intent(null, 'freeze', null), TypeError, 'no source at all');
});

test('the cost of one intent through three nested scopes', sandbox => {
  const first = room(sandbox), second = room(first.el), third = room(second.el);
  const list = ul(sandbox);
  const button = control(third.el);
  list.region.insert(['x']);
  third.scope.handle('cost', () => plan('continue'));
  second.scope.handle('cost', () => plan('continue'));
  first.scope.handle('cost', () => plan('consume', [op.update(list.el.children[0], 'x')]));

  for (let i = 0; i < 1000; i++) intent(button, 'cost', null);
  const rounds = 2000, started = performance.now();
  for (let i = 0; i < rounds; i++) intent(button, 'cost', null);
  const each = (performance.now() - started) * 1000 / rounds;
  note(`one intent through three scopes, one operation: ${each.toFixed(1)} µs`);
  assert(each > 0, 'the loop ran');
});
