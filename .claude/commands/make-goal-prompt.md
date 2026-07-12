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
