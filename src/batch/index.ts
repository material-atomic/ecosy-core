/**
 * Items gathered for a moment, then handled together.
 *
 * Not re-exported from the package index — reach it by subpath:
 *
 * ```ts
 * import { Batch } from "@ecosy/core/batch";
 * export const AppBatch = Batch({ window: 10, max: 100 });
 * ```
 */

import type { ClassType, Promisable } from "../types";
import { globalState } from "../utilities/global-state";

export interface BatchOptions {
  /**
   * Milliseconds to keep gathering after the first item of a group arrives.
   * `0` — the default — gathers what arrives in the same turn of the event
   * loop, adding next to no delay.
   */
  window?: number;
  /** Items after which a group is flushed without waiting for the window. `0` or absent: no limit. */
  max?: number;
  /** Shares the groups on `globalThis` under this name. See `QueueOptions.storageKey`. */
  storageKey?: string;
}

export interface BatchHandler<Item, Result = void> {
  /**
   * Handles a group's items, in the order they were added. Resolve with one
   * result per item, in the same order, to hand each caller its own; resolve
   * with nothing and every caller gets `undefined`. A throw rejects every
   * caller in the flush.
   */
  flush(items: Item[]): Promisable<Result[] | void>;
}

export interface BatchToken {
  /**
   * Adds an item to `group`, flushing the group's items together once the
   * window closes or `max` is reached. The handler of the first item added to a
   * gathering group is the one that flushes it.
   *
   * @returns This item's result, once its flush has finished.
   */
  add<Item, Result = void>(group: string, item: Item, handler: BatchHandler<Item, Result>): Promise<Result | undefined>;

  /**
   * Resolves once every item added to `group` up to this call has been
   * flushed, however the flush ended. Never rejects.
   */
  pending(group: string): Promise<void>;

  /** Flushes `group` now instead of waiting for its window. Resolves when that flush has finished. */
  flush(group: string): Promise<void>;
}

export type BatchClass = ClassType<BatchToken>;

interface Waiter {
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

interface Gathering {
  items: unknown[];
  waiters: Waiter[];
  handler: BatchHandler<unknown, unknown>;
  timer: ReturnType<typeof setTimeout> | null;
  /** Settles when this gathering has been flushed. */
  done: Promise<void>;
  finish(): void;
}

/**
 * Builds a batch token class.
 *
 * Like `Queue`, the state lives with the class, not its instances: every
 * `new AppBatch()` gathers into the same groups. Anchor the class with
 * `@ecosy/anchor` where a module is evaluated more than once.
 */
export function Batch(options: BatchOptions = {}): BatchClass {
  const windowMs = options.window ?? 0;
  const max = options.max ?? 0;

  if (!(windowMs >= 0)) throw new TypeError("[ecosy/batch] window must be 0 or more");
  if (!(max >= 0)) throw new TypeError("[ecosy/batch] max must be 0 or more");

  const { gathering, flushing } = globalState("batch", options.storageKey, () => ({
    gathering: new Map<string, Gathering>(),
    /** Flushes started but not finished, per group — what `pending` also waits for. */
    flushing: new Map<string, Set<Promise<void>>>(),
  }));

  const run = (group: string, batch: Gathering): Promise<void> => {
    if (gathering.get(group) === batch) gathering.delete(group);
    if (batch.timer) clearTimeout(batch.timer);

    const inFlight = (async () => {
      try {
        const results = await batch.handler.flush(batch.items);
        batch.waiters.forEach((waiter, index) => waiter.resolve(Array.isArray(results) ? results[index] : undefined));
      } catch (error) {
        batch.waiters.forEach((waiter) => waiter.reject(error));
      } finally {
        batch.finish();
      }
    })();

    let set = flushing.get(group);
    if (!set) {
      set = new Set();
      flushing.set(group, set);
    }
    set.add(inFlight);

    void inFlight.then(() => {
      set!.delete(inFlight);
      if (set!.size === 0 && flushing.get(group) === set) flushing.delete(group);
    });

    return inFlight;
  };

  return class BatchImpl implements BatchToken {
    add<Item, Result = void>(group: string, item: Item, handler: BatchHandler<Item, Result>): Promise<Result | undefined> {
      let batch = gathering.get(group);

      if (!batch) {
        let finish!: () => void;
        const done = new Promise<void>((resolve) => (finish = resolve));
        const created: Gathering = {
          items: [],
          waiters: [],
          handler: handler as BatchHandler<unknown, unknown>,
          timer: null,
          done,
          finish,
        };
        batch = created;
        gathering.set(group, created);

        if (windowMs > 0) {
          created.timer = setTimeout(() => void run(group, created), windowMs);
        } else {
          queueMicrotask(() => {
            if (gathering.get(group) === created) void run(group, created);
          });
        }
      }

      const result = new Promise<Result | undefined>((resolve, reject) => {
        batch!.waiters.push({ resolve: resolve as (value: unknown) => void, reject });
      });

      batch.items.push(item);

      if (max > 0 && batch.items.length >= max) {
        void run(group, batch);
      }

      return result;
    }

    pending(group: string): Promise<void> {
      const waits: Promise<void>[] = [...(flushing.get(group) ?? [])];
      const batch = gathering.get(group);
      if (batch) waits.push(batch.done);
      return Promise.all(waits).then(() => undefined);
    }

    flush(group: string): Promise<void> {
      const batch = gathering.get(group);
      return batch ? run(group, batch) : Promise.resolve();
    }
  };
}
