// ─── DB wiring validation ──────────────────────────────────────────────
// Exercises every server action wired into the pages end-to-end. This test
// CLEARS whole tables for deterministic assertions — so it runs against a
// throwaway COPY of prisma/dev.db (see ./_db-isolation, imported first: it
// points DATABASE_URL at the copy before the server actions below construct
// their PrismaClient). The real dev.db is never opened; the copy is deleted
// in the finally block even when the run crashes.
import "./_db-isolation"; // ⚠ must stay the FIRST import — sets DATABASE_URL
import { cleanupIsolatedDb } from "./_db-isolation";

import { PrismaClient } from "@prisma/client";

import {
  createLyric,
  getAllLyrics,
  getLyric,
  saveLyricVersion,
  updateLyric,
  deleteLyric,
  deleteLyricVersion,
  getLyricVersionStats,
  getArchivedLyricVersions,
  archiveLyricVersion,
  restoreLyricVersion,
  purgeArchivedLyricVersions,
  ratePost,
  addComment,
} from "../src/actions/lyrics";
import { MAX_ACTIVE_VERSIONS_PER_LYRIC } from "../src/lib/lyric-versions";
import { createPost, getFeedPosts } from "../src/actions/community";
import { createExpense, getExpenses, deleteExpense } from "../src/actions/budget";
import { awardPoints, getProfile, updateProfile, deleteAchievement } from "../src/actions/achievements";
import { createBeat, getBeats, deleteBeat, saveProject, getProjects, deleteProject } from "../src/actions/beats";
import { saveCover, getCovers, deleteCover } from "../src/actions/covers";
import type { SavedProject } from "../src/components/studio/types";
import { createInspiration, getInspirations } from "../src/actions/inspirations";
import { exportLyricAsText, getExportHistory } from "../src/actions/export";
import { prisma as appPrisma } from "../src/lib/prisma";

