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
import { ICON_ASSETS, ICON_CACHE_CONTROL } from "./icons.js";
import { WIDGET_HTML } from "./generated/assets.js";

const HTML = { "content-type": "text/html; charset=utf-8" };

/** A front door for anyone who opens the deploy URL in a browser. */
const LANDING = `<!doctype html>
<meta charset="utf-8" />
<title>mcp-memes</title>
<h1>mcp-memes</h1>
<p>A situation-aware meme editor, served over the Model Context Protocol.</p>
<p>MCP endpoint: <code>POST /mcp</code> &middot; health: <code>GET /health</code></p>
<p>Also reachable at <a href="https://sinan.pl/mcp-memes">sinan.pl/mcp-memes</a>.</p>
<p><a href="https://github.com/sinanpl/mcp-memes">Source on GitHub</a></p>`;

/**
 * The vanity front door is sinan.pl/mcp-memes. A front door that *forwards*
 * rather than rewrites — a Cloudflare proxy rule, a reverse proxy — hands the
 * whole path through, prefix and all, so `/mcp-memes/mcp` has to route like
 * `/mcp`. Stripping it here rather than asking the blog to rewrite keeps both
 * addresses answering the same four routes.
 *
 * (A plain 301/302 redirect never gets this far: clients turn a redirected POST
 * into a GET. The vanity URL has to be a 308 or a proxy — docs/deployment.md.)
 */
const PREFIX = /^\/mcp-memes(?=\/|$)/;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const prefix = PREFIX.exec(url.pathname)?.[0] ?? "";
    const pathname = url.pathname.slice(prefix.length) || "/";

    // Whatever address this request came in on is the one the host can fetch an
    // icon from, so the advertised icons are built from it rather than hardcoded.
    const iconBaseUrl = url.origin + prefix;

    // Every path arrives here, so the routing lives in code.
    if (pathname === "/mcp") {
      return handleMcpRequest(request, { widgetHtml: WIDGET_HTML, iconBaseUrl });
    }
    if (pathname === "/health") {
      return Response.json({ status: "ok" });
    }
    const icon = ICON_ASSETS[pathname];
    if (icon) {
      // Public and cross-origin by nature: the pane fetching it is not us.
      return new Response(icon.body, {
        status: 200,
        headers: {
          "content-type": icon.contentType,
          "cache-control": ICON_CACHE_CONTROL,
          "access-control-allow-origin": "*",
        },
      });
    }
    if (pathname === "/") return new Response(LANDING, { status: 200, headers: HTML });
    return new Response("Not found. The MCP endpoint is at POST /mcp.", { status: 404 });
  },
};
