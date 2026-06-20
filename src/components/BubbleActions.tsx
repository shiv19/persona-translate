import { Volume2, VolumeX, Copy, Check } from "lucide-react"
import type { useSpeech } from "../hooks/useSpeech"

type Speech = ReturnType<typeof useSpeech>

interface Props {
  /** Text to speak and copy. */
  text: string
  /** Opaque id shared with the speech hook — identifies the playing/copied item. */
  id: string
  /** Language NAME (e.g. "Vietnamese") used to resolve the TTS voice. */
  language: string
  /** Which side this is — drives the title/aria-label copy ("original"/"translation"). */
  label: "original" | "translation"
  /** Icon size; 16 in chat bubbles, 14 in suggestion/favorite cards. */
  size?: number
  speech: Speech
}

/**
 * The speak + copy button pair that appears on every translation/favorite/
 * suggestion row. Renders the Volume2/VolumeX toggle (tap the playing one to
 * stop) and the Copy/Check toggle (Copied shown for ~1.5s after copy).
 *
 * Pulled out because this exact ~20-line block was repeated 6× across
 * TranslationChat and FavoritesView, differing only in id/language/labels/size.
 */
export function BubbleActions({ text, id, language, label, size = 16, speech }: Props) {
  const playing = speech.isPlaying(id)
  const copied = speech.isCopied(id)
  return (
    <>
      <button
        className={`btn btn-ghost btn-sm btn-speak ${playing ? "speaking" : ""}`}
        onClick={() => speech.speak(text, id, language)}
        title={playing ? "Stop" : "Play aloud"}
        aria-label={playing ? "Stop playback" : `Play ${label} aloud`}
        aria-pressed={playing}
      >
        {playing ? <VolumeX size={size} /> : <Volume2 size={size} />}
      </button>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => speech.copy(text, id)}
        title="Copy"
        aria-label={copied ? "Copied" : `Copy ${label}`}
      >
        {copied ? <Check size={size} /> : <Copy size={size} />}
      </button>
    </>
  )
}
