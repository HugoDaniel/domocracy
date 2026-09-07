// domocracy. One small core, three names.
//
//   region(container, adapter, options)   children that change only through operations
//   on(root, type, selector, handler)     delegated handlers matched by selector
//   dispatch(node, type, detail)          actions as bubbling CustomEvents
//
// Every change a region makes to the DOM is an operation: a frozen value that
// names what happens and to which nodes. There are five of them, `insert`,
// `move`, `update`, `remove` and `clear`, and nothing else writes to a managed
// container. A group of operations is validated as a whole before the first
// one runs, so a group that could not finish never starts.
//
// Structure is behavior: what an action means is decided by the ancestors it
// bubbles through, and a handler registered on an ancestor applies to every
// matching element, including elements created later and elements moved in
// from elsewhere.
//
// Identity is the node. Position is an address inside a region and it changes
// when the region changes. Durable identity belongs to the document a surface
// shows, never to the surface: domocracy keeps no ids, no receipts and no
// history, so there is nothing here to fall out of step with the document.
//
// No per-node handlers, no expandos, no attribute language, no diffing.
// Whatever can be decided once is decided once, at module load or at region
// construction, so the operations themselves do no feature checks and no
// lookups they can avoid.

const freeze = Object.freeze;
const indexOf = Array.prototype.indexOf;
const COMPOSED = { composed: true };
const isSection = typeof HTMLTableSectionElement !== 'undefined'
  ? node => node instanceof HTMLTableSectionElement
  : () => false;

// How a node moves under a parent it already shares a root with, chosen once.
// moveBefore keeps the node's state (focus, selection, animations, an iframe's
// document) where insertBefore resets it.
const move = typeof Element !== 'undefined' && 'moveBefore' in Element.prototype
  ? (parent, node, before) => parent.moveBefore(node, before)
  : (parent, node, before) => parent.insertBefore(node, before);

// moveBefore refuses a node from a different root (a detached tree, another
// document), so a transfer checks the roots first and inserts when they differ.
function place(parent, node, before) {
  if (node.getRootNode(COMPOSED) === parent.getRootNode(COMPOSED)) move(parent, node, before);
  else parent.insertBefore(node, before);
}

// The five operations. Each is a frozen value naming one change to one region;
// `region`, `entity` and `before` are nodes, and `before === null` means the
// end of the region. The arrays are copied before they are frozen, so the value
// names exactly the specs and entities it was built with, whatever the caller
// does to its own array afterwards. What is inside a spec or a payload is the
// caller's: the core references it and never copies or walks it.
export const op = {
  insert: (region, before, specs) => freeze({ op: 'insert', region, before, specs: freeze(specs.slice()) }),
  move: (entity, region, before) => freeze({ op: 'move', entity, region, before }),
  update: (entity, data) => freeze({ op: 'update', entity, data }),
  remove: (entities) => freeze({ op: 'remove', entities: freeze(entities.slice()) }),
  clear: (region) => freeze({ op: 'clear', region }),
};

// What every operation must be true of, once. `parentOf` and `inside` are the
// model it is checked against: the live tree for a single operation, and the
// placement overrides of a group for the rest. Nothing here reads or writes
// anything else, so given the same model it gives the same answer and leaves no
// trace, and it throws before anything changes.
function step(o, parentOf, inside) {
  switch (o.op) {
    case 'insert':
      if (!Array.isArray(o.specs)) throw new TypeError('insert: specs must be an array');
      break;
    case 'move':
      if (o.entity === o.before) throw new RangeError('move: entity and before are the same node');
      if (inside(o.region, o.entity)) throw new RangeError('move: region is inside the entity');
      break;
    case 'update':
    case 'clear':
      return;
    case 'remove':
      for (let i = 0; i < o.entities.length; i++) if (parentOf(o.entities[i]) === null) throw new RangeError('remove: entity has no parent');
      return;
    default:
      throw new TypeError(`unknown operation ${o.op}`);
  }
  // insert and move are the two that place a node before an anchor, and the
  // anchor has to be a child of the region they name.
  if (o.before !== null && parentOf(o.before) !== o.region) throw new RangeError(`${o.op}: before is not a child of the region`);
}

// The live tree is the model a single operation is checked against.
const parentNow = node => node.parentNode;
const insideNow = (node, ancestor) => ancestor.contains(node);

