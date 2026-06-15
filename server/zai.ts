import OpenAI from "openai"
import { z } from "zod"

// Server-only: the API key lives in process.env and is NEVER sent to the browser.
const BASE_URL = process.env.ZAI_BASE_URL || "https://api.z.ai/api/coding/paas/v4"
const IS_ZAI = BASE_URL.includes("z.ai")

const MODEL = process.env.ZAI_MODEL || "glm-5.2"
export const MAX_HISTORY = 5

// Lazily construct the OpenAI client so a missing ZAI_API_KEY doesn't crash
// the process on boot — it only fails if a request actually needs the key.
let _client: OpenAI | null = null
function client(): OpenAI {
  if (!_client) {
    if (!process.env.ZAI_API_KEY) {
      throw new Error("Server is missing ZAI_API_KEY")
    }
    _client = new OpenAI({ apiKey: process.env.ZAI_API_KEY, baseURL: BASE_URL })
  }
  return _client
}

// ---------------------------------------------------------------------------
// Shared types — mirrored from src/types.ts. The server cannot import client
// code, so we redeclare the minimal shape it needs.
// ---------------------------------------------------------------------------

export interface PersonaPerson {
  name: string
  relationToListener: string
  relationToSpeaker?: string
  notes?: string
}

export interface Persona {
  id: string
  name: string
  targetLanguage: string
  sourceLanguage: string
  relationship: string
  reverseRelationship: string
  context: string
  /** Optional explicit term the user uses to address this person (e.g. "Mẹ", "Bác 3"). When set, the translator treats it as authoritative. */
  addressTerm?: string
  people?: PersonaPerson[]
  createdAt: number
}

export interface Message {
  id: string
  personaId: string
  original: string
  translation: string
  direction: "to-target" | "from-target"
  createdAt: number
  debug?: TranslationDebug | null
}

export interface TranslationDebug {
  speaker?: string
  register?: string
  honorificsUsed?: string
  referents?: string
}

// ---------------------------------------------------------------------------
// Zod contract + parsing — moved verbatim from the old src/ai.ts.
// ---------------------------------------------------------------------------

const TranslationResult = z.object({
  translation: z
    .string()
    .describe("The final natural translation only — no notes, no romanization"),
  // Debug/diagnostic fields — optional because GLM often returns only the
  // translation. They're nice-to-have for the UI, not load-bearing.
  speaker: z
    .enum(["user", "other-person"])
    .describe("Who is speaking this message — determines translation direction and pronoun/honorific choice")
    .optional(),
  register: z
    .string()
    .describe("The level of formality/respect chosen for this relationship (e.g. formal, polite, casual, intimate) and why it fits")
    .optional(),
  honorificsUsed: z
    .string()
    .describe("The specific honorifics, pronouns, and address terms used, appropriate for the relationship")
    .optional(),
  referents: z
    .string()
    .describe("Third parties mentioned in the message (not the speaker or listener). For each: who they are according to the persona context, their relationship to the LISTENER, and the correct kinship/address term to refer to them from the listener's perspective. The translation MUST use exactly this term. 'none' if no third parties are mentioned")
    .optional(),
})

export type TranslationDebugParsed = Omit<z.infer<typeof TranslationResult>, "translation">

export interface TranslateOutput {
  translation: string
  debug: TranslationDebugParsed | null
}

function buildPeopleRoster(persona: Persona, direction: "to-target" | "from-target"): string {
  const people = persona.people?.filter((p) => p.name.trim() && p.relationToListener.trim()) ?? []
  if (people.length === 0) return ""

  const speakerIsUser = direction === "to-target"
  const listenerName = speakerIsUser ? persona.name : "the user"

  const lines = people.map((p) => {
    const note = p.notes?.trim() ? ` (${p.notes.trim()})` : ""
    const relation = speakerIsUser
      ? p.relationToListener
      : (p.relationToSpeaker || p.relationToListener)
    return `- ${p.name} — ${listenerName}'s ${relation}${note} → when mentioned, use the kinship/address term for "${relation}" from ${listenerName}'s perspective`
  })

  return `

PEOPLE WHO MAY BE MENTIONED (this roster is AUTHORITATIVE — relationships are relative to ${listenerName}, the listener):
${lines.join("\n")}`
}

