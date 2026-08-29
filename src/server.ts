/**
 * The server core: transport- and host-agnostic, so the local HTTP entrypoint,
 * the stdio entrypoint and the Workers handler all build the same server.
 *
 * There is deliberately no matching algorithm here. The catalogue is exposed as
 * readable resources and the model chooses from what it reads.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { TEMPLATES, getTemplate, resolveTemplate, suggestTemplates, templateIds } from "./catalogue.js";
import { LAYOUT_CONSTANTS } from "./layout.js";
import { ICON_PNG_BASE64, ICON_SVG_BASE64, WIDGET_HTML } from "./generated/assets.js";
import type { Template } from "./types.js";

export const UI_URI = "ui://memes/editor.html";
/** How many formats the model is asked to pick. */
export const PICKS = 5;

/**
 * The mark a host shows next to the server. Without it Claude Desktop falls
 * back to the first letter of the name, which is a grey "M".
 *
 * Two forms, chosen per host rather than per format:
 *
 * - `iconBaseUrl` given (any HTTP host — the Worker, `npm start`): the icons are
 *   advertised as absolute `https://` URLs the host fetches itself. Claude's
 *   connector pane renders the icon in a normal page, and a `data:` image from a
 *   remote server does not survive that page's CSP — which is why the inline
 *   form showed nothing there. PNG first: it is the form every host can paint.
 * - No base URL (stdio): inline `data:` URIs, because a stdio server has no
 *   origin to serve an image from and must still identify itself. Both formats
 *   are offered and the host picks; together they cost ~9 KB of the initialize
 *   response, paid once per connection.
 *
 * Drawn for this repo, deliberately not Trollface — assets/ICON.md has the
 * copyright reasoning.
 */
export const ICON_PATHS = { png: "/icon.png", svg: "/icon.svg" } as const;

function serverIcons(baseUrl?: string) {
  if (baseUrl) {
    const base = baseUrl.replace(/\/+$/, "");
    return [
      { src: `${base}${ICON_PATHS.png}`, mimeType: "image/png", sizes: ["256x256"] },
      { src: `${base}${ICON_PATHS.svg}`, mimeType: "image/svg+xml", sizes: ["any"] },
    ];
  }
  return [
    { src: `data:image/svg+xml;base64,${ICON_SVG_BASE64}`, mimeType: "image/svg+xml", sizes: ["any"] },
    { src: `data:image/png;base64,${ICON_PNG_BASE64}`, mimeType: "image/png", sizes: ["256x256"] },
  ];
}

/** Rendering is optional: hosts that only display the app never need it. */
export type RenderMeme = (template: Template, texts: readonly string[]) => Promise<Buffer>;

export type ServerOptions = {
  /** The bundled editor HTML. */
  widgetHtml: string;
  /**
   * Origin (optionally with a path prefix) the server is reachable at, e.g.
   * `https://sinan.pl/mcp-memes`. When given, the server icons are advertised as
   * URLs under it — `<base>/icon.png` and `<base>/icon.svg` — so the host must
   * serve those two paths. Omitted over stdio, where inline data URIs are used
   * instead.
   */
  iconBaseUrl?: string;
  /**
   * Server-side PNG renderer. When omitted, `render_meme` falls back to
   * returning a memegen image URL. The deployed Worker omits it — see
   * src/worker.ts.
   */
  render?: RenderMeme;
};

/**
 * The widget bundle produced by scripts/build-widget.mjs, baked into this
 * bundle at build time. Kept as a function so the entrypoints do not change.
 */
export function readWidgetHtml(): string {
  return WIDGET_HTML;
}

// --- resource bodies -------------------------------------------------------

/**
 * The list the model reads to choose. Terse on purpose: box geometry is the
 * whole catalogue's worth of coordinates that the model never reasons about,
 * so it lives in the per-template resource instead.
 */
function templatesIndexText(): string {
  const lines = TEMPLATES.map((t) => {
    const example = t.example.length > 0 ? t.example.join(" / ") : "(no example)";
    const keywords = t.keywords.length > 0 ? t.keywords.join(", ") : "-";
    return `${t.id} — ${t.name} — ${example} — ${keywords} — ${t.lines} lines`;
  });
  return [
    `${TEMPLATES.length} meme formats. Columns: id — name — example captions — keywords — caption slots.`,
    "Ids are short codes (db, cmm, ds), not the names memes are known by; a format's",
    "own name works as an id too, but nothing outside this list does.",
    "Read the example captions: they are the clearest signal of what joke shape a format carries.",
    "",
    ...lines,
  ].join("\n");
}

