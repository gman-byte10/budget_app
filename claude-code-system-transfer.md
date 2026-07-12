# Claude Code Orchestration System — Transfer Package

Everything below is self-contained. To install on a new project:

1. Copy the **CLAUDE.md block** into your project's `CLAUDE.md` (create one if it doesn't exist)
2. Create `.claude/settings.json` with the **settings block**
3. Create `.claude/commands/` and add the **four command files**

---

## 1. CLAUDE.md — paste this into your project's CLAUDE.md

```markdown
## Plan mode → goal conversion (auto-detect, verdict in plan file)

This project uses **goal-driven autonomous execution** for non-trivial work. A
"goal" is a structured spec at `goals/<name>-goal.md` that a session runs to
completion via `Work on goals/<name>-goal.md autonomously to completion.` (or
the `/work-on-goal <filename>` slash command). Status reports land at
`goals/<name>-status-<date>.md`.

**The goal-conversion decision happens IN PLAN MODE, before the user approves
the plan — not silently after.** The plan file must include a
`## Goal-conversion verdict` section so the user reads your recommendation
during plan review and either accepts it or pushes back, before hitting approve.

### Step 0: Auto-enter plan mode (the user should not need the manual toggle)

When a request arrives in NORMAL mode and it is plan-worthy, call
`EnterPlanMode` yourself BEFORE doing any implementation work.
Plan-worthy = any of:

- multi-phase work (>= 3 steps that gate each other)
- hard-to-reverse production change (migrations, bulk mutations, anything externally visible)
- real runtime LLM spend
- scope is ambiguous enough that exploration should precede action

Do NOT auto-enter plan mode for: questions/explanations, single-file fixes,
running tests/servers, reversible config tweaks, or continuing already-planned work.
When unsure, a one-line heads-up beats a silent plan-mode jump:
"This looks plan-worthy (~N phases) — entering plan mode."
The user can say "just do it" to override.

### Step 1: Evaluate the plan against the goal-worthy criteria

- **Multi-phase work** — the plan has ≥2 distinct phases / checkpoints
- **Real LLM spend** — the work calls Opus/Sonnet/etc. at runtime. Goals enforce explicit cost ceilings.
- **Production output** — writes to the live DB, or anything user-visible in production.
- **Walk-away appropriate** — the work runs for >15 minutes and the user would reasonably want it to run unattended.
- **Plan file is large** — >100 lines suggests scope worth a goal artifact.

### Step 2: Add a `## Goal-conversion verdict` section to the plan file

Append this section BEFORE calling `ExitPlanMode`:

```
## Goal-conversion verdict

**Recommendation:** {one of: MAKE A GOAL (auto-run) / SKIP — just execute / SPLIT FIRST / NARROW FIRST}

**Reasons:**
- {which goal-worthy criteria fired, with the specific signal}
- {If none fired: "No goal-worthy criteria. This is a {N}-file change taking ~{M} minutes."}

**If MAKE A GOAL — what the goal will contain (1-3 sentence preview):**
{Objective + scope + hardest constraint. Don't write the full goal here.}

**Proposed filename:** `goals/<kebab-name>-goal.md`
**Proposed cost ceiling:** $<X> (and {Y} hours)
**Approach shape:** {Single goal / Split into N goals / Narrow to phase N first}

**Risk callouts (if any):**
- {Compaction risk if plan is >200 lines AND execution will be long}
- {High-cost-ceiling restatement if >$25}
```

### Step 2b: Execution-routing banner at the TOP of the plan file

The very first lines of every plan file must tell the operator what to do after reading:

If the verdict is MAKE A GOAL:
> **NEXT STEP → Just accept this plan (no model switching needed).** After
> approval, the goal file is drafted and auto-run in a **Fable subagent** —
> fresh context window, zero keystrokes from you. The status report is relayed
> back here. (Opt-outs: say `manual` to run it yourself via `/model claude-fable-5` +
> `/work-on-goal <filename>-goal.md`, or `just run` for current-session execution.)

If the verdict is SKIP — just execute:
> **NEXT STEP → Just accept this plan (no model switching needed).** After
> approval, a **Fable subagent** spawns immediately to execute it — you type
> nothing; results are relayed back here. (Opt-outs: `just do it here` for
> in-session execution, or `manual switch` to drive Fable yourself.)

### Step 3: User reviews + approves (or objects in plan mode)

- Agreement → approve via `ExitPlanMode` → carry out the verdict in step 4.
- Objection → revise the plan + verdict before exit.

