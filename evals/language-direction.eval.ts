import { evalite } from "evalite"
import { serverTranslate, type TranslateOutput } from "../server/zai.js"
import { motherInLaw, japaneseFriend, case_, type TestCase } from "./fixtures.js"
import { judgeScorer } from "./helpers.js"
import { outputLanguageDiffers, vietnameseDirectionRespected, translationNotEmpty } from "./scorers.js"

// Regression class: the output must be in the OTHER language from the input.
// Catches the "English echoed as English" / wrong-translation-target bug.
evalite<TestCase, TranslateOutput>("language-direction", {
  data: [
    case_(motherInLaw, "Hi mom, good morning.", "to-target", "English → Vietnamese"),
    case_(motherInLaw, "Chào mẹ, chúc mẹ buổi sáng tốt lành.", "from-target", "Vietnamese → English"),
    case_(japaneseFriend, "Hey, want to grab lunch?", "to-target", "English → Japanese"),
    case_(japaneseFriend, "今日のランチ、ラーメンにしない？", "from-target", "Japanese → English"),
  ],
  task: async (input) => {
    return serverTranslate(input.persona, input.input, [], input.direction)
  },
  scorers: [
    translationNotEmpty,
    // Deterministic: script must differ between input and output.
    outputLanguageDiffers,
    // Tighter: Vietnamese diacritics must appear iff the input was English.
    vietnameseDirectionRespected,
    judgeScorer(
      "The translation must be in a DIFFERENT language from the input. If the input is English, the output must be in the persona's target language. If the input is the target language, the output must be English. Score 0 if the output is in the same language as the input (an echo / no-op translation).",
    ),
  ],
})