function templateDetailText(t: Template): string {
  const boxes = t.boxes.map((b, i) => {
    const bits = [
      `x=${b.x}`,
      `y=${b.y}`,
      `w=${b.w}`,
      `h=${b.h}`,
      `align=${b.align}`,
      `color=${b.color}`,
      `upper=${b.upper}`,
    ];
    return `  box ${i + 1}: ${bits.join(" ")}`;
  });
  return [
    `${t.id} — ${t.name}`,
    `source: ${t.source || "(none)"}`,
    `keywords: ${t.keywords.join(", ") || "-"}`,
    `example captions: ${t.example.join(" / ") || "(none)"}`,
    `blank image: ${t.blank} (${t.width}x${t.height} px)`,
    `caption slots: ${t.lines}`,
    "",
    "Box geometry. x and w are fractions of image width; y and h are fractions of",
    "image height. x,y is the top-left corner of the box; w,h its size. A box with",
    "upper=true has its caption upper-cased before layout. See meme://guide/layout",
    "for how a caption is fitted inside a box.",
    ...boxes,
  ].join("\n");
}

const LAYOUT_GUIDE = [
  "How a caption becomes pixels",
  "",
  "Every template's boxes are stored as fractions of the image's own width and",
  "height, so the same numbers describe a thumbnail and a full-size render. One",
  "layout module (src/layout.ts) turns a caption plus a box into placed lines, and",
  "both the in-app canvas editor and the server-side PNG renderer call it. That is",
  "why what you edit is what you get.",
  "",
  "The rules, in order:",
  "",
  `1. If the box says upper, the caption is upper-cased first. Capitals vary far`,
  "   less in width, which makes the auto-fit predictable.",
  "2. The box is resolved to pixels: x*width, y*height, w*width, h*height.",
  "3. The font starts at the box's own height in pixels and steps down 1px at a",
  "   time until a greedy word wrap fits the box in both dimensions, or a floor of",
  `   ${LAYOUT_CONSTANTS.MIN_SIZE_FRACTION * 100}% of image height is reached. Shrinking beats overflowing: an`,
  "   overflowing caption covers the picture.",
  `4. Line height is ${LAYOUT_CONSTANTS.LINE_HEIGHT}x the font size, and the block of lines is centred`,
  "   vertically inside the box.",
  "5. A single word still too wide at the floor size is broken mid-word rather",
  "   than allowed to bleed outside the frame.",
  `6. The outline is ${LAYOUT_CONSTANTS.OUTLINE_RATIO}x the font size, measured outwards from the glyph. A`,
  "   canvas caller must double that for lineWidth, because strokeText centres the",
  "   stroke on the glyph outline. Stroke first, then fill.",
  `7. Positions come back as baselines, not tops: baseline = lineTop + ${LAYOUT_CONSTANTS.BASELINE_RATIO} * size.`,
  "   Both callers anchor to the baseline, so identical input lands on the",
  "   identical pixel row.",
  "",
  "The typeface is Anton, used under the SIL Open Font License. memegen's own",
  "'thick' font is Impact, which is proprietary and is not redistributed here.",
].join("\n");

// --- server ----------------------------------------------------------------

export function createServer(options: ServerOptions): McpServer {
  const server = new McpServer(
    { name: "mcp-memes-ts", version: "0.1.0", title: "Memes", icons: serverIcons(options.iconBaseUrl) },
    {
      capabilities: { resources: {}, tools: {}, prompts: {}, completions: {} },
      instructions:
        "A situation-aware meme editor. Call list_formats, pick five formats whose joke " +
        "shape fits the user's situation, write the captions yourself, and call make_meme. " +
        "On a host that renders MCP Apps the editor IS the deliverable: it opens with all " +
        "five captioned and the person edits and copies from it, so do not describe or list " +
        "the memes afterwards — end the turn on the tool call.",
    },
  );

  registerResources(server);
  registerPrompt(server);
  registerTools(server, options);
  return server;
}

