/**
 * Worked examples for --demo. Picked at random each run so a demo does not
 * always land on the same verdict — real deliberations don't.
 */

const SCENARIOS = [
  {
    proposition: 'Replace the hand-rolled session cache with Redis before the launch.',
    target: 'git diff HEAD · 6 files',
    votes: [
      {
        agent: 'MELCHIOR-1',
        verdict: 'APPROVE',
        headline: 'Cache semantics are sound and the eviction path is now bounded.',
        findings: [
          {
            file: 'src/cache.ts',
            line: 48,
            severity: 'minor',
            summary: 'TTL is read once at boot; a config reload will not take effect until restart.',
          },
        ],
      },
      {
        agent: 'BALTHASAR-2',
        verdict: 'APPROVE',
        headline: 'Session data is encrypted at rest and the blast radius is one service.',
        findings: [
          {
            file: 'src/cache.ts',
            line: 91,
            severity: 'major',
            summary:
              'Redis connection falls back to plaintext when TLS negotiation fails, instead of refusing to start.',
          },
        ],
      },
      {
        agent: 'CASPER-3',
        verdict: 'REJECT',
        headline: 'This adds an operational dependency nobody on call is trained to run.',
        findings: [
          {
            file: 'deploy/redis.yaml',
            line: 12,
            severity: 'critical',
            summary: 'Single node, no persistence, no replica: every deploy drops all sessions.',
          },
          {
            severity: 'major',
            summary:
              'No runbook and no alerting on eviction rate; this pages someone at 3am within a month.',
          },
        ],
      },
    ],
  },

  {
    proposition: 'Drop the users table and rebuild it from the event log during the maintenance window.',
    target: 'migrations/041_rebuild_users.sql · 3 files',
    votes: [
      {
        agent: 'MELCHIOR-1',
        verdict: 'REJECT',
        headline: 'The event log is not a complete record; rebuilding from it loses rows.',
        findings: [
          {
            file: 'migrations/041_rebuild_users.sql',
            line: 12,
            severity: 'critical',
            summary: 'Events before the 2024 retention cutoff were pruned, so any earlier account cannot be reconstructed.',
          },
        ],
      },
      {
        agent: 'BALTHASAR-2',
        verdict: 'REJECT',
        headline: 'This destroys user data with no tested path back.',
        findings: [
          {
            file: 'migrations/041_rebuild_users.sql',
            line: 1,
            severity: 'critical',
            summary: 'DROP TABLE runs before the rebuild, so a failure mid-migration leaves no users at all and no rollback.',
          },
        ],
      },
      {
        agent: 'CASPER-3',
        verdict: 'REJECT',
        headline: 'A maintenance window is not long enough to recover if this goes wrong.',
        findings: [
          {
            severity: 'major',
            summary: 'The rebuild is estimated at 40 minutes against a 30 minute window, with no plan for overrun.',
          },
        ],
      },
    ],
  },

  {
    proposition: 'Ship the new rate limiter ahead of the marketing launch tomorrow.',
    target: 'git diff HEAD · 4 files',
    votes: [
      {
        agent: 'MELCHIOR-1',
        verdict: 'APPROVE',
        headline: 'The token-bucket math is correct and the tests cover the boundary cases.',
        findings: [],
      },
      {
        agent: 'BALTHASAR-2',
        verdict: 'APPROVE',
        headline: 'Fails closed under Redis outage; nothing worse than a slower request.',
        findings: [
          {
            file: 'src/rateLimit.ts',
            line: 33,
            severity: 'minor',
            summary: 'The fallback limit is hardcoded rather than configurable, but it is conservative.',
          },
        ],
      },
      {
        agent: 'CASPER-3',
        verdict: 'APPROVE',
        headline: 'Small, well-scoped change that matches how the rest of the API already handles limits.',
        findings: [],
      },
    ],
  },

  {
    proposition: 'Move the monorepo from npm workspaces to a from-scratch Bazel build.',
    target: '(architecture decision)',
    votes: [
      {
        agent: 'MELCHIOR-1',
        verdict: 'APPROVE',
        headline: 'Bazel’s incremental graph is a real correctness win over npm’s flat install.',
        findings: [],
      },
      {
        agent: 'BALTHASAR-2',
        verdict: 'ABSTAIN',
        headline: 'No security regression either way; this is not my axis to decide on.',
        findings: [],
      },
      {
        agent: 'CASPER-3',
        verdict: 'REJECT',
        headline: 'Nobody on the team has run Bazel before, and this is a six-month migration for a ten-person repo.',
        findings: [
          {
            severity: 'major',
            summary: 'The build is currently slow but working; the pain does not yet justify the retraining cost.',
          },
        ],
      },
    ],
  },

  {
    proposition: 'Enable the LLM-generated SQL feature for all customers, not just the opted-in beta cohort.',
    target: '(architecture decision)',
    votes: [
      {
        agent: 'MELCHIOR-1',
        verdict: 'REJECT',
        headline: 'The beta cohort’s error rate on multi-table joins is still 4%, well above the 1% bar.',
        findings: [
          {
            severity: 'major',
            summary: 'No query-plan cost cap exists yet, so a bad generation can still run an unbounded scan.',
          },
        ],
      },
      {
        agent: 'BALTHASAR-2',
        verdict: 'REJECT',
        headline: 'A wrong generated query can silently return the wrong customer’s data across a join.',
        findings: [
          {
            severity: 'critical',
            summary: 'Row-level security is enforced at the table layer, not verified against the generated join itself.',
          },
        ],
      },
      {
        agent: 'CASPER-3',
        verdict: 'REJECT',
        headline: 'Support has no runbook yet for a customer who gets a confidently wrong answer.',
        findings: [],
      },
    ],
  },
];

/** A random scenario, so --demo does not land on the same verdict every time. */
export function randomDemo() {
  return SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
}

/** Backward-compatible export: the first scenario, for anything that wants a fixed one. */
export const DEMO = SCENARIOS[0];
