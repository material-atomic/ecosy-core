/* eslint-disable @typescript-eslint/no-explicit-any */
import { type FileListLike, flatten, isFileList, isLiteralObject, objectToFormData } from "./utilities";
import { Serialize } from "./serialize";

function getEnv(key: string, defaultValue?: string) {
  if (typeof process !== "undefined" && isLiteralObject(process.env)) {
    return process.env[key] ?? defaultValue;
  }

  return defaultValue;
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
}

/** Storage adapter interface for reading/writing auth tokens (e.g. `localStorage`). */
export interface HttpStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string, options?: any): void;
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

  static authTokenKey = "access_token";
  static authHeaderKey = "Authorization";
  static authHeaderType = "Bearer";
  static authDetectToken = ["localStorage", "sessionStorage", "cookie"];
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

  constructor(private readonly baseURL = DEFAULT_BASE_URL) {}

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
          Serialize.Primitive.isPrimitive(item[1])
      );
    }

    if (typeof query === "object" && query !== null) {
      return Object.values(query).every(
        (value) => Serialize.Primitive.isPrimitive(value)
      );
    }

    return false;
  }

  getQuery<Params extends Record<string, unknown>>(options: HttpRequest<unknown, Params>): string {
    const { method, body, query } = options;

    const source = (method === HttpMethod.GET && this.isValidQuery(body)) ? body : query;

    if (!source || typeof source !== "object") {
      return typeof source === "string" ? source : "";
    }

    if (source instanceof URLSearchParams) {
      return source.toString();
    }

    return Serialize.queryString.stringify(
      source as Record<string, unknown>,
      { skipNull: true, skipEmptyString: true }
    );
  }

  /** Type guard that checks whether a body is a `FormData` instance. */
  isFormData(body: unknown): body is FormData {
    return body instanceof FormData;
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
  getToken() {
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
      token = this.storage.getItem(authTokenKey) || "";
    }

    const result = {
      key: authHeaderKey,
      value: "",
    };

    if (token) {
      result.value = token;

      if (authHeaderType) {
        result.value = `${authHeaderType} ${token}`;
      }
    }

    return result;
  }

  /** Build the final headers object, injecting auth token and Content-Type. */
  getHeaders(headers: Record<string, string> = {}, isFormData?: boolean) {
    const token = this.getToken();

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

  /** Build the full URL from base URL, path, query string, and path params. */
  getURL(options: HttpRequest): string {
    const { url, params = {} } = options;
    const queryString = this.getQuery(options);

    let finalURL = url;

    if (url) {
      if (url.match(/^https?:\/\//)) {
        finalURL = url;
      } else {
        const baseURL = this.baseURL?.replace(/\/+$/, "");
        const cleanURL = url.replace(/^\/+/, "");
        finalURL = `${baseURL}/${cleanURL}`;
      }
    }

    if (queryString) {
      const separator = finalURL.includes("?") ? "&" : "?";
      finalURL += `${separator}${queryString}`;
    }

    return Serialize.interpolate(finalURL, params);
  }

  /** Serialize the request body (JSON or FormData). Returns `undefined` for bodyless methods. */
  getBody(options: HttpRequest) {
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
      this.isFormData(body)
    ) {
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
      const requestHeaders = this.getHeaders(modifiedOptions.headers || {});

      if (this.isFormData(modifiedOptions.body) && "Content-Type" in requestHeaders) {
        delete requestHeaders["Content-Type"];
      }

      const response = await fetch(fullURL, {
        method: modifiedOptions.method || method,
        headers: requestHeaders,
        body: this.getBody(modifiedOptions),
        signal: modifiedOptions.signal,
      });

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
    options?: Pick<HttpRequest, "headers" | "params" | "signal">
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
    options?: Pick<HttpRequest, "headers" | "params" | "signal" | "query">
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
    options?: Pick<HttpRequest, "headers" | "params" | "signal" | "query">
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
    options?: Pick<HttpRequest, "headers" | "params" | "signal" | "query">
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
    options?: Pick<HttpRequest, "headers" | "params" | "signal" | "query">
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
    options?: Pick<HttpRequest, "headers" | "params" | "signal" | "query">
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
    options?: Pick<HttpRequest, "headers" | "params" | "signal" | "query">
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
    options?: HttpUploadOptions
  ) {
    const formData = options?.body 
      ? objectToFormData(options.body) 
      : new FormData();

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
          const requestHeaders = this.getHeaders(requestOptions.headers || {}, true);

          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener("progress", (event) => {
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

          xhr.addEventListener("error", (error) => {
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

          xhr.send(requestOptions.body as Document | XMLHttpRequestBodyInit | null);
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
      method?: HttpMethod | "UPLOAD"
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
            case "UPLOAD":
              return await instance.upload<T, E>(
                url,
                ...(args as unknown as [File | File[] | FileListLike, HttpUploadOptions | undefined])
              );
            default:
              return await instance.get<T, Args[0], E>(url, ...args);
          }
        },
      };
    };
  }
}
