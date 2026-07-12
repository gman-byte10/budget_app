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
