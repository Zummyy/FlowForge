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

export async function getFeedPosts(options?: {
  limit?: number;
  offset?: number;
  sortBy?: "newest" | "popular" | "top-rated";
}) {
  const posts = await prisma.communityPost.findMany({
    include: {
      ratings: true,
      comments: { orderBy: { createdAt: "asc" } },
    },
    orderBy: options?.sortBy === "popular"
      ? { viewCount: "desc" }
      : { createdAt: "desc" },
    take: options?.limit || 20,
    skip: options?.offset || 0,
  });

  return posts.map((post) => ({
    ...post,
    rating: post.ratings.length > 0
      ? post.ratings.reduce((sum, r) => sum + r.score, 0) / post.ratings.length
      : 0,
    ratingCount: post.ratings.length,
  }));
}

export async function getPost(postId: string) {
  return prisma.communityPost.findUnique({
    where: { id: postId },
    include: {
      ratings: true,
      comments: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function incrementViewCount(postId: string) {
  return prisma.communityPost.update({
    where: { id: postId },
    data: { viewCount: { increment: 1 } },
  });
}

export async function toggleFeatured(postId: string, isFeatured: boolean) {
  return prisma.communityPost.update({
    where: { id: postId },
    data: { isFeatured },
  });
}
