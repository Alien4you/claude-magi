import test from 'node:test';
import assert from 'node:assert/strict';

import { tally } from '../lib/verdict.mjs';
import { composeScreen, sanitize, wrap, STATES } from '../lib/frames.mjs';

const votes = (a, b, c) => [
  { agent: 'MELCHIOR-1', verdict: a, headline: 'logic holds', findings: [] },
  { agent: 'BALTHASAR-2', verdict: b, headline: 'no one gets hurt', findings: [] },
  { agent: 'CASPER-3', verdict: c, headline: 'we can ship it', findings: [] },
];

const screen = (over = {}) =>
  composeScreen({
    proposition: 'Should we ship it?',
    target: 'git diff HEAD',
    timestamp: '2026-09-01T00:00:00Z',
    result: tally(votes('APPROVE', 'APPROVE', 'REJECT')),
    states: { 'MELCHIOR-1': STATES.THINKING, 'BALTHASAR-2': STATES.THINKING, 'CASPER-3': STATES.THINKING },
    showVerdict: false,
    color: false,
    width: 80,
    ...over,
  });

test('deliberating units show 審議中', () => {
  const out = screen();
  assert.equal([...out.matchAll(/審議中/g)].length, 3);
  assert.ok(!out.includes('肯定'), 'no unit has resolved yet');
});

test('resolved units show their own verdict glyph', () => {
  const out = screen({
    states: { 'MELCHIOR-1': STATES.APPROVE, 'BALTHASAR-2': STATES.APPROVE, 'CASPER-3': STATES.REJECT },
  });

  assert.equal([...out.matchAll(/肯定/g)].length, 2);
  assert.equal([...out.matchAll(/否定/g)].length, 1);
  assert.ok(!out.includes('審議中'));
});

test('an abstaining unit shows 保留', () => {
  const out = screen({
    result: tally(votes('APPROVE', 'REJECT', 'ABSTAIN')),
    states: { 'MELCHIOR-1': STATES.APPROVE, 'BALTHASAR-2': STATES.REJECT, 'CASPER-3': STATES.ABSTAIN },
  });

  assert.ok(out.includes('保留'));
});

test('all three units are drawn, in the triangle layout order', () => {
  const out = screen();
  // The show arranges them BALTHASAR above, CASPER lower left, MELCHIOR lower
  // right — so the drawn order is not the canonical vote order.
  const order = ['BALTHASAR·2', 'CASPER·3', 'MELCHIOR·1'].map((a) => out.indexOf(a));

  assert.ok(order.every((i) => i >= 0), 'every unit appears');
  assert.deepEqual([...order].sort((x, y) => x - y), order, 'top, then lower left, then lower right');
});

test('the three units and the MAGI centre form a triangle', () => {
  const lines = screen().split('\n');
  const rowOf = (needle) => lines.findIndex((l) => l.includes(needle));

  const balthasar = rowOf('BALTHASAR·2');
  const magi = rowOf('M A G I');
  const casper = rowOf('CASPER·3');
  const melchior = rowOf('MELCHIOR·1');

  assert.ok(balthasar < magi, 'BALTHASAR sits above the centre');
  assert.ok(magi < casper, 'the centre sits above the lower row');
  assert.equal(casper, melchior, 'CASPER and MELCHIOR share the lower row');
  assert.ok(
    lines[casper].indexOf('CASPER·3') < lines[melchior].indexOf('MELCHIOR·1'),
    'CASPER is left of MELCHIOR',
  );
});

test('the dissenting unit is marked once its verdict is in', () => {
  const out = screen({
    states: { 'MELCHIOR-1': STATES.APPROVE, 'BALTHASAR-2': STATES.APPROVE, 'CASPER-3': STATES.REJECT },
  });

  const dissentRow = out.split('\n').find((l) => l.includes('DISSENT'));
  assert.ok(dissentRow, 'a dissent marker is drawn');
  assert.equal([...out.matchAll(/DISSENT/g)].length, 1, 'only the dissenter is flagged');

  // The marker must sit in CASPER-3's column, not somewhere else on the board.
  const lines = out.split('\n');
  const casperCol = lines.find((l) => l.includes('CASPER·3')).indexOf('CASPER·3');
  assert.ok(
    Math.abs(dissentRow.indexOf('DISSENT') - casperCol) < 26,
    'the marker is inside the CASPER-3 panel',
  );
});

