/**
 * Cloudflare Workers entrypoint — the deploy target.
 *
 * A sibling of src/http.ts and src/stdio.ts: same core, different transport
 * adapter. `handleMcpRequest` already has the Workers fetch signature
 * (Request -> Response), and WIDGET_HTML is a compile-time constant, so
 * nothing here touches the filesystem — a V8 isolate has none.
 *
 * Unlike the Node entrypoints there is no renderer, not even optionally:
 * @napi-rs/canvas is a native Skia binary and a V8 isolate cannot load one.
 * That is a deliberate trade, not a limitation worked around — `render_meme`
 * falls back to a memegen URL (src/server.ts) and the editor renders in the
 * browser, so the only cost is image bytes we never wanted to serve anyway.
 */
import { handleMcpRequest } from "./web.js";
import { WIDGET_HTML } from "./generated/assets.js";

const HTML = { "content-type": "text/html; charset=utf-8" };

/** A front door for anyone who opens the deploy URL in a browser. */
const LANDING = `<!doctype html>
<meta charset="utf-8" />
<title>mcp-memes</title>
<h1>mcp-memes</h1>
<p>A situation-aware meme editor, served over the Model Context Protocol.</p>
<p>MCP endpoint: <code>POST /mcp</code> &middot; health: <code>GET /health</code></p>
<p><a href="https://github.com/sinanpl/mcp-memes">Source on GitHub</a></p>`;

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Every path arrives here, so the routing lives in code.
    if (pathname === "/mcp") {
      return handleMcpRequest(request, { widgetHtml: WIDGET_HTML });
    }
    if (pathname === "/health") {
      return Response.json({ status: "ok" });
    }
    if (pathname === "/") return new Response(LANDING, { status: 200, headers: HTML });
    return new Response("Not found. The MCP endpoint is at POST /mcp.", { status: 404 });
  },
};
