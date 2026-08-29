/**
 * Build-time only. Never imported by the server.
 *
 * memegen splits the data we need across two places: the API lists the
 * templates but not their geometry, and the geometry lives in each template's
 * config.yml in the git repo. This script joins the two into one flat
 * data/catalogue.json, which is committed and shipped with the function.
 *
 *   npm run sync-templates
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { loadImage } from "@napi-rs/canvas";
import { validateTemplate, type Box, type Template } from "../src/types.js";

const API = "https://api.memegen.link/templates/";
const CONFIG = (id: string) =>
  `https://raw.githubusercontent.com/jacebrowning/memegen/main/templates/${id}/config.yml`;

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "data", "catalogue.json");
const CACHE = path.join(ROOT, ".sync-cache");
const CONCURRENCY = 6;
const MISSING = "__404__";
const DIMS_CACHE = path.join(CACHE, "_dimensions.json");

type ApiTemplate = {
  id: string;
  name: string;
  lines: number;
  blank: string;
  source: string | null;
  keywords: string[] | null;
  example: { text: string[]; url: string } | null;
};

/** config.yml `text:` entries. Fields not listed here are deliberately out of scope. */
type YamlBox = {
  style?: string;
  color?: string;
  anchor_x?: number;
  anchor_y?: number;
  scale_x?: number;
  scale_y?: number;
  align?: string;
};

/** Fetch with an on-disk cache, so re-runs are cheap and offline-friendly. */
async function cachedFetch(url: string, key: string): Promise<string | null> {
  const file = path.join(CACHE, `${key}.txt`);
  if (existsSync(file)) {
    const cached = await readFile(file, "utf-8");
    return cached === MISSING ? null : cached;
  }
  const res = await fetch(url);
  if (res.status === 404) {
    await writeFile(file, MISSING);
    return null;
  }
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const body = await res.text();
  await writeFile(file, body);
  return body;
}

/**
 * Natural size of a blank image. memegen serves no dimensions and ignores
 * Range requests, so the only way to learn them is to decode the image — which
 * is exactly why this happens at build time and lands in the catalogue.
 */
async function imageSize(url: string, cache: Record<string, [number, number]>): Promise<[number, number]> {
  const hit = cache[url];
  if (hit) return hit;
  const img = await loadImage(url);
  const dims: [number, number] = [img.width, img.height];
  cache[url] = dims;
  return dims;
}

function toBox(raw: YamlBox): Box {
  const align = raw.align === "left" || raw.align === "right" ? raw.align : "center";
  return {
    x: raw.anchor_x ?? 0,
    y: raw.anchor_y ?? 0,
    w: raw.scale_x ?? 1,
    h: raw.scale_y ?? 0.2,
    align,
    color: raw.color ?? "white",
    upper: raw.style === "upper",
  };
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      const item = items[i];
      if (item === undefined) return;
      out[i] = await fn(item);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main(): Promise<void> {
  await mkdir(CACHE, { recursive: true });
  await mkdir(path.dirname(OUT), { recursive: true });

  const listBody = await cachedFetch(API, "_templates-index");
  if (listBody === null) throw new Error(`${API} returned 404`);
  const list = JSON.parse(listBody) as ApiTemplate[];
  console.log(`API listed ${list.length} templates`);

  const dims: Record<string, [number, number]> = existsSync(DIMS_CACHE)
    ? (JSON.parse(await readFile(DIMS_CACHE, "utf-8")) as Record<string, [number, number]>)
    : {};

  const skipped: string[] = [];
  const results = await mapLimited(list, CONCURRENCY, async (t): Promise<Template | null> => {
    const yamlText = await cachedFetch(CONFIG(t.id), t.id);
    if (yamlText === null) {
      skipped.push(`${t.id} (no config.yml)`);
      return null;
    }
    const cfg = parseYaml(yamlText) as { text?: YamlBox[] } | null;
    const textBoxes = cfg?.text;
    if (!Array.isArray(textBoxes) || textBoxes.length === 0) {
      skipped.push(`${t.id} (config.yml has no text: block)`);
      return null;
    }
    const boxes = textBoxes.map(toBox);
    const [width, height] = await imageSize(t.blank, dims);
    return {
      id: t.id,
      name: t.name,
      lines: boxes.length,
      blank: t.blank,
      width,
      height,
      example: t.example?.text ?? [],
      keywords: t.keywords ?? [],
      source: t.source ?? "",
      boxes,
    };
  });

  const templates = results
    .filter((t): t is Template => t !== null)
    .map((t, i) => validateTemplate(t, `template[${i}]`))
    .sort((a, b) => a.id.localeCompare(b.id));

  await writeFile(DIMS_CACHE, JSON.stringify(dims));
  await writeFile(OUT, `${JSON.stringify(templates)}\n`);

  console.log(`Wrote ${templates.length} templates to ${path.relative(ROOT, OUT)}`);
  console.log(`Skipped ${skipped.length}:`);
  for (const s of skipped) console.log(`  - ${s}`);
}

await main();
