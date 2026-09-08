// Browser tests for the two examples. What is here is what only a browser can
// answer: focus, pointer capture, hidden subtrees, canvas pixels, the resize
// observer and the delegated listeners on a real root. The scene model, the
// history and the replay evaluation are checked without a browser in
// tests/pure/examples.test.mjs.
//
// The pointer events below are synthetic, so no pointer is active and
// setPointerCapture cannot take. The example guards that call, which is also
// what a real page needs when a pointer is released between the event and the
// handler.
import { intent } from '../intent.js';
import { test, assert, equal, note, throws } from './harness.js';
import { mountNavigationDemo } from '../examples/navigation/main.js';
import { createNavigation } from '../examples/navigation/navigation.js';
import { mountCanvasHistoryDemo } from '../examples/canvas-history/main.js';
import { BOUNDS, circleOf, initialScene } from '../examples/canvas-history/scene.js';

// Element identity, which the harness's `equal` cannot say: it compares two
// values as JSON, and every element is "{}" to JSON.stringify.
const same = (actual, expected, message) => assert(actual === expected, `${message}: not the same node`);

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = value => JSON.stringify(value);

note(`browser: ${navigator.userAgent}`);
note(`device pixel ratio: ${window.devicePixelRatio}. WebKit and Firefox are not run by this runner.`);

// ---------------------------------------------------------------- navigation

const control = (navigation, id, kind = '.nav-control') => navigation.element.querySelector(`.nav-entry[data-id="${id}"] > ${kind}`);
const listOf = (navigation, id) => navigation.element.querySelector(`.nav-entry[data-id="${id}"] > .nav-list`);

function openMenu(navigation, ...ids) {
  for (const id of ids) control(navigation, id, '.nav-disclosure').click();
}

test('two navigations render one spec with no shared state and no shared ids', sandbox => {
  const demo = mountNavigationDemo(sandbox);
  const [a, b] = demo.navigations;
  const ids = Array.from(sandbox.querySelectorAll('[id]'), node => node.id);
  equal(ids.length, new Set(ids).size, 'every DOM id in the page is unique');
  assert(ids.length > 0, 'the disclosures need ids for aria-controls');

  openMenu(a, 'products');
  equal(control(a, 'products', '.nav-disclosure').getAttribute('aria-expanded'), 'true', 'A opened');
  equal(control(b, 'products', '.nav-disclosure').getAttribute('aria-expanded'), 'false', 'B stayed closed');
  equal(listOf(b, 'products').hidden, true, 'B keeps its submenu hidden');
  demo.dispose();
  equal(sandbox.children.length, 0, 'dispose takes the demo out of the page');
});

test('a closed submenu is hidden, and a hidden control cannot take focus', sandbox => {
  const demo = mountNavigationDemo(sandbox);
  const [a] = demo.navigations;
  const button = control(a, 'products', '.nav-disclosure');
  const list = document.getElementById(button.getAttribute('aria-controls'));
  assert(list !== null, 'aria-controls names a real element');
  same(list, listOf(a, 'products'), 'and it is the submenu beside the button');
  const inside = list.querySelector('.nav-control');
  inside.focus();
  assert(document.activeElement !== inside, 'a control in a hidden subtree is not focusable');
  button.click();
  inside.focus();
  same(document.activeElement, inside, 'the same control takes focus once the submenu is open');
  demo.dispose();
});

test('an entry added later works with the rules already registered, once per activation', sandbox => {
  const demo = mountNavigationDemo(sandbox);
  const [a] = demo.navigations;
  const seen = [];
  sandbox.addEventListener('nav:select', event => seen.push(event.detail));

  sandbox.querySelector('[data-action="add"]').click();
  const added = control(a, 'scratch-1', '.nav-command');
  assert(added !== null, 'the new entry is in the open submenu');
  added.click();
  equal(seen.length, 1, 'one activation, one command event');
  equal(seen[0], { id: 'scratch-1', command: 'scratch' }, 'the event says which entry and which command');

  // The icon is a child of the button, so the nearest match above the target is
  // still the button.
  control(a, 'export', '.nav-command').querySelector('.nav-icon').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  equal(seen.length, 2, 'a click on an SVG descendant is a click on the entry');
  equal(seen[1].id, 'export', 'and it names the entry the icon belongs to');
  demo.dispose();
});

