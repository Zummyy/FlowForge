"use server";

import { prisma } from "@/lib/prisma";

// ─── Posts CRUD ────────────────────────────────────────────────────────

export async function createPost(data: {
  title: string;
  content: string;
  authorName?: string;
  authorAvatar?: string;
}) {
  return prisma.communityPost.create({
    data: {
      title: data.title,
      content: data.content,
      authorName: data.authorName || "Anonymous",
      authorAvatar: data.authorAvatar || null,
    },
  });
}

export async function getFeedPosts() {
  const posts = await prisma.communityPost.findMany({
    include: {
      ratings: true,
      comments: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return posts.map((post) => ({
    ...post,
    rating: post.ratings.length > 0
      ? post.ratings.reduce((sum, r) => sum + r.score, 0) / post.ratings.length
      : 0,
    ratingCount: post.ratings.length,
  }));
}
