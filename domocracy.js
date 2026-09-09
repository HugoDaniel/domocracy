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

// A group is checked against a model of the tree, not the tree itself.
// Checking each operation against the tree as it is now cannot see a
// dependency between two of them: remove an anchor, then insert before it, and
// both checks pass while the second insertBefore throws with the group half
// applied. The model is a map of placement overrides on top of the live tree.
// Each operation is checked as the earlier ones would have left things, then
// records what it would change. The nodes an insert would create do not exist
// yet, so nothing later in the group can name them.
//
// `check`, when given, runs on every operation after its own checks and before
// it is recorded, with `parentOf` reading the model, so a layer can ask its own
// questions of the tree as the group would leave it. `intent.js` asks which
// region would own each operation.
function dryRun(group, check) {
  const parent = new Map();    // node -> Element | null, as earlier operations leave it
  const cleared = new Set();   // containers an earlier clear emptied
  const parentOf = node => parent.has(node) ? parent.get(node) : cleared.has(node.parentNode) ? null : node.parentNode;
  const inside = (node, ancestor) => { for (let n = node; n; n = parentOf(n)) if (n === ancestor) return true; return false; };
  const record = o => {
    switch (o.op) {
      case 'move': parent.set(o.entity, o.region); break;
      case 'remove': for (const entity of o.entities) parent.set(entity, null); break;
      case 'clear':
        cleared.add(o.region);
        for (const [node, p] of parent) if (p === o.region) parent.set(node, null);
        break;
    }
  };
  for (let i = 0; i < group.length; i++) {
    const o = group[i];
    switch (o.op) {
      case 'insert':
        if (!Array.isArray(o.specs)) throw new TypeError('insert: specs must be an array');
        anchored(o, parentOf);
        break;
      case 'move':
        if (o.entity === o.before) throw new RangeError('move: entity and before are the same node');
        if (inside(o.region, o.entity)) throw new RangeError('move: region is inside the entity');
        anchored(o, parentOf);
        break;
      case 'remove':
        for (const entity of o.entities) if (parentOf(entity) === null) throw new RangeError('remove: entity has no parent');
        break;
      case 'update':
      case 'clear':
        break;
      default:
        throw new TypeError(`unknown operation ${o.op}`);
    }
    if (check !== undefined) check(o, i, parentOf);
    record(o);
  }
}

// insert and move place a node before an anchor, and the anchor has to be a
// child of the region they name.
function anchored(o, parentOf) {
  if (o.before !== null && parentOf(o.before) !== o.region) throw new RangeError(`${o.op}: before is not a child of the region`);
}

// The pure half of execute. Takes one operation or an ordered sequence of them,
// whatever containers they touch, dry runs the whole sequence and returns it
// frozen. `check` goes to the dry run. `intent.js` calls this once over a plan
// before executing it.
export function validate(ops, check) {
  const group = Array.isArray(ops) ? freeze(ops.slice()) : freeze([ops]);
  dryRun(group, check);
  return group;
}

// The DOM handler: one validated operation, one adapter. The only function here
// that writes to the tree.
export function apply(o, adapter) {
  switch (o.op) {
    case 'insert': {
      // Every node is created before the tree is touched, so a create that
      // throws halfway leaves this operation without a trace.
      const nodes = o.specs.map(spec => adapter.create(spec));
      // insertBefore(node, null) is appendChild, so one loop serves appending
      // and inserting.
      for (const node of nodes) o.region.insertBefore(node, o.before);
      return;
    }
    case 'move': place(o.region, o.entity, o.before); return;
    case 'update': adapter.update(o.entity, o.data); return;
    case 'remove': for (const entity of o.entities) entity.remove(); return;
    case 'clear': o.region.textContent = ''; return;
  }
}

// One region per container, so an operation naming a container always names the
// same region, and a second region over the same children cannot exist.
const regions = new WeakMap();

