// Streams a stored take recording back to the client. The URL returned by
// POST /api/recordings (`/api/recordings/<takeId>`) is used as the `<audio>`
// src for restored takes, so audio survives across browsers and reloads.

import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getRecording } from "@/lib/recordings";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ takeId: string }> }
) {
  const { takeId } = await params;
  const rec = await getRecording(takeId);
  if (!rec) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  }
  try {
    await stat(rec.filePath);
  } catch {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  }
  const webStream = Readable.toWeb(createReadStream(rec.filePath)) as unknown as ReadableStream;
  return new Response(webStream, {
    headers: {
      "Content-Type": rec.mimeType,
      "Content-Length": String(rec.size),
      // No caching: a re-upload overwrites the SAME URL, so a cached copy
      // would serve stale bytes after a take is replaced.
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
    },
  });
}
