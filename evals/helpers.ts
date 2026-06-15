import { createScorer } from "evalite"
import type { TranslateOutput } from "../server/zai.js"
import type { TestCase } from "./fixtures.js"
import { judgeTranslation } from "./judge.js"

/**
 * Build an LLM-as-judge scorer for a specific rubric string. Each eval file
 * defines its own rubric (the specific criterion to check) and gets back a
 * drop-in scorer.
 */
export function judgeScorer(rubric: string) {
  return createScorer<TestCase, TranslateOutput, unknown>({
    name: "judge",
    scorer: async ({ input, output }) => {
      const verdict = await judgeTranslation({
        input: input.input,
        output: output.translation,
        persona: input.persona,
        direction: input.direction,
        rubric,
      })
      return {
        score: verdict.score,
        metadata: { rationale: verdict.rationale },
      }
    },
  })
}
