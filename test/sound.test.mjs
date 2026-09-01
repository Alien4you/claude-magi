import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CUES, PROVENANCE, TIMING, cueDuration, createSpeaker, _internals } from '../lib/sound.mjs';

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

test('every cue the animation asks for exists', () => {
  for (const cue of ['boot', 'tick', 'think', 'agree', 'reject', 'withhold', 'klaxon', 'approved', 'rejected']) {
    assert.ok(Array.isArray(CUES[cue]) && CUES[cue].length, `missing cue: ${cue}`);
  }
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

test('agree rises a fifth and resolves onto reject\'s fundamental', () => {
  const samples = renderTones(CUES.agree);
  const first = peaks(samples, 0.02, 0.16, 1, 700);
  const second = peaks(samples, 0.22, 0.5, 1, 700);

  assert.ok(within(first[0], 844), `first note ${first[0]} is not 844`);
  assert.ok(within(second[0], 1266), `second note ${second[0]} is not 1266`);
  assert.ok(second[0] > first[0], 'the figure must rise');
});

test('agree answers the rejection at its own length and register', () => {
  // It read as thin and high while it was half the length an octave up.
  const len = (cue) => Math.max(...CUES[cue].map((t) => t.start + t.dur));

  assert.ok(Math.abs(len('agree') - len('reject')) < 0.02, 'same length as the rejection');
  assert.ok(
    CUES.agree.some((t) => t.freq === 1266),
    'resolves onto the measured rejection fundamental',
  );
});

test('every pitch in the set comes from the measured partials', () => {
  // SPEC: build new cues from the measured partials rather than inventing
  // unrelated pitches. 844/1688 are the fifth below reject's measured
  // fundamental (1266 x 2/3) and its octave — the only derived pitches.
  const allowed = new Set([1266, 2531, 1705, 3410, 5115, 844, 1688]);

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
  assert.ok(Math.abs(cueDuration('agree') - 1.24) < 1e-9);
  assert.equal(cueDuration('no-such-cue'), 0);
});
