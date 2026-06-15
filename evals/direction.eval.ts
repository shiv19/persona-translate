import { evalite } from "evalite"
import { serverTranslate, type TranslateOutput } from "../server/zai.js"
import { motherInLaw, case_, type TestCase } from "./fixtures.js"
import { judgeScorer } from "./helpers.js"
import { translationNotEmpty, noRoleDescriptorSelfReference, debugSpeakerMatchesDirection } from "./scorers.js"

// Regression class: speaker self-reference and listener address must be
// correct for the direction. Catches the "I'll go for a run" → third-person
// "mẹ vợ đi chạy bộ" bug, and the reverse-direction honorific flip bug.
evalite<TestCase, TranslateOutput>("direction", {
  data: [
    // The exact bug: user speaks, must self-refer as "con", not "mẹ vợ".
    case_(motherInLaw, "Senku is sleeping. I'll go for a run now.", "to-target", "user self-ref (the mẹ vợ bug)"),
    case_(motherInLaw, "I'll call you later.", "to-target", "user self-ref (simple)"),
    // Reverse: mother-in-law speaks to the user. Must NOT address user as "Mẹ"
    // (that's the user's term for HER, not hers for the user).
    case_(motherInLaw, "Con đi chạy bộ à? Để mẹ trông cháu Senku cho.", "from-target", "reverse: she addresses user correctly"),
  ],
  task: async (input) => {
    return serverTranslate(input.persona, input.input, [], input.direction)
  },
  scorers: [
    translationNotEmpty,
    // The core deterministic guard for this bug class.
    noRoleDescriptorSelfReference,
    // debug.speaker must match the direction.
    debugSpeakerMatchesDirection,
    judgeScorer(
      "DIRECTION-CORRECTNESS: (1) When the USER is speaking (to-target, English→Vietnamese), the speaker must refer to themselves with the correct humble first-person term for a son-in-law addressing an elder (Vietnamese: 'con'), NEVER with a third-person role descriptor like 'mẹ vợ' or 'con rể'. (2) When the PERSONA is speaking (from-target, Vietnamese→English), the persona must address the USER correctly per the reverse relationship — NOT by reusing the user's addressTerm flipped onto the user. (3) MEANING & TENSE must be preserved exactly — e.g. 'is sleeping' must not become 'has fallen asleep' / 'ngủ rồi' (already asleep). NOTE: natural register particles (Vietnamese: ơi, ạ, nha, nhé) and dialect features are ENCOURAGED and must NOT be penalized — they make the translation sound natural. Score 0 only for wrong pronouns, wrong self-reference, wrong direction-address, or altered meaning/tense. Do not penalize natural discourse particles.",
    ),
  ],
})
