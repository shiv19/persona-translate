import OpenAI from "openai"
import { z } from "zod"
import { withRetry } from "./retry.js"

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
// Zod contract for the translation result.
//
// We use Function Calling (tools) rather than response_format: json_object,
// because json_object only guarantees valid JSON — it does NOT enforce the
// schema, so GLM-5.2 happily returns {"translation":"..."} and omits every
// debug field. With tools, the model must populate arguments matching the
// JSON Schema, so the debug fields actually come back populated.
// ---------------------------------------------------------------------------

const TranslationResult = z.object({
  translation: z
    .string()
    .describe("The final natural translation only — no notes, no romanization"),
  speaker: z
    .enum(["user", "other-person"])
    .describe("Who is speaking this message — 'user' if the user is speaking, 'other-person' if the persona is speaking"),
  register: z
    .string()
    .describe("The level of formality/respect chosen for this relationship (e.g. formal, polite, casual, intimate) and a one-sentence reason it fits"),
  honorificsUsed: z
    .string()
    .describe("The specific honorifics, pronouns, and address terms used in the translation. Explain the choices briefly."),
  referents: z
    .string()
    .describe("Third parties mentioned in the message (not the speaker or listener). For each: who they are, their relationship to the LISTENER, and the kinship/address term used. Write 'none' if no third parties are mentioned."),
})

export type TranslationDebugParsed = Omit<z.infer<typeof TranslationResult>, "translation">

export interface TranslateOutput {
  translation: string
  debug: TranslationDebugParsed | null
}

