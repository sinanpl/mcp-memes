import { describe, expect, it } from "vitest";
import { readWidgetHtml } from "../src/server.js";

/**
 * The build inlines the font and the script into widget/index.html. When a
 * substitution silently no-ops, the server still serves a plausible 700 KB page
 * and every host renders a dead editor — no error anywhere, on any side. These
 * assertions are the only place that failure is cheap to catch.
 */
describe("the built widget", () => {
  const html = readWidgetHtml();

  it("has no placeholder left in it", () => {
    expect(html).not.toContain("__SCRIPT__");
    expect(html).not.toContain("__FONT__");
  });

  it("carries the bundled font and a script that actually runs", () => {
    expect(html).toContain("data:font/ttf;base64,");
    // The bundle defines the editor's own entry points; a stub would not.
    expect(html).toContain("ui/initialize");
    expect(html.length).toBeGreaterThan(500_000);
  });
});
