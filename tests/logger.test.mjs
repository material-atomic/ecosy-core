/* Against the built package in dist/, the thing that ships. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createSocket } from "node:dgram";
import { format } from "node:util";

const { Logger, ConsoleDelivery, GraylogDelivery, resolveColor, NestTheme } =
  await import(new URL("../dist/logger/index.mjs", import.meta.url).href);

/* The terminal running these may set either — many do, and CI often sets
   FORCE_COLOR. Tests that need them set them explicitly. */
delete process.env.FORCE_COLOR;
delete process.env.NO_COLOR;

/** A console-shaped double that records what each level was called with. */
const recorder = () => {
  const calls = [];
  const rec = (level) => (...args) => calls.push({ level, args });
  return { calls, log: rec("log"), info: rec("info"), warn: rec("warn"), error: rec("error"), debug: rec("debug") };
};
const ESC = "\x1b[";

test("PRETTY lays out a NestJS-style line, plain on a custom adapter", () => {
  const out = recorder();
  const L = Logger({ standard: "PRETTY", service: "Nest", adapter: out });
  const log = new L("Router");
  log.log("Mapped /users");
  log.warn("slow");
  const [first, second] = out.calls.map((c) => c.args[0]);
  assert.match(first, new RegExp(`^\\[Nest\\] ${process.pid}  - \\d{2}/\\d{2}/\\d{4}, \\d{2}:\\d{2}:\\d{2} [AP]M    LOG \\[Router\\] Mapped /users`));
  assert.match(second, /  WARN \[Router\] slow \+\d+ms$/, "the second line carries the delta");
  assert.ok(!first.includes(ESC), "no escape codes into something that is not a terminal");
  process.env.FORCE_COLOR = "1";
  try {
    const forced = recorder();
    new (Logger({ standard: "PRETTY", adapter: forced }))().log("x");
    assert.ok(!forced.calls[0].args[0].includes(ESC), "FORCE_COLOR in the environment does not reach a custom adapter");
  } finally {
    delete process.env.FORCE_COLOR;
  }
  assert.equal(out.calls[1].level, "warn", "still the console method matching the level");
});

test("ANSI, forced: level and message in the level's colour, context and delta yellow", () => {
  const out = recorder();
  const log = new (Logger({ standard: "PRETTY", adapter: out, color: "ansi" }))("Db");
  log.error("connection refused");
  const line = out.calls[0].args[0];
  assert.ok(line.includes(`${ESC}31mERROR ${ESC}0m`), "ERROR in red");
  assert.ok(line.includes(`${ESC}33m[Db] ${ESC}0m`), "context in yellow");
  assert.ok(line.includes(`${ESC}31mconnection refused${ESC}0m`), "message in red");
});

test("CSS, forced: one %c per segment, one style per %c", () => {
  const out = recorder();
  new (Logger({ standard: "PRETTY", adapter: out, color: "css" }))("Ui").info("50% loaded");
  const [fmt, ...styles] = out.calls[0].args;
  assert.equal((fmt.match(/%c/g) ?? []).length, styles.length);
  assert.ok(fmt.includes("50%% loaded"), "a literal % is escaped, since styles follow");
  assert.ok(styles.includes("color:#22c55e"), "info in green");
});

test("a % in the message cannot swallow an argument that follows it", () => {
  const out = recorder();
  new (Logger({ standard: "PRETTY", adapter: out }))().log("50%s done", { a: 1 });
  const rendered = format(...out.calls[0].args);
  assert.match(rendered, /LOG 50%s done \+\d+ms \{ a: 1 \}$/, `rendered: ${rendered}`);
});

test("objects and Errors go to the console as they are, after the line", () => {
  const out = recorder();
  const err = new Error("boom");
  new (Logger({ standard: "PRETTY", adapter: out }))().error("failed", err, { id: 7 });
  const [line, ...rest] = out.calls[0].args;
  assert.match(line, /ERROR failed/);
  assert.equal(rest[0], err, "the Error itself, for the console to print a stack");
  assert.deepEqual(rest[1], { id: 7 });
});

