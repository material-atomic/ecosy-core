/* eslint-disable @typescript-eslint/no-explicit-any */
import { get } from "./utilities/get";
import { getEnv } from "./env";
import { flatten } from "./utilities/flatten";
import { Serialize } from "./serialize";
import { sanitizeMime } from "./utilities/sanitize-mime";
import { isFormData, objectToFormData } from "./utilities/formdata";
import { type FileListLike, isFileList } from "./utilities/filelist";
import type { Promisable } from "./types/built-in";

// Allow XMLHttpRequest in environments that support it (browser, React Native)
declare var XMLHttpRequest: any;

/** Parse a URL string into its origin, returning `null` if the input is relative or invalid. */
function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Reserved keys that must never be honored in user-supplied query / param objects. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Keys allowed on {@link HttpRequest.fetch}. Lib-level fields
 * (`method`, `headers`, `body`, `signal`) are handled separately and
 * must not appear here — they would let a caller override what the
 * library has already decided.
 *
 * Framework-specific extensions (`next` for Next.js App Router,
 * `cf` for Cloudflare Workers, `dispatcher` for undici) are allowed
 * so apps can pass them through without the lib depending on any of
 * those runtimes.
 */
const ALLOWED_FETCH_KEYS: ReadonlySet<string> = new Set([
  "credentials",
  "cache",
  "mode",
  "redirect",
  "referrer",
  "referrerPolicy",
  "integrity",
  "keepalive",
  "priority",
  "duplex",
  "window",
  "next",
  "cf",
  "dispatcher",
]);

/** Keep only keys permitted on a fetch pass-through bag; drops the rest silently. */
function filterFetchConfigs(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(source)) {
    if (ALLOWED_FETCH_KEYS.has(key)) out[key] = source[key];
  }
  return out;
}

/** Strip prototype-pollution vectors from a plain object shallowly. */
function stripUnsafeKeys<T extends Record<string, unknown>>(source: T): T {
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key)) continue;
    out[key] = source[key];
  }
  return out as T;
}


/** Default base URL for HTTP requests, sourced from `API_URL` env variable. */
export const DEFAULT_BASE_URL = getEnv("API_URL", "/");
/** Authentication token storage key, sourced from `API_AUTH_TOKEN_KEY` env variable. */
export const API_AUTH_TOKEN_KEY = getEnv("API_AUTH_TOKEN_KEY");
/** Authentication header name, sourced from `API_AUTH_HEADER_KEY` env variable. */
export const API_AUTH_HEADER_KEY = getEnv("API_AUTH_HEADER_KEY");
/** Authentication header type prefix (e.g. "Bearer"), sourced from `API_AUTH_HEADER_TYPE` env variable. */
export const API_AUTH_HEADER_TYPE = getEnv("API_AUTH_HEADER_TYPE");

/** Supported HTTP methods. */
export enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
  PATCH = "PATCH",
  HEAD = "HEAD",
  OPTIONS = "OPTIONS",
}

/** Upload method types for {@link Http.createFactory}. */
export enum HttpUpload {
  UPLOAD = "UPLOAD",
  RELATED = "RELATED",
}

/** Accepted query parameter formats for HTTP requests. */
export type HttpQuery =
  | string
  | Record<string, string | number | boolean | undefined>
  | Array<[string, string | number | boolean | undefined]>
  | URLSearchParams;

/** Configuration object for an HTTP request. */
export interface HttpRequest<
  Body = unknown,
  Params = Record<string, unknown>,
  Query = HttpQuery,
  Headers = Record<string, string>,
> {
  method: HttpMethod;
  url: string;
  headers?: Headers;
  body?: Body;
  query?: Query;
  params?: Params;
  signal?: AbortSignal;
  /**
   * Pass-through bag for `fetch`'s `RequestInit` options that the
   * library does not manage itself (`credentials`, `cache`, `mode`,
   * `redirect`, `referrer`, `referrerPolicy`, `integrity`, `keepalive`,
   * `priority`, `duplex`) plus framework extensions (`next` on Next.js,
   * `cf` on Cloudflare Workers, `dispatcher` on undici).
   *
   * Lib-level fields (`method`, `headers`, `body`, `signal`) cannot be
   * overridden here — they are applied after this bag is spread.
   * Unknown keys are silently dropped, so a compromised caller cannot
   * smuggle arbitrary fields into `fetch`.
   */
  configs?: Record<string, unknown>;
}

