// Rooms: named scopes, kept where a rehearsal can find them.
//
//   room(element, name, handlers)     a scope with a name and one interpreter per type
//   roomOf(element)                   the room on an element, or null
//   nameOf(element)                   the name a room had on the element, even after it is gone
//   routeOf(source)                   the rooms an intent from source would visit
//   rehearse(source, type, args)      what each room would answer, without running any of it
//   raise(source, type, args, from)   intent, then a bubbling report of what happened
//   describe(operation)               one operation as a line of text
//
// `intent` walks the scopes above a source, asks each interpreter for a plan and
// runs the plans. `rehearse` walks the same route and asks the same question,
// then stops. The core's guard is set while the interpreters are asked, exactly
// as `intent` sets it, so an interpreter that writes throws here too. What comes
// back is what the "what will this do" panel shows.
//
// This works because interpreters are pure functions of the intent and the
// tree. That is the contract domocracy holds them to, and a rehearsal is that
// contract used as a feature: an answer you can read before you commit to it.
import { dispatch, guard, ownerOf, validate } from 'domocracy';
import { intent, scope } from 'domocracy/intent';

const freeze = Object.freeze;
const rooms = new WeakMap();   // element -> { element, name, interpreters }
const names = new WeakMap();   // element -> name, kept after the room is disposed

export function room(element, name, handlers) {
  const owner = scope(element);
  const interpreters = new Map();
  const offs = [];
  for (const [type, interpreter] of Object.entries(handlers)) {
    interpreters.set(type, interpreter);
    offs.push(owner.handle(type, interpreter));
  }
  const mine = { element, name, interpreters };
  rooms.set(element, mine);
  names.set(element, name);
  return {
    element,
    name,
    dispose() {
      for (const off of offs) off();
      owner.dispose();
      if (rooms.get(element) === mine) rooms.delete(element);
    },
  };
}

export function roomOf(element) { return rooms.get(element) ?? null; }

// A trace names the elements that answered, and one of them may be gone by the
// time the trace is read: a card that removed itself has disposed its room.
// The name outlives the room, so the log can still say who decided.
export function nameOf(element) { return names.get(element) ?? null; }

// The same walk `intent` takes: light-DOM ancestors, starting above the source.
export function routeOf(source) {
  const route = [];
  for (let el = source.parentElement; el !== null; el = el.parentElement) {
    const found = rooms.get(el);
    if (found !== undefined) route.push(found);
  }
  return route;
}

// One answer per room on the route. A room with no interpreter for the type is
// not asked, which is what `intent` does too; a room after a consume is not
// reached. The plan's operations are then dry run as one sequence, as `intent`
// would before executing, and each is asked which region would run it as the
// tree stands now. Nothing here changes anything.
export function rehearse(source, type, args) {
  const raised = freeze({ id: 0, source, type, args });
  const route = routeOf(source);
  const answers = [];
  const operations = [];
  const effects = [];
  let consumed = false;
  guard.reason = 'rehearsing';
  try {
    for (const each of route) {
      const interpreter = each.interpreters.get(type);
      if (consumed) { answers.push({ room: each, state: 'unreached' }); continue; }
      if (interpreter === undefined) { answers.push({ room: each, state: 'skipped' }); continue; }
      let plan = null, error = null;
      try { plan = interpreter(raised, each.element) ?? null; } catch (thrown) { error = thrown; }
      const disposition = error !== null ? 'error' : plan === null ? 'pass' : plan.disposition;
      answers.push({ room: each, state: disposition, plan, error });
      if (plan !== null) {
        for (const o of plan.operations ?? []) operations.push(o);
        for (const e of plan.effects ?? []) effects.push(e);
      }
      consumed = disposition === 'consume';
    }
  } finally {
    guard.reason = null;
  }
  let check;
  try {
    const group = validate(operations);
    const orphan = group.findIndex(o => ownerOf(o) === null);
    check = orphan === -1 ? { ok: true } : { ok: false, error: new RangeError(`operation ${orphan} (${group[orphan].op}) names a container with no region`) };
  } catch (error) {
    check = { ok: false, error };
  }
  return freeze({ type, args, route, answers, operations, effects, disposition: consumed ? 'consumed' : 'passed', check });
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
