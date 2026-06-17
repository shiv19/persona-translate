import type { Persona, Message, Suggestion } from "./types"
import type { TranslateOutput } from "./ai"

// The client never holds the API key. All requests go to our own backend
// (same-origin in prod, proxied to the dev server via vite.config.ts in dev).
const API_BASE = import.meta.env.VITE_API_BASE || ""

export async function translateViaApi(
  persona: Persona,
  input: string,
  history: Message[],
  direction: "to-target" | "from-target",
): Promise<TranslateOutput> {
  const res = await fetch(`${API_BASE}/api/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona, input, history, direction }),
  })

  if (!res.ok) {
    let message = `Translation failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {}
    throw new Error(message)
  }

  return (await res.json()) as TranslateOutput
}

export async function suggestViaApi(
  persona: Persona,
  situation: string,
  avoid: string[] = [],
  count = 3,
  direction: "to-target" | "from-target" = "to-target",
  history: Message[] = [],
): Promise<{ suggestions: Suggestion[] }> {
  const res = await fetch(`${API_BASE}/api/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona, situation, avoid, count, direction, history }),
  })

  if (!res.ok) {
    let message = `Suggestion failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {}
    throw new Error(message)
  }

  return (await res.json()) as { suggestions: Suggestion[] }
}

/**
 * Stream an ask answer from the server (SSE). Yields events as they arrive:
 *   { delta }  — incremental answer text fragment (append to growing answer)
 *   { done }   — final complete answer (persist this)
 *   { error }  — failure (mid-stream or pre-stream)
 *
 * We can't use EventSource because the request needs a POST body (persona,
 * question, history, quote). Instead: fetch + manual SSE line parsing off the
 * response body's ReadableStream. This is the standard pattern for
 * POST-initiated SSE.
 */
export async function* askViaApi(
  persona: Persona,
  question: string,
  history: Message[] = [],
  quote?: { original: string; translation: string },
): AsyncGenerator<{ delta?: string; done?: string; error?: string }> {
  const res = await fetch(`${API_BASE}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona, question, history, quote }),
  })

  // Pre-stream errors come back as JSON (the server hadn't switched to SSE yet).
  if (!res.ok || !res.body) {
    let message = `Answer failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {}
    yield { error: message }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE events are separated by a blank line (\n\n). Process any complete
      // events in the buffer; keep the partial tail for the next chunk.
      let sep: number
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        // Each event line is "data: <json>". Parse the JSON payload.
        for (const line of rawEvent.split("\n")) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data:")) continue
          const jsonStr = trimmed.slice(5).trim()
          if (!jsonStr) continue
          try {
            const ev = JSON.parse(jsonStr) as {
              type: "delta" | "done" | "error"
              text?: string
              answer?: string
              error?: string
            }
            if (ev.type === "delta" && ev.text) yield { delta: ev.text }
            else if (ev.type === "done" && ev.answer !== undefined) yield { done: ev.answer }
            else if (ev.type === "error" && ev.error) yield { error: ev.error }
          } catch {
            // Malformed event line — skip. Shouldn't happen with our server.
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}


