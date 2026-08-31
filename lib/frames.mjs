/**
 * Pure frame composition for the MAGI display.
 *
 * Layout follows the NERV terminal from the series: three units arranged in a
 * triangle — BALTHASAR·2 above, CASPER·3 lower left, MELCHIOR·1 lower right —
 * joined by a bus that meets at a centre marked MAGI. A unit that has returned
 * its verdict is drawn as a solid colour-filled block with knocked-out black
 * lettering, the way the show fills them green.
 *
 * Every function here is a string transform: no I/O, no timers, no cursor
 * control. `animate.mjs` owns the clock and the terminal.
 */

export const STATES = {
  IDLE: 'idle',
  THINKING: 'thinking',
  APPROVE: 'approve',
  REJECT: 'reject',
  ABSTAIN: 'abstain',
};

/** Drawn order is the triangle, not the canonical vote order. */
const UNITS = [
  { agent: 'BALTHASAR-2', display: 'BALTHASAR·2', persona: 'MOTHER' },
  { agent: 'CASPER-3', display: 'CASPER·3', persona: 'WOMAN' },
  { agent: 'MELCHIOR-1', display: 'MELCHIOR·1', persona: 'SCIENTIST' },
];

const STATE_GLYPH = {
  [STATES.IDLE]: { jp: '待機', en: 'STANDBY' },
  [STATES.THINKING]: { jp: '審議中', en: 'DELIBERATING' },
  [STATES.APPROVE]: { jp: '肯定', en: 'AFFIRMATIVE' },
  [STATES.REJECT]: { jp: '否定', en: 'NEGATIVE' },
  [STATES.ABSTAIN]: { jp: '保留', en: 'WITHHELD' },
};

const C = {
  amber: '\x1b[38;5;208m',
  amberDim: '\x1b[38;5;130m',
  red: '\x1b[38;5;196m',
  green: '\x1b[38;5;48m',
  dim: '\x1b[38;5;240m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
  // Solid fills with black lettering, as the show draws a resolved unit.
  fillGreen: '\x1b[48;5;48m\x1b[38;5;16m',
  fillRed: '\x1b[48;5;196m\x1b[38;5;16m',
  fillAmber: '\x1b[48;5;208m\x1b[38;5;16m',
  fillIdle: '\x1b[48;5;236m\x1b[38;5;245m',
};

const FILL_FOR = {
  [STATES.IDLE]: C.fillIdle,
  [STATES.THINKING]: C.fillIdle,
  [STATES.APPROVE]: C.fillGreen,
  [STATES.REJECT]: C.fillRed,
  [STATES.ABSTAIN]: C.fillAmber,
};

const EDGE_FOR = {
  [STATES.IDLE]: C.dim,
  [STATES.THINKING]: C.amber,
  [STATES.APPROVE]: C.green,
  [STATES.REJECT]: C.red,
  [STATES.ABSTAIN]: C.amber,
};

/**
 * Strip anything that could move the cursor or repaint the screen.
 *
 * Headlines and findings are written by agents that read arbitrary source
 * code, so this text is untrusted: a diff containing `\x1b[2J` must not be
 * able to clear the user's terminal. Tabs become spaces; everything else in
 * the C0/C1 control ranges is dropped.
 */
export function sanitize(value) {
  return String(value ?? '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b./g, '')
    .replace(/\t/g, ' ')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

/** Terminal cell width: CJK and fullwidth forms occupy two columns. */
export function cells(text) {
  let n = 0;
  for (const ch of text) n += isWide(ch) ? 2 : 1;
  return n;
}

function isWide(ch) {
  const cp = ch.codePointAt(0);
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6)
  );
}

/** Greedy word wrap that hard-breaks words longer than the limit. */
export function wrap(text, limit) {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  const push = () => {
    if (line) lines.push(line);
    line = '';
  };

  for (let word of words) {
    while (cells(word) > limit) {
      push();
      let head = '';
      for (const ch of word) {
        if (cells(head + ch) > limit) break;
        head += ch;
      }
      lines.push(head);
      word = word.slice(head.length);
    }
    if (!line) line = word;
    else if (cells(`${line} ${word}`) <= limit) line += ` ${word}`;
    else {
      push();
      line = word;
    }
  }
  push();

  return lines.length ? lines : [''];
}

const padEnd = (text, width) => text + ' '.repeat(Math.max(0, width - cells(text)));

const centre = (text, width) => {
  const gap = Math.max(0, width - cells(text));
  const left = Math.floor(gap / 2);
  return ' '.repeat(left) + text + ' '.repeat(gap - left);
};

/**
 * A mutable character grid. The triangle bus and the panels overlap in
 * position, so it is far simpler to plot into a grid than to concatenate rows.
 */
class Grid {
  /**
   * Occupies the second column of a double-width glyph; never rendered.
   * NUL, because sanitize() strips it from any text reaching the grid, so it
   * can never collide with real content.
   */
  static CONTINUATION = '\u0000';

  constructor(width, height) {
    this.width = width;
    this.rows = Array.from({ length: height }, () => Array(width).fill(' '));
    // Style runs, applied at render time: { row, from, to, code }.
    this.styles = [];
  }