function registerResources(server: McpServer): void {
  server.registerResource(
    "meme-templates",
    "meme://templates",
    {
      title: "Meme formats",
      description:
        "Every meme format: id, name, example captions, keywords and caption-slot count. " +
        "The same list the list_formats tool returns, for hosts that surface resources to " +
        "the user. Box geometry lives in meme://templates/{template_id}.",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/plain", text: templatesIndexText() }],
    }),
  );

  server.registerResource(
    "meme-template",
    new ResourceTemplate("meme://templates/{template_id}", {
      list: undefined,
      complete: {
        template_id: (value) => {
          const q = value.toLowerCase();
          return templateIds()
            .filter((id) => id.startsWith(q))
            .slice(0, 100);
        },
      },
    }),
    {
      title: "Meme format detail",
      description: "One format in full, including the complete box geometry.",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const id = String(variables.template_id);
      const t = getTemplate(id);
      if (!t) throw new Error(`Unknown template id: ${id}`);
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: templateDetailText(t) }] };
    },
  );

  server.registerResource(
    "meme-layout-guide",
    "meme://guide/layout",
    {
      title: "Layout contract",
      description: "How a caption is fitted into a box, in words, so the geometry is interpretable.",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/plain", text: LAYOUT_GUIDE }],
    }),
  );
}

function registerPrompt(server: McpServer): void {
  server.registerPrompt(
    "meme_this",
    {
      title: "Meme this situation",
      description: `Pick ${PICKS} meme formats for a situation and caption each one.`,
      argsSchema: { situation: z.string().describe("The situation to make memes about.") },
    },
    ({ situation }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Situation: ${situation}`,
              "",
              `Call list_formats. Pick ${PICKS} formats whose joke shape fits this`,
              "situation, spread across different shapes rather than five variations of one:",
              "a comparison format and a slow-realisation format carry different jokes, five",
              "two-panel comparisons do not.",
              "",
              "Judge a format by its name and its example captions. If you want to know exactly",
              "where the text will sit, read meme://templates/{template_id} for that format.",
              "",
              `Then write the captions yourself — one string per caption slot, in order — and`,
              "call make_meme with the situation and a texts object mapping each template id to",
              "its captions. Keep captions short: they are set in a small box over a picture.",
              "",
              "The editor that opens is the answer. Do not summarise it afterwards.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

/** The shape the editor draws from: geometry, dimensions and the blank image. */
function appTemplate(t: Template) {
  return {
    id: t.id,
    name: t.name,
    lines: t.lines,
    image: t.blank,
    width: t.width,
    height: t.height,
    boxes: t.boxes,
  };
}

/** Name an unresolvable id together with the closest real ids, so a retry can succeed. */
function describeUnknownId(id: string): string {
  const near = suggestTemplates(id);
  if (near.length === 0) return id;
  return `${id} (did you mean ${near.map((t) => `${t.id} = ${t.name}`).join(", ")}?)`;
}

/** Resolve caller-supplied captions against the catalogue, or explain what is wrong. */
function resolvePicks(texts: Record<string, string[]>): { template: Template; texts: string[] }[] {
  const ids = Object.keys(texts);
  const unknown = ids.filter((id) => !resolveTemplate(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown template ids: ${unknown.map(describeUnknownId).join("; ")}. ` +
        "Call list_formats and use ids from that list.",
    );
  }
  return ids.map((id) => {
    const template = resolveTemplate(id) as Template;
    const given = texts[id] ?? [];
    // Pad or trim to the format's slot count so a caption never lands in a box
    // the template does not have.
    const slots = Array.from({ length: template.lines }, (_, i) => given[i] ?? "");
    return { template, texts: slots };
  });
}

