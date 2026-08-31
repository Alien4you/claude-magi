import test from 'node:test';
import assert from 'node:assert/strict';

import { tally } from '../lib/verdict.mjs';
import { deliberate } from '../lib/animate.mjs';

/** A stream stand-in that records everything written to it. */
function fakeStream({ isTTY = true, columns = 80 } = {}) {
  const chunks = [];
  return {
    isTTY,
    columns,
    write(s) {
      chunks.push(s);
      return true;
    },
    get frames() {
      return chunks.length;
    },
    get text() {
      return chunks.join('');
    },
  };
}

const split = tally([
  { agent: 'MELCHIOR-1', verdict: 'APPROVE', headline: 'logic holds', findings: [] },
  { agent: 'BALTHASAR-2', verdict: 'APPROVE', headline: 'no one gets hurt', findings: [] },
  {
    agent: 'CASPER-3',
    verdict: 'REJECT',
    headline: 'nobody on call can run this',
    findings: [{ severity: 'critical', summary: 'pages someone at 3am within a month' }],
  },
]);

const run = (out, over = {}) =>
  deliberate({
    proposition: 'Ship the cache rewrite?',
    target: 'git diff HEAD',
    result: split,
    out,
    sound: false,
    speed: 0,
    ...over,
  });

test('the animated path emits many frames and restores the cursor', async () => {
  const out = fakeStream();
  await run(out, { animate: true });

  assert.ok(out.frames > 10, `expected an animation, got ${out.frames} writes`);
  assert.ok(out.text.includes('\x1b[?25l'), 'hides the cursor');
  assert.ok(out.text.includes('\x1b[?25h'), 'restores the cursor');
  assert.ok(out.text.includes('\x1b[2J'), 'repaints between frames');
});

test('the animation ends on the verdict, findings and a one-line summary', async () => {
  const out = fakeStream();
  await run(out, { animate: true });

  assert.ok(out.text.includes('可決'), 'stamps the verdict');
  assert.ok(out.text.includes('pages someone at 3am within a month'), 'lists findings');
  assert.match(out.text, /可決 \/ APPROVED \(2-1\) — CASPER-3 dissents/);
});

test('a non-TTY stream gets one static frame and no cursor control', async () => {
  const out = fakeStream({ isTTY: false });
  await run(out);

  assert.ok(!out.text.includes('\x1b[?25l'), 'no cursor hiding when piped');
  assert.ok(!out.text.includes('\x1b[2J'), 'no screen clearing when piped');
  assert.ok(!out.text.includes('\x1b['), 'no colour when piped');
  assert.ok(out.text.includes('可決'), 'still reports the verdict');
});

test('every unit reaches a resolved state by the end', async () => {
  const out = fakeStream();
  await run(out, { animate: true });

  const tail = out.text.slice(out.text.lastIndexOf('\x1b[2J'));
  assert.ok(!tail.includes('審議中'), 'nothing is still deliberating on the last frame');
  assert.equal([...tail.matchAll(/肯定/g)].length, 2);
  assert.equal([...tail.matchAll(/否定/g)].length, 1);
});
