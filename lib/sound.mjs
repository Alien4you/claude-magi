/**
 * MAGI console tones.
 *
 * Every cue is synthesized here from published partial frequencies and
 * envelopes — see SPEC.md in the reference analysis. Two of the voices are
 * *measured*: their partials were recovered by narrowband tone-prominence
 * matching against the original broadcast audio. The rest are *derived*, built
 * from those same measured partials so the set reads as one console.
 *
 * The distinction is load-bearing and is recorded per cue below. Parameters
 * are measurements, not copied audio: nothing sampled ships with this plugin.
 *
 * Measured partials, the only pitches anything here is built from:
 *   reject  1266, 2531 Hz
 *   think   1705, 3410, 5115 Hz
 *
 * If you add a cue, build it from those and label it derived.
 *
 * One deliberate divergence from the source, per SPEC §1 and §6.1: on screen
 * the 1266 Hz tone fires on ALL GREEN / 終了 — it is the source's *all-clear*,
 * the moment all three units agree, not a refusal. No rejection cue exists in
 * the episode at all; the matched scene is a routine diagnostic that passes.
 * This project assigns that tone to `reject` by decision. The sound is
 * authentic, the label is reassigned on purpose. Both verdict cues run 1.24 s
 * at matched weight so the swap does not read as an imbalance. To follow the
 * source instead, swap the two names — nothing else changes.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const RATE = 48000;

/** Peak each cue is normalized to before the master gain. */
const NORMALIZE_TO = 0.9;
const MASTER = 0.5;

/** Spec defaults: 8 ms linear attack, 120 ms linear release. */
const ATTACK = 0.008;
const RELEASE = 0.12;

/**
 * One partial of one note.
 *
 * @typedef {object} Tone
 * @property {number} start   seconds from cue start
 * @property {number} dur     seconds
 * @property {number} freq    Hz
 * @property {number} amp     linear, pre-normalization
 * @property {number} [attack]
 * @property {number} [release]
 * @property {number} [decay] exponential decay rate; amplitude x e^(-rate*t)
 */

/** A stack of partials at one time, as `[freq, amp]` pairs. */
const note = (start, dur, partials, opts = {}) =>
  partials.map(([freq, amp]) => ({ start, dur, freq, amp, ...opts }));

/** `think`'s three partials — note that 2f is the loudest, not the fundamental. */
const THINK_PARTIALS = [
  [1705, 0.3],
  [3410, 0.4],
  [5115, 0.14],
];

const REJECT_PARTIALS = [
  [1266, 0.55],
  [2531, 0.045],
];

/** `agree`'s rising fifth, built on reject's measured second partial. */
const AGREE_NOTE_1 = [
  [1688, 0.5],
  [3376, 0.045],
];
const AGREE_NOTE_2 = [
  [2531, 0.58],
  [5062, 0.052],
];

/**
 * `think` gate shape, measured over the reference train's 9 gates.
 *
 * The train is irregular. On-duration is near-constant; the *gap* is what
 * moves, near-uniform across its range. An earlier reading took 277 ms on /
 * 442 ms period as fixed, but those came from the only three pulses at 02:10,
 * which happen to fall close to regular — measuring the full 2.9 s reference
 * train shows otherwise.
 *
 *   on      219 ms, sd 30, jitter +/-8%
 *   gap     122 ms, sd 36, uniform 72-173 ms
 *   period  341 ms, sd 36, range 291-392, CV ~0.10
 *
 * Two caveats carried from the measurement, both load-bearing. The uniform gap
 * distribution rests on n = 8 — defensible at that size, not proven. And the
 * episode's own instance at 02:10 runs ~1.28x slower than the reference at
 * identical pitch (1264 vs 1256 Hz), so it is a different take, not a
 * time-stretch; EPISODE_TEMPO scales both on and gap to it.
 */
export const GATE = {
  onMean: 0.219,
  onJitter: 0.08,
  gapMin: 0.072,
  gapMax: 0.173,

  /** Successive gaps must differ by this much, or a steady beat emerges. */
  gapMinDelta: 0.02,

  /** 6 ms ramp at every edge, to prevent clicks. */
  edgeRamp: 0.006,

  /** Roughly three pulses per second at reference tempo. */
  pulsesPerSecond: 3,

  /** Multiply on and gap by this for the episode's slower take. */
  episodeTempo: 1.28,
};

/**
 * A small deterministic PRNG, so a seeded render is reproducible and the page
 * and the terminal can produce the same train from the same seed.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build an irregular gate list: `[{ start, end }]`, seconds from train start.
 *
 * Pass a seed for a reproducible render; omit it and every deliberation
 * sounds different, which is the point.
 *
 * @param {{pulses?: number, seconds?: number, seed?: number, tempo?: number}} o
 */
