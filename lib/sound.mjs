/**
 * Synthesized MAGI cues.
 *
 * Every sound is generated as raw PCM here and written to a temp WAV, then
 * handed to the platform player. Nothing ships as an audio asset: the cues are
 * original tones, not sampled from anything.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const RATE = 22050;
const AMPLITUDE = 0.22;

/** @param {number} t seconds @param {number} freq Hz */
const saw = (t, freq) => 2 * ((t * freq) % 1) - 1;
const square = (t, freq) => (Math.sin(2 * Math.PI * freq * t) >= 0 ? 1 : -1);
const sine = (t, freq) => Math.sin(2 * Math.PI * freq * t);
const triangle = (t, freq) => 2 * Math.abs(2 * ((t * freq) % 1) - 1) - 1;

const WAVES = { saw, square, sine, triangle };

/**
 * Envelope shapes.
 *
 * `pluck` decays away — right for chimes and stamps. `gate` holds flat with
 * fast edges, which is what makes a klaxon read as a klaxon: a real alarm horn
 * sustains at full level for its whole blast rather than dying away.
 */
function envelopeAt(kind, progress, dur) {
  // Edge time as a fraction of the tone, clamped so short tones stay clean.
  const edge = Math.min(0.25, 0.008 / Math.max(dur, 0.001));

  if (kind === 'gate') {
    const attack = Math.min(1, progress / edge);
    const release = Math.min(1, (1 - progress) / edge);
    return Math.min(attack, release);
  }
  return Math.min(1, progress / 0.04) * (1 - progress) ** 1.4;
}

/**
 * Additively render a list of tones into a Float array.
 *
 * @param {Array<{
 *   start:number, dur:number, freq:number, to?:number, wave?:string,
 *   gain?:number, env?:'pluck'|'gate', tremolo?:number, detune?:number
 * }>} tones
 */
function renderTones(tones) {
  const total = Math.max(...tones.map((t) => t.start + t.dur)) + 0.05;
  const samples = new Float32Array(Math.ceil(total * RATE));

  for (const tone of tones) {
    const wave = WAVES[tone.wave ?? 'square'] ?? square;
    const gain = tone.gain ?? 1;
    const from = Math.floor(tone.start * RATE);
    const count = Math.floor(tone.dur * RATE);

    for (let i = 0; i < count; i++) {
      const idx = from + i;
      if (idx >= samples.length) break;

      const progress = i / count;
      const t = i / RATE;
      // Glide between freq and `to` when a sweep is requested.
      const freq = tone.to ? tone.freq + (tone.to - tone.freq) * progress : tone.freq;

      let value = wave(t, freq);

      // A second voice a few Hz off beats against the first: that slow warble
      // is most of what makes an alarm horn sound mechanical rather than
      // synthetic.
      if (tone.detune) value += wave(t, freq + tone.detune);

      // Amplitude tremolo, for the pulsing of a powered siren.
      const trem = tone.tremolo ? 0.78 + 0.22 * Math.sin(2 * Math.PI * tone.tremolo * t) : 1;

      samples[idx] += value * envelopeAt(tone.env ?? 'pluck', progress, tone.dur) * trem * gain;
    }
  }

  return samples;
}

/** Wrap 16-bit PCM in a canonical 44-byte WAV header. */
function toWav(samples) {
  const data = Buffer.alloc(samples.length * 2);

  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i] * AMPLITUDE));
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

/** The cue library. Each entry is a list of tones. */
export const CUES = {
  /** Terminal boot: a rising three-note ident. */
  boot: [
    { start: 0.0, dur: 0.1, freq: 330, wave: 'square', gain: 0.5 },
    { start: 0.1, dur: 0.1, freq: 494, wave: 'square', gain: 0.5 },
    { start: 0.2, dur: 0.3, freq: 660, wave: 'triangle', gain: 0.6 },
  ],

  /** A unit powering up. */
  tick: [{ start: 0, dur: 0.05, freq: 880, wave: 'square', gain: 0.35 }],

  /** 肯定 — two rising notes. */
  affirm: [
    { start: 0.0, dur: 0.1, freq: 660, wave: 'triangle', gain: 0.6 },
    { start: 0.09, dur: 0.18, freq: 990, wave: 'triangle', gain: 0.6 },
  ],

  /** 否定 — a falling saw. */
  negate: [{ start: 0, dur: 0.3, freq: 190, to: 90, wave: 'saw', gain: 0.75 }],

  /** 保留 — flat, unresolved. */
  withhold: [{ start: 0, dur: 0.22, freq: 300, wave: 'triangle', gain: 0.45 }],

  /**
   * Dissent: a two-tone alarm horn, five cycles.
   *
   * Sustained gated blasts rather than decaying notes, a square laid under the
   * saw for the hard buzzing edge, a few Hz of detune so the two voices beat
   * against each other, and a slow tremolo on top. Low register — an alarm
   * sits well under the chimes so it reads as an interruption.
   */
  klaxon: Array.from({ length: 5 }, (_, i) => {
    const cycle = i * 0.66;
    const blast = (start, freq) => [
      { start, dur: 0.31, freq, wave: 'saw', gain: 0.62, env: 'gate', detune: 3, tremolo: 11 },
      { start, dur: 0.31, freq: freq / 2, wave: 'square', gain: 0.3, env: 'gate', detune: 2 },
    ];
    return [...blast(cycle, 622), ...blast(cycle + 0.33, 466)];
  }).flat(),

  /** Final stamp. */
  approved: [
    { start: 0.0, dur: 0.5, freq: 130, to: 65, wave: 'sine', gain: 1 },
    { start: 0.05, dur: 0.4, freq: 523, wave: 'triangle', gain: 0.5 },
    { start: 0.2, dur: 0.5, freq: 784, wave: 'triangle', gain: 0.45 },
  ],
  rejected: [
    { start: 0.0, dur: 0.6, freq: 130, to: 42, wave: 'sine', gain: 1 },
    { start: 0.1, dur: 0.5, freq: 233, to: 110, wave: 'saw', gain: 0.6 },
  ],
};

/** Platform players, in preference order. */
function playerFor(file) {
  if (process.platform === 'darwin') return ['afplay', [file]];
  if (process.platform === 'win32') {
    return ['powershell', ['-NoProfile', '-c', `(New-Object Media.SoundPlayer '${file}').PlaySync()`]];
  }
  return ['aplay', ['-q', file]];
}

/** Cue file extensions accepted in a user-supplied sound directory. */
const SOUND_EXTS = ['.wav', '.mp3', '.aiff', '.aif', '.m4a', '.ogg'];

/**
 * Look for a user-supplied file for `cue` in `dir`, e.g. `klaxon.wav`.
 * Returns null when the directory or the file is absent.
 */
function userCue(dir, cue) {
  if (!dir) return null;

  for (const ext of SOUND_EXTS) {
    const candidate = join(dir, cue + ext);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * A speaker that plays each cue without blocking.
 *
 * Cues are synthesized by default. If `soundDir` is given and contains a file
 * named after a cue (`klaxon.wav`, `affirm.mp3`, …) that file is played
 * instead — the plugin ships no audio of its own, so whatever goes in that
 * directory is the operator's own material.
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

export const _internals = { renderTones, toWav, RATE };
