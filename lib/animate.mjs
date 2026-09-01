/**
 * Drives the MAGI frames over time: owns the clock, the cursor and the
 * speaker. All frame content comes from `frames.mjs`.
 *
 * The console deliberates as one. All three units come online together, blink
 * together on the pulse train, and answer at the same moment; a single verdict
 * tone lands with the result. Units are never sounded individually.
 */

import process from 'node:process';

import { composeScreen, findingsReport, STATES } from './frames.mjs';
import { createSpeaker, cueDuration, TIMING, verdictCue, thinkGates } from './sound.mjs';
import { summarize } from './verdict.mjs';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR = '\x1b[2J\x1b[H';

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

/** Seconds to milliseconds; the timing table is all in seconds. */
const ms = (seconds) => Math.round(seconds * 1000);

/** Seconds the units deliberate before answering. */
const DELIBERATE_FOR = TIMING.deliberateFor;

const STATE_FOR = {
  APPROVE: STATES.APPROVE,
  REJECT: STATES.REJECT,
  ABSTAIN: STATES.ABSTAIN,
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
 * @param {number}  [o.deliberateFor] seconds of deliberation before the verdict
 */
export async function deliberate(o) {
  const out = o.out ?? process.stdout;
  const tty = Boolean(out.isTTY);
  const animate = o.animate ?? tty;
  const color = o.color ?? tty;
  const width = Math.min(out.columns || 80, 100);
  const speed = o.speed ?? 1;
  const seconds = o.deliberateFor ?? DELIBERATE_FOR;
  const wait = (delay) => sleep(delay * speed);

  const speaker = createSpeaker({
    enabled: (o.sound ?? true) && animate,
    soundDir: o.soundDir ?? process.env.MAGI_SOUND_DIR ?? null,
  });

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

  const tail = () => {
    const findings = findingsReport({ result: o.result, width, color });
    if (findings.trim()) out.write(findings + '\n');
    out.write(`\n${summarize(o.result)}\n`);
  };

  // Static path: piped output, --no-animate, or a dumb terminal.
  if (!animate) {
    for (const vote of o.result.votes) states[vote.agent] = STATE_FOR[vote.verdict];
    draw({ showVerdict: true });
    tail();
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

    // 1. All three units come online together.
    speaker.play('boot');
    for (const vote of o.result.votes) states[vote.agent] = STATES.THINKING;
    draw();
    await wait(320);

    // 2. Deliberation. The train is irregular by measurement, so the blink
    //    follows the generated gate list rather than a fixed period — the
    //    panels flash exactly when the pulses sound.
    const gates = speaker.playThink(seconds);
    const train = gates.length ? gates : thinkGates({ seconds });

    let elapsed = 0;
    for (const gate of train) {
      await wait(ms(gate.start - elapsed));
      draw({ blink: false });
      await wait(ms(gate.end - gate.start));
      draw({ blink: true });
      elapsed = gate.end;
    }

    // 0.275 s of silence, as in the source: deliberation and verdict never
    // overlap.
    draw();
    await wait(ms(TIMING.silenceBeforeVerdict));

    // 3. All three answer at once, and the one verdict tone lands with them.
    for (const vote of o.result.votes) states[vote.agent] = STATE_FOR[vote.verdict];
    const cue = verdictCue(o.result.decision);
    speaker.play(cue);
    draw({ showVerdict: true });
    await wait(ms(cueDuration(cue)));

    // 4. Dissent raises the alarm, after the verdict has been stated.
    if (o.result.dissenters.length) {
      await wait(ms(TIMING.silenceBeforeVerdict));
      speaker.play('klaxon');

      const half = 220;
      const flashes = Math.round(ms(cueDuration('klaxon')) / half);
      for (let i = 0; i < flashes; i++) {
        draw({ showVerdict: true, blink: i % 2 === 1 });
        await wait(half);
      }
      draw({ showVerdict: true });
    }

    tail();
  } finally {
    restore();
  }
}
