/** A worked example, shared by both renderers' --demo flag. */
export const DEMO = {
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
};
