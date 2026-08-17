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
//
// Plus per-stem files for the „Miejski Rytm” STEM MIXER on /beats — each
// track of the beat rendered into its own WAV so the page can play them
// together with per-channel muting:
//   public/stems/miejski-rytm-drums.wav   — kicks + offbeat hats
//   public/stems/miejski-rytm-bass.wav    — A2 D3 A2 E3 bassline
//   public/stems/miejski-rytm-melody.wav  — A-minor arpeggio lead
//   public/stems/miejski-rytm-vocals.wav  — synth „vocal” line with vibrato
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "public");
const STEMS = path.join(OUT, "stems");
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

/** Normalize a buffer to 90% of full scale (loop, not spread — 176k+
 *  samples would blow the Math.max argument limit). */
function normalize(out) {
  let peak = 1e-6;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  const gain = 0.9 / peak;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

/**
 * Render one stem: `addVoice({ out, n, SR, beat, totalBeats })` adds its
 * samples into a zeroed buffer, which is then normalized to full scale.
 */
function renderStem({ bpm, seconds, addVoice }) {
  const n = Math.floor(seconds * SR);
  const out = new Float64Array(n);
  const beat = 60 / bpm;
  const totalBeats = Math.floor(seconds / beat);
  addVoice({ out, n, SR, beat, totalBeats });
  return normalize(out);
}

/** Render a full beat: `kicks`/`hats`/`bass` are functions of the beat index. */
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

  return normalize(out);
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

// ── STEMS — „Miejski Rytm” split into tracks (the /beats mixer) ───────
// Each stem is one element of beat A rendered alone and normalized. The
// four WAVs layered together reconstruct the full instrumental, so muting
// any channel is audible.

// Drums — kick on every beat + offbeat hats (the boom-bap kit).
const stemsDrums = renderStem({
  bpm: 92,
  seconds: 8,
  addVoice: ({ out, n, SR, beat, totalBeats }) => {
    const kick = (t0) => {
      const s0 = Math.floor(t0 * SR);
      let phase = 0;
      for (let i = s0; i < n && i < s0 + Math.floor(0.3 * SR); i++) {
        const t = (i - s0) / SR;
        const f = 45 + 105 * Math.exp(-t * 25);
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
    for (let b = 0; b < totalBeats; b++) {
      kick(b * beat);
      hat((b + 0.5) * beat);
    }
    for (let i = 0; i < 4; i++) hat(totalBeats * beat + i * 0.11);
  },
});

// Bass — A2 D3 A2 E3 on alternating beats.
const stemsBass = renderStem({
  bpm: 92,
  seconds: 8,
  addVoice: ({ out, n, SR, beat, totalBeats }) => {
    const note = (t0, freq, dur) => {
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
      note(b * beat, basslineA[Math.floor(b / 2) % basslineA.length], beat * 0.9);
    }
  },
});

// Melody — A-minor arpeggio (A4 C5 E5 G5) on every beat, triangle timbre.
const melodyNotes = [440.0, 523.25, 659.25, 783.99]; // A4 C5 E5 G5
const stemsMelody = renderStem({
  bpm: 92,
  seconds: 8,
  addVoice: ({ out, n, SR, beat, totalBeats }) => {
    const note = (t0, freq, dur) => {
      const s0 = Math.floor(t0 * SR);
      let phase = 0;
      const len = Math.min(Math.floor(dur * SR), n - s0);
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        phase += (2 * Math.PI * freq) / SR;
        // Triangle wave (cheap, cuts through the bass/drums).
        const tri = 2 * Math.abs(2 * (phase / (2 * Math.PI) - Math.floor(phase / (2 * Math.PI) + 0.5))) - 1;
        out[s0 + i] += tri * 0.4 * Math.exp(-t * 3);
      }
    };
    for (let b = 0; b < totalBeats; b++) {
      note(b * beat, melodyNotes[b % melodyNotes.length], beat * 0.45);
    }
  },
});

// Vocals — synth „vocal” line (E4 G4 A4 G4) with vibrato, held notes on
// every other beat — stands in for an acapella until real takes exist.
const vocalNotes = [329.63, 392.0, 440.0, 392.0]; // E4 G4 A4 G4
const stemsVocals = renderStem({
  bpm: 92,
  seconds: 8,
  addVoice: ({ out, n, SR, beat, totalBeats }) => {
    const note = (t0, freq, dur) => {
      const s0 = Math.floor(t0 * SR);
      let phase = 0;
      const len = Math.min(Math.floor(dur * SR), n - s0);
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const vib = 1 + 0.008 * Math.sin(2 * Math.PI * 5.5 * t); // vibrato
        phase += (2 * Math.PI * freq * vib) / SR;
        const saw = 2 * (phase / (2 * Math.PI) - Math.floor(phase / (2 * Math.PI) + 0.5));
        out[s0 + i] += saw * 0.18 * Math.exp(-t * 2.2);
      }
    };
    for (let b = 0; b < totalBeats; b += 2) {
      note(b * beat, vocalNotes[(b / 2) % vocalNotes.length], beat * 1.4);
    }
  },
});

const stemFiles = [
  ["miejski-rytm-drums.wav", stemsDrums],
  ["miejski-rytm-bass.wav", stemsBass],
  ["miejski-rytm-melody.wav", stemsMelody],
  ["miejski-rytm-vocals.wav", stemsVocals],
];
for (const [file, samples] of stemFiles) {
  writeFileSync(path.join(STEMS, file), wavBuffer(samples));
}

for (const [file, samples] of [
  ["test-beat-a.wav", beatA],
  ["test-beat-b.wav", beatB],
  ...stemFiles,
]) {
  let peak = 0;
  for (const v of samples) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  console.log(`  • ${file}: ${(samples.length / SR).toFixed(1)}s, ${(samples.length * 2 / 1024).toFixed(0)} KB, peak ${peak.toFixed(2)}`);
}
