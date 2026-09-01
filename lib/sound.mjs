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
 * Derived pitches are formed from those by the same rule — 844 = 1266 x 2/3,
 * the fifth below reject's fundamental — and nothing else is invented.
 *
 * If you add a cue, build it from those and label it derived.
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

/** The gated pulse train: 442 ms period, 277 ms on, 6 ms edges. */
const thinkPulses = (count, from = 0) =>
  Array.from({ length: count }, (_, i) =>
    note(from + i * 0.442, 0.277, THINK_PARTIALS, { attack: 0.006, release: 0.006 }),
  ).flat();

export const CUES = {
  /**
   * MEASURED. The deliberation pulse train, three pulses over 1.33 s. Loops
   * cleanly on the 442 ms period: each pulse ends in 165 ms of silence.
   */
  think: thinkPulses(3),

  /**
   * MEASURED. The rejection tone: a sustained near-perfect sine at 1266 Hz
   * with its second partial 21.7 dB down. Spectral flatness 0.012.
   */
  reject: note(0, 1.24, REJECT_PARTIALS, { attack: ATTACK, release: RELEASE }),

  /**
   * DERIVED. A rising fifth that resolves onto reject's measured fundamental.
   *
   * The source contains no agreement chime, so this is designed. It is built
   * an octave below the rejection's second partial — 844 = 1266 x 2/3 — so the
   * figure arrives from underneath and settles on 1266/2531, exactly reject's
   * measured spectrum. Same length as the rejection (1.24 s) and the same
   * register, so the two read as one console answering either way: rising for
   * assent against the flat sustained tone for refusal.
   */
  agree: [
    ...note(0, 0.18, [[844, 0.5], [1688, 0.05]], { attack: 0.008, release: 0.008 }),
    ...note(0.18, 1.06, REJECT_PARTIALS.map(([f, a]) => [f, a * 1.05]), {
      attack: 0.008,
      release: RELEASE,
      decay: 1.2,
    }),
  ],

  /** DERIVED. One think pulse, shortened: a unit coming online. */
  tick: note(0, 0.09, THINK_PARTIALS, { attack: 0.006, release: 0.02 }),

  /** DERIVED. Two quick think pulses: the terminal powering up. */
  boot: thinkPulses(2).map((t) => ({ ...t, dur: 0.14, start: t.start * 0.42 })),

  /**
   * DERIVED. Abstention: think's fundamental held flat and cut off without
   * resolving, so it reads as unfinished rather than as a verdict.
   */
  withhold: note(0, 0.34, [[1705, 0.34], [3410, 0.2]], { attack: ATTACK, release: 0.1 }),

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

  /** DERIVED. Final 可決 stamp: the agree figure, held longer to close. */
  approved: [
    ...note(0, 0.2, [[844, 0.5], [1688, 0.05]], { attack: 0.008, release: 0.008 }),
    ...note(0.2, 1.4, [[1266, 0.6], [2531, 0.05]], { attack: 0.008, release: RELEASE, decay: 0.9 }),
  ],

  /** MEASURED. Final 否決 stamp: the rejection tone, held its full length. */
  rejected: note(0, 1.24, REJECT_PARTIALS, { attack: ATTACK, release: RELEASE }),
};

/**
 * Scene timing, measured from the source.
 *
 * `think` begins at 02:10.219 and `reject` at 02:11.655 — 1.436 s from the
 * first pulse onset to the verdict. The three gate periods run 1.326 s and the
 * last pulse stops sounding at 1.161 s, so 0.275 s of silence separates the
 * deliberation from the verdict. The two never overlap.
 *
 * (SPEC §7 describes this as "1.4 s after the last pulse begins"; that
 * interval is 0.552 s. The 1.44 figure is from the *first* pulse onset, which
 * is what the timecodes in §6 give.)
 *
 * All values in seconds.
 */
export const TIMING = {
  gatePeriod: 0.442,
  gateOn: 0.277,
  pulses: 3,

  /** One full `think` cue: three gate periods. */
  thinkCycle: 0.442 * 3, // 1.326

  /** First pulse onset to verdict onset. */
  verdictAfterThinkOnset: 1.436,

  /** Last pulse ends to verdict onset. */
  silenceBeforeVerdict: 1.436 - (0.442 * 2 + 0.277), // 0.275
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
  rejected: 'measured',
  agree: 'derived',
  approved: 'derived',
  tick: 'derived',
  boot: 'derived',
  withhold: 'derived',
  klaxon: 'derived',
};

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
  if (!enabled) return { play: () => {}, close: () => {} };

  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'magi-audio-'));
  } catch {
    return { play: () => {}, close: () => {} };
  }

  const files = new Map();
  const children = new Set();

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

  return {
    play(name) {
      const file = fileFor(name);
      if (!file) return;

      try {
        const [cmd, args] = playerFor(file);
        const child = spawn(cmd, args, { stdio: 'ignore', detached: false });
        // A missing player must never take the animation down with it.
        child.on('error', () => {});
        child.on('exit', () => children.delete(child));
        children.add(child);
      } catch {
        /* audio is decorative; never fatal */
      }
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
