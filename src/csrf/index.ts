/**
 * CSRF protection: an origin check that needs nothing, signed tokens for forms
 * and scripts, and the two flows that happen before there is a session to bind
 * to — login and OAuth.
 *
 * Framework-free — a Web `Request` in, cookies through a `CookieJar`. Not
 * re-exported from the package index — reach it by subpath:
 *
 * ```ts
 * import { Csrf } from "@ecosy/core/csrf";
 * ```
 */

export {
  Csrf,
  safeReturnTo,
  type CsrfClaim,
  type CsrfClass,
  type CsrfIssueOptions,
  type CsrfLogger,
  type CsrfOptions,
  type CsrfReadOptions,
  type CsrfToken,
  type CsrfVerified,
  type CsrfVerifyOptions,
  type OAuthFinish,
  type OAuthStart,
} from "./csrf";
export type { CookieJar, CookieOptions } from "../session/types";
