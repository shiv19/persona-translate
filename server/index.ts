import http from "node:http"
import { readFile, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { extname, join, normalize, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { Persona, Message } from "./zai.js"
import { serverTranslate, serverSuggest, serverAskStream } from "./zai.js"

// Load .env from the project root if present. Works under both tsx (dev) and
// node (prod) — no --env-file flag needed. Safe to skip if the file is absent
// (e.g. when the host injects env vars directly).
try {
  process.loadEnvFile()
} catch {
  // .env missing — rely on the ambient environment.
}

// Resolve the project root by walking up from this file to the directory that
// contains package.json. This works whether we're running the TS source via tsx
// (file at <root>/server/index.ts) or the compiled output via node (file at
// <root>/server/dist/index.js) — both reach <root> by going up 1–2 levels.
function findProjectRoot(start: string): string {
  let dir = start
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "vite.config.ts"))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return start
}

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const ROOT = findProjectRoot(__dirname)
const DIST_DIR = process.env.DIST_DIR || join(ROOT, "dist")
// Dev: vite runs on 3133 and proxies /api here (3134). Prod: this serves both.
const PORT = Number(process.env.PORT) || 3134

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(res: http.ServerResponse, status: number, body: unknown, headers?: Record<string, string>) {
  const json = typeof body === "string" ? body : JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  })
  res.end(json)
}

function readJsonBody<T = unknown>(req: http.IncomingMessage, limit = 5 * 1024 * 1024): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error("Payload too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf-8")
        resolve(text ? (JSON.parse(text) as T) : ({} as T))
      } catch (err) {
        reject(err)
      }
    })
    req.on("error", reject)
  })
}

async function serveStatic(res: http.ServerResponse, urlPath: string) {
  // Prevent path traversal. Normalize then strip leading slash.
  const safe = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "")
  let filePath = join(DIST_DIR, safe)

  // Cache headers keyed off the file path:
  //  - index.html (and the SPA fallback) → no-cache. The browser always
  //    revalidates so a new deploy is picked up on next open. Without this,
  //    an installed PWA serves a stale index.html that points at the previous
  //    build's hashed assets — the "I updated but nothing changed" bug.
  //  - /assets/* (Vite content-hashed JS/CSS) → 1 year, immutable. The
  //    filename changes every build, so caching forever is safe and fast.
  //  - everything else (icons, manifest) → revalidate after 1 hour.
  function cacheHeadersFor(p: string): Record<string, string> {
    if (p.endsWith(".html")) return { "Cache-Control": "no-cache" }
    if (p.includes(`/assets/`)) return { "Cache-Control": "public, max-age=31536000, immutable" }
    return { "Cache-Control": "public, max-age=3600" }
  }

  try {
    const s = await stat(filePath)
    if (s.isDirectory()) {
      filePath = join(filePath, "index.html")
    }
    const data = await readFile(filePath)
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
      ...cacheHeadersFor(filePath),
    })
    res.end(data)
  } catch {
    // SPA fallback: any unknown path serves index.html (so client-side routing works)
    try {
      const index = await readFile(join(DIST_DIR, "index.html"))
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        ...cacheHeadersFor("index.html"),
      })
      res.end(index)
    } catch {
      send(res, 404, { error: "Not found" })
    }
  }
}

// ---------------------------------------------------------------------------
// API handlers
//
// Every handler shares the same skeleton: a ZAI_API_KEY guard, a JSON body read
// (400 on malformed), and field validation (400 on bad input). `jsonHandler`
// encapsulates that plus the run/JSON-encode/502-on-error tail. `handleAsk`
// reuses only the prelude (key guard + body read + validate) because its
// response is an SSE stream, not JSON.
// ---------------------------------------------------------------------------

interface TranslateRequest {
  persona: Persona
  input: string
  history?: Message[]
  direction?: "to-target" | "from-target"
}

interface SuggestRequest {
  persona: Persona
  situation: string
  avoid?: string[]
  count?: number
  direction?: "to-target" | "from-target"
  history?: Message[]
}

interface AskRequest {
  persona: Persona
  question: string
  history?: Message[]
  quote?: { original: string; translation: string }
}

interface JsonHandlerOpts<T> {
  /** Short label for error logging + the generic failure message. */
  label: string
  /** Validate the parsed body; return an error string (→ 400) or null if ok. */
  validate: (body: T) => string | null
  /** Run the work; its return value is JSON-encoded as the 200 response. */
  run: (body: T) => Promise<unknown>
}

/**
 * JSON request → JSON response handler. Handles the key guard, body parsing,
 * validation, and the run/error envelope uniformly. On a thrown `run`, logs and
 * returns 502 with the error message (or a generic "<label> failed").
 */
