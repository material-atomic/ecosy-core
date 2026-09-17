/**
 * Work run one at a time per key.
 *
 * Not re-exported from the package index — reach it by subpath:
 *
 * ```ts
 * import { Queue } from "@ecosy/core/queue";
 * export const AppQueue = Queue({ timeout: 5_000, retry: 2 });
 * ```
 */

import type { ClassType, Promisable } from "../types";
import { globalState } from "../utilities/global-state";

export interface QueueOptions {
  /**
   * Milliseconds a task may run, counted from when it starts — time spent
   * waiting behind other tasks does not count — before its caller is rejected
   * with {@link QueueTimeoutError}. The key stays held until the task really ends —
   * a function already running cannot be stopped, and letting the next task
   * start beside it is exactly the overlap a queue exists to prevent.
   * `0` or absent waits as long as it takes.
   */
  timeout?: number;
  /** Further attempts after a task throws. Not after a timeout — that task is still running. Default 0. */
  retry?: number;
  /** Milliseconds before attempt `attempt + 1`. Default `min(2^attempt × 1000, 30 000)`. */
  backoff?: (attempt: number) => number;
  /**
   * Shares the lanes on `globalThis` under this name, so every copy of the
   * module — one per Next layer, say — queues in the same lanes. Without it the
   * lanes belong to the class; anchoring the class shares them just as well.
   */
  storageKey?: string;
}

export interface QueueToken {
  /**
   * Runs `task` after every task already queued under `key`, and before any
   * queued after it. Tasks under different keys run side by side.
   *
   * @returns What `task` returns, or its error after the last attempt.
   */
  run<Result>(key: string, task: () => Promisable<Result>): Promise<Result>;

  /**
   * Resolves once every task queued under `key` up to this call has ended,
   * however it ended. Tasks queued later are not waited for. Never rejects.
   */
  pending(key: string): Promise<void>;

  /** Tasks under `key` not yet ended, the running one included. */
  size(key: string): number;
}

export type QueueClass = ClassType<QueueToken>;

/** Rejects a caller whose task outlived {@link QueueOptions.timeout}. The task itself keeps running. */
export class QueueTimeoutError extends Error {
  constructor(
    readonly key: string,
    readonly timeout: number,
  ) {
    super(`[ecosy/queue] task under "${key}" exceeded ${timeout}ms — still running, the key stays held until it ends`);
    this.name = "QueueTimeoutError";
  }
}

const defaultBackoff = (attempt: number) => Math.min(2 ** attempt * 1000, 30_000);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Lane {
  /** Settles when the last task queued under this key has really ended. */
  tail: Promise<void>;
  size: number;
}

/**
 * Builds a queue token class.
 *
 * The lanes live with the class this returns, not with its instances, so every
 * `new AppQueue()` — one per request or one for the app — shares them. Two
 * calls to `Queue()` are two separate queues. Where one module is evaluated
 * more than once (Next evaluates a module per layer), anchor the class with
 * `@ecosy/anchor` to share one queue across them.
 */
export function Queue(options: QueueOptions = {}): QueueClass {
  const timeout = options.timeout ?? 0;
  const retry = Math.max(0, options.retry ?? 0);
  const backoff = options.backoff ?? defaultBackoff;

  if (!(timeout >= 0)) throw new TypeError("[ecosy/queue] timeout must be 0 or more");

  const lanes = globalState("queue", options.storageKey, () => new Map<string, Lane>());

  const attempt = async <Result>(task: () => Promisable<Result>): Promise<Result> => {
    for (let tries = 0; ; tries++) {
      try {
        return await task();
      } catch (error) {
        if (tries >= retry) throw error;
        await sleep(backoff(tries + 1));
      }
    }
  };

  return class QueueImpl implements QueueToken {
    run<Result>(key: string, task: () => Promisable<Result>): Promise<Result> {
      let lane = lanes.get(key);

      if (!lane) {
        lane = { tail: Promise.resolve(), size: 0 };
        lanes.set(key, lane);
      }

      const current = lane;
      current.size++;

      let started!: () => void;
      const start = new Promise<void>((resolve) => (started = resolve));

      const work = current.tail.then(() => {
        started();
        return attempt(task);
      });

      const settled = work.then(
        () => undefined,
        () => undefined,
      );

      current.tail = settled;

      void settled.then(() => {
        current.size--;
        // Nothing queued after this task: the lane can go.
        if (current.size === 0 && lanes.get(key) === current) {
          lanes.delete(key);
        }
      });

      if (!timeout) return work;

      return new Promise<Result>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let ended = false;
        void start.then(() => {
          // A task can end before this runs; no timer to leave behind then.
          if (!ended) timer = setTimeout(() => reject(new QueueTimeoutError(key, timeout)), timeout);
        });
        work.then(
          (value) => {
            ended = true;
            clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            ended = true;
            clearTimeout(timer);
            reject(error);
          },
        );
      });
    }

    pending(key: string): Promise<void> {
      return lanes.get(key)?.tail ?? Promise.resolve();
    }

    size(key: string): number {
      return lanes.get(key)?.size ?? 0;
    }
  };
}
