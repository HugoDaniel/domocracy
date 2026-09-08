# domocracy

What if the DOM could work a little more like drag and drop, where each drop site gets to say what it accepts?

Imagine dragging a file across a desktop. A folder offers to take it in, an application offers to open it, and the trash offers to remove it. The file is the same throughout, but each place has its own understanding of what receiving that file would mean. A good interface can show you that understanding while you are still hovering, so you can see what will happen before you let go.

Domocracy brings that way of thinking to the controls already on a page. An Apply button carries a request, and the part of the page around it decides how to answer. In a form, Apply might commit the fields; in a confirmation panel, it might accept the decision; inside a card, it might mark that card complete. You can move the same button between those places and keep its element and its event handler, while its next request acquires the meaning of its new surroundings.

The connection to drag and drop is the responsibility given to the destination. You do not need to drag anything to use domocracy: a click, a keyboard shortcut, or a menu item can all raise a request from an element, and the DOM ancestry determines which places get to answer it. Because those answers describe work before performing it, the interface can also ask what would happen and use the answer for a caption, a refusal message, or a preview of the affected elements.

That is the idea behind this library: let the structure of a page participate in its behavior, and make that behavior something you can inspect before you use it.

Domocracy is a small JavaScript library with three ES modules, no runtime dependencies, and TypeScript declarations. You write ordinary HTML, CSS, and rendering functions; the library supplies delegated events, explicit DOM operations, and the machinery for interpreting requests through their surroundings.

## A place can give a control its meaning

Consider a toolbar containing Apply, Cancel, Up, Down, and Remove. The toolbar has plenty of work of its own: it needs to arrange the buttons, manage keyboard navigation, and keep a sensible tab stop. What Apply means belongs to the content being worked on, so the toolbar can leave that decision to the place it is in.

In domocracy, the toolbar raises a named **intent** from the button that was pressed. Assuming an existing toolbar whose buttons carry `data-intent`, the connection looks like this:

```js
import { on } from 'domocracy';
import { intent } from 'domocracy/intent';

const toolbar = document.querySelector('[role="toolbar"]');

const offClick = on(toolbar, 'click', 'button[data-intent]', (event, button) => {
  intent(button, button.dataset.intent);
});
```

A button marked `data-intent="ui:apply"` therefore asks for `ui:apply`, regardless of where the toolbar has been placed. `data-intent` is a convention chosen by the application; the handler above is what reads it. Since the event handler is delegated from the toolbar, it also works for matching buttons added later.

A place answers by registering a **scope** on an ancestor element. When the button raises its intent, domocracy walks up from the button's parent and asks the scopes it encounters, nearest first. A scope's answering function is an **interpreter**, and its answer is a **plan** containing the work it proposes.

For example, an editor section could interpret Apply by reading its title field and proposing an announcement. This fragment assumes that the toolbar is inside `#editor`, which also contains a title input and a status element:

```js
import { scope, effect } from 'domocracy/intent';

const editor = document.querySelector('#editor');
const editing = scope(editor);

editing.handle('ui:apply', () => {
  const title = editor.querySelector('input[name="title"]').value.trim();

  if (title === '') {
    return {
      disposition: 'consume',
      refused: 'Give this draft a title first.',
      effects: [{ type: 'editor.announce', text: 'Give this draft a title first.' }],
    };
  }

  return {
    disposition: 'consume',
    meaning: `Confirm “${title}” as the title.`,
    effects: [{ type: 'editor.announce', text: `Title confirmed: “${title}”.` }],
  };
});

const offAnnounce = effect('editor.announce', request => {
  editor.querySelector('[role="status"]').textContent = request.text;
});
```

Here, `consume` tells domocracy to include this answer and stop asking outer scopes. The `effects` array contains requests for work, and `effect` registers the function that performs one kind of request. The interpreter reads the title and describes the response; the effect adapter writes the announcement after interpretation has finished. This small example only changes a status message, but the same boundary can connect an editor to an application-owned document or a persistence service.

Another section can register its own answer to `ui:apply`. Once the toolbar moves underneath that section, its buttons reach that answer instead. There is no need to rebuild the toolbar or give its Apply button a different click handler, because the next request starts from the button's current position in the tree.

For a complete page you can run and change, the [getting started guide](docs/getting-started.md) builds one control that travels between a Draft section and a Review section, with all the markup, imports, and cleanup included.

## You can ask a place what would happen

The useful part of returning a plan is that the answer exists before the work begins. Just as a drop target can show what it would do with the item over it, a scope can explain what it would do with a request without having to carry it out first.

`interpret` follows the same route and calls the same interpreters as `intent`, including the checks on their proposed DOM operations, but stops before execution. Its result includes the route through the scopes, a trace of their answers, and the collected operation and effect requests. That gives a caption or a preview panel access to the actual decision:

