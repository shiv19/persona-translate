import { useState, useMemo, useRef, useCallback } from "react"
import type { Persona, Favorite } from "../types"
import { loadFavorites, updateFavorite, removeFavorite, saveFavorite } from "../storage"
import { useSpeech } from "../hooks/useSpeech"
import { BubbleActions } from "./BubbleActions"
import { DebugDetails } from "./DebugDetails"
import { ArrowLeft, Search, X, Tag, StickyNote } from "lucide-react"

interface Props {
  persona: Persona
  onBack: () => void
}

const UNDO_DELAY = 5000

export function FavoritesView({ persona, onBack }: Props) {
  const [favorites, setFavorites] = useState<Favorite[]>(() => loadFavorites(persona.id))
  const [search, setSearch] = useState("")
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNotes, setEditNotes] = useState("")
  const [editTags, setEditTags] = useState("")
  const [pendingDelete, setPendingDelete] = useState<Favorite | null>(null)
  const speech = useSpeech()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    favorites.forEach((f) => f.tags?.forEach((t) => tagSet.add(t)))
    return Array.from(tagSet).sort()
  }, [favorites])

  const filtered = useMemo(() => {
    let result = favorites
    if (filterTag) {
      result = result.filter((f) => f.tags?.includes(filterTag))
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (f) =>
          f.original.toLowerCase().includes(q) ||
          f.translation.toLowerCase().includes(q) ||
          f.notes?.toLowerCase().includes(q) ||
          f.tags?.some((t) => t.toLowerCase().includes(q)),
      )
    }
    return result
  }, [favorites, search, filterTag])

  const commitVisualRemove = useCallback(() => {
    setPendingDelete(null)
  }, [])

  function handleRemove(fav: Favorite) {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (pendingDelete) {
      removeFavorite(pendingDelete.id)
      setFavorites((prev) => prev.filter((f) => f.id !== pendingDelete.id))
    }
    removeFavorite(fav.id)
    setPendingDelete(fav)
    timerRef.current = setTimeout(() => {
      setFavorites((prev) => prev.filter((f) => f.id !== fav.id))
      setPendingDelete(null)
    }, UNDO_DELAY)
  }

  function handleUndo() {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (pendingDelete) {
      loadFavorites(persona.id)
      const restored = [...favorites, pendingDelete].sort((a, b) => b.createdAt - a.createdAt)
      setFavorites(restored)
      saveFavorite(pendingDelete)
    }
    setPendingDelete(null)
  }

  function startEditing(fav: Favorite) {
    setEditingId(fav.id)
    setEditNotes(fav.notes ?? "")
    setEditTags(fav.tags?.join(", ") ?? "")
  }

  function saveEdits(favoriteId: string) {
    const tags = editTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
    updateFavorite(favoriteId, { notes: editNotes, tags })
    setFavorites((prev) =>
      prev.map((f) => (f.id === favoriteId ? { ...f, notes: editNotes, tags } : f)),
    )
    setEditingId(null)
  }

  function addTagToEdit(tag: string) {
    const current = editTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
    if (!current.includes(tag)) {
      current.push(tag)
      setEditTags(current.join(", "))
    }
  }

  return (
    <div className="screen favorites-screen">
      <header className="chat-header">
        <button className="btn btn-ghost" onClick={onBack} aria-label="Back to chat">
          <ArrowLeft size={20} />
        </button>
        <div className="chat-header-info">
          <h3>Favorites</h3>
          <span className="chat-header-meta">
            {persona.name} &middot; {favorites.length} saved
          </span>
        </div>
      </header>

      {favorites.length > 0 && (
        <div className="favorites-search-area">
          <div className="favorites-search-row">
            <Search size={16} className="favorites-search-icon" />
            <input
              className="favorites-search-input"
              type="text"
              placeholder="Search translations, notes, tags..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="btn btn-ghost btn-sm" onClick={() => setSearch("")} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
          {allTags.length > 0 && (
            <div className="favorites-tags-bar">
              <button
                className={`favorites-tag-chip ${filterTag === null ? "active" : ""}`}
                onClick={() => setFilterTag(null)}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  className={`favorites-tag-chip ${filterTag === tag ? "active" : ""}`}
                  onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                >
                  <Tag size={12} />
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {pendingDelete && (
        <div className="favorites-undo-banner">
          <span>Favorite removed</span>
          <button className="btn btn-ghost btn-sm" onClick={handleUndo}>
            Undo
          </button>
        </div>
      )}

      <div className="favorites-list">
        {favorites.length === 0 && (
          <div className="chat-empty">
            <p>No favorites yet.</p>
            <p className="chat-empty-hint">
              Tap the star on a translation to save it here.
            </p>
          </div>
        )}

        {favorites.length > 0 && filtered.length === 0 && (
          <div className="chat-empty">
            <p>No favorites match your search.</p>
          </div>
        )}

        {filtered.map((fav) => {
          const isPendingDelete = pendingDelete?.id === fav.id
          return (
            <div key={fav.id} className={`favorite-card ${isPendingDelete ? "pending-delete" : ""}`}>
              <div className="favorite-card-body">
                <div className="favorite-card-original">
                  <div className="favorite-card-label-row">
                    <span className="favorite-card-label">
                      {fav.direction === "to-target" ? "Original" : persona.name}
                    </span>
                    <span className="bubble-actions">
                      <BubbleActions
                        text={fav.original}
                        id={`orig-${fav.id}`}
                        language={fav.direction === "to-target" ? persona.sourceLanguage : persona.targetLanguage}
                        label="original"
                        size={14}
                        speech={speech}
                      />
                    </span>
                  </div>
                  {fav.original}
                </div>
                <div className="favorite-card-translation">
                  <div className="favorite-card-label-row">
                    <span className="favorite-card-label">Translation</span>
                    <span className="bubble-actions">
                      <BubbleActions
                        text={fav.translation}
                        id={fav.id}
                        language={fav.direction === "to-target" ? persona.targetLanguage : persona.sourceLanguage}
                        label="translation"
                        size={14}
                        speech={speech}
                      />
                    </span>
                  </div>
                  {fav.translation}
                </div>
                <DebugDetails debug={fav.debug} summary="Grammar" />
                {fav.tags && fav.tags.length > 0 && editingId !== fav.id && (
                  <div className="favorite-card-tags">
                    {fav.tags.map((tag) => (
                      <span key={tag} className="favorite-card-tag">
                        <Tag size={11} />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {fav.notes && editingId !== fav.id && (
                  <div className="favorite-card-notes">
                    <StickyNote size={12} />
                    {fav.notes}
                  </div>
                )}
              </div>

              {editingId === fav.id ? (
                <div className="favorite-card-edit">
                  <label className="favorite-edit-label">
                    Notes
                    <textarea
                      className="favorite-edit-textarea"
                      placeholder="Add a note about this translation..."
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={2}
                    />
                  </label>
                  <label className="favorite-edit-label">
                    Tags (comma-separated)
                    <input
                      className="favorite-edit-input"
                      type="text"
                      placeholder="e.g. greeting, formal, family"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                    />
                    {allTags.length > 0 && (
                      <div className="favorite-edit-suggested-tags">
                        {allTags.map((tag) => (
                          <button
                            key={tag}
                            className="favorites-tag-chip"
                            onClick={() => addTagToEdit(tag)}
                            type="button"
                          >
                            +{tag}
                          </button>
                        ))}
                      </div>
                    )}
                  </label>
                  <div className="favorite-edit-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => saveEdits(fav.id)}>
                      Save
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="favorite-card-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => startEditing(fav)}>
                    <StickyNote size={14} />
                    {fav.notes || fav.tags?.length ? "Edit" : "Add note"}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => handleRemove(fav)}
                    title="Remove from favorites"
                    aria-label="Remove from favorites"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