/** Constructor options for {@link Http}. */
export interface HttpOptions {
  /** Base URL prepended to every relative request path. */
  baseURL?: string;
  /**
   * Additional origins (besides `baseURL`'s origin) that absolute URLs
   * and redirect responses are permitted to reach. Any other origin is
   * rejected before the request is sent and, for redirects, before the
   * response body is returned.
   */
  allowedOrigins?: ReadonlyArray<string>;
  /**
   * Default `configs` merged into every request sent through this
   * instance. Same shape and allowlist as {@link HttpRequest.configs}:
   * `credentials`, `cache`, `mode`, `redirect`, `referrer`,
   * `referrerPolicy`, `integrity`, `keepalive`, `priority`, `duplex`,
   * plus framework extensions (`next`, `cf`, `dispatcher`). Per-call
   * `configs` override these.
   */
  configs?: Record<string, unknown>;
}

/** Storage adapter interface for reading/writing auth tokens (e.g. `localStorage`). */
export interface HttpStorage {
  getItem(key: string): Promisable<string | null>;
  setItem(key: string, value: string): Promisable<void>;
  removeItem(key: string, options?: any): Promisable<void>;
}

/** Interceptor that can modify a request before it is sent. */
export type HttpInterceptorRequest = (options: HttpRequest) => Promise<HttpRequest> | HttpRequest;

/** Interceptor that can modify a `Response` after it is received. */
export type HttpInterceptorResponse = (response: Response) => Promise<Response> | Response;

/** Interceptor that transforms the parsed response data. */
export type HttpInterceptorTransform = (data: any) => Promise<any> | any;

/** Interceptor that handles errors from requests. */
export type HttpInterceptorError = (error: unknown) => Promise<any> | any;

/** Tuple type for registering interceptors by phase. */
export type HttpInterceptorParameters =
  | ["request", HttpInterceptorRequest]
  | ["response", HttpInterceptorResponse]
  | ["transform", HttpInterceptorTransform]
  | ["error", HttpInterceptorError];

/** Normalized response returned by all `Http` methods. */
export interface HttpResponse<T = unknown, E = unknown> {
  success: boolean;
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  error: E | null;
}

/** Upload progress snapshot. */
export interface HttpProgress {
  loaded: number;
  total: number;
  percentage: number;
}

/** Options for file upload, including progress tracking. */
export interface HttpUploadOptions extends Pick<
  HttpRequest,
  "headers" | "params" | "signal" | "query"
> {
  onProgress?: (progress: HttpProgress) => void;
  name: string;
  body?: Record<string, unknown>;
}

/** Options for a multipart/related upload (e.g. Google Drive). */
export interface HttpRelatedOptions
  extends Pick<HttpRequest, "headers" | "params" | "signal" | "query"> {
  /** JSON metadata object (will be serialized as the first part). */
  metadata: Record<string, unknown>;
  /** MIME type of the metadata part. Default: "application/json" */
  metadataMimeType?: string;
  /** MIME type of the file content. */
  contentType: string;
}

/** Options for creating an HTTP factory via {@link Http.createFactory}. */
export interface HttpFactoryOptions {
  baseURL?: string;
  http?: Http;
  storage?: HttpStorage | (() => Promise<HttpStorage> | HttpStorage);
  endpoint?: Record<string, unknown> | (() => Record<string, unknown>);
}

/** A factory-generated endpoint descriptor with a key and an async `fn`. */
export interface HttpFactory<T = unknown, Args extends any[] = [], E = unknown> {
  key: string;
  fn: (...args: Args) => Promise<HttpResponse<T, E>>;
}

// ─── Endpoint Registry ──────────────────────────────────────────

/** Central registry for grouping endpoint URLs by service name. */
export class Endpoint {
  private static registered: Record<string, Record<string, string>> = {};

  static register(service: string, endpoints: Record<string, string>) {
    this.registered[service] = { ...endpoints };
    return this;
  }

  static all() {
    return { ...this.registered };
  }
}

/**
 * HTTP client with interceptors, auth token management, file uploads,
 * and a factory pattern for endpoint generation.
 *
 * @example
 * ```ts
 * const http = new Http("https://api.example.com");
 *
 * const { data } = await http.get<User[]>("/users");
 * await http.post<User>("/users", { name: "Alice" });
 * await http.upload<Media>("/upload", file, { name: "avatar" });
 * ```
 */
export class Http {
  static readonly method = HttpMethod;
  static readonly Endpoint = Endpoint;

