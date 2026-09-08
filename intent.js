// domocracy intentions. Four names on the core.
//
//   scope(element)                 interpreters for the intents raised below it
//   interpret(source, type, args)  what an intent would do, checked and not run
//   intent(source, type, args)     a request whose meaning its surroundings decide
//   effect(type, adapter)          what runs an effect after the operations
//
// A control raises an intent and the scopes above it interpret it, nearest
// first, each answering with a plan: a disposition, the operations it proposes
// and the effects it asks for. Nothing in a plan has run. The sequence is
// validated once, executed one operation at a time through the regions that own
// the containers it names, and the effects follow in plan order.
//
// `interpret` is the half of that which writes nothing: the route, the answers,
// the checks. `intent` is `interpret` and then the running. A page that wants to
// show what a control would do asks the first and not the second, and asks the
// second afresh when the control is used, because the tree may have moved.
//
// Interpreters describe, handlers execute: an interpreter reads the tree, which
// is the state, and writes nothing. The core's guard is set while they run, so
// a region.execute or a nested intent anywhere in the page throws.

import { divide, ownerOf, regionOf, validate, guard } from './domocracy.js';

const freeze = Object.freeze;
const scopes = new WeakMap();   // element -> { element, interpreters }
const adapters = new Map();     // effect type -> adapter
let raised = 0;                 // intent ids, in the order they were interpreted
const NOTHING = freeze([]);

// A scope is an element that answers for the intents raised below it. One scope
// per element; `dispose()` gives the element up again.
export function scope(element) {
  if (scopes.has(element)) throw new Error('scope: the element already has a scope');
  const interpreters = new Map();
  const mine = { element, interpreters };
  scopes.set(element, mine);
  return {
    element,
    // One interpreter per intent type. A scope that needs two answers for one
    // type writes one interpreter that gives both. Returns the function that
    // removes this one.
    handle(type, interpreter) {
      if (interpreters.has(type)) throw new Error(`scope: ${type} already has an interpreter here`);
      interpreters.set(type, interpreter);
      return () => { if (interpreters.get(type) === interpreter) interpreters.delete(type); };
    },
    // Gives the element up again, but only while this handle's own scope is the
    // one registered: disposing a replaced handle a second time must not take
    // the scope that replaced it.
    dispose() {
      if (scopes.get(element) === mine) scopes.delete(element);
      interpreters.clear();
    },
  };
}

// What runs one kind of effect, once the operations of the intent that asked for
// it have been applied. One adapter per type; it receives the request and the
// intent. Returns the function that removes it.
export function effect(type, adapter) {
  if (adapters.has(type)) throw new Error(`effect: ${type} already has an adapter`);
  adapters.set(type, adapter);
  return () => { if (adapters.get(type) === adapter) adapters.delete(type); };
}

// A remove of nothing is the one operation a plan may carry that runs nothing.
const runsNothing = o => o.op === 'remove' && o.entities.length === 0;

