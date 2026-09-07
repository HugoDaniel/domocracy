// Type declarations for surface.js.
import type { Adapter, Group, Operation } from './domocracy.js';

/**
 * SJON's name for a position in the document: a root and a path, `root:a/b/c`.
 * The author's, never the editor's, and it carries the root because the same
 * path exists in PROGRAM, WORLD, SESSION and VIEW.
 */
export type Address = string;

/** A value at one address changed. `preview` marks an override that is not committed. */
export interface ValueChange<V = unknown> {
  readonly kind: 'value';
  readonly address: Address;
  readonly value: V;
  readonly preview?: boolean;
}

/** A form arrived under `parent`, at `position` among its parent's forms. */
export interface InsertChange<V = unknown> {
  readonly kind: 'insert';
  readonly address: Address;
  readonly parent: Address;
  readonly position: number;
  readonly value: V;
}

/** A form took a new position under the same parent. */
export interface MoveChange {
  readonly kind: 'move';
  readonly address: Address;
  readonly parent?: Address;
  readonly position: number;
}

/** A form is gone. Every control presenting it goes with it. */
export interface RemoveChange {
  readonly kind: 'remove';
  readonly address: Address;
}

/**
 * What the editing bridge says happened to one address. The record is the
 * payload: it reaches `create` as the spec of a new control and `update` as the
 * data of an existing one.
 */
export type Change<V = unknown> = ValueChange<V> | InsertChange<V> | MoveChange | RemoveChange;

/** Every presentation of one address, in document order. */
export function controlsFor(surface: ParentNode, address: Address): NodeListOf<HTMLElement>;

/** The address of the control an element is in, or null when it is in none. */
export function addressOf(element: Element): Address | null;

/**
 * Change records as the operations that bring the surface up to date, resolved
 * against the tree as this call finds it. Pure: it reads the tree and writes
 * nothing. A change with no control contributes no operation. Handed several
 * records it answers for the tree as it is now, which is what inspecting a
 * notification wants and not what applying one means; `apply` therefore calls
 * it one record at a time.
 */
export function operationsFor<V = unknown>(
  surface: ParentNode,
  changes: readonly Change<V>[],
): Operation<Change<V>, Change<V>>[];

/**
 * Applies a notification record by record, in the order the bridge listed it.
 * Each record is resolved against the tree the records before it left,
 * validated, and executed through the region that owns each container, or
 * through `adapter` when the control is not a child of a region. Returns the
 * frozen sequence that ran.
 *
 * A record that cannot run fails after the records before it have been applied;
 * the error's `committed` says how many operations ran.
 */
export function apply<V = unknown>(
  surface: ParentNode,
  changes: readonly Change<V>[],
  adapter?: Adapter<Change<V>, Change<V>>,
): Group<Change<V>, Change<V>>;
