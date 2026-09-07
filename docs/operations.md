# Operations

A region is a container whose direct children change only through operations. There are five of them and nothing else in the library writes to a managed container.

```js
import { region, op } from 'domocracy';

const layers = region(document.getElementById('layers'), {
  create(spec) { const li = document.createElement('li'); li.textContent = spec.name; return li; },
  update(node, data) { node.textContent = data.name; },
});
```

The code above hands one container to the library. `create` returns the element for a new child and `update` refreshes one. Rendering is entirely yours: the library decides what runs and in which order, and never what a child looks like.

## The five

| Operation | What it does |
| --- | --- |
| `insert` | Builds children from specs and puts them before a node, or at the end |
| `move` | Moves one node inside this region or into another one, keeping it alive |
| `update` | Hands one node and one payload to the adapter's `update` |
| `remove` | Takes nodes out of the document |
| `clear` | Empties the container |

Each has a method on the region and a constructor on `op`. These two lines do the same thing:

```js
layers.insert([{ name: 'dust' }], layers.nodes[1]);
layers.execute(op.insert(layers.container, layers.nodes[1], [{ name: 'dust' }]));
```

The code above inserts one child before the second one. The method is what you call day to day. The constructor is for when you want the change as a value: to hand it to somebody else, to look at it, or to put it in a group.

`insert` prepares every node before it touches the tree, so a `create` that throws halfway leaves the operation without a trace. `move` uses `moveBefore` where the browser has it, which keeps focus, selection, animations and an iframe's document alive across the move, and falls back to `insertBefore` otherwise. `clear` is `textContent = ''`, which is the fastest thing the platform has, and it is an operation of its own for that reason.

## Groups

An array of operations is a group. It is validated as a whole before the first one runs:

```js
layers.execute([
  op.move(layers.nodes[2], layers.container, layers.nodes[0]),
  op.remove([layers.nodes[1]]),
]);
```

The code above runs two changes as one. Checking a group is a dry run over a model of the tree, not over the tree itself, so it catches a dependency between two operations that checking each one against the live tree cannot see. Remove a node and then insert before it, and the group is refused before anything happens.

`region.swap(a, b)` is one group of two moves, so it is validated and observed as the single change it is. It takes nodes or positions.

## Positions

Identity is the node. A position is an address inside a region and it changes when the region changes.

`insert` and `move` name the node they go before, and `null` means the end. The index sugar says the same operations by where they land and range checks before it builds anything:

```js
layers.insertAt(0, [{ name: 'sky' }]);
layers.moveAt(2, 0);
layers.removeAt(1, 2);
layers.updateAt(0, { name: 'sky, at night' });
```

The code above works in positions instead of nodes. `moveAt(index, at)` counts `at` in the destination without the node that is leaving, which is the region's own rule for a position.

`region.at(element)` goes the other way. It takes any element and returns the direct child of the region that contains it, with its index, or null when the element is not in this region. That is how a delegated handler turns an event target into the row it belongs to:

```js
import { on } from 'domocracy';

on(document, 'click', 'li', (event, target) => {
  const found = layers.at(target);
  if (found) layers.removeAt(found.index);
});
```

## Reading a region

`region.nodes` is the live `HTMLCollection` of children, so reading it is reading the DOM. `region.length` is how many there are. `region.container` is the element itself.

`regionOf(container)` gives the region of a container, or null. There is one region per container, and a second one over the same children throws.

## The items mirror

A region keeps nothing besides the children unless you ask. If you want your items in JavaScript, ask at construction:

```js
const layers = region(container, adapter, { items: [{ name: 'sky' }] });
```

The code above adopts a frozen array with one item per child, in order. The counts must match. Every operation replaces the array rather than mutating it, so `region.items` is a value you can hold on to and compare. In the mirror a spec is the item an insert puts there and an update's data replaces one.

The mirror costs an array copy per operation and it is the part of this library I am least convinced by. A page that keeps its state in the DOM does not need it. Leave the option out and nothing is allocated for it.

## Observers

`region.observe(fn)` registers a function that receives every committed group, in order, with the region it happened to. It returns the function that removes it.

```js
const off = layers.observe((group, of) => console.log(group.length, 'operations,', of.length, 'children'));
```

An observer may write to a region, including this one. What that costs is in [sequences](sequences.md).

## The pieces underneath

`validate(ops)` is the dry run on its own: it takes one operation or a sequence, over whatever containers, checks it and returns it frozen. It changes nothing.

`apply(operation, adapter)` is the DOM handler: one already validated operation, one adapter. It is the only function here that writes to the tree.

`ownerOf(operation)` answers which region would execute an operation, read from the tree as it is. `divide(operation)` answers with the operations the current owners would each execute, which matters for a remove whose nodes have been scattered since it was built. Both are there for code that runs sequences of its own, and both are described in [sequences](sequences.md).
