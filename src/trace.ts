/**
 * An env-gated tee of the JSON-RPC traffic.
 *
 * Claude Desktop's own connector log records that a `tools/call` happened and
 * nothing about what was in it, which makes "the model sent the wrong ids"
 * impossible to tell apart from "the tool rejected a valid call". Setting
 * MEMES_TRACE to a path writes both directions to that file as JSON lines.
 *
 * Off unless the variable is set: this sits in the stdio hot path, and the
 * traffic includes whatever the user asked to be memed about.
 */
import { appendFileSync } from "node:fs";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/** Wrap a transport so every message in and out is appended to MEMES_TRACE. */
export function traceTransport<T extends Transport>(transport: T): T {
  const path = process.env.MEMES_TRACE;
  if (!path) return transport;

  const write = (direction: "in" | "out", message: unknown): void => {
    try {
      appendFileSync(path, `${JSON.stringify({ t: new Date().toISOString(), direction, message })}\n`);
    } catch {
      // Tracing must never take the server down with it.
    }
  };

  const send = transport.send.bind(transport);
  transport.send = async (message, options) => {
    write("out", message);
    return send(message, options);
  };

  // onmessage is assigned by the Protocol layer during connect(), so the hook
  // has to sit on the property rather than on whatever is there right now.
  let handler: Transport["onmessage"];
  Object.defineProperty(transport, "onmessage", {
    configurable: true,
    get: () => handler,
    set: (next: Transport["onmessage"]) => {
      handler = next
        ? (message, extra) => {
            write("in", message);
            next(message, extra);
          }
        : next;
    },
  });

  write("out", { note: `tracing to ${path}` });
  return transport;
}
