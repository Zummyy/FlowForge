#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────
// Browser E2E verification of the The Vault tools (no npm dependencies):
//
//   • Rhyme markers  — mirror rendered, rhyme groups highlight the exact
//     rhyming WORD of each line with the „Analiza Wersów” group colors
//     (1:1 by line, blank-line stanza breaks included), markers track
//     textarea scrolling (dynamic, not static rectangles)
//   • Metronome      — Web Audio lookahead scheduling: exact osc.start(t)
//     spacing at 90/95 BPM, live tempo change, stop cancels all timers
//   • Writer block   — categorized „Iskra” database (5 prompt types), „Losuj
//     Klimat” auto-selects mood tags with a glow + rolls a context-aware
//     spark (klimat templates/affinity), manual multi-select, insert both
//   • Editor undo/redo — own history stack: typing bursts = one step,
//     programmatic insertions (Iskra) = independent transactions;
//     Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z restore exact pre-insertion state
//   • Moodboard      — image upload, drag & drop reordering, persistence,
//     DB sync (keyword lands in the board row) + restore from the DB after
//     a localStorage wipe
//   • Flow Meter     — syllable counts accurate (regression: stateful regex)
//   • Release Plan   — milestones toggle/add, target date, persistence//   • Dashboard      — streak, level bar, active-challenge tile (countdown,
//     submit flow), „Ostatnio Edytowane” empty state, recent-lyrics deep
//     links, live refresh reorder on the vault save event, /vault?track=<id>
//     deep-link navigation + unknown-id fallback, stats grid, budget tile,
//     „Ostatnio zapisane projekty” tile (DB-primary, live-refresh event),
//     „Ostatnio Użyte Beat / Podkłady” mini-player (empty state, lists the
//     seeded beat with play + 🎙️ Nagraj, ▶→⏸ play/pause via a stubbed
//     Audio, playing records lastPlayedAt — real history, Nagraj deep-links
//     to /studio?beatId=<id>)
//   • Studio         — teleprompter (pick text, fullscreen scroll, pause,
//     close) and clip timeline (select take, marker, split, undo/redo,
//     reload persistence); the ?beatId= deep-link loads that exact beat
//     (audio from filePath/stems, session persisted, lastPlayedAt recorded,
//     unknown id falls back gracefully)
//   • Save Project    — modal summary + custom name, project lands in the
//     „Gotowe Numery” library and renders on /beats across reloads
//   • Challenges      — DB-primary progress render (score/count/percent),
//     auto-award of achievements, „Resetuj postęp” wipes DB + mirror + badges
//   • Feed            — seeded post render, like toggle, 5★ rating, comment
//     thread, publishing a new post (all DB-backed)
//   • Inspirations    — seeded cards (difficulty + tags), optimistic voting
//   • Cover            — generate + save cover, gallery from the DB across
//     reloads, „Wczytaj” restores settings, delete removes the DB row
  //     with DB persistence, search + difficulty/tag filters, adding new rows
//   • Profile          — DB-primary edit (name/bio/avatar) with persistence
//     across reloads, level bar + stats grid + achievements from the DB;
//     sidebar profile chip reads the same row (no hardcoded „MC FlowForge”)
//     and refreshes via the „flowforge-profile-updated” event
//   • Track Archive     — „📦 Archiwum” section in the Vault: hide a track
//     (status archived, editor switches away), restore, permanent delete
//   • Publish            — „📤 Publikuj utwór” (status published + isPublic),
//     „✓ Opublikowany” badge, /feed?shared=<id> read-only card, „Cofnij”
//   • Recordings        — durable Studio takes: POST /api/recordings (raw
//     bytes → uploads/ file + Recording row), GET streams them back, upsert
//     on re-upload, DELETE removes row + file, 404 afterwards; deleting a
//     „Gotowe Numery” project on /beats prunes its takes' recordings (rows
//     + files), so no .webm orphans survive a project delete
//   • ExportLog          — real history source: „Eksporty” stat card on the
//     dashboard (DB count), per-format badges + „🧹 Wyczyść historię” in the
//     Vault history panel (row deletions land in the DB)
//   • Budget             — /budget breakdown charts: summary cards (total /
//     count / projects), „Według Kategorii” bars with per-category colors +
//     widths, „Według Projektów” bars sorted desc with distinct colors
//   • Stem mixer         — /beats stems beat (isStems + stemsData): 4
//     channels render, ▶ starts all audios in sync, per-channel mute drops
//     volume to 0 (🔇 + line-through) and back, ⏸ pauses everything
//   • PWA                — manifest + real 192/512 icons (decode as PNG),
//     service worker registers/activates/controls the page, offline reload
//     renders the app shell from cache, back online restores normal loads
//   • Sweep               — `sweep:recordings` on the isolated copy:
//     orphaned file (no row) + broken row (no file) reported by --dry-run
//     and removed by the real run, healthy row+file pair kept
//   • Install prompt      — sidebar „⬇️ Zainstaluj aplikację”: hidden by
//     default, appears on beforeinstallprompt, clicking invokes the stored
//     prompt() (accepted hides it, dismissed keeps it), appinstalled removes it
//   • Stem upload         — „Dodaj Numer” modal: stems tab attaches 4 real
//     WAVs (drums/bass/melody/vocals) → card + „🎛️ Stemy” mixer render, DB
//     row carries isStems + stemsData data URLs; single-beat tab still works
//   • Academy             — /academy static articles: header + all 6 cards,
//     difficulty badges + read time, expand/collapse accordion (single-open),
//     category filters (Rymy/Flow/Technika/Twórczość) narrow the list and
//     „Wszystkie” restores it
//   • Edit beat           — ✏️ on a beat card: modal prefilled from the row,
//     empty-title validation keeps it open, saving title/artist/BPM/key
//     updates the card + DB row (unrelated fields untouched), persists
//     across reload; the search box filters cards by title/artist
//     („Brak wyników” empty state, clearing restores the grid)
//   • Create cypher       — „+ Nowy Cypher” on /challenges: modal with
//     title/description/prize/deadline, empty-title + past-deadline
//     validation keeps it open, saving renders the card (countdown from the
//     DB deadline, „Zgłoszenia • 0”), row created isActive, persists across
//     reload
  //

// The script starts its own Next.js dev server (or reuses one that is
// already running for this project) and a headless Chrome, runs every
// scenario through the Chrome DevTools Protocol and cleans up after
// itself when done (success or failure).
//
// Requirements:
//   • Node ≥ 22 (global `fetch` + `WebSocket`)
//   • A Chrome/Chromium install (override with CHROME_PATH)
//   • `npm install` already run in this repo
//
// Usage:
//   npm run test:ui
//   node scripts/test-vault-ui.mjs
//
// Optional env overrides:
//   PORT        — dev-server port (default: a free port)
//   CDP_PORT    — Chrome remote-debugging port (default: a free port)
//   CHROME_PATH — path to the Chrome executable
//   VAULT_URL   — if set, no dev server is started (use your own)
//
// Notes:
//   • ISOLATION: the test never touches prisma/dev.db. It copies the file to
//     a temp location, starts its own dev server pointed at the copy, tests
//     against it and deletes it afterwards. Because Next.js allows only ONE
//     dev server per project directory, a dev server that is already running
//     makes the test refuse to start (it would otherwise hit dev.db) — stop
//     it first, or use VAULT_URL with a server you started yourself against
//     an isolated DB (see the error message for the exact command).
//   • The metronome scenario injects a fake AudioContext because headless
//     Chrome has no audio device — the audio clock would never advance.
// ────────────────────────────────────────────────────────────────────────
"use strict";

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Direct DB access for fixture setup/teardown (e.g. resetting the release
// plan row so the scenario starts from the factory defaults). The client is
// instantiated lazily AFTER DATABASE_URL points at the isolated copy, so it
// only ever touches the copy — never the real prisma/dev.db.
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
let _prisma = null;
const prisma = () => (_prisma ??= new PrismaClient());

// ── Isolated DB copy ───────────────────────────────────────────────────
// The test runs against a throwaway copy of prisma/dev.db (plus any WAL/SHM
// journal siblings), so the user's real data is never modified. The copy is
// deleted in the finally block.
let isolatedDbFiles = [];

function prepareIsolatedDb() {
  const src = path.join(ROOT, "prisma", "dev.db");
  if (!existsSync(src)) throw new Error(`prisma/dev.db not found at ${src}`);
  const dest = path.join(os.tmpdir(), `flowforge-e2e-db-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  isolatedDbFiles = [];
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const f = src + suffix;
    if (existsSync(f)) {
      copyFileSync(f, dest + suffix);
      isolatedDbFiles.push(dest + suffix);
    }
  }
  // Absolute, forward-slashed path so Prisma opens exactly this file.
  process.env.DATABASE_URL = "file:" + dest.replace(/\\/g, "/");
  console.log(`  • isolated DB copy: ${dest}`);
}

function cleanupIsolatedDb() {
  for (const f of isolatedDbFiles) {
    // Windows may hold the file a moment after the server dies — retry.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(f, { force: true });
        break;
      } catch {
        // eslint-disable-next-line no-loop-func
        if (attempt === 4) console.error(`  (warn) could not remove ${f}`);
        else new Promise((r) => setTimeout(r, 200));
      }
    }
  }
  isolatedDbFiles = [];
}


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

if (typeof WebSocket !== "function") {
  console.error("This test needs Node ≥ 22 (global WebSocket). Current Node:", process.version);
  process.exit(1);
}

// ── Config ───────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 0); // 0 → pick a free port
const CDP_PORT = Number(process.env.CDP_PORT || 0);
const USE_EXTERNAL_SERVER = !!process.env.VAULT_URL;

let failures = 0;
let passed = 0;
const check = (cond, label) => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ FAIL: ${label}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = async () => {
  const srv = net.createServer();
  await new Promise((res, rej) => {
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", res);
  });
  const port = srv.address().port;
  srv.close();
  return port;
};

const findChrome = () => {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates =
    process.platform === "win32"
      ? [
          // Forward slashes on purpose: Windows APIs accept them, and backslashes
          // in source get mangled by string escaping on some platforms.
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
          "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
          ...(process.env.LOCALAPPDATA
            ? [path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")]
            : []),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((p) => existsSync(p)) || null;
};

// ── Process management ───────────────────────────────────────────────
let devServer = null;
let chromeProc = null;
let chromeProfileDir = null;

/** GET with full control over headers (Node fetch forbids Origin/Referer). */
function getWithHeaders(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") })
      );
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
  });
}

/**
 * True when the app HTML loads AND every JS chunk is served for a browser
 * whose origin is `host:port`. Next 16 dev blocks dev resources when the
 * request's Origin hostname is not in its allowed list — `localhost` is
 * always allowed, `127.0.0.1` is NOT for a server bound to localhost (the
 * default). A page whose chunks are blocked SSR-renders but never hydrates,
 * so this probe replicates the browser's Origin/Sec-Fetch headers exactly.
 */
async function hostServesChunks(host, port) {
  try {
    const origin = `http://${host}:${port}`;
    const html = await getWithHeaders(`${origin}/vault`);
    if (html.status !== 200 || !html.body.includes("FlowForge")) return false;
    const chunkUrls = [
      ...new Set([...html.body.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)].map((m) => m[0])),
    ];
    const headers = {
      Origin: origin,
      Referer: `${origin}/vault`,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Dest": "script",
    };
    for (const url of chunkUrls) {
      const res = await getWithHeaders(`${origin}${url}`, headers);
      if (res.status !== 200) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect a dev server already serving this app (Next allows only one dev
 * server per project directory, so a second `next dev` would refuse to start).
 * Checks both localhost and 127.0.0.1 and returns the host that actually
 * serves the JS chunks (see hostServesChunks).
 */
async function findRunningDevServer() {
  const ports = [...new Set([3000, ...(PORT ? [PORT] : [])])];
  for (const port of ports) {
    // localhost first — it matches how `next dev` is normally started.
    for (const host of ["localhost", "127.0.0.1"]) {
      if (await hostServesChunks(host, port)) return `http://${host}:${port}/vault`;
    }
  }
  return null;
}

async function startDevServer(port) {
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) {
    throw new Error(`next bin not found at ${nextBin} — run npm install first`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port), "-H", "127.0.0.1"], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    let settled = false;
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`dev server exited early (code ${code})\n${log.slice(-1500)}`));
      }
    });
    const deadline = Date.now() + 120000;
    const poll = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/vault`);
        if (res.ok && !settled) {
          settled = true;
          devServer = child;
          console.log(`  • dev server ready on :${port}`);
          resolve();
          return;
        }
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) {
        if (!settled) {
          settled = true;
          reject(new Error(`dev server did not become ready\n${log.slice(-1500)}`));
        }
      } else {
        setTimeout(poll, 500);
      }
    };
    poll();
  });
}

function stopDevServer() {
  if (!devServer) return;
  const pid = devServer.pid;
  devServer = null;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    /* already gone */
  }
}

async function startChrome(port) {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error("Chrome not found — install Chrome or set CHROME_PATH");
  }
  return new Promise((resolve, reject) => {
    chromeProfileDir = mkdtempSync(path.join(os.tmpdir(), "flowforge-e2e-"));
    const chromeFlags = [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${chromeProfileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--window-size=1280,900",
    ];
    // CI runners (GitHub Actions, Docker) often run Chrome as root or in a
    // container where the SUID sandbox can't start and /dev/shm is tiny.
    // Only added under CI — local runs keep the normal sandbox.
    if (process.env.CI) {
      chromeFlags.push("--no-sandbox", "--disable-dev-shm-usage");
    }
    chromeFlags.push("about:blank");
    const child = spawn(chrome, chromeFlags, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let chromeLog = "";
    child.stdout.on("data", (d) => (chromeLog += d));
    child.stderr.on("data", (d) => (chromeLog += d));
    let settled = false;
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    // On Windows, chrome.exe is a launcher: it hands off to a separate browser
    // process and exits 0 immediately — the CDP port is served by that browser
    // process, so an early exit is NOT a failure there. On other platforms the
    // direct child is the browser, so an early exit means a real crash.
    child.on("exit", (code) => {
      if (!settled && process.platform !== "win32") {
        settled = true;
        reject(new Error(`Chrome exited before CDP was ready (code ${code})\n${chromeLog.slice(-1500)}`));
      }
    });
    const deadline = Date.now() + 30000;
    const poll = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok && !settled) {
          settled = true;
          chromeProc = child;
          console.log(`  • headless Chrome CDP ready on :${port}`);
          resolve();
          return;
        }
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) {
        if (!settled) {
          settled = true;
          reject(new Error(`Chrome CDP did not become ready\n${chromeLog.slice(-1500)}`));
        }
      } else {
        setTimeout(poll, 300);
      }
    };
    poll();
  });
}

async function stopChrome(port) {
  // Graceful close via CDP first, then hard-kill as a fallback.
  try {
    const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });
    ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    await sleep(500);
    ws.close();
  } catch {
    /* fall through to hard kill */
  }
  if (chromeProc && !chromeProc.killed) {
    try {
      chromeProc.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
  // Windows: the launcher we spawned already exited, so if the browser is
  // still listening on the CDP port, kill it by PID directly.
  if (process.platform === "win32") {
    try {
      const rows = spawnSync("netstat", ["-ano"]).stdout.toString();
      const match = rows
        .split(/\r?\n/)
        .find((l) => l.includes(`:${port}`) && l.includes("LISTENING"));
      const pid = match?.trim().split(/\s+/).pop();
      if (pid) spawnSync("taskkill", ["/pid", pid, "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* already gone */
    }
  }
  if (chromeProfileDir) {
    try {
      rmSync(chromeProfileDir, { recursive: true, force: true });
    } catch {
      /* profile in use or already removed */
    }
    chromeProfileDir = null;
  }
}

// ── CDP client ───────────────────────────────────────────────────────
class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error("CDP websocket connect failed"));
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      }
    };
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    await this.send("DOM.enable");
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.result?.exceptionDetails) {
      throw new Error(
        `eval error: ${JSON.stringify(
          r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text
        )}`
      );
    }
    return r.result?.result?.value;
  }
  async waitFor(expression, timeoutMs = 30000, intervalMs = 150, label = expression) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const v = await this.evaluate(expression).catch(() => false);
      if (v) return v;
      await sleep(intervalMs);
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }
  async goto(url, readySelector = `!!document.querySelector('textarea')`) {
    await this.send("Page.navigate", { url });
    await this.waitFor(`document.readyState === 'complete'`, 60000);
    if (readySelector) await this.waitFor(readySelector, 30000);
    await sleep(600);
  }
  async freshSlate(url) {
    await this.goto(url);
    await this.evaluate(`localStorage.clear()`);
    // Tool panels that are DB-primary now (moodboard, release plan) must
    // start fresh too — otherwise a previous run's board/plan leaks into
    // this one (localStorage.clear() alone no longer resets them). This only
    // touches the isolated copy (prisma() is bound to DATABASE_URL).
    try {
      await prisma().moodboardItem.deleteMany({ where: { type: "board" } });
      await prisma().releasePlan.deleteMany({});
    } catch (e) {
      console.error("  (warn) could not clear tool-state DB rows:", e.message);
    }
    await this.send("Page.reload");
    await this.waitFor(`document.readyState === 'complete'`);
    await this.waitFor(`!!document.querySelector('textarea')`);
    await sleep(600);
  }
  clickText(text) {
    return this.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
  }
  setTextarea(value) {
    return this.evaluate(`(() => {
      const ta = document.querySelector('textarea');
      if (!ta) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(value)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }
  setInput(selector, value) {
    return this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }
  /** Attach a real on-disk file to an <input type=file> (value is read-only). */
  async setFileInput(selector, filePath) {
    const doc = await this.send("DOM.getDocument");
    const rootNodeId = doc.result?.root?.nodeId;
    if (!rootNodeId) return false;
    const q = await this.send("DOM.querySelector", { nodeId: rootNodeId, selector });
    if (!q.result?.nodeId) return false;
    await this.send("DOM.setFileInputFiles", { nodeId: q.result.nodeId, files: [filePath] });
    return true;
  }
}

// ── Dashboard fixture & scenario ────────────────────────────────────
// Seeds the isolated copy with the data the dashboard cards read:
//   • TWO lyrics: „Testowy Wers” edited TODAY (with a version saved
//     YESTERDAY → streak = 2) and „Starszy Wers” edited 2h ago (used to
//     verify the live-refresh reorder on the vault save event)
//   • profile at 240 points → level 3, 60% progress, „60 pkt do poziomu 4”
//   • an active challenge ending in 21 days → countdown „21d”
//   • a beat → „Numery” stat = 1, a current-month expense → budget tile
// Cleanup removes the lyrics (cascade: versions), submission and challenge;
// the profile row is deleted too (the seed-less dashboard treats a missing
// profile as MC / 0 points, matching the pre-test state).
async function seedDashboardFixture() {
  const db = prisma();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const lyric = await db.lyric.create({
    data: {
      title: "Testowy Wers",
      content: "pierwszy wers\ndrugi wers\ntrzeci wers",
      lineCount: 3,
      wordCount: 6,
      syllableCount: 8,
      updatedAt: new Date(now),
    },
  });
  const lyricB = await db.lyric.create({
    data: {
      title: "Starszy Wers",
      content: "starszy wers\nz wczoraj",
      lineCount: 2,
      wordCount: 4,
      syllableCount: 5,
      updatedAt: new Date(now - 2 * 60 * 60 * 1000),
    },
  });
  await db.lyricVersion.create({
    data: {
      lyricId: lyric.id,
      content: "pierwszy wers\ndrugi wers\ntrzeci wers",
      snapshot: 1,
      createdAt: new Date(now - day),
    },
  });
  // lastPlayedAt in the past → the beat still shows in the recent widget,
  // and playing it in the mini-player must bump the timestamp (real history).
  await db.beat.create({
    data: {
      title: "Testowy Bit",
      bpm: 90,
      duration: 120,
      filePath: "/test-beat-a.wav",
      lastPlayedAt: new Date(now - 2 * day),
    },
  });
  // A current-month expense → the „Budżet w pigułce” tile (DB-primary).
  await db.budgetExpense.create({
    data: {
      category: "beat_license",
      title: "Licencja testowa",
      amount: 150,
      currency: "PLN",
      date: new Date(now),
    },
  });
  await db.userProfile.upsert({
    where: { id: "default" },
    update: { displayName: "MC", totalPoints: 240, level: 3, avatarEmoji: "🎤" },
    create: {
      id: "default",
      displayName: "MC",
      totalPoints: 240,
      level: 3,
      avatarEmoji: "🎤",
    },
  });
  // Ends SOONER than the seeded „Cypher: Moje Miasto” (+21d) so
  // getDashboardChallenge (ordered by endDate asc) picks THIS one.
  const challenge = await db.challenge.create({
    data: {
      id: "e2e-cypher-test",
      title: "Cypher: Test E2E",
      description: "Wers o testowaniu automatycznym",
      prize: "🎁 Wyróżnienie testowe",
      endDate: new Date(now + 20 * day),
      isActive: true,
    },
  });
  return { lyric, lyricB, challenge };
}

async function cleanupDashboardFixture() {
  const db = prisma();
  await db.challengeSubmission.deleteMany({ where: { challengeId: "e2e-cypher-test" } });
  await db.challenge.deleteMany({ where: { id: "e2e-cypher-test" } });
  await db.beat.deleteMany({ where: { title: "Testowy Bit" } });
  await db.budgetExpense.deleteMany({ where: { title: "Licencja testowa" } });
  await db.lyric.deleteMany({ where: { title: { in: ["Testowy Wers", "Starszy Wers"] } } });
  await db.savedProject.deleteMany({ where: { title: "Testowy Projekt" } });
  await db.userProfile.deleteMany({ where: { id: "default" } });
}

