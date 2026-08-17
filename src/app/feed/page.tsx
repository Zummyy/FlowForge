"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { useToast } from "@/components/studio/useToast";
import { ToastView } from "@/components/studio/ToastView";
import { fetchDbOrCache, saveCache, tryDbWrite } from "@/lib/db-sync";
import { createPost, getFeedPosts } from "@/actions/community";
import { addComment, getPublicLyric, ratePost } from "@/actions/lyrics";

const CACHE_KEY = "flowforge-feed-posts";

function fmtDate(d: Date | string): string {
  try {
    return new Date(d).toLocaleString("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

type DbPost = Awaited<ReturnType<typeof getFeedPosts>>[number];

function toPost(p: DbPost): Post {
  return {
    id: p.id,
    title: p.title,
    content: p.content,
    author: p.authorName,
    avatar: p.authorAvatar || "🎤",
    rating: p.rating,
    ratingCount: p.ratingCount,
    commentCount: p.comments.length,
    comments: p.comments.map((c) => ({
      id: c.id,
      author: c.authorName,
      content: c.content,
      createdAt: fmtDate(c.createdAt),
    })),
    createdAt: fmtDate(p.createdAt),
    isLiked: false,
  };
}

interface Post {
  id: string;
  title: string;
  content: string;
  author: string;
  avatar: string;
  rating: number;
  ratingCount: number;
  commentCount: number;
  comments: Comment[];
  createdAt: string;
  isLiked: boolean;
}

interface Comment {
  id: string;
  author: string;
  content: string;
  createdAt: string;
}

/** A published lyric rendered via /feed?shared=<id>. */
interface SharedLyric {
  id: string;
  title: string;
  content: string;
  lineCount: number;
  verseCount: number;
  syllableCount: number;
  wordCount: number;
  publishedAt: string;
}

export default function FeedPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [newPost, setNewPost] = useState({ title: "", content: "" });
  const [showNewPostForm, setShowNewPostForm] = useState(false);
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [postsLoaded, setPostsLoaded] = useState(false);
  const [sharedLyric, setSharedLyric] = useState<SharedLyric | null>(null);

  const { toast, showToast } = useToast();

  // ── /feed?shared=<id> — show a published lyric (read-only) at the top ──
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("shared");
    if (!id) return;
    getPublicLyric(id)
      .then((l) => setSharedLyric(l))
      .catch(() => {
        /* not public / missing — nothing to show */
      });
  }, []);

  // ── Load posts from the DB (fallback: localStorage cache) ──
  useEffect(() => {
    let cancelled = false;
    fetchDbOrCache(CACHE_KEY, async () => (await getFeedPosts()).map(toPost), [] as Post[]).then((rows) => {
      if (cancelled) return;
      setPosts(rows);
      setPostsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Mirror the feed into the cache whenever it changes ──
  useEffect(() => {
    if (!postsLoaded) return;
    saveCache(CACHE_KEY, posts);
  }, [posts, postsLoaded]);

  const handleLike = (postId: string) => {
    setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, isLiked: !p.isLiked } : p));
  };

  const handleRate = (postId: string, score: number) => {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id === postId) {
          const newCount = p.ratingCount + 1;
          const newRating = (p.rating * p.ratingCount + score) / newCount;
          return { ...p, rating: Math.round(newRating * 10) / 10, ratingCount: newCount };
        }
        return p;
      })
    );
    if (!postId.startsWith("local-")) {
      tryDbWrite(() => ratePost(postId, score, "Ty"));
    }
  };

  const handleAddComment = useCallback(
    (postId: string) => {
      if (!newComment.trim()) return;
      const tempId = `c${Date.now()}`;
      const content = newComment;
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                commentCount: p.commentCount + 1,
                comments: [...p.comments, { id: tempId, author: "Ty", content, createdAt: "Teraz" }],
              }
            : p
        )
      );
      setNewComment("");
      // Persist to the DB; swap the temp id for the real one on success.
      tryDbWrite(async () => {
        const created = await addComment(postId, content, "Ty");
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  comments: p.comments.map((c) =>
                    c.id === tempId
                      ? { id: created.id, author: created.authorName, content: created.content, createdAt: fmtDate(created.createdAt) }
                      : c
                  ),
                }
              : p
          )
        );
      });
    },
    [newComment]
  );

  const handlePublish = useCallback(async () => {
    if (!newPost.title || !newPost.content) return;
    const title = newPost.title;
    const content = newPost.content;
    setNewPost({ title: "", content: "" });
    setShowNewPostForm(false);
    const ok = await tryDbWrite(async () => {
      const created = await createPost({ title, content, authorName: "Ty", authorAvatar: "🎤" });
      const post: Post = {
        id: created.id,
        title: created.title,
        content: created.content,
        author: created.authorName,
        avatar: created.authorAvatar || "🎤",
        rating: 0,
        ratingCount: 0,
        commentCount: 0,
        comments: [],
        createdAt: fmtDate(created.createdAt),
        isLiked: false,
      };
      setPosts((prev) => [post, ...prev]);
    });
    if (!ok) {
      // DB unavailable — keep the post locally (cache) so nothing is lost.
      // The "local-" prefix lets the rate/comment handlers skip server calls.
      const post: Post = {
        id: `local-${Date.now()}`,
        title,
        content,
        author: "Ty",
        avatar: "🎤",
        rating: 0,
        ratingCount: 0,
        commentCount: 0,
        comments: [],
        createdAt: "Teraz",
        isLiked: false,
      };
      setPosts((prev) => [post, ...prev]);
      showToast("⚠️ Baza danych niedostępna — post zapisany lokalnie", "info");
    }
  }, [newPost, showToast]);

  return (
    <AppShell>
      {/* Toast notification — shared component driven by the useToast hook */}
      <ToastView toast={toast} />
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center">
              <span className="text-lg">🔥</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Ściana Raperów</h1>
              <p className="text-sm text-zinc-400">Community Feed • Dziel się swoją twórczością</p>
            </div>
          </div>
          <button
            onClick={() => setShowNewPostForm(!showNewPostForm)}
            className="px-4 py-2 rounded-xl bg-amber-500/10 text-amber-500 text-sm font-medium hover:bg-amber-500/20 transition-colors"
          >
            ✍️ Opublikuj Tekst
          </button>
        </div>

        {/* Shared published lyric — /feed?shared=<id> */}
        {sharedLyric && (
          <div className="rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/20 p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">
                📢 Opublikowany utwór
              </p>
              <button
                onClick={() => setSharedLyric(null)}
                className="text-xs text-zinc-500 hover:text-white transition-colors"
              >
                ✕ Zamknij
              </button>
            </div>
            <h3 className="text-lg font-bold text-white mb-2">{sharedLyric.title}</h3>
            <div className="text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed bg-zinc-800/30 rounded-xl p-4">
              {sharedLyric.content}
            </div>
            <p className="text-[11px] text-zinc-500 mt-3">
              {sharedLyric.lineCount} wersów • {sharedLyric.verseCount} zwrotek • {sharedLyric.syllableCount} sylab •{" "}
              {sharedLyric.wordCount} słów • opublikowano {fmtDate(sharedLyric.publishedAt)}
            </p>
          </div>
        )}

        {/* New Post Form */}
        {showNewPostForm && (
          <div className="rounded-2xl bg-zinc-900/50 border border-amber-500/20 p-6 space-y-4 animate-slide-down">
            <h3 className="text-lg font-semibold text-white">Nowy Post</h3>
            <input
              type="text"
              value={newPost.title}
              onChange={(e) => setNewPost({ ...newPost, title: e.target.value })}
              placeholder="Tytuł utworu..."
              className="w-full px-4 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/30"
            />
            <textarea
              value={newPost.content}
              onChange={(e) => setNewPost({ ...newPost, content: e.target.value })}
              placeholder="Wklej swój tekst tutaj..."
              className="w-full h-40 px-4 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-white font-mono text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/30 resize-none"
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setShowNewPostForm(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-400 text-sm font-medium hover:bg-zinc-700 transition-colors"
              >
                Anuluj
              </button>
              <button
                onClick={handlePublish}
                className="px-4 py-2 rounded-xl bg-amber-500 text-zinc-900 text-sm font-medium hover:bg-amber-400 transition-colors"
              >
                Opublikuj
              </button>
            </div>
          </div>
        )}

        {/* Posts Feed */}
        {posts.length === 0 ? (
          <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-16 text-center">
            <span className="text-5xl block mb-4">🔥</span>
            <h3 className="text-xl font-bold text-white mb-2">Brak postów</h3>
            <p className="text-sm text-zinc-400 max-w-md mx-auto mb-6">
              Bądź pierwszym, który opublikuje swój tekst na Ścianie Raperów!
            </p>
            <button
              onClick={() => setShowNewPostForm(true)}
              className="px-5 py-2.5 rounded-xl bg-amber-500 text-zinc-900 text-sm font-semibold hover:bg-amber-400 transition-colors"
            >
              ✍️ Opublikuj Pierwszy Tekst
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <div key={post.id} className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 overflow-hidden">
                <div className="p-5 pb-3">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-lg">
                      {post.avatar}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{post.author}</p>
                      <p className="text-xs text-zinc-500">{post.createdAt}</p>
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{post.title}</h3>
                  <div className="text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed bg-zinc-800/30 rounded-xl p-4">
                    {post.content}
                  </div>
                </div>
                <div className="px-5 py-3 flex items-center gap-4 border-t border-zinc-800/30">
                  <button
                    onClick={() => handleLike(post.id)}
                    className={`flex items-center gap-1.5 text-sm transition-colors ${
                      post.isLiked ? "text-red-400" : "text-zinc-400 hover:text-red-400"
                    }`}
                  >
                    {post.isLiked ? "❤️" : "🤍"} Lubię
                  </button>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((score) => (
                      <button
                        key={score}
                        onClick={() => handleRate(post.id, score)}
                        className="text-lg text-zinc-600 hover:text-amber-500 transition-colors"
                      >
                        {score <= Math.round(post.rating) ? "★" : "☆"}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setExpandedPost(expandedPost === post.id ? null : post.id)}
                    className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors ml-auto"
                  >
                    💬 {post.commentCount}
                  </button>
                </div>
                {expandedPost === post.id && (
                  <div className="px-5 py-4 border-t border-zinc-800/30 bg-zinc-800/10 space-y-3">
                    {post.comments.map((comment) => (
                      <div key={comment.id} className="flex items-start gap-2">
                        <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] shrink-0">
                          {comment.author[0]}
                        </div>
                        <div>
                          <p className="text-xs">
                            <span className="font-semibold text-white">{comment.author}</span>
                            <span className="text-zinc-500 ml-2">{comment.createdAt}</span>
                          </p>
                          <p className="text-sm text-zinc-300 mt-0.5">{comment.content}</p>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-2">
                      <input
                        type="text"
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddComment(post.id)}
                        placeholder="Dodaj komentarz..."
                        className="flex-1 px-3 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/30"
                      />
                      <button
                        onClick={() => handleAddComment(post.id)}
                        className="px-3 py-2 rounded-xl bg-amber-500/10 text-amber-500 text-sm font-medium hover:bg-amber-500/20 transition-colors"
                      >
                        Wyślij
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
