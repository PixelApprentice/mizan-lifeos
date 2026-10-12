// Cinematic electronic score for the cinema style. Same contract as audio.mjs:
// synthesize({ bpm, total, scenes, chords, foley }) → { L, R, sampleRate }.
//
// Arrangement follows each scene's `mood`: 0 = ambient (pad, sparse bells), 1 = build
// (filter opens, hats, pulse), 2 = groove (four-on-the-floor, clap, sidechained bass, arp),
// 3 = full (groove + open hats + wide stabs). Scenes with `drop: true` get a riser before
// and an impact on the downbeat. Camera flights get whooshes, the lid opening gets a boot
// chime, and `foley` cues (clicks, keys, drags, wheel ticks from the recording) get small
// interface sounds placed exactly where they happen on screen.

const SR = 44100;
const TAU = Math.PI * 2;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Fm9 – Dbmaj9 – Abmaj9 – Eb6/9: warm, a little wistful, lifts on the last bar.
const DEFAULT_CHORDS = [
  { bass: 41, notes: [56, 60, 63, 67, 72] },
  { bass: 37, notes: [56, 60, 63, 65, 72] },
  { bass: 44, notes: [56, 60, 63, 67, 70] },
  { bass: 39, notes: [55, 58, 63, 65, 70] },
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

export function synthesize({ bpm, total, scenes, chords, tail = 0, foley = [] }) {
  const progression = (chords?.length && typeof chords[0].bass === "number" && chords[0].bass < 128) ? chords : DEFAULT_CHORDS;
  const n = Math.ceil((total + tail) * SR);
  const beat = 60 / bpm, bar = beat * 4, s16 = beat / 4;
  const bus = () => ({ L: new Float32Array(n), R: new Float32Array(n) });
  const music = bus(), drums = bus(), fx = bus(), ui = bus(), send = bus();
  const noise = noiseGen(777);
  const rnd = noiseGen(31337);
  const sceneAt = (t) => scenes.find((s) => t >= s.start && t < s.start + s.dur);
  const moodAt = (t) => sceneAt(t)?.mood ?? 1;
  const chordAt = (t) => progression[Math.floor(t / bar) % progression.length];
  const endScene = scenes[scenes.length - 1];
  const fadeOut = (t) => Math.min(1, Math.max(0, (total - t) / 2.2));
  const put = (b, i, l, r, rev = 0) => {
    if (i < 0 || i >= n) return;
    b.L[i] += l; b.R[i] += r;
    if (rev) { send.L[i] += l * rev; send.R[i] += r * rev; }
  };
  // How far into a scene's build we are (mood 1 opens the filter as it goes).
  const openness = (t) => {
    const s = sceneAt(t);
    if (!s) return 0;
    const m = s.mood ?? 1;
    if (m === 1) return 0.25 + 0.6 * ((t - s.start) / s.dur) ** 1.5;
    return [0.12, 0.5, 0.75, 1][m];
  };

  // ---- pad: detuned saws through a moving low-pass, spread wide ----
  for (let b = 0; b * bar < total; b++) {
    const t0 = b * bar, ch = chordAt(t0 + 0.01), len = bar + 0.8;
    const voices = ch.notes.slice(0, 4);
    voices.forEach((m, j) => {
      for (const [d, pan] of [[-0.11, -0.85], [0, 0], [0.12, 0.85]]) {
        const f = hz(m) * 2 ** (d / 12);
        let ph = rnd() * 0.5 + 0.5, lp1 = 0, lp2 = 0;
        const i0 = Math.round(t0 * SR);
        for (let k = 0; k < len * SR; k++) {
          const at = t0 + k / SR;
          if (at >= total) break;
          ph += f / SR; if (ph >= 1) ph -= 1;
          const saw = 2 * ph - 1;
          const cut = 250 + 3200 * openness(at) ** 2;
          const a = 1 - Math.exp((-TAU * cut) / SR);
          lp1 += a * (saw - lp1); lp2 += a * (lp1 - lp2);
          const env = Math.min(1, k / SR / 0.5) * Math.min(1, (len - k / SR) / 0.8) * fadeOut(at);
          const v = lp2 * env * 0.034;
          put(music, i0 + k, v * (1 - pan * 0.9), v * (1 + pan * 0.9), 0.55);
        }
      }
    });
  }

  // ---- bass: sustained in builds, pumping offbeat 8ths in grooves ----
  for (let b = 0; b * beat < total; b++) {
    const at = b * beat, mood = moodAt(at + 0.001);
    if (mood < 1) continue;
    const root = chordAt(at + 0.001).bass;
    const hits = mood >= 2 ? [[at + beat / 2, beat * 0.45]] : (b % 4 === 0 ? [[at, bar * 0.95]] : []);
    if (mood >= 2) hits.push([at, beat * 0.2]);
    for (const [st, len] of hits) {
      const f = hz(root), i0 = Math.round(st * SR);
      let ph = 0, lp = 0;
      for (let k = 0; k < len * SR; k++) {
        const t = k / SR;
        ph += f / SR; if (ph >= 1) ph -= 1;
        const sub = Math.sin(TAU * ph), saw = 2 * ph - 1;
        lp += 0.05 * (saw - lp);
        const env = Math.min(1, t / 0.006) * Math.min(1, (len - t) / 0.03) * fadeOut(st + t);
        const v = Math.tanh((sub * 0.8 + lp * (mood >= 3 ? 0.55 : 0.3)) * 1.6) * env * 0.2;
        put(music, i0 + k, v, v);
      }
    }
  }

  // ---- arp: 16th plucks over the chord, ping-pong, in grooves ----
  const pattern = [0, 2, 4, 2, 1, 3, 4, 3];
  for (let k = 0; k * s16 < total; k++) {
    const at = k * s16, mood = moodAt(at + 0.001);
    if (mood < 2 && !(mood === 1 && k % 2 === 0 && openness(at) > 0.45)) continue;
    const ch = chordAt(at + 0.001);
    const m = ch.notes[pattern[k % 8] % ch.notes.length] + 12;
    const f = hz(m), i0 = Math.round(at * SR), len = 0.28;
    const vel = (k % 4 === 0 ? 1 : 0.7) * (mood === 1 ? 0.5 : 1);
    const pan = k % 2 ? 0.6 : -0.6;
    let lp = 0;
    for (let j = 0; j < len * SR; j++) {
      const t = j / SR;
      const sq = Math.sign(Math.sin(TAU * f * t)) * 0.5 + Math.sin(TAU * f * 2 * t) * 0.3;
      lp += (0.08 + 0.4 * Math.exp(-t * 30)) * (sq - lp);
      const v = lp * Math.exp(-t * 14) * Math.min(1, t / 0.002) * vel * 0.05 * fadeOut(at);
      put(music, i0 + j, v * (1 - pan), v * (1 + pan), 0.35);
    }
  }

  // ---- bells: sparse in ambient scenes ----
  for (let k = 0; k * (beat / 2) < total; k++) {
    const at = k * (beat / 2), s = sceneAt(at + 0.001);
    if (!s || (s.mood ?? 1) !== 0) continue;
    const pos = k % 16;
    if (![0, 3, 6, 10, 13].includes(pos)) continue;
    if (s === endScene && at - s.start > s.dur - 2.5) continue;
    const ch = chordAt(at + 0.001);
    const m = ch.notes[[4, 2, 3, 1, 2][[0, 3, 6, 10, 13].indexOf(pos)] % ch.notes.length] + 12;
    const f = hz(m), i0 = Math.round(at * SR), pan = Math.sin(k * 1.3) * 0.5;
    for (let j = 0; j < 2.5 * SR; j++) {
      const t = j / SR;
      const v = (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * f * 2.76 * t) * Math.exp(-t * 4) + 0.15 * Math.sin(TAU * f * 5.4 * t) * Math.exp(-t * 9))
        * Math.exp(-t * 1.8) * Math.min(1, t / 0.003) * 0.06 * fadeOut(at);
      put(music, i0 + j, v * (1 - pan), v * (1 + pan), 0.6);
    }
  }

  // ---- drums ----
  const kicks = [];
  for (let b = 0; b * beat < total; b++) {
    const at = b * beat, mood = moodAt(at + 0.001);
    if (mood >= 2) {
      kicks.push(at);
      const i0 = Math.round(at * SR);
      for (let k = 0; k < 0.45 * SR; k++) {
        const t = k / SR;
        const v = (Math.sin(TAU * (45 * t + (110 * (1 - Math.exp(-28 * t))) / 28)) * Math.exp(-6.5 * t) + (k < 90 ? noise() * 0.25 * (1 - k / 90) : 0)) * 0.62 * fadeOut(at);
        put(drums, i0 + k, Math.tanh(v * 1.4), Math.tanh(v * 1.4));
      }
      if (b % 2 === 1) {
        // Clap: three quick bursts of band-passed noise.
        const c0 = Math.round(at * SR);
        let bp1 = 0, bp2 = 0;
        for (let k = 0; k < 0.3 * SR; k++) {
          const t = k / SR, x = noise();
          bp1 += 0.35 * (x - bp1); bp2 += 0.35 * (bp1 - bp2);
          const hp = bp1 - bp2;
          const env = (t < 0.03 ? [0, 0.011, 0.022].reduce((e, o) => e + (t >= o ? Math.exp(-(t - o) * 180) : 0), 0) : Math.exp(-(t - 0.022) * 22));
          const v = hp * env * 0.38 * fadeOut(at);
          put(drums, c0 + k, v * 0.9, v * 1.1, 0.35);
        }
      }
    }
    if (mood >= 1) {
      const subdiv = mood >= 2 ? [0.5] : openness(at) > 0.5 ? [0.25, 0.5, 0.75] : [0.5];
      for (const off of subdiv) {
        const i0 = Math.round((at + beat * off) * SR);
        const open = mood >= 3 && off === 0.5;
        let hp = 0, prev = 0;
        const len = open ? 0.28 : 0.05;
        for (let k = 0; k < len * SR; k++) {
          const t = k / SR, x = noise();
          hp = 0.88 * (hp + x - prev); prev = x;
          const v = hp * Math.exp(-t * (open ? 12 : 70)) * (open ? 0.08 : off === 0.5 ? 0.075 : 0.04) * fadeOut(at);
          put(drums, i0 + k, v * 0.75, v * 1.25, 0.15);
        }
      }
    }
  }

  // Sidechain: everything melodic ducks under the kick, the classic pump.
  const duck = new Float32Array(n).fill(1);
  for (const at of kicks) {
    const i0 = Math.round(at * SR);
    for (let k = 0; k < beat * SR && i0 + k < n; k++) duck[i0 + k] = Math.min(duck[i0 + k], 1 - 0.6 * Math.exp(-(k / SR) * 9));
  }

  // ---- risers into drops, impacts on them ----
  for (const s of scenes) {
    if (!s.drop) continue;
    const T = s.start, dur = Math.min(3.6, bar * 2);
    let lp = 0, ph = 0;
    for (let k = 0; k < dur * SR; k++) {
      const t = k / SR, x = t / dur;
      lp += (0.01 + 0.5 * x ** 2) * (noise() - lp);
      ph += (hz(53) * 2 ** (x * 1.5)) / SR; if (ph >= 1) ph -= 1;
      const v = (lp * 0.6 + (2 * ph - 1) * 0.12 * x) * x ** 2.2 * 0.5;
      const pan = Math.sin(t * TAU * (0.5 + x * 3)) * 0.5 * x;
      put(fx, Math.round((T - dur) * SR) + k, v * (1 - pan), v * (1 + pan), 0.5);
    }
    // Snare roll, accelerating.
    for (let r = 0; r < 16; r++) {
      const x = r / 16, at = T - dur * 0.5 * (1 - x) ** 1.4;
      const i0 = Math.round(at * SR);
      let bp = 0;
      for (let k = 0; k < 0.08 * SR; k++) {
        const t = k / SR, y = noise();
        bp += 0.3 * (y - bp);
        const v = (y - bp) * Math.exp(-t * 40) * (0.04 + 0.12 * x);
        put(fx, i0 + k, v, v, 0.3);
      }
    }
    // Impact: deep boom, a crash, and a moment of silence before it.
    const i0 = Math.round(T * SR);
    let lp2 = 0;
    for (let k = 0; k < 3 * SR; k++) {
      const t = k / SR;
      const boom = Math.sin(TAU * (32 * t + (60 * (1 - Math.exp(-5 * t))) / 5)) * Math.exp(-t * 1.8) * 0.75;
      const y = noise();
      lp2 += 0.6 * (y - lp2);
      const crash = (y - lp2 * 0.7) * Math.exp(-t * 1.5) * 0.18;
      put(fx, i0 + k, Math.tanh(boom * 1.5) + crash * 0.8, Math.tanh(boom * 1.5) + crash * 1.2, 0.4);
    }
    const g0 = Math.round((T - 0.12) * SR);
    for (let k = 0; k < 0.12 * SR; k++) { const g = 1 - 0.85 * Math.sin((Math.PI * k) / (0.12 * SR)); music.L[g0 + k] *= g; music.R[g0 + k] *= g; drums.L[g0 + k] *= g; drums.R[g0 + k] *= g; }
  }

  // ---- whooshes on camera flights ----
  scenes.forEach((s, i) => {
    if (!i || s.drop) return;
    const fly = Math.min(s.fly ?? 1.1, s.dur * 0.5);
    if (fly < 0.3) return;
    const T = s.start - 0.15, dur = fly + 0.5;
    const dir = i % 2 ? 1 : -1;
    let bp1 = 0, bp2 = 0;
    for (let k = 0; k < dur * SR; k++) {
      const t = k / SR, x = t / dur;
      const env = Math.sin(Math.PI * x ** 0.8) ** 2;
      const cut = 0.02 + 0.25 * Math.sin(Math.PI * x);
      const y = noise();
      bp1 += cut * (y - bp1); bp2 += cut * (bp1 - bp2);
      const v = (bp1 - bp2) * env * 0.5;
      const pan = dir * (x * 2 - 1) * 0.8;
      put(fx, Math.round(T * SR) + k, v * (1 - pan), v * (1 + pan), 0.45);
    }
  });

  // ---- boot chime when the lid opens, final chord on the end card ----
  const chord = (T, notes, level, decay) => {
    const i0 = Math.round(T * SR);
    notes.forEach((m, j) => {
      const f = hz(m), pan = (j / Math.max(1, notes.length - 1) - 0.5) * 0.9;
      for (let k = 0; k < 5 * SR; k++) {
        const t = k / SR;
        const v = (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * f * 2 * t) * Math.exp(-t * 2) + 0.12 * Math.sin(TAU * f * 3.01 * t) * Math.exp(-t * 3))
          * Math.exp(-t * decay) * Math.min(1, t / 0.02) * level;
        put(fx, i0 + k, v * (1 - pan), v * (1 + pan), 0.7);
      }
    });
  };
  for (const s of scenes) {
    if (s.screenShow === "logo" && s.lid?.length) chord(s.start + s.lid[s.lid.length - 1][0] * 0.85, [53, 60, 65, 69, 72], 0.05, 0.7);
  }
  chord(endScene.start + 0.2, [41 + 12, 56, 60, 63, 67, 72], 0.045, 0.55);

  // ---- interface sounds from the recording ----
  for (const c of foley) {
    const i0 = Math.round(c.t * SR), g = (c.gain ?? 1) * 0.5, pan = c.pan ?? 0;
    const r = rnd();
    const spec = {
      click: { len: 0.06, tone: 2400, body: 170, n: 0.5, b: 0.6, d: 120 },
      key: { len: 0.04, tone: 3200 + r * 600, body: 240 + r * 30, n: 0.3, b: 0.25, d: 160 },
      space: { len: 0.05, tone: 2200, body: 150, n: 0.3, b: 0.35, d: 120 },
      grab: { len: 0.1, tone: 900, body: 120, n: 0.25, b: 0.7, d: 50 },
      drop: { len: 0.14, tone: 700, body: 95, n: 0.3, b: 0.9, d: 40 },
      tick: { len: 0.025, tone: 5200, body: 0, n: 0.4, b: 0, d: 260 },
    }[c.kind] || null;
    if (!spec) continue;
    let hp = 0, prev = 0;
    for (let k = 0; k < spec.len * SR; k++) {
      const t = k / SR, x = noise();
      hp = 0.7 * (hp + x - prev); prev = x;
      const v = (hp * spec.n * Math.exp(-t * spec.d * 1.5) + Math.sin(TAU * spec.tone * t) * 0.18 * Math.exp(-t * spec.d * 2) + Math.sin(TAU * spec.body * t) * spec.b * Math.exp(-t * spec.d * 0.6))
        * Math.min(1, t / 0.0008) * g * 0.22;
      put(ui, i0 + k, v * (1 - pan), v * (1 + pan), 0.12);
    }
  }

  // ---- reverb (Schroeder, decorrelated per side) ----
  const reverb = (input, offset) => {
    const out = new Float32Array(n);
    for (const d of [1687, 1601, 2053, 2251].map((x) => x + offset)) {
      const buf = new Float32Array(d); let p = 0, lp = 0;
      for (let i = 0; i < n; i++) {
        const y = buf[p];
        lp = y * 0.55 + lp * 0.45;
        buf[p] = input[i] + lp * 0.86;
        p = (p + 1) % d;
        out[i] += y * 0.25;
      }
    }
    for (const d of [556 + offset, 225 + offset, 341 + offset]) {
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
  const wetL = reverb(send.L, 0), wetR = reverb(send.R, 37);

  // ---- mix, glue, limit to a safe true peak ----
  const L = new Float32Array(n), R = new Float32Array(n);
  let env = 0;
  for (let i = 0; i < n; i++) {
    const d = duck[i];
    let l = music.L[i] * d + drums.L[i] + fx.L[i] + ui.L[i] + wetL[i] * 0.5 * (0.6 + 0.4 * d);
    let r = music.R[i] * d + drums.R[i] + fx.R[i] + ui.R[i] + wetR[i] * 0.5 * (0.6 + 0.4 * d);
    // Gentle bus compressor before the clipper.
    const lev = Math.max(Math.abs(l), Math.abs(r));
    env = lev > env ? env + (lev - env) * 0.01 : env + (lev - env) * 0.0002;
    const gr = env > 0.5 ? 0.5 / env : 1;
    l = Math.tanh(l * gr * 1.35); r = Math.tanh(r * gr * 1.35);
    L[i] = l; R[i] = r;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = peak > 0 ? 0.79 / peak : 1; // −2 dBFS sample peak leaves room for inter-sample peaks
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  return { L, R, sampleRate: SR };
}