async function scenarioDashboard(cdp, appUrl) {
  console.log("\n== 6. Dashboard — streak, level, challenge tile, recent lyrics ==");
  const root = new URL(appUrl).origin + "/";

  // ── Phase 1: empty DB → „Ostatnio Edytowane” empty state ──
  // Guarantee an empty lyric/beat/expense table regardless of earlier
  // scenarios' leftovers or the demo seed rows (this is the isolated copy,
  // so deleting is safe).
  await prisma().lyric.deleteMany({});
  await prisma().beat.deleteMany({});
  await prisma().savedProject.deleteMany({});
  await prisma().budgetExpense.deleteMany({});
  // Push the demo cyphers („Cypher: Moje Miasto” / „Bitwa Freestyle”) far
  // into the future. Their endDate is fixed at db:seed time (+21d), so the
  // fixture below (+20d from NOW) would otherwise lose the dashboard's
  // „soonest deadline” pick once the seeded DB is more than ~1 day old.
  await prisma().challenge.updateMany({
    where: { id: { in: ["cypher-miasto", "cypher-bitwa"] } },
    data: { endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
  });
  await cdp.goto(root, `document.body.textContent.includes('Szybki Dostęp')`);
  await sleep(700);
  const emptyState = await cdp.evaluate(`(() => {
    const section = [...document.querySelectorAll('h2')].find(h => h.textContent.includes('Ostatnio Edytowane'));
    const container = section ? section.closest('div')?.parentElement : null;
    const links = container ? [...container.querySelectorAll('a[href^="/vault?track="]')] : [];
    const projSection = [...document.querySelectorAll('h2')].find(h => h.textContent.includes('Ostatnio zapisane projekty'));
    const projContainer = projSection ? projSection.closest('div')?.parentElement : null;
    return {
      found: !!section,
      hasEmpty: container ? container.textContent.includes('Brak tekstów') : false,
      hasCta: container ? container.textContent.includes('Nowy Tekst') : false,
      rows: links.length,
      projFound: !!projSection,
      projEmpty: projContainer ? projContainer.textContent.includes('Brak zapisanych projektów') : false,
      projCta: projContainer ? [...projContainer.querySelectorAll('a')].some(a => a.textContent.includes('Otwórz Studio')) : false,
    };
  })()`);
  check(emptyState.found === true, "„Ostatnio Edytowane” section present");
  check(emptyState.hasEmpty === true, "empty state „Brak tekstów” with an empty DB");
  check(emptyState.hasCta === true, "„Nowy Tekst” CTA in the empty state");
  check(emptyState.rows === 0, "no lyric rows when the DB has no lyrics");
  check(emptyState.projFound === true, "„Ostatnio zapisane projekty” section present");
  check(emptyState.projEmpty === true, "projects empty state „Brak zapisanych projektów” with an empty table");
  check(emptyState.projCta === true, "„🎙️ Otwórz Studio” CTA in the projects empty state");

  // The „Ostatnio Użyte Beat / Podkłady” mini-player widget shows an empty
  // state while the Beat table is empty.
  const beatsEmpty = await cdp.evaluate(`(() => ({
    found: [...document.querySelectorAll('h2')].some(h => h.textContent.includes('Ostatnio Użyte Beat / Podkłady')),
    empty: document.body.textContent.includes('Brak historii odtwarzania'),
    rows: document.querySelectorAll('[data-beat-row]').length,
  }))()`);
  check(beatsEmpty.found === true, "„Ostatnio Użyte Beat / Podkłady” widget present");
  check(beatsEmpty.empty === true && beatsEmpty.rows === 0, "beat widget empty state with an empty table");

  // ── Phase 2: seeded fixture → full dashboard ──
  const fixture = await seedDashboardFixture();
  try {
    // Regression guard: plant a bogus vault mirror (5 ghost versions) BEFORE
    // the dashboard loads. The „Teksty” card must still read the DB count
    // (1 seeded lyric) — a localStorage override would show 5 here.
    await cdp.evaluate(`(() => {
      const fake = Array.from({ length: 5 }, (_, i) => ({
        id: 'ghost-' + i, label: 'Ghost ' + i, content: 'x', timestamp: new Date().toISOString(),
      }));
      localStorage.setItem('flowforge-versions', JSON.stringify(fake));
      return true;
    })()`);
    // One export log → the „📤 Eksporty” stat card (ExportLog is the source).
    await prisma().exportLog.create({ data: { lyricId: fixture.lyric.id, format: "txt" } });
    // The dashboard has no textarea — wait for the challenge tile instead.
    await cdp.goto(root, `document.body.textContent.includes('Aktywne wyzwanie')`);

    // ── „📤 Eksporty” stat card — reads the ExportLog table ──
    const exportCard = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-2xl'));
      const card = cards.find(c => c.textContent.includes('Eksporty'));
      const val = card ? card.querySelector('p.text-2xl')?.textContent : null;
      return { found: !!card, val };
    })()`);
    check(exportCard.found === true && exportCard.val === "1", `„📤 Eksporty” card reads the ExportLog count (got ${exportCard.val})`);
    await prisma().exportLog.deleteMany({ where: { lyricId: fixture.lyric.id } });

    // ── Streak card ──
    const streak = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-2xl'));
      const card = cards.find(c => c.textContent.includes('z rzędu') || c.textContent.includes('Brak serii'));
      return {
        found: !!card,
        text: card ? (card.textContent.match(/([0-9]+) dni z rzędu/) || [])[1] ?? null : null,
        hint: card ? card.textContent.includes('Napisałeś dziś') : false,
      };
    })()`);
    check(streak.found === true, "streak card rendered");
    check(streak.text === "2", `streak = 2 (version yesterday + track edited today) (got ${streak.text})`);
    check(streak.hint === true, "streak hint: „Napisałeś dziś — podtrzymaj serię!”");

    // ── Level card ──
    const level = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-2xl'));
      const card = cards.find(c => c.textContent.includes('Poziom 3'));
      const bar = card ? [...card.querySelectorAll('div')].find(d => d.className.includes('h-2.5') && d.className.includes('rounded-full')) : null;
      // The percentage lives in its own <span class="font-mono"> — reading
      // card.textContent would glue „Poziom 3” + „60%” into „360%”.
      const pctSpan = card ? card.querySelector('span.font-mono') : null;
      return {
        found: !!card,
        pct: pctSpan ? (pctSpan.textContent.match(/([0-9]+)%/) || [])[1] ?? null : null,
        pointsLine: card ? card.textContent.includes('60 pkt do poziomu 4') : false,
        barWidth: bar && bar.firstElementChild ? bar.firstElementChild.style.width : null,
      };
    })()`);
    check(level.found === true, "level card shows „MC · Poziom 3”");
    check(level.pct === "60", `level progress = 60% at 240 pkt (got ${level.pct})`);
    check(level.pointsLine === true, "points line: „60 pkt do poziomu 4”");
    check(level.barWidth === "60%", `progress bar width = 60% (got ${level.barWidth})`);

    // ── Challenge tile ──
    const tile = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-2xl'));
      const card = cards.find(c => c.textContent.includes('Aktywne wyzwanie'));
      return {
        found: !!card,
        title: card ? card.textContent.includes('Cypher: Test E2E') : false,
        countdown: card ? (card.textContent.match(/([0-9]+)d/) || [])[1] ?? null : null,
        notSubmitted: card ? card.textContent.includes('Nie zgłoszono się') : false,
        count: card ? (card.textContent.match(/Nie zgłoszono się • ([0-9]+) zgłoszeń/) || [])[1] ?? null : null,
        cta: card ? [...card.querySelectorAll('button')].some(b => b.textContent.includes('Weź udział')) : false,
      };
    })()`);
    check(tile.found === true, "challenge tile rendered");
    check(tile.title === true, "tile shows the active challenge title");
    check(tile.countdown === "20", `countdown badge shows 20d (got ${tile.countdown})`);
    check(tile.notSubmitted === true && tile.count === "0", "status: „Nie zgłoszono się • 0 zgłoszeń”");
    check(tile.cta === true, "„Weź udział” button present");

    // ── Submit flow ──
    check(await cdp.clickText("Weź udział"), "opened the inline submit form");
    await sleep(300);
    check(await cdp.setInput(`input[placeholder*='Tytuł']`, "Mój testowy wers"), "filled the title input");
    check(await cdp.setInput(`textarea[placeholder*='Twój wers']`, "testowy wers do wyzwania"), "filled the verse textarea");
    await sleep(200);
    await cdp.waitFor(
      `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Zgłoś' && !b.disabled)`,
      10000,
      150,
      "submit button enabled"
    );
    check(await cdp.clickText("Zgłoś"), "clicked Zgłoś");
    await cdp.waitFor(
      `document.body.textContent.includes('Zgłoszono się') && document.body.textContent.includes('Przejdź do wyzwań')`,
      15000,
      200,
      "tile flips to submitted state"
    );
    const after = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-2xl'));
      const card = cards.find(c => c.textContent.includes('Aktywne wyzwanie'));
      return {
        submitted: card ? card.textContent.includes('✔ Zgłoszono się') : false,
        count: card ? (card.textContent.match(/✔ Zgłoszono się • ([0-9]+) zgłoszeń?/) || [])[1] ?? null : null,
        link: card ? [...card.querySelectorAll('a')].some(a => a.textContent.includes('Przejdź do wyzwań')) : false,
      };
    })()`);
    check(after.submitted === true, "status flips to „✔ Zgłoszono się”");
    check(after.count === "1", `submission count = 1 (got ${after.count})`);
    check(after.link === true, "CTA becomes „Przejdź do wyzwań →” link");

    const subRow = await prisma().challengeSubmission.findFirst({
      where: { challengeId: "e2e-cypher-test" },
    });
    check(
      subRow !== null && subRow.authorName === "MC" && subRow.content === "testowy wers do wyzwania",
      "submission row written to the DB (author MC, content intact)"
    );

    // ── Recent lyrics (deep-link rows) ──
    const recent = await cdp.evaluate(`(() => {
      const rows = [...document.querySelectorAll('a')].filter(a => a.getAttribute('href') && a.getAttribute('href').startsWith('/vault?track='));
      const first = rows[0];
      return {
        count: rows.length,
        titles: rows.map(r => r.textContent.trim()),
        title: first ? first.textContent.includes('Testowy Wers') : false,
        meta: first ? first.textContent.includes('3 wersów') && first.textContent.includes('1 wersji') : false,
        href: first ? first.getAttribute('href') : null,
      };
    })()`);
    check(recent.count === 2, `recent list shows both seeded lyrics (${recent.count} row(s))`);
    check(recent.title === true, "newest lyric listed first („Testowy Wers”)");
    check(recent.titles[1]?.includes('Starszy Wers') === true, "older lyric listed second („Starszy Wers”)");
    check(recent.meta === true, "recent row meta: „3 wersów • 6 słów • 8 sylab • 1 wersji”");
    check(recent.href === `/vault?track=${encodeURIComponent(fixture.lyric.id)}`, `recent row deep-links to /vault?track=<id> (got ${recent.href})`);

    // ── Live refresh: bump the older lyric, dispatch the vault save event ──
    // (the exact event the Vault fires when saving a version), expect reorder.
    await prisma().lyric.update({
      where: { id: fixture.lyricB.id },
      data: { updatedAt: new Date(Date.now() + 60000) },
    });
    await cdp.evaluate(`window.dispatchEvent(new CustomEvent('flowforge-versions-updated'))`);
    let reordered = false;
    for (let i = 0; i < 20 && !reordered; i++) {
      reordered = await cdp.evaluate(`(() => {
        const rows = [...document.querySelectorAll('a')].filter(a => a.getAttribute('href') && a.getAttribute('href').startsWith('/vault?track='));
        return rows[0] ? rows[0].textContent.includes('Starszy Wers') : false;
      })()`);
      if (!reordered) await sleep(500);
    }
    check(reordered, "live refresh reorders recent lyrics on the vault save event (bumped lyric first)");

    // ── Stats row (DB-primary: the bogus 5-entry mirror must be ignored) ──
    const stats = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-2xl') && d.className.includes('card-hover'));
      const find = (label) => {
        const card = cards.find(c => c.textContent.includes(label));
        const p = card ? [...card.querySelectorAll('p')].find(p => /^[0-9]+$/.test(p.textContent)) : null;
        return p ? p.textContent : null;
      };
      return { teksty: find('Teksty'), numery: find('Numery'), punkty: find('Punkty') };
    })()`);
    check(stats.teksty === "2", `„Teksty” card = 2 from the DB, ignoring the 5-entry vault mirror (got ${stats.teksty})`);
    check(stats.numery === "1", `„Numery” card = 1 (seeded beat) (got ${stats.numery})`);
    // Punkty are recomputed by awardPoints as the sum of ALL achievements —
    // the challenge submit above already re-awarded, so the card must match
    // the current DB total (poll: the refresh may lag a beat).
    const dbPoints =
      (await prisma().userProfile.findUnique({ where: { id: "default" } }))?.totalPoints ?? 0;
    let punktyOk = false;
    for (let i = 0; i < 20 && !punktyOk; i++) {
      punktyOk = await cdp.evaluate(`(() => {
        const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-2xl') && d.className.includes('card-hover'));
        const card = cards.find(c => c.textContent.includes('Punkty'));
        const p = card ? [...card.querySelectorAll('p')].find(p => /^[0-9]+$/.test(p.textContent)) : null;
        return p ? p.textContent === ${JSON.stringify(String(dbPoints))} : false;
      })()`);
      if (!punktyOk) await sleep(500);
    }
    check(punktyOk, `„Punkty” card matches the DB total (${dbPoints} pkt)`);
    // Restore the mirror so later scenarios seed it themselves.
    await cdp.evaluate(`localStorage.removeItem('flowforge-versions'); true`);

    // ── Budget at a glance (current-month expenses, DB-primary) ──
    const budget = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-2xl'));
      const card = cards.find(c => c.textContent.includes('Budżet w pigułce'));
      return {
        found: !!card,
        total: card ? (card.textContent.match(/([0-9 ]+) PLN/) || [])[1] ?? null : null,
        count: card ? (card.textContent.match(/([0-9]+) wydatek/) || [])[1] ?? null : null,
        chip: card ? card.textContent.includes('Licencja na bit · 150 PLN') : false,
        link: card ? [...card.querySelectorAll('a')].some(a => a.textContent.includes('Przejdź do budżetu')) : false,
      };
    })()`);
    check(budget.found === true, "„Budżet w pigułce” tile rendered");
    check(budget.total === "150", `tile shows 150 PLN from the current month (got ${budget.total})`);
    check(budget.count === "1", `tile counts 1 expense this month (got ${budget.count})`);
    check(budget.chip === true, "top-category chip: „🎵 Licencja na bit · 150 PLN”");
    check(budget.link === true, "„Przejdź do budżetu →” link present");

    // ── Recently saved projects tile (DB-primary, SavedProject.createdAt) ──
    // Created AFTER the stats row — „Numery” counts projects too, so adding
    // the row earlier would break the exact numery=1 assertion above. The
    // tile then appears through the same live-refresh event the Studio fires
    // on save, proving the DB→tile path end-to-end.
    await prisma().savedProject.create({
      data: {
        title: "Testowy Projekt",
        data: JSON.stringify({
          kind: "project",
          id: "proj-e2e-dashboard",
          title: "Testowy Projekt",
          artist: "MC",
          genre: "rap",
          duration: "3:00",
          beatName: "Testowy Bit",
          beatVolume: 0.8,
          teleprompterText: "",
          teleprompterSpeed: 5,
          takes: [{ id: "take-1", label: "Wokal 1" }, { id: "take-2", label: "Wokal 2" }],
          clips: [],
          savedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        }),
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });
    await cdp.evaluate(`window.dispatchEvent(new CustomEvent('flowforge-library-updated'))`);
    let proj = null;
    for (let i = 0; i < 20 && !proj; i++) {
      proj = await cdp.evaluate(`(() => {
        const section = [...document.querySelectorAll('h2')].find(h => h.textContent.includes('Ostatnio zapisane projekty'));
        if (!section) return null;
        const container = section.closest('div')?.parentElement;
        if (!container) return null;
        const row = [...container.querySelectorAll('a')].find(a => a.getAttribute('href') === '/beats' && a.textContent.includes('Testowy Projekt'));
        return {
          title: row ? row.textContent.includes('Testowy Projekt') : false,
          meta: row ? row.textContent.includes("2 take'ów") && row.textContent.includes('projekt ze Studio') : false,
          ago: row ? row.textContent.includes('2 godz. temu') : false,
        };
      })()`);
      if (!proj || !proj.title) { proj = null; await sleep(500); }
    }
    check(!!proj && proj.title === true, "„Ostatnio zapisane projekty” lists the seeded project");
    check(!!proj && proj.meta === true, "project row meta: „2 take'ów • projekt ze Studio”");
    check(!!proj && proj.ago === true, "project row shows the DB createdAt as „2 godz. temu”");

    // ── Deep-link: /vault?track=<id> opens the exact lyric ──
    await cdp.goto(root + `/vault?track=${encodeURIComponent(fixture.lyric.id)}`, `!!document.querySelector('textarea')`);
    await sleep(700);
    const dl = await cdp.evaluate(`(() => {
      const ta = document.querySelector('textarea');
      const title = document.querySelector('input[placeholder="Nazwa utworu..."]');
      return {
        firstLine: ta ? ta.value.split('\\n')[0] : null,
        title: title ? title.value : null,
      };
    })()`);
    check(dl.firstLine === "pierwszy wers", `deep link loads the requested lyric content (got ${dl.firstLine})`);
    check(dl.title === "Testowy Wers", `deep link sets the requested lyric title (got ${dl.title})`);

    // ── Unknown track id: no crash, falls back to the remembered track ──
    await cdp.goto(root + "/vault?track=does-not-exist-123", `!!document.querySelector('textarea')`);
    await sleep(700);
    const fb = await cdp.evaluate(`(() => {
      const ta = document.querySelector('textarea');
      const title = document.querySelector('input[placeholder="Nazwa utworu..."]');
      return { len: ta ? ta.value.length : -1, title: title ? title.value : null };
    })()`);
    check(fb.len >= 0, "unknown track id falls back (editor still renders)");
    check(fb.title === "Testowy Wers", `unknown id falls back to the remembered track (CURRENT_KEY) (got ${fb.title})`);

    // ── Writing activity chart: LyricVersion day buckets ──
    // 3 versions TODAY (100+50+50 = 200 syllables) + the fixture's version
    // yesterday (0 syllables) + one 20 days ago (60 syllables). The 7-day
    // window sees 2 days/200 sylab; the 30-day window adds the old one.
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await prisma().lyricVersion.createMany({
      data: [
        { lyricId: fixture.lyric.id, content: "wers a", snapshot: 11, syllableCount: 100, createdAt: new Date(now - 3600e3) },
        { lyricId: fixture.lyric.id, content: "wers b", snapshot: 12, syllableCount: 50, createdAt: new Date(now - 1800e3) },
        { lyricId: fixture.lyric.id, content: "wers c", snapshot: 13, syllableCount: 50, createdAt: new Date(now) },
        { lyricId: fixture.lyric.id, content: "wers stary", snapshot: 14, syllableCount: 60, createdAt: new Date(now - 20 * day) },
      ],
    });
    await cdp.goto(root, `document.body.textContent.includes('Aktywność pisania')`);
    await sleep(600);
    const activity7 = await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-2xl'))
        .find(c => c.textContent.includes('Aktywność pisania'));
      if (!card) return null;
      const bars = [...card.querySelectorAll('div[title]')];
      const todayBar = bars.find(b => (b.getAttribute('title') || '').includes('200 sylab'));
      return {
        subtitle: card.textContent.includes('200 sylab') && card.textContent.includes('2 dni z pisaniem'),
        raw: [...card.querySelectorAll('p')].map((p) => p.textContent).join(' | '),
        barCount: bars.length,
        today: todayBar ? todayBar.getAttribute('title') : null,
        pressed: card.querySelector('button[aria-pressed="true"]')?.textContent,
      };
    })()`);
    check(activity7 !== null, "„Aktywność pisania” tile rendered");
    check(activity7.subtitle === true, `tile totals „200 sylab • 2 dni z pisaniem” (raw: ${activity7.raw})`);
    check(activity7.barCount === 7, `7 day bars by default (got ${activity7.barCount})`);
    check(activity7.today && activity7.today.includes('3 wersji'), `today's bar tooltip „200 sylab, 3 wersji” (got ${activity7.today})`);
    check(activity7.pressed === "7 dni", "range toggle defaults to 7 dni");

    // Toggle to 30 days → 30 bars; the yesterday version adds a second day.
    check(await cdp.clickText("30 dni"), "switched the chart to 30 days");
    await sleep(500);
    const activity30 = await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-2xl'))
        .find(c => c.textContent.includes('Aktywność pisania'));
      if (!card) return null;
      return {
        barCount: card.querySelectorAll('div[title]').length,
        subtitle: card.textContent.includes('260 sylab') && card.textContent.includes('3 dni z pisaniem'),
        pressed: card.querySelector('button[aria-pressed="true"]')?.textContent,
      };
    })()`);
    check(activity30.barCount === 30, `30 day bars after toggle (got ${activity30.barCount})`);
    check(activity30.subtitle === true, "30-day window adds the 20-days-ago version („260 sylab • 3 dni z pisaniem”)");
    check(activity30.pressed === "30 dni", "range toggle now on 30 dni");

    // ── Recent Beats mini-player: the seeded „Testowy Bit” plays/pauses ──
    const testBeat = await prisma().beat.findFirst({ where: { title: "Testowy Bit" } });
    check(testBeat !== null, "fixture beat exists for the widget");
    // Deterministic playback: capture Audio instances + play/pause calls.
    await cdp.evaluate(`(() => {
      window.__dashAudios = [];
      window.__dashPlays = [];
      window.__dashPauses = [];
      const OrigAudio = window.Audio;
      window.Audio = class extends OrigAudio {
        constructor(src) { super(src); window.__dashAudios.push(src); }
      };
      HTMLMediaElement.prototype.play = function () { window.__dashPlays.push(this.src); return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () { window.__dashPauses.push(this.src); };
      return true;
    })()`);
    const widget = await cdp.evaluate(`(() => {
      const row = document.querySelector('[data-beat-row="${testBeat.id}"]');
      const link = row ? row.querySelector('[data-studio-link="${testBeat.id}"]') : null;
      return row ? {
        title: row.textContent.includes('Testowy Bit'),
        meta: row.textContent.includes('90 BPM'),
        play: !!row.querySelector('[data-beat-play="${testBeat.id}"]'),
        nagraj: row.textContent.includes('Nagraj'),
        studioHref: link ? link.getAttribute('href') : null,
      } : null;
    })()`);
    check(
      !!widget && widget.title && widget.meta && widget.play && widget.nagraj,
      "widget lists „Testowy Bit” with play button + 🎙️ Nagraj link"
    );
    check(
      widget.studioHref === `/studio?beatId=${testBeat.id}`,
      `„Nagraj” deep-links to /studio?beatId= (got ${widget.studioHref})`
    );
    await cdp.evaluate(`document.querySelector('[data-beat-play="${testBeat.id}"]').click()`);
    await sleep(300);
    const playing = await cdp.evaluate(`(() => {
      const row = document.querySelector('[data-beat-row="${testBeat.id}"]');
      const btn = row ? row.querySelector('[data-beat-play="${testBeat.id}"]') : null;
      return {
        isPause: btn ? btn.textContent.includes('⏸') : false,
        audios: window.__dashAudios.length,
        played: window.__dashPlays.length,
        src: window.__dashAudios[0] ?? null,
      };
    })()`);
    check(playing.isPause === true, "▶ flips to ⏸ while playing");
    check(
      playing.audios === 1 && playing.played === 1 && playing.src === "/test-beat-a.wav",
      "one Audio created with the beat's filePath and played"
    );
    // Playing must bump lastPlayedAt (fire-and-forget server action) — the
    // widget is driven by real usage history, not creation dates.
    let bumped = false;
    for (let i = 0; i < 20 && !bumped; i++) {
      const row = await prisma().beat.findFirst({ where: { title: "Testowy Bit" } });
      bumped = !!row?.lastPlayedAt && row.lastPlayedAt.getTime() > Date.now() - 60000;
      if (!bumped) await sleep(300);
    }
    check(bumped, "playing the beat records lastPlayedAt in the DB");
    await cdp.evaluate(`document.querySelector('[data-beat-play="${testBeat.id}"]').click()`);
    await sleep(200);
    const paused = await cdp.evaluate(`(() => {
      const row = document.querySelector('[data-beat-row="${testBeat.id}"]');
      const btn = row ? row.querySelector('[data-beat-play="${testBeat.id}"]') : null;
      return { isPlay: btn ? btn.textContent.includes('▶') : false, paused: window.__dashPauses.length };
    })()`);
    check(paused.isPlay === true && paused.paused >= 1, "second click pauses and ▶ returns");
  } finally {
    await cleanupDashboardFixture();
  }
}

// ── Studio scenario (teleprompter + clip timeline) ───────────────────
// Seeds the STUDIO session (localStorage `flowforge-studio-live`) with a
// beat + one vocal take (real decodable WAV data URLs — the repo's
// test-beat-*.wav are empty placeholders and never decode) and a Vault
// version so the Teleprompter Setup picker has an entry. The studio
// provider reads this storage on mount, so the seed happens while a
// different route is loaded.
function makeWavDataUrl(seconds, sampleRate = 22050, freq = 440) {
  const n = Math.floor(seconds * sampleRate);
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 12000), 44 + i * 2);
  }
  return "data:audio/wav;base64," + buf.toString("base64");
}

async function scenarioStudio(cdp, appUrl) {
  console.log("\n== 7. Studio — teleprompter + clip timeline ==");
  const root = new URL(appUrl).origin;
  const tpText = "pierwsza linijka\ndruga linijka\ntrzecia linijka";
  const studioSession = {
    beat: { name: "Bit testowy", dataUrl: makeWavDataUrl(8) },
    beatVolume: 0.7,
    takes: [
      {
        id: "take-e2e-1",
        label: "Wokal testowy",
        duration: 4,
        offset: 0,
        volume: 1,
        isMuted: false,
        isSoloed: false,
        trimStart: 0,
        trimEnd: 1,
        dataUrl: makeWavDataUrl(4),
      },
    ],
    clips: [],
    teleprompter: { text: tpText, sourceId: null, sourceLabel: null, speed: 30 },
    updatedAt: new Date().toISOString(),
  };

  // Land on the dashboard first (same origin) so localStorage is writable
  // BEFORE the studio provider hydrates.
  await cdp.goto(root + "/", `document.body.textContent.includes('Szybki Dostęp')`);
  await sleep(400);
  check(
    await cdp.evaluate(
      `localStorage.setItem('flowforge-studio-live', ${JSON.stringify(JSON.stringify(studioSession))}); true`
    ),
    "seeded studio session (beat + take + teleprompter)"
  );
  check(
    await cdp.evaluate(
      `localStorage.setItem('flowforge-versions', ${JSON.stringify(
        JSON.stringify([{ id: "ver-e2e-1", label: "Teleprompter Test", content: tpText, timestamp: new Date().toISOString() }])
      )}); true`
    ),
    "seeded a Vault version for the text picker"
  );

  await cdp.goto(root + "/studio", `document.body.textContent.includes('Teleprompter Setup')`);

  // ── Timeline renders the take ──
  const timeline = await cdp.evaluate(`(() => {
    const txt = document.body.textContent;
    const canvases = [...document.querySelectorAll('canvas')];
    return {
      hasTake: txt.includes('Wokal testowy'),
      hasBeat: txt.includes('Bit testowy'),
      ruler: canvases.some(c => c.height === 36),
      track: canvases.some(c => c.height === 56),
      hasEmptyHint: txt.includes('Nagraj wokal, aby zobaczyć edytor fali'),
    };
  })()`);
  check(timeline.hasTake && timeline.hasBeat, "timeline renders the seeded take + beat");
  check(timeline.ruler && timeline.track, "ruler + track canvases rendered");
  check(timeline.hasEmptyHint === false, "no empty-editor placeholder");

  // ── Clip timeline: select take → move marker → split → undo → redo ──
  check(
    await cdp.evaluate(`(() => {
      const canvases = [...document.querySelectorAll('canvas')];
      const track = canvases.find(c => c.height === 56);
      if (!track) return false;
      const r = track.getBoundingClientRect();
      const x = r.left + r.width * 0.25;
      track.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: r.top + r.height / 2, button: 0 }));
      track.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: r.top + r.height / 2, button: 0 }));
      const ruler = canvases.find(c => c.height === 36);
      if (ruler) {
        const rr = ruler.getBoundingClientRect();
        ruler.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rr.left + rr.width * 0.25, clientY: rr.top + 10, button: 0 }));
        ruler.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rr.left + rr.width * 0.25, clientY: rr.top + 10, button: 0 }));
      }
      return true;
    })()`),
    "clicked the track (select take) + ruler (marker ≈ 1s of 4s take)"
  );
  await sleep(600);
  const splitBtn = await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Rozetnij'));
    return b ? { text: b.textContent.trim(), title: b.title } : null;
  })()`);
  check(!!splitBtn, "split button appears after selecting the take");
  check(
    splitBtn && /Rozetnij @ 0:0[1-9]/.test(splitBtn.text),
    `marker moved off 0:00 (got ${splitBtn?.text})`
  );

  check(await cdp.clickText("Rozetnij"), "clicked Rozetnij");
  await sleep(600);
  const undoState = await cdp.evaluate(`(() => {
    const undoBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Cofnij'));
    const redoBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Ponów'));
    return { undoDisabled: undoBtn ? undoBtn.disabled : null, redoDisabled: redoBtn ? redoBtn.disabled : null };
  })()`);
  check(undoState.undoDisabled === false, "split recorded an undo entry (Cofnij enabled)");
  check(undoState.redoDisabled === true, "redo disabled right after a fresh edit");

  check(await cdp.clickText("Cofnij"), "clicked Cofnij");
  await sleep(600);
  const afterUndo = await cdp.evaluate(`(() => {
    const redoBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Ponów'));
    return redoBtn ? redoBtn.disabled : null;
  })()`);
  check(afterUndo === false, "undo enabled redo (Ponów clickable)");
  check(await cdp.clickText("Ponów"), "clicked Ponów (redo the split)");
  await sleep(600);

  // ── Teleprompter ──
  const tpReady = await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Otwórz Teleprompter'));
    return { btn: !!b, disabled: b ? b.disabled : null };
  })()`);
  check(tpReady.btn === true && tpReady.disabled === false, "„Otwórz Teleprompter →” enabled (text loaded from Vault)");
  check(await cdp.clickText("Otwórz Teleprompter"), "opened the fullscreen teleprompter");
  await sleep(800);
  const tpView = await cdp.evaluate(`(() => {
    const txt = document.body.textContent;
    return {
      fullscreen: !!document.querySelector('.fixed.inset-0'),
      text: txt.includes('pierwsza linijka') && txt.includes('druga linijka'),
      pause: txt.includes('⏸ Pauza'),
      speed: txt.includes('30 px/s'),
      animating: !!document.querySelector('.teleprompter-scroll'),
    };
  })()`);
  check(tpView.fullscreen && tpView.text, "teleprompter renders the picked text fullscreen");
  check(tpView.pause && tpView.speed && tpView.animating, "controls: Pauza button, 30 px/s label, scroll animation");

  check(await cdp.clickText("Pauza"), "paused the scroll");
  await sleep(400);
  check(
    await cdp.evaluate(`document.body.textContent.includes('▶ Wznów') && document.body.textContent.includes('⏸ pauza')`),
    "pause state visible („▶ Wznów” + „⏸ pauza”)"
  );
  check(await cdp.clickText("Zamknij"), "closed the teleprompter");
  await sleep(600);
  check(
    await cdp.evaluate(
      `document.body.textContent.includes('Teleprompter Setup') && !document.querySelector('.fixed.inset-0')`
    ),
    "back on the studio editor"
  );

  // ── Persistence: reload keeps the take + teleprompter text ──
  await cdp.send("Page.reload");
  await cdp.waitFor(`document.body.textContent.includes('Teleprompter Setup')`, 30000);
  await sleep(1200);
  const reloaded = await cdp.evaluate(`(() => {
    const txt = document.body.textContent;
    return {
      take: txt.includes('Wokal testowy'),
      beat: txt.includes('Bit testowy'),
      tpText: txt.includes('pierwsza linijka'),
    };
  })()`);
  check(reloaded.take && reloaded.beat, "after reload: take + beat restored from the persisted session");
  check(reloaded.tpText === true, "after reload: teleprompter text restored");

  // ── Deep-link: /studio?beatId=<id> loads that exact beat ──
  const dlBeat = await prisma().beat.create({
    data: {
      id: "e2e-deeplink-beat",
      title: "Deep Link Bit",
      artist: "FlowForge",
      bpm: 95,
      key: "Em",
      genre: "Demo",
      duration: 8,
      filePath: "/test-beat-b.wav",
    },
  });
  try {
    // Deterministic playback: stub Audio BEFORE navigating — the deep-link
    // builds the element during the page's mount, so the stub must be
    // injected into the new document.
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        window.__dlAudios = [];
        const OrigAudio = window.Audio;
        window.Audio = class extends OrigAudio {
          constructor(src) { super(src); window.__dlAudios.push(src); }
        };
        HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
        HTMLMediaElement.prototype.pause = function () {};
        return true;
      })();`,
    });
    await cdp.goto(root + "/studio?beatId=e2e-deeplink-beat", `document.body.textContent.includes('Deep Link Bit')`);
    await sleep(1200);
    // The LAST Audio is the deep-linked beat — the mount restore creates
    // one for the persisted session's beat first („Bit testowy” data URL).
    const deepLink = await cdp.evaluate(`(() => ({
      name: document.body.textContent.includes('Deep Link Bit'),
      audio: window.__dlAudios[window.__dlAudios.length - 1] ?? null,
      session: (localStorage.getItem('flowforge-studio-live') || '').includes('Deep Link Bit'),
    }))()`);
    check(deepLink.name === true, "studio shows the deep-linked beat name");
    check(
      deepLink.audio === "/test-beat-b.wav",
      `beat audio created from the row's filePath (got ${deepLink.audio})`
    );
    check(deepLink.session === true, "deep-linked beat persisted into the studio session");
    // The deep-link also records real usage (lastPlayedAt) for the widget.
    let dlRecorded = false;
    for (let i = 0; i < 20 && !dlRecorded; i++) {
      const row = await prisma().beat.findUnique({ where: { id: "e2e-deeplink-beat" } });
      dlRecorded = !!row?.lastPlayedAt && row.lastPlayedAt.getTime() > Date.now() - 60000;
      if (!dlRecorded) await sleep(300);
    }
    check(dlRecorded, "deep-link records lastPlayedAt for the recent-beats history");

    // Unknown id → graceful fallback (editor still renders, no beat). The
    // persisted session is cleared first so the restore can't mask it.
    await cdp.evaluate(`localStorage.removeItem('flowforge-studio-live'); true`);
    await cdp.goto(root + "/studio?beatId=nieistniejacy-beat", `document.body.textContent.includes('Teleprompter Setup')`);
    await sleep(800);
    check(
      await cdp.evaluate(`document.body.textContent.includes('Deep Link Bit') === false`),
      "unknown beatId falls back without loading a beat"
    );
  } finally {
    await prisma().beat.deleteMany({ where: { id: "e2e-deeplink-beat" } });
  }

  // Cleanup the seeded localStorage so later scenarios start fresh.
  await cdp.evaluate(`localStorage.removeItem('flowforge-studio-live'); localStorage.removeItem('flowforge-versions'); true`);
}

// ── Save-Project scenario (modal → Gotowe Numery library → reload) ────
// Reuses the same seeded studio session as scenarioStudio: beat + take +
// teleprompter text. Saves the project through the modal and verifies it
// lands in the „Gotowe Numery” library (localStorage flowforge-beats) and
// renders on /beats, surviving a reload.
async function scenarioSaveProject(cdp, appUrl) {
  console.log("\n== 8. Studio — Zapisz Projekt (modal → Gotowe Numery) ==");
  const root = new URL(appUrl).origin;
  const tpText = "pierwsza linijka\ndruga linijka\ntrzecia linijka";
  const studioSession = {
    beat: { name: "Bit testowy", dataUrl: makeWavDataUrl(8) },
    beatVolume: 0.7,
    takes: [
      {
        id: "take-save-1",
        label: "Wokal testowy",
        duration: 4,
        offset: 0,
        volume: 1,
        isMuted: false,
        isSoloed: false,
        trimStart: 0,
        trimEnd: 1,
        dataUrl: makeWavDataUrl(4),
      },
    ],
    clips: [],
    teleprompter: { text: tpText, sourceId: null, sourceLabel: null, speed: 30 },
    updatedAt: new Date().toISOString(),
  };

  // Seed on the dashboard (same origin) BEFORE the studio provider hydrates.
  await cdp.goto(root + "/", `document.body.textContent.includes('Szybki Dostęp')`);
  await sleep(400);
  await cdp.evaluate(`localStorage.setItem('flowforge-studio-live', ${JSON.stringify(JSON.stringify(studioSession))}); true`);
  await cdp.evaluate(`localStorage.removeItem('flowforge-beats'); true`);

  await cdp.goto(root + "/studio", `document.body.textContent.includes('Zapisz Projekt')`);

  // ── Open the modal ──
  check(await cdp.clickText("Zapisz Projekt"), "opened the „Zapisz Projekt” modal");
  await sleep(500);
  const modal = await cdp.evaluate(`(() => {
    const txt = document.body.textContent;
    const input = document.querySelector('#save-project-name');
    return {
      open: !!document.querySelector('[role=dialog]'),
      title: txt.includes('Zapisz Projekt'),
      summaryTakes: txt.includes('Ścieżki wokalne: 1'),
      summaryBeat: txt.includes('Bit / instrumental'),
      summaryLyrics: txt.includes('Tekst z The Vault'),
      inputPresent: !!input,
      prefilled: input ? input.value : null,
      saveDisabled: [...document.querySelectorAll('button')].find(b => b.textContent.includes('💾 Zapisz'))?.disabled ?? null,
    };
  })()`);
  check(modal.open && modal.title, "modal rendered („Zapisz Projekt” dialog)");
  check(modal.summaryTakes && modal.summaryBeat && modal.summaryLyrics, "summary lists the take, beat and lyrics");
  check(modal.inputPresent === true, "name input present");
  check(modal.prefilled === "Bit testowy", `name pre-filled from the beat (got ${modal.prefilled})`);
  check(modal.saveDisabled === false, "„💾 Zapisz” enabled (name is pre-filled, non-empty)");

  // Type a custom name and save.
  check(await cdp.setInput("#save-project-name", "Mój zapisany numer"), "typed a custom track name");
  await sleep(200);
  // Target the modal's footer button specifically — the header „💾 Zapisz
  // Projekt” also contains „💾 Zapisz” and would win a text search.
  check(
    await cdp.evaluate(`(() => {
      const dlg = document.querySelector('[role=dialog]');
      if (!dlg) return false;
      const b = [...dlg.querySelectorAll('button')].find(x => x.textContent.includes('Zapisz'));
      if (!b) return false;
      b.click();
      return true;
    })()`),
    "clicked the modal's „💾 Zapisz” button"
  );
  await sleep(800);

  // ── Library + toast ──
  const saved = await cdp.evaluate(`(() => {
    let lib = [];
    try { lib = JSON.parse(localStorage.getItem('flowforge-beats') || '[]'); } catch {}
    const proj = lib.find(b => b.kind === 'project' && b.title === 'Mój zapisany numer');
    const txt = document.body.textContent;
    return {
      inLibrary: lib.length === 1 && !!proj,
      takes: proj ? proj.takes.length : null,
      hasTakeLabel: proj ? proj.takes.some(t => t.label === 'Wokal testowy') : false,
      // The save toast is instantly replaced by the challenge-completion
      // toast („🏆 Wyzwanie ukończone…”) — assert either, plus the button
      // flipping to „✓ Zapisano!”.
      saveFeedback: txt.includes('Zapisano projekt') || txt.includes('Wyzwanie ukończone'),
      saveBtnOk: [...document.querySelectorAll('button')].some(b => b.textContent.includes('✓ Zapisano')),
      modalClosed: !document.querySelector('[role=dialog]'),
    };
  })()`);
  check(saved.inLibrary === true, "project written to the „Gotowe Numery” library (1 entry)");
  check(saved.takes === 1 && saved.hasTakeLabel, "saved project carries the take („Wokal testowy”)");
  check(saved.saveFeedback === true, "save feedback shown (toast „Zapisano projekt” / challenge toast)");
  check(saved.saveBtnOk === true, "header button flips to „✓ Zapisano!”");
  check(saved.modalClosed === true, "modal closed after saving");

  // ── /beats renders the project card ──
  await cdp.goto(root + "/beats", `document.body.textContent.includes('Gotowe Numery')`);
  await sleep(800);
  const card = await cdp.evaluate(`(() => {
    const txt = document.body.textContent;
    return {
      title: txt.includes('Mój zapisany numer'),
      studioBadge: txt.includes('🎛️ Studio'),
      // The card renders „1 take'y” (literal apostrophe) when the fix is in.
      takes: txt.includes("1 take'y"),
      genre: txt.includes('Z bitem'),
    };
  })()`);
  check(card.title === true, "/beats shows the saved project title");
  check(card.studioBadge === true, "project card carries the „🎛️ Studio” badge");
  check(card.takes === true, "card shows „1 take'y” (flat project shape)");
  check(card.genre === true, "card shows genre „Z bitem”");

  // ── DB-primary: the save must have persisted a SavedProject row ──
  // The Studio's write is fire-and-forget (tryDbWrite) — poll for it, since
  // the first server-action call in dev mode can compile for a second.
  let dbRow = null;
  for (let i = 0; i < 20 && !dbRow; i++) {
    dbRow = await prisma().savedProject.findFirst({
      where: { title: "Mój zapisany numer" },
    });
    if (!dbRow) await sleep(500);
  }
  check(dbRow !== null, "project row persisted to the DB (SavedProject table)");
  if (dbRow) {
    const payload = JSON.parse(dbRow.data);
    check(payload.takes?.length === 1 && payload.takes[0].label === "Wokal testowy", "DB payload round-trips the full take state");
    check(payload.clips !== undefined && payload.beatName === "Bit testowy", "DB payload carries beat + clip timeline");
  }

  // ── Reload persistence + dedup ──
  // The mirror entry (no dbId) must NOT re-import — /beats dedupes it against
  // the DB row by the proj-… client id, so the card renders exactly once.
  await cdp.send("Page.reload");
  await cdp.waitFor(`document.body.textContent.includes('Gotowe Numery')`, 30000);
  await sleep(1200);
  const afterReload = await cdp.evaluate(`(() => {
    const cards = [...document.querySelectorAll('h3')].filter(h => h.textContent.trim() === 'Mój zapisany numer');
    return {
      shown: cards.length >= 1,
      dupes: cards.length > 1,
    };
  })()`);
  check(afterReload.shown === true, "after reload the project is still in the library");
  check(afterReload.dupes === false, `no duplicate card after reload (dedup via sourceId, ${afterReload.dupes ? "DUPLICATE" : "1 card"})`);

  // Cleanup: drop the seeded session + saved library entry + DB row.
  await cdp.evaluate(`localStorage.removeItem('flowforge-studio-live'); localStorage.removeItem('flowforge-beats'); true`);
  if (dbRow) await prisma().savedProject.deleteMany({ where: { id: dbRow.id } });
}