export function thinkGates({ pulses, seconds, seed, tempo = 1 } = {}) {
  const rng = seed === undefined ? Math.random : mulberry32(seed);
  const count = pulses ?? Math.ceil(GATE.pulsesPerSecond * (seconds ?? 1));

  const gates = [];
  let t = 0;
  let previousGap = null;

  for (let i = 0; i < count; i++) {
    const on = GATE.onMean * (1 + (rng() * 2 - 1) * GATE.onJitter) * tempo;
    gates.push({ start: t, end: t + on });

    let gap = (GATE.gapMin + rng() * (GATE.gapMax - GATE.gapMin)) * tempo;
    // Redraw until this gap is audibly different from the last one.
    let guard = 0;
    while (previousGap !== null && Math.abs(gap - previousGap) < GATE.gapMinDelta * tempo) {
      gap = (GATE.gapMin + rng() * (GATE.gapMax - GATE.gapMin)) * tempo;
      if (++guard > 32) break;
    }
    previousGap = gap;
    t += on + gap;
  }

  return gates;
}

/** Render a gate list into `think` tones. */
export function thinkTones(gates) {
  return gates.flatMap((g) =>
    note(g.start, g.end - g.start, THINK_PARTIALS, {
      attack: GATE.edgeRamp,
      release: GATE.edgeRamp,
    }),
  );
}

export const CUES = {
  /**
   * MEASURED. The deliberation pulse train.
   *
   * Irregular by construction, so this entry is only a seeded default for
   * callers that want a fixed-length cue. It cannot be produced by looping a
   * period: generate a gate list for the duration you need with `thinkGates()`
   * and render it with `thinkTones()`.
   */
  think: thinkTones(thinkGates({ pulses: 8, seed: 1 })),

  /**
   * MEASURED. The rejection tone: a sustained near-perfect sine at 1266 Hz
   * with its second partial 21.7 dB down. Spectral flatness 0.012.
   */
  reject: note(0, 1.24, REJECT_PARTIALS, { attack: ATTACK, release: RELEASE }),

  /**
   * DERIVED. Two-note rising fifth, second note sustained.
   *
   * The source contains no second console tone, so this is designed — built
   * from reject's own material: 2531 Hz is reject's measured second partial.
   * It runs the same 1.24 s and is held, not decayed, so neither verdict
   * outweighs the other; the rising figure and the higher held pitch are what
   * separate assent from refusal, not loudness.
   *
   * Note 1 overruns the split by the 6 ms ramp so the two notes crossfade
   * rather than clicking at the phase jump.
   */
  agree: [
    ...note(0, 0.186, AGREE_NOTE_1, { attack: ATTACK, release: 0.006 }),
    ...note(0.18, 1.06, AGREE_NOTE_2, { attack: 0.006, release: RELEASE }),
  ],

  /** DERIVED. One think pulse, shortened: a unit coming online. */
  tick: note(0, 0.09, THINK_PARTIALS, { attack: GATE.edgeRamp, release: 0.02 }),

  /** DERIVED. Two quick think pulses: the terminal powering up. */
  boot: [
    ...note(0, 0.14, THINK_PARTIALS, { attack: GATE.edgeRamp, release: GATE.edgeRamp }),
    ...note(0.2, 0.14, THINK_PARTIALS, { attack: GATE.edgeRamp, release: GATE.edgeRamp }),
  ],

  /**
   * DERIVED. Dissent alarm: reject's fundamental alternating with think's,
   * gated on think's measured 442 ms period, five cycles. Built only from
   * measured pitches — no invented frequencies.
   */
  klaxon: Array.from({ length: 5 }, (_, i) => {
    const cycle = i * 0.442;
    return [
      ...note(cycle, 0.2, [[1266, 0.5], [2531, 0.08]], { attack: 0.006, release: 0.006 }),
      ...note(cycle + 0.221, 0.2, [[1705, 0.42], [3410, 0.34]], { attack: 0.006, release: 0.006 }),
    ];
  }).flat(),
};

/**
 * Scene timing.
 *
 * The deliberation train is irregular (see GATE), so there is no fixed period
 * to key off: generate the gates you need and read their length. What remains
 * fixed is the silence between the last pulse and the verdict — measured at
 * the episode's instance, `think` at 02:10.219 and `reject` at 02:11.655.
 *
 * All values in seconds.
 */
export const TIMING = {
  /** Last pulse ends to verdict onset. Deliberation and verdict never overlap. */
  silenceBeforeVerdict: 0.275,

  /** How long the units deliberate before answering. */
  deliberateFor: 5.0,
};

/** Total length of a cue, in seconds. */
export function cueDuration(name) {
  const tones = CUES[name];
  if (!tones?.length) return 0;
  return Math.max(...tones.map((t) => t.start + t.dur));
}

/** Which cues are measured from the source and which are constructed. */
export const PROVENANCE = {
  think: 'measured',
  reject: 'measured',
  agree: 'derived',
  tick: 'derived',
  boot: 'derived',
  klaxon: 'derived',
};

/**
 * The verdict tone, fired once when all three units answer together.
 *
 * The units do not sound individually: in the source the console deliberates
 * as one and the tone lands on the collective result.
 */
export const verdictCue = (decision) => (decision === 'APPROVED' ? 'agree' : 'reject');

