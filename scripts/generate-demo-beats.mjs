#!/usr/bin/env node
// ─── Demo beat generator ────────────────────────────────────────────────
// Writes REAL, playable 16-bit PCM WAVs into public/ for the seeded
// „Gotowe Numery” library. The previous test-beat-*.wav were 1 KB empty
// placeholders (all-zero PCM) that Chrome never decoded, so the play button
// on seeded beats did nothing. Re-run with:  npm run gen:beats
//
// Output (two distinct instrumentals):
//   public/test-beat-a.wav — boom-bap feel, 92 BPM („Miejski Rytm”)
//   public/test-beat-b.wav — trap feel,      128 BPM („Nocny Drive”)
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "public");
const SR = 22050; // same format the E2E suite generates (decodes in Chrome)

function wavBuffer(samples) {
  const n = samples.length;
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]))), 44 + i * 2);
  }
  return buf;
}

/** Render a beat: `kicks`/`hats`/`bass` are functions of the beat index. */
function render({ bpm, seconds, kickOn, hatOn, bassOn }) {
  const n = Math.floor(seconds * SR);
  const out = new Float64Array(n);
  const beat = 60 / bpm;
  const totalBeats = Math.floor(seconds / beat);

  const kick = (t0) => {
    const s0 = Math.floor(t0 * SR);
    let phase = 0;
    for (let i = s0; i < n && i < s0 + Math.floor(0.3 * SR); i++) {
      const t = (i - s0) / SR;
      const f = 45 + 105 * Math.exp(-t * 25); // pitch sweep 150→45 Hz
      phase += (2 * Math.PI * f) / SR;
      out[i] += Math.sin(phase) * Math.exp(-t * 9);
    }
  };

  const hat = (t0) => {
    const s0 = Math.floor(t0 * SR);
    for (let i = s0; i < n && i < s0 + Math.floor(0.09 * SR); i++) {
      const t = (i - s0) / SR;
      out[i] += (Math.random() * 2 - 1) * 0.3 * Math.exp(-t * 55);
    }
  };

  const bass = (t0, freq, dur) => {
    const s0 = Math.floor(t0 * SR);
    let phase = 0;
    const len = Math.min(Math.floor(dur * SR), n - s0);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      phase += (2 * Math.PI * freq) / SR;
      out[s0 + i] += Math.sin(phase) * 0.55 * Math.exp(-t * 4);
    }
  };

  for (let b = 0; b < totalBeats; b++) {
    if (kickOn(b)) kick(b * beat);
    if (hatOn(b)) hat((b + 0.5) * beat);
    if (bassOn(b)) bass(b * beat, bassOn(b), beat * 0.9);
  }
  // A few closing hats so the loop end isn't a hard cut.
  for (let i = 0; i < 4; i++) hat(totalBeats * beat + i * 0.11);

  // Normalize to full scale (master) — loop, not spread: 176k+ samples would
  // blow the Math.max argument limit.
  let peak = 1e-6;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  const gain = 0.9 / peak;
  for (let i = 0; i < n; i++) out[i] *= gain;
  return out;
}

// ── Beat A — „Miejski Rytm” (boom bap, 92 BPM) ────────────────────────
// Kick on every beat, hat on the offbeats, bass alternating A-D-A-E.
const basslineA = [110.0, 146.83, 110.0, 164.81]; // A2 D3 A2 E3
const beatA = render({
  bpm: 92,
  seconds: 8,
  kickOn: () => true,
  hatOn: () => true,
  bassOn: (b) => basslineA[Math.floor(b / 2) % basslineA.length],
});
writeFileSync(path.join(OUT, "test-beat-a.wav"), wavBuffer(beatA));

// ── Beat B — „Nocny Drive” (trap, 128 BPM) ────────────────────────────
// Kick on 1 and 3 of each bar, 16th-note hats, 808-ish bass glides.
const basslineB = [65.41, 73.42, 65.41, 98.0]; // C2 D2 C2 G2
const beatB = render({
  bpm: 128,
  seconds: 7.5,
  kickOn: (b) => b % 4 === 0 || b % 4 === 2,
  hatOn: (b) => true,
  bassOn: (b) => (b % 2 === 0 ? basslineB[(b / 2) % basslineB.length] : null),
});
writeFileSync(path.join(OUT, "test-beat-b.wav"), wavBuffer(beatB));

for (const [file, samples] of [
  ["test-beat-a.wav", beatA],
  ["test-beat-b.wav", beatB],
]) {
  let peak = 0;
  for (const v of samples) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  console.log(`  • ${file}: ${(samples.length / SR).toFixed(1)}s, ${(samples.length * 2 / 1024).toFixed(0)} KB, peak ${peak.toFixed(2)}`);
}
