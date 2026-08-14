"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import AppShell from "@/components/layout/AppShell";
import { useToast } from "@/components/studio/useToast";
import { ToastView } from "@/components/studio/ToastView";
import { loadCache, saveCache, tryDbWrite } from "@/lib/db-sync";
import { saveCover, getCovers, deleteCover } from "@/actions/covers";

type DbCover = Awaited<ReturnType<typeof getCovers>>[number];

/** localStorage mirror key — offline cache, the DB stays the source of truth. */
const COVERS_KEY = "flowforge-covers";

const BACKGROUNDS = [
  { id: "dark", label: "Ciemny", gradient: "from-zinc-900 to-zinc-950" },
  { id: "amber", label: "Bursztynowy", gradient: "from-amber-900 to-amber-950" },
  { id: "red", label: "Czerwony", gradient: "from-red-900 to-red-950" },
  { id: "blue", label: "Niebieski", gradient: "from-blue-900 to-blue-950" },
  { id: "purple", label: "Fioletowy", gradient: "from-purple-900 to-purple-950" },
  { id: "green", label: "Zielony", gradient: "from-emerald-900 to-emerald-950" },
  { id: "gradient1", label: "Gradient 1", gradient: "from-amber-600 via-red-600 to-purple-600" },
  { id: "gradient2", label: "Gradient 2", gradient: "from-blue-600 via-purple-600 to-pink-600" },
  { id: "gradient3", label: "Gradient 3", gradient: "from-emerald-600 via-cyan-600 to-blue-600" },
];

const FILTERS = [
  { id: "none", label: "Brak", value: "" },
  { id: "grain", label: "Grain", value: "contrast(1.1) saturate(1.2)" },
  { id: "vintage", label: "Vintage", value: "sepia(0.3) contrast(1.1) brightness(0.9)" },
  { id: "noir", label: "Noir", value: "grayscale(1) contrast(1.3)" },
  { id: "warm", label: "Ciepły", value: "sepia(0.2) saturate(1.3) brightness(1.05)" },
  { id: "cold", label: "Zimny", value: "hue-rotate(20deg) saturate(0.8) brightness(1.1)" },
];

const FONTS = ["Inter", "JetBrains Mono", "Georgia", "Arial Black", "Courier New"];

