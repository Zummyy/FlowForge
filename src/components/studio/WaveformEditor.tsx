"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Clip, TrimEdge, VocalTake } from "./types";
import { clamp } from "./useClipTimeline";

// ─── Layout constants ──────────────────────────────────────────────────────────
const BASE_WIDTH = 800; // timeline width at 100% zoom
const TRACK_HEIGHT = 56;
const RULER_HEIGHT = 36;
const HANDLE_MIN_PX = 8; // minimum edge hit-zone in px
const HANDLE_MAX_PX = 48; // maximum edge hit-zone in px
const DRAG_THRESHOLD_PX = 4; // px before a press becomes a drag

function handleZone(zoom: number) {
  return clamp(6 * zoom, HANDLE_MIN_PX, HANDLE_MAX_PX);
}

function snapForZoom(zoom: number) {
  return zoom > 10 ? 0.005 : zoom > 5 ? 0.01 : zoom > 2 ? 0.05 : 0.1;
}

const EDITOR_SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Space"], label: "Odtwórz / Pauza" },
  { keys: ["Ctrl", "Z"], label: "Cofnij ostatnią akcję" },
  { keys: ["Ctrl", "Shift", "Z"], label: "Ponów ostatnią akcję (także Ctrl+Y)" },
  { keys: ["Ctrl", "S"], label: "Zapisz sesję" },
  { keys: ["S"], label: "Rozetnij przy znaczniku (zaznacz ścieżkę)" },
  { keys: ["Delete"], label: "Usuń zaznaczony fragment" },
  { keys: ["←", "→"], label: "Przesuń zaznaczony fragment lub take (Shift = 1 s)" },
  { keys: ["↑", "↓"], label: "Głośność fragmentu lub take (±5%, Shift = ±20%)" },
  { keys: ["Ctrl", "scroll"], label: "Zoom osi czasu" },
];

