import { createScorer } from "evalite"
import type { TranslateOutput } from "../server/zai.js"
import type { TestCase } from "./fixtures.js"

// The "output" type for every eval is TranslateOutput (translation + debug).
// The "input" type is TestCase. Deterministic scorers get these typed args.

/** True if `s` contains characters outside basic Latin (implies non-English). */
function hasNonLatin(s: string): boolean {
  return /[^\x00-\x7F]/.test(s)
}

/** True if `s` looks like Vietnamese (has Vietnamese-specific diacritics). */
function isVietnamese(s: string): boolean {
  return /[ăâêôơưđĂÂÊÔƠƯĐàáảãạằắẳẵặầấẩẫậềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/.test(s)
}

/**
 * Guard against the "echo" bug: the output must be in a different script from
 * the input. Used for non-Vietnamese personas (Vietnamese has a tighter check
 * below). We sample the output rather than checking every char, so a stray
 * loanword or ASCII name in an otherwise-non-English translation doesn't trip it.
 */
export const outputLanguageDiffers = createScorer<TestCase, TranslateOutput, unknown>({
  name: "outputLanguageDiffers",
  scorer: ({ input, output }) => {
    // Vietnamese personas use the tighter vietnameseDirectionRespected scorer.
    const isViPersona =
      input.persona.targetLanguage.toLowerCase().includes("vietnamese") ||
      input.persona.sourceLanguage.toLowerCase().includes("vietnamese")
    if (isViPersona) return { score: 1, metadata: { skipped: "Vietnamese (tighter scorer used)" } }

    const inputNonLatin = hasNonLatin(input.input)
    const outputNonLatin = hasNonLatin(output.translation)
    const differs = inputNonLatin !== outputNonLatin
    return { score: differs ? 1 : 0, metadata: { inputNonLatin, outputNonLatin } }
  },
})

/**
 * Tighter direction check for Vietnamese↔English: English input must produce
 * Vietnamese diacritics in the output; Vietnamese input must produce ASCII-only
 * English output. Catches partial-echo and same-language regressions precisely.
 */
export const vietnameseDirectionRespected = createScorer<TestCase, TranslateOutput, unknown>({
  name: "vietnameseDirectionRespected",
  scorer: ({ input, output }) => {
    const isViPersona =
      input.persona.targetLanguage.toLowerCase().includes("vietnamese") ||
      input.persona.sourceLanguage.toLowerCase().includes("vietnamese")
    if (!isViPersona) return { score: 1, metadata: { skipped: "non-Vietnamese persona" } }

    const inputIsVi = isVietnamese(input.input)
    const outputIsVi = isVietnamese(output.translation)
    const correct = inputIsVi !== outputIsVi
    return { score: correct ? 1 : 0, metadata: { inputIsVi, outputIsVi } }
  },
})

/** The translation must be non-empty (guards against parse failures). */
export const translationNotEmpty = createScorer<TestCase, TranslateOutput, unknown>({
  name: "translationNotEmpty",
  scorer: ({ output }) => ({ score: output.translation.trim().length > 0 ? 1 : 0 }),
})

/** All four debug fields must be present and non-empty (structured-output guard). */
export const debugPopulated = createScorer<TestCase, TranslateOutput, unknown>({
  name: "debugPopulated",
  scorer: ({ output }) => {
    const d = output.debug
    const allPresent = Boolean(
      d && d.speaker && d.register && d.honorificsUsed && d.referents,
    )
    return {
      score: allPresent ? 1 : 0,
      metadata: {
        speaker: d?.speaker ?? null,
        hasRegister: Boolean(d?.register),
        hasHonorifics: Boolean(d?.honorificsUsed),
        hasReferents: Boolean(d?.referents),
      },
    }
  },
})

/**
 * Fail if `forbidden` appears as a DIRECT ADDRESS of the listener — i.e. at the
 * start of the translation or right after a vocative particle (ơi, à, ạ, etc.).
 * This avoids false positives where the forbidden word appears legitimately in
 * the sentence content (e.g. "Bà nội called" → translation mentions "bà nội").
 *
 * Only checks to-target (where the listener is the persona being addressed).
 */
export function noForbiddenAddressTerm(forbidden: string[]) {
  return createScorer<TestCase, TranslateOutput, unknown>({
    name: `noForbiddenAddressTerm[${forbidden.join("|")}]`,
    scorer: ({ input, output }) => {
      if (input.direction !== "to-target") {
        return { score: 1, metadata: { skipped: "from-target" } }
      }
      const t = output.translation
      // Direct address patterns: sentence-initial capitalized term, or term
      // following a vocative particle/comma. "Bà ơi", "^Bà ", ", Bà", "Bà," etc.
      const hit = forbidden.find((f) => {
        const escaped = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        // Sentence-initial: "Bà " at start, or after a sentence boundary.
        const initial = new RegExp(`(^|[.!?]\\s)${escaped}\\b`).test(t)
        // Vocative: "Bà ơi", "Bà à", "Bà," (direct address markers)
        const vocative = new RegExp(`${escaped}\\s*(ơi|à|ạ|nhé|nha|,)`).test(t)
        return initial || vocative
      })
      return {
        score: hit ? 0 : 1,
        metadata: hit ? { matched: hit, context: "direct address" } : null,
      }
    },
  })
}

/**
 * The "mẹ vợ third-person self-reference" bug: when the USER speaks (to-target),
 * the translation must not use role descriptors (mẹ vợ, con rể, etc.) for the
 * speaker's self-reference. A son-in-law says "con", never "mẹ vợ đi..."/
 * "con rể đi...". Direction-aware — only checks to-target.
 *
 * NOTE: This can false-positive if the source text literally contains the role
 * (e.g. "I am proud to be your son-in-law"). We mitigate by only flagging the
 * descriptor when it appears as a subject before a verb (the self-reference
 * pattern), not when it's the object of a sentence like "là con rể của mẹ".
 */
export const noRoleDescriptorSelfReference = createScorer<TestCase, TranslateOutput, unknown>({
  name: "noRoleDescriptorSelfReference",
  scorer: ({ input, output }) => {
    if (input.direction !== "to-target") {
      return { score: 1, metadata: { skipped: "from-target (not applicable)" } }
    }
    const roleDescriptors = ["mẹ vợ", "mẹ chồng", "con rể", "con dâu", "bố vợ", "mẹ ruột"]
    const t = output.translation.toLowerCase()
    // Only flag the descriptor as a SUBJECT (self-reference pattern):
    // sentence-initial or after a period, followed by a verb. This avoids
    // flagging "Con tự hào là con rể của mẹ" (object position, legitimate).
    const hit = roleDescriptors.find((d) => {
      const escaped = d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      // Subject pattern: descriptor at start of sentence, followed by space+verb-ish word.
      return new RegExp(`(^|[.!?]\\s)${escaped}\\s+(đi|đang|sẽ|đã|muốn|thích|nói|gọi|cho|đưa|nhìn|mua|ăn|ngủ|chạy|gặp)`).test(t)
    })
    return {
      score: hit ? 0 : 1,
      metadata: hit ? { matched: hit, context: "subject self-reference" } : null,
    }
  },
})

/**
 * Debug field correctness: when the user is speaking, debug.speaker must be
 * "user"; when the persona is speaking, it must be "other-person". Catches the
 * model mislabeling who spoke (which cascades into wrong pronouns).
 */
export const debugSpeakerMatchesDirection = createScorer<TestCase, TranslateOutput, unknown>({
  name: "debugSpeakerMatchesDirection",
  scorer: ({ input, output }) => {
    const expected = input.direction === "to-target" ? "user" : "other-person"
    const actual = output.debug?.speaker
    return {
      score: actual === expected ? 1 : 0,
      metadata: { expected, actual: actual ?? null },
    }
  },
})
