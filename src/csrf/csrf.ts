import { AesGcm } from "../crypt/aes";
import { ensureCrypt } from "../crypt/assert";
import { fromBase64Url, randomBytes, toBase64Url, utf8 } from "../crypt/encoding";
import type { CryptToken, CryptTokenClass } from "../crypt/types";
import type { CookieJar, CookieOptions } from "../session/types";
import type { ClassType, Promisable } from "../types";

/** Console-shaped; only `warn` is used. */
export interface CsrfLogger {
  warn(...args: unknown[]): void;
}

/**
 * Spends a token's nonce, so the token works once. Must be an atomic
 * insert-if-absent — a unique constraint, `SET NX` — and, with more than one
 * instance, in storage they share. Resolve `true` when this call spent it,
 * `false` when it was already spent.
 *
 * The alternative, usually better: take the nonce from `verify` and store it
 * inside the write the form performs, under a unique constraint. Then the token
 * is spent only if the action succeeds, and a double submit makes one result.
 */
export type CsrfClaim = (nonce: string, expiresAt: number) => Promisable<boolean>;

export interface CsrfOptions {
  /** Crypt token. Defaults to `AesGcm()` — a generated key, with its warning. */
  encrypt?: CryptTokenClass;
  /** Milliseconds a form or request token stays valid. Default 2 hours. */
  maxAge?: number;
  /** Other origins allowed to send state-changing requests, e.g. `"https://admin.example.com"`. */
  trustedOrigins?: readonly string[];
  /**
   * Origins whose requests are the app's own front end, and therefore carry a
   * session cookie and need a CSRF token — this app's origin and any listed
   * here. Everything else is an API client: it has no cookie to abuse, so
   * {@link CsrfToken.check} lets it through, the way Sanctum separates
   * stateful front-end requests from token-authenticated ones.
   *
   * Absent, every request is treated as the front end's.
   */
  statefulOrigins?: readonly string[];
  /** Accept `Sec-Fetch-Site: same-site` — sibling subdomains. Default `false`. */
  allowSameSite?: boolean;
  /**
   * Take the expected origin from `X-Forwarded-Proto` / `X-Forwarded-Host`.
   * Only behind a proxy you control that sets them — otherwise a client does.
   * Default `false`.
   */
  trustProxy?: boolean;
  /**
   * Cookies are `Secure` and named with the `__Host-` prefix. Default `true`;
   * pass `false` for development over plain HTTP, where a browser refuses both.
   */
  secure?: boolean;
  /** Spends nonces on `verify`, for single-use tokens. See {@link CsrfClaim}. */
  claim?: CsrfClaim;
  /** The cookie and header a script uses, Laravel/axios style. */
  xsrf?: {
    /** Cookie name. Readable by scripts on purpose. Default `"XSRF-TOKEN"`. */
    cookie?: string;
    /** Header the script sends it back in. Default `"x-xsrf-token"`. */
    header?: string;
  };
  login?: {
    /** Cookie name, before any `__Host-` prefix. Default `"csrf_login"`. */
    cookie?: string;
    /** Milliseconds. Default 1 hour. */
    maxAge?: number;
  };
  oauth?: {
    /** Cookie name, before any `__Host-` prefix. Default `"oauth_state"`. */
    cookie?: string;
    /**
     * Path the cookie is sent to — the callback's, ideally. A path other than
     * `/` gives up the `__Host-` prefix, which requires `/`. Default `"/"`.
     */
    path?: string;
    /** Milliseconds. Default 10 minutes. */
    maxAge?: number;
    /** `returnTo` paths refused on top of the built-in rules, e.g. `/^\/(api|login|logout)(\/|$)/`. */
    deny?: RegExp;
  };
  logger?: CsrfLogger;
}

export interface CsrfIssueOptions {
  /**
   * Who the token is for: a session id, a user id, anything the verifying side
   * can name again. A token for one binding fails for every other.
   *
   * A user id outlives sessions — a token bound to it still works after a
   * logout, until it expires. Pair it with a short `maxAge` or single use.
   */
  bind: string;
  /** What the token is for — `"change-email"`. Separate keys per purpose: one form's token is refused by another. */
  purpose: string;
  /** Milliseconds, overriding the default. */
  maxAge?: number;
}

