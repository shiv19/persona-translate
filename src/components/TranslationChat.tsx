import { useState, useRef, useEffect, useCallback } from "react"
import type { Persona, Message } from "../types"
import { uid } from "../types"
import { translate, MAX_HISTORY } from "../ai"
import { loadMessages, saveMessage, clearMessages, deleteMessage, isFavorited, saveFavorite, removeFavoriteByContent } from "../storage"
import { resolveLangCode } from "../tts"
import { ArrowLeft, Trash2, Volume2, VolumeX, Copy, Check, SendHorizontal, ArrowRightLeft, X, Repeat, Star } from "lucide-react"

interface Props {
  persona: Persona
  onBack: () => void
  onFavorites: () => void
}

export function TranslationChat({ persona, onBack, onFavorites }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(persona.id))
  const [favoritedKeys, setFavoritedKeys] = useState<Set<string>>(() => {
    const keys = new Set<string>()
    messages.forEach((m) => {
      if (isFavorited(m.original, m.translation)) keys.add(`${m.original}::${m.translation}`)
    })
    return keys
  })
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showConfirmClear, setShowConfirmClear] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [direction, setDirection] = useState<"to-target" | "from-target">("to-target")
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    typeof window !== "undefined" ? window.speechSynthesis.getVoices() : [],
  )
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const stopSpeech = useCallback(() => {
    window.speechSynthesis.cancel()
    setPlayingId(null)
  }, [])

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel()
    }
  }, [])

  // getVoices() returns [] until the synth finishes loading. Listen for the
  // voiceschanged event so voice matching works on first render after load.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return
    const sync = () => setVoices(window.speechSynthesis.getVoices())
    sync()
    window.speechSynthesis.addEventListener("voiceschanged", sync)
    return () => window.speechSynthesis.removeEventListener("voiceschanged", sync)
  }, [])

  function handleSpeak(text: string, messageId: string, msgDirection: "to-target" | "from-target") {
    if (playingId === messageId) {
      stopSpeech()
      return
    }

    stopSpeech()

    const utterance = new SpeechSynthesisUtterance(text)
    const ttsLang = msgDirection === "to-target" ? persona.targetLanguage : persona.sourceLanguage
    const langCode = resolveLangCode(ttsLang)

    // Prefer an actually-installed voice for this language. Fall back to the
    // synth default only if we mapped a real BCP-47 tag; never hand it a
    // garbage string that the synth will reject.
    if (langCode) {
      utterance.lang = langCode
      const match = voices.find((v) => v.lang.startsWith(langCode.split("-")[0]))
      if (match) utterance.voice = match
    }

    utterance.rate = 0.9
    utterance.onend = () => setPlayingId(null)
    utterance.onerror = () => setPlayingId(null)

    setPlayingId(messageId)
    window.speechSynthesis.speak(utterance)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    setInput("")
    setPendingText(text)
    setLoading(true)
    setError(null)

    try {
      const { translation, debug } = await translate(persona, text, messages, direction)

      const msg: Message = {
        id: uid(),
        personaId: persona.id,
        original: text,
        translation,
        direction,
        createdAt: Date.now(),
        debug,
      }

      saveMessage(msg)
      setMessages((prev) => [...prev, msg])
    } catch (err) {
      // Errors are ephemeral UI state — never persisted, never fed back to the
      // model as history. Restore the input so the user can retry/edit.
      const message = err instanceof Error ? err.message : "Translation failed"
      setError(message)
      setInput(text)
      setPendingText(null)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  function handleToggleFavorite(msg: Message) {
    const key = `${msg.original}::${msg.translation}`
    if (favoritedKeys.has(key)) {
      removeFavoriteByContent(msg.original, msg.translation)
      setFavoritedKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    } else {
      saveFavorite({
        id: uid(),
        personaId: persona.id,
        original: msg.original,
        translation: msg.translation,
        direction: msg.direction,
        createdAt: Date.now(),
      })
      setFavoritedKeys((prev) => new Set(prev).add(key))
    }
  }

  function handleClear() {
    clearMessages(persona.id)
    setMessages([])
    setShowConfirmClear(false)
  }

  function handleDeleteTurn(messageId: string) {
    deleteMessage(messageId)
    setMessages((prev) => prev.filter((m) => m.id !== messageId))
  }

  return (
    <div className="screen chat-screen">
      <header className="chat-header">
        <button className="btn btn-ghost back-mobile-only" onClick={onBack} aria-label="Back to personas">
          <ArrowLeft size={20} />
        </button>
        <div className="chat-header-info">
          <h3>{persona.name}</h3>
          <span className="chat-header-meta">
            {persona.sourceLanguage} <ArrowRightLeft size={12} /> {persona.targetLanguage}
          </span>
        </div>
        <div className="chat-header-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={onFavorites}
            title="View favorites"
            aria-label="View favorites"
          >
            <Star size={16} />
          </button>
          {messages.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowConfirmClear(!showConfirmClear)}
              aria-label="Clear all messages"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </header>

      {showConfirmClear && (
        <div className="clear-banner">
          <span>Clear all messages?</span>
          <button className="btn btn-danger btn-sm" onClick={handleClear}>
            Clear
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowConfirmClear(false)}>
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div className="clear-banner error-banner" role="alert">
          <span>{error}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setError(null)} aria-label="Dismiss error">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>
              Type a message in <strong>{persona.sourceLanguage}</strong> or{" "}
              <strong>{persona.targetLanguage}</strong> below.
            </p>
            <p className="chat-empty-hint">
              The last {MAX_HISTORY} messages are included as context for better translations.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="chat-bubble-wrapper">
            <div className="chat-bubble chat-bubble-original">
              <div className="chat-bubble-label">
                {msg.direction === "to-target" ? "You said" : `${persona.name} said`}
                <span className="bubble-actions">
                  <button
                    className={`btn btn-ghost btn-sm btn-speak ${playingId === `orig-${msg.id}` ? "speaking" : ""}`}
                    onClick={() => handleSpeak(msg.original, `orig-${msg.id}`, msg.direction === "to-target" ? "from-target" : "to-target")}
                    title={playingId === `orig-${msg.id}` ? "Stop" : "Play aloud"}
                    aria-label={playingId === `orig-${msg.id}` ? "Stop playback" : "Play original aloud"}
                    aria-pressed={playingId === `orig-${msg.id}`}
                  >
                    {playingId === `orig-${msg.id}` ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleCopy(msg.original, `orig-${msg.id}`)}
                    title="Copy"
                    aria-label={copiedId === `orig-${msg.id}` ? "Copied" : "Copy original"}
                  >
                    {copiedId === `orig-${msg.id}` ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </span>
              </div>
              <div className="chat-bubble-text">{msg.original}</div>
            </div>
            <div className="chat-bubble chat-bubble-translation">
              <div className="chat-bubble-label">
                Translation
                <span className="bubble-actions">
                  <button
                    className={`btn btn-ghost btn-sm btn-speak ${playingId === msg.id ? "speaking" : ""}`}
                    onClick={() => handleSpeak(msg.translation, msg.id, msg.direction)}
                    title={playingId === msg.id ? "Stop" : "Play aloud"}
                    aria-label={playingId === msg.id ? "Stop playback" : "Play translation aloud"}
                    aria-pressed={playingId === msg.id}
                  >
                    {playingId === msg.id ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleCopy(msg.translation, msg.id)}
                    title="Copy"
                    aria-label={copiedId === msg.id ? "Copied" : "Copy translation"}
                  >
                    {copiedId === msg.id ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                  <button
                    className={`btn btn-ghost btn-sm btn-favorite ${favoritedKeys.has(`${msg.original}::${msg.translation}`) ? "favorited" : ""}`}
                    onClick={() => handleToggleFavorite(msg)}
                    title={favoritedKeys.has(`${msg.original}::${msg.translation}`) ? "Remove from favorites" : "Add to favorites"}
                    aria-label={favoritedKeys.has(`${msg.original}::${msg.translation}`) ? "Remove from favorites" : "Add to favorites"}
                    aria-pressed={favoritedKeys.has(`${msg.original}::${msg.translation}`)}
                  >
                    <Star size={16} fill={favoritedKeys.has(`${msg.original}::${msg.translation}`) ? "currentColor" : "none"} />
                  </button>
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => handleDeleteTurn(msg.id)}
                    title="Delete this turn"
                    aria-label="Delete this turn"
                  >
                    <X size={16} />
                  </button>
                </span>
              </div>
              <div className="chat-bubble-text">{msg.translation}</div>
              {msg.debug && (
                <details className="debug-details">
                  <summary>Debug</summary>
                  <dl className="debug-grid">
                    <dt>Speaker</dt>
                    <dd>{msg.debug.speaker}</dd>
                    <dt>Register</dt>
                    <dd>{msg.debug.register}</dd>
                    <dt>Honorifics</dt>
                    <dd>{msg.debug.honorificsUsed}</dd>
                    <dt>Referents</dt>
                    <dd>{msg.debug.referents}</dd>
                  </dl>
                </details>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="chat-bubble-wrapper">
            <div className="chat-bubble chat-bubble-original">
              <div className="chat-bubble-label">
                {direction === "to-target" ? "You said" : `${persona.name} said`}
              </div>
              <div className="chat-bubble-text">{pendingText ?? "..."}</div>
            </div>
            <div className="chat-bubble chat-bubble-translation">
              <div className="chat-bubble-label">Translation</div>
              <div className="chat-bubble-text">
                <span className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={
              direction === "to-target"
                ? `Type in ${persona.sourceLanguage}...`
                : `Type in ${persona.targetLanguage}...`
            }
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = "auto"
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"
            }}
            onKeyDown={handleKeyDown}
            rows={2}
            disabled={loading}
          />
          <button
            className="btn btn-primary chat-send-btn"
            onClick={handleSend}
            disabled={loading || !input.trim()}
            aria-label="Send message"
          >
            {loading ? "..." : <SendHorizontal size={20} />}
          </button>
        </div>
        <button
          className={`btn btn-ghost chat-speaker-toggle ${direction === "from-target" ? "toggled" : ""}`}
          onClick={() => setDirection(direction === "to-target" ? "from-target" : "to-target")}
          title={direction === "to-target" ? "Tap to switch to their voice" : "Tap to switch to your voice"}
          aria-pressed={direction === "from-target"}
          aria-label={
            direction === "to-target"
              ? `You speaking to ${persona.name}. Tap to switch to their voice.`
              : `${persona.name} speaking to you. Tap to switch to your voice.`
          }
        >
          <Repeat size={14} />
          <span className="speaker-label">
            {direction === "to-target" ? `You → ${persona.targetLanguage}` : `${persona.name} → ${persona.sourceLanguage}`}
          </span>
        </button>
      </div>
    </div>
  )
}
