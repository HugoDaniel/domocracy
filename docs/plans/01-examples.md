# Two small domocracy examples

Status: built. The two examples live in [`examples/navigation/`](../../examples/navigation/) and [`examples/canvas-history/`](../../examples/canvas-history/), with an index in [`examples/README.md`](../../examples/README.md). Their model tests are in `tests/pure/examples.test.mjs` and their browser tests in `tests/examples.test.js`, both inside the existing `npm test`. The rest of this page is the plan they were built from, kept as written.

The first shows a reusable component creating other components. The second shows an interactive canvas whose editing history belongs to the application. Neither requires new domocracy primitives, a component framework, or the parked recording runtime.

## Delivery and boundaries

Serve the repository over HTTP. Each example has its own `index.html`, `main.js`, and small stylesheet, with an import map pointing the package entry points at the repository modules. No bundler or external icon dependency is needed. Each page includes a short explanation of ownership and a visible interaction checklist.

| Planned path | Delivers |
|---|---|
| `examples/navigation/` | Two independent navigation bars built from recursive component factories. |
| `examples/canvas-history/` | Three draggable colored circles, a selection inspector, Undo, Redo, Replay, Stop, and a history list. |
| `examples/README.md` | Run instructions, the concepts each page demonstrates, and the limits of their promises. |

Use the core in both examples and `domocracy/intent` in the canvas example. The canvas scene is a tiny JS document; it does not need SJON or the address-based surface module. Keep the examples separate enough to copy independently. Share no new application framework between them.

Read the [operations](../operations.md), [intentions](../intents.md), and [sequence contracts](../sequences.md) before implementation. In particular:

- Region adapters own creation and updates of their direct children. Private element internals belong to the component.
- An intent starts above its source. Raise it from a connected control or canvas below the relevant scope.
- Interpreters read and return plans. Application mutation occurs in effect adapters, after interpretation.
- Effects have one global adapter per type. Register them once per demo page, route to the intended instance explicitly, and retain their unsubscribe functions.
- Effects run after a plan's DOM operations. A document-backed edit therefore proposes a commit effect alone; the committed document notification produces the UI updates.
- Sequences have no automatic rollback. Undo and replay below are application features, not inverses inferred from domocracy operations.

## Example 1: a navigation component that makes components

### What the person does

Open Products, open a nested Tools group, and activate an entry. Some entries have icons and some do not. Add an entry to an already-open submenu, rename it, toggle its icon, reorder it, and remove it using a small demonstration control strip. A second navigation bar remains unchanged throughout.

Use a navigation landmark with nested lists, real links for destinations, and buttons for disclosure or demo commands. This is a disclosure navigation example; do not assign application-menu roles or implement a desktop menu keyboard system. Enter/Space activates disclosure buttons, Tab follows native controls, and Escape closes the nearest open submenu and returns focus to its disclosure button. A link remains a link.

### Component shape

Use plain factories, with names chosen for readability:

```js
createNavigation(spec)   // { element, add, update, move, remove, dispose }
createEntry(spec)        // link, command, or submenu entry
createIcon(name)         // an optional, locally defined SVG
```

`createEntry` recursively creates entries when the spec has children. A representative input is:

```js
[
  { id: 'home', label: 'Home', href: '#home', icon: 'home' },
  { id: 'products', label: 'Products', children: [
    { id: 'overview', label: 'Overview', href: '#overview' },
    { id: 'tools', label: 'Tools', children: [
      { id: 'export', label: 'Export', command: 'export', icon: 'download' }
    ] }
  ] }
]
```

The spec is creation input. The live components own this example's local disclosure state; do not keep a second ordered item mirror. Stable entry IDs are unique within a navigation instance. Give DOM IDs used by `aria-controls` an instance prefix so two copies do not collide.

### Ownership and execution

Each list is a region whose direct children are entry hosts. The entry adapter calls `createEntry`, which may create another list and region. An entry owns its link/button, label, icon slot, and optional nested list. Icon SVG is private presentation, marked decorative because the visible label carries the meaning. Use text nodes for labels and a fixed local icon vocabulary.

Component initialization may construct private detached DOM. Once a list is managed, insert/reorder/remove its entries through its region. Public methods resolve an entry within this navigation and call the owning region. Updates change existing labels, icon contents and disclosure state narrowly; they do not replace the entry host or its focused button. Changing an entry's kind is outside this example.

