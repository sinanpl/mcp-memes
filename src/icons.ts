/**
 * The server icon as bytes, for HTTP hosts that serve it at a URL.
 *
 * Three paths, because a host asks for the icon in two different ways at two
 * different moments:
 *
 * - `/icon.png` and `/icon.svg` are what the `icons` in the initialize response
 *   point at (src/server.ts), so they only reach a host that has already
 *   connected. A URL rather than the inline `data:` URI because a pane that
 *   draws the server in a web page fetches the icon like any other image, and a
 *   remote `data:` image is what a page CSP drops.
 * - `/favicon.ico` is the one a host can ask for *before* connecting, when it
 *   has no initialize response to read: it has a URL and nothing else, so the
 *   only mark it can find is the origin's favicon. Without it there is nothing
 *   to show but a letter — which is what Claude's connector pane shows for an
 *   unconnected server. Whether that pane looks for a favicon is not something
 *   this repo can verify from the outside; serving one is ten lines and the
 *   only lever available before a connection exists.
 *
 * `.ico` carries PNG bytes. Every browser since IE11 accepts a PNG at that
 * path, and shipping a real ICO would mean a second encoder for one 256x256
 * image already baked in.
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

const png = (): IconAsset => ({ body: bytes(ICON_PNG_BASE64), contentType: "image/png" });

export const ICON_ASSETS: Record<string, IconAsset> = {
  [ICON_PATHS.png]: png(),
  [ICON_PATHS.svg]: { body: bytes(ICON_SVG_BASE64), contentType: "image/svg+xml" },
  // Served as image/png, not image/vnd.microsoft.icon: the bytes are a PNG and
  // saying otherwise only invites a stricter client to reject them.
  "/favicon.ico": png(),
};
