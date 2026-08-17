import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  console.log("🌱 Seeding FlowForge database...");

  // WAL journaling (persistent per-file). db:reset recreates the file in
  // default delete-journal mode, so re-assert it after every reset.
  // $queryRawUnsafe (not $executeRawUnsafe): PRAGMA journal_mode returns a
  // result row, which $executeRaw rejects on SQLite (P2010).
  await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL");

  // ─── USER PROFILE ─────────────────────────────────────────────────
  // Points/level match the seeded achievements below (awardPoints
  // recomputes totalPoints from achievements, so keep them in sync).
  // `update: {}` — re-running the seed on an existing DB must never clobber
  // a user's real progress; the rich demo values only apply on a fresh DB.
  await prisma.userProfile.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      displayName: "MC",
      totalPoints: 150,
      level: 3,
      avatarEmoji: "🎤",
      bio: "",
    },
  });

  // ─── COMMUNITY CHALLENGES (cyphery) ────────────────────────────────
  // One rolling community cypher so the dashboard tile always has a deadline
  // to show. The end date rolls forward on every seed so the demo never
  // silently expires.
  const cypherEnd = new Date(Date.now() + 21 * DAY);
  await prisma.challenge.upsert({
    where: { id: "cypher-miasto" },
    update: { endDate: cypherEnd, isActive: true },
    create: {
      id: "cypher-miasto",
      title: "Cypher: Moje Miasto",
      description: "Napisz wers o swoim mieście — blokowisko, ulice, ludzie. Najlepsze wersy trafią na Ścianę Raperów.",
      theme: "miasto",
      prize: "🔥 Wyróżnienie na Ścianie Raperów",
      endDate: cypherEnd,
      isActive: true,
    },
  });
  // A second cypher — ends later so the dashboard tile keeps showing the
  // soonest deadline („Moje Miasto”).
  const bitwaEnd = new Date(Date.now() + 30 * DAY);
  await prisma.challenge.upsert({
    where: { id: "cypher-bitwa" },
    update: { endDate: bitwaEnd, isActive: true },
    create: {
      id: "cypher-bitwa",
      title: "Bitwa Freestyle",
      description: "Rozpisz 8 wersów o ulubionej technice rapowania. Najostrzejsze wejście wygrywa bitwę.",
      theme: "freestyle",
      prize: "🎁 Beat na zamówienie",
      endDate: bitwaEnd,
      isActive: true,
    },
  });
  // A couple of demo submissions so the cypher looks lived-in.
  const demoSubs = [
    { authorName: "Raper X", title: "Moje osiedle", content: "Blokowisko szare, ale serce w nim bije..." },
    { authorName: "Raper Y", title: "Ulice miasta", content: "Asfalt pod stopami, dym nad dachami..." },
  ];
  for (const sub of demoSubs) {
    const exists = await prisma.challengeSubmission.findFirst({
      where: { challengeId: "cypher-miasto", authorName: sub.authorName, title: sub.title },
    });
    if (!exists) {
      await prisma.challengeSubmission.create({
        data: { challengeId: "cypher-miasto", ...sub, voteCount: 3 },
      });
    }
  }

  // ─── SAMPLE BEATS (Gotowe Numery) ─────────────────────────────────
  const beats = [
    {
      id: "beat-miejski-rytm",
      title: "Miejski Rytm",
      artist: "FlowForge",
      bpm: 92,
      key: "Dm",
      genre: "Boom Bap",
      tags: "ulica,klasyk",
      duration: 8, // matches the generated public/test-beat-a.wav
      filePath: "/test-beat-a.wav",
      // Staggered lastPlayedAt — the dashboard „Ostatnio Użyte” widget
      // reads real history (most recently played first).
      lastPlayedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      // Stem mixer demo — each track rendered by scripts/generate-demo-beats.mjs.
      isStems: true,
      stemsData: JSON.stringify({
        drums: "/stems/miejski-rytm-drums.wav",
        bass: "/stems/miejski-rytm-bass.wav",
        melody: "/stems/miejski-rytm-melody.wav",
        vocals: "/stems/miejski-rytm-vocals.wav",
      }),
    },
    {
      id: "beat-nocny-drive",
      title: "Nocny Drive",
      artist: "FlowForge",
      bpm: 128,
      key: "Am",
      genre: "Trap",
      tags: "trap,noc",
      duration: 8, // matches the generated public/test-beat-b.wav
      filePath: "/test-beat-b.wav",
      lastPlayedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
    },
    {
      id: "beat-stary-blok",
      title: "Stary Blok",
      artist: "FlowForge",
      bpm: 85,
      key: "Cm",
      genre: "Lo-Fi",
      tags: "lofi,nostalgia",
      duration: 8, // matches the generated public/test-beat-a.wav
      filePath: "/test-beat-a.wav",
      lastPlayedAt: new Date(Date.now() - 3 * DAY),
    },
  ];
  for (const b of beats) {
    await prisma.beat.upsert({
      where: { id: b.id },
      // update mirrors create so re-running the seed keeps stems/files in sync.
      update: {
        title: b.title,
        artist: b.artist,
        bpm: b.bpm,
        key: b.key,
        genre: b.genre,
        tags: b.tags,
        duration: b.duration,
        filePath: b.filePath,
        isStems: b.isStems || false,
        stemsData: b.stemsData || null,
        lastPlayedAt: b.lastPlayedAt,
      },
      create: { ...b },
    });
  }

  // ─── INSPIRATIONS (Hall of Fame) ──────────────────────────────────
  const inspirations = [
    {
      id: "inspo-ulica",
      artist: "O.S.T.R.",
      songTitle: "Sztuka ulicy",
      lyrics: "Na klatce schodowej, gdzie ściany mają uszy,\nkażdy wers to kawałek tej samej duszy.",
      difficulty: "medium",
      tags: JSON.stringify(["street", "opowiesci"]),
      year: 2008,
      voteCount: 4,
    },
    {
      id: "inspo-blok",
      artist: "Peja",
      songTitle: "Blok",
      lyrics: "Z betonu wyrastam, beton we mnie siedzi,\nkażdy blok ma swoją prawdę i swoich sąsiadów.",
      difficulty: "hard",
      tags: JSON.stringify(["battle", "ulica"]),
      year: 2001,
      voteCount: 2,
    },
    {
      id: "inspo-miasto",
      artist: "Ten Typ Mes",
      songTitle: "Miasto w ogniu",
      lyrics: "Neonowe ognie nad mokrym asfaltem,\nmiasto nie śpi, bo sen to dla słabych.",
      difficulty: "medium",
      tags: JSON.stringify(["metafory", "noc"]),
      year: 2015,
      voteCount: 6,
    },
  ];
  for (const i of inspirations) {
    await prisma.lyricalInspiration.upsert({
      where: { id: i.id },
      update: { songTitle: i.songTitle, lyrics: i.lyrics, voteCount: i.voteCount },
      create: { ...i },
    });
  }

  // ─── CHALLENGE PROGRESS (personal, /challenges) ────────────────────
  // A „demo user” that already finished two challenges — the page shows
  // 2 z 10 ukończonych, 150 pkt, and two badges on the dashboard.
  const seededProgress = {
    completed: {
      "szybki-start": new Date(Date.now() - 2 * DAY).toISOString(),
      "mistrz-rymu": new Date(Date.now() - DAY).toISOString(),
    },
    stats: {
      takes: 1,
      splits: 0,
      trims: 0,
      volumeChanges: 0,
      beats: 1,
      lyricsLines: 14,
      teleprompterOpens: 1,
      projectsSaved: 0,
    },
    updatedAt: new Date().toISOString(),
  };
  await prisma.challengeProgress.upsert({
    where: { id: "default" },
    update: {}, // never overwrite real progress on re-seed
    create: { id: "default", content: JSON.stringify(seededProgress) },
  });

  // Matching achievements (same ids/points as lib/challenges.ts) so the
  // profile total stays consistent with awardPoints' recompute-from-sum.
  const seededAchievements = [
    {
      badgeId: "challenge-szybki-start",
      badgeName: "Szybki Start",
      badgeIcon: "⚡",
      badgeDescription: "Nagraj pierwszy take wokalny w Studio.",
      points: 50,
    },
    {
      badgeId: "challenge-mistrz-rymu",
      badgeName: "Mistrz Rymu",
      badgeIcon: "🎤",
      badgeDescription: "Napisz co najmniej 8 wersów w The Vault.",
      points: 100,
    },
  ];
  for (const a of seededAchievements) {
    await prisma.userAchievement.upsert({
      where: { badgeId: a.badgeId },
      update: {}, // never overwrite real achievements on re-seed
      create: { ...a },
    });
  }

  // ─── COVERS (Generator Okładek) ────────────────────────────────────
  // Two example artworks so /cover shows a populated „Zapisane Okładki”
  // gallery from the first launch. imageUrl is a lightweight SVG data URL
  // (renders fine in <img>) — user-saved covers store a full PNG data URL.
  const coverSvg = (title: string, artist: string, from: string, to: string) => {
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='1080'>` +
      `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
      `<stop offset='0' stop-color='${from}'/><stop offset='1' stop-color='${to}'/>` +
      `</linearGradient></defs>` +
      `<rect width='1080' height='1080' fill='url(#g)'/>` +
      `<text x='540' y='500' font-family='Arial Black, sans-serif' font-size='88' ` +
      `fill='#f59e0b' text-anchor='middle'>${title}</text>` +
      `<text x='540' y='620' font-family='Inter, sans-serif' font-size='40' ` +
      `fill='#fde68a' opacity='0.8' text-anchor='middle'>${artist}</text>` +
      `</svg>`;
    return "data:image/svg+xml," + encodeURIComponent(svg);
  };
  const covers = [
    {
      id: "cover-ulicznik",
      title: "Ulicznik",
      artistName: "MC Beton",
      bgPattern: "dark",
      textColor: "#f59e0b",
      filterStyle: "noir",
      fontSize: 52,
      fontFamily: "Arial Black",
      imageUrl: coverSvg("ULICZNIK", "MC Beton", "#18181b", "#09090b"),
      layoutData: JSON.stringify({ noiseOpacity: 0.08, vignetteOpacity: 0.35, filterValue: "grayscale(1) contrast(1.3)" }),
    },
    {
      id: "cover-goracy",
      title: "Gorący Wers",
      artistName: "DJ Płomień",
      bgPattern: "gradient1",
      textColor: "#ffffff",
      filterStyle: "warm",
      fontSize: 44,
      fontFamily: "Georgia",
      imageUrl: coverSvg("GORĄCY WERS", "DJ Płomień", "#d97706", "#9333ea"),
      layoutData: JSON.stringify({ noiseOpacity: 0.05, vignetteOpacity: 0.3, filterValue: "sepia(0.2) saturate(1.3) brightness(1.05)" }),
    },
  ];
  for (const c of covers) {
    await prisma.coverArt.upsert({
      where: { id: c.id },
      update: { title: c.title, artistName: c.artistName, imageUrl: c.imageUrl },
      create: { ...c },
    });
  }

  console.log("✅ Database seeded!");
  console.log("   • User profile (MC, 150 pkt, poziom 3)");
  console.log("   • Challenges: „Cypher: Moje Miasto” (+2 zgłoszenia), „Bitwa Freestyle”");
  console.log("   • Beats: 3 sample instrumentals (Gotowe Numery)");
  console.log("   • Inspirations: 3 sample entries (Hall of Fame)");
  console.log("   • Covers: 2 sample artworks (Generator Okładek)");
  console.log("   • Challenge progress: 2/10 ukończonych, 150 pkt");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
