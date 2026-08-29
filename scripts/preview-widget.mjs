/**
 * A stand-in host for the editor, so the widget can be exercised without a
 * desktop app in the loop.
 *
 * It serves the built widget in an iframe and speaks the app side of the MCP
 * Apps protocol at it: answers ui/initialize, pushes tool-input and tool-result
 * from a real make_meme call, and proxies the app's tools/call back to an
 * in-process server. Every message both ways is echoed into the page, which is
 * the point — a blank editor in a real host tells you nothing about which step
 * failed.
 *
 *   node scripts/preview-widget.mjs   # then open http://localhost:8099
 */
import { createServer as createHttp } from "node:http";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, readWidgetHtml } from "../dist/src/server.js";

const PORT = 8099;
const server = createServer({ widgetHtml: readWidgetHtml() });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "preview-host", version: "0" }, { capabilities: {} });
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

const ARGS = {
  situation: "Debugging an MCP app widget without a desktop host",
  texts: {
    drake: ["redeploy and hope", "a stand-in host that logs both sides"],
    db: ["me", "this preview harness", "a blank editor panel"],
    cmm: ["", "a blank panel is not an error message"],
    exit: ["read the harness log", "redeploy again", "me"],
    gb: ["console.log", "a real host", "the preview harness", "--strict-csp"],
  },
};
const toolResult = await client.callTool({ name: "make_meme", arguments: ARGS });

const STRICT = process.argv.includes("--strict-csp") ? "?csp=strict" : "";
const HARNESS = `<!doctype html><meta charset="utf-8"><title>widget harness</title>
<style>
  body { font: 13px ui-monospace, monospace; margin: 0; display: grid; grid-template-columns: 1fr 420px; height: 100vh; }
  iframe { width: 100%; height: 100%; border: 0; border-right: 1px solid #ccc; }
  #log { margin: 0; padding: 8px; overflow: auto; white-space: pre-wrap; background: #111; color: #ddd; }
  .in { color: #7fd67f; } .out { color: #7fb0ff; } .err { color: #ff8080; }
</style>
<iframe id="app" src="/widget.html${STRICT}"></iframe><pre id="log"></pre>
<script>
const logEl = document.getElementById("log");
const log = (cls, ...parts) => {
  const line = document.createElement("div");
  line.className = cls;
  line.textContent = parts.map((p) => typeof p === "string" ? p : JSON.stringify(p)).join(" ");
  logEl.append(line);
  logEl.scrollTop = logEl.scrollHeight;
};
const frame = document.getElementById("app");
const post = (m) => { log("out", "host →", m); frame.contentWindow.postMessage(m, "*"); };
const TOOL_RESULT = ${JSON.stringify(toolResult)};
const ARGS = ${JSON.stringify(ARGS)};

window.addEventListener("message", async (event) => {
  const m = event.data;
  if (!m || m.jsonrpc !== "2.0") return;
  log("in", "app →", m);

  if (m.method === "ui/initialize") {
    post({ jsonrpc: "2.0", id: m.id, result: {
      protocolVersion: m.params?.protocolVersion,
      // hostInfo is required: omit it and the app SDK rejects the whole result,
      // connect() throws, and the editor sits there looking broken.
      hostInfo: { name: "preview-host", version: "0.1.0" },
      hostCapabilities: { serverTools: {}, sizeChanged: {} },
      hostContext: { theme: "light", containerDimensions: { width: 700, height: 620 } },
    }});
    setTimeout(() => {
      post({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: ARGS } });
      post({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: TOOL_RESULT });
    }, 50);
    return;
  }
  if (m.method === "tools/call") {
    const res = await fetch("/call", { method: "POST", body: JSON.stringify(m.params) }).then((r) => r.json());
    post({ jsonrpc: "2.0", id: m.id, result: res });
    return;
  }
  if (m.id !== undefined) post({ jsonrpc: "2.0", id: m.id, result: {} });
});
window.addEventListener("error", (e) => log("err", "harness error:", String(e.message)));
</script>`;

createHttp(async (req, res) => {
  if (req.url?.startsWith("/widget.html")) {
    // ?csp=strict applies the policy a host would derive from the resource's
    // declared resourceDomains alone — no data: for fonts — which is how at
    // least one host sandboxes it.
    const headers = { "content-type": "text/html; charset=utf-8" };
    if (req.url.includes("csp=strict")) {
      headers["content-security-policy"] =
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
        "img-src https://api.memegen.link data:; font-src https://api.memegen.link; connect-src 'none'";
    }
    res.writeHead(200, headers);
    res.end(readFileSync(new URL("../dist/widget.html", import.meta.url), "utf-8"));
    return;
  }
  if (req.url === "/call" && req.method === "POST") {
    const body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data));
    });
    const params = JSON.parse(body);
    console.log("app called", params.name, JSON.stringify(params.arguments).slice(0, 120));
    const result = await client.callTool(params);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(HARNESS);
}).listen(PORT, () => console.log(`harness on http://localhost:${PORT}`));
