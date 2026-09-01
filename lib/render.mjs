/**
 * Renders a tallied MAGI deliberation into a single self-contained HTML page.
 *
 * The chrome follows the NERV terminal closely: a black panel inside an orange
 * frame, 質問 / 解決 headers in stretched kanji flanked by rules, a CODE block
 * of file metadata, a status box, and the three units as clipped polygons in a
 * triangle joined by angled orange connectors around a centre marked MAGI.
 * Panel geometry, palette and the flicker cadence match the reference
 * implementation at github.com/TomaszRewak/MAGI, which reproduces the display
 * from the series.
 *
 * No external assets, no network calls, no dependencies. Cue definitions are
 * the same ones `sound.mjs` uses, re-synthesized with the Web Audio API, so
 * the terminal and the page sound identical.
 */

import { CUES, TIMING, cueDuration, verdictCue } from './sound.mjs';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for interpolation into HTML markup. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * Serialize data for embedding inside a <script> tag. `<` and `>` are escaped
 * so a `</script>` inside a diff or a finding cannot break out of the tag.
 */
export function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const UNIT_META = {
  'BALTHASAR-2': { display: 'BALTHASAR • 2', persona: 'MOTHER', lens: 'SAFETY / HARM', slot: 'balthasar' },
  'CASPER-3': { display: 'CASPER • 3', persona: 'WOMAN', lens: 'PRAGMATICS', slot: 'casper' },
  'MELCHIOR-1': { display: 'MELCHIOR • 1', persona: 'SCIENTIST', lens: 'LOGIC / DATA', slot: 'melchior' },
};

/** Drawing order is the triangle, not the canonical vote order. */
const DRAW_ORDER = ['BALTHASAR-2', 'CASPER-3', 'MELCHIOR-1'];

const VERDICT_META = {
  APPROVE: { jp: '肯定', en: 'AFFIRMATIVE', tone: 'approve' },
  REJECT: { jp: '否定', en: 'NEGATIVE', tone: 'reject' },
  ABSTAIN: { jp: '保留', en: 'WITHHELD', tone: 'abstain' },
};

function findingHtml(finding) {
  const severity = String(finding?.severity ?? 'note').toLowerCase();
  const where = [finding?.file, finding?.line].filter(Boolean).join(':');

  return `
      <li class="finding sev-${escapeHtml(severity)}">
        <span class="sev">${escapeHtml(severity)}</span>
        ${where ? `<code class="where">${escapeHtml(where)}</code>` : ''}
        <span class="what">${escapeHtml(finding?.summary ?? '')}</span>
      </li>`;
}

function panelHtml(vote, isDissenter) {
  const meta = UNIT_META[vote.agent];
  const verdict = VERDICT_META[vote.verdict];

  return `
      <div class="panel slot-${meta.slot} wise-man" data-agent="${escapeHtml(vote.agent)}"
           data-tone="${verdict.tone}"${isDissenter ? ' data-dissent="true"' : ''}>
        <div class="inner">
          <span class="unit">${escapeHtml(meta.display)}</span>
          <span class="glyph"><b class="jp">審議中</b><i class="en">DELIBERATING</i></span>
        </div>
      </div>`;
}

function reasoningHtml(vote) {
  const meta = UNIT_META[vote.agent];
  const verdict = VERDICT_META[vote.verdict];
  const findings = vote.findings ?? [];

  return `
      <article class="reasoning" data-tone="${verdict.tone}">
        <header>
          <span class="r-unit">${escapeHtml(meta.display)}</span>
          <span class="r-lens">${escapeHtml(meta.lens)}</span>
          <span class="r-verdict">${escapeHtml(verdict.jp)} · ${escapeHtml(verdict.en)}</span>
        </header>
        <p class="headline">${escapeHtml(vote.headline)}</p>
        ${findings.length ? `<ul class="findings">${findings.map(findingHtml).join('')}</ul>` : ''}
      </article>`;
}

/**
 * @param {{proposition: string, target?: string, timestamp?: string, result: object}} report
 * @returns {string} a complete HTML document
 */
