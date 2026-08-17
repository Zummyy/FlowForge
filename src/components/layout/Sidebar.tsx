"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getDashboardStats } from "@/actions/achievements";

/**
 * The browser's install prompt event — Chrome fires `beforeinstallprompt`
 * when the PWA criteria are met (manifest + icons, served over a secure
 * context). It is NOT part of the standard TS lib, hence the local type.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "🏠", shortLabel: "Home" },
  { href: "/vault", label: "The Vault", icon: "📝", shortLabel: "Vault" },
  { href: "/studio", label: "Studio", icon: "🎛️", shortLabel: "Studio" },
  { href: "/feed", label: "Ściana Raperów", icon: "🔥", shortLabel: "Feed" },
  { href: "/challenges", label: "Wyzwania", icon: "⚔️", shortLabel: "Battles" },
  { href: "/inspirations", label: "Hall of Fame", icon: "🏆", shortLabel: "Fame" },
  { href: "/beats", label: "Gotowe Numery", icon: "🎵", shortLabel: "Numery" },
  { href: "/cover", label: "Okładki", icon: "🎨", shortLabel: "Cover" },
  { href: "/budget", label: "Budżet", icon: "💰", shortLabel: "Budżet" },
  { href: "/academy", label: "Akademia", icon: "📚", shortLabel: "Guide" },
  { href: "/profile", label: "Profil", icon: "👤", shortLabel: "Profil" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  // Profile card — DB-primary (same source as the profile page / dashboard):
  // displayName + avatar + level + points from the userProfile row.
  const [profile, setProfile] = useState<{
    displayName: string;
    avatarEmoji: string;
    level: number;
    totalPoints: number;
  } | null>(null);

  // Load the profile on mount and refresh when the profile page saves
  // („flowforge-profile-updated” — see src/app/profile/page.tsx).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const stats = await getDashboardStats();
        if (cancelled) return;
        setProfile({
          displayName: stats.displayName || "MC",
          avatarEmoji: stats.avatarEmoji || "🎤",
          level: stats.level,
          totalPoints: stats.totalPoints,
        });
      } catch {
        // DB unavailable — fall back to the defaults (never crash the nav).
        if (!cancelled) setProfile({ displayName: "MC", avatarEmoji: "🎤", level: 1, totalPoints: 0 });
      }
    };
    load();
    window.addEventListener("flowforge-profile-updated", load);
    return () => {
      cancelled = true;
      window.removeEventListener("flowforge-profile-updated", load);
    };
  }, []);

  // PWA install: show „⬇️ Zainstaluj aplikację” only when the browser offers
  // the install (beforeinstallprompt fires) and the app is not already
  // running as an installed PWA (display-mode: standalone). The stored event
  // is the ONLY way to trigger the real prompt — it can't be recreated.
  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // Chrome shows its own mini-infobar otherwise
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setShowInstall(true);
    };
    const onInstalled = () => {
      deferredPromptRef.current = null;
      setShowInstall(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    const promptEvent = deferredPromptRef.current;
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") {
      deferredPromptRef.current = null;
      setShowInstall(false);
    }
    // „dismissed” → keep the button so the user can try again.
  };

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-zinc-900/80 border-r border-zinc-800/50 backdrop-blur-xl z-40">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-zinc-800/50">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
          <span className="text-xl">🔥</span>
        </div>
        <div>
          <h1 className="text-lg font-bold text-gradient-amber tracking-tight">FlowForge</h1>
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Studio Mode</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group
                ${isActive
                  ? "bg-amber-500/10 text-amber-500 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
            >
              <span className={`text-lg transition-transform duration-200 ${isActive ? "scale-110" : "group-hover:scale-105"}`}>
                {item.icon}
              </span>
              <span>{item.label}</span>
              {isActive && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-zinc-800/50 space-y-2">
        {/* PWA install — only visible after the browser offers the install */}
        {showInstall && (
          <button
            onClick={handleInstall}
            data-install-app
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-amber-500/10 text-amber-400 text-sm font-medium hover:bg-amber-500/20 transition-colors"
            title="Zainstaluj FlowForge jako aplikację"
          >
            <span className="text-lg">⬇️</span>
            <span>Zainstaluj aplikację</span>
          </button>
        )}
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-zinc-800/30" data-profile-chip>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500/20 to-amber-600/20 flex items-center justify-center text-sm">
            {profile?.avatarEmoji ?? "🎤"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-zinc-300 truncate">{profile?.displayName ?? "MC"}</p>
            <p className="text-[10px] text-zinc-500">
              Poziom {profile?.level ?? 1} • {profile?.totalPoints ?? 0} pkt
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
