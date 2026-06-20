import type { TranslationDebug } from "../types"

interface Props {
  debug: TranslationDebug | null | undefined
  /** <summary> label: "Breakdown" in chat, "Grammar" in favorites. */
  summary?: string
}

/**
 * The expandable linguistic breakdown (speaker / register / honorifics /
 * referents) shown under a translation. Identical grid in the chat bubble
 * (summary "Breakdown") and the favorite card (summary "Grammar"); rendered
 * only when `debug` is present.
 */
export function DebugDetails({ debug, summary = "Breakdown" }: Props) {
  if (!debug) return null
  return (
    <details className="debug-details">
      <summary>{summary}</summary>
      <dl className="debug-grid">
        <dt>Speaker</dt>
        <dd>{debug.speaker}</dd>
        <dt>Register</dt>
        <dd>{debug.register}</dd>
        <dt>Honorifics</dt>
        <dd>{debug.honorificsUsed}</dd>
        <dt>Referents</dt>
        <dd>{debug.referents}</dd>
      </dl>
    </details>
  )
}