  /**
   * Plot `str` at a *column* (not a character index). A double-width glyph
   * claims two columns: the second holds a marker that renders as nothing, so
   * everything to the right of it stays aligned.
   */
  text(row, col, str, code) {
    if (row < 0 || row >= this.rows.length) return;

    let c = col;
    for (const ch of str) {
      if (c >= 0 && c < this.width) this.rows[row][c] = ch;
      if (isWide(ch)) {
        if (c + 1 >= 0 && c + 1 < this.width) this.rows[row][c + 1] = Grid.CONTINUATION;
        c += 2;
      } else {
        c += 1;
      }
    }
    if (code) this.styles.push({ row, from: col, to: c, code });
  }

  render(color) {
    const join = (cellsSlice) => cellsSlice.filter((c) => c !== Grid.CONTINUATION).join('');

    return this.rows
      .map((row, y) => {
        if (!color) return join(row).replace(/\s+$/, '');

        const runs = this.styles.filter((s) => s.row === y).sort((a, b) => a.from - b.from);
        if (!runs.length) return join(row).replace(/\s+$/, '');

        let out = '';
        let cursor = 0;
        for (const run of runs) {
          const from = Math.max(run.from, cursor);
          const to = Math.min(run.to, row.length);
          if (to <= from) continue;
          out += join(row.slice(cursor, from));
          out += run.code + join(row.slice(from, to)) + C.reset;
          cursor = to;
        }
        return (out + join(row.slice(cursor))).replace(/\s+$/, '');
      })
      .join('\n');
  }
}

const PANEL_W = 26;
const PANEL_H = 6;

/** Plot one unit's block at (row, col). */
function plotPanel(grid, { row, col, unit, state, isDissenter, blink }) {
  const inner = PANEL_W - 2;
  const glyph = STATE_GLYPH[state] ?? STATE_GLYPH[STATES.IDLE];
  const resolved = state !== STATES.IDLE && state !== STATES.THINKING;
  const edge = EDGE_FOR[state] ?? C.dim;
  const fill = FILL_FOR[state] ?? C.fillIdle;

  const hidden = blink && state === STATES.THINKING;
  const jp = hidden ? '' : glyph.jp;
  const en = hidden ? '' : glyph.en;

  // Cut corners echo the angled polygons on the NERV display.
  grid.text(row, col, '╭' + '─'.repeat(inner) + '╮', edge);
  grid.text(row + PANEL_H - 1, col, '╰' + '─'.repeat(inner) + '╯', edge);

  const body = [
    centre(unit.display, inner),
    centre(jp, inner),
    centre(en, inner),
    centre(isDissenter && resolved ? '▲ DISSENT ▲' : unit.persona, inner),
  ];

  for (let i = 0; i < body.length; i++) {
    const r = row + 1 + i;
    grid.text(r, col, '│', edge);
    grid.text(r, col + PANEL_W - 1, '│', edge);
    // A resolved unit is a solid block: fill the interior, knock the text out.
    grid.text(r, col + 1, body[i], resolved ? fill : i === 1 ? edge + C.bold : C.dim);
  }
}

/** The bus joining the three units, meeting at a centre marked MAGI. */
function plotBus(grid, { topRow, topCentre, leftCentre, rightCentre, busRow, color }) {
  const code = C.amberDim;

  grid.text(topRow, topCentre, '┬', code);
  grid.text(topRow + 1, topCentre, '│', code);

  const magi = 'M A G I';
  grid.text(topRow + 2, topCentre - Math.floor(magi.length / 2) - 2, `╴${magi}╶`, C.amber + C.bold);
  grid.text(topRow + 3, topCentre, '│', code);

  const left = Math.min(leftCentre, topCentre);
  const right = Math.max(rightCentre, topCentre);
  grid.text(busRow, left, '┌' + '─'.repeat(right - left - 1) + '┐', code);
  grid.text(busRow, topCentre, '┴', code);
  grid.text(busRow + 1, leftCentre, '│', code);
  grid.text(busRow + 1, rightCentre, '│', code);
}

function headerLines({ result, target, timestamp, showVerdict, color }) {
  const paint = (t, code) => (color ? code + t + C.reset : t);
  const alert = showVerdict && (result.dissenters.length > 0 || result.decision === 'REJECTED');

  const code601 = alert ? 'CODE:601' : 'CODE:127';
  const status = !showVerdict
    ? { jp: '審議', en: 'IN SESSION', tone: C.amber }
    : result.decision === 'APPROVED'
      ? { jp: '終了', en: 'ALL GREEN', tone: C.green }
      : { jp: '警告', en: 'ALERT', tone: C.red };

  return [
    paint('▰▰▰ 定期検診 ▰▰▰', C.amber + C.bold) +
      '   ' +
      paint(code601, C.amber) +
      '   ' +
      paint(`【 ${status.jp} · ${status.en} 】`, status.tone + C.bold),
    paint(`FILE      : ${sanitize(target)}`, C.dim),
    paint(`EX_MODE   : ON        PRIORITY : A--        ${sanitize(timestamp)}`, C.dim),
  ];
}

