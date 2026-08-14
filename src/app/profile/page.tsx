"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { useToast } from "@/components/studio/useToast";
import { ToastView } from "@/components/studio/ToastView";
import { getDashboardStats, getProfile, updateProfile } from "@/actions/achievements";

type DbStats = Awaited<ReturnType<typeof getDashboardStats>>;
type DbAchievement = Awaited<ReturnType<typeof getProfile>>["achievements"][number];

function toAchievement(a: DbAchievement): Achievement {
  return {
    id: a.badgeId,
    name: a.badgeName,
    icon: a.badgeIcon,
    description: a.badgeDescription,
    points: a.points,
    earned: true,
    earnedAt: new Date(a.earnedAt).toISOString(),
  };
}

interface Achievement {
  id: string;
  name: string;
  icon: string;
  description: string;
  points: number;
  earned: boolean;
  earnedAt?: string;
}

const LEVEL_THRESHOLDS = [0, 50, 150, 300, 500, 750, 1000, 1500, 2000, 3000];
const emojis = ["🎤", "🎧", "🎹", "🎸", "🥁", "🔥", "⚡", "💎", "👑", "🎵"];

export default function ProfilePage() {
  const [profile, setProfile] = useState({
    displayName: "MC",
    bio: "",
    avatarEmoji: "🎤",
  });
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [editingProfile, setEditingProfile] = useState(false);
  const [dbStats, setDbStats] = useState<DbStats | null>(null);

  const { toast, showToast } = useToast();

  // ── Load profile + achievements + stats from the DB on mount ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [prof, stats] = await Promise.all([getProfile(), getDashboardStats()]);
        if (cancelled) return;
        if (prof) {
          setProfile({
            displayName: prof.displayName || "MC",
            bio: prof.bio || "",
            avatarEmoji: prof.avatarEmoji || "🎤",
          });
          setAchievements((prof.achievements ?? []).map(toAchievement));
        }
        setDbStats(stats);
      } catch {
        /* DB unavailable — keep defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Persist profile edits to the DB ──
  const saveProfile = useCallback(async () => {
    const ok = await updateProfile(profile)
      .then(() => true)
      .catch(() => false);
    if (ok) {
      setEditingProfile(false);
      showToast("💾 Zapisano profil");
    } else {
      showToast("⚠️ Nie udało się zapisać profilu", "info");
    }
  }, [profile, showToast]);

  const totalPoints = dbStats ? dbStats.totalPoints : achievements.filter((a) => a.earned).reduce((sum, a) => sum + a.points, 0);
  const level = LEVEL_THRESHOLDS.findIndex((t) => totalPoints < t);
  const nextLevel = LEVEL_THRESHOLDS[level] || 100;
  const prevLevel = LEVEL_THRESHOLDS[level - 1] || 0;
  const progress = nextLevel > prevLevel ? ((totalPoints - prevLevel) / (nextLevel - prevLevel)) * 100 : 100;

  return (
    <AppShell>
      {/* Toast notification — shared component driven by the useToast hook */}
      <ToastView toast={toast} />
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <span className="text-lg">👤</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Profil Artysty</h1>
            <p className="text-sm text-zinc-400">Twoje osiągnięcia i postępy</p>
          </div>
        </div>

        {/* Profile Card */}
        <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 overflow-hidden">
          <div className="h-32 bg-gradient-to-r from-amber-500/20 via-amber-600/10 to-zinc-900/50" />
          <div className="px-6 pb-6 -mt-12">
            <div className="flex items-end gap-4 mb-4">
              <div className="w-20 h-20 rounded-2xl bg-zinc-800 border-4 border-zinc-900 flex items-center justify-center text-3xl shadow-xl">
                {profile.avatarEmoji}
              </div>
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-white">{profile.displayName}</h2>
                  <button
                    onClick={() => setEditingProfile(!editingProfile)}
                    className="text-zinc-500 hover:text-zinc-300 text-sm"
                  >
                    ✏️
                  </button>
                </div>
                <p className="text-sm text-zinc-400">{profile.bio || "Kliknij ✏️ aby dodać bio"}</p>
              </div>
            </div>

            {editingProfile && (
              <div className="space-y-3 mb-4 p-4 rounded-xl bg-zinc-800/30 border border-zinc-700/30 animate-slide-down">
                <input
                  type="text"
                  value={profile.displayName}
                  onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
                  placeholder="Nazwa wyświetlana..."
                  className="w-full px-3 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-white text-sm"
                />
                <input
                  type="text"
                  value={profile.bio}
                  onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                  placeholder="Bio..."
                  className="w-full px-3 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-white text-sm"
                />
                <div className="flex gap-2 flex-wrap">
                  {emojis.map((e) => (
                    <button
                      key={e}
                      onClick={() => setProfile({ ...profile, avatarEmoji: e })}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg transition-all ${
                        profile.avatarEmoji === e
                          ? "bg-amber-500/20 border border-amber-500/30 scale-110"
                          : "bg-zinc-800/50 hover:bg-zinc-700/50"
                      }`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 justify-end pt-1">
                  <button
                    onClick={() => setEditingProfile(false)}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 text-xs font-medium hover:bg-zinc-700 transition-colors"
                  >
                    Anuluj
                  </button>
                  <button
                    onClick={saveProfile}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 text-zinc-900 text-xs font-semibold hover:bg-amber-400 transition-colors"
                  >
                    💾 Zapisz
                  </button>
                </div>
              </div>
            )}

            {/* Level Progress */}
            <div className="rounded-xl bg-zinc-800/30 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white">Poziom {level}</span>
                <span className="text-xs text-zinc-500">{totalPoints} / {nextLevel} pkt</span>
              </div>
              <div className="h-2 rounded-full bg-zinc-700/50 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Stats Grid — wired to the DB dashboard stats */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          <StatBox icon="📝" label="Teksty" value={dbStats?.lyricCount ?? 0} />
          <StatBox icon="🎛️" label="Sesje" value={dbStats?.achievementCount ?? 0} />
          <StatBox icon="🔥" label="Posty" value={dbStats?.postCount ?? 0} />
          <StatBox icon="⚔️" label="Wygrane" value={0} />
          <StatBox icon="⭐" label="Punkty" value={totalPoints} />
          <StatBox icon="📅" label="Odznaki" value={achievements.length} />
        </div>

        {/* Achievements — loaded from the DB */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span>🏅</span> Osiągnięcia
          </h2>
          {achievements.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {achievements.map((a) => (
                <div key={a.id} className="rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/40 p-4 card-hover">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center text-xl shrink-0">
                      {a.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-white truncate">{a.name}</h3>
                      <p className="text-[10px] text-zinc-500 mt-0.5">{a.description}</p>
                      {a.earnedAt && (
                        <p className="text-[10px] text-emerald-400 mt-1.5 font-medium">
                          ✓ Zdobyto {new Date(a.earnedAt).toLocaleDateString("pl-PL")}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 text-[10px] font-bold font-mono">
                      +{a.points} pkt
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-12 text-center">
              <span className="text-4xl block mb-3">🏅</span>
              <h3 className="text-lg font-semibold text-white mb-2">Brak osiągnięć</h3>
              <p className="text-sm text-zinc-400 max-w-md mx-auto">
                Zdobywaj osiągnięcia pisząc teksty, nagrywając sesje i uczestnicząc w wyzwaniach. Każda aktywność to punkty!
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function StatBox({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/50 p-3 text-center">
      <span className="text-xl block mb-1">{icon}</span>
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-[10px] text-zinc-500">{label}</p>
    </div>
  );
}
