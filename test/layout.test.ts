import { describe, expect, it } from "vitest";
import { layout, LAYOUT_CONSTANTS } from "../src/layout.js";
import type { Box } from "../src/types.js";

/**
 * A deterministic stand-in for real font metrics: every glyph is half an em
 * wide. Real measurement differs per environment; the layout rules do not.
 */
const measure = (s: string, fontPx: number): number => s.length * fontPx * 0.5;

const box = (overrides: Partial<Box> = {}): Box => ({
  x: 0,
  y: 0,
  w: 1,
  h: 0.2,
  align: "center",
  color: "white",
  upper: false,
  ...overrides,
});

const W = 600;
const H = 500;

describe("layout", () => {
  it("upper-cases the caption when the box asks for it", () => {
    const placed = layout("shrink to fit", box({ upper: true }), W, H, measure);
    expect(placed.map((l) => l.text).join(" ")).toBe("SHRINK TO FIT");
  });

  it("returns nothing for an empty caption", () => {
    expect(layout("   ", box(), W, H, measure)).toEqual([]);
  });

  describe("the text-size scale", () => {
    const caption = "one two three four five six seven";
    const b = box({ h: 0.3 });
    const at = (scale?: number) => layout(caption, b, W, H, measure, scale);

    it("defaults to the unscaled fit", () => {
      expect(at()).toEqual(at(1));
    });

    it("grows and shrinks the fitted size with the slider", () => {
      expect(at(1.5)[0]!.size).toBeGreaterThan(at(1)[0]!.size);
      expect(at(0.6)[0]!.size).toBeLessThan(at(1)[0]!.size);
    });

    const span = (placed: ReturnType<typeof layout>) => {
      const { LINE_HEIGHT, BASELINE_RATIO } = LAYOUT_CONSTANTS;
      const size = placed[0]!.size;
      const top = placed[0]!.baseline - BASELINE_RATIO * size;
      const height = placed.length * LINE_HEIGHT * size;
      return { top, bottom: top + height, centre: top + height / 2 };
    };

    it("keeps the block centred on the real box, so a big scale overhangs evenly", () => {
      const middle = box({ y: 0.35, h: 0.3 });
      const at2 = (scale: number) => layout(caption, middle, W, H, measure, scale);
      expect(span(at2(1.5)).centre).toBeCloseTo(span(at2(1)).centre, 6);
    });

    it("pulls an overhanging block back inside the picture", () => {
      // `b` sits at y = 0, so a 1.6x block would otherwise start above the frame.
      expect(span(at(1.6)).top).toBeGreaterThanOrEqual(0);
      expect(span(at(1.6)).bottom).toBeLessThanOrEqual(H);
    });

    it("never runs a line off the side of the box, however big the scale", () => {
      for (const line of at(1.6)) {
        expect(measure(line.text, line.size)).toBeLessThanOrEqual(W);
      }
    });

    it("falls back to the plain fit for a nonsense scale", () => {
      expect(at(0)).toEqual(at(1));
      expect(at(Number.NaN)).toEqual(at(1));
    });
  });

  it("wraps greedily and keeps every line inside the box width", () => {
    const placed = layout("one two three four five six seven", box({ h: 0.5 }), W, H, measure);
    expect(placed.length).toBeGreaterThan(1);
    for (const line of placed) {
      expect(measure(line.text, line.size)).toBeLessThanOrEqual(W);
    }
    // Greedy wrap fills each line before starting the next.
    expect(placed[0]!.text.startsWith("one two")).toBe(true);
  });

  it("steps the font size down until the block fits the box height", () => {
    const tall = layout("hi", box({ h: 0.2 }), W, H, measure);
    const long = layout(
      "a caption long enough that it has to wrap several times over",
      box({ h: 0.2 }),
      W,
      H,
      measure,
    );
    const boxH = 0.2 * H;
    expect(tall[0]!.size).toBeGreaterThan(long[0]!.size);
    const blockH = long.length * LAYOUT_CONSTANTS.LINE_HEIGHT * long[0]!.size;
    expect(blockH).toBeLessThanOrEqual(boxH);
  });

  it("never shrinks below the floor of 2% of image height", () => {
    const placed = layout("word ".repeat(400).trim(), box({ h: 0.05 }), W, H, measure);
    const floor = Math.max(1, Math.round(LAYOUT_CONSTANTS.MIN_SIZE_FRACTION * H));
    expect(placed[0]!.size).toBe(floor);
  });

  it("breaks a single over-wide word mid-word rather than letting it bleed out", () => {
    // 400 characters cannot fit 600px even at the 10px floor (200px per line).
    const placed = layout("x".repeat(400), box({ h: 0.05 }), W, H, measure);
    expect(placed.length).toBeGreaterThan(1);
    for (const line of placed) {
      expect(measure(line.text, line.size)).toBeLessThanOrEqual(W);
    }
    expect(placed.map((l) => l.text).join("")).toBe("x".repeat(400));
  });

  it("places baselines 0.82 of the size below each line top, one line height apart", () => {
    const placed = layout("alpha beta gamma delta epsilon zeta", box({ h: 0.4 }), W, H, measure);
    expect(placed.length).toBeGreaterThan(1);
    const size = placed[0]!.size;
    const lineHeight = LAYOUT_CONSTANTS.LINE_HEIGHT * size;

    // Successive baselines are exactly one line height apart.
    for (let i = 1; i < placed.length; i += 1) {
      expect(placed[i]!.baseline - placed[i - 1]!.baseline).toBeCloseTo(lineHeight, 6);
    }

    // The block is centred in the box, and the first baseline sits 0.82*size
    // below the first line's top.
    const blockH = placed.length * lineHeight;
    const firstTop = 0 + (0.4 * H - blockH) / 2;
    expect(placed[0]!.baseline).toBeCloseTo(firstTop + LAYOUT_CONSTANTS.BASELINE_RATIO * size, 6);
  });

  it("anchors x according to the box alignment", () => {
    const half = box({ x: 0.25, w: 0.5 });
    expect(layout("hi", { ...half, align: "left" }, W, H, measure)[0]!.x).toBe(150);
    expect(layout("hi", { ...half, align: "center" }, W, H, measure)[0]!.x).toBe(300);
    expect(layout("hi", { ...half, align: "right" }, W, H, measure)[0]!.x).toBe(450);
  });

  it("reports an outward outline and the doubled canvas lineWidth", () => {
    const placed = layout("hi", box(), W, H, measure);
    const line = placed[0]!;
    expect(line.outlinePx).toBeCloseTo(LAYOUT_CONSTANTS.OUTLINE_RATIO * line.size, 6);
    expect(line.strokeLineWidth).toBeCloseTo(2 * line.outlinePx, 6);
  });
});
