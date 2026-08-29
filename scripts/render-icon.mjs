/**
 * Renders assets/icon-256.png from assets/icon.svg.
 *
 * Kept out of `npm run build` on purpose. It shells out to rsvg-convert, which
 * is a Homebrew dependency that CI does not have and does not need: the PNG is
 * committed, so the build only ever reads it. Run this when the SVG changes.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SVG = path.join(ROOT, "assets", "icon.svg");
const PNG = path.join(ROOT, "assets", "icon-256.png");

try {
  execFileSync("rsvg-convert", ["-w", "256", "-h", "256", SVG, "-o", PNG], { stdio: "inherit" });
} catch (error) {
  if (error.code === "ENOENT") {
    throw new Error("rsvg-convert not found. brew install librsvg");
  }
  throw error;
}

console.log(`Wrote ${path.relative(ROOT, PNG)} from ${path.relative(ROOT, SVG)}`);
