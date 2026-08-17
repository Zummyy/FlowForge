#!/usr/bin/env node
// ─── PWA icon generator ─────────────────────────────────────────────────
// Draws the FlowForge app icons (dark rounded square + amber „equalizer
// bars” motif, matching the beat-card visual language) and writes real PNGs
// to public/. The manifest + apple-touch-icon link reference these files,
// and Chrome requires a 192px + 512px icon to make the app installable.
//
// Zero dependencies: a minimal PNG encoder (RGBA, 8-bit, zlib from node)
// + 2× supersampled rasterizer for smooth edges. Re-run with:
//   npm run gen:icons
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "public");

// ── Minimal PNG encoder (no deps) ─────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ── Rasterizer (2× supersampled, straight-alpha floats) ───────────────
function drawIcon(size) {
  const SS = 2;
  const S = size * SS;
  const img = new Float32Array(S * S * 4);
  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
    const i = (y * S + x) * 4;
    const na = a + img[i + 3] * (1 - a);
    if (na <= 0) return;
    img[i] = (r * a + img[i] * img[i + 3] * (1 - a)) / na;
    img[i + 1] = (g * a + img[i + 1] * img[i + 3] * (1 - a)) / na;
    img[i + 2] = (b * a + img[i + 2] * img[i + 3] * (1 - a)) / na;
    img[i + 3] = na;
  };

  // Full-bleed dark vertical gradient background (safe for maskable).
  for (let y = 0; y < S; y++) {
    const t = y / S;
    const shade = 0.062 - 0.024 * t; // #0f0f14 → #0a0a0d
    for (let x = 0; x < S; x++) put(x, y, shade, shade, shade + 0.005, 1);
  }

  // Soft amber glow behind the bars.
  const cx = S / 2;
  const cy = S * 0.46;
  const glowR = S * 0.34;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - cy) / glowR;
      if (d < 1) {
        const a = 0.11 * (1 - d) * (1 - d);
        put(x, y, 0.96, 0.62, 0.04, a);
      }
    }
  }

  // Equalizer bars: 5 pills, centered, heights as fractions of the icon.
  const heights = [0.34, 0.55, 0.42, 0.66, 0.30];
  const barW = S * 0.085;
  const gap = S * 0.032;
  const totalW = 5 * barW + 4 * gap;
  const baseY = S * 0.76; // baseline (from top)
  const x0 = (S - totalW) / 2;
  for (let i = 0; i < 5; i++) {
    const bx = x0 + i * (barW + gap);
    const h = S * heights[i];
    const top = baseY - h;
    for (let y = Math.floor(top); y < Math.floor(baseY); y++) {
      for (let x = Math.floor(bx); x < Math.floor(bx + barW); x++) {
        // Vertical pill: rounded ends via distance from the straight part.
        const cap = Math.max(top - y, y - (baseY - 1), 0);
        if (cap > barW / 2) continue;
        const edge = Math.max(0, 1 - cap / (barW / 2));
        const dx = Math.max(bx - x, x - (bx + barW - 1), 0);
        const hEdge = Math.max(0, 1 - dx);
        const a = Math.max(0, Math.min(1, edge)) * Math.max(0, Math.min(1, hEdge));
        // Vertical amber gradient (#f59e0b → #fbbf24).
        const g = (y - top) / h;
        put(x, y, 0.96 - 0.05 * g, 0.62 + 0.1 * g, 0.04, a * 0.98);
      }
    }
  }

  // Downsample 2× → final RGBA bytes.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * S + (x * SS + dx)) * 4;
          r += img[i];
          g += img[i + 1];
          b += img[i + 2];
          a += img[i + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round((r / n) * 255);
      out[o + 1] = Math.round((g / n) * 255);
      out[o + 2] = Math.round((b / n) * 255);
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePng(size, size, out);
}

for (const size of [192, 512]) {
  const png = drawIcon(size);
  writeFileSync(path.join(OUT, `icon-${size}.png`), png);
  console.log(`  • icon-${size}.png: ${png.length} bytes`);
}
