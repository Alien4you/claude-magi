import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CUES,
  GATE,
  PROVENANCE,
  TIMING,
  cueDuration,
  verdictCue,
  thinkGates,
  thinkTones,
  createSpeaker,
  _internals,
} from '../lib/sound.mjs';

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));

/** on-durations, gaps and periods of a gate list, in seconds. */
function gateStats(gates) {
  const on = gates.map((g) => g.end - g.start);
  const gaps = gates.slice(1).map((g, i) => g.start - gates[i].end);
  const periods = gates.slice(1).map((g, i) => g.start - gates[i].start);
  return { on, gaps, periods };
}

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

test('the think train is irregular: the gap varies, the on-duration does not', () => {
  // SPEC: on-duration near-constant at 219 ms, gap uniform 72-173 ms.
  const { on, gaps } = gateStats(thinkGates({ pulses: 200, seed: 7 }));

  assert.ok(Math.abs(mean(on) - 0.219) < 0.015, `on mean ${mean(on)} is not ~219 ms`);
  assert.ok(sd(on) < 0.02, `on should be near-constant, sd ${sd(on)}`);

  assert.ok(Math.min(...gaps) >= GATE.gapMin - 1e-9, 'no gap below 72 ms');
  assert.ok(Math.max(...gaps) <= GATE.gapMax + 1e-9, 'no gap above 173 ms');
  assert.ok(sd(gaps) > 0.02 && sd(gaps) < 0.04, `gap sd ${sd(gaps)} outside 20-40 ms`);
});

test('successive gaps differ by at least 20 ms, so no steady beat emerges', () => {
  const { gaps } = gateStats(thinkGates({ pulses: 200, seed: 11 }));

  for (let i = 1; i < gaps.length; i++) {
    assert.ok(
      Math.abs(gaps[i] - gaps[i - 1]) >= GATE.gapMinDelta - 1e-9,
      `gaps ${i - 1} and ${i} are ${Math.abs(gaps[i] - gaps[i - 1])} apart`,
    );
  }
});

test('period CV sits between 0.06 and 0.14 — below 0.03 means no randomization', () => {
  const { periods } = gateStats(thinkGates({ pulses: 200, seed: 3 }));
  const cv = sd(periods) / mean(periods);

  assert.ok(cv > 0.06 && cv < 0.14, `period CV ${cv.toFixed(3)} outside 0.06-0.14`);
  assert.ok(Math.abs(mean(periods) - 0.341) < 0.02, `period mean ${mean(periods)} is not ~341 ms`);
});

test('a seed makes a train reproducible; omitting it does not', () => {
  assert.deepEqual(thinkGates({ pulses: 12, seed: 42 }), thinkGates({ pulses: 12, seed: 42 }));
  assert.notDeepEqual(thinkGates({ pulses: 12 }), thinkGates({ pulses: 12 }));
});

test('the episode tempo scales the train by 1.28x', () => {
  const ref = gateStats(thinkGates({ pulses: 60, seed: 5 }));
  const ep = gateStats(thinkGates({ pulses: 60, seed: 5, tempo: GATE.episodeTempo }));

  assert.ok(Math.abs(mean(ep.on) / mean(ref.on) - 1.28) < 0.01, 'on scales');
  assert.ok(Math.abs(mean(ep.gaps) / mean(ref.gaps) - 1.28) < 0.01, 'gap scales too');
});

test('a train is generated for a requested duration, not looped', () => {
  const gates = thinkGates({ seconds: 5 });
  const last = gates[gates.length - 1].end;

  assert.equal(gates.length, Math.ceil(GATE.pulsesPerSecond * 5));
  assert.ok(last > 4 && last < 6.5, `5 s of deliberation ran ${last.toFixed(2)} s`);
});

test('rendered gates sound and fall silent where the gate list says', () => {
  const gates = thinkGates({ pulses: 6, seed: 9 });
  const samples = renderTones(thinkTones(gates));

  // Peak over a 2 ms window: a single-sample probe can land on a zero crossing
  // of the sine and read as silence.
  const at = (sec) => {
    const from = Math.floor(sec * RATE);
    let peak = 0;
    for (let i = from; i < from + Math.floor(0.002 * RATE); i++) {
      peak = Math.max(peak, Math.abs(samples[i] ?? 0));
    }
    return peak > 0.05;
  };

  for (const [i, gate] of gates.entries()) {
    assert.ok(at((gate.start + gate.end) / 2), `pulse ${i} should be sounding`);
    const next = gates[i + 1];
    if (next) assert.ok(!at((gate.end + next.start) / 2), `gap after pulse ${i} should be silent`);
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

test('the silence between the last pulse and the verdict is 0.275 s', () => {
  assert.ok(Math.abs(TIMING.silenceBeforeVerdict - 0.275) < 1e-9);
  assert.ok(TIMING.silenceBeforeVerdict > 0, 'think and the verdict never overlap');
});

test('no fixed period survives in the timing table', () => {
  // The train is irregular, so a caller must generate gates rather than loop.
  assert.equal(TIMING.gatePeriod, undefined);
  assert.equal(TIMING.thinkCycle, undefined);
});

test('cueDuration reports each cue at its rendered length', () => {
  assert.ok(cueDuration('think') > 0, 'the seeded default train has a length');
  assert.ok(Math.abs(cueDuration('reject') - 1.24) < 1e-9);
  assert.ok(Math.abs(cueDuration('agree') - 1.24) < 1e-9, 'both verdicts run 1.24 s');
  assert.equal(cueDuration('no-such-cue'), 0);
  assert.equal(cueDuration('withhold'), 0, 'per-unit cues are gone');
});
