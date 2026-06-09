# Budget — a frictionless personal budgeting app

Local-first, private, mobile-friendly. All data is entered manually and stored
only on your device (IndexedDB). No bank integrations. An optional, cost-capped
AI layer adds smart help — and the app is 100% functional with AI turned off.

---

## Quick start

```bash
npm install

# Everyday use (no AI): just the app
npm run dev
# → open the printed Local URL on your computer, or the Network URL on your phone

# With AI features (runs the app + the local key-holding proxy together)
npm run dev:ai
```

### Use it on your phone (PWA over your home Wi-Fi)

1. Make sure your phone and computer are on the same network.
2. Run `npm run dev:ai` (or `npm run start` for a production build — see below).
3. On your phone open the **Network** URL printed in the terminal
   (e.g. `http://10.0.0.95:5173`).
4. In your mobile browser choose **Add to Home Screen** to install it as an app.

### Production build served from one process (recommended for daily phone use)

```bash
npm run start      # builds, then serves the app + /api on port 8787
# open http://<your-computer-ip>:8787 on your phone
```

---

## What's inside

- **Fast entry** — one screen, on-screen keypad, quick-add chips, recently-used
  categories first. Natural-language entry ("$12 lunch yesterday") parsed locally.
- **Accounts** — checking / savings / cash / manually-paid credit, per-account
  balances, total net worth, and transfers (never counted as spending).
- **Budgets + rollover** — monthly budgets per category, a single **safe-to-spend**
  number, and per-category **envelope rollover** (under-spend accumulates,
  over-spend carries a debt). Optional accumulation cap. Past months freeze.
- **Month close** — at month end, route leftovers to a savings goal instead of
  carrying, then freeze the month so historical numbers never shift.
- **Goals, recurring, streaks, weekly check-in, charts, JSON export/import.**

## Rollover model (the core logic)

For each category, walking months forward:

```
carryIn(M)   = rollover ? carryOut(M-1) : 0
effective(M) = base(M) + carryIn(M)            // shown as base, +/- rolled, = effective
carryOut(M)  = effective(M) - spent(M)          // negative = in the hole
if cap set and carryOut(M) > cap → carryOut(M) = cap   // caps positive build-up only
```

Closing a month writes a frozen **snapshot** per category; past views read the
snapshot, so they never change. See `src/lib/rollover.ts` (and its tests).

---

## AI layer (optional, cost-conscious)

Everything is **local-first**: category matching, math, totals, streaks, rollover,
and natural-language parsing all run as plain code. An LLM is called **only** on
explicit actions, and only when the local path is uncertain:

| Trigger | Local first | LLM fallback |
| --- | --- | --- |
| Smart categorize (✨ on Add) | history + keyword match | classify with a small model |
| Natural-language entry (✨ on Add) | regex/heuristic parser | extract JSON with a small model |
| Coach (🤖 on Home) | — | analyze the month (stronger model) |
| Weekly summary (in the check-in) | the numbers themselves | plain-English recap (small model) |

- **One abstraction:** every call goes through `callLLM(task, input)`
  (`src/llm/callLLM.ts`) which handles provider selection, model tiering,
  caching, in-flight dedupe, the spend cap, and usage tracking.
- **Routing is one file:** `src/llm/config.ts` maps each task → tier → model.
  Cheap tasks use small models (Gemini Flash / GPT-mini / Claude Haiku tier);
  only the Coach escalates to a stronger model.
- **Guardrails:** running cost/calls shown in Settings; a monthly USD cap that
  disables AI when hit; aggressive caching + dedupe; minimal prompts (never the
  full history); and a master on/off switch.

### Keys & the proxy

Direct browser → provider calls leak keys, so calls go through a tiny local proxy
(`server/proxy.mjs`). Two ways to provide keys (nothing is ever hardcoded):

1. **In the app:** Settings → AI → paste a key per provider. Stored locally on
   your device; sent only to your local proxy.
2. **On the machine:** copy `server/keys.example.json` to `server/keys.json`
   (gitignored) or set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`.
   This keeps keys entirely off the browser.

Get keys at: Google `aistudio.google.com/apikey`, OpenAI `platform.openai.com/api-keys`,
Anthropic `console.anthropic.com`.

---

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | App only (AI calls will fail gracefully without the proxy) |
| `npm run dev:ai` | App + local proxy together (for AI features) |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run start` | Build, then serve app + `/api` from the proxy on port 8787 |
| `npm run test` | Run the rollover engine tests |
| `npm run proxy` | Run just the proxy |

## Tech

React + Vite + TypeScript · Tailwind v4 · Dexie (IndexedDB) · Recharts ·
vite-plugin-pwa · a dependency-free Node proxy.

## Privacy

All budget data stays in your browser's IndexedDB on your device. The only
network calls are the ones you explicitly trigger for AI, which go to your local
proxy and then to the provider you configured. Use Settings → Export regularly to
back up to a JSON file.
