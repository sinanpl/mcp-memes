/**
 * A stdio client that drives the built server the way a host would, so the
 * whole flow can be checked without the desktop app in the loop: which tools a
 * host sees, what list_formats returns, the shape of a make_meme result, and
 * the error a guessed id produces.
 *
 *   node scripts/probe.mjs [trace-file]
 *
 * Passing a path turns on the MEMES_TRACE tee in the spawned server, which is
 * also how to capture the traffic of a real session — see README.md.
 */
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Resolved from this file, not from the working directory, so the probe runs
// from anywhere. Requires `npm run build` first.
const SERVER = path.resolve(import.meta.dirname, "..", "dist", "src", "stdio.js");

const trace = process.argv[2];
const client = new Client({ name: "probe", version: "0" }, { capabilities: {} });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [SERVER],
  // StdioClientTransport rejects undefined values, so only set MEMES_TRACE when
  // a path was actually given.
  env: { ...process.env, ...(trace ? { MEMES_TRACE: trace } : {}) },
}));

const tools = await client.listTools();
const info = client.getServerVersion();
console.log(
  "serverInfo: %s v%s, icons: %s",
  info.name,
  info.version,
  (info.icons ?? []).map((i) => `${i.mimeType} ${i.src.length} chars`).join(" + ") || "none",
);
console.log("tools:", tools.tools.map(t => t.name).join(", "));

const list = await client.callTool({ name: "list_formats", arguments: {} });
const text = list.content[0].text;
console.log("list_formats: %d chars, %d lines, header: %s", text.length, text.split("\n").length, text.split("\n")[0]);

// The ids a model would now be reading straight off that list.
const made = await client.callTool({
  name: "make_meme",
  arguments: {
    situation: "Shipping a demo MCP server on a free-tier quota",
    texts: { db: ["me", "the 100k/day free tier", "paying for compute"], cmm: ["", "the editor is the answer"], ds: ["read the docs", "guess the template id"], fine: ["", "six failing tool calls"], stonks: ["", "aliases"] },
  },
});
console.log("make_meme text:", made.content[0].text);
const picks = made.structuredContent.picks;
console.log("picks keys:", Object.keys(picks[0]).join(", "));
console.log("boxes on first pick:", picks[0].boxes.length, "image:", picks[0].image);

// The failure path a model hits when it guesses.
const bad = await client.callTool({
  name: "make_meme",
  arguments: { situation: "x", texts: { "distracted-boyfriend": ["a","b","c"], "sad-frog-crying": ["a","b"], cmm: ["","x"], ds: ["a","b"], fine: ["","y"] } },
});
console.log("guessed ids ->", bad.isError ? bad.content[0].text : "accepted: " + JSON.stringify(bad.structuredContent.picks.map(p=>p.id)));

const png = await client.callTool({ name: "render_meme", arguments: { template_id: "two-buttons", texts: ["read the docs", "guess the id"] } });
console.log("render_meme:", png.content[0].type, png.content[0].data ? png.content[0].data.length + " b64 chars" : png.content[0].text);
await client.close();
