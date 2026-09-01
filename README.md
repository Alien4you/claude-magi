# MAGI

A Claude Code plugin. Three agents review a code change or an architecture
decision independently, then vote. Majority carries. Dissent raises the alarm.

Modelled on the MAGI supercomputers from *Neon Genesis Evangelion*: three
copies of one person's judgement, split along different axes, forced to agree.

```
▰▰▰ 定期検診 ▰▰▰   CODE:601   【 警告 · ALERT 】

                           ╭────────────────────────╮
                           │      BALTHASAR·2       │
                           │          肯定          │
                           ╰────────────────────────╯
                                        │
                                   ╴M A G I╶
                 ┌──────────────────────┴──────────────────────┐
    ╭────────────────────────╮                    ╭────────────────────────╮
    │        CASPER·3        │                    │       MELCHIOR·1       │
    │          否定          │                    │          肯定          │
    │      ▲ DISSENT ▲       │                    │       SCIENTIST        │
    ╰────────────────────────╯                    ╰────────────────────────╯

可決 / APPROVED (2-1) — CASPER-3 dissents
```

## The three units

| Unit | Persona | Judges |
|------|---------|--------|
| **MELCHIOR-1** | the scientist | correctness — logic, data, edge cases |
| **BALTHASAR-2** | the mother | safety — security, data loss, blast radius |
| **CASPER-3** | the woman | pragmatics — operability, maintenance, cost |

They run in parallel with no shared context, so none can see another's
reasoning. That independence is what makes a 2-1 split mean something.

On screen the console deliberates as one: all three units come online together,
blink in step with the pulse train for about five seconds, then answer at the
same instant. One tone sounds on the collective verdict — units are never
sounded individually, as in the source.

**Majority carries.** Abstentions count toward neither side. A deadlock fails
closed to 否決 — an undecided MAGI never green-lights anything.

## Install

```bash
claude --plugin-dir ~/Documents/Projects/claude-magi
```

Then `/magi`. Run `/reload-plugins` after editing anything.

To load it every session without the flag, see
[skills-directory plugins](https://code.claude.com/docs/en/plugins-reference#skills-directory-plugins).

## Use

```
/magi                          # the uncommitted diff
/magi staged                   # git diff --cached
/magi src/auth/                # a path
/magi 412                      # a GitHub PR
/magi branch                   # this branch vs main
/magi Should we move off MySQL onto Postgres before the migration?
```

Anything that is not a path, a number, or a known keyword is treated as a
decision to vote on. It reviews; it never edits.

## Output modes

Append a flag, or set `MAGI_OUTPUT`:

| Mode | What you get |
|------|--------------|
| `chat` (default) | the board rendered inline — static, no sound |
| `tty` | full animation and audio, run in a real terminal |
| `html` | a self-contained page, opened in your browser |

Chat output is static markdown, so motion and audio are only available in
`tty` and `html`.

## The binaries

```bash
magi-deliberate verdict.json          # terminal animation
magi-deliberate --demo                # worked example
magi-render verdict.json              # HTML page, opens it
magi-cues list                        # sound cue status
```

`magi-deliberate` flags: `--silent`, `--no-animate`, `--speed <n>`,
`--sounds <dir>`. Both binaries exit `0` on 可決, `1` on 否決, so they gate a
script or a hook directly.

The deliberation JSON is the interchange format:

```json
{
  "proposition": "Replace the session cache with Redis",
  "target": "git diff HEAD · 6 files",
  "votes": [
    {
      "agent": "MELCHIOR-1",
      "verdict": "APPROVE",
      "headline": "Eviction path is bounded and the semantics hold.",
      "findings": [
        { "file": "src/cache.ts", "line": 48, "severity": "minor", "summary": "..." }
      ]
    }
  ]
}
```

`file` and `line` are optional, so architecture decisions work the same way.

## Sound

The plugin ships **no audio**. Every cue is synthesized at runtime from
published partial frequencies and envelopes — pure sines summed sample by
sample, wrapped in a WAV header, handed to `afplay` (macOS), `aplay` (Linux) or
PowerShell (Windows). The browser rebuilds the same cue data with Web Audio.

Two voices are **measured**: their partials were recovered by narrowband
tone-prominence matching against the original broadcast audio.

| cue | provenance | partials (Hz) |
|-----|-----------|---------------|
| `think` | measured | 1705, 3410, 5115 — gated, 442 ms period, 277 ms on |
| `reject` | measured | 1266, 2531 — sustained, 1.24 s |
| `agree` | derived | 1688 → 2531, a rising fifth on reject's second partial, sustained |
| `klaxon` | derived | 1266 alternating with 1705 |
| `boot`, `tick` | derived | built from the same partials |

The source contains no second console tone, so `agree` is designed rather than
found — that distinction is recorded per cue in `lib/sound.mjs` and asserted by
the tests. It runs the same 1.24 s as the rejection and its second note is
*held*, not decayed, so the two verdicts land within 0.4 dB RMS of each other:
the rising figure carries the difference in meaning, not loudness. If you add a
cue, build it from the measured partials and label it derived.

**One deliberate divergence from the source.** On screen the 1266 Hz tone fires
on ALL GREEN / 終了 — it is the episode's *all-clear*, the moment all three
units agree, not a refusal. The matched scene is a routine diagnostic that
passes, and no rejection cue exists in the episode at all. This project assigns
that tone to `reject` by decision: the sound is authentic, the label is
reassigned on purpose. To follow the source instead, swap the two cue names —
nothing else changes.

Playback follows the scene: `think` loops on its 442 ms period (three pulses,
1.326 s), then 0.275 s of silence, then the verdict — 1.436 s from the first
pulse onset, matching `think` at 02:10.219 and `reject` at 02:11.655. The two
never overlap. `TIMING` in `lib/sound.mjs` is the single source for both
renderers.

Parameters are measurements, not copied audio, so the synthesized voices carry
no sampled material. Tests verify the rendered output against the published FFT
table with a DFT over each cue.

To use your own recordings instead, drop them in `sounds/` named after the cue
(`klaxon.wav`, `agree.mp3`, …). See [`sounds/README.md`](sounds/README.md).
`magi-cues extract` cuts clips out of a media file you already have:

```bash
magi-cues extract --from ~/media/episode.mkv --cue klaxon --at 00:04:12.0 --dur 2.5
magi-cues play klaxon
```

Anything in `sounds/` is git-ignored. It is yours and is not part of this
project.

## Development

```bash
npm test        # 72 tests, no dependencies
npm run demo
```

Everything runs on the Node standard library. `lib/verdict.mjs`,
`lib/frames.mjs` and `lib/render.mjs` are pure functions, which is where the
tests concentrate — including that untrusted text from a diff cannot inject
terminal escapes or break out of a `<script>` tag.

## Credits

Display geometry, palette and flicker cadence are derived from
[TomaszRewak/MAGI](https://github.com/TomaszRewak/MAGI) (MIT, © 2023 Tomasz
Rewak), which reproduces the NERV terminal from the series. See
[NOTICE](NOTICE).

*Neon Genesis Evangelion* © GAINAX / khara. Fan project, unaffiliated.
Code: Apache License 2.0 — see [LICENSE](LICENSE).