test('an update changes a label and an icon without replacing the host or losing focus', sandbox => {
  const demo = mountNavigationDemo(sandbox);
  const [a] = demo.navigations;
  openMenu(a, 'products');
  const button = control(a, 'tools', '.nav-disclosure');
  button.click();
  button.focus();
  const host = button.parentElement;
  const submenu = listOf(a, 'tools');

  a.update('tools', { label: 'Tools, renamed' });
  same(button.parentElement, host, 'the host is the same node');
  same(control(a, 'tools', '.nav-disclosure'), button, 'and so is the button');
  same(document.activeElement, button, 'focus stayed on it');
  equal(submenu.hidden, false, 'the open submenu stayed open');
  equal(button.querySelector('.nav-label').textContent, 'Tools, renamed', 'the label changed');

  a.update('tools', { icon: null });
  equal(button.querySelectorAll('.nav-icon').length, 0, 'the icon went');
  a.update('tools', { icon: 'star' });
  equal(button.querySelectorAll('.nav-icon').length, 1, 'and came back as one icon');
  same(document.activeElement, button, 'through both, focus never moved');
  demo.dispose();
});

test('a reorder keeps the node, and Escape closes the nearest group and gives focus back', sandbox => {
  const demo = mountNavigationDemo(sandbox);
  const [a] = demo.navigations;
  sandbox.querySelector('[data-action="add"]').click();
  const scratch = control(a, 'scratch-1', '.nav-command');
  const host = scratch.parentElement;
  const submenu = listOf(a, 'tools');
  equal(submenu.children.length, 2, 'Export and the new entry');

  sandbox.querySelector('[data-action="up"]').click();
  same(submenu.children[0], host, 'the same node moved to the front');
  same(control(a, 'scratch-1', '.nav-command'), scratch, 'with the same button inside it');

  scratch.focus();
  scratch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  equal(submenu.hidden, true, 'Escape closed the submenu the focus was in');
  same(document.activeElement, control(a, 'tools', '.nav-disclosure'), 'and focus went to the button that reopens it');

  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  equal(listOf(a, 'products').hidden, true, 'Escape again closed the group above');
  same(document.activeElement, control(a, 'products', '.nav-disclosure'), 'and focus followed');
  demo.dispose();
});

test('collapsing or removing the entry that holds focus hands focus to a survivor', sandbox => {
  const demo = mountNavigationDemo(sandbox);
  const [a] = demo.navigations;
  sandbox.querySelector('[data-action="add"]').click();
  const scratch = control(a, 'scratch-1', '.nav-command');

  scratch.focus();
  a.update('tools', { expanded: false });
  same(document.activeElement, control(a, 'tools', '.nav-disclosure'), 'a collapse moved focus out of the hidden subtree');

  a.update('tools', { expanded: true });
  control(a, 'scratch-1', '.nav-command').focus();
  a.remove('scratch-1');
  same(document.activeElement, control(a, 'export', '.nav-command'), 'a removal moved focus to the surviving neighbour');
  assert(!a.has('scratch-1'), 'the id is free again');

  // Nothing else moves focus. An update elsewhere leaves it where it is.
  a.update('export', { label: 'Export now' });
  same(document.activeElement, control(a, 'export', '.nav-command'), 'an unrelated update does not steal focus');
  demo.dispose();
});

test('a spec that clashes is refused, and it leaves nothing half built', sandbox => {
  const demo = mountNavigationDemo(sandbox);
  const [a] = demo.navigations;
  openMenu(a, 'products');
  const submenu = listOf(a, 'products');
  const before = submenu.children.length;
  let refused = null;
  try { a.add({ id: 'export', label: 'Clash' }, { parent: 'products' }); } catch (error) { refused = error; }
  assert(refused instanceof RangeError, 'the duplicate id was refused');
  equal(submenu.children.length, before, 'and the list is as it was');

  let nested = null;
  try {
    createNavigation([{ id: 'root', label: 'Root', children: [{ id: 'twin', label: 'One' }, { id: 'twin', label: 'Two' }] }]);
  } catch (error) { nested = error; }
  assert(nested instanceof RangeError, 'a clash inside a subtree is refused too');
  // The failed navigation was never mounted, and the good one still builds.
  const fresh = createNavigation([{ id: 'twin', label: 'One' }]);
  assert(fresh.has('twin'), 'a later navigation can use the id that failed');
  fresh.dispose();
  demo.dispose();
});

