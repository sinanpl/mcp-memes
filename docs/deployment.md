# Deployment

The deploy target is a **Cloudflare Worker**. There is no other host: the
Netlify target this project started on has been removed.

## The shape of it

[`wrangler.jsonc`](../wrangler.jsonc) points at [`src/worker.ts`](../src/worker.ts),
which is a thin adapter over `handleMcpRequest` in [`src/web.ts`](../src/web.ts) —
the same host-agnostic core the stdio and local-dev entrypoints use.

Three routes, and nothing else:

| Route | Response |
| --- | --- |
| `POST /mcp` | The MCP endpoint. Stateless: one server per request, one JSON body out. |
| `GET /health` | `{"status":"ok"}` |
| `GET /` | A one-paragraph landing page. |

Everything the Worker needs at runtime is a compile-time value. A V8 isolate has
no filesystem, so the catalogue, the editor HTML, the Anton font and both server
icons are all baked into the bundle — `data/catalogue.json` by a JSON import,
the rest by [`scripts/build-widget.mjs`](../scripts/build-widget.mjs) into
`src/generated/assets.ts`. That generated file is **not committed**; `npm run
build` regenerates it, and `npm run deploy` runs the build first for exactly that
reason.

The Worker itself has no bindings, no environment variables and no runtime
secrets — there is nothing to configure on it beyond an account. Deploying *to*
it does need credentials, but those live in CI and never reach the isolate; see
[From CI](#from-ci) below.

## Deploying

First time on a new machine:

```bash
npm install
npx wrangler login
```

Then, every time:

```bash
npm run deploy
```

That is `npm run build && wrangler deploy`. Never run `wrangler deploy` on its
own — without the build step it ships whatever `src/generated/assets.ts`
happened to be lying around, or fails to compile because it is absent.

To see what would go out without shipping it:

```bash
npx wrangler deploy --dry-run
```

### From CI

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) does the same
thing on every push to `main`: `npm ci`, `npm run build`, `npm test`, then
`wrangler deploy`, then a `/health` curl. Manual runs are available through
**Actions → Deploy → Run workflow**.

It runs in the `production` GitHub Environment, which is where the two secrets
live and where a required reviewer can be added if merges should not ship
unattended.

| Secret | What it is |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | An account API token with the **Edit Cloudflare Workers** template. Nothing broader — the Worker has no bindings, so the token needs no KV, R2 or D1 scope. |
| `CLOUDFLARE_ACCOUNT_ID` | The account ID from the Cloudflare dashboard sidebar (`npx wrangler whoami` also prints it). Only strictly needed when the token can see more than one account, but setting it removes the ambiguity. |

Deploys are serialised by a `concurrency` group and deliberately **not**
cancelled in flight: a half-run `wrangler deploy` is worse than a redundant one.
The build step is not optional in CI either — `src/generated/` is gitignored, so
a checkout has nothing to bundle until it runs.

### Verify

```bash
curl https://mcp-memes.polatoglu-sinan.workers.dev/health
```

```bash
curl -X POST https://mcp-memes.polatoglu-sinan.workers.dev/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The second should list `list_formats`, `make_meme`, `app_templates` and
`render_meme`. `app_templates` is app-visibility-only, so a real host will show a
model three tools, not four.

### Rollback

```bash
npx wrangler deployments list
npx wrangler rollback [deployment-id]
```

## Limits

The Worker runs on Cloudflare's **free plan**. The ones that bite:

| Limit | Free plan | Where this project sits |
| --- | --- | --- |
| Requests | **100,000 / day**, resetting midnight UTC | The ceiling that matters. Past it, Cloudflare returns error 1027. |
| CPU time per request | 10 ms | Comfortable. The `/mcp` path is string building and JSON — no rendering, no image decoding. |
| Worker size (gzipped) | 3 MB | ~470 KB, most of it the baked font and editor. Roughly a sixth of the budget. |
| Subrequests | 50 / request | Zero. The Worker makes no outbound calls at all. |
| Memory | 128 MB | Not close. |

Wall-clock time is not limited on Workers — only CPU time — so the 8 s timeout in
`handleMcpRequest` is a safety net against a wedged handler, not a platform
deadline being anticipated.

### About the 100k/day ceiling

The endpoint is **unauthenticated on purpose**. It is a demo over a public
catalogue of public images, so there is nothing to protect but the compute — and
on the free plan, exceeding the quota costs availability rather than money.

Two consequences worth being honest about:

- Anyone can spend the quota. A trivial script can exhaust 100,000 requests, and
  the endpoint is simply down until midnight UTC.
- There is no rate limiting, no auth, and no alerting configured.

If that stops being acceptable, the cheapest fixes in order:

1. A [rate-limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
   in `wrangler.jsonc` — no extra services, no code beyond a guard.
2. A shared-secret `Authorization` check in `handleMcpRequest`, ahead of
   `createServer`. There is a comment in [`src/web.ts`](../src/web.ts) marking
   exactly where it belongs.
3. The Workers paid plan, which removes the daily request limit.

## Observability

`observability.enabled` is on in `wrangler.jsonc`, so invocation logs go to the
Cloudflare dashboard. Tail them live:

```bash
npx wrangler tail
```

Note what this does *not* give you: the contents of MCP traffic. For that, run
the stdio entrypoint locally with `MEMES_TRACE` set — see the README. Deliberately
there is no equivalent on the Worker, because it would mean logging whatever
users asked to be memed about.

## Why not Netlify, and why no renderer

The project originally deployed to Netlify Functions. That target is gone; the
core never depended on it, which is why removing it touched comments and config
rather than logic.

The one behavioural difference the Worker brings is that `render_meme` returns a
[memegen](https://api.memegen.link) image URL rather than PNG bytes.
`@napi-rs/canvas` is a native Skia binary and a V8 isolate cannot load one.

This is a trade, not a regression:

- The editor renders in the browser through the same `src/layout.ts`, so the
  primary path is unaffected.
- Image bytes stay off the Worker's egress and out of its CPU budget.
- `render_meme` exists as a fallback for hosts that cannot display an app, and on
  those a URL is still a usable answer.

Restoring server-side rendering would mean a runtime that can load native
binaries — [Cloudflare Containers](https://developers.cloudflare.com/containers/),
or a Node host — not a change to this Worker.
