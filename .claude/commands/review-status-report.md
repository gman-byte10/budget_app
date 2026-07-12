---
description: Read the most recent goal status report (or a named one), summarize what shipped vs. what's left, and suggest 3-5 concrete next steps with goal-conversion verdicts.
argument-hint: "[status-report filename, optional — defaults to most recent goals/*-status-*.md]"
---

The user just finished a goal-driven run. Read the status report, extract the signal,
and suggest next steps.

**Run this in Sonnet (main loop) — no plan mode, no Opus.** This is triage only.

## Step 1: Find the report

If `$ARGUMENTS` is set: treat as filename (prefix `goals/` if bare).
If empty: glob `goals/*-status-*.md`, sort by mtime, take newest.
If none found: tell the user and suggest `ls goals/`.

## Step 2: Extract signal

Read end-to-end. Identify:
1. **What shipped** — phases marked ✅, files created, endpoints live.
2. **What's partial** — WIP / blocked items.
3. **What was deferred** — "Out of scope" / "Follow-up" sections.
4. **Stop conditions that fired** — cost/time/gate hits.
5. **Hard locks that almost fired** — load-bearing for next iteration.
6. **Surprises** — unexpected discoveries.

## Step 3: Score next-step candidates

For each candidate, score (low/med/high):
- **Continuity** — completes an open loop?
- **Compounding** — unlocks downstream work?
- **Decay risk** — stale if not done in 1-2 weeks?

Pick 3-5 best. Don't pad.

## Step 4: Emit the digest

```
## What shipped
- {bullet per deliverable}

## What's still open
- {bullet per partial/deferred/blocked}

## Next-step recommendations

### 1. {Title}
{1-2 sentences}
**Goal-conversion verdict:** {MAKE A GOAL / SKIP — just execute / SPLIT FIRST}
**Approximate effort:** {N minutes/hours/days}
**Why now:** {continuity + compounding + decay, 1 line}

### 2. {Title}
... (same shape)

## What I'd skip
- {items NOT worth doing soon — 1-line reason each}
```

Goal-conversion verdict rules:
- MAKE A GOAL: multi-phase, real LLM spend, production output, walk-away-appropriate, >100 line plan
- SKIP — just execute: ≤2 files, ≤30 min, no LLM spend, reversible
- SPLIT FIRST: goal-worthy but mixes unrelated subgoals
- NARROW FIRST: user probably wants phase 1 only

End with: "Want me to start any of these?" then wait.
