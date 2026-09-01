import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CUES,
  PROVENANCE,
  TIMING,
  cueDuration,
  verdictCue,
  createSpeaker,
  _internals,
} from '../lib/sound.mjs';

const { renderTones, toWav, RATE } = _internals;

/**
 * Peak frequencies in a window of a rendered cue.
 *
 * A plain DFT over a Hann-windowed slice — slow, but this runs over a few
 * thousand samples and avoids pulling in a dependency just to check spectra.
 */
function peaks(samples, fromSec, toSec, count, floorHz = 1000) {
  const from = Math.floor(fromSec * RATE);
  const to = Math.min(Math.floor(toSec * RATE), samples.length);
  const n = to - from;
  if (n <= 0) return [];

  // Resolution of ~2 Hz is plenty to separate partials hundreds of Hz apart.
  const step = 2;
  const bins = [];

  for (let freq = floorHz; freq <= 6000; freq += step) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      // Hann window, so neighbouring partials do not smear into each other.
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
      const s = samples[from + i] * w;
      const ang = (2 * Math.PI * freq * i) / RATE;
      re += s * Math.cos(ang);
      im -= s * Math.sin(ang);
    }
    bins.push([freq, Math.hypot(re, im)]);
  }

  // Local maxima, strongest first.
  const maxima = bins
    .filter((b, i) => i > 0 && i < bins.length - 1 && b[1] > bins[i - 1][1] && b[1] >= bins[i + 1][1])
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([freq]) => freq)
    .sort((a, b) => a - b);

  return maxima;
}

const within = (actual, expected, tolerance = 0.01) =>
  Math.abs(actual - expected) / expected <= tolerance;

test('every cue the animation asks for exists, and no others', () => {
  // The units answer together and sound once, so there are no per-unit cues.
  assert.deepEqual(
    Object.keys(CUES).sort(),
    ['agree', 'boot', 'klaxon', 'reject', 'think', 'tick'],
  );
});

test('the verdict tone is chosen by the collective decision', () => {
  assert.equal(verdictCue('APPROVED'), 'agree');
  assert.equal(verdictCue('REJECTED'), 'reject');
});

test('every cue declares whether it is measured or derived', () => {
  for (const cue of Object.keys(CUES)) {
    assert.ok(['measured', 'derived'].includes(PROVENANCE[cue]), `${cue} has no provenance`);
  }
});

test('reject reproduces its measured partials: 1266 and 2531 Hz', () => {
  const found = peaks(renderTones(CUES.reject), 0.1, 0.9, 2);

  assert.equal(found.length, 2, `expected two partials, got ${found}`);
  assert.ok(within(found[0], 1266), `fundamental ${found[0]} is not 1266`);
  assert.ok(within(found[1], 2531), `second partial ${found[1]} is not 2531`);
});

test('think reproduces its measured partials: 1705, 3410 and 5115 Hz', () => {
  const found = peaks(renderTones(CUES.think), 0.02, 0.25, 3);

  assert.equal(found.length, 3, `expected three partials, got ${found}`);
  assert.ok(within(found[0], 1705), `${found[0]} is not 1705`);
  assert.ok(within(found[1], 3410), `${found[1]} is not 3410`);
  assert.ok(within(found[2], 5115), `${found[2]} is not 5115`);
});

test("think's second partial is louder than its fundamental", () => {
  // The measurement says 2f dominates; a reimplementation that "corrects" this
  // toward the expected balance is wrong.
  const [f, twoF] = [CUES.think[0].amp, CUES.think[1].amp];
  assert.ok(twoF > f, `2f (${twoF}) must exceed f (${f})`);
});

test('think is three gate-on regions separated by silence', () => {
  const samples = renderTones(CUES.think);
  const onAt = (sec) => Math.abs(samples[Math.floor(sec * RATE)]) > 0.05;

  // 277 ms on, then 165 ms silent, repeating on a 442 ms period.
  for (const pulse of [0, 1, 2]) {
    assert.ok(onAt(pulse * 0.442 + 0.13), `pulse ${pulse} should be sounding`);
    assert.ok(!onAt(pulse * 0.442 + 0.36), `gap after pulse ${pulse} should be silent`);
  }
});

test('agree rises a fifth: 1688/3376 then 2531/5062', () => {
  const samples = renderTones(CUES.agree);
  const first = peaks(samples, 0.02, 0.16, 2);
  const second = peaks(samples, 0.3, 1.0, 2);

  assert.ok(within(first[0], 1688), `note 1 fundamental ${first[0]} is not 1688`);
  assert.ok(within(first[1], 3376), `note 1 second partial ${first[1]} is not 3376`);
  assert.ok(within(second[0], 2531), `note 2 fundamental ${second[0]} is not 2531`);
  assert.ok(within(second[1], 5062), `note 2 second partial ${second[1]} is not 5062`);
  assert.ok(second[0] > first[0], 'the figure must rise');
});

test('agree sustains its second note rather than decaying', () => {
  // A decaying note 2 is what made this read as thin and short.
  const samples = renderTones(CUES.agree);
  const rms = (fromSec, toSec) => {
    const from = Math.floor(fromSec * RATE);
    const to = Math.floor(toSec * RATE);
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i] ** 2;
    return Math.sqrt(sum / (to - from));
  };

  const early = rms(0.25, 0.45);
  const late = rms(0.9, 1.1);
  const dropDb = 20 * Math.log10(early / late);

  assert.ok(dropDb < 3, `note 2 decays ${dropDb.toFixed(1)} dB; it must be held`);
  assert.ok(CUES.agree.every((t) => !t.decay), 'no cue tone carries a decay');
});

