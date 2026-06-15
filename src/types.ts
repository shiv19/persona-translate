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

export interface PersonaPerson {
  name: string
  relationToListener: string
  relationToSpeaker?: string
  notes?: string
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

// Canonical definition of the translation debug shape. `ai.ts` re-exports this
// so the two modules never diverge.
export interface TranslationDebug {
  speaker?: string
  register?: string
  honorificsUsed?: string
  referents?: string
}

export function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

export type Screen =
  | { view: "home" }
  | { view: "create-persona" }
  | { view: "edit-persona"; personaId: string }
  | { view: "chat"; personaId: string }