test("auto colour: only on the global console and a terminal; NO_COLOR and FORCE_COLOR as the conventions say", () => {
  const saved = { NO_COLOR: process.env.NO_COLOR, FORCE_COLOR: process.env.FORCE_COLOR };
  try {
    delete process.env.NO_COLOR; delete process.env.FORCE_COLOR;
    assert.equal(resolveColor("auto", recorder()), "none", "a custom adapter is not a terminal");
    process.env.FORCE_COLOR = "1";
    assert.equal(resolveColor("auto", console), "ansi", "FORCE_COLOR: the console colours even off a TTY");
    assert.equal(resolveColor("auto", recorder()), "none", "…but never a custom adapter — escape codes in a log file");
    process.env.NO_COLOR = "1";
    assert.equal(resolveColor("auto", console), "none");
    assert.equal(resolveColor(true, recorder()), "none", "NO_COLOR beats true (which is auto)");
    assert.equal(resolveColor("ansi", recorder()), "ansi", "an explicit mode is not second-guessed");
  } finally {
    for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  }
});

test("TEXT is unchanged: arguments straight through", () => {
  const out = recorder();
  new (Logger({ adapter: out }))("Ignored").log("a", { b: 2 });
  assert.deepEqual(out.calls[0].args, ["a", { b: 2 }]);
});

test("a theme is data: swap one colour", () => {
  const out = recorder();
  const theme = { ...NestTheme, context: "cyan" };
  new (Logger({ standard: "PRETTY", adapter: new ConsoleDelivery(out, { color: "ansi", theme }) }))("X").log("y");
  assert.ok(out.calls[0].args[0].includes(`${ESC}36m[X] `));
});

const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

test("one logger: PRETTY to the console and GELF to Graylog over HTTP", async () => {
  const bodies = [];
  const server = createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { bodies.push({ type: req.headers["content-type"], body: JSON.parse(b) }); res.writeHead(202).end(); });
  });
  const port = await listen(server);
  const out = recorder();
  const graylog = new GraylogDelivery({ url: `http://127.0.0.1:${port}/gelf`, service: "sniprender" });
  const log = new (Logger({ standard: "PRETTY", adapter: [out, graylog] }))("Router");
  log.warn("slow request", { ms: 812 });
  await new Promise((r) => setTimeout(r, 200));
  server.close();

  assert.match(out.calls[0].args[0], /WARN \[Router\] slow request/, "the console got the PRETTY line");
  assert.equal(bodies.length, 1);
  const g = bodies[0].body;
  assert.equal(bodies[0].type, "application/json");
  assert.deepEqual([g.version, g.level, g.short_message, g._context, g._framework_chain], ["1.1", 4, "slow request", "Router", "sniprender"]);
});

test("Graylog unreachable or refusing: reported through onError, never thrown at the caller", async () => {
  const server = createServer((_q, res) => res.writeHead(500).end());
  const port = await listen(server);
  const errors = [];
  const log = new (Logger({ adapter: new GraylogDelivery({ url: `http://127.0.0.1:${port}/gelf`, onError: (e) => errors.push(String(e)) }) }))();
  assert.doesNotThrow(() => log.error("x"));
  await new Promise((r) => setTimeout(r, 200));
  server.close();
  assert.match(errors[0] ?? "", /Graylog answered 500/);
  assert.throws(() => new GraylogDelivery({}), /needs `url`/);
});

test("UDP: one datagram when it fits, GELF chunks when it does not", async () => {
  const sock = createSocket("udp4");
  const got = [];
  sock.on("message", (m) => got.push(Buffer.from(m)));
  await new Promise((r) => sock.bind(0, "127.0.0.1", r));
  const port = sock.address().port;
  const udp = new GraylogDelivery({ transport: "udp", host: "127.0.0.1", port, chunkSize: 512 });
  const log = new (Logger({ adapter: udp }))("Jobs");

  log.info("small");
  log.info("x".repeat(3000));
  await new Promise((r) => setTimeout(r, 300));
  await udp.close(); sock.close();

  assert.equal(JSON.parse(got[0].toString()).short_message, "small");
  const chunks = got.slice(1);
  assert.ok(chunks.length > 1, "split");
  for (const [i, c] of chunks.entries()) {
    assert.deepEqual([c[0], c[1]], [0x1e, 0x0f], "magic bytes");
    assert.equal(c[10], i, "sequence number");
    assert.equal(c[11], chunks.length, "count");
    assert.ok(c.length <= 512, "within chunkSize");
    assert.deepEqual(c.subarray(2, 10), chunks[0].subarray(2, 10), "one message id");
  }
  const whole = JSON.parse(Buffer.concat(chunks.map((c) => c.subarray(12))).toString());
  assert.equal(whole.short_message.length, 3000);
  assert.equal(whole._context, "Jobs");
});