/**
 * Sum a cue's partials into a normalized sample buffer.
 *
 * Every voice is a pure sine; there is no noise component anywhere in the set.
 *
 * @param {Tone[]} tones
 * @returns {Float32Array}
 */
function renderTones(tones) {
  const total = Math.max(...tones.map((t) => t.start + t.dur)) + 0.05;
  const samples = new Float32Array(Math.ceil(total * RATE));

  for (const tone of tones) {
    const attack = tone.attack ?? ATTACK;
    const release = tone.release ?? RELEASE;
    const from = Math.floor(tone.start * RATE);
    const count = Math.floor(tone.dur * RATE);

    for (let i = 0; i < count; i++) {
      const idx = from + i;
      if (idx >= samples.length) break;

      const t = i / RATE;
      const remaining = tone.dur - t;

      // Linear attack, linear release, optional exponential decay between.
      let env = 1;
      if (t < attack) env = t / attack;
      if (remaining < release) env = Math.min(env, Math.max(0, remaining / release));
      if (tone.decay) env *= Math.exp(-tone.decay * t);

      samples[idx] += Math.sin(2 * Math.PI * tone.freq * t) * tone.amp * env;
    }
  }

  // Normalize per cue: the spec's amplitudes are pre-normalization.
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  if (peak > 0) {
    const scale = (NORMALIZE_TO / peak) * MASTER;
    for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  }

  return samples;
}

/** Wrap 16-bit PCM in a canonical 44-byte WAV header. */
function toWav(samples) {
  const data = Buffer.alloc(samples.length * 2);

  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(clipped * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(1, 22); // channels: mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

/** Cue file extensions accepted in a user-supplied sound directory. */
const SOUND_EXTS = ['.wav', '.mp3', '.aiff', '.aif', '.m4a', '.ogg'];

/** Look for a user-supplied file for `cue` in `dir`, e.g. `klaxon.wav`. */
function userCue(dir, cue) {
  if (!dir) return null;

  for (const ext of SOUND_EXTS) {
    const candidate = join(dir, cue + ext);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Platform players, in preference order. */
function playerFor(file) {
  if (process.platform === 'darwin') return ['afplay', [file]];
  if (process.platform === 'win32') {
    return ['powershell', ['-NoProfile', '-c', `(New-Object Media.SoundPlayer '${file}').PlaySync()`]];
  }
  return ['aplay', ['-q', file]];
}

/**
 * A speaker that plays each cue without blocking.
 *
 * Cues are synthesized by default. If `soundDir` contains a file named after a
 * cue (`klaxon.wav`, `agree.mp3`, …) that file is played instead — the plugin
 * ships no audio of its own, so whatever goes in that directory is the
 * operator's own material.
 *
 * `enabled:false` makes every call a no-op, for piped output or --silent.
 */
export function createSpeaker({ enabled = true, soundDir = null } = {}) {
  if (!enabled) return { play: () => {}, playThink: () => [], close: () => {} };

  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'magi-audio-'));
  } catch {
    return { play: () => {}, playThink: () => [], close: () => {} };
  }

  const files = new Map();
  const children = new Set();

  /** Fire a player at a file, never letting its failure reach the animation. */
  const spawnPlayer = (file) => {
    try {
      const [cmd, args] = playerFor(file);
      const child = spawn(cmd, args, { stdio: 'ignore', detached: false });
      child.on('error', () => {});
      child.on('exit', () => children.delete(child));
      children.add(child);
    } catch {
      /* audio is decorative; never fatal */
    }
  };

  const fileFor = (name) => {
    if (files.has(name)) return files.get(name);

    // A file the operator supplied wins over the synthesized cue.
    const supplied = userCue(soundDir, name);
    if (supplied) {
      files.set(name, supplied);
      return supplied;
    }

    const tones = CUES[name];
    if (!tones) return null;

    const path = join(dir, `${name}.wav`);
    writeFileSync(path, toWav(renderTones(tones)));
    files.set(name, path);
    return path;
  };

  /** Cache-busting counter, so each `think` render lands on its own file. */
  let trainSerial = 0;

  return {
    /**
     * Play a fresh irregular deliberation train of roughly `seconds`.
     *
     * `think` is generated per call rather than cached: the whole point of the
     * measured gate distribution is that no two trains are identical. A
     * supplied sounds/think.* file still wins, and is played as-is.
     */
    playThink(seconds = TIMING.deliberateFor, { seed, tempo } = {}) {
      const supplied = userCue(soundDir, 'think');
      if (supplied) return this.play('think');

      const gates = thinkGates({ seconds, seed, tempo });
      const path = join(dir, `think-${trainSerial++}.wav`);

      try {
        writeFileSync(path, toWav(renderTones(thinkTones(gates))));
      } catch {
        return gates;
      }

      spawnPlayer(path);
      return gates;
    },

    play(name) {
      const file = fileFor(name);
      if (!file) return;

      spawnPlayer(file);
    },

    close() {
      for (const child of children) {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}

export const _internals = { renderTones, toWav, RATE, THINK_PARTIALS, REJECT_PARTIALS };
