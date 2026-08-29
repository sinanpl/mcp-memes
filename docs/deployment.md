# Deployment

The deploy target is a **Cloudflare Worker**. There is no other host: the
Netlify target this project started on has been removed.

## The shape of it

[`wrangler.jsonc`](../wrangler.jsonc) points at [`src/worker.ts`](../src/worker.ts),
which is a thin adapter over `handleMcpRequest` in [`src/web.ts`](../src/web.ts) —
the same host-agnostic core the stdio and local-dev entrypoints use.

Four routes, and nothing else:

| Route | Response |
| --- | --- |
| `POST /mcp` | The MCP endpoint. Stateless: one server per request, one JSON body out. |
| `GET /health` | `{"status":"ok"}` |
| `GET /icon.png`, `GET /icon.svg` | The server icon, cached for a year and CORS-open — what `serverInfo.icons` points at. See [The icons](#the-icons). |
| `GET /favicon.ico` | The same PNG at the path a host asks for when it has a URL and nothing else. |
| `GET /` | A one-paragraph landing page. |

Each also answers under a `/mcp-memes` path prefix. The front door in front of
this Worker does not need that — it rewrites the path itself — so the prefix
routing is there for the other shape of proxy; see [The vanity URL](#the-vanity-url).

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

## The vanity URL

`https://sinan.pl/mcp-memes` is a front door on the blog onto this Worker. The
blog is a Quarto site on Netlify, and the rule lives in its `_redirects`:

```
/mcp-memes           https://mcp-memes.polatoglu-sinan.workers.dev/mcp     200
/mcp-memes/health    https://mcp-memes.polatoglu-sinan.workers.dev/health  200
```

Three things about that shape are worth keeping straight, because two of them
have already cost an afternoon.

**The endpoint is `/mcp-memes`, not `/mcp-memes/mcp`.** The rule maps the bare
path straight onto the Worker's `/mcp`, so the usual `…/mcp` suffix is already
spent. `https://sinan.pl/mcp-memes/mcp` matches no rule, falls through to the
blog's own 404 page, and a client reports it as *couldn't reach the server* —
or, once it starts hunting for an OAuth server it will never find, as an
authentication error. That is the URL to paste into a connector:

```
https://sinan.pl/mcp-memes
```

**`200` is a proxy, not a redirect.** Netlify fetches the Worker server-side, so
the `POST` keeps its method and its JSON-RPC body. A `301` or `302` would not:
clients re-issue a redirected POST as a GET, which arrives bodiless and earns
the Worker's `405`, and many refuse a cross-origin redirect for a tool endpoint
outright. A proxy also keeps the address stable, so nothing downstream has to
know the `.workers.dev` name.

**No splat, so only the mapped paths exist.** `/mcp-memes/icon.png` is not
proxied and does not need to be: the icons are advertised at the address the
request arrived on, which under this proxy is the Worker's own origin (the
Worker sees its `.workers.dev` host, not `sinan.pl`), and that origin serves
them directly.

One limit that comes with the proxy: Netlify caps a proxied response at 26
seconds. `handleMcpRequest` gives up at 8, so the Worker's own deadline is
always the one that fires first.

To check the front door, ask it the question a client asks — a `HEAD` or a `GET`
proves nothing here, since the failure mode is specific to `POST`:

```bash
curl -sS -X POST https://sinan.pl/mcp-memes \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 200
```

A JSON-RPC result means the proxy is passing POSTs through. HTML is the blog's
404 page (wrong path, or the rule is not published — Netlify only sees
`_redirects` after a `quarto publish`). A `405` means something turned the POST
into a GET.

## The icons

A host asks for the server's mark at two different moments, and they are not
served by the same mechanism. Getting this wrong is what left the connector pane
showing a grey letter "M".

**Once connected**, the host has the `initialize` response and reads
`serverInfo.icons`:

| Entrypoint | `icons` | Why |
| --- | --- | --- |
| `src/worker.ts`, `src/http.ts` | `<base>/icon.png`, `<base>/icon.svg` | A host that draws connectors in a web page fetches the icon as an image, and a remote `data:` image is dropped by that page's CSP. |
| `src/stdio.ts` | inline `data:` URIs | A stdio server has no origin to serve a URL from, and the host reads the response itself. |

`<base>` is built from the address the request actually arrived on, path prefix
included, so the icon is fetched back through the same door the client came in
by. Nothing is hardcoded and a new domain needs no code change.

**Before connecting** — a connector that has been added but not connected, which
is the state the pane spends most of its life in — there is no initialize
response and therefore no `icons` at all. The host has a URL and nothing else,
so the only mark it can find is the origin's favicon. That is why the Worker
serves `/favicon.ico` (the same 256x256 PNG) and why the landing page carries a
`<link rel="icon">`.

Honest about what is verified: the `data:`-versus-URL reasoning is CSP mechanics
and holds generally, but *which* of these two a given pane actually reads has not
been observed from inside this repo — the pre-connection letter is the only
symptom available. Serving both costs ~10 lines and covers either answer. If a
future connector pane still shows a letter after a connection succeeds, the
thing to check is whether `serverInfo.icons` is read at all, not these paths.

The bytes are the same baked constants throughout (`src/icons.ts` decodes them;
`assets/icon.svg` is still the one source). To confirm a deployment serves them:

```bash
curl -sSI https://mcp-memes.polatoglu-sinan.workers.dev/icon.png | head -3
curl -sSI https://mcp-memes.polatoglu-sinan.workers.dev/favicon.ico | head -3
```

Both should be `200` with an `image/png` content type. A connector added before
those existed can hold a stale mark; removing and re-adding it is the way to see
the current state.

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
thing on every push to `main`: `npm ci`, a credentials check, `npm run build`,
`npm test`, then `wrangler deploy`, then a `/health` curl. Manual runs are available through
**Actions → Deploy → Run workflow**.

It runs in the `production` GitHub Environment, which is where the two secrets
live and where a required reviewer can be added if merges should not ship
unattended.

| Secret | What it is |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | An API token carrying **Account → Workers Scripts → Edit**, scoped under **Account Resources** to the account ID below. That single permission is what `wrangler deploy` spends; the Worker has no bindings, so nothing about KV, R2, D1 or any zone belongs on it. Add **User → User Details → Read** too — no deploy needs it, but wrangler falls back to `whoami` when a call fails, and without it the diagnostics can't say who the token is. |
| `CLOUDFLARE_ACCOUNT_ID` | The account ID from the Cloudflare dashboard sidebar (`npx wrangler whoami` also prints it). Only strictly needed when the token can see more than one account, but setting it removes the ambiguity — and it must be the *same* account the token is scoped to, or every call 403s. |

Deploys are serialised by a `concurrency` group and deliberately **not**
cancelled in flight: a half-run `wrangler deploy` is worse than a redundant one.
The build step is not optional in CI either — `src/generated/` is gitignored, so
a checkout has nothing to bundle until it runs.

The job checks both secrets against the Cloudflare API before it builds
anything. `wrangler deploy` is the first step that would otherwise touch them,
and it is four minutes of `npm ci`, build and test away — long enough that a
credentials problem arrives looking like a deploy problem.

### When the deploy fails to authenticate

The symptom is a `wrangler deploy` that ends in:

```
✘ [ERROR] A request to the Cloudflare API (/accounts/<id>/workers/services/mcp-memes) failed.
  Authentication error [code: 10000]
```

Code 10000 on that path means one thing: **the token is not allowed to write
Workers on that account.** Wrangler then runs `whoami` to help, and that output
is where the trail goes cold, because it asks about permissions the deploy never
needed:

- `Are you missing the User->User Details->Read permission?` and
  `Unable to get membership roles` are the *diagnostic* failing, not the deploy.
  Granting them makes the message useful; it does not make the deploy work.
- If that output still prints the account **name** — not just the ID — the token
  is live, unexpired, and scoped to the right account, since listing accounts is
  itself a token-authenticated call. Rule out expiry and the wrong account ID
  and go straight to the permission.

Issue the token at
[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
→ **Create Token** → **Create Custom Token**:

| Field | Value |
| --- | --- |
| Permissions | `Account` · `Workers Scripts` · **Edit** |
| Permissions | `User` · `User Details` · **Read** |
| Account Resources | Include · the one account this Worker deploys to |
| Zone Resources | *none* — the Worker is on `workers.dev` and claims no route |
| Client IP Filtering | leave empty — GitHub-hosted runners have no stable egress IP |
| TTL | no expiry, or a calendar reminder; an expired token fails the same way a revoked one does |

The **Edit Cloudflare Workers** template also works and is the faster path, but
it is a moving target maintained for the general case: it grants KV, R2, D1 and
zone scopes this Worker has no use for, and it has at times not carried the
`User Details` read that makes wrangler's diagnostics legible. The custom token
above is the minimum that deploys this repository.

Then paste it into **Settings → Environments → production → Secrets**, and check
these while you are there:

- **The `production` environment is the one that matters.** A repository-level
  secret of the same name is shadowed by the environment's, so an old token
  sitting in the environment will be used no matter what you fix at repo level.
- **Paste without a trailing newline or space.** The token is sent verbatim in
  an `Authorization` header; whitespace makes it fail as if it were revoked.
- **`CLOUDFLARE_ACCOUNT_ID` must be the account the token is scoped to.** A
  token issued under a second account on the same login is the quiet version of
  this bug: it authenticates, and then 403s on an account it cannot see.

To confirm a token before trusting CI with it, ask the API the same question the
deploy asks. `200` means the permission is there:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts"
```

A `403` there with a `200` from `/client/v4/user/tokens/verify` is exactly the
failure above: a valid token without `Workers Scripts:Edit`.

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
