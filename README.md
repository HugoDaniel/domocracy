# domocracy

**domocracy is a small library for changing DOM elements through explicit operations and giving controls behavior through their surroundings.**

## Start here: one button, two rooms

An Apply button means one thing over a form and another over a dialog. The usual ways to handle that are to hand the button a callback from the component above it, to read a `context` variable inside its click handler, or to keep a command registry with a `canExecute` next to every command. Each of them puts the knowledge of what Apply does into the button or beside it, and each keeps a second copy of that knowledge for the label and the disabled state, which then drifts from what the click does.

Here the button knows nothing. It asks, and the part of the page it sits in answers. The twenty lines below build that, and every word is explained before it is used. To run them, serve the folder over HTTP with the import map from [Install and run](#install-and-run).

### The page

Two sections and one button. The button starts in the form. Later it moves into the dialog, and none of its code changes.

```html
<section id="form">
  <input placeholder="Title">
  <button id="apply">Apply</button>
</section>
<section id="dialog">Discard the draft?</section>
<p id="status"></p>
```

`main.js` opens by picking those up:

```js
import { scope, intent, interpret, effect } from 'domocracy/intent';

const form = document.querySelector('#form');
const dialog = document.querySelector('#dialog');
const apply = document.querySelector('#apply');
const status = document.querySelector('#status');
```

### An intent is a request with a name

Pressing a doorbell does not open the door. It asks, and whoever is inside decides. An **intent** is that kind of ask: a name, here `apply`, raised from an element. The element it is raised from is the **source**, and the source decides nothing about what happens next.

The button's whole click handler raises one:

```js
apply.addEventListener('click', () => intent(apply, 'apply'));
```

Nothing answers yet, so pressing the button does nothing, and that is not an error. An intent nobody answers is a request that went unheard.

### A scope is a room that answers

A **scope** is an element that has agreed to answer for the intents raised from anything inside it. Think of it as a room: what "apply" means is decided by the room the button is standing in. The function that answers is an **interpreter**, and a scope holds one per intent name.

When the button raises `apply`, the library walks up from the button's parent to the top of the document. That walk is the **route**, and along it the library asks each scope that has an interpreter for `apply`, nearest first, until one of them gives a final answer.

```text
<body>
  <section id="form">      a scope: on the route, asked first
    <input>
    <button id="apply">    the source: the walk starts above it
  <section id="dialog">    a scope, but not on this route
```

### The answer is a plan, and nothing in it has happened

An interpreter does nothing. It returns a **plan**: a plain object describing what would happen, the way a recipe describes a meal. Two rules make a plan safe to hold. An interpreter reads the tree and writes nothing, and the library holds a guard while interpreters run, so any change made through it during that time throws. And nothing in a plan runs until the walk is over.

Every plan carries a **disposition**, which says how far the walk continues. `consume` means "this is the answer, ask nobody else". `continue` means "add this and keep asking the rooms outside". `pass` means "nothing to say here", and returning nothing at all is a pass.

The dialog's answer is the shortest plan there is:

```js
{ disposition: 'consume', meaning: 'Confirm and close' }
```

`meaning` is not a word the library knows. domocracy reads `disposition`, `operations` and `effects` on a plan and keeps the whole object exactly as the interpreter returned it, so anything else on it is yours. This page puts `meaning` on every plan: one sentence for people, saying what the room would do. The plan above says something and does nothing, because it proposes nothing. Words are not work.

### An effect is work outside the DOM

A plan can propose two kinds of work. **Operations** are DOM changes (insert, move, update, remove, clear), and this example needs none. **Effects** are everything else: saving, closing, announcing. An effect in a plan is a request by name, such as `{ type: 'save' }`, and the plan does not say how it is done. The function that does it is an **adapter**, registered once per type for the whole page, and it runs after the operations of an accepted plan.

Now both rooms answer in full. The form reads its own input and refuses when there is no title:

```js
scope(form).handle('apply', (raised, place) => {
  const title = place.querySelector('input').value.trim();
  if (title === '') return { disposition: 'consume', refused: 'Give it a title first' };
  return { disposition: 'consume', meaning: `Save “${title}”`, effects: [{ type: 'save', title }] };
});
scope(dialog).handle('apply', () =>
  ({ disposition: 'consume', meaning: 'Confirm and close', effects: [{ type: 'close' }] }));

effect('save', ({ title }) => { status.textContent = `Saved “${title}”`; });
effect('close', () => { dialog.hidden = true; });
```

An interpreter receives the intent that was raised (its source, its name and its arguments) and the scope's own element, which is how the form finds its input without a reference held elsewhere. `refused` is another word of this page, not of the library: a plan that proposes nothing and says why. Because it proposes nothing, pressing Apply on an empty form runs nothing, and the reason stays readable in the plan.

### Ask before doing

`interpret` is the first half of `intent`: the same walk, the same answers, checked, and nothing run. It returns the route and the **trace**, which is the list of scopes that answered, nearest first, each with the plan it returned. A control can ask what it would do, so its label and its availability come from the same function that would run it and cannot drift from it.

```js
function caption() {
  const plan = interpret(apply, 'apply').trace[0]?.plan;
  apply.title = plan?.meaning ?? plan?.refused ?? 'Nothing to do here';
}
form.addEventListener('input', caption);
caption();
```

Nothing re-renders by itself. A plan is good for the tree as it stands, so the page asks again after every keystroke. When the button is pressed, `intent` interprets afresh rather than reusing what `caption` saw.

### Try it

Type a title and hover the button: "Save “Hello”". Clear the input: "Give it a title first", and a press does nothing. Then move the button into the other room from the console:

```js
dialog.append(apply); caption();   // the title reads "Confirm and close"
```

The button's code did not change. Its room did. A second way of asking costs one line, because the route is the tree and not wiring:

```js
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.metaKey) intent(document.activeElement, 'apply');
});
```

Cmd+Enter in the form's input raises the same request from wherever focus is, and the form answers it the same way, not knowing who asked.

### What this gives you, and what stays yours

The button has no `onApply`, no `switch (context)` and no registry entry. Its meaning, its availability and its execution are one walk, so they agree. A refusal is a plan that proposes nothing, not an exception. Any other raiser gets the same answer for free.

What stays yours: the words `meaning` and `refused`, and asking again when the tree changes. The walk is the light-DOM ancestry only, so a menu rendered elsewhere raises from its anchor, and a Web Component raises from its host. The rest of this README covers the regions that run operations, plans that more than one room contributes to, and a document with its own history behind the effects.

You supply the rendering functions. A region inserts, moves, updates, or removes the elements they create. Delegated handlers work for existing and future children. Optional scopes interpret a control's request according to where it lives. An optional surface adapter connects these mechanisms to a document with its own state and history.

Three ES modules, no runtime dependencies, and TypeScript declarations for every entry point.

```text
Browser interaction
        │
        ▼
Delegated handler                  domocracy
        │
        ├── execute a DOM operation directly
        │
        └── raise an intent        domocracy/intent
                  │
            ancestor scopes
                  │
            operations + effects
                  │
            execute, then report
```

Use the core for explicitly managed lists and movable controls. Add intentions when a control should ask its surroundings what to do. Add the surface module when the page presents a document whose edits, validation, and undo belong elsewhere. These layers can be adopted separately.

## Contents

- [Start here: one button, two rooms](#start-here-one-button-two-rooms)
- [Install and run](#install-and-run)
- [Tutorial: a board of movable cards](#tutorial-a-board-of-movable-cards)
- [Operations, groups, and identity](#operations-groups-and-identity)
- [Tutorial: give the rooms different meanings](#tutorial-give-the-rooms-different-meanings)
- [Tutorial: edit a document through a surface](#tutorial-edit-a-document-through-a-surface)
- [Execution and failure contracts](#execution-and-failure-contracts)
- [API reference](#api-reference)
- [Integration, cleanup, and tradeoffs](#integration-cleanup-and-tradeoffs)
- [Development and further reading](#development-and-further-reading)

## Install and run

```sh
npm install domocracy
```

In a project with a bundler, use the package entry points:

```js
import { region, on, dispatch, op } from 'domocracy';
import { scope, interpret, intent, effect } from 'domocracy/intent';
import { apply as applySurface } from 'domocracy/surface';
```

Only import the layers you use. The core does not import the other two modules.

For the tutorials below, a bundler is optional. Put `index.html` and `main.js` beside the `node_modules` directory created by npm. Add this import map to the HTML before the module script:

```html
<script type="importmap">
{
  "imports": {
    "domocracy": "./node_modules/domocracy/domocracy.js",
    "domocracy/intent": "./node_modules/domocracy/intent.js",
    "domocracy/surface": "./node_modules/domocracy/surface.js"
  }
}
</script>
```

Serve the directory over HTTP using your development server. For example, if Python is installed:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. Loading modules through `file://` is not a reliable substitute for an HTTP server. You can also serve the three library files directly and import their relative URLs.

## Tutorial: a board of movable cards

This example creates two rooms. Cards can be added, activated, moved between rooms, and removed. Later, the rooms will interpret activation differently.

### 1. Write the page

Use this `index.html`, adding the import map above where indicated if you are not using a bundler:

```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>domocracy cards</title>
<!-- Put the import map here when running without a bundler. -->
<main id="board">
  <button id="add" type="button">Add a card</button>
  <section id="draft-room">
    <h2>Drafts</h2>
    <ul id="drafts"></ul>
  </section>
  <section id="review-room">
    <h2>Review</h2>
    <ul id="review"></ul>
  </section>
  <p id="status" role="status">Activate a card.</p>
</main>
<script type="module" src="./main.js"></script>
</html>
```

### 2. Create regions and an adapter

Start `main.js` with:

```js
import { region, regionOf, on, dispatch, op } from 'domocracy';

const board = document.querySelector('#board');
const status = document.querySelector('#status');

const cardAdapter = {
  create(spec) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span data-label></span>
      <button type="button" data-action="activate">Activate</button>
      <button type="button" data-action="move">Move to other room</button>
      <button type="button" data-action="remove">Remove</button>
    `;
    cardAdapter.update(li, spec);
    return li;
  },
  update(node, data) {
    node.querySelector('[data-label]').textContent = data.name;
  },
};

const drafts = region(document.querySelector('#drafts'), cardAdapter);
const review = region(document.querySelector('#review'), cardAdapter);

drafts.insert([{ name: 'Sky' }, { name: 'Trees' }]);
review.insert([{ name: 'Dust' }]);
```

A **region** manages a container's direct child elements. An **adapter** describes how to create and update one child. `create(spec)` returns a fresh element; `update(node, data)` changes that element's presentation. Keep headings, toolbars, and other unrelated elements outside the region's container.

The library does not generate a template or compare a desired tree with the current one. `drafts.insert(...)` creates and inserts those cards immediately. Later, `drafts.update(node, data)` calls your update function on that node. Whether `data` is a full record or a patch is your adapter's convention.

The HTML string above is fixed markup. User-supplied names are written with `textContent`.

### 3. Handle interactions from the parent

Append this to `main.js`:

```js
let serial = 0;

const offAdd = on(board, 'click', '#add', () => {
  drafts.insert([{ name: `Card ${++serial}` }]);
});

const offMove = on(board, 'click', '[data-action="move"]', (event, button) => {
  const card = button.closest('li');
  const from = regionOf(card.parentElement);
  const to = from === drafts ? review : drafts;
  from.move(card, null, to);
});

const offRemove = on(board, 'click', '[data-action="remove"]', (event, button) => {
  const card = button.closest('li');
  regionOf(card.parentElement).remove(card);
});

const offActivate = on(board, 'click', '[data-action="activate"]', (event, button) => {
  const card = button.closest('li');
  const name = card.querySelector('[data-label]').textContent;
  dispatch(card, 'card:activate', { name });
});

const offMeaning = on(board, 'card:activate', 'li', event => {
  status.textContent = `Activated ${event.detail.name}`;
  event.preventDefault();
});
```

Try adding a card, moving it, and activating it again. No listener was attached to that card. `on(root, type, selector, handler)` registers a rule on the ancestor and supplies the closest matching element as the handler's second argument.

`data-action` and `data-label` are this example's conventions, not attributes interpreted by domocracy.

The click handler translates a browser interaction into a semantic event: `card:activate`. `dispatch` creates a bubbling, cancelable `CustomEvent`; its payload is `event.detail`. It returns `false` if a listener calls `preventDefault()`. That reports cancellation, not necessarily success of an application action.

Rules on the same root and event type run in registration order. Calling `stopPropagation()` stops later domocracy rules for that event as well as ancestor propagation. Use `focusin`/`focusout` for delegated focus handling, because `focus`/`blur` do not bubble. The returned `off` functions remove individual rules.

## Operations, groups, and identity

### A node is an identity; an index is a position

`drafts.nodes` is the container's live `HTMLCollection`. Moving a card changes its position while retaining the same node object. An application may keep domain identity in its own records or document addresses; domocracy does not allocate durable IDs for it.

`region.at(element)` finds the direct child containing a target and returns `{ node, index }`, or `null` when the target is outside that region. This is useful when an event lands on something nested inside a row.

An index can change after any insertion, removal, or move. Capture node references when a sequence must keep addressing the same objects. For a stable snapshot of current children, use `Array.from(drafts.nodes)`.

`move` uses `moveBefore` when available and the implementation's root check allows it, otherwise `insertBefore`. A supported state-preserving move can retain browser-managed state that ordinary reinsertion may reset. The same node object is retained in either case, but preserving every browser state is not guaranteed on the fallback path. Removing a node is a different lifecycle operation and has no automatic undo.

### A change can be a value

There are five operation constructors:

| Constructor | Meaning |
|---|---|
| `op.insert(container, before, specs)` | Create children and insert them before the anchor. |
| `op.move(node, container, before)` | Place an existing node in that container. |
| `op.update(node, data)` | Render data through an adapter. |
| `op.remove(nodes)` | Remove the named nodes. |
| `op.clear(container)` | Empty the container with `textContent = ''`. |

`container` is a DOM element, not a region object. `before` is a child node or `null` for the end. Region convenience methods construct these values and execute them for you.

To try a group in the board example, append the following. It resets the draft cards so the example has known inputs:

```js
drafts.clear();
drafts.insert([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
const [a, b, c] = drafts.nodes;

const changes = [
  op.move(c, drafts.container, a),
  op.remove([b]),
];

// Building changes has not touched the DOM.
drafts.execute(changes); // Drafts now contains C, A.
```

A **group** is an ordered sequence of operations. The dry run models parent relationships earlier operations would leave, so it can reject an insertion before an anchor that an earlier operation removes. `validate(operations)` exposes that check without executing anything.

Use direct region methods for that region's children. `execute` uses the calling region's adapter for inserts and updates; it is not a general router for arbitrary operations on unrelated containers. Cross-region moves have special handling. Intentions provide ownership routing for plans spanning regions.

### Immutability has a boundary

Operation constructors freeze the operation envelope. `insert` and `remove` copy and freeze their input arrays. Validation returns a frozen copy of the group array.

Specs, update payloads, and nodes are still references. Mutating a payload can change what a pending operation will see. Keep those values stable, or freeze them yourself. Use the constructors; passing a handwritten operation to `validate` does not recursively freeze it.

Live operation groups are useful for inspection and observation, but they are not portable history. They reference living nodes and arbitrary payloads. Durable undo, serialization, and replay semantics belong to the application or document.

### Observe committed groups

```js
const offObserve = drafts.observe((group, currentRegion) => {
  console.log(group.map(change => change.op), currentRegion.length);
});
```

Observers receive `(group, region)` after a successful group. A cross-region move notifies the source and destination. A direct `swap` is one group containing two moves. Intentions execute their operations individually, so an observer sees those individual groups rather than one combined intent.

Observers are synchronous. Their exceptions propagate, and a throwing observer can prevent subsequent observers from running. Failure accounting is described below.

### Keep an item mirror only when needed

By default, `region.items` is `null`. You can opt into one item per child:

```js
const container = document.createElement('ul');
board.append(container);
const tracked = region(container, cardAdapter, { items: [] });
tracked.insert([{ name: 'Tracked card' }]);
console.log(tracked.items[0].name); // Tracked card
```

Initial items must match the number of existing children. Arrays are copied and frozen; their contents are not deeply frozen. Inserts add specs, updates replace an item with the update payload, and moves carry the item between mirrored regions. An arrival from an unmirrored source is represented as `undefined`.

This is an optional presentation mirror, not a document store. Many changes allocate new arrays; repeated updates to a large mirrored region can be expensive. When your application already owns its data, omit the mirror.

## Tutorial: give the rooms different meanings

Native events work well for straightforward interaction. Add **intentions** when ancestors should interpret a request into an inspectable plan before it executes.

A **scope** belongs to an ancestor element. An **interpreter** answers an intent type with a **plan**: a disposition, proposed DOM operations, and optional effect requests. Interpreters describe work; executors perform it.

Append this to the board's `main.js`. It removes the earlier activation rules so activation has exactly one path:

```js
import { scope, intent, effect } from 'domocracy/intent';

offActivate();
offMeaning();

const draftScope = scope(document.querySelector('#draft-room'));
const reviewScope = scope(document.querySelector('#review-room'));

const offDraftHandler = draftScope.handle('card:activate', raised => ({
  disposition: 'consume',
  operations: [op.update(raised.source, { name: `${raised.args.name} ✓` })],
}));

const offReviewHandler = reviewScope.handle('card:activate', raised => ({
  disposition: 'consume',
  effects: [{ type: 'demo.announce', text: `Reviewing ${raised.args.name}` }],
}));

const offAnnounce = effect('demo.announce', request => {
  status.textContent = request.text;
});

const offIntentClick = on(board, 'click', '[data-action="activate"]', (event, button) => {
  const card = button.closest('li');
  const name = card.querySelector('[data-label]').textContent;
  const result = intent(card, 'card:activate', { name });
  console.log(result.trace);
});
```

Activate a draft: its label changes. Move it to Review and activate it: the status announces it. The activation handler is unchanged. The same node's ancestry determines which interpreter answers.

An **effect** is a request handled by an application adapter after DOM operations finish. It can commit to an external document, start asynchronous work, or invoke host behavior such as the announcement above. The effect mechanism does not provide persistence or special permissions.

### How a scope answers

| Disposition | Contribution | Continue to outer scopes? |
|---|---|---|
| `pass` | None. Returning `null` or `undefined` also passes. | Yes |
| `continue` | Add this plan's operations and effects. | Yes |
| `consume` | Add this plan's operations and effects. | No |

A passing plan containing operations or effects throws. There is one interpreter per intent type per scope; a second registration throws. Compose multiple answers inside one interpreter if needed. Scope order is ancestry, not CSS specificity.

`intent(source, type, args)` requires a connected element. Its walk starts at `source.parentElement`, so a scope does not interpret an intent raised from its own host. The route is captured before interpreting. Moving the source in the resulting plan changes the route of its next intent, not the current one.

The walk follows light-DOM parents, ignores slot assignment, and stops at a shadow root. A Web Component should raise its public intent from its host when it wants surrounding scopes to interpret it.

### Events and intentions are different tools

`dispatch` sends a native `CustomEvent`. Its listeners run as part of event dispatch and may act immediately. `intent` explicitly walks registered scopes, collects plans, validates operations, executes them, and reports the result. A native event does not automatically become an intent; your handler makes that connection.

`intent` returns `{ id, disposition, route, trace, operations, effects }`. The result disposition is `consumed` or `passed`, not the interpreter's three-way disposition. A `continue` plan can execute work even if the final result is `passed`. The route is every scope above the source; the trace says which of them answered and what each contributed; effects contain `done` or `failed` outcomes.

`interpret(source, type, args)` does everything `intent` does before executing and returns it frozen: the same route, trace and validated operations, with the effects still as requests. Nothing runs. A page that shows what a control would do calls `interpret`; when the control is used it calls `intent`, which interprets afresh, because the tree may have changed in between.

Effect adapters are registered globally by type, with one adapter per type. Scope-local interpretation does not make effect registration scope-local. A missing adapter or a synchronous adapter exception produces a failed effect outcome; later effects still run.

Promises are returned as results, not awaited. `done` means the adapter returned successfully, not that asynchronous work completed. The adapter must handle eventual rejection and report completion through your application's normal channel. Do not treat the immediate intent result as confirmation that a save finished.

## Tutorial: edit a document through a surface

The first tutorial lets DOM operations directly define the board. An editor often has another authority: a source document, database, or application store. A control then proposes an edit and renders the committed result.

```text
control → intent → scope → effect → document commit
                                        │
                                  change records
                                        │
                                  surface.apply
                                        │
                                 updated controls
```

The **surface** is the ancestor under which document presentations live. A **control** carries a document **address** in `data-address`. Multiple controls can present the same address. Addresses are opaque strings to this module; your bridge defines their meaning. Include document/root context so similarly named values in different documents do not collide.

### 1. Create two presentations of one value

This is a separate example. Replace the board page's `<main>` with the following and replace `main.js` with the code in the next two steps. Keep the module script and import map.

```html
<main id="inspector">
  <label>Gain
    <input type="range" min="0" max="1" step="0.01"
           data-address="program:scene/gain">
  </label>
  <label>Numeric gain
    <input type="number" min="0" max="1" step="0.01"
           data-address="program:scene/gain">
  </label>
  <button type="button" id="undo">Undo</button>
  <p id="notice" role="status"></p>
</main>
```

### 2. Provide a small document bridge

This demo store is application code, not a domocracy API. It deliberately handles one number, one revision counter, and undo:

```js
import { on } from 'domocracy';
import { scope, intent, effect } from 'domocracy/intent';
import { apply as applySurface } from 'domocracy/surface';

const address = 'program:scene/gain';
const inspector = document.querySelector('#inspector');
const notice = document.querySelector('#notice');

let value = 0.5;
let revision = 0;
const history = [];
const subscribers = new Set();

const snapshot = () => ({
  revision,
  changes: [{ kind: 'value', address, value }],
});
const announce = () => {
  for (const subscriber of subscribers) subscriber(snapshot());
};

const documentBridge = {
  snapshot,
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
  commit(request) {
    if (request.address !== address) throw new Error('Unknown address');
    if (request.revision !== revision) throw new Error('The document changed; try again');
    if (!Number.isFinite(request.value) || request.value < 0 || request.value > 1) {
      throw new Error('Gain must be between 0 and 1');
    }
    history.push(value);
    value = request.value;
    revision++;
    announce();
  },
  undo() {
    if (history.length === 0) return;
    value = history.pop();
    revision++;
    announce();
  },
};
```

A real bridge supplies its own edit vocabulary, diagnostics, subscriptions, and history. The important boundary is that document changes go through it. domocracy has no dependency on this demo store or on SJON.

### 3. Connect intentions to commits and commits to controls

Append:

```js
const fields = {
  update(node, data) {
    node.value = String(data.value);
    node.toggleAttribute('data-preview', data.preview === true);
  },
};

let shownRevision = 0;
function render(notification) {
  applySurface(inspector, notification.changes, fields);
  shownRevision = notification.revision;
}

const offDocument = documentBridge.subscribe(render);
render(documentBridge.snapshot());

const editing = scope(inspector);
editing.handle('gain:edit', raised => ({
  disposition: 'consume',
  effects: [{ type: 'demo.commitGain', ...raised.args }],
}));
editing.handle('history:undo', () => ({
  disposition: 'consume',
  effects: [{ type: 'demo.undoGain' }],
}));

const offCommit = effect('demo.commitGain', request => documentBridge.commit(request));
const offUndoEffect = effect('demo.undoGain', () => documentBridge.undo());

function requestFrom(control, type, args) {
  const result = intent(control, type, args);
  const failed = result.effects.find(outcome => outcome.status === 'failed');
  notice.textContent = failed ? String(failed.error.message ?? failed.error) : '';
  if (failed) render(documentBridge.snapshot());
}

const offChange = on(inspector, 'change', '[data-address]', (event, control) => {
  requestFrom(control, 'gain:edit', {
    address: control.dataset.address,
    value: control.valueAsNumber,
    revision: shownRevision,
  });
});
const offUndo = on(inspector, 'click', '#undo', (event, button) => {
  requestFrom(button, 'history:undo');
});
```

Change either input: both show the committed value. Click Undo: the bridge emits another notification and the same rendering path updates both inputs. Enter an out-of-range number: the document refuses, the message explains why, and the inputs return to the committed value.

Native inputs naturally display text or a thumb position while the person edits them. That transient input is not yet document authority. This example commits on `change`; continuous preview would be a separate path.

The controls here are not direct children of a region, so `applySurface` uses the supplied `fields` adapter. For controls inside a region, it uses that region's adapter. A surface does not itself require a region.

### Preview does not commit

These optional helpers extend the inspector example:

```js
function previewGain(candidate) {
  applySurface(inspector, [
    { kind: 'value', address, value: candidate, preview: true },
  ], fields);
}

function discardPreview() {
  render(documentBridge.snapshot());
}
```

`previewGain(0.8)` changes the presentations, not the document revision or undo history. `discardPreview()` renders the current committed value again. The adapter decides how to style or label `data-preview`. Restoring external execution, such as a simulation affected by a preview, remains the application's responsibility.

### Structural changes use the same channel

| Change record | Presentation change |
|---|---|
| `{ kind: 'value', address, value }` | Update every matching control. |
| `{ kind: 'insert', address, parent, position, value }` | Insert into each managed region presenting `parent`. |
| `{ kind: 'move', address, position }` | Reorder each matching region child within its current parent. |
| `{ kind: 'remove', address }` | Remove every matching control. |

The entire change record is the spec passed to `create` or the data passed to `update`. A structural adapter must put `spec.address` on the element it creates. A parent container carries its own address; other presentations of that parent, such as a label, do not receive inserted children unless they also have a region.

The current surface `move` is a reorder within the existing parent. Its optional `parent` field does not implement cross-parent transfer. Cross-region movement exists in the core, but mapping a document transfer into presentations needs bridge-specific work.

`applySurface` resolves records in order. An insert can create a control that the next record updates; two moves use positions after earlier moves. A missing control contributes no operation, because the page may show only part of the document.

`controlsFor(surface, address)` queries descendant controls. `addressOf(element)` finds the closest address-bearing host. `operationsFor(surface, changes)` inspects operations against the tree **as it is now**; it does not simulate newly created controls across a whole notification. Its output is not generally an executable substitute for `applySurface` on dependent records.

`surface.js` is provisional. Its tests use a fake document bridge; a real editor may require changes to its address or notification contract. Test that boundary with the actual document before treating it as a stable integration protocol.

## Execution and failure contracts

### Validation is not rollback

The dry run checks structural preconditions it can model. It cannot prove that your adapter will succeed, that returned elements are suitable, or that callbacks will leave the DOM untouched.

For an insert, all `create` calls finish before insertion begins. If a well-behaved creator throws, that operation has not inserted any nodes. Side effects inside `create` are still yours, and a failure during actual insertion is not rolled back. Keep creators focused on building detached elements and updates focused on rendering their target.

| Sequence | Before execution | During execution |
|---|---|---|
| `region.execute(group)` | Validate the whole group. | Apply in order using the region's adapter; moves account for their current regions. |
| `intent(...)` | Interpret, validate the whole plan, and check modeled ownership. | Resolve current ownership and execute each operation individually; then run effects. |
| `applySurface(...)` | Resolve and validate the next change record. | Execute its operations, then resolve the next record against the updated tree. |

A structural error detected in a direct group's initial validation leaves that group unapplied. A plan rejected in preflight leaves its operations unapplied. A surface notification can fail on a later record after earlier records have changed the page.

Execution errors propagate. For `Error` instances caught during execution, `error.committed` reports the completed prefix: operations in the region group, plan positions for an intent, or executed operations in the surface notification. A surface removal may split into several operations, so this is not a count of document records. Preflight failures can have no `committed` field because execution never began.

```js
try {
  drafts.execute([op.update(drafts.nodes[0], { name: 'Changed' })]);
} catch (error) {
  console.error('Completed prefix:', error.committed ?? 0, error);
  // A document-backed application restores presentation from its document here.
}
```

An observer failure after all mutations reports the whole group as committed. A failing adapter may already have changed part of its target before throwing, so the prefix count does not promise that the failing operation left no trace. There is no automatic retry or rollback. After a presentation failure, restore from the authoritative document rather than blindly replaying edits or external effects.

### Callbacks may change the world

Writes from interpreters are prohibited through the guarded APIs. Writes from adapters and observers during execution are allowed, but they can change the assumptions of the remaining sequence.

A direct core group validates only once. An adapter's nested write is outside that model; later operations run as written. Intentions and surface notifications resolve owners between operations. An intent refuses a multi-node removal whose nodes no longer share a parent. The surface splits such a removal across current parents so each managed region receives its bookkeeping and notification.

Avoid casually mutating managed structure from adapter callbacks. For ordinary applications, describe related changes as operations and let observers report the result. Reentrant application flows need explicit tests for ordering, failure, and mirror consistency.

### The guard is a development contract

While scope interpreters run, `guard.reason` blocks `region.execute`, nested `intent` and `interpret`, and `applySurface`. It does not intercept native DOM methods or the exported low-level `apply`. It is not a sandbox or a proof that an interpreter is pure. Interpreters are responsible for reading and returning plans without side effects.

## API reference

### Core: `domocracy`

| Export | Purpose |
|---|---|
| `region(container, adapter, options?)` | Create one region for a container. A second registration throws. |
| `on(root, type, selector, handler)` | Delegate an event; returns unsubscribe. |
| `dispatch(node, type, detail?)` | Send a bubbling, cancelable custom event. |
| `op` | Constructors for `insert`, `move`, `update`, `remove`, `clear`. |
| `validate(operationOrArray)` | Validate without executing; return a frozen group. |
| `regionOf(container)` | Registered region, or `null`. |
| `ownerOf(operation)` | Current region that would execute an operation, or `null`. |
| `divide(operation)` | Split a multi-parent removal by current parent; otherwise return the operation in an array. |
| `apply(operation, adapter)` | Low-level DOM handler for an already validated operation. |
| `guard` | Shared interpretation guard; normally managed by the intent module. |

Low-level `apply` bypasses region mirrors, observers, and the interpretation guard. Prefer region methods or the higher-level modules. `ownerOf` returning `null` may mean an unmanaged target, no target owner, or a removal spread across parents. Custom executors must distinguish those cases; `divide` addresses the multi-parent removal case. It does not validate or execute its output.

### Region methods and properties

| Member | Meaning |
|---|---|
| `insert(specs, before = null)` | Insert children created by the adapter. |
| `move(node, before = null, to = this)` | Move a node within this region or to another region. |
| `update(node, data?)` | Call the adapter's update function. |
| `remove(nodeOrArray)` | Remove named children. |
| `clear()` | Empty the container. |
| `swap(a, b)` | Swap two children addressed by node or index. |
| `execute(operationOrArray)` | Validate and execute a group; return the frozen group. |
| `insertAt(index, specs)` | Insert before that index, including the end index. |
| `removeAt(index, count = 1)` | Remove a contiguous range. |
| `updateAt(index, data?)` | Update the child at the index. |
| `moveAt(index, at?, to = this)` | Move to destination position `at`, defaulting to its end. |
| `at(element)` | Locate the direct child containing a target. |
| `observe(fn)` | Observe committed groups; return unsubscribe. |
| `container` | The managed element. |
| `nodes` | Live child-element collection. |
| `length` | Current number of child elements. |
| `items` | Optional frozen item mirror, or `null`. |

Positions are zero-based integers. For `moveAt`, the destination position is counted after excluding the moved node from that destination. Region mutation methods return their operation group; they do not return newly created nodes. Read `nodes` after insertion to get those nodes.

Existing children are adopted without being recreated. Without an item mirror, there is no initial data array to provide; your adapter must know how to update existing elements. `update` is optional on an adapter only if you never execute updates through it.

### Intentions: `domocracy/intent`

| Export or method | Purpose |
|---|---|
| `scope(element)` | Register a scope on one element. |
| `scope.handle(type, interpreter)` | Register one interpreter for that type; returns unsubscribe. |
| `scope.dispose()` | Remove this scope and its interpreters. |
| `interpret(source, type, args?)` | Interpret and check without executing; return the route, trace, operations and effect requests. |
| `intent(source, type, args?)` | Interpret and execute; return trace and outcomes. |
| `effect(type, adapter)` | Register an effect adapter; returns unsubscribe. |

### Surface: `domocracy/surface`

| Export | Purpose |
|---|---|
| `addressOf(element)` | Closest control's address, or `null`. |
| `controlsFor(surface, address)` | Matching descendant controls in document order. |
| `operationsFor(surface, changes)` | Inspect operations against the current tree. |
| `apply(surface, changes, adapter?)` | Render an ordered notification; return the frozen sequence that ran. |

Alias the surface `apply` as `applySurface` when also using the core. They have different responsibilities and signatures.

## Integration, cleanup, and tradeoffs

Keep one owner for each managed DOM subtree. If a text editor or another UI library manages a component's internal DOM, let domocracy manage its outer host and use the component's public API for internal updates. Native DOM changes to region children bypass mirror and observer bookkeeping; the library does not monitor and reconstruct those writes.

Use unsubscribe functions when a feature is removed. For the inspector tutorial, teardown is:

```js
offChange();
offUndo();
offDocument();
offCommit();
offUndoEffect();
editing.dispose();
```

The card tutorial likewise retains its event, observer, interpreter, and effect subscriptions so they can be removed. `on` removes rules; its shared native listener can remain on the root. Regions have no `dispose()` method: reuse the existing region while its container remains in use. Removed components may need their own cleanup for timers, media, or subscriptions; removing a node does not perform that application cleanup.

domocracy supplies neither templates nor reactive state, scheduling, virtualization, durable undo, or a document format. You write adapters and choose your data owner. This is useful when direct operations and context-sensitive controls match the application; it is extra work if you primarily want automatic state-to-view rendering.

The initial renderer grew out of experiments with the vanilla implementation of [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark). That history explains its attention to native operations and allocation. Benchmark results from earlier boreDOM versions are not measurements of every current domocracy integration; measure your actual adapters, data, and optional mirrors.

## Development and further reading

The package includes [core declarations](domocracy.d.ts), [intent declarations](intent.d.ts), and [surface declarations](surface.d.ts). Generic adapter types describe creation specs and update payloads; they do not enforce runtime membership or payload immutability.

From a repository checkout:

```sh
npm test                 # Pure tests, then browser tests
npm run test:pure        # Fake-tree operations, intentions, and fake-document tests
npm run test:browser     # Headless Chrome
node tests/run.mjs --headed
```

Browser tests require an installed Chrome. Set the `CHROME` environment variable to its executable if it is not at the platform's default path. No build step is required for the library or these tests.

The focused guides provide additional detail: [operations](docs/operations.md), [intentions](docs/intents.md), [surfaces](docs/surface.md), and [sequence contracts](docs/sequences.md). Read the implementation alongside them when building a custom executor.

Three runnable [examples](examples/README.md) ship with the repository. [Navigation](examples/navigation/) builds two independent bars from recursive component factories, with nested submenus, optional icons, and delegated handlers registered once per bar. [Canvas history](examples/canvas-history/) drags three circles on a single canvas child and adds undo, redo and replay, which are the example's own code and not the library's. [Toolbar](examples/toolbar/) is one toolbar whose buttons mean whatever the room around them says, with a panel built on `interpret` that shows what a button would do before it is pressed. Serve the repository over HTTP and open any directory; no build step is involved. The [plan they were built from](docs/plans/01-examples.md) records what each page promises and what it does not.

Licensed under [CC0](LICENSE).
