export type primitive = string | number | boolean | bigint | symbol | undefined | null;

export type PrimitiveClass =
  | Date
  | RegExp
  | File
  | FileList
  | URL
  | Blob
  | ArrayBuffer
  | SharedArrayBuffer
  | DataView
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array
  | FormData
  | Headers
  | Request
  | Response
  | URLSearchParams
  | AbortController
  | AbortSignal
  | ReadableStream
  | WritableStream
  | TransformStream
  | Event
  | CustomEvent
  | EventTarget
  | MutationObserver
  | IntersectionObserver
  | ResizeObserver
  | Worker
  | MessageChannel
  | MessagePort
  | BroadcastChannel
  | Generator
  | AsyncGenerator
  | Element
  | HTMLElement
  | Node
  | Document
  | Window
  | Error
  | TypeError
  | RangeError
  | SyntaxError
  | ReferenceError
  | EvalError
  | AggregateError
  | URIError;

export type BuiltInPrimitive = primitive | PrimitiveClass;

export type LiteralObject<Keys extends PropertyKey = PropertyKey> =
  | Record<Keys, unknown>
  | { [K in Keys]: unknown }
  | object;

export type AtomicObject<Key extends PropertyKey = PropertyKey, Value = unknown> =
  { [K in Key]: Value };

export type LiteralFunction<R = unknown, A extends unknown[] = unknown[]> = (...args: A) => R;

export type Objectable = LiteralObject | Array<unknown> | LiteralFunction;

export type Promisable<Value> = Value | Promise<Value>;

export type ExtendedFunction<F = LiteralFunction, O = LiteralObject> = F & O;

export type Freezable<T> = T extends primitive
  ? T
  : T extends (...args: unknown[]) => unknown
  ? T
  : T extends Array<infer U>
  ? ReadonlyArray<Freezable<U>>
  : T extends object
  ? { readonly [K in keyof T]: Freezable<T[K]> }
  : T;

export type PartialLiteral<T> =
  T extends Map<infer K, infer V>
  ? Map<PartialLiteral<K>, PartialLiteral<V>>
  : T extends WeakMap<infer K, infer V>
  ? WeakMap<PartialLiteral<K>, PartialLiteral<V>>
  : T extends ReadonlyMap<infer K, infer V>
  ? ReadonlyMap<PartialLiteral<K>, PartialLiteral<V>>
  : T extends Set<infer U>
  ? Set<PartialLiteral<U>>
  : T extends WeakSet<infer U>
  ? WeakSet<PartialLiteral<U>>
  : T extends ReadonlySet<infer U>
  ? ReadonlySet<PartialLiteral<U>>
  : T extends Promise<infer U>
  ? Promise<PartialLiteral<U>>
  : T extends WeakRef<infer U>
  ? WeakRef<PartialLiteral<U>>
  : T extends FinalizationRegistry<infer U>
  ? FinalizationRegistry<PartialLiteral<U>>
  : T extends BuiltInPrimitive
  ? T
  : T extends ExtendedFunction
  ? T extends ExtendedFunction<infer F>
  ? F & {
    [K in keyof T]?: PartialLiteral<T[K]>;
  }
  : T
  : T extends LiteralObject
  ? { [K in keyof T]?: PartialLiteral<T[K]> }
  : T extends Array<infer U>
  ? Array<PartialLiteral<U>>
  : T extends ReadonlyArray<infer U>
  ? ReadonlyArray<PartialLiteral<U>>
  : T;

export type ToString<T> = T extends string | number | bigint | boolean
  ? `${T}`
  : T extends symbol
    ? string
    : T extends null
      ? "null"
      : T extends undefined
        ? "undefined"
        : never;