// Which region executes each operation is the core's `ownerOf`, asked when the
// operation's turn comes. By then the plan's own earlier operations have run,
// and so has whatever an observer or an adapter did while they ran: a plan that
// is allowed to provoke writes cannot also assume the tree it was written
// against. The pass below asks the same question of the plan as written. A node
// an earlier operation of the same plan moves belongs to where it lands, so the
// pass keeps the placement overrides the core's dry run keeps. Every operation
// must name a container with a region: an unmanaged one has no adapter to create
// or update with and no observers to tell. The one exception is a remove of
// nothing, which a plan may carry and which runs nothing. This is the pre-flight
// that lets a plan which was wrong from the start change nothing at all; what
// actually executes each operation is `ownerOf`, asked when its turn comes.
function ownersOf(group) {
  const parent = group.length > 1 ? new Map() : null;
  const cleared = group.length > 1 ? new Set() : null;   // containers an earlier clear emptied
  const parentOf = node => parent !== null && parent.has(node) ? parent.get(node)
    : cleared !== null && cleared.has(node.parentElement) ? null : node.parentElement;
  const owners = new Array(group.length);
  for (let i = 0; i < group.length; i++) {
    const o = group[i];
    let owner = null;
    switch (o.op) {
      case 'insert':
        owner = regionOf(o.region);
        break;
      case 'clear':
        // A clear empties its container, so an operation later in the plan that
        // names one of those children names a node that will be nowhere. The
        // core's dry run models this for structure; the same has to hold for
        // ownership, or a plan that was invalid from the start empties a region
        // before anything says so.
        owner = regionOf(o.region);
        if (cleared !== null) {
          cleared.add(o.region);
          for (const [node, held] of parent) if (held === o.region) parent.set(node, null);
        }
        break;
      case 'update': {
        const from = parentOf(o.entity);
        owner = from === null ? null : regionOf(from);
        break;
      }
      case 'move': {
        // The region a node leaves executes the move, so its observers and its
        // mirror see the node go while the destination's see it arrive. A node
        // coming from a container without a region is the destination's to take.
        const from = parentOf(o.entity);
        owner = (from === null ? null : regionOf(from)) ?? regionOf(o.region);
        if (parent !== null) parent.set(o.entity, o.region);
        break;
      }
      case 'remove': {
        // Where the nodes are is read before recording that they are gone,
        // because this operation's own owner is the container they leave.
        const entities = o.entities;
        const from = entities.length === 0 ? null : parentOf(entities[0]);
        for (let j = 1; j < entities.length; j++) {
          if (parentOf(entities[j]) !== from) throw new RangeError(`intent: operation ${i} removes nodes from more than one container`);
        }
        if (parent !== null) for (let j = 0; j < entities.length; j++) parent.set(entities[j], null);
        if (entities.length === 0) { owners[i] = null; continue; }
        owner = from === null ? null : regionOf(from);
        break;
      }
    }
    if (owner === null) throw new RangeError(`intent: operation ${i} (${o.op}) names a container with no region`);
    owners[i] = owner;
  }
  return owners;
}

// One effect request through its adapter. An effect with no adapter fails with a
// named error and the next effect still runs; so does one whose adapter throws.
// A promise is a result like any other and is not awaited: when the work
// finishes it raises a new intent.
function run(request, raising) {
  const adapter = adapters.get(request.type);
  if (adapter === undefined) return freeze({ type: request.type, status: 'failed', error: new Error(`effect: no adapter for ${request.type}`) });
  try {
    return freeze({ type: request.type, status: 'done', result: adapter(request, raising) });
  } catch (error) {
    return freeze({ type: request.type, status: 'failed', error });
  }
}

// What one plan contributes under one heading, as a frozen copy that is the
// plan's own to keep: the trace carries it, and an interpreter that goes on
// using its array afterwards changes nothing here. A pass contributes nothing,
// and a passing plan that proposes something is a mistake worth throwing for.
function contribution(plan, disposition, of) {
  const proposed = plan === null ? undefined : plan[of];
  if (proposed === undefined) return NOTHING;
  if (!Array.isArray(proposed)) throw new TypeError(`intent: a plan's ${of} must be an array`);
  if (proposed.length === 0) return NOTHING;
  if (disposition === 'pass') throw new TypeError(`intent: a passing plan proposed ${of}`);
  return freeze(proposed.slice());
}

