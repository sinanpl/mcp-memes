/**
 * Server-side rendering, for hosts that cannot display an MCP App.
 *
 * This is the second caller of src/layout.ts. It contains no layout rules of
 * its own: it resolves a font metric, hands the callback to `layoutAll`, and
 * draws what comes back.
 */
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { layoutAll } from "./layout.js";
import { ANTON_TTF_BASE64 } from "./generated/assets.js";
import type { Template } from "./types.js";

export const FONT_FAMILY = "Anton";

/**
 * Register Anton explicitly rather than relying on system fontconfig. A
 * minimal container has nothing to fall back to — `GlobalFonts.families` comes
 * back empty, verified on a serverless deploy — so an unregistered face is not
 * a substitution but a blank render.
 *
 * The bytes are baked into the bundle rather than shipped beside it; see the
 * note in scripts/build-widget.mjs.
 */
function registerFont(): void {
  if (!GlobalFonts.register(Buffer.from(ANTON_TTF_BASE64, "base64"), FONT_FAMILY)) {
    throw new Error("Could not register the bundled Anton face.");
  }
}
registerFont();

function font(size: number): string {
  return `${size}px "${FONT_FAMILY}"`;
}

/**
 * How long to wait for the blank template image. Third-party latency gets a
 * bounded slice of the request rather than the whole budget, so a hung upstream
 * fails fast and explicitly instead of holding the caller open.
 */
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Fetch a blank template image ourselves rather than letting `loadImage`
 * resolve the URL, so the request carries a timeout we control.
 */
async function fetchBlank(url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    const reason = (err as Error).name === "TimeoutError" ? "timed out" : (err as Error).message;
    throw new Error(`Could not fetch the blank template at ${url}: ${reason}`);
  }
  if (!response.ok) {
    throw new Error(`Could not fetch the blank template at ${url}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Render one captioned meme as PNG bytes. */
export async function renderMeme(template: Template, texts: readonly string[]): Promise<Buffer> {
  const image = await loadImage(await fetchBlank(template.blank));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);

  const measure = (s: string, fontPx: number): number => {
    ctx.font = font(fontPx);
    return ctx.measureText(s).width;
  };

  const placed = layoutAll(texts, template.boxes, image.width, image.height, measure);
  draw(ctx, placed);

  return canvas.encode("png");
}

function draw(ctx: SKRSContext2D, placed: ReturnType<typeof layoutAll>): void {
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  for (const line of placed) {
    ctx.font = font(line.size);
    ctx.textAlign = line.align;
    // Stroke first, then fill, so the outline sits behind the glyph.
    ctx.strokeStyle = line.color === "black" ? "white" : "black";
    ctx.lineWidth = line.strokeLineWidth;
    ctx.strokeText(line.text, line.x, line.baseline);
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, line.x, line.baseline);
  }
}
