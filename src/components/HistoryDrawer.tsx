import { useState, useRef, useCallback, useEffect } from "react"
import type { Persona, Conversation, Message } from "../types"
import {
  loadConversations,
  renameConversation,
  toggleConversationPin,
  deleteConversation,
  restoreConversation,
} from "../storage"
import { ArrowLeft, Pin, PinOff, Pencil, Trash2, X, Check } from "lucide-react"

const UNDO_DELAY = 5000

interface Props {
  persona: Persona
  activeConversationId?: string
  onSelect: (conversationId: string) => void
  onClose: () => void
}

// Snapshot for undo: the deleted conversation plus its messages, so both can be
// restored. Deleted messages are returned by deleteConversation for this purpose.
interface DeleteSnapshot {
  conversation: Conversation
  messages: Message[]
}

export function HistoryDrawer({ persona, activeConversationId, onSelect, onClose }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    loadConversations(persona.id),
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [pendingDelete, setPendingDelete] = useState<DeleteSnapshot | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(() => {
    setConversations(loadConversations(persona.id))
  }, [persona.id])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  function startEditing(conv: Conversation) {
    setEditingId(conv.id)
    setEditTitle(conv.title)
  }

  function saveEdit(id: string) {
    const title = editTitle.trim()
    if (title) {
      renameConversation(id, title)
      refresh()
    }
    setEditingId(null)
  }

  function handleTogglePin(id: string) {
    toggleConversationPin(id)
    refresh()
  }

  // Delete with 5s undo. The conversation + its messages are removed from
  // storage immediately; undo re-saves both. Only one pending delete at a time
  // — arming a new one commits any prior pending one permanently.
  const commitDelete = useCallback(() => {
    setPendingDelete(null)
  }, [])

  function handleDelete(conv: Conversation) {
    // If another delete is already pending, commit it (drop its undo window).
    if (pendingDelete && timerRef.current) {
      clearTimeout(timerRef.current)
    }
    const messages = deleteConversation(conv.id)
    setPendingDelete({ conversation: conv, messages })
    refresh()
    timerRef.current = setTimeout(commitDelete, UNDO_DELAY)
  }

  function handleUndo() {
    if (!pendingDelete) return
    if (timerRef.current) clearTimeout(timerRef.current)
    restoreConversation(pendingDelete.conversation, pendingDelete.messages)
    setPendingDelete(null)
    refresh()
  }

  function handleSelect(conv: Conversation) {
    // Don't navigate away if this row is mid-edit or pending delete.
    if (editingId === conv.id) return
    if (pendingDelete?.conversation.id === conv.id) return
    onSelect(conv.id)
  }

  return (
    <>
      {/* Backdrop: click to dismiss. Sits behind the panel via z-index. */}
      <div className="history-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="history-drawer" role="dialog" aria-label="Conversation history">
        <header className="chat-header">
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close history">
            <ArrowLeft size={20} />
          </button>
          <div className="chat-header-info">
            <h3>Conversations</h3>
            <span className="chat-header-meta">
              {persona.name} &middot; {conversations.length} saved
            </span>
          </div>
        </header>

        {pendingDelete && (
          <div className="history-undo-banner">
            <span>Conversation removed</span>
            <button className="btn btn-ghost btn-sm" onClick={handleUndo}>
              Undo
            </button>
          </div>
        )}

        <div className="history-list">
          {conversations.length === 0 && (
            <div className="chat-empty">
              <p>No conversations yet.</p>
              <p className="chat-empty-hint">
                Past chats with {persona.name} will appear here. Start a new chat from the chat
                header to archive the current one.
              </p>
            </div>
          )}

          {conversations.map((conv) => {
            const isPendingDelete = pendingDelete?.conversation.id === conv.id
            const isActive = conv.id === activeConversationId
            const displayTitle = conv.title.trim() || "New conversation"
            return (
              <div
                key={conv.id}
                className={`history-item ${conv.pinned ? "pinned" : ""} ${
                  isActive ? "active" : ""
                } ${isPendingDelete ? "pending-delete" : ""}`}
                onClick={() => handleSelect(conv)}
                role="button"
                tabIndex={isPendingDelete ? -1 : 0}
              >
                {editingId === conv.id ? (
                  <div className="history-item-edit" onClick={(e) => e.stopPropagation()}>
                    <input
                      className="history-edit-input"
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Conversation name"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(conv.id)
                        if (e.key === "Escape") setEditingId(null)
                      }}
                    />
                    <div className="history-edit-actions">
                      <button className="btn btn-primary btn-sm" onClick={() => saveEdit(conv.id)}>
                        <Check size={13} /> Save
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="history-item-main">
                      <div className="history-item-title-row">
                        {conv.pinned && <Pin size={12} className="history-item-pin-icon" />}
                        <span className="history-item-title">{displayTitle}</span>
                      </div>
                      <span className="history-item-meta">
                        {formatTimestamp(conv.updatedAt)}
                        {isActive && <span className="history-item-active-tag"> · current</span>}
                      </span>
                    </div>
                    <div className="history-item-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => startEditing(conv)}
                        title="Rename"
                        aria-label={`Rename ${displayTitle}`}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleTogglePin(conv.id)}
                        title={conv.pinned ? "Unpin" : "Pin to top"}
                        aria-label={conv.pinned ? "Unpin conversation" : "Pin conversation"}
                        aria-pressed={conv.pinned}
                      >
                        {conv.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm btn-danger"
                        onClick={() => handleDelete(conv)}
                        title="Delete conversation"
                        aria-label={`Delete ${displayTitle}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </aside>
    </>
  )
}

// Lightweight timestamp formatter. Same-day → time only, otherwise → date.
// Keeps the list scannable without pulling in a date library.
function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  if (sameDay) return time
  // Same year → drop the year; otherwise show it.
  const sameYear = d.getFullYear() === now.getFullYear()
  const date = d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })
  return `${date}, ${time}`
}
