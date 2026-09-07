// Type declarations for domocracy.js.

/** How one kind of control is rendered. Everything about the element is here. */
export interface Adapter<S = unknown, D = unknown> {
  /** Returns the element for a new child. */
  create(spec: S): Element;
  /** Refreshes one child. Needed by the update operation. */
  update?(node: Element, data: D): void;
}

/** One change to one region, as a frozen value. `before: null` means the end. */
export type Operation<S = unknown, D = unknown> =
  | { readonly op: 'insert'; readonly region: Element; readonly before: Element | null; readonly specs: readonly S[] }
  | { readonly op: 'move'; readonly entity: Element; readonly region: Element; readonly before: Element | null }
  | { readonly op: 'update'; readonly entity: Element; readonly data: D }
  | { readonly op: 'remove'; readonly entities: readonly Element[] }
  | { readonly op: 'clear'; readonly region: Element };

/** An ordered sequence of operations, frozen, validated and applied as one. */
export type Group<S = unknown, D = unknown> = readonly Operation<S, D>[];

/** The five operation constructors. Each copies the array it is given. */
export const op: {
  insert<S>(region: Element, before: Element | null, specs: readonly S[]): Operation<S, never>;
  move(entity: Element, region: Element, before: Element | null): Operation<never, never>;
  update<D>(entity: Element, data?: D): Operation<never, D>;
  remove(entities: readonly Element[]): Operation<never, never>;
  clear(region: Element): Operation<never, never>;
};

/** Thrown when an operation fails partway through a sequence. */
export interface OperationError extends Error {
  /**
   * How many operations of the sequence ran; the ones before the failure stay
   * applied. A region counts its own group, `intent` counts the plan and
   * `surface.apply` counts the notification.
   */
  committed?: number;
}

/** Where an element sits in a region. `item` only when the region keeps a mirror. */
export interface Located<S = unknown> {
  /** The direct child of the region that contains the element passed to at(). */
  node: Element;
  index: number;
  /** The mirror's entry for that child. Absent when the region keeps no mirror. */
  item?: S;
}

/** What a region keeps besides its children. */
export interface RegionOptions<S = unknown> {
  /**
   * One item per child, in order. Adopted frozen; the counts must match. In the
   * mirror a spec is the item an insert puts there and an update's data replaces
   * one, so a region that keeps a mirror usually has one type for both.
   */
  items?: readonly S[];
}

export type Off = () => void;

/** Receives every committed group, in order. */
export type Observer<S = unknown, D = unknown> = (group: Group<S, D>, region: Region<S, D>) => void;

/** A container whose direct children change only through operations. */
export interface Region<S = unknown, D = unknown> {
  /** The element whose children are the region. */
  readonly container: Element;
  /** The live collection of children. */
  readonly nodes: HTMLCollection;
  readonly length: number;
  /** The frozen mirror, or null when the region keeps none. Replaced, never mutated. */
  readonly items: readonly S[] | null;
  /** Validates a group, applies it in order, then delivers it to the observers. */
  execute(ops: Operation<S, D> | readonly Operation<S, D>[]): Group<S, D>;
  insert(specs: readonly S[], before?: Element | null): Group<S, D>;
  remove(nodes: Element | readonly Element[]): Group<S, D>;
  update(node: Element, data?: D): Group<S, D>;
  /** Moves a node inside this region, or into `to`, keeping the node alive. */
  move(node: Element, before?: Element | null, to?: Region<S, D>): Group<S, D>;
  clear(): Group<S, D>;
  /** Exchanges two children, given as nodes or as positions. One group of two moves. */
  swap(a: Element | number, b: Element | number): Group<S, D>;
  /** The same operations, said by position. */
  insertAt(index: number, specs: readonly S[]): Group<S, D>;
  removeAt(index: number, count?: number): Group<S, D>;
  updateAt(index: number, data?: D): Group<S, D>;
  /** Moves the child at `index` to position `at` of this region or of `to`, the end by default. */
  moveAt(index: number, at?: number, to?: Region<S, D>): Group<S, D>;
  /** Resolves an element inside a child to that child and its index, or null. */
  at(element: Node | null): Located<S> | null;
  /** Registers an observer; returns the function that removes it. */
  observe(fn: Observer<S, D>): Off;
}

export function region<S = unknown, D = unknown>(container: Element, adapter: Adapter<S, D>, options?: RegionOptions<S>): Region<S, D>;

/** The region of a container, or null. */
export function regionOf<S = unknown, D = unknown>(container: Element): Region<S, D> | null;

/**
 * One operation as the operations its current owners would each execute. Only a
 * remove names more than one node, so everything else answers with itself; a
 * remove whose nodes no longer share a container answers with one remove per
 * container, each of which has an owner again.
 *
 * Run an operation through this before `ownerOf` whenever null is going to mean
 * "handle it myself": otherwise a scattered remove reads the same as one on an
 * unmanaged container, and the regions involved lose both their notification and
 * their mirror's account of the children they no longer have.
 */
export function divide<S = unknown, D = unknown>(o: Operation<S, D>): Operation<S, D>[];

/**
 * The region that would execute one operation, read from the tree as it is:
 * the container an insert or a clear names, the container an update's or a
 * remove's nodes are in, and for a move the region it leaves, or the one it
 * lands in when it comes from a container without a region.
 *
 * Null when no region owns it: an unmanaged container, a node that is nowhere,
 * a remove of nothing, or a remove whose nodes are no longer in one container.
 * That last one is not the same kind of answer as the others, which is what
 * `divide` is for. `intent` and `surface.apply` both ask this when an
 * operation's turn comes, rather than trusting an answer taken before the
 * callbacks that are allowed to move things.
 */
export function ownerOf<S = unknown, D = unknown>(o: Operation<S, D>): Region<S, D> | null;

/** Dry runs a sequence over any containers and returns it frozen. Changes nothing. */
export function validate<S = unknown, D = unknown>(ops: Operation<S, D> | readonly Operation<S, D>[]): Group<S, D>;

/** The DOM handler: applies one validated operation through an adapter. */
export function apply<S = unknown, D = unknown>(o: Operation<S, D>, adapter: Adapter<S, D>): void;

/**
 * Set while an interpreter runs. Read by `Region.execute`, `intent` and
 * `surface.apply`, and by nothing else: the exported `apply` does not check it,
 * and native DOM writes are outside it. It says nothing about writes from an
 * observer or an adapter while a sequence runs, which are allowed.
 */
export const guard: { reason: string | null };

/** Registers a delegated handler; returns the function that removes it. */
export function on<K extends keyof HTMLElementEventMap>(
  root: Element | Document,
  type: K,
  selector: string,
  handler: (event: HTMLElementEventMap[K], match: Element) => void,
): Off;
export function on<D = unknown>(
  root: Element | Document,
  type: string,
  selector: string,
  handler: (event: CustomEvent<D>, match: Element) => void,
): Off;

/** Sends a bubbling, cancelable CustomEvent. Returns false when a handler called preventDefault(). */
export function dispatch<D>(node: Node, type: string, detail?: D): boolean;