test('dispose then mount again: no duplicate handlers and no retained subscriptions', sandbox => {
  const first = mountNavigationDemo(sandbox);
  const stale = control(first.navigations[0], 'products', '.nav-disclosure');
  first.dispose();
  first.dispose();
  first.navigations[0].dispose();
  assert(!stale.isConnected, 'the old navigation left the document');
  stale.click();

  const second = mountNavigationDemo(sandbox);
  const seen = [];
  sandbox.addEventListener('nav:select', event => seen.push(event.detail));
  openMenu(second.navigations[0], 'products');
  openMenu(second.navigations[0], 'tools');
  control(second.navigations[0], 'export', '.nav-command').click();
  equal(seen.length, 1, 'the new instance dispatches once, and the old one not at all');
  second.dispose();
});

// ------------------------------------------------------------ canvas history

// A pointer event at a logical scene position. The client position is read from
// the canvas rectangle, which is what the example converts back.
function pointer(canvas, type, x, y, pointerId = 1) {
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId,
    isPrimary: true,
    pointerType: 'mouse',
    button: type === 'pointermove' ? -1 : 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: rect.left + x / BOUNDS.width * rect.width,
    clientY: rect.top + y / BOUNDS.height * rect.height,
  }));
}

// One pixel of the backing buffer, named in logical coordinates.
function pixel(canvas, x, y) {
  const scale = canvas.width / BOUNDS.width;
  const data = canvas.getContext('2d').getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
  return Array.from(data).join(',');
}

// The pixel that says whether a circle is drawn at a centre. It is read below
// the centre, because the name is painted in white across the middle and white
// is also the colour of the paper: the centre pixel cannot tell them apart.
const sample = (canvas, x, y) => pixel(canvas, x, y + 20);

const rows = demo => Array.from(demo.element.querySelectorAll('.history-row'), row => ({ text: row.textContent, state: row.dataset.state }));
const button = (demo, selector) => demo.element.querySelector(selector);
const command = (demo, type) => demo.element.querySelector(`.command[data-intent="${type}"]`);

test('a drag changes pixels, and only the release changes the document', sandbox => {
  const demo = mountCanvasHistoryDemo(sandbox);
  const canvas = demo.canvas;
  const before = demo.document.get();
  const empty = sample(canvas, 300, 300);

  pointer(canvas, 'pointerdown', 150, 140);
  pointer(canvas, 'pointermove', 300, 300);
  assert(sample(canvas, 300, 300) !== empty, 'the preview is drawn');
  assert(demo.document.get() === before, 'the document is the value it was');
  equal(demo.document.get().entries.length, 0, 'and it has no entries');
  equal(rows(demo).length, 0, 'the history list is empty');

  pointer(canvas, 'pointerup', 300, 300);
  const after = demo.document.get();
  equal(after.entries.length, 1, 'the release wrote exactly one entry');
  equal(after.revision, 1, 'and advanced the revision once');
  equal(json(circleOf(after.scene, 'ash')), json({ ...circleOf(before.scene, 'ash'), x: 300, y: 300 }), 'the circle moved to the released position');
  equal(rows(demo).length, 1, 'one row appeared');
  equal(rows(demo)[0].state, 'applied', 'and it applies');
  demo.dispose();
});

