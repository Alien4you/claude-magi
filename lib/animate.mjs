/**
 * Drives the MAGI frames over time: owns the clock, the cursor and the
 * speaker. All frame content comes from `frames.mjs`.
 */

import process from 'node:process';

import { composeScreen, findingsReport, STATES } from './frames.mjs';
import { createSpeaker } from './sound.mjs';
import { summarize } from './verdict.mjs';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR = '\x1b[2J\x1b[H';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const STATE_FOR = {
  APPROVE: STATES.APPROVE,
  REJECT: STATES.REJECT,
  ABSTAIN: STATES.ABSTAIN,
};

const CUE_FOR = {
  APPROVE: 'affirm',
  REJECT: 'negate',
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

    // 2. Deliberation: the 審議中 glyph strobes.
    for (let i = 0; i < 7; i++) {
      draw({ blink: i % 2 === 1 });
      await wait(190);
    }

    // 3. Each unit returns its verdict in turn.
    for (const vote of o.result.votes) {
      states[vote.agent] = STATE_FOR[vote.verdict];
      speaker.play(CUE_FOR[vote.verdict]);
      draw();
      await wait(420);

      if (dissent.has(vote.agent)) {
        speaker.play('klaxon');
        // Strobe the whole board while the klaxon runs.
        for (let i = 0; i < 8; i++) {
          draw({ blink: i % 2 === 1 });
          await wait(150);
        }
      }
      await wait(320);
    }

    // 4. The stamp.
    await wait(260);
    speaker.play(o.result.decision === 'APPROVED' ? 'approved' : 'rejected');
    draw({ showVerdict: true });
    await wait(900);

    const findings = findingsReport({ result: o.result, width, color });
    if (findings.trim()) out.write(findings + '\n');
    out.write(`\n${summarize(o.result)}\n`);
  } finally {
    restore();
  }
}