/**
 * Compose a complete frame.
 *
 * @param {object} o
 * @param {string} o.proposition
 * @param {string} o.target
 * @param {string} o.timestamp
 * @param {object} o.result       output of `tally()`
 * @param {Record<string,string>} o.states  per-agent STATES value
 * @param {boolean} o.showVerdict
 * @param {boolean} o.color
 * @param {number}  o.width
 * @param {boolean} [o.blink]
 * @returns {string}
 */
export function composeScreen(o) {
  const width = Math.max(72, Math.min(o.width ?? 80, 100));
  const color = Boolean(o.color);
  const paint = (t, code) => (color ? code + t + C.reset : t);
  const dissent = new Set(o.result.dissenters);
  const byAgent = new Map(o.result.votes.map((v) => [v.agent, v]));

  const out = [];
  out.push(...headerLines({ ...o, color }));
  out.push(paint('─'.repeat(width), C.amberDim));
  out.push('');
  out.push(paint('議題 · PROPOSITION', C.amber));
  for (const line of wrap(o.proposition, width - 2)) out.push(`  ${line}`);
  out.push('');

  // Triangle: BALTHASAR·2 centred above, CASPER·3 lower left, MELCHIOR·1
  // lower right, joined through a centre bus.
  const topCol = Math.floor((width - PANEL_W) / 2);
  const leftCol = Math.max(0, topCol - Math.floor(PANEL_W * 0.9));
  const rightCol = Math.min(width - PANEL_W, topCol + Math.floor(PANEL_W * 0.9));

  const busRow = PANEL_H + 4;
  const grid = new Grid(width, busRow + 2 + PANEL_H);

  const place = {
    'BALTHASAR-2': { row: 0, col: topCol },
    'CASPER-3': { row: busRow + 2, col: leftCol },
    'MELCHIOR-1': { row: busRow + 2, col: rightCol },
  };

  for (const unit of UNITS) {
    const at = place[unit.agent];
    const state = o.states?.[unit.agent] ?? STATES.IDLE;
    const resolved = state !== STATES.IDLE && state !== STATES.THINKING;

    plotPanel(grid, {
      ...at,
      unit,
      state,
      isDissenter: resolved && dissent.has(unit.agent),
      blink: Boolean(o.blink),
    });
  }

  plotBus(grid, {
    topRow: PANEL_H,
    topCentre: topCol + Math.floor(PANEL_W / 2),
    leftCentre: leftCol + Math.floor(PANEL_W / 2),
    rightCentre: rightCol + Math.floor(PANEL_W / 2),
    busRow,
    color,
  });

  out.push(grid.render(color));
  out.push('');

  // Each unit's one-line reasoning, once it has resolved.
  for (const vote of o.result.votes) {
    const state = o.states?.[vote.agent] ?? STATES.IDLE;
    if (state === STATES.IDLE || state === STATES.THINKING) continue;

    const tone = state === STATES.APPROVE ? C.green : state === STATES.REJECT ? C.red : C.amber;
    const lines = wrap(vote.headline, width - 16);
    out.push(paint(padEnd(`${vote.agent}`, 14), tone) + (lines[0] ?? ''));
    for (const extra of lines.slice(1)) out.push(' '.repeat(14) + extra);
  }

  if (o.showVerdict) {
    const tone = o.result.decision === 'APPROVED' ? C.green : C.red;
    const note = o.result.deadlocked
      ? 'DEADLOCK · FAILED CLOSED'
      : o.result.dissenters.length
        ? `DISSENT: ${o.result.dissenters.join(', ')}`
        : 'UNANIMOUS';

    const inner = width - 2;
    out.push('');
    out.push(paint('╔' + '═'.repeat(inner) + '╗', tone));
    out.push(
      paint('║', tone) +
        paint(centre(`${o.result.label}   ${o.result.decision}`, inner), tone + C.bold) +
        paint('║', tone),
    );
    out.push(
      paint('║', tone) +
        paint(centre(`${o.result.tallyText}  ·  ${note}`, inner), C.dim) +
        paint('║', tone),
    );
    out.push(paint('╚' + '═'.repeat(inner) + '╝', tone));
  }

  return out.join('\n');
}

/** Everything the units found, listed after the board settles. */
export function findingsReport({ result, width = 80, color = false }) {
  const paint = (t, code) => (color ? code + t + C.reset : t);
  const sev = { critical: C.red, major: C.amber, minor: C.dim, note: C.dim };
  const out = [];

  for (const vote of result.votes) {
    if (!vote.findings?.length) continue;

    out.push('');
    out.push(paint(`${vote.agent} · ${vote.findings.length} finding(s)`, C.amber + C.bold));

    for (const f of vote.findings) {
      const severity = sanitize(f?.severity ?? 'note').toLowerCase();
      const where = [f?.file, f?.line].filter(Boolean).map(sanitize).join(':');
      out.push(paint(`  [${severity}]${where ? ` ${where}` : ''}`, sev[severity] ?? C.dim));
      for (const line of wrap(f?.summary ?? '', width - 6)) out.push(`      ${line}`);
    }
  }

  return out.join('\n');
}
