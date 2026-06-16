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

// ---------------------------------------------------------------------------
// Audio recording + transcription helpers.
//
// The WAV encoding stays client-side (it only needs the AudioContext). The
// network call goes through our backend so the key stays server-side.
// ---------------------------------------------------------------------------

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, "data")
  view.setUint32(40, samples.length * 2, true)

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return buffer
}

async function blobToWav(blob: Blob): Promise<Blob> {
  const audioCtx = new AudioContext()
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
    const samples = audioBuffer.getChannelData(0)
    const wavBuffer = encodeWav(samples, audioBuffer.sampleRate)
    return new Blob([wavBuffer], { type: "audio/wav" })
  } finally {
    audioCtx.close()
  }
}

export async function transcribeViaApi(audioBlob: Blob): Promise<string> {
  const wavBlob = await blobToWav(audioBlob)

  const formData = new FormData()
  formData.append("file", wavBlob, "recording.wav")

  const res = await fetch(`${API_BASE}/api/asr`, {
    method: "POST",
    body: formData,
  })

  if (!res.ok) {
    let message = `Transcription failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {}
    throw new Error(message)
  }

  const data = (await res.json()) as { text?: string }
  return data.text ?? ""
}
