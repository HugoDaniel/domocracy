// Type declarations for intent.js.
import type { Group, Off, Operation } from './domocracy.js';

/** A request raised from an element. What it means is the scopes' to decide. */
export interface Intent<A = unknown> {
  readonly id: number;
  /** The element the walk starts above. */
  readonly source: Element;
  readonly type: string;
  /** Values and explicit references. What it names does not move with it. */
  readonly args: A;
}

/** What an interpreter does with an intent: nothing, something, or the last word. */
export type Disposition = 'pass' | 'continue' | 'consume';

/** A request to act outside the surface, run by its adapter after the operations. */
export interface EffectRequest {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** What an interpreter returns. Nothing in it has run. A pass proposes nothing. */
export interface Plan<S = unknown, D = unknown> {
  disposition: Disposition;
  operations?: readonly Operation<S, D>[];
  effects?: readonly EffectRequest[];
}

/** Reads the tree and returns a plan. Writing from one throws. */
export type Interpreter<A = unknown, S = unknown, D = unknown> =
  (intent: Intent<A>, element: Element) => Plan<S, D> | void | null;

/** An element that answers for the intents raised below it. */
export interface Scope {
  readonly element: Element;
  /** One interpreter per intent type here; a second for the type throws. */
  handle<A = unknown, S = unknown, D = unknown>(type: string, interpreter: Interpreter<A, S, D>): Off;
  /**
   * Gives the element up again; it can take a new scope afterwards. Disposing a
   * handle whose scope has already been replaced removes this handle's
   * interpreters and leaves the replacement alone.
   */
  dispose(): void;
}

/** One scope's answer, in the order the scopes were asked, and what it contributed. */
export interface TraceEntry<S = unknown, D = unknown> {
  readonly scope: Element;
  readonly disposition: Disposition;
  /**
   * The plan as the interpreter returned it, or null when it returned nothing.
   * The interpreter's own object, neither copied nor frozen: whatever else it
   * carries, a reason or a label, is read from here.
   */
  readonly plan: Plan<S, D> | null;
  /** The operations this scope proposed, frozen. Empty for a pass. */
  readonly operations: Group<S, D>;
  /** The effects this scope asked for, frozen. Empty for a pass. */
  readonly effects: readonly EffectRequest[];
}

/**
 * An intent interpreted and checked, and not run: exactly what `intent` would
 * do next. Good for the tree as it stands; ask again after anything changes.
 */
export interface Interpretation<A = unknown, S = unknown, D = unknown> extends Intent<A> {
  readonly disposition: 'consumed' | 'passed';
  /** Every scope above the source, nearest first, whether or not it answered. */
  readonly route: readonly Element[];
  readonly trace: readonly TraceEntry<S, D>[];
  /** The whole sequence, dry run and checked for ownership, frozen and not applied. */
  readonly operations: Group<S, D>;
  /** The effect requests, in plan order. None has run. */
  readonly effects: readonly EffectRequest[];
}

/** What became of one effect request. A promise is a result, not awaited. */
export interface EffectResult {
  readonly type: string;
  readonly status: 'done' | 'failed';
  readonly result?: unknown;
  readonly error?: Error;
}

/** What an intent did: who answered, what ran, what became of the effects. */
export interface Result<S = unknown, D = unknown> {
  readonly id: number;
  readonly disposition: 'consumed' | 'passed';
  readonly route: readonly Element[];
  readonly trace: readonly TraceEntry<S, D>[];
  /** The frozen validated sequence, already applied. */
  readonly operations: Group<S, D>;
  readonly effects: readonly EffectResult[];
}

/** Registers a scope on an element; a second scope over the same element throws. */
export function scope(element: Element): Scope;

/**
 * The half of `intent` that writes nothing: takes the route, asks the
 * interpreters under the guard, dry runs their operations as one sequence and
 * asks which region would run each. Returns all of it frozen and runs none of
 * it. Every interpretation takes an id, raised or not.
 */
export function interpret<A = unknown, S = unknown, D = unknown>(source: Element, type: string, args?: A): Interpretation<A, S, D>;

/**
 * Raises an intent from a connected element: `interpret`, then the operations
 * are executed through the regions that own them and the effects run afterwards
 * in plan order.
 *
 * An operation that fails throws with `committed` set to how many of the plan's
 * operations ran; the ones before it stay applied.
 */
export function intent<A = unknown, S = unknown, D = unknown>(source: Element, type: string, args?: A): Result<S, D>;

/** Registers what runs one kind of effect; a second adapter for the type throws. */
export function effect<R extends EffectRequest = EffectRequest, A = unknown>(
  type: string,
  adapter: (request: R, intent: Intent<A>) => unknown,
): Off;
