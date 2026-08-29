/**
 * The editor. One self-contained page: no framework, no CDN.
 *
 * It imports src/layout.ts directly and contains no layout rules of its own —
 * every keystroke redraws locally through the same function the server renders
 * with, so no tool call and no model round-trip is involved in editing.
 */
import { App } from "@modelcontextprotocol/ext-apps";
import { layoutAll } from "../src/layout.js";
import type { Box } from "../src/types.js";

type AppTemplate = {
  id: string;
  name: string;
  lines: number;
  image: string;
  width: number;
  height: number;
  boxes: Box[];
};

/**
 * make_meme sends the full geometry with the picks, so the editor can draw
 * without calling back. Older results carried only id and texts; app_templates
 * is the fallback for those and for hosts that deliver a thinner result.
 */
type Pick = Partial<AppTemplate> & { id: string; texts: string[] };

/**
 * Anton is bundled as a data: URI, but a host may sandbox this page under a CSP
 * whose font-src omits data: — at least one shipping host does — and then the
 * face never arrives.
 * The stack degrades to whatever condensed face the platform has, which is what
 * a meme wants anyway, and the layout module measures whatever is actually in
 * use, so the captions still fit their boxes either way.
 */
const FONT = 'Anton, Impact, Haettenschweiler, "Arial Narrow Bold", "Franklin Gothic Bold", sans-serif';

const app = new App({ name: "mcp-memes-editor", version: "0.1.0" });

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const thumbsEl = el<HTMLDivElement>("thumbs");
const stageEl = el<HTMLCanvasElement>("stage");
const fieldsEl = el<HTMLDivElement>("fields");
const statusEl = el<HTMLParagraphElement>("status");
const copyBtn = el<HTMLButtonElement>("copy");
const scaleEl = el<HTMLInputElement>("scale");
const scaleValueEl = el<HTMLOutputElement>("scale-value");

const templates = new Map<string, AppTemplate>();
const captions = new Map<string, string[]>();
const images = new Map<string, HTMLImageElement>();
const thumbs = new Map<string, HTMLCanvasElement>();
let order: string[] = [];
let selected: string | null = null;
/**
 * The text-size slider, as a multiple of the auto-fitted size. One value for the
 * whole editor rather than one per template: the thumbnails are previews of the
 * same picture you are about to copy, so they follow the slider too.
 */
let scale = 1;

function setStatus(text: string, tone: "info" | "error" = "info"): void {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

/** memegen serves `access-control-allow-origin: *`, so the canvas stays untainted. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

function draw(canvas: HTMLCanvasElement, t: AppTemplate, texts: string[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = t.width;
  canvas.height = t.height;

  const img = images.get(t.id);
  if (img) ctx.drawImage(img, 0, 0, t.width, t.height);
  else {
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, t.width, t.height);
  }

  const measure = (s: string, fontPx: number): number => {
    ctx.font = `${fontPx}px ${FONT}`;
    return ctx.measureText(s).width;
  };

  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  for (const line of layoutAll(texts, t.boxes, t.width, t.height, measure, scale)) {
    ctx.font = `${line.size}px ${FONT}`;
    ctx.textAlign = line.align;
    // strokeText centres the stroke on the glyph outline, so the layout module
    // hands us a doubled width to get the outward thickness it specified.
    ctx.strokeStyle = line.color === "black" ? "white" : "black";
    ctx.lineWidth = line.strokeLineWidth;
    ctx.strokeText(line.text, line.x, line.baseline);
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, line.x, line.baseline);
  }
}

/** Every canvas on the page — the slider moves them all at once. */
function redrawAll(): void {
  redrawSelected();
  for (const [id, canvas] of thumbs) {
    if (id === selected) continue;
    const t = templates.get(id);
    if (t) draw(canvas, t, captions.get(id) ?? []);
  }
}

function redrawSelected(): void {
  if (!selected) return;
  const t = templates.get(selected);
  if (!t) return;
  const texts = captions.get(selected) ?? [];
  draw(stageEl, t, texts);
  const thumb = thumbs.get(selected);
  if (thumb) draw(thumb, t, texts);
}

function buildFields(): void {
  fieldsEl.replaceChildren();
  if (!selected) return;
  const t = templates.get(selected);
  if (!t) return;
  const texts = captions.get(selected) ?? [];

  for (let i = 0; i < t.lines; i += 1) {
    const wrap = document.createElement("label");
    wrap.className = "field";

    const name = document.createElement("span");
    name.textContent = t.lines === 1 ? "Caption" : `Caption ${i + 1}`;

    const input = document.createElement("input");
    input.type = "text";
    input.value = texts[i] ?? "";
    input.addEventListener("input", () => {
      const current = captions.get(t.id) ?? [];
      current[i] = input.value;
      captions.set(t.id, current);
      redrawSelected();
    });

    wrap.append(name, input);
    fieldsEl.append(wrap);
  }
}

function select(id: string): void {
  selected = id;
  for (const [tid, canvas] of thumbs) {
    canvas.parentElement?.classList.toggle("selected", tid === id);
  }
  buildFields();
  redrawSelected();
}

function buildThumbs(): void {
  thumbsEl.replaceChildren();
  thumbs.clear();
  for (const id of order) {
    const t = templates.get(id);
    if (!t) continue;

    const button = document.createElement("button");
    button.className = "thumb";
    button.title = t.name;
    button.addEventListener("click", () => select(id));

    const canvas = document.createElement("canvas");
    const caption = document.createElement("span");
    caption.textContent = t.name;

    button.append(canvas, caption);
    thumbsEl.append(button);
    thumbs.set(id, canvas);
    draw(canvas, t, captions.get(id) ?? []);
  }
}

/**
 * navigator.clipboard.write must be called synchronously within the click
 * handler's call stack, or Safari (and increasingly Chrome) silently treats
 * the write as not user-initiated and refuses it. stageEl.toBlob is
 * callback-based, so we can't `await` it first — instead we hand the write
 * call a Promise<Blob> directly, which the spec allows to resolve later
 * while the write() call itself still counts as synchronous.
 */
function copyToClipboard(): Promise<void> {
  const blob = new Promise<Blob>((resolve, reject) => {
    stageEl.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Could not read the canvas as a PNG."));
    }, "image/png");
  });
  return navigator.clipboard
    .write([new ClipboardItem({ "image/png": blob })])
    .then(() => setStatus("Copied the image to your clipboard."))
    .catch((err: unknown) => {
      // Image writes are permission-gated in some browsers; say so rather than
      // failing silently.
      setStatus(
        `Clipboard write was refused (${(err as Error).message}). Right-click the image and copy it instead.`,
        "error",
      );
    });
}

