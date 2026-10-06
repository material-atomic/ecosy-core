import { clone } from "./utilities/clone";
import { freeze } from "./utilities/freeze";
import { isEqual } from "./utilities/is-equal";
import { isLiteralObject } from "./utilities/object";
import { merge, mergeShallow } from "./utilities/merge";
import { ucfirst } from "./utilities/string";
import type { Freezable, LiteralObject, PartialLiteral, ToString } from "./types/built-in";

export type SubscribeChannel = string;
export type SubcribeHandler<Payload = never> = [Payload] extends [never]
  ? () => void
  : (payload: Payload) => void;

class SubscribeListener extends Set<SubcribeHandler> {}
class SubscribeListeners extends Map<SubscribeChannel, SubscribeListener> {}

/**
 * How a subscriber works with its state: how a partial is merged in, how the
 * state is copied for a listener, and what counts as a change. Replace any of
 * them to change those answers — a cheaper comparison for a large state, say.
 *
 * All three are deep by default.
 */
export interface StateOps {
  merge<AsType>(source: unknown, target: unknown, cloneDeep?: (data: unknown) => unknown): AsType;
  clone<DataType>(data: DataType): DataType;
  isEqual(value1: unknown, value2: unknown): boolean;
}

/**
 * How {@link Subscriber.setState} puts a new state over the current one.
 *
 * - `"deep"` (the default): objects are merged all the way down; a key is only ever added or replaced, never
 *   removed — a partial state is enough to change one value.
 * - `"shallow"`: each top-level key given replaces the current one whole, so what a nested object no longer has is
 *   gone. For a whole new value of a key — a slice a reducer computed — where a key deleted from it must stay deleted.
 */
export type MergeMode = "deep" | "shallow";

/** Options for one {@link Subscriber.setState}. */
export interface SetStateOptions {
  merge?: MergeMode;
}

/**
 * @deprecated The old name for {@link StateOps}. Nothing about these is
 * shallow: `merge`, `clone` and `isEqual` all go all the way down.
 */
export type Shallow = StateOps;

export type ExtendedEventExpect = {
  readonly [key: string]: {
    readonly [key: string]: SubscribeChannel;
  };
};

export type WiredEventDomain<Domain extends Record<string, SubscribeChannel>> = {
  [K in keyof Domain]: <Payload>(payload?: Payload) => void;
} & {
  [K in keyof Domain as `on${Capitalize<ToString<K>>}`]: <Payload>(
    handler: SubcribeHandler<Payload>,
  ) => () => void;
};

export type WiredEvents<Events extends ExtendedEventExpect> = {
  readonly [K in keyof Events]: Readonly<WiredEventDomain<Events[K]>>;
};

const defaultEvents = freeze({
  state: {
    change: "$state:change",
  },
});

type DefaultEvents = typeof defaultEvents;

export type SubscriberInstance<
  State extends LiteralObject = LiteralObject,
  Events = {},
> = InstanceType<typeof Subscriber<State, Events>>;

/**
 * Generic pub/sub event emitter with built-in state management.
 * Provides subscribe/dispatch for arbitrary channels and state change notifications.
 *
 * @typeParam State - The shape of the internal state object.
 * @typeParam Events - Extended event definitions to wire onto the instance.
 */
export class Subscriber<State extends LiteralObject, Events = {}> {
  private _state: State = {} as State;
  private listeners = new SubscribeListeners();

  private _ops: StateOps = {
    merge,
    clone,
    isEqual,
  };

  readonly _events = freeze(defaultEvents) as Freezable<DefaultEvents & Events>;

  /** {@link StateOps} in use. Assign a partial to replace some of them. */
  get ops(): Freezable<StateOps> {
    return freeze({
      merge: this._ops.merge,
      clone: this._ops.clone,
      isEqual: this._ops.isEqual,
    });
  }

  set ops(ops: StateOps | Partial<StateOps>) {
    this._ops = this._ops.merge(this._ops, ops);
  }

  /**
   * @deprecated Use {@link Subscriber.ops}. The name said shallow while every
   * one of these is deep; it stays as an alias so existing code keeps working.
   */
  get shallow(): Freezable<StateOps> {
    return this.ops;
  }

  set shallow(ops: StateOps | Partial<StateOps>) {
    this.ops = ops;
  }

  constructor(initialState?: State | PartialLiteral<State>, events?: Events) {
    this._state = (initialState ?? {}) as State;

    this._events = freeze({
      ...this._events,
      ...events,
    }) as Freezable<DefaultEvents & Events>;
  }

