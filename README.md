# mcp-memes

[![Deploy](https://github.com/sinanpl/mcp-memes/actions/workflows/deploy.yml/badge.svg)](https://github.com/sinanpl/mcp-memes/actions/workflows/deploy.yml)

A situation-aware meme editor, served over the [Model Context Protocol](https://modelcontextprotocol.io).

Describe a situation. The model reads a catalogue of 209 meme formats, picks five
whose *joke shape* fits, writes the captions itself, and opens an editor with all
five already captioned. You tweak the text and copy the image out.

The editor is the deliverable — not a paragraph describing memes it might make.

```
MCP endpoint:  POST https://sinan.pl/mcp-memes/mcp
               POST https://mcp-memes.polatoglu-sinan.workers.dev/mcp
```

## What is interesting about it

**No matching algorithm.** There is no embedding search, no keyword scorer, no
"which template is funniest" heuristic anywhere in this repo. The catalogue is
exposed as readable MCP resources — id, name, example captions, keywords — and
the model chooses from what it reads. The example captions do the work: they are
the clearest signal of what joke a format carries. Choosing is the one thing the
model is genuinely better at than a scoring function, so it is the one thing left
to the model.

**One copy of the layout rules.** [`src/layout.ts`](src/layout.ts) is pure
functions with text measurement injected. The identical file is bundled into the
browser editor and imported by the server-side PNG renderer, so a caption typed
in the editor lands on the same pixel row as one baked into a PNG. The rules are
also published to the model as a plain-prose resource (`meme://guide/layout`), so
the geometry it reads is interpretable rather than opaque coordinates.

**The editor does not call home.** Every keystroke redraws locally through that
same layout function. No tool call, no model round-trip, no server render while
you type.

**Ids the model cannot guess, handled.** memegen's ids are short codes — `db`,
`cmm`, `ds` — and a model reaches for the name it knows a format by
("distracted-boyfriend"). Names and keywords are indexed as aliases, and an
unresolvable id comes back naming the closest real ones, so a retry can succeed.

## Architecture

One transport-agnostic core, three thin adapters:

```
                     src/server.ts          the MCP server: resources, prompt, tools
                          │
      ┌───────────────────┼───────────────────┐
      │                   │                   │
 src/worker.ts       src/http.ts         src/stdio.ts
 Cloudflare Workers  express, local      stdio, local
 (deploy target)     (MCP Inspector)     (desktop hosts)
      │
 src/web.ts          Request -> Response MCP handler, host-agnostic
```

| File | What it is |
| --- | --- |
| [`src/server.ts`](src/server.ts) | The core. Resources, the `meme_this` prompt, and the four tools. Knows nothing about transports or hosts. |
| [`src/layout.ts`](src/layout.ts) | The only copy of the layout rules. Pure; measurement injected. |
| [`src/render.ts`](src/render.ts) | Server-side PNG rendering via `@napi-rs/canvas`. Optional — see below. |
| [`src/catalogue.ts`](src/catalogue.ts) | Loads and validates `data/catalogue.json` at module load; builds the alias index. |
| [`src/icons.ts`](src/icons.ts) | The server icon as bytes, for the entrypoints that serve it at a URL. |
| [`src/web.ts`](src/web.ts) | A `Request -> Response` MCP endpoint. Stateless: one server per request, one JSON body out. |
| [`src/worker.ts`](src/worker.ts) | Cloudflare Workers entrypoint. The deploy target. |
| [`widget/main.ts`](widget/main.ts) | The editor. No framework, no CDN, one self-contained page. |
| [`scripts/sync-templates.ts`](scripts/sync-templates.ts) | Build-time only. Joins memegen's API and its `config.yml` files into `data/catalogue.json`. |
| [`scripts/build-widget.mjs`](scripts/build-widget.mjs) | Bakes the editor and the font into `src/generated/assets.ts`. Runs before `tsc`. |

### MCP surface

**Tools**

| Tool | For | Does |
| --- | --- | --- |
| `list_formats` | model | The whole catalogue: id, name, example captions, keywords, slot count. |
| `make_meme` | model | Opens the editor with exactly five captioned formats. |
| `app_templates` | app only | Geometry for given ids. Plumbing for the editor; never in the model's tool list. |
| `render_meme` | model | One meme rendered server-side as PNG. The fallback for hosts that cannot display an app. |

**Resources** — `meme://templates` (the index), `meme://templates/{id}` (one
format with full box geometry), `meme://guide/layout` (how a caption becomes
pixels).

**Prompt** — `meme_this(situation)`.

**Identity** — the server advertises `icons` on its `Implementation`, so a host
shows the mark rather than the first letter of the name. Both an SVG and a
256px PNG, inline as `data:` URIs because a stdio server has no origin to serve
an image from. Source in [`assets/icon.svg`](assets/icon.svg);
[`assets/ICON.md`](assets/ICON.md) covers regenerating it — and why it is not
the meme face you would expect.

### The rendering trade

`render_meme` has two behaviours, and which one you get depends on the host:

- **Node** (`src/http.ts`, `src/stdio.ts`) renders a real PNG with
  `@napi-rs/canvas`.
- **The deployed Worker** returns a [memegen](https://api.memegen.link) image URL
  instead. `@napi-rs/canvas` is a native Skia binary and a V8 isolate cannot load
  one.

This is deliberate rather than a limitation worked around. The editor renders in
the browser either way, so on the path that matters nothing is lost — and image
bytes stay off the Worker's egress entirely. `render_meme` is the fallback for
hosts with no app support; on those, a URL is still a usable answer.

## Host support

Built and tested against **Claude**, which is where the MCP Apps editor is
verified to render — the captioned panel, live re-layout on every keystroke, and
copy-to-clipboard.

The server does not require any of that. It degrades in defined steps:

| The host can... | What you get |
| --- | --- |
| render MCP Apps | The editor. The intended experience. |
| call tools only | `render_meme` — one meme at a time, as a PNG or an image URL. |
| read resources | `meme://templates` and the layout guide as plain text. |

`list_formats` exists precisely because some hosts never put resources in front
of the model, and `app_templates` is marked app-visibility-only so it stays out
of the model's tool list on hosts that would otherwise show it.

## Use it

### Against the deployed server

Point an MCP client at the HTTP endpoint:

```
https://sinan.pl/mcp-memes/mcp
```

That is a front door onto the Worker, which also answers directly at
`https://mcp-memes.polatoglu-sinan.workers.dev/mcp`. Both addresses reach the
same deployment; the Worker routes the vanity path prefix itself, so nothing has
to be rewritten on the way in. What the front door must *not* be is a 301 or a
302: MCP is POST-only, and those turn a POST into a GET. See
[docs/deployment.md](docs/deployment.md#the-vanity-url).

This endpoint is unauthenticated and runs on Cloudflare's free plan, which stops
serving at 100,000 requests a day. It is a demo over a public catalogue of public
images — treat it as best-effort, and deploy your own if you want a guarantee.
See [docs/deployment.md](docs/deployment.md).

### Locally, over stdio

```bash
npm install && npm run build
```

Then point a desktop MCP host at `node /absolute/path/to/dist/src/stdio.js`. This
is the path that gets you the real server-side PNG renderer, since Node can load
`@napi-rs/canvas`.

### Locally, over HTTP

```bash
npm run build && npm start
```

Serves `POST http://localhost:8080/mcp` — for the MCP Inspector or `curl`. Set
`PORT` / `HOST` to change where.

## Develop

| Command | Does |
| --- | --- |
| `npm run build` | Bakes the widget and font into `src/generated/`, then compiles. Required before anything else. |
| `npm test` | Vitest: layout geometry, catalogue resolution, server contract, the built widget. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run dev:worker` | `wrangler dev` — the Worker locally. |
| `npm run deploy` | Build, then `wrangler deploy`. |
| `npm run probe` | Drives the built stdio server as a host would, and prints what a host sees. |
| `npm run preview:widget` | A stand-in host for the editor on `:8099`, with both sides of the protocol logged. |
| `npm run sync-templates` | Rebuilds `data/catalogue.json` from memegen. Rarely needed; the output is committed. |
| `npm run render-icon` | Re-renders `assets/icon-256.png` from the SVG. Needs `rsvg-convert`; the PNG is committed, so the build never calls it. |

Requires Node 22+.

### Debugging a real session

Host connector logs record *that* a `tools/call` happened and nothing about what
was in it, which makes "the model sent the wrong ids" impossible to tell apart
from "the tool rejected a valid call". Set `MEMES_TRACE` to a path and the stdio
entrypoint tees both directions of the JSON-RPC traffic there as JSON lines:

```bash
MEMES_TRACE=/tmp/trace.jsonl node dist/src/stdio.js
```

Off unless the variable is set — the traffic includes whatever the user asked to
be memed about. `*.jsonl` is gitignored for the same reason.

### Testing the editor without a desktop host

```bash
npm run build && npm run preview:widget
```

`scripts/preview-widget.mjs` speaks the app side of the MCP Apps protocol at the
widget in an iframe and echoes every message both ways into the page — a blank
editor in a real host tells you nothing about which step failed. Pass
`--strict-csp` to reproduce the tighter sandbox some hosts apply.

## Deploy

Cloudflare Workers. Every push to `main` deploys through
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml); by hand it is:

```bash
npm run deploy
```

See **[docs/deployment.md](docs/deployment.md)** for the full walkthrough, the CI
secrets, limits, and rollback.

## Credits and licensing

- Template geometry and blank images come from
  [jacebrowning/memegen](https://github.com/jacebrowning/memegen) and its public
  API. `data/catalogue.json` is a derived join of its API and its `config.yml`
  files. memegen is **MIT, Copyright 2020 Jace Browning**; its notice is bundled
  verbatim at [`data/memegen-LICENSE.txt`](data/memegen-LICENSE.txt), since the
  box coordinates are its work and MIT asks that the notice travel with them.
  [`data/README.md`](data/README.md) maps which field came from where.
- The typeface is [Anton](https://github.com/googlefonts/AntonFont), used under
  the SIL Open Font License — see [`assets/Anton-OFL.txt`](assets/Anton-OFL.txt).
  memegen's own "thick" font is Impact, which is proprietary and is **not**
  redistributed here.
- Meme images themselves are third-party cultural material served from memegen;
  this project neither hosts nor claims rights to them.
- The icon is an original drawing, not Trollface — that one is registered,
  actively licensed IP with an exclusive licensee, and a logo is the wrong place
  to be casual about it. Reasoning and sources in
  [`assets/ICON.md`](assets/ICON.md).

This project's own code is MIT — see [LICENSE](LICENSE).
