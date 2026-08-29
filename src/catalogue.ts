/**
 * The baked-in catalogue. data/catalogue.json is produced at build time by
 * scripts/sync-templates.ts; the running server makes no network calls to fetch
 * catalogue data.
 *
 * It is imported rather than read from disk so that it travels inside the
 * bundle. A Workers isolate has no filesystem to read from, so anything the
 * server needs at runtime has to be a compile-time value — see the note in
 * scripts/build-widget.mjs.
 *
 * Validated once, at module load, so a malformed catalogue fails the process at
 * startup rather than the first request.
 */
import raw from "../data/catalogue.json" with { type: "json" };
import { validateTemplate, type Template } from "./types.js";

function load(): Template[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("data/catalogue.json is not a non-empty array. Run: npm run sync-templates");
  }
  const validated = raw.map((t, i) => validateTemplate(t, `template[${i}]`));
  // The upstream catalogue lists a couple of formats twice (db, rollsafe).
  // Deduplicate on load so meme://templates does not offer the same format
  // twice as if it were two choices.
  const byId = new Map<string, Template>();
  for (const t of validated) if (!byId.has(t.id)) byId.set(t.id, t);
  return [...byId.values()];
}

export const TEMPLATES: readonly Template[] = load();

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

export function getTemplate(id: string): Template | undefined {
  return BY_ID.get(id);
}

export function templateIds(): string[] {
  return [...BY_ID.keys()];
}

/**
 * Ids in this catalogue are memegen's short codes (`db`, `cmm`, `ds`), which a
 * model that has not read meme://templates cannot guess — it reaches for the
 * name it knows the format by ("distracted-boyfriend"). Rather than fail those
 * calls, names and keywords are indexed as aliases. This is identity mapping,
 * not matching: an alias resolves to exactly one template or to nothing.
 */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A handful of formats are widely known under a name memegen does not use, so
 * the name alone never reaches them. Only entries where the popular name and
 * the catalogue name genuinely differ belong here.
 */
const EXTRA_ALIASES: Record<string, string> = {
  "two-buttons": "ds",
  "daily-struggle": "ds",
  "expanding-brain": "gb",
  "galaxy-brain": "gb",
  "drake-hotline-bling": "drake",
  "one-does-not-simply": "mordor",
  "left-exit-12": "exit",
  "x-everywhere": "buzz",
  "buzz-lightyear": "buzz",
};

const BY_ALIAS = new Map<string, Template>();
for (const t of TEMPLATES) {
  for (const alias of [slug(t.id), slug(t.name), ...t.keywords.map(slug)]) {
    // First writer wins, so a keyword shared by two formats never shadows a
    // format's own name.
    if (alias && !BY_ALIAS.has(alias)) BY_ALIAS.set(alias, t);
  }
}
for (const [alias, id] of Object.entries(EXTRA_ALIASES)) {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`Alias ${alias} points at missing template ${id}.`);
  BY_ALIAS.set(alias, t);
}

/** An exact id, or the slug of a format's name or one of its keywords. */
export function resolveTemplate(idOrName: string): Template | undefined {
  return BY_ID.get(idOrName) ?? BY_ALIAS.get(slug(idOrName));
}

/**
 * Near misses for an unresolvable id, so an error can name real ids instead of
 * only saying no. Scored on shared words with names and keywords.
 */
export function suggestTemplates(query: string, limit = 3): Template[] {
  const words = slug(query).split("-").filter((w) => w.length > 2);
  if (words.length === 0) return [];
  const scored = TEMPLATES.map((t) => {
    const hay = slug([t.name, ...t.keywords].join(" "));
    return { t, score: words.filter((w) => hay.includes(w)).length };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id));
  return scored.slice(0, limit).map((s) => s.t);
}
