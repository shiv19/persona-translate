import { evalite } from "evalite"
import { serverTranslate, type TranslateOutput } from "../server/zai.js"
import { motherInLaw, japaneseFriend, case_, type TestCase } from "./fixtures.js"
import { debugPopulated, translationNotEmpty, debugSpeakerMatchesDirection } from "./scorers.js"

// Regression class: the function-calling structured output must populate ALL
// debug fields. Catches a regression back to response_format: json_object
// (where GLM returned only {"translation": "..."}).
// Deterministic scorers only — no judge needed.
evalite<TestCase, TranslateOutput>("structured-output", {
  data: [
    case_(motherInLaw, "Hi mom, good morning.", "to-target", "MIL greeting"),
    case_(motherInLaw, "Con đi chạy bộ à?", "from-target", "MIL reverse"),
    case_(japaneseFriend, "Want to grab lunch?", "to-target", "JP friend"),
  ],
  task: async (input) => {
    return serverTranslate(input.persona, input.input, [], input.direction)
  },
  scorers: [translationNotEmpty, debugPopulated, debugSpeakerMatchesDirection],
})
