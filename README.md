# domocracy

What if the DOM could have a similar logic to drag and drop, where each drop site gets to say what it accepts?

I like how much of drag and drop can be understood just by moving something around. Take a file over a folder and the folder can tell you whether it will accept it. Move that same file over an email and it might become an attachment. Each destination has its own use for the thing you are carrying, and ideally lets you know about it before you drop it there.

I want to play with that idea for regular UI controls. The DOM already gives us a hierarchy to work with, and events already travel through it. With domocracy I want to make more use of that surrounding structure when deciding what a control does.

There is no dragging required here (sorry, you will have to bring your own drag and drop, like we do in the [clear example](examples/clear/) for example purposes). The thing I am borrowing is how a destination gets to interpret what arrives. A keyboard shortcut can make the same request from whatever control has focus, and the surrounding element answers in the same way.

Domocracy is a small JS library for experimenting with this. It works with regular DOM elements and has no runtime dependencies. HTML can stay in your .html files, with CSS alongside it and JavaScript imported as ES modules. There are TypeScript declarations too.

## One button, two places

Imagine a button that says Clear, sitting beside a search field. Pressing it empties the field, which is about what you would expect.

Now move that same button into a todo list. Here, Clear removes the completed items. The button still has the same click handler. It asks to clear something, and the place where you put it decides what that involves.

This is the idea I wanted to play with in domocracy. An element can answer requests from the controls inside it. I call that element a scope, although it is still ordinary HTML that you can find in the browser’s inspector.

The search form knows about its field. The todo list knows which items are done. The button can carry on knowing very little, which seems healthy for a button.

What I particularly like is being able to ask what would happen before doing it. The scope returns a plan, so I can use its answer to put a caption under Clear:

> Remove the 4 completed tasks.

Untick one of those tasks and ask again:

> Remove the 3 completed tasks.

The caption comes from the same function that decides what pressing Clear will do. If there are no completed tasks, that function can explain why there is nothing to clear. I do not need to maintain another little set of rules just to explain the first one.

Moving the button back beside the search field makes it ask the form again. There is no search setting to restore on the button, because it never knew it was a search button.

I find that a fun amount of behaviour to get out of where something lives in an HTML page.

The [clear example](examples/clear/) is this page. Its todo list is a section with a scope on it, and the scope's answer for Clear is a function like this:

```js
import { op } from "domocracy";
import { scope } from "domocracy/intent";

const listing = scope(todoSection);

listing.handle("ui:clear", () => {
  const completed = Array.from(list.children).filter(task => task.querySelector("input").checked);
  if (completed.length === 0) {
    return { disposition: "consume", refused: "No task is completed, so there is nothing to clear." };
  }
  return {
    disposition: "consume",
    meaning: `Remove the ${completed.length} completed tasks.`,
    operations: [op.remove(completed)],
  };
});
```

The function above reads the list and returns a plan. `consume` says this scope has answered and nothing above it needs asking, and `operations` is what pressing Clear runs. `meaning` and `refused` are words I chose for the example; domocracy keeps them on the plan without reading them.

The button's click handler raises the request with `intent(button, "ui:clear")`. The caption asks the same function with `interpret`, which walks up from the button, collects the plan, checks it, and returns it without running anything:

```js
import { interpret } from "domocracy/intent";

const plan = interpret(button, "ui:clear").trace[0]?.plan;
caption.textContent = plan?.refused ?? plan?.meaning ?? "Nothing here answers Clear.";
```

Beside the search field, the same two lines get the form's plan instead, because the walk from the button reaches the form's scope and not the list's. The example moves the button with the browser's own drag and drop, and a slot the button is dragged over asks the same question from itself, so it can say what the drop would mean before it happens. The [getting started guide](docs/getting-started.md) builds a page like this from scratch.

## More than one parent can have an opinion

In the [toolbar example](examples/toolbar/), a toolbar with an Apply button can be inside a card, which is itself inside a board. Both of those elements may have something to say about Apply, so the card can answer with `continue` to let the request travel further up.

In the example, the card proposes toggling its completion state. The board then adds an effect to count the completed cards and returns `consume`. When the collected work runs, the card changes first and the tally runs afterward, so it sees the new state.

The possible answers are:

