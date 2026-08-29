/**
 * The shared layout module — the one place the meme layout rules live.
 *
 * Pure functions only: no DOM, no Node APIs. The identical file is bundled into
 * the browser widget and imported by the server renderer, so a caption typed in
 * the editor lands on the same pixel row as the caption baked into a PNG.
 * Text measurement is injected, because that is the only part that genuinely
 * differs between the two environments.
 */
import type { Box } from "./types.js";

/** Measures the advance width of `s` when drawn at `fontPx` in the meme font. */
export type Measure = (s: string, fontPx: number) => number;

export type PlacedLine = {
  /** The text to draw, already upper-cased if the box asks for it. */
  text: string;
  /** Anchor x in pixels. Its meaning follows `align`, matching canvas `textAlign`. */
  x: number;
  /** Baseline y in pixels. Draw with `textBaseline = "alphabetic"`. */
  baseline: number;
  /** Font size in pixels. */
  size: number;
  align: Box["align"];
  color: string;
  /** Outline thickness measured *outwards* from the glyph edge. */
  outlinePx: number;
  /**
   * What a `<canvas>` caller must set as `lineWidth`: `strokeText` centres the
   * stroke on the outline, so half of it falls inside the glyph. Passing
   * `outlinePx` here would give a half-thickness outline — the difference
   * between a meme and text on a picture. Stroke first, then fill.
   */
  strokeLineWidth: number;
};

/** Font size never drops below this fraction of image height. */
const MIN_SIZE_FRACTION = 0.02;
/** Line height as a multiple of font size. */
const LINE_HEIGHT = 1.08;
/** Baseline offset from the top of a line, as a multiple of font size. */
const BASELINE_RATIO = 0.82;
/** Outward outline thickness as a multiple of font size. */
const OUTLINE_RATIO = 0.07;

export const LAYOUT_CONSTANTS = {
  MIN_SIZE_FRACTION,
  LINE_HEIGHT,
  BASELINE_RATIO,
  OUTLINE_RATIO,
} as const;

/**
 * Greedy word wrap at a fixed size. Words that do not fit on their own are
 * broken mid-word rather than allowed to bleed outside the frame.
 */
function wrap(text: string, maxW: number, size: number, measure: Measure, breakWords: boolean): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.length > 0) {
      lines.push(current);
      current = "";
    }
  };

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (measure(candidate, size) <= maxW) {
      current = candidate;
      continue;
    }
    pushCurrent();
    if (measure(word, size) <= maxW) {
      current = word;
      continue;
    }
    // Word is wider than the box on its own.
    if (!breakWords) {
      // Signal non-fit to the auto-fit loop by keeping it on its own line.
      lines.push(word);
      continue;
    }
    let rest = word;
    while (rest.length > 0 && measure(rest, size) > maxW) {
      let take = 1;
      while (take < rest.length && measure(rest.slice(0, take + 1), size) <= maxW) take += 1;
      lines.push(rest.slice(0, take));
      rest = rest.slice(take);
    }
    current = rest;
  }
  pushCurrent();
  return lines;
}

function widest(lines: string[], size: number, measure: Measure): number {
  let max = 0;
  for (const line of lines) max = Math.max(max, measure(line, size));
  return max;
}

/**
 * Lay a caption out inside one box.
 *
 * The rules, in order:
 *  1. Upper-case when the box says so — capitals vary far less in width, which
 *     makes the auto-fit predictable.
 *  2. Resolve the box to pixels against the image's real dimensions.
 *  3. Start at a font size of the box's own height and step down 1px at a time
 *     until a greedy word wrap fits in *both* dimensions, or the floor of
 *     2% of image height is hit. Shrinking beats overflowing: an overflowing
 *     caption covers the picture.
 *  4. Line height is 1.08x the size; the block is centred vertically in the box.
 *  5. At the floor size an over-wide word is broken mid-word.
 *  6. Outline is 0.07x the size, outwards (see `strokeLineWidth`).
 *  7. Baselines, not tops, are returned: both callers anchor to the baseline so
 *     identical input lands on the identical pixel row.
 *
 * `scale` is the editor's text-size slider. It stretches the *height* the
 * auto-fit measures against, so above 1 the caption keeps growing past the size
 * that fits exactly, wrapping into more lines and overhanging the box evenly
 * above and below — it stays centred on the real box. The width stays the real
 * box width at every scale: vertical overhang reads as a deliberately big
 * caption, but horizontal overhang runs words off the side of the picture. The
 * floor and the outline ratio are untouched — a slider is a preference, not a
 * licence to render a caption too small to read.
 */
export function layout(
  text: string,
  box: Box,
  imgW: number,
  imgH: number,
  measure: Measure,
  scale = 1,
): PlacedLine[] {
  const caption = box.upper ? text.toUpperCase() : text;
  if (caption.trim().length === 0) return [];

  const bx = box.x * imgW;
  const by = box.y * imgH;
  const bw = box.w * imgW;
  const bh = box.h * imgH;

  // A garbled scale must not blank the caption, so fall back to the fitted size.
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const fitH = bh * k;

  const floor = Math.max(1, Math.round(MIN_SIZE_FRACTION * imgH));
  const start = Math.max(floor, Math.round(fitH));

  let size = start;
  let lines: string[] = [];
  for (; size > floor; size -= 1) {
    lines = wrap(caption, bw, size, measure, false);
    const fitsWidth = widest(lines, size, measure) <= bw;
    const fitsHeight = lines.length * LINE_HEIGHT * size <= fitH;
    if (fitsWidth && fitsHeight) break;
  }
  if (size <= floor) {
    // Floor reached: break over-wide words rather than let them bleed out.
    size = floor;
    lines = wrap(caption, bw, size, measure, true);
  }

  const blockH = lines.length * LINE_HEIGHT * size;
  // Centred on the box, then nudged back inside the picture. At scale 1 the block
  // never exceeds its box, so the clamp is a no-op and baked PNGs are unchanged;
  // above 1 it stops the overhang from sliding a line off the top or bottom edge.
  const centred = by + (bh - blockH) / 2;
  const firstTop = blockH >= imgH ? 0 : Math.min(Math.max(centred, 0), imgH - blockH);
  const anchorX = box.align === "left" ? bx : box.align === "right" ? bx + bw : bx + bw / 2;
  const outlinePx = OUTLINE_RATIO * size;

  return lines.map((line, i) => ({
    text: line,
    x: anchorX,
    baseline: firstTop + i * LINE_HEIGHT * size + BASELINE_RATIO * size,
    size,
    align: box.align,
    color: box.color,
    outlinePx,
    strokeLineWidth: 2 * outlinePx,
  }));
}

/** The whole of a template's captions, one entry per box. Extra captions are ignored. */
export function layoutAll(
  texts: readonly string[],
  boxes: readonly Box[],
  imgW: number,
  imgH: number,
  measure: Measure,
  scale = 1,
): PlacedLine[] {
  return boxes.flatMap((box, i) => layout(texts[i] ?? "", box, imgW, imgH, measure, scale));
}
