// Route handler — durable Studio take recordings.
//
// Server Actions cap request bodies at ~1 MB, which audio blobs blow past, so
// uploads go through a plain route handler instead. The client sends the raw
// audio bytes with the take id in the `x-take-id` header; the file lands under
// uploads/recordings/ and the Recording row (takeId → file) is upserted, so a
// re-upload of the same take simply overwrites both.

import { NextRequest, NextResponse } from "next/server";
import { deleteRecording, saveRecording } from "@/lib/recordings";

export const runtime = "nodejs";

/** Generous local ceiling — protects the disk from runaway bodies. */
const MAX_RECORDING_BYTES = 100 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const takeId = req.headers.get("x-take-id");
  if (!takeId) {
    return NextResponse.json({ error: "Missing x-take-id header" }, { status: 400 });
  }
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_RECORDING_BYTES) {
    return NextResponse.json({ error: "Recording too large" }, { status: 413 });
  }
  try {
    const data = Buffer.from(await req.arrayBuffer());
    if (data.length === 0) {
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }
    if (data.length > MAX_RECORDING_BYTES) {
      return NextResponse.json({ error: "Recording too large" }, { status: 413 });
    }
    const meta = await saveRecording({
      takeId,
      mimeType: req.headers.get("content-type") || "audio/webm",
      data,
    });
    return NextResponse.json({ takeId: meta.takeId, url: `/api/recordings/${meta.takeId}` });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const takeId = req.headers.get("x-take-id");
  if (!takeId) {
    return NextResponse.json({ error: "Missing x-take-id header" }, { status: 400 });
  }
  try {
    const removed = await deleteRecording(takeId);
    return NextResponse.json({ removed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
