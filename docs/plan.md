# likh.dev — git-backed, offline-first journal

## Context

**likh.dev** is an open-source, offline-first journaling web app where entries live as plain
markdown in **your own GitHub repo**, and every save becomes a real git commit.

This document is both the original plan and the running status of it — the design sections describe
intent, the Status section describes what actually exists. The product is described in
[the README](../README.md); how it is built and how to run it is in
[`technical.md`](technical.md).

It combines the two references:

- **JournalBook** (Preact + IndexedDB) — offline-first, private, day-oriented, no sync.
- **Pile** (Electron + React + Tiptap) — beautiful writing surface, local markdown files.

likh takes JournalBook's offline-first day model and Pile's writing-surface quality, and adds what neither has: **git as the sync and history layer**, working from any device including mobile.

Design goals, in priority order: (1) never lose a word, (2) instant and fully usable offline, (3) the repo is readable and portable without likh, (4) a surface people actively enjoy writing on.

---

## Status

Last updated after M3. **M0–M3 are built and green; M4 and M5 have not been started.**

| Milestone                       | State                        | What's left                                               |
| ------------------------------- | ---------------------------- | --------------------------------------------------------- |
| **M0** Skeleton and deploy path | Done, not deployed           | `likh.dev` DNS and a real deploy — needs a CF account     |
| **M1** Local-first journal      | Done                         | Mobile keyboard check on a **real phone** (see Risks)     |
| **M2** GitHub identity          | Done, not run against GitHub | Register the GitHub App; verify hosted sign-in end to end |
| **M3** Sync engine              | Done, not run against GitHub | Branch picker in Settings; verify against a real repo     |
| **M4** Attachments              | Not started                  | All of it                                                 |
| **M5** Craft pass               | Part done                    | Fonts, ⌘K palette, motion, export-all, landing page       |

Current test coverage: **258 unit tests** (run under five timezones) and **80 end-to-end tests**
across desktop and mobile viewports. `pnpm test && pnpm test:tz && pnpm test:e2e` is the gate.

### Blocked on the repo owner

Three things cannot be done from inside the codebase, and two of them gate "really done":

1. **Cloudflare account.** `wrangler login`, then `wrangler kv namespace create SESSIONS`, put the id
   in `wrangler.jsonc`, `pnpm deploy`. Until then M0 is "builds and previews", not "live".
2. **GitHub App registration.** Settings are in `.dev.vars.example`. Until then hosted sign-in
   reports itself unconfigured and only the personal-token path is exercised. M2 and M3 are verified
   against an in-memory fake GitHub, not the real one.
3. **A real phone.** Mobile CodeMirror was verified in Chromium touch emulation only. iOS Safari is
   where this usually bites, and it is the single biggest remaining product risk.

### Where to pick up

Start M4 (attachments), or close the verification gaps above first. `attachmentPath` and
`relativeFromDay` in `src/lib/core/repo/paths.ts` already encode M4's on-disk contract and are
tested; nothing else for M4 exists.

The smallest genuinely-missing feature is the **branch picker** in Settings — M3 called for it, the
branch is currently read from the repo's default and displayed read-only. `SyncMeta.repo.branch`
already carries it end to end, so this is UI only.

---

## Decisions already made

| Decision       | Choice                                                                           |
| -------------- | -------------------------------------------------------------------------------- |
| Data model     | One markdown file per day, freeform body                                         |
| Frontend       | SvelteKit 5 + Vite, `adapter-cloudflare`                                         |
| Hosting        | Cloudflare **Workers with static assets** (not Pages)                            |
| Auth           | Worker BFF (httpOnly cookie) by default, **+ PAT escape hatch** for self-hosters |
| v1 scope       | Core journal + sync + **images/attachments**                                     |
| Deferred to v2 | AI reflections, non-GitHub hosts, E2E encryption                                 |

---

## The repo format (the real product contract)

This is the most important artifact — it must make sense to someone who opens the repo on github.com and never uses likh.

