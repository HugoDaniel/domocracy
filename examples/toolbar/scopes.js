// Rooms: scopes with names, and a rehearsal that is `interpret` with the names
// put back.
//
//   room(element, name, handlers)     a scope with a name and one interpreter per type
//   nameOf(element)                   the name a room had on the element, even after it is gone
//   rehearse(source, type, args)      what each room would answer, without running any of it
//   raise(source, type, args, from)   intent, then a bubbling report of what happened
//   labelOf(node), describe(op)       a node and an operation as lines of text
//
// `interpret` is the half of `intent` that writes nothing: the route, the
// answers under the guard, the dry run and the ownership pass. `rehearse` calls
// it and lays the answer out room by room: which had nothing to say, which
// answered and with what, which were never reached. It keeps no interpreters
// of its own and adds no rules. The names are all it knows.
import { dispatch } from 'domocracy';
import { interpret, intent, scope } from 'domocracy/intent';

const freeze = Object.freeze;
const NOTHING = freeze([]);
const names = new WeakMap();   // element -> name, kept after the room is disposed

export function room(element, name, handlers) {
  const owner = scope(element);
  const offs = Object.entries(handlers).map(([type, interpreter]) => owner.handle(type, interpreter));
  names.set(element, name);
  return {
    element,
    name,
    dispose() {
      for (const off of offs) off();
      owner.dispose();
    },
  };
}

// A trace names the elements that answered, and one of them may be gone by the
// time the trace is read: a card that removed itself has disposed its room.
// The name outlives the room, so the log can still say who decided.
export function nameOf(element) { return names.get(element) ?? null; }

// One answer per scope on the route, in the order `intent` would ask them. A
// scope in the trace answered, and its entry says what it contributed. A scope
// on the route and not in the trace either had no interpreter for the type or
// came after the one that consumed, and the order of the route tells which.
//
// What `interpret` refuses, this reports: an interpreter that threw, a passing
// plan that proposed something, a sequence that does not check out. `intent`
// would have thrown before anything ran, and here nothing ran either way.
export function rehearse(source, type, args) {
  let interpreted;
  try {
    interpreted = interpret(source, type, args);
  } catch (error) {
    return freeze({ type, args, interpreted: null, answers: NOTHING, error });
  }
  const answered = new Map();
  for (const entry of interpreted.trace) answered.set(entry.scope, entry);
  let reached = true;
  const answers = interpreted.route.map(element => {
    const name = nameOf(element) ?? 'a scope';
    const entry = answered.get(element);
    if (entry === undefined) return freeze({ name, state: reached ? 'skipped' : 'unreached' });
    if (entry.disposition === 'consume') reached = false;
    return freeze({ name, state: entry.disposition, plan: entry.plan, operations: entry.operations, effects: entry.effects });
  });
  return freeze({ type, args, interpreted, answers: freeze(answers), error: null });
}

// Raises the intent and reports the outcome as a bubbling `intent:raised` event
// from `from`, which defaults to the source. A plan may move or remove its own
// source, and an event from a detached node reaches nobody, so a caller whose
// source might leave hands over an element that stays.
export function raise(source, type, args, from = source) {
  let outcome;
  try {
    outcome = freeze({ type, result: intent(source, type, args) });
  } catch (error) {
    outcome = freeze({ type, error });
  }
  dispatch(from, 'intent:raised', outcome);
  return outcome;
}

// How a node is named in a line of text: its data-label, its aria-label, or its
// text, after its tag and first class.
export function labelOf(node) {
  const tag = `<${node.tagName.toLowerCase()}${node.classList.length ? `.${node.classList[0]}` : ''}>`;
  const text = node.dataset.label ?? node.getAttribute('aria-label') ?? node.textContent.trim().replace(/\s+/g, ' ');
  if (text === '') return tag;
  return `${tag} “${text.length > 26 ? `${text.slice(0, 24)}…` : text}”`;
}

const at = before => before === null ? 'at the end' : `before ${labelOf(before)}`;

export function describe(o) {
  switch (o.op) {
    case 'insert': return `insert ${o.specs.length} into ${labelOf(o.region)} ${at(o.before)}`;
    case 'move': return `move ${labelOf(o.entity)} into ${labelOf(o.region)} ${at(o.before)}`;
    case 'update': return `update ${labelOf(o.entity)} with ${JSON.stringify(o.data)}`;
    case 'remove': return `remove ${o.entities.map(labelOf).join(', ')}`;
    case 'clear': return `clear ${labelOf(o.region)}`;
    default: return String(o.op);
  }
}
