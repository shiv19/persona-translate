import { useState, useRef, useEffect, useCallback } from "react"
import type { Persona, Message } from "../types"
import { uid } from "../types"
import { translate } from "../ai"
import { loadMessages, saveMessage, clearMessages } from "../storage"
import { ArrowLeft, Trash2, Volume2, VolumeX, Copy, Check, SendHorizontal, ArrowRightLeft } from "lucide-react"

const LANG_MAP: Record<string, string> = {
  vietnamese: "vi-VN",
  viet: "vi-VN",
  korean: "ko-KR",
  japanese: "ja-JP",
  chinese: "zh-CN",
  mandarin: "zh-CN",
  cantonese: "zh-HK",
  spanish: "es-ES",
  french: "fr-FR",
  german: "de-DE",
  portuguese: "pt-BR",
  italian: "it-IT",
  thai: "th-TH",
  tagalog: "fil-PH",
  filipino: "fil-PH",
  hindi: "hi-IN",
  tamil: "ta-IN",
  arabic: "ar-SA",
  russian: "ru-RU",
  indonesian: "id-ID",
  malay: "ms-MY",
  english: "en-US",
}

function resolveLangCode(language: string): string {
  const lower = language.toLowerCase().trim()
  for (const [key, code] of Object.entries(LANG_MAP)) {
    if (lower.includes(key)) return code
  }
  return lower
}

interface Props {
  persona: Persona
  onBack: () => void
}

export function TranslationChat({ persona, onBack }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(persona.id))
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showConfirmClear, setShowConfirmClear] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
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

  function handleSpeak(text: string, messageId: string) {
    if (playingId === messageId) {
      stopSpeech()
      return
    }

    stopSpeech()

    const utterance = new SpeechSynthesisUtterance(text)
    const langCode = resolveLangCode(persona.targetLanguage)
    utterance.lang = langCode
    utterance.rate = 0.9

    const voices = window.speechSynthesis.getVoices()
    const match = voices.find((v) => v.lang.startsWith(langCode.split("-")[0]))
    if (match) utterance.voice = match

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
    setLoading(true)

    try {
      const translation = await translate(persona, text, messages)

      const msg: Message = {
        id: uid(),
        personaId: persona.id,
        original: text,
        translation,
        direction: "to-target",
        createdAt: Date.now(),
      }

      saveMessage(msg)
      setMessages((prev) => [...prev, msg])
    } catch (err) {
      const errorMsg: Message = {
        id: uid(),
        personaId: persona.id,
        original: text,
        translation: `Error: ${err instanceof Error ? err.message : "Translation failed"}`,
        direction: "to-target",
        createdAt: Date.now(),
      }
      saveMessage(errorMsg)
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  function handleClear() {
    clearMessages(persona.id)
    setMessages([])
    setShowConfirmClear(false)
  }

  return (
    <div className="screen chat-screen">
      <header className="chat-header">
        <button className="btn btn-ghost" onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        <div className="chat-header-info">
          <h3>{persona.name}</h3>
          <span className="chat-header-meta">
            {persona.sourceLanguage} <ArrowRightLeft size={12} /> {persona.targetLanguage}
          </span>
        </div>
        <div className="chat-header-actions">
          {messages.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowConfirmClear(!showConfirmClear)}
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

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>
              Type a message in <strong>{persona.sourceLanguage}</strong> or{" "}
              <strong>{persona.targetLanguage}</strong> below.
            </p>
            <p className="chat-empty-hint">
              The last {5} messages are included as context for better translations.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="chat-bubble-wrapper">
            <div className="chat-bubble chat-bubble-original">
              <div className="chat-bubble-label">You said</div>
              <div className="chat-bubble-text">{msg.original}</div>
            </div>
            <div className="chat-bubble chat-bubble-translation">
              <div className="chat-bubble-label">
                Translation
                <span className="bubble-actions">
                  <button
                    className={`btn btn-ghost btn-sm btn-speak ${playingId === msg.id ? "speaking" : ""}`}
                    onClick={() => handleSpeak(msg.translation, msg.id)}
                    title={playingId === msg.id ? "Stop" : "Play aloud"}
                  >
                    {playingId === msg.id ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleCopy(msg.translation, msg.id)}
                    title="Copy"
                  >
                    {copiedId === msg.id ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </span>
              </div>
              <div className="chat-bubble-text">{msg.translation}</div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="chat-bubble-wrapper">
            <div className="chat-bubble chat-bubble-original">
              <div className="chat-bubble-label">You said</div>
              <div className="chat-bubble-text">{input || "..."}</div>
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
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder={`Type in ${persona.sourceLanguage} or ${persona.targetLanguage}...`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={loading}
        />
        <button
          className="btn btn-primary chat-send-btn"
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          {loading ? "..." : <SendHorizontal size={20} />}
        </button>
      </div>
    </div>
  )
}