const prisma = new PrismaClient();
let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${msg}`);
  }
}

async function main() {
  try {
    // Deterministic start: clear the tables the assertions count on. This is
    // safe — everything runs on the isolated copy, and the copy is deleted
    // afterwards (dev.db is never opened). The profile row is kept on purpose:
    // awardPoints recomputes its totalPoints from the achievements below.
    await prisma.$transaction([
      prisma.lyricVersion.deleteMany(),
      prisma.lyric.deleteMany(),
      prisma.budgetExpense.deleteMany(),
      prisma.communityPost.deleteMany(),
      prisma.userAchievement.deleteMany(),
      prisma.beat.deleteMany(),
      prisma.savedProject.deleteMany(),
      prisma.coverArt.deleteMany(),
      prisma.lyricalInspiration.deleteMany(),
      prisma.exportLog.deleteMany(),
    ]);

    console.log("📝 Lyrics (Vault)");
    const lyric = await createLyric({ title: "Testowy Tekst", content: "Wers pierwszy\nWers drugi", lineCount: 2, verseCount: 1, syllableCount: 8, wordCount: 4 });
    assert(!!lyric.id, "createLyric returns a row with id");
    assert(lyric.wordCount === 4, "createLyric stores the word count");
    const v1 = await saveLyricVersion({ lyricId: lyric.id, content: "Wers pierwszy\nWers drugi", label: "Seedowana wersja - 10.08.2026" });
    assert(!!v1.id && v1.label === "Seedowana wersja - 10.08.2026", "saveLyricVersion creates a labeled version");
    const all = await getAllLyrics({ limit: 1 });
    assert(all.length === 1 && all[0].title === "Testowy Tekst", "getAllLyrics returns the imported lyric");
    assert(all[0]._count?.versions === 1, "getAllLyrics reports the version count (track list)");
    assert(all[0].wordCount === 4, "getAllLyrics exposes the word count (track list)");
    assert(all[0].syllableCount === 8, "getAllLyrics exposes the syllable count (track list)");
    assert(all[0].versions?.[0]?.label === "Seedowana wersja - 10.08.2026", "getAllLyrics exposes recent version labels (track-list search)");
    const full = await getLyric(lyric.id);
    assert((full?.versions.length ?? 0) === 1, "getLyric includes versions");
    await deleteLyricVersion(v1.id);
    const afterDelete = await getLyric(lyric.id);
    assert((afterDelete?.versions.length ?? 0) === 0, "deleteLyricVersion removes the version");

    console.log("📤 Export");
    const exported = await exportLyricAsText(lyric.id);
    assert(exported.includes("Testowy Tekst") && exported.includes("Statystyki") && exported.includes("Linii: 2") && exported.includes("Słów: 4"), "exportLyricAsText returns the formatted text with stats (incl. words)");
    const history = await getExportHistory(lyric.id);
    assert(history.length === 1 && history[0].format === "txt", "export creates an ExportLog row seen by getExportHistory");
    const allHistory = await getExportHistory();
    assert(allHistory.length === 1, "getExportHistory without filter lists all exports");
    const renamed = await updateLyric(lyric.id, { title: "Nowa nazwa" });
    assert(renamed.title === "Nowa nazwa", "updateLyric changes the title (inline rename)");
    assert((await getLyric(lyric.id))?.title === "Nowa nazwa", "the rename persists to the row");
    await deleteLyric(lyric.id);
    assert((await getLyric(lyric.id)) === null, "deleteLyric removes the track");
    assert((await getExportHistory(lyric.id)).length === 0, "deleting the track detaches its export logs");

    // Track archive — Lyric.status = "archived" drives the Vault „📦 Archiwum”
    // section (hidden from the working list, restorable back to draft).
    const archivedTrack = await createLyric({ title: "Do Archiwum", content: "Wers", lineCount: 1, verseCount: 1, syllableCount: 4, wordCount: 1 });
    await updateLyric(archivedTrack.id, { status: "archived" });
    const archivedList = await getAllLyrics({ status: "archived" });
    assert(archivedList.length === 1 && archivedList[0].id === archivedTrack.id, "getAllLyrics({ status: 'archived' }) returns the archived track");
    const activeList = await getAllLyrics({ excludeArchived: true, limit: 100 });
    assert(!activeList.some((l) => l.id === archivedTrack.id), "getAllLyrics({ excludeArchived: true }) hides archived tracks from the working list");
    await updateLyric(archivedTrack.id, { status: "draft" });
    assert((await getAllLyrics({ status: "archived" })).length === 0, "restoring the status to draft empties the archive query");
    await deleteLyric(archivedTrack.id);

    console.log("💰 Budget");
    const exp = await createExpense({ category: "mix_master", title: "Mix i mastering", amount: 350, currency: "PLN", project: "EP 2026" });
    assert(!!exp.id && exp.amount === 350, "createExpense persists an expense");
    const expenses = await getExpenses({ project: "EP 2026" });
    assert(expenses.length === 1 && expenses[0].title === "Mix i mastering", "getExpenses filters by project");
    await deleteExpense(exp.id);
    assert((await getExpenses({ project: "EP 2026" })).length === 0, "deleteExpense removes the row");

    console.log("🔥 Feed");
    const post = await createPost({ title: "Nowy numer", content: "Refren\nZwrotka", authorName: "Ty", authorAvatar: "🎤" });
    assert(!!post.id && post.authorName === "Ty", "createPost persists a post");
    await ratePost(post.id, 5, "Ty");
    await addComment(post.id, "Mocny numer!", "Ty");
    const feed = await getFeedPosts();
    assert(feed.length === 1, "getFeedPosts returns the post");
    assert(feed[0].rating === 5 && feed[0].ratingCount === 1, "rating rolls up into the feed post");
    assert(feed[0].comments.length === 1 && feed[0].comments[0].content === "Mocny numer!", "comment is included in the feed post");

    console.log("🏅 Achievements / Profile");
    // Note: createExpense above already awarded the "manager" badge (15 pts),
    // so the profile carries it into these assertions.
    const badgeId = "challenge-szybki-start";
    await awardPoints(badgeId, "Szybki Start", "⚡", "Nagraj pierwszy take wokalny w Studio.", 50);
    await awardPoints(badgeId, "Szybki Start", "⚡", "dupe", 9999); // idempotent — no double award
    const prof = await getProfile();
    assert(prof && prof.totalPoints === 65, `awardPoints is idempotent (50 + 15 manager = 65, got ${prof?.totalPoints})`);
    assert(prof && prof.achievements.length === 2, `profile lists manager + challenge (got ${prof?.achievements.length})`);
    const updated = await updateProfile({ displayName: "Młody MC", bio: "Raper z osiedla" });
    assert(updated.displayName === "Młody MC" && updated.bio === "Raper z osiedla", "updateProfile upserts the profile");
    await deleteAchievement(badgeId);
    const profileAfterDelete = await getProfile();
    assert(profileAfterDelete && profileAfterDelete.totalPoints === 15, `deleteAchievement removes only the target badge (15 manager left, got ${profileAfterDelete?.totalPoints})`);

    console.log("🎵 Beats");
    const beat = await createBeat({ title: "Moj bit", artist: "Wgrany bit", bpm: 90, key: "Am", genre: "Demo", filePath: "data:audio/wav;base64,AAAA" });
    assert(!!beat.id, "createBeat persists a beat");
    const beats = await getBeats();
    assert(beats.length === 1 && beats[0].title === "Moj bit", "getBeats returns the beat");
    await deleteBeat(beat.id);
    assert((await getBeats()).length === 0, "deleteBeat removes the beat");

    console.log("🎛️ Saved Projects (Studio library)");
    const proj: SavedProject = {
      kind: "project",
      id: "proj-test-1",
      title: "Moj numer",
      artist: "Studio",
      genre: "Z bitem",
      duration: "1:23",
      beatName: "Miejski Rytm",
      beatVolume: 0.8,
      teleprompterText: "Wers testowy",
      teleprompterSpeed: 1,
      takes: [{ id: "t1", label: "Take 1", duration: 8, offset: 0, volume: 1, isMuted: false, isSoloed: false, trimStart: 0, trimEnd: 1 }],
      clips: [{ takeId: "t1", items: [] }],
      savedAt: new Date().toISOString(),
    };
    const saved = await saveProject(proj);
    assert(!!saved.id && saved.dbId === saved.id && saved.id !== "proj-test-1", "saveProject persists and adopts the DB id");
    const projects = await getProjects();
    assert(projects.length === 1 && projects[0].title === "Moj numer", "getProjects returns saved projects");
    assert(projects[0].dbId === saved.id && projects[0].sourceId === "proj-test-1", "getProjects exposes both stable ids (dedup key)");
    assert(projects[0].takes?.length === 1 && projects[0].takes?.[0].label === "Take 1", "getProjects round-trips the full take state");
    await deleteProject(saved.id);
    assert((await getProjects()).length === 0, "deleteProject removes the project");

    console.log("🖼️ Covers (Generator Okładek)");
    const cover = await saveCover({
      title: "Moj numer",
      artistName: "MC Test",
      bgPattern: "dark",
      textColor: "#f59e0b",
      filterStyle: "noir",
      fontSize: 52,
      fontFamily: "Arial Black",
      imageUrl: "data:image/svg+xml,PHN2Zz48L3N2Zz4=",
      layoutData: JSON.stringify({ noiseOpacity: 0.08, vignetteOpacity: 0.3 }),
    });
    assert(!!cover.id && cover.title === "Moj numer" && cover.artistName === "MC Test", "saveCover persists the artwork with its settings");
    assert(cover.bgPattern === "dark" && cover.filterStyle === "noir" && cover.fontSize === 52, "saveCover stores the design settings");
    const covers = await getCovers();
    assert(covers.length === 1 && covers[0].title === "Moj numer" && covers[0].imageUrl?.startsWith("data:image/") === true, "getCovers returns the saved cover (newest first)");
    const layout = JSON.parse(covers[0].layoutData || "{}");
    assert(layout.noiseOpacity === 0.08 && layout.vignetteOpacity === 0.3, "layoutData round-trips the extra effect settings");
    await deleteCover(cover.id);
    assert((await getCovers()).length === 0, "deleteCover removes the cover");

    console.log("📚 Lyric versions (cap + archive)");
    const capLyric = await createLyric({ title: "Limit Test", content: "start", lineCount: 1, verseCount: 1, syllableCount: 2, wordCount: 1 });
    const MAX = MAX_ACTIVE_VERSIONS_PER_LYRIC;
    // Fill the track to the cap directly (fast), each with an increasing
    // createdAt so „oldest” is deterministic.
    await prisma.lyricVersion.createMany({
      data: Array.from({ length: MAX }, (_, i) => ({
        lyricId: capLyric.id,
        content: `wers ${i + 1}`,
        label: `seed-${i + 1}`,
        snapshot: i + 1,
        createdAt: new Date(Date.now() + i * 1000),
      })),
    });
    let stats = await getLyricVersionStats(capLyric.id);
    assert(stats.activeCount === MAX && stats.archivedCount === 0 && stats.limit === MAX, "getLyricVersionStats reports the cap exactly");
    const fiftyFirst = await saveLyricVersion({ lyricId: capLyric.id, content: "wers 51", label: "seed-51" });
    assert(fiftyFirst.snapshot === MAX + 1, "saveLyricVersion continues the snapshot sequence past the cap");
    stats = await getLyricVersionStats(capLyric.id);
    assert(stats.activeCount === MAX && stats.archivedCount === 1, "the 51st save auto-archives the oldest (active stays at the cap)");
    const archived1 = await getArchivedLyricVersions(capLyric.id);
    assert(archived1.length === 1 && archived1[0].label === "seed-1", "the OLDEST version is the one archived");
    const v2 = await prisma.lyricVersion.findFirst({ where: { lyricId: capLyric.id, label: "seed-2" } });
    await archiveLyricVersion(v2!.id);
    stats = await getLyricVersionStats(capLyric.id);
    assert(stats.activeCount === MAX - 1 && stats.archivedCount === 2, "manual archive moves a version out of the active set");
    await restoreLyricVersion(archived1[0].id); // room available → plain un-archive
    stats = await getLyricVersionStats(capLyric.id);
    assert(stats.activeCount === MAX && stats.archivedCount === 1, "restore with room returns the version to the active set");
    const v3 = await prisma.lyricVersion.findFirst({ where: { lyricId: capLyric.id, label: "seed-3" } });
    await archiveLyricVersion(v3!.id);
    await saveLyricVersion({ lyricId: capLyric.id, content: "wers 52", label: "seed-52" }); // back to the cap
    stats = await getLyricVersionStats(capLyric.id);
    assert(stats.activeCount === MAX && stats.archivedCount === 2, "at the cap again before the swap test");
    await restoreLyricVersion(v3!.id); // AT the cap → swap the oldest active
    stats = await getLyricVersionStats(capLyric.id);
    assert(stats.activeCount === MAX && stats.archivedCount === 2, "restore at the cap keeps the active set at the limit (swap)");
    const v3row = await prisma.lyricVersion.findUnique({ where: { id: v3!.id } });
    // seed-1 was restored in step 4, so it is the OLDEST active again — the
    // swap at the cap must archive IT (not seed-4).
    const s1row = await prisma.lyricVersion.findFirst({ where: { lyricId: capLyric.id, label: "seed-1" } });
    assert(v3row?.archivedAt === null && s1row?.archivedAt !== null, "restore at the cap archives the oldest active to make room");
    await purgeArchivedLyricVersions(capLyric.id);
    stats = await getLyricVersionStats(capLyric.id);
    assert(stats.activeCount === MAX && stats.archivedCount === 0, "purge removes all archived versions");
    const totalAfterPurge = await prisma.lyricVersion.count({ where: { lyricId: capLyric.id } });
    assert(totalAfterPurge === MAX, "purge hard-deletes only the archived rows (active untouched)");

    console.log("🏆 Inspirations");
    const insp = await createInspiration({ artist: "Paktofonika", songTitle: "Jestem Bogiem", lyrics: "To nie jest moja wina...", tags: ["klasyk"], difficulty: "medium" });
    assert(!!insp.id, "createInspiration persists an entry");
    const inps = await getInspirations();
    assert(inps.length === 1 && inps[0].songTitle === "Jestem Bogiem", "getInspirations returns the entry");
    const withTags = await getInspirations({ limit: 1 });
    assert(withTags[0].tags === JSON.stringify(["klasyk"]), "tags serialize to JSON");
  } finally {
    // Release the DB file locks BEFORE deleting the copy (the server actions'
    // Prisma singleton holds the query engine open until disconnected).
    await appPrisma.$disconnect().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    await cleanupIsolatedDb();
  }
  console.log(`\n${passed} assertions passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await appPrisma.$disconnect().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  await cleanupIsolatedDb();
  process.exit(1);
});
