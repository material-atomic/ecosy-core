/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FormatterOptions, ILogDelivery, LogLevel, LogRecord } from "../types";
import { GelfFormatter } from "../formatters/gelf";

export interface GraylogDeliveryOptions extends FormatterOptions {
  /**
   * - `"http"` (default): POST to a GELF HTTP input — `url`, e.g.
   *   `http://graylog:12201/gelf`. Uses `fetch`, so it works in Node, a
   *   browser, and an edge runtime.
   * - `"udp"`: a GELF UDP input at `host`:`port`. Node only. Messages larger
   *   than one datagram are split into GELF chunks.
   */
  transport?: "http" | "udp";
  /** HTTP: the GELF input's endpoint. */
  url?: string;
  /** HTTP: sent with every request — an auth header for a proxy in front of Graylog, say. */
  headers?: Record<string, string>;
  /** UDP: defaults to `"127.0.0.1"`. */
  host?: string;
  /** UDP: defaults to 12201, Graylog's GELF default. */
  port?: number;
  /**
   * UDP: the largest datagram to send before chunking. Defaults to 1420, which
   * fits a typical WAN MTU; Graylog accepts up to 8192.
   */
  chunkSize?: number;
  /**
   * Where a failed send goes. Defaults to `console.error`. A logger that
   * cannot reach its log server must not throw into the code that logged.
   */
  onError?: (error: unknown) => void;
}

/** GELF chunk header: magic bytes, 8-byte message id, sequence number, count. */
const CHUNK_MAGIC = [0x1e, 0x0f];
const CHUNK_HEADER = 12;
const MAX_CHUNKS = 128;

/**
 * Sends log entries to Graylog as GELF 1.1.
 *
 * Builds the GELF itself from the entry as logged, whatever standard the
 * logger formats in — so one logger can print PRETTY to the terminal and ship
 * GELF to Graylog at once:
 *
 * ```ts
 * const AppLogger = Logger({
 *   standard: "PRETTY",
 *   service: "sniprender",
 *   adapter: [console, new GraylogDelivery({ url: "http://graylog:12201/gelf", service: "sniprender" })],
 * });
 * new AppLogger("Router").warn("slow request", { ms: 812 });
 * ```
 *
 * The context given to the logger goes out as `_context`. Sends are not
 * awaited by the logger; a failure is reported through `onError`.
 */
export class GraylogDelivery implements ILogDelivery {
  private readonly gelf: GelfFormatter;
  private readonly onError: (error: unknown) => void;
  private socket: Promise<any> | null = null;

  constructor(private readonly options: GraylogDeliveryOptions = {}) {
    if ((options.transport ?? "http") === "http" && !options.url) {
      throw new Error("[GraylogDelivery] transport \"http\" needs `url` — the GELF HTTP input, e.g. http://graylog:12201/gelf.");
    }
    this.gelf = new GelfFormatter({ service: options.service });
    this.onError = options.onError ?? ((error) => console.error("[GraylogDelivery] send failed:", error));
  }

  async send(level: LogLevel, formattedData: any, record?: LogRecord): Promise<void> {
    /* The entry as logged, when the logger hands it over; otherwise the
       formatted payload, which is already GELF only if the logger's standard
       is GELF — anything else is wrapped as a message. */
    const payload: string = record
      ? this.gelf.format(level, record.args, record)
      : typeof formattedData === "string" && formattedData.includes('"version":"1.1"')
        ? formattedData
        : this.gelf.format(level, [formattedData]);

    try {
      if ((this.options.transport ?? "http") === "udp") await this.sendUdp(payload);
      else await this.sendHttp(payload);
    } catch (error) {
      this.onError(error);
    }
  }

  private async sendHttp(payload: string) {
    const response = await fetch(this.options.url!, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.options.headers },
      body: payload,
    });
    /* Graylog answers 202 Accepted; anything outside 2xx is a refusal. */
    if (!response.ok) throw new Error(`Graylog answered ${response.status} ${response.statusText}`);
  }

  private async sendUdp(payload: string) {
    const socket = await (this.socket ??= import("node:dgram").then((dgram) => {
      const s = dgram.createSocket("udp4");
      /* A logging socket must not keep a process alive that has finished. */
      s.unref();
      return s;
    }));
    const host = this.options.host ?? "127.0.0.1";
    const port = this.options.port ?? 12201;
    const data = new TextEncoder().encode(payload);
    const size = this.options.chunkSize ?? 1420;

    const datagrams: Uint8Array[] = [];
    if (data.length <= size) {
      datagrams.push(data);
    } else {
      const body = size - CHUNK_HEADER;
      const count = Math.ceil(data.length / body);
      if (count > MAX_CHUNKS) {
        throw new Error(`GELF message of ${data.length} bytes needs ${count} chunks; the limit is ${MAX_CHUNKS}.`);
      }
      const id = new Uint8Array(8);
      crypto.getRandomValues(id);
      for (let i = 0; i < count; i++) {
        const piece = data.subarray(i * body, (i + 1) * body);
        const chunk = new Uint8Array(CHUNK_HEADER + piece.length);
        chunk.set(CHUNK_MAGIC, 0);
        chunk.set(id, 2);
        chunk[10] = i;
        chunk[11] = count;
        chunk.set(piece, CHUNK_HEADER);
        datagrams.push(chunk);
      }
    }

    for (const d of datagrams) {
      await new Promise<void>((resolve, reject) =>
        socket.send(d, port, host, (error: unknown) => (error ? reject(error) : resolve())),
      );
    }
  }

  /** Closes the UDP socket, if one was opened. */
  async close(): Promise<void> {
    if (!this.socket) return;
    const s = await this.socket;
    this.socket = null;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
}
