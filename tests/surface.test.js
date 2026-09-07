// Browser tests for surface.js: addresses in the DOM, values flowing one way,
// and a commit coming back as the operations that bring the surface up to date.
// The bridge is tests/fake-document.mjs, so these run without SJON's wasm.
// Run them with `node tests/run.mjs`.
import { region, on } from '../domocracy.js';
import { scope, intent, effect } from '../intent.js';
import { addressOf, controlsFor, operationsFor, apply } from '../surface.js';
import { fakeDocument, action } from './fake-document.mjs';
import { test, assert, equal, throws } from './harness.js';

const VELOCITY = 'world:dust/velocity';
const MIRRORED = 'program:dust/velocity';
const LAYERS = 'world:dust/layers';
const NOISE = LAYERS + '/noise', GRAIN = LAYERS + '/grain', DRIFT = LAYERS + '/drift';

// Two roots holding the same path, because a knob in WORLD and a source scrub
// in PROGRAM are two addresses and a control has to say which it presents.
const bridge = () => fakeDocument({
  world: { dust: { velocity: 3, layers: { noise: 1, grain: 2, drift: 3 } } },
  program: { dust: { velocity: 7 } },
});

const addresses = el => Array.from(el.children, child => child.dataset.address);
const valueIn = node => (node.tagName === 'INPUT' ? node.value : node.firstElementChild?.value ?? node.textContent);

// A preview is the committed record with an override on it, and the adapter
// shows it as one. Discarding is one more update with the committed record.
function mark(node, data) {
  if (data.preview) node.dataset.preview = 'true';
  else delete node.dataset.preview;
}

// What renders a control that is not a child of a region: a lone field in an
// inspector. It counts its calls, so a test can say the surface made one update
// and nothing else.
function fields() {
  const updates = [];
  return {
    updates,
    update(node, data) {
      updates.push(data);
      if (node.tagName === 'INPUT') node.value = String(data.value);
      else node.textContent = String(data.value);
      mark(node, data);
    },
  };
}

// One kind of control, a number, as a region's adapter: a row that carries its
// address and holds something focusable, so a move can be seen to keep state.
const rows = {
  create(spec) {
    const li = document.createElement('li');
    li.dataset.address = spec.address;
    li.appendChild(document.createElement('input'));
    rows.update(li, spec);
    return li;
  },
  update(node, data) {
    node.firstElementChild.value = String(data.value);
    mark(node, data);
  },
};

// The refusal, shown on the control that raised the intent, in animader's
// three-part shape.
function refuse(control, { what, why, offers }) {
  control.dataset.refused = what;
  control.dataset.why = why;
  control.dataset.offers = offers.join(' ');
}

// A surface with the bridge wired to it: every commit the bridge announces is
// applied here, and nothing else writes to it.
function surfaceOn(sandbox, document_) {
  const el = document.createElement('div');
  sandbox.appendChild(el);
  const adapter = fields(), applied = [];
  document_.subscribe(({ changes }) => applied.push(apply(el, changes, adapter)));
  return { el, adapter, applied };
}

// A control: an element carrying an address, rendered once from the document.
function field(parent, document_, address, tag = 'input') {
  const el = document.createElement(tag);
  el.dataset.address = address;
  parent.appendChild(el);
  const found = document_.resolve(address);
  if (tag === 'input') el.value = String(found.value); else el.textContent = String(found.value);
  return el;
}

// A region presenting the forms under one address: the container carries the
// parent's address, its children carry their own.
function list(parent, document_, address) {
  const el = document.createElement('ul');
  el.dataset.address = address;
  parent.appendChild(el);
  const forms = document_.resolve(address).value;
  const r = region(el, rows);
  r.insert(Object.entries(forms).map(([name, value]) => ({ address: address + '/' + name, value })));
  return { el, region: r };
}

// Effect adapters are global and one per type, so a test takes them for as long
// as it runs and gives them back afterwards.
function withEffects(map, fn) {
  const offs = Object.entries(map).map(([type, adapter]) => effect(type, adapter));
  try { return fn(); } finally { for (const off of offs) off(); }
}

// The commit adapter: it hands the batch to the bridge and, when the bridge
// refuses, shows the refusal on the control that raised the intent. It changes
// nothing else; what the surface shows arrives as a change notification.
const commits = document_ => (request, raising) => {
  const answer = document_.commit(request.actions, request.revision);
  if (!answer.ok) refuse(raising.source, { what: raising.args.address, why: answer.diagnostics[0].code, offers: ['reload'] });
  return answer;
};