test('Escape and a cancelled pointer end a drag without writing anything', sandbox => {
  const demo = mountCanvasHistoryDemo(sandbox);
  const canvas = demo.canvas;
  const committed = sample(canvas, 150, 140);

  pointer(canvas, 'pointerdown', 150, 140);
  pointer(canvas, 'pointermove', 400, 300);
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  equal(demo.document.get().entries.length, 0, 'Escape wrote nothing');
  equal(sample(canvas, 150, 140), committed, 'and put the committed scene back');
  pointer(canvas, 'pointerup', 400, 300);
  equal(demo.document.get().entries.length, 0, 'the release after Escape commits nothing');

  pointer(canvas, 'pointerdown', 150, 140);
  pointer(canvas, 'pointermove', 400, 300);
  pointer(canvas, 'pointercancel', 400, 300);
  equal(demo.document.get().entries.length, 0, 'a cancelled pointer wrote nothing');
  equal(sample(canvas, 150, 140), committed, 'and the committed scene is on screen');

  // A press that goes nowhere is not an edit either.
  pointer(canvas, 'pointerdown', 150, 140);
  pointer(canvas, 'pointerup', 150, 140);
  equal(demo.document.get().entries.length, 0, 'a press with no movement writes nothing');
  demo.dispose();
});

test('move, colour, move, undo everything, redo everything', sandbox => {
  const demo = mountCanvasHistoryDemo(sandbox);
  const canvas = demo.canvas;
  const start = json(demo.document.get().scene);

  pointer(canvas, 'pointerdown', 150, 140);
  pointer(canvas, 'pointermove', 300, 300);
  pointer(canvas, 'pointerup', 300, 300);
  button(demo, '.pick[data-id="birch"]').click();
  button(demo, '.swatch[data-color="#8250df"]').click();
  button(demo, '.pick[data-id="cedar"]').click();
  button(demo, '.nudge-button[data-dx="1"]').click();

  const history = demo.document.get();
  equal(history.entries.length, 3, 'three edits, three entries');
  const final = json(history.scene);
  equal(rows(demo).length, 3, 'three rows');

  for (let i = 0; i < 3; i++) command(demo, 'history:undo').click();
  equal(json(demo.document.get().scene), start, 'undoing everything is the scene it started from');
  equal(json(demo.document.get().scene), json(initialScene()), 'which is the fixture');
  equal(rows(demo).map(row => row.state).join(), 'undone,undone,undone', 'every row reads as undone');
  equal(command(demo, 'history:undo').disabled, true, 'Undo is disabled at the start of the list');

  for (let i = 0; i < 3; i++) command(demo, 'history:redo').click();
  equal(json(demo.document.get().scene), final, 'redoing everything is the scene it reached');
  equal(demo.document.get().revision, 9, 'nine changes, counted in one direction only');
  equal(button(demo, '.swatch[data-color="#1a7f37"]').getAttribute('aria-pressed'), 'true', 'the inspector shows the colour of the selected circle');
  equal(command(demo, 'history:redo').disabled, true, 'Redo is disabled at the end of the list');
  demo.dispose();
});

test('an edit after an undo drops the redo tail, in the document and in the list', sandbox => {
  const demo = mountCanvasHistoryDemo(sandbox);
  button(demo, '.pick[data-id="ash"]').click();
  button(demo, '.nudge-button[data-dx="1"]').click();
  button(demo, '.nudge-button[data-dx="1"]').click();
  const first = demo.element.querySelector('.history-row');
  equal(rows(demo).length, 2, 'two rows');

  command(demo, 'history:undo').click();
  button(demo, '.swatch[data-color="#8250df"]').click();
  const history = demo.document.get();
  equal(history.entries.length, 2, 'the tail went and the new edit took its place');
  equal(history.cursor, 2, 'the cursor is at the end again');
  equal(rows(demo).length, 2, 'and the list says the same');
  equal(rows(demo)[1].text.includes('#8250df'), true, 'the last row is the new edit');
  same(demo.element.querySelector('.history-row'), first, 'the surviving row is the same node, so the list is not rebuilt');
  demo.dispose();
});

