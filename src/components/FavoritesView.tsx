import { useState, useMemo, useRef, useCallback, useEffect } from "react"
import type { Persona, Favorite } from "../types"
import { loadFavorites, updateFavorite, removeFavorite, saveFavorite } from "../storage"
import { resolveLangCode } from "../tts"
import { ArrowLeft, Search, X, Tag, StickyNote, Volume2, VolumeX, Copy, Check } from "lucide-react"

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
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopSpeech = useCallback(() => {
    window.speechSynthesis.cancel()
    setPlayingId(null)
  }, [])

  useEffect(() => {
    return () => { window.speechSynthesis.cancel() }
  }, [])

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

  function handleSpeak(text: string, id: string, direction: "to-target" | "from-target") {
    if (playingId === id) {
      stopSpeech()
      return
    }
    stopSpeech()
    const utterance = new SpeechSynthesisUtterance(text)
    const lang = direction === "to-target" ? persona.targetLanguage : persona.sourceLanguage
    const langCode = resolveLangCode(lang)
    if (langCode) {
      utterance.lang = langCode
      const match = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith(langCode.split("-")[0]))
      if (match) utterance.voice = match
    }
    utterance.rate = 0.9
    utterance.onend = () => setPlayingId(null)
    utterance.onerror = () => setPlayingId(null)
    setPlayingId(id)
    window.speechSynthesis.speak(utterance)
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
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
                      <button
                        className={`btn btn-ghost btn-sm btn-speak ${playingId === `orig-${fav.id}` ? "speaking" : ""}`}
                        onClick={() => handleSpeak(fav.original, `orig-${fav.id}`, fav.direction === "to-target" ? "from-target" : "to-target")}
                        title={playingId === `orig-${fav.id}` ? "Stop" : "Play aloud"}
                        aria-label={playingId === `orig-${fav.id}` ? "Stop playback" : "Play original aloud"}
                        aria-pressed={playingId === `orig-${fav.id}`}
                      >
                        {playingId === `orig-${fav.id}` ? <VolumeX size={14} /> : <Volume2 size={14} />}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleCopy(fav.original, `orig-${fav.id}`)}
                        title="Copy"
                        aria-label={copiedId === `orig-${fav.id}` ? "Copied" : "Copy original"}
                      >
                        {copiedId === `orig-${fav.id}` ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </span>
                  </div>
                  {fav.original}
                </div>
                <div className="favorite-card-translation">
                  <div className="favorite-card-label-row">
                    <span className="favorite-card-label">Translation</span>
                    <span className="bubble-actions">
                      <button
                        className={`btn btn-ghost btn-sm btn-speak ${playingId === fav.id ? "speaking" : ""}`}
                        onClick={() => handleSpeak(fav.translation, fav.id, fav.direction)}
                        title={playingId === fav.id ? "Stop" : "Play aloud"}
                        aria-label={playingId === fav.id ? "Stop playback" : "Play translation aloud"}
                        aria-pressed={playingId === fav.id}
                      >
                        {playingId === fav.id ? <VolumeX size={14} /> : <Volume2 size={14} />}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleCopy(fav.translation, fav.id)}
                        title="Copy"
                        aria-label={copiedId === fav.id ? "Copied" : "Copy translation"}
                      >
                        {copiedId === fav.id ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </span>
                  </div>
                  {fav.translation}
                </div>
                {fav.debug && (
                  <details className="debug-details">
                    <summary>Grammar</summary>
                    <dl className="debug-grid">
                      <dt>Speaker</dt>
                      <dd>{fav.debug.speaker}</dd>
                      <dt>Register</dt>
                      <dd>{fav.debug.register}</dd>
                      <dt>Honorifics</dt>
                      <dd>{fav.debug.honorificsUsed}</dd>
                      <dt>Referents</dt>
                      <dd>{fav.debug.referents}</dd>
                    </dl>
                  </details>
                )}
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
