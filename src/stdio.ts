/** Local development entrypoint: the same core server over stdio. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, readWidgetHtml } from "./server.js";
import { renderMeme } from "./render.js";
import { traceTransport } from "./trace.js";

const server = createServer({ widgetHtml: readWidgetHtml(), render: renderMeme });
// Set MEMES_TRACE=/path/to/trace.jsonl to record the JSON-RPC traffic.
await server.connect(traceTransport(new StdioServerTransport()));
