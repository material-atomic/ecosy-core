import { isLiteralObject } from "./utilities/object";

export type EnvSource = Record<string, string | undefined>;

/**
 * Returns an env source object for the current runtime.
 * Called once per `getEnv` invocation to resolve the global source.
 */
export type EnvGetter = () => EnvSource;

/** Default getter: process.env → import.meta.env → {} */
function defaultGetter(): EnvSource {
  if (typeof globalThis !== "undefined" && "process" in globalThis) {
    const proc = (globalThis as unknown as Record<string, unknown>).process as
      | { env?: EnvSource }
      | undefined;
    if (proc?.env && isLiteralObject(proc.env)) {
      return proc.env;
    }
  }

  try {
    const metaEnv = (import.meta as unknown as Record<string, unknown>).env;
    if (metaEnv && isLiteralObject(metaEnv)) {
      return metaEnv as EnvSource;
    }
  } catch {
    // import.meta may not be available in all environments
  }

  return {};
}

/**
 * Read an environment variable across runtimes.
 *
 * @example
 * ```ts
 * // Basic — uses getter (default: process.env → import.meta.env)
 * getEnv("API_URL", "/api")
 *
 * // Per-call source (e.g. Hono ctx.env)
 * getEnv("API_URL", "/api", ctx.env)
 *
 * // Custom getter for a specific runtime
 * getEnv.getter(() => Deno.env.toObject());
 * ```
 */
export function getEnv(
  key: string,
  defaultValue?: string,
  ...sources: Array<EnvSource | undefined>
): string | undefined {
  // 1. Per-call sources (most specific)
  for (const source of sources) {
    if (source && key in source && source[key] !== undefined) {
      return source[key];
    }
  }

  // 2. Global source from getter
  const env = getEnv._getter();
  if (key in env && env[key] !== undefined) {
    return env[key];
  }

  return defaultValue;
}

getEnv._getter = defaultGetter as EnvGetter;

/** Register a custom getter that returns the env source object. */
getEnv.getter = (fn: EnvGetter) => {
  getEnv._getter = fn;
};
