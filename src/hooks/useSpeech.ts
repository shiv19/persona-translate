import { useState, useRef, useCallback, useEffect } from "react"
import { resolveLangCode } from "../tts"

/**
 * Shared speech-synthesis + clipboard state for the chat and favorites views.
 *
 * Centralizes three things that were duplicated nearly verbatim across
 * TranslationChat and FavoritesView:
 *   - `playingId` / `copiedId` UI state and their toggles,
 *   - the Web Speech voice-matching logic (track `voiceschanged`, prefer an
 *     installed voice for the resolved BCP-47 tag),
 *   - the unmount cleanup that cancels any in-flight utterance.
 *
 * Voice resolution uses the state + `voiceschanged`-listener approach (the
 * correct one — getVoices() returns [] until the synth finishes loading).
 *
 * `speak` takes an explicit language *name* (e.g. "Vietnamese"); the caller
 * decides which side (original/translation) it's playing and passes the right
 * language. The id is opaque and just identifies "what's currently playing"
 * so multiple bubbles can share one hook without colliding.
 */
export function useSpeech() {
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    typeof window !== "undefined" ? window.speechSynthesis.getVoices() : [],
  )
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    window.speechSynthesis.cancel()
    setPlayingId(null)
  }, [])

  // Cancel any in-flight speech when the component unmounts.
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

  // Clear the copied-reset timer on unmount so we don't setState post-unmount.
  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
  }, [])

  const speak = useCallback(
    (text: string, id: string, language: string) => {
      if (playingId === id) {
        stop()
        return
      }

      stop()

      const utterance = new SpeechSynthesisUtterance(text)
      const langCode = resolveLangCode(language)

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

      setPlayingId(id)
      window.speechSynthesis.speak(utterance)
    },
    [playingId, voices, stop],
  )

  const copy = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopiedId(null), 1500)
  }, [])

  return {
    playingId,
    copiedId,
    speak,
    copy,
    stop,
    isPlaying: (id: string) => playingId === id,
    isCopied: (id: string) => copiedId === id,
  }
}