```
journal/2026/August/28.md          # one file per day
attachments/2026/August/sunset-a1b2c3.webp
.likh/config.json                  # { version, timezone, dateFormat }
README.md                          # generated on first commit
```

```markdown
---
date: 2026-08-28
tags: [work, ideas] # optional, omitted when empty
---

Shipped the sync layer today.
Still thinking about the merge strategy for offline edits.

![sunset](../../../attachments/2026/August/sunset-a1b2c3.webp)
```

A day that has ended is a record. likh will not rewrite one — it appends, and
says when:

```markdown
Shipped the sync layer today.

---

**Added 2 September 2026**

This is the commit that broke staging, as it turned out.
```

Nothing parses those headings back; they are prose for whoever reads the repo.
The blank line above the `---` is load-bearing — directly under a paragraph,
`---` is a Setext underline and would turn the entry's last line into a heading.

Rules that keep diffs clean and merges sane:

- Frontmatter keys are **sorted and minimal**; omit empty values entirely. Never write `updated:` — that field would make every commit conflict.
- Body is written verbatim as typed. No normalization, no reflow, no trailing-whitespace stripping mid-edit.
- Exactly one trailing newline. Serialization must be **idempotent**: `parse(serialize(x)) === x`, and re-serializing an untouched file produces a byte-identical result. Property-test this.
- `YYYY/Month/DD.md` nesting keeps github.com's file browser usable after a few
  years, and reads as a calendar: the year and month are already in the folders,
  so the file only carries the day. Days are zero-padded so a month sorts
  chronologically. Month names are **English and fixed** — never
  `toLocaleDateString`, or a French browser would file `Avril/` beside a Chrome
  `April/` and the same day would occupy two files.