  /**
   * Subscribes a handler to a named channel.
   *
   * @param channel - The event channel name.
   * @param handler - Callback invoked when the channel is dispatched.
   * @returns An unsubscribe function.
   */
  subscribe<Payload = never>(channel: SubscribeChannel, handler: SubcribeHandler<Payload>) {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new SubscribeListener());
    }

    this.listeners.get(channel)!.add(handler as SubcribeHandler);

    return () => {
      this.listeners.get(channel)?.delete(handler as SubcribeHandler);
    };
  }

  /**
   * Dispatches a payload to all handlers subscribed to the given channel.
   *
   * @param channel - The event channel name.
   * @param payload - Optional data to pass to each handler.
   */
  dispatch<Payload = unknown>(channel: SubscribeChannel, payload?: Payload) {
    if (!this.listeners.has(channel)) {
      return;
    }

    this.listeners.get(channel)!.forEach((handler: SubcribeHandler<Payload>) => {
      const params = payload === undefined ? [] : [payload];
      handler(...(params as [Payload]));
    });
  }

  /** Returns the current state. */
  getState() {
    return this._state;
  }

  /**
   * Merges new state and dispatches a state change event if the state has changed.
   *
   * @param state - Full or partial state to merge.
   * @param options - `merge`: `"deep"` (the default, {@link StateOps.merge}) or `"shallow"`, where each top-level
   *   key given replaces the current one whole — see {@link MergeMode}.
   */
  setState(state: State | PartialLiteral<State>, options?: SetStateOptions) {
    const nextState =
      options?.merge === "shallow"
        ? mergeShallow<State>(this._state, state, this._ops.clone)
        : this._ops.merge<State>(this._state, state);

    if (!this._ops.isEqual(this._state, nextState)) {
      this._state = nextState;
      this.dispatch(this._events.state.change, this._ops.clone(nextState));
    }
  }

  /**
   * Shorthand to subscribe to state change events.
   *
   * @param handler - Callback receiving the new state.
   * @returns An unsubscribe function.
   */
  onStateChange(handler: SubcribeHandler<State>) {
    return this.subscribe(this._events.state.change, handler);
  }

  /**
   * Subscribes to a channel, resolving a Promise with the first dispatched payload.
   * Supports cancellation via an `AbortSignal`.
   *
   * @warning If the channel is never dispatched and no `AbortSignal` is provided,
   * the returned Promise will never resolve, causing a memory leak. Always pass an
   * `AbortSignal` or ensure the channel will eventually be dispatched.
   *
   * @param channel - The event channel name.
   * @param handler - Optional callback invoked on payload.
   * @param signal - Optional AbortSignal to cancel the subscription.
   * @returns A promise that resolves with the first payload dispatched to the channel.
   */
  async subscribeAsyncOnce<Payload = never>(
    channel: SubscribeChannel,
    handler?: SubcribeHandler<Payload>,
    signal?: AbortSignal,
  ) {
    let unsub: (() => void) | undefined;
    let onAbort: (() => void) | undefined;

    try {
      return await new Promise<Payload>((resolve, reject) => {
        if (signal?.aborted) {
          return reject(new Error("Operation cancelled"));
        }

        const handle = ((payload: Payload) => {
          handler?.(payload);
          resolve(payload);
        }) as SubcribeHandler<Payload>;

        unsub = this.subscribe(channel, handle);

        if (signal) {
          onAbort = () => reject(new Error("Operation cancelled"));
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    } finally {
      unsub?.();
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  /**
   * Wires event domains onto a `Subscriber` instance, creating typed dispatch and
   * listener methods (e.g. `instance.domainName.eventName()` and
   * `instance.domainName.onEventName()`).
   *
   * @param $instance - The subscriber instance to extend.
   * @param events - Event definitions mapping domain → channel names.
   * @returns The instance with wired event methods.
   */
  static wire<
    ExtendedEvents extends ExtendedEventExpect,
    State extends LiteralObject,
    Instance extends SubscriberInstance<State, ExtendedEvents>,
  >($instance: Instance, events: ExtendedEvents) {
    for (const channel in events) {
      if (channel in $instance) {
        throw new Error(`[Subscriber.wire] "${channel}" is invalid.`);
      }

      const domains = events[channel];

      if (!isLiteralObject(domains)) {
        continue;
      }

      const methods = Object.keys(domains).reduce(
        (acc, domain) => {
          const channelName = domains[domain as keyof typeof domains] as SubscribeChannel;
          acc[domain] = <Payload>(payload: Payload) => {
            $instance.dispatch(channelName, payload);
          };
          acc[`on${ucfirst(domain)}`] = <Payload>(listener: SubcribeHandler<Payload>) =>
            $instance.subscribe(channelName, listener);
          return acc;
        },
        {} as Record<string, unknown>,
      );

      Object.defineProperty($instance, channel, {
        value: freeze(methods),
        writable: false,
        enumerable: true,
        configurable: false,
      });
    }

    return $instance as Instance & Freezable<WiredEvents<ExtendedEvents>>;
  }
}