test('the final verdict block reports decision, tally and dissent', () => {
  const out = screen({ showVerdict: true });

  assert.ok(out.includes('可決'));
  assert.ok(out.includes('APPROVED'));
  assert.ok(out.includes('2-1'));
  assert.ok(out.includes('CASPER-3'));
});

test('a unanimous verdict says so', () => {
  const out = screen({
    result: tally(votes('APPROVE', 'APPROVE', 'APPROVE')),
    states: Object.fromEntries(['MELCHIOR-1', 'BALTHASAR-2', 'CASPER-3'].map((a) => [a, STATES.APPROVE])),
    showVerdict: true,
  });

  assert.ok(out.includes('UNANIMOUS'));
  assert.ok(!out.includes('DISSENT'));
});

test('a deadlock renders as failed closed', () => {
  const out = screen({
    result: tally(votes('APPROVE', 'REJECT', 'ABSTAIN')),
    states: { 'MELCHIOR-1': STATES.APPROVE, 'BALTHASAR-2': STATES.REJECT, 'CASPER-3': STATES.ABSTAIN },
    showVerdict: true,
  });

  assert.ok(out.includes('否決'));
  assert.ok(out.includes('DEADLOCK'));
});

test('color:false emits no escape sequences at all', () => {
  const out = screen({ showVerdict: true, color: false });
  assert.ok(!out.includes('\x1b'), 'plain text only');
});

test('color:true emits escape sequences and still contains the same words', () => {
  const out = screen({ showVerdict: true, color: true });
  assert.ok(out.includes('\x1b['));
  assert.ok(out.includes('可決'));
});

test('no rendered line exceeds the requested width', () => {
  const out = screen({ showVerdict: true, color: false, width: 80 });

  for (const line of out.split('\n')) {
    // CJK glyphs are double-width; count them twice.
    const cells = [...line].reduce((n, ch) => n + (/[　-鿿＀-｠]/.test(ch) ? 2 : 1), 0);
    assert.ok(cells <= 80, `line over 80 cells (${cells}): ${JSON.stringify(line)}`);
  }
});

test('a long proposition wraps instead of overflowing', () => {
  const long = 'Should we migrate the entire billing pipeline off MySQL and onto Postgres '
    + 'before the quarter closes, given the read-replica lag we saw last month?';
  const out = screen({ proposition: long, color: false, width: 80 });

  assert.ok(out.includes('Should we migrate'));
  for (const line of out.split('\n')) {
    assert.ok(line.length <= 80, `line over 80: ${JSON.stringify(line)}`);
  }
});

test('sanitize strips ANSI escapes so reviewed code cannot drive the terminal', () => {
  assert.equal(sanitize('\x1b[31mred\x1b[0m'), 'red');
  assert.equal(sanitize('a\x1b]0;title\x07b'), 'ab');
});

test('sanitize strips carriage returns and other control characters', () => {
  assert.equal(sanitize('a\rb\x00c\x07d'), 'abcd');
  assert.equal(sanitize('keeps\ttabs as spaces'), 'keeps tabs as spaces');
});

test('hostile finding text cannot inject escapes into a frame', () => {
  const hostile = tally([
    { agent: 'MELCHIOR-1', verdict: 'REJECT', headline: '\x1b[2J\x1b[HWIPED', findings: [] },
    { agent: 'BALTHASAR-2', verdict: 'REJECT', headline: 'no', findings: [] },
    { agent: 'CASPER-3', verdict: 'REJECT', headline: 'no', findings: [] },
  ]);
  const out = composeScreen({
    proposition: '\x1b[2J',
    target: 't',
    timestamp: 'ts',
    result: hostile,
    states: Object.fromEntries(['MELCHIOR-1', 'BALTHASAR-2', 'CASPER-3'].map((a) => [a, STATES.REJECT])),
    showVerdict: true,
    color: false,
    width: 80,
  });

  assert.ok(!out.includes('\x1b'), 'no escape survived into the frame');
  assert.ok(out.includes('WIPED'), 'the readable text is kept');
});

test('wrap never splits a line beyond the limit and keeps all words', () => {
  const lines = wrap('alpha beta gamma delta epsilon', 12);

  assert.ok(lines.every((l) => l.length <= 12));
  assert.equal(lines.join(' ').split(/\s+/).join(' '), 'alpha beta gamma delta epsilon');
});

test('wrap hard-breaks a word longer than the limit', () => {
  const lines = wrap('supercalifragilistic', 8);

  assert.ok(lines.every((l) => l.length <= 8));
  assert.equal(lines.join(''), 'supercalifragilistic');
});