const propose = (act, revision) => ({
  disposition: 'consume',
  effects: [{ type: 'document.commit', actions: [act], revision }],
});

const point = (el, type, clientX) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX }));

// A knob drag, as the only place where a browser event and an intent meet:
// every move previews, and the release discards the preview and proposes the
// edit. Nothing here writes a value anywhere; the control shows the preview
// because `apply` rendered the record the bridge handed back.
function knobDrag(surface, document_, adapter) {
  let dragging = null;
  const reached = event => dragging.value + (event.clientX - dragging.from);
  on(surface, 'pointerdown', '[data-address]', (event, control) => {
    const address = control.dataset.address;
    dragging = { address, from: event.clientX, value: document_.resolve(address).value };
  });
  on(surface, 'pointermove', '[data-address]', event => {
    if (dragging !== null) apply(surface, [document_.preview(dragging.address, reached(event))], adapter);
  });
  on(surface, 'pointerup', '[data-address]', (event, control) => {
    if (dragging === null) return;
    const value = reached(event), address = dragging.address;
    dragging = null;
    apply(surface, [document_.discard(address)], adapter);
    intent(control, 'edit.propose', { address, action: action('replace', address, { value }), revision: document_.revision });
  });
}

test('a commit updates exactly the controls of its address, and they stay the same nodes', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  const velocity = field(surface.el, document_, VELOCITY);
  const mirrored = field(surface.el, document_, MIRRORED);
  const noise = field(surface.el, document_, NOISE, 'span');
  velocity.focus();

  document_.commit([action('replace', VELOCITY, { value: 9 })], 1);
  assert(surface.el.children[0] === velocity, 'the control is the same node');
  equal(velocity.value, '9', 'the control shows the committed value');
  assert(document.activeElement === velocity, 'focus in the control survives the update');
  equal(mirrored.value, '7', 'the other root is untouched');
  equal(noise.textContent, '1', 'another address is untouched');
  equal(surface.adapter.updates.length, 1, 'one update, for one control');
});

test('two controls presenting one address both update on one commit', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  const knob = field(surface.el, document_, VELOCITY);
  const readout = field(surface.el, document_, VELOCITY, 'span');
  equal(controlsFor(surface.el, VELOCITY).length, 2, 'the query finds both presentations');

  document_.commit([action('replace', VELOCITY, { value: 5 })], 1);
  equal([knob.value, readout.textContent], ['5', '5'], 'both show the committed value');
  equal(surface.adapter.updates.length, 2, 'one update each');
});

test('the same path in two roots is two addresses', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  const world = field(surface.el, document_, VELOCITY);
  const program = field(surface.el, document_, MIRRORED);

  document_.commit([action('replace', MIRRORED, { value: 11 })], 1);
  equal([world.value, program.value], ['3', '11'], 'the PROGRAM commit left the WORLD control alone');
  equal(document_.resolve(VELOCITY).value, 3, 'and the WORLD value with it');
});

test('a preview is an override and discarding it gives back the committed value', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  const knob = field(surface.el, document_, VELOCITY);
  const revision = document_.revision;

  apply(surface.el, [document_.preview(VELOCITY, 42)], surface.adapter);
  equal(knob.value, '42', 'the control shows the preview');
  equal(knob.dataset.preview, 'true', 'and marks it as one');
  equal(document_.revision, revision, 'a preview is not a commit');
  equal(document_.resolve(VELOCITY).value, 3, 'and the document still holds the committed value');

  const before = surface.adapter.updates.length;
  apply(surface.el, [document_.discard(VELOCITY)], surface.adapter);
  equal(knob.value, '3', 'discarding gives back exactly what was there');
  equal(knob.dataset.preview, undefined, 'and the override is gone');
  equal(document_.revision, revision, 'the revision has not moved');
  equal(surface.adapter.updates.length - before, 1, 'the surface made one update for the restore and nothing else');
  equal(document_.log, [{ call: 'checkpoint', address: VELOCITY }, { call: 'restore', address: VELOCITY }], 'the bridge checkpointed and restored');
});