test('replay draws the committed edits and leaves the document alone', async sandbox => {
  const demo = mountCanvasHistoryDemo(sandbox);
  const canvas = demo.canvas;
  pointer(canvas, 'pointerdown', 150, 140);
  pointer(canvas, 'pointermove', 500, 300);
  pointer(canvas, 'pointerup', 500, 300);
  const committed = demo.document.get();
  const atEnd = sample(canvas, 500, 300);

  command(demo, 'replay:start').click();
  assert(demo.replaying, 'replay is running');
  equal(command(demo, 'replay:stop').disabled, false, 'Stop is the control replay leaves alone');
  equal(command(demo, 'history:undo').disabled, true, 'Undo is not');
  await frame();
  await frame();
  assert(sample(canvas, 500, 300) !== atEnd, 'the playback scene is not the committed one');
  same(demo.document.get(), committed, 'and the document has not moved');

  command(demo, 'replay:stop').click();
  assert(!demo.replaying, 'Stop stopped it');
  equal(sample(canvas, 500, 300), atEnd, 'the committed scene is back on screen');
  same(demo.document.get(), committed, 'with the same history and the same cursor');

  // Escape stops it too, from anywhere in the demo.
  command(demo, 'replay:start').click();
  demo.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert(!demo.replaying, 'Escape stopped the replay');
  same(demo.document.get(), committed, 'and wrote nothing');

  command(demo, 'replay:start').click();
  await wait(750);
  assert(!demo.replaying, 'a replay that runs out finishes on its own');
  equal(sample(canvas, 500, 300), atEnd, 'and leaves the committed scene drawn');
  same(demo.document.get(), committed, 'having written nothing');
  equal(rows(demo).map(row => row.state).join(), 'applied', 'the row is applied again, not playing');
  demo.dispose();
});

test('starting replay keeps focus in the page, so Escape still reaches the handler', sandbox => {
  const demo = mountCanvasHistoryDemo(sandbox);
  button(demo, '.pick[data-id="ash"]').click();
  button(demo, '.nudge-button[data-dx="1"]').click();
  const replay = command(demo, 'replay:start'), stop = command(demo, 'replay:stop');

  replay.focus();
  same(document.activeElement, replay, 'the reader is on the Replay button');
  replay.click();
  assert(demo.replaying, 'replay is running');
  equal(replay.disabled, true, 'the button that started it is disabled');
  same(document.activeElement, stop, 'so focus went to the control that stays enabled');

  // Escape from where the focus actually is, which is the only path a reader has.
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert(!demo.replaying, 'Escape stopped it');
  same(document.activeElement, replay, 'and focus came back to the button that started it');
  demo.dispose();
});

test('two demos cannot share one name, and disposing frees only that name', sandbox => {
  const one = mountCanvasHistoryDemo(sandbox, { instance: 'twin' });
  const built = sandbox.children.length;
  throws(() => mountCanvasHistoryDemo(sandbox, { instance: 'twin' }), RangeError, 'the second mount is refused');
  equal(sandbox.children.length, built, 'and it built nothing');

  button(one, '.pick[data-id="ash"]').click();
  button(one, '.nudge-button[data-dx="1"]').click();
  equal(one.document.get().entries.length, 1, 'the demo holding the name still gets its own edits');

  one.dispose();
  const two = mountCanvasHistoryDemo(sandbox, { instance: 'twin' });
  button(two, '.pick[data-id="ash"]').click();
  button(two, '.nudge-button[data-dx="1"]').click();
  equal(two.document.get().entries.length, 1, 'the name is free again, and it commits to the new document');
  two.dispose();
});

test('a cancellation from another pointer leaves this drag alone', sandbox => {
  const demo = mountCanvasHistoryDemo(sandbox);
  const canvas = demo.canvas;
  pointer(canvas, 'pointerdown', 150, 140, 1);
  pointer(canvas, 'pointermove', 300, 300, 1);
  pointer(canvas, 'pointercancel', 10, 10, 2);
  pointer(canvas, 'lostpointercapture', 10, 10, 2);
  pointer(canvas, 'pointerup', 300, 300, 1);
  equal(demo.document.get().entries.length, 1, 'the first pointer still committed its move');
  equal(circleOf(demo.document.get().scene, 'ash').x, 300, 'at the position it released');

  // Its own cancellation still ends it.
  pointer(canvas, 'pointerdown', 300, 300, 1);
  pointer(canvas, 'pointermove', 400, 200, 1);
  pointer(canvas, 'pointercancel', 400, 200, 1);
  pointer(canvas, 'pointerup', 400, 200, 1);
  equal(demo.document.get().entries.length, 1, 'and a cancellation naming it writes nothing');
  demo.dispose();
});

