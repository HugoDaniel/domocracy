# Sequences

A group, a plan and a notification are all ordered sequences of operations. This page is what all three promise, because that is where the bugs were.

## Every operation is read against what the ones before it left

Checking each operation of a group against the tree as it is now cannot see a dependency between two of them. Remove an anchor, then insert before it: both checks pass, and the second `insertBefore` throws with the group half applied.

So a group of more than one operation is checked against a model instead. Its whole state is a map of placement overrides on top of the live tree. Each operation is checked as the earlier ones would have left things, then records what it would change. A cycle that only exists after an earlier move of the same group is caught the same way.

The nodes an insert would create do not exist yet, so nothing later in a group can name them.

A plan gets that check and a second one: a pass that asks which region owns each operation as the plan stands, including what a clear does to its container's children. A plan that was wrong when it was written changes nothing.

A notification is resolved one record at a time, against the tree the records before it left. A record can name the control an earlier record created, because by then it exists.

## Nothing is rolled back, and you are told how far it got

An adapter that throws halfway leaves the operations before it applied. There is no transaction. The error carries `committed`, and it counts the sequence you handed over:

```js
try {
  layers.execute(group);
} catch (error) {
  console.log(error.committed, 'of', group.length, 'operations ran');
}
```

A region counts its own group. `intent` counts the plan, so a plan whose fourth operation fails reports 3. `surface.apply` counts the notification. An observer that throws after its group applied reports the whole group as committed, because it did apply and it was the notification that failed. A layer that runs each operation as its own group does the arithmetic with `committed(error, ran)`, which adds what it had run to what the group of one reported and returns the error to throw.

The reason there is no rollback: undoing a DOM change is a DOM change, and the library has no idea whether your adapter's `create` also started a video, opened a socket or focused something. Saying how far it got and letting you ask the document what the truth is beats pretending.

## A write from inside a sequence is allowed

An observer or an adapter may write to a region while a sequence is running. Nothing forbids it, because two presentations of one document are made of exactly that.

What it costs depends on which sequence:

* A group handed to `region.execute` is validated once, as a whole, before the first operation. That is its contract, and it is what lets a group of a hundred operations pay for one dry run. A write from inside that group is outside what the dry run saw: the operations after it are applied as they stand, and one of them may quietly do nothing, the way removing a node an adapter already detached does nothing.
* A plan and a notification run each operation as its own group. Each one is checked when its turn comes, and each one is executed by the region that owns the node at that moment. A write that removes a node the rest of the sequence needs fails it there, with `committed` saying where. A write that moves a node to another region hands the next operation to that region, with the right adapter and the right mirror.

Both layers ask the core for that, so there is one rule for who executes an operation and not one rule per layer:

```js
import { apply, ownerOf, divide } from 'domocracy';

for (const part of divide(operation)) {
  const owner = ownerOf(part);
  if (owner === null) apply(part, myAdapter);
  else owner.execute(part);
}
```

The code above is what both `intent.js` and `surface.js` do. `ownerOf` reads the tree as it is, or a model of it when handed a `parentOf`, which is how `intent` asks the same question of a plan as written before any of it runs. `divide` comes first because only a remove names more than one node, and something may have moved one of them since the operation was built: a scattered remove becomes one remove per container, each with an owner again, so no region loses its notification or keeps a mirror naming a child it no longer has.

Without `divide`, `null` from `ownerOf` means two things that must not share a fallback: an operation on a container with no region, which you may well handle yourself, and one whose nodes no longer share a container, which you must not.

The two layers then differ on purpose. A notification divides, because a remove record says the document no longer holds this form and each presentation should leave through the region it is in. A plan refuses, because a plan names the nodes of an operation together and that is a promise the layer keeps.

## What the guard covers

`guard.reason` is set while `interpret` runs the interpreters, which is how every `intent` starts. It is read by `region.execute`, by `interpret` and `intent`, and by `surface.apply`. That is the whole list.

It does not cover the exported `apply`, which is the DOM handler and takes one already validated operation, and it cannot cover `node.remove()` or `container.append()`, which are the platform's and answer to nobody. An interpreter that writes through either of those writes, and the plan it returns is then describing a tree that has already moved.

Interpreters read. The rule is the contract, and the guard is what catches the ordinary way of breaking it.
