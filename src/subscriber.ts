import { clone } from "./utilities/clone";
import { freeze } from "./utilities/freeze";
import { isEqual } from "./utilities/is-equal";
import { isLiteralObject } from "./utilities/object";
import { merge } from "./utilities/merge";
import { ucfirst } from "./utilities/string";
import type { Freezable, LiteralObject, PartialLiteral, ToString } from "./types";

export type SubscribeChannel = string;
export type SubcribeHandler<Payload = never> = [Payload] extends [never]
  ? () => void
  : (payload: Payload) => void;

class SubscribeListener extends Set<SubcribeHandler> {}
class SubscribeListeners extends Map<SubscribeChannel, SubscribeListener> {}

export interface Shallow {
  merge<AsType>(source: unknown, target: unknown, cloneDeep?: (data: unknown) => unknown): AsType;
  clone<DataType>(data: DataType): DataType;
  isEqual(value1: unknown, value2: unknown): boolean;
}

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

  private _shallow: Shallow = {
    merge,
    clone,
    isEqual,
  };

  readonly _events = freeze(defaultEvents) as Freezable<DefaultEvents & Events>;

  get shallow(): Freezable<Shallow> {
    return freeze({
      merge: this._shallow.merge,
      clone: this._shallow.clone,
      isEqual: this._shallow.isEqual,
    });
  }

  set shallow(shallow: Shallow | Partial<Shallow>) {
    this._shallow = this._shallow.merge(this._shallow, shallow);
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
   */
  setState(state: State | PartialLiteral<State>) {
    const nextState = this._shallow.merge<State>(this._state, state);

    if (!this._shallow.isEqual(this._state, nextState)) {
      this._state = nextState;
      this.dispatch(this._events.state.change, this._shallow.clone(nextState));
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
