import { describe, expect, it } from "vitest";
import worker from "../src/worker.js";

const fetchWorker = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://mcp-memes.polatoglu-sinan.workers.dev${path}`, init));

const initialize = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
  }),
} satisfies RequestInit;

describe("worker routes", () => {
  it("serves the icon the initialize response points at", async () => {
    const response = await fetchWorker("/icon.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    // The pane fetching it is a different origin.
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("serves a favicon, the only mark a host can find before it connects", async () => {
    const response = await fetchWorker("/favicon.ico");
    expect(response.status).toBe(200);
    // PNG bytes at the .ico path: claiming image/vnd.microsoft.icon for a PNG
    // only invites a stricter client to reject it.
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("links the icon from the landing page, for a host that reads the HTML", async () => {
    const html = await (await fetchWorker("/")).text();
    expect(html).toContain('<link rel="icon" href="/icon.svg"');
    expect(html).toContain('<link rel="icon" href="/icon.png"');
  });

  it("points the icons at the address the request came in on", async () => {
    const response = await fetchWorker("/mcp", initialize);
    const body = (await response.json()) as { result: { serverInfo: { icons: { src: string }[] } } };
    expect(body.result.serverInfo.icons.map((i) => i.src)).toEqual([
      "https://mcp-memes.polatoglu-sinan.workers.dev/icon.png",
      "https://mcp-memes.polatoglu-sinan.workers.dev/icon.svg",
    ]);
  });

});