```js
import { interpret } from 'domocracy/intent';

const applyButton = toolbar.querySelector('[data-intent="ui:apply"]');
const preview = interpret(applyButton, 'ui:apply');

for (const answer of preview.trace) {
  const plan = answer.plan;
  console.log(plan?.refused ?? plan?.meaning ?? 'This scope has nothing to add.');
}
```

The fields `meaning` and `refused` belong to our example. Domocracy reads the disposition, operations, and effects, while preserving the original plan so the application can use whatever else the interpreter says. A description and an availability indicator can therefore come from the same branch that decided which work to propose. When the title is empty, that branch supplies both the refusal text and the announcement that will run if the person presses Apply.

In the [toolbar example](examples/toolbar/), these explanations appear under every button and are connected through `aria-describedby`. A refused action is dimmed and marked `aria-disabled`, while still allowing a press to run its explanatory response. The larger panel shows each scope's words alongside the operations it contributed, and highlights the parts of the page involved in the plan.

An explanation remains current only as long as the state it describes remains current. The example asks again after input, change, click, and intent activity; an application with another source of changes needs to refresh from that source too. Activation always calls `intent` afresh, so it reads the state at the time of the action rather than executing an old preview. Keeping interpreters free of mutations is what allows both uses to share the same decision safely.

## Places can cooperate because they are nested

A page usually has more structure than a collection of unrelated drop sites. A card belongs to a board, a field belongs to a form, and both may sit inside a workspace with responsibilities of its own. Following the ancestry lets an action involve those surrounding places without making the control coordinate them.

Suppose the toolbar is inside a card and someone presses Apply. The card can propose changing its completion state and return `continue`, allowing the request to reach the board. The board can then contribute an effect that counts completed cards and return `consume`, ending the walk. Domocracy collects the two answers before running either, applies the card's update, and runs the tally afterward, when the new completion state is visible.

Each interpreter chooses one of three dispositions:

| Answer | What it means |
|---|---|
| `pass` | Contribute nothing and let the next outer scope answer. Returning nothing also passes. |
| `continue` | Include this plan's operations and effects, then keep asking. |
| `consume` | Include this plan's operations and effects, then stop asking. |

This becomes especially useful when an action has to preserve something before removing its surroundings. In the toolbar example, a card can hold toolbars A and B at the same time. When Remove is pressed, the card's scope proposes moving both occupants back to the dock, and the board's scope proposes removing the card. The complete explanation reads:

> Hand toolbar A and toolbar B back to the dock, then remove “Write the docs”.

The resulting sequence contains two moves followed by one removal. The card knows what it holds, the board knows which child is leaving, and the two toolbars do not need references to each other. Put both toolbars in the same card and their captions describe the same context; press Apply on A and, when the captions refresh, B describes the changed card too.

Contributions accumulate as the request travels outward. A board that returns `consume` ends the conversation while retaining the card's earlier work; it cannot cancel operations the card already proposed. To intercept a request before it reaches the card, a scope must be nearer to the source. The example demonstrates this with a lock on the card's toolbar slot, and the preview makes it visible that the card and board were never asked.

## The elements can move without being recreated

For the surrounding structure to carry meaning, moving things through that structure needs to be an ordinary operation. Domocracy's core provides **regions**, which manage the direct children of a container through five explicit changes: insert, move, update, remove, and clear.

A region uses an adapter supplied by the application to create and update its children. For a list with an existing `<ul id="cards"></ul>`, that can be as simple as:

```js
import { region } from 'domocracy';

const list = document.querySelector('#cards');
const cards = region(list, {
  create(data) {
    const card = document.createElement('li');
    card.textContent = data.title;
    return card;
  },
  update(card, data) {
    card.textContent = data.title;
  },
});

cards.insert([{ title: 'Write the docs' }, { title: 'Ship it' }]);

const first = cards.nodes[0];
cards.update(first, { title: 'Finish the docs' });
cards.move(first, null); // Move this same element to the end of the list.
```

Moving an element changes its position while preserving its identity, which means references to that element still refer to the same object afterward. A move can also carry a whole subtree, such as a card containing its controls. Where the browser supports `moveBefore` and the move meets its conditions, browser-managed state such as focus can survive the move; the fallback retains the node but does not guarantee that state preservation.

The region methods execute changes immediately, while the `op` constructors express the same changes as values that can be inspected or returned in a plan. Continuing the list above, we can describe a move and an update before applying either:

```js
import { op } from 'domocracy';

const changes = [
  op.move(first, list, list.firstElementChild),
  op.update(first, { title: 'Docs are ready' }),
];

cards.execute(changes);
```

Before execution, the group is checked as an ordered sequence, including structural dependencies between earlier and later operations. Intentions use these same operation values when several scopes contribute to an action, and route execution through the regions that own the affected containers. This is how the toolbar removal can be both a readable proposal and the actual sequence that moves its occupants to safety.