| Disposition | What happens |
|---|---|
| `pass` | This scope contributes nothing and the walk continues. Returning nothing also passes. |
| `continue` | Keep this scope's operations and effects, then ask the next scope. |
| `consume` | Keep this scope's operations and effects, then stop asking. |

This gets a little more fun with Remove. If the card holds a toolbar, removing the card would also take the toolbar out of the page. To keep it around, the card's scope proposes moving its contents back to the dock before letting the request reach the board, where the card removal is added.

The example has two toolbars, A and B, and both can live in the same card. Removing that card produces this explanation:

> Hand toolbar A and toolbar B back to the dock, then remove “Write the docs”.

There are two moves and a removal in the plan. The card takes care of what it holds, and the board removes its child once those moves have happened. A and B have no references to each other and do not need to arrange any of this between themselves.

Try putting both toolbars in one card and pressing Apply on A. The card changes, and B's caption changes when it next asks what Apply would do. I find this a nice way to see where the behavior lives: both controls are asking the same card, and the card's answer depends on its current state.

There is a detail here that is easy to get wrong. `consume` stops the walk, and whatever was already contributed stays in the plan. An outer scope cannot take back an operation proposed by an inner one. If we want to stop the request before the card answers, we need a scope closer to the button. The example has a lock on the card's toolbar slot for this purpose, and its preview shows that the card and board are never asked while the lock consumes the request.

## Moving things around

So far we have been talking about moving controls and updating cards. The core of domocracy handles these changes through **regions**. A region manages a container's direct child elements, using functions you provide to create and update them.

Let's give the cards their own little list. This snippet stands on its own, and starts with this HTML:

```html
<ul id="cards"></ul>
```

Each card will have a checkbox beside its title. I want to be able to change the title later without rebuilding the checkbox:

```js
import { region } from "domocracy";

const list = document.querySelector("#cards");
const cardAdapter = {
  create(title) {
    const card = document.createElement("li");
    card.innerHTML = '<label><input type="checkbox"> <span></span></label>';
    cardAdapter.update(card, title);
    return card;
  },
  update(card, title) {
    card.querySelector("span").textContent = title;
  },
};

const cards = region(list, cardAdapter);
cards.insert(["Write the docs", "Actually ship it"]);

const [docs, shipping] = cards.nodes;
const checkbox = docs.querySelector("input");
checkbox.checked = true;

cards.update(docs, "The docs are done");
cards.move(docs, null); // Move the docs to the end. Shipping goes first now.

console.log(docs.querySelector("input") === checkbox); // true
console.log(checkbox.checked); // still checked
```

The HTML string is fixed markup, and the title goes into `textContent` when the adapter updates the card. The `docs` reference keeps pointing to the same element after the move, even though it is now last in the list. Its checkbox comes along, with the value we gave it. This is useful when the control that caused a move is itself somewhere inside the thing being moved.

Focus is a slightly more awkward part of this. Domocracy uses the browser's `moveBefore` where it is supported and the move meets its conditions, which can preserve focus through the move. The fallback keeps the same node, but focus may be lost. The toolbar example lets you try this by pressing its Next room button repeatedly and watching the focused button travel with the toolbar.

The region methods above run their changes immediately. We can also describe a change as an object, which is what the interpreters use when they return operations in a plan. Continuing the list above, let's admit that the docs might need another pass:

```js
import { op } from "domocracy";

const oneMorePass = [
  op.update(docs, "One last typo, I promise"),
  op.move(docs, list, shipping),
];

// The docs are still last until we run this.
cards.execute(oneMorePass);
// Now they are before shipping again. Such is life.
```

The `op` calls construct the operations, and `cards.execute` runs them in order. Before it starts, it checks the sequence against the tree, accounting for changes that earlier operations would leave behind. For instance, it can catch an insertion that tries to use an anchor removed earlier in the same group. The checkbox stays checked because our adapter only updates the title.

This is the code underneath the card-removal example too. Each scope contributes ordinary operation values, and the intent runs them through the regions that own their targets. The moves back to the dock happen before the card is removed because that is the order in which they were proposed.

Regions are also usable on their own, with ordinary event handlers. If you are just adding a row to a list, you can call `insert` and carry on. The [operations guide](docs/operations.md) goes into the other methods, including moving between regions and observing their changes.

## And where does the state go?

For the small toolbar example, much of the state is already in the DOM. A list option carries `aria-selected`, and a form input has its current value and its last committed `defaultValue`. Those are convenient things for a scope to read when deciding what a request would do.

