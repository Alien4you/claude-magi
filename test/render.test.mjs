import test from 'node:test';
import assert from 'node:assert/strict';

import { tally } from '../lib/verdict.mjs';
import { renderHtml, escapeHtml, embedJson } from '../lib/render.mjs';

const votes = (a, b, c) => [
  { agent: 'MELCHIOR-1', verdict: a, headline: 'logic', findings: [] },
  { agent: 'BALTHASAR-2', verdict: b, headline: 'safety', findings: [] },
  { agent: 'CASPER-3', verdict: c, headline: 'pragmatics', findings: [] },
];

const report = (over = {}) => ({
  proposition: 'Should we ship it?',
  target: 'git diff HEAD',
  timestamp: '2026-09-01 00:00:00',
  result: tally(votes('APPROVE', 'APPROVE', 'REJECT')),
  ...over,
});

/** Every unit panel's opening tag, in document order. */
function panelTags(html) {
  return [...html.matchAll(/<div class="panel [^"]*"[\s\S]*?>/g)].map((m) => m[0]);
}

/** Panels carrying the dissent flag, read off the panel tags only. */
function dissentingPanels(html) {
  return panelTags(html)
    .filter((tag) => tag.includes('data-dissent="true"'))
    .map((tag) => /data-agent="([^"]+)"/.exec(tag)[1]);
}

test('escapeHtml neutralizes every markup character', () => {
  assert.equal(
    escapeHtml(`<script>"x"&'y'</script>`),
    '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;',
  );
});

test('embedJson escapes angle brackets so a payload cannot close the script tag', () => {
  const out = embedJson({ evil: '</script><img onerror=alert(1)>' });

  assert.ok(!out.includes('</script>'));
  assert.ok(!out.includes('<'));
  assert.deepEqual(JSON.parse(out), { evil: '</script><img onerror=alert(1)>' });
});

test('embedJson escapes the separators that break JS string literals', () => {
  const sep = String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
  const out = embedJson({ s: `a${sep}b` });

  assert.ok(!new RegExp('[\\u2028\\u2029]').test(out), 'raw separators must not survive');
  assert.equal(JSON.parse(out).s, `a${sep}b`);
});

test('embedJson leaves ordinary spaces alone', () => {
  assert.equal(JSON.parse(embedJson({ s: 'a b c' })).s, 'a b c');
});

test('a hostile proposition is escaped, not injected', () => {
  const html = renderHtml(report({ proposition: '<img src=x onerror=alert(1)>' }));

  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('hostile finding text is escaped', () => {
  const hostile = tally([
    {
      agent: 'MELCHIOR-1',
      verdict: 'REJECT',
      headline: '<b>bad</b>',
      findings: [
        { file: 'src/<x>.ts', line: 3, severity: 'critical', summary: '</script><script>alert(1)</script>' },
      ],
    },
    { agent: 'BALTHASAR-2', verdict: 'REJECT', headline: 'no', findings: [] },
    { agent: 'CASPER-3', verdict: 'APPROVE', headline: 'ok', findings: [] },
  ]);
  const html = renderHtml(report({ result: hostile }));

  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('src/&lt;x&gt;.ts:3'));
  assert.ok(html.includes('&lt;b&gt;bad&lt;/b&gt;'));
});

test('the page carries the decision, tally and dissenting unit', () => {
  const html = renderHtml(report());

  assert.ok(html.includes('可決'));
  assert.ok(html.includes('APPROVED'));
  assert.ok(html.includes('2-1'));
  assert.ok(html.includes('DISSENT: CASPER-3'));
  assert.deepEqual(dissentingPanels(html), ['CASPER-3']);
});

test('a unanimous page says so and flags no dissent', () => {
  const html = renderHtml(report({ result: tally(votes('APPROVE', 'APPROVE', 'APPROVE')) }));

  assert.ok(html.includes('UNANIMOUS'));
  assert.deepEqual(dissentingPanels(html), []);
});

test('a deadlock renders as failed closed', () => {
  const html = renderHtml(report({ result: tally(votes('APPROVE', 'REJECT', 'ABSTAIN')) }));

  assert.ok(html.includes('否決'));
  assert.ok(html.includes('DEADLOCK · FAILED CLOSED'));
});

test('panels are laid out in the triangle: BALTHASAR top, CASPER left, MELCHIOR right', () => {
  const panels = panelTags(renderHtml(report())).map((tag) => [
    /data-agent="([^"]+)"/.exec(tag)[1],
    /class="panel slot-(\w+)/.exec(tag)[1],
  ]);

  assert.deepEqual(panels, [
    ['BALTHASAR-2', 'balthasar'],
    ['CASPER-3', 'casper'],
    ['MELCHIOR-1', 'melchior'],
  ]);
});

test('each unit gets the clip-path that shapes its corner of the triangle', () => {
  const html = renderHtml(report());

  // BALTHASAR narrows at the bottom; CASPER and MELCHIOR cut their inner top
  // corners so the three meet around the centre.
  assert.ok(html.includes('.slot-balthasar, .slot-balthasar > .inner { clip-path: polygon(0 0, 100% 0, 100% 80%, 75% 100%, 25% 100%, 0 80%); }'));
  assert.ok(html.includes('.slot-casper, .slot-casper > .inner { clip-path: polygon(0 0, 65% 0, 100% 44%, 100% 100%, 0 100%); }'));
  assert.ok(html.includes('.slot-melchior, .slot-melchior > .inner { clip-path: polygon(35% 0, 100% 0, 100% 100%, 0 100%, 0 44%); }'));
});

test('dissent raises the alert header, a clean run does not', () => {
  assert.ok(renderHtml(report()).includes('CODE:601'), 'dissent is an alert');
  assert.ok(
    renderHtml(report({ result: tally(votes('APPROVE', 'APPROVE', 'APPROVE')) })).includes('CODE:127'),
    'a clean unanimous run is routine',
  );
});

test('the page is standalone: no network references', () => {
  const html = renderHtml(report());

  assert.ok(!/src\s*=\s*["']https?:/i.test(html), 'no remote scripts or images');
  assert.ok(!/href\s*=\s*["']https?:/i.test(html), 'no remote stylesheets');
  assert.ok(!/\bfetch\s*\(/.test(html), 'no fetch calls');
});

test('the embedded cue definitions match the ones the terminal plays', async () => {
  const { CUES } = await import('../lib/sound.mjs');
  const html = renderHtml(report());
  const json = /const PLAN = ([\s\S]*?);\n/.exec(html)[1];
  const plan = JSON.parse(json.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>'));

  assert.deepEqual(Object.keys(plan.cues).sort(), Object.keys(CUES).sort());
  assert.deepEqual(plan.cues.klaxon, CUES.klaxon, 'the page klaxon is the terminal klaxon');
});

test('findings without a file still render (architecture calls have no line numbers)', () => {
  const result = tally([
    {
      agent: 'MELCHIOR-1',
      verdict: 'APPROVE',
      headline: 'ok',
      findings: [{ severity: 'note', summary: 'Postgres gives us real transactions.' }],
    },
    { agent: 'BALTHASAR-2', verdict: 'APPROVE', headline: 'ok', findings: [] },
    { agent: 'CASPER-3', verdict: 'APPROVE', headline: 'ok', findings: [] },
  ]);
  const html = renderHtml(report({ result }));

  assert.ok(html.includes('Postgres gives us real transactions.'));
  assert.ok(!html.includes('class="where"></code>'), 'no empty location element');
});