function formatTick(t: number, majorStep: number) {
  if (majorStep < 0.01) {
    const ms = Math.round(t * 1000);
    return `${Math.floor(ms / 1000)}s${(ms % 1000).toString().padStart(3, "0")}ms`;
  }
  if (majorStep < 1) {
    const sec = Math.floor(t);
    const ms = Math.round((t - sec) * 1000);
    return `${sec}.${ms.toString().padStart(3, "0")}`;
  }
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// TIMELINE RULER
// ═══════════════════════════════════════════════════════════════════════════

function TimelineRuler({
  totalDuration,
  zoom,
  currentTime,
  markerPosition,
  onMarkerChange,
}: {
  totalDuration: number;
  zoom: number;
  currentTime: number;
  markerPosition: number;
  onMarkerChange: (t: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDraggingMarker, setIsDraggingMarker] = useState(false);
  const totalWidth = BASE_WIDTH * zoom;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = totalWidth * dpr;
    canvas.height = RULER_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#18181b";
    ctx.fillRect(0, 0, totalWidth, RULER_HEIGHT);

    const dur = totalDuration || 60;
    const pxPerSec = totalWidth / dur;

    let majorStep = 10;
    let minorStep = 5;
    let microStep = 0;
    if (pxPerSec > 1000) { majorStep = 0.001; minorStep = 0.0005; microStep = 0.0001; }
    else if (pxPerSec > 500) { majorStep = 0.01; minorStep = 0.005; microStep = 0.001; }
    else if (pxPerSec > 200) { majorStep = 0.05; minorStep = 0.01; microStep = 0.005; }
    else if (pxPerSec > 100) { majorStep = 0.1; minorStep = 0.05; microStep = 0.01; }
    else if (pxPerSec > 40) { majorStep = 0.5; minorStep = 0.1; microStep = 0.05; }
    else if (pxPerSec > 20) { majorStep = 1; minorStep = 0.5; }
    else if (pxPerSec > 8) { majorStep = 5; minorStep = 1; }

    for (let t = 0; t <= dur; t += majorStep) {
      const x = (t / dur) * totalWidth;
      if (x > totalWidth + 10) break;
      ctx.fillStyle = "#a1a1aa";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(formatTick(t, majorStep), Math.min(x, totalWidth - 20), 12);
      ctx.strokeStyle = "#52525b";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.stroke();

      if (microStep > 0) {
        for (let sub = microStep; sub < majorStep; sub += microStep) {
          const sx = ((t + sub) / dur) * totalWidth;
          if (sx > totalWidth + 5) break;
          ctx.strokeStyle = "#27272a";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(sx, RULER_HEIGHT - 3);
          ctx.lineTo(sx, RULER_HEIGHT);
          ctx.stroke();
        }
      }
      if (minorStep > 0 && minorStep < majorStep) {
        for (let sub = minorStep; sub < majorStep; sub += minorStep) {
          const sx = ((t + sub) / dur) * totalWidth;
          if (sx > totalWidth + 5) break;
          ctx.strokeStyle = "#3f3f46";
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(sx, RULER_HEIGHT - 7);
          ctx.lineTo(sx, RULER_HEIGHT);
          ctx.stroke();
        }
      }
    }

    // Playhead (current playback position)
    if (totalDuration > 0) {
      const px = (currentTime / dur) * totalWidth;
      ctx.fillStyle = "#a1a1aa";
      ctx.beginPath();
      ctx.moveTo(px - 3, 0);
      ctx.lineTo(px + 3, 0);
      ctx.lineTo(px, 5);
      ctx.fill();
      ctx.strokeStyle = "#a1a1aa";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, 5);
      ctx.lineTo(px, RULER_HEIGHT);
      ctx.stroke();
    }

    // Split marker (amber, draggable)
    if (totalDuration > 0) {
      const mx = (markerPosition / dur) * totalWidth;
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.moveTo(mx - 5, 0);
      ctx.lineTo(mx + 5, 0);
      ctx.lineTo(mx, 8);
      ctx.fill();
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx, 8);
      ctx.lineTo(mx, RULER_HEIGHT);
      ctx.stroke();
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(mx - 3, RULER_HEIGHT - 6, 6, 6);
    }
  }, [totalDuration, zoom, currentTime, markerPosition, totalWidth]);

  const getTimeFromX = useCallback(
    (clientX: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || !totalDuration) return 0;
      const x = clientX - rect.left;
      return clamp((x / totalWidth) * totalDuration, 0, totalDuration);
    },
    [totalDuration, totalWidth]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || !totalDuration) return;
      const x = e.clientX - rect.left;
      const mx = (markerPosition / totalDuration) * totalWidth;
      if (Math.abs(x - mx) < 10) {
        setIsDraggingMarker(true);
        e.preventDefault();
        return;
      }
      onMarkerChange(getTimeFromX(e.clientX));
    },
    [totalDuration, totalWidth, markerPosition, onMarkerChange, getTimeFromX]
  );

  useEffect(() => {
    if (!isDraggingMarker) return;
    const handleMouseMove = (e: MouseEvent) => onMarkerChange(getTimeFromX(e.clientX));
    const handleMouseUp = () => setIsDraggingMarker(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingMarker, onMarkerChange, getTimeFromX]);

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      className="rounded-t-xl border border-zinc-800/50 block select-none"
      style={{
        height: RULER_HEIGHT,
        width: totalWidth,
        cursor: isDraggingMarker ? "ew-resize" : "crosshair",
        touchAction: "none",
      }}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WAVEFORM TRACK (single take row)
// ═══════════════════════════════════════════════════════════════════════════

interface WaveformTrackProps {
  take: VocalTake;
  /** null = original unsplit take; [] = take was edited and all clips removed. */
  clips: Clip[] | null;
  waveformData?: Float32Array;
  totalDuration: number;
  zoom: number;
  currentTime: number;
  isSelected: boolean;
  onSelect: (id: string | null) => void;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  onUpdateOffset: (offset: number) => void;
  onMoveClip: (clipId: string, offset: number) => void;
  onUpdateTrim: (trimStart: number, trimEnd: number) => void;
  onTrimClipEdge: (clipId: string, edge: TrimEdge, newEdgeTime: number) => void;
  /** Called when a drag/trim gesture starts (undo snapshots once per gesture). */
  onGestureStart: () => void;
  /** Called when a drag/trim gesture ends. */
  onGestureEnd: () => void;
  formatTime: (s: number) => string;
  markerPosition: number;
}

type DragKind = "clip" | "take" | "trim-clip" | "trim-take" | null;

interface DragSession {
  kind: Exclude<DragKind, null>;
  clipId?: string;
  edge?: TrimEdge;
  startClientX: number;
  startOffset?: number;
  startEdgeTime?: number;
  startTrim?: { s: number; e: number };
  moved: boolean;
}

function WaveformTrack({
  take,
  clips,
  waveformData,
  totalDuration,
  zoom,
  currentTime,
  isSelected,
  onSelect,
  selectedClipId,
  onSelectClip,
  onUpdateOffset,
  onMoveClip,
  onUpdateTrim,
  onTrimClipEdge,
  onGestureStart,
  onGestureEnd,
  formatTime,
  markerPosition,
}: WaveformTrackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const totalWidth = BASE_WIDTH * zoom;
  const dur = totalDuration || 60;

  const [hover, setHover] = useState<{ edge: TrimEdge | null; clipId: string | null }>({
    edge: null,
    clipId: null,
  });
  const hoverRef = useRef(hover);
  const [dragKind, setDragKind] = useState<DragKind>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; text: string } | null>(null);

  // Stable callback access inside window listeners
  const cb = useRef({ onMoveClip, onTrimClipEdge, onUpdateOffset, onUpdateTrim, formatTime, onGestureStart, onGestureEnd });
  useEffect(() => {
    cb.current = { onMoveClip, onTrimClipEdge, onUpdateOffset, onUpdateTrim, formatTime, onGestureStart, onGestureEnd };
  }, [onMoveClip, onTrimClipEdge, onUpdateOffset, onUpdateTrim, formatTime, onGestureStart, onGestureEnd]);

  /** Arm a drag/trim session and notify the parent that a gesture started. */
  const armSession = useCallback((s: DragSession) => {
    sessionRef.current = s;
    setDragKind(s.kind);
    cb.current.onGestureStart();
  }, []);

  // ── Edge hit-testing ──
  const findEdgeAt = useCallback(
    (x: number): { clip: Clip; edge: TrimEdge } | null => {
      if (!clips || clips.length === 0) return null;
      const hz = handleZone(zoom);
      const hits: { clip: Clip; edge: TrimEdge; edgeX: number }[] = [];
      for (const clip of clips) {
        const leftX = (clip.offset / dur) * totalWidth;
        const rightX = leftX + (clip.duration / dur) * totalWidth;
        if (Math.abs(x - leftX) <= hz) hits.push({ clip, edge: "start", edgeX: leftX });
        if (Math.abs(x - rightX) <= hz) hits.push({ clip, edge: "end", edgeX: rightX });
      }
      if (hits.length === 0) return null;
      // Deduplicate coincident edges (shared boundary) by pointer side
      const byPos = new Map<number, { clip: Clip; edge: TrimEdge; edgeX: number }>();
      for (const h of hits) {
        const key = Math.round(h.edgeX * 100);
        const existing = byPos.get(key);
        if (!existing) {
          byPos.set(key, h);
          continue;
        }
        const wantEnd = x <= h.edgeX;
        byPos.set(key, h.edge === (wantEnd ? "end" : "start") ? h : existing);
      }
      let best: { clip: Clip; edge: TrimEdge; edgeX: number } | null = null;
      for (const h of byPos.values()) {
        if (!best || Math.abs(x - h.edgeX) < Math.abs(x - best.edgeX)) best = h;
      }
      return best ? { clip: best.clip, edge: best.edge } : null;
    },
    [clips, dur, totalWidth, zoom]
  );

  // ── Hover detection (edge → ew-resize cursor) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let edge: TrimEdge | null = null;
      let clipId: string | null = null;
      if (clips && clips.length > 0) {
        const hit = findEdgeAt(x);
        if (hit) {
          edge = hit.edge;
          clipId = hit.clip.id;
        }
      } else if (!clips && isSelected) {
        // Unsplit take trim handles (only when the take is selected)
        const startX = (take.offset / dur) * totalWidth;
        const trimStartX = startX + ((take.trimStart * take.duration) / dur) * totalWidth;
        const trimEndX = startX + ((take.trimEnd * take.duration) / dur) * totalWidth;
        const hz = handleZone(zoom);
        if (Math.abs(x - trimStartX) < hz) edge = "start";
        else if (Math.abs(x - trimEndX) < hz) edge = "end";
      }
      if (edge !== hoverRef.current.edge || clipId !== hoverRef.current.clipId) {
        hoverRef.current = { edge, clipId };
        setHover({ edge, clipId });
      }
    };
    const onLeave = () => {
      hoverRef.current = { edge: null, clipId: null };
      setHover({ edge: null, clipId: null });
    };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    return () => {
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [clips, isSelected, take, dur, totalWidth, zoom, findEdgeAt]);

  // ── Drawing ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = totalWidth * dpr;
    canvas.height = TRACK_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, totalWidth, TRACK_HEIGHT);

    // Grid (≈ every 2s at 120 BPM)
    const gridStep = zoom > 10 ? 0.5 : zoom > 5 ? 1 : 2;
    ctx.strokeStyle = "#1a1a1e";
    ctx.lineWidth = 0.5;
    for (let t = 0; t <= dur; t += gridStep) {
      const x = (t / dur) * totalWidth;
      if (x > totalWidth) break;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, TRACK_HEIGHT);
      ctx.stroke();
    }

    const midY = TRACK_HEIGHT / 2;

    /** Draw a waveform block mapping source [trimStart..trimEnd] across [x0, x0+w]. */
    const drawWaveformBlock = (
      trimStart: number,
      trimEnd: number,
      x0: number,
      w: number,
      active: boolean
    ) => {
      if (!waveformData || waveformData.length === 0 || w <= 0) return;
      const samples = waveformData.length;
      const s0 = Math.floor(trimStart * samples);
      const s1 = Math.floor(trimEnd * samples);
      if (s1 <= s0) return;
      const visSamples = Math.max(1, Math.floor(w));
      const step = Math.max(1, Math.floor((s1 - s0) / visSamples / 4));
      const color = take.isMuted ? "#52525b" : active ? "#f59e0b" : "#fb923c";
      ctx.strokeStyle = color;
      ctx.fillStyle = color + "40";
      ctx.lineWidth = 0.8;
      if (zoom > 5) {
        // stroked peaks
        const peaks: number[] = [];
        for (let i = 0; i < visSamples; i++) {
          const idx = s0 + Math.floor((i * (s1 - s0)) / visSamples);
          let max = 0;
          for (let j = 0; j < step && idx + j < samples; j++) {
            max = Math.max(max, Math.abs(waveformData[idx + j] || 0));
          }
          peaks.push(max);
        }
        ctx.beginPath();
        for (let i = 0; i < peaks.length; i++) {
          const x = x0 + (i / visSamples) * w;
          const h = peaks[i] * midY * 0.9;
          if (i === 0) ctx.moveTo(x, midY - h);
          else ctx.lineTo(x, midY - h);
        }
        ctx.stroke();
        ctx.beginPath();
        for (let i = 0; i < peaks.length; i++) {
          const x = x0 + (i / visSamples) * w;
          const h = peaks[i] * midY * 0.9;
          if (i === 0) ctx.moveTo(x, midY + h);
          else ctx.lineTo(x, midY + h);
        }
        ctx.stroke();
      } else {
        // filled bars
        ctx.beginPath();
        for (let i = 0; i < visSamples; i++) {
          const idx = s0 + Math.floor((i * (s1 - s0)) / visSamples);
          let max = 0;
          for (let j = 0; j < step && idx + j < samples; j++) {
            max = Math.max(max, Math.abs(waveformData[idx + j] || 0));
          }
          const x = x0 + (i / visSamples) * w;
          const h = max * midY * 0.9;
          ctx.fillRect(x, midY - h, Math.max(1, w / visSamples - 0.3), h * 2);
        }
      }
    };

    /** Amber edge-trim handles (grip bars) at leftX / rightX. */
    const drawTrimHandles = (leftX: number, rightX: number, showLeft: boolean, showRight: boolean) => {
      const handleWidth = Math.max(4, 6 / zoom);
      const gripWidth = Math.max(2, 3 / zoom);
      const drawGrip = (x: number, fillLeft: boolean) => {
        ctx.fillStyle = "rgba(245, 158, 11, 0.3)";
        ctx.fillRect(fillLeft ? x - handleWidth : x, 0, handleWidth, TRACK_HEIGHT);
        ctx.fillStyle = "#f59e0b";
        ctx.fillRect(x - gripWidth / 2, 4, gripWidth, TRACK_HEIGHT - 8);
        ctx.fillStyle = "#fff";
        ctx.fillRect(x - 1, midY - 6, 2, 2);
        ctx.fillRect(x - 1, midY, 2, 2);
        ctx.fillRect(x - 1, midY + 6, 2, 2);
      };
      if (showLeft) drawGrip(leftX, true);
      if (showRight) drawGrip(rightX, false);
    };

    const drawMarkerLine = () => {
      if (totalDuration <= 0) return;
      const mx = (markerPosition / dur) * totalWidth;
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, TRACK_HEIGHT);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const drawPlayheadLine = () => {
      if (totalDuration <= 0 || currentTime <= 0) return;
      const px = (currentTime / dur) * totalWidth;
      ctx.strokeStyle = "rgba(161, 161, 170, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, TRACK_HEIGHT);
      ctx.stroke();
    };

    // ── Clip mode ──
    if (clips) {
      if (clips.length === 0) {
        ctx.fillStyle = "#3f3f46";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          "Brak fragmentów — naciśnij „✂️ Rozetnij”, aby utworzyć nowy",
          totalWidth / 2,
          midY + 3
        );
      } else {
        clips.forEach((clip, idx) => {
          const startX = (clip.offset / dur) * totalWidth;
          const endX = startX + (clip.duration / dur) * totalWidth;
          const w = Math.max(0, endX - startX);
          const isSel = selectedClipId === clip.id;
          const isHov = hover.clipId === clip.id;

          ctx.fillStyle = isSel
            ? "rgba(245, 158, 11, 0.22)"
            : isHov
              ? "rgba(245, 158, 11, 0.12)"
              : isSelected
                ? "rgba(245, 158, 11, 0.06)"
                : "rgba(245, 158, 11, 0.04)";
          ctx.fillRect(startX, 0, w, TRACK_HEIGHT);

          if (isSel || isHov) {
            ctx.strokeStyle = isSel ? "#f59e0b" : "#f59e0b88";
            ctx.lineWidth = isSel ? 2 : 1;
            ctx.strokeRect(startX + 0.5, 0.5, Math.max(0, w - 1), TRACK_HEIGHT - 1);
          }

          drawWaveformBlock(clip.trimStart, clip.trimEnd, startX, w, isSel || isHov);

          // Dashed separator before the next clip
          if (idx < clips.length - 1) {
            ctx.strokeStyle = "#f59e0b";
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(endX, 0);
            ctx.lineTo(endX, TRACK_HEIGHT);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          ctx.fillStyle = "#a1a1aa";
          ctx.font = "9px sans-serif";
          ctx.textAlign = "left";
          ctx.fillText(clip.label, startX + 4, 12);

          // Volume deviation indicator (shown when different from the take's)
          if (Math.abs(clip.volume - take.volume) > 0.005) {
            ctx.fillStyle = clip.volume > take.volume ? "#86efac" : "#fca5a5";
            ctx.font = "9px monospace";
            ctx.textAlign = "right";
            ctx.fillText(`${Math.round(clip.volume * 100)}%`, Math.max(startX + 4, endX - 4), 12);
          }
        });
      }

      // Edge handles for hovered / selected clip
      const handleClipId = hover.clipId ?? selectedClipId;
      const handleClip = handleClipId ? clips.find((c) => c.id === handleClipId) : undefined;
      if (handleClip) {
        const hLeftX = (handleClip.offset / dur) * totalWidth;
        const hRightX = hLeftX + (handleClip.duration / dur) * totalWidth;
        const trimming = dragKind === "trim-clip";
        drawTrimHandles(
          hLeftX,
          hRightX,
          hover.edge === "start" || (trimming && sessionRef.current?.edge === "start") || selectedClipId === handleClip.id,
          hover.edge === "end" || (trimming && sessionRef.current?.edge === "end") || selectedClipId === handleClip.id
        );
      }
    } else {
      // ── Original unsplit take ──
      const startX = (take.offset / dur) * totalWidth;
      const takeDur = take.duration * (take.trimEnd - take.trimStart);
      const endX = startX + (takeDur / dur) * totalWidth;
      const trimStartX = startX + ((take.trimStart * take.duration) / dur) * totalWidth;
      const trimEndX = startX + ((take.trimEnd * take.duration) / dur) * totalWidth;

      // Dim the "dead" regions before/after the audible block
      ctx.fillStyle = "rgba(245, 158, 11, 0.03)";
      ctx.fillRect(0, 0, Math.max(0, startX), TRACK_HEIGHT);
      if (endX < totalWidth) ctx.fillRect(endX, 0, totalWidth - endX, TRACK_HEIGHT);

      ctx.fillStyle = isSelected ? "rgba(245, 158, 11, 0.08)" : "rgba(245, 158, 11, 0.04)";
      ctx.fillRect(startX, 0, endX - startX, TRACK_HEIGHT);

      drawWaveformBlock(take.trimStart, take.trimEnd, startX, endX - startX, isSelected);

      // Trim handles when selected
      const showLeftHandle = isSelected && (hover.edge === "start" || dragKind === "trim-take");
      const showRightHandle = isSelected && (hover.edge === "end" || dragKind === "trim-take");
      if (showLeftHandle || showRightHandle) {
        drawTrimHandles(trimStartX, trimEndX, showLeftHandle, showRightHandle);
      } else if (isSelected) {
        ctx.fillStyle = "rgba(245, 158, 11, 0.4)";
        ctx.fillRect(trimStartX - 1, 0, 2, TRACK_HEIGHT);
        ctx.fillRect(trimEndX - 1, 0, 2, TRACK_HEIGHT);
      }
    }

    drawPlayheadLine();
    drawMarkerLine();

    // Selection border
    if (isSelected) {
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(0.5, 0.5, totalWidth - 1, TRACK_HEIGHT - 1);
    }

    // Track label
    ctx.fillStyle = take.isMuted ? "#52525b" : "#e4e4e7";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(take.label, 8, 14);
    ctx.fillStyle = "#71717a";
    ctx.font = "9px monospace";
    ctx.fillText(cb.current.formatTime(take.duration), 8, 26);
  }, [
    take, clips, waveformData, totalDuration, zoom, currentTime, isSelected,
    totalWidth, dur, selectedClipId, hover, dragKind, markerPosition,
  ]);

  // ── Mouse interaction ──
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;

      if (clips) {
        // 1) Edge trimming — works on ANY clip, selected or not
        const edgeHit = findEdgeAt(x);
        if (edgeHit) {
          if (!isSelected) onSelect(take.id);
          if (selectedClipId !== edgeHit.clip.id) onSelectClip(edgeHit.clip.id);
          armSession({
            kind: "trim-clip",
            clipId: edgeHit.clip.id,
            edge: edgeHit.edge,
            startClientX: e.clientX,
            startEdgeTime:
              edgeHit.edge === "start" ? edgeHit.clip.offset : edgeHit.clip.offset + edgeHit.clip.duration,
            moved: false,
          });
          e.preventDefault();
          return;
        }
        // 2) Clip body — select + fluid drag in one gesture (4px threshold)
        const hitClip = clips.find((c) => {
          const sx = (c.offset / dur) * totalWidth;
          const ex = sx + (c.duration / dur) * totalWidth;
          return x >= sx && x <= ex;
        });
        if (hitClip) {
          if (!isSelected) onSelect(take.id);
          if (selectedClipId !== hitClip.id) onSelectClip(hitClip.id);
          armSession({
            kind: "clip",
            clipId: hitClip.id,
            startClientX: e.clientX,
            startOffset: hitClip.offset,
            moved: false,
          });
          e.preventDefault();
          return;
        }
        // 3) Empty area — just select the take (never toggle it off)
        if (!isSelected) onSelect(take.id);
        return;
      }

      // ── Unsplit take ──
      const trimStartX = (take.offset / dur) * totalWidth + ((take.trimStart * take.duration) / dur) * totalWidth;
      const trimEndX = (take.offset / dur) * totalWidth + ((take.trimEnd * take.duration) / dur) * totalWidth;
      const hz = handleZone(zoom);
      if (isSelected && Math.abs(x - trimStartX) < hz) {
        armSession({
          kind: "trim-take",
          edge: "start",
          startClientX: e.clientX,
          startTrim: { s: take.trimStart, e: take.trimEnd },
          moved: false,
        });
        e.preventDefault();
        return;
      }
      if (isSelected && Math.abs(x - trimEndX) < hz) {
        armSession({
          kind: "trim-take",
          edge: "end",
          startClientX: e.clientX,
          startTrim: { s: take.trimStart, e: take.trimEnd },
          moved: false,
        });
        e.preventDefault();
        return;
      }
      // Body: select if needed, then arm a fluid drag
      if (!isSelected) onSelect(take.id);
      armSession({
        kind: "take",
        startClientX: e.clientX,
        startOffset: take.offset,
        moved: false,
      });
      e.preventDefault();
    },
    [clips, findEdgeAt, isSelected, onSelect, onSelectClip, selectedClipId, take, dur, totalWidth, zoom, armSession]
  );

  // ── Window-level drag/trim listeners ──
  useEffect(() => {
    if (!dragKind) return;
    const handleMove = (e: MouseEvent) => {
      const s = sessionRef.current;
      if (!s) return;
      const dt = ((e.clientX - s.startClientX) * dur) / totalWidth;
      const rect = canvasRef.current?.getBoundingClientRect();
      const x = rect ? e.clientX - rect.left : 0;

      if (s.kind === "clip" && s.clipId) {
        const moved = s.moved || Math.abs(e.clientX - s.startClientX) > DRAG_THRESHOLD_PX;
        sessionRef.current = { ...s, moved };
        if (moved) {
          const snap = snapForZoom(zoom);
          const newOffset = Math.round(Math.max(0, (s.startOffset ?? 0) + dt) / snap) * snap;
          cb.current.onMoveClip(s.clipId, newOffset);
          setTooltip({ x, text: `Start: ${cb.current.formatTime(newOffset)}` });
        }
      } else if (s.kind === "take") {
        const moved = s.moved || Math.abs(e.clientX - s.startClientX) > DRAG_THRESHOLD_PX;
        sessionRef.current = { ...s, moved };
        if (moved) {
          const snap = snapForZoom(zoom);
          const newOffset = Math.round(Math.max(0, (s.startOffset ?? 0) + dt) / snap) * snap;
          cb.current.onUpdateOffset(newOffset);
          setTooltip({ x, text: `Start: ${cb.current.formatTime(newOffset)}` });
        }
      } else if (s.kind === "trim-clip" && s.clipId && s.edge) {
        const snap = snapForZoom(zoom) / 2;
        const newEdgeTime = Math.round(((s.startEdgeTime ?? 0) + dt) / snap) * snap;
        cb.current.onTrimClipEdge(s.clipId, s.edge, newEdgeTime);
        setTooltip({
          x,
          text: `${s.edge === "start" ? "Start" : "Koniec"}: ${cb.current.formatTime(Math.max(0, newEdgeTime))}`,
        });
      } else if (s.kind === "trim-take" && s.edge && s.startTrim) {
        const dTrim = dt / take.duration;
        const snap = zoom > 10 ? 0.0005 : zoom > 5 ? 0.001 : 0.01;
        if (s.edge === "start") {
          const ns = clamp(s.startTrim.s + dTrim, 0, s.startTrim.e - 0.02);
          cb.current.onUpdateTrim(Math.round(ns / snap) * snap, take.trimEnd);
        } else {
          const ne = clamp(s.startTrim.e + dTrim, s.startTrim.s + 0.02, 1);
          cb.current.onUpdateTrim(take.trimStart, Math.round(ne / snap) * snap);
        }
      }
    };
    const handleUp = () => {
      cb.current.onGestureEnd();
      sessionRef.current = null;
      setDragKind(null);
      setTooltip(null);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragKind, dur, totalWidth, zoom, take.duration]);

  const cursor = dragKind
    ? dragKind === "clip" || dragKind === "take"
      ? "grabbing"
      : "ew-resize"
    : hover.edge
      ? "ew-resize"
      : "grab";

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        className="rounded-lg block select-none"
        style={{
          height: TRACK_HEIGHT,
          width: totalWidth,
          opacity: take.isMuted ? 0.5 : 1,
          cursor,
          touchAction: "none",
        }}
      />
      {tooltip && (
        <div
          className="absolute pointer-events-none z-10 px-2 py-1 rounded bg-zinc-800 border border-zinc-600 text-[10px] text-amber-400 font-mono whitespace-nowrap"
          style={{ left: tooltip.x, top: TRACK_HEIGHT + 4 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WAVEFORM EDITOR (container)
// ═══════════════════════════════════════════════════════════════════════════

export interface WaveformEditorProps {
  takes: VocalTake[];
  clips: Map<string, Clip[]>;
  waveformDataCache: Map<string, Float32Array>;
  totalDuration: number;
  /**
   * The timeline length used for ruler/marker geometry. Falls back to the
   * longest take end when totalDuration is 0 (beat metadata may not have
   * loaded yet — e.g. a restored data-URL beat in a non-interactive tab).
   */
  timelineDuration: number;
  zoom: number;
  onZoomChange: (fn: (z: number) => number) => void;
  selectedTakeId: string | null;
  onSelectTake: (id: string | null) => void;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  onUpdateTakeOffset: (id: string, offset: number) => void;
  onUpdateTakeTrim: (id: string, trimStart: number, trimEnd: number) => void;
  onSplit: (takeId: string, position: number) => void;
  onDeleteClip: (takeId: string, clipId: string) => void;
  onMoveClip: (clipId: string, offset: number) => void;
  onTrimClipEdge: (clipId: string, edge: TrimEdge, newEdgeTime: number) => void;
  canUndo: boolean;
  onUndo: () => void;
  canRedo: boolean;
  onRedo: () => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  formatTime: (s: number) => string;
  currentTime: number;
  markerPosition: number;
  onMarkerChange: (t: number) => void;
}

export default function WaveformEditor(props: WaveformEditorProps) {
  const {
    takes, clips, waveformDataCache, totalDuration, timelineDuration, zoom, onZoomChange,
    selectedTakeId, onSelectTake, selectedClipId, onSelectClip,
    onUpdateTakeOffset, onUpdateTakeTrim, onSplit, onDeleteClip,
    onMoveClip, onTrimClipEdge, canUndo, onUndo, canRedo, onRedo,
    onGestureStart, onGestureEnd, formatTime, currentTime, markerPosition, onMarkerChange,
  } = props;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shortcutsRef = useRef<HTMLDivElement>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const totalWidth = BASE_WIDTH * zoom;

  // Close the shortcuts popover on outside click / Escape
  useEffect(() => {
    if (!showShortcuts) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (shortcutsRef.current && !shortcutsRef.current.contains(e.target as Node)) {
        setShowShortcuts(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowShortcuts(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [showShortcuts]);

  // Scroll to keep the playhead in view during playback
  useEffect(() => {
    if (currentTime <= 0 || !scrollContainerRef.current || !totalDuration) return;
    const container = scrollContainerRef.current;
    const px = (currentTime / totalDuration) * totalWidth;
    const scrollLeft = container.scrollLeft;
    const viewWidth = container.clientWidth;
    if (px < scrollLeft + 50 || px > scrollLeft + viewWidth - 50) {
      container.scrollTo({ left: Math.max(0, px - viewWidth / 2), behavior: "smooth" });
    }
  }, [currentTime, totalDuration, totalWidth]);

  // Ctrl/Cmd + wheel = zoom
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        onZoomChange((z) => clamp(z + (e.deltaY > 0 ? -0.25 : 0.25), 0.25, 20));
      }
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [onZoomChange]);

  const zoomLabel = useMemo(() => `${Math.round(zoom * 100)}%`, [zoom]);

  return (
    <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-zinc-800/50 flex items-center justify-between gap-4 flex-wrap">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 shrink-0">
          🎼 Edytor Fali
          <span className="text-[10px] font-normal text-zinc-500">
            ({takes.length} {takes.length === 1 ? "ścieżka" : "ścieżki"})
          </span>
        </h3>
        <div className="flex items-center gap-3 flex-1 justify-end flex-wrap">
          {/* Zoom */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium hidden sm:inline">
              Zoom
            </span>
            <button
              onClick={() => onZoomChange((z) => Math.max(0.25, z - 0.25))}
              className="w-6 h-6 rounded bg-zinc-800 text-zinc-400 text-xs hover:bg-zinc-700 hover:text-white transition-colors flex items-center justify-center"
              title="Zmniejsz zoom"
            >
              −
            </button>
            <input
              type="range"
              min="0.25"
              max="20"
              step="0.25"
              value={zoom}
              onChange={(e) => onZoomChange(() => parseFloat(e.target.value))}
              className="w-24 accent-amber-500 h-1"
              aria-label="Zoom osi czasu"
            />
            <button
              onClick={() => onZoomChange((z) => Math.min(20, z + 0.25))}
              className="w-6 h-6 rounded bg-zinc-800 text-zinc-400 text-xs hover:bg-zinc-700 hover:text-white transition-colors flex items-center justify-center"
              title="Zwiększ zoom"
            >
              +
            </button>
            <span className="text-[10px] text-zinc-500 font-mono w-10 text-right">{zoomLabel}</span>
            <button
              onClick={() => onZoomChange(() => 1)}
              className="px-1.5 h-6 rounded bg-zinc-800 text-zinc-500 text-[9px] hover:bg-zinc-700 hover:text-white transition-colors"
              title="Reset zoomu"
            >
              1:1
            </button>
          </div>

          {/* Edit actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="px-3 py-1 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-medium hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Cofnij ostatnią akcję (Ctrl+Z)"
            >
              ↩️ Cofnij
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="px-3 py-1 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-medium hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Ponów ostatnią akcję (Ctrl+Shift+Z / Ctrl+Y)"
            >
              ↪️ Ponów
            </button>
            {/* Keyboard shortcuts hint tooltip */}
            <div className="relative" ref={shortcutsRef}>
              <button
                onClick={() => setShowShortcuts((s) => !s)}
                aria-expanded={showShortcuts}
                title="Skróty klawiszowe"
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  showShortcuts
                    ? "bg-zinc-700 text-white"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white"
                }`}
              >
                ⌨️ <span className="hidden sm:inline">Skróty</span>
              </button>
              {showShortcuts && (
                <div className="absolute right-0 top-full mt-2 z-20 w-72 rounded-xl bg-zinc-900 border border-zinc-700 shadow-2xl p-3 animate-scale-in">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-2">
                    Skróty edytora fali
                  </p>
                  <ul className="space-y-1.5">
                    {EDITOR_SHORTCUTS.map((sc) => (
                      <li key={sc.keys.join("+")} className="flex items-center gap-2 text-[11px] text-zinc-300">
                        <span className="flex items-center gap-1 shrink-0">
                          {sc.keys.map((k) => (
                            <kbd
                              key={k}
                              className="px-1.5 py-0.5 rounded-md bg-zinc-800 border border-zinc-600 text-[9px] font-mono text-amber-400"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                        <span className="min-w-0">{sc.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
          {selectedTakeId && (
            <div className="flex items-center gap-2 shrink-0">
              {selectedClipId && (
                <button
                  onClick={() => onDeleteClip(selectedTakeId, selectedClipId)}
                  className="px-3 py-1 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
                  title="Usuń tylko ten fragment"
                >
                  🗑️ Usuń fragment
                </button>
              )}
              <button
                onClick={() => onSplit(selectedTakeId, markerPosition)}
                className="px-3 py-1 rounded-lg bg-amber-500/10 text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-colors"
                title={`Rozetnij w miejscu znacznika (${formatTime(markerPosition)})`}
              >
                ✂️ Rozetnij @ {formatTime(markerPosition)}
              </button>
              <button
                onClick={() => onSelectTake(null)}
                className="px-3 py-1 rounded-lg bg-zinc-800 text-zinc-500 text-xs font-medium hover:bg-zinc-700 hover:text-white transition-colors"
                title="Odznacz ścieżkę"
              >
                ✕ Odznacz
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div
        ref={scrollContainerRef}
        className="overflow-x-auto overflow-y-hidden p-2"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#3f3f46 transparent" }}
      >
        {takes.length === 0 ? (
          <div className="text-center py-12">
            <span className="text-3xl block mb-2">🎼</span>
            <p className="text-xs text-zinc-500">Nagraj wokal, aby zobaczyć edytor fali</p>
          </div>
        ) : (
          <div className="space-y-1" style={{ width: totalWidth }}>            <TimelineRuler
              totalDuration={timelineDuration}
              zoom={zoom}
              currentTime={currentTime}
              markerPosition={markerPosition}
              onMarkerChange={onMarkerChange}
            />
            {takes.map((take) => {
              const hasClips = clips.has(take.id);
              return (
                <WaveformTrack
                  key={take.id}
                  take={take}
                  clips={hasClips ? (clips.get(take.id) ?? []) : null}
                  waveformData={waveformDataCache.get(take.id)}
                  totalDuration={timelineDuration}
                  zoom={zoom}
                  currentTime={currentTime}
                  isSelected={selectedTakeId === take.id}
                  onSelect={onSelectTake}
                  selectedClipId={selectedTakeId === take.id ? selectedClipId : null}
                  onSelectClip={onSelectClip}
                  onUpdateOffset={(offset) => onUpdateTakeOffset(take.id, offset)}
                  onMoveClip={onMoveClip}
                  onUpdateTrim={(s, e) => onUpdateTakeTrim(take.id, s, e)}
                  onTrimClipEdge={onTrimClipEdge}
                  onGestureStart={onGestureStart}
                  onGestureEnd={onGestureEnd}
                  formatTime={formatTime}
                  markerPosition={markerPosition}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-zinc-800/50 text-[10px] text-zinc-600 leading-relaxed">
        💡 Kliknij na linijce czasu, aby ustawić znacznik cięcia • przeciągnij fragment, aby go
        przesunąć • chwyć krawędź (⇄), aby przyciąć start/czas trwania • Ctrl+Z = cofnij •
        Ctrl+scroll = zoom
      </div>
    </div>
  );
}