// ── Challenges scenario (DB-primary progress, auto-award, reset) ──────
// Seeds the ChallengeProgress row (1 completed + 1 partially complete),
// verifies the page renders the score/progress, that syncToDb auto-awards
// the achievement (+points to the profile), and that „Resetuj postęp” wipes
// the DB + mirror + achievements and persists across a reload.
async function scenarioChallenges(cdp, appUrl) {
  console.log("\n== 9. Challenges — progress, auto-award, reset ==");
  const root = new URL(appUrl).origin;
  const now = new Date().toISOString();
  const seeded = {
    completed: { "mistrz-rymu": now },
    stats: {
      takes: 0, splits: 0, trims: 0, volumeChanges: 0, beats: 0,
      lyricsLines: 8, teleprompterOpens: 0, projectsSaved: 0,
    },
    updatedAt: now,
  };

  // Seed the DB (single ChallengeProgress row) and clear the localStorage
  // mirror so the page reads DB-primary. Also drop any challenge achievements
  // that earlier scenarios may have awarded (idempotent awardPoints would
  // otherwise skip the profile upsert after the dashboard cleanup removed it).
  await prisma().userAchievement.deleteMany({ where: { badgeId: { startsWith: "challenge-" } } });
  await prisma().challengeProgress.upsert({
    where: { id: "default" },
    update: { content: JSON.stringify(seeded) },
    create: { id: "default", content: JSON.stringify(seeded) },
  });

  // Fixture for cypher voting: one submission this voter already voted on
  // (voters JSON = DB-primary dedup), one open to vote.
  await prisma().challenge.create({
    data: {
      id: "e2e-vote-cypher",
      title: "E2E Cypher Głosowania",
      description: "Zgłoś zwrotkę i zagłosuj na najlepszą.",
      endDate: new Date(Date.now() + 30 * 86400000),
      isActive: true,
    },
  });
  await prisma().challengeSubmission.create({
    data: {
      id: "e2e-vote-sub-open",
      challengeId: "e2e-vote-cypher",
      authorName: "MC Test",
      title: "Zwrotka testowa",
      content: "linijka",
      voteCount: 3,
      voters: JSON.stringify(["voter-other"]),
    },
  });
  await prisma().challengeSubmission.create({
    data: {
      id: "e2e-vote-sub-done",
      challengeId: "e2e-vote-cypher",
      authorName: "MC Stary",
      title: "Stara zwrotka",
      content: "linijka",
      voteCount: 1,
      voters: JSON.stringify(["voter-e2e"]),
    },
  });

  await cdp.goto(root + "/vault", `!!document.querySelector('textarea')`);
  await cdp.evaluate(`localStorage.clear(); localStorage.setItem('flowforge-voter-id', 'voter-e2e'); true`);
  await cdp.goto(root + "/challenges", `document.body.textContent.includes('Jak zdobywać punkty?')`);

  // ── Rendered score + progress ──
  const ui = await cdp.evaluate(`(() => {
    const txt = document.body.textContent;
    // The score is the text-4xl font-mono <p> („100 / 1450 pkt” with the max
    // score in a nested span) — strip non-digits to get the score value.
    const scoreEl = [...document.querySelectorAll('p')].find(p => p.className.includes('text-4xl') && p.className.includes('font-mono'));
    // „100 / 1450 pkt” — take the digits BEFORE the slash only.
    const scorePart = scoreEl ? (scoreEl.textContent.split('/')[0] || '') : '';
    return {
      score: scorePart.replace(/[^0-9]/g, '') || null,
      completed: (txt.match(/([0-9]+) z 10 wyzwań ukończonych/) || [])[1] ?? null,
      mistrzDone: txt.includes('Mistrz Rymu') && txt.includes('Ukończono'),
      resetBtn: [...document.querySelectorAll('button')].some(b => b.textContent.includes('Resetuj postęp')),
    };
  })()`);
  check(ui.score === "100", `score shows 100 pkt (Mistrz Rymu) (got ${ui.score})`);
  check(ui.completed === "1", `completed count = 1 z 10 (got ${ui.completed})`);
  check(ui.mistrzDone === true, "„Mistrz Rymu” card shows „Ukończono” badge");
  check(ui.resetBtn === true, "„↺ Resetuj postęp” button present");

  // Maraton Wersów at 8/30 lines — progress ~27%.
  const maraton = await cdp.evaluate(`(() => {
    const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-2xl'));
    const card = cards.find(c => c.textContent.includes('Maraton Wersów'));
    const pct = card ? (card.textContent.match(/([0-9]+)%/) || [])[1] ?? null : null;
    return { pct };
  })()`);
  check(maraton.pct === "27", `Maraton Wersów progress = 27% (8/30 lines) (got ${maraton.pct})`);

  // ── Community cyphers section (seeded Challenge rows + submissions) ──
  // The countdown is computed from the DB deadline (the seed re-rolls it on
  // every db:seed, so a fixed literal would drift).
  const seedCypher = await prisma().challenge.findUnique({ where: { id: "cypher-miasto" } });
  const expectedDays = seedCypher
    ? String(Math.max(0, Math.ceil((seedCypher.endDate.getTime() - Date.now()) / 86400000)))
    : null;
  const cyphers = await cdp.evaluate(`(() => {
    const txt = document.body.textContent;
    const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-2xl'));
    const section = [...document.querySelectorAll('h2')].find(h => h.textContent.includes('Aktywne Cyphery'));
    const card = (title) => cards.find(c => c.textContent.includes('Cypher') && c.textContent.includes(title));
    const m = card('Cypher: Moje Miasto');
    const b = card('Bitwa Freestyle');
    return {
      found: !!section,
      miasto: !!m,
      bitwa: !!b,
      countdown: m ? (m.textContent.match(/([0-9]+)d/) || [])[1] ?? null : null,
      sub: m ? m.textContent.includes('Raper X') && m.textContent.includes('▲ 3') : false,
      votesLine: m ? m.textContent.includes('Zgłoszenia • 2') : false,
      emptyBitwa: b ? b.textContent.includes('Brak zgłoszeń — bądź pierwszy!') : false,
      secPresent: txt.includes('Aktywne Cyphery'),
    };
  })()`);
  check(cyphers.secPresent === true, "„Aktywne Cyphery” section rendered");
  check(cyphers.miasto === true && cyphers.bitwa === true, "both seeded cyphers render as cards");
  check(
    expectedDays !== null && cyphers.countdown === expectedDays,
    `„Cypher: Moje Miasto” countdown matches the DB deadline (${expectedDays}d, got ${cyphers.countdown})`
  );
  check(cyphers.votesLine === true, "„Zgłoszenia • 2” counter shown");
  check(cyphers.sub === true, "top submission listed: „Raper X” with ▲ 3");
  check(cyphers.emptyBitwa === true, "„Bitwa Freestyle” shows the empty-state „Bądź pierwszy!”");

  // ── Cypher voting: ▲ button → DB vote → lock, dedup, persistence ──
  const voteUi = await cdp.evaluate(`(() => {
    const open = document.querySelector('[data-vote-btn="e2e-vote-sub-open"]');
    const done = document.querySelector('[data-vote-btn="e2e-vote-sub-done"]');
    const txt = (b) => b.textContent.replace(/\\s+/g, ' ').trim();
    return {
      open: open ? { voted: open.getAttribute('data-voted') === 'true', disabled: open.disabled, text: txt(open) } : null,
      done: done ? { voted: done.getAttribute('data-voted') === 'true', disabled: done.disabled, text: txt(done) } : null,
    };
  })()`);
  check(voteUi.open !== null && voteUi.done !== null, "both fixture submissions render vote buttons");
  check(
    voteUi.open && voteUi.open.voted === false && voteUi.open.disabled === false && voteUi.open.text === "▲ 3",
    `open submission shows an enabled „▲ 3” button (got ${voteUi.open && voteUi.open.text})`
  );
  check(
    voteUi.done && voteUi.done.voted === true && voteUi.done.disabled === true && voteUi.done.text.includes("✓"),
    "already-voted submission is locked with ✓"
  );

  // Click vote → the DB count moves 3 → 4 and the voter id is recorded.
  check(
    await cdp.evaluate(`(() => {
      const btn = document.querySelector('[data-vote-btn="e2e-vote-sub-open"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`),
    "clicked ▲ on the open submission"
  );
  await sleep(500);
  // Regression guard: the page renders ToastView — without it, vote/create
  // toasts would silently never appear (found missing on /challenges).
  check(
    await cdp.evaluate(`document.body.textContent.includes('Oddano głos')`),
    "vote toast „▲ Oddano głos…” rendered (ToastView present)"
  );
  const votedRow = await prisma().challengeSubmission.findUnique({ where: { id: "e2e-vote-sub-open" } });
  check(votedRow !== null && votedRow.voteCount === 4, `vote persisted: count 3 → 4 (got ${votedRow?.voteCount})`);
  check(
    votedRow !== null && typeof votedRow.voters === "string" && votedRow.voters.includes("voter-e2e"),
    "voters JSON records the browser's voter id"
  );
  const voteLocked = await cdp.evaluate(`(() => {
    const btn = document.querySelector('[data-vote-btn="e2e-vote-sub-open"]');
    return btn
      ? { voted: btn.getAttribute('data-voted') === 'true', disabled: btn.disabled, text: btn.textContent.replace(/\\s+/g, ' ').trim() }
      : null;
  })()`);
  check(
    voteLocked && voteLocked.voted === true && voteLocked.disabled === true && voteLocked.text.includes("4"),
    `button locks after voting and shows the new count (got ${voteLocked && voteLocked.text})`
  );

  // A second click is a no-op — the DB count must not move.
  await cdp.evaluate(`document.querySelector('[data-vote-btn="e2e-vote-sub-open"]').click()`);
  await sleep(300);
  const still4 = await prisma().challengeSubmission.findUnique({ where: { id: "e2e-vote-sub-open" }, select: { voteCount: true } });
  check(still4?.voteCount === 4, "double-click cannot inflate the count (still 4)");

  // Reload → the voters column locks the button again from the DB.
  await cdp.send("Page.reload");
  await cdp.waitFor(`document.body.textContent.includes('Jak zdobywać punkty?')`, 30000);
  await sleep(1200);
  const voteAfterReload = await cdp.evaluate(`(() => {
    const btn = document.querySelector('[data-vote-btn="e2e-vote-sub-open"]');
    return btn ? { voted: btn.getAttribute('data-voted') === 'true', disabled: btn.disabled } : null;
  })()`);
  check(
    voteAfterReload && voteAfterReload.voted === true && voteAfterReload.disabled === true,
    "after reload the vote stays locked (voters read from the DB)"
  );

  // ── Auto-award: syncToDb creates the achievement + profile points ──
  // Poll until the award lands (the server action is fire-and-forget).
  let award = null;
  let profile = null;
  for (let i = 0; i < 20; i++) {
    award = await prisma().userAchievement.findUnique({ where: { badgeId: "challenge-mistrz-rymu" } });
    profile = await prisma().userProfile.findUnique({ where: { id: "default" } });
    if (award && profile && profile.totalPoints >= 100) break;
    await sleep(400);
  }
  check(
    award !== null && award.points === 100,
    "completed challenge auto-awarded to the DB profile (challenge-mistrz-rymu +100 pkt)"
  );
  check(
    profile !== null && profile.totalPoints >= 100 && profile.level >= 1,
    `profile totalPoints reflects the award (got ${profile?.totalPoints})`
  );

  // ── Reset: wipes DB + mirror + achievements ──
  check(await cdp.clickText("Resetuj postęp"), "clicked „↺ Resetuj postęp”");
  await sleep(1500);
  const afterReset = await cdp.evaluate(`(() => {
    const txt = document.body.textContent;
    const scoreEl = [...document.querySelectorAll('p')].find(p => p.className.includes('text-4xl') && p.className.includes('font-mono'));
    const scorePart = scoreEl ? (scoreEl.textContent.split('/')[0] || '') : '';
    return {
      score: scorePart.replace(/[^0-9]/g, '') || null,
      completed: (txt.match(/([0-9]+) z 10 wyzwań ukończonych/) || [])[1] ?? null,
    };
  })()`);
  check(afterReset.score === "0", `score resets to 0 (got ${afterReset.score})`);
  check(afterReset.completed === "0", `completed count resets to 0 (got ${afterReset.completed})`);

  const dbState = await prisma().challengeProgress.findUnique({ where: { id: "default" } });
  check(dbState === null, "ChallengeProgress row deleted from the DB");
  check(
    await cdp.evaluate(`(() => { try { const s = JSON.parse(localStorage.getItem('flowforge-challenge-state')); return (s.completed ? Object.keys(s.completed).length : 0) === 0 && s.stats.lyricsLines === 0; } catch { return false; } })()`),
    "localStorage mirror reset to the empty state"
  );
  const awardAfterReset = await prisma().userAchievement.findUnique({
    where: { badgeId: "challenge-mistrz-rymu" },
  });
  check(awardAfterReset === null, "achievement removed from the DB profile");

  // ── Reload: reset persists ──
  await cdp.send("Page.reload");
  await cdp.waitFor(`document.body.textContent.includes('Jak zdobywać punkty?')`, 30000);
  await sleep(1000);
  check(
    await cdp.evaluate(`(() => { const t = document.body.textContent; return (t.match(/([0-9]+) z 10 wyzwań ukończonych/) || [])[1] === '0'; })()`),
    "after reload the reset persists (0/10)"
  );

  // Cleanup: restore the pristine profile (reset may have left totalPoints 0
  // via awardPoints' recompute; deleteAchievement already removed the row)
  // and drop the voting fixture (cascade removes its submissions).
  await prisma().challenge.deleteMany({ where: { id: "e2e-vote-cypher" } });
  await prisma().userProfile.deleteMany({ where: { id: "default" } });
}

// ── Feed scenario (create post, rate, comment) ───────────────────────
// Seeds a community post in the isolated DB, verifies the feed renders it,
// then exercises like → rating → comment → publishing a new post (all
// DB-backed) and confirms the rows land in the DB.
async function scenarioFeed(cdp, appUrl) {
  console.log("\n== 10. Feed — post, rating, comments ==");
  const root = new URL(appUrl).origin;

  // Seed one post so the feed is non-empty and the interactions have a target.
  const seededPost = await prisma().communityPost.create({
    data: {
      title: "Seedowy Wers z Testu",
      content: "pierwsza linijka z seeda\ndruga linijka",
      authorName: "Testowy Autor",
    },
  });

  try {
    // Clear the localStorage feed cache so the page loads DB-primary.
    await cdp.goto(root + "/vault", `!!document.querySelector('textarea')`);
    await cdp.evaluate(`localStorage.removeItem('flowforge-feed-posts'); true`);
    await cdp.goto(root + "/feed", `document.body.textContent.includes('Ściana Raperów')`);
    await sleep(800);

    // ── Seeded post renders ──
    const seeded = await cdp.evaluate(`(() => {
      const txt = document.body.textContent;
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('overflow-hidden') && d.textContent.includes('Seedowy Wers z Testu'));
      return {
        title: txt.includes('Seedowy Wers z Testu'),
        author: card ? card.textContent.includes('Testowy Autor') : false,
        content: card ? card.textContent.includes('pierwsza linijka z seeda') : false,
        commentCount: card ? card.textContent.includes('💬 0') : false,
      };
    })()`);
    check(seeded.title && seeded.author && seeded.content, "seeded post renders (title, author, content)");
    check(seeded.commentCount === true, "comment counter starts at 💬 0");

    // ── Like toggles the heart ──
    const likeBefore = await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('overflow-hidden') && d.textContent.includes('Seedowy Wers z Testu'));
      return card ? [...card.querySelectorAll('button')].some(b => b.textContent.includes('❤️')) : null;
    })()`);
    check(likeBefore === false, "post starts unliked (🤍)");
    await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('overflow-hidden') && d.textContent.includes('Seedowy Wers z Testu'));
      const b = card ? [...card.querySelectorAll('button')].find(x => x.textContent.includes('Lubię')) : null;
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(300);
    check(
      await cdp.evaluate(`(() => {
        const card = [...document.querySelectorAll('div')].find(d => d.className.includes('overflow-hidden') && d.textContent.includes('Seedowy Wers z Testu'));
        return card ? [...card.querySelectorAll('button')].some(b => b.textContent.includes('❤️')) : false;
      })()`),
      "like flips the heart to ❤️"
    );

    // ── Rate 5★ → optimistic UI update + Rating row in the DB ──
    await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('overflow-hidden') && d.textContent.includes('Seedowy Wers z Testu'));
      const stars = card ? [...card.querySelectorAll('button')].filter(b => b.textContent === '☆' || b.textContent === '★') : [];
      const five = stars[4];
      if (five) five.click();
      return !!five;
    })()`);
    await sleep(300);
    check(
      await cdp.evaluate(`(() => {
        const card = [...document.querySelectorAll('div')].find(d => d.className.includes('overflow-hidden') && d.textContent.includes('Seedowy Wers z Testu'));
        const stars = card ? [...card.querySelectorAll('button')].filter(b => b.textContent === '★') : [];
        return stars.length === 5;
      })()`),
      "rating 5★ lights all five stars (optimistic UI)"
    );
    await sleep(800); // let the ratePost server action land
    const ratingRow = await prisma().rating.findFirst({
      where: { postId: seededPost.id, raterName: "Ty" },
    });
    check(ratingRow !== null && ratingRow.score === 5, "Rating row written to the DB (Ty, 5★)");

    // ── Comment: expand + submit ──
    await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('overflow-hidden') && d.textContent.includes('Seedowy Wers z Testu'));
      const b = card ? [...card.querySelectorAll('button')].find(x => x.textContent.includes('💬')) : null;
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(400);
    check(
      await cdp.evaluate(`(() => {
        const card = [...document.querySelectorAll('div')].find(d => d.className.includes('overflow-hidden') && d.textContent.includes('Seedowy Wers z Testu'));
        return card ? !!card.querySelector('input[placeholder*="Dodaj komentarz"]') : false;
      })()`),
      "comment input appears after expanding the post"
    );
    await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('overflow-hidden') && d.textContent.includes('Seedowy Wers z Testu'));
      const input = card ? card.querySelector('input[placeholder*="Dodaj komentarz"]') : null;
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'komentarz testowy e2e');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(200);
    check(
      await cdp.evaluate(`(() => {
        const card = [...document.querySelectorAll('div')].find(d => d.className.includes('overflow-hidden') && d.textContent.includes('Seedowy Wers z Testu'));
        const b = card ? [...card.querySelectorAll('button')].find(x => x.textContent.trim() === 'Wyślij') : null;
        if (b) b.click();
        return !!b;
      })()`),
      "clicked „Wyślij”"
    );
    await sleep(1000); // let the addComment server action land + swap temp id
    const commentUi = await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('overflow-hidden') && d.textContent.includes('Seedowy Wers z Testu'));
      return {
        visible: card ? card.textContent.includes('komentarz testowy e2e') : false,
        author: card ? card.textContent.includes('Ty') : false,
        count: card ? card.textContent.includes('💬 1') : false,
      };
    })()`);
    check(commentUi.visible && commentUi.author, "comment renders in the thread („komentarz testowy e2e” by Ty)");
    check(commentUi.count === true, "comment counter updates to 💬 1");
    const commentRow = await prisma().comment.findFirst({
      where: { postId: seededPost.id, content: "komentarz testowy e2e" },
    });
    check(commentRow !== null && commentRow.authorName === "Ty", "Comment row written to the DB (Ty)");

    // ── Publish a new post through the form ──
    check(await cdp.clickText("Opublikuj Tekst"), "opened the new-post form");
    await sleep(300);
    check(await cdp.setInput(`input[placeholder*='Tytuł utworu']`, "E2E Nowy Post"), "filled the post title");
    check(await cdp.setInput(`textarea[placeholder*='Wklej swój tekst']`, "świeży tekst z testu e2e"), "filled the post content");
    await sleep(200);
    // Scope to the form's button — the header „✍️ Opublikuj Tekst” also
    // contains „Opublikuj” and would win an unscoped text search.
    check(
      await cdp.evaluate(`(() => {
        const form = [...document.querySelectorAll('div')].find(d => d.className.includes('border-amber-500/20') && d.textContent.includes('Nowy Post'));
        const b = form ? [...form.querySelectorAll('button')].find(x => x.textContent.trim() === 'Opublikuj') : null;
        if (b) b.click();
        return !!b;
      })()`),
      "clicked the form's „Opublikuj” button"
    );
    await sleep(1000);
    const published = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('overflow-hidden'));
      const first = cards[0];
      return {
        inFeed: document.body.textContent.includes('E2E Nowy Post'),
        content: document.body.textContent.includes('świeży tekst z testu e2e'),
        firstIsNew: first ? first.textContent.includes('E2E Nowy Post') : false,
      };
    })()`);
    check(published.inFeed && published.content, "new post appears in the feed");
    check(published.firstIsNew === true, "new post is listed first (newest first)");
    const postRow = await prisma().communityPost.findFirst({
      where: { title: "E2E Nowy Post" },
    });
    check(postRow !== null && postRow.authorName === "Ty", "published post row written to the DB (Ty)");
  } finally {
    // Cleanup: remove the seeded + published posts (ratings/comments cascade).
    await prisma().communityPost.deleteMany({
      where: { OR: [{ id: seededPost.id }, { title: "E2E Nowy Post" }] },
    });
  }
}