test('the two verdicts carry equal weight: within 1 dB RMS', () => {
  // SPEC §5: if agree reads quieter, the sustain length or note-2 amplitude
  // has been altered. Neither verdict may outweigh the other.
  const rms = (cue) => {
    const s = renderTones(CUES[cue]);
    let sum = 0;
    for (const v of s) sum += v ** 2;
    return Math.sqrt(sum / s.length);
  };

  const deltaDb = Math.abs(20 * Math.log10(rms('agree') / rms('reject')));
  assert.ok(deltaDb <= 1, `verdicts differ by ${deltaDb.toFixed(2)} dB RMS`);
});

test('every pitch in the set comes from the measured partials', () => {
  // SPEC §6.2: build new cues from the measured partials rather than
  // inventing unrelated pitches. 1688/3376/5062 are agree's derived fifth,
  // itself built on reject's measured 2531.
  const allowed = new Set([1266, 2531, 1705, 3410, 5115, 1688, 3376, 5062]);

  for (const [name, tones] of Object.entries(CUES)) {
    for (const tone of tones) {
      assert.ok(allowed.has(tone.freq), `${name} uses unmeasured pitch ${tone.freq} Hz`);
    }
  }
});

test('the klaxon alternates reject and think fundamentals', () => {
  const fundamentals = [...new Set(CUES.klaxon.map((t) => t.freq))];

  assert.ok(fundamentals.includes(1266), 'carries the rejection tone');
  assert.ok(fundamentals.includes(1705), 'carries the deliberation tone');
  assert.ok(CUES.klaxon.length >= 16, 'several cycles, two partials each');
});

test('rendered audio is finite and normalized below clipping', () => {
  for (const [name, tones] of Object.entries(CUES)) {
    const samples = renderTones(tones);
    let peak = 0;
    for (const s of samples) {
      assert.ok(Number.isFinite(s), `${name} produced a non-finite sample`);
      peak = Math.max(peak, Math.abs(s));
    }
    assert.ok(peak > 0.05, `${name} is inaudibly quiet (peak ${peak})`);
    assert.ok(peak <= 1, `${name} clips (peak ${peak})`);
  }
});

test('toWav emits a valid 16-bit mono PCM header at 48 kHz', () => {
  const wav = toWav(renderTones(CUES.tick));

  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1, 'PCM format');
  assert.equal(wav.readUInt16LE(22), 1, 'mono');
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(wav.readUInt16LE(34), 16, '16-bit samples');
  assert.equal(wav.readUInt32LE(4), wav.length - 8, 'RIFF size matches the buffer');
});

test('a disabled speaker is inert', () => {
  const speaker = createSpeaker({ enabled: false });

  assert.doesNotThrow(() => speaker.play('klaxon'));
  assert.doesNotThrow(() => speaker.close());
});

test('an unknown cue is ignored rather than throwing', () => {
  const speaker = createSpeaker({ enabled: false });
  assert.doesNotThrow(() => speaker.play('no-such-cue'));
  speaker.close();
});

test('a supplied sound file is preferred over the synthesized cue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magi-cues-'));
  writeFileSync(join(dir, 'klaxon.wav'), toWav(renderTones(CUES.tick)));

  try {
    const speaker = createSpeaker({ enabled: true, soundDir: dir });
    assert.doesNotThrow(() => speaker.play('klaxon'));
    assert.doesNotThrow(() => speaker.play('agree'), 'falls back to synthesis');
    speaker.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing sound directory falls back to synthesis without throwing', () => {
  const speaker = createSpeaker({ enabled: true, soundDir: '/nonexistent/magi/cues' });
  assert.doesNotThrow(() => speaker.play('klaxon'));
  speaker.close();
});

test('scene timing matches the source timecodes', () => {
  // think at 02:10.219, reject at 02:11.655 → 1.436 s between onsets.
  assert.equal(TIMING.verdictAfterThinkOnset, 1.436);
  assert.equal(TIMING.gatePeriod, 0.442);
  assert.equal(TIMING.gateOn, 0.277);
  assert.equal(TIMING.pulses, 3);

  // Three gate periods, and the train ends before the verdict starts.
  assert.ok(Math.abs(TIMING.thinkCycle - 1.326) < 1e-9);
  assert.ok(
    TIMING.thinkCycle < TIMING.verdictAfterThinkOnset,
    'the pulse train must finish before the verdict fires',
  );
});

test('the silence between the last pulse and the verdict is 0.275 s', () => {
  const lastPulseEnds = TIMING.gatePeriod * (TIMING.pulses - 1) + TIMING.gateOn;

  assert.ok(Math.abs(lastPulseEnds - 1.161) < 1e-9);
  assert.ok(Math.abs(TIMING.silenceBeforeVerdict - 0.275) < 1e-9);
  assert.ok(TIMING.silenceBeforeVerdict > 0, 'think and the verdict never overlap');
});

test('cueDuration reports each cue at its rendered length', () => {
  assert.ok(Math.abs(cueDuration('think') - 1.161) < 1e-9, 'three pulses, last one 277 ms');
  assert.ok(Math.abs(cueDuration('reject') - 1.24) < 1e-9);
  assert.ok(Math.abs(cueDuration('agree') - 1.24) < 1e-9, 'both verdicts run 1.24 s');
  assert.equal(cueDuration('no-such-cue'), 0);
  assert.equal(cueDuration('withhold'), 0, 'per-unit cues are gone');
});