export interface CsrfVerifyOptions {
  bind: string;
  purpose: string;
  /** Overrides {@link CsrfOptions.claim} for this call. `null` turns it off. */
  claim?: CsrfClaim | null;
}

/** What {@link CsrfToken.check} needs: a binding, and where to find the token. */
export interface CsrfCheckOptions extends CsrfReadOptions {
  bind: string;
  /** Defaults to what {@link CsrfToken.cookie} issues. */
  purpose?: string;
  claim?: CsrfClaim | null;
}

export interface CsrfVerified {
  /** Unique per token. Store it under a unique constraint to spend the token with the action. */
  nonce: string;
  expiresAt: number;
}

export interface CsrfReadOptions {
  /** Form field. Default `"_csrf"`. */
  field?: string;
  /** Header, in front of the `xsrf` header, which is read either way. Default `"x-csrf-token"`. */
  header?: string;
  /** Bodies declared larger than this are not read for a token. Default 1 MiB. */
  maxBytes?: number;
}

export interface OAuthStart {
  /** For the provider's `state` parameter. */
  state: string;
  /** For `code_challenge`. */
  codeChallenge: string;
  codeChallengeMethod: "S256";
  /** For OpenID Connect's `nonce`. */
  nonce: string;
}

export interface OAuthFinish {
  /** Where to go afterwards: a path on this app, never another site. */
  returnTo: string;
  /** For the code exchange. */
  codeVerifier: string;
  /** Must match the `nonce` inside the id_token. */
  nonce: string;
}

export interface CsrfToken {
  /**
   * Whether a request may change state, judged from `Sec-Fetch-Site`, then
   * `Origin`, then `Referer`. Needs no token and no secret. Safe methods pass,
   * as does a request carrying `Authorization` — another site cannot attach
   * that header. A request with none of the three headers passes too: that is
   * not a browser, and CSRF is an attack through a browser.
   */
  origin(request: Request): boolean;

  /** A token for a form or a script to send back. */
  issue(options: CsrfIssueOptions): Promise<string>;

  /** The token's nonce when it is valid for this binding and purpose, not expired and — with `claim` — not yet spent. */
  verify(token: string | null | undefined, options: CsrfVerifyOptions): Promise<CsrfVerified | null>;

  /**
   * The token a request carries: the headers first (`X-CSRF-Token`, then the
   * `xsrf` one), then the form field of a urlencoded or multipart body. Reads
   * a clone, so the body stays readable.
   */
  read(request: Request, options?: CsrfReadOptions): Promise<string | null>;

  /**
   * Whether this request comes from the app's own front end — the one kind
   * that carries cookies and so needs a token. See
   * {@link CsrfOptions.statefulOrigins}.
   */
  stateful(request: Request): boolean;

  /**
   * Hands the browser a token in a cookie a script can read, to send back in
   * the `xsrf` header. One call before the first write — the front end's
   * equivalent of Sanctum's `/sanctum/csrf-cookie`.
   *
   * Bind it to something the browser keeps: a session id, which means the
   * session must exist — `session.start()` — before this is called.
   *
   * @returns The token, also for rendering into a form.
   */
  cookie(jar: CookieJar, options: { bind: string; maxAge?: number }): Promise<string>;

  /**
   * The whole check for one request, in order: a safe method passes; a request
   * that is not the front end's passes; the origin must hold; then the token
   * from header or form must verify.
   *
   * `purpose` defaults to the one {@link CsrfToken.cookie} issues, so a form
   * with a purpose of its own names it here.
   */
  check(request: Request, options: CsrfCheckOptions): Promise<boolean>;

  readonly login: {
    /** Before sign-in: a browser-bound nonce cookie, and a token for the login form bound to it. */
    start(jar: CookieJar): Promise<string>;
    /** Whether the login form's token belongs to this browser. */
    verify(jar: CookieJar, token: string | null | undefined): Promise<boolean>;
    /** After sign-in: drops the nonce cookie. Rotate the session too — `session.regenerate()`. */
    finish(jar: CookieJar): Promise<void>;
  };