test('a knob drag previews on the way and commits once on release', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  const room = document.createElement('div');
  surface.el.appendChild(room);
  scope(room).handle('edit.propose', ({ args }) => propose(args.action, args.revision));
  const knob = field(room, document_, VELOCITY);
  knobDrag(surface.el, document_, surface.adapter);

  withEffects({ 'document.commit': commits(document_) }, () => {
    point(knob, 'pointerdown', 100);
    point(knob, 'pointermove', 104);
    equal(knob.value, '7', 'the control shows the preview');
    equal(knob.dataset.preview, 'true', 'and marks it as one');
    equal(document_.revision, 1, 'previewing is not committing');
    point(knob, 'pointermove', 110);
    equal(knob.value, '13', 'every move previews again');
    equal(document_.resolve(VELOCITY).value, 3, 'and the document still holds what it held');
    point(knob, 'pointerup', 110);
  });

  equal(knob.value, '13', 'the release committed what the preview showed');
  equal(knob.dataset.preview, undefined, 'and it is a committed value now');
  equal(document_.revision, 2, 'one commit for the whole drag');
  equal(document_.resolve(VELOCITY).value, 13, 'which the document holds');
  equal(document_.log.map(entry => entry.call), ['checkpoint', 'checkpoint', 'restore'], 'a checkpoint per preview and one restore');
});

test('a drag moves nothing until the document commits, and then the row keeps its state', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  const room = document.createElement('div');
  surface.el.appendChild(room);
  const canvas = scope(room);
  const rowsIn = list(room, document_, LAYERS);
  const drift = rowsIn.el.children[2];
  drift.firstElementChild.focus();

  canvas.handle('edit.propose', ({ args }) => propose(args.action, args.revision));
  let duringCommit = null;
  withEffects({ 'document.commit': (request, raising) => { duringCommit = addresses(rowsIn.el); return commits(document_)(request, raising); } }, () => {
    const result = intent(drift, 'edit.propose', {
      address: DRIFT,
      action: action('insert_positional', DRIFT, { position: 0 }),
      revision: document_.revision,
    });
    equal(result.disposition, 'consumed', 'the canvas answered');
    equal(result.operations.length, 0, 'the plan moved nothing itself');
  });

  equal(duringCommit, [NOISE, GRAIN, DRIFT], 'nothing had moved when the batch reached the bridge');
  equal(addresses(rowsIn.el), [DRIFT, NOISE, GRAIN], 'the row moved because the committed document says so');
  if ('moveBefore' in Element.prototype) assert(document.activeElement === drift.firstElementChild, 'the row kept its focus across the move');
  assert(rowsIn.el.children[0] === drift, 'and it is the same node');
});

test('the same intent gets different commands in two scopes, and a refusal says what, why and offers', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  const inspectorEl = document.createElement('div'), canvasEl = document.createElement('div');
  surface.el.append(inspectorEl, canvasEl);
  const inspector = scope(inspectorEl), canvas = scope(canvasEl);
  const knob = field(inspectorEl, document_, VELOCITY);

  inspector.handle('edit.propose', ({ args }) => propose(args.action, args.revision));
  canvas.handle('edit.propose', ({ args }) => ({
    disposition: 'consume',
    effects: [{ type: 'surface.refuse', what: args.address, why: 'the canvas edits forms, not parameters', offers: ['open the inspector'] }],
  }));

  const raise = () => intent(knob, 'edit.propose', {
    address: VELOCITY,
    action: action('replace', VELOCITY, { value: 8 }),
    revision: document_.revision,
  });

  withEffects({ 'document.commit': commits(document_), 'surface.refuse': (request, raising) => refuse(raising.source, request) }, () => {
    const committed = raise();
    equal(committed.effects[0].type, 'document.commit', 'the inspector offers a commit');
    equal(knob.value, '8', 'and the commit came back as an update');

    canvasEl.appendChild(knob);
    const refused = raise();
    equal(refused.effects[0].type, 'surface.refuse', 'the canvas offers no such command');
    equal(knob.dataset.refused, VELOCITY, 'the refusal names what');
    equal(knob.dataset.why, 'the canvas edits forms, not parameters', 'and why');
    equal(knob.dataset.offers, 'open the inspector', 'and what is offered instead');
    equal(document_.resolve(VELOCITY).value, 8, 'the document did not move');
  });
});

test('an edit against a stale revision is refused and nothing changes', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  const room = document.createElement('div');
  surface.el.appendChild(room);
  scope(room).handle('edit.propose', ({ args }) => propose(args.action, args.revision));
  const knob = field(room, document_, VELOCITY);
  const stale = document_.revision;

  withEffects({ 'document.commit': commits(document_) }, () => {
    document_.commit([action('replace', VELOCITY, { value: 4 })], stale);
    equal(knob.value, '4', 'someone else committed first');

    const result = intent(knob, 'edit.propose', {
      address: VELOCITY,
      action: action('replace', VELOCITY, { value: 99 }),
      revision: stale,
    });
    equal(result.effects[0].status, 'done', 'the adapter ran');
    assert(result.effects[0].result.ok === false, 'and the bridge refused the batch');
    equal(result.effects[0].result.diagnostics[0].code, 'stale-revision', 'with a diagnostic');
    equal(knob.dataset.refused, VELOCITY, 'the refusal is on the control that raised it');
    equal(knob.value, '4', 'the control still shows the committed value');
    equal(document_.resolve(VELOCITY).value, 4, 'and the document did not move');
  });
});

