// domocracy surface. What the document changed, on the controls that show it.
//
//   addressOf(element)                 the address of the control an element is in
//   controlsFor(surface, address)      every presentation of one address
//   operationsFor(surface, changes)    change records to operations, against the tree as it is
//   apply(surface, changes, adapter)   run a notification, record by record
//
// A control presents one address of the document and raises intents about it.
// The address is in the DOM, in `data-address`, and it names its root as well
// as its path, because the same path exists in more than one root: a knob and a
// source scrub on the same parameter are two addresses, one in WORLD and one in
// PROGRAM. There is no registry from address to node. The query is the lookup.
//
// Values flow one way. A control renders what the document committed and never
// writes back except by raising an intent, so nothing here proposes an edit and
// nothing here decides what an edit means. A gesture is an intent, the bridge
// commits it, and the commit comes back as change records this module turns
// into the operations that bring the surface up to date.
//
// This is the provisional half of domocracy. How the address is spelled, and what
// a change record carries, are the editing bridge's to settle; the first real
// binding corrects them here and leaves `domocracy.js` and `intent.js` alone.

import { op, apply as handle, divide, validate, ownerOf, regionOf, guard } from './domocracy.js';

const indexOf = Array.prototype.indexOf;

// An attribute selector takes a quoted string, so a quote or a backslash in an
// author's name has to survive the quoting. Nothing else needs escaping.
const QUOTED = /["\\]/g;

// Every presentation of one address, in document order: a knob, the number
// beside it, and the container whose children are the forms under it are all
// controls for their address, and one commit reaches all of them. A prefix
// query (`[data-address^="world:dust/"]`) finds a subtree the same way.
export function controlsFor(surface, address) {
  return surface.querySelectorAll(`[data-address="${String(address).replace(QUOTED, '\\$&')}"]`);
}

// The address of the control an element is in, or null when it is in none: a
// pointer landing anywhere inside a knob asks this. The control's own host is
// `element.closest('[data-address]')`, which is what a delegated handler on
// `[data-address]` already hands over.
export function addressOf(element) {
  const host = element.closest('[data-address]');
  return host === null ? null : host.dataset.address;
}

// A change record is what the bridge says happened to one address:
//
//   { kind: 'value',  address, value }
//   { kind: 'insert', address, parent, position, value }
//   { kind: 'move',   address, parent, position }
//   { kind: 'remove', address }
//
// The record itself is the payload: it goes to `create` as the spec of a new
// child and to `update` as the data of an existing one, so an adapter reads
// `data.value` and writes `data.address` into the node it creates. A preview is
// the same record with `preview: true`, which the adapter renders as an
// override; discarding it is one more `update` with the committed record.
//
// Every address and every position here is resolved against the tree as this
// call finds it. That is why `apply` calls it one record at a time: a record
// names what the document holds after the records before it, so the control an
// insert creates has to exist before the next record can name it, and a
// position is counted in a region the earlier records have already changed.
// Handed several records at once it answers for the tree as it is now, which is
// what a caller inspecting a notification wants, and not what applying one
// means.
export function operationsFor(surface, changes) {
  const operations = [];
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    switch (change.kind) {
      case 'value':
        for (const control of controlsFor(surface, change.address)) operations.push(op.update(control, change));
        break;
      case 'insert':
        // A form is inserted into the regions presenting its parent. Another
        // presentation of that parent, a label saying its name, is not a
        // container and takes nothing.
        for (const container of controlsFor(surface, change.parent)) {
          if (regionOf(container) !== null) operations.push(op.insert(container, container.children[change.position] ?? null, [change]));
        }
        break;
      case 'move':
        for (const control of controlsFor(surface, change.address)) {
          const container = control.parentElement;
          if (container !== null && regionOf(container) !== null) operations.push(op.move(control, container, anchor(container, control, change.position)));
        }
        break;
      case 'remove': {
        // One remove names the children of one container, so the controls that
        // go are grouped by the container they leave.
        const leaving = new Map();
        for (const control of controlsFor(surface, change.address)) {
          const container = control.parentElement;
          if (container === null) continue;
          const found = leaving.get(container);
          if (found === undefined) leaving.set(container, [control]); else found.push(control);
        }
        for (const entities of leaving.values()) operations.push(op.remove(entities));
        break;
      }
      default:
        throw new TypeError(`surface: unknown change ${JSON.stringify(change.kind)}`);
    }
  }
  return operations;
}

// Where a moved node lands, counted in the destination without the node that is
// leaving, which is the region's own rule for a position.
function anchor(container, node, position) {
  const children = container.children;
  const from = indexOf.call(children, node);
  return (position >= from ? children[position + 1] : children[position]) ?? null;
}

// An operation on an unmanaged container still needs somewhere to render from.
const UNADAPTED = {
  create() { throw new Error('surface: apply needs an adapter to create a control outside a region'); },
  update() { throw new Error('surface: apply needs an adapter to update a control outside a region'); },
};

// The changes of one commit, applied in the order the bridge listed them. Each
// record is turned into operations against the tree the records before it left,
// validated, and run through the region that owns each container, or through
// `adapter` when the control is not a child of a region. Returns the frozen
// sequence that ran, every record's operations in order.
//
// A notification is a sequence, not a set: a record may name a form an earlier
// record created, take a position an earlier record vacated, or change a value
// an earlier record inserted. Resolving the whole notification first would
// answer all of those against a tree that no longer exists by the time the
// operations run, so a record is resolved when its turn comes.
//
// The price is that a notification is not rejected as a whole: a record that
// cannot run fails after the records before it have already been applied, and
// the error's `committed` says how many operations ran. That is the core's own
// bargain, made here for the same reason: the document has already committed,
// and a surface that refuses to show a change is not more correct than one that
// shows what it could and says where it stopped.
//
// An address with no control changes nothing, and a change this surface does
// not present is not an error: the surface shows part of a document and says so
// by having no control there.
export function apply(surface, changes, adapter = UNADAPTED) {
  if (guard.reason !== null) throw new Error(`surface: no writes while ${guard.reason}`);
  const ran = [];
  for (let i = 0; i < changes.length; i++) {
    // Turning a record into operations, checking them and finding their regions
    // are inside the same accounting as running them: a record the surface
    // cannot read, or one whose operations no longer check out, fails a
    // notification whose earlier records are already applied, and the caller
    // needs the count either way.
    try {
      const group = validate(operationsFor(surface, [changes[i]]));
      for (let j = 0; j < group.length; j++) {
        // One record can carry an operation per presentation of its address, and
        // an observer of the first can move the second somewhere else, so which
        // region executes an operation is asked when its turn comes, the same as
        // in a plan. `divide` first, because a record that removes every
        // presentation of an address names them as one operation and something
        // may have moved one of them since: each of them leaves through the
        // region it is in now. A control outside every region, a lone field in
        // an inspector, has none and is rendered through the surface adapter.
        for (const part of divide(group[j])) {
          const owner = ownerOf(part);
          if (owner === null) handle(part, adapter);
          else owner.execute(part);
          ran.push(part);
        }
      }
    } catch (error) {
      // Each operation runs alone, so what a region reports counts inside its
      // own group of one. The caller is holding the whole notification.
      if (error instanceof Error) error.committed = ran.length + (error.committed ?? 0);
      throw error;
    }
  }
  return Object.freeze(ran);
}