// Checking each operation of a group against the tree as it is now cannot see a
// dependency between two of them: remove an anchor, then insert before it, and
// both checks pass while the second insertBefore throws with the group half
// applied. So a group of more than one operation is checked against a model
// instead, whose whole state is a map of placement overrides on top of the live
// tree. Each operation is checked as the earlier ones would have left things,
// then records what it would change. The nodes an insert would create do not
// exist yet, so nothing later in the group can name them.
function dryRun(group) {
  if (group.length === 1) return step(group[0], parentNow, insideNow);
  if (group.length === 0) return;
  const parent = new Map();    // node -> Element | null, as earlier operations leave it
  const cleared = new Set();   // containers an earlier clear emptied
  const parentOf = node => parent.has(node) ? parent.get(node) : cleared.has(node.parentNode) ? null : node.parentNode;
  // The walk is override-aware too, so a cycle that exists only after an earlier
  // move of the same group is caught as well.
  const inside = (node, ancestor) => { for (let n = node; n; n = parentOf(n)) if (n === ancestor) return true; return false; };
  for (let i = 0; i < group.length; i++) {
    const o = group[i];
    step(o, parentOf, inside);
    switch (o.op) {
      case 'move': parent.set(o.entity, o.region); break;
      case 'remove': for (const entity of o.entities) parent.set(entity, null); break;
      case 'clear':
        cleared.add(o.region);
        for (const [node, p] of parent) if (p === o.region) parent.set(node, null);
        break;
    }
  }
}

// The pure half of execute. Takes one operation or an ordered sequence of them,
// whatever containers they touch, dry runs the whole sequence and returns it
// frozen. `intent.js` calls this once over a plan before executing it.
export function validate(ops) {
  const group = Array.isArray(ops) ? freeze(ops.slice()) : freeze([ops]);
  dryRun(group);
  return group;
}

// The DOM handler: one validated operation, one adapter. The only function here
// that writes to the tree.
export function apply(o, adapter) {
  switch (o.op) {
    case 'insert': {
      const region = o.region, before = o.before, specs = o.specs, n = specs.length;
      const create = adapter.create, nodes = new Array(n);
      // Every node is created before the tree is touched, so a create that
      // throws halfway leaves this operation without a trace.
      for (let i = 0; i < n; i++) nodes[i] = create(specs[i]);
      // insertBefore(node, null) is appendChild inside Blink, so one loop
      // serves appending and inserting.
      for (let i = 0; i < n; i++) region.insertBefore(nodes[i], before);
      return;
    }
    case 'move': place(o.region, o.entity, o.before); return;
    case 'update': adapter.update(o.entity, o.data); return;
    case 'remove': {
      const entities = o.entities;
      for (let i = 0; i < entities.length; i++) entities[i].remove();
      return;
    }
    case 'clear': o.region.textContent = ''; return;
  }
}

// One region per container, so an operation naming a container always names the
// same region, and a second region over the same children cannot exist.
const regions = new WeakMap();

// Set while an interpreter runs, in `intent.js`. Interpreters describe what
// should happen and return it as a plan; a write from inside one is a bug, and
// every execute in the page refuses until the reason is cleared again.
//
// What that covers exactly: `Region.execute`, `intent` and `surface.apply` read
// it. The exported `apply` does not, because it is the handler that takes one
// already validated operation and is called once per operation from inside
// execute. Nothing can cover `node.remove()` or `container.append()`, which are
// the platform's. The guard catches the ordinary way of breaking the rule, not
// every way.
//
// It says nothing about a write from an observer or an adapter while a sequence
// is running. That is allowed: two presentations of one document are made of
// exactly that. What it costs depends on the sequence. A group here is validated
// once as a whole, so a write from inside it is outside what the dry run saw and
// the operations after it are applied as they stand. A plan or a notification
// runs each operation as its own group, so each is checked and its region found
// when its turn comes, and a write that invalidates the rest fails it there with
// `committed` saying how many ran.
export const guard = { reason: null };

// A region may keep a mirror: one frozen item per child, in order. It is an
// option because nothing in the core needs it, the children being the state
// already, so an application that wants its items in JavaScript pays for them
// here and nowhere else. The items a region is given must count as its children
// do, since the mirror names the children that are there.
function adopt(items, children) {
  if (!Array.isArray(items)) throw new TypeError('region: items must be an array');
  if (items.length !== children.length) throw new RangeError(`region: ${items.length} items for ${children.length} children`);
  return freeze(items.slice());
}

