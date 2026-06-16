import { useState, useRef, useEffect, useCallback } from "react"
import type { Persona, Message, Suggestion } from "../types"
import { uid } from "../types"
import { translate, suggest, ask, MAX_HISTORY, SUGGEST_BATCH } from "../ai"
import {
  loadMessages,
  saveMessage,
  deleteMessage,
  isFavorited,
  saveFavorite,
  removeFavoriteByContent,
  loadSeenPhrases,
  addSeenPhrase,
} from "../storage"
import { resolveLangCode } from "../tts"
import { Markdown } from "./Markdown"
import { ArrowLeft, Volume2, VolumeX, Copy, Check, SendHorizontal, ArrowRightLeft, X, Repeat, Star, Sparkles, Plus, History, MessageCircleQuestion, Quote } from "lucide-react"

interface Props {
  persona: Persona
  /** Which conversation messages load into / save to. */
  conversationId?: string
  onBack: () => void
  onFavorites: () => void
  onHistory: () => void
  onNewChat: () => void
}

// A suggestion as it lives in component state: the server item plus a client
// id (React key) and two INDEPENDENT state flags:
//  - `used`: promoted into the live conversation thread (gives subsequent
//    translations the right context). The item stays in the batch so it can
//    still be Saved, and multiple items can be Used.
//  - `saved`: copied to Favorites. Independent of Used — the user may Save all
//    three but Use only one.
interface SuggestionItem extends Suggestion {
  id: string
  saved: boolean
  used: boolean
}

interface SuggestionBatch {
  situation: string
  // Which speaker the batch was generated for. Captured at request time so the
  // items render/Use/Save correctly even if the user flips the toggle later —
  // the batch stays internally consistent with how it was produced.
  direction: "to-target" | "from-target"
  items: SuggestionItem[]
}