### Step 4: After ExitPlanMode — execute the verdict

Briefly restate in one line what you're doing, then act:

**If verdict was MAKE A GOAL:**
1. Draft the goal file in the standard shape (Objective / Context / Target State / Scope /
   Hard Constraints / Acceptance Criteria / Stop Conditions / Progress / Session Strategy /
   Cost & Time Bounds / Primary Outcome).
2. Save to `goals/<kebab-filename>-goal.md`.
3. Spawn a Fable subagent:
   ```
   Agent(
     subagent_type: "general-purpose",
     model: "fable",
     run_in_background: true,
     prompt: "Work on goals/<filename>-goal.md autonomously to completion."
   )
   ```
   Announce the launch in one line. When it completes, relay: status report path +
   outcome summary + any stop-conditions hit.

   **One executor, not a team.** Spawn a SINGLE Fable subagent. Most goals are a
   sequential phase chain and/or contend on shared resources — a team would stall.
   The executor may parallelize internally for genuinely independent sub-steps.

   **Manual fallback** (user says `manual`, or MCP missing): tell the user —
   goal saved at `goals/<filename>-goal.md`; run it with `/model claude-fable-5`
   then `/work-on-goal <filename>-goal.md`. `just run` = execute in current session/model.

   **Mid-run questions:** if the subagent hits a "stop and ask" condition,
   it returns with the question; relay to the user, then continue the same
   subagent via `SendMessage` with their answer.

**If verdict was SKIP — just execute:**
Immediately and automatically:
1. Produce a Fable handoff briefing (self-contained: objective, file scope,
   constraints, acceptance criteria, verification gates).
2. Spawn: `Agent(subagent_type: "general-purpose", model: "fable", prompt: <briefing + plan content>)`.
   Use `run_in_background: true` if work exceeds a few minutes.
3. When it reports back, relay results (what shipped / tests run / deviations / blockers).

Opt-outs: `just do it here` = execute in current session; `manual switch` = produce briefing,
then prompt the user to paste `/model claude-fable-5` + `go`.

**If verdict was SPLIT FIRST or NARROW FIRST:**
Don't proceed to execution. Tell the user: "I recommended splitting/narrowing first —
want me to re-enter plan mode and revise, or override and proceed anyway?"

### A note on the verdict section in plan mode

The plan-file `## Goal-conversion verdict` section should also note whether you'll
recommend context refresh before run:

> **Pre-run refresh:** RECOMMENDED (reasons: cost ceiling > $5; 4 phases)
Or:
> **Pre-run refresh:** Not recommended — short goal, lightly-used session.

---

## Model routing — three tiers (Sonnet orchestrates, Opus designs, Fable executes)

The main conversation loop lives in **Sonnet** (set in `.claude/settings.json`).
Expensive models are pulled in as subagents only where they earn their cost —
subscription limits are one shared pool, and Fable burns ~2x faster than Opus.

| Tier | Where it runs | Used for |
|:-|:-|:-|
| Sonnet | main loop | conversation, triage, routine planning, writing plan files, relaying results |
| Opus | `Agent(subagent_type: "Plan", model: "opus")` | high-stakes design AND the DEFAULT executor for implementation |
| Fable | `Agent(model: "fable")` | execution ONLY for the heaviest runs (checklist below) |

**Executor-tier checklist — default to Opus; use Fable only when:**
- long multi-phase autonomous goals (> ~2h expected, many checkpoints)
- sustained MCP orchestration loops
- a prior Opus executor attempt stalled or mangled the same task
- the operator explicitly says `use fable`

When unsure, use Opus — Fable drains the shared pool ~2x faster.
Trivial mechanical tasks (run tests, restart server, one-file edit) may use default-model subagent.

**Ultrathink — prepend to Opus/Fable prompts broadly.**
Always add `"Ultrathink. "` to Opus/Fable prompts for:
- design judgment (architecture, plan drafting, goal drafting)
- complex multi-phase autonomous goals
- implementation work with non-trivial decisions (new files, multi-file changes, DB schema, API design)
- any task the operator describes as important or difficult

Skip ultrathink ONLY for purely mechanical tasks: running tests, restarting a server,
applying a single known diff, simple file lookups, one-line edits.

**Escalation checklist — spawn an Opus Plan subagent when ANY of:**
- >= 3 phases, or the plan is likely goal-worthy
- hard-to-reverse production change (schema migration, bulk data mutation, anything externally published)
- real runtime LLM spend
- the user explicitly asks for deep design judgment

