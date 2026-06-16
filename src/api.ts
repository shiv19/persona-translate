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

export async function askViaApi(
  persona: Persona,
  question: string,
  history: Message[] = [],
  quote?: { original: string; translation: string },
): Promise<{ answer: string }> {
  const res = await fetch(`${API_BASE}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona, question, history, quote }),
  })

  if (!res.ok) {
    let message = `Answer failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {}
    throw new Error(message)
  }

  return (await res.json()) as { answer: string }
}