const NOTHING = freeze([]);

// The mirror one operation leaves behind, as a pure function of the array it is
// given, the operation, and `position`, which says where a node sits in this
// region and -1 when the node is not one of its children. It runs before apply,
// so the positions it reads are the ones the operation is about to change. In
// the mirror the spec is the item and an update's data replaces one. An
// operation about a node of another container leaves the array as it was, and a
// node moved in from outside arrives as undefined, because a mirror only ever
// names its own region's children.
function mirror(items, o, position) {
  switch (o.op) {
    case 'insert': {
      if (o.before === null) return freeze(items.concat(o.specs));
      const at = position(o.before);
      return freeze(items.slice(0, at).concat(o.specs, items.slice(at)));
    }
    case 'move': {
      const from = position(o.entity);
      const to = o.before === null ? items.length : position(o.before);
      if (from === -1) return freeze(items.slice(0, to).concat([undefined], items.slice(to)));
      if (to === from || to === from + 1) return items;   // the place it already holds
      const rest = items.slice(0, from).concat(items.slice(from + 1));
      const at = to > from ? to - 1 : to;
      return freeze(rest.slice(0, at).concat([items[from]], rest.slice(at)));
    }
    case 'update': {
      const at = position(o.entity);
      if (at === -1) return items;
      const next = items.slice();
      next[at] = o.data;
      return freeze(next);
    }
    case 'remove': {
      const entities = o.entities;
      if (entities.length === 1) {
        const at = position(entities[0]);
        return at === -1 ? items : freeze(items.slice(0, at).concat(items.slice(at + 1)));
      }
      const gone = new Set();
      for (let i = 0; i < entities.length; i++) gone.add(position(entities[i]));
      return freeze(items.filter((item, at) => !gone.has(at)));
    }
    case 'clear': return NOTHING;
  }
}

// A region is a container whose direct children change only through operations.
// The adapter is `{ create, update }`: `create(spec)` returns the element for a
// new child and `update(node, data)` refreshes one. Rendering is the adapter's,
// entirely; the region only decides what runs and in which order.
//
// `region(container, adapter, { items })` adds the mirror: one item per child,
// replaced and frozen by every operation, for an application that wants its
// items in JavaScript. Without it a region keeps nothing at all.
class Region {
  #container;
  #children;
  #adapter;
  #index;
  #items;
  #position;
  #observers = [];

  constructor(container, adapter, { items } = {}) {
    if (regions.has(container)) throw new Error('region: the container already has a region');
    const children = container.children;
    this.#container = container;
    this.#children = children;
    this.#adapter = adapter;
    // A table section keeps every row's index current for free; any other
    // container answers through the position among its children.
    const index = isSection(container) ? node => node.sectionRowIndex : node => indexOf.call(children, node);
    this.#index = index;
    // A region without a mirror allocates nothing for one. The mirror's own
    // position function refuses a node of another container, which a row index
    // would otherwise answer for.
    this.#items = items === undefined ? null : adopt(items, children);
    this.#position = items === undefined ? null : node => node.parentNode === container ? index(node) : -1;
    regions.set(container, this);
  }

