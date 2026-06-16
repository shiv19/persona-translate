import type { Persona, Message, Favorite, Conversation } from "./types"
import { uid } from "./types"

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

/**
 * Load messages for a persona, optionally scoped to a conversation.
 * - conversationId provided: return only that conversation's messages.
 * - conversationId omitted: return messages with NO conversationId (legacy)
 *   plus any whose conversationId is undefined — i.e. the "active draft"
 *   bucket. Callers that know the active conversation pass it explicitly.
 */
export function loadMessages(personaId: string, conversationId?: string): Message[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY)
    const all: Message[] = raw ? JSON.parse(raw) : []
    return all.filter((m) => {
      if (m.personaId !== personaId) return false
      if (conversationId === undefined) return m.conversationId === undefined
      return m.conversationId === conversationId
    })
  } catch {
    return []
  }
}

/** Load all messages for a conversation across the flat store. */
export function loadConversationMessages(conversationId: string): Message[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY)
    const all: Message[] = raw ? JSON.parse(raw) : []
    return all.filter((m) => m.conversationId === conversationId)
  } catch {
    return []
  }
}

export function saveMessage(message: Message): void {
  const raw = localStorage.getItem(MESSAGES_KEY)
  const all: Message[] = raw ? JSON.parse(raw) : []
  all.push(message)
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(all))
  // Keep the conversation's updatedAt in sync so recency sort is accurate.
  if (message.conversationId) touchConversation(message.conversationId)
}

/**
 * Clear messages. With a conversationId, clears only that conversation's
 * messages. Without, clears ALL messages for the persona (used by deletePersona).
 */
export function clearMessages(personaId: string, conversationId?: string): void {
  const raw = localStorage.getItem(MESSAGES_KEY)
  const all: Message[] = raw ? JSON.parse(raw) : []
  const filtered = all.filter((m) => {
    if (conversationId !== undefined) {
      // Remove only this conversation's messages
      return !(m.personaId === personaId && m.conversationId === conversationId)
    }
    return m.personaId !== personaId
  })
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
  clearConversations(personaId)
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

// ---------------------------------------------------------------------------
// CONVERSATIONS
//
// A Conversation groups messages into threads scoped to a persona. Messages
// carry an optional conversationId; legacy messages (none) are treated as the
// active draft. The active conversation is the most recently updated one, or a
// lazily-created one on first message. "New Chat" archives the current
// conversation (it stays in history) and starts a fresh one.
//
// Storage follows the favorites/seen pattern: private loadAll/saveAll, public
// filtered API. Sort order is pinned-first, then updatedAt desc.
// ---------------------------------------------------------------------------

const CONVERSATIONS_KEY = "pt_conversations"

function loadAllConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveAllConversations(all: Conversation[]): void {
  localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(all))
}

/** Conversations for a persona, sorted pinned-first then by updatedAt desc. */
export function loadConversations(personaId: string): Conversation[] {
  return loadAllConversations()
    .filter((c) => c.personaId === personaId)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
}

export function getConversation(id: string): Conversation | undefined {
  return loadAllConversations().find((c) => c.id === id)
}

/** Upsert a conversation record. */
export function saveConversation(conv: Conversation): void {
  const all = loadAllConversations()
  const idx = all.findIndex((c) => c.id === conv.id)
  if (idx >= 0) all[idx] = conv
  else all.push(conv)
  saveAllConversations(all)
}

export function renameConversation(id: string, title: string): void {
  const all = loadAllConversations()
  const conv = all.find((c) => c.id === id)
  if (conv) {
    conv.title = title
    saveAllConversations(all)
  }
}

export function toggleConversationPin(id: string): void {
  const all = loadAllConversations()
  const conv = all.find((c) => c.id === id)
  if (conv) {
    conv.pinned = !conv.pinned
    saveAllConversations(all)
  }
}

/** Bump a conversation's updatedAt (called from saveMessage). No-op if missing. */
export function touchConversation(id: string): void {
  const all = loadAllConversations()
  const conv = all.find((c) => c.id === id)
  if (conv) {
    conv.updatedAt = Date.now()
    saveAllConversations(all)
  }
}

/**
 * Delete a conversation and all its messages. Returns the deleted messages so
 * the caller can offer undo (re-save both on undo).
 */
export function deleteConversation(id: string): Message[] {
  const deletedMessages = loadConversationMessages(id)
  // Remove the conversation record
  saveAllConversations(loadAllConversations().filter((c) => c.id !== id))
  // Remove its messages
  const raw = localStorage.getItem(MESSAGES_KEY)
  const all: Message[] = raw ? JSON.parse(raw) : []
  localStorage.setItem(
    MESSAGES_KEY,
    JSON.stringify(all.filter((m) => m.conversationId !== id)),
  )
  return deletedMessages
}

/** Restore a conversation and its messages (undo). */
export function restoreConversation(conv: Conversation, messages: Message[]): void {
  saveConversation(conv)
  if (messages.length > 0) {
    const raw = localStorage.getItem(MESSAGES_KEY)
    const all: Message[] = raw ? JSON.parse(raw) : []
    localStorage.setItem(MESSAGES_KEY, JSON.stringify([...all, ...messages]))
  }
}

/**
 * Get the active conversation for a persona, creating one lazily if none exists.
 * The active conversation is the most recently updated; if there are none, a
 * fresh empty one is created. Title is derived from the first message once one
 * exists (left empty until then — the UI falls back to "New conversation").
 */
export function getOrCreateActiveConversation(personaId: string): Conversation {
  const existing = loadAllConversations()
    .filter((c) => c.personaId === personaId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  if (existing.length > 0) return existing[0]

  const now = Date.now()
  const conv: Conversation = {
    id: uid(),
    personaId,
    title: "",
    pinned: false,
    createdAt: now,
    updatedAt: now,
  }
  saveConversation(conv)
  return conv
}

/** Create a fresh empty conversation and return it. Used by "New Chat". */
export function createConversation(personaId: string, title = ""): Conversation {
  const now = Date.now()
  const conv: Conversation = {
    id: uid(),
    personaId,
    title,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  }
  saveConversation(conv)
  return conv
}

/**
 * Derive a conversation title from its first message (verbatim, truncated).
 * No AI call — cheap and deterministic. Returns empty string if no messages.
 */
export function deriveConversationTitle(messages: Message[]): string {
  const first = messages.find((m) => m.original?.trim())
  if (!first) return ""
  const title = first.original.trim()
  return title.length > 60 ? title.slice(0, 60) + "…" : title
}

/** Ensure a conversation has a title; if its title is empty, derive one. */
export function ensureConversationTitle(conv: Conversation): Conversation {
  if (conv.title.trim()) return conv
  const messages = loadConversationMessages(conv.id)
  const title = deriveConversationTitle(messages)
  if (title) {
    const updated = { ...conv, title }
    saveConversation(updated)
    return updated
  }
  return conv
}

function clearConversations(personaId: string): void {
  saveAllConversations(loadAllConversations().filter((c) => c.personaId !== personaId))
}
