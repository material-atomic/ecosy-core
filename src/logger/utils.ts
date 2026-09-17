/* eslint-disable @typescript-eslint/no-explicit-any */

let cachedHostname: string | undefined;

/**
 * The host this process is running on, or the page's host in a browser.
 *
 * `require("os")` cannot be called directly: this package ships an ESM build
 * as well, and `require` does not exist there — reaching for it threw a
 * ReferenceError out of every formatter that stamps a host, which is all of
 * them but TEXT, CEF and LEEF. `typeof` on an undeclared identifier is safe in
 * both module systems, so the call is guarded and falls back to the
 * environment when there is no `require` to use.
 */
export const getHostname = (): string => {
  if (typeof window !== "undefined") return window.location.hostname;
  if (cachedHostname) return cachedHostname;

  try {
    const req: any = typeof require === "function" ? require : undefined;
    cachedHostname = req?.("os")?.hostname?.();
  } catch {
    /* No CJS require, or `os` unavailable — a worker or an edge runtime. */
  }

  if (!cachedHostname) {
    const env = typeof process !== "undefined" ? process.env : undefined;
    cachedHostname = env?.HOSTNAME || env?.COMPUTERNAME || "localhost";
  }

  return cachedHostname;
};

export const parseArgs = (args: any[]) => {
  const summary = typeof args[0] === "string" ? args[0] : JSON.stringify(args[0]);
  return { summary, full: args.length > 1 ? JSON.stringify(args) : summary };
};