// ── Inspirations scenario (add, vote, search/filter) ─────────────────
// Seeds inspirations with distinct difficulty + tags, verifies the cards
// render with vote counts, then exercises voting (optimistic + DB),
// search, difficulty + tag filters, and adding a new inspiration.
async function scenarioInspirations(cdp, appUrl) {
  console.log("\n== 11. Inspirations — add, vote, search/filter ==");
  const root = new URL(appUrl).origin;

  // The demo seed adds sample inspirations — wipe them so the assertions
  // below (vote counters, filter counts) see only this scenario's fixture.
  await prisma().lyricalInspiration.deleteMany({});

  await prisma().lyricalInspiration.createMany({
    data: [
      {
        artist: "Peja",
        songTitle: "Testowy Bit Peji",
        lyrics: "refren z testu e2e",
        difficulty: "easy",
        tags: JSON.stringify(["storytelling"]),
        voteCount: 0,
      },
      {
        artist: "Ostry",
        songTitle: "Testowy Wers Ostry",
        lyrics: "trudny tekst z testu e2e",
        difficulty: "hard",
        tags: JSON.stringify(["metafory"]),
        voteCount: 0,
      },
    ],
  });

  try {
    // Clear the localStorage cache so the page loads DB-primary.
    await cdp.goto(root + "/vault", `!!document.querySelector('textarea')`);
    await cdp.evaluate(`localStorage.removeItem('flowforge-inspirations'); localStorage.removeItem('flowforge-inspiration-votes'); true`);
    await cdp.goto(root + "/inspirations", `document.body.textContent.includes('Polish Lyric Hall of Fame')`);
    await sleep(800);

    // ── Seeded cards render with difficulty + vote count ──
    const seeded = await cdp.evaluate(`(() => {
      const txt = document.body.textContent;
      const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-2xl') && d.className.includes('card-hover'));
      return {
        peja: txt.includes('Testowy Bit Peji') && txt.includes('Peja'),
        ostry: txt.includes('Testowy Wers Ostry') && txt.includes('Ostry'),
        pejaEasy: cards.some(c => c.textContent.includes('Testowy Bit Peji') && c.textContent.includes('Łatwy')),
        ostryHard: cards.some(c => c.textContent.includes('Testowy Wers Ostry') && c.textContent.includes('Trudny')),
        tagStory: txt.includes('#storytelling'),
        tagMeta: txt.includes('#metafory'),
        votesZero: cards.every(c => c.textContent.includes('△ 0')),
      };
    })()`);
    check(seeded.peja && seeded.ostry, "both seeded cards render (artist + title)");
    check(seeded.pejaEasy && seeded.ostryHard, "difficulty badges show (Łatwy / Trudny)");
    check(seeded.tagStory && seeded.tagMeta, "tag chips render (#storytelling / #metafory)");
    check(seeded.votesZero === true, "vote counters start at △ 0");

    // ── Vote: optimistic + DB row ──
    await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('card-hover') && d.textContent.includes('Testowy Bit Peji'));
      const b = card ? [...card.querySelectorAll('button')].find(x => x.textContent.includes('△') || x.textContent.includes('▲')) : null;
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(300);
    check(
      await cdp.evaluate(`(() => {
        const card = [...document.querySelectorAll('div')].find(d => d.className.includes('card-hover') && d.textContent.includes('Testowy Bit Peji'));
        return card ? card.textContent.includes('▲ 1') : false;
      })()`),
      "vote bumps the counter to ▲ 1 (optimistic)"
    );
    await sleep(800); // let the voteInspiration server action land
    const pejaRow = await prisma().lyricalInspiration.findFirst({
      where: { songTitle: "Testowy Bit Peji" },
    });
    check(pejaRow !== null && pejaRow.voteCount === 1, "voteCount = 1 persisted to the DB");
    check(
      await cdp.evaluate(`(() => { try { return JSON.parse(localStorage.getItem('flowforge-inspiration-votes') || '[]').length === 1; } catch { return false; } })()`),
      "voted id persisted to localStorage"
    );

    // Toggle back (remove the vote).
    await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('card-hover') && d.textContent.includes('Testowy Bit Peji'));
      const b = card ? [...card.querySelectorAll('button')].find(x => x.textContent.includes('▲')) : null;
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(300);
    check(
      await cdp.evaluate(`(() => {
        const card = [...document.querySelectorAll('div')].find(d => d.className.includes('card-hover') && d.textContent.includes('Testowy Bit Peji'));
        return card ? card.textContent.includes('△ 0') : false;
      })()`),
      "voting again removes the vote (△ 0)"
    );
    await sleep(800);
    const pejaAfter = await prisma().lyricalInspiration.findFirst({ where: { songTitle: "Testowy Bit Peji" } });
    check(pejaAfter !== null && pejaAfter.voteCount === 0, "voteCount back to 0 in the DB");

    // ── Search filters by artist/title ──
    check(await cdp.setInput(`input[placeholder*='Szukaj artysty']`, "ostry"), "typed a search query");
    await sleep(400);
    const searched = await cdp.evaluate(`(() => {
      const txt = document.body.textContent;
      const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('card-hover'));
      return {
        ostry: cards.some(c => c.textContent.includes('Testowy Wers Ostry')),
        peja: cards.some(c => c.textContent.includes('Testowy Bit Peji')),
        count: cards.length,
      };
    })()`);
    check(searched.ostry === true && searched.peja === false, `search narrows to the matching card (got ${searched.count} card(s))`);
    await cdp.evaluate(`(() => {
      const el = document.querySelector('input[placeholder*="Szukaj artysty"]');
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(300);

    // ── Difficulty filter ──
    await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Łatwy');
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(400);
    const byDiff = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('card-hover'));
      return {
        count: cards.length,
        peja: cards.some(c => c.textContent.includes('Testowy Bit Peji')),
        ostry: cards.some(c => c.textContent.includes('Testowy Wers Ostry')),
      };
    })()`);
    check(byDiff.count === 1 && byDiff.peja === true && byDiff.ostry === false, "difficulty filter „Łatwy” keeps only the easy card");

    // ── Tag filter ──
    await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '#metafory');
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(400);
    const byTag = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('card-hover'));
      return {
        count: cards.length,
        peja: cards.some(c => c.textContent.includes('Testowy Bit Peji')),
        ostry: cards.some(c => c.textContent.includes('Testowy Wers Ostry')),
        empty: document.body.textContent.includes('Brak inspiracji pasujących do filtrów'),
      };
    })()`);
    check(
      byTag.count === 0 && byTag.empty === true,
      "tag filter „#metafory” + difficulty „Łatwy” → empty state (no matches)"
    );
    // Reset filters — click ALL „Wszystkie” buttons (difficulty + tag).
    // (Clicking only the first one used to leave the difficulty filter on
    // „Łatwy”, which then hid the new „Średni” card from the render.)
    await cdp.evaluate(`(() => {
      const bs = [...document.querySelectorAll('button')].filter(x => x.textContent.trim() === 'Wszystkie');
      for (const b of bs) b.click();
      return bs.length;
    })()`);
    await sleep(400);

    // ── Add a new inspiration ──
    check(await cdp.clickText("Dodaj Inspirację"), "opened the add form");
    await sleep(300);
    check(await cdp.setInput(`input[placeholder*='Artysta']`, "E2E Artysta"), "filled the artist");
    check(await cdp.setInput(`input[placeholder*='Tytuł utworu']`, "E2E Utwór"), "filled the song title");
    check(await cdp.setInput(`textarea[placeholder*='Wklej fragment tekstu']`, "świeży tekst e2e"), "filled the lyrics");
    await sleep(200);
    // Scope to the form's „Dodaj” button — the header „+ Dodaj Inspirację” also contains „Dodaj”.
    check(
      await cdp.evaluate(`(() => {
        const form = [...document.querySelectorAll('div')].find(d => d.className.includes('border-amber-500/20') && d.textContent.includes('Nowa Inspiracja'));
        const b = form ? [...form.querySelectorAll('button')].find(x => x.textContent.trim() === 'Dodaj') : null;
        if (b) b.click();
        return !!b;
      })()`),
      "clicked the form's „Dodaj” button"
    );
    // The first server-action call compiles in dev mode, so poll for the card
    // instead of relying on a fixed sleep.
    let added = null;
    for (let i = 0; i < 24 && !added; i++) {
      added = await cdp.evaluate(`(() => {
        const txt = document.body.textContent;
        if (!txt.includes('E2E Utwór') || !txt.includes('E2E Artysta')) return null;
        const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('card-hover'));
        return {
          visible: true,
          content: txt.includes('świeży tekst e2e'),
          first: cards[0] ? cards[0].textContent.includes('E2E Utwór') : false,
          toast: txt.includes('Dodano: E2E Artysta'),
        };
      })()`);
      if (!added) await sleep(500);
    }
    check(!!added && added.visible && added.content, "new inspiration card renders at the top");
    check(!!added && added.first === true, "new card is listed first");
    check(!!added && added.toast === true, "success toast „🏆 Dodano: E2E Artysta — E2E Utwór”");
    const addedRow = await prisma().lyricalInspiration.findFirst({ where: { songTitle: "E2E Utwór" } });
    check(addedRow !== null && addedRow.artist === "E2E Artysta", "new inspiration row written to the DB");
  } finally {
    await prisma().lyricalInspiration.deleteMany({
      where: { OR: [{ songTitle: "Testowy Bit Peji" }, { songTitle: "Testowy Wers Ostry" }, { songTitle: "E2E Utwór" }] },
    });
  }
}

// ── Versions cap + archive scenario ──────────────────────────────────
// Seeds a lyric with MAX_ACTIVE_VERSIONS_PER_LYRIC (50) active versions,
// then saves one more THROUGH THE UI: the oldest must be auto-archived
// (quota stays 50/50, „Archiwum (1)”). Then exercises the archive UI:
// restore at the cap swaps the oldest active into the archive, manual
// archive, and „Wyczyść archiwum” (purge) — each verified against the DB.
async function scenarioVersionsArchive(cdp, appUrl) {
  console.log("\n== 12. Versions — cap + archive ==");
  const root = new URL(appUrl).origin + "/";
  const MAX = 50;
  const lyric = await prisma().lyric.create({
    data: {
      title: "Limit Wersji",
      content: "wers startowy",
      lineCount: 1,
      wordCount: 2,
      syllableCount: 5,
    },
  });
  try {
    // Fill the track to the cap with deterministic ordering (seed-1 oldest).
    await prisma().lyricVersion.createMany({
      data: Array.from({ length: MAX }, (_, i) => ({
        lyricId: lyric.id,
        content: `wers ${i + 1}`,
        label: `seed-${i + 1}`,
        snapshot: i + 1,
        createdAt: new Date(Date.now() + i * 1000),
      })),
    });

    // Open the track via deep link, then switch to the Wersje tab.
    await cdp.goto(root + `/vault?track=${encodeURIComponent(lyric.id)}`, `!!document.querySelector('textarea')`);
    await sleep(800);
    check(await cdp.clickText("Wersje"), "opened the Wersje tab");
    await sleep(600);
    const atCap = await cdp.evaluate(`(() => {
      const txt = document.body.textContent;
      return {
        quota: txt.includes('50/50'),
        badge0: txt.includes('📦 Archiwum (0)'),
        newest: txt.includes('seed-50'),
        oldestActive: txt.includes('seed-1'),
      };
    })()`);
    check(atCap.quota === true, `quota chip shows 50/50 at the cap (got ${atCap.quota})`);
    check(atCap.badge0 === true, "archive badge „📦 Archiwum (0)” before the save");
    check(atCap.newest === true, "newest active version visible (seed-50)");
    check(atCap.oldestActive === true, "seed-1 still in the active list before the save");

    // ── Version diff: „🔍 Porównaj” — two selects + colored line rows ──
    check(await cdp.clickText("Porównaj"), "opened the compare mode");
    await sleep(400);
    const diffOpen = await cdp.evaluate(`(() => {
      const body = document.body.textContent;
      return {
        selects: document.querySelectorAll('select').length,
        stats: body.includes('% podobieństwa'),
        base: body.includes('Wersja bazowa'),
      };
    })()`);
    check(diffOpen.selects >= 2, "compare mode renders two version selectors");
    check(diffOpen.base === true, "base selector labeled „Wersja bazowa (starsza)”");
    check(diffOpen.stats === true, "diff stats line rendered („% podobieństwa”)");

    // Pick seed-1 (base) vs seed-2 (compare) — one line each, fully different.
    const seedIds = await prisma().lyricVersion.findMany({
      where: { lyricId: lyric.id, label: { in: ["seed-1", "seed-2"] } },
    });
    const seed1 = seedIds.find((v) => v.label === "seed-1");
    const seed2 = seedIds.find((v) => v.label === "seed-2");
    await cdp.evaluate(`(() => {
      const selects = [...document.querySelectorAll('select')];
      const setVal = (sel, val) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, val);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setVal(selects[0], '${seed1.id}');
      setVal(selects[1], '${seed2.id}');
    })()`);
    await sleep(400);
    const diffRows = await cdp.evaluate(`(() => {
      const container = document.querySelector('div[class*="max-h-[320px]"]');
      const rows = container ? [...container.children] : [];
      return {
        count: rows.length,
        texts: rows.map((r) => r.textContent.trim()),
        classes: rows.map((r) => r.className),
      };
    })()`);
    check(diffRows.count === 2, `diff shows 2 rows for two one-line versions (got ${diffRows.count})`);
    check(diffRows.texts.some((t) => t.includes("wers 1")), "removed line „wers 1” rendered");
    check(diffRows.texts.some((t) => t.includes("wers 2")), "added line „wers 2” rendered");
    check(
      diffRows.classes[0].includes("red") && diffRows.classes[1].includes("emerald"),
      "removed row styled red / added row styled green"
    );
    const diffStatsTxt = await cdp.evaluate(
      `document.body.textContent.includes('+1 −1 • 0 wspólnych')`
    );
    check(diffStatsTxt === true, "stats read „+1 −1 • 0 wspólnych” for fully different one-liners");
    check(await cdp.clickText("Porównaj"), "closed the compare mode");
    await sleep(300);

    // Back to the editor and save the 51st version through the UI.
    check(await cdp.clickText("Edytor"), "back to the editor tab");
    await sleep(400);
    check(await cdp.clickText("Zapisz Wersję"), "clicked „💾 Zapisz Wersję” (the 51st version)");
    // Switch to the Wersje tab FIRST — the panel only exists in the DOM on
    // that tab — then poll for the auto-archive to appear (the save runs a
    // server action + refreshVersions, so it lands asynchronously).
    check(await cdp.clickText("Wersje"), "opened the Wersje tab to inspect");
    let archived = false;
    for (let i = 0; i < 30 && !archived; i++) {
      archived = await cdp.evaluate(`document.body.textContent.includes('📦 Archiwum (1)')`);
      if (!archived) await sleep(500);
    }
    check(archived, "saving the 51st version auto-archives the oldest (badge → „Archiwum (1)”)");
    await sleep(300);
    const afterSave = await cdp.evaluate(`(() => {
      const txt = document.body.textContent;
      return {
        quota: txt.includes('50/50'),
        badge1: txt.includes('📦 Archiwum (1)'),
        newest: txt.includes('seed-50'),
      };
    })()`);
    check(afterSave.quota === true, "active quota stays at 50/50 after the save");
    check(afterSave.badge1 === true, "archive badge counts 1");
    const statsAfterSave = await prisma().lyricVersion.count({
      where: { lyricId: lyric.id, archivedAt: { not: null } },
    });
    check(statsAfterSave === 1, "exactly one archived row in the DB");
    const archivedLabel = await prisma().lyricVersion.findFirst({
      where: { lyricId: lyric.id, archivedAt: { not: null } },
    });
    check(archivedLabel?.label === "seed-1", `the archived row is the oldest (seed-1, got ${archivedLabel?.label})`);

    // ── Restore at the cap → the oldest ACTIVE is swapped into the archive ──
    check(await cdp.clickText("Archiwum"), "expanded the archive section");
    await sleep(400);
    const restored = await cdp.evaluate(`(() => {
      const rows = [...document.querySelectorAll('div')].filter(d => {
        const p = d.querySelector('p');
        return p && p.textContent.trim() === 'seed-1' && d.className.includes('opacity-80');
      });
      const row = rows[0];
      if (!row) return false;
      const b = [...row.querySelectorAll('button')].find(x => x.textContent.includes('Przywróć'));
      if (!b) return false;
      b.click();
      return true;
    })()`);
    check(restored, "clicked „Przywróć” on the archived seed-1");
    // Poll for the swap to land (badge stays 1, but the archived label becomes seed-2).
    let swapped = false;
    for (let i = 0; i < 20 && !swapped; i++) {
      swapped = await cdp.evaluate(`(() => {
        const rows = [...document.querySelectorAll('div')].filter(d => {
          const p = d.querySelector('p');
          return p && p.textContent.trim() === 'seed-2' && d.className.includes('opacity-80');
        });
        return rows.length > 0;
      })()`);
      if (!swapped) await sleep(500);
    }
    check(swapped, "restore at the cap swapped seed-2 (oldest active) into the archive");
    const s1 = await prisma().lyricVersion.findFirst({ where: { lyricId: lyric.id, label: "seed-1" } });
    const s2 = await prisma().lyricVersion.findFirst({ where: { lyricId: lyric.id, label: "seed-2" } });
    check(s1?.archivedAt === null && s2?.archivedAt !== null, "DB: seed-1 active again, seed-2 archived (swap verified)");
    const activeCount = await prisma().lyricVersion.count({ where: { lyricId: lyric.id, archivedAt: null } });
    check(activeCount === MAX, "active set still exactly at the cap after the swap");

    // ── Manual archive of an active version ──
    const manual = await cdp.evaluate(`(() => {
      const rows = [...document.querySelectorAll('div')].filter(d => {
        const p = d.querySelector('p');
        return p && p.textContent.trim() === 'seed-50' && !d.className.includes('opacity-80');
      });
      const row = rows[0];
      if (!row) return false;
      const b = [...row.querySelectorAll('button')].find(x => x.textContent.includes('📦'));
      if (!b) return false;
      b.click();
      return true;
    })()`);
    check(manual, "clicked „📦” on an active version (seed-50)");
    let badge2 = false;
    for (let i = 0; i < 20 && !badge2; i++) {
      badge2 = await cdp.evaluate(`document.body.textContent.includes('📦 Archiwum (2)')`);
      if (!badge2) await sleep(500);
    }
    check(badge2, "manual archive bumps the badge to „Archiwum (2)”");
    // The archive write is fire-and-forget (tryDbWrite) — poll the DB until
    // the row actually lands, so the purge below can't race it.
    let s50 = null;
    for (let i = 0; i < 20 && !s50?.archivedAt; i++) {
      s50 = await prisma().lyricVersion.findFirst({ where: { lyricId: lyric.id, label: "seed-50" } });
      if (!s50?.archivedAt) await sleep(500);
    }
    check(s50?.archivedAt !== null, "DB: seed-50 archived by the manual action");

    // ── Purge ──
    check(await cdp.clickText("Wyczyść archiwum"), "clicked „🧹 Wyczyść archiwum”");
    let purged = false;
    for (let i = 0; i < 20 && !purged; i++) {
      purged = await cdp.evaluate(`document.body.textContent.includes('📦 Archiwum (0)')`);
      if (!purged) await sleep(500);
    }
    check(purged, "purge empties the archive (badge → „Archiwum (0)”)");
    // Same fire-and-forget race — poll until the delete actually lands.
    let archivedAfterPurge = -1;
    for (let i = 0; i < 20 && archivedAfterPurge !== 0; i++) {
      archivedAfterPurge = await prisma().lyricVersion.count({
        where: { lyricId: lyric.id, archivedAt: { not: null } },
      });
      if (archivedAfterPurge !== 0) await sleep(500);
    }
    check(archivedAfterPurge === 0, "DB: no archived rows left after the purge");
    // 50 seed + 1 UI save = 51 rows created; purge hard-deletes the 2 archived → 49.
    const totalAfter = await prisma().lyricVersion.count({ where: { lyricId: lyric.id } });
    check(totalAfter === MAX - 1, `purge hard-deletes only archived rows (${totalAfter} active remain, expected ${MAX - 1})`);
  } finally {
    // Cascade removes the versions with the track.
    await prisma().lyric.deleteMany({ where: { id: lyric.id } });
  }
}

// ── Cover Art scenario (save → gallery → reload → load-into-editor → delete) ──
// Exercises the DB-primary „Zapisane Okładki” gallery on /cover: save the
// current design (full PNG data URL + settings), verify the row in the DB,
// survive a reload, load a saved cover's settings back into the editor, and
// delete it.
async function scenarioCoverArt(cdp, appUrl) {
  console.log("\n== 13. Cover — save, gallery, load, delete ==");
  const root = new URL(appUrl).origin + "/";

  // Deterministic start: the isolated copy may carry the 2 seeded covers;
  // clear them and the offline mirror so the gallery reads DB-primary.
  await prisma().coverArt.deleteMany({});
  await cdp.goto(root + "/cover", `document.body.textContent.includes('Generator Okładek')`);
  await cdp.evaluate(`localStorage.removeItem('flowforge-covers'); true`);
  await cdp.send("Page.reload");
  await cdp.waitFor(`document.body.textContent.includes('Generator Okładek')`, 30000);
  await sleep(800);

  check(
    await cdp.evaluate(`document.body.textContent.includes('Brak zapisanych okładek')`),
    "empty gallery state with a clean table"
  );
  check(
    await cdp.evaluate(`document.body.textContent.includes('(0)')`),
    "gallery counter shows (0)"
  );

  // ── Save the current design ──
  check(await cdp.setInput(`input[placeholder*='Tytuł']`, "Testowa Okładka"), "typed the cover title");
  check(await cdp.setInput(`input[placeholder*='artysty']`, "E2E MC"), "typed the artist name");
  await sleep(200);
  check(await cdp.clickText("Zapisz Okładkę"), "clicked „💾 Zapisz Okładkę”");
  // The card appears optimistically, but the DB write is a server action
  // (first call compiles in dev mode) — poll until BOTH the card and the
  // row land, and catch the toast while it's still visible.
  let saved = null;
  for (let i = 0; i < 40 && !saved; i++) {
    const row = await prisma().coverArt.findFirst({ where: { title: "Testowa Okładka" } });
    const ui = await cdp.evaluate(`(() => {
      const txt = document.body.textContent;
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('card-hover') && d.textContent.includes('Testowa Okładka'));
      const img = card ? card.querySelector('img') : null;
      return {
        card: !!card,
        artist: card ? card.textContent.includes('E2E MC') : false,
        img: img ? img.src.startsWith('data:image/png') : false,
        toast: txt.includes('Zapisano okładkę'),
      };
    })()`);
    if (row && ui.card) saved = { row, ...ui };
    else await sleep(500);
  }
  check(!!saved && saved.card === true, "saved cover card renders in the gallery");
  check(!!saved && saved.artist === true, "card shows the artist (E2E MC)");
  check(!!saved && saved.img === true, "card thumbnail is a real PNG data URL");
  check(!!saved && saved.toast === true, "toast „💾 Zapisano okładkę” shown");
  check(saved?.row !== null && saved?.row?.artistName === "E2E MC", "cover row written to the DB");
  check(saved?.row?.imageUrl?.startsWith("data:image/png") === true, "DB stores a PNG data URL (downscaled preview)");
  check(saved?.row?.bgPattern === "dark" && saved?.row?.filterStyle === "none" && saved?.row?.fontSize === 48, "DB stores the design settings (defaults)");
  const layout = JSON.parse(saved?.row?.layoutData || "{}");
  check(typeof layout.noiseOpacity === "number" && typeof layout.vignetteOpacity === "number", "layoutData round-trips noise + vignette");

  // ── Reload: the gallery must come back from the DB ──
  await cdp.send("Page.reload");
  await cdp.waitFor(`document.body.textContent.includes('Generator Okładek')`, 30000);
  await sleep(1000);
  check(
    await cdp.evaluate(`document.body.textContent.includes('Testowa Okładka')`),
    "after reload the saved cover is still in the gallery (DB-primary)"
  );

  // ── Wczytaj: load the saved cover's settings back into the editor ──
  await cdp.setInput(`input[placeholder*='Tytuł']`, "Zmieniony tytuł");
  await sleep(200);
  check(
    await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('card-hover') && d.textContent.includes('Testowa Okładka'));
      if (!card) return false;
      const b = [...card.querySelectorAll('button')].find(x => x.textContent.includes('Wczytaj'));
      if (!b) return false;
      b.click();
      return true;
    })()`),
    "clicked „↩️ Wczytaj” on the saved cover"
  );
  await sleep(500);
  check(
    await cdp.evaluate(`document.querySelector('input[placeholder*="Tytuł"]').value === 'Testowa Okładka'`),
    "editor title restored from the saved cover"
  );

  // ── Delete ──
  check(
    await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('card-hover') && d.textContent.includes('Testowa Okładka'));
      if (!card) return false;
      const b = [...card.querySelectorAll('button')].find(x => x.textContent.includes('🗑️'));
      if (!b) return false;
      b.click();
      return true;
    })()`),
    "clicked „🗑️” on the saved cover"
  );
  // The destructive action needs a confirm — first cancel keeps the row.
  await sleep(300);
  check(await cdp.evaluate(`!!document.querySelector('[data-confirm]')`), "delete confirm dialog appears");
  await cdp.evaluate(`document.querySelector('[data-cancel]').click()`);
  await sleep(300);
  check(
    await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('card-hover') && d.textContent.includes('Testowa Okładka'));
      return !!card && !document.querySelector('[data-confirm]');
    })()`),
    "cancelling keeps the cover + closes the dialog"
  );
  check(
    await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('card-hover') && d.textContent.includes('Testowa Okładka'));
      if (!card) return false;
      const b = [...card.querySelectorAll('button')].find(x => x.textContent.includes('🗑️'));
      if (!b) return false;
      b.click();
      return true;
    })()`),
    "clicked „🗑️” again"
  );
  await sleep(300);
  await cdp.evaluate(`document.querySelector('[data-confirm]').click()`);
  let removed = false;
  for (let i = 0; i < 20 && !removed; i++) {
    removed = await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div')].find(d => d.className.includes('card-hover') && d.textContent.includes('Testowa Okładka'));
      return !card;
    })()`);
    if (!removed) await sleep(500);
  }
  check(removed, "card removed from the gallery after delete");
  // The delete write is fire-and-forget — poll the DB row away.
  let gone = false;
  for (let i = 0; i < 20 && !gone; i++) {
    gone = (await prisma().coverArt.count({ where: { title: "Testowa Okładka" } })) === 0;
    if (!gone) await sleep(500);
  }
  check(gone, "cover row deleted from the DB");
}

// ── Profile scenario (edit profile + achievements, DB-primary) ────────
// Seeds a deterministic profile (MC, 240 pkt → poziom 3, 60% bar) plus ONE
// achievement in the isolated DB, verifies the page renders them from the
// DB (level, stats grid, badge card), edits the profile through the UI
// (name/bio/avatar), confirms the row lands in the DB and survives a
// reload, then restores the pre-test state.
async function scenarioProfile(cdp, appUrl) {
  console.log("\n== 14. Profile — edit profile + achievements (DB-primary) ==");
  const root = new URL(appUrl).origin + "/";

  // Deterministic fixture: earlier scenarios may have awarded achievements
  // (scenario 9 removed only its own) — clear all, then seed exactly one +
  // a 240-point profile so level/stats are exact. This is the last scenario,
  // so wiping achievements here cannot disturb anything that runs later.
  await prisma().userAchievement.deleteMany({});
  await prisma().userAchievement.create({
    data: {
      badgeId: "e2e-test-badge",
      badgeName: "Testowy Rycerz",
      badgeIcon: "🏆",
      badgeDescription: "Osiągnięcie testowe E2E",
      points: 50,
      earnedAt: new Date("2026-01-15T12:00:00Z"),
    },
  });
  await prisma().userProfile.upsert({
    where: { id: "default" },
    update: { displayName: "MC", bio: "", avatarEmoji: "🎤", totalPoints: 240, level: 3 },
    create: { id: "default", displayName: "MC", bio: "", avatarEmoji: "🎤", totalPoints: 240, level: 3 },
  });

  await cdp.goto(root + "/profile", `document.body.textContent.includes('Profil Artysty')`);
  // The level bar is DB-backed — wait until the seeded 240 pts land.
  await cdp.waitFor(`document.body.textContent.includes('240 / 300 pkt')`, 30000);

  // ── Rendered from the DB: profile, level, stats, achievement ──
  // The earned date is formatted in-page (toLocaleDateString), so compute
  // the expected value in the same engine to dodge timezone differences.
  const initial = await cdp.evaluate(`(() => {
    const txt = document.body.textContent;
    const stat = (label) => {
      const boxes = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-xl') && d.className.includes('text-center'));
      const box = boxes.find(b => b.textContent.trim().endsWith(label));
      return box ? box.textContent.replace(label, '').replace(/[^0-9]/g, '') : null;
    };
    const expectedDate = new Date('2026-01-15T12:00:00Z').toLocaleDateString('pl-PL');
    return {
      name: txt.includes('MC'),
      bioHint: txt.includes('Kliknij ✏️ aby dodać bio'),
      level: txt.includes('Poziom 3'),
      badge: txt.includes('Testowy Rycerz') && txt.includes('🏆') && txt.includes('+50 pkt'),
      earned: txt.includes('✓ Zdobyto ' + expectedDate),
      points: stat('Punkty'),
      badges: stat('Odznaki'),
    };
  })()`);
  check(initial.name === true, "profile displayName renders from the DB (MC)");
  check(initial.bioHint === true, "empty bio shows the „Kliknij ✏️ aby dodać bio” hint");
  check(initial.level === true, "level bar shows „Poziom 3” from totalPoints=240");
  check(initial.badge === true, "seeded achievement renders (🏆 Testowy Rycerz +50 pkt)");
  check(initial.earned === true, "achievement shows the earned date (15.01.2026)");
  check(initial.points === "240", `„Punkty” stat = 240 (got ${initial.points})`);
  check(initial.badges === "1", `„Odznaki” stat = 1 (got ${initial.badges})`);

  // ── Sidebar profile chip — DB-primary (same source as this page) ──
  // The old footer was hardcoded „MC FlowForge · Poziom 1 • 0 pkt”; now it
  // reads displayName/avatar/level/points from the userProfile row.
  const chipBefore = await cdp.evaluate(`(() => {
    const chip = document.querySelector('[data-profile-chip]');
    return chip ? chip.textContent : null;
  })()`);
  check(
    !!chipBefore && chipBefore.includes("MC") && chipBefore.includes("Poziom 3") && chipBefore.includes("240 pkt") && chipBefore.includes("🎤"),
    `sidebar chip shows the seeded profile (got ${chipBefore})`
  );
  check(!!chipBefore && !chipBefore.includes("MC FlowForge"), "hardcoded „MC FlowForge” is gone");

  // ── Edit the profile through the UI ──
  check(await cdp.clickText("✏️"), "opened the profile editor (✏️)");
  await cdp.waitFor(`!!document.querySelector('input[placeholder*="Nazwa wyświetlana"]')`, 10000);
  check(
    await cdp.setInput(`input[placeholder*='Nazwa wyświetlana']`, "E2E MC"),
    "typed the new display name"
  );
  check(await cdp.setInput(`input[placeholder*='Bio']`, "Testowy bio E2E"), "typed the new bio");
  check(await cdp.clickText("🎧"), "picked the 🎧 avatar emoji");
  check(await cdp.clickText("Zapisz"), "clicked „💾 Zapisz”");

  // The save is a server action (first call compiles in dev mode) — poll
  // until BOTH the DB row and the toast land, and read the UI state while
  // the toast is still visible.
  let saved = null;
  for (let i = 0; i < 40 && !saved; i++) {
    const row = await prisma().userProfile.findUnique({ where: { id: "default" } });
    const ui = await cdp.evaluate(`(() => {
      const txt = document.body.textContent;
      return {
        toast: txt.includes('Zapisano profil'),
        name: txt.includes('E2E MC'),
        bio: txt.includes('Testowy bio E2E'),
        avatar: txt.includes('🎧'),
        formClosed: !document.querySelector('input[placeholder*="Nazwa wyświetlana"]'),
      };
    })()`);
    if (row && row.displayName === "E2E MC" && ui.toast) saved = { row, ...ui };
    else await sleep(500);
  }
  check(!!saved && saved.toast === true, "toast „💾 Zapisano profil” shown");
  check(!!saved && saved.row?.displayName === "E2E MC", "displayName saved to the DB");
  check(!!saved && saved.row?.bio === "Testowy bio E2E", "bio saved to the DB");
  check(!!saved && saved.row?.avatarEmoji === "🎧", "avatar emoji saved to the DB");
  check(!!saved && saved.formClosed === true, "editor closes after a successful save");
  check(!!saved && saved.name === true, "page shows the new display name");
  check(!!saved && saved.bio === true, "page shows the new bio");

  // The sidebar chip must refresh through the „flowforge-profile-updated”
  // event (fired by the save) — no reload involved.
  let chipRefreshed = false;
  for (let i = 0; i < 20 && !chipRefreshed; i++) {
    chipRefreshed = await cdp.evaluate(`(() => {
      const chip = document.querySelector('[data-profile-chip]');
      return chip ? chip.textContent.includes('E2E MC') && chip.textContent.includes('🎧') : false;
    })()`);
    if (!chipRefreshed) await sleep(300);
  }
  check(chipRefreshed === true, "sidebar chip refreshes to „E2E MC • 🎧” right after the save (event)");

  // ── Reload: profile + achievements must come back from the DB ──
  await cdp.send("Page.reload");
  await cdp.waitFor(`document.body.textContent.includes('240 / 300 pkt')`, 30000);
  await sleep(1000);
  const afterReload = await cdp.evaluate(`(() => {
    const txt = document.body.textContent;
    return {
      name: txt.includes('E2E MC'),
      bio: txt.includes('Testowy bio E2E'),
      avatar: txt.includes('🎧'),
      badge: txt.includes('Testowy Rycerz'),
    };
  })()`);
  check(afterReload.name === true, "after reload the display name persists (DB-primary)");
  check(afterReload.bio === true, "after reload the bio persists");
  check(afterReload.avatar === true, "after reload the avatar emoji persists");
  check(afterReload.badge === true, "after reload the achievement still renders");
  const chipAfterReload = await cdp.evaluate(`(() => {
    const chip = document.querySelector('[data-profile-chip]');
    return chip ? chip.textContent : null;
  })()`);
  check(
    !!chipAfterReload && chipAfterReload.includes("E2E MC") && chipAfterReload.includes("🎧"),
    `sidebar chip persists across reload (got ${chipAfterReload})`
  );

  // Cleanup: restore the pre-test state (no profile row + no test badge).
  await prisma().userAchievement.deleteMany({ where: { badgeId: "e2e-test-badge" } });
  await prisma().userProfile.deleteMany({ where: { id: "default" } });
}

