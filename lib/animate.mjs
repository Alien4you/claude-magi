/**
 * Drives the MAGI frames over time: owns the clock, the cursor and the
 * speaker. All frame content comes from `frames.mjs`.
 */

import process from 'node:process';

import { composeScreen, findingsReport, STATES } from './frames.mjs';
import { createSpeaker, cueDuration, TIMING } from './sound.mjs';
import { summarize } from './verdict.mjs';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR = '\x1b[2J\x1b[H';

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

/** Seconds to milliseconds; the timing table is all in seconds. */
const ms = (seconds) => Math.round(seconds * 1000);

/**
 * How many times the deliberation train loops before the verdict.
 * The source plays it once; two reads better when three units are thinking.
 */
const THINK_CYCLES = 2;

const STATE_FOR = {
  APPROVE: STATES.APPROVE,
  REJECT: STATES.REJECT,
  ABSTAIN: STATES.ABSTAIN,
};

const CUE_FOR = {
  APPROVE: 'agree',
  REJECT: 'reject',
  ABSTAIN: 'withhold',
};

/**
 * Play the deliberation.
 *
 * @param {object} o
 * @param {string} o.proposition
 * @param {string} o.target
 * @param {object} o.result       output of `tally()`
 * @param {object} [o.out]        stream to write to (default stdout)
 * @param {boolean} [o.sound]
 * @param {boolean} [o.animate]   false prints one static frame
 * @param {number}  [o.speed]     1 = normal, 0 = instant
 */
export async function deliberate(o) {
  const out = o.out ?? process.stdout;
  const tty = Boolean(out.isTTY);
  const animate = o.animate ?? tty;
  const color = o.color ?? tty;
  const width = Math.min(out.columns || 80, 100);
  const speed = o.speed ?? 1;
  const wait = (ms) => sleep(ms * speed);

  const speaker = createSpeaker({
    enabled: (o.sound ?? true) && animate,
    soundDir: o.soundDir ?? process.env.MAGI_SOUND_DIR ?? null,
  });
  const dissent = new Set(o.result.dissenters);

  const states = Object.fromEntries(o.result.votes.map((v) => [v.agent, STATES.IDLE]));

  const draw = ({ showVerdict = false, blink = false } = {}) => {
    const frame = composeScreen({
      proposition: o.proposition,
      target: o.target ?? '—',
      timestamp: o.timestamp ?? new Date().toISOString().replace('T', ' ').slice(0, 19),
      result: o.result,
      states,
      showVerdict,
      color,
      width,
      blink,
    });
    out.write(animate ? CLEAR + frame + '\n' : frame + '\n');
  };

  // Static path: piped output, --no-animate, or a dumb terminal.
  if (!animate) {
    for (const vote of o.result.votes) states[vote.agent] = STATE_FOR[vote.verdict];
    draw({ showVerdict: true });
    const findings = findingsReport({ result: o.result, width, color });
    if (findings.trim()) out.write(findings + '\n');
    out.write(`\n${summarize(o.result)}\n`);
    return;
  }

  const restore = () => {
    out.write(SHOW_CURSOR);
    speaker.close();
  };
  process.once('SIGINT', () => {
    restore();
    process.exit(130);
  });

  try {
    out.write(HIDE_CURSOR);

    // 1. Units power up one at a time.
    speaker.play('boot');
    await wait(320);
    for (const vote of o.result.votes) {
      states[vote.agent] = STATES.THINKING;
      speaker.play('tick');
      draw();
      await wait(260);
    }

    // 2. Deliberation, timed to the scene: `think` loops on its 442 ms period
    //    and the glyph strobes with it, one blink per pulse.
    for (let cycle = 0; cycle < THINK_CYCLES; cycle++) {
      speaker.play('think');
      for (let pulse = 0; pulse < TIMING.pulses; pulse++) {
        draw({ blink: false });
        await wait(ms(TIMING.gateOn));
        draw({ blink: true });
        await wait(ms(TIMING.gatePeriod - TIMING.gateOn));
      }
    }

    // The verdict lands 1.436 s after the last cycle's first pulse onset, so
    // what remains after three pulses is 0.275 s of silence. They never
    // overlap: in the source the tones are strictly sequential.
    draw();
    await wait(ms(TIMING.silenceBeforeVerdict));

    // 3. Each unit returns its verdict in turn, each held for its own length.
    for (const vote of o.result.votes) {
      states[vote.agent] = STATE_FOR[vote.verdict];
      const cue = CUE_FOR[vote.verdict];
      speaker.play(cue);
      draw();
      await wait(ms(cueDuration(cue)));

      if (dissent.has(vote.agent)) {
        speaker.play('klaxon');
        // Strobe the board on the klaxon's own alternation.
        const half = ms(TIMING.gatePeriod / 2);
        const flashes = Math.round(ms(cueDuration('klaxon')) / half);
        for (let i = 0; i < flashes; i++) {
          draw({ blink: i % 2 === 1 });
          await wait(half);
        }
      }
      await wait(ms(TIMING.silenceBeforeVerdict));
    }

    // 4. The stamp, after the same silence, held for the cue's own length.
    await wait(ms(TIMING.silenceBeforeVerdict));
    const stamp = o.result.decision === 'APPROVED' ? 'approved' : 'rejected';
    speaker.play(stamp);
    draw({ showVerdict: true });
    await wait(ms(cueDuration(stamp)));

    const findings = findingsReport({ result: o.result, width, color });
    if (findings.trim()) out.write(findings + '\n');
    out.write(`\n${summarize(o.result)}\n`);
  } finally {
    restore();
  }
}