You can use regions and delegated handlers on their own wherever the event handler already knows what should happen. The [operations guide](docs/operations.md) covers cross-region moves, observation, position-based methods, and the optional item mirror; adding contextual interpretation is a separate choice.

## The document can still own its data

Giving the DOM a role in behavior does not require putting all application state in it. An editor may have a document that owns its values, validates changes, and records history, while the DOM holds the controls through which someone works on that document. In that arrangement, a scope interprets a request into an effect, the effect asks the document to commit an edit, and the document's notification updates the presentations that show it.

The optional `domocracy/surface` module helps with that return path. Controls identify the values they present through `data-address`, so a slider and a numeric input can both display the same document address. When a value-change record arrives, the surface turns it into updates for both controls, using their region adapters or an adapter supplied by the application.

This keeps the two responsibilities distinct and connected: the place around a control determines how its request should be understood, while the document determines whether an edit is valid and what the committed state becomes. Undo belongs to that document, and undoing an edit produces another notification through the same presentation path.

The surface module is provisional, with its address and notification contracts described in the [surface guide](docs/surface.md). The [canvas history example](examples/canvas-history/) shows the broader document-owned approach using core regions and effects, including application code for undo, redo, and replay.

## Try it, then build with it

The quickest way to explore the idea is to serve this repository and open the toolbar example:

```sh
python3 -m http.server 8000
```

At `http://localhost:8000/examples/toolbar/`, move A between the form, listbox, confirmation panel, and cards, watching how the captions change. Put B in the same card as A, try the keyboard shortcuts from different controls, and inspect the removal that returns both toolbars to the dock. The same page shows successful plans, refusals, and nested contributions, so you can follow where each decision came from.

Two other examples explore different parts of the library. [Navigation](examples/navigation/) builds recursive components with delegated interactions, while [Canvas history](examples/canvas-history/) connects pointer gestures to a document with its own history. All three run directly from this checkout without a build step, and the [examples guide](examples/README.md) explains their files and limits.

To use domocracy in your own project:

```sh
npm install domocracy
```

The modules can be adopted separately, depending on how much of the approach your page needs:

| Import | What it provides |
|---|---|
| `domocracy` | Regions, operations, delegated handlers, and native custom-event dispatch. |
| `domocracy/intent` | Scopes, interpretation without execution, intent execution, and effects. |
| `domocracy/surface` | Document change records rendered into addressed controls. |

The [getting started guide](docs/getting-started.md) takes you through a complete page with an import map, so you can begin without a bundler. For individual APIs, use the guides to [operations](docs/operations.md), [intents](docs/intents.md), [surfaces](docs/surface.md), and [sequence behavior](docs/sequences.md), along with the declarations in [domocracy.d.ts](domocracy.d.ts), [intent.d.ts](intent.d.ts), and [surface.d.ts](surface.d.ts).

## Boundaries worth understanding

The ancestry used for interpretation is the actual light-DOM parent chain, beginning above a connected source element and stopping at a shadow root. A Web Component can raise a public request from its host, and a menu rendered elsewhere can deliberately raise from its connected anchor. Moving a source during an action changes the route of its next request, since the current route has already been captured.

Interpreters are responsible for reading without mutating. Domocracy guards region writes, nested interpretation, and surface application while they run, but native DOM methods and the low-level core `apply` remain outside that guard. The returned route, trace entries, and operation arrays are frozen, while nodes, payloads, effect requests, and the original plans remain references; an interpretation is a proposal against current state rather than a durable snapshot.

Checking the proposed sequence catches structural and ownership errors before execution, but cannot guarantee that an adapter or observer will succeed. If execution fails, earlier changes remain applied and an error may report the completed prefix through `error.committed`; there is no automatic rollback. Effects run after the operations, and their outcomes distinguish synchronous success from failure. A promise returned by an effect adapter is not awaited, so asynchronous completion and rejection need to be handled through the application's own notification path.

Each effect type has one globally registered adapter, and each scope has one interpreter per intent type. Retain the unsubscribe functions and dispose scopes when removing a feature, including any cleanup required by widgets your adapters create. A region has no disposal method, and direct DOM writes to its children bypass its observers and optional item mirror, so ownership of each managed subtree should remain explicit.

Domocracy supplies the mechanisms described here, while markup, styling, rendering, state ownership, and refresh scheduling remain application choices. It is most useful when working with existing elements, explicit changes, and controls whose behavior belongs to the places around them.

## Development

There is no library build step. From a repository checkout, run:

```sh
npm test                 # Pure tests, followed by browser tests
npm run test:pure        # Node tests with fake trees and documents
npm run test:browser     # Headless Chrome
node tests/run.mjs --headed
```

The browser runner requires an installed Chrome, whose executable can be supplied through `CHROME` if it is not at the default location. It runs Chrome only; Firefox and WebKit are not part of this runner.

Licensed under [CC0](LICENSE).