// ── Track archive scenario (Lyric.status = "archived") ───────────────
// Seeds two tracks, opens one, archives it via the row button (hidden from
// the working list + „📦 Archiwum (N)” badge + DB status + editor switches
// to the next track), restores it from the archive, then archives + deletes
// it permanently through the confirm dialog, and confirms the state
// survives a reload.
async function scenarioTrackArchive(cdp, appUrl) {
  console.log("\n== 15. Vault — track archive (hide, restore, permanent delete) ==");
  const root = new URL(appUrl).origin + "/";

  // Deterministic fixture: earlier scenarios leave lyric rows behind — wipe
  // them, then seed two active tracks (B newer than A).
  await prisma().lyric.deleteMany({});
  await prisma().lyricVersion.deleteMany({});
  const a = await prisma().lyric.create({
    data: { title: "Utwór A", content: "wers a", lineCount: 1, wordCount: 2, syllableCount: 3, updatedAt: new Date(Date.now() - 60000) },
  });
  const b = await prisma().lyric.create({
    data: { title: "Utwór B", content: "wers b", lineCount: 1, wordCount: 2, syllableCount: 3, updatedAt: new Date(Date.now() - 30000) },
  });

  // In-page helpers.
  const panelText = () =>
    cdp.evaluate(`(() => {
      const h = [...document.querySelectorAll('h3')].find(h => h.textContent.includes('Utwory'));
      const panel = h ? h.closest('div')?.parentElement : null;
      return panel ? panel.textContent : '';
    })()`);
  const clickRowAction = (titleAttr, trackTitle) =>
    cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b =>
        b.getAttribute('title') === ${JSON.stringify(titleAttr)} &&
        b.closest('div')?.textContent.includes(${JSON.stringify(trackTitle)}));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
  const editorState = () =>
    cdp.evaluate(`(() => {
      const title = document.querySelector('input[placeholder="Nazwa utworu..."]');
      const ta = document.querySelector('textarea');
      return { title: title ? title.value : null, content: ta ? ta.value : null };
    })()`);

  await cdp.goto(root + "/vault", `!!document.querySelector('textarea')`);
  await cdp.evaluate(`localStorage.clear(); true`);
  await cdp.send("Page.reload");
  await cdp.waitFor(`document.body.textContent.includes('Utwór A')`, 30000);
  await sleep(800);

  // ── Both tracks render; the archive badge starts at (0) ──
  const p0 = await panelText();
  check(p0.includes("Utwór A") && p0.includes("Utwór B"), "both seeded tracks render in „Utwory”");
  check(
    (await cdp.evaluate(`document.body.textContent.includes('Archiwum (0)')`)) === true,
    "archive badge shows (0)"
  );

  // ── Publish flow: 📤 → status published + isPublic → /feed?shared=<id> ──
  check(await clickRowAction("Publikuj utwór", "Utwór B"), "clicked „📤 Publikuj utwór” on „Utwór B”");
  let pubRow = null;
  for (let i = 0; i < 20 && !pubRow; i++) {
    const row = await prisma().lyric.findUnique({ where: { id: b.id } });
    if (row && row.status === "published" && row.isPublic === true) pubRow = row;
    else await sleep(500);
  }
  check(pubRow !== null, "DB: status flips to \"published\" + isPublic=true");
  await sleep(400);
  const pubBadge = await panelText();
  check(pubBadge.includes("✓ Opublikowany"), "row shows the „✓ Opublikowany” badge");
  check(pubBadge.includes("Utwór A"), "the other track stays in the list (no accidental publish)");

  // The share link (/feed?shared=<id>) renders the published lyric read-only.
  await cdp.goto(root + `/feed?shared=${b.id}`, `document.body.textContent.includes('Opublikowany utwór')`);
  await sleep(500);
  const shared = await cdp.evaluate(`(() => {
    const cards = [...document.querySelectorAll('div')].filter(d => d.className.includes('rounded-2xl'));
    const card = cards.find(c => c.textContent.includes('Opublikowany utwór'));
    return card ? {
      title: card.textContent.includes('Utwór B'),
      content: card.textContent.includes('wers b'),
      stats: card.textContent.includes('1 wersów') && card.textContent.includes('opublikowano'),
      close: [...card.querySelectorAll('button')].some(x => x.textContent.includes('Zamknij')),
    } : null;
  })()`);
  check(shared !== null, "/feed?shared=<id> renders the „Opublikowany utwór” card");
  check(shared.title === true, "shared card shows the track title");
  check(shared.content === true, "shared card shows the lyric content");
  check(shared.stats === true, "shared card shows stats + publish date");
  check(shared.close === true, "shared card has a „✕ Zamknij” button");

  // Back in the Vault: ✓ → Cofnij publikację reverts to draft + private.
  await cdp.goto(root + "/vault", `!!document.querySelector('textarea')`);
  await cdp.waitFor(`document.body.textContent.includes('✓ Opublikowany')`, 30000);
  await sleep(600);
  check(await clickRowAction("Cofnij publikację", "Utwór B"), "clicked „✓ Cofnij publikację” on „Utwór B”");
  let unPubRow = null;
  for (let i = 0; i < 20 && !unPubRow; i++) {
    const row = await prisma().lyric.findUnique({ where: { id: b.id } });
    if (row && row.status === "draft" && row.isPublic === false) unPubRow = row;
    else await sleep(500);
  }
  check(unPubRow !== null, "DB: status back to \"draft\" + isPublic=false");
  await sleep(400);
  const unPubPanel = await panelText();
  check(!unPubPanel.includes("✓ Opublikowany"), "the „✓ Opublikowany” badge disappears after unpublish");

  // ── Open „Utwór A”, then archive it from its row ──
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Utwór A') && b.textContent.includes('wersów'));
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(800);
  let ed = await editorState();
  check(ed.title === "Utwór A" && ed.content === "wers a", "„Utwór A” is open in the editor");

  check(await clickRowAction("Archiwizuj utwór", "Utwór A"), "clicked „📦 Archiwizuj utwór” on „Utwór A”");
  // Optimistic UI + fire-and-forget DB write — poll until BOTH land.
  let archived = null;
  for (let i = 0; i < 30 && !archived; i++) {
    const row = await prisma().lyric.findUnique({ where: { id: a.id } });
    const ui = await panelText();
    const edNow = await editorState();
    if (row?.status === "archived" && !ui.includes("Utwór A")) archived = { row, editor: edNow };
    else await sleep(400);
  }
  check(!!archived, "„Utwór A” disappears from the working list");
  check(!!archived && archived.row?.status === "archived", "DB status flips to \"archived\"");
  check(
    (await cdp.evaluate(`document.body.textContent.includes('Archiwum (1)')`)) === true,
    "archive badge shows (1)"
  );
  check(
    !!archived && archived.editor?.title === "Utwór B" && archived.editor?.content === "wers b",
    "editor switches to the next track („Utwór B”)"
  );

  // ── Archive section: the track is listed with restore/delete actions ──
  check(await cdp.clickText("Archiwum (1)"), "opened the „📦 Archiwum (1)” section");
  await sleep(400);
  check((await panelText()).includes("Utwór A"), "archived track listed in the archive section");
  check(
    await cdp.evaluate(`(() => {
      const h = [...document.querySelectorAll('h3')].find(h => h.textContent.includes('Utwory'));
      const panel = h ? h.closest('div')?.parentElement : null;
      return panel ? [...panel.querySelectorAll('button')].some(b => b.getAttribute('title') === 'Przywróć utwór') : false;
    })()`),
    "archive row has the „↩️ Przywróć” action"
  );

  // ── Restore: out of the archive, back to the working list ──
  check(await clickRowAction("Przywróć utwór", "Utwór A"), "clicked „↩️ Przywróć” on the archived track");
  let restored = false;
  for (let i = 0; i < 30 && !restored; i++) {
    const row = await prisma().lyric.findUnique({ where: { id: a.id } });
    const ui = await panelText();
    // The archive section is still open — the track must have left it.
    if (row?.status === "draft" && !ui.includes("Utwór A")) restored = true;
    else await sleep(400);
  }
  check(restored, "restore removes the track from the archive section");
  check(
    (await prisma().lyric.findUnique({ where: { id: a.id } }))?.status === "draft",
    "DB status restored to \"draft\""
  );
  check(
    (await cdp.evaluate(`document.body.textContent.includes('Archiwum (0)')`)) === true,
    "archive badge drops back to (0)"
  );
  // Close the archive view — the track must be back in the working list.
  check(await cdp.clickText("Archiwum (0)"), "closed the archive section");
  await sleep(400);
  check((await panelText()).includes("Utwór A"), "„Utwór A” is back in the working list");

  // ── Archive again, then delete permanently via the confirm dialog ──
  check(await clickRowAction("Archiwizuj utwór", "Utwór A"), "archived „Utwór A” again");
  await sleep(400);
  check(await cdp.clickText("Archiwum (1)"), "reopened the archive section");
  await sleep(300);
  check(await clickRowAction("Usuń na stałe", "Utwór A"), "clicked „🗑️ Usuń na stałe” on the archived track");
  await sleep(300);
  check(
    await cdp.evaluate(`document.body.textContent.includes('Usunięcie go na stałe')`),
    "confirm dialog explains the permanent delete"
  );
  check(await cdp.clickText("Usuń na stałe"), "confirmed the permanent delete");
  let gone = false;
  for (let i = 0; i < 30 && !gone; i++) {
    gone = (await prisma().lyric.count({ where: { id: a.id } })) === 0;
    if (!gone) await sleep(400);
  }
  check(gone, "row deleted from the DB after the permanent delete");
  check((await panelText()).includes("Archiwum jest puste"), "archive section shows the empty state");

  // ── Reload: the deleted track stays gone; the editor reopens „Utwór B” ──
  await cdp.send("Page.reload");
  await cdp.waitFor(`!!document.querySelector('textarea')`, 30000);
  await cdp.waitFor(
    `document.querySelector('input[placeholder="Nazwa utworu..."]')?.value === 'Utwór B'`,
    30000,
    300,
    "editor reopens Utwór B"
  );
  await sleep(500);
  const after = await cdp.evaluate(`(() => {
    const body = document.body.textContent;
    return {
      gone: !body.includes('Utwór A'),
      badge: body.includes('Archiwum (0)'),
    };
  })()`);
  check(after.gone === true, "after reload „Utwór A” is nowhere (list + editor)");
  check(after.badge === true, "after reload the archive badge shows (0)");

  // Cleanup: remove the remaining track (restore the pre-test empty state).
  await prisma().lyric.deleteMany({});
}

async function scenarioRecordings(cdp, url) {
  console.log("\n== 16. Recordings — durable Studio takes (upload → file+DB → GET → delete) ==");
  const root = new URL(url).origin + "/";
  const recDir = path.join(ROOT, "uploads", "recordings");

  // Self-healing start: sweep leftovers from any crashed previous run.
  const sweep = () => {
    try {
      for (const f of readdirSync(recDir)) {
        if (f.startsWith("e2e-take-")) unlinkSync(path.join(recDir, f));
      }
    } catch {
      /* dir may not exist yet — fine */
    }
  };
  sweep();
  await prisma().recording.deleteMany({ where: { takeId: { startsWith: "e2e-take-" } } });

  await cdp.goto(root + "/studio", `document.body.textContent.includes('Studio')`);
  await sleep(400);

  const takeId = `e2e-take-${Date.now()}`;
  const payload = "fake-webm-opus-bytes-for-e2e";
  try {
    // 1. Upload — raw bytes + x-take-id → API URL.
    const up = await cdp.evaluate(`(async () => {
      const res = await fetch('/api/recordings', {
        method: 'POST',
        headers: { 'x-take-id': '${takeId}', 'content-type': 'audio/webm' },
        body: new Blob(['${payload}'], { type: 'audio/webm' }),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    })()`);
    check(up.status === 200, `upload returns 200 (got ${up.status})`);
    check(up.json && up.json.url === `/api/recordings/${takeId}`, "upload returns the /api/recordings/<takeId> URL");

    // 2. DB row + on-disk file (the suite's Node process shares the project root).
    const row = await prisma().recording.findUnique({ where: { takeId } });
    check(row !== null && row.mimeType === "audio/webm", "Recording row upserted (takeId → file)");
    check(existsSync(path.join(recDir, `${takeId}.webm`)), "audio file written under uploads/recordings/");

    // 3. GET streams the exact bytes back.
    const got = await cdp.evaluate(`(async () => {
      const res = await fetch('/api/recordings/${takeId}');
      const buf = await res.arrayBuffer();
      return { status: res.status, size: buf.byteLength, text: new TextDecoder().decode(buf) };
    })()`);
    check(got.status === 200 && got.text === payload, `GET streams the exact uploaded bytes back (${got.size} B)`);

    // 4. Re-upload the same take — upsert keeps a single row.
    await cdp.evaluate(`(async () => {
      await fetch('/api/recordings', {
        method: 'POST',
        headers: { 'x-take-id': '${takeId}', 'content-type': 'audio/webm' },
        body: new Blob(['${payload}-v2'], { type: 'audio/webm' }),
      });
    })()`);
    await sleep(300);
    const count = await prisma().recording.count({ where: { takeId } });
    check(count === 1, "re-uploading the same take keeps a single row (upsert)");

    // 5. DELETE removes row + file; GET → 404.
    const del = await cdp.evaluate(`(async () => {
      const res = await fetch('/api/recordings', { method: 'DELETE', headers: { 'x-take-id': '${takeId}' } });
      return { status: res.status, json: await res.json().catch(() => null) };
    })()`);
    check(del.status === 200 && del.json && del.json.removed === true, "DELETE removes the recording");
    check((await prisma().recording.findUnique({ where: { takeId } })) === null, "Recording row deleted from the DB");
    check(!existsSync(path.join(recDir, `${takeId}.webm`)), "audio file removed from disk");
    const gone = await cdp.evaluate(`(async () => (await fetch('/api/recordings/${takeId}')).status)()`);
    check(gone === 404, "GET after delete returns 404");

    // 6. Validation — a missing take id is rejected.
    const noHeader = await cdp.evaluate(`(async () =>
      (await fetch('/api/recordings', { method: 'POST', body: new Blob(['x']) })).status
    )()`);
    check(noHeader === 400, "POST without x-take-id is rejected (400)");

    // 7. Deleting a PROJECT („Gotowe Numery” on /beats) prunes the recordings
    // its takes reference — the fix for orphaned .webm files + rows that
    // deleteTake could never reach. Upload two takes, save a project that
    // points at them, delete it through the UI, expect row + file gone.
    const projTakeA = `e2e-take-${Date.now()}-a`;
    const projTakeB = `e2e-take-${Date.now()}-b`;
    await cdp.evaluate(`(async () => {
      await fetch('/api/recordings', { method: 'POST', headers: { 'x-take-id': '${projTakeA}', 'content-type': 'audio/webm' }, body: new Blob(['proj-a'], { type: 'audio/webm' }) });
      await fetch('/api/recordings', { method: 'POST', headers: { 'x-take-id': '${projTakeB}', 'content-type': 'audio/webm' }, body: new Blob(['proj-b'], { type: 'audio/webm' }) });
    })()`);
    await sleep(300);
    check(
      (await prisma().recording.count({ where: { takeId: { in: [projTakeA, projTakeB] } } })) === 2,
      "two recordings exist before the project delete"
    );
    const projRow = await prisma().savedProject.create({
      data: {
        title: "E2E Projekt z nagraniami",
        data: JSON.stringify({
          kind: "project",
          id: "proj-e2e-rec-cleanup",
          title: "E2E Projekt z nagraniami",
          artist: "Studio",
          genre: "rap",
          duration: "2:00",
          beatName: "Bit",
          beatVolume: 0.8,
          teleprompterText: "",
          teleprompterSpeed: 5,
          takes: [
            { id: "t1", label: "Wokal 1", duration: 8, offset: 0, volume: 1, isMuted: false, isSoloed: false, trimStart: 0, trimEnd: 1, audioUrl: `/api/recordings/${projTakeA}` },
            { id: "t2", label: "Wokal 2", duration: 8, offset: 0, volume: 1, isMuted: false, isSoloed: false, trimStart: 0, trimEnd: 1, audioUrl: `/api/recordings/${projTakeB}` },
          ],
          clips: [],
          savedAt: new Date().toISOString(),
        }),
      },
    });
    await cdp.goto(root + "/beats", `document.body.textContent.includes('Gotowe Numery')`);
    await sleep(1200);
    const cardFound = await cdp.evaluate(`(() => {
      const card = [...document.querySelectorAll('div.rounded-2xl')].find(c => c.textContent.includes('E2E Projekt z nagraniami'));
      if (!card) return false;
      const del = [...card.querySelectorAll('button')].find(b => b.textContent.includes('🗑️'));
      if (!del) return false;
      del.click();
      return true;
    })()`);
    check(cardFound, "project card renders on /beats with a delete button");
    // Deleting a project also prunes its takes' recordings — the confirm
    // dialog must be acknowledged (and the warning mentions the recordings).
    await sleep(300);
    check(await cdp.evaluate(`!!document.querySelector('[data-confirm]')`), "delete confirm dialog appears for the project");
    check(
      await cdp.evaluate(`document.body.textContent.includes("Nagrania take'ów")`),
      "dialog warns the takes' recordings will be removed"
    );
    await cdp.evaluate(`document.querySelector('[data-confirm]').click()`);
    await sleep(400);
    // The server action runs async — poll for the row to disappear.
    let projectGone = false;
    for (let i = 0; i < 20 && !projectGone; i++) {
      projectGone = (await prisma().savedProject.findUnique({ where: { id: projRow.id } })) === null;
      if (!projectGone) await sleep(300);
    }
    check(projectGone, "deleteProject removes the project row from the DB");
    check(
      (await prisma().recording.count({ where: { takeId: { in: [projTakeA, projTakeB] } } })) === 0,
      "the project's Recording rows are pruned with it"
    );
    check(
      !existsSync(path.join(recDir, `${projTakeA}.webm`)) && !existsSync(path.join(recDir, `${projTakeB}.webm`)),
      "the takes' audio files are removed from disk"
    );
    const cardGone = await cdp.evaluate(
      `![...document.querySelectorAll('div.rounded-2xl')].some(c => c.textContent.includes('E2E Projekt z nagraniami'))`
    );
    check(cardGone, "project card disappears from the library");
  } finally {
    // Cleanup: row + file for this take (and any e2e leftovers).
    await prisma().savedProject.deleteMany({ where: { title: "E2E Projekt z nagraniami" } }).catch(() => {});
    await prisma().recording.deleteMany({ where: { takeId: { startsWith: "e2e-take-" } } }).catch(() => {});
    sweep();
  }
}

// ── Budget scenario (category + project breakdown charts) ─────────────
// Seeds 3 deterministic expenses (2 projects, 3 categories) directly into
// the isolated DB, then verifies the /budget page renders the summary
// cards (total/count/projects), the „Według Kategorii” chart with
// per-category bar colors + widths, and the „Według Projektów” chart
// (sorted desc, distinct colors by rank). Cleanup removes only the
// seeded rows — the rest of the DB is untouched.
async function scenarioBudget(cdp, appUrl) {
  console.log("\n== 17. Budget — category + project breakdown charts ==");
  const root = new URL(appUrl).origin + "/";

  const fixture = [
    { category: "beat_license", title: "Licencja na bit", amount: 150, project: "EP 2026" },
    { category: "mix_master", title: "Mix", amount: 100, project: "EP 2026" },
    { category: "cover_art", title: "Okładka", amount: 50, project: "Singiel X" },
  ];
  const titles = fixture.map((f) => f.title);
  try {
    // Deterministic start: remove any leftovers, then seed the fixture.
    await prisma().budgetExpense.deleteMany({ where: { title: { in: titles } } });
    for (const f of fixture) {
      await prisma().budgetExpense.create({
        data: { ...f, currency: "PLN", date: new Date() },
      });
    }

    await cdp.goto(root + "/budget", `document.body.textContent.includes('Budżet Projektu')`);
    await sleep(1200); // server action round-trip + re-render

    // Summary cards: total / count / projects.
    const cards = await cdp.evaluate(`(() => {
      const grid = [...document.querySelectorAll('div.grid')].find(g => g.textContent.includes('Łączne wydatki'));
      return grid ? grid.textContent : '';
    })()`);
    check(cards.includes("Łączne wydatki") && cards.includes("300"), "summary card: total 300 PLN across all expenses");
    check(cards.includes("Wydatków") && cards.includes("3"), "summary card: 3 expenses");
    check(cards.includes("Projektów") && cards.includes("2"), "summary card: 2 projects");

    // Both charts: labels, totals, bar colors and widths.
    const charts = await cdp.evaluate(`(() => {
      const grab = (headingText) => {
        const h = [...document.querySelectorAll('h3')].find(x => x.textContent.includes(headingText));
        if (!h) return null;
        const wrap = h.closest('div');
        const bars = [...wrap.querySelectorAll('div[class*="h-full"]')].map(b => {
          const style = b.getAttribute('style') || '';
          return {
            color: (b.className.match(/bg-[a-z]+-[0-9]+/) || [])[0] || null,
            width: parseFloat((style.match(/width: ([0-9.]+)%/) || [])[1] || "0"),
          };
        });
        return { text: wrap.textContent, bars };
      };
      return { cat: grab('Według Kategorii'), proj: grab('Według Projektów') };
    })()`);

    // Category chart: 3 bars, per-category colors, widths proportional.
    check(!!charts.cat && charts.cat.bars.length === 3, "„Według Kategorii” renders 3 bars (beat/mix/cover)");
    check(
      charts.cat.text.includes("Licencja na bit") && charts.cat.text.includes("Mix/Mastering") && charts.cat.text.includes("Okładka"),
      "category chart labels all three categories"
    );
    check(
      charts.cat.bars[0].color === "bg-amber-500" && charts.cat.bars[1].color === "bg-blue-500" && charts.cat.bars[2].color === "bg-pink-500",
      `category bars use per-category colors (got ${charts.cat.bars.map((b) => b.color).join(", ")})`
    );
    check(
      Math.abs(charts.cat.bars[0].width - 50) < 1 && Math.abs(charts.cat.bars[1].width - 33.33) < 1 && Math.abs(charts.cat.bars[2].width - 16.67) < 1,
      `category bar widths proportional to totals (got ${charts.cat.bars.map((b) => b.width).join(", ")})`
    );

    // Project chart: 2 bars, largest first, distinct colors.
    check(!!charts.proj && charts.proj.bars.length === 2, "„Według Projektów” renders 2 bars (EP 2026 + Singiel X)");
    check(
      charts.proj.text.indexOf("EP 2026") < charts.proj.text.indexOf("Singiel X"),
      "projects sorted by total, largest first (EP 2026 250 PLN before Singiel X 50 PLN)"
    );
    check(
      charts.proj.text.includes("250") && charts.proj.text.includes("50"),
      "project chart shows per-project totals (250 + 50 PLN)"
    );
    check(
      charts.proj.bars[0].color === "bg-emerald-500" && charts.proj.bars[1].color === "bg-violet-500",
      `project bars use distinct colors by rank (got ${charts.proj.bars.map((b) => b.color).join(", ")})`
    );
  } finally {
    // Cleanup: remove only the seeded rows.
    await prisma().budgetExpense.deleteMany({ where: { title: { in: titles } } });
  }
}

// ── Stem mixer scenario (per-channel mute on /beats) ──────────────────
// Upserts a stems beat (isStems + stemsData → the real generated files)
// into the isolated DB, stubs HTMLMediaElement so playback is deterministic
// in headless Chrome, then verifies the mixer UI: 4 channels render, ▶
// starts all four audios in sync, muting a channel drops its volume to 0
// (🔇 + line-through) and back to 1, and ⏸ pauses everything.
async function scenarioStemMixer(cdp, appUrl) {
  console.log("\n== 18. Beats — stem mixer (per-channel mute) ==");
  const root = new URL(appUrl).origin + "/";

  const fixture = {
    id: "e2e-stems-beat",
    title: "E2E Stem Mix",
    artist: "FlowForge",
    bpm: 92,
    key: "Dm",
    genre: "Boom Bap",
    duration: 8,
    filePath: "/test-beat-a.wav",
    isStems: true,
    stemsData: JSON.stringify({
      drums: "/stems/miejski-rytm-drums.wav",
      bass: "/stems/miejski-rytm-bass.wav",
      melody: "/stems/miejski-rytm-melody.wav",
      vocals: "/stems/miejski-rytm-vocals.wav",
    }),
  };
  try {
    const { id, ...rest } = fixture;
    await prisma().beat.upsert({ where: { id }, update: { ...rest }, create: { ...fixture } });

    await cdp.goto(root + "/beats", `document.body.textContent.includes('Gotowe Numery')`);
    await sleep(1200); // server action round-trip + re-render

    // Deterministic playback: collect Audio instances + count play/pause.
    await cdp.evaluate(`(() => {
      window.__audios = [];
      window.__plays = [];
      window.__pauses = [];
      const OrigAudio = window.Audio;
      window.Audio = class extends OrigAudio {
        constructor(src) { super(src); window.__audios.push(this); }
      };
      HTMLMediaElement.prototype.play = function () { window.__plays.push(this.src); return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () { window.__pauses.push(this.src); };
      return true;
    })()`);

    const card = await cdp.evaluate(`(() => {
      const mixer = document.querySelector('[data-stem-mixer="e2e-stems-beat"]');
      if (!mixer) return null;
      const cardEl = mixer.closest('div.rounded-2xl');
      return {
        found: true,
        text: cardEl.textContent,
        channels: [...mixer.querySelectorAll('[data-stem-channel]')].map(b => b.textContent),
        hasPlay: [...cardEl.querySelectorAll('button')].some(b => b.textContent.includes('▶')),
      };
    })()`);
    check(!!card && card.found, "stems beat card renders with the mixer");
    check(card.text.includes("🎛️ Stemy"), "„🎛️ Stemy” chip shown on the stems beat");
    check(card.channels.length === 4, `mixer renders 4 channels (got ${card.channels.length})`);
    check(
      card.channels.join(" ").includes("Drums") &&
        card.channels.join(" ").includes("Bass") &&
        card.channels.join(" ").includes("Melody") &&
        card.channels.join(" ").includes("Wokal"),
      "channel labels: Drums / Bass / Melody / Wokal"
    );
    check(card.hasPlay === true, "play button present on the stems beat");

    // Equalizer bars must be DETERMINISTIC — the old Math.random() recomputed
    // heights on every render, so they jumped on any state change. Capture
    // the heights now and again after the play toggle: they must be identical.
    const barsBefore = await cdp.evaluate(`(() => {
      const mixer = document.querySelector('[data-stem-mixer="e2e-stems-beat"]');
      const cardEl = mixer.closest('div.rounded-2xl');
      return [...cardEl.querySelectorAll('[class*="w-1.5"]')].map(el => parseFloat(el.style.height) || 0);
    })()`);
    check(barsBefore.length === 20 && barsBefore.every((h) => h > 0), `equalizer renders 20 bars with heights (got ${barsBefore.length})`);

    // ── Play: all four channels start in sync ──
    check(
      await cdp.evaluate(`(() => {
        const mixer = document.querySelector('[data-stem-mixer="e2e-stems-beat"]');
        const cardEl = mixer.closest('div.rounded-2xl');
        const btn = [...cardEl.querySelectorAll('button')].find(b => b.textContent.includes('▶'));
        if (!btn) return false;
        btn.click();
        return true;
      })()`),
      "clicked ▶ on the stems beat"
    );
    await sleep(300);
    const barsAfter = await cdp.evaluate(`(() => {
      const mixer = document.querySelector('[data-stem-mixer="e2e-stems-beat"]');
      const cardEl = mixer.closest('div.rounded-2xl');
      return [...cardEl.querySelectorAll('[class*="w-1.5"]')].map(el => parseFloat(el.style.height) || 0);
    })()`);
    check(
      JSON.stringify(barsBefore) === JSON.stringify(barsAfter),
      "bar heights are stable across the play toggle (no Math.random jumps)"
    );
    const playInfo = await cdp.evaluate(`(() => {
      const srcs = window.__plays;
      const audios = window.__audios;
      return {
        playCount: srcs.length,
        channels: ["drums", "bass", "melody", "vocals"].map(c => audios.some(a => a.src.includes(c))),
        volumes: ["drums", "bass", "melody", "vocals"].map(c => {
          const a = audios.find(x => x.src.includes(c));
          return a ? a.volume : null;
        }),
      };
    })()`);
    check(playInfo.playCount === 4, `play started all 4 stem audios (got ${playInfo.playCount})`);
    check(playInfo.channels.every(Boolean), "one audio per channel (drums/bass/melody/vocals)");
    check(playInfo.volumes.every((v) => v === 1), "all channels start at volume 1");

    // ── Mute drums: volume 0 + visual feedback ──
    check(
      await cdp.evaluate(`(() => {
        const btn = document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-channel="drums"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()`),
      "clicked the drums channel (mute)"
    );
    await sleep(200);
    const muted = await cdp.evaluate(`(() => {
      const btn = document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-channel="drums"]');
      const a = window.__audios.find(x => x.src.includes('drums'));
      const label = btn.querySelector('span:nth-child(2)');
      const bass = window.__audios.find(x => x.src.includes('bass'));
      return {
        volume: a ? a.volume : null,
        icon: btn.textContent.includes('🔇'),
        strike: label ? label.classList.contains('line-through') : false,
        bassVolume: bass ? bass.volume : null,
      };
    })()`);
    check(muted.volume === 0, "drums audio volume dropped to 0 (muted)");
    check(muted.icon === true, "drums channel shows 🔇");
    check(muted.strike === true, "drums label gets the line-through style");
    check(muted.bassVolume === 1, "other channels keep volume 1");

    // ── Unmute drums: volume back to 1 ──
    await cdp.evaluate(`document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-channel="drums"]').click()`);
    await sleep(200);
    const unmuted = await cdp.evaluate(`(() => {
      const btn = document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-channel="drums"]');
      const a = window.__audios.find(x => x.src.includes('drums'));
      return { volume: a ? a.volume : null, icon: btn.textContent.includes('🔊') };
    })()`);
    check(unmuted.volume === 1, "drums volume restored to 1 (unmuted)");
    check(unmuted.icon === true, "drums channel shows 🔊 again");

    // ── Solo drums: only drums audible, the rest drop to 0 ──
    check(
      await cdp.evaluate(`(() => {
        const btn = document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-solo="drums"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()`),
      "clicked the drums solo button"
    );
    await sleep(200);
    const soloDrums = await cdp.evaluate(`(() => {
      const audios = window.__audios;
      const vol = (c) => { const a = audios.find(x => x.src.includes(c)); return a ? a.volume : null; };
      const soloBtn = document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-solo="drums"]');
      const bassBtn = document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-channel="bass"]');
      return {
        drums: vol('drums'),
        bass: vol('bass'),
        melody: vol('melody'),
        vocals: vol('vocals'),
        soloActive: soloBtn.getAttribute('data-stem-solo-active') === 'true',
        bassShowsMuted: bassBtn.textContent.includes('🔇'),
        clearVisible: !!document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-solo-clear]'),
      };
    })()`);
    check(soloDrums.drums === 1, "soloed drums stays at volume 1");
    check(
      soloDrums.bass === 0 && soloDrums.melody === 0 && soloDrums.vocals === 0,
      "solo silences the other three channels (volume 0)"
    );
    check(soloDrums.soloActive === true, "drums solo button shows the active state");
    check(soloDrums.bassShowsMuted === true, "non-soloed channels show 🔇");
    check(soloDrums.clearVisible === true, "„✕ Wyłącz solo” chip appears while solo is active");

    // ── Solo another channel: solo switches to it ──
    await cdp.evaluate(`document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-solo="bass"]').click()`);
    await sleep(200);
    const soloSwitch = await cdp.evaluate(`(() => {
      const audios = window.__audios;
      const vol = (c) => { const a = audios.find(x => x.src.includes(c)); return a ? a.volume : null; };
      const drumsBtn = document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-solo="drums"]');
      const bassBtn = document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-solo="bass"]');
      return {
        drums: vol('drums'),
        bass: vol('bass'),
        drumsSoloed: drumsBtn.getAttribute('data-stem-solo-active') === 'true',
        bassSoloed: bassBtn.getAttribute('data-stem-solo-active') === 'true',
      };
    })()`);
    check(soloSwitch.bass === 1 && soloSwitch.drums === 0, "solo switches to the newly clicked channel");
    check(
      soloSwitch.bassSoloed === true && soloSwitch.drumsSoloed === false,
      "solo button active state follows the switch"
    );

    // ── Clear solo: every channel back to its explicit mute state (all 1) ──
    check(
      await cdp.evaluate(`(() => {
        const btn = document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-solo-clear]');
        if (!btn) return false;
        btn.click();
        return true;
      })()`),
      "clicked „✕ Wyłącz solo”"
    );
    await sleep(200);
    const soloCleared = await cdp.evaluate(`(() => {
      const audios = window.__audios;
      const vol = (c) => { const a = audios.find(x => x.src.includes(c)); return a ? a.volume : null; };
      return {
        drums: vol('drums'),
        bass: vol('bass'),
        melody: vol('melody'),
        vocals: vol('vocals'),
        clearGone: !document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-solo-clear]'),
      };
    })()`);
    check(
      soloCleared.drums === 1 && soloCleared.bass === 1 && soloCleared.melody === 1 && soloCleared.vocals === 1,
      "„Wyłącz solo” restores all channels to volume 1"
    );
    check(soloCleared.clearGone === true, "„✕ Wyłącz solo” chip disappears");

    // ── Stop: all channels pause, UI back to ▶ ──
    check(
      await cdp.evaluate(`(() => {
        const mixer = document.querySelector('[data-stem-mixer="e2e-stems-beat"]');
        const cardEl = mixer.closest('div.rounded-2xl');
        const btn = [...cardEl.querySelectorAll('button')].find(b => b.textContent.includes('⏸'));
        if (!btn) return false;
        btn.click();
        return true;
      })()`),
      "clicked ⏸ on the stems beat"
    );
    await sleep(300);
    const stopped = await cdp.evaluate(`(() => {
      const mixer = document.querySelector('[data-stem-mixer="e2e-stems-beat"]');
      const cardEl = mixer.closest('div.rounded-2xl');
      const btn = [...cardEl.querySelectorAll('button')].find(b => b.textContent.includes('▶'));
      const stemPauses = window.__pauses.filter(s => s.includes('/stems/'));
      return { backToPlay: !!btn, stemPauses: stemPauses.length };
    })()`);
    check(stopped.backToPlay === true, "play button back to ▶ after stop");
    check(stopped.stemPauses === 4, `stop paused all 4 stem audios (got ${stopped.stemPauses})`);

    // ── Export mix: record the current mute/solo settings to one file ──
    // Stub the Web Audio graph + MediaRecorder (headless = no audio device):
    // the component must build 4 gains honoring mute/solo, feed the recorder
    // from the mixed destination stream, and download a real blob on stop.
    await cdp.evaluate(`(() => {
      window.__rec = { gains: [], instances: 0, stops: 0, started: false, resumed: false, closed: false, blobs: [], anchors: [] };
      const rec = window.__rec;
      window.AudioContext = class {
        constructor() { rec.ctxCreated = true; }
        suspend() { return Promise.resolve(); }
        resume() { rec.resumed = true; return Promise.resolve(); }
        close() { rec.closed = true; return Promise.resolve(); }
        createMediaStreamDestination() { return { stream: { __mix: true } }; }
        createGain() { const g = { gain: { value: 1 }, connect() {} }; rec.gains.push(g); return g; }
        createMediaElementSource() { return { connect() {} }; }
      };
      window.MediaRecorder = class {
        static isTypeSupported() { return true; }
        constructor(stream, opts) {
          rec.streamFake = stream.__mix === true;
          rec.mime = opts ? opts.mimeType : null;
          rec.instances += 1;
        }
        start() { rec.started = true; }
        stop() {
          rec.stops += 1;
          if (this.ondataavailable) this.ondataavailable({ data: new Blob([new Uint8Array(128)], { type: "audio/webm" }) });
          if (this.onstop) this.onstop();
        }
      };
      const origCreate = URL.createObjectURL.bind(URL);
      window.URL.createObjectURL = (blob) => { rec.blobs.push({ type: blob.type, size: blob.size }); return "blob:fake-mix"; };
      window.URL.revokeObjectURL = () => {};
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) rec.anchors.push(this.download);
        return origClick.call(this);
      };
      return true;
    })()`);
    // Solo bass first — the recorded gains must reflect the mixer state.
    await cdp.evaluate(`document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-solo="bass"]').click()`);
    await sleep(150);
    check(
      await cdp.evaluate(`(() => {
        const btn = document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-record]');
        if (!btn) return false;
        btn.click();
        return true;
      })()`),
      "clicked „🎙️ Nagraj miks”"
    );
    await sleep(250);
    const recState = await cdp.evaluate(`(() => {
      const mixer = document.querySelector('[data-stem-mixer="e2e-stems-beat"]');
      const playBtn = [...mixer.closest('div.rounded-2xl').querySelectorAll('button')].find(b => b.textContent.includes('▶'));
      return {
        rec: window.__rec,
        stopShown: !!mixer.querySelector('[data-stem-record-stop]'),
        timer: mixer.querySelector('[data-stem-record-timer]')?.textContent ?? null,
        playDisabled: playBtn ? playBtn.disabled === true : null,
      };
    })()`);
    check(recState.rec.instances === 1, "MediaRecorder constructed once for the mix");
    check(recState.rec.started === true && recState.rec.resumed === true, "recorder started + AudioContext resumed");
    check(recState.rec.streamFake === true, "recorder feeds from the mixed destination stream");
    check(recState.rec.gains.length === 4, `one gain node per channel (got ${recState.rec.gains.length})`);
    const gains = recState.rec.gains.map((g) => g.gain.value);
    check(
      gains[1] === 1 && gains[0] === 0 && gains[2] === 0 && gains[3] === 0,
      "gain per channel matches the solo state (only bass audible)"
    );
    check(recState.stopShown === true, "„⏹ Zatrzymaj i pobierz” replaces the record button while recording");
    check(recState.playDisabled === true, "play button disabled while recording");
    check(recState.timer !== null && /^\d+s$/.test(recState.timer), "recording timer chip rendered");

    // Stop → download the mix with a title-derived filename, UI back to start.
    await cdp.evaluate(`document.querySelector('[data-stem-mixer="e2e-stems-beat"] [data-stem-record-stop]').click()`);
    await sleep(250);
    const recDone = await cdp.evaluate(`(() => {
      const mixer = document.querySelector('[data-stem-mixer="e2e-stems-beat"]');
      return {
        rec: window.__rec,
        recordBtnBack: !!mixer.querySelector('[data-stem-record]'),
        stopGone: !mixer.querySelector('[data-stem-record-stop]'),
      };
    })()`);
    check(recDone.rec.stops === 1, "recorder.stop() called exactly once");
    check(recDone.rec.blobs.length === 1, "a mix blob was created for download");
    check(
      recDone.rec.blobs[0] &&
        recDone.rec.blobs[0].type === "audio/webm" &&
        recDone.rec.blobs[0].size === 128,
      "downloaded blob is the recorded webm (non-empty)"
    );
    check(
      recDone.rec.anchors.length === 1 && recDone.rec.anchors[0] === "miks-e2e-stem-mix.webm",
      `download filename derived from the beat title (got ${recDone.rec.anchors[0] ?? "none"})`
    );
    check(recDone.recordBtnBack === true && recDone.stopGone === true, "UI back to „🎙️ Nagraj miks” after stop");
    check(recDone.rec.closed === true, "AudioContext closed after the recording");
  } finally {
    await prisma().beat.deleteMany({ where: { id: fixture.id } });
  }
}

