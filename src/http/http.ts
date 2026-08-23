/* eslint-disable @typescript-eslint/no-explicit-any */
import { Methods, type HttpMethod } from "./method";
import { HttpStatic } from "./http-static";
import { HttpXML } from "./xml";
import { Endpoint } from "./endpoint";
import { HttpUtils } from "./utils";
import type { HttpInit } from "./init";
import type { HttpResponse } from "./response";
import type { HttpUploadOptions, HttpRelatedOptions } from "./xml";
import type { 
  HttpInterceptorRequest, 
  HttpInterceptorResponse, 
  HttpInterceptorTransform, 
  HttpInterceptorError 
} from "./init";
import type { FileListLike } from "../utilities/filelist";
import { getEnv } from "../env";

export const DEFAULT_BASE_URL = getEnv("API_URL", "/");

import { flatten } from "../utilities/flatten";

export interface HttpClientOptions {
  baseURL?: string;
  http?: Http;
  endpoint?: Record<string, unknown> | (() => Record<string, unknown>);
}

export interface HttpAction<T = unknown, Args extends any[] = [], E = unknown> {
  key: string;
  fn: (...args: Args) => Promise<HttpResponse<T, E>>;
}

export type HttpInterceptorParameters =
  | ["request", HttpInterceptorRequest]
  | ["response", HttpInterceptorResponse]
  | ["transform", HttpInterceptorTransform]
  | ["error", HttpInterceptorError];

export interface HttpOptions {
  baseURL?: string;
  allowedOrigins?: ReadonlyArray<string>;
  configs?: Record<string, unknown>;
}

export class Http extends HttpStatic {
  static readonly method = Methods;
  static readonly Endpoint = Endpoint;

  private static interceptors = {
    request: [] as HttpInterceptorRequest[],
    response: [] as HttpInterceptorResponse[],
    transform: [] as HttpInterceptorTransform[],
    error: [] as HttpInterceptorError[],
  };

  public readonly method = Http.method;
  public readonly baseURL: string;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly defaultConfigs: Record<string, unknown>;
  private defaultHeaders: Record<string, string> = {};

  private interceptors = {
    request: [] as HttpInterceptorRequest[],
    response: [] as HttpInterceptorResponse[],
    transform: [] as HttpInterceptorTransform[],
    error: [] as HttpInterceptorError[],
  };

  constructor(init?: string | HttpOptions) {
    super();
    const resolved: HttpOptions =
      typeof init === "string" || init === undefined
        ? { baseURL: init ?? DEFAULT_BASE_URL }
        : init;

    this.baseURL = resolved.baseURL ?? DEFAULT_BASE_URL ?? "/";

    const origins = new Set<string>();
    for (const o of resolved.allowedOrigins ?? []) {
      const origin = HttpUtils.safeOrigin(o);
      if (!origin) throw new Error(`Http: invalid allowedOrigins entry: ${o}`);
      origins.add(origin);
    }
    const baseOrigin = HttpUtils.safeOrigin(this.baseURL);
    if (baseOrigin) origins.add(baseOrigin);
    this.allowedOrigins = origins;

    this.defaultConfigs = resolved.configs || {};
    
    // Register allowed origins globally for safe redirects
    origins.forEach(origin => HttpUtils.AllowedOrigins.add(origin));
  }

  static on(...params: HttpInterceptorParameters) {
    const [type, handler] = params;
    const registered = Http.interceptors[type] as unknown[];
    registered.includes(handler) || registered.push(handler);
    Http.interceptors[type] = registered as Array<any>;
  }

  static off(...params: HttpInterceptorParameters) {
    const [type, handler] = params;
    const registered = Http.interceptors[type] as unknown[];
    Http.interceptors[type] = registered.filter((h) => h !== handler) as Array<any>;
  }

  on(...params: HttpInterceptorParameters) {
    const [type, handler] = params;
    const registered = this.interceptors[type] as unknown[];
    registered.includes(handler) || registered.push(handler);
    this.interceptors[type] = registered as Array<any>;
    return this;
  }

  off(...params: HttpInterceptorParameters) {
    const [type, handler] = params;
    const registered = this.interceptors[type] as unknown[];
    this.interceptors[type] = registered.filter((h) => h !== handler) as Array<any>;
    return this;
  }

  addHeaders(headers: Record<string, string>) {
    this.defaultHeaders = {
      ...this.defaultHeaders,
      ...headers,
    };
  }

  private mergeConfig(init: Omit<HttpInit, "url" | "method"> & { url: string; method?: HttpMethod }): HttpInit {
    const mergedRequest = [
      ...Http.interceptors.request,
      ...this.interceptors.request,
      ...(init.request ? (Array.isArray(init.request) ? init.request : [init.request]) : []),
    ];

    const mergedTransform = [
      ...Http.interceptors.transform,
      ...this.interceptors.transform,
      ...(init.transform ? (Array.isArray(init.transform) ? init.transform : [init.transform]) : []),
    ];

    const mergedResponse = [
      ...Http.interceptors.response,
      ...this.interceptors.response,
      ...(init.response ? (Array.isArray(init.response) ? init.response : [init.response]) : []),
    ];

    const mergedError = [
      ...Http.interceptors.error,
      ...this.interceptors.error,
      ...(init.error ? (Array.isArray(init.error) ? init.error : [init.error]) : []),
    ];

    let finalUrl = init.url;
    if (finalUrl.startsWith("//")) {
      throw new Error(`Http: protocol-relative URLs are not allowed: ${finalUrl}`);
    }
    
    if (!/^[a-z][a-z0-9+.-]*:/i.test(finalUrl)) {
      const base = this.baseURL.replace(/\/+$/, "");
      const cleanURL = finalUrl.replace(/^\/+/, "");
      finalUrl = base ? `${base}/${cleanURL}` : `/${cleanURL}`;
    }

    const mergedHeaders = {
      ...this.defaultHeaders,
      ...init.headers,
    };

    return {
      ...this.defaultConfigs,
      ...init,
      url: finalUrl,
      headers: mergedHeaders,
      request: mergedRequest,
      transform: mergedTransform,
      response: mergedResponse,
      error: mergedError,
      method: init.method || Methods.GET,
    };
  }

