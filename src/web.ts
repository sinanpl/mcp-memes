/**
 * A Web-standard (Request -> Response) MCP endpoint, for hosts that speak
 * `fetch` rather than Node's http objects — Cloudflare Workers in particular.
 *
 * The same stateless idea as src/http.ts: one server per request, one JSON body
 * out, no stream held open. Nothing here forks the core; it only adapts the
 * transport.
 */
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { createServer, type ServerOptions } from "./server.js";

/**
 * A transport that carries exactly one JSON-RPC message in and collects what
 * the server writes back. It is the smallest thing that satisfies the SDK's
 * Transport contract for a request/response host.
 */
class OneShotTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  readonly sent: JSONRPCMessage[] = [];
  private settle: (() => void) | undefined;
  private readonly done: Promise<void>;

  constructor() {
    this.done = new Promise<void>((resolve) => {
      this.settle = resolve;
    });
  }

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    this.sent.push(message);
    this.settle?.();
  }

  async close(): Promise<void> {
    this.settle?.();
    this.onclose?.();
  }

  /** Resolves when the server has written something, or after `timeoutMs`. */
  async waitForReply(timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([this.done, timeout]);
    if (timer) clearTimeout(timer);
  }
}

/**
 * Sent on every response, including errors and the `OPTIONS` preflight, so
 * browser-hosted MCP clients can reach the endpoint. They live here rather than
 * in host-level header config so that every host mounting this handler behaves
 * the same way.
 */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Authorization",
  "access-control-expose-headers": "Mcp-Session-Id, MCP-Protocol-Version",
  "access-control-max-age": "86400",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });

const rpcError = (message: string, status: number, code: number): Response =>
  json({ jsonrpc: "2.0", error: { code, message }, id: null }, status);

export type WebHandlerOptions = ServerOptions & {
  /**
   * How long to wait for the server's reply before giving up. Workers caps CPU
   * time rather than wall-clock, so nothing upstream enforces a deadline here;
   * this one exists so a wedged handler surfaces as a JSON-RPC error instead of
   * holding the connection open indefinitely.
   */
  timeoutMs?: number;
};

/**
 * Handle one MCP request. Exported so any fetch-style host can mount it.
 *
 * Deliberately unauthenticated: this is a demo endpoint over a public
 * catalogue of public images, so there is nothing to protect but the compute.
 * If it ever starts costing real money, a shared-secret `Authorization` check
 * belongs here, ahead of `createServer`.
 */
export async function handleMcpRequest(
  request: Request,
  options: WebHandlerOptions,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return rpcError("Method not allowed: this server is stateless (POST only).", 405, -32000);
  }

  let message: JSONRPCMessage;
  try {
    message = (await request.json()) as JSONRPCMessage;
  } catch {
    return rpcError("Parse error: body is not JSON.", 400, -32700);
  }
  if (Array.isArray(message)) {
    return rpcError("Batched requests are not supported.", 400, -32600);
  }

  const server = createServer(options);
  const transport = new OneShotTransport();
  try {
    await server.connect(transport);
    transport.onmessage?.(message);
    // A notification gets no reply; the wait simply expires cheaply.
    const isNotification = !("id" in message) || message.id === undefined;
    if (isNotification) return new Response(null, { status: 202, headers: CORS_HEADERS });

    await transport.waitForReply(options.timeoutMs ?? 8_000);
    const reply = transport.sent[0];
    if (!reply) return rpcError("Timed out waiting for the server to reply.", 504, -32603);
    return json(reply);
  } catch (err) {
    console.error("MCP request failed:", err);
    return rpcError("Internal server error", 500, -32603);
  } finally {
    await server.close().catch(() => {});
  }
}
