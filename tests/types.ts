// The only type check there is. `tsc --noEmit tests/types.ts` compiles the
// three declaration files against a use of every exported name, so a signature
// that drifts from the code is caught by hand before a release.
//
//   npx tsc --noEmit --strict --module nodenext --target es2022 --lib es2022,dom tests/types.ts
//
// It is a compile, never a run: the values here are only as real as the types
// need them to be.
import { op, validate, apply, region, regionOf, ownerOf, divide, guard, on, dispatch } from '../domocracy.js';
import type { Adapter, Group, Located, Off, Operation, Region } from '../domocracy.js';
import { scope, interpret, intent, effect } from '../intent.js';
import type { EffectRequest, Intent, Interpretation, Plan, Result, Scope, TraceEntry } from '../intent.js';
import { addressOf, controlsFor, operationsFor, apply as applyChanges } from '../surface.js';
import type { Address, Change } from '../surface.js';

// A region carries two types: the spec an insert puts there and the data an
// update replaces one with. Both are the application's, never the core's.
interface Row { label: string; done: boolean }

const rows: Adapter<Row, Partial<Row>> = {
  create(spec: Row): Element {
    const li = document.createElement('li');
    li.textContent = spec.label;
    return li;
  },
  update(node: Element, data: Partial<Row>): void {
    if (data.label !== undefined) node.textContent = data.label;
  },
};

const container = document.querySelector('ul')!;
const list: Region<Row, Partial<Row>> = region(container, rows, { items: [{ label: 'first', done: false }] });

const first: Element = list.nodes[0];
const count: number = list.length;
const items: readonly Row[] | null = list.items;

// The five operations, built and validated without a region in sight.
const built: Operation<Row, Partial<Row>>[] = [
  op.insert<Row>(container, null, [{ label: 'second', done: false }]),
  op.move(first, container, null),
  op.update<Partial<Row>>(first, { done: true }),
  op.remove([first]),
  op.clear(container),
];
const checked: Group<Row, Partial<Row>> = validate<Row, Partial<Row>>(built);
apply<Row, Partial<Row>>(checked[0], rows);

// The same five through the region, by node and by position.
const committed: Group<Row, Partial<Row>> = list.execute(built[0]);
list.insert([{ label: 'third', done: false }], first);
list.move(first, null, list);
list.update(first, { done: true });
list.remove(first);
list.remove([first]);
list.swap(0, 1);
list.swap(first, list.nodes[1]);
list.insertAt(0, [{ label: 'fourth', done: false }]);
list.removeAt(0, 2);
list.updateAt(0, { done: false });
list.moveAt(0, 1);
list.clear();

const found: Located<Row> | null = list.at(document.body);
const where: number | undefined = found?.index;
const item: Row | undefined = found?.item;
const same: Region<Row, Partial<Row>> | null = regionOf<Row, Partial<Row>>(container);
const runner: Region<Row, Partial<Row>> | null = ownerOf<Row, Partial<Row>>(built[0]);
const parts: Operation<Row, Partial<Row>>[] = divide<Row, Partial<Row>>(built[3]);
const stopObserving: Off = list.observe((group: Group<Row, Partial<Row>>, of: Region<Row, Partial<Row>>) => {
  const how: number = group.length + of.length;
});

// Delegated handlers and actions. A known event type keeps its own interface;
// a custom one carries the detail the dispatch sent.
const stopClicks: Off = on(document, 'click', 'li', (event: MouseEvent, match: Element) => {
  const x: number = event.clientX;
  match.classList.toggle('picked');
});
const stopCustom: Off = on<{ by: string }>(container, 'row:picked', 'li', (event, match) => {
  const by: string = event.detail.by;
});
const wentThrough: boolean = dispatch<{ by: string }>(first, 'row:picked', { by: 'pointer' });

// A scope answers for the intents raised below it, and an interpreter returns a
// plan without running any of it.
const here: Scope = scope(container);
const stopHandling: Off = here.handle<{ index: number }, Row, Partial<Row>>('row:pick', (raised: Intent<{ index: number }>, element: Element): Plan<Row, Partial<Row>> => ({
  disposition: 'consume',
  operations: [op.update<Partial<Row>>(raised.source, { done: true })],
  effects: [{ type: 'save', address: 'world:rows' }],
}));
here.dispose();

const stopSaving: Off = effect<{ type: 'save'; address: string }, { index: number }>('save', (request, raised) => {
  const address: string = request.address;
  const index: number = raised.args.index;
  return Promise.resolve(address + index);
});

// What an intent would do, checked and not run: the same route, trace and
// operations a result carries, with the effects still as requests.
const seen: Interpretation<{ index: number }, Row, Partial<Row>> = interpret<{ index: number }, Row, Partial<Row>>(first, 'row:pick', { index: 0 });
const raisedFrom: Element = seen.source;
const wouldBe: 'consumed' | 'passed' = seen.disposition;
const wholeRoute: readonly Element[] = seen.route;
const proposed: Group<Row, Partial<Row>> = seen.trace[0].operations;
const requested: readonly EffectRequest[] = seen.effects;
const forAdapters: Intent<{ index: number }> = seen;

const outcome: Result<Row, Partial<Row>> = intent<{ index: number }, Row, Partial<Row>>(first, 'row:pick', { index: 0 });
const answered: 'consumed' | 'passed' = outcome.disposition;
const route: readonly Element[] = outcome.route;
const asked: readonly TraceEntry<Row, Partial<Row>>[] = outcome.trace;
const decided: 'pass' | 'continue' | 'consume' = asked[0].disposition;
const returned: Plan<Row, Partial<Row>> | null = asked[0].plan;
const reason: string | undefined = (returned as (Plan<Row, Partial<Row>> & { reason?: string }) | null)?.reason;
const ran: Group<Row, Partial<Row>> = outcome.operations;
const outside: string | undefined = outcome.effects[0]?.type;

// The editing surface: addresses in the tree, a commit's changes as operations.
const address: Address | null = addressOf(first);
const controls: NodeListOf<HTMLElement> = controlsFor(document, 'world:dust/velocity');
const changes: Change<number>[] = [
  { kind: 'value', address: 'world:dust/velocity', value: 3, preview: true },
  { kind: 'insert', address: 'world:dust/layers/haze', parent: 'world:dust/layers', position: 1, value: 5 },
  { kind: 'move', address: 'world:dust/layers/haze', parent: 'world:dust/layers', position: 0 },
  { kind: 'remove', address: 'world:dust/layers/haze' },
];
const toRun: Operation<Change<number>, Change<number>>[] = operationsFor<number>(document, changes);
const fields: Adapter<Change<number>, Change<number>> = {
  create: (spec: Change<number>) => document.createElement('div'),
  update: (node: Element, data: Change<number>) => { node.textContent = data.address; },
};
const brought: Group<Change<number>, Change<number>> = applyChanges<number>(document, changes, fields);

// The guard is a plain object holding one reason, so an interpreter can be told
// what it is and every region can refuse until it is null again.
const why: string | null = guard.reason;
