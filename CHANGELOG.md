# Changelog

Notable changes to likh. Dates are the day the change went out.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html). Until 1.0 the minor number moves when
something visible changes.

**The repository format is versioned separately and more carefully.** `.likh/config.json` carries
its own `version`, and a change there is a breaking change no matter what this file says — a journal
written by any release must stay readable by every later one.

## [Unreleased]

### Added

- Open Graph and description metadata, so a link to likh.dev unfurls with a title, a summary and a
  card image instead of a bare URL. The app renders client-side, so these are static in `app.html`.
- An error page (`+error.svelte`) for unresolvable routes and unexpected throws, replacing
  SvelteKit's default. It reads no storage, so a failure in the database layer cannot fail it too.
- `pnpm verify` — the full gate (`check`, `test`, `test:tz`, `test:e2e`) in one command.
- `.nvmrc`, `engines`, `packageManager` and `.editorconfig`, so a contributor's toolchain matches.

### Removed

- `eslint`, which was a dependency with no configuration file and no script. `svelte-check` covers
  the same ground and actually runs.

## [0.1.0] — 2026-08-29

First deploy. Live at [likh.dev](https://likh.dev).

### Added

- **The journal.** One markdown file per day in a GitHub repository you choose, written to
  IndexedDB first and committed on sync. The editor never waits on the network.
- **The writing surface.** CodeMirror 6 with markdown syntax hidden on lines the cursor is not on,
  a formatting toolbar and keyboard shortcuts, focus mode, typewriter scroll, and six themes across
  three light and three dark palettes.
- **Offline from cold.** A service worker precaches the app shell; the whole journal, calendar and
  full-text search work with no network at all. Installable as a PWA.
- **Sync.** Three-way merge against a stored merge base, so two devices editing the same day
  converge without losing text. Genuine conflicts are written as standard git conflict markers and
  held back from pushing. Manual by default; automatic sync is opt-in.
- **Two ways to connect.** A GitHub App through a Cloudflare Worker that keeps the token off the
  page, or a personal access token that needs no server at all.
- **Append-only past.** A day that has ended is a record: likh appends to it, dated, rather than
  rewriting it.
- **Templates** with `{{date}}`, `{{weekday}}`, `{{time}}` and `{{cursor}}`, always offered and
  never applied on their own.

### Known gaps

- Images and attachments are not built. The on-disk contract exists in `core/repo/paths.ts`; nothing
  writes to the `attachments` store yet.
- Sync is verified against a complete in-memory GitHub rather than the live API.
- Hosted sign-in is not configured on likh.dev, so the personal-token path is the one that works
  there today.
- Mobile was verified in emulation, not on a physical device.

[Unreleased]: https://github.com/nisnym/likh/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nisnym/likh/releases/tag/v0.1.0
