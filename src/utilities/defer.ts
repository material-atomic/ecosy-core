type Timeout = ReturnType<typeof setTimeout>;

/** Callback function for {@link defer}. */
export type DeferCallback = () => void;

/** Internal timer IDs used by {@link defer} for cancellation. */
export type DeferIds = {
  /** `requestAnimationFrame` ID. */
  r: number | null;
  /** `setTimeout` ID. */
  s: Timeout | null;
};

/**
 * Schedules a callback using `requestAnimationFrame` + `setTimeout` for optimal
 * browser execution timing. Falls back to plain `setTimeout` in non-browser environments.
 *
 * @param callback - Function to execute after the defer.
 * @param delay - Additional delay in milliseconds after the animation frame. Defaults to `0`.
 * @returns An object with `ids` (internal timer IDs) and a `cancel` function.
 *
 * @example
 * ```ts
 * const { cancel } = defer(() => console.log("done"), 100);
 * // Later:
 * cancel(); // Cancels if not yet executed
 * ```
 */
export function defer(callback: DeferCallback, delay?: number) {
  const ids: DeferIds = { r: null, s: null };
  const timeout = Math.max(0, delay || 0);

  function cancel() {
    ids.r && typeof cancelAnimationFrame === "function" && cancelAnimationFrame(ids.r);
    ids.s && clearTimeout(ids.s);
    ids.r = null;
    ids.s = null;
  }

  if (typeof requestAnimationFrame === "function") {
    ids.r = requestAnimationFrame(() => {
      ids.s = setTimeout(() => {
        callback();
        cancel();
      }, timeout);
    });
  } else {
    ids.s = setTimeout(() => {
      callback();
      cancel();
    }, timeout);
  }

  return { ids, cancel };
}

/** A `Promise<void>` with an attached `cancel` method. */
export interface CancelablePromise extends Promise<void> {
  /** Cancels the pending defer, preventing the promise from resolving. */
  cancel: () => void;
}

/**
 * Promise-based wrapper around {@link defer}.
 * Resolves after the specified delay, and can be cancelled before resolution.
 *
 * @param delay - Delay in milliseconds. Defaults to `0`.
 * @returns A {@link CancelablePromise} that resolves when the defer completes.
 *
 * @example
 * ```ts
 * const wait = deferAsync(500);
 * await wait; // Resolves after ~500ms
 *
 * // Or cancel early:
 * const wait2 = deferAsync(5000);
 * wait2.cancel();
 * ```
 */
export function deferAsync(delay?: number): CancelablePromise {
  let cancelRef: () => void;

  const promise = new Promise<void>((resolve) => {
    // Leverage the core defer function above
    const { cancel } = defer(() => resolve(), delay);
    cancelRef = cancel;
  }) as CancelablePromise;

  // Attach the cancel method directly onto the Promise object
  promise.cancel = () => {
    cancelRef();
  };

  return promise;
}
