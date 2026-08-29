# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

An MCP server that hands a model a catalogue of meme formats, lets it pick five
and caption them, and opens a browser-side editor as the deliverable. Deployed as
a Cloudflare Worker. See [README.md](README.md) for the architecture and
[docs/deployment.md](docs/deployment.md) for the deploy.

## Build first, always

```bash
npm run build
```

`scripts/build-widget.mjs` bakes the editor, the Anton font and the server icon
into `src/generated/assets.ts`, and **that file is gitignored**. `src/server.ts` and
`src/render.ts` import it, so without a build nothing compiles and nothing runs —
not the tests, not the probe, not `wrangler deploy`. This is the single most
common way to be confused in this repo.

```bash
npm test          # vitest, ~30 tests
npm run typecheck # tsc --noEmit
```

## Invariants — do not break these

**One copy of the layout rules.** `src/layout.ts` is the only place layout logic
lives. It is bundled into the browser editor *and* imported by the Node renderer,
which is why what you edit is what you get. Never add layout maths to
`widget/main.ts` or `src/render.ts`; both must stay callers. `src/layout.ts` must
also stay pure — no DOM, no `node:` imports — because it runs in both. Text
measurement is injected for exactly that reason.

**No matching algorithm.** Choosing formats is the model's job, deliberately.
Do not add embedding search, scoring, or "best template" heuristics. The
catalogue is exposed as readable resources and the model picks. `resolveTemplate`
is identity mapping (an alias resolves to exactly one template or to nothing),
not fuzzy matching; `suggestTemplates` only produces error-message hints.

**The core is host-agnostic.** `src/server.ts` knows nothing about transports.
`src/worker.ts`, `src/http.ts` and `src/stdio.ts` are adapters over it. New host
support means a new adapter, never a change to the core. Only `src/http.ts` may
import express.

**The editor is the answer.** `make_meme` returns a deliberately content-free
line annotated `audience: ["user"], priority: 0.1`, and the picks travel in
`structuredContent` where the app reads them and the model does not. This is on
purpose: naming the formats in the text invites the model to list them back in
prose, which pushes the editor panel up out of the last turn. Do not "improve"
that message by making it informative.

**The Worker has no renderer.** `@napi-rs/canvas` is a native binary; a V8
isolate cannot load one. `render_meme` falls back to a memegen URL there. Do not
try to make it work — the trade is documented in `src/worker.ts` and
docs/deployment.md.

## Working on the editor

Claude is the reference host: it is where the MCP Apps editor is verified to
render, and it is what any change to `widget/` should ultimately be confirmed
against. Everything else degrades to `render_meme` and the text resources, which
the tests cover.

That said, do not *develop* against a real host — a blank editor tells you
nothing about which step failed.

```bash
npm run build && npm run preview:widget   # http://localhost:8099
```

`scripts/preview-widget.mjs` is a stand-in host: it speaks the app side of the
MCP Apps protocol and logs every message both ways. `--strict-csp` reproduces the
tighter sandbox some hosts apply.

For the server side as a host sees it:

```bash
npm run probe
```

## The catalogue

`data/catalogue.json` is **committed generated output** — a build-time join of
memegen's API and its per-template `config.yml` files. Edit
`scripts/sync-templates.ts` and re-run `npm run sync-templates`; never hand-edit
the JSON. Re-running is cheap: `.sync-cache/` holds the fetched sources.

It is validated at module load (`src/types.ts`), so a malformed catalogue fails
at startup rather than on the first request. Keep it that way.

## The icon

`assets/icon.svg` is the source; `assets/icon-256.png` is committed generated
output (`npm run render-icon`, needs `rsvg-convert`) so the build never needs
the renderer. Both are baked in and advertised as `icons` on the server's
`Implementation`. Do not swap in Trollface or a redraw of it —
[assets/ICON.md](assets/ICON.md) records why, with sources.

## Style

The existing code carries dense explanatory comments, and the standard is
specific: they say *why*, and they record what was actually verified rather than
what was assumed. Match that. A comment that restates the code is worse than
none.

Anything user-facing — tool descriptions, resource text, error messages — is
prose a model reads. Write it as instructions to a competent reader, not as
schema documentation.

## Deploying

```bash
npm run deploy    # build, then wrangler deploy
```

Never `wrangler deploy` alone: without the build it ships a stale
`src/generated/assets.ts` or fails outright. `.github/workflows/deploy.yml` runs
the build itself before deploying, which is why it may call `wrangler deploy`
directly. Full detail, limits and rollback in
[docs/deployment.md](docs/deployment.md).

Pushes to `main` deploy automatically. Deploying by hand is for out-of-band
fixes, not the normal path.

The deployment sits on Cloudflare's free plan: **100,000 requests/day**,
unauthenticated, no rate limiting. That is a deliberate, documented choice for a
public demo — but do not add anything that raises per-request cost without saying
so.

## Do not commit

`src/generated/`, `dist/`, `.sync-cache/`, `.wrangler/`, and any `*.jsonl` —
`MEMES_TRACE` output contains whatever users asked to be memed about.
