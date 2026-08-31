/**
 * MAGI deliberation tally.
 *
 * Three units vote on one proposition. Normal operations carry on a simple
 * majority of the votes actually cast; abstentions count toward neither side.
 * Without a majority either way the system fails closed to 否決 — an
 * undecided MAGI never green-lights anything.
 */

export const AGENTS = ['MELCHIOR-1', 'BALTHASAR-2', 'CASPER-3'];

export const VERDICTS = ['APPROVE', 'REJECT', 'ABSTAIN'];

const AGENT_TITLES = {
  'MELCHIOR-1': 'Scientist',
  'BALTHASAR-2': 'Mother',
  'CASPER-3': 'Woman',
};

/**
 * @param {Array<{agent: string, verdict: string, headline?: string, findings?: Array}>} rawVotes
 * @returns {object} the tallied deliberation
 */
export function tally(rawVotes) {
  if (!Array.isArray(rawVotes) || rawVotes.length !== AGENTS.length) {
    throw new Error(
      `MAGI requires exactly three votes, one per unit; received ${
        Array.isArray(rawVotes) ? rawVotes.length : typeof rawVotes
      }`,
    );
  }

  const seen = new Set();
  const byAgent = new Map();

  for (const raw of rawVotes) {
    const agent = String(raw?.agent ?? '').toUpperCase();

    if (!AGENTS.includes(agent)) {
      throw new Error(`Unknown MAGI unit: ${raw?.agent}. Expected one of ${AGENTS.join(', ')}`);
    }
    if (seen.has(agent)) {
      throw new Error(`Duplicate vote from ${agent}`);
    }
    seen.add(agent);

    const verdict = String(raw?.verdict ?? '').toUpperCase();
    if (!VERDICTS.includes(verdict)) {
      throw new Error(`Unknown verdict from ${agent}: ${raw?.verdict}. Expected one of ${VERDICTS.join(', ')}`);
    }

    byAgent.set(agent, {
      agent,
      title: AGENT_TITLES[agent],
      verdict,
      headline: raw?.headline ?? '',
      findings: Array.isArray(raw?.findings) ? raw.findings : [],
    });
  }

  // Three votes, all known units, no duplicates — so all three are present.
  // Canonical MAGI order, never input order.
  const votes = AGENTS.map((agent) => byAgent.get(agent));

  const approvers = votes.filter((v) => v.verdict === 'APPROVE').map((v) => v.agent);
  const rejecters = votes.filter((v) => v.verdict === 'REJECT').map((v) => v.agent);
  const abstainers = votes.filter((v) => v.verdict === 'ABSTAIN').map((v) => v.agent);

  const approve = approvers.length;
  const reject = rejecters.length;
  const deadlocked = approve === reject;
  const decision = approve > reject ? 'APPROVED' : 'REJECTED';

  // Dissent is measured against the side that carried. In a deadlock nothing
  // carried, so every cast vote reads as dissent.
  const majoritySide = deadlocked ? null : decision === 'APPROVED' ? 'APPROVE' : 'REJECT';
  const dissenters = votes
    .filter((v) => v.verdict !== 'ABSTAIN' && v.verdict !== majoritySide)
    .map((v) => v.agent);

  return {
    decision,
    label: decision === 'APPROVED' ? '可決' : '否決',
    votes,
    approve,
    reject,
    abstain: abstainers.length,
    approvers,
    rejecters,
    abstainers,
    dissenters,
    deadlocked,
    unanimous: approve === AGENTS.length || reject === AGENTS.length,
    tallyText: `${Math.max(approve, reject)}-${Math.min(approve, reject)}`,
  };
}

/** One-line terminal summary, e.g. `可決 / APPROVED (2-1) — CASPER-3 dissents`. */
export function summarize(result) {
  const base = `${result.label} / ${result.decision} (${result.tallyText})`;

  if (result.deadlocked) return `${base} — deadlocked, failing closed`;
  if (result.dissenters.length === 0) return `${base} — unanimous`;

  const verb = result.dissenters.length === 1 ? 'dissents' : 'dissent';
  return `${base} — ${result.dissenters.join(', ')} ${verb}`;
}
