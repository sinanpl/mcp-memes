import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

/** A connected client/server pair over an in-memory transport, no build needed. */
async function connect(options: { iconBaseUrl?: string } = {}) {
  const server = createServer({ widgetHtml: "<!-- test -->", ...options });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("identity", () => {
  it("hands the host an icon, so it does not fall back to the letter M", async () => {
    const client = await connect();
    const icons = client.getServerVersion()?.icons ?? [];
    // Both formats, both inline: a stdio server has no origin to serve a URL from.
    expect(icons.map((i) => i.mimeType)).toEqual(["image/svg+xml", "image/png"]);
    for (const icon of icons) expect(icon.src).toMatch(/^data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+$/);
  });

  it("advertises fetchable URLs when the host has an origin", async () => {
    // Claude's connector pane paints the icon in a page whose CSP drops a data:
    // image from a remote server, so an HTTP host serves the bytes instead.
    const client = await connect({ iconBaseUrl: "https://sinan.pl/mcp-memes/" });
    const icons = client.getServerVersion()?.icons ?? [];
    expect(icons.map((i) => i.src)).toEqual([
      "https://sinan.pl/mcp-memes/icon.png",
      "https://sinan.pl/mcp-memes/icon.svg",
    ]);
    expect(icons[0].mimeType).toBe("image/png");
  });
});

const captions = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, ["a", "b", "c"]]));

describe("server", () => {
  it("offers list_formats, so ids reach a model that never reads resources", async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_formats");

    const result = await client.callTool({ name: "list_formats", arguments: {} });
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain("db — Distracted Boyfriend");
    expect(text.split("\n").length).toBeGreaterThan(200);
  });

  it("sends the geometry the editor needs with the picks", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "make_meme",
      arguments: { situation: "s", texts: captions(["db", "cmm", "ds", "fine", "stonks"]) },
    });
    const picks = (result.structuredContent as { picks: Record<string, unknown>[] }).picks;
    expect(picks).toHaveLength(5);
    expect(Object.keys(picks[0]).sort()).toEqual(
      ["boxes", "height", "id", "image", "lines", "name", "texts", "width"],
    );
  });

  it("names the closest real ids when a guessed one does not resolve", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "make_meme",
      arguments: { situation: "s", texts: captions(["sad-frog-crying", "cmm", "ds", "fine", "stonks"]) },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toContain("sad-frog-crying");
    expect(text).toContain("sadfrog");
    expect(text).toContain("list_formats");
  });

  it("accepts the name a format is known by as an id", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "make_meme",
      arguments: {
        situation: "s",
        texts: captions(["distracted-boyfriend", "two-buttons", "cmm", "fine", "stonks"]),
      },
    });
    expect(result.isError).toBeFalsy();
    const picks = (result.structuredContent as { picks: { id: string }[] }).picks;
    expect(picks.map((p) => p.id)).toEqual(["db", "ds", "cmm", "fine", "stonks"]);
  });

  it("still asks for exactly five formats", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "make_meme",
      arguments: { situation: "s", texts: captions(["db", "cmm"]) },
    });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toContain("exactly 5");
  });
});