An editor with its own document can keep that document in charge. A scope can turn a request into an effect that asks the document to commit an edit, then the document sends a notification with what changed. The page renders that notification, including any other controls showing the same value.

There is an optional `domocracy/surface` module for this last part. A control marks the value it presents with `data-address`, and more than one control can have the same address. A slider and the number input beside it can then receive the same value-change record. The surface finds both and updates them through their adapters.

Undo follows the same path. The document undoes its edit and sends another notification, which the page displays. Domocracy has no history of its own to rewind, so the document gets to decide what an undo means and how much history to keep.

The surface module is still provisional, and its current contract is described in the [surface guide](docs/surface.md). The [canvas history example](examples/canvas-history/) uses regions and effects directly to show a document with its own undo and replay. Those features are code in the example, if you want to see how they are put together.

## Give it a go

From a checkout of this repository, start a local server:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/examples/clear/`. Drag Clear between the search field and the todo list, read what the slot says before you drop, and read the caption before pressing anything.

The [toolbar example](examples/toolbar/) at `http://localhost:8000/examples/toolbar/` has more of this: two toolbars, four rooms, and a panel that shows each scope's answer. I would start by moving toolbar A between the form and a card. Once that makes sense, put B in the same card and remove the card, and follow the order of the moves back to the dock in the panel.

The [examples guide](examples/README.md) explains the files if you want to dig into the code. There is also a [navigation example](examples/navigation/) with recursive components, alongside the [canvas history example](examples/canvas-history/). They all run directly from the checkout, with no build step.

For your own project:

```sh
npm install domocracy
```

You can import whichever part you need:

| Import | What's there |
|---|---|
| `domocracy` | Regions and DOM operations, with delegated handlers and custom-event dispatch. |
| `domocracy/intent` | Scopes and the functions that interpret requests and run their plans. |
| `domocracy/surface` | Document change records rendered into addressed controls. |

The [getting started guide](docs/getting-started.md) builds a complete page with an import map, so a bundler is optional. There are more detailed guides for [operations](docs/operations.md) and [intents](docs/intents.md), as well as the [surface](docs/surface.md) and [sequence](docs/sequences.md) contracts. Types are in [domocracy.d.ts](domocracy.d.ts), [intent.d.ts](intent.d.ts), and [surface.d.ts](surface.d.ts).

## A few things to keep in mind

The parent walk is quite literal: it starts above a connected source element, follows light-DOM parents, and stops at a shadow root. A Web Component can raise from its host when it wants the surrounding scopes to answer. A menu placed elsewhere in the DOM can use its connected anchor as the source. If an action moves its own source, the new parents will be used on the next request; the current route has already been captured.

The library catches writes made through regions while interpreters are running, along with nested interpretation and surface application. It cannot stop an interpreter from using native DOM methods or the low-level core `apply`, so the read-only part is still a rule for your code to follow. The returned arrays and trace entries are frozen, while their payloads and the original plans remain references. Keep those stable while using an interpretation.

Sequence validation also has its limits. It can check whether the proposed structure makes sense, but an adapter or observer may still throw during execution. Earlier changes will stay applied, and `error.committed` may tell you how far the sequence got. There is no rollback, and even the operation that threw might have partially changed its target. The [sequence guide](docs/sequences.md) covers this in more detail.

Effects run after the operations, with an outcome for each request. Their adapters are registered globally, one per type, so use names specific to your application and include an instance reference when an adapter serves several instances. If an adapter returns a promise, domocracy does not await it: a synchronous `done` result says the function returned, and your application still needs to handle the eventual completion or rejection.

Keep the returned unsubscribe functions for when a feature is removed, and dispose its scopes too. Regions have no disposal method; a region can be reused while its container remains in use. If something else writes directly to its children, its observers and optional item mirror will miss that change. I would keep one owner for each managed subtree, especially when placing a widget from another library inside it.

## Development

The library runs as written, so the repository has no build step. The tests can be run with:

```sh
npm test                 # Pure tests, followed by browser tests
npm run test:pure        # Node tests with fake trees and documents
npm run test:browser     # Headless Chrome
node tests/run.mjs --headed
```

The browser runner needs an installed Chrome. If it cannot find yours, set `CHROME` to the executable's path. Firefox and WebKit are not run by this runner.

Licensed under [CC0](LICENSE).