Register delegated click and keydown rules once on each navigation root. The factories do not install a new listener for every entry or nested list. The nearest matching button determines the action, so an icon click behaves like a label click and a nested action runs once. No document-global selectors or listeners are needed for local interaction.

Disclosure clicks call a region update directly. Command entries dispatch `nav:select` from the public navigation host with `{ id, command }`. The page handles that event and updates its own status; the component knows nothing about the page's commands. Ordinary destination links keep their native behavior. This example deliberately teaches `on/dispatch` without requiring scopes.

Keep child component handles inside their owning component for cleanup. `dispose()` is idempotent, removes subscriptions, and recursively disposes children. Dispose an entry before removing it through its owning region. A factory that fails while preparing a nested subtree cleans up what it created before rethrowing. Regions have no `dispose()` API; do not invent one or register a second region on a reused container.

### Acceptance

- Two navigation instances render the same spec without shared disclosure state or duplicate DOM IDs.
- A newly inserted nested entry works with the existing delegated rules; one activation produces one command event.
- Entries with and without icons, and clicking directly on an SVG descendant, work identically.
- Rename and icon updates preserve the host, focused control and open submenu. Same-list reorder retains identity; focus behavior is checked on the active movement path.
- Disclosure buttons expose `aria-expanded` and `aria-controls`; hidden submenus cannot receive Tab focus. Escape closes the nearest group. Collapsing or removing a subtree that contains focus moves focus to its surviving trigger or the nearest surviving entry, without stealing focus otherwise.
- Keyboard-only use reaches every action, destination links remain usable, and unrelated page scrolling does not jump after label/icon updates.
- Dispose/remove one instance, then mount another: no duplicate handlers, command events or retained application subscriptions.

Do not add remote menu loading, routing, arbitrary HTML icons, portals, drag-and-drop, or a custom-element base class to prove recursive composition.

## Example 2: canvas editing, undo and replay

### What the person does

Drag one of three circles, change its color through the inspector, then move another. Undo and redo those edits. Replay the current history from the initial scene, stop midway, and confirm that the editable scene is still the committed one.

The inspector includes native selection buttons, a color control, and directional nudge buttons. Every edit has a keyboard path. The canvas has an accessible label and instructions, and a status element announces selection and completed actions without announcing every preview frame.

### Ownership

| Owner | Responsibility |
|---|---|
| `scene.js` | Immutable scene values, stable circle IDs, validation, history entries, cursor, commit, undo and redo. Pure functions where possible. |
| `canvas.js` | Canvas instance, drawing, hit testing, coordinate conversion, resize handling, and pointer gesture lifetime. |
| `replay.js` | A transient playback scene, playback position and one animation-frame loop. Never edits document history. |
| `main.js` | DOM regions, scope handlers, effect registration, subscriptions, accessible controls and teardown. |

Keep one live canvas node as the child of a stage region. The region adapter's `update` draws the supplied presentation scene; canvas drawing is the adapter's responsibility, not a new operation kind. Other regions manage the history rows and inspector controls. Changing pixels does not imply removing/recreating the canvas or making each circle a DOM node.

Use a fixed logical scene coordinate system scaled to the canvas. Convert pointer positions from its CSS rectangle and account separately for device-pixel ratio in the backing buffer. Keep stroke/text scaling predictable. Resizing redraws the current presentation and makes no history entry.

### The action boundary

```text
pointer or inspector interaction
  → intent from a control/canvas below the demo scope
  → plan with an application effect request
  → scene commit / history command / replay controller
  → notification
  → region.update(canvas, presentation) and targeted control updates
```

Use intent types such as `scene:move`, `scene:color`, `history:undo`, `history:redo`, `replay:start`, and `replay:stop`. Effect names are demo-specific, for example `canvas-demo.commit`. Resolve targets by stable circle ID, never by list index or pointer coordinate alone. Register effects once at the page composition boundary and pass the intended instance explicitly if a second demo is mounted.

The scope interpreters return effect-only plans for these commands. The scene/controller boundary validates again before mutation. Failed effects appear as a visible status and leave the scene unchanged; a successful invocation that starts replay is not a claim that playback has finished. domocracy does not await the animation loop or returned promises.

### Gesture and history rules

On pointerdown, select the hit circle and capture its ID, original position, pointer ID and scene revision. Use pointer capture for the drag. Pointer moves update only a preview scene. On pointerup, commit one `move` action with the final logical coordinates. Escape, pointer cancellation, unexpected loss of capture, window blur, or teardown discards the preview without adding history. Normal capture release after a completed gesture does not cancel the commit a second time.

