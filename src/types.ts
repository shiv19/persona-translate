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
  /** Which conversation this message belongs to. Optional so legacy messages
   *  (created before conversations existed) remain valid — they're treated as
   *  belonging to the persona's active conversation at read time. */
  conversationId?: string
}

// Canonical definition of the translation debug shape. `ai.ts` re-exports this
// so the two modules never diverge.
export interface TranslationDebug {
  speaker?: string
  register?: string
  honorificsUsed?: string
  referents?: string
}

export interface Favorite {
  id: string
  personaId: string
  original: string
  translation: string
  direction: "to-target" | "from-target"
  debug?: TranslationDebug | null
  notes?: string
  tags?: string[]
  createdAt: number
}

// A situational phrase suggestion returned by the server. Ephemeral UI state —
// never persisted directly. When the user keeps one, it graduates into a
// Favorite (tagged "suggested"); when discarded, its `original` is recorded in
// the per-persona seen-phrases list so the server avoids regenerating it.
export interface Suggestion {
  original: string
  translation: string
  register?: string
  honorificsUsed?: string
  note?: string
}

// A saved conversation thread scoped to a persona. Messages carry a
// conversationId linking them here. Title defaults to the first message
// verbatim (truncated); user-renameable. Pinned conversations sort first.
// updatedAt is bumped on each message save and drives recency ordering.
export interface Conversation {
  id: string
  personaId: string
  title: string
  pinned: boolean
  createdAt: number
  updatedAt: number
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
  | { view: "favorites"; personaId: string }
  | { view: "history"; personaId: string }