export function TranslationChat({ persona, conversationId, onBack, onFavorites, onHistory, onNewChat }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(persona.id, conversationId))
  const [favoritedKeys, setFavoritedKeys] = useState<Set<string>>(() => {
    const keys = new Set<string>()
    messages.forEach((m) => {
      if (isFavorited(m.original, m.translation)) keys.add(`${m.original}::${m.translation}`)
    })
    return keys
  })
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  // Which mode is currently loading — drives the loading placeholder shape.
  // "translate" → "You said" + translation typing; "ask" → "You asked" + answer typing.
  const [loadingMode, setLoadingMode] = useState<"translate" | "ask">("translate")
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [direction, setDirection] = useState<"to-target" | "from-target">("to-target")
  // Suggest mode: when armed, the textarea becomes a situation field and the
  // send button calls the suggest endpoint instead of translate. Auto-exits
  // after one send. `activeBatch` holds the currently-displayed suggestions.
  const [suggestMode, setSuggestMode] = useState(false)
  const [activeBatch, setActiveBatch] = useState<SuggestionBatch | null>(null)
  // Ask mode: when armed, the textarea becomes a question field and the send
  // button calls the ask endpoint, producing a markdown note (kind: "note").
  // `quote` is set when the user enters Ask mode via the quote icon on a bubble
  // — it anchors the question to that specific translation.
  const [askMode, setAskMode] = useState(false)
  const [quote, setQuote] = useState<{ original: string; translation: string } | null>(null)
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
  }, [messages, activeBatch, loading])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    if (askMode) {
      await handleAsk(text)
      return
    }

    if (suggestMode) {
      await handleSuggest(text)
      return
    }

    setInput("")
    setPendingText(text)
    setLoading(true)
    setLoadingMode("translate")
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
        conversationId,
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

  // Ask mode flow. The typed text is a QUESTION about the language or a quoted
  // translation. The answer comes back as markdown and is saved as a note
  // (kind: "note") interleaved in the conversation. Notes are excluded from
  // translate context but included in ask context, so follow-ups chain.
  async function handleAsk(question: string) {
    const currentQuote = quote
    setInput("")
    setAskMode(false)
    setQuote(null)
    setPendingText(question)
    setLoading(true)
    setLoadingMode("ask")
    setError(null)

    try {
      const answer = await ask(persona, question, messages, currentQuote ?? undefined)
      const msg: Message = {
        id: uid(),
        personaId: persona.id,
        original: question,
        translation: answer,
        direction: "to-target", // unused for notes; required by the type
        createdAt: Date.now(),
        conversationId,
        kind: "note",
        quote: currentQuote ?? undefined,
      }
      saveMessage(msg)
      setMessages((prev) => [...prev, msg])
    } catch (err) {
      const message = err instanceof Error ? err.message : "Answer failed"
      setError(message)
      setInput(question)
      // Restore the quote so the user can retry without re-quoting.
      if (currentQuote) setQuote(currentQuote)
      setAskMode(true)
    } finally {
      setPendingText(null)
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  // Enter Ask mode anchored to a specific translation (the quote icon on a
  // bubble). Sets the quote row + arms ask mode + focuses the input.
  function handleQuote(msg: Message) {
    setQuote({ original: msg.original, translation: msg.translation })
    setSuggestMode(false)
    setAskMode(true)
    inputRef.current?.focus()
  }

  // Situational suggestion flow. The typed text is a SITUATION ("going
  // shopping"), not something the user said — so it is never added to message
  // history. We pass the per-persona seen-phrases list as `avoid` so the model
  // doesn't regenerate saved/used phrases. Auto-exits suggest mode after the
  // call regardless of outcome.
  async function handleSuggest(situation: string) {
    setInput("")
    setSuggestMode(false)
    setLoading(true)
    setError(null)
    // Capture the direction at request time so the batch stays internally
    // consistent even if the toggle changes later.
    const batchDirection = direction
    // Show the situation immediately as a pending batch header while loading.
    setActiveBatch({ situation, direction: batchDirection, items: [] })

    try {
      const avoid = loadSeenPhrases(persona.id)
      const results = await suggest(persona, situation, avoid, SUGGEST_BATCH, batchDirection, messages)
      if (results.length === 0) {
        throw new Error("No suggestions returned — try a different situation.")
      }
      const items: SuggestionItem[] = results.map((s) => ({
        ...s,
        id: uid(),
        saved: false,
        used: false,
      }))
      setActiveBatch({ situation, direction: batchDirection, items })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Suggestion failed"
      setError(message)
      setActiveBatch(null)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  // "Suggest more" — append another batch for the SAME situation and direction,
  // aware of everything already shown (current items + the persistent seen list)
  // so the model produces fresh options. The previous items stay on screen so
  // the user can still Use/Save any of them.
  async function handleSuggestMore() {
    const current = activeBatch
    if (!current || loading) return
    setLoading(true)
    setError(null)
    try {
      // Avoid = persistent seen list PLUS every original currently on screen,
      // so we never repeat what the user is already looking at.
      const avoid = Array.from(
        new Set([...loadSeenPhrases(persona.id), ...current.items.map((i) => i.original)]),
      )
      const results = await suggest(persona, current.situation, avoid, SUGGEST_BATCH, current.direction, messages)
      if (results.length === 0) {
        throw new Error("No more suggestions — try a different situation.")
      }
      const more: SuggestionItem[] = results.map((s) => ({
        ...s,
        id: uid(),
        saved: false,
        used: false,
      }))
      setActiveBatch({ ...current, items: [...current.items, ...more] })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Suggestion failed"
      setError(message)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  // "Use this" — promote a suggestion into the live conversation thread as a
  // real translated turn. Uses the BATCH's direction (not the current toggle)
  // so the turn matches how the phrase was generated: to-target = the user said
  // it, from-target = the persona said it. This is what gives subsequent
  // translations the right context. After the turn is appended, the suggestion
  // box clears: the phrases have served their purpose, and any un-Saved items
  // are recorded as seen so they don't resurface on a future suggestion.
  function handleUseSuggestion(item: SuggestionItem) {
    if (item.used || !activeBatch) return
    const batchDirection = activeBatch.direction
    const msg: Message = {
      id: uid(),
      personaId: persona.id,
      original: item.original,
      translation: item.translation,
      direction: batchDirection,
      createdAt: Date.now(),
      debug: {
        speaker: batchDirection === "to-target" ? "user" : "other-person",
        register: item.register,
        honorificsUsed: item.honorificsUsed,
      },
      conversationId,
    }
    saveMessage(msg)
    setMessages((prev) => [...prev, msg])
    // Record every phrase in the batch as seen: the used one (now in the
    // conversation) and the rest (declined by implication). Either way they
    // shouldn't be suggested again.
    activeBatch.items.forEach((i) => addSeenPhrase(persona.id, i.original))
    setActiveBatch(null)
  }

  // Save a suggestion to Favorites (tagged "suggested", with the situation as a
  // note so FavoritesView can group by scenario later). Uses the batch's
  // direction so the favorite matches how the phrase was generated. Independent
  // of Use: the user may Save all three but Use only one.
  function handleSaveSuggestion(item: SuggestionItem) {
    if (item.saved || !activeBatch) return
    saveFavorite({
      id: uid(),
      personaId: persona.id,
      original: item.original,
      translation: item.translation,
      direction: activeBatch.direction,
      notes: `For: ${activeBatch.situation}`,
      tags: ["suggested"],
      createdAt: Date.now(),
    })
    // Saving implies we've seen it — record so it won't be regenerated.
    addSeenPhrase(persona.id, item.original)
    markSuggestionState(item.id, { saved: true })
  }

  // Clear the suggestion batch. Any items the user neither Used nor Saved are
  // recorded as seen so re-suggesting the same situation doesn't echo them.
  function handleClearBatch() {
    setActiveBatch((prev) => {
      prev?.items.forEach((i) => {
        if (!i.used && !i.saved) addSeenPhrase(persona.id, i.original)
      })
      return null
    })
  }

  function markSuggestionState(itemId: string, patch: Partial<Pick<SuggestionItem, "saved" | "used">>) {
    setActiveBatch((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        items: prev.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
      }
    })
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
        debug: msg.debug,
        createdAt: Date.now(),
      })
      setFavoritedKeys((prev) => new Set(prev).add(key))
    }
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
          <button
            className="btn btn-ghost btn-sm"
            onClick={onNewChat}
            title="New chat (archives the current one)"
            aria-label="New chat"
          >
            <Plus size={16} />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onHistory}
            title="Conversation history"
            aria-label="Conversation history"
          >
            <History size={16} />
          </button>
        </div>
      </header>

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

        {messages.map((msg) =>
          msg.kind === "note" ? (
            // Ask-mode note: a single markdown card, distinct from translation
            // bubbles. Shows the quoted translation (if any), the question, and
            // the markdown answer. No TTS (markdown isn't speakable), no
            // favorite star (notes aren't favoritable per the design call).
            <div key={msg.id} className="note-bubble-wrapper">
              <div className="note-bubble">
                <div className="note-bubble-label">
                  <MessageCircleQuestion size={13} /> You asked
                  <span className="bubble-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleCopy(msg.translation, msg.id)}
                      title="Copy answer"
                      aria-label={copiedId === msg.id ? "Copied" : "Copy answer"}
                    >
                      {copiedId === msg.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() => handleDeleteTurn(msg.id)}
                      title="Delete this note"
                      aria-label="Delete this note"
                    >
                      <X size={14} />
                    </button>
                  </span>
                </div>
                {msg.quote && (
                  <div className="note-bubble-quote">
                    <Quote size={12} />
                    <span className="note-bubble-quote-text">{msg.quote.original}</span>
                    <span className="note-bubble-quote-translation">{msg.quote.translation}</span>
                  </div>
                )}
                <div className="note-bubble-question">{msg.original}</div>
                <Markdown>{msg.translation}</Markdown>
              </div>
            </div>
          ) : (
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
                    {/* Quote/Ask — enter Ask mode anchored to this translation */}
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleQuote(msg)}
                      title="Ask about this translation"
                      aria-label="Ask about this translation"
                    >
                      <Quote size={16} />
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
                    <summary>Grammar</summary>
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
          ),
        )}

        {loading && !activeBatch && (
          loadingMode === "ask" ? (
            <div className="note-bubble-wrapper">
              <div className="note-bubble">
                <div className="note-bubble-label">
                  <MessageCircleQuestion size={13} /> You asked
                </div>
                <div className="note-bubble-question">{pendingText ?? "..."}</div>
                <div className="note-bubble-loading">
                  <span className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                </div>
              </div>
            </div>
          ) : (
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
          )
        )}

        {/* Situational suggestion batch. Distinct from chat turns but bridged to
            them: "Use this" promotes a suggestion into the live conversation
            (so it contributes context to later translations). "Save" copies it
            to Favorites. The two are independent — Save all three, Use one.
            "Suggest more" appends a fresh batch for the same situation; Clear
            dismisses the group (un-Used/un-Saved items are recorded as seen so
            they won't be regenerated). */}
        {activeBatch && (
          <div className="suggestion-batch">
            <div className="suggestion-batch-header">
              <span className="suggestion-batch-label">
                <Sparkles size={13} /> Phrases for
              </span>
              <span className="suggestion-batch-situation">"{activeBatch.situation}"</span>
              <span className={`suggestion-batch-speaker ${activeBatch.direction === "from-target" ? "toggled" : ""}`}>
                {activeBatch.direction === "to-target"
                  ? `You → ${persona.name}`
                  : `${persona.name} → You`}
              </span>
              {!loading && (
                <span className="suggestion-batch-actions">
                  <button
                    className="btn btn-ghost btn-sm suggestion-batch-more"
                    onClick={handleSuggestMore}
                    title="Generate 3 more phrases for this situation"
                    aria-label="Suggest more phrases"
                  >
                    <Sparkles size={13} /> Suggest more
                  </button>
                  <button
                    className="btn btn-ghost btn-sm suggestion-batch-clear"
                    onClick={handleClearBatch}
                    aria-label="Clear suggested phrases"
                  >
                    Clear
                  </button>
                </span>
              )}
            </div>

            {loading ? (
              <div className="suggestion-batch-loading">
                <span className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              </div>
            ) : (
              activeBatch.items.map((item, idx) => (
                <div
                  key={item.id}
                  className={`suggestion-item ${item.used ? "suggestion-item-used" : ""} ${item.saved ? "suggestion-item-saved" : ""}`}
                >
                  <div className="suggestion-item-number">{idx + 1}</div>
                  <div className="suggestion-item-body">
                    <div className="suggestion-item-original">
                      <div className="suggestion-item-label-row">
                        <span className="suggestion-item-label">
                          {activeBatch.direction === "to-target" ? "You say" : "You hear"}
                          <span className="suggestion-item-lang"> · {persona.sourceLanguage}</span>
                        </span>
                        <span className="bubble-actions">
                          <button
                            className={`btn btn-ghost btn-sm btn-speak ${playingId === `sg-orig-${item.id}` ? "speaking" : ""}`}
                            onClick={() => handleSpeak(item.original, `sg-orig-${item.id}`, "from-target")}
                            title={playingId === `sg-orig-${item.id}` ? "Stop" : "Play aloud"}
                            aria-label={playingId === `sg-orig-${item.id}` ? "Stop playback" : "Play original aloud"}
                            aria-pressed={playingId === `sg-orig-${item.id}`}
                          >
                            {playingId === `sg-orig-${item.id}` ? <VolumeX size={14} /> : <Volume2 size={14} />}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleCopy(item.original, `sg-orig-${item.id}`)}
                            title="Copy"
                            aria-label={copiedId === `sg-orig-${item.id}` ? "Copied" : "Copy original"}
                          >
                            {copiedId === `sg-orig-${item.id}` ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </span>
                      </div>
                      {item.original}
                    </div>
                    <div className="suggestion-item-translation">
                      <div className="suggestion-item-label-row">
                        <span className="suggestion-item-label">
                          {activeBatch.direction === "to-target" ? "They hear" : "They say"}
                          <span className="suggestion-item-lang"> · {persona.targetLanguage}</span>
                        </span>
                        <span className="bubble-actions">
                          <button
                            className={`btn btn-ghost btn-sm btn-speak ${playingId === `sg-tr-${item.id}` ? "speaking" : ""}`}
                            onClick={() => handleSpeak(item.translation, `sg-tr-${item.id}`, "to-target")}
                            title={playingId === `sg-tr-${item.id}` ? "Stop" : "Play aloud"}
                            aria-label={playingId === `sg-tr-${item.id}` ? "Stop playback" : "Play translation aloud"}
                            aria-pressed={playingId === `sg-tr-${item.id}`}
                          >
                            {playingId === `sg-tr-${item.id}` ? <VolumeX size={14} /> : <Volume2 size={14} />}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleCopy(item.translation, `sg-tr-${item.id}`)}
                            title="Copy"
                            aria-label={copiedId === `sg-tr-${item.id}` ? "Copied" : "Copy translation"}
                          >
                            {copiedId === `sg-tr-${item.id}` ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </span>
                      </div>
                      {item.translation}
                    </div>
                    {item.note && (
                      <div className="suggestion-item-note">💡 {item.note}</div>
                    )}
                    <div className="suggestion-item-actions">
                      <button
                        className={`btn btn-sm ${item.used ? "btn-ghost" : "btn-primary"}`}
                        onClick={() => handleUseSuggestion(item)}
                        disabled={item.used}
                        title={item.used ? "Added to the conversation" : "Send this into the conversation as your turn"}
                        aria-label={item.used ? "Already used in conversation" : "Use this phrase in the conversation"}
                        aria-pressed={item.used}
                      >
                        {item.used ? <Check size={13} /> : <SendHorizontal size={13} />}
                        {item.used ? "Used" : "Use this"}
                      </button>
                      <button
                        className={`btn btn-sm ${item.saved ? "btn-ghost" : "btn-ghost"}`}
                        onClick={() => handleSaveSuggestion(item)}
                        disabled={item.saved}
                        title={item.saved ? "Saved to favorites" : "Save to favorites"}
                        aria-label={item.saved ? "Already saved to favorites" : "Save to favorites"}
                        aria-pressed={item.saved}
                      >
                        <Star size={13} fill={item.saved ? "currentColor" : "none"} />
                        {item.saved ? "Saved" : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        {/* Quote row — shown when Ask mode was entered via the quote icon on a
            bubble. Displays the anchored translation; dismiss X clears it. */}
        {quote && (
          <div className="chat-quote-row">
            <Quote size={14} className="chat-quote-icon" />
            <div className="chat-quote-content">
              <div className="chat-quote-original">{quote.original}</div>
              <div className="chat-quote-translation">{quote.translation}</div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setQuote(null)}
              aria-label="Remove quote"
              title="Remove quote"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            className={`chat-input ${suggestMode ? "chat-input-suggest" : ""} ${askMode ? "chat-input-ask" : ""}`}
            placeholder={
              askMode
                ? `Ask a question about the language or this translation…`
                : suggestMode
                  ? direction === "to-target"
                    ? `Describe a situation to get phrases YOU would say (e.g. "going shopping for clothes")…`
                    : `Describe a situation to get phrases ${persona.name} would say (e.g. "asking about the baby")…`
                  : direction === "to-target"
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
            className={`btn btn-primary chat-send-btn ${suggestMode ? "chat-send-btn-suggest" : ""} ${askMode ? "chat-send-btn-ask" : ""}`}
            onClick={handleSend}
            disabled={loading || !input.trim()}
            aria-label={askMode ? "Ask this question" : suggestMode ? "Suggest phrases for this situation" : "Send message"}
          >
            {loading ? "..." : askMode ? <MessageCircleQuestion size={20} /> : suggestMode ? <Sparkles size={20} /> : <SendHorizontal size={20} />}
          </button>
        </div>
        <div className="chat-toggle-row">
          <button
            className={`btn btn-ghost chat-speaker-toggle ${suggestMode ? "toggled" : ""}`}
            onClick={() => {
              // Preserve typed text across mode toggles (footgun guard).
              setSuggestMode((v) => !v)
              // Enabling suggest disables ask (mutually exclusive modes).
              if (!suggestMode) {
                setAskMode(false)
                setQuote(null)
              }
              inputRef.current?.focus()
            }}
            title={suggestMode ? "Suggest mode on — tap to return to translate" : "Suggest phrases for a situation"}
            aria-pressed={suggestMode}
            aria-label={suggestMode ? "Suggest mode on. Tap to return to translate." : "Suggest phrases for a situation."}
          >
            <Sparkles size={14} />
            <span className="speaker-label">Suggest a phrase</span>
          </button>
          <button
            className={`btn btn-ghost chat-speaker-toggle ${askMode ? "toggled" : ""}`}
            onClick={() => {
              setAskMode((v) => !v)
              // Enabling ask disables suggest (mutually exclusive). Quote is
              // only set via the bubble icon, not this toggle, so leave it.
              if (!askMode) {
                setSuggestMode(false)
              } else {
                // Turning ask OFF clears any pending quote.
                setQuote(null)
              }
              inputRef.current?.focus()
            }}
            title={askMode ? "Ask mode on — tap to return to translate" : "Ask a question about the language"}
            aria-pressed={askMode}
            aria-label={askMode ? "Ask mode on. Tap to return to translate." : "Ask a question about the language."}
          >
            <MessageCircleQuestion size={14} />
            <span className="speaker-label">Ask a question</span>
          </button>
          <button
            className={`btn btn-ghost chat-speaker-toggle ${direction === "from-target" ? "toggled" : ""} ${askMode ? "is-disabled" : ""}`}
            onClick={() => !askMode && setDirection(direction === "to-target" ? "from-target" : "to-target")}
            title={
              askMode
                ? "Direction is fixed in ask mode (notes are about the language, not a speaker turn)"
                : direction === "to-target"
                  ? suggestMode
                    ? "Phrases you would say. Tap to switch to phrases they would say."
                    : "Tap to switch to their voice"
                  : suggestMode
                    ? `Phrases ${persona.name} would say. Tap to switch to phrases you would say.`
                    : "Tap to switch to your voice"
            }
            aria-pressed={direction === "from-target"}
            aria-disabled={askMode}
            aria-label={
              askMode
                ? "Direction locked in ask mode"
                : direction === "to-target"
                  ? suggestMode
                    ? `Phrases you would say to ${persona.name}. Tap for phrases they would say.`
                    : `You speaking to ${persona.name}. Tap to switch to their voice.`
                  : suggestMode
                    ? `Phrases ${persona.name} would say to you. Tap for phrases you would say.`
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
    </div>
  )
}
