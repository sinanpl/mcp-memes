/**
 * The server icon as bytes, for HTTP hosts that serve it at a URL.
 *
 * A host that shows the server in a web page (Claude's connector pane) fetches
 * the icon like any other image, so it has to exist at an https:// address; the
 * inline data: URIs in src/server.ts only get as far as hosts that render the
 * initialize response themselves. Both entrypoints that have an origin —
 * src/worker.ts and src/http.ts — serve these two paths, and pass the base URL
 * back into `createServer` so the advertised `icons` point here.
 *
 * The bytes come from the same baked constants the data: URIs use, so there is
 * still one source for the icon: assets/icon.svg and its rendered PNG.
 */
import { ICON_PATHS } from "./server.js";
import { ICON_PNG_BASE64, ICON_SVG_BASE64 } from "./generated/assets.js";

/**
 * atob rather than Buffer: this module is loaded in a V8 isolate too. The bytes
 * are handed on as an ArrayBuffer because that is the one body type both a
 * Workers `Response` and express's `send` take without a copy or a cast.
 */
const bytes = (base64: string): ArrayBuffer =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;

export type IconAsset = { body: ArrayBuffer; contentType: string };

/**
 * Immutable content at a stable path, so a host may cache it for a year. The
 * icon changing would be a deploy, and a deploy is free to change the path.
 */
export const ICON_CACHE_CONTROL = "public, max-age=31536000, immutable";

export const ICON_ASSETS: Record<string, IconAsset> = {
  [ICON_PATHS.png]: { body: bytes(ICON_PNG_BASE64), contentType: "image/png" },
  [ICON_PATHS.svg]: { body: bytes(ICON_SVG_BASE64), contentType: "image/svg+xml" },
};