  request<DataType = unknown, Err = unknown>(init: HttpInit): Promise<HttpResponse<DataType, Err>> {
    return HttpStatic.request<DataType, Err>(this.mergeConfig(init));
  }

  get<DataType = unknown, Err = unknown>(url: string, init?: Omit<HttpInit, "url" | "method">) {
    return this.request<DataType, Err>({ ...init, url, method: Methods.GET });
  }

  post<DataType = unknown, Err = unknown>(url: string, body?: unknown, init?: Omit<HttpInit, "url" | "method" | "body">) {
    return this.request<DataType, Err>({ ...init, url, method: Methods.POST, body });
  }

  put<DataType = unknown, Err = unknown>(url: string, body?: unknown, init?: Omit<HttpInit, "url" | "method" | "body">) {
    return this.request<DataType, Err>({ ...init, url, method: Methods.PUT, body });
  }

  patch<DataType = unknown, Err = unknown>(url: string, body?: unknown, init?: Omit<HttpInit, "url" | "method" | "body">) {
    return this.request<DataType, Err>({ ...init, url, method: Methods.PATCH, body });
  }

  delete<DataType = unknown, Err = unknown>(url: string, body?: unknown, init?: Omit<HttpInit, "url" | "method" | "body">) {
    return this.request<DataType, Err>({ ...init, url, method: Methods.DELETE, body });
  }

  head<DataType = unknown, Err = unknown>(url: string, init?: Omit<HttpInit, "url" | "method">) {
    return this.request<DataType, Err>({ ...init, url, method: Methods.HEAD });
  }

  options<DataType = unknown, Err = unknown>(url: string, init?: Omit<HttpInit, "url" | "method">) {
    return this.request<DataType, Err>({ ...init, url, method: Methods.OPTIONS });
  }

  upload<DataType = unknown, Err = unknown>(
    url: string,
    file: File | File[] | FileListLike,
    options?: HttpUploadOptions & Omit<HttpInit, "url" | "method" | "body">,
  ) {
    return HttpXML.upload<DataType, Err>(url, file, this.mergeConfig({ ...options, url, method: Methods.POST }) as any);
  }

  related<DataType = unknown, Err = unknown>(
    url: string,
    fileData: ArrayBuffer | Uint8Array,
    options: HttpRelatedOptions & Omit<HttpInit, "url" | "method" | "body">,
  ) {
    return HttpXML.related<DataType, Err>(url, fileData, this.mergeConfig({ ...options, url, method: Methods.POST }) as any);
  }

  /**
   * Creates a client that generates typed endpoint actions.
   * Each action has a `key` (useful for caching keys like React Query) and an async `fn`.
   *
   * @example
   * ```ts
   * const api = Http.createClient({
   *   baseURL: "https://api.example.com",
   *   endpoint: { users: { list: "/users", create: "/users" } },
   * });
   *
   * const getUsers = api<User[]>("users.list");
   * const { data } = await getUsers.fn();
   * ```
   */
  static createClient(options: HttpClientOptions = {}) {
    const instance = options.http || new Http(options.baseURL);

    const getEndpoints = () => {
      if (typeof options.endpoint === "function") {
        return options.endpoint();
      } else {
        return options.endpoint || {};
      }
    };

    return function client<T, Args extends any[] = [], E = unknown>(
      key: string,
      method?: HttpMethod | "upload" | "related",
    ): HttpAction<T, Args, E> {
      const urls = flatten(getEndpoints()) as Record<string, string>;
      const url = urls[key] as string;

      return {
        key,
        fn: async (...args: Args) => {
          switch (method) {
            case Methods.POST:
              return await instance.post<T, E>(url, ...(args as unknown as [any, any]));
            case Methods.PUT:
              return await instance.put<T, E>(url, ...(args as unknown as [any, any]));
            case Methods.PATCH:
              return await instance.patch<T, E>(url, ...(args as unknown as [any, any]));
            case Methods.DELETE:
              return await instance.delete<T, E>(url, ...(args as unknown as [any, any]));
            case Methods.HEAD:
              return await instance.head<T, E>(url, ...(args as unknown as [any]));
            case Methods.OPTIONS:
              return await instance.options<T, E>(url, ...(args as unknown as [any]));
            case "upload":
              return await instance.upload<T, E>(
                url,
                ...(args as unknown as [File | File[] | FileListLike, (HttpUploadOptions & Omit<HttpInit, "url" | "method" | "body">)?])
              );
            case "related":
              return await instance.related<T, E>(
                url,
                ...(args as unknown as [ArrayBuffer | Uint8Array, HttpRelatedOptions & Omit<HttpInit, "url" | "method" | "body">])
              );
            default:
              return await instance.get<T, E>(url, ...(args as unknown as [any]));
          }
        },
      };
    };
  }
}
