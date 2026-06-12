export interface Persona {
  id: string
  name: string
  targetLanguage: string
  sourceLanguage: string
  relationship: string
  context: string
  createdAt: number
}

export interface Message {
  id: string
  personaId: string
  original: string
  translation: string
  direction: "to-target" | "from-target"
  createdAt: number
}

export type Screen =
  | { view: "home" }
  | { view: "create-persona" }
  | { view: "edit-persona"; personaId: string }
  | { view: "chat"; personaId: string }
