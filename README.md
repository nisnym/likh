<div align="center">

# likh

**A journal that writes to your own GitHub repo.**

One markdown file per day. Every save is a real git commit. Works on a plane.

_likh_ (लिख) is Hindi for "write".

</div>

---

Every journaling app asks for the most personal text you will ever write, and then keeps it
somewhere you cannot read. Export is a feature request. The history is theirs. The company can shut
down.

likh keeps nothing. Your entries are plain markdown files in a GitHub repository **you** choose.
The app is a nice way to write into them — and if it disappeared tomorrow, you would still have
every word, in a folder, in a format that will outlive all of us.

## Your journal is just files

```
journal/
  2026/
    August/
      27.md
      28.md
```

```markdown
---
date: 2026-08-28
---

Shipped the sync layer today.
Still thinking about the merge strategy for offline edits.
```

That's it. No wrapper format, no proprietary blob, no export step. Open it on github.com. `grep` it.
Clone it to a Raspberry Pi. Read it in twenty years on something that hasn't been invented yet.

And because it's git, you get something no journaling app has ever given you for free: **an honest
history of what you wrote and when you changed your mind.**

## What it does

### It writes beautifully

A full-bleed writing surface with the chrome out of the way. Markdown with the syntax hidden on
lines you're not editing — you see the heading, not the `#` — while the file underneath stays
exactly what you typed.

Bold, italic, headings, quotes, lists, code and links, from a toolbar or from the shortcuts you
already know. **Focus mode** dims every paragraph but the one you're in. **Typewriter scroll** keeps
the line you're writing in the middle of the screen. Six themes, three light and three dark, plus
the text size and column width you like. It opens on paper white, because a journal should look like
paper unless you said otherwise.

### It works with no internet at all

Not "offline capable". Offline **first**. Your device is the source of truth and the editor never
waits on the network — git is where it syncs to, not something it needs to run. Write on the
Underground, in a basement, on a flight. It's an installable app on your phone, built for a thumb
keyboard as much as a desk.

### It respects the past

Today's entry is yours to change. **A day that has ended is a record, and likh won't let you rewrite
it.** You can add to it — and the addition says when it was written.

```markdown
Shipped the sync layer today.

---

**Added 2 September 2026**

This is the commit that broke staging, as it turned out.
```

This is the one place likh is deliberately less capable than a folder of text files, and it is the
whole reason to keep a journal instead of a wiki. An entry is worth something because it records
what you thought _at the time_. Editing it two years later destroys that, and destroys it
invisibly.

### It never loses a word

Two devices, both offline, both editing Tuesday. likh keeps the exact bytes it last saw on the
remote, so when you reconnect it can merge the two properly — different paragraphs of the same day
just resolve. When the two versions genuinely collide, **both are kept**, side by side, and it asks
you. Nothing is ever thrown away to make a merge succeed.

### It commits when you say so

Syncing is manual by default. Nothing reaches GitHub until you press sync, and then everything
outstanding goes up as one commit. A journal is a draft until you decide it isn't, and the history
reads better for it — a commit per sitting, not a commit per pause in your typing. Turn on automatic
sync if you'd rather not think about it.

### Little things that add up

**Templates** for the shape of an entry you write often — a daily check-in, three good things — with
`{{date}}`, `{{weekday}}`, `{{time}}` filled in and `{{cursor}}` for where to land. Always offered,
never applied on their own, so a day you opened and left alone stays out of your repository and
"days I wrote" keeps meaning something.

**A calendar** of everything you've written, **full-text search** that works offline, and one
permission asked of GitHub: read and write the contents of the repos you pick.

## What's next

The journal, the writing surface and the sync engine are built. These are the next things:

| What                       | Why                                                             |
| -------------------------- | --------------------------------------------------------------- |
| **Images**                 | Paste a photo, get a resized WebP committed alongside the entry |
| **A command palette**      | ⌘K for everything, not just search                              |
| **Export everything**      | A zip of your markdown, without a repo, without an account      |
| **Real typography**        | Self-hosted variable fonts instead of whatever the OS has       |
| **A first-run that sings** | The empty state is where people decide whether to come back     |
| **A landing page**         | likh.dev serves the app itself; there's nothing to read first   |
| **Tags**                   | The file format reserves the field; nothing yet writes to it    |

Further out, and unbuilt on purpose: **GitLab, Gitea and plain self-hosted git** (the client is
already behind one interface, so this is a day's work for someone who wants it), **end-to-end
encryption**, and a **native shell** — nothing under `src/lib/core/` imports Svelte, which is the
seam that keeps all three cheap.

## We'd love your help

This is an open project and it is genuinely open. **If you have an idea, open an issue — we want to
hear it.** If you'd rather just build the thing, do that; a rough PR that shows what you mean is
worth more than a paragraph describing it.

Good places to start, roughly by size:

- **A branch picker in settings.** The branch is read from the repo's default and shown read-only,
  but it's carried end to end already. This is UI only.
- **Any row in the table above.** Images is the biggest and the most fun.
- **Themes.** Palettes live in one file and a test fails if a theme is half-added. Bring a good one.
- **A phone you own.** Mobile was verified in emulation. iOS Safari is where editors go to die, and
  a real report from a real device is a real contribution.
- **Anything that makes writing in it better.** That's the whole point of the project. If it feels
  wrong to you while you're using it, that's a bug, and saying so is useful.

Two things to keep in mind while you work: **the repository format is a promise** — files someone
can read without this app, diffs a human can follow — and **logic belongs in `src/lib/core/`**,
away from the framework, where it can be tested honestly. Beyond that, come in.

Run `pnpm install && pnpm dev`. The full picture is in
**[docs/technical.md](docs/technical.md)** — architecture, the sync engine, auth, testing, and how
to host your own copy. The design and its running status are in [docs/plan.md](docs/plan.md).

## Where things stand

Early, honest, and usable. The journal works offline, syncs to a GitHub repo, and two devices
editing the same day converge without losing text — proven by 281 unit tests (run across five
timezones) and 90 end-to-end tests on desktop and mobile viewports.

It's live at **[likh.dev](https://likh.dev)**. Not yet: images, and a run against real GitHub —
sync is verified against a complete in-memory GitHub rather than the live API. Hosted sign-in isn't
switched on there yet either, so today you connect it to your own repo with a personal access
token — which needs no server at all.

## License

MIT. Take it.
