# Examples

Three runnable pages, each using the library from this checkout through an
import map. No build step, no dependencies, no bundler.

## Run them

Serve the repository root over HTTP and open the page you want:

```sh
python3 -m http.server 8000
```

- `http://localhost:8000/examples/navigation/` for the navigation components
- `http://localhost:8000/examples/canvas-history/` for the canvas, undo and replay
- `http://localhost:8000/examples/toolbar/` for one toolbar whose buttons mean what the room around them says

Each page maps `domocracy` and `domocracy/intent` to the modules beside this
directory:

```html
<script type="importmap">
{ "imports": { "domocracy": "../../domocracy.js", "domocracy/intent": "../../intent.js" } }
</script>
```

Loading them through `file://` does not work: modules and import maps need HTTP.

## What each page shows

### `navigation/`: components that make components

Two navigation bars are built from one spec of nested entries. Every list is a
region, and the adapter of a list creates entries, which create the lists under
them. Recursion happens in your factories; the library sees one container at a
time.

- `navigation.js` is the reusable part: `createNavigation`, `createEntry` and
  `createIcon`. Nothing in it knows about the page around it.
- `main.js` is the page: it mounts two instances, drives them from a strip of
  buttons, and decides what the `nav:select` event means.

Read it for delegated handlers registered once per root, for an update that
changes a label without replacing the control that has focus, and for disposal
that walks down the components a factory built.

### `canvas-history/`: a document with undo, redo and replay

Three circles live in a document the page owns. A drag changes pixels, and only
the release asks the document to commit one move. Undo, redo and replay are
built on the entries the document keeps.

- `scene.js` is the document: frozen scene values, validation, history entries,
  the cursor and the revision counter. No DOM.
- `canvas.js` is the one canvas node: drawing, hit testing, the two coordinate
  systems, the resize, and the lifetime of a drag.
- `replay.js` plays the committed entries back at a fixed pace, into a scene of
  its own.
- `main.js` composes them: the regions, the scope that interprets what the
  controls ask for, the effect adapters, and the subscription that turns a
  committed change back into pixels.

Read it for the route an action takes. A control raises an intent, the scope
above it returns a plan carrying one effect and no operations, the effect asks
the document to change, the document notifies, and the notification updates the
canvas region and the controls. Nothing is drawn from inside an interpreter.

### `toolbar/`: one toolbar, four rooms

A toolbar with six buttons and no handler that knows what any of them does.
Each button raises the intent in its `data-intent`, and the scope of the room
the toolbar is in answers: Apply commits a form, confirms a dialog, or ticks a
card. Moving the toolbar to another room changes what the same buttons mean,
and the button that asked for the move keeps its focus through it.

- `toolbar.js` is the component: the buttons, one tab stop and the arrow keys.
- `rooms.js` is the four rooms, each a scope over a section with a slot for
  the toolbar. A board card is a scope inside the board's, so an intent from a
  card visits two rooms and the plan carries both contributions in order.
- `scopes.js` is `room`, which is `scope` with a name, and `rehearse`, which
  walks the route `intent` would take, asks the same interpreters under the
  same guard, and runs nothing.
- `main.js` is the page: the dock, the travel between rooms as intents the
  page's own scope answers, the status effect, and the two panels.

Read it for a control that has no meaning of its own, for a plan read before it
runs, and for a sequence whose order matters: a card that is removed hands the
toolbar back to the dock in the operation before the one that removes it.

## What these examples do not claim

**Undo is not a domocracy feature.** The library has five operations and no
inverses, no history and no receipts. Every undo, redo and replay here is code in
`scene.js` and `replay.js`, and deleting those files would take the feature with
them. A sequence that fails partway is not rolled back either; see
[sequence contracts](../docs/sequences.md).

**Replay is a presentation, not a recording.** It plays committed edits at 600ms
per entry, interpolating a move between its endpoints. It does not reproduce the
path a pointer took or the time it took.

**History entries hold whole scenes.** That is cheap for three circles and wrong
for a real document, where an inverse per action is the usual answer. The
example takes the cheap road so that no generic inverse-operation engine appears
where none exists.

**The navigation is a disclosure navigation.** Buttons open submenus, Tab follows
the native order and Escape closes the nearest open group. There is no arrow-key
menu system and no application menu role.

**A rehearsal is not a sandbox.** It sets the same guard `intent` sets, which
catches a write through a region and nothing else. An interpreter that writes
through the platform's own methods is a bug in both.

## Tests

The parts that are values run under Node, and the parts that need a browser run
in headless Chrome, both from the repository root:

```sh
npm run test:pure      # includes tests/pure/examples.test.mjs
npm run test:browser   # includes tests/examples.test.js and tests/toolbar.test.js
```

The pure suite covers commit validation, immutable snapshots, no-ops, the undo
and redo boundaries, branching after an undo, and replay evaluation at entry
boundaries and at skipped frame times. The browser suite covers what a fake DOM
cannot answer: focus, hidden subtrees, pointer gestures, canvas pixels, resizing
and disposal.

The browser suite runs in Chrome only. WebKit and Firefox are not run by the
repository's test runner, and the browser suite prints that alongside its
results.
