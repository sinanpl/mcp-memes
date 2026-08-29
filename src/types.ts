/** Geometry and metadata for one meme template, as baked into data/catalogue.json. */

/**
 * One text box on a template. All four coordinates are fractions of the image's
 * own width/height, exactly as memegen's `config.yml` stores them, so a box is
 * resolution-independent and the same numbers work for a thumbnail and a render.
 */
export type Box = {
  /** anchor_x — box left edge, fraction of image width. */
  x: number;
  /** anchor_y — box top edge, fraction of image height. */
  y: number;
  /** scale_x — box width, fraction of image width. */
  w: number;
  /** scale_y — box height, fraction of image height. */
  h: number;
  align: "left" | "center" | "right";
  /** "white", "black" or "#rrggbb". */
  color: string;
  /** config `style: upper` — caption is upper-cased before layout. */
  upper: boolean;
};

export type Template = {
  /** memegen id, e.g. "drake". */
  id: string;
  name: string;
  /** Number of caption slots; always equal to boxes.length. */
  lines: number;
  /** Un-captioned image URL on api.memegen.link. */
  blank: string;
  /**
   * Natural pixel size of the blank image, probed once at sync time.
   *
   * Not part of memegen's own data model. It is carried here because
   * `app_templates` is specified to hand the widget each format's dimensions,
   * and the only other ways to get them are a runtime fetch (which this server
   * does not do) or waiting for the browser to decode the image (which would
   * make the editor reflow on load).
   */
  width: number;
  height: number;
  /** memegen's own example captions — the model's main cue for what the format is for. */
  example: string[];
  keywords: string[];
  /** knowyourmeme (or similar) URL. */
  source: string;
  boxes: Box[];
};

const ALIGNS = new Set(["left", "center", "right"]);

function fail(what: string): never {
  throw new Error(`catalogue.json is malformed: ${what}`);
}

function validateBox(b: unknown, where: string): Box {
  if (typeof b !== "object" || b === null) fail(`${where} is not an object`);
  const o = b as Record<string, unknown>;
  for (const k of ["x", "y", "w", "h"]) {
    if (typeof o[k] !== "number" || !Number.isFinite(o[k])) fail(`${where}.${k} is not a finite number`);
  }
  if (typeof o.align !== "string" || !ALIGNS.has(o.align)) fail(`${where}.align is not left|center|right`);
  if (typeof o.color !== "string") fail(`${where}.color is not a string`);
  if (typeof o.upper !== "boolean") fail(`${where}.upper is not a boolean`);
  return o as Box;
}

/** Validate one raw record. Throws with a pointed message rather than returning null. */
export function validateTemplate(t: unknown, where: string): Template {
  if (typeof t !== "object" || t === null) fail(`${where} is not an object`);
  const o = t as Record<string, unknown>;
  for (const k of ["id", "name", "blank", "source"]) {
    if (typeof o[k] !== "string") fail(`${where}.${k} is not a string`);
  }
  for (const k of ["width", "height"]) {
    if (typeof o[k] !== "number" || !(o[k] as number > 0)) fail(`${where}.${k} is not a positive number`);
  }
  if (!Array.isArray(o.example)) fail(`${where}.example is not an array`);
  if (!Array.isArray(o.keywords)) fail(`${where}.keywords is not an array`);
  if (!Array.isArray(o.boxes) || o.boxes.length === 0) fail(`${where}.boxes is empty or missing`);
  const boxes = o.boxes.map((b, i) => validateBox(b, `${where}.boxes[${i}]`));
  if (o.lines !== boxes.length) fail(`${where}.lines (${String(o.lines)}) != boxes.length (${boxes.length})`);
  return { ...(o as unknown as Template), boxes };
}
