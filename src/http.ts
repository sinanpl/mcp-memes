/**
 * Local development entrypoint: stateless streamable HTTP, for pointing the
 * MCP Inspector at something without going through `wrangler dev`. This is the
 * only file in src/ allowed to import express, and it is not in the deployed
 * path — the deploy target is src/worker.ts.
 *
 * Unlike the Worker, this entrypoint *does* wire up the server-side renderer,
 * because Node can load @napi-rs/canvas. That makes it the way to exercise
 * `render_meme`'s PNG path locally.
 *
 * A fresh server and transport are built per request with
 * `sessionIdGenerator: undefined`, so nothing is held between requests, and
 * `enableJsonResponse: true` keeps every response a single JSON body rather
 * than a long-lived SSE stream — the server is safe to run on per-second-billed
 * compute.
 */
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, readWidgetHtml } from "./server.js";
import { CORS_HEADERS } from "./web.js";
import { ICON_ASSETS, ICON_CACHE_CONTROL } from "./icons.js";
import { TEMPLATES } from "./catalogue.js";
import { renderMeme } from "./render.js";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";

// Read once at boot: a missing catalogue or widget must fail loudly at startup.
const widgetHtml = readWidgetHtml();

const app = express();
app.use(express.json({ limit: "1mb" }));

// The same headers the deployed handler sends, so a browser client that works
// against one entrypoint works against the other.
app.use((_req, res, next) => {
  res.set(CORS_HEADERS);
  next();
});
app.options("/mcp", (_req, res) => {
  res.status(204).end();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", templates: TEMPLATES.length });
});

// The same two paths the Worker serves, so a host pointed at this entrypoint
// can fetch the icons the initialize response advertises.
for (const [path, icon] of Object.entries(ICON_ASSETS)) {
  app.get(path, (_req, res) => {
    res.type(icon.contentType).set("cache-control", ICON_CACHE_CONTROL).send(Buffer.from(icon.body));
  });
}

async function handleMcp(req: Request, res: Response): Promise<void> {
  // Built from the address this request came in on: behind a tunnel or a proxy
  // it is not the one the process is listening on.
  const iconBaseUrl = `${req.protocol}://${req.get("host") ?? `${HOST}:${PORT}`}`;
  const server = createServer({ widgetHtml, iconBaseUrl, render: renderMeme });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

app.post("/mcp", (req, res) => {
  void handleMcp(req, res);
});

/** Stateless: there is no stream to resume and no session to delete. */
const notAllowed = (_req: Request, res: Response): void => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: this server is stateless (POST /mcp only)." },
    id: null,
  });
};
app.get("/mcp", notAllowed);
app.delete("/mcp", notAllowed);

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`mcp-memes-ts listening on http://${HOST}:${PORT}/mcp`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down.`);
    httpServer.close(() => process.exit(0));
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
