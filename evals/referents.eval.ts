import { evalite } from "evalite"
import { serverTranslate, type TranslateOutput } from "../server/zai.js"
import { motherInLaw, case_, type TestCase } from "./fixtures.js"
import { judgeScorer } from "./helpers.js"
import { translationNotEmpty } from "./scorers.js"

// Regression class: third parties mentioned in the message must be referred to
// with the kinship term matching their relationship to the LISTENER. Catches
// "Senku" being referred to with a dismissive classifier (thằng/con) instead
// of the kinship term (cháu).
evalite<TestCase, TranslateOutput>("referents", {
  data: [
    case_(motherInLaw, "Senku is sleeping.", "to-target", "grandson → cháu"),
    case_(motherInLaw, "Where is Kelly?", "to-target", "daughter"),
    case_(motherInLaw, "Senku ate all his food.", "to-target", "grandson in a sentence"),
  ],
  task: async (input) => {
    return serverTranslate(input.persona, input.input, [], input.direction)
  },
  scorers: [
    translationNotEmpty,
    judgeScorer(
      "Third parties (not the speaker or listener) must be referred to using the kinship term matching their relationship to the LISTENER. 'Senku' is the listener's grandson → must use 'cháu' (Vietnamese), never a dismissive classifier like 'thằng' or 'con'. 'Kelly' is the listener's daughter → use the daughter kinship term. Score 0 if a dismissive/generic classifier is used for the listener's own family.",
    ),
  ],
})