When unsure, ESCALATE — one wasted Opus design call is far cheaper than a poisoned autonomous run.

**Outside plan mode — hard-call escalation:**
When the main loop hits a genuinely hard judgment call — architecture decision,
durable tradeoff, choice expensive to walk back — spawn a one-off Opus subagent
(`Agent(subagent_type: "Plan", model: "opus")`) to weigh in, then present its reasoning.
Do NOT escalate for questions that are merely detailed (lookups, explanations, mechanical how-tos).

**Main-loop upgrade recommendations (max once per direction per session):**

- Recommend `/model claude-opus-4-8` when the session has become sustained design work
  (2-3 Opus escalations back-to-back, or long architecture discussion losing nuance):
  > This session is mostly deep design now — running the whole loop in Opus would be better
  > than round-tripping subagents. Paste `/model claude-opus-4-8` to switch.

- Recommend `/model claude-fable-5` when the user is driving sustained hands-on execution
  themselves in the main loop:
  > You're hand-steering a long execution stretch — the main loop on Fable is the better fit.
  > Paste `/model claude-fable-5` to switch.

Never nag: one recommendation per direction per session, drop it if the user declines.

**Manual override:** If the main loop is on Fable and the user asks for planning/design work,
remind them once:
> Planning belongs in the cheap tier — paste `/model sonnet` (or `/model claude-opus-4-8`
> for the hardest calls) and re-ask.

### Standalone goal drafting (no plan mode)

When the user invokes `/make-goal-prompt` directly, the command stays draft-only:
produce the goal, save it, tell the user to start a fresh session and run
`/work-on-goal <filename>`. Do NOT execute the goal in the same session.
```

---

## 2. .claude/settings.json — create this file at `<your-project>/.claude/settings.json`

```json
{
  "model": "claude-sonnet-4-6",
  "permissions": {
    "defaultMode": "auto"
  }
}
```

---

## 3. .claude/commands/work-on-goal.md

Create `.claude/commands/work-on-goal.md`:

```markdown
---
description: Trigger a fresh autonomous Claude Code run on a saved goal file in goals/. Best used in a NEW session with clean context.
argument-hint: <goal-filename> (e.g. "fix-login-bug-goal.md")
---

Work on goals/$ARGUMENTS autonomously to completion.
```

---

## 4. .claude/commands/make-goal-prompt.md

Create `.claude/commands/make-goal-prompt.md`:

```markdown
---
description: Draft a structured goal prompt for Claude Code, then offer to save it to goals/.
argument-hint: <short description of what the goal should accomplish>
---

You are drafting a goal prompt for CLAUDE CODE (the Anthropic CLI / IDE tool).

The prompt will be saved to `goals/<filename>.md` and later invoked verbatim by a fresh
Claude Code session via: `Work on goals/<filename>.md autonomously to completion.`

Task / input: $ARGUMENTS

**Input interpretation:**
- Short prose description → draft the goal from scratch.
- Path to a plan file (starts with `@` or contains `plans/`) → read that file first and
  convert it into a goal. The plan's Steps/Verification → Acceptance Criteria + Stop Conditions;
  the plan's Context → goal's Context; plan's "what this does NOT do" → Hard Constraints.
- Empty → ask the user what the goal should accomplish.

## Goal sections (in order)

- **Objective** — one paragraph: what to achieve and why.
- **Context** — current state, what triggered the goal, references to prior status reports.
- **Target State** — concrete outcomes after the goal is done (numbered list).
- **Scope** — three sub-lists: `Work in` (paths to edit), `READ as grounding` (paths to consult),
  `Do NOT touch` (locked surfaces).
- **Hard Constraints** — what's locked. Always include: "Backend schema: additive only",
  and any surfaces named NEVER in your CLAUDE.md.
- **Acceptance Criteria** — phase-by-phase, checkbox-shaped (`- [ ] …`). Group by phase.
  Include a `### CHECKPOINT` between parts so the executor stops + reports before continuing.
- **Stop Conditions** — "stop and write status report when…" + "stop and ask before…" lists.
- **Progress** — "After each completed step output: `✅ [what was done] — [file(s) affected] — [cost so far]`."
- **Session Strategy** — "Fresh session" OR "Continue — prior context required:" with bullet list
  of status reports + files to load up front.
