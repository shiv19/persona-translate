import OpenAI from "openai"
import { z } from "zod"
import { zodResponseFormat } from "openai/helpers/zod"
import type { Persona, Message } from "./types"

const client = new OpenAI({
  apiKey: import.meta.env.VITE_ZAI_API_KEY,
  // baseURL: "https://api.z.ai/api/coding/paas/v4",
  baseURL: "https://openrouter.ai/api/v1",
  dangerouslyAllowBrowser: true,
})

// const MODEL = "glm-5.1"
const MODEL = "deepseek/deepseek-v4-pro"
const MAX_HISTORY = 5

const TranslationResult = z.object({
  speaker: z
    .enum(["user", "other-person"])
    .describe("Who is speaking this message — determines translation direction and pronoun/honorific choice"),
  register: z
    .string()
    .describe("The level of formality/respect chosen for this relationship (e.g. formal, polite, casual, intimate) and why it fits"),
  honorificsUsed: z
    .string()
    .describe("The specific honorifics, pronouns, and address terms used, appropriate for the relationship"),
  referents: z
    .string()
    .describe("Third parties mentioned in the message (not the speaker or listener). For each: who they are according to the persona context, their relationship to the LISTENER, and the correct kinship/address term to refer to them from the listener's perspective. The translation MUST use exactly this term. 'none' if no third parties are mentioned"),
  translation: z
    .string()
    .describe("The final natural translation only — no notes, no romanization"),
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

  const response = await client.chat.completions.parse({
    model: MODEL,
    messages,
    temperature: 0.3,
    response_format: zodResponseFormat(TranslationResult, "translation_result"),
    reasoning_effort: "none",
    thinking: { type: "disabled" }
  })

  const parsed = response.choices[0]?.message?.parsed
  if (!parsed) return { translation: "", debug: null }

  const { translation, ...debug } = parsed
  return { translation: translation.trim(), debug }
}
