# domocracy

A container's children change only through five named operations, handlers are delegated from an ancestor, and what a click means is decided by the ancestors it happens inside.

Three ES modules, no dependencies, no build step. Open a file with `<script type="module">` and use it.

```sh
npm install domocracy
```

## The API

`domocracy.js` is the core.

| | |
| --- | --- |
| `region(container, adapter, options?)` | Takes over a container's direct children. Returns the region. |
| `on(root, type, selector, handler)` | One native listener on the root, matched with `Element.closest`. Returns the function that removes it. |
| `dispatch(node, type, detail?)` | A bubbling, cancelable `CustomEvent`. False when a handler called `preventDefault()`. |
| `op.insert / move / update / remove / clear` | The five operations, as frozen values. Nothing runs. |
| `validate(ops)` | Dry runs a sequence over any containers and returns it frozen. Changes nothing. |
| `apply(operation, adapter)` | The DOM handler: one validated operation. The only function that writes. |
| `regionOf(container)` | The region of a container, or null. |
| `ownerOf(operation)` | The region that would execute an operation, read from the tree as it is. |
| `divide(operation)` | That operation as the operations its current owners would each execute. |
| `guard` | `{ reason }`, set while an interpreter runs. Every region refuses to write until it is null. |

A region:

| | |
| --- | --- |
| `.insert(specs, before?)` | Builds children from specs, before a node or at the end. |
| `.move(node, before?, to?)` | Moves a node here or into another region. It stays alive. |
| `.update(node, data?)` | Hands the node and the payload to the adapter. |
| `.remove(nodes)` | One node or an array of them. |
| `.clear()` | Empties the container. |
| `.swap(a, b)` | Exchanges two children, by node or by position. One group of two moves. |
| `.execute(ops)` | One operation or a sequence, validated as a whole and run in order. |
| `.insertAt / removeAt / updateAt / moveAt` | The same operations said by position, range checked. |
| `.at(element)` | The child of this region that contains an element, with its index, or null. |
| `.observe(fn)` | Every committed group, in order. Returns the function that removes it. |
| `.nodes` `.length` `.container` `.items` | The live children, how many, the element, and the mirror or null. |

`intent.js` is contextual meaning, on top of the core.

| | |
| --- | --- |
| `scope(element)` | An element that answers for the intents raised below it. |
| `scope.handle(type, interpreter)` | One interpreter per type. It reads the tree and returns a plan. |
| `scope.dispose()` | Gives the element up again. |
| `intent(source, type, args?)` | Raises a request. Returns what happened: trace, operations, effects. |
| `effect(type, adapter)` | What runs one kind of effect, after the operations. |

`surface.js` is for a document that lives elsewhere. It is provisional.

| | |
| --- | --- |
| `addressOf(element)` | The address of the control an element is in, or null. |
| `controlsFor(surface, address)` | Every presentation of one address, in document order. |
| `operationsFor(surface, changes)` | Change records as operations. Pure. |
| `apply(surface, changes, adapter?)` | Runs a notification, record by record. |

## Examples

A list whose children only change through operations:

```js
import { region } from 'domocracy';

const layers = region(document.getElementById('layers'), {
  create(spec) { const li = document.createElement('li'); li.textContent = spec.name; return li; },
  update(node, data) { node.textContent = data.name; },
});

layers.insert([{ name: 'sky' }, { name: 'trees' }, { name: 'dust' }]);
layers.updateAt(0, { name: 'sky, at night' });
layers.swap(0, 2);
layers.removeAt(1);
```

The code above changes the document four times, and each call returns with the change already made. No diffing, no scheduler, no template.

Two changes as one group:

```js
import { op } from 'domocracy';

layers.execute([
  op.move(layers.nodes[2], layers.container, layers.nodes[0]),
  op.remove([layers.nodes[1]]),
]);
```

A group is checked as a whole before the first operation runs, against a model of the tree rather than the tree itself. Remove a node and then insert before it, and the group is refused instead of half applied.

One listener for every row, including the rows that don't exist yet:

```js
import { on, dispatch } from 'domocracy';

on(document, 'click', 'li', (event, layer) => dispatch(layer, 'layer:pick'));
on(document, 'layer:pick', 'li', (event, layer) => layers.update(layer, { name: 'picked' }));
```

Nothing is attached to a row, so a row created later or moved in from somewhere else is covered. The row says what happened to it and an ancestor decides what to do about it.

The same list, meaning two different things in two places:

```js
import { op, on } from 'domocracy';
import { scope, intent } from 'domocracy/intent';

scope(document.getElementById('editor')).handle('layer:pick', (raised) => ({
  disposition: 'consume',
  operations: [op.update(raised.source, { name: 'selected' })],
}));

scope(document.getElementById('preview')).handle('layer:pick', () => ({ disposition: 'pass' }));

on(document, 'click', 'li', (event, layer) => intent(layer, 'layer:pick'));
```

The scopes above the clicked row are asked in order, nearest first. An interpreter reads the tree and returns a plan, and the operations in that plan are values that have not run. Writing to a region from inside an interpreter throws. Move the list from the editor into the preview and the same click means nothing, with nothing changed in the list.

## Benefits

* **Nothing per node.** No wrappers, no expandos, no key maps, no per-node listeners. Your state is your data and the DOM.
* **A change has a name.** Five operations, as values you can build, hold, log and check before anything runs.
* **A group doesn't half apply for a reason you could have seen.** The dry run catches a dependency between two operations before the first one runs.
* **Nodes stay alive.** A move is `moveBefore` where the browser has it, so focus, selection, animations and an iframe's document survive it.
* **Contextual meaning.** With `intent.js` the same control does different things in different places, and the control holds no opinion about which.
* **Small and readable.** The core is one file you can read in a sitting.

## Drawbacks

* **Size is a loss.** 3.5 KB compressed against 2.5 KB for the same app written by hand, measured in the js-framework-benchmark. CPU is a tie there, 0.986x on the geometric mean of the nine benchmarks, and run memory is 0.95x. Size is what you pay.
* **No rollback.** An adapter that throws halfway leaves the operations before it applied. You get `committed`, the number that ran, and you ask the document what the truth is.
* **You write the rendering.** `create` and `update` are yours. There is no template syntax and there is not going to be one.
* **No virtualization, no batching, no scheduling.** A thousand rows is a thousand rows.
* **The items mirror costs a copy per operation.** It is optional, it is off by default, and I would leave it off.
* **`surface.js` has never met a real editing bridge.** It is tested against a fake one I wrote. Expect the address format and the change records to move.

## More

[Operations](docs/operations.md), [intents](docs/intents.md), [surface](docs/surface.md), and [what a sequence promises](docs/sequences.md), which is the one with the contracts in it.

```sh
npm test    # 57 tests over a fake tree, then 53 in headless Chrome
```

CC0. Take it.