// ── PWA scenario (manifest, icons, service worker offline) ────────────
// Verifies installability prerequisites (manifest with 192+512 icons that
// really decode as PNG) and the offline story: the service worker registers,
// activates and controls the page, and after CDP cuts the network a reload
// still renders the app shell from cache (sidebar „FlowForge” brand). The
// client-side localStorage mirrors then do the rest — the whole point of
// the DB-primary + mirror architecture.
async function scenarioPwa(cdp, appUrl) {
  console.log("\n== 19. PWA — manifest, icons, service worker offline ==");
  const root = new URL(appUrl).origin + "/";

  // ── 1. Manifest + icons: the installability prerequisites ──
  const manifest = await (await fetch(root + "manifest.json")).json();
  check(!!manifest.name && manifest.name.includes("FlowForge"), "manifest served with the app name");
  check(
    manifest.icons.some((i) => i.sizes === "192x192") && manifest.icons.some((i) => i.sizes === "512x512"),
    "manifest declares 192 + 512 icons (installable)"
  );
  const icon192 = await fetch(root + "icon-192.png");
  const icon512 = await fetch(root + "icon-512.png");
  check(icon192.status === 200 && (icon192.headers.get("content-type") || "").includes("image/png"), "icon-192.png served as PNG");
  check(icon512.status === 200 && (icon512.headers.get("content-type") || "").includes("image/png"), "icon-512.png served as PNG");
  check((await icon192.arrayBuffer()).byteLength > 3000, "icon-192.png is a real image (not an empty stub)");

  await cdp.goto(root + "/vault", `document.body.textContent.includes('The Vault') || document.body.textContent.includes('FlowForge')`);
  await sleep(500);

  // Icons must also DECODE as PNG in the browser (manifest parse-proof).
  const decodes = await cdp.evaluate(`(async () => {
    const ok = async (path) => {
      try {
        const blob = await (await fetch(path)).blob();
        const bmp = await createImageBitmap(blob);
        return bmp.width > 0;
      } catch { return false; }
    };
    return { i192: await ok('/icon-192.png'), i512: await ok('/icon-512.png') };
  })()`);
  check(decodes.i192 === true && decodes.i512 === true, "both icons decode as PNG images in the browser");

  // ── 2. Service worker registers, activates, controls the page ──
  const reg = await cdp.evaluate(`(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready; // resolves once active
    return {
      supported: true,
      scope: registration.scope,
      active: !!registration.active,
    };
  })()`);
  check(reg.supported === true, "serviceWorker API available in the browser");
  check(reg.active === true, "service worker registered and activated");

  // A reload under the active SW: every fetch (HTML + chunks) now goes
  // through the worker and lands in its caches.
  await cdp.send("Page.reload");
  await cdp.waitFor(`document.body.textContent.includes('FlowForge')`, 30000);
  await sleep(800);
  check(
    (await cdp.evaluate(`!!navigator.serviceWorker.controller`)) === true,
    "page is controlled by the service worker after reload"
  );

  // ── 3. Offline: reload must render the app shell from cache ──
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await cdp.send("Page.reload");
  let offlineLoaded = false;
  try {
    await cdp.waitFor(
      `document.body.textContent.includes('FlowForge') && !!document.querySelector('aside, nav')`,
      30000
    );
    offlineLoaded = true;
  } catch {
    /* timed out — nothing rendered offline */
  }
  check(offlineLoaded, "offline reload renders the app shell from the service worker cache");

  // Restore connectivity and confirm the page works normally again.
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await cdp.send("Page.reload");
  await cdp.waitFor(`document.body.textContent.includes('FlowForge')`, 30000);
  await sleep(500);
  check(
    await cdp.evaluate(`document.body.textContent.includes('The Vault') || document.body.textContent.includes('FlowForge')`),
    "page loads normally once back online"
  );
}

// ── Sweep scenario (orphaned recordings cleanup script) ──────────────
// Exercises `npm run sweep:recordings` against the isolated DB copy with
// three fixtures: an orphaned FILE with no Recording row, a BROKEN row whose
// file is missing from disk, and a healthy row+file pair that must survive.
// Verifies --dry-run reports but deletes nothing, then the real run removes
// exactly the orphans. Files live in the real uploads/recordings/ (like
// scenario 16) and are swept in the finally block.
async function scenarioSweepRecordings(cdp, appUrl) {
  console.log("\n== 20. sweep:recordings — orphaned file/row cleanup ==");
  const recDir = path.join(ROOT, "uploads", "recordings");
  const sweepScript = path.join(ROOT, "scripts", "sweep-recordings.mjs");
  const orphanFile = "e2e-sweep-orphan.webm";
  const brokenTake = "e2e-sweep-broken";
  const keepTake = "e2e-sweep-keep";

  // Self-healing start: clear leftovers from any crashed previous run.
  const sweepFiles = () => {
    try {
      for (const f of readdirSync(recDir)) {
        if (f.startsWith("e2e-sweep-")) unlinkSync(path.join(recDir, f));
      }
    } catch {
      /* dir may not exist yet — fine */
    }
  };
  sweepFiles();
  await prisma().recording.deleteMany({ where: { takeId: { startsWith: "e2e-sweep-" } } });

  // Run the real script in a child process — it inherits DATABASE_URL from
  // the suite, so it operates on the isolated copy, never prisma/dev.db.
  const runSweep = (dryRun) => {
    const r = spawnSync(process.execPath, [sweepScript, ...(dryRun ? ["--dry-run"] : [])], {
      cwd: ROOT,
      env: process.env,
      encoding: "utf8",
      timeout: 60000,
    });
    return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };

  try {
    // Three fixtures: orphan file (no row), broken row (no file), healthy pair.
    writeFileSync(path.join(recDir, orphanFile), "orphan-bytes");
    await prisma().recording.create({
      data: { takeId: brokenTake, fileName: `${brokenTake}.webm`, mimeType: "audio/webm", size: 5 },
    });
    writeFileSync(path.join(recDir, `${keepTake}.webm`), "keep-bytes");
    await prisma().recording.create({
      data: { takeId: keepTake, fileName: `${keepTake}.webm`, mimeType: "audio/webm", size: 9 },
    });

    // ── Dry run: reports both orphans, deletes nothing ──
    const dry = runSweep(true);
    check(dry.status === 0, "sweep --dry-run exits 0");
    check(
      dry.out.includes(orphanFile) && dry.out.includes(brokenTake) && dry.out.includes("DRY-RUN"),
      "dry-run reports the orphaned file + broken row (and marks DRY-RUN)"
    );
    check(existsSync(path.join(recDir, orphanFile)), "dry-run keeps the orphaned file");
    check(
      (await prisma().recording.findUnique({ where: { takeId: brokenTake } })) !== null,
      "dry-run keeps the broken row"
    );

    // ── Real run: orphans gone, healthy pair untouched ──
    const real = runSweep(false);
    check(real.status === 0, "sweep exits 0");
    check(!existsSync(path.join(recDir, orphanFile)), "orphaned file removed from disk");
    check(
      (await prisma().recording.findUnique({ where: { takeId: brokenTake } })) === null,
      "broken row removed from the DB"
    );
    check(
      existsSync(path.join(recDir, `${keepTake}.webm`)) &&
        (await prisma().recording.findUnique({ where: { takeId: keepTake } })) !== null,
      "healthy row+file pair survives the sweep"
    );
  } finally {
    await prisma().recording.deleteMany({ where: { takeId: { startsWith: "e2e-sweep-" } } }).catch(() => {});
    sweepFiles();
  }
}

// ── Install-prompt scenario (sidebar PWA button) ─────────────────────
// The sidebar „⬇️ Zainstaluj aplikację” button must appear only after the
// browser offers the install (beforeinstallprompt) and hide once installed.
// The synthetic event carries a stubbed prompt()/userChoice — the exact
// contract the button uses.
async function scenarioInstallPrompt(cdp, appUrl) {
  console.log("\n== 21. Install prompt — sidebar „Zainstaluj aplikację” ==");
  const root = new URL(appUrl).origin + "/";

  // Headless Chrome CAN fire a real beforeinstallprompt once the app is
  // installable (manifest + icons + SW from the PWA scenario) — that would
  // pre-populate the button before we dispatch our synthetic event. Block the
  // real one at the document level (first-registered listener on window wins
  // at-target dispatch order) so the sidebar only ever sees OUR event.
  // Test-dispatched events are tagged __testInstall and pass through; the
  // blocker only swallows the REAL browser event.
  const blocker = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      window.addEventListener('beforeinstallprompt', (e) => {
        if (e.__testInstall) return;
        window.__realBeforeInstallFired = true;
        e.stopImmediatePropagation();
      }, true);
    })();`,
  });

  await cdp.goto(root + "/vault", `document.body.textContent.includes('The Vault')`);
  await sleep(400);

  // 1. Default: no button until the browser offers the install.
  check(
    (await cdp.evaluate(`!!document.querySelector('[data-install-app]')`)) === false,
    "install button hidden before beforeinstallprompt fires"
  );

  // 2. Dispatch the prompt event (accepted outcome) → button appears.
  await cdp.evaluate(`(() => {
    window.__installPrompted = 0;
    const ev = new Event('beforeinstallprompt', { cancelable: true });
    ev.__testInstall = true;
    Object.assign(ev, {
      prompt: () => { window.__installPrompted += 1; return Promise.resolve(); },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    window.dispatchEvent(ev);
    return true;
  })()`);
  await cdp.waitFor(`!!document.querySelector('[data-install-app]')`, 10000, 150, "install button visible");
  const shown = await cdp.evaluate(`(() => {
    const btn = document.querySelector('[data-install-app]');
    return { text: btn ? btn.textContent : null, inFooter: !!btn && !!btn.closest('aside') };
  })()`);
  check(shown.text && shown.text.includes("Zainstaluj aplikację"), "button „⬇️ Zainstaluj aplikację” rendered in the sidebar");
  check(shown.inFooter === true, "button lives inside the sidebar footer");

  // 3. Click → real prompt() invoked, accepted → button disappears.
  check(await cdp.evaluate(`(() => { document.querySelector('[data-install-app]').click(); return true; })()`), "clicked the install button");
  await cdp.waitFor(`!document.querySelector('[data-install-app]')`, 10000, 150, "button hides after accepted install");
  check(
    (await cdp.evaluate(`window.__installPrompted`)) === 1,
    "prompt() invoked exactly once on the stored beforeinstallprompt event"
  );

  // 4. Dismissed outcome → button STAYS (user can retry).
  await cdp.evaluate(`(() => {
    const ev = new Event('beforeinstallprompt', { cancelable: true });
    ev.__testInstall = true;
    Object.assign(ev, {
      prompt: () => { window.__installPrompted += 1; return Promise.resolve(); },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(ev);
    return true;
  })()`);
  await cdp.waitFor(`!!document.querySelector('[data-install-app]')`, 10000, 150, "button reappears for the retry");
  await cdp.evaluate(`document.querySelector('[data-install-app]').click()`);
  await sleep(400);
  check(
    (await cdp.evaluate(`window.__installPrompted`)) === 2 &&
      (await cdp.evaluate(`!!document.querySelector('[data-install-app]')`)) === true,
    "dismissed install keeps the button (prompt called again)"
  );

  // 5. appinstalled hides the button permanently (already-running PWA case).
  await cdp.evaluate(`window.dispatchEvent(new Event('appinstalled')); true`);
  await cdp.waitFor(`!document.querySelector('[data-install-app]')`, 10000, 150, "button hides after appinstalled");
  check(
    (await cdp.evaluate(`!!document.querySelector('[data-install-app]')`)) === false,
    "appinstalled event removes the install button"
  );

  // Remove the document-level blocker — later navigations are unaffected.
  await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: blocker.identifier,
  }).catch(() => {});
}

// ── Stem-upload scenario (4-channel form in the „Dodaj Numer” modal) ──
// Uploads a REAL stem pack through the modal (drums/bass/melody/vocals) via
// DOM.setFileInputFiles, then verifies the card + mixer render and the DB row
// carries isStems + stemsData with 4 audio data URLs. Finally checks the
// single-beat tab still works. Cleanup removes only the created rows.
async function scenarioStemUpload(cdp, appUrl) {
  console.log("\n== 22. Beats — stem upload („Dodaj Numer” modal) ==");
  const root = new URL(appUrl).origin + "/";
  const stemsDir = path.join(ROOT, "public", "stems");

  // Deterministic start: remove any leftovers from a previous crash.
  await prisma().beat.deleteMany({ where: { OR: [{ title: { endsWith: "(Stemy)" } }, { title: "test-beat-a" }] } });

  try {
    await cdp.goto(root + "/beats", `document.body.textContent.includes('Gotowe Numery')`);
    await sleep(1200);

    // ── Open the modal → switch to the stems tab ──
    check(await cdp.clickText("Dodaj Numer"), "„+ Dodaj Numer” opens the upload modal");
    await cdp.waitFor(`!!document.querySelector('[data-upload-modal]')`, 10000, 150, "upload modal visible");
    await sleep(300);
    check(
      await cdp.evaluate(`(() => {
        const tab = document.querySelector('[data-upload-mode="stems"]');
        if (!tab) return false;
        tab.click();
        return true;
      })()`),
      "switched to the „🎛️ Stemy” tab"
    );
    await sleep(300);
    const inputs = await cdp.evaluate(`(() => {
      const modal = document.querySelector('[data-upload-modal]');
      const chans = ["drums", "bass", "melody", "vocals"];
      return {
        count: chans.filter((c) => modal.querySelector('[data-stem-upload="' + c + '"]')).length,
        labels: [...modal.querySelectorAll('label span.text-xs')].map((s) => s.textContent),
      };
    })()`);
    check(inputs.count === 4, "stems tab renders 4 file inputs (drums/bass/melody/vocals)");
    check(
      inputs.labels.join(" ").includes("Drums") &&
        inputs.labels.join(" ").includes("Bass") &&
        inputs.labels.join(" ").includes("Melody") &&
        inputs.labels.join(" ").includes("Wokal"),
      "channel labels: Drums / Bass / Melody / Wokal"
    );

    // ── Attach real files (the repo's generated stem WAVs) ──
    const files = {
      drums: "miejski-rytm-drums.wav",
      bass: "miejski-rytm-bass.wav",
      melody: "miejski-rytm-melody.wav",
      vocals: "miejski-rytm-vocals.wav",
    };
    for (const [ch, f] of Object.entries(files)) {
      check(await cdp.setFileInput(`[data-stem-upload="${ch}"]`, path.join(stemsDir, f)), `attached ${f} to the ${ch} input`);
    }
    await sleep(300);
    const names = await cdp.evaluate(`(() => {
      const modal = document.querySelector('[data-upload-modal]');
      return [...modal.querySelectorAll('span')]
        .filter((s) => s.className.includes('text-[') && s.className.includes('10px]'))
        .map((s) => s.textContent.trim());
    })()`);
    check(names.length === 4 && names.every((n) => n.includes(".wav")), "all four inputs show the chosen file names");

    // ── Submit → card renders + DB row carries isStems + stemsData ──
    check(
      await cdp.evaluate(`(() => {
        const b = document.querySelector('[data-submit-upload="stems"]');
        if (!b) return false;
        b.click();
        return true;
      })()`),
      "clicked „Wgraj stemy”"
    );
    await cdp.waitFor(`!document.querySelector('[data-upload-modal]')`, 10000, 150, "modal closed after upload");
    await cdp.waitFor(
      `[...document.querySelectorAll('div.rounded-2xl')].some((c) => c.textContent.includes('(Stemy)'))`,
      20000,
      300,
      "stems card rendered"
    );
    await sleep(500);
    const card = await cdp.evaluate(`(() => {
      const cardEl = [...document.querySelectorAll('div.rounded-2xl')].find((c) => c.textContent.includes('(Stemy)'));
      if (!cardEl) return null;
      const mixer = cardEl.querySelector('[data-stem-mixer]');
      return {
        chip: cardEl.textContent.includes("🎛️ Stemy"),
        channels: mixer ? [...mixer.querySelectorAll('[data-stem-channel]')].length : 0,
        bars: [...cardEl.querySelectorAll('[class*="w-1.5"]')].length,
      };
    })()`);
    check(!!card && card.chip === true, "uploaded stems card shows the „🎛️ Stemy” chip");
    check(card.channels === 4, `uploaded stems card renders the mixer with 4 channels (got ${card.channels})`);
    check(card.bars === 20, `uploaded stems card renders 20 equalizer bars (got ${card.bars})`);

    const row = await prisma().beat.findFirst({
      where: { title: { endsWith: "(Stemy)" } },
      orderBy: { createdAt: "desc" },
    });
    check(row !== null && row.isStems === true, "DB row created with isStems = true");
    let stemsData = null;
    try {
      stemsData = row ? JSON.parse(row.stemsData || "null") : null;
    } catch {
      stemsData = null;
    }
    check(
      !!stemsData &&
        ["drums", "bass", "melody", "vocals"].every(
          (c) => typeof stemsData[c] === "string" && stemsData[c].startsWith("data:audio/")
        ),
      "stemsData holds 4 audio data URLs (drums/bass/melody/vocals)"
    );

    // ── Single-beat tab still works (reopens on the „🎵 Bit” default) ──
    check(await cdp.clickText("Dodaj Numer"), "reopened the upload modal");
    await cdp.waitFor(`!!document.querySelector('[data-upload-modal]')`, 10000, 150, "modal visible again");
    await sleep(300);
    check(
      await cdp.setFileInput("[data-beat-upload]", path.join(ROOT, "public", "test-beat-a.wav")),
      "attached test-beat-a.wav in the „🎵 Bit” tab"
    );
    check(
      await cdp.evaluate(`(() => {
        const b = document.querySelector('[data-submit-upload="beat"]');
        if (!b) return false;
        b.click();
        return true;
      })()`),
      "clicked „Wgraj bit”"
    );
    await cdp.waitFor(
      `[...document.querySelectorAll('div.rounded-2xl')].some((c) => c.textContent.includes('test-beat-a'))`,
      20000,
      300,
      "single-beat card rendered"
    );
    await sleep(400);
    const beatRow = await prisma().beat.findFirst({
      where: { title: "test-beat-a" },
      orderBy: { createdAt: "desc" },
    });
    check(
      beatRow !== null &&
        beatRow.isStems === false &&
        typeof beatRow.filePath === "string" &&
        beatRow.filePath.startsWith("data:audio/"),
      "single beat stored with filePath data URL (isStems false)"
    );
  } finally {
    await prisma().beat.deleteMany({ where: { OR: [{ title: { endsWith: "(Stemy)" } }, { title: "test-beat-a" }] } });
  }
}

// ── Academy scenario (static articles, no DB) ────────────────────────
async function scenarioAcademy(cdp, appUrl) {
  console.log("\n== 23. Academy — static articles, filters, accordion ==");
  const root = new URL(appUrl).origin + "/";

  await cdp.goto(root + "/academy", `document.body.textContent.includes('Akademia FlowForge')`);

  const TITLES = [
    "Podstawy Budowania Rymów Wielosylabowych",
    "Flow: Jak Dostosować Wersy Do Bitu",
    "Technika Mikrofonowa: Jak Brzmieć Profesjonalnie",
    "Pisanie Storytellingu: Opowiadanie Historii w Wersach",
    "Jak Przełamać Blokadę Twórczą (Writer's Block)",
    "Słownik Rymów: Jak Znaleźć Idealny Rym",
  ];

  // ── Header + full article list ──
  const header = await cdp.evaluate(`(() => ({
    title: document.body.textContent.includes('Akademia FlowForge'),
    subtitle: document.body.textContent.includes('Poradniki i artykuły o rapie, flowie i technice'),
    articleCount: document.querySelectorAll('h3').length,
    titles: [...document.querySelectorAll('h3')].map((h) => h.textContent.trim()),
    filterBtns: [...document.querySelectorAll('button')].filter((b) =>
      ['🔍 Wszystkie', 'Rymy', 'Flow', 'Technika', 'Twórczość'].includes(b.textContent.trim())
    ).length,
    labels: ['Początkujący', 'Średniozaawansowany', 'Zaawansowany'].filter((l) =>
      document.body.textContent.includes(l)
    ),
    readTime: document.body.textContent.includes('⏱ 5 min'),
  }))()`);
  check(header.title === true && header.subtitle === true, "header „Akademia FlowForge” + subtitle rendered");
  check(header.articleCount === 6, `all 6 articles render (got ${header.articleCount})`);
  check(
    TITLES.every((t) => header.titles.includes(t)),
    "all six article titles present"
  );
  check(header.filterBtns === 5, "5 category filter buttons (Wszystkie + Rymy/Flow/Technika/Twórczość)");
  check(
    header.labels.length === 3,
    `difficulty badges present (Początkujący / Średniozaawansowany / Zaawansowany)`
  );
  check(header.readTime === true, "read time shown (⏱ 5 min)");

  // ── Accordion: expand → content, single-open, collapse ──
  check(
    await cdp.evaluate(`!document.body.textContent.includes('Technika 1: Dopasowanie sylab')`),
    "article content hidden before expansion"
  );
  check(
    await cdp.clickText("Podstawy Budowania Rymów Wielosylabowych"),
    "clicked the first article header"
  );
  await sleep(250);
  const expanded1 = await cdp.evaluate(`(() => ({
    content: document.body.textContent.includes('Technika 1: Dopasowanie sylab'),
    strong: document.querySelectorAll('strong').length > 0,
  }))()`);
  check(expanded1.content === true, "expanded article shows its content");
  check(expanded1.strong === true, "**bold** segments render as <strong>");

  // Single-open accordion: opening a second article collapses the first.
  check(
    await cdp.clickText("Flow: Jak Dostosować Wersy Do Bitu"),
    "clicked the second article header"
  );
  await sleep(250);
  const accordion = await cdp.evaluate(`(() => ({
    secondOpen: document.body.textContent.includes('Krok 1: Poznaj BPM bitu'),
    firstClosed: !document.body.textContent.includes('Technika 1: Dopasowanie sylab'),
  }))()`);
  check(accordion.secondOpen === true, "second article expands");
  check(accordion.firstClosed === true, "first article collapses (single-open accordion)");
  check(
    await cdp.clickText("Flow: Jak Dostosować Wersy Do Bitu"),
    "clicked the second article again"
  );
  await sleep(250);
  check(
    await cdp.evaluate(`!document.body.textContent.includes('Krok 1: Poznaj BPM bitu')`),
    "re-click collapses the article"
  );

  // ── Category filters ──
  const filter = async (label) => {
    await cdp.clickText(label);
    await sleep(250);
    return cdp.evaluate(`[...document.querySelectorAll('h3')].map((h) => h.textContent.trim())`);
  };

  const rymy = await filter("Rymy");
  check(
    rymy.length === 2 && rymy.includes(TITLES[0]) && rymy.includes(TITLES[5]),
    `„Rymy” filter shows 2 articles (got ${rymy.length})`
  );

  const flow = await filter("Flow");
  check(flow.length === 1 && flow[0] === TITLES[1], `„Flow” filter shows 1 article (got ${flow.length})`);

  const technika = await filter("Technika");
  check(technika.length === 1 && technika[0] === TITLES[2], `„Technika” filter shows 1 article (got ${technika.length})`);

  const tworczosc = await filter("Twórczość");
  check(
    tworczosc.length === 2 && tworczosc.includes(TITLES[3]) && tworczosc.includes(TITLES[4]),
    `„Twórczość” filter shows 2 articles (got ${tworczosc.length})`
  );

  const all = await filter("🔍 Wszystkie");
  check(all.length === 6, `„Wszystkie” restores all 6 articles (got ${all.length})`);
}

// ── Edit beat scenario (✏️ title/artist/BPM/key on /beats) ────────────
async function scenarioEditBeat(cdp, appUrl) {
  console.log("\n== 24. Beats — edit beat card (✏️ title/artist/BPM/key) ==");
  const root = new URL(appUrl).origin + "/";

  const fixture = {
    id: "e2e-edit-beat",
    title: "Oryginalny Tytul",
    artist: "Oryginalny Artysta",
    bpm: 90,
    key: "Am",
    genre: "Boom Bap",
    duration: 8,
    filePath: "/test-beat-a.wav",
  };
  try {
    const { id, ...rest } = fixture;
    await prisma().beat.upsert({ where: { id }, update: { ...rest }, create: { ...fixture } });

    await cdp.goto(root + "/beats", `document.body.textContent.includes('Gotowe Numery')`);
    await sleep(1200); // server action round-trip + re-render

    // ── Card renders the original values + the ✏️ button ──
    const card = await cdp.evaluate(`(() => {
      const cardEl = [...document.querySelectorAll('div.rounded-2xl')].find((c) => c.textContent.includes('Oryginalny Tytul'));
      if (!cardEl) return null;
      // Note: genre isn't rendered on regular (non-project) beat cards —
      // only BPM/key/duration are — so it's asserted via the DB row below.
      return {
        hasEdit: !!cardEl.querySelector('[data-edit-beat="e2e-edit-beat"]'),
        artist: cardEl.textContent.includes('Oryginalny Artysta'),
        meta: cardEl.textContent.includes('90 BPM') && cardEl.textContent.includes('Am'),
      };
    })()`);
    check(!!card, "seeded beat card renders");
    check(card.hasEdit === true, "✏️ edit button on the beat card");
    check(card.artist === true && card.meta === true, "card shows original artist / 90 BPM / key Am");

    // ── Open the modal → fields prefilled from the row ──
    check(
      await cdp.evaluate(`(() => {
        const b = document.querySelector('[data-edit-beat="e2e-edit-beat"]');
        if (!b) return false;
        b.click();
        return true;
      })()`),
      "clicked ✏️ on the card"
    );
    await sleep(300);
    const modal = await cdp.evaluate(`(() => {
      const m = document.querySelector('[data-edit-modal]');
      if (!m) return null;
      const val = (sel) => { const el = m.querySelector(sel); return el ? el.value : null; };
      return {
        title: val('[data-edit-field="title"]'),
        artist: val('[data-edit-field="artist"]'),
        bpm: val('[data-edit-field="bpm"]'),
        key: val('[data-edit-field="key"]'),
      };
    })()`);
    check(!!modal, "edit modal opened");
    check(
      modal.title === "Oryginalny Tytul" && modal.artist === "Oryginalny Artysta" && modal.bpm === "90" && modal.key === "Am",
      `modal prefilled from the row (got ${modal.title}/${modal.artist}/${modal.bpm}/${modal.key})`
    );

    // ── Validation: empty title keeps the modal open ──
    check(await cdp.setInput(`[data-edit-field="title"]`, ""), "cleared the title");
    await cdp.evaluate(`(() => { const b = document.querySelector('[data-edit-save]'); if (!b) return false; b.click(); return true; })()`);
    await sleep(400);
    const validation = await cdp.evaluate(`(() => ({
      modalOpen: !!document.querySelector('[data-edit-modal]'),
      toast: document.body.textContent.includes('Tytuł nie może być pusty'),
    }))()`);
    check(validation.modalOpen === true, "empty title keeps the modal open");
    check(validation.toast === true, "validation toast „Tytuł nie może być pusty” shown");

    // ── Edit all four fields + save ──
    check(await cdp.setInput(`[data-edit-field="title"]`, "Nowy Tytul E2E"), "typed the new title");
    check(await cdp.setInput(`[data-edit-field="artist"]`, "Nowy Artysta E2E"), "typed the new artist");
    check(await cdp.setInput(`[data-edit-field="bpm"]`, "105"), "typed the new BPM");
    check(
      await cdp.evaluate(`(() => {
        const sel = document.querySelector('[data-edit-field="key"]');
        if (!sel) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, 'Fm');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`),
      "picked key Fm"
    );
    await sleep(200);
    check(
      await cdp.evaluate(`(() => { const b = document.querySelector('[data-edit-save]'); if (!b) return false; b.click(); return true; })()`),
      "clicked „💾 Zapisz zmiany”"
    );
    await cdp.waitFor(
      `document.body.textContent.includes('Nowy Tytul E2E') && !document.querySelector('[data-edit-modal]')`,
      15000,
      200,
      "card updates + modal closes"
    );

    // ── Card + DB reflect the edit; unrelated fields untouched ──
    const updated = await cdp.evaluate(`(() => {
      const cardEl = [...document.querySelectorAll('div.rounded-2xl')].find((c) => c.textContent.includes('Nowy Tytul E2E'));
      if (!cardEl) return null;
      return {
        artist: cardEl.textContent.includes('Nowy Artysta E2E'),
        meta: cardEl.textContent.includes('105 BPM') && cardEl.textContent.includes('Fm'),
      };
    })()`);
    check(updated !== null && updated.artist && updated.meta, "card shows new title/artist/105 BPM/Fm");

    const row = await prisma().beat.findUnique({ where: { id: "e2e-edit-beat" } });
    check(
      row !== null &&
        row.title === "Nowy Tytul E2E" &&
        row.artist === "Nowy Artysta E2E" &&
        row.bpm === 105 &&
        row.key === "Fm" &&
        row.genre === "Boom Bap" &&
        row.duration === 8 &&
        row.filePath === "/test-beat-a.wav",
      "DB row updated (title/artist/bpm/key), genre/duration/filePath untouched"
    );

    // ── Reload → edit persists (DB-primary) ──
    await cdp.goto(root + "/beats", `document.body.textContent.includes('Gotowe Numery')`);
    await sleep(1200);
    const afterReload = await cdp.evaluate(`(() => {
      const cardEl = [...document.querySelectorAll('div.rounded-2xl')].find((c) => c.textContent.includes('Nowy Tytul E2E'));
      return cardEl
        ? cardEl.textContent.includes('105 BPM') && cardEl.textContent.includes('Fm') && cardEl.textContent.includes('Nowy Artysta E2E')
        : false;
    })()`);
    check(afterReload === true, "edit persists after reload (105 BPM / Fm / new artist)");

    // ── Search box: filters cards by title/artist (regression guard) ──
    const allCards = await cdp.evaluate(`document.querySelectorAll('div.rounded-2xl').length`);
    check(allCards > 0, "search starts with a populated grid");
    check(await cdp.setInput(`input[placeholder*='Szukaj numerów']`, "Nowy Tytul"), "typed in the search box");
    // Debounce guard: before the 150 ms window elapses the grid is still
    // unfiltered; only after it does the narrowing apply.
    await sleep(60);
    check(
      (await cdp.evaluate(`document.querySelectorAll('div.rounded-2xl').length`)) === allCards,
      "grid not filtered yet inside the debounce window"
    );
    await sleep(300);
    const filtered = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('div.rounded-2xl')];
      return {
        count: cards.length,
        onlyMatch: cards.length === 1 && cards[0].textContent.includes('Nowy Tytul E2E'),
      };
    })()`);
    check(
      filtered.count === 1 && filtered.onlyMatch === true,
      `search narrows to the matching card (got ${filtered.count})`
    );
    check(await cdp.setInput(`input[placeholder*='Szukaj numerów']`, "nieistniejacy-numer-xyz"), "typed a no-match query");
    await sleep(300);
    // Real beat cards carry ✏️ edit buttons — the „Brak wyników” container is
    // itself rounded-2xl, so count cards via [data-edit-beat] instead.
    const noMatch = await cdp.evaluate(`(() => ({
      empty: document.body.textContent.includes('Brak wyników'),
      cards: document.querySelectorAll('[data-edit-beat]').length,
    }))()`);
    check(noMatch.empty === true && noMatch.cards === 0, "no-match query shows „Brak wyników” + zero cards");
    check(await cdp.setInput(`input[placeholder*='Szukaj numerów']`, ""), "cleared the search box");
    await sleep(300);
    check(
      (await cdp.evaluate(`document.querySelectorAll('div.rounded-2xl').length`)) === allCards,
      "clearing the search restores the full grid"
    );
  } finally {
    await prisma().beat.deleteMany({ where: { id: "e2e-edit-beat" } });
  }
}

// ── Create-cypher scenario („+ Nowy Cypher” form on /challenges) ──────
async function scenarioCreateCypher(cdp, appUrl) {
  console.log("\n== 25. Challenges — create cypher (form + deadline) ==");
  const root = new URL(appUrl).origin + "/";
  const day = 24 * 60 * 60 * 1000;
  const TITLE = "Cypher E2E Nowy";

  const future = new Date(Date.now() + 10 * day);
  const dateStr = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(
    future.getDate()
  ).padStart(2, "0")}`;

  try {
    await cdp.goto(root + "/challenges", `document.body.textContent.includes('Jak zdobywać punkty?')`);
    await sleep(400);

    // ── Open the modal ──
    check(
      await cdp.evaluate(`(() => { const b = document.querySelector('[data-create-open]'); if (!b) return false; b.click(); return true; })()`),
      "clicked „+ Nowy Cypher”"
    );
    await sleep(300);
    check(await cdp.evaluate(`!!document.querySelector('[data-create-modal]')`), "create modal opened");

    // ── Validation: empty title ──
    await cdp.evaluate(`(() => { const b = document.querySelector('[data-create-save]'); if (!b) return false; b.click(); return true; })()`);
    await sleep(400);
    const v1 = await cdp.evaluate(`(() => ({
      open: !!document.querySelector('[data-create-modal]'),
      toast: document.body.textContent.includes('Tytuł cypheru jest wymagany'),
    }))()`);
    check(v1.open === true, "empty title keeps the modal open");
    check(v1.toast === true, "validation toast „Tytuł cypheru jest wymagany”");

    // ── Validation: past deadline ──
    check(await cdp.setInput(`[data-create-field="title"]`, TITLE), "typed the title");
    const past = new Date(Date.now() - 2 * day);
    const pastStr = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`;
    check(await cdp.setInput(`[data-create-field="endDate"]`, pastStr), "typed a past deadline");
    await sleep(200);
    await cdp.evaluate(`(() => { const b = document.querySelector('[data-create-save]'); if (!b) return false; b.click(); return true; })()`);
    await sleep(400);
    const v2 = await cdp.evaluate(`(() => ({
      open: !!document.querySelector('[data-create-modal]'),
      toast: document.body.textContent.includes('Data musi być w przyszłości'),
    }))()`);
    check(v2.open === true && v2.toast === true, "past deadline rejected („Data musi być w przyszłości”)");

    // ── Fill the full form + save ──
    check(
      await cdp.setInput(`[data-create-field="description"]`, "Wers o testowaniu automatycznym"),
      "typed the description"
    );
    check(await cdp.setInput(`[data-create-field="prize"]`, "Wyróżnienie testowe"), "typed the prize");
    check(await cdp.setInput(`[data-create-field="endDate"]`, dateStr), "typed a future deadline (+10d)");
    await sleep(200);
    check(
      await cdp.evaluate(`(() => { const b = document.querySelector('[data-create-save]'); if (!b) return false; b.click(); return true; })()`),
      "clicked „⚔️ Utwórz cypher”"
    );
    await cdp.waitFor(
      `document.body.textContent.includes('${TITLE}') && !document.querySelector('[data-create-modal]')`,
      15000,
      200,
      "card renders + modal closes"
    );

    // ── Card shows title / description / prize / countdown / empty subs ──
    const row = await prisma().challenge.findFirst({ where: { title: TITLE } });
    const expectedDays = row
      ? String(Math.max(0, Math.ceil((row.endDate.getTime() - Date.now()) / 86400000)))
      : null;
    const card = await cdp.evaluate(`(() => {
      const cardEl = [...document.querySelectorAll('div.rounded-2xl')].find((c) => c.textContent.includes('${TITLE}'));
      if (!cardEl) return null;
      return {
        title: cardEl.textContent.includes('${TITLE}'),
        desc: cardEl.textContent.includes('Wers o testowaniu automatycznym'),
        prize: cardEl.textContent.includes('Wyróżnienie testowe'),
        countdown: (cardEl.textContent.match(/([0-9]+)d/) || [])[1] ?? null,
        empty: cardEl.textContent.includes('Brak zgłoszeń — bądź pierwszy!'),
        counter: cardEl.textContent.includes('Zgłoszenia • 0'),
      };
    })()`);
    check(!!card, "new cypher card rendered in „Aktywne Cyphery”");
    check(card.title === true && card.desc === true && card.prize === true, "card shows title / description / prize");
    check(
      expectedDays !== null && card.countdown === expectedDays,
      `countdown matches the deadline (${expectedDays}d, got ${card.countdown})`
    );
    check(card.empty === true && card.counter === true, "new cypher shows „Zgłoszenia • 0” + empty state");

    // ── DB row: created active, deadline stored ──
    check(
      row !== null && row.isActive === true && row.endDate.getTime() > Date.now(),
      "DB row created (isActive true, future endDate)"
    );

    // ── Reload → the cypher persists (DB-primary) ──
    await cdp.goto(root + "/challenges", `document.body.textContent.includes('Jak zdobywać punkty?')`);
    await sleep(1200);
    check(
      await cdp.evaluate(`(() => {
        const cardEl = [...document.querySelectorAll('div.rounded-2xl')].find((c) => c.textContent.includes('${TITLE}'));
        return !!cardEl && cardEl.textContent.includes('Zgłoszenia • 0');
      })()`),
      "new cypher persists after reload"
    );
  } finally {
    // Submissions cascade on challenge delete.
    await prisma().challenge.deleteMany({ where: { title: TITLE } });
  }
}

