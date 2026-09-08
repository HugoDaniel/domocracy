# Intents

An intent is a request raised from an element. What it means is decided by the scopes above it.

```js
import { scope, intent, effect } from 'domocracy/intent';
```

This module imports the core and the core knows nothing about it. A page that does not need scopes does not load them.

## Scopes

A scope is an element that answers for the intents raised below it:

```js
const panel = scope(document.getElementById('layers-panel'));

const off = panel.handle('layer:pick', (raised, element) => ({
  disposition: 'consume',
  operations: [op.update(raised.source, { name: 'picked' })],
}));
```

The code above registers one interpreter for one type of intent. `handle` returns the function that removes it, and `panel.dispose()` gives the element up so it can take a new scope. One scope per element, one interpreter per type in a scope. A scope that needs two answers for one type writes one interpreter that gives both.

## Raising one

```js
const result = intent(layer, 'layer:pick', { with: 'the pointer' });
```

The code above raises an intent from `layer`. The source must be an element in the document. The walk starts above it, so a scope's own host raises into the scopes around it and a panel's controls do not interpret themselves. The route is taken before any interpreter runs, so a plan that moves the source does not change which scopes finish this intent.

`parentElement` is the walk, which means it ignores slot assignment and stops at a shadow root. The light DOM ancestry is the whole rule.

## Plans

An interpreter returns a plan, and nothing in it has run:

```js
{
  disposition: 'consume',
  operations: [op.update(node, data), op.remove([other])],
  effects: [{ type: 'save', address: 'world:layers' }],
}
```

The operations are values built with `op`. The effects are requests to act outside the surface. Returning nothing at all is a pass.

There are three dispositions:

* `pass` proposes nothing and lets the next scope up answer. A passing plan that carries operations or effects is a mistake and throws.
* `continue` adds its operations and effects and lets the next scope up add more.
* `consume` adds its own and stops the walk. Nearest scope wins.

Once the walk is done, the whole sequence is validated as one, then each operation runs through the region that owns it, in plan order. The effects follow.

## Interpreters read, handlers write

An interpreter that writes to a region throws:

```js
panel.handle('layer:pick', () => {
  layers.remove(layers.nodes[0]);   // throws: no writes while interpreting
});
```

The core's `guard` is set for as long as the interpreters run, and every `region.execute` in the page refuses until it is clear again. So does a nested `intent` or `interpret`.

That is what makes a plan worth having. An interpreter is a pure function of the intent and the tree, so what an action was going to do can be asked without any of it happening. What the guard covers exactly, and what it cannot, is in [sequences](sequences.md).

## Asking without running

`interpret` is the half of `intent` that writes nothing:

```js
import { interpret } from 'domocracy/intent';

const seen = interpret(layer, 'layer:pick', { with: 'the pointer' });
```

The code above takes the route, asks the interpreters under the guard, dry runs their operations as one sequence and asks which region would run each of them. It returns all of that frozen and runs none of it. `intent` is this and then the running, so what `interpret` gives back is exactly what `intent` would do next:

```js
{
  id: 7,
  source: layer, type: 'layer:pick', args: { with: 'the pointer' },
  disposition: 'consumed',
  route: [panelElement, boardElement],
  trace: [{ scope: panelElement, disposition: 'consume', operations: [...], effects: [...] }],
  operations: [ ...the frozen sequence, checked and not applied... ],
  effects: [{ type: 'save', address: 'world:layers' }],
}
```

`route` is every scope above the source, nearest first, whether or not it had anything to say. `trace` is the ones that answered, each with what it contributed. A scope on the route and not in the trace either had no interpreter for the type or came after the one that consumed. The `effects` here are the requests; the `effects` of an intent's result are what became of them.

Each trace entry also keeps `plan`, the object the interpreter returned, or null when it returned nothing. The `operations` and `effects` on the entry are frozen copies and are what would run; the plan is the interpreter's own, neither copied nor frozen, and it is where anything else the interpreter said is read from. An interpreter that returns `{ disposition: 'consume', effects: [...], reason: 'Select an option first' }` has said why, and a panel showing what a control would do reads the reason from the trace.

The answer is good for the tree as it stands. A page that shows what a control would do asks again after anything changes, and when the control is used it raises `intent`, which interprets afresh, rather than running a result it kept. Every interpretation takes an id, raised or not.

## Effects

An effect is the part of an action that is not a change to this page: a network call, a commit to a document, a file written.

```js
const off = effect('save', (request, raised) => fetch('/layers', { method: 'POST', body: request.address }));
```

The code above registers what runs one kind of effect. One adapter per type, registered globally, and it runs after the operations of the intent that asked for it. A promise is a result like any other and is not awaited: when the work finishes it raises a new intent.

An effect with no adapter fails with a named error and the next effect still runs. So does one whose adapter throws. You get the outcome of each in the result.

## What you get back

```js
{
  id: 7,
  disposition: 'consumed',
  route: [panelElement, boardElement],
  trace: [{ scope: panelElement, disposition: 'consume', operations: [...], effects: [...] }],
  operations: [ ...the frozen sequence that ran... ],
  effects: [{ type: 'save', status: 'done', result: aPromise }],
}
```

The trace is every scope that answered, in the order they were asked, with what each proposed and the plan it returned. It is the thing to log when a control does something you did not expect: it says which ancestor decided, and what it decided. The route is every scope that was there to ask.

## When a plan fails

A plan that is wrong when it is written changes nothing. Two passes see to that: the core's dry run over the whole sequence, and a pass that asks which region owns each operation as the plan stands. A plan that names a container with no region, or that clears a region and then names one of its former children, is refused before the first operation. Both passes are `interpret`'s, so a rehearsal refuses the same plans.

A plan that fails once it is running leaves the operations before the failure applied. The error carries `committed`, and it counts the plan's operations, not the region's. There is no rollback. [Sequences](sequences.md) says why.