async function jsonHandler<T>(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: JsonHandlerOpts<T>,
) {
  if (!process.env.ZAI_API_KEY) {
    send(res, 500, { error: "Server missing ZAI_API_KEY" })
    return
  }

  let body: T
  try {
    body = await readJsonBody<T>(req)
  } catch {
    send(res, 400, { error: "Invalid JSON body" })
    return
  }

  const validationError = opts.validate(body)
  if (validationError) {
    send(res, 400, { error: validationError })
    return
  }

  try {
    send(res, 200, await opts.run(body))
  } catch (err) {
    console.error(`[${opts.label}] error:`, err)
    send(res, 502, { error: err instanceof Error ? err.message : `${opts.label} failed` })
  }
}

const handleTranslate = (req: http.IncomingMessage, res: http.ServerResponse) =>
  jsonHandler<TranslateRequest>(req, res, {
    label: "translate",
    validate: (b) =>
      !b.persona || typeof b.input !== "string" || !b.input.trim()
        ? "Missing persona or input"
        : null,
    run: (b) =>
      serverTranslate(b.persona, b.input, b.history ?? [], b.direction ?? "to-target"),
  })

const handleSuggest = (req: http.IncomingMessage, res: http.ServerResponse) =>
  jsonHandler<SuggestRequest>(req, res, {
    label: "suggest",
    validate: (b) =>
      !b.persona || typeof b.situation !== "string" || !b.situation.trim()
        ? "Missing persona or situation"
        : null,
    run: (b) =>
      serverSuggest(
        b.persona,
        b.situation,
        b.avoid ?? [],
        b.count ?? 3,
        b.direction ?? "to-target",
        b.history ?? [],
      ),
  })

async function handleAsk(req: http.IncomingMessage, res: http.ServerResponse) {
  // Prelude: key guard + body parse + validation. (Shares the shape of
  // jsonHandler but can't use it — ask's response is an SSE stream, not JSON.)
  if (!process.env.ZAI_API_KEY) {
    send(res, 500, { error: "Server missing ZAI_API_KEY" })
    return
  }

  let body: AskRequest
  try {
    body = await readJsonBody<AskRequest>(req)
  } catch {
    send(res, 400, { error: "Invalid JSON body" })
    return
  }

  if (!body.persona || typeof body.question !== "string" || !body.question.trim()) {
    send(res, 400, { error: "Missing persona or question" })
    return
  }

  const { persona, question, history = [], quote } = body

  // SSE streaming response. Events:
  //   data: {"type":"delta","text":"..."}   — incremental answer fragment
  //   data: {"type":"done","answer":"..."}  — final complete answer
  //   data: {"type":"error","error":"..."}  — failure (mid-stream or otherwise)
  // The client (fetch + ReadableStream reader) parses these line by line and
  // grows the answer live. Errors before the stream starts are sent as JSON
  // (the client hasn't switched to stream-reading yet); errors mid-stream are
  // sent as an SSE error event then the connection closes.
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no", // hint for proxies (Cloudflare etc.) not to buffer
  })

  const writeEvent = (obj: unknown) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`)
  }

  try {
    for await (const ev of serverAskStream(persona, question, history, quote)) {
      if (ev.delta) writeEvent({ type: "delta", text: ev.delta })
      else if (ev.done !== undefined) writeEvent({ type: "done", answer: ev.done })
    }
  } catch (err) {
    console.error("[ask] stream error:", err)
    writeEvent({ type: "error", error: err instanceof Error ? err.message : "Answer failed" })
  } finally {
    res.end()
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`)
  const path = url.pathname
  const method = req.method || "GET"

  // Simple health check.
  if (path === "/api/health") {
    send(res, 200, { ok: true, hasKey: Boolean(process.env.ZAI_API_KEY) })
    return
  }

  if (path === "/api/translate" && method === "POST") {
    await handleTranslate(req, res)
    return
  }

  if (path === "/api/suggest" && method === "POST") {
    await handleSuggest(req, res)
    return
  }

  if (path === "/api/ask" && method === "POST") {
    await handleAsk(req, res)
    return
  }

  if (method === "GET") {
    await serveStatic(res, path)
    return
  }

  send(res, 404, { error: "Not found" })
})

server.listen(PORT, () => {
  console.log(`[server] PersonaTranslate listening on http://localhost:${PORT}`)
  console.log(`[server] Serving static assets from ${DIST_DIR}`)
  if (!process.env.ZAI_API_KEY) {
    console.warn("[server] WARNING: ZAI_API_KEY is not set — /api/* will return 500")
  }
})