// The half of an intent that writes nothing. The route is every scope above the
// source, nearest first; the trace is what each scope with an interpreter for
// the type answered, and what it contributed, until one consumed; the operations
// are the whole sequence, dry run as one; and the ownership pass asks which
// region would run each of them as the plan stands. What comes back is exactly
// what `intent` would run next, frozen, and nothing has run.
//
// A trace entry keeps the plan as the interpreter returned it, beside the
// frozen copies of what it contributed. The copies are what ran, or would; the
// plan is the interpreter's own object, for whatever else it chose to say in it,
// and it is neither copied nor frozen here.
//
// The tree is read as it stands, so the answer is good for the tree as it
// stands: a page that shows it asks again after anything changes, and asks
// `intent` rather than running this result when the control is used.
//
// Every interpretation takes an id, raised or not, so an interpreter and an
// adapter see one number for one intent and a rehearsal never shares its
// number with a raise.
export function interpret(source, type, args) {
  if (guard.reason !== null) throw new Error(`interpret: no interpretation while ${guard.reason}`);
  if (!source || source.nodeType !== 1 || !source.isConnected) throw new TypeError('intent: the source must be an element in the document');
  const id = ++raised;
  const raising = freeze({ id, source, type, args });
  // The route is taken before any interpreter runs, so a plan that moves the
  // source does not change which scopes finish this intent; the next intent
  // sees the new surroundings. The walk starts above the source, so a scope's
  // own host raises into the scopes around it and a room's controls do not
  // interpret themselves. parentElement ignores slot assignment and stops at a
  // shadow root, so the walk is the light-DOM ancestry and nothing else.
  const route = [];
  for (let el = source.parentElement; el !== null; el = el.parentElement) {
    const found = scopes.get(el);
    if (found !== undefined) route.push(found);
  }
  const trace = [], operations = [], effects = [];
  let consumed = false;
  guard.reason = 'interpreting';
  try {
    for (let i = 0; i < route.length && !consumed; i++) {
      const interpreter = route[i].interpreters.get(type);
      if (interpreter === undefined) continue;
      const answer = interpreter(raising, route[i].element);
      const plan = answer === undefined || answer === null ? null : answer;
      const disposition = plan === null ? 'pass' : plan.disposition;
      if (disposition !== 'pass' && disposition !== 'continue' && disposition !== 'consume') {
        throw new TypeError(`intent: an interpreter for ${type} returned the disposition ${JSON.stringify(disposition)}`);
      }
      const proposed = contribution(plan, disposition, 'operations');
      const asked = contribution(plan, disposition, 'effects');
      trace.push(freeze({ scope: route[i].element, disposition, plan, operations: proposed, effects: asked }));
      for (let j = 0; j < proposed.length; j++) operations.push(proposed[j]);
      for (let j = 0; j < asked.length; j++) effects.push(asked[j]);
      consumed = disposition === 'consume';
    }
  } finally {
    guard.reason = null;
  }
  // One dry run over the whole sequence, whatever regions it touches, and one
  // pass over the plan as written. A failure in either refuses the intent
  // before anything could run.
  const group = validate(operations);
  ownersOf(group);
  return freeze({
    id,
    source,
    type,
    args,
    disposition: consumed ? 'consumed' : 'passed',
    route: freeze(Array.from(route, each => each.element)),
    trace: freeze(trace),
    operations: group,
    effects: freeze(effects),
  });
}

// An intent is a request raised from an element: what it means is decided by the
// scopes above it, and what it references is in its args and does not move with
// it. It is `interpret`, then the running. Returns what happened: the
// disposition, the scopes that answered, the operations that ran and what
// became of the effects that were asked for.
export function intent(source, type, args) {
  if (guard.reason !== null) throw new Error(`intent: no intents while ${guard.reason}`);
  const interpreted = interpret(source, type, args);
  // The operations run one at a time, in plan order, each through the region
  // that owns it at the moment it runs, so no grouping can reorder a
  // dependency, every region sees each change as it happens, and a write from
  // an observer between two operations cannot leave the next one with the
  // region it used to belong to.
  const group = interpreted.operations;
  for (let i = 0; i < group.length; i++) {
    try {
      if (runsNothing(group[i])) continue;
      // A plan names the nodes of one operation together, so a remove whose
      // nodes something has scattered since is refused rather than divided: the
      // pre-flight refuses the same thing in the plan as written, and this is
      // the same rule asked again of the tree as it is.
      if (divide(group[i]).length > 1) throw new RangeError(`intent: operation ${i} removes nodes from more than one container`);
      const owner = ownerOf(group[i]);
      if (owner === null) throw new RangeError(`intent: operation ${i} (${group[i].op}) names a container with no region`);
      owner.execute(group[i]);
    } catch (error) {
      // Each operation runs as a group of one, so the index that region reports
      // counts inside that group. The caller is holding the whole plan, so the
      // number it needs is how many of the plan's operations are committed.
      if (error instanceof Error) error.committed = i + (error.committed ?? 0);
      throw error;
    }
  }
  const requests = interpreted.effects;
  const done = new Array(requests.length);
  for (let i = 0; i < requests.length; i++) done[i] = run(requests[i], interpreted);
  return freeze({
    id: interpreted.id,
    disposition: interpreted.disposition,
    route: interpreted.route,
    trace: interpreted.trace,
    operations: group,
    effects: freeze(done),
  });
}
