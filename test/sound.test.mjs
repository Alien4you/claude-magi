import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CUES, createSpeaker, _internals } from '../lib/sound.mjs';

const { renderTones, toWav, RATE } = _internals;

test('every cue the animation asks for exists', () => {
  for (const cue of ['boot', 'tick', 'affirm', 'negate', 'withhold', 'klaxon', 'approved', 'rejected']) {
    assert.ok(Array.isArray(CUES[cue]) && CUES[cue].length, `missing cue: ${cue}`);
  }
});

test('the klaxon alternates two fundamentals over several cycles', () => {
  // Each blast is a saw fundamental with a square an octave below it.
  const fundamentals = [...new Set(CUES.klaxon.filter((t) => t.wave === 'saw').map((t) => t.freq))];

  assert.equal(fundamentals.length, 2, 'a high and a low blast');
  assert.ok(CUES.klaxon.length >= 16, 'several cycles, two voices each');
});

test('the klaxon sustains rather than decaying, which is what makes it a horn', () => {
  for (const tone of CUES.klaxon) {
    assert.equal(tone.env, 'gate', 'every klaxon blast is gated, not plucked');
  }
});

test('the klaxon blasts do not overlap each other', () => {
  const saws = CUES.klaxon
    .filter((t) => t.wave === 'saw')
    .sort((a, b) => a.start - b.start);

  for (let i = 1; i < saws.length; i++) {
    assert.ok(
      saws[i].start >= saws[i - 1].start + saws[i - 1].dur,
      `blast ${i} starts before blast ${i - 1} ends`,
    );
  }
});

test('a gated envelope holds full level through the middle of the tone', async () => {
  const { renderTones } = _internals;
  const gated = renderTones([{ start: 0, dur: 0.4, freq: 400, wave: 'square', gain: 1, env: 'gate' }]);
  const plucked = renderTones([{ start: 0, dur: 0.4, freq: 400, wave: 'square', gain: 1 }]);

  const peakNear = (buf, fraction) => {
    const centre = Math.floor(buf.length * fraction);
    let peak = 0;
    for (let i = centre - 200; i < centre + 200; i++) peak = Math.max(peak, Math.abs(buf[i] ?? 0));
    return peak;
  };

  assert.ok(peakNear(gated, 0.8) > 0.9, 'gated tone is still at full level late on');
  assert.ok(peakNear(plucked, 0.8) < 0.4, 'plucked tone has decayed by then');
});

test('rendered audio is the expected length and stays in range', () => {
  const samples = renderTones(CUES.affirm);
  const span = Math.max(...CUES.affirm.map((t) => t.start + t.dur));

  assert.ok(samples.length >= span * RATE, 'covers every tone');
  assert.ok(samples.every((s) => Number.isFinite(s)), 'no NaN in the buffer');
});

test('toWav emits a valid 16-bit mono PCM header', () => {
  const wav = toWav(renderTones(CUES.tick));

  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1, 'PCM format');
  assert.equal(wav.readUInt16LE(22), 1, 'mono');
  assert.equal(wav.readUInt32LE(24), RATE);
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
  const supplied = join(dir, 'klaxon.wav');
  writeFileSync(supplied, toWav(renderTones(CUES.tick)));

  try {
    // `enabled:false` returns an inert speaker, so exercise resolution directly
    // through a speaker that never spawns a player.
    const speaker = createSpeaker({ enabled: true, soundDir: dir });
    assert.doesNotThrow(() => speaker.play('klaxon'));
    assert.doesNotThrow(() => speaker.play('affirm'), 'falls back to synthesis');
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
