import OpenAI from "openai"
import { z } from "zod"
import type { Persona, Message } from "./types"

const BASE_URL = import.meta.env.VITE_ZAI_BASE_URL || "https://api.z.ai/api/coding/paas/v4"
const IS_ZAI = BASE_URL.includes("z.ai")

const client = new OpenAI({
  apiKey: import.meta.env.VITE_ZAI_API_KEY,
  baseURL: BASE_URL,
  dangerouslyAllowBrowser: true,
})

const MODEL = import.meta.env.VITE_ZAI_MODEL || "glm-5.2"
const MAX_HISTORY = 5

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

export type TranslationDebug = Omit<z.infer<typeof TranslationResult>, "translation">

export interface TranslateOutput {
  translation: string
  debug: TranslationDebug | null
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

  return `You are a expert translator specializing in ${persona.targetLanguage}.

The current message is spoken by ${speakerName} and addressed to ${listenerName}.

Context:
- ${speakerRelationship}
- Additional context: ${persona.context}${buildPeopleRoster(persona, direction)}

IMPORTANT RULES:
1. Use the CORRECT honorifics, pronouns, and respect words for this specific relationship.
2. In ${persona.targetLanguage}, the choice of pronouns and address terms depends heavily on the relationship between speakers. Always choose forms appropriate for "${persona.relationship}".
3. Translate naturally — not word-by-word — as a native speaker would address this person.
4. TRANSLATION DIRECTION IS FIXED: [${persona.sourceLanguage} — You speaking] → output in ${persona.targetLanguage}. [${persona.targetLanguage} — ${persona.name} speaking] → output in ${persona.sourceLanguage}. Never output in the same language as the input.
5. When the message mentions OTHER PEOPLE (not the speaker or listener), check the people roster first (it is authoritative), then the persona context. Refer to them using the KINSHIP TERM that matches their relationship to the LISTENER — e.g. if the listener's grandchild is mentioned, use the word for "grandchild" (+ name), with an affectionate register. NEVER use dismissive, distancing, or generic classifiers (in Vietnamese: never "thằng"/"con" for the listener's own family — use the kinship term like "cháu"/"bé" instead).
6. Earlier messages in this conversation may contain translation mistakes. Do NOT copy pronoun or address-term choices from history — re-derive them from these rules every time.
7. Respond with JSON. Decide speaker, register, and honorifics FIRST, then produce the translation consistent with those choices. The "translation" field must contain only the translated text.`
}

function buildHistoryMessages(persona: Persona, history: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return history.flatMap((msg): OpenAI.Chat.ChatCompletionMessageParam[] => {
    const speakerLabel = msg.direction === "to-target"
      ? `[${persona.sourceLanguage} — You speaking]`
      : `[${persona.targetLanguage} — ${persona.name} speaking]`

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

export async function translate(
  persona: Persona,
  input: string,
  history: Message[],
  direction: "to-target" | "from-target",
): Promise<TranslateOutput> {
  const recentHistory = history.slice(-MAX_HISTORY)

  const speakerLabel = direction === "to-target"
    ? `[${persona.sourceLanguage} — You speaking]`
    : `[${persona.targetLanguage} — ${persona.name} speaking]`

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(persona, direction) },
    ...buildHistoryMessages(persona, recentHistory),
    { role: "user", content: `${speakerLabel} ${input}` },
  ]

  const response = await client.chat.completions.create({
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