  // The element whose children are the region.
  get container() { return this.#container; }

  // The live collection of children. Reading it is reading the DOM.
  get nodes() { return this.#children; }

  get length() { return this.#children.length; }

  // The frozen mirror, or null when the region keeps none.
  get items() { return this.#items; }

  // Validates a group, applies it in order, then hands the frozen group to the
  // observers. Nothing else in the core writes to a managed container.
  execute(ops) {
    if (guard.reason !== null) throw new Error(`region: no writes while ${guard.reason}`);
    const group = validate(ops);
    const adapter = this.#adapter, container = this.#container;
    let others = null, i = 0;
    try {
      for (; i < group.length; i++) {
        const o = group[i];
        // A move is the one operation that can leave one region and land in
        // another. Which region loses the node and which gains it is decided by
        // where the node is now, not by the region this call was made on: an
        // earlier operation of the same group may have moved it elsewhere, and
        // the same sequence has to mean the same thing whichever region runs it.
        // Inserts and updates pay no lookup for any of this.
        // A move inside this region is the common one and pays two comparisons
        // for the check. Only a move that crosses a container boundary looks up
        // which regions the two ends belong to.
        if (o.op === 'move' && (o.region !== container || o.entity.parentNode !== container)) {
          const from = regions.get(o.entity.parentNode) ?? null;
          const to = regions.get(o.region) ?? null;
          if (from !== null && from !== this && !(others ??= []).includes(from)) others.push(from);
          if (to !== null && to !== this && !(others ??= []).includes(to)) others.push(to);
          this.#hand(o, from, to);
          continue;
        }
        const items = this.#items;
        if (items === null) apply(o, adapter);
        else {
          // The positions the mirror needs are the ones this operation is about
          // to change, which is why it is computed per operation and not once
          // for the group: the second move of a swap needs what the first left.
          const next = mirror(items, o, this.#position);
          apply(o, adapter);
          this.#items = next;
        }
      }
      // Delivery is inside the loop's try so that an observer which throws is
      // reported as what it is: every operation of the group applied, and the
      // notification failed afterwards. `i` is the group's length by now, which
      // is what `committed` should say.
      this.#deliver(group);
      if (others !== null) for (const other of others) other.#deliver(group);
    } catch (error) {
      // An adapter that throws leaves the group half applied. The core does not
      // roll back: it says how far it got and lets the caller ask the document
      // what the truth is.
      if (error instanceof Error) error.committed = i;
      throw error;
    }
    return group;
  }

  // Inserts children built from `specs`, before `before` or at the end.
  insert(specs, before = null) { return this.execute(op.insert(this.#container, before, specs)); }

  // Removes one node or an array of them. The nodes leave the document.
  remove(nodes) { return this.execute(op.remove(Array.isArray(nodes) ? nodes : [nodes])); }

  // Hands one node and one payload to the adapter's update.
  update(node, data) { return this.execute(op.update(node, data)); }

  // Moves a node before `before`, or to the end, of this region or of `to`. The
  // node stays alive throughout, so a card dragged from one room to another
  // keeps its focus and its running state.
  move(node, before = null, to = this) { return this.execute(op.move(node, to.#container, before)); }

  // Empties the region. textContent is the fastest way the platform has to do
  // it, which is why clear is an operation of its own and not a bulk remove.
  clear() { return this.execute(op.clear(this.#container)); }

  // Exchanges two children, given as nodes or as positions. One group of two
  // moves, so it is validated and observed as the single change it is.
  swap(a, b) {
    const children = this.#children;
    // Two moves exchange two children only when they run in document order.
    // Adjacent children are why: taken the other way round, the second move
    // would aim at the node it is moving. Positions say which comes first by
    // themselves; nodes have to ask the tree, so positions are the cheaper way
    // to say it.
    const ordered = typeof a === 'number' && typeof b === 'number';
    if (ordered && a > b) { const first = b; b = a; a = first; }
    let left = typeof a === 'number' ? children[a] : a;
    let right = typeof b === 'number' ? children[b] : b;
    if (left === undefined || right === undefined) throw new RangeError(`region.swap: ${a}, ${b} of ${children.length}`);
    if (left === right) return this.execute([]);
    if (!ordered && left.compareDocumentPosition(right) & 2 /* Node.DOCUMENT_POSITION_PRECEDING */) { const first = right; right = left; left = first; }
    // The anchor for the second move is what followed the later node, which the
    // first move leaves where it is.
    const after = right.nextSibling;
    return this.execute([op.move(right, this.#container, left), op.move(left, this.#container, after)]);
  }

  // The index sugar. A position is an address inside the region, so these say
  // the same five operations by where they land rather than by which node, and
  // the range checks answer before an operation is built.
  insertAt(index, specs) {
    const children = this.#children;
    if (index < 0 || index > children.length) throw new RangeError(`region.insertAt: index ${index} of ${children.length}`);
    return this.insert(specs, children[index] ?? null);
  }

  removeAt(index, count = 1) {
    const children = this.#children;
    if (index < 0 || count < 0 || index + count > children.length) throw new RangeError(`region.removeAt: ${count} at ${index} of ${children.length}`);
    const nodes = new Array(count);
    for (let i = 0; i < count; i++) nodes[i] = children[index + i];
    return this.execute(op.remove(nodes));
  }

  updateAt(index, data) {
    const node = this.#children[index];
    if (node === undefined) throw new RangeError(`region.updateAt: index ${index} of ${this.#children.length}`);
    return this.update(node, data);
  }

  // `at` is the position the node holds after the move, counted in the
  // destination without the node that is leaving, and the end by default.
  moveAt(index, at, to = this) {
    const children = this.#children, node = children[index];
    if (node === undefined) throw new RangeError(`region.moveAt: index ${index} of ${children.length}`);
    const siblings = to.#children, room = to === this ? siblings.length - 1 : siblings.length;
    if (at === undefined) at = room;
    if (at < 0 || at > room) throw new RangeError(`region.moveAt: position ${at} of ${room}`);
    const before = (to === this && at >= index ? siblings[at + 1] : siblings[at]) ?? null;
    return this.move(node, before, to);
  }

  // Resolves an element inside one of the children to { node, index }, or null
  // when the element is not inside this region. This is how a delegated handler
  // turns an event target into the row it belongs to.
  at(element) {
    const container = this.#container;
    let node = element;
    while (node && node.parentNode !== container) node = node.parentNode;
    if (!node) return null;
    const index = this.#index(node);
    return this.#items === null ? { node, index } : { node, index, item: this.#items[index] };
  }

  // Every committed group, in order. The array is replaced rather than mutated,
  // so an observer that removes itself while the loop runs cannot disturb it.
  // Returns the function that removes the observer.
  observe(fn) {
    this.#observers = this.#observers.concat([fn]);
    return () => { this.#observers = this.#observers.filter(other => other !== fn); };
  }

  // A move this region is running on behalf of others. Either end may be null, a
  // container with no region.
  //
  // Both ends being the same region is a reorder inside it, which is one change
  // to one mirror by that mirror's own rule. Reading it as a transfer would take
  // the item out at one position and put it back at another, both computed from
  // the array as it was, and the second write would win: the node would be
  // counted twice. That is only reachable when a third region runs the group,
  // since a region reordering its own children never comes through here.
  #hand(o, from, to) {
    if (from === to) {
      const items = from === null ? null : from.#items;
      if (items === null) { apply(o, this.#adapter); return; }
      const next = mirror(items, o, from.#position);
      apply(o, this.#adapter);
      from.#items = next;
      return;
    }
    // A move between two containers carries the item with the node: the region
    // it leaves loses it at the entity's position, the region it lands in gains
    // it at the anchor's, and both positions are read before the tree changes.
    // A node that arrives from a container with no region arrives as undefined,
    // and one that leaves for such a container is dropped.
    const mine = from === null ? null : from.#items, theirs = to === null ? null : to.#items;
    if (mine === null && theirs === null) { apply(o, this.#adapter); return; }
    const at = mine === null ? -1 : from.#position(o.entity);
    const item = at === -1 ? undefined : mine[at];
    const next = at === -1 ? null : freeze(mine.slice(0, at).concat(mine.slice(at + 1)));
    const into = theirs === null ? 0 : o.before === null ? theirs.length : to.#position(o.before);
    const arrived = theirs === null ? null : freeze(theirs.slice(0, into).concat([item], theirs.slice(into)));
    apply(o, this.#adapter);
    if (next !== null) from.#items = next;
    if (arrived !== null) to.#items = arrived;
  }

  #deliver(group) {
    const observers = this.#observers;
    for (let i = 0; i < observers.length; i++) observers[i](group, this);
  }
}

export function region(container, adapter, options) { return new Region(container, adapter, options); }

// The region of a container, or null. An operation names containers, so this is
// how a plan built elsewhere finds the region that owns the one it names.
export function regionOf(container) { return regions.get(container) ?? null; }

// The region that would execute one operation, read from the tree as it is: the
// container an insert or a clear names, the container an update's or a remove's
// nodes are in, and for a move the region it leaves, or the one it lands in when
// it comes from a container without a region.
//
// Null when no region owns it: an unmanaged container, a node that is nowhere, a
// remove of nothing, or a remove whose nodes are no longer in one container. The
// last of those is not the same kind of answer as the others, and a caller that
// means to handle an unmanaged container itself has to run the operation through
// `divide` first, which is what both layers here do.
//
// Both of them ask this rather than keeping a rule of their own, because a
// sequence that is allowed to provoke writes has to ask again for each operation
// and two answers that drift apart are worth more trouble than the lookup costs.
export function ownerOf(o) {
  switch (o.op) {
    case 'insert':
    case 'clear':
      return regions.get(o.region) ?? null;
    case 'update':
      return holder(o.entity);
    case 'move': {
      const from = holder(o.entity);
      return from ?? regions.get(o.region) ?? null;
    }
    case 'remove': {
      const entities = o.entities;
      if (entities.length === 0) return null;
      const parent = entities[0].parentElement;
      for (let i = 1; i < entities.length; i++) if (entities[i].parentElement !== parent) return null;
      return parent === null ? null : regions.get(parent) ?? null;
    }
    default:
      return null;
  }
}

const holder = node => {
  const parent = node.parentElement;
  return parent === null ? null : regions.get(parent) ?? null;
};

// One operation as the operations its current owners would each execute, so
// that `ownerOf` is asked only about operations that can have one owner.
//
// Only a remove names more than one node, and only something that moved those
// nodes after the operation was built can leave them in different containers,
// so everything else is itself and the answer is the operation alone. A remove
// that has been scattered becomes one remove per container, each of which has
// an owner again, and none of the regions involved loses its notification or is
// left with a mirror naming a child it no longer has.
//
// Without this a caller has to read `null` from `ownerOf` as two different
// things: an operation on a container that has no region, which the caller may
// well handle itself, and one whose nodes no longer share a container, which it
// must not treat the same way.
export function divide(o) {
  const entities = o.op === 'remove' ? o.entities : null;
  if (entities === null || entities.length < 2) return [o];
  const parent = entities[0].parentElement;
  let scattered = false;
  for (let i = 1; i < entities.length && !scattered; i++) scattered = entities[i].parentElement !== parent;
  if (!scattered) return [o];
  const each = new Map();
  for (let i = 0; i < entities.length; i++) {
    const held = each.get(entities[i].parentElement);
    if (held === undefined) each.set(entities[i].parentElement, [entities[i]]); else held.push(entities[i]);
  }
  return Array.from(each.values(), part => op.remove(part));
}

// CustomEvent copies its init dictionary, so one dictionary per event kind
// serves every event. `detail` is set for the construction and cleared right
// after, so the dictionary never keeps the last payload alive.
const ACTION = { bubbles: true, cancelable: true, detail: null };
function event(type, init, detail) {
  init.detail = detail;
  const event = new CustomEvent(type, init);
  init.detail = null;
  return event;
}

// Delegated handlers. One native listener per root and event type, added the
// first time a rule is registered; each rule is a selector matched with
// Element.closest from the event target upwards, so it applies to elements
// that exist now, elements created later, and elements moved in from another
// root. Rules run in registration order and receive (event, matchedElement).
// A handler that calls event.stopPropagation() ends the matching for that
// event. The returned function removes the rule.
//
// The root is an Element or the Document. focus and blur do not bubble; use
// focusin and focusout.
const roots = new WeakMap();
export function on(root, type, selector, handler) {
  let types = roots.get(root);
  if (!types) roots.set(root, types = new Map());
  let entry = types.get(type);
  if (!entry) {
    // The rule array is replaced on every change, never mutated, so a handler
    // that removes itself or adds another while the loop runs cannot disturb it.
    types.set(type, entry = { rules: [] });
    root.addEventListener(type, event => {
      const rules = entry.rules;
      let target = event.target;
      if (target.nodeType !== 1) target = target.parentNode;
      if (!target || !target.closest) return;
      for (let i = 0; i < rules.length; i++) {
        const match = target.closest(rules[i][0]);
        if (match && root.contains(match)) {
          rules[i][1](event, match);
          if (event.cancelBubble) return;
        }
      }
    });
  }
  const rule = [selector, handler];
  entry.rules = entry.rules.concat([rule]);
  return () => { entry.rules = entry.rules.filter(r => r !== rule); };
}

// Actions bubble. A component dispatches on its own node and never touches an
// ancestor's DOM; whichever ancestor handles the action decides what it means,
// and the same card does different things in different rooms. The event is
// cancelable, so a handler that calls event.preventDefault() makes dispatch
// return false, which tells the sender its action was taken up.
export function dispatch(node, type, detail) {
  return node.dispatchEvent(event(type, ACTION, detail));
}
