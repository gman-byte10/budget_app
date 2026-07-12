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
