import type { Persona, Message, TranslationDebug, Suggestion } from "./types"
import { translateViaApi, suggestViaApi } from "./api"

// Re-export so existing imports (`import { translate, TranslationDebug } from "../ai"`)
// keep working. The canonical definition lives in ./types.
export type { TranslationDebug, Suggestion }

// How many previous turns the server includes as context. Exported so the UI
// can show an accurate hint without duplicating the literal. Mirrors
// server/zai.ts; both must stay in sync.
export const MAX_HISTORY = 5

// Default batch size for situational suggestions. The server clamps to [1, 5].
export const SUGGEST_BATCH = 3

export interface TranslateOutput {
  translation: string
  debug: TranslationDebug | null
}

/**
 * Translate `input` using the active persona. The actual model call happens
 * server-side (see server/zai.ts) — the client never sees the API key.
 */
export async function translate(
  persona: Persona,
  input: string,
  history: Message[],
  direction: "to-target" | "from-target",
): Promise<TranslateOutput> {
  return translateViaApi(persona, input, history, direction)
}

/**
 * Generate situational phrase suggestions for `situation`. `avoid` is the list
 * of phrase originals the user has already seen (saved or discarded) for this
 * persona, so the model doesn't repeat itself across batches. `direction`
 * controls whose perspective the phrases come from: to-target = the user
 * speaking (production practice), from-target = the persona speaking
 * (comprehension practice). `history` is the recent conversation — it anchors
 * the kinship terms so the model doesn't default to generic pronouns.
 */
export async function suggest(
  persona: Persona,
  situation: string,
  avoid: string[] = [],
  count = SUGGEST_BATCH,
  direction: "to-target" | "from-target" = "to-target",
  history: Message[] = [],
): Promise<Suggestion[]> {
  const { suggestions } = await suggestViaApi(persona, situation, avoid, count, direction, history)
  return suggestions
}