export default function CoverPage() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("Tytuł Utworu");
  const [artist, setArtist] = useState("MC Name");
  const [bgId, setBgId] = useState("dark");
  const [textColor, setTextColor] = useState("#f59e0b");
  const [bgColor, setBgColor] = useState("#09090b");
  const [fontSize, setFontSize] = useState(48);
  const [filter, setFilter] = useState("none");
  const [fontFamily, setFontFamily] = useState("Inter");
  const [noiseOpacity, setNoiseOpacity] = useState(0.05);
  const [vignetteOpacity, setVignetteOpacity] = useState(0.3);

  const currentBg = BACKGROUNDS.find((b) => b.id === bgId) || BACKGROUNDS[0];
  const currentFilter = FILTERS.find((f) => f.id === filter) || FILTERS[0];

  // Shared toast notifications (save / delete feedback).
  const { toast, showToast } = useToast();

  // ── Saved covers (DB-primary + localStorage mirror) ──
  const [savedCovers, setSavedCovers] = useState<DbCover[]>([]);
  const [coversLoaded, setCoversLoaded] = useState(false);

  // Render the current settings to a 1080×1080 canvas (shared by the PNG
  // download and the save action).
  const renderCoverCanvas = useCallback(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Draw background
    const gradient = ctx.createLinearGradient(0, 0, 1080, 1080);
    const bgColors: Record<string, string[]> = {
      dark: ["#18181b", "#09090b"],
      amber: ["#92400e", "#451a03"],
      red: ["#991b1b", "#450a0a"],
      blue: ["#1e3a5f", "#0c1929"],
      purple: ["#581c87", "#2e1065"],
      green: ["#065f46", "#022c22"],
      gradient1: ["#d97706", "#9333ea"],
      gradient2: ["#2563eb", "#ec4899"],
      gradient3: ["#059669", "#2563eb"],
    };
    const colors = bgColors[bgId] || bgColors.dark;
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(1, colors[1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1080, 1080);

    // Draw noise texture
    if (noiseOpacity > 0) {
      for (let i = 0; i < 10000; i++) {
        const x = Math.random() * 1080;
        const y = Math.random() * 1080;
        const alpha = Math.random() * noiseOpacity;
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Draw vignette
    if (vignetteOpacity > 0) {
      const vigGrad = ctx.createRadialGradient(540, 540, 200, 540, 540, 750);
      vigGrad.addColorStop(0, "rgba(0,0,0,0)");
      vigGrad.addColorStop(1, `rgba(0,0,0,${vignetteOpacity})`);
      ctx.fillStyle = vigGrad;
      ctx.fillRect(0, 0, 1080, 1080);
    }

    // Draw text
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Title
    ctx.font = `bold ${fontSize * 2.2}px ${fontFamily}`;
    ctx.fillText(title, 540, 420);

    // Artist
    ctx.font = `${fontSize * 0.8 * 2.2}px ${fontFamily}`;
    ctx.globalAlpha = 0.7;
    ctx.fillText(artist, 540, 580);
    ctx.globalAlpha = 1;

    return canvas;
  }, [title, artist, bgId, textColor, fontSize, fontFamily, noiseOpacity, vignetteOpacity]);

  const downloadCover = useCallback(() => {
    const canvas = renderCoverCanvas();
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `flowforge-cover-${title.toLowerCase().replace(/\s+/g, "-")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [renderCoverCanvas, title]);

  // ── Load saved covers on mount (DB-primary, mirror as offline fallback) ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let covers: DbCover[] = [];
      let dbOk = false;
      try {
        covers = await getCovers();
        dbOk = true;
      } catch {
        /* DB unavailable — use the mirror below */
      }
      if (cancelled) return;
      if (!dbOk) {
        const local = loadCache<DbCover[]>(COVERS_KEY, []);
        if (local.length > 0) setSavedCovers(local);
      } else {
        setSavedCovers(covers);
        saveCache(COVERS_KEY, covers);
      }
      setCoversLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Mirror to localStorage whenever the list changes ──
  useEffect(() => {
    if (!coversLoaded) return;
    saveCache(COVERS_KEY, savedCovers);
  }, [savedCovers, coversLoaded]);

  const handleSaveCover = useCallback(async () => {
    const canvas = renderCoverCanvas();
    if (!canvas) {
      showToast("⚠️ Nie udało się wygenerować okładki", "info");
      return;
    }
    // Store a small downscaled preview: a full 1080×1080 PNG data URL is
    // multiple MB — over the Server Action 1 MB body limit and the
    // localStorage mirror's quota. The gallery only needs a thumbnail; the
    // full-res PNG is still available via „Pobierz PNG” (live render).
    const preview = document.createElement("canvas");
    preview.width = 300;
    preview.height = 300;
    const pctx = preview.getContext("2d");
    if (pctx) pctx.drawImage(canvas, 0, 0, 300, 300);
    const imageUrl = pctx ? preview.toDataURL("image/png") : canvas.toDataURL("image/png");
    const layoutData = JSON.stringify({
      noiseOpacity,
      vignetteOpacity,
      filterValue: currentFilter.value,
    });
    const optimistic: DbCover = {
      id: `cover-${Date.now()}`,
      title,
      artistName: artist,
      bgColor: "#09090b",
      textColor,
      bgPattern: bgId,
      filterStyle: filter,
      fontSize,
      fontFamily,
      imageUrl,
      layoutData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setSavedCovers((prev) => [optimistic, ...prev]);
    const ok = await tryDbWrite(async () => {
      const row = await saveCover({
        title,
        artistName: artist,
        bgPattern: bgId,
        textColor,
        filterStyle: filter,
        fontSize,
        fontFamily,
        imageUrl,
        layoutData,
      });
      setSavedCovers((prev) => prev.map((c) => (c.id === optimistic.id ? { ...c, id: row.id } : c)));
    });
    if (ok) showToast("💾 Zapisano okładkę");
    else showToast("⚠️ Baza danych niedostępna — okładka zapisana lokalnie", "info");
  }, [renderCoverCanvas, title, artist, bgId, textColor, filter, fontSize, fontFamily, noiseOpacity, vignetteOpacity, currentFilter, showToast]);

  // Load a saved cover's settings back into the editor.
  const loadCoverIntoEditor = useCallback((cover: DbCover) => {
    setTitle(cover.title);
    setArtist(cover.artistName);
    if (cover.bgPattern && BACKGROUNDS.some((b) => b.id === cover.bgPattern)) setBgId(cover.bgPattern);
    if (cover.textColor) setTextColor(cover.textColor);
    if (cover.filterStyle && FILTERS.some((f) => f.id === cover.filterStyle)) setFilter(cover.filterStyle);
    if (cover.fontSize) setFontSize(cover.fontSize);
    if (cover.fontFamily) setFontFamily(cover.fontFamily);
    try {
      const layout = JSON.parse(cover.layoutData || "{}") as {
        noiseOpacity?: number;
        vignetteOpacity?: number;
      };
      if (typeof layout.noiseOpacity === "number") setNoiseOpacity(layout.noiseOpacity);
      if (typeof layout.vignetteOpacity === "number") setVignetteOpacity(layout.vignetteOpacity);
    } catch {
      /* no layout data */
    }
    showToast(`↩️ Wczytano: ${cover.title}`);
  }, [showToast]);

  const handleDeleteCover = useCallback(
    (id: string, titleName: string) => {
      const target = savedCovers.find((c) => c.id === id);
      setSavedCovers((prev) => prev.filter((c) => c.id !== id));
      // DB rows carry real ids; temp ids (cover-…) never reach the backend.
      if (target && !target.id.startsWith("cover-")) tryDbWrite(() => deleteCover(target.id));
      showToast(`🗑️ Usunięto okładkę: ${titleName}`, "info");
    },
    [savedCovers, showToast]
  );

  return (
    <AppShell>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center">
              <span className="text-lg">🎨</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Generator Okładek</h1>
              <p className="text-sm text-zinc-400">Cover Art Creator • Stwórz artwork singla</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveCover}
              className="px-4 py-2 rounded-xl bg-blue-500/10 text-blue-400 text-sm font-medium hover:bg-blue-500/20 transition-colors"
            >
              💾 Zapisz Okładkę
            </button>
            <button
              onClick={downloadCover}
              className="px-4 py-2 rounded-xl bg-amber-500 text-zinc-900 text-sm font-medium hover:bg-amber-400 transition-colors"
            >
              📥 Pobierz PNG
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Preview */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>👁️</span> Podgląd
            </h3>
            <div
              ref={canvasRef}
              className={`w-full aspect-square rounded-2xl bg-gradient-to-br ${currentBg.gradient} flex flex-col items-center justify-center relative overflow-hidden border border-zinc-800/50`}
              style={{ filter: currentFilter.value }}
            >
              {/* Noise overlay */}
              <div
                className="absolute inset-0 opacity-5"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='${noiseOpacity * 20}'/%3E%3C/svg%3E")`,
                }}
              />
              {/* Vignette */}
              <div
                className="absolute inset-0"
                style={{
                  background: `radial-gradient(circle at center, transparent 30%, rgba(0,0,0,${vignetteOpacity}) 100%)`,
                }}
              />
              {/* Text */}
              <div className="relative z-10 text-center px-8">
                <h2
                  className="font-bold leading-tight mb-3"
                  style={{ fontSize: `${fontSize}px`, color: textColor, fontFamily }}
                >
                  {title}
                </h2>
                <p
                  className="opacity-70"
                  style={{ fontSize: `${fontSize * 0.35}px`, color: textColor, fontFamily }}
                >
                  {artist}
                </p>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="space-y-5">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>⚙️</span> Ustawienia
            </h3>

            {/* Text Inputs */}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Tytuł utworu</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Tytuł utworu..."
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-900/50 border border-zinc-800/50 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/30"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Ksywka artysty</label>
                <input
                  type="text"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="Ksywka artysty..."
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-900/50 border border-zinc-800/50 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/30"
                />
              </div>
            </div>

            {/* Backgrounds */}
            <div>
              <label className="text-xs text-zinc-500 mb-2 block">Tło</label>
              <div className="grid grid-cols-5 gap-2">
                {BACKGROUNDS.map((bg) => (
                  <button
                    key={bg.id}
                    onClick={() => setBgId(bg.id)}
                    className={`h-10 rounded-lg bg-gradient-to-br ${bg.gradient} border-2 transition-all ${
                      bgId === bg.id ? "border-amber-500 scale-105" : "border-transparent hover:scale-105"
                    }`}
                    title={bg.label}
                  />
                ))}
              </div>
            </div>

            {/* Text Color */}
            <div>
              <label className="text-xs text-zinc-500 mb-2 block">Kolor tekstu</label>
              <div className="flex items-center gap-2">
                {["#f59e0b", "#ffffff", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"].map((c) => (
                  <button
                    key={c}
                    onClick={() => setTextColor(c)}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      textColor === c ? "border-white scale-110" : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <input
                  type="color"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="w-8 h-8 rounded-full cursor-pointer"
                />
              </div>
            </div>

            {/* Font Size */}
            <div>
              <label className="text-xs text-zinc-500 mb-2 block">Rozmiar tekstu: {fontSize}px</label>
              <input
                type="range"
                min="16"
                max="80"
                value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>

            {/* Font Family */}
            <div>
              <label className="text-xs text-zinc-500 mb-2 block">Font</label>
              <div className="flex flex-wrap gap-2">
                {FONTS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFontFamily(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                      fontFamily === f
                        ? "bg-amber-500/10 text-amber-500 border border-amber-500/30"
                        : "bg-zinc-800/50 text-zinc-400 border border-transparent hover:text-zinc-200"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter */}
            <div>
              <label className="text-xs text-zinc-500 mb-2 block">Filtr</label>
              <div className="flex flex-wrap gap-2">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                      filter === f.id
                        ? "bg-amber-500/10 text-amber-500 border border-amber-500/30"
                        : "bg-zinc-800/50 text-zinc-400 border border-transparent hover:text-zinc-200"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Effects */}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500 mb-2 block">Noise: {Math.round(noiseOpacity * 100)}%</label>
                <input
                  type="range"
                  min="0"
                  max="20"
                  value={noiseOpacity * 100}
                  onChange={(e) => setNoiseOpacity(parseInt(e.target.value) / 100)}
                  className="w-full accent-amber-500"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-2 block">Vignette: {Math.round(vignetteOpacity * 100)}%</label>
                <input
                  type="range"
                  min="0"
                  max="80"
                  value={vignetteOpacity * 100}
                  onChange={(e) => setVignetteOpacity(parseInt(e.target.value) / 100)}
                  className="w-full accent-amber-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Saved covers gallery („Zapisane okładki”) ── */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <span>🖼️</span> Zapisane Okładki
              <span className="text-xs font-normal text-zinc-500">({savedCovers.length})</span>
            </h3>
          </div>
          {savedCovers.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {savedCovers.map((cover) => (
                <div key={cover.id} className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 overflow-hidden card-hover">
                  <div className="aspect-square bg-zinc-800">
                    {cover.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover.imageUrl} alt={cover.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-600">🎨</div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-semibold text-white truncate">{cover.title}</p>
                    <p className="text-xs text-zinc-500 truncate">{cover.artistName}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => loadCoverIntoEditor(cover)}
                        className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-500 text-[11px] font-medium hover:bg-amber-500/20 transition-colors"
                      >
                        ↩️ Wczytaj
                      </button>
                      <button
                        onClick={() => handleDeleteCover(cover.id, cover.title)}
                        className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-400 text-[11px] font-medium hover:bg-red-500/10 hover:text-red-400 transition-colors"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-10 text-center">
              <span className="text-4xl block mb-3">🖼️</span>
              <p className="text-sm text-zinc-400">Brak zapisanych okładek — ustaw projekt i kliknij „💾 Zapisz Okładkę”.</p>
            </div>
          )}
        </div>
      </div>
      <ToastView toast={toast} />
    </AppShell>
  );
}
