---
name: magi
description: Convene the MAGI system on a proposition. Three agents independently review a code change or an architecture decision and vote; majority carries and dissent raises the alarm. Use when asked to run MAGI, convene MAGI, or put a change or a decision to a three-way vote.
argument-hint: "[question, path, PR number, or nothing for the current diff]"
---

# MAGI

Three units judge one proposition on three different axes, independently, then
vote. `$ARGUMENTS` decides what is judged.

## 1. Work out the proposition and the target

Match `$ARGUMENTS` against these shapes, in order:

| `$ARGUMENTS` | Mode | Target |
|---|---|---|
| empty | review | `git diff HEAD` — the uncommitted change |
| `staged` | review | `git diff --cached` |
| a number, or `#123` | review | that GitHub PR, via `gh pr diff <n>` |
| a path that exists | review | that file or directory |
| `branch` or `vs main` | review | `git diff main...HEAD` |
| anything else | decision | the text itself is the question |

For **review** mode, the proposition is `Ship this change: <short description
of what the diff does>`. Read the diff first so the description is accurate;
do not just echo the argument back.

For **decision** mode, the proposition is the user's question, rewritten as a
yes/no proposal if it is not already one. "Should we move to Postgres?"
becomes "Move from MySQL to Postgres."

If the target is empty — no uncommitted changes, an empty diff — say so and
stop. Do not convene the units over nothing.

## 2. Gather the evidence once

Collect the material the units will judge, so all three see exactly the same
thing:

- Review mode: capture the diff to a file under the system temp directory, and
  note which files it touches.
- Decision mode: gather whatever local context bears on the question — the
  relevant files, the current implementation, the dependency manifest. If the
  question is purely abstract, that is fine; there may be no files.

Keep it to what is relevant. A 5000-line diff should be summarised by file with
the interesting hunks quoted, not pasted whole.

## 3. Convene the three units

Dispatch **melchior**, **balthasar** and **casper** with the Agent tool **in a
single message, so they run in parallel**. This matters: they must not see each
other's reasoning. Independence is the entire point of the vote.

Give each the same brief:

- the proposition, stated identically to all three
- the diff path or the file paths to read
- the working directory
- an instruction to return only their JSON verdict

Do not tell any unit what another thinks. Do not summarise, soften, or edit
their verdicts afterwards.

If a unit fails or returns unparseable output, record it as `ABSTAIN` with a
headline saying it failed, and carry on. Two votes still decide; three
abstentions deadlock and fail closed, which is the correct outcome.

## 4. Render the verdict

Write the three verdicts to a JSON file in the system temp directory:

```json
{
  "proposition": "Ship this change: bound the session cache eviction path",
  "target": "git diff HEAD · 6 files",
  "votes": [ <the three verdict objects, verbatim> ]
}
```

Then render it as a self-contained HTML page and open it — this is the only
output mode:

```bash
node <plugin-root>/bin/magi-render <verdict.json>
```

`<plugin-root>` is the directory containing this `skills/magi/SKILL.md`, two
levels up — i.e. wherever `bin/magi-render` sits relative to this file. Use
`${CLAUDE_PLUGIN_ROOT}` if it is set; otherwise resolve it yourself from the
path this skill loaded from.

The binary exits `0` on 可決 and `1` on 否決, so a failed exit code is the
verdict, not an error. Do not report it as a failure.

## 5. Report

State the outcome in one line — `可決 / APPROVED (2-1) — CASPER-3 dissents` —
then the substance: what each unit found, dissent first. The dissenting unit's
objection is the most valuable output of the whole exercise; lead with it.

Do not editorialise about the verdict or argue with the units. You convened
them; the vote is theirs.

## Rules

- Never modify files as part of a MAGI run. It reviews; it does not fix. If the
  user wants the findings applied, that is a separate request.
- Never invent a verdict, a headline, or a finding. Every one comes from a unit.
- Never run the units sequentially or let one see another's output.
