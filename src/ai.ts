import type { Persona, Message, TranslationDebug } from "./types"
import { translateViaApi } from "./api"

// Re-export so existing imports (`import { translate, TranslationDebug } from "../ai"`)
// keep working. The canonical definition lives in ./types.
export type { TranslationDebug }

// How many previous turns the server includes as context. Exported so the UI
// can show an accurate hint without duplicating the literal. Mirrors
// server/zai.ts; both must stay in sync.
export const MAX_HISTORY = 5

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
