import test from 'node:test';
import assert from 'node:assert/strict';

import { tally, AGENTS } from '../lib/verdict.mjs';

const vote = (agent, verdict) => ({ agent, verdict, headline: `${agent} says ${verdict}` });

test('unanimous approval is 可決 with no dissent', () => {
  const r = tally([
    vote('MELCHIOR-1', 'APPROVE'),
    vote('BALTHASAR-2', 'APPROVE'),
    vote('CASPER-3', 'APPROVE'),
  ]);

  assert.equal(r.decision, 'APPROVED');
  assert.equal(r.label, '可決');
  assert.equal(r.approve, 3);
  assert.equal(r.reject, 0);
  assert.equal(r.unanimous, true);
  assert.deepEqual(r.dissenters, []);
});

test('unanimous rejection is 否決 with no dissent', () => {
  const r = tally([
    vote('MELCHIOR-1', 'REJECT'),
    vote('BALTHASAR-2', 'REJECT'),
    vote('CASPER-3', 'REJECT'),
  ]);

  assert.equal(r.decision, 'REJECTED');
  assert.equal(r.label, '否決');
  assert.equal(r.reject, 3);
  assert.equal(r.unanimous, true);
  assert.deepEqual(r.dissenters, []);
});

test('2-1 approval carries, the lone rejecter is the dissenter', () => {
  const r = tally([
    vote('MELCHIOR-1', 'APPROVE'),
    vote('BALTHASAR-2', 'APPROVE'),
    vote('CASPER-3', 'REJECT'),
  ]);

  assert.equal(r.decision, 'APPROVED');
  assert.equal(r.tallyText, '2-1');
  assert.equal(r.unanimous, false);
  assert.deepEqual(r.dissenters, ['CASPER-3']);
});

test('2-1 rejection carries, the lone approver is the dissenter', () => {
  const r = tally([
    vote('MELCHIOR-1', 'APPROVE'),
    vote('BALTHASAR-2', 'REJECT'),
    vote('CASPER-3', 'REJECT'),
  ]);

  assert.equal(r.decision, 'REJECTED');
  assert.equal(r.tallyText, '2-1');
  assert.deepEqual(r.dissenters, ['MELCHIOR-1']);
});

test('an abstaining agent counts toward neither side', () => {
  const r = tally([
    vote('MELCHIOR-1', 'APPROVE'),
    vote('BALTHASAR-2', 'APPROVE'),
    vote('CASPER-3', 'ABSTAIN'),
  ]);

  assert.equal(r.decision, 'APPROVED');
  assert.equal(r.approve, 2);
  assert.equal(r.reject, 0);
  assert.equal(r.abstain, 1);
  assert.deepEqual(r.abstainers, ['CASPER-3']);
  assert.deepEqual(r.dissenters, []);
  assert.equal(r.unanimous, false, 'an abstention is never unanimous');
});

test('a deadlock fails closed to 否決', () => {
  const r = tally([
    vote('MELCHIOR-1', 'APPROVE'),
    vote('BALTHASAR-2', 'REJECT'),
    vote('CASPER-3', 'ABSTAIN'),
  ]);

  assert.equal(r.decision, 'REJECTED');
  assert.equal(r.deadlocked, true);
  assert.deepEqual(r.dissenters.sort(), ['BALTHASAR-2', 'MELCHIOR-1']);
});

test('all three abstaining fails closed and is deadlocked', () => {
  const r = tally([
    vote('MELCHIOR-1', 'ABSTAIN'),
    vote('BALTHASAR-2', 'ABSTAIN'),
    vote('CASPER-3', 'ABSTAIN'),
  ]);

  assert.equal(r.decision, 'REJECTED');
  assert.equal(r.deadlocked, true);
  assert.equal(r.abstain, 3);
});

test('votes are returned in canonical MAGI order regardless of input order', () => {
  const r = tally([
    vote('CASPER-3', 'APPROVE'),
    vote('MELCHIOR-1', 'REJECT'),
    vote('BALTHASAR-2', 'APPROVE'),
  ]);

  assert.deepEqual(r.votes.map((v) => v.agent), AGENTS);
});

test('verdicts are accepted case-insensitively and normalized', () => {
  const r = tally([
    vote('MELCHIOR-1', 'approve'),
    vote('BALTHASAR-2', 'Approve'),
    vote('CASPER-3', 'reject'),
  ]);

  assert.equal(r.decision, 'APPROVED');
  assert.deepEqual(r.votes.map((v) => v.verdict), ['APPROVE', 'APPROVE', 'REJECT']);
});

test('an unknown verdict is rejected rather than silently ignored', () => {
  assert.throws(
    () => tally([
      vote('MELCHIOR-1', 'MAYBE'),
      vote('BALTHASAR-2', 'APPROVE'),
      vote('CASPER-3', 'APPROVE'),
    ]),
    /MAYBE/,
  );
});

test('an unknown agent is rejected', () => {
  assert.throws(
    () => tally([
      vote('MELCHIOR-1', 'APPROVE'),
      vote('BALTHASAR-2', 'APPROVE'),
      vote('GASPAR-4', 'APPROVE'),
    ]),
    /GASPAR-4/,
  );
});

test('a short quorum is rejected', () => {
  assert.throws(
    () => tally([vote('MELCHIOR-1', 'APPROVE'), vote('BALTHASAR-2', 'APPROVE')]),
    /exactly three votes/,
  );
});

test('a duplicate agent is rejected', () => {
  assert.throws(
    () => tally([
      vote('MELCHIOR-1', 'APPROVE'),
      vote('MELCHIOR-1', 'REJECT'),
      vote('CASPER-3', 'APPROVE'),
    ]),
    /MELCHIOR-1/,
  );
});

test('no votes at all is rejected', () => {
  assert.throws(() => tally([]), /three/i);
});