// ── Scenarios ────────────────────────────────────────────────────────
async function scenarioRhymeMetronomeMoodboard(cdp, url) {
  console.log("\n== 1. Rhyme markers ==");
  await cdp.freshSlate(url);
  check(await cdp.clickText("Analiza Rymów"), "enabled rhyme analysis toggle");
  await sleep(400);
  check(await cdp.evaluate(`document.querySelectorAll('.vault-text-line').length > 0`), "measurement mirror lines rendered");

  const lyrics =
    "Na górze siedzi kura\nDeszcz pada na parapet\na pod górą jest dziura\ni sypie się ze ściany tynk";
  check(await cdp.setTextarea(lyrics), "typed lyrics (2 rhyming + 2 non-rhyming lines)");
  await sleep(500);

  const markerSummary = await cdp.evaluate(`(() => {
    const layer = document.querySelector('div[class*="inset-y-0"]');
    const markers = layer ? [...layer.children] : [];
    return {
      count: markers.length,
      visible: markers.filter((m) => m.style.opacity === "1").length,
      heights: markers.map((m) => parseFloat(m.style.height) || 0),
    };
  })()`);
  check(markerSummary.count === 4, `4 markers rendered for 4 lines (got ${markerSummary.count})`);
  check(
    markerSummary.visible >= 2 && markerSummary.visible < 4,
    `rhyme engine marks the rhyming pair but not the rest (got ${markerSummary.visible}/4)`
  );
  check(
    markerSummary.heights.filter((h) => h > 0).length === markerSummary.visible,
    "marked markers have a real measured height"
  );

  // Editor ↔ panel 1:1 — for every line, the SET of „Analiza Wersów” dot
  // colors must equal the SET of editor word-highlight colors (rgba alpha
  // stripped). Multi-cluster lines carry multiple dots/spans.
  const colorSync = await cdp.evaluate(`(() => {
    const ta = document.querySelector('textarea');
    const raw = ta.value.split('\\n');
    const card = [...document.querySelectorAll('h3')].find(h => h.textContent.includes('Analiza Wersów'));
    if (!card) return null;
    const panel = card.closest('div.rounded-xl');
    const rows = [...panel.querySelectorAll('div.space-y-1 > div')].filter(r => r.textContent.trim().length > 0);
    const lineDivs = [...document.querySelectorAll('.vault-text-line')];
    const rgb = (c) => c.indexOf('rgba(') === 0 ? 'rgb(' + c.slice(5, c.lastIndexOf(',')) + ')' : c;
    const rawIdxOf = [];
    let rawIdx = 0;
    for (const r of rows) {
      while (raw[rawIdx] !== undefined && raw[rawIdx].trim().length === 0) rawIdx++;
      rawIdxOf.push(rawIdx);
      rawIdx++;
    }
    const mismatch = [];
    rows.forEach((row, i) => {
      const ri = rawIdxOf[i];
      // SET comparison: several words on one line may share a cluster color
      // (one dot per cluster), so dedupe before comparing.
      const dotColors = [...new Set([...row.querySelectorAll('[data-rhyme-dot]')].map(d => rgb(getComputedStyle(d).backgroundColor)))].sort();
      const spanColors = [...new Set(lineDivs[ri]
        ? [...lineDivs[ri].querySelectorAll('[data-rhyme-word]')].map(s => rgb(getComputedStyle(s).backgroundColor))
        : [])].sort();
      if (JSON.stringify(dotColors) !== JSON.stringify(spanColors)) {
        mismatch.push({ ri, dotColors, spanColors });
      }
    });
    return { rows: rows.length, mismatch };
  })()`);
  check(
    colorSync && colorSync.rows === 4 && colorSync.mismatch.length === 0,
    `editor word highlights match the „Analiza Wersów” dot colors 1:1 (${colorSync ? colorSync.mismatch.length + " mismatches" : "panel not found"})`
  );

  // ── Rhyme granularity: blank-line stanza breaks + multi-word highlights ──
  // The panel skips blank lines but must look cluster colors up by RAW line
  // index. The text carries THREE word-level clusters — „jakiś/taki” (mid-
  // line internal rhyme), the user's „dziwny/inni” (assonance) and
  // „mówi/ludzi/budzi” — so several lines hold multiple highlights.
  const stanzaText =
    "On jest jakiś dziwny\nNikt nie jest taki inni\n\nMówi, że pisze dla ludzi\nA w nocy sam siebie budzi";
  check(await cdp.setTextarea(stanzaText), "typed lyrics with a blank-line stanza break");
  await sleep(500);

  const stanzaSync = await cdp.evaluate(`(() => {
    const ta = document.querySelector('textarea');
    const raw = ta.value.split('\\n');
    const card = [...document.querySelectorAll('h3')].find(h => h.textContent.includes('Analiza Wersów'));
    if (!card) return null;
    const panel = card.closest('div.rounded-xl');
    const rows = [...panel.querySelectorAll('div.space-y-1 > div')].filter(r => r.textContent.trim().length > 0);
    const lineDivs = [...document.querySelectorAll('.vault-text-line')];
    const rgb = (c) => c.indexOf('rgba(') === 0 ? 'rgb(' + c.slice(5, c.lastIndexOf(',')) + ')' : c;
    // Map each non-blank panel row to its RAW line index (same walk as the panel).
    const rawIdxOf = [];
    let rawIdx = 0;
    for (const r of rows) {
      while (raw[rawIdx] !== undefined && raw[rawIdx].trim().length === 0) rawIdx++;
      rawIdxOf.push(rawIdx);
      rawIdx++;
    }
    const mismatch = [];
    const byWord = {};
    const wordTexts = [];
    rows.forEach((row, i) => {
      const ri = rawIdxOf[i];
      const dotColors = [...new Set([...row.querySelectorAll('[data-rhyme-dot]')].map(d => rgb(getComputedStyle(d).backgroundColor)))].sort();
      const spans = lineDivs[ri] ? [...lineDivs[ri].querySelectorAll('[data-rhyme-word]')] : [];
      const spanColors = [...new Set(spans.map(s => rgb(getComputedStyle(s).backgroundColor)))].sort();
      const texts = spans.map(s => s.textContent);
      wordTexts.push(texts);
      if (JSON.stringify(dotColors) !== JSON.stringify(spanColors)) mismatch.push({ ri, dotColors, spanColors });
      const lineText = raw[ri] || '';
      if (lineText.includes('dziwny') || lineText.includes('inni')) {
        const target = lineText.includes('dziwny') ? 'dziwny' : 'inni';
        const ti = texts.indexOf(target);
        byWord[target] = ti >= 0 ? spanColors[ti] : 'transparent';
      }
    });
    return {
      rawLines: raw.length,
      rows: rows.length,
      mismatch,
      wordTexts,
      dziwnyBg: byWord['dziwny'] || null,
      inniBg: byWord['inni'] || null,
      shared: byWord['dziwny'] === byWord['inni'] && byWord['dziwny'] !== 'transparent' && byWord['dziwny'] != null,
      summary: [...document.querySelectorAll('span')].find(s => s.textContent.includes('grup rymów'))?.textContent.trim() || null,
    };
  })()`);
  check(
    stanzaSync && stanzaSync.rawLines === 5 && stanzaSync.rows === 4,
    `panel skips the blank line but keeps 4 rows out of 5 raw lines (${stanzaSync ? stanzaSync.rows + "/" + stanzaSync.rawLines : "panel not found"})`
  );
  check(
    stanzaSync && stanzaSync.mismatch.length === 0,
    `„Analiza Wersów” dots stay 1:1 with editor highlights across a stanza break (${stanzaSync ? stanzaSync.mismatch.length + " mismatches" : "panel not found"})`
  );
  check(
    stanzaSync && stanzaSync.shared === true && stanzaSync.dziwnyBg === stanzaSync.inniBg,
    `„dziwny” and „inni” words share the same highlight color (${stanzaSync ? JSON.stringify([stanzaSync.dziwnyBg, stanzaSync.inniBg]) : "panel not found"})`
  );
  check(
    stanzaSync && JSON.stringify(stanzaSync.wordTexts) === JSON.stringify([['jakiś', 'dziwny'], ['taki', 'inni'], ['Mówi,', 'ludzi'], ['budzi']]),
    `the editor highlights every matching word, incl. internal rhymes — not just line endings (${stanzaSync ? JSON.stringify(stanzaSync.wordTexts) : "panel not found"})`
  );
  check(
    stanzaSync && stanzaSync.summary !== null && stanzaSync.summary.includes('3 grup'),
    `summary reports 3 rhyme groups for the stanza text (word-level clusters) (${stanzaSync ? stanzaSync.summary : "no summary"})`
  );

  // ── Export PDF: print view (portal) + ExportLog „pdf” ──
  await cdp.evaluate(`(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; return true; })()`);
  check(await cdp.clickText("Eksportuj PDF"), "clicked „📄 Eksportuj PDF”");
  await cdp.waitFor(`!!document.querySelector('#print-area')`, 10000, 200, "print area rendered");
  await sleep(400);
  const pdfView = await cdp.evaluate(`(() => {
    const area = document.querySelector('#print-area');
    return {
      printed: window.__printed || 0,
      title: area ? area.textContent.includes('On jest jakiś dziwny') : false,
      stats: area ? area.textContent.includes('Linie: 4') && area.textContent.includes('Sylaby:') : false,
      brand: area ? area.textContent.includes('FlowForge') : false,
    };
  })()`);
  check(pdfView.printed >= 1, "window.print() invoked for the PDF export");
  check(pdfView.title === true, "print area contains the exported lyrics");
  check(pdfView.stats === true, "print card shows the stats line (Linie: 4 + Sylaby)");
  check(pdfView.brand === true, "print card branded „FlowForge”");
  // The export persisted the lyric, then logged format „pdf”.
  const pdfLog = await prisma().exportLog.findFirst({ where: { format: "pdf" }, orderBy: { createdAt: "desc" } });
  check(pdfLog !== null, "ExportLog row with format \"pdf\" written");

  // ── ExportLog as a real history source: badge + „🧹 Wyczyść historię” ──
  const histPanel = await cdp.evaluate(`(() => {
    const h = [...document.querySelectorAll('h3')].find(x => x.textContent.includes('Historia Eksportów'));
    const panel = h ? h.closest('div') : null;
    return panel ? {
      pdfBadge: panel.textContent.includes('PDF'),
      clearBtn: [...panel.querySelectorAll('button')].some(b => b.textContent.includes('Wyczyść historię')),
    } : null;
  })()`);
  check(histPanel !== null && histPanel.pdfBadge === true, "history panel shows the „📄 PDF” format badge");
  check(histPanel !== null && histPanel.clearBtn === true, "„🧹 Wyczyść historię” button present");
  check(await cdp.clickText("Wyczyść historię"), "clicked „🧹 Wyczyść historię”");
  await cdp.waitFor(`document.body.textContent.includes('Brak eksportów')`, 10000, 200, "history panel empty state");
  await sleep(300);
  check((await prisma().exportLog.count()) === 0, "ExportLog table emptied after „Wyczyść historię”");

  // Cleanup: detach the print area + remove the row and its lyric.
  await cdp.evaluate(`(() => { const el = document.querySelector('#print-area'); if (el) el.remove(); return true; })()`);
  if (pdfLog) {
    await prisma().exportLog.deleteMany({ where: { lyricId: pdfLog.lyricId ?? "" } });
    if (pdfLog.lyricId) await prisma().lyric.deleteMany({ where: { id: pdfLog.lyricId } });
  }

  // ── Internal-position rhyme: „Płomień” ↔ „Promień” at token index 0 ──
  // Both words are the FIRST word of their line (not the line end) — a rhyme
  // only a full-text scan can catch, and both must share one highlight color.
  const internalText = "Płomień gaśnie w wielkim mieście\nPromień słońca w oknie płynie";
  check(await cdp.setTextarea(internalText), "typed lyrics with an internal-position rhyme pair");
  await sleep(500);
  const internalSync = await cdp.evaluate(`(() => {
    const lineDivs = [...document.querySelectorAll('.vault-text-line')];
    const spans = (i) => lineDivs[i] ? [...lineDivs[i].querySelectorAll('[data-rhyme-word]')] : [];
    const rgb = (c) => c.indexOf('rgba(') === 0 ? 'rgb(' + c.slice(5, c.lastIndexOf(',')) + ')' : c;
    const s0 = spans(0).find(s => s.textContent === 'Płomień');
    const s1 = spans(1).find(s => s.textContent === 'Promień');
    const lineText = (i) => (lineDivs[i] ? lineDivs[i].textContent.trim() : '');
    return {
      hit: s0 !== undefined && s1 !== undefined,
      // The matching word sits at the line START (internal position) —
      // and it is NOT the line's last word (not an end-rhyme).
      atLineStart: lineText(0).startsWith('Płomień') && lineText(1).startsWith('Promień'),
      notLineEnd: s0 !== undefined && !lineText(0).endsWith(s0.textContent),
      shared: s0 && s1 ? rgb(getComputedStyle(s0).backgroundColor) === rgb(getComputedStyle(s1).backgroundColor) : false,
      color: s0 ? getComputedStyle(s0).backgroundColor : null,
    };
  })()`);
  check(
    internalSync && internalSync.hit === true && internalSync.atLineStart === true &&
      internalSync.notLineEnd === true && internalSync.shared === true && internalSync.color !== 'transparent',
    `„Płomień” ↔ „Promień” rhyme at an internal position (line start, not the line end) and share one highlight color (${internalSync ? JSON.stringify([internalSync.atLineStart, internalSync.notLineEnd, internalSync.shared, internalSync.color]) : "panel not found"})`
  );

  // ── Writer's Block: categorized „Iskra” + „Losuj Klimat” ──
  await cdp.clickText("Blokada Twórcza");
  await sleep(400);
  check(
    await cdp.evaluate(`!![...document.querySelectorAll('h4')].find(h => h.textContent.includes('Iskra Inspiracji'))`),
    "writer block panel opened (Iskra Inspiracji section)"
  );
  const sparkCategories = ['Ustawki puenty', 'Koncepcje tematyczne', 'Zabawy słowne', 'Linie otwierające', 'Abstrakcyjne obrazy', 'Klimat:'];
  check(await cdp.clickText("Losuj Iskrę"), "clicked „🎲 Losuj Iskrę”");
  await sleep(300);
  const spark1 = await cdp.evaluate(`(() => {
    const card = document.querySelector('[data-spark-card]');
    if (!card) return null;
    const label = card.querySelector('p')?.textContent || '';
    const quote = card.querySelectorAll('p')[1]?.textContent || '';
    return { label, quote: quote.replace(/^“|”$/g, ''), categorized: ${JSON.stringify(sparkCategories)}.some(c => label.includes(c)) };
  })()`);
  check(
    spark1 !== null && spark1.categorized === true && spark1.quote.length > 10,
    `spark drawn from a labeled category (${spark1 ? spark1.label : "no card"})`
  );
  check(await cdp.clickText("Losuj Iskrę"), "re-rolled „Losuj Iskrę”");
  await sleep(300);
  check(
    await cdp.evaluate(`!!document.querySelector('[data-spark-card]')`),
    "spark card still present after another roll"
  );

  // „Losuj Klimat” — auto-selects mood tags (with glow) and re-rolls a spark
  // tailored to the new vibe.
  check(await cdp.clickText("Losuj Klimat"), "clicked „🎲 Losuj Klimat”");
  await sleep(350);
  const klimat = await cdp.evaluate(`(() => {
    const active = [...document.querySelectorAll('[data-mood-tag]')].filter(b => b.dataset.moodActive === 'true');
    const glow = active.some(b => getComputedStyle(b).boxShadow !== 'none');
    const wordsBox = [...document.querySelectorAll('p')].find(p => p.textContent.includes('Słowa:'));
    return {
      activeCount: active.length,
      glow,
      wordsBox: !!wordsBox,
      spark: !!document.querySelector('[data-spark-card]'),
    };
  })()`);
  check(
    klimat && klimat.activeCount >= 1 && klimat.activeCount <= 3,
    `„Losuj Klimat” auto-selected ${klimat ? klimat.activeCount : "?"} mood tag(s)`
  );
  check(
    klimat && klimat.glow === true,
    "active mood tags carry the glow effect (box-shadow)"
  );
  check(
    klimat && klimat.wordsBox === true && klimat.spark === true,
    "klimat word chips shown and a context-aware spark was rolled"
  );

  // Insertion still works: a klimat word chip inserts the word, a spark
  // card click inserts the prompt. The chip test runs FIRST, while the klimat
  // rolled above is still active (chips only render with ≥1 active mood).
  const beforeWord = await cdp.evaluate(`document.querySelector('textarea').value.length`);
  const klimatWord = await cdp.evaluate(`(() => {
    const chip = document.querySelector('[data-klimat-word]');
    return chip ? chip.textContent.trim() : null;
  })()`);
  if (klimatWord) {
    check(await cdp.evaluate(`(() => { const el = document.querySelector('[data-klimat-word]'); if (!el) return false; el.click(); return true; })()`), "clicked a klimat word chip");
    await sleep(250);
    check(
      await cdp.evaluate(`(() => {
        const v = document.querySelector('textarea').value;
        return v.length > ${beforeWord} && v.includes(${JSON.stringify(klimatWord)});
      })()`),
      "klimat word chip inserts its word into the editor"
    );
  } else {
    check(true, "klimat word chip not present (no active mood) — skipped");
  }

  // Manual mood toggling (multi-select) still works. Click by data-mood-tag
  // (not text) — a klimat-tailored spark's label may also contain „Mrok”.
  // Normalize first: the klimat roll above is random, so „Mrok” may already
  // be active — the toggle test must start from a known (inactive) state.
  await cdp.evaluate(`(() => {
    const b = document.querySelector('[data-mood-tag="🌑 Mrok"]');
    if (b && b.dataset.moodActive === 'true') b.click();
    return true;
  })()`);
  await sleep(200);
  const mrokSelector = `(() => { const b = document.querySelector('[data-mood-tag="🌑 Mrok"]'); if (!b) return false; b.click(); return true; })()`;
  check(await cdp.evaluate(mrokSelector), "clicked „🌑 Mrok” mood tag (data selector)");
  await sleep(200);
  check(
    await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('[data-mood-tag]')].find(x => x.textContent.includes('Mrok'));
      return b && b.dataset.moodActive === 'true';
    })()`),
    "manually toggled „🌑 Mrok” mood tag on"
  );
  check(await cdp.evaluate(mrokSelector), "clicked „🌑 Mrok” again");
  await sleep(200);
  check(
    await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('[data-mood-tag]')].find(x => x.textContent.includes('Mrok'));
      return b && b.dataset.moodActive === 'false';
    })()`),
    "clicking „🌑 Mrok” again toggles it off"
  );

  // Spark card insertion (independent of the mood state).
  check(await cdp.clickText("Losuj Iskrę"), "rolled a spark before insertion test");
  await sleep(250);
  const sparkQuote = await cdp.evaluate(`(() => {
    const card = document.querySelector('[data-spark-card]');
    return card ? card.querySelectorAll('p')[1].textContent.replace(/^“|”$/g, '') : null;
  })()`);
  check(await cdp.evaluate(`(() => { const el = document.querySelector('[data-spark-card]'); if (!el) return false; el.click(); return true; })()`), "clicked the spark card");
  await sleep(250);
  check(
    await cdp.evaluate(`(() => {
      const v = document.querySelector('textarea').value;
      return ${JSON.stringify(sparkQuote)} !== null && v.includes(${JSON.stringify((sparkQuote || "").slice(0, 24))});
    })()`),
    "clicking the spark card inserts its text into the editor"
  );

  // ── Undo/redo history: typing bursts + programmatic insertions ──
  const baseText = "Pierwsza linia\nDruga linia";
  check(await cdp.setTextarea(baseText), "set editor to a known base state");
  // Wait past the 800 ms typing-merge window so the burst below starts its
  // OWN undo transaction (otherwise it would merge with the set and Ctrl+Z
  // would jump past the base state).
  await sleep(900);
  const keydown = (key, ctrl, shift) => cdp.evaluate(`(() => {
    const ta = document.querySelector('textarea');
    if (!ta) return false;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', ctrlKey: ${ctrl}, shiftKey: ${shift}, bubbles: true, cancelable: true }));
    return true;
  })()`);
  const editorText = () => cdp.evaluate(`document.querySelector('textarea').value`);

  // A typing burst (3 input events in one tick) = ONE undo step.
  check(
    await cdp.evaluate(`(() => {
      const ta = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      for (const ch of ['A', 'B', 'C']) {
        setter.call(ta, ta.value + ch);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    })()`),
    "typed a 3-character burst (A, B, C)"
  );
  await sleep(200);
  check((await editorText()) === baseText + "ABC", `burst landed in the editor (got ${(await editorText()).slice(-12)})`);
  check(await keydown("z", true, false), "dispatched Ctrl+Z");
  await sleep(200);
  check(
    (await editorText()) === baseText,
    `Ctrl+Z removes the whole typing burst in one step (got ${JSON.stringify((await editorText()).slice(-20))})`
  );
  check(await keydown("y", true, false), "dispatched Ctrl+Y");
  await sleep(200);
  check((await editorText()) === baseText + "ABC", "Ctrl+Y redoes the burst");

  // A programmatic „Iskra” insertion is an INDEPENDENT transaction: Ctrl+Z
  // right after it restores the precise pre-insertion state.
  check(await cdp.clickText("Losuj Iskrę"), "rolled an iskra for the undo test");
  await sleep(250);
  const undoSparkQuote = await cdp.evaluate(`(() => {
    const card = document.querySelector('[data-spark-card]');
    return card ? card.querySelectorAll('p')[1].textContent.replace(/^“|”$/g, '') : null;
  })()`);
  check(await cdp.evaluate(`(() => { const el = document.querySelector('[data-spark-card]'); if (!el) return false; el.click(); return true; })()`), "clicked the spark card to insert it");
  await sleep(250);
  const afterInsert = await editorText();
  check(
    undoSparkQuote !== null && afterInsert.includes(undoSparkQuote.slice(0, 20)),
    "iskra text inserted into the editor"
  );
  check(await keydown("z", true, false), "dispatched Ctrl+Z after the insertion");
  await sleep(250);
  const afterUndo = await editorText();
  check(
    afterUndo === baseText + "ABC",
    `Ctrl+Z after „Losuj Iskrę” removes exactly the inserted text (got ${JSON.stringify(afterUndo.slice(-24))})`
  );
  check(await keydown("z", true, true), "dispatched Ctrl+Shift+Z");
  await sleep(250);
  check(
    (await editorText()) === afterInsert,
    "Ctrl+Shift+Z re-applies the inserted iskra"
  );
  check(await keydown("z", true, false), "dispatched Ctrl+Z again");
  await sleep(200);
  check((await editorText()) === baseText + "ABC", "Ctrl+Z again removes the iskra (stack stays consistent)");

  const manyLines = Array.from({ length: 60 }, (_, i) => `Wers numer ${i + 1} siedzi na górze jak kura`).join("\n");
  await cdp.setTextarea(manyLines);
  await sleep(500);
  const before = await cdp.evaluate(`(() => {
    const layer = document.querySelector('div[class*="inset-y-0"]');
    return [...layer.children].map((m) => parseFloat(m.style.top) || 0);
  })()`);
  const scrollInfo = await cdp.evaluate(`(() => {
    const ta = document.querySelector('textarea');
    ta.scrollTop = 160;
    ta.dispatchEvent(new Event('scroll'));
    return { scrollTop: ta.scrollTop, scrollable: ta.scrollHeight > ta.clientHeight };
  })()`);
  await sleep(300);
  const after = await cdp.evaluate(`(() => {
    const layer = document.querySelector('div[class*="inset-y-0"]');
    return [...layer.children].map((m) => parseFloat(m.style.top) || 0);
  })()`);
  check(scrollInfo.scrollable === true, "editor content overflows (scrollable)");
  const moved = after.filter((t, i) => Math.abs((before[i] || 0) - t - 160) < 2).length;
  check(moved >= 3, `markers tracked the 160px scroll (${moved}/4 moved by ~160px)`);
  await cdp.evaluate(`(() => { const ta = document.querySelector('textarea'); ta.scrollTop = 0; })()`);
  await sleep(200);

  console.log("\n== 2. Metronome (audio-clock verified via injected fake AudioContext) ==");
  // Headless Chrome has no audio device, so its AudioContext clock never
  // advances. Inject a deterministic fake with a real-time clock that records
  // every osc.start(t) — this verifies the lookahead scheduler's exact timing,
  // live tempo changes and stop-cancellation more strictly than a device.
  await cdp.evaluate(`(() => {
    window.__scheduledStarts = [];
    const instances = [];
    class FakeAudioContext {
      constructor() { this.currentTime = 0; this.state = 'running'; this._t0 = performance.now(); instances.push(this); }
      resume() { this.state = 'running'; return Promise.resolve(); }
      close() { this.state = 'closed'; return Promise.resolve(); }
      get destination() { return {}; }
      createOscillator() {
        return {
          type: '',
          frequency: { setValueAtTime() {} },
          connect() {},
          disconnect() {},
          start(t) { window.__scheduledStarts.push(t); },
          stop() {},
        };
      }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    }
    window.AudioContext = FakeAudioContext;
    window.__advanceClock = setInterval(() => {
      const now = performance.now();
      for (const c of instances) c.currentTime = (now - c._t0) / 1000;
    }, 10);
    return true;
  })()`);

  check(await cdp.clickText("Metronom"), "enabled metronome toggle");
  await sleep(400);
  const bpmBefore = await cdp.evaluate(`(() => {
    const el = [...document.querySelectorAll('span')].find(s => /^\\d{2,3}$/.test(s.textContent.trim()) && s.className.includes('text-5xl'));
    return el ? el.textContent.trim() : null;
  })()`);
  check(bpmBefore === "90", `metronome starts at 90 BPM (got ${bpmBefore})`);

  const statusText = () =>
    cdp.evaluate(`(() => {
      const els = [...document.querySelectorAll('*')];
      const el = els.find(e => e.textContent.trim() === 'Aktywny') || els.find(e => e.textContent.trim() === 'Wstrzymany');
      return el ? el.textContent.trim() : null;
    })()`);

  check(
    await cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '▶');
      if (!btn) return false;
      btn.click();
      return true;
    })()`),
    "clicked play"
  );
  await sleep(1500);
  check((await statusText()) === "Aktywny", `status shows Aktywny while playing (got ${await statusText()})`);
  const startsAt90 = await cdp.evaluate(`window.__scheduledStarts.length`);
  check(startsAt90 >= 3, `scheduler pre-scheduled clicks at 90 BPM (${startsAt90} within ~1.5s)`);
  const spacing90 = await cdp.evaluate(`(() => {
    const s = window.__scheduledStarts;
    if (s.length < 3) return null;
    return s[2] - s[1];
  })()`);
  check(spacing90 !== null && Math.abs(spacing90 - 60 / 90) < 0.03, `click spacing ≈ 60/90 = 0.667s at 90 BPM (got ${spacing90?.toFixed(3)}s)`);

  const leds = () =>
    cdp.evaluate(`(() => [...document.querySelectorAll('div[class*="w-8 h-8 rounded-full"]')].map(d => d.className).join('|'))()`);
  const ledShot1 = await leds();
  check(ledShot1.includes("bg-amber-500"), "at least one beat LED is lit while playing");
  await sleep(700);
  const ledShot2 = await leds();
  check(ledShot1 !== ledShot2, "beat LEDs animate while playing (snapshot changed)");

  check(
    await cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '+');
      if (!btn) return false;
      btn.click();
      return true;
    })()`),
    "clicked BPM +"
  );
  await sleep(300);
  const bpmAfter = await cdp.evaluate(`(() => {
    const el = [...document.querySelectorAll('span')].find(s => /^\\d{2,3}$/.test(s.textContent.trim()) && s.className.includes('text-5xl'));
    return el ? el.textContent.trim() : null;
  })()`);
  check(bpmAfter === "95", `BPM increased to 95 (got ${bpmAfter})`);
  await sleep(1400);
  const spacing95 = await cdp.evaluate(`(() => {
    const s = window.__scheduledStarts;
    if (s.length < 6) return null;
    const recent = s.slice(-3);
    return recent[2] - recent[1];
  })()`);
  check(spacing95 !== null && Math.abs(spacing95 - 60 / 95) < 0.03, `click spacing ≈ 60/95 = 0.632s after BPM change (got ${spacing95?.toFixed(3)}s)`);

  check(
    await cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '⏸');
      if (!btn) return false;
      btn.click();
      return true;
    })()`),
    "clicked stop"
  );
  await sleep(400);
  check((await statusText()) === "Wstrzymany", `status shows Wstrzymany after stop (got ${await statusText()})`);
  const countAtStop = await cdp.evaluate(`window.__scheduledStarts.length`);
  await sleep(1200);
  const countAfterStop = await cdp.evaluate(`window.__scheduledStarts.length`);
  check(countAtStop === countAfterStop, `no clicks scheduled after stop (${countAtStop} → ${countAfterStop})`);
  const frozenA = await leds();
  await sleep(1200);
  const frozenB = await leds();
  check(frozenA === frozenB, "beat LEDs frozen after stop (no stray timers)");

  console.log("\n== 3. Moodboard ==");
  check(await cdp.clickText("Moodboard"), "enabled moodboard toggle");
  await sleep(400);
  check(
    await cdp.evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('Wgraj obraz'))`),
    "image upload button present"
  );

  const testImage = path.join(os.tmpdir(), "flowforge-e2e-test.png");
  if (!existsSync(testImage)) {
    // 1×1 red PNG.
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const { writeFileSync } = await import("node:fs");
    writeFileSync(testImage, Buffer.from(b64, "base64"));
  }

  const doc = await cdp.send("DOM.getDocument", { depth: -1 });
  const fileQ = await cdp.send("DOM.querySelector", {
    nodeId: doc.result.root.nodeId,
    selector: 'input[type="file"]',
  });
  check(fileQ.result?.nodeId > 0, "hidden file input found");
  await cdp.send("DOM.setFileInputFiles", { nodeId: fileQ.result.nodeId, files: [testImage] });
  await cdp.waitFor(
    `[...document.querySelectorAll('img')].some(i => (i.src || '').startsWith('data:image'))`,
    10000,
    200,
    "image preview card"
  );
  check(
    (await cdp.evaluate(
      `[...document.querySelectorAll('img')].filter(i => (i.src || '').startsWith('data:image')).length`
    )) === 1,
    "uploaded image rendered as a card"
  );

  check(await cdp.setInput('input[placeholder="URL..."]', "https://example.com"), "typed a link URL");
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '+' && b.title === 'Dodaj link');
    if (btn) btn.click();
  })()`);
  await sleep(400);
  const cardsBefore = await cdp.evaluate(
    `(() => [...document.querySelectorAll('div[draggable="true"]')].map(d => d.textContent.trim().replace(/[×⠿\\s]+$/g, '')))()`
  );
  check(cardsBefore.length === 2, `two cards on the board (got ${cardsBefore.length})`);

  // Drag card 0 onto card 1. Events are dispatched in SEPARATE tasks so React
  // flushes dragIndex between dragstart and drop (a real drag spans >100ms).
  check(
    await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('div[draggable="true"]')];
      if (cards.length < 2) return false;
      const dt = new DataTransfer();
      cards[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`),
    "dragstart on card 0"
  );
  await sleep(250);
  await cdp.evaluate(`(() => {
    const cards = [...document.querySelectorAll('div[draggable="true"]')];
    const dt = new DataTransfer();
    cards[1].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    cards[1].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    cards[0].dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await sleep(400);
  const cardsAfter = await cdp.evaluate(
    `(() => [...document.querySelectorAll('div[draggable="true"]')].map(d => d.textContent.trim().replace(/[×⠿\\s]+$/g, '')))()`
  );
  check(cardsAfter.length === 2, "still two cards after reorder");
  check(
    cardsAfter[0] !== cardsBefore[0],
    `drag & drop reordered the cards (${JSON.stringify(cardsBefore)} → ${JSON.stringify(cardsAfter)})`
  );

  await cdp.setInput('input[placeholder="Dodaj słowo..."]', "mroczny");
  await sleep(200);
  await cdp.evaluate(`(() => {
    const input = document.querySelector('input[placeholder="Dodaj słowo..."]');
    const btn = input && input.parentElement.querySelector('button');
    if (btn) btn.click();
  })()`);
  await sleep(400);
  check(
    await cdp.evaluate(`[...document.querySelectorAll('span')].some(s => s.textContent.includes('mroczny'))`),
    "added keyword „mroczny”"
  );

  // Let the debounced DB sync (800ms) land before the reload — the panel
  // restores from the DB on mount, so a premature reload would lose the
  // last change even though the localStorage mirror has it.
  await sleep(1200);
  await cdp.send("Page.reload");
  await cdp.waitFor(`document.readyState === 'complete'`);
  await cdp.waitFor(`!!document.querySelector('textarea')`);
  await cdp.waitFor(
    `!![...document.querySelectorAll('button')].find(b => b.textContent.includes('Wgraj obraz'))`,
    20000,
    200,
    "moodboard reopened after reload"
  );
  await sleep(500);
  const restored = await cdp.evaluate(`(() => ({
    keywords: [...document.querySelectorAll('span')].filter(s => s.textContent.includes('mroczny')).length,
    images: [...document.querySelectorAll('img')].filter(i => (i.src || '').startsWith('data:image')).length,
    cards: [...document.querySelectorAll('div[draggable="true"]')].map(d => d.textContent.trim().replace(/[×⠿\\s]+$/g, '')),
  }))()`);
  check(restored.keywords === 1, "keyword persisted across reload");
  check(restored.images === 1, "uploaded image persisted across reload (data URL)");
  check(
    restored.cards.length === 2 && restored.cards[0] !== cardsBefore[0],
    `card order persisted across reload (${JSON.stringify(restored.cards)})`
  );

  // ── DB-primary sync: the board row must hold the added keyword ──
  await sleep(1200); // debounced (800ms) upsert + write
  const boardRow = await prisma().moodboardItem.findFirst({ where: { type: "board" } });
  check(boardRow !== null, "moodboard board row exists in the DB");
  check(boardRow !== null && (boardRow.content || "").includes("mroczny"), "added keyword synced into the DB row");

  // ── Wipe the localStorage mirror → reload → the board must restore from DB ──
  await cdp.evaluate(`localStorage.removeItem('flowforge-moodboard'); true`);
  await cdp.send("Page.reload");
  await cdp.waitFor(`document.readyState === 'complete'`);
  await cdp.waitFor(`!!document.querySelector('textarea')`);
  await cdp.waitFor(
    `!![...document.querySelectorAll('button')].find(b => b.textContent.includes('Wgraj obraz'))`,
    20000,
    200,
    "moodboard reopened after localStorage wipe (DB restore)"
  );
  await sleep(800);
  const afterWipe = await cdp.evaluate(`(() => ({
    keywords: [...document.querySelectorAll('span')].filter(s => s.textContent.includes('mroczny')).length,
    images: [...document.querySelectorAll('img')].filter(i => (i.src || '').startsWith('data:image')).length,
  }))()`);
  check(afterWipe.keywords === 1, "keyword restored from the DB after the localStorage wipe");
  check(afterWipe.images === 1, "uploaded image restored from the DB after the localStorage wipe");
}

async function scenarioFlowAndRelease(cdp, url) {
  console.log("\n== 4. Flow Meter — accurate syllable counts ==");
  await cdp.freshSlate(url);
  check(await cdp.clickText("Flow Meter"), "enabled flow meter toggle");
  await sleep(400);
  await cdp.waitFor(
    `[...document.querySelectorAll('h3')].some(h => h.textContent.includes('Flow Meter'))`,
    10000,
    150,
    "flow meter panel rendered"
  );

  // Known counts (verified by the syllable-counter unit tests):
  //   miasto(2) serce(2) → 4 | ciemność → 2 | horyzont(3) muzyka(3) → 6 | idea(3) teatr(2) → 5
  const lyrics = "miasto serce\nciemność\nhoryzont muzyka\nidea teatr";
  check(await cdp.setTextarea(lyrics), "typed lyrics with known syllable counts");
  await sleep(500);

  const bars = await cdp.evaluate(`(() => {
    const panel = [...document.querySelectorAll('h3')].find(h => h.textContent.includes('Flow Meter'))?.closest('.rounded-xl');
    if (!panel) return [];
    return [...panel.querySelectorAll('div.flex.items-center.gap-2.group')]
      .map(row => row.querySelector('span[class*="inset-0"]')?.textContent.trim())
      .filter(Boolean);
  })()`);
  check(
    JSON.stringify(bars) === JSON.stringify(["4s", "2s", "6s", "5s"]),
    `per-line syllable bars accurate (got ${JSON.stringify(bars)})`
  );

  const sidebar = await cdp.evaluate(`(() => {
    const panel = [...document.querySelectorAll('h3')].find(h => h.textContent.includes('Analiza Wersów'))?.closest('.rounded-xl');
    if (!panel) return [];
    return [...panel.querySelectorAll('span.text-amber-500')].map(s => s.textContent.trim());
  })()`);
  check(
    JSON.stringify(sidebar) === JSON.stringify(["4s", "2s", "6s", "5s"]),
    `sidebar per-line syllables match (got ${JSON.stringify(sidebar)})`
  );

  const total = await cdp.evaluate(`(() => {
    const el = [...document.querySelectorAll('span')].find(s => s.textContent.includes('sylab') && /^🔤/.test(s.textContent.trim()));
    return el ? el.textContent.trim() : null;
  })()`);
  check(total === "🔤 17 sylab", `total syllable count correct (got ${total})`);

  const metric = (label) =>
    cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('div.px-3.py-2.rounded-lg')];
      const card = cards.find(c => c.querySelector('p')?.textContent.trim() === ${JSON.stringify(label)});
      const ps = card ? [...card.querySelectorAll('p')] : [];
      return ps.length >= 2 ? { value: ps[1].textContent.trim(), sub: ps[2]?.textContent.trim() } : null;
    })()`);
  const avg = await metric("Śr. sylab/wers");
  check(avg?.value === "4.3", `avg syllables/line = 4.3 (got ${avg?.value})`);
  const breath = await metric("Oddech");
  check(breath?.value === "OK" && breath?.sub === "brak ostrzeżeń", `breath check OK (no >16-syllable lines) (got ${JSON.stringify(breath)})`);
  const rhyme = await metric("Rymowanie");
  check(rhyme?.value === "—", `rhyme density shows — when rhyme analysis is off (got ${rhyme?.value})`);
  const flow = await metric("Flow");
  check(
    flow && /^\d+%$/.test(flow.value) && ["Idealny", "Znośny", "Nierówny"].includes(flow.sub),
    `flow consistency is a sane percentage (got ${JSON.stringify(flow)})`
  );

  console.log("\n== 5. Release Plan — milestones, dates, persistence ==");
  // The plan is DB-primary now — scenario 4's freshSlate cleared the
  // persisted row, so the panel mounts with factory defaults (11, 0 done).
  check(await cdp.clickText("Release Plan"), "enabled release plan toggle");
  await sleep(400);
  await cdp.waitFor(
    `[...document.querySelectorAll('h3')].some(h => h.textContent.includes('Release Plan'))`,
    10000,
    150,
    "release plan panel rendered"
  );

  const progressText = () =>
    cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll('span')].find(s => /^\\d+\\/\\d+ \\(\\d+%\\)$/.test(s.textContent.trim()));
      return el ? el.textContent.trim() : null;
    })()`);
  const rpPanel = () => `[...document.querySelectorAll('h3')].find(h => h.textContent.includes('Release Plan'))?.closest('.rounded-xl')`;

  check((await progressText()) === "0/11 (0%)", `defaults: 11 milestones, 0 done (got ${await progressText()})`);

  check(
    await cdp.evaluate(`(() => {
      const panel = ${rpPanel()};
      const btn = panel?.querySelector('button[class*="rounded-md"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`),
    "toggled first milestone done"
  );
  await sleep(400);
  check((await progressText()) === "1/11 (9%)", `progress after toggle (got ${await progressText()})`);

  check(await cdp.clickText("Dodaj własne zadanie"), "opened add-task form");
  await sleep(300);
  await cdp.setInput('input[placeholder="Nazwa zadania..."]', "Konsultacje z menedżerem");
  await sleep(200);
  check(
    await cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Dodaj');
      if (!btn) return false;
      btn.click();
      return true;
    })()`),
    "confirmed custom task"
  );
  await sleep(400);
  check((await progressText()) === "1/12 (8%)", `custom task added: 12 total (got ${await progressText()})`);
  check(
    await cdp.evaluate(`[...document.querySelectorAll('span')].some(s => s.textContent.includes('Konsultacje z menedżerem'))`),
    "custom task label rendered"
  );

  check(
    await cdp.evaluate(`(() => {
      const panel = ${rpPanel()};
      const rows = [...panel.querySelectorAll('div.flex.items-center.gap-2.group')];
      const row = rows.find(r => r.textContent.includes('Konsultacje z menedżerem'));
      const btn = row?.querySelector('button');
      if (!btn) return false;
      btn.click();
      return true;
    })()`),
    "toggled custom task done"
  );
  await sleep(400);
  check((await progressText()) === "2/12 (17%)", `progress with custom done (got ${await progressText()})`);

  check(await cdp.setInput('input[type="date"]', "2026-12-01"), "set target release date");
  await sleep(400);
  const daysBadge = await cdp.evaluate(`(() => {
    const el = [...document.querySelectorAll('span')].find(s => /^\\d+d$/.test(s.textContent.trim()));
    return el ? el.textContent.trim() : null;
  })()`);
  check(/^\d+d$/.test(daysBadge || ""), `countdown badge appears for the future date (got ${daysBadge})`);

  // Let the debounced DB sync (800ms) land before the reload — the panel
  // restores from the DB on mount, so a premature reload would lose the
  // last change even though the localStorage mirror has it.
  await sleep(1200);
  await cdp.send("Page.reload");
  await cdp.waitFor(`document.readyState === 'complete'`);
  await cdp.waitFor(`!!document.querySelector('textarea')`);
  await cdp.waitFor(
    `[...document.querySelectorAll('h3')].some(h => h.textContent.includes('Release Plan'))`,
    20000,
    200,
    "release plan reopened after reload"
  );
  await sleep(500);
  check((await progressText()) === "2/12 (17%)", `progress persisted after reload (got ${await progressText()})`);
  const restored = await cdp.evaluate(`(() => {
    const panel = ${rpPanel()};
    const rows = [...panel.querySelectorAll('div.flex.items-center.gap-2.group')];
    const custom = rows.find(r => r.textContent.includes('Konsultacje z menedżerem'));
    const firstCheckbox = panel.querySelector('button[class*="rounded-md"]');
    const date = panel.querySelector('input[type="date"]');
    return {
      customPresent: !!custom,
      customDone: custom ? custom.querySelector('button')?.textContent.includes('✓') : false,
      firstDone: firstCheckbox ? firstCheckbox.textContent.includes('✓') : false,
      date: date ? date.value : null,
    };
  })()`);
  check(restored.customPresent === true, "custom task persisted across reload");
  check(restored.customDone === true, "custom task done-state persisted");
  check(restored.firstDone === true, "first milestone done-state persisted");
  check(restored.date === "2026-12-01", `target release date persisted (got ${restored.date})`);
}

// ── Main ─────────────────────────────────────────────────────────────
const cdpPort = CDP_PORT || (await freePort());
let appUrl = process.env.VAULT_URL;
let usingOwnServer = false;
let cdp = null;
let runFailed = false;

if (!appUrl) {
  const running = await findRunningDevServer();
  if (running) {
    // Reusing the running server is intentionally refused: it is bound to
    // prisma/dev.db, so tests against it would modify the user's real data.
    console.error(`
✗ A dev server is already running at ${running}.
  The test now runs against an ISOLATED copy of the database, so it must start
  its own dev server (Next.js allows only one dev server per project directory).

  Options:
    1) Stop the running dev server and re-run — the test copies prisma/dev.db
       to a temp file, tests against it, and deletes it. Your data is untouched.
    2) Start your own isolated server first:
         DATABASE_URL="file:./prisma/e2e-isolated.db" npx next dev -p 3000
       (copy prisma/dev.db to prisma/e2e-isolated.db first), then run:
         VAULT_URL=http://127.0.0.1:3000/vault npm run test:ui
       and delete prisma/e2e-isolated.db afterwards.`);
    process.exit(1);
  }
  const appPort = PORT || (await freePort());
  appUrl = `http://127.0.0.1:${appPort}/vault`;
  usingOwnServer = true;
  console.log(`FlowForge Vault UI test — isolated DB, own dev server on :${appPort}, Chrome CDP on :${cdpPort}`);
  prepareIsolatedDb();
}