function registerTools(server: McpServer, options: ServerOptions): void {
  registerAppResource(
    server,
    "Meme editor",
    UI_URI,
    { description: "Five captioned memes, with a live editor and a copy button." },
    async () => ({
      contents: [
        {
          uri: UI_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: options.widgetHtml,
          _meta: {
            ui: {
              // The editor loads blank template images straight from memegen.
              // Without this the host CSP blocks them and the canvas stays empty.
              csp: { resourceDomains: ["https://api.memegen.link"] },
              // "Copy image" writes a PNG to the clipboard.
              permissions: { clipboardWrite: {} },
              // Hosts differ on the default, and an editor reads as a panel, not
              // as inline prose.
              prefersBorder: true,
            },
          },
        },
      ],
    }),
  );

  server.registerTool(
    "list_formats",
    {
      title: "List meme formats",
      description:
        "Every meme format with its id, name, example captions and caption-slot count. " +
        "Call this before make_meme: ids are memegen short codes (db, cmm, ds) and cannot " +
        "be guessed from the name a meme is known by. Same content as meme://templates, " +
        "for hosts that do not put resources in front of the model.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: templatesIndexText() }],
    }),
  );

  registerAppTool(
    server,
    "make_meme",
    {
      title: "Make memes",
      description:
        `Open the meme editor with ${PICKS} captioned formats. Call list_formats first, ` +
        `pick ${PICKS} formats that fit the situation, and write the captions yourself: one ` +
        "string per caption slot, in order. Ids are short codes (db, cmm, ds) — do not guess " +
        "them from a meme's popular name.",
      inputSchema: {
        situation: z.string().describe("The situation the memes are about."),
        texts: z
          .record(z.string(), z.array(z.string()))
          .describe(`Template id -> captions, one entry per caption slot. Exactly ${PICKS} templates.`),
      },
      _meta: { ui: { resourceUri: UI_URI, visibility: ["model", "app"] } },
    },
    async ({ situation, texts }) => {
      const count = Object.keys(texts).length;
      if (count !== PICKS) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `make_meme needs exactly ${PICKS} templates, got ${count}. Pick ${PICKS} different formats.`,
            },
          ],
        };
      }
      let picks;
      try {
        picks = resolvePicks(texts);
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
      }
      // Everything the editor needs to draw, so a host that never lets the app
      // call back still renders. app_templates stays as the fallback path.
      const structuredContent = {
        situation,
        picks: picks.map((p) => ({
          ...appTemplate(p.template),
          texts: p.texts,
        })),
      };
      // The editor is the deliverable and the person is already looking at it.
      // Naming the formats here only invites the model to list them back in
      // prose, which pushes the panel up out of the last turn; the picks stay in
      // structuredContent, which the app reads and the model does not. The
      // annotation says the same thing in protocol terms: this line is for the
      // person, and there is nothing in it to build on.
      return {
        content: [
          {
            type: "text",
            text: "The editor is open. It is the whole answer — say nothing further.",
            annotations: { audience: ["user"], priority: 0.1 },
          },
        ],
        structuredContent,
      };
    },
  );

  registerAppTool(
    server,
    "app_templates",
    {
      title: "Template geometry (app only)",
      description: "Geometry, dimensions and image URLs for the given template ids.",
      inputSchema: { ids: z.array(z.string()).describe("Template ids to describe.") },
      // App-only: this is plumbing for the editor and never belongs in the
      // model's tool list.
      _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
    },
    async ({ ids }) => {
      const templates = ids.map((id) => {
        const t = resolveTemplate(id);
        if (!t) throw new Error(`Unknown template id: ${id}`);
        return appTemplate(t);
      });
      const payload = { templates };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    "render_meme",
    {
      title: "Render a meme",
      description:
        "Render one captioned meme server-side and return the PNG. The fallback for hosts " +
        "that cannot display the editor.",
      inputSchema: {
        template_id: z.string().describe("A template id from list_formats."),
        texts: z.array(z.string()).describe("One caption per caption slot, in order."),
      },
    },
    async ({ template_id, texts }) => {
      const template = resolveTemplate(template_id);
      if (!template) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Unknown template id: ${describeUnknownId(template_id)}. Call list_formats for valid ids.`,
            },
          ],
        };
      }
      const slots = Array.from({ length: template.lines }, (_, i) => texts[i] ?? "");
      if (!options.render) {
        // No renderer on this deployment: hand back memegen's own image URL.
        return {
          content: [{ type: "text", text: memegenUrl(template, slots) }],
        };
      }
      const png = await options.render(template, slots);
      return {
        content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }],
      };
    },
  );
}

/** memegen's URL encoding for captions: see https://api.memegen.link. */
export function memegenUrl(template: Template, texts: readonly string[]): string {
  const parts = texts.map((t) => {
    const escaped = t
      .replace(/_/g, "__")
      .replace(/-/g, "--")
      .replace(/ /g, "_")
      .replace(/\?/g, "~q")
      .replace(/&/g, "~a")
      .replace(/%/g, "~p")
      .replace(/#/g, "~h")
      .replace(/\//g, "~s")
      .replace(/\\/g, "~b")
      .replace(/</g, "~l")
      .replace(/>/g, "~g")
      .replace(/"/g, "''");
    return encodeURIComponent(escaped) || "_";
  });
  return `https://api.memegen.link/images/${template.id}/${parts.join("/")}.png`;
}
