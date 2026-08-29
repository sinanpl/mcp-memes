import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../src/catalogue.js";
import { renderMeme } from "../src/render.js";

/**
 * A budget guard, not a layout test — src/layout.ts owns that. `dg` is the
 * largest image in the catalogue (1200x600), so it is the worst case.
 *
 * The first render pays DNS, TLS and whatever memegen's cache is doing, which
 * varies by seconds and is not ours to regress; the timed render is the second
 * one. The upstream fetch itself is bounded separately, by FETCH_TIMEOUT_MS in
 * src/render.ts.
 *
 * The ceiling is deliberately loose. It is here to catch a render that has
 * become seconds slower, well before it threatens the 10 s function limit.
 */
const BUDGET_MS = 4_000;

describe("renderMeme", () => {
  it(`renders the largest template within ${BUDGET_MS} ms`, async () => {
    const template = TEMPLATES.find((t) => t.id === "dg");
    if (!template) throw new Error("The catalogue no longer contains `dg`.");

    await renderMeme(template, template.example);

    const started = performance.now();
    const png = await renderMeme(template, template.example);
    const elapsed = performance.now() - started;

    // The PNG signature: proof we drew something, not that it looks right.
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(elapsed).toBeLessThan(BUDGET_MS);
  }, 30_000);
});