try {
  if (usingOwnServer) {
    await startDevServer(Number(new URL(appUrl).port));
  } else {
    console.log(`  • using dev server: ${appUrl}`);
  }
  await startChrome(cdpPort);

  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("No page target found on the CDP port");
  cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.open();

  await scenarioRhymeMetronomeMoodboard(cdp, appUrl);
  await scenarioFlowAndRelease(cdp, appUrl);
  await scenarioDashboard(cdp, appUrl);
  await scenarioStudio(cdp, appUrl);
  await scenarioSaveProject(cdp, appUrl);
  await scenarioChallenges(cdp, appUrl);
  await scenarioFeed(cdp, appUrl);
  await scenarioInspirations(cdp, appUrl);
  await scenarioVersionsArchive(cdp, appUrl);
  await scenarioCoverArt(cdp, appUrl);
  await scenarioProfile(cdp, appUrl);
  await scenarioTrackArchive(cdp, appUrl);
  await scenarioRecordings(cdp, appUrl);
  await scenarioBudget(cdp, appUrl);
  await scenarioStemMixer(cdp, appUrl);
  await scenarioPwa(cdp, appUrl);
  await scenarioSweepRecordings(cdp, appUrl);
  await scenarioInstallPrompt(cdp, appUrl);
  await scenarioStemUpload(cdp, appUrl);
  await scenarioAcademy(cdp, appUrl);
  await scenarioEditBeat(cdp, appUrl);
  await scenarioCreateCypher(cdp, appUrl);
} catch (err) {
  runFailed = true;
  console.error(`\n✗ Test run aborted: ${err.message}`);
} finally {
  if (cdp) cdp.close();
  await stopChrome(cdpPort);
  if (usingOwnServer) {
    stopDevServer();
    // The isolated copy is deleted wholesale — prisma/dev.db was never
    // touched, so no row-level cleanup is needed (or safe) here.
    try {
      await prisma().$disconnect();
    } catch { /* not connected */ }
    cleanupIsolatedDb();
  }
}

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(runFailed || failures > 0 ? 1 : 0);