test('an edit the document refuses changes nothing and says so', sandbox => {
  const demo = mountCanvasHistoryDemo(sandbox);
  const before = demo.document.get();
  const result = intent(demo.canvas, 'scene:move', { id: 'nope', x: 100, y: 100 });
  equal(result.disposition, 'consumed', 'the scope answered');
  equal(result.operations.length, 0, 'the plan carried no operations');
  equal(result.effects.length, 1, 'and one effect');
  equal(result.effects[0].status, 'failed', 'which failed in the document');
  assert(demo.document.get() === before, 'the document is untouched');
  equal(rows(demo).length, 0, 'and no row was written');

  const outside = intent(demo.canvas, 'scene:move', { id: 'ash', x: 5, y: 5 });
  equal(outside.effects[0].status, 'failed', 'a position outside the scene is refused as well');
  assert(demo.document.get() === before, 'still untouched');

  // An interpreter cannot write, so a refusal is an effect too: it says what
  // happened where the reader can see it and proposes nothing else.
  button(demo, '.pick[data-id="ash"]').click();
  button(demo, '.nudge-button[data-dx="1"]').click();
  command(demo, 'replay:start').click();
  const during = intent(demo.canvas, 'scene:move', { id: 'ash', x: 200, y: 200 });
  equal(during.effects.length, 1, 'one effect');
  equal(during.effects[0].type, 'canvas-demo.say', 'and it is the refusal, not a commit');
  assert(demo.element.querySelector('.status').textContent.includes('Replay is running'), 'the status says why');
  equal(demo.document.get().entries.length, 1, 'the document kept the one entry it had');
  command(demo, 'replay:stop').click();
  demo.dispose();
});

test('resizing rebuilds the backing buffer and redraws, without touching the document', async sandbox => {
  const demo = mountCanvasHistoryDemo(sandbox);
  const canvas = demo.canvas;
  button(demo, '.pick[data-id="ash"]').click();
  button(demo, '.nudge-button[data-dx="1"]').click();
  const before = demo.document.get();
  const width = canvas.width;

  canvas.style.width = '320px';
  canvas.style.height = '200px';
  for (let i = 0; i < 10 && canvas.width === width; i++) await frame();
  assert(canvas.width !== width, 'the backing buffer followed the element');
  equal(canvas.width, Math.round(320 * (window.devicePixelRatio || 1)), 'at the device pixel ratio');
  assert(demo.document.get() === before, 'the document did not hear about it');
  const circle = circleOf(before.scene, 'ash');
  assert(sample(canvas, circle.x, circle.y) !== pixel(canvas, 10, 10), 'the scene was drawn again after the buffer reset');
  demo.dispose();
});

test('an inspector edit does not take focus, and two demos keep their own documents', sandbox => {
  const one = mountCanvasHistoryDemo(sandbox);
  const two = mountCanvasHistoryDemo(sandbox);
  assert(one.instance !== two.instance, 'each mount is its own instance');

  const pick = button(one, '.pick[data-id="ash"]');
  pick.focus();
  pick.click();
  same(document.activeElement, pick, 'selecting kept focus on the button');
  const swatch = button(one, '.swatch[data-color="#e0562d"]');
  swatch.focus();
  swatch.click();
  same(document.activeElement, swatch, 'and so did colouring');
  assert(one.canvas !== document.activeElement, 'the canvas was not focused by an inspector edit');

  equal(one.document.get().entries.length, 1, 'the demo that was edited has the entry');
  equal(two.document.get().entries.length, 0, 'the other one has nothing');
  equal(rows(two).length, 0, 'and no rows');

  one.dispose();
  // The effect adapters are shared, so the second demo has to keep working after
  // the first one has gone.
  button(two, '.pick[data-id="birch"]').click();
  button(two, '.nudge-button[data-dy="-1"]').click();
  equal(two.document.get().entries.length, 1, 'the surviving demo still commits');
  two.dispose();
  equal(sandbox.children.length, 0, 'both demos left the page');
});

test('a demo mounted after every other one was disposed registers its effects again', sandbox => {
  const first = mountCanvasHistoryDemo(sandbox);
  first.dispose();
  const second = mountCanvasHistoryDemo(sandbox);
  button(second, '.pick[data-id="ash"]').click();
  button(second, '.nudge-button[data-dx="1"]').click();
  equal(second.document.get().entries.length, 1, 'the commit effect ran for the new instance');
  second.dispose();
});