// Set while an interpreter runs, in `intent.js`. Interpreters describe what
// should happen and return it as a plan, so a write from inside one is a bug,
// and every execute in the page refuses until the reason is cleared again.
// `Region.execute`, `interpret`, `intent` and `surface.apply` read it. The
// exported `apply` does not, being the handler execute calls once per
// operation, and nothing can cover `node.remove()` or `container.append()`,
// which are the platform's. A write from an observer or an adapter while a
// sequence runs is allowed. A group is validated once as a whole, so the
// operations after such a write are applied as they stand; a plan or a
// notification checks each operation when its turn comes, so a write that
// invalidates the rest fails it there.
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
      const gone = new Set(entities.map(entity => position(entity)));
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
    const index = isSection(container) ? node => node.sectionRowIndex : node => Array.prototype.indexOf.call(children, node);
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
        // where the node is now, not by the region this call was made on, so
        // the same sequence means the same thing whichever region runs it. A
        // move inside this region, the common one, costs two comparisons; only
        // one that crosses a container boundary looks up the regions at its
        // two ends.
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

  // A move this region runs on behalf of others. Either end may be null, a
  // container with no region. Both ends being the same region is a reorder
  // inside it, one change to that mirror by its own rule; read as a transfer
  // it would count the node twice. Only a third region running the group gets
  // here that way.
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
    for (const observer of this.#observers) observer(group, this);
  }
}

export function region(container, adapter, options) { return new Region(container, adapter, options); }

// The region of a container, or null. An operation names containers, so this is
// how a plan built elsewhere finds the region that owns the one it names.
export function regionOf(container) { return regions.get(container) ?? null; }

// The tree as it is, which is what `ownerOf` and `divide` read unless a caller
// hands them a model of it, the way the dry run does for a group.
const live = node => node.parentElement;

// The region that would execute one operation: the container an insert or a
// clear names, the container an update's or a remove's nodes are in, and for a
// move the region it leaves, or the one it lands in when it comes from a
// container without a region.
//
// Null when no region owns it: an unmanaged container, a node that is nowhere,
// a remove of nothing, or a remove whose nodes are no longer in one container.
// The last of those is not the same kind of answer as the others, which is
// what `divide` is for. Both layers ask this when an operation's turn comes
// rather than keeping a rule of their own, because a sequence that is allowed
// to provoke writes has to ask again for each operation.
export function ownerOf(o, parentOf = live) {
  switch (o.op) {
    case 'insert':
    case 'clear':
      return regions.get(o.region) ?? null;
    case 'update':
      return regions.get(parentOf(o.entity)) ?? null;
    case 'move':
      return regions.get(parentOf(o.entity)) ?? regions.get(o.region) ?? null;
    case 'remove': {
      const entities = o.entities;
      if (entities.length === 0) return null;
      const parent = parentOf(entities[0]);
      for (let i = 1; i < entities.length; i++) if (parentOf(entities[i]) !== parent) return null;
      return regions.get(parent) ?? null;
    }
    default:
      return null;
  }
}

// One operation as the operations its current owners would each execute. Only
// a remove names more than one node, so everything else is itself. A remove
// whose nodes something has scattered across containers since it was built
// becomes one remove per container, each of which has an owner again, so no
// region loses its notification or keeps a mirror naming a child it no longer
// has. Without this a caller has to read `null` from `ownerOf` as two things:
// an operation on a container with no region, which it may well handle itself,
// and one whose nodes no longer share a container, which it must not.
export function divide(o, parentOf = live) {
  if (o.op !== 'remove' || o.entities.length < 2) return [o];
  const each = new Map();
  for (const entity of o.entities) {
    const parent = parentOf(entity);
    const held = each.get(parent);
    if (held === undefined) each.set(parent, [entity]); else held.push(entity);
  }
  return each.size === 1 ? [o] : Array.from(each.values(), part => op.remove(part));
}

// How far a sequence got before `error` stopped it, as `committed` on the
// error: how many of its operations ran. A region counts its own group in
// `execute`. A layer that runs each operation of a plan or a notification as
// its own group counts the whole plan, so it adds what the group of one
// reported to what it had already run, which is what this does. Returns the
// error, to be thrown.
export function committed(error, ran) {
  if (error instanceof Error) error.committed = ran + (error.committed ?? 0);
  return error;
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
      for (const [selector, handler] of rules) {
        const match = target.closest(selector);
        if (match && root.contains(match)) {
          handler(event, match);
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
  return node.dispatchEvent(new CustomEvent(type, { bubbles: true, cancelable: true, detail }));
}