Clamp centers so a circle remains inside the logical scene. A zero-distance move and a color set to the current color are no-ops. Color changes and each nudge commit one action. Disable other editing/history/replay controls during a drag; any unexpected document revision change cancels the preview and invalidates its release. Prevent browser panning only on the drag surface, leaving the surrounding page scrollable.

The scene starts from a fixed, reproducible three-circle fixture. An entry stores `{ action, before, after }`, where the action is a serializable move or color change and the snapshots are immutable scene values. This deliberately uses cheap full snapshots for a tiny document; it does not introduce a generic inverse-operation engine.

Maintain `entries` and a cursor in `0..entries.length`. Undo restores the preceding entry's `before`; redo restores the next entry's `after`. A new commit after undo truncates the redo tail. Each accepted edit, undo or redo advances a separate document revision; undo never rewinds revision numbers. Preview, selection, focus, playback frames and window resizing are absent from authored history.

### Replay rules

Replay is **presentation of committed edits at a fixed teaching pace**, not a recording of raw pointer input or original wall-clock timing. Replay the initial scene plus the entries before the history cursor. Exclude the redo tail. Use a fixed documented duration per entry; interpolate each move between its endpoints and apply a color change at its entry boundary. Do not claim to reproduce the original drag trajectory.

Snapshot this prefix at Start. Replay from the initial scene into a separate playback scene and mark the active history row without replacing the list. While replay runs, disable commits, undo, redo and a second Start; keep Stop available. Frames draw the playback scene without dispatching the original edit intents, executing commit effects or appending history.

Stop, Escape or completion cancels playback and renders the current committed scene again. Selection remains the user's selection. Disable Replay when the applied prefix is empty. Use elapsed time from one animation-frame loop, including when frames are skipped; do not chain timers or use an asynchronous effect result as the playback state. Teardown cancels the frame and releases all subscriptions.

### Browser continuity and evidence

Keep the canvas and focused controls mounted during edits, undo and replay. An inspector edit does not focus the canvas. Preserve the history list's visible anchor when rows are appended; highlight the replay row without automatically scrolling to it. Resizing the backing buffer resets drawing state, so the renderer reestablishes its transform and redraws without resetting the scene/history. The example promises no recovery of arbitrary browser state after teardown.

Pure tests cover commit validation, immutable snapshots, no-ops, undo/redo boundaries, branching after undo, and replay evaluation at entry boundaries and skipped-frame times. Compare scene values rather than relying on cross-browser pixel equality.

Browser checks cover:

- Drag preview changes pixels but not committed scene/history; release adds exactly one entry; Escape and pointer cancellation add none.
- Move, color, move, undo all, redo all reproduces the exact initial/final scene values and inspector values.
- Undo then edit drops the redo tail; replay uses only the applied prefix.
- Replay reaches the same logical final scene; Stop halfway restores the committed scene; neither path changes history or its cursor.
- Pointer capture, scrolling around the canvas, high-DPI coordinates, resizing, keyboard nudges, focus, and history-list anchoring work together.
- Repeated Start/Stop and dispose/remount leave no running frames or duplicate handlers. Failed validation creates neither a history entry nor a partial scene edit.

Record browser/OS versions and limitations. Test Chromium and WebKit, keeping scene correctness separate from rendering tolerances and native browser-state behavior. The page and notes explicitly attribute history, replay and frame scheduling to example code, not domocracy.

## Build order and completion

1. Build the recursive navigation factories and two-instance fixture. Verify nested creation, event delegation, updates and cleanup.
2. Add the navigation interaction/accessibility checks and a short annotated walkthrough.
3. Build and test the pure scene/history model, then the persistent canvas adapter and inspector. Connect commits through scope/effect plans.
4. Add gesture preview/cancellation, then replay as a separate presentation controller. Verify the full move/color/undo/redo/replay ritual and browser continuity.
5. Link both runnable pages from the examples index and package README. Document ownership, run instructions and observed limits beside each example; run the existing package checks plus the new relevant checks.

Add pure example tests under the existing Node test discovery and browser cases to the existing browser harness where practical. Use actual browser pages for pointer/focus/layout checks; a fake DOM cannot establish those results. Keep WebKit checks explicitly recorded if the repository runner remains Chrome-only.

Completion means both pages run from a checkout without a build, the named rituals pass, and a reader can distinguish domocracy's operations/routing from the components, scene store and replay machinery they supplied. Any need for a new core primitive is a finding to discuss, not a silent expansion of this plan.
