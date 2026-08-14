#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────
// Browser E2E verification of the The Vault tools (no npm dependencies):
//
//   • Rhyme markers  — mirror rendered, rhyme groups marked, markers track
//     textarea scrolling (dynamic, not static rectangles)
//   • Metronome      — Web Audio lookahead scheduling: exact osc.start(t)
//     spacing at 90/95 BPM, live tempo change, stop cancels all timers
//   • Moodboard      — image upload, drag & drop reordering, persistence,
//     DB sync (keyword lands in the board row) + restore from the DB after
//     a localStorage wipe
//   • Flow Meter     — syllable counts accurate (regression: stateful regex)
//   • Release Plan   — milestones toggle/add, target date, persistence  //   • Dashboard      — streak, level bar, active-challenge tile (countdown,
  //     submit flow), „Ostatnio Edytowane” empty state, recent-lyrics deep
  //     links, live refresh reorder on the vault save event, /vault?track=<id>
  //     deep-link navigation + unknown-id fallback, stats grid, budget tile,
  //     „Ostatnio zapisane projekty” tile (DB-primary, live-refresh event)
//   • Studio         — teleprompter (pick text, fullscreen scroll, pause,
//     close) and clip timeline (select take, marker, split, undo/redo,
//     reload persistence)
//   • Save Project    — modal summary + custom name, project lands in the
//     „Gotowe Numery” library and renders on /beats across reloads
//   • Challenges      — DB-primary progress render (score/count/percent),
//     auto-award of achievements, „Resetuj postęp” wipes DB + mirror + badges
//   • Feed            — seeded post render, like toggle, 5★ rating, comment
//     thread, publishing a new post (all DB-backed)  //   • Inspirations    — seeded cards (difficulty + tags), optimistic voting
  //     with DB persistence, search + difficulty/tag filters, adding new rows
  //   • Profile          — DB-primary edit (name/bio/avatar) with persistence
  //     across reloads, level bar + stats grid + achievements from the DB
  //   • Track Archive     — „📦 Archiwum” section in the Vault: hide a track
  //     (status archived, editor switches away), restore, permanent delete
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
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
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
  await db.beat.create({
    data: { title: "Testowy Bit", bpm: 90, duration: 120, filePath: "/test-beat-a.wav" },
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
    // The dashboard has no textarea — wait for the challenge tile instead.
    await cdp.goto(root, `document.body.textContent.includes('Aktywne wyzwanie')`);

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

  await cdp.goto(root + "/vault", `!!document.querySelector('textarea')`);
  await cdp.evaluate(`localStorage.clear(); true`);
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
  // via awardPoints' recompute; deleteAchievement already removed the row).
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
