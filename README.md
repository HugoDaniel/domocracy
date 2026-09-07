# domocracy

I keep writing the same 300 lines in every project. Make some elements, put them in a container, take them out again, and then a click handler somewhere that has to work out which row the click was on and what the click should mean in that part of the page.

So I wrote those 300 lines once, properly, and measured them against hand-written DOM code in the js-framework-benchmark to see what the abstraction costs.

It is three ES modules, no dependencies, no build step, and no attribute language. You can open a file with `<script type="module">` and use it.

```js
import { region, op, on, dispatch } from './domocracy.js';
```

## Regions

**A container whose children change only through five named operations**

`region(container, adapter)` takes over the direct children of an element. From then on they change through `insert`, `move`, `update`, `remove` and `clear`, and through nothing else. The adapter says how a child is rendered, and that is the only place in your app that builds DOM:

```js
const layers = region(document.getElementById('layers'), {
  create(spec) {
    const li = document.createElement('li');
    li.textContent = spec.name;
    return li;
  },
  update(node, data) {
    node.textContent = data.name;
  },
});

layers.insert([{ name: 'sky' }, { name: 'trees' }, { name: 'dust' }]);
```

The code above puts three list items in the container. There is no diffing, no scheduler and no template. `insert` returns with the document already changed.

Each of the five is also a value you can build without running it, with `op`:

```js
layers.execute([
  op.update(layers.nodes[0], { name: 'sky, at night' }),
  op.remove([layers.nodes[2]]),
]);
```

The code above is one group. A group is checked as a whole before the first operation runs, so a group that could not finish never starts. Checking it is a dry run over a model of the tree, which catches the case where one operation depends on another: remove a node and then insert before it, and the group is refused rather than half applied.

Identity is the node. Position is where a node sits in its region right now, and it changes when the region changes, which is why `insert` and `move` name the node they go before and not an index. There are no ids, no key maps and no expandos on your elements.

## The click is a proposal

**What an action means is decided by the ancestors it happens inside**

`on(root, type, selector, handler)` registers one native listener on the root and matches each event with `Element.closest`. Elements created later and elements moved in from somewhere else are covered, because nothing was ever attached to them:

```js
on(document, 'click', 'li', (event, layer) => dispatch(layer, 'layer:pick'));
on(document, 'layer:pick', 'li', (event, layer) => layers.update(layer, { name: layer.textContent + ' *' }));
```

`dispatch` sends a bubbling, cancelable `CustomEvent`. The layer says what happened to it, an ancestor listens for `layer:pick` and decides what to do, and the layer itself holds no opinion.

That is the whole core, and for most pages it is enough. The name comes from the second module, which takes the same idea further.

The same list of layers means different things in different places. In the layers panel a click selects, in the export dialog it toggles a checkbox, and in a read-only preview it does nothing at all. `intent.js` lets an ancestor answer for what happens below it:

```js
import { scope, intent } from './intent.js';

const panel = scope(document.getElementById('layers-panel'));

panel.handle('layer:pick', (raised) => ({
  disposition: 'consume',
  operations: [op.update(raised.source, { name: raised.source.textContent + ' *' })],
}));

on(document, 'click', 'li', (event, layer) => intent(layer, 'layer:pick'));
```

The code above registers an interpreter and then raises an intent from every clicked layer. The interpreter reads the tree and returns a plan, and nothing in that plan has run: the operations are values. The scopes above the element are asked in order, nearest first, and each one passes, adds to the plan, or consumes the intent. Then the whole plan is validated and executed, and you get back what happened: which scopes answered, which operations ran, what was asked of the outside world.

Put the same list inside a different scope and the same click means something else, with nothing changed in the list.

An interpreter that writes to a region throws. That is enforced, not just asked for, and it is what makes a plan worth having: you can look at what an action was going to do before any of it happened.

## Documents on screen

**A commit comes back as change records, and each record becomes operations**

`surface.js` is the third module and the provisional one. It is for an editor where a document lives somewhere else, with its own undo and its own idea of what an edit means, and the page is one presentation of it.

A control carries the address it presents in `data-address`. There is no registry from address to node, the query is the lookup, and one address can be on screen in several places at once. When the document commits, the records come back and the surface turns each one into the operations that catch the page up.

I built it against a fake document because the real bridge is SJON in another project of mine. It is the part most likely to change.

## What a sequence promises

**Nothing is rolled back, and you are told how far it got**

An adapter that throws halfway leaves the operations before it applied. There is no transaction to undo. The error carries `committed`, the number of operations of the sequence you handed over that ran, and a plan counts in the plan's terms and a notification in the notification's.

An observer or an adapter is allowed to write to a region while a sequence is running, because two presentations of one document are made of exactly that. What it costs depends on the sequence. A group pays one dry run for all its operations, so a write from inside it is outside what that dry run saw. A plan and a notification run each operation as its own group, so each one is checked when its turn comes, and each one is executed by the region that owns the node at that moment and not by the region that owned it when the plan was written.

That last part took four rounds of review to get right, and the four failures were all the same failure: execution trusting something decided before a callback was allowed to change it.

`docs/sequences.md` has the whole contract.

## The numbers

I ran the [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) on 7 September 2026, headless Chrome 152 on an M4 Pro, this library and `vanillajs` in the same session:

| | vanillajs | this |
| --- | ---: | ---: |
| CPU, geometric mean of the nine benchmarks | 1.00x | 0.986x |
| run memory | 1.9 MB | 1.8 MB (0.95x) |
| compressed size | 2.5 KB | 3.5 KB (1.40x) |

CPU is a tie. Painting a thousand table rows costs the same whoever asked for them, and the JavaScript on top of it is a few percent of the benchmark, so a tie is the honest result and not a win. Memory is a small win, because the page keeps no per-row state at all: the ids and the labels live in the cells that show them. Size is a loss and I am reporting it rather than claiming it.

The harness is not in this repository. It lives in the project this code came out of, and the numbers above predate the last 69 bytes of it.

## Running it

```sh
npm test                 # the pure tests, then the browser ones
node --test tests/pure   # 57 tests over a fake tree, milliseconds, no Chrome
node tests/run.mjs       # 53 tests in headless Chrome
```

The pure tests run the checking half of an execute, the mirror and the fake document against plain objects. The browser tests cover what only a browser can answer: `moveBefore`, shadow roots, custom element reactions and table sections. `tests/chrome.mjs` is a DevTools client with no dependencies, so there is nothing to install for either.

## Docs

* [Operations](docs/operations.md): regions, the five operations, adapters, positions, the optional items mirror.
* [Intents](docs/intents.md): scopes, plans, dispositions, effects.
* [Surface](docs/surface.md): addresses, change records, applying a notification.
* [Sequences](docs/sequences.md): what a group, a plan and a notification each promise, and what the guard covers.

## Conclusion

This is a library for pages where the structure of the document is the state, and where what a control means depends on where it sits. It doesn't virtualize long lists, it doesn't batch or schedule anything, and it has no story for animation beyond keeping your nodes alive across a move.

The surface module is the part I am least sure about. It has never been used against a real editing bridge, only against a fake one I wrote to test it, and the first real binding is likely to change how an address is spelled and what a change record carries.

The thing I still don't know is whether the intent layer earns its 228 lines. Every app I have written could have used a `switch` statement in one handler instead. The argument for it is the second and third presentation of the same document, which is exactly the case I have not built yet.
