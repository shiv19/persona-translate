import type { Persona, Message } from "./types"

const PERSONAS_KEY = "pt_personas"
const MESSAGES_KEY = "pt_messages"

export function loadPersonas(): Persona[] {
  try {
    const raw = localStorage.getItem(PERSONAS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function savePersonas(personas: Persona[]): void {
  localStorage.setItem(PERSONAS_KEY, JSON.stringify(personas))
}

export function loadMessages(personaId: string): Message[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY)
    const all: Message[] = raw ? JSON.parse(raw) : []
    return all.filter((m) => m.personaId === personaId)
  } catch {
    return []
  }
}

export function saveMessage(message: Message): void {
  const raw = localStorage.getItem(MESSAGES_KEY)
  const all: Message[] = raw ? JSON.parse(raw) : []
  all.push(message)
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(all))
}

export function clearMessages(personaId: string): void {
  const raw = localStorage.getItem(MESSAGES_KEY)
  const all: Message[] = raw ? JSON.parse(raw) : []
  const filtered = all.filter((m) => m.personaId !== personaId)
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(filtered))
}

export function deleteMessage(messageId: string): void {
  const raw = localStorage.getItem(MESSAGES_KEY)
  const all: Message[] = raw ? JSON.parse(raw) : []
  const filtered = all.filter((m) => m.id !== messageId)
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(filtered))
}

export function deletePersona(personaId: string): void {
  const personas = loadPersonas().filter((p) => p.id !== personaId)
  savePersonas(personas)
  clearMessages(personaId)
}
