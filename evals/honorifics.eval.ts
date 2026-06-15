import { evalite } from "evalite"
import { serverTranslate, type TranslateOutput } from "../server/zai.js"
import { motherInLaw, case_, type TestCase } from "./fixtures.js"
import { judgeScorer } from "./helpers.js"
import { noForbiddenTerm, translationNotEmpty, noRoleDescriptorSelfReference, debugSpeakerMatchesDirection } from "./scorers.js"

// Regression class: the listener is addressed with the correct kinship term,
// never a generic elder term (the "Bà ơi for a mother-in-law" bug).
evalite<TestCase, TranslateOutput>("honorifics", {
  data: [
    case_(motherInLaw, "Hi mom, good morning.", "to-target", "greeting"),
    case_(motherInLaw, "Are you hungry?", "to-target", "question"),
    case_(motherInLaw, "I bought you some fruit.", "to-target", "statement"),
  ],
  task: async (input) => {
    return serverTranslate(input.persona, input.input, [], input.direction)
  },
  scorers: [
    translationNotEmpty,
    // Hard guard: "Bà"/"Ông" must never appear when addressing the mother-in-law.
    noForbiddenTerm(["Bà", "Ông"]),
    // The user must not self-refer as "mẹ vợ"/"con rể" (third-person descriptors).
    noRoleDescriptorSelfReference,
    // debug.speaker must be "user" since these are all to-target.
    debugSpeakerMatchesDirection,
    judgeScorer(
      "The listener (the mother-in-law) must be addressed using a kinship term appropriate for a mother-in-law (e.g. 'Mẹ', 'mẹ vợ'), NEVER a generic elder term like 'Bà' or 'Ông'. If the translation directly addresses the listener, verify the address term is correct.",
    ),
  ],
})
