// Calm product-launch soundtrack for the keynote style. Same contract as audio.mjs:
// synthesize({ bpm, total, scenes, chords }) → { L, R, sampleRate }.
//
// Layers: warm pad, soft piano-like plucks (sparse in statements, flowing in features),
// a round sub, a felt kick and shaker once the tour starts, swells into the logo and the
// end card, and a shared reverb so everything sits in one room. Scene `mood` (0–2)
// overrides how busy the music is; by default it follows the scene type.

const SR = 44100;
const TAU = Math.PI * 2;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Dmaj9 – Bm9 – Gmaj9 – A6sus. Bright, open, unhurried.
const DEFAULT_CHORDS = [
  { bass: 38, notes: [62, 66, 69, 73, 76] },
  { bass: 35, notes: [59, 62, 66, 69, 73] },
  { bass: 31, notes: [55, 59, 62, 66, 69] },
  { bass: 33, notes: [57, 62, 64, 66, 69] },
];
const MOOD = { statement: 0, logo: 0, hero: 1, feature: 2, phone: 2, list: 1, grid: 2, end: 0 };

function noiseGen(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
}

export function synthesize({ bpm, total, scenes, chords, tail = 0 }) {
  const progression = (chords?.length && typeof chords[0].bass === "number" && chords[0].bass < 128) ? chords : DEFAULT_CHORDS;
  const n = Math.ceil((total + tail) * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const sendL = new Float32Array(n), sendR = new Float32Array(n);
  const beat = 60 / bpm, bar = beat * 4;
  const sceneAt = (t) => scenes.find((s) => t >= s.start && t < s.start + s.dur);
  const moodAt = (t) => { const s = sceneAt(t); return s ? s.mood ?? MOOD[s.type] ?? 1 : 0; };
  const chordAt = (t) => progression[Math.floor(t / bar) % progression.length];
  const noise = noiseGen(424242);
  const add = (i, l, r, send = 0.3) => {
    if (i < 0 || i >= n) return;
    L[i] += l; R[i] += r; sendL[i] += l * send; sendR[i] += r * send;
  };
  const fadeOut = (t) => Math.min(1, Math.max(0, (total - t) / 1.6));

  // ---- pad: detuned sines, slow swell per bar ----
  for (let b = 0; b * bar < total; b++) {
    const t0 = b * bar, ch = chordAt(t0 + 0.01);
    const level = 0.05 + 0.015 * Math.min(2, moodAt(t0 + 0.01));
    const len = bar + 1.2;
    for (const [j, m] of ch.notes.slice(0, 4).entries()) {
      const f = hz(m - 12), pan = (j / 3 - 0.5) * 0.8;
      for (let k = 0; k < len * SR; k++) {
        const t = k / SR, at = t0 + t;
        const env = Math.min(1, t / 0.9) * Math.min(1, (len - t) / 1.2) * fadeOut(at);
        const v = (Math.sin(TAU * f * t) + 0.6 * Math.sin(TAU * f * 1.003 * t + j) + 0.25 * Math.sin(TAU * f * 2.001 * t)) * env * level / 1.85;
        add(Math.round(at * SR), v * (1 - pan), v * (1 + pan), 0.5);
      }
    }
  }

  // ---- plucks: piano-like (harmonics with faster decay up high) ----
  const pluck = (at, m, vel, pan) => {
    const f = hz(m), i0 = Math.round(at * SR), len = 2.4;
    for (let k = 0; k < len * SR; k++) {
      const t = k / SR;
      const atk = Math.min(1, t / 0.004);
      let v = 0;
      for (let h = 1; h <= 6; h++) v += Math.sin(TAU * f * h * t * (1 + 0.0004 * h * h)) * Math.exp(-t * (1.6 + h * 1.4)) / h ** 1.3;
      v *= atk * vel * 0.16 * fadeOut(at + t);
      add(i0 + k, v * (1 - pan), v * (1 + pan), 0.45);
    }
  };
  const steps = Math.ceil(total / (beat / 2));
  for (let k = 0; k < steps; k++) {
    const at = k * (beat / 2), mood = moodAt(at + 0.001);
    const s = sceneAt(at + 0.001);
    if (!s || s.type === "end" && at - s.start > 2.5) continue;
    const pos = k % 8;
    const play = mood >= 2 ? true : mood === 1 ? pos % 2 === 0 : pos === 0 || pos === 3 || pos === 6;
    if (!play) continue;
    const ch = chordAt(at + 0.001);
    const pattern = [0, 2, 1, 3, 4, 2, 3, 1];
    const note = ch.notes[pattern[pos] % ch.notes.length] + (mood >= 2 && pos === 4 ? 12 : 0);
    const vel = (pos === 0 ? 1 : 0.62) * (0.85 + 0.15 * Math.sin(k * 1.7));
    pluck(at, note, vel, Math.sin(k * 0.9) * 0.35);
  }

  // ---- sub ----
  for (let b = 0; b * bar < total; b++) {
    const t0 = b * bar, mood = moodAt(t0 + 0.01);
    if (mood < 1) continue;
    const f = hz(chordAt(t0 + 0.01).bass + 12);
    for (const off of mood >= 2 ? [0, beat * 2.5] : [0]) {
      const len = mood >= 2 ? beat * 2.2 : bar;
      for (let k = 0; k < len * SR; k++) {
        const t = k / SR;
        const env = Math.min(1, t / 0.02) * Math.min(1, (len - t) / 0.25) * fadeOut(t0 + off + t);
        const v = (Math.sin(TAU * f * t) + 0.18 * Math.sin(TAU * f * 2 * t)) * env * 0.17;
        add(Math.round((t0 + off) * SR) + k, v, v, 0.05);
      }
    }
  }

  // ---- felt kick + shaker ----
  for (let b = 0; b * beat < total; b++) {
    const at = b * beat, mood = moodAt(at + 0.001);
    if (mood >= 2 && b % 2 === 0) {
      const i0 = Math.round(at * SR);
      for (let k = 0; k < 0.4 * SR; k++) {
        const t = k / SR;
        const v = Math.sin(TAU * (48 * t + (70 * (1 - Math.exp(-30 * t))) / 30)) * Math.exp(-9 * t) * 0.42 * fadeOut(at);
        add(i0 + k, v, v, 0.02);
      }
    }
    if (mood >= 1) {
      for (const half of [0.5, 1]) {
        if (mood < 2 && half === 1) continue;
        const i0 = Math.round((at + beat * half) * SR);
        let hp = 0, prev = 0;
        for (let k = 0; k < 0.09 * SR; k++) {
          const t = k / SR, x = noise();
          hp = 0.92 * (hp + x - prev); prev = x;
          const v = hp * Math.exp(-t * 55) * Math.min(1, t / 0.006) * 0.05 * fadeOut(at);
          add(i0 + k, v * 0.7, v * 1.3, 0.2);
        }
      }
    }
  }

  // ---- swells into the logo and the end card, a bloom when they land ----
  for (const s of scenes) {
    if (s.type !== "logo" && s.type !== "end") continue;
    const T = s.start, dur = 2.2;
    let lp = 0;
    for (let k = 0; k < dur * SR; k++) {
      const t = k / SR, x = t / dur;
      lp += (0.02 + 0.25 * x * x) * (noise() - lp);
      const v = lp * x ** 2.4 * 0.35;
      add(Math.round((T - dur) * SR) + k, v, v * 0.9, 0.6);
    }
    const ch = chordAt(T + 0.01);
    for (const [j, m] of [ch.bass + 12, ...ch.notes.slice(0, 3)].entries()) {
      const f = hz(m), i0 = Math.round(T * SR);
      for (let k = 0; k < 4 * SR; k++) {
        const t = k / SR;
        const v = Math.sin(TAU * f * t) * Math.exp(-t * 0.9) * Math.min(1, t / 0.01) * (j ? 0.07 : 0.2);
        add(i0 + k, v, v, 0.6);
      }
    }
  }

  // ---- reverb (Schroeder: parallel combs → series allpasses) ----
  const reverb = (input, offset) => {
    const out = new Float32Array(n);
    for (const d of [1557, 1617, 1491, 1422].map((x) => x + offset)) {
      const buf = new Float32Array(d); let p = 0, lp = 0;
      for (let i = 0; i < n; i++) {
        const y = buf[p];
        lp = y * 0.6 + lp * 0.4;
        buf[p] = input[i] + lp * 0.84;
        p = (p + 1) % d;
        out[i] += y * 0.25;
      }
    }
    for (const d of [556 + offset, 225 + offset]) {
      const buf = new Float32Array(d); let p = 0;
      for (let i = 0; i < n; i++) {
        const b = buf[p], y = -out[i] + b;
        buf[p] = out[i] + b * 0.5;
        p = (p + 1) % d;
        out[i] = y;
      }
    }
    return out;
  };
  const wetL = reverb(sendL, 0), wetR = reverb(sendR, 23);

  // ---- mix, gentle limiter, normalize ----
  let peak = 0;
  for (let i = 0; i < n; i++) {
    L[i] = Math.tanh((L[i] + wetL[i] * 0.55) * 1.1);
    R[i] = Math.tanh((R[i] + wetR[i] * 0.55) * 1.1);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const g = peak > 0 ? 0.89 / peak : 1;
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  return { L, R, sampleRate: SR };
}
