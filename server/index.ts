import http from "node:http"
import { readFile, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { extname, join, normalize, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { Persona, Message } from "./zai.js"
import { serverTranslate, serverTranscribe, serverSuggest, serverAsk } from "./zai.js"

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

function readRawBody(req: http.IncomingMessage, limit = 25 * 1024 * 1024): Promise<Buffer> {
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
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

async function serveStatic(res: http.ServerResponse, urlPath: string) {
  // Prevent path traversal. Normalize then strip leading slash.
  const safe = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "")
  let filePath = join(DIST_DIR, safe)

  try {
    const s = await stat(filePath)
    if (s.isDirectory()) {
      filePath = join(filePath, "index.html")
    }
    const data = await readFile(filePath)
    res.writeHead(200, { "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream" })
    res.end(data)
  } catch {
    // SPA fallback: any unknown path serves index.html (so client-side routing works)
    try {
      const index = await readFile(join(DIST_DIR, "index.html"))
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(index)
    } catch {
      send(res, 404, { error: "Not found" })
    }
  }
}

// ---------------------------------------------------------------------------
// API handlers
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

async function handleTranslate(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!process.env.ZAI_API_KEY) {
    send(res, 500, { error: "Server missing ZAI_API_KEY" })
    return
  }

  let body: TranslateRequest
  try {
    body = await readJsonBody<TranslateRequest>(req)
  } catch {
    send(res, 400, { error: "Invalid JSON body" })
    return
  }

  const { persona, input, history = [], direction = "to-target" } = body
  if (!persona || typeof input !== "string" || !input.trim()) {
    send(res, 400, { error: "Missing persona or input" })
    return
  }

  try {
    const result = await serverTranslate(persona, input, history, direction)
    send(res, 200, result)
  } catch (err) {
    console.error("[translate] error:", err)
    send(res, 502, { error: err instanceof Error ? err.message : "Translation failed" })
  }
}

async function handleSuggest(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!process.env.ZAI_API_KEY) {
    send(res, 500, { error: "Server missing ZAI_API_KEY" })
    return
  }

  let body: SuggestRequest
  try {
    body = await readJsonBody<SuggestRequest>(req)
  } catch {
    send(res, 400, { error: "Invalid JSON body" })
    return
  }

  const { persona, situation, avoid = [], count = 3, direction = "to-target", history = [] } = body
  if (!persona || typeof situation !== "string" || !situation.trim()) {
    send(res, 400, { error: "Missing persona or situation" })
    return
  }

  try {
    const result = await serverSuggest(persona, situation, avoid, count, direction, history)
    send(res, 200, result)
  } catch (err) {
    console.error("[suggest] error:", err)
    send(res, 502, { error: err instanceof Error ? err.message : "Suggestion failed" })
  }
}

async function handleAsk(req: http.IncomingMessage, res: http.ServerResponse) {
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

  const { persona, question, history = [], quote } = body
  if (!persona || typeof question !== "string" || !question.trim()) {
    send(res, 400, { error: "Missing persona or question" })
    return
  }

  try {
    const result = await serverAsk(persona, question, history, quote)
    send(res, 200, result)
  } catch (err) {
    console.error("[ask] error:", err)
    send(res, 502, { error: err instanceof Error ? err.message : "Answer failed" })
  }
}

async function handleAsr(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!process.env.ZAI_API_KEY) {
    send(res, 500, { error: "Server missing ZAI_API_KEY" })
    return
  }

  // The client sends multipart/form-data with a "file" field (the WAV blob).
  // Parse it manually with Node 20+'s Undici FormData.
  const contentType = req.headers["content-type"] || ""
  if (!contentType.includes("multipart/form-data")) {
    send(res, 400, { error: "Expected multipart/form-data" })
    return
  }

  try {
    const buf = await readRawBody(req)
    // Node 20+ exposes Request/FormData globally (via Undici). Build a Request
    // so we can parse multipart/form-data without an extra dependency.
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": contentType },
      body: buf,
      // Required by the WHATWG fetch spec for request bodies carrying a buffer.
      duplex: "half",
    })
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof Blob)) {
      send(res, 400, { error: "Missing 'file' in form data" })
      return
    }
    const text = await serverTranscribe(file)
    send(res, 200, { text })
  } catch (err) {
    console.error("[asr] error:", err)
    send(res, 502, { error: err instanceof Error ? err.message : "Transcription failed" })
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

  if (path === "/api/asr" && method === "POST") {
    await handleAsr(req, res)
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
