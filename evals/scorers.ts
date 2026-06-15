import { createScorer } from "evalite"
import type { TranslateOutput } from "../server/zai.js"
import type { TestCase } from "./fixtures.js"

// The "output" type for every eval is TranslateOutput (translation + debug).
// The "input" type is TestCase. Deterministic scorers get these typed args.

/** True if `s` contains characters outside basic Latin (implies non-English). */
function hasNonLatin(s: string): boolean {
  // Vietnamese diacritics, CJK, Cyrillic, Arabic, etc. all live outside ASCII.
  // Also catch Vietnamese-specific composed chars (ấ ườ ạ etc. are > U+0300).
  return /[^\x00-\x7F]/.test(s)
}

/** True if `s` looks like Vietnamese (has Vietnamese-specific diacritics). */
function isVietnamese(s: string): boolean {
  // Vietnamese-specific composed chars and tone marks: ă â ê ô ơ ư đ + diacritics
  // à á ả ã ạ ằ ắ ẳ ẵ ặ ầ ấ ẩ ẫ ậ ề ế ể ễ ệ ì í ỉ ĩ ị ò ó ỏ õ ọ ồ ố ổ ỗ ộ ờ ớ ở ỡ ợ
  // ù ú ủ ũ ụ ừ ứ ử ữ ự ỳ ý ỷ ỹ ỵ Đ
  return /[ăâêôơưđĂÂÊÔƠƯĐàáảãạằắẳẵặầấẩẫậềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/.test(s)
}

/**
 * Guard against the "echo" bug: the output must be in a different script from
 * the input. English in → Vietnamese out (diacritics); Vietnamese in → English
 * out (ASCII). Catches wrong-direction / same-language-as-input regressions.
 */
export const outputLanguageDiffers = createScorer<TestCase, TranslateOutput, unknown>({
  name: "outputLanguageDiffers",
  scorer: ({ input, output }) => {
    const inputNonLatin = hasNonLatin(input.input)
    const outputNonLatin = hasNonLatin(output.translation)
    const differs = inputNonLatin !== outputNonLatin
    return {
      score: differs ? 1 : 0,
      metadata: { inputNonLatin, outputNonLatin },
    }
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
    // Only applies to Vietnamese personas.
    const isViPersona =
      input.persona.targetLanguage.toLowerCase().includes("vietnamese") ||
      input.persona.sourceLanguage.toLowerCase().includes("vietnamese")
    if (!isViPersona) return { score: 1, metadata: { skipped: "non-Vietnamese persona" } }

    const inputIsVi = isVietnamese(input.input)
    const outputIsVi = isVietnamese(output.translation)
    // Correct: input and output must be in different languages.
    const correct = inputIsVi !== outputIsVi
    return {
      score: correct ? 1 : 0,
      metadata: { inputIsVi, outputIsVi },
    }
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
 * Factory: a scorer that fails if any of `forbidden` terms appears in the
 * translation. E.g. forbid "Bà" when addressTerm is "Mẹ".
 * Case-sensitive (Vietnamese is diacritic-sensitive: "bà" ≠ "Bà").
 */
export function noForbiddenTerm(forbidden: string[]) {
  return createScorer<TestCase, TranslateOutput, unknown>({
    name: `noForbiddenTerm[${forbidden.join("|")}]`,
    scorer: ({ output }) => {
      const hit = forbidden.find((t) => output.translation.includes(t))
      return {
        score: hit ? 0 : 1,
        metadata: hit ? { matched: hit } : null,
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
 * This is deterministic because the bug has an exact lexical signature: the
 * persona's own role descriptors appearing where a first-person pronoun should.
 */
export const noRoleDescriptorSelfReference = createScorer<TestCase, TranslateOutput, unknown>({
  name: "noRoleDescriptorSelfReference",
  scorer: ({ input, output }) => {
    // Only check when the user is speaking (to-target) — that's the bug class.
    if (input.direction !== "to-target") {
      return { score: 1, metadata: { skipped: "from-target (not applicable)" } }
    }
    // Role descriptors for Vietnamese family roles — these are how OTHERS refer
    // to the person, never how the person refers to themselves.
    const roleDescriptors = ["mẹ vợ", "mẹ chồng", "con rể", "con dâu", "bố vợ", "mẹ ruột"]
    const hit = roleDescriptors.find((d) => output.translation.toLowerCase().includes(d))
    return {
      score: hit ? 0 : 1,
      metadata: hit ? { matched: hit } : null,
    }
  },
})

/**
 * The "addressTerm flipped in reverse" bug: when the PERSONA speaks
 * (from-target), the user's configured addressTerm must NOT appear as an
 * address for the user. E.g. if addressTerm is "Mẹ" (how the user addresses the
 * mother-in-law), the mother-in-law must not call the user "Mẹ" back.
 *
 * Only fires when an addressTerm is set AND direction is from-target.
 */
export const addressTermNotFlippedInReverse = createScorer<TestCase, TranslateOutput, unknown>({
  name: "addressTermNotFlippedInReverse",
  scorer: ({ input, output }) => {
    const term = input.persona.addressTerm?.trim()
    if (!term || input.direction !== "from-target") {
      return { score: 1, metadata: { skipped: "no addressTerm or not from-target" } }
    }
    // The output of from-target is in the SOURCE language (English), so the
    // target-language addressTerm wouldn't appear anyway. Instead, check the
    // debug.honorificsUsed to ensure the model didn't claim it addressed the
    // user with the flipped term. This is a heuristic — the judge covers nuance.
    const honorifics = output.debug?.honorificsUsed?.toLowerCase() ?? ""
    const flipped = honorifics.includes(term.toLowerCase()) &&
      /addresses?.?\s*(the\s*)?(user|listener)/i.test(honorifics)
    return {
      score: flipped ? 0 : 1,
      metadata: flipped ? { matched: term } : null,
    }
  },
})

/**
 * The "dismissive classifier for family" bug: third parties in the listener's
 * family must use kinship terms (cháu, bé), never classifiers (thằng, con) as
 * dismissive markers. Vietnamese-specific.
 */
export const noDismissiveClassifier = createScorer<TestCase, TranslateOutput, unknown>({
  name: "noDismissiveClassifier",
  scorer: ({ input, output }) => {
    const isVi = input.persona.targetLanguage.toLowerCase().includes("vietnamese")
    if (!isVi || input.direction !== "to-target") {
      return { score: 1, metadata: { skipped: "non-Vietnamese or not to-target" } }
    }
    // "thằng <Name>" or "con <Name>" as a classifier before a proper noun is
    // dismissive when referring to the listener's own family.
    const dismissive = /\b(thằng|con)\s+[A-ZÀ-Ỵ]/.test(output.translation)
    return {
      score: dismissive ? 0 : 1,
      metadata: dismissive ? { matched: "thằng/con + Name" } : null,
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