export function renderHtml(report) {
  const { result } = report;
  const dissent = new Set(result.dissenters);
  const timestamp = report.timestamp ?? new Date().toISOString().replace('T', ' ').slice(0, 19);
  const alert = result.dissenters.length > 0 || result.decision === 'REJECTED';

  const votesByAgent = new Map(result.votes.map((v) => [v.agent, v]));
  const drawn = DRAW_ORDER.map((agent) => votesByAgent.get(agent)).filter(Boolean);

  const plan = {
    cues: CUES,
    order: drawn.map((v) => ({
      agent: v.agent,
      tone: VERDICT_META[v.verdict].tone,
      jp: VERDICT_META[v.verdict].jp,
      en: VERDICT_META[v.verdict].en,
      dissent: dissent.has(v.agent),
    })),
    approved: result.decision === 'APPROVED',
    verdictCue: verdictCue(result.decision),
    dissent: result.dissenters.length > 0,
    label: result.label,
    timing: TIMING,
    // Cue lengths, so the page holds each tone for exactly as long as it sounds.
    durations: Object.fromEntries(Object.keys(CUES).map((c) => [c, cueDuration(c)])),
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MAGI — ${escapeHtml(result.label)} ${escapeHtml(result.decision)}</title>
<style>
  :root {
    --orange: #ff8d00;
    --yes: #52e691;
    --no: #a41413;
    --info: #3caee0;
    --rule: #277547;
    --mono: 'Lucida Console', 'Courier New', ui-monospace, monospace;
    --sans: Helvetica, Arial, sans-serif;
  }

  * { box-sizing: border-box; }

  html {
    /* Diagonal hatch behind the console, as in the reference. */
    background: repeating-linear-gradient(45deg, #000 0px, #000 20px, #140b02 20px, #140b02 40px);
    min-height: 100vh;
  }

  body { margin: 15px; color: var(--orange); font-family: var(--mono); }

  .system {
    background: #000; border: 2px solid var(--orange); padding: 15px;
    max-width: 1200px; margin: 0 auto; position: relative;
  }

  /* ---------- gate ---------- */
  #gate {
    position: fixed; inset: 0; z-index: 90; background: #000;
    display: grid; place-content: center; justify-items: center; gap: 20px;
    text-align: center; padding: 24px;
  }
  #gate.done { animation: gateOut .4s ease forwards; pointer-events: none; }
  @keyframes gateOut { to { opacity: 0; visibility: hidden; } }

  .sigil { width: 116px; height: 102px; animation: pulse 2.2s ease-in-out infinite; }
  .sigil path { fill: var(--no); }
  @keyframes pulse { 0%,100% { opacity: .9 } 50% { opacity: .3 } }

  .gate-title { margin: 0; font-size: clamp(30px, 7vw, 54px); font-weight: 700; letter-spacing: .34em; }
  .gate-sub { margin: 0; font-size: 11px; letter-spacing: .3em; color: #7a4a00; }
  .gate-prop {
    max-width: 60ch; margin: 0; padding-left: 14px; text-align: left;
    border-left: 3px solid var(--no); color: #e8e8e8;
    font-size: 15px; line-height: 1.7;
  }
  #begin {
    font-family: var(--mono); font-weight: 700; font-size: 16px; letter-spacing: .3em;
    padding: 14px 36px; cursor: pointer; color: #000; background: var(--orange); border: none;
  }
  #begin:hover { box-shadow: 0 0 30px rgba(255,141,0,.7); }
  #begin:focus-visible { outline: 2px solid #fff; outline-offset: 4px; }

  /* ---------- the console ---------- */
  .magi {
    display: grid;
    grid-template-columns:
      [left-header-start] 20px
      [casper-start status] 2fr
      [left-header-end balthasar-start casper-balthasar-connection] 0.5fr
      [casper-end title casper-melchior-connection] 1fr
      [balthasar-melchior-connection melchior-start] 0.5fr
      [right-header-start balthasar-end response] 2fr
      [melchior-end] 20px
      [right-header-end];
    grid-template-rows:
      20px
      [header balthasar-start] 2fr
      [status response] 2fr
      [casper-start melchior-start casper-balthasar-connection balthasar-melchior-connection] 1fr
      [balthasar-end title casper-melchior-connection] 3fr
      [casper-end melchior-end] 20px;
    aspect-ratio: 2 / 1;
    container-type: size;
    border: 2px solid var(--orange);
  }

  .magi > .title {
    grid-area: title / title;
    color: var(--orange); text-align: center;
    font-size: 9cqh; font-weight: 700; font-family: var(--sans); font-style: italic;
  }

  .magi > .header { overflow: hidden; }
  .magi > .header > hr { border: 2px solid var(--rule); height: 4px; margin: 2px; }
  .magi > .header > span {
    color: var(--orange); font-size: 10cqh; font-weight: 700;
    display: flex; justify-content: center; transform: scaleX(2);
  }
  .magi > .header.left { grid-area: header / left-header-start / auto / left-header-end; }
  .magi > .header.right { grid-area: header / right-header-start / auto / right-header-end; }

  /* The status block shares its row with BALTHASAR's panel, so it must stay
     inside its own column rather than running under it. */
  .magi > .system-status { grid-area: status; color: var(--orange); overflow: hidden; }
  .magi > .system-status > div {
    font-size: 3cqh; margin-left: 4cqw; transform: scaleX(1.2); transform-origin: left;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80%;
  }
  .magi > .system-status > div:first-child { font-size: 6cqh; margin-left: 0; }

  .magi > .response {
    grid-area: response; justify-self: flex-end; align-self: center;
    border: solid 2px; padding: 2px; color: var(--info);
  }
  .magi > .response > .inner {
    white-space: nowrap; border: solid 2px; padding: 2px 10px;
    font-size: 8cqh; font-weight: 700;
  }
  .magi > .response.approved { color: var(--yes); }
  .magi > .response.rejected { color: var(--no); }

  /* Each unit: an orange plate with the status-coloured face clipped inside. */
  .wise-man { display: flex; background: var(--orange); padding: 2px; }
  .wise-man > .inner {
    width: 100%; height: 100%; background: #000;
    font-family: var(--sans); font-weight: 700;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .4cqh;
    color: var(--orange);
  }
  .wise-man .unit { font-size: 7cqh; }
  .wise-man .glyph { display: flex; flex-direction: column; align-items: center; }
  .wise-man .jp { font-size: 6cqh; letter-spacing: .1em; }
  .wise-man .en { font-size: 2.2cqh; font-style: normal; letter-spacing: .22em; opacity: .85; }

  .slot-melchior { grid-area: melchior-start / melchior-start / melchior-end / melchior-end; }
  .slot-melchior, .slot-melchior > .inner { clip-path: polygon(35% 0, 100% 0, 100% 100%, 0 100%, 0 44%); }

  .slot-balthasar { grid-area: balthasar-start / balthasar-start / balthasar-end / balthasar-end; }
  .slot-balthasar, .slot-balthasar > .inner { clip-path: polygon(0 0, 100% 0, 100% 80%, 75% 100%, 25% 100%, 0 80%); }

  .slot-casper { grid-area: casper-start / casper-start / casper-end / casper-end; }
  .slot-casper, .slot-casper > .inner { clip-path: polygon(0 0, 65% 0, 100% 44%, 100% 100%, 0 100%); }

  /* A resolved unit fills solid, lettering knocked out in black. */
  .panel[data-state="done"] > .inner { color: #000; }
  .panel[data-state="done"][data-tone="approve"] > .inner { background: var(--yes); }
  .panel[data-state="done"][data-tone="reject"] > .inner { background: var(--no); color: #fff; }
  .panel[data-state="done"][data-tone="abstain"] > .inner {
    background: repeating-linear-gradient(56deg, #52e691 0px, #52e691 30px, #82cd68 30px, #82cd68 60px);
  }

  /* Blink is driven from JS on the measured gate period, so all three panels
     stay in step with each other and with the pulse train. */
  .panel[data-state="thinking"].blink > .inner { background: #000; color: #000; }

  @keyframes dissent-animation { 0% {} 50% { background: #000; color: #000; } }
  .panel[data-state="done"][data-dissent="true"] > .inner { animation: dissent-animation .33s step-end 10; }

  .connection { height: 10px; background: var(--orange); align-self: center; margin: -10%; }
  .connection.casper-balthasar { grid-area: casper-balthasar-connection; transform: rotate(-54deg); }
  .connection.casper-melchior { grid-area: casper-melchior-connection; }
  .connection.balthasar-melchior { grid-area: balthasar-melchior-connection; transform: rotate(54deg); }

  /* ---------- verdict + reasoning ---------- */
  #verdict {
    margin-top: 15px; padding: 20px; text-align: center;
    border: 2px solid var(--orange); opacity: 0; transition: opacity .35s ease;
  }
  #verdict.live { opacity: 1; }
  #verdict .big { font-size: clamp(52px, 13vw, 116px); line-height: 1; font-weight: 700; letter-spacing: .12em; }
  #verdict .roman { font-size: 13px; letter-spacing: .42em; margin-top: 10px; }
  #verdict .count { font-size: 11px; letter-spacing: .22em; margin-top: 8px; opacity: .8; }
  #verdict.approved { border-color: var(--yes); color: var(--yes); }
  #verdict.rejected { border-color: var(--no); color: #ff5b5b; }
  #verdict.live .big { animation: stamp .45s ease; }
  @keyframes stamp { from { transform: scale(1.6); opacity: 0; } }

  #alarm { position: fixed; inset: 0; z-index: 80; pointer-events: none; background: rgba(164,20,19,.35); opacity: 0; }
  #alarm.on { animation: klaxon .66s steps(1) 5; }
  @keyframes klaxon { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }

  .report { margin-top: 15px; display: grid; gap: 12px; }
  .reasoning { border: 2px solid #4a2a00; border-left-width: 5px; padding: 12px 14px; }
  .reasoning[data-tone="approve"] { border-left-color: var(--yes); }
  .reasoning[data-tone="reject"] { border-left-color: var(--no); }
  .reasoning[data-tone="abstain"] { border-left-color: var(--orange); }
  .reasoning header { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: baseline; margin-bottom: 8px; }
  .r-unit { font-size: 14px; font-weight: 700; }
  .r-lens { font-size: 9px; letter-spacing: .22em; opacity: .6; }
  .r-verdict { margin-left: auto; font-size: 11px; letter-spacing: .16em; }
  .headline { margin: 0; color: #e8e8e8; font-size: 14px; line-height: 1.65; }
  .findings { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
  .finding { font-size: 12.5px; line-height: 1.6; color: #cfcfcf; border-top: 1px solid #3a2000; padding-top: 8px; }
  .sev { display: inline-block; font-weight: 700; font-size: 9px; letter-spacing: .18em; padding: 1px 6px; margin-right: 7px; border: 1px solid currentColor; }
  .sev-critical .sev { color: #ff5b5b; }
  .sev-major .sev { color: var(--orange); }
  .sev-minor .sev, .sev-note .sev { color: #8a8a8a; }
  .where { color: var(--orange); margin-right: 7px; word-break: break-all; }

  .proposition { margin: 15px 0 0; padding: 10px 14px; border-left: 4px solid var(--no); background: #140b02; color: #e8e8e8; font-size: 14px; line-height: 1.7; }
  .proposition .lbl { display: block; color: var(--orange); font-size: 10px; letter-spacing: .3em; margin-bottom: 6px; }

  .replay { display: block; margin: 15px auto 0; font-family: var(--mono); font-size: 11px; letter-spacing: .24em; padding: 9px 24px; cursor: pointer; background: #1f1203; color: var(--orange); border: 2px solid var(--orange); }
  .replay:hover { background: #2f1c05; }

  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
</style>
</head>
<body>

<div id="gate">
  <svg class="sigil" viewBox="0 0 100 88" aria-hidden="true">
    <path d="M50 0 L100 88 L0 88 Z M50 20 L82 76 L18 76 Z"/>
    <path d="M50 26 L74 70 L26 70 Z"/>
  </svg>
  <h1 class="gate-title">MAGI</h1>
  <p class="gate-sub">NERV · CENTRAL DOGMA · DELIBERATION TERMINAL</p>
  <p class="gate-prop">${escapeHtml(report.proposition)}</p>
  <button id="begin" type="button">審議開始 · BEGIN</button>
</div>

<div id="alarm"></div>

<div class="system">
  <div class="magi">
    <div class="header left"><hr><hr><span>質問</span><hr><hr></div>
    <div class="header right"><hr><hr><span>解決</span><hr><hr></div>

    <div class="system-status">
      <div>CODE:${alert ? '601' : '127'}</div>
      <div>FILE:${escapeHtml(report.target ?? 'MAGI_SYS')}</div>
      <div>EXTENTION:0256</div>
      <div>EX_MODE:ON</div>
      <div>PRIORITY:AAA</div>
    </div>

    <div class="response" id="response"><div class="inner">情報</div></div>

    <div class="connection casper-balthasar"></div>
    <div class="connection casper-melchior"></div>
    <div class="connection balthasar-melchior"></div>

    ${drawn.map((v) => panelHtml(v, dissent.has(v.agent))).join('')}

    <div class="title">MAGI</div>
  </div>

  <p class="proposition">
    <span class="lbl">議題 · PROPOSITION</span>
    ${escapeHtml(report.proposition)}
  </p>

  <div id="verdict" class="${result.decision.toLowerCase()}">
    <div class="big">${escapeHtml(result.label)}</div>
    <div class="roman">${escapeHtml(result.decision)}${result.deadlocked ? ' · DEADLOCK · FAILED CLOSED' : ''}</div>
    <div class="count">${escapeHtml(result.tallyText)}${
      result.dissenters.length
        ? ` · DISSENT: ${escapeHtml(result.dissenters.join(', '))}`
        : result.unanimous
          ? ' · UNANIMOUS'
          : ''
    } · ${escapeHtml(timestamp)}</div>
  </div>

  <div class="report">
    ${result.votes.map(reasoningHtml).join('')}
  </div>

  <button class="replay" type="button" id="replay">再審議 · REPLAY</button>
</div>

<script>
const PLAN = ${embedJson(plan)};

/* ---------- audio: the same cue definitions the terminal uses ---------- */
let ctx = null;
function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/**
 * Render one cue. Mirrors renderTones() in sound.mjs: every partial is a pure
 * sine with a linear attack, a flat hold, and a linear release. No cue in the
 * set decays — both verdicts are sustained so neither outweighs the other.
 *
 * Overlapping notes (agree's two) crossfade on their 6 ms ramps.
 */
function playCue(name) {
  const ac = audio();
  const tones = PLAN.cues[name];
  if (!ac || !tones) return;

  const now = ac.currentTime + 0.02;
  const master = 0.42;

  for (const tone of tones) {
    const start = now + tone.start;
    const dur = tone.dur;
    const attack = tone.attack ?? 0.008;
    const release = tone.release ?? 0.12;
    const level = tone.amp * master;
    const hold = Math.max(start + attack, start + dur - release);

    const osc = ac.createOscillator();
    const amp = ac.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(tone.freq, start);

    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(level, start + attack);
    amp.gain.setValueAtTime(level, hold);
    amp.gain.linearRampToValueAtTime(0, start + dur);

    osc.connect(amp).connect(ac.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }
}

/* ---------- sequence ---------- */
const panels = new Map([...document.querySelectorAll('.panel')].map((p) => [p.dataset.agent, p]));
const verdictEl = document.getElementById('verdict');
const alarmEl = document.getElementById('alarm');
const responseEl = document.getElementById('response');
const timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, ms));

/** Blink every panel still deliberating, in step with the pulse train. */
function setBlink(on) {
  for (const panel of panels.values()) {
    if (panel.getAttribute('data-state') === 'thinking') {
      panel.classList.toggle('blink', on);
    }
  }
}

function reset() {
  timers.splice(0).forEach(clearTimeout);
  for (const p of panels.values()) {
    p.removeAttribute('data-state');
    p.classList.remove('blink');
    p.querySelector('.jp').textContent = '審議中';
    p.querySelector('.en').textContent = 'DELIBERATING';
  }
  verdictEl.classList.remove('live');
  alarmEl.classList.remove('on');
  responseEl.className = 'response';
  responseEl.querySelector('.inner').textContent = '情報';
}

function run() {
  reset();
  playCue('boot');

  const T = PLAN.timing;
  const period = T.gatePeriod * 1000;
  const on = T.gateOn * 1000;
  const cycle = T.thinkCycle * 1000;
  const gap = T.silenceBeforeVerdict * 1000;
  const CYCLES = 4;

  // 1. All three units come online together — the console deliberates as one.
  for (const panel of panels.values()) panel.setAttribute('data-state', 'thinking');

  // 2. Deliberation: the pulse train loops on its own 442 ms period and every
  //    panel blinks with it, in step. Always cut on a period boundary.
  const thinkFrom = 400;
  for (let c = 0; c < CYCLES; c++) later(() => playCue('think'), thinkFrom + c * cycle);

  for (let p = 0; p < CYCLES * T.pulses; p++) {
    const at = thinkFrom + p * period;
    later(() => setBlink(false), at);
    later(() => setBlink(true), at + on);
  }

  // 3. All three answer at once, 1.436 s after the last cycle's first pulse
  //    onset, and the single verdict tone lands with them.
  const verdictAt = thinkFrom + (CYCLES - 1) * cycle + T.verdictAfterThinkOnset * 1000;

  later(() => {
    setBlink(false);
    for (const step of PLAN.order) {
      const panel = panels.get(step.agent);
      panel.setAttribute('data-state', 'done');
      panel.querySelector('.jp').textContent = step.jp;
      panel.querySelector('.en').textContent = step.en;
    }

    playCue(PLAN.verdictCue);
    responseEl.className = 'response ' + (PLAN.approved ? 'approved' : 'rejected');
    responseEl.querySelector('.inner').textContent = PLAN.label;
    verdictEl.classList.add('live');
    verdictEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, verdictAt);

  // 4. Dissent raises the alarm, after the verdict has been stated.
  if (PLAN.dissent) {
    later(() => {
      alarmEl.classList.remove('on');
      void alarmEl.offsetWidth; // restart the flash
      alarmEl.classList.add('on');
      playCue('klaxon');
    }, verdictAt + PLAN.durations[PLAN.verdictCue] * 1000 + gap);
  }
}

document.getElementById('begin').addEventListener('click', () => {
  audio();
  document.getElementById('gate').classList.add('done');
  run();
});

document.getElementById('replay').addEventListener('click', () => {
  audio();
  run();
  document.querySelector('.magi').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
</script>
</body>
</html>
`;
}