function buildSystemPrompt(persona: Persona, direction: "to-target" | "from-target"): string {
  const speakerIsUser = direction === "to-target"
  const speakerName = speakerIsUser ? "the user" : persona.name
  const listenerName = speakerIsUser ? persona.name : "the user"
  const speakerRelationship = speakerIsUser
    ? `${persona.name}'s relationship to the user: ${persona.relationship}`
    : `The user's relationship to ${persona.name}: ${persona.reverseRelationship || persona.relationship}`

  // The listener's address term is the single most important lexical choice in
  // honorific languages. If the user supplied one explicitly, it is a HARD
  // override — never substitute it. Otherwise derive it from the relationship
  // and forbid generic elder fallbacks (the "Bà ơi for a mother-in-law" bug).
  const addressOverride = persona.addressTerm?.trim()
  const listenerAddressLine = addressOverride
    ? `HOW TO ADDRESS THE LISTENER: Use the EXACT term "${addressOverride}" when directly addressing ${persona.name}. This is non-negotiable — do NOT substitute it with any other kinship term, pronoun, or generic honorific, even if the relationship description seems to suggest otherwise. (The user has explicitly chosen this term.)`
    : `HOW TO ADDRESS THE LISTENER: Derive the correct ${persona.targetLanguage} kinship/address term for the listener from the relationship above. NEVER default to a generic elder term (Vietnamese: "Bà"/"Ông", Korean: "할머니"/"할아버지") when the relationship specifies a more precise one — e.g. a mother-in-law is addressed as "Mẹ" (or "mẹ vợ"/"mẹ chồng" per side), NOT "Bà". If you are unsure which specific term applies, prefer the kinship term over a generic one.`

  return `You are an expert translator specializing in ${persona.targetLanguage}.

The current message is spoken by ${speakerName} and addressed to ${listenerName}.

Context:
- ${speakerRelationship}
- ${listenerAddressLine}
- Additional context: ${persona.context}${buildPeopleRoster(persona, direction)}

IMPORTANT RULES:
1. DETECT THE INPUT LANGUAGE and translate INTO THE OTHER language — never echo the input language. If the input is ${persona.sourceLanguage}, output ${persona.targetLanguage}. If the input is ${persona.targetLanguage}, output ${persona.sourceLanguage}. The speaker label is only a hint about register; the actual text decides the source language.
2. ADDRESS TERM: Every direct address in the translation MUST use the term from "HOW TO ADDRESS THE LISTENER" above.
3. CONCISE & NATURAL: Translate what was said — nothing more. No added pleasantries, no expansions, no "brother/sister" insertions the speaker didn't say. Match the source's length and tone. A 4-word input should not become a 10-word translation.
4. When the message mentions OTHER PEOPLE (not the speaker or listener), check the people roster first (it is authoritative), then the persona context. Refer to them using the KINSHIP TERM that matches their relationship to the LISTENER. NEVER use dismissive, distancing, or generic classifiers (in Vietnamese: never "thằng"/"con" for the listener's own family — use the kinship term like "cháu"/"bé" instead).
5. Earlier messages in this conversation may contain translation mistakes. Do NOT copy pronoun or address-term choices from history — re-derive them from these rules every time.
6. Respond with JSON. The "translation" field must contain only the translated text.`
}

function buildHistoryMessages(persona: Persona, history: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return history.flatMap((msg): OpenAI.Chat.ChatCompletionMessageParam[] => {
    const speakerLabel = msg.direction === "to-target"
      ? `[You speaking to ${persona.name}]`
      : `[${persona.name} speaking to you]`

    return [
      {
        role: "user",
        content: `${speakerLabel} ${msg.original}`,
      },
      {
        role: "assistant",
        content: msg.translation,
      },
    ]
  })
}

export async function serverTranslate(
  persona: Persona,
  input: string,
  history: Message[],
  direction: "to-target" | "from-target",
): Promise<TranslateOutput> {
  const recentHistory = history.slice(-MAX_HISTORY)

  const speakerLabel = direction === "to-target"
    ? `[You speaking to ${persona.name}]`
    : `[${persona.name} speaking to you]`

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(persona, direction) },
    ...buildHistoryMessages(persona, recentHistory),
    { role: "user", content: `${speakerLabel} ${input}` },
  ]

  const response = await client().chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.3,
    // GLM often ignores response_format and wraps JSON in ```json fences, so we
    // don't rely on the SDK's structured-output parsing. We strip fences and parse
    // the raw content ourselves (see extractJson below).
    ...(IS_ZAI
      ? { response_format: { type: "json_object" } as const, reasoning_effort: "none", thinking: { type: "disabled" } }
      : {}),
  })

  const raw = response.choices[0]?.message?.content ?? ""
  const parsed = parseTranslation(raw)
  if (!parsed) return { translation: "", debug: null }

  const { translation, ...debug } = parsed
  return { translation: translation.trim(), debug }
}

/**
 * GLM frequently wraps JSON in ```json ... ``` fences or adds stray prose around it.
 * Extract the first {...} block and parse it; fall back to a direct parse.
 */
function extractJson(text: string): unknown | null {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {}

  // Strip a leading ```json / ``` fence if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim())
    } catch {}
  }

  // Grab the outermost { ... } span
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {}
  }
  return null
}

// GLM doesn't use a stable key name for the translated text — it has been seen
// returning "translation", "answer", "text", etc. Map any of these to "translation".
const TRANSLATION_KEYS = ["translation", "answer", "translated_text", "translatedText", "output", "text", "result", "message"]

function parseTranslation(text: string) {
  const json = extractJson(text)

  // Bare string response — treat it as the translation directly.
  if (typeof json === "string" && json.trim()) {
    return { translation: json.trim() }
  }

  if (!json || typeof json !== "object") return null
  const obj = json as Record<string, unknown>

  // Normalize alias keys → "translation"
  if (typeof obj.translation !== "string") {
    const alias = TRANSLATION_KEYS.find((k) => k !== "translation" && typeof obj[k] === "string")
    if (alias) obj.translation = obj[alias]
  }

  const result = TranslationResult.safeParse(obj)
  return result.success ? result.data : null
}

// ---------------------------------------------------------------------------
// ASR — moved from the old src/asr.ts. The key is now server-side.
// ---------------------------------------------------------------------------

export async function serverTranscribe(audio: Blob): Promise<string> {
  console.log("[ASR] Input:", audio.size, "bytes, type:", audio.type)

  const formData = new FormData()
  formData.append("model", "glm-asr-2512")
  formData.append("file", audio, "recording.wav")
  formData.append("stream", "false")

  const response = await fetch(`${BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ZAI_API_KEY}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const err = await response.text()
    console.error("[ASR] Error:", response.status, err)
    throw new Error(`ASR ${response.status}: ${err}`)
  }

  const data = (await response.json()) as { text?: string }
  console.log("[ASR] Response:", JSON.stringify(data))
  return data.text ?? ""
}
