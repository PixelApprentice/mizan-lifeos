// Procedural soundtrack, synced to the trailer timeline. No samples, no network:
// pads, bass, arp, drums, risers, impacts and whooshes are synthesized here and
// written as a 16-bit stereo WAV.
//
// Energy per scene drives the arrangement: 0 = pad only, 1 = half-time drums,
// 2 = full groove with arp. Impacts land on scene starts where energy jumps.

import { writeFileSync } from "node:fs";

const SR = 44100;
const TAU = Math.PI * 2;

// i–VI–III–VII in A minor; override with config.music.chords.
const DEFAULT_CHORDS = [
  { bass: 55.0, notes: [220.0, 261.63, 329.63] },
  { bass: 43.65, notes: [174.61, 220.0, 261.63] },
  { bass: 65.41, notes: [261.63, 329.63, 392.0] },
  { bass: 49.0, notes: [196.0, 246.94, 293.66] },
];

function noiseGen(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
}

export function synthesize({ bpm, total, scenes, chords = DEFAULT_CHORDS, tail = 2.5 }) {
  const n = Math.ceil((total + tail) * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const beat = 60 / bpm, bar = beat * 4;
  const energyAt = (t) => scenes.find((s) => t >= s.start && t < s.start + s.dur)?.energy ?? 0;
  const noise = noiseGen(1234567);
  const add = (i, l, r = l) => { if (i >= 0 && i < n) { L[i] += l; R[i] += r; } };
  const duck = new Float32Array(n).fill(1);

  // ---- drums ----
  const beats = Math.ceil(total / beat);
  for (let b = 0; b < beats; b++) {
    const t0 = b * beat, e = energyAt(t0 + 0.001), inBar = b % 4;
    if (e >= 2 || (e >= 1 && inBar % 2 === 0)) {
      const i0 = Math.round(t0 * SR);
      for (let k = 0; k < 0.5 * SR; k++) {
        const t = k / SR;
        const phase = TAU * (44 * t + (95 * (1 - Math.exp(-28 * t))) / 28);
        const v = Math.sin(phase) * Math.exp(-6.5 * t) * 0.85 + (k < 90 ? noise() * 0.25 * (1 - k / 90) : 0);
        add(i0 + k, v);
        if (i0 + k < n) duck[i0 + k] = Math.min(duck[i0 + k], 1 - 0.65 * Math.exp(-9 * t));
      }
    }
    if (e >= 2 && inBar % 2 === 1) {
      const i0 = Math.round(t0 * SR);
      let lp = 0;
      for (let k = 0; k < 0.35 * SR; k++) {
        const t = k / SR;
        lp += 0.5 * (noise() - lp);
        const v = lp * Math.exp(-16 * t) * 0.42 + Math.sin(TAU * 185 * t) * Math.exp(-24 * t) * 0.22;
        add(i0 + k, v * 0.95, v);
      }
    }
    const hats = e >= 2 ? 4 : e >= 1 ? 2 : 0;
    for (let h = 0; h < hats; h++) {
      if (hats === 2 && h === 0) continue;
      const i0 = Math.round((t0 + (h * beat) / hats) * SR);
      const accent = (hats === 4 && h === 2) || hats === 2 ? 1 : 0.55;
      let prev = 0;
      for (let k = 0; k < 0.06 * SR; k++) {
        const x = noise(), hp = x - prev; prev = x;
        const v = hp * Math.exp(-(k / SR) * 70) * 0.075 * accent;
        add(i0 + k, v * (h % 2 ? 0.7 : 1), v * (h % 2 ? 1 : 0.7));
      }
    }
  }

  // ---- bass + pad + arp, per bar ----
  const bars = Math.ceil((total + tail) / bar);
  const delayL = new Float32Array(n), delayR = new Float32Array(n);
  for (let b = 0; b < bars; b++) {
    const chord = chords[b % chords.length];
    const bs = b * bar, be = bs + bar;
    const e = energyAt(bs + 0.001);
    const ending = bs >= total - 0.01;

    // pad: three detuned saws per note through a one-pole low-pass
    const cutoff = ending ? 700 : [900, 1400, 2300][e] ?? 900;
    const a = Math.exp((-TAU * cutoff) / SR);
    const lp = [0, 0];
    const i0 = Math.round(bs * SR), i1 = Math.min(n, Math.round((be + 0.35) * SR));
    for (let i = i0; i < i1; i++) {
      const t = i / SR - bs;
      const env = Math.min(1, t / 0.35) * (i / SR > be ? Math.exp(-(i / SR - be) * 9) : 1);
      let l = 0, r = 0;
      for (const f of chord.notes) {
        for (const [d, pan] of [[-0.0045, 0.2], [0, 0.5], [0.005, 0.8]]) {
          const ph = (f * (1 + d) * t) % 1;
          const v = 2 * ph - 1;
          l += v * (1 - pan);
          r += v * pan;
        }
      }
      lp[0] = (1 - a) * l + a * lp[0];
      lp[1] = (1 - a) * r + a * lp[1];
      const g = 0.03 * env * (ending ? 1.2 : 1) * duck[i];
      L[i] += lp[0] * g;
      R[i] += lp[1] * g;
    }

    // bass on eighths
    if (e >= 1 && !ending) {
      for (let k = 0; k < 8; k++) {
        if (e === 1 && k % 2) continue;
        const s0 = bs + (k * beat) / 2, j0 = Math.round(s0 * SR);
        for (let j = 0; j < (beat / 2) * SR; j++) {
          const t = j / SR, f = chord.bass;
          const v = (Math.sin(TAU * f * t) + 0.45 * Math.sin(TAU * 2 * f * t) + 0.15 * Math.sin(TAU * 3 * f * t)) * Math.exp(-3.5 * t) * Math.min(1, t * 300);
          if (j0 + j < n) { L[j0 + j] += v * 0.26 * duck[j0 + j]; R[j0 + j] += v * 0.26 * duck[j0 + j]; }
        }
      }
    }

    // arp on sixteenths, into a ping-pong delay
    if (e >= 2 && !ending) {
      const order = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 2];
      for (let k = 0; k < 16; k++) {
        const f = chord.notes[order[k]] * 2, s0 = bs + (k * beat) / 4, j0 = Math.round(s0 * SR);
        for (let j = 0; j < 0.22 * SR; j++) {
          const t = j / SR;
          const v = (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t)) * Math.exp(-16 * t) * Math.min(1, t * 400) * 0.075;
          if (j0 + j < n) { delayL[j0 + j] += v; L[j0 + j] += v * 0.8; R[j0 + j] += v * 0.8; }
        }
      }
    }
  }
  const dly = Math.round(beat * 0.75 * SR);
  for (let i = dly; i < n; i++) {
    delayR[i] += delayL[i - dly] * 0.55;
    if (i >= 2 * dly) delayL[i] += delayR[i - dly] * 0.4;
    L[i] += delayL[i] * 0.35;
    R[i] += delayR[i] * 0.5;
  }

  // ---- effects at scene boundaries ----
  let prevEnergy = 0;
  scenes.forEach((s, idx) => {
    const T = s.start;
    if (idx > 0 && s.energy > prevEnergy) {
      // riser over the last two beats before a lift
      const r0 = Math.round((T - 2 * beat) * SR), len = Math.round(2 * beat * SR);
      let lp2 = 0;
      for (let j = 0; j < len; j++) {
        const x = j / len, c = 300 + 7000 * x * x, k = 1 - Math.exp((-TAU * c) / SR);
        lp2 += k * (noise() - lp2);
        const sweep = Math.sin(TAU * (200 * (j / SR) + 600 * x * x * (j / SR)));
        const v = (lp2 * 0.22 + sweep * 0.025) * x * x;
        add(r0 + j, v * (1 - x * 0.5), v * (0.5 + x * 0.5));
      }
    }
    if (s.impact ?? (idx > 0 && s.energy > prevEnergy) ?? false) impact(T, 1);
    else if (idx > 0 && s.transition && s.transition !== "cut") whoosh(T);
    if (s.type === "words") {
      const per = s.dur / s.words.length;
      s.words.forEach((_, k) => k > 0 && impact(T + k * per, 0.45));
    }
    if (s.type === "montage") (s.clips || []).forEach((c, k) => k > 0 && impact(T + c.start, 0.4));
    if (s.type === "collapse" && s.cue) {
      // A rising notification ping per item, a reverse swell into the pull, a hit on the answer.
      s.cue.appear.forEach((at, k) => blip(T + at, 660 * Math.pow(2, (k % 5) / 12 * 2), 0.16 + 0.02 * k));
      swell(T + s.cue.suck - 0.6, 0.9);
      impact(T + s.cue.title, 0.8);
    }
    prevEnergy = s.energy;
  });
  impact(scenes.at(-1).start, 0.9);

  function impact(T, gain) {
    const i0 = Math.round(T * SR);
    let lpn = 0;
    for (let j = 0; j < 2.2 * SR; j++) {
      const t = j / SR;
      lpn += 0.08 * (noise() - lpn);
      const v = (Math.sin(TAU * (38 * t + (50 * (1 - Math.exp(-7 * t))) / 7)) * Math.exp(-2.4 * t) * 0.85 + lpn * Math.exp(-3.5 * t) * 1.4) * gain;
      add(i0 + j, v);
    }
  }
  function blip(T, f, gain) {
    const i0 = Math.round(T * SR), pan = 0.5 + 0.35 * Math.sin(f);
    for (let j = 0; j < 0.25 * SR; j++) {
      const t = j / SR;
      const v = (Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * f * 1.5 * t) * Math.exp(-30 * t)) * Math.exp(-14 * t) * Math.min(1, t * 800) * gain;
      add(i0 + j, v * (1.2 - pan), v * (0.2 + pan));
    }
  }
  function swell(T, len) {
    const i0 = Math.round(T * SR), m = Math.round(len * SR);
    let lp4 = 0;
    for (let j = 0; j < m; j++) {
      const x = j / m, c = 200 + 6000 * x * x * x, k = 1 - Math.exp((-TAU * c) / SR);
      lp4 += k * (noise() - lp4);
      const v = lp4 * x * x * 0.5;
      add(i0 + j, v, v);
    }
  }
  function whoosh(T) {
    const len = Math.round(0.55 * SR), i0 = Math.round(T * SR) - Math.round(0.3 * SR);
    let lp3 = 0;
    for (let j = 0; j < len; j++) {
      const x = j / len, c = 5500 - 4800 * x, k = 1 - Math.exp((-TAU * c) / SR);
      lp3 += k * (noise() - lp3);
      const v = lp3 * Math.sin(Math.PI * x) * 0.28;
      add(i0 + j, v * (1 - x), v * x);
    }
  }

  // ---- master: soft clip, normalize, fades ----
  let peak = 0;
  for (let i = 0; i < n; i++) {
    L[i] = Math.tanh(L[i] * 1.15);
    R[i] = Math.tanh(R[i] * 1.15);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const g = 0.89 / (peak || 1);
  const fadeIn = 0.03 * SR, fadeOutStart = (total + tail - 2.2) * SR;
  for (let i = 0; i < n; i++) {
    let f = Math.min(1, i / fadeIn);
    if (i > fadeOutStart) f *= Math.max(0, 1 - (i - fadeOutStart) / (2.2 * SR));
    L[i] *= g * f;
    R[i] *= g * f;
  }
  return { L, R, sampleRate: SR };
}

export function writeWav(file, { L, R, sampleRate }) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(file, buf);
}
