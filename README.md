# FlowForge 🎤

A Next.js studio toolkit for rappers and lyricists — write verses in The Vault
(with rhyme analysis, metronome, flow meter, moodboard, release planner), record
takes and arrange clips in the Studio, then save finished numbers to the
„Gotowe Numery" library. Includes a community feed, challenges with
achievements, beat/inspiration libraries, cover-art generator and a music
budget tracker.

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
npm run db:reset   # prisma db push --force-reset && tsx prisma/seed.ts
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
| `npm run gen:beats` | Regenerate the demo WAVs in `public/` (real, playable 16-bit PCM beats)        |
| `npm test`          | Run everything: unit suites **then** the E2E suite (exit 1 on any failure)    |
| `npm run test:unit` | Run the 8 unit suites (`scripts/test-*.ts`)                                    |
| `npm run test:ui`   | Run the E2E browser suite (`scripts/test-vault-ui.mjs`)                        |

### The demo seed

`npm run db:seed` (also run by `db:reset`) makes the app feel alive from the
first launch: a profile (MC, 150 pts, level 3), two challenges with example
submissions, three sample beats („Miejski Rytm", „Nocny Drive", „Stary Blok" —
backed by the real demo WAVs), three inspiration entries, and matching challenge
progress + achievements. Re-seeding on a populated DB is **non-destructive**
(upserts by stable ids, never touches your data).

## Architecture

### DB-primary with a localStorage mirror

Every feature that needs persistence follows the same pattern:

1. **SQLite via Prisma is the source of truth** (server actions in `src/actions/`).
2. **localStorage is only an offline cache/mirror** — written on every change so
   the UI still works when the backend is down, and re-synced on the next load.

Implemented this way for: moodboard, release plan, „Gotowe Numery" (saved Studio
projects), inspirations, challenge progress, budget expenses, lyrics/versions,
cover art („Zapisane Okładki" gallery — stores a downscaled PNG preview; the
full-res PNG is rendered live on download) and the vault tools panel. The
dashboard stats read **exclusively from the DB** — a stale localStorage mirror
can never skew the cards.

Version history is capped: each track keeps at most **50 active versions**
(`MAX_ACTIVE_VERSIONS_PER_LYRIC` in `src/lib/lyric-versions.ts`). When a save
would exceed the cap, the oldest version is **archived** (never deleted) and can
be restored or purged from the Vault's „Wersje" tab.

### Database notes

- SQLite runs in **WAL mode** (set in `src/lib/prisma.ts` and the seed), so the
  dev server, seeds and tests read/write concurrently without file locks.
- `prisma/dev.db*` (including `-wal`/`-shm`) is gitignored — your data never
  lands in the repo. Same for `prisma/backups/` (the `db:reset` snapshots).

## Testing

### Unit suites (`npm run test:unit`)

`scripts/run-unit-tests.mjs` discovers and runs every `scripts/test-*.ts`
sequentially (order matters — `test-db-wiring` uses its own isolated DB copy).
The wiring test exercises every server action end-to-end: lyrics/versions
(including the archive cap), export, budget, feed, achievements, beats, saved
projects and inspirations.

### E2E suite (`npm run test:ui`)

`scripts/test-vault-ui.mjs` is a self-contained browser suite (no test
framework — plain CDP over Node):

- **Starts its own dev server on a free port** and drives a headless Chrome via
  the DevTools protocol, so it never touches a server you're already running.
- **Runs against an isolated copy of `prisma/dev.db`** (copied to a temp file
  with its WAL/SHM siblings; `DATABASE_URL` is pointed at the copy before any
  Prisma client is constructed). Your real database is never opened — the copy
  is deleted in a `finally`, even on crash.
- 12 scenarios (≈240 checks): Vault tools (rhyme markers, metronome via an
  injected fake `AudioContext`, moodboard + DB sync), flow meter, release plan,
  dashboard (streak, level, challenge tile, recent lyrics, budget tile, deep
  links), Studio (teleprompter, clip timeline, „Zapisz Projekt" → DB + dedup),
  challenges, feed, inspirations, and the versions cap/archive flow (auto-
  archive at the 50-version limit, restore swap, purge). Fixtures are
  seeded through the isolated DB copy and cleaned up per scenario, so the run is
  deterministic.

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