// The tool definition passed to the API. GLM is constrained to return
// arguments matching this schema via tool_calls[0].function.arguments.
const TRANSLATION_TOOL = {
  type: "function" as const,
  function: {
    name: "record_translation",
    description: "Record the completed translation along with the linguistic choices made (speaker, register, honorifics, referents). You MUST call this tool to return your translation — do not output the translation as plain text.",
    parameters: {
      type: "object",
      properties: {
        translation: { type: "string", description: "The final natural translation only — no notes, no romanization" },
        speaker: { type: "string", enum: ["user", "other-person"], description: "'user' if the user is speaking, 'other-person' if the persona is speaking" },
        register: { type: "string", description: "The level of formality/respect chosen (e.g. formal, polite, casual, intimate) and a one-sentence reason it fits" },
        honorificsUsed: { type: "string", description: "The specific honorifics, pronouns, and address terms used in the translation, with brief explanation" },
        referents: { type: "string", description: "Third parties mentioned and the kinship/address terms used for them, or 'none'" },
      },
      required: ["translation", "speaker", "register", "honorificsUsed", "referents"],
    },
  },
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

  // addressTerm is listener-relative: it describes how the SPEAKER addresses the
  // LISTENER. So in to-target (user→persona) it's how the user addresses the
  // persona; in from-target (persona→user) it's how the persona addresses the
  // user. We must attach it to whoever is actually the listener.
  //
  // The override is a USER preference for how *they* address the persona. We do
  // NOT force the persona to use the same term in reverse — the persona uses the
  // reverseRelationship to derive the correct term for the user.
  const addressOverride = persona.addressTerm?.trim()

  let addressLine: string
  if (speakerIsUser) {
    // User is speaking → listener is the persona. addressTerm applies here.
    addressLine = addressOverride
      ? `HOW TO ADDRESS THE LISTENER (${persona.name}): When the user directly addresses ${persona.name}, use the EXACT term "${addressOverride}". Non-negotiable — never substitute it.`
      : `HOW TO ADDRESS THE LISTENER (${persona.name}): Derive the correct ${persona.targetLanguage} kinship/address term for ${persona.name} from the relationship. NEVER default to a generic elder term (Vietnamese "Bà"/"Ông") when a precise kinship term exists — a mother-in-law is "Mẹ", not "Bà".`
  } else {
    // Persona is speaking → listener is the user. addressTerm does NOT apply
    // (it was the user's choice for addressing the persona, not vice versa).
    // The persona derives the user's term from reverseRelationship.
    addressLine = `HOW TO ADDRESS THE LISTENER (the user): Derive the correct ${persona.targetLanguage} kinship/address term for the USER from "${persona.reverseRelationship || persona.relationship}". This is how ${persona.name} addresses the user — it is generally DIFFERENT from how the user addresses ${persona.name}.`
  }

  // First-person guidance: when a younger-generation speaker addresses an elder,
  // they refer to themselves with the humble/younger term (Vietnamese "con"),
  // NEVER with a third-person descriptor like "mẹ vợ" (wife's mother).
  const firstPersonLine = `FIRST-PERSON SELF-REFERENCE: The speaker refers to THEMSELVES using the correct first-person pronoun for this relationship in ${persona.targetLanguage} — never in the third person, never by their role title. (Vietnamese: a younger speaker addressing an elder uses "con" for themselves, NOT "mẹ vợ"/"con rể" — those are descriptors others use about them, not words they call themselves.)`

  return `You are an expert translator specializing in ${persona.targetLanguage}.

The current message is spoken by ${speakerName} and addressed to ${listenerName}.

Context:
- ${speakerRelationship}
- ${addressLine}
- ${firstPersonLine}
- Additional context: ${persona.context}${buildPeopleRoster(persona, direction)}

IMPORTANT RULES:
1. DETECT THE INPUT LANGUAGE and translate INTO THE OTHER language — never echo the input language. If the input is ${persona.sourceLanguage}, output ${persona.targetLanguage}. If the input is ${persona.targetLanguage}, output ${persona.sourceLanguage}.
2. PRONOUNS ARE DIRECTION-RELATIVE: The term for addressing the listener is in "HOW TO ADDRESS THE LISTENER" above. The speaker's self-reference is in "FIRST-PERSON SELF-REFERENCE". These are generally DIFFERENT terms. Never confuse speaker-self with listener-address.
3. CONCISE & NATURAL: Translate what was said — nothing more. No added pleasantries, no expansions. Match the source's length and tone.
4. When the message mentions OTHER PEOPLE (not the speaker or listener), check the people roster first (it is authoritative). Refer to them using the KINSHIP TERM matching their relationship to the LISTENER. NEVER use dismissive classifiers (Vietnamese: never "thằng"/"con" for the listener's family — use "cháu"/"bé").
5. Earlier messages may contain mistakes. Re-derive all pronouns and address terms from these rules every time — never copy from history.
6. You MUST return your result by calling the record_translation tool. Fill every field: decide speaker, address term, self-reference, register, and referents FIRST (committing to the correct kinship terms before translating), then produce the translation. The "translation" field contains only the translated text.`
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

  const response = await withRetry(() =>
    client().chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.3,
      tools: [TRANSLATION_TOOL],
      // Z.ai only supports "auto", but with exactly one tool defined and the
      // system prompt instructing the model to call it, GLM reliably invokes it.
      tool_choice: "auto",
      // Z.ai-specific: disable GLM-5.2 reasoning/thinking tokens for speed.
      ...({ thinking: { type: "disabled" } } as object),
    }),
  )

  const message = response.choices[0]?.message

  // Primary path: parse the tool call arguments (schema-enforced).
  // Narrow to the function-tool variant — the union also has a "custom" variant.
  const toolCall = message?.tool_calls?.[0]
  if (toolCall && toolCall.type === "function" && "function" in toolCall) {
    const parsed = parseToolArguments(toolCall.function.arguments)
    if (parsed) {
      const { translation, ...debug } = parsed
      return { translation: translation.trim(), debug }
    }
  }

  // Fallback: if the model emitted plain content instead of a tool call (rare,
  // but happens), salvage a translation from the text using the lenient parser.
  const raw = message?.content ?? ""
  const parsed = parseTranslation(raw)
  if (parsed) {
    const { translation, ...debug } = parsed
    return {
      translation: translation.trim(),
      debug: hasDebugFields(debug) ? debug : null,
    }
  }

  return { translation: "", debug: null }
}

/** Type guard: only report debug if at least one field is populated. */
function hasDebugFields(d: Partial<TranslationDebugParsed>): d is TranslationDebugParsed {
  return Boolean(d.speaker || d.register || d.honorificsUsed || d.referents)
}

/**
 * Parse the tool call's function arguments (a JSON string) against the Zod
 * schema. This is the schema-enforced path — all required fields should be
 * present. We still validate defensively in case the model returns malformed JSON.
 */
function parseToolArguments(argsJson: string) {
  try {
    const obj = JSON.parse(argsJson)
    const result = TranslationResult.safeParse(obj)
    return result.success ? result.data : null
  } catch {
    return null
  }
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