test('an address with no control changes nothing, and an element with no address is no control', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  const knob = field(surface.el, document_, VELOCITY);
  const plain = document.createElement('span');
  surface.el.appendChild(plain);

  const group = apply(surface.el, [{ kind: 'value', address: 'world:dust/unseen', value: 1 }], surface.adapter);
  equal(group.length, 0, 'no control, no operation');
  equal(surface.adapter.updates.length, 0, 'and nothing rendered');
  equal(knob.value, '3', 'the surface is as it was');

  assert(addressOf(plain) === null, 'an element outside every control has no address');
  equal(addressOf(knob), VELOCITY, 'and a control has its own');

  let raised = 0;
  on(surface.el, 'click', '[data-address]', () => { raised++; });
  plain.click();
  knob.click();
  equal(raised, 1, 'only the control raised');

  throws(() => apply(surface.el, [{ kind: 'sideways', address: VELOCITY }], surface.adapter), TypeError, 'an unknown change');
});

test('a commit inserts, moves and removes the forms it changed', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  const rowsIn = list(surface.el, document_, LAYERS);

  document_.commit([action('insert_positional', LAYERS + '/haze', { position: 1, value: 4 })], 1);
  equal(addresses(rowsIn.el), [NOISE, LAYERS + '/haze', GRAIN, DRIFT], 'the form arrived where the document put it');
  equal(valueIn(rowsIn.el.children[1]), '4', 'with its value');

  document_.commit([action('remove_positional', GRAIN)], 2);
  equal(addresses(rowsIn.el), [NOISE, LAYERS + '/haze', DRIFT], 'and left when the document removed it');

  document_.undo();
  equal(addresses(rowsIn.el), [NOISE, LAYERS + '/haze', GRAIN, DRIFT], 'undo is a commit like any other');
  equal(valueIn(rowsIn.el.children[2]), '2', 'and it brought the value back');
});

test('operationsFor names the regions presenting a parent and nothing else', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  const label = field(surface.el, document_, LAYERS, 'span');   // a presentation that is not a container
  const rowsIn = list(surface.el, document_, LAYERS);

  const operations = operationsFor(surface.el, [{ kind: 'insert', address: LAYERS + '/haze', parent: LAYERS, position: 0, value: 4 }]);
  equal(operations.length, 1, 'one insert, into the one region');
  assert(operations[0].region === rowsIn.el, 'the region is the container, not the label');
  assert(label.isConnected, 'and the label is still there');
});

// The three cases a review found: a notification is a sequence, and each record
// names the document the records before it left. Resolving the whole
// notification against the tree as it was would answer all three wrongly.
test('a record can name the control an earlier record created', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  const rowsIn = list(surface.el, document_, LAYERS);
  const HAZE = LAYERS + '/haze';

  apply(surface.el, [
    { kind: 'insert', address: HAZE, parent: LAYERS, position: 1, value: 1 },
    { kind: 'value', address: HAZE, value: 2 },
  ], surface.adapter);

  equal(addresses(rowsIn.el), [NOISE, HAZE, GRAIN, DRIFT], 'the form arrived where the record put it');
  equal(valueIn(rowsIn.el.children[1]), '2', 'and the update that followed reached it');
});

test('two moves in one notification count their positions one after the other', sandbox => {
  const document_ = fakeDocument({ world: { dust: { layers: { a: 1, b: 2, c: 3, d: 4 } } } });
  const surface = surfaceOn(sandbox, document_);
  const rowsIn = list(surface.el, document_, LAYERS);
  const at = name => LAYERS + '/' + name;
  equal(addresses(rowsIn.el), [at('a'), at('b'), at('c'), at('d')], 'ABCD to start');

  apply(surface.el, [
    { kind: 'move', address: at('d'), parent: LAYERS, position: 0 },
    { kind: 'move', address: at('c'), parent: LAYERS, position: 1 },
  ], surface.adapter);

  equal(addresses(rowsIn.el), [at('d'), at('c'), at('a'), at('b')], 'DCAB, each position read after the move before it');
});

