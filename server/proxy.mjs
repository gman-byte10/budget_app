// ===========================================================================
// Tiny local proxy. Two jobs:
//   1) POST /api/llm  → forward a single prompt to OpenAI / Anthropic / Google
//      so API keys are attached server-side and never baked into the bundle.
//   2) Serve the built app (../dist) so you can open it from your phone on the
//      same Wi-Fi (PWA-on-LAN). In dev, Vite serves the app and proxies /api.
//
// Keys come from (in order): the request body (pasted in the app UI), then
// server/keys.json, then environment variables. Nothing is hardcoded.
//
// Run:  node server/proxy.mjs        (defaults to port 8787)
// ===========================================================================
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = process.env.PORT || 8787
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'dist')

// Optional keys file (gitignored). { "openai": "...", "anthropic": "...", "google": "..." }
let fileKeys = {}
try {
  if (existsSync(join(ROOT, 'server', 'keys.json'))) {
    fileKeys = JSON.parse(await readFile(join(ROOT, 'server', 'keys.json'), 'utf8'))
  }
} catch {
  /* ignore */
}

function keyFor(provider, fromBody) {
  if (fromBody && fromBody.trim()) return fromBody.trim()
  if (fileKeys[provider]) return fileKeys[provider]
  const env = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_API_KEY' }[provider]
  return env ? process.env[env] : undefined
}

// ---- Sync store: tiny key/value for cross-device sync. -----------------------
// Stores ONLY client-encrypted blobs (the server can't read your data). Uses
// Upstash Redis REST when configured (durable, free); falls back to in-memory
// for local dev. Each value is JSON: { payload: <ciphertext>, updatedAt: <ms> }.
const UP_URL = process.env.UPSTASH_REDIS_REST_URL
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
const memStore = new Map()

async function upstash(command) {
  const r = await fetch(UP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || 'Upstash error')
  return j.result
}

async function kvGet(key) {
  if (UP_URL && UP_TOKEN) {
    const v = await upstash(['GET', key])
    return v ? JSON.parse(v) : null
  }
  return memStore.get(key) ?? null
}

async function kvSet(key, value) {
  if (UP_URL && UP_TOKEN) {
    await upstash(['SET', key, JSON.stringify(value)])
    return
  }
  memStore.set(key, value)
}

// ---- Provider adapters: build request, return {text, inputTokens, outputTokens}
async function callOpenAI({ model, system, prompt, maxTokens, apiKey }) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.4,
    }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error?.message || JSON.stringify(j))
  return {
    text: j.choices?.[0]?.message?.content?.trim() ?? '',
    inputTokens: j.usage?.prompt_tokens ?? 0,
    outputTokens: j.usage?.completion_tokens ?? 0,
  }
}

async function callAnthropic({ model, system, prompt, maxTokens, apiKey }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error?.message || JSON.stringify(j))
  return {
    text: (j.content?.[0]?.text ?? '').trim(),
    inputTokens: j.usage?.input_tokens ?? 0,
    outputTokens: j.usage?.output_tokens ?? 0,
  }
}

async function callGoogle({ model, system, prompt, maxTokens, apiKey }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
    }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error?.message || JSON.stringify(j))
  return {
    text: (j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '').trim(),
    inputTokens: j.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: j.usageMetadata?.candidatesTokenCount ?? 0,
  }
}

const ADAPTERS = { openai: callOpenAI, anthropic: callAnthropic, google: callGoogle }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 1e6) reject(new Error('Body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
}

async function serveStatic(req, res) {
  if (!existsSync(DIST)) {
    res.writeHead(404)
    return res.end('Build not found. Run `npm run build` (or use Vite dev server).')
  }
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let filePath = normalize(join(DIST, urlPath))
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403)
    return res.end('Forbidden')
  }
  if (urlPath === '/' || !existsSync(filePath)) filePath = join(DIST, 'index.html') // SPA fallback
  try {
    const buf = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
}

const server = createServer(async (req, res) => {
  // CORS so the dev server / phone on LAN can reach the API.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  if (req.url?.startsWith('/api/llm') && req.method === 'POST') {
    try {
      const { provider, model, system, prompt, maxTokens, apiKey } = JSON.parse(await readBody(req))
      const adapter = ADAPTERS[provider]
      if (!adapter) throw new Error(`Unknown provider: ${provider}`)
      const key = keyFor(provider, apiKey)
      if (!key) throw new Error(`No API key for ${provider}.`)
      const out = await adapter({ model, system, prompt, maxTokens: maxTokens || 256, apiKey: key })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(out))
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end(String(e.message || e))
    }
    return
  }

  // Pull the latest encrypted blob for a sync key.
  if (req.url === '/api/sync/get' && req.method === 'POST') {
    try {
      const { key } = JSON.parse(await readBody(req))
      if (!key) throw new Error('Missing key')
      const value = await kvGet(`sync:${key}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(value)) // {payload, updatedAt} or null
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end(String(e.message || e))
    }
    return
  }

  // Store an encrypted blob — last-write-wins by updatedAt (rejects stale writes).
  if (req.url === '/api/sync/put' && req.method === 'POST') {
    try {
      const { key, payload, updatedAt } = JSON.parse(await readBody(req))
      if (!key || typeof payload !== 'string' || !updatedAt) throw new Error('Bad sync payload')
      const current = await kvGet(`sync:${key}`)
      if (current && current.updatedAt > updatedAt) {
        // Someone else wrote a newer copy — tell the client to reconcile.
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ ok: false, stale: true, server: current }))
      }
      await kvSet(`sync:${key}`, { payload, updatedAt })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, updatedAt }))
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end(String(e.message || e))
    }
    return
  }

  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, sync: !!(UP_URL && UP_TOKEN) }))
  }

  return serveStatic(req, res)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Budget proxy → http://localhost:${PORT}`)
  console.log(`  LAN (phone)  → http://<your-computer-ip>:${PORT}`)
  console.log(`  Serving:       ${existsSync(DIST) ? 'dist/ (built app) + /api/llm' : '/api/llm only (run npm run build to serve the app)'}\n`)
})
