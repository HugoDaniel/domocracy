# Surface

This is the provisional module. It is for an editor where the document lives somewhere else, with its own undo and its own idea of what an edit means, and the page is one presentation of it. How an address is spelled and what a change record carries are the editing bridge's to settle, and the first real binding is likely to change both. The core and `intent.js` do not depend on any of it.

```js
import { addressOf, controlsFor, operationsFor, apply } from 'domocracy/surface';
```

## Two conventions

A control carries the address it presents in `data-address`:

```html
<li data-address="world:layers/dust"><input value="3"></li>
```

An address names its root as well as its path, because the same path exists in more than one root: a knob in `world` and a source scrub in `program` for the same parameter are two addresses and a control has to say which it shows.

There is no registry from address to node. The query is the lookup:

```js
const controls = controlsFor(document, 'world:layers/dust');
const address = addressOf(event.target);
```

`controlsFor` gives every presentation of one address, in document order: a knob, the number beside it and the container whose children are the forms under it are all controls for their address, and one commit reaches all of them. `addressOf` gives the address of the control an element is in, or null, which is what a pointer landing anywhere inside a knob asks.

The second convention is that a container presenting an address has the region, and its children carry their own addresses. Addresses under a parent are names and not indices, so a form keeps its address when its neighbours move.

## The loop

Values flow one way. A control renders what the document committed and never writes back except by raising an intent:

1. A gesture on a control raises an intent.
1. A scope interprets it and asks for an effect: commit these actions to the document.
1. The bridge commits, or refuses with diagnostics.
1. The commit comes back as change records.
1. `apply` turns the records into operations and runs them.

Nothing in step 1 or 2 writes a value anywhere. If the bridge refuses, the page has not moved, and showing the refusal is one more thing to render.

## Change records

Four kinds, and the record itself is the payload:

```js
{ kind: 'value',  address, value }
{ kind: 'insert', address, parent, position, value }
{ kind: 'move',   address, parent, position }
{ kind: 'remove', address }
```

A record goes to `create` as the spec of a new control and to `update` as the data of an existing one, so an adapter reads `data.value` and writes `spec.address` into what it creates. Nothing between the bridge and the adapter reshapes anything.

A preview is the same record with `preview: true`, which an adapter renders as an override. Discarding it is one more update with the committed record.

There is no `clear`. A document that emptied a form removed its children one at a time.

## Applying a notification

```js
document_.subscribe(({ changes }) => apply(surface, changes, adapter));
```

The code above wires a bridge to a page. `apply` takes the records in the order the bridge listed them and, for each one in turn, builds its operations, checks them and runs them through the region that owns each container. A control that is no child of a region, a lone field in an inspector, is rendered through the `adapter` argument instead.

A notification is a sequence and not a set. A record may name a form an earlier record created, take a position an earlier record vacated, or change a value an earlier record inserted. So each record is resolved when its turn comes, against the tree the records before it left.

The price is that a notification is not rejected as a whole. A record that cannot run fails after the records before it have been applied, and the error's `committed` says how many operations ran. That is the right trade here: the document has already committed, and a surface that refuses to show a change is not more correct than one that shows what it could and says where it stopped.

An address with no control changes nothing. A change this page does not present is not an error, because a surface shows part of a document and having no control there is how it says so.

## Inspecting without applying

```js
const operations = operationsFor(surface, changes);
```

`operationsFor` is pure: it reads the tree and writes nothing. Handed several records it answers for the tree as it is now, which is what looking at a notification wants and not what applying one means. That is why `apply` calls it one record at a time.

## The fake document

`tests/fake-document.mjs` is a stand-in bridge, so the surface can be tested without the real one. It has named roots of nested plain objects, addresses like `root:a/b/c`, five of SJON's operations, change records with a new revision, a refusal for a stale revision, and an undo that comes back as a commit like any other. Eighteen of the pure tests are about the fake itself, so the surface tests can trust it.

It is a fake. It does not prove that a real bridge behaves this way, only that the surface behaves this way against something that says it does.
