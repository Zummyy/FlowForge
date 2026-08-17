# FlowForge 🎤

[![CI](https://img.shields.io/github/actions/workflow/status/Zummyy/FlowForge/ci.yml?branch=main&label=CI&logo=github)](https://github.com/Zummyy/FlowForge/actions/workflows/ci.yml)

A Next.js studio toolkit for rappers and lyricists — write verses in The Vault
(with rhyme analysis, metronome, flow meter, moodboard, release planner), record
takes and arrange clips in the Studio, then save finished numbers to the
„Gotowe Numery" library. Includes a community feed, challenges with
achievements, beat/inspiration libraries, cover-art generator, a music
budget tracker and print/PDF export of lyrics („Eksportuj PDF” — a portaled
print view, so „Zapisz jako PDF” in the browser dialog does the work with no
server-side PDF engine).

Built with **Next.js 16** (App Router), **React 18**, **TypeScript**, **Prisma 5 +
SQLite** and **Tailwind CSS**.

---

## Quick start

Prerequisites:

- **Node.js ≥ 22** (the E2E suite needs the global `WebSocket`/`fetch`)
- Chrome (used by the E2E suite via the DevTools protocol)

```bash
npm install
```

`.env` is committed on purpose — it only holds the non-secret SQLite path and
the schema requires `DATABASE_URL` with no fallback:

```dotenv
DATABASE_URL="file:./dev.db"
```

Set up the database and seed it with demo data:

```bash
npm run db:reset   # backup → --force-reset → seed → sweep:recordings
```

> ⚠️ `db:reset` **wipes the whole database** (profile, achievements, everything)
> and inserts the demo seed. It's the intended way to start fresh — but it is
> destructive. **It's also reversible**: the current DB is snapshotted to
> `prisma/backups/` first (`db:backup`), and `npm run db:restore` brings the
> newest snapshot back. Stop the dev server before restoring.

Start the dev server:

```bash
npm run dev
```

Open <http://localhost:3000> (or <http://127.0.0.1:3000> — `allowedDevOrigins`
in `next.config.mjs` makes the IP work out of the box).

## Scripts

| Command             | What it does                                                                  |
| ------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`       | Start the Next.js dev server on :3000                                         |
| `npm run build`     | Production build (`next build`)                                               |
| `npm start`         | Serve the production build                                                     |
| `npm run db:push`   | Sync the Prisma schema into the SQLite database (non-destructive)             |
| `npm run db:seed`   | Seed demo data (idempotent — never overwrites real rows)                       |
| `npm run db:backup` | Snapshot the DB to `prisma/backups/dev-<timestamp>.db` (with integrity check)  |
| `npm run db:reset`  | **Backup first**, then `--force-reset` + seed — destructive but reversible    |
| `npm run db:restore`| Restore the newest backup (`-- <path>` for a specific one; requires `--yes`)  |
| `npm run db:studio` | Open Prisma Studio to browse/edit the database                                 |
| `npm run gen:beats` | Regenerate the demo WAVs in `public/` (full beats + the per-stem tracks in `public/stems/` for the /beats mixer) |
| `npm run gen:icons` | Regenerate the PWA icons (`public/icon-192/512.png`) — needed by the manifest |
| `npm test`          | Run everything: unit suites **then** the E2E suite (exit 1 on any failure)    |
| `npm run test:unit` | Run the 8 unit suites (`scripts/test-*.ts`)                                    |
| `npm run test:ui`   | Run the E2E browser suite (`scripts/test-vault-ui.mjs`)                        |

### The demo seed

`npm run db:seed` (also run by `db:reset`) makes the app feel alive from the
first launch: a profile (MC, 150 pts, level 3), two challenges with example
submissions, three sample beats („Miejski Rytm", „Nocny Drive", „Stary Blok" —
backed by the real demo WAVs — „Miejski Rytm” is seeded with `isStems` +
`stemsData` pointing at four generated tracks (drums/bass/melody/vocals) so
`/beats` shows a working stem mixer with per-channel mute + solo). „+ Dodaj Numer”
on `/beats` opens an upload modal with two modes: a single beat file, or a
**4-channel stem pack** (drums/bass/melody/vocals — all four required) whose
channels are stored as data URLs in `stemsData` and feed the same mixer. The
modal's uploads go through a server action, so `next.config.mjs` raises
`experimental.serverActions.bodySizeLimit` to 32 MB — the default 1 MB cap
would reject real audio data URLs (a single WAV over ~750 KB or any stem pack).
Three inspiration entries, and matching challenge
progress + achievements. Re-seeding on a populated DB is **non-destructive**
(upserts by stable ids, never touches your data).

## Architecture

### DB-primary with a localStorage mirror

Every feature that needs persistence follows the same pattern:

1. **SQLite via Prisma is the source of truth** (server actions in `src/actions/`).
2. **localStorage is only an offline cache/mirror** — written on every change so
   the UI still works when the backend is down, and re-synced on the next load.

The app is also a **PWA**: `public/manifest.json` (with real 192/512 icons,
regenerated via `npm run gen:icons`) makes it installable, and `public/sw.js`
precaches the app shell + serves navigations network-first with the cached
shell as the offline fallback (stale-while-revalidate for `/_next/static` and
stem/media files; `/api/recordings` is always network-only). The sidebar shows
a „⬇️ Zainstaluj aplikację" button when the browser offers the install
(`beforeinstallprompt` — it hides once installed or when the app already runs
as a PWA). The sidebar's profile chip is DB-primary too: it reads the artist's
`displayName`/avatar/level/points from the `userProfile` row (no hardcoded
„MC FlowForge") and refreshes on the `flowforge-profile-updated` event the
profile page fires after a save. Combined with the localStorage mirrors above,
the app stays usable with no connection.

Implemented this way for: moodboard, release plan, „Gotowe Numery" (saved Studio
projects), inspirations, challenge progress, budget expenses, lyrics/versions,
cover art („Zapisane Okładki" gallery — stores a downscaled PNG preview; the
full-res PNG is rendered live on download) and the vault tools panel. Lyrics
can be **published** (status `published` + `isPublic`): the Vault shows a
„✓ Opublikowany" badge and a toggle, and the share link `/feed?shared=<id>`
renders the lyric read-only on the Feed — `getPublicLyric` only ever returns
lyrics that were actually published. The dashboard stats read **exclusively
from the DB** — a stale localStorage mirror can never skew the cards. The dashboard's „📈 Aktywność pisania" chart buckets
`LyricVersion.createdAt` + `syllableCount` into per-day bars (7/30-day toggle),
so the writing streak stops being a bare number.

Version history is capped: each track keeps at most **50 active versions**
(`MAX_ACTIVE_VERSIONS_PER_LYRIC` in `src/lib/lyric-versions.ts`). When a save
would exceed the cap, the oldest version is **archived** (never deleted) and can
be restored or purged from the Vault's „Wersje" tab.

### Studio recordings (`uploads/` + `Recording`)

Vocal takes recorded in the Studio are **uploaded as raw bytes** to
`POST /api/recordings` (a route handler — Server Actions cap bodies at ~1 MB,
which audio blobs exceed). The file lands under `uploads/recordings/`
(gitignored) and the `Recording` table indexes takeId → file, so restored takes
fetch their audio back from `GET /api/recordings/<takeId>` in **any browser**.
Re-uploading the same take overwrites both file and row (upsert); deleting a
take removes the file after the undo window (cancelled by „↩️ Cofnij”). Deleting
a whole **project** from „Gotowe Numery” (`/beats`) prunes every take it
references too — `deleteProject` collects the `/api/recordings/<takeId>` URLs
from the saved payload and removes each file + row. The live session mirror
(`flowforge-studio-live`) stores the server URL instead of a base64 data URL,
which also removes the ~5 MB localStorage ceiling.

`npm run sweep:recordings` cleans up **orphans** left by crashed runs or manual
db edits: files under `uploads/recordings/` whose takeId has no `Recording`
row, and rows whose file is missing from disk (`--dry-run` to preview). Row+file
pairs are always kept — a take can live in a not-yet-saved session.

### Database notes

- SQLite runs in **WAL mode** (set in `src/lib/prisma.ts` and the seed), so the
  dev server, seeds and tests read/write concurrently without file locks.
- `prisma/dev.db*` (including `-wal`/`-shm`) is gitignored — your data never
  lands in the repo. Same for `prisma/backups/` (the `db:reset` snapshots) and
  `uploads/` (user recordings). `db:reset` now ends with
  `npm run sweep:recordings`, so the recording files orphaned by the reset are
  removed automatically (a fresh reset = a fresh `uploads/recordings/`); you
  can also run the sweep standalone with `--dry-run` to preview.

## Testing

### Unit suites (`npm run test:unit`)

`scripts/run-unit-tests.mjs` discovers and runs every `scripts/test-*.ts`
sequentially (order matters — `test-db-wiring` uses its own isolated DB copy).
The wiring test exercises every server action end-to-end: lyrics/versions
(including the archive cap), export, budget, feed, achievements, beats, saved
projects, inspirations and recordings (file + row upsert, id sanitization,
delete).

### E2E suite (`npm run test:ui`)

`scripts/test-vault-ui.mjs` is a self-contained browser suite (no test
framework — plain CDP over Node):

- **Starts its own dev server on a free port** and drives a headless Chrome via
  the DevTools protocol, so it never touches a server you're already running.
- **Runs against an isolated copy of `prisma/dev.db`** (copied to a temp file
  with its WAL/SHM siblings; `DATABASE_URL` is pointed at the copy before any
  Prisma client is constructed). Your real database is never opened — the copy
  is deleted in a `finally`, even on crash.
- 25 scenarios (≈615 checks): Vault tools (rhyme markers — full-text word-level
  clustering: internal rhymes („Płomień”↔„Promień” mid-line), multi-word and
  assonance/near-rhyme clusters („dziwny/inni”, „jakiś/taki”); the editor
  highlights EVERY matching word with its cluster color, 1:1 with the
  „Analiza Wersów” dots (multi-dot lines) even across blank-line stanza
  breaks; writer block — 70+ „Iskry” in 5 categories, „Losuj Klimat” picks
  1–3 mood tags with a glow and rolls a context-aware spark (klimat
  templates + mood affinity), manual multi-select mood tags; editor
  undo/redo — own history stack (typing bursts merge into one step,
  programmatic insertions like „Iskra” are independent transactions,
  Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z bound); metronome via an injected fake
  `AudioContext`, moodboard + DB sync), flow meter, release plan,
  dashboard (streak, level, challenge tile, recent lyrics, budget tile,
  „Ostatnio Użyte Beat / Podkłady” mini-player — real history driven by
  Beat.lastPlayedAt (playing anywhere records it; „🎙️ Nagraj” deep-links to
  /studio?beatId=<id>, which loads and pre-selects that exact beat — deep links), Studio
  (teleprompter, clip timeline, „Zapisz Projekt" → DB + dedup),
  challenges (incl. cypher voting — ▲ button, DB-primary dedup via the
  voters column: one vote per browser, locked after voting + on reload), feed, inspirations, cover, profile, track archive, publish,
  durable recordings (incl. project-delete pruning), export history, budget
  breakdown charts (per-category + per-project), the versions cap/archive flow
  (auto-archive at the 50-version limit, restore swap, purge), stem mixer
  (per-channel mute + solo — solo silences the rest, switches between
  channels, „Wyłącz solo” restores; „🎙️ Nagraj miks” records the current
  mute/solo mix to a single webm via MediaRecorder — gains match the mixer
  state, stop downloads a title-derived file and closes the graph), PWA/offline, the `sweep:recordings` orphan cleanup script (dry-run vs
  real run), the sidebar install prompt (hidden by default, appears on
  beforeinstallprompt, prompt()/userChoice contract, dismissed keeps it), the
  „Dodaj Numer” stem-upload modal (4 real WAVs → isStems + stemsData
  data URLs in the DB, mixer renders; single-beat tab still works), and the
  /academy static articles (header, all 6 cards with difficulty badges +
  read time, expand/collapse single-open accordion, category filters
  Rymy/Flow/Technika/Twórczość narrow the list and „Wszystkie” restores it),
  the ✏️ beat edit modal (prefilled from the row, empty-title validation,
  title/artist/BPM/key saved to the DB, unrelated fields untouched, edit
  persists across reload; the /beats search box filters cards by
  title/artist with a „Brak wyników” state — regression guard), destructive
  actions on /beats + /cover are gated by the shared ConfirmDialog (cancel
  keeps the row; the project-delete dialog warns the takes' recordings are
  pruned), and the
  „+ Nowy Cypher” form (empty-title +
  past-deadline validation, card renders with a DB-derived countdown,
  „Zgłoszenia • 0”, row created isActive, persists across reload; the vote
  toast regression guard covers the ToastView render on /challenges).
  Fixtures are seeded through the isolated DB copy and cleaned up per
  scenario, so the run is deterministic.

Requires **Node ≥ 22** and an installed Chrome. On CI runners (GitHub Actions
included) the suite detects the `CI` env var and adds Chrome's
`--no-sandbox`/`--disable-dev-shm-usage` flags automatically.

### CI

`.github/workflows/ci.yml` runs `npm ci`, `prisma db push` + `db:seed` (the
suites need `prisma/dev.db` to exist; `.env` is committed so no env setup is
required), `tsc --noEmit`, then `npm test` on every push and pull request.

## Project layout

```
prisma/schema.prisma        # Data model (SQLite)
prisma/seed.ts              # Demo seed (idempotent)
src/actions/                # Server actions — the only DB access layer
src/app/                    # Pages: vault, studio, beats, challenges, feed,
                            #   inspirations, cover, budget, profile, academy
src/components/studio/      # Studio shared components (toast, dialogs, types)
src/lib/                    # Pure logic + shared constants (rhyme engine,
                            #   syllable counter, db-sync, track sort/filter,
                            #   lyric-versions cap, challenges, prisma client)
scripts/test-*.ts           # Unit suites (run via npm run test:unit)
scripts/test-vault-ui.mjs   # E2E browser suite
scripts/generate-demo-beats.mjs  # Demo WAV generator (npm run gen:beats)
public/test-beat-*.wav      # Generated demo beats (playable audio)
```