  readonly oauth: {
    /** A sign-in's state, PKCE challenge and nonce, bound to this browser by a cookie. */
    start(jar: CookieJar, options?: { returnTo?: string }): Promise<OAuthStart>;
    /**
     * The sign-in a callback belongs to, or `null` when the state was not issued
     * here, expired, was altered, or was started in another browser. The cookie
     * is dropped either way.
     */
    finish(jar: CookieJar, state: string | null | undefined): Promise<OAuthFinish | null>;
  };
}

export type CsrfClass = ClassType<CsrfToken>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);
/** What `cookie` issues and `check` verifies when no purpose is named. */
export const REQUEST_PURPOSE = "request";
const PURPOSE = {
  token: (purpose: string) => `@ecosy/csrf:token:${purpose}`,
  oauthState: "@ecosy/csrf:oauth:state",
  oauthCookie: "@ecosy/csrf:oauth:cookie",
} as const;

async function sha256(text: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(text))));
}

/**
 * Where a sign-in may send you afterwards: a path on this app, never another
 * site. Anything else — an absolute URL, `//host`, `/\host`, something that
 * does not parse — is `/`.
 */
export function safeReturnTo(value: string | null | undefined, deny?: RegExp): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";

  let url: URL;
  try {
    url = new URL(value, "http://return.invalid");
  } catch {
    return "/";
  }

  if (url.origin !== "http://return.invalid") return "/";
  if (deny?.test(url.pathname)) return "/";

  return url.pathname + url.search + url.hash;
}

/**
 * Builds a CSRF token class. Framework-free: it reads a Web `Request` and
 * writes cookies through a `CookieJar`.
 *
 * ```ts
 * export const AppCsrf = Csrf({ encrypt: AppCrypt, secure: process.env.NODE_ENV === "production" });
 *
 * const csrf = new AppCsrf();
 * if (!csrf.origin(request)) return new Response(null, { status: 403 });
 * const token = await csrf.issue({ bind: session.id, purpose: "change-email" });
 * const ok = await csrf.verify(await csrf.read(request), { bind: session.id, purpose: "change-email" });
 * ```
 */