test('a record can take the place an earlier record vacated', sandbox => {
  const document_ = fakeDocument({ world: { dust: { layers: { a: 1, b: 2 } } } });
  const surface = surfaceOn(sandbox, document_);
  const rowsIn = list(surface.el, document_, LAYERS);
  const at = name => LAYERS + '/' + name;

  apply(surface.el, [
    { kind: 'remove', address: at('a') },
    { kind: 'insert', address: at('c'), parent: LAYERS, position: 0, value: 3 },
  ], surface.adapter);

  equal(addresses(rowsIn.el), [at('c'), at('b')], 'the anchor the insert wanted was gone by the time it ran');
});

test('a notification that fails partway says how many operations ran', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  // Two lone fields, so the surface adapter is what renders them: one that
  // refuses the second update it is given.
  const first = field(surface.el, document_, NOISE, 'span');
  const second = field(surface.el, document_, GRAIN, 'span');
  let seen = 0;
  const brittle = { create() { throw new Error('nothing is created here'); }, update(node, data) {
    if (++seen === 2) throw new Error('render failed');
    node.textContent = String(data.value);
  } };

  const error = throws(() => apply(surface.el, [
    { kind: 'value', address: NOISE, value: 10 },
    { kind: 'value', address: GRAIN, value: 20 },
  ], brittle), Error, 'the adapter failure reaches the caller');
  equal(error.committed, 1, 'one operation of the notification ran');
  equal(first.textContent, '10', 'and it is the one that shows');
  equal(second.textContent, '2', 'the second control still shows what it had');
});

test('a record the surface cannot read fails a notification that is already part applied', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  const first = field(surface.el, document_, NOISE, 'span');

  const error = throws(() => apply(surface.el, [
    { kind: 'value', address: NOISE, value: 10 },
    { kind: 'sideways', address: GRAIN },
  ], surface.adapter), TypeError, 'the unknown record is refused');
  equal(error.committed, 1, 'and the count survives the conversion, not only the execution');
  equal(first.textContent, '10', 'the record before it stays applied');
});

test('one record with two presentations resolves each of them when its turn comes', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  // Three containers, each saying which one rendered a control.
  const rendering = tag => ({
    create(spec) { const li = document.createElement('li'); li.dataset.address = spec.address; li.textContent = tag + ':' + spec.value; return li; },
    update(node, data) { node.textContent = tag + ':' + data.value; },
  });
  const container = tag => { const ul = document.createElement('ul'); surface.el.appendChild(ul); return region(ul, rendering(tag), { items: [] }); };
  const a = container('A'), b = container('B'), c = container('C');
  a.insert([{ address: NOISE, value: 1 }]);
  b.insert([{ address: NOISE, value: 1 }]);
  const second = b.nodes[0];
  // The first update's observer takes the other presentation to a third region.
  const off = a.observe(() => b.move(second, null, c));

  apply(surface.el, [{ kind: 'value', address: NOISE, value: 9 }], surface.adapter);

  assert(second.parentElement === c.container, 'the observer moved it');
  equal(second.textContent, 'C:9', 'and the region it landed in rendered the update');
  equal(c.items[0].value, 9, 'in the mirror it landed in');
  off();
});

test('a removal scattered by an observer still leaves every region through its own bookkeeping', sandbox => {
  const document_ = bridge();
  const surface = surfaceOn(sandbox, document_);
  const rendering = tag => ({
    create(spec) { const li = document.createElement('li'); li.dataset.address = spec.address; li.textContent = tag; return li; },
    update(node, data) { node.textContent = tag + ':' + data.value; },
  });
  const container = tag => { const ul = document.createElement('ul'); surface.el.appendChild(ul); return region(ul, rendering(tag), { items: [] }); };
  const a = container('A'), b = container('B'), c = container('C');
  a.insert([{ address: NOISE, value: 1 }]);
  b.insert([{ address: NOISE, value: 1 }, { address: NOISE, value: 1 }]);
  const travelling = b.nodes[1];
  const heard = [];
  for (const [name, r] of [['A', a], ['B', b], ['C', c]]) r.observe(group => heard.push(name + ':' + group[0].op));
  // Removing A's presentation moves one of B's into C, so the pending removal
  // names one node in B and one in C by the time it runs.
  const off = a.observe(group => { if (group[0].op === 'remove') b.move(travelling, null, c); });

  apply(surface.el, [{ kind: 'remove', address: NOISE }], surface.adapter);

  equal([a.length, b.length, c.length], [0, 0, 0], 'every presentation is gone from the document');
  equal([a.items, b.items, c.items], [[], [], []], 'and out of every mirror');
  assert(heard.includes('B:remove'), 'B heard its own removal');
  assert(heard.includes('C:remove'), 'C heard the removal of what had just arrived');
  off();
});
