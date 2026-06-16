import type { Persona, Message, Favorite } from "./types"

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
  clearFavorites(personaId)
  clearSeenPhrases(personaId)
}

const FAVORITES_KEY = "pt_favorites"

function loadAllFavorites(): Favorite[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveAllFavorites(favs: Favorite[]): void {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs))
}

export function loadFavorites(personaId: string): Favorite[] {
  return loadAllFavorites().filter((f) => f.personaId === personaId)
}

export function isFavorited(original: string, translation: string): boolean {
  return loadAllFavorites().some(
    (f) => f.original === original && f.translation === translation,
  )
}

export function saveFavorite(fav: Favorite): void {
  const all = loadAllFavorites()
  all.push(fav)
  saveAllFavorites(all)
}

export function removeFavorite(favoriteId: string): void {
  const all = loadAllFavorites()
  saveAllFavorites(all.filter((f) => f.id !== favoriteId))
}

export function removeFavoriteByContent(original: string, translation: string): void {
  const all = loadAllFavorites()
  saveAllFavorites(
    all.filter((f) => !(f.original === original && f.translation === translation)),
  )
}

export function updateFavorite(favoriteId: string, updates: { notes?: string; tags?: string[] }): void {
  const all = loadAllFavorites()
  const fav = all.find((f) => f.id === favoriteId)
  if (fav) {
    if (updates.notes !== undefined) fav.notes = updates.notes
    if (updates.tags !== undefined) fav.tags = updates.tags
    saveAllFavorites(all)
  }
}

function clearFavorites(personaId: string): void {
  saveAllFavorites(loadAllFavorites().filter((f) => f.personaId !== personaId))
}

// ---------------------------------------------------------------------------
// Seen-phrases — the anti-repeat list for situational suggestions.
//
// When the user saves or discards a suggested phrase, its `original` is added
// here so the server is told NOT to regenerate it next time. This is invisible
// to the user (it never renders) and is independent of conversation history —
// clearing the chat does NOT clear seen-phrases, only deleting the persona does.
// Keepers also live on as Favorites (tagged "suggested"); this list exists
// purely so discarded ones aren't suggested again.
// ---------------------------------------------------------------------------

const SEEN_KEY = "pt_seen_phrases"

interface SeenPhraseRecord {
  personaId: string
  original: string
}

function loadAllSeen(): SeenPhraseRecord[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveAllSeen(all: SeenPhraseRecord[]): void {
  localStorage.setItem(SEEN_KEY, JSON.stringify(all))
}

export function loadSeenPhrases(personaId: string): string[] {
  return loadAllSeen()
    .filter((s) => s.personaId === personaId)
    .map((s) => s.original)
}

export function addSeenPhrase(personaId: string, original: string): void {
  const trimmed = original.trim()
  if (!trimmed) return
  const all = loadAllSeen()
  const exists = all.some((s) => s.personaId === personaId && s.original === trimmed)
  if (!exists) {
    all.push({ personaId, original: trimmed })
    saveAllSeen(all)
  }
}

export function clearSeenPhrases(personaId: string): void {
  saveAllSeen(loadAllSeen().filter((s) => s.personaId !== personaId))
}