export function Csrf(options: CsrfOptions = {}): CsrfClass {
  const logger = options.logger ?? console;
  const maxAge = options.maxAge ?? 2 * 60 * 60 * 1000;
  const secure = options.secure ?? true;
  const trusted = new Set((options.trustedOrigins ?? []).map((origin) => new URL(origin).origin));
  const loginMaxAge = options.login?.maxAge ?? 60 * 60 * 1000;
  const oauthMaxAge = options.oauth?.maxAge ?? 10 * 60 * 1000;
  const oauthPath = options.oauth?.path ?? "/";
  const xsrfCookie = options.xsrf?.cookie ?? "XSRF-TOKEN";
  const xsrfHeader = options.xsrf?.header ?? "x-xsrf-token";
  const stateful = options.statefulOrigins && new Set(options.statefulOrigins.map((origin) => new URL(origin).origin));

  if (!(maxAge > 0)) throw new TypeError("[ecosy/csrf] maxAge must be positive");

  const cookieName = (base: string, path = "/") => (secure && path === "/" ? `__Host-${base}` : base);
  const loginCookie = cookieName(options.login?.cookie ?? "csrf_login");
  const oauthCookie = cookieName(options.oauth?.cookie ?? "oauth_state", oauthPath);

  const cookieOptions = (path: string, ms: number): CookieOptions => ({
    httpOnly: true,
    sameSite: "lax",
    path,
    secure,
    maxAge: Math.floor(ms / 1000),
  });

  const CryptClass = options.encrypt ?? AesGcm({ logger });
  let crypt: CryptToken | null = null;
  let checked: Promise<void> | null = null;

  const cryptReady = async () => {
    crypt ??= new CryptClass();
    checked ??= ensureCrypt(crypt, logger);
    await checked;
    return crypt;
  };

  const expectedOrigin = (request: Request): string | null => {
    try {
      const url = new URL(request.url);
      if (!options.trustProxy) return url.origin;
      const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
      const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
      return `${proto}://${host}`;
    } catch {
      return null;
    }
  };

  const originAllowed = (value: string, request: Request) => {
    let origin: string;
    try {
      origin = new URL(value).origin;
    } catch {
      return false;
    }
    return origin === expectedOrigin(request) || trusted.has(origin);
  };

  const requireText = (value: unknown, name: string) => {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`[ecosy/csrf] a non-empty \`${name}\` is required`);
    }
    return value;
  };

  const issue = async ({ bind, purpose, maxAge: override }: CsrfIssueOptions) => {
    requireText(bind, "bind");
    requireText(purpose, "purpose");
    const token = await cryptReady();
    const nonce = toBase64Url(randomBytes(18));
    const expires = (Date.now() + (override ?? maxAge)).toString(36);
    const signature = await token.sign(JSON.stringify([bind, nonce, expires]), { purpose: PURPOSE.token(purpose) });
    return `${nonce}.${expires}.${signature}`;
  };

  const verify = async (value: string | null | undefined, verifyOptions: CsrfVerifyOptions): Promise<CsrfVerified | null> => {
    requireText(verifyOptions.bind, "bind");
    requireText(verifyOptions.purpose, "purpose");
    if (typeof value !== "string") return null;

    const first = value.indexOf(".");
    const second = value.indexOf(".", first + 1);
    if (first <= 0 || second <= first + 1) return null;

    const nonce = value.slice(0, first);
    const expires = value.slice(first + 1, second);
    const signature = value.slice(second + 1);

    const expiresAt = parseInt(expires, 36);
    if (!/^[0-9a-z]+$/.test(expires) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

    const token = await cryptReady();
    const valid = await token.verify(JSON.stringify([verifyOptions.bind, nonce, expires]), signature, {
      purpose: PURPOSE.token(verifyOptions.purpose),
    });
    if (!valid) return null;

    const claim = verifyOptions.claim === undefined ? options.claim : verifyOptions.claim;
    if (claim && !(await claim(nonce, expiresAt))) return null;

    return { nonce, expiresAt };
  };

  return class CsrfImpl implements CsrfToken {
    origin(request: Request): boolean {
      if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
      if (request.headers.has("authorization")) return true;

      const site = request.headers.get("sec-fetch-site");
      const origin = request.headers.get("origin");

      if (site) {
        if (site === "same-origin" || site === "none") return true;
        if (site === "same-site" && options.allowSameSite) return true;
        // cross-site, or same-site not allowed: only an origin trusted by name gets through.
        return origin !== null && trusted.has(safeOrigin(origin));
      }

      if (origin !== null) {
        // "null" is what sandboxed frames and some redirects send: not a place to trust.
        return origin !== "null" && originAllowed(origin, request);
      }

      const referer = request.headers.get("referer");
      if (referer) return originAllowed(referer, request);

      return true;
    }

    issue(issueOptions: CsrfIssueOptions) {
      return issue(issueOptions);
    }

    verify(value: string | null | undefined, verifyOptions: CsrfVerifyOptions) {
      return verify(value, verifyOptions);
    }

    async read(request: Request, readOptions: CsrfReadOptions = {}): Promise<string | null> {
      const header = request.headers.get(readOptions.header ?? "x-csrf-token") ?? request.headers.get(xsrfHeader);
      if (header) return header;

      const type = request.headers.get("content-type") ?? "";
      if (!type.startsWith("application/x-www-form-urlencoded") && !type.startsWith("multipart/form-data")) return null;

      const declared = Number(request.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > (readOptions.maxBytes ?? 1024 * 1024)) return null;

      try {
        const value = (await request.clone().formData()).get(readOptions.field ?? "_csrf");
        return typeof value === "string" ? value : null;
      } catch {
        return null;
      }
    }

    stateful(request: Request): boolean {
      if (!stateful) return true;
      if (request.headers.has("authorization")) return false;

      const from = request.headers.get("origin") ?? request.headers.get("referer");
      if (!from) return request.headers.get("sec-fetch-site") === "same-origin";

      const origin = safeOrigin(from);
      return origin === expectedOrigin(request) || stateful.has(origin);
    }

    async cookie(jar: CookieJar, cookieOptions_: { bind: string; maxAge?: number }): Promise<string> {
      const token = await issue({ bind: cookieOptions_.bind, purpose: REQUEST_PURPOSE, maxAge: cookieOptions_.maxAge });
      /* Readable by scripts on purpose: the front end reads it here and sends
         it back in a header, which another site cannot do. */
      await jar.set(xsrfCookie, token, { ...cookieOptions("/", cookieOptions_.maxAge ?? maxAge), httpOnly: false });
      return token;
    }

    async check(request: Request, checkOptions: CsrfCheckOptions): Promise<boolean> {
      if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
      if (!this.stateful(request)) return true;
      if (!this.origin(request)) return false;

      const token = await this.read(request, checkOptions);
      const verified = await verify(token, { ...checkOptions, purpose: checkOptions.purpose ?? REQUEST_PURPOSE });
      return verified !== null;
    }

    readonly login = {
      async start(jar: CookieJar): Promise<string> {
        let nonce = jar.get(loginCookie);
        if (!nonce || !fromBase64Url(nonce) || nonce.length < 32) {
          nonce = toBase64Url(randomBytes(24));
          await jar.set(loginCookie, nonce, cookieOptions("/", loginMaxAge));
        }
        return issue({ bind: nonce, purpose: "@ecosy/csrf:login", maxAge: loginMaxAge });
      },

      async verify(jar: CookieJar, token: string | null | undefined): Promise<boolean> {
        const nonce = jar.get(loginCookie);
        if (!nonce) return false;
        return (await verify(token, { bind: nonce, purpose: "@ecosy/csrf:login", claim: null })) !== null;
      },

      async finish(jar: CookieJar): Promise<void> {
        await jar.delete(loginCookie, { ...cookieOptions("/", 0), maxAge: 0 });
      },
    };

    readonly oauth = {
      async start(jar: CookieJar, startOptions: { returnTo?: string } = {}): Promise<OAuthStart> {
        const token = await cryptReady();
        const binding = toBase64Url(randomBytes(32));
        const verifier = toBase64Url(randomBytes(32));
        const nonce = toBase64Url(randomBytes(32));

        const payload = toBase64Url(
          utf8(
            JSON.stringify({
              b: await sha256(binding),
              r: safeReturnTo(startOptions.returnTo, options.oauth?.deny),
              e: Date.now() + oauthMaxAge,
            }),
          ),
        );
        const state = `${payload}.${await token.sign(payload, { purpose: PURPOSE.oauthState })}`;

        const sealed = await token.encrypt(JSON.stringify({ b: binding, v: verifier, n: nonce }), {
          purpose: PURPOSE.oauthCookie,
        });
        await jar.set(oauthCookie, sealed, cookieOptions(oauthPath, oauthMaxAge));

        return { state, codeChallenge: await sha256(verifier), codeChallengeMethod: "S256", nonce };
      },

      async finish(jar: CookieJar, state: string | null | undefined): Promise<OAuthFinish | null> {
        const sealed = jar.get(oauthCookie);
        // Spent on first sight, whatever happens next: a state works once.
        await jar.delete(oauthCookie, { ...cookieOptions(oauthPath, 0), maxAge: 0 });

        if (!sealed || typeof state !== "string") return null;

        const dot = state.indexOf(".");
        if (dot <= 0) return null;
        const payload = state.slice(0, dot);

        const token = await cryptReady();
        if (!(await token.verify(payload, state.slice(dot + 1), { purpose: PURPOSE.oauthState }))) return null;

        const opened = await token.decrypt(sealed, { purpose: PURPOSE.oauthCookie });
        if (opened === null) return null;

        let claims: { b?: unknown; r?: unknown; e?: unknown };
        let stored: { b?: unknown; v?: unknown; n?: unknown };
        try {
          const bytes = fromBase64Url(payload);
          if (!bytes) return null;
          claims = JSON.parse(new TextDecoder().decode(bytes));
          stored = JSON.parse(opened);
        } catch {
          return null;
        }

        if (typeof claims?.b !== "string" || typeof claims.r !== "string" || typeof claims.e !== "number") return null;
        if (typeof stored?.b !== "string" || typeof stored.v !== "string" || typeof stored.n !== "string") return null;
        if (claims.e <= Date.now()) return null;
        if ((await sha256(stored.b)) !== claims.b) return null;

        return { returnTo: safeReturnTo(claims.r, options.oauth?.deny), codeVerifier: stored.v, nonce: stored.n };
      },
    };
  };
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}