- **Implementation Notes** — per-phase guidance: traps to avoid, specific approaches, calibration tips.
- **Cost & Time Bounds** — hard ceiling in USD and hours, plus expected actual range.
- **Reference Files** — bulleted list of paths the executor must consult.
- **Primary Outcome** — one-line summary of success as a future tense statement.
- **Final reminder block** — 3-6 bolded warning lines at the very bottom re-anchoring posture.

## After drafting

1. Propose a kebab-case filename ending in `-goal.md`.
2. Offer to write it to `goals/<filename>`.
3. Do NOT execute the goal — only draft it.
4. After saving, remind the user: start a NEW Claude Code session and run
   `/work-on-goal <filename>` (or paste `Work on goals/<filename>.md autonomously to completion.`).
```

---

## 5. .claude/commands/handoff.md

Create `.claude/commands/handoff.md`:

```markdown
---
description: Handoff between Opus (planning) and Fable (implementation). Invoke in Opus after plan approval to brief Fable; invoke in Fable when done to wrap up and switch back.
argument-hint: "(no args — auto-detects current model)"
---

# Plan-in-Opus / execute-in-Fable handoff (MANUAL path)

NOTE: The DEFAULT path is automated — per CLAUDE.md, after plan approval the main loop
spawns a Fable subagent automatically. This command is the MANUAL fallback for when the
user wants to drive Fable in the main loop themselves (said `manual switch` or wants more
visibility/steering).

Check `You are powered by the model named ...` in your system prompt to determine which
model you are. The model switch itself happens via `/model` — the USER must type it.

---

## If you are OPUS — produce a handoff BRIEFING for Fable

First check the plan's `## Goal-conversion verdict`:
- MAKE A GOAL → draft + save `goals/<name>-goal.md` while still in Opus, THEN tell
  the user to switch. The goal file IS the briefing — don't produce both.
- SKIP — just execute → proceed with the briefing below.
- SPLIT / NARROW FIRST → don't hand off, resolve scope first.

### Briefing shape (40-80 lines):

```
## Fable handoff briefing

**Plan file:** `<path>`
**Source goal:** <one-line summary>
**Estimated effort:** <minutes/hours>

### What you (Fable) need to know

1. **Objective in one sentence:** ...
2. **Hard constraints / LOCKED surfaces** (copy verbatim from plan):
   - ...
3. **Files to modify:**
   - `path/to/file` — <what changes>
4. **Pattern to follow** (cite existing code):
   - ...
5. **Verification gates** (check before declaring done):
   - Run `<exact command>` → expect `<exact assertion>`

### Gotchas Opus noticed during planning
(2-6 bullets — discoveries not obvious from the plan text)

### Out of scope — do NOT attempt
(Pull from plan's "What's NOT touched" / "Stop conditions")

### When you're done
Run the verification gates. If all pass, invoke `/handoff` to produce a wrap-up.
```

End with EXACTLY:
> ---
> **Briefing complete.** Switch to Fable now by pasting:
> ```
> /model claude-fable-5
> ```
> Then say `go` so Fable picks up the briefing and starts executing.

Then STOP. Do not begin implementation yourself.

---

## If you are FABLE — produce a wrap-up for Opus

First check: search the conversation for a "Fable handoff briefing". If NONE exists
and no implementation has happened, tell the user:
> No briefing exists yet — `/handoff` runs in Opus FIRST. Paste `/model claude-opus-4-8`,
> run `/handoff` there, then switch back.

### Wrap-up shape (20-40 lines):

```
## Fable wrap-up

**Status:** COMPLETE / PARTIAL / BLOCKED

### What shipped
- `file:line` — what changed

### Tests run
- `<command>` → pass/fail count

### Deviations from the plan
- (or "None — followed plan as written.")

### What I couldn't do
- (or "Nothing — plan completed end-to-end.")

### Open questions for Opus
- <decision needed>
```

End with EXACTLY:
> ---
> **Wrap-up complete.** Switch back to Opus by pasting:
> ```
> /model claude-opus-4-8
> ```

Then STOP. Do not start the next phase.
```

---

## 6. .claude/commands/review-status-report.md

Create `.claude/commands/review-status-report.md`:

```markdown
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
```

---

## Installation summary

```
your-project/
├── CLAUDE.md                          ← paste the block from section 1
├── goals/                             ← create this folder (goals live here)
└── .claude/
    ├── settings.json                  ← section 2
    └── commands/
        ├── work-on-goal.md            ← section 3
        ├── make-goal-prompt.md        ← section 4
        ├── handoff.md                 ← section 5
        └── review-status-report.md   ← section 6
```

That's the complete system. Open Claude Code in the project root and it picks everything up automatically.