async function start(picks: Pick[]): Promise<void> {
  if (picks.length === 0) return;
  order = picks.map((p) => p.id);
  for (const p of picks) captions.set(p.id, [...p.texts]);

  const complete = (p: Pick): p is Pick & AppTemplate =>
    Array.isArray(p.boxes) && typeof p.image === "string" && typeof p.width === "number";

  let list: AppTemplate[];
  if (picks.every(complete)) {
    list = picks.map(({ texts: _texts, ...t }) => t as AppTemplate);
  } else {
    setStatus("Loading formats…");
    const result = await app.callServerTool({ name: "app_templates", arguments: { ids: order } });
    const structured = result.structuredContent as { templates?: AppTemplate[] } | undefined;
    list = structured?.templates ?? [];
  }
  if (list.length === 0) {
    setStatus("The server returned no template geometry.", "error");
    return;
  }
  for (const t of list) templates.set(t.id, t);

  // Draw first, wait for the webfont second. A font that never loads — blocked,
  // slow, or absent — must not be able to leave the editor blank, which is
  // exactly what awaiting it here used to do.
  buildThumbs();
  const first = order[0];
  if (first) select(first);
  setStatus("Edit any caption. The picture updates as you type.");

  void document.fonts
    .load(`100px Anton`)
    .then(() => {
      for (const [id, canvas] of thumbs) {
        const t = templates.get(id);
        if (t) draw(canvas, t, captions.get(id) ?? []);
      }
      redrawSelected();
    })
    .catch(() => {
      // The stack's fallbacks are already on the canvas; nothing to say.
    });

  // Images arrive after the first paint; redraw each thumbnail as it lands.
  await Promise.all(
    list.map(async (t) => {
      try {
        images.set(t.id, await loadImage(t.image));
      } catch {
        return;
      }
      const thumb = thumbs.get(t.id);
      if (thumb) draw(thumb, t, captions.get(t.id) ?? []);
      if (t.id === selected) redrawSelected();
    }),
  );
}

let started = false;
/**
 * The picks arrive as a one-shot notification. If it never comes the canvas
 * would sit blank and silent, which is indistinguishable from a broken render,
 * so say so instead.
 */
const BOOTSTRAP_TIMEOUT_MS = 5000;
setTimeout(() => {
  if (!started) {
    setStatus(
      "No tool result reached the editor, so there is nothing to draw. " +
        "This host may not deliver toolresult to apps.",
      "error",
    );
  }
}, BOOTSTRAP_TIMEOUT_MS);

app.addEventListener("toolresult", (params) => {
  if (started) return;
  const structured = params.structuredContent as { picks?: Pick[] } | undefined;
  const picks = structured?.picks;
  if (!Array.isArray(picks)) return;
  started = true;
  void start(picks).catch((err: unknown) => setStatus(`${(err as Error).message}`, "error"));
});

scaleEl.addEventListener("input", () => {
  scale = Number(scaleEl.value) || 1;
  scaleValueEl.textContent = `${Math.round(scale * 100)}%`;
  redrawAll();
});

copyBtn.addEventListener("click", () => {
  void copyToClipboard();
});

void app.connect().then(() => {
  app.setupSizeChangedNotifications();
});