  static authTokenKey = "access_token";
  static authHeaderKey = "Authorization";
  static authHeaderType = "Bearer";
  static authDetectToken = ["localStorage", "sessionStorage", "cookie"];
  /**
   * One-shot headers merged into the very next request across all
   * instances, then cleared. Intended for request-scoped values like
   * CSRF tokens or correlation IDs that callers don't want to thread
   * through every call site.
   *
   * Note: this is a process-wide mutable static. In concurrent async
   * contexts (e.g. multiple tenants sharing one process) it is the
   * caller's responsibility to ensure the set → dispatch → reset
   * sequence is not interleaved.
   */
  static extraHeaders: Record<string, string> | null = null;
  static storage: HttpStorage | null = null;

  private defaultHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };

  readonly method = Http.method;
  private storage: HttpStorage | null = Http.storage;

  private static interceptors = {
    request: [] as HttpInterceptorRequest[],
    response: [] as HttpInterceptorResponse[],
    transform: [] as HttpInterceptorTransform[],
    error: [] as HttpInterceptorError[],
  };

  private interceptors = {
    request: [] as HttpInterceptorRequest[],
    response: [] as HttpInterceptorResponse[],
    transform: [] as HttpInterceptorTransform[],
    error: [] as HttpInterceptorError[],
  };

  private readonly baseURL: string;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly defaultConfigs: Record<string, unknown>;

  /**
   * @param init - Either a base URL string (backwards-compatible form)
   *   or an {@link HttpOptions} object. Using the object form lets
   *   callers opt in to additional origins that absolute URLs and
   *   redirect responses are permitted to reach. Any other origin is
   *   rejected before the request is sent and, for redirects, before
   *   the response body is returned.
   *
   * @example
   * ```ts
   * new Http("https://api.example.com");
   * new Http({
   *   baseURL: "https://api.example.com",
   *   allowedOrigins: ["https://cdn.example.com"],
   * });
   * ```
   */
  constructor(init?: string | HttpOptions) {
    const resolved: HttpOptions =
      typeof init === "string" || init === undefined
        ? { baseURL: init ?? DEFAULT_BASE_URL }
        : init;

    this.baseURL = resolved.baseURL ?? DEFAULT_BASE_URL ?? "/";

    const origins = new Set<string>();
    for (const o of resolved.allowedOrigins ?? []) {
      const origin = safeOrigin(o);
      if (!origin) throw new Error(`Http: invalid allowedOrigins entry: ${o}`);
      origins.add(origin);
    }
    const baseOrigin = safeOrigin(this.baseURL);
    if (baseOrigin) origins.add(baseOrigin);
    this.allowedOrigins = origins;

    this.defaultConfigs = resolved.configs ? filterFetchConfigs(resolved.configs) : {};
  }

  /** Whether `origin` is this instance's baseURL origin or an explicitly allowed one. */
  private isAllowedOrigin(origin: string): boolean {
    return this.allowedOrigins.size === 0 || this.allowedOrigins.has(origin);
  }

  /**
   * If a request was sent with credentials (Authorization / Cookie) and
   * ended up at a different origin via redirect, refuse to return the
   * response. Defends against token exfil via server-controlled 3xx.
   */
  private assertSameOriginResponse(
    requestURL: string,
    response: Response,
    sentHeaders: Record<string, string>,
  ): void {
    const hasAuthHeader = Object.keys(sentHeaders).some(
      (k) => k.toLowerCase() === "authorization" && !!sentHeaders[k],
    );
    const hasCookieHeader = Object.keys(sentHeaders).some(
      (k) => k.toLowerCase() === "cookie" && !!sentHeaders[k],
    );
    if (!hasAuthHeader && !hasCookieHeader) return;

    const reqOrigin = safeOrigin(requestURL);
    if (!reqOrigin) return; // relative URL — same-origin by definition

    const resOrigin = response.url ? safeOrigin(response.url) : null;
    if (!resOrigin || resOrigin === reqOrigin) return;

    if (this.isAllowedOrigin(resOrigin)) return;

    throw new Error(
      `Http: credentialed request was redirected from ${reqOrigin} to untrusted origin ${resOrigin}`,
    );
  }

  /** Register a global interceptor (applies to all `Http` instances). */
  static on(...params: HttpInterceptorParameters) {
    const [type, handler] = params;
    const registered = Http.interceptors[type] as unknown[];
    registered.includes(handler) || registered.push(handler);
    Http.interceptors[type] = registered as Array<any>;
  }

  /** Remove a global interceptor. */
  static off(...params: HttpInterceptorParameters) {
    const [type, handler] = params;
    const registered = Http.interceptors[type] as unknown[];
    Http.interceptors[type] = registered.filter((h) => h !== handler) as Array<any>;
  }

  /** Set the storage adapter for this instance (used to read auth tokens). */
  setStorage(storage: HttpStorage) {
    this.storage = storage;
  }

  /** Type guard that checks whether a value is a valid {@link HttpQuery}. */
  isValidQuery(query: unknown): query is HttpQuery {
    if (typeof query === "string" || query instanceof URLSearchParams) {
      return true;
    }

    if (Array.isArray(query)) {
      return query.every(
        (item) =>
          Array.isArray(item) &&
          item.length === 2 &&
          typeof item[0] === "string" &&
          Serialize.Primitive.isPrimitive(item[1]),
      );
    }

    if (typeof query === "object" && query !== null) {
      return Object.values(query).every((value) => Serialize.Primitive.isPrimitive(value));
    }

    return false;
  }

  getQuery<Params extends Record<string, unknown>>(options: HttpRequest<unknown, Params>): string {
    const { method, body, query } = options;

    const source = method === HttpMethod.GET && this.isValidQuery(body) ? body : query;

    if (!source || typeof source !== "object") {
      return typeof source === "string" ? source : "";
    }

    if (source instanceof URLSearchParams) {
      return source.toString();
    }

    const safe = stripUnsafeKeys(source as Record<string, unknown>);

    return Serialize.queryString.stringify(safe, {
      skipNull: true,
      skipEmptyString: true,
    });
  }

  /** Merge additional default headers into this instance. */
  addHeaders(headers: Record<string, string>) {
    this.defaultHeaders = {
      ...this.defaultHeaders,
      ...headers,
    };
  }

  /** Register an instance-level interceptor. */
  on(...params: HttpInterceptorParameters) {
    const [type, handler] = params;
    const registered = this.interceptors[type] as unknown[];
    registered.includes(handler) || registered.push(handler);
    this.interceptors[type] = registered as Array<any>;
    return this;
  }

  /** Remove an instance-level interceptor. */
  off(...params: HttpInterceptorParameters) {
    const [type, handler] = params;
    const registered = this.interceptors[type] as unknown[];
    this.interceptors[type] = registered.filter((h) => h !== handler) as Array<any>;
    return this;
  }

  /** Read the auth token from storage and format it with the configured header type. */
  async getToken() {
    const authTokenKey = API_AUTH_TOKEN_KEY || Http.authTokenKey;
    const authHeaderKey = API_AUTH_HEADER_KEY || Http.authHeaderKey;
    const authHeaderType = API_AUTH_HEADER_TYPE || Http.authHeaderType;

    if (!authTokenKey || !authHeaderKey) {
      return {
        key: authHeaderKey,
        value: "",
      };
    }

    let token = "";

    if (this.storage) {
      token = await this.storage.getItem(authTokenKey) || "";
    }

    const result = {
      key: authHeaderKey,
      value: "",
    };

    // Header values must be visible ASCII (RFC 7230 §3.2.6) and must not
    // contain CR/LF. A tampered token from storage (XSS-written) could
    // otherwise smuggle headers or force the runtime to silently drop
    // the Authorization header (fail-open).
    if (token && /^[\x21-\x7E]+$/.test(token)) {
      result.value = authHeaderType ? `${authHeaderType} ${token}` : token;
    }

    return result;
  }

  /** Build the final headers object, injecting auth token and Content-Type. */
  async getHeaders(headers: Record<string, string> = {}, isFormData?: boolean) {
    const token = await this.getToken();

    if (!(token.key in headers) || !headers[token.key]) {
      headers[token.key] = token.value;
    }

    if (isFormData && "Content-Type" in headers) {
      delete headers["Content-Type"];
    } else {
      headers["Content-Type"] =
        headers["Content-Type"] || this.defaultHeaders["Content-Type"] || "application/json";
    }

    const result = {
      ...this.defaultHeaders,
      ...headers,
      ...(Http.extraHeaders || {}),
    };

    Http.extraHeaders = null;
    return result;
  }

  /**
   * Build the full URL from base URL, path, query string, and path params.
   *
   * Security rules applied here (see SECURITY audit):
   * - Absolute URLs must use `http`/`https` and their origin must match
   *   `baseURL`'s origin or an entry in `allowedOrigins`.
   * - Protocol-relative URLs (`//host/…`) are rejected — they silently
   *   flip the target host.
   * - Path params (`{id}`) are URL-encoded by `interpolateURL`
   *   so a value of `"../admin"` cannot traverse the path.
   * - Proto-pollution keys in `params` are stripped.
   */
  getURL(options: HttpRequest): string {
    const { url = "", params = {} } = options;
    const queryString = this.getQuery(options);

    let finalURL: string;

    if (!url) {
      finalURL = this.baseURL || "/";
    } else if (url.startsWith("//")) {
      throw new Error(`Http: protocol-relative URLs are not allowed: ${url}`);
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      // Has a scheme — must be http/https and origin-allowed
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error(`Http: invalid absolute URL: ${url}`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Http: unsupported URL scheme: ${parsed.protocol}`);
      }
      if (!this.isAllowedOrigin(parsed.origin)) {
        throw new Error(
          `Http: URL origin '${parsed.origin}' is not in allowedOrigins`,
        );
      }
      finalURL = parsed.toString();
    } else {
      const base = (this.baseURL || "/").replace(/\/+$/, "");
      const cleanURL = url.replace(/^\/+/, "");
      finalURL = base ? `${base}/${cleanURL}` : `/${cleanURL}`;
    }

    if (queryString) {
      const separator = finalURL.includes("?") ? "&" : "?";
      finalURL += `${separator}${queryString}`;
    }

    if (!finalURL.includes("{") || !finalURL.includes("}")) return finalURL;

    const safeParams = Array.isArray(params)
      ? params
      : stripUnsafeKeys(params as Record<string, unknown>);

    return finalURL.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_m, variable) => {
      const value = get(safeParams, variable);
      if (value === null || value === undefined) return "";
      if (typeof value === "object") return "";
      return Serialize.URL.encode(String(value));
    });
  }

  /** Serialize the request body (JSON, FormData, or binary). Returns `undefined` for bodyless methods. */
  getBody(options: HttpRequest): string | FormData | Uint8Array | ArrayBuffer | undefined {
    const { method, body } = options;

    if (
      method === HttpMethod.GET ||
      method === HttpMethod.HEAD ||
      method === HttpMethod.OPTIONS ||
      method === HttpMethod.DELETE
    ) {
      return undefined;
    }

    if (
      (method === HttpMethod.POST || method === HttpMethod.PUT || method === HttpMethod.PATCH) &&
      isFormData(body)
    ) {
      return body;
    }

    // Allow raw binary payloads (e.g. multipart/related body)
    if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
      return body;
    }

    return body !== undefined ? JSON.stringify(body) : undefined;
  }

  /** Execute a full HTTP request with all interceptors applied. */
  async request<T = unknown, E = unknown>(options: HttpRequest): Promise<HttpResponse<T, E>> {
    const { method = HttpMethod.GET } = options;

    try {
      let modifiedOptions = { ...options };
      const allReqInterceptors = [...Http.interceptors.request, ...this.interceptors.request];

      for (const interceptor of allReqInterceptors) {
        modifiedOptions = await interceptor(modifiedOptions);
      }

      const fullURL = this.getURL(modifiedOptions);
      const requestHeaders = await this.getHeaders(modifiedOptions.headers || {});

      if (isFormData(modifiedOptions.body) && "Content-Type" in requestHeaders) {
        delete requestHeaders["Content-Type"];
      }

      const fetchConfigs = {
        ...this.defaultConfigs,
        ...(modifiedOptions.configs ? filterFetchConfigs(modifiedOptions.configs) : {}),
      };

      const response = await fetch(fullURL, {
        ...fetchConfigs,
        method: modifiedOptions.method || method,
        headers: requestHeaders,
        body: this.getBody(modifiedOptions) as BodyInit | undefined,
        signal: modifiedOptions.signal,
      });

      this.assertSameOriginResponse(fullURL, response, requestHeaders);

      const headers = response.headers;
      const contentType = headers.get("Content-Type") || "";
      let originalData: unknown = null;

      if (contentType.includes("application/json")) {
        originalData = (await response.json()) as unknown as T;
      } else {
        originalData = (await response.text()) as unknown as T;
      }

      const allTransformInterceptors = [
        ...Http.interceptors.transform,
        ...this.interceptors.transform,
      ];

      let data = originalData as T;

      for (const transform of allTransformInterceptors) {
        data = await transform(data);
      }

      const allResInterceptors = [...Http.interceptors.response, ...this.interceptors.response];

      let modifiedResponse: Response = response;

      for (const interceptor of allResInterceptors) {
        modifiedResponse = await interceptor(modifiedResponse);
      }

      const resultHeaders: Record<string, string> = {};
      modifiedResponse.headers.forEach((value, key) => {
        resultHeaders[key] = value;
      });

      const success = modifiedResponse.ok;

      let error: E | null = null;

      if (!success) {
        error = (originalData as { error: E }).error || (originalData as E);

        const allInterceptors = [...Http.interceptors.error, ...this.interceptors.error];

        for (const errorHandler of allInterceptors) {
          error = await errorHandler(error);
        }
      }

      return {
        data,
        success,
        error: success ? null : (error as E),
        status: modifiedResponse.status,
        statusText: modifiedResponse.statusText,
        headers: resultHeaders,
      };
    } catch (error) {
      let finalError = error instanceof Error ? error : new Error(String(error));
      const allInterceptors = [...Http.interceptors.error, ...this.interceptors.error];

      for (const errorHandler of allInterceptors) {
        finalError = await errorHandler(finalError);
      }

      return {
        data: null as unknown as T,
        status: 0,
        statusText: "Error",
        headers: {},
        error: finalError as E,
        success: false,
      };
    }
  }

  /** Perform a GET request. */
  get<T = unknown, Query = Record<string, unknown>, E = unknown>(
    url: string,
    query?: Query,
    options?: Pick<HttpRequest, "headers" | "params" | "signal">,
  ): Promise<HttpResponse<T, E>> {
    return this.request<T, E>({
      ...options,
      method: HttpMethod.GET,
      url,
      query: query as HttpQuery,
    });
  }

  /** Perform a POST request. */
  post<T = unknown, Body = unknown, E = unknown>(
    url: string,
    body?: Body,
    options?: Pick<HttpRequest, "headers" | "params" | "signal" | "query">,
  ): Promise<HttpResponse<T, E>> {
    return this.request<T, E>({
      ...options,
      method: HttpMethod.POST,
      url,
      body,
    });
  }

  /** Perform a PUT request. */
  put<T = unknown, Body = unknown, E = unknown>(
    url: string,
    body?: Body,
    options?: Pick<HttpRequest, "headers" | "params" | "signal" | "query">,
  ): Promise<HttpResponse<T, E>> {
    return this.request<T, E>({
      ...options,
      method: HttpMethod.PUT,
      url,
      body,
    });
  }

  /** Perform a PATCH request. */
  patch<T = unknown, Body = unknown, E = unknown>(
    url: string,
    body?: Body,
    options?: Pick<HttpRequest, "headers" | "params" | "signal" | "query">,
  ): Promise<HttpResponse<T, E>> {
    return this.request<T, E>({
      ...options,
      method: HttpMethod.PATCH,
      url,
      body,
    });
  }

  /** Perform a DELETE request. */
  delete<T = unknown, E = unknown>(
    url: string,
    options?: Pick<HttpRequest, "headers" | "params" | "signal" | "query">,
  ): Promise<HttpResponse<T, E>> {
    return this.request<T, E>({
      ...options,
      method: HttpMethod.DELETE,
      url,
    });
  }

  /** Perform a HEAD request. */
  head<T = unknown, E = unknown>(
    url: string,
    options?: Pick<HttpRequest, "headers" | "params" | "signal" | "query">,
  ): Promise<HttpResponse<T, E>> {
    return this.request<T, E>({
      ...options,
      method: HttpMethod.HEAD,
      url,
    });
  }

  /** Perform an OPTIONS request. */
  options<T = unknown, E = unknown>(
    url: string,
    options?: Pick<HttpRequest, "headers" | "params" | "signal" | "query">,
  ): Promise<HttpResponse<T, E>> {
    return this.request<T, E>({
      ...options,
      method: HttpMethod.OPTIONS,
      url,
    });
  }

  /**
   * Upload one or more files via POST.
   * Falls back to `XMLHttpRequest` when `onProgress` is provided for progress tracking.
   */
  upload<T = unknown, E = unknown>(
    url: string,
    file: File | File[] | FileListLike,
    options?: HttpUploadOptions,
  ) {
    const formData = options?.body ? objectToFormData(options.body) : new FormData();

    let fileName = options?.name || "file";

    if (Array.isArray(file)) {
      if (fileName.endsWith("[]")) {
        fileName = fileName.slice(0, -2);
      }

      file.forEach((f, index) => {
        formData.append(`${fileName}[${index}]`, f, f.name);
      });
    } else if (isFileList(file)) {
      if (fileName.endsWith("[]")) fileName = fileName.slice(0, -2);
      Array.from(file).forEach((f, index) => {
        formData.append(`${fileName}[${index}]`, f, f.name);
      });
    } else {
      formData.append(fileName, file, file.name);
    }

    if (options?.body) {
      const flattenedBody = flatten(options.body);

      Object.entries(flattenedBody).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          formData.append(key, String(value));
        }
      });
    }

    if (options?.onProgress && typeof XMLHttpRequest !== "undefined") {
      return new Promise<HttpResponse<T, E>>(async (resolve) => {
        try {
          let requestOptions: HttpRequest = {
            ...options,
            method: HttpMethod.POST,
            url,
            body: formData,
          };

          const allReqInterceptors = [...Http.interceptors.request, ...this.interceptors.request];

          for (const interceptor of allReqInterceptors) {
            requestOptions = await interceptor(requestOptions);
          }

          const fullURL = this.getURL(requestOptions);
          const requestHeaders = await this.getHeaders(requestOptions.headers || {}, true);

          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener("progress", (event: { lengthComputable: boolean; loaded: number; total: number }) => {
            if (event.lengthComputable) {
              const percentage = Math.round((event.loaded / event.total) * 100);

              options.onProgress?.({
                loaded: event.loaded,
                total: event.total,
                percentage,
              });
            }
          });

          xhr.addEventListener("load", async () => {
            try {
              // 1. Parse raw response data (same as the `request` method)
              const contentType = xhr.getResponseHeader("Content-Type") || "";
              let originalData: unknown = null;

              if (contentType.includes("application/json")) {
                originalData = JSON.parse(xhr.responseText);
              } else {
                originalData = xhr.responseText;
              }

              // 2. Run through TRANSFORM INTERCEPTORS (convert raw payload to normalized data)
              const allTransformInterceptors = [
                ...Http.interceptors.transform,
                ...this.interceptors.transform,
              ];

              let data = originalData as T;
              for (const transform of allTransformInterceptors) {
                data = await transform(data);
              }

              // 3. Run through RESPONSE INTERCEPTORS (modify status/headers only, body is not re-read)
              const allResInterceptors = [
                ...Http.interceptors.response,
                ...this.interceptors.response,
              ];

              let modifiedResponse: Response = new Response(xhr.responseText, {
                status: xhr.status,
                statusText: xhr.statusText,
                headers: requestHeaders,
              });

              for (const interceptor of allResInterceptors) {
                modifiedResponse = await interceptor(modifiedResponse);
              }

              // 4. Extract final headers and status
              const resultHeaders: Record<string, string> = {};
              modifiedResponse.headers.forEach((value, key) => {
                resultHeaders[key] = value;
              });

              const success = modifiedResponse.ok;

              // 5. Package the final result (transformed data + modified headers)
              resolve({
                data,
                success,
                error: success ? null : (data as unknown as E),
                status: modifiedResponse.status,
                statusText: modifiedResponse.statusText,
                headers: resultHeaders,
              });
            } catch (error) {
              const allInterceptors = [...Http.interceptors.error, ...this.interceptors.error];
              for (const errorHandler of allInterceptors) {
                errorHandler(error);
              }
              resolve({
                data: null as unknown as T,
                status: 0,
                statusText: "Error",
                headers: {},
                error: error as E,
                success: false,
              });
            }
          });

          xhr.addEventListener("error", (error: unknown) => {
            const allInterceptors = [...Http.interceptors.error, ...this.interceptors.error];
            for (const errorHandler of allInterceptors) {
              errorHandler(error);
            }
            resolve({
              data: null as unknown as T,
              status: 0,
              statusText: "Error",
              headers: {},
              error: error as E,
              success: false,
            });
          });

          xhr.addEventListener("abort", () => {
            resolve({
              data: null as unknown as T,
              status: 0,
              statusText: "Aborted",
              headers: {},
              error: null,
              success: false,
            });
          });

          xhr.open(requestOptions.method || HttpMethod.POST, fullURL, true);

          Object.entries(requestHeaders).forEach(([key, value]) => {
            if (key?.toLowerCase() !== "content-type" && value) {
              xhr.setRequestHeader(key, value);
            }
          });

          xhr.send(requestOptions.body as BodyInit | null);
        } catch (error) {
          const allInterceptors = [...Http.interceptors.error, ...this.interceptors.error];
          for (const errorHandler of allInterceptors) {
            errorHandler(error);
          }
          resolve({
            data: null as unknown as T,
            status: 0,
            statusText: "Error",
            headers: {},
            error: error as E,
            success: false,
          });
        }
      });
    }

    return this.request<T, E>({
      method: HttpMethod.POST,
      url,
      body: formData,
      headers: options?.headers,
      params: options?.params,
      signal: options?.signal,
      query: options?.query,
    });
  }

  /**
   * Upload with multipart/related format.
   * Builds a proper multipart/related body with JSON metadata + binary file content.
   *
   * @example
   * ```ts
   * const result = await http.related<DriveFile>("/files?uploadType=multipart", fileBuffer, {
   *   metadata: { name: "photo.jpg", parents: ["folderId"] },
   *   contentType: "image/jpeg",
   * });
   * ```
   */
  related<T = unknown, E = unknown>(
    url: string,
    fileData: ArrayBuffer | Uint8Array,
    options: HttpRelatedOptions,
  ): Promise<HttpResponse<T, E>> {
    const contentType = sanitizeMime(options.contentType);
    const metadataMimeType = sanitizeMime(options.metadataMimeType || "application/json");

    const boundary = `----related-boundary-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const metadataJson = JSON.stringify(options.metadata);

    const encoder = new TextEncoder();

    const metadataPart = encoder.encode(
      `--${boundary}\r\n` +
        `Content-Type: ${metadataMimeType}; charset=UTF-8\r\n\r\n` +
        metadataJson +
        "\r\n",
    );

    const filePart = encoder.encode(
      `--${boundary}\r\n` +
        `Content-Type: ${contentType}\r\n` +
        "Content-Transfer-Encoding: binary\r\n\r\n",
    );

    const closing = encoder.encode(`\r\n--${boundary}--`);

    const fileBytes = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);

    const body = new Uint8Array(
      metadataPart.length + filePart.length + fileBytes.length + closing.length,
    );
    [metadataPart, filePart, fileBytes, closing].reduce((offset, part) => {
      body.set(part, offset);
      return offset + part.length;
    }, 0);

    return this.request<T, E>({
      method: HttpMethod.POST,
      url,
      body: body as unknown,
      headers: {
        ...(options.headers || {}),
        "Content-Type": `multipart/related; boundary=${boundary}`,
      } as Record<string, string>,
      params: options.params,
      signal: options.signal,
      query: options.query,
    });
  }

  /**
   * Creates a factory function that generates typed endpoint descriptors.
   * Each descriptor has a `key` and an async `fn` that performs the HTTP call.
   *
   * @example
   * ```ts
   * const api = Http.createFactory({
   *   baseURL: "https://api.example.com",
   *   endpoint: { users: { list: "/users", create: "/users" } },
   * });
   *
   * const getUsers = api<User[]>("users.list");
   * const { data } = await getUsers.fn();
   * ```
   */
  static createFactory(options: HttpFactoryOptions = {}) {
    const instance = options.http || new Http(options.baseURL);

    const getEndpoints = () => {
      if (typeof options.endpoint === "function") {
        return options.endpoint();
      } else {
        return options.endpoint || {};
      }
    };

    return function factory<T, Args extends any[] = [], E = unknown>(
      key: string,
      method?: HttpMethod | HttpUpload,
    ): HttpFactory<T, Args, E> {
      const urls = flatten(getEndpoints()) as Record<string, string>;
      const url = urls[key] as string;

      return {
        key,
        fn: async (...args: Args) => {
          const storage =
            typeof options.storage === "function" ? await options.storage() : options.storage;

          storage && instance.setStorage(storage);

          switch (method) {
            case HttpMethod.POST:
              return await instance.post<T, Args[0], E>(url, ...args);
            case HttpMethod.PUT:
              return await instance.put<T, Args[0], E>(url, ...args);
            case HttpMethod.PATCH:
              return await instance.patch<T, Args[0], E>(url, ...args);
            case HttpMethod.DELETE:
              return await instance.delete<T, E>(url, ...args);
            case HttpMethod.HEAD:
              return await instance.head<T, E>(url, ...args);
            case HttpMethod.OPTIONS:
              return await instance.options<T, E>(url, ...args);
            case HttpUpload.UPLOAD:
              return await instance.upload<T, E>(
                url,
                ...(args as unknown as [
                  File | File[] | FileListLike,
                  HttpUploadOptions | undefined,
                ]),
              );
            case HttpUpload.RELATED:
              return await instance.related<T, E>(
                url,
                ...(args as unknown as [ArrayBuffer | Uint8Array, HttpRelatedOptions]),
              );
            default:
              return await instance.get<T, Args[0], E>(url, ...args);
          }
        },
      };
    };
  }
}
