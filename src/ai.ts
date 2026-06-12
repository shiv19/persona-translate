import OpenAI from "openai"
import type { Persona, Message } from "./types"

const client = new OpenAI({
  apiKey: import.meta.env.VITE_ZAI_API_KEY,
  baseURL: "https://api.z.ai/api/coding/paas/v4",
  dangerouslyAllowBrowser: true,
})

const MODEL = "glm-5.1"
const MAX_HISTORY = 5

function buildSystemPrompt(persona: Persona): string {
  return `You are a expert translator specializing in ${persona.targetLanguage}.

The user is communicating with someone specific. Here is the context:

- Person's name/role: ${persona.name}
- Relationship to user: ${persona.relationship}
- Additional context: ${persona.context}

IMPORTANT RULES:
1. Use the CORRECT honorifics, pronouns, and respect words for this specific relationship.
2. In ${persona.targetLanguage}, the choice of pronouns and address terms depends heavily on the relationship between speakers. Always choose forms appropriate for "${persona.relationship}".
3. Translate naturally — not word-by-word — as a native speaker would address this person.
4. Only output the translation. No explanations, no notes, no romanization unless requested.
5. If the input is in ${persona.targetLanguage}, translate to ${persona.sourceLanguage}.
6. If the input is in ${persona.sourceLanguage}, translate to ${persona.targetLanguage}.`
}

function buildHistoryMessages(history: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return history.flatMap((msg): OpenAI.Chat.ChatCompletionMessageParam[] => [
    {
      role: "user",
      content: msg.original,
    },
    {
      role: "assistant",
      content: msg.translation,
    },
  ])
}

export async function translate(
  persona: Persona,
  input: string,
  history: Message[],
): Promise<string> {
  const recentHistory = history.slice(-MAX_HISTORY)

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(persona) },
    ...buildHistoryMessages(recentHistory),
    { role: "user", content: input },
  ]

  const response = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.3,
  })

  return response.choices[0]?.message?.content?.trim() ?? ""
}