---

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
                    ▼ (BFF mode)                   ▼ (PAT mode)
        Cloudflare Worker  /auth/*  /api/gh/*   api.github.com
          KV: session → {access, refresh}          (direct)
                    └──────────▶ api.github.com
```

**IndexedDB is the source of truth.** The editor never waits on the network. Git is a sync target, not a dependency.

### Storage schema (`idb`, DB `likh`, v1)

- **`days`** — key `"2026-08-28"`
  `{ date, body, frontmatter, baseText, baseBlobSha, dirty, conflicted, updatedAt }`
  `baseText` is the exact content we last knew was on the remote — **the merge base**. Everything correct about conflict handling depends on this field being maintained honestly.
- **`attachments`** — key `path` → `{ path, blob, baseSha, dirty }`
- **`meta`** — singleton `{ repo: {owner, name, branch}, headSha, headTreeSha, lastSyncAt, authMode }`

No operation log. The changeset is derived from `dirty` rows, which makes sync **idempotent and crash-safe** — an interrupted push simply replays.

---

## Sync engine (`src/lib/core/sync/`)

The hard part. Keep it framework-free and unit-testable — no Svelte imports below `src/lib/core/`.

### `pull()`

1. `GET /git/ref/heads/{branch}` → `remoteHead`. Equal to `meta.headSha`? Done.
2. `GET /git/trees/{remoteHead}?recursive=1` → `path → blobSha` map.
3. For each path whose remote sha ≠ our `baseBlobSha`, fetch the blob:
   - **not dirty** → fast-forward: `body = baseText = remoteText`.
   - **dirty** → `diff3Merge(localBody, baseText, remoteText)` via [`node-diff3`](https://github.com/bhousel/node-diff3):
     - clean merge → `body = merged`, `baseText = remoteText`, stays `dirty` (the merge gets pushed).
     - conflict → write standard `<<<<<<< / ======= / >>>>>>>` markers into `body`, set `conflicted = true`, surface in the UI. **Never discard either side.**
4. `meta.headSha = remoteHead`.

Freeform prose merges line-by-line very well — two devices editing different paragraphs of the same day resolve cleanly. This is exactly why the merge base must be stored.

### `push()`

1. `pull()` first, always.
2. Build tree entries from dirty rows: text files inline via `tree[].content`; binaries `POST /git/blobs` (base64) then reference by sha.
3. `POST /git/trees { base_tree: headTreeSha, tree: [...] }` — **all changed files in one call**.
4. `POST /git/commits { message, tree, parents: [headSha] }`
5. `PATCH /git/refs/heads/{branch} { sha, force: false }` → on `422` (ref moved), `pull()` and retry, max 3.
6. On success, for each pushed row: `baseText = body`, `dirty = false`, and set `baseBlobSha` to the **locally computed** git blob sha — `SHA1("blob " + len + "\0" + bytes)` via `crypto.subtle.digest('SHA-1', ...)`. Avoids a second tree fetch.

Commit messages: `journal: 2026-08-28` for one day, `journal: 3 entries (2026-08-26..2026-08-28)` for several.

### Scheduling and rate limits

**Syncing is manual by default** (`settings.syncMode`). Nothing commits until the user presses the
sync button, ⌘S, or Sync now — and then everything outstanding goes up as one commit. The reasons: a
journal is a draft until its writer says otherwise; a commit per sitting reads better in `git log`
than a commit per pause in typing; and IndexedDB is the source of truth, so waiting costs nothing but
latency to the other device. Adopting a repository still pulls once, because arriving at an empty
journal whose entries are sitting in the repo reads as data loss.

Everything below is the optional automatic half, off unless **Sync automatically** is on. GitHub's secondary limit is **80 content-generating requests/minute and 500/hour**. A commit costs 3–4 calls, so ~125 commits/hour is the ceiling. Therefore:

- Debounce **30s of edit idle**; also flush on `visibilitychange → hidden`, on manual save (⌘S), and on `online`.
- **Minimum 30s between pushes**, single-flight (never two in parallel), coalescing everything dirty into one commit.
  _(Revised during M3: at 20s a full hour of syncing allows 180 pushes — 540 content-generating
  requests — which exceeds the 500/hour limit. 30s allows 120 pushes, 360 requests.)_
- Background `pull()` every 5 min while the tab is visible.
- Honor `x-ratelimit-remaining` / `retry-after` with exponential backoff; surface a "sync paused" state rather than hammering.

A `SyncStatus` store drives one small, honest indicator: `offline | idle | pending(n) | syncing | conflict | error`. In manual mode the indicator _is_ the sync button, and `pending(n)` is how the app asks to be pressed.

---

## Auth (`src/lib/core/github/`)

Ship a **GitHub App** (not an OAuth App): fine-grained `contents: read/write` only, and the user picks exactly which repos at install time — which is precisely the "choice of their repo" requirement. GitHub [added PKCE support in July 2025](https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/); use it (`S256`) on top of the BFF.

**Worker routes** (SvelteKit `+server.ts` endpoints, deployed in the same Worker):

- `GET /auth/login` → redirect to GitHub authorize with signed `state` + PKCE challenge.
- `GET /auth/callback` → exchange code (secret + `code_verifier`); store `{access, refresh, exp}` in **KV** keyed by session id; set `likh_sid` httpOnly / Secure / SameSite=Lax.
- `ALL /api/gh/*` → refresh if expired, attach token, proxy to `api.github.com`, strip cookies from the upstream request, pass rate-limit headers back.
- `POST /auth/logout` → delete KV record + cookie.

**Client interface** — the sync engine only ever sees this:

```ts
interface GitHubClient {
	getRef(branch): Promise<{ sha }>;
	getTree(sha, recursive): Promise<TreeEntry[]>;
	getBlob(sha): Promise<Uint8Array>;
	createBlob(bytes): Promise<{ sha }>;
	createTree(baseTree, entries): Promise<{ sha }>;
	createCommit(msg, tree, parents): Promise<{ sha }>;
	updateRef(branch, sha): Promise<void>;
	listRepos(): Promise<Repo[]>;
}
```

Two implementations: `BffClient` (fetch `/api/gh/*`, `credentials: 'include'`) and `DirectClient` (fetch `api.github.com` with an `Authorization` header). PAT mode stores a fine-grained token in **IndexedDB, not localStorage**, behind a settings toggle with a plain-language warning about XSS exposure. Both paths must pass the same sync test suite.

**Resolved in M2:** a GitHub App user token _cannot_ create a repository — `POST /user/repos`
accepts only OAuth tokens and classic PATs. Onboarding links out to github.com's new-repo page and
picks the repo up on return, which is the fallback this plan named.

---

## The writing surface

**Editor: CodeMirror 6**, not Tiptap — a deliberate divergence from Pile. Tiptap/ProseMirror stores semantic structure and re-serializes to markdown, which produces lossy, noisy diffs. In this app **the git diff is part of the product**, so raw markdown must be the source of truth and saved bytes must be exactly what was typed.

- `@codemirror/lang-markdown` + a custom live-preview decoration plugin: hide `#`, `**`, `_` markers on lines the cursor isn't on, style headings/bold/quotes inline. Obsidian-style, raw text underneath.
- Self-hosted variable fonts (subset woff2, no Google Fonts request — it would break the offline shell): a serif for the body, one clean sans for UI.
- Measure capped ~68ch. Full-bleed surface; chrome fades in on pointer move. Optional focus mode (dim non-current paragraph) and typewriter scroll.
- OKLCH color tokens, warm off-white and a true (not blue-black) dark, `prefers-color-scheme` plus an explicit toggle.
- Keyboard: `⌘K` palette, `⌘S` sync now, `[` / `]` previous/next day, `T` today.
- Sidebar: a year heatmap (JournalBook's calendar), streak, word count — quiet, never gamified.
- **Mobile is a first-class target, not a shrink.** Test CM6 against the iOS/Android virtual keyboard early (M1, on a real device): use `VisualViewport` for the composing area, keep the caret above the keyboard, avoid `100vh`. This is the single most likely source of unpleasant surprises — do it before building UI on top.

Search: **MiniSearch** over day bodies, index built in a Web Worker on boot, fully offline.

---

## Project layout

Single SvelteKit app — no monorepo overhead in v1. The discipline that matters is that `src/lib/core/` imports nothing from Svelte, so it can later be lifted into a package for a Capacitor or desktop build.

```
src/lib/core/          # framework-free and unit-tested
  markdown/            # frontmatter (idempotent), conflict markers
  date/                # civil-date day keys
  repo/                # path <-> day mapping, day-file bridge
  db/                  # IndexedDB schema, day store, kv
  git/                 # blob SHA, matching real git
  github/              # GitHubClient, transports, init, fake.ts (test double)
  sync/                # merge, scheduler, engine
  util/                # debounce, base64
src/lib/server/        # Worker-only: pkce, session, github-oauth, allowlist, env
src/lib/stores/        # Svelte runes: journal, settings, connection, sync
src/lib/editor/        # CodeMirror setup, live preview, conflict syntax, theme
src/lib/search/        # MiniSearch in a web worker
src/lib/components/    # Calendar, SearchPanel, SettingsSheet, SyncIndicator, ConflictBar, FormatBar
src/routes/
  +layout.svelte       # app shell; +layout.ts sets ssr = false
  [[date=date]]/       # the writing view
  connect/             # onboarding and repo picker
  auth/login|callback|logout|session/+server.ts
  api/gh/[...path]/+server.ts
src/service-worker.ts  # hand-rolled: precache shell, never cache /auth or /api
src/hooks.server.ts    # no-store on /auth and /api, error responses included
wrangler.jsonc         # assets.not_found_handling: "single-page-application"
                       # assets.run_worker_first: ["/api/*", "/auth/*"]
                       # KV binding: SESSIONS
```

Key deps: `@codemirror/*`, `idb`, `node-diff3`, `minisearch`, `@sveltejs/adapter-cloudflare`.
Dev: `vitest`, `fast-check`, `fake-indexeddb`, `@playwright/test`, `wrangler`.

---

## Milestones

Each milestone ends at something usable, so the project is never in a half-broken state.

**M0 — Skeleton and deploy path.** ✅ _built_ · ◻ _not deployed_
SvelteKit 5 + TS + `adapter-cloudflare`, `wrangler.jsonc` with static assets and SPA fallback,
Vitest + Playwright wired, MIT license, README. Remaining: `likh.dev` DNS and a real deploy.

**M1 — Local-first journal (no network at all).** ✅ _built_ · ◻ _real-phone check outstanding_
Markdown frontmatter serializer, IndexedDB schema, day store, CodeMirror editor with live preview,
date routing, calendar sidebar, MiniSearch in a worker, PWA shell. A settings sheet (theme, text
size, line width, focus mode, typewriter, spellcheck) landed here rather than in M5, so those
features are reachable. Remaining: verify the keyboard on a real phone, iOS Safari especially.

**M2 — GitHub identity and repo choice.** ✅ _built_ · ◻ _not run against real GitHub_
Worker `/auth/*` with PKCE + KV sessions, `/api/gh/*` proxy behind an allowlist, `GitHubClient` over
two transports, repo picker, onboarding that writes `.likh/config.json` and `README.md` as the first
commit, personal-token mode. Remaining: register the GitHub App and run the hosted flow once.

**M3 — Sync engine.** ✅ _built_ · ◻ _branch picker; not run against real GitHub_
`pull`, `push`, three-way merge, conflict markers with a resolution bar, a scheduler with
debounce/coalescing/backoff, sync status indicator, "sync now" and "disconnect" in Settings.
Manual by default: the scheduler's automatic half is behind a setting and off unless asked for.
Two browsers editing the same day offline converge with no lost text, proven by an end-to-end test.
Remaining: a branch picker in Settings, and a run against a real repository.

**M4 — Attachments.** ◻ _not started_
Paste/drag images, client-side resize + WebP encode via `createImageBitmap` + canvas, size budget
with a clear over-limit message, blob upload path, relative-link insertion, offline blob cache.
_Done when an image pasted offline commits correctly on reconnect and renders from github.com._

Groundwork already in place: `attachmentPath` / `relativeFromDay` (tested), `createBlob` on the
client, and an `attachments` object store in IndexedDB that nothing writes to yet. The sync engine
currently ignores non-journal paths entirely — `pull` filters the tree through `dayFromPath`, so
attachment handling has to be added there as well as in `push`.

**M5 — Craft pass.** ◐ _part done_
Done: six themes with a light default and no flash on cold start, text size and line width as
settings, a formatting toolbar with keyboard shortcuts, and entry templates.
Remaining: self-hosted variable fonts (currently system stacks), motion polish, ⌘K command palette
(⌘K opens search today), empty and first-run states, a11y audit (focus rings, reduced motion and
calendar labels are done; keyboard nav needs a pass), Lighthouse, export-all, landing page,
contributor docs.

**Appearance.** Six palettes — Paper, Sepia, Daylight (light) and Ink, Midnight, Ember (dark) —
plus `system`, which resolves to Paper/Ink. `tokens.css` holds each palette once and `THEMES` is the
index over them; a unit test reads the stylesheet and fails if the two disagree, so a theme cannot
be half-added. `system` is resolved in JavaScript rather than by a `prefers-color-scheme` block,
which is what allows one copy of each palette. Theme, text size and line width are mirrored into
`localStorage` and applied by an inline script in `app.html` before the first paint; the appearance
effect then waits for `settings.loaded` so the defaults are never painted over a correct value.

**Formatting.** `core/markdown/format.ts` turns an action plus a selection into a text edit and is
tested against plain strings, including a property test that pressing a mark twice restores the
document byte for byte. `editor/format.ts` is the only part that knows about CodeMirror, and the
toolbar buttons and the keyboard shortcuts run through the same commands.

**Chrome.** Settings are three menus — writing, theme, syncing — with an icon each in the header
rather than one gear. They share a tabbed sheet, because the header is behind the sheet's scrim and
switching should not cost a trip back out. `Icon.svelte` holds all seven shapes on one 16-unit grid,
which is what keeps them looking like a set.

**Templates.** Markdown snippets with `{{date}}`, `{{weekday}}`, `{{time}}` and `{{cursor}}`, stored
in IndexedDB. Inserted only when asked for — from the toolbar, or from a one-tap offer on an empty
day — so a day that was opened and left alone stays out of the repository.

## Decisions made while building

Deviations from the plan above, and why. Each is deliberate.

- **The push floor is 30s, not 20s.** At 20s a full hour allows 180 pushes — 540 content-generating
  requests — which exceeds GitHub's 500/hour. 30s allows 120 pushes, 360 requests. The scheduler test
  asserts against the budget rather than a constant, so changing the floor without redoing the
  arithmetic fails.
- **The service worker is hand-rolled** on SvelteKit's built-in support rather than
  `@vite-pwa/sveltekit`. One less dependency, and the caching policy is ~60 lines we fully control.
- **One `GitHubClient` over two transports**, not two client implementations. The auth modes differ
  only in dispatch, so "both paths behave identically" is structural rather than a discipline.
- **The proxy has an allowlist** (`src/lib/server/allowlist.ts`), which the plan did not call for.
  The Worker turns an httpOnly token into something any script on the page can _use_; the allowlist
  keeps the blast radius to the fifteen endpoints likh needs. Adding a feature that needs a new
  endpoint means adding it there, on purpose.
- **`platformProxy` is not enabled** in `vite.config.ts`. It boots Miniflare inside `vite dev`, and
  concurrent instances deadlock on one SQLite lock, leaving orphaned `workerd` processes. So
  `platform.env` is undefined under `pnpm dev` and hosted sign-in reports itself unconfigured there;
  use `pnpm cf:preview` (real `wrangler dev`) for auth work.
- **Repo creation links out to github.com.** A GitHub App user token cannot create repositories —
  `POST /user/repos` accepts only OAuth tokens and classic PATs. This was the plan's flagged open
  item; the fallback it named is what shipped.
- **Conflict markers are parsed as markers, not markdown** (`src/lib/editor/conflict-syntax.ts`).
  Otherwise `=======` makes the paragraph above a Setext heading and `>>>>>>>` opens a blockquote,
  and a conflict looks like a broken editor. Trade-off: a line of exactly seven `=` is read as a
  separator rather than a Setext underline.
- **Day files are `journal/2026/August/28.md`**, not `journal/2026/08/2026-08-28.md`. The year and
  month are already in the folders, so repeating them in the filename only made the file browser
  noisier. Named months read as a calendar. Two costs, both accepted: month folders sort
  alphabetically on github.com (April, August, December…), and this is a **breaking change to the
  repo format** — safe to make now only because nothing has ever synced to a real repo. Numbering
  the folders (`04-April/`) would restore chronological sort; it is a one-line change in
  `calendarDir`.
- **Past days are read-only, and take dated notes instead.** Today and any day
  ahead are freely editable; a day that has ended is a record, and the only way to
  change it is `appendNote`, which adds `**Added 29 August 2026**` at the end. The
  reason is the whole point of keeping a journal: an entry is worth having because
  it says what you thought _at the time_, and a silent edit two years later
  destroys that invisibly — a diff nobody is watching says nothing. The date comes
  from `formatFixed`, English and locale-independent, for the same reason month
  folders are.
- **The default theme is light, not the system's.** `system` is one option among seven rather than
  the default, so a first launch is always Paper. The palettes were widened to six because "light or
  dark" is not what people actually want from a journal — Sepia for a long sitting, Ember for a dark
  room, Daylight for a bright one are different tools, not different moods.
- **The writing column is wider and the type larger** — `--measure` 42rem and 19px, up from 34rem
  and 17px, both now settings. The old measure was chosen for reading comfort; this is a surface you
  fill rather than one you read, and at 34rem it looked like a text field on a page rather than a
  page.
- **Templates are not committed.** They live in IndexedDB with settings, so they do not follow you
  to a second device. Carrying them in the repo would mean teaching `pull` and `push` a second kind
  of file with its own merge rules, and that is not worth risking the day-file path for. If it is
  ever worth doing, `.likh/templates/*.md` is the obvious home and the settings sheet already says
  where they live today.
- **Templates are offered, never applied.** A daily template could pre-fill an empty day, and most
  journalling apps do. likh does not: it would commit a scaffold under a date nothing happened on,
  and "days I wrote" would stop meaning anything. The offer is one tap on an empty day.
- **Syncing is manual by default**, with the whole automatic half behind `settings.syncMode`. The
  plan above assumed automatic; this inverts the default. The scheduler kept its debounce, poll,
  backoff and floor rather than losing them — `auto: false` gates every path that could start a sync
  unasked at one point, `#scheduleAt`, leaving `flush()` and its single caller, the sync button.
  What stays unconditional: writes to IndexedDB, and one pull when a repository is adopted.

## Traps worth remembering

Things that cost time once and should not cost it twice.

- **Never use `margin` on `.cm-line`.** CodeMirror measures line geometry from the element's box; a
  margin shifts where a line is painted but not where CodeMirror thinks it is, so clicking a heading
  puts the caret on the next line. All vertical rhythm in the editor theme is padding.
- **Day keys are civil dates.** Deciding _which_ day "now" is uses local components; all arithmetic
  on an existing key uses UTC components. Pacific/Kiritimati has no 31 December 1994, so
  elapsed-millisecond arithmetic is off by one across it. Run `pnpm test:tz` after touching dates.
- **A constrained scroller puts its scrollbar beside the text.** The writing column is set on
  `.cm-content`, not on a wrapper around the editor, so `.cm-scroller` spans the window and its
  scrollbar sits at the window edge where one belongs. `.rail` lines everything else up with the
  text.
- **Scroller padding is content.** `padding-bottom: 40vh` made a six-line entry taller than its
  viewport, so a scrollbar appeared next to an entry with nothing to scroll. It is 20vh now, and
  `EditorView.scrollMargins` keeps the caret clear of the toolbar instead.
- **Use `background-color`, not `background`, in a CodeMirror theme.** The shorthand resets
  `background-clip` — which the scrollbar thumb depends on for its inset — and a `var()` inside a
  shorthand serialises to nothing usable.
- **Vitest replaces CSS imports with an empty string** unless `test.css` is on. `themes.test.ts`
  reads `tokens.css` through `?raw` to check the palettes against `THEMES`, and without that flag it
  silently tested nothing at all.
- **A colon inside a CSS comment breaks a naive declaration scan.** The same test strips comments
  before parsing, because `darks: this theme is…` inside a `/* */` reads as a property and swallows
  the declaration after it.
- **Appearance must wait for `settings.loaded`.** The inline script in `app.html` paints the right
  theme before anything else runs, and an effect that applies `settings.current` eagerly repaints the
  defaults over it one frame later — undoing the work and reintroducing the flash. An E2E test
  asserts the attribute right after a reload, which is what caught it.
- **A reload can abort an IndexedDB write that has only just been issued.** Real people take
  milliseconds between changing a setting and reloading; a test takes none. `e2e/appearance.spec.ts`
  polls the database before simulating a cold start rather than trusting the store.
- **Playwright's `reuseExistingServer` will serve a stale build.** If you start `pnpm preview`
  yourself, Playwright reuses it and never rebuilds — you will debug fixes that were never loaded.
  Let Playwright own the server.
- **`pkill wrangler` leaves `workerd` running.** Orphans hold Miniflare's SQLite lock and break every
  later run. Kill `workerd` explicitly.
- **`BrowserContext.setOffline` does not affect intercepted routes.** A route fulfilled by Playwright
  never touches the network, so the fake keeps answering. `e2e/sync.spec.ts` gives its interception
  its own offline switch.
- **`page.keyboard.press('Enter')` does nothing under touch emulation.** Use `insertText('\n')`,
  which follows the same `beforeinput` path a real soft keyboard uses.
- **`keyboard.press` returns before the app has reacted.** In `e2e/sync.spec.ts`, asserting "Synced"
  straight after ⌘S can match the "Synced" left from the sync that ran when the repository was
  adopted, and the next assertion then reads a repo the edit never reached. Wait for the indicator to
  count the work (`expectPending`) before syncing it. It fails roughly one run in eight, only under
  full-suite load — `pnpm exec playwright test --repeat-each=4` is what surfaces it.
- **Paths are never localised.** Month directories come from a fixed English table in `paths.ts`.
  The moment a path segment goes through `Intl`, two devices in different locales write the same day
  to two different files and the sync engine's path map disagrees with itself.

## Verification

`pnpm test && pnpm test:tz && pnpm test:e2e` is the gate. 258 unit tests, 80 end-to-end.

**Unit (Vitest)** — `src/lib/{core,server}/**/*.test.ts`, plain node, no DOM:

- Frontmatter is idempotent and lossless (property tests via `fast-check`).
- Day-key arithmetic, run under five timezones by `pnpm test:tz` including Kiritimati and Niue.
- Blob SHAs pinned against values from real `git hash-object`.
- Three-way merge: clean merges, true conflicts, tag union, null-base creation on two devices.
- The scheduler under fake timers: debounce, coalescing, single-flight, backoff, and the hourly
  write budget asserted against GitHub's actual limit.
- PKCE against the worked example in RFC 7636; sessions; token refresh; `safeRedirect`.
- The proxy allowlist: every endpoint likh uses, and traversal / smuggled separators / method
  swapping refused.

**Integration** — the real `GitHubClient` driven against `src/lib/core/github/fake.ts`, an in-memory
GitHub that hashes blobs with the real algorithm and rejects non-fast-forward ref updates. Covers
first commit into an empty repo, coalescing several days into one commit, idempotent replay,
new-device pull, clean merge, conflict held back from push, stale-ref retry, interrupted push,
remote deletion, and leaving unrelated files alone.

**E2E (Playwright)** — desktop and mobile viewports, with `api.github.com` answered by the same
fake. Covers writing and reload, offline cold start through the service worker, live-preview
reveal-on-cursor, calendar, search, the connect flow, repo initialization being idempotent, and —
in two browser contexts against one remote — offline edits converging with no lost text, and a real
conflict surfacing rather than being resolved for you.

**Not yet covered, and known:**

- Nothing has run against real GitHub. The fake is faithful but it is a fake.
- The hosted OAuth flow is untested end to end; it needs a registered GitHub App.
- Mobile is Chromium touch emulation, not a real device.

**Manual, before a release** — a real GitHub repo end to end; iOS Safari and Android Chrome
installed as a PWA (keyboard, caret position, install prompt); airplane-mode cold boot; and open the
repo on github.com to confirm the markdown reads well with clean diffs.

---

## Risks

- **Mobile CodeMirror.** Still the biggest UX risk, and still open. Chromium touch emulation is
  fine — the `beforeinput`/`insertLineBreak` path a soft keyboard uses was verified to work — but
  iOS Safari has not been tried. Fallback if it disappoints: a plain textarea composing mode on
  small screens with live preview disabled.
- **Rate limits.** Mitigated by a 30s floor, debouncing, coalescing and single-flight; the ceiling
  is 120 pushes/hour (360 of GitHub's 500 content-generating requests), far above real journaling.
  Attachments in M4 add blob uploads to that budget and will need re-checking.
- **Merge on one shared day file.** The chosen data model concentrates concurrent edits into one file. `baseText` + diff3 handles it well; conflict markers are the honest fallback. Never auto-resolve by discarding a side.
- **Bundle weight vs. offline boot.** Budget: <150KB gzip for the initial shell. Currently 44KB;
  CodeMirror (~176KB) is lazy-loaded and MiniSearch lives in a worker.

## Non-goals for v1

AI reflections; GitLab/Gitea/self-hosted git; end-to-end encryption; real-time collaboration; native apps. The `GitHubClient` interface and the framework-free `core/` are the seams that keep all of these cheap to add later.
