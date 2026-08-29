# likh — technical notes

How the thing is built, how to run it, and how to host your own. The product itself is described in
[the README](../README.md); the design and its running status are in [`plan.md`](plan.md).

## Contents

- [Stack](#stack)
- [Architecture](#architecture)
- [The repo format](#the-repo-format)
- [How syncing works](#how-syncing-works)
- [Auth](#auth)
- [Layout of the source](#layout-of-the-source)
- [Running it locally](#running-it-locally)
- [Testing](#testing)
- [Hosting your own](#hosting-your-own)

## Stack

SvelteKit 5 · CodeMirror 6 · IndexedDB · GitHub Git Data API · Cloudflare Workers (static assets)

No backend of our own beyond the Worker, and the Worker exists only to hold a GitHub token so the
browser doesn't have to. There is no likh database. There is nowhere for your journal to be except
your browser and your repository.

**The editor is CodeMirror rather than a WYSIWYG on purpose.** Raw markdown stays the source of
truth, so the bytes that get committed are exactly the bytes you typed. A rich-text editor that
re-serialises to markdown produces noisy diffs, and here the diff is part of the product.

## Architecture

```
┌─────────────── browser (offline-capable) ──────────────┐
│  SvelteKit SPA                                         │
│    CodeMirror 6 ──▶ store ──▶ IndexedDB  (source of    │
│                       │                    truth)      │
│                       ▼                                │
│                  sync engine  ── GitHubClient ─┐       │
│  service worker (app shell precache)           │       │
└────────────────────────────────────────────────┼───────┘
                    ┌───────────────────────────┴──┐
                    ▼ (hosted)                     ▼ (token)
        Cloudflare Worker  /auth/*  /api/gh/*   api.github.com
          KV: session → {access, refresh}          (direct)
                    └──────────▶ api.github.com
```

**IndexedDB is the source of truth.** The editor never waits on the network. Git is a sync target,
not a dependency.

### Storage schema (`idb`, database `likh`)

| Store         | Key          | Value                                                                              |
| ------------- | ------------ | ---------------------------------------------------------------------------------- |
| `days`        | `2026-08-28` | `{ date, body, frontmatter, baseText, baseBlobSha, dirty, conflicted, updatedAt }` |
| `attachments` | path         | `{ path, blob, baseSha, dirty }` — reserved; nothing writes here yet               |
| `meta`        | singleton    | `{ repo: {owner, name, branch}, headSha, headTreeSha, lastSyncAt, authMode }`      |
| `kv`          | free-form    | settings, templates — schemaless, so a new setting needs no version bump           |

`baseText` is the exact content we last knew was on the remote: **the merge base**. Everything
correct about conflict handling depends on that field being maintained honestly, which means it is
written only after a successful pull or push and never after a local edit.

There is no operation log. The changeset is derived from the `dirty` flag, which is what makes sync
idempotent and crash-safe — an interrupted push simply replays.

## The repo format

The most important artefact in the project, because it has to make sense to someone who opens the
repository on github.com and never uses likh.

```
journal/2026/August/28.md
attachments/2026/August/sunset-a1b2c3.webp
.likh/config.json
README.md
```

Rules that keep diffs clean and merges sane:

- Frontmatter keys are sorted and minimal; empty values are omitted entirely. There is deliberately
  no `updated:` field — it would make every commit conflict.
- The body is written verbatim as typed. No normalisation, no reflow, no whitespace stripping.
- Exactly one trailing newline, and serialisation is idempotent: re-serialising an untouched file
  produces a byte-identical result. This is property-tested.
- Month names are written in English regardless of the reader's locale, so the same day is the same
  path on every device.

## How syncing works

### `pull()`

1. `GET /git/ref/heads/{branch}` → `remoteHead`. Equal to `meta.headSha`? Nothing to do.
2. `GET /git/trees/{remoteHead}?recursive=1` → a `path → blobSha` map.
3. For each path whose remote sha differs from our `baseBlobSha`, fetch the blob:
   - **not dirty** → fast-forward: `body = baseText = remoteText`.
   - **dirty** → three-way merge of `localBody`, `baseText` and `remoteText` via
     [`node-diff3`](https://github.com/bhousel/node-diff3). A clean merge keeps the row dirty, so the
     merged text gets pushed. A real conflict writes standard `<<<<<<< / ======= / >>>>>>>` markers
     into the body and flags the row. **Neither side is ever discarded.**
4. `meta.headSha = remoteHead`.

Freeform prose merges line by line very well: two devices editing different paragraphs of the same
day resolve cleanly. Conflicted days are held back from pushing, so markers never reach the
repository, and every other day still syncs.

### `push()`

1. `pull()` first, always.
2. Build tree entries from the dirty rows — text inline via `tree[].content`, binaries as blobs.
3. `POST /git/trees` with `base_tree: headTreeSha` — every changed file in one call.
4. `POST /git/commits`, then `PATCH /git/refs/heads/{branch}`. A `422` means the ref moved, so
   `pull()` and retry, three times at most.
5. On success set `baseText = body`, clear `dirty`, and store the **locally computed** blob sha —
   `SHA1("blob " + len + "\0" + bytes)` through `crypto.subtle` — which saves a second tree fetch.

Commit messages read `journal: 2026-08-28`, or `journal: 3 entries (2026-08-26..2026-08-28)`.

### Scheduling

Manual by default: nothing is committed until you ask. Everything outstanding then goes up as one
commit.

With **Sync automatically** on, a push also happens 30 seconds after you stop typing, when the tab
goes away, when the network returns, and on a five-minute poll. GitHub's secondary limit is 500
content-generating requests an hour and a push spends three, so the scheduler never runs two syncs
at once and never starts one within 30 seconds of the last — about 120 pushes an hour at the
ceiling, far above real journaling. Rate-limit headers and `retry-after` are honoured with
exponential backoff, and the app shows "sync paused" rather than hammering.

## Auth

Two transports behind one `GitHubClient` interface, so the sync engine never knows which is in use
and both are covered by the same test suite.

**Hosted sign-in** uses a GitHub App with PKCE. The Worker exchanges the code, keeps
`{access, refresh, exp}` in KV keyed by session id, and sets an httpOnly `likh_sid` cookie.
`/api/gh/*` refreshes if needed, attaches the token, and proxies to `api.github.com` behind a path
allowlist. Script running on the page can _use_ your GitHub access but cannot read the credential.

**A personal access token** needs no server at all. It is stored in IndexedDB rather than
localStorage, behind a toggle that says plainly what the exposure is. This is the path for
self-hosters, and it works from any fork.

Either way the permission asked for is one line: `Contents: read and write`, on repositories you
pick at install time.

One GitHub limitation worth knowing: a GitHub App user token **cannot create repositories**
(`POST /user/repos` accepts only OAuth tokens and classic PATs), so onboarding links out to
github.com for that and picks the repo up afterwards.

## Layout of the source

```
src/lib/core/     framework-free and unit-tested: markdown, db, git, github, sync, search, themes
src/lib/server/   Worker-only: OAuth, sessions, the proxy allowlist
src/lib/editor/   CodeMirror setup, live-preview plugin, formatting commands, theme
src/lib/stores/   Svelte runes
src/lib/components/
src/routes/       pages, plus the /auth and /api/gh Worker endpoints
```

**Nothing under `src/lib/core/` imports Svelte.** That is what keeps the sync engine testable in
plain node, and what would let a native shell reuse it later. If you are adding logic, try to land
it there and keep the Svelte file thin — the formatting engine is the pattern to copy:
`core/markdown/format.ts` turns an action plus a selection into a text edit against a plain string,
and `editor/format.ts` is the only part that has heard of CodeMirror.

`src/lib/core/github/fake.ts` is an in-memory GitHub good enough to run the real client against, so
tests exercise actual URLs, JSON shapes and error handling rather than a stub. It hashes blobs with
the real git algorithm, which is what lets a locally-computed sha be checked against what "the
server" says.

## Running it locally

```sh
pnpm install
pnpm dev
```

| Command           | What it does                                      |
| ----------------- | ------------------------------------------------- |
| `pnpm dev`        | Dev server                                        |
| `pnpm build`      | Production build                                  |
| `pnpm check`      | Type + Svelte diagnostics                         |
| `pnpm test`       | Unit tests (Vitest)                               |
| `pnpm test:tz`    | Unit tests across five timezones                  |
| `pnpm test:e2e`   | End-to-end tests (Playwright), desktop and mobile |
| `pnpm format`     | Prettier                                          |
| `pnpm cf:preview` | Build and serve through the real Workers runtime  |
| `pnpm deploy`     | Build and deploy to Cloudflare Workers            |

`pnpm dev` has no Cloudflare bindings, so hosted GitHub sign-in reports itself as unconfigured
there — everything else works, including the whole journal and the personal-token path. Use
`pnpm cf:preview` when working on auth; that runs the actual Worker, with KV and secrets.

## Testing

`pnpm test && pnpm test:tz && pnpm test:e2e` is the gate, and it should be green before a PR.

- **Unit** — the frontmatter round-trip, the merge, the formatting engine and the scheduler are all
  pure functions tested against plain strings, several with `fast-check` property tests (marks are
  an involution; serialisation is idempotent).
- **Timezones** — the same suite under five zones including `Pacific/Kiritimati` and `Pacific/Niue`,
  which sit on opposite sides of the date line. Date handling is where this app would quietly rot.
- **End-to-end** — Playwright against desktop and a Pixel 7 viewport, including two contexts editing
  the same day offline and converging on reconnect.

## Hosting your own

You need a Cloudflare account, and a GitHub App only if you want hosted sign-in — the personal-token
path works without one.

1. Create a GitHub App at <https://github.com/settings/apps/new>:
   - **Callback URL** `https://your-domain/auth/callback`
   - **Repository permissions** → Contents: **Read and write**
   - **Request user authorization (OAuth) during installation**: on
   - Webhooks: off
2. Put `GITHUB_CLIENT_ID` and `GITHUB_APP_SLUG` in `wrangler.jsonc` under `vars`.
3. Then:

```sh
wrangler kv namespace create SESSIONS   # put the id in wrangler.jsonc
wrangler secret put GITHUB_CLIENT_SECRET
pnpm deploy
```

For local development, copy `.dev.vars.example` to `.dev.vars` and run `pnpm cf:preview`.
