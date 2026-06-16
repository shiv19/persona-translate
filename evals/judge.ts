import OpenAI from "openai"
import type { Persona } from "../server/zai.js"
import { withRetry } from "../server/retry.js"

// The judge uses the same Z.ai endpoint + key as the translator under test.
// This is a known trade-off (a model judging itself may share blind spots),
// chosen for cost/simplicity. To swap in a stronger judge later, change only
// this file — test cases stay untouched.
const BASE_URL = process.env.ZAI_BASE_URL || "https://api.z.ai/api/coding/paas/v4"
const MODEL = process.env.ZAI_JUDGE_MODEL || process.env.ZAI_MODEL || "glm-5.1"

let _client: OpenAI | null = null
function client(): OpenAI {
  if (!_client) {
    if (!process.env.ZAI_API_KEY) throw new Error("Judge missing ZAI_API_KEY")
    _client = new OpenAI({ apiKey: process.env.ZAI_API_KEY, baseURL: BASE_URL })
  }
  return _client
}

// The judge must commit to a structured verdict via a tool call, so we get a
// clean { score, rationale } back instead of free-form prose.
const SCORE_TOOL = {
  type: "function" as const,
  function: {
    name: "score_translation",
    description: "Score whether the translation satisfies the rubric.",
    parameters: {
      type: "object",
      properties: {
        score: {
          type: "number",
          enum: [0, 0.5, 1],
          description: "1 = fully satisfies the rubric. 0.5 = partially / ambiguous. 0 = fails the rubric.",
        },
        rationale: {
          type: "string",
          description: "One or two sentences explaining the score, citing the specific term(s) in the translation.",
        },
      },
      required: ["score", "rationale"],
    },
  },
}

export interface JudgeInput {
  /** The original text that was submitted for translation. */
  input: string
  /** The translation produced by the system under test. */
  output: string
  /** The persona in effect (for relationship / language context). */
  persona: Persona
  /** The direction the translation was performed in. */
  direction: "to-target" | "from-target"
  /** The specific criterion the judge must evaluate. */
  rubric: string
}

export interface JudgeVerdict {
  score: number
  rationale: string
}

/**
 * Ask the judge model whether `output` satisfies `rubric`, given the persona
 * and direction context. Returns a 0/0.5/1 score + rationale.
 */
export async function judgeTranslation(opts: JudgeInput): Promise<JudgeVerdict> {
  const speakerIsUser = opts.direction === "to-target"
  const speaker = speakerIsUser ? "the user (English speaker)" : `${opts.persona.name} (${opts.persona.targetLanguage} speaker)`
  const listener = speakerIsUser ? `${opts.persona.name} (${opts.persona.targetLanguage} speaker)` : "the user (English speaker)"

  // The input/output languages depend on direction. State them explicitly so
  // the judge never has to infer which language the output should be in.
  const inputLang = speakerIsUser ? opts.persona.sourceLanguage : opts.persona.targetLanguage
  const expectedOutputLang = speakerIsUser ? opts.persona.targetLanguage : opts.persona.sourceLanguage

  const prompt = `You are a strict, expert evaluator of ${opts.persona.targetLanguage} translations. You know the language's honorific and kinship systems natively.

CONTEXT:
- Input language: ${inputLang}
- Expected output language: ${expectedOutputLang}
- Speaker: ${speaker}
- Listener: ${listener}
- Speaker↔Listener relationship: ${opts.persona.relationship}
- Reverse relationship: ${opts.persona.reverseRelationship}
- Address term configured by the user: ${opts.persona.addressTerm ?? "(none — derive from relationship)"} — note: this is how the USER addresses the persona; the persona may use a DIFFERENT term when addressing the user.
- Extra persona context: ${opts.persona.context}

ORIGINAL INPUT (${inputLang}): ${opts.input}
TRANSLATION UNDER TEST: ${opts.output}

RUBRIC — score whether the translation satisfies THIS criterion:
${opts.rubric}

EVALUATION PROCEDURE (follow this order exactly):
1. CHECK THE OUTPUT LANGUAGE FIRST. The output must be in ${expectedOutputLang}. If it is in the same language as the input, score 0 immediately — this is a hard failure regardless of the rubric.
2. Evaluate the rubric. The translation's address terms and kinship choices are CORRECT if they match the direction: when the persona speaks, they use their own kinship system to address the user — this may differ from the user's configured addressTerm, and that difference is correct, not an error.
3. Before scoring, state your conclusion in one sentence (e.g. "The output is in English and preserves the source meaning → rubric satisfied").
4. Your score MUST agree with your conclusion in step 3. If you concluded the rubric is satisfied, score 1 — do not contradict yourself.

Score 1 = rubric satisfied. Score 0.5 = ambiguous/partial. Score 0 = violated. Cite the exact term(s) from the translation in your rationale.`

  const response = await withRetry(() =>
    client().chat.completions.create({
      model: MODEL,
      temperature: 0, // deterministic judging
      messages: [{ role: "user", content: prompt }],
      tools: [SCORE_TOOL],
      tool_choice: "auto",
      ...({ thinking: { type: "disabled" } } as object),
    }),
  )

  const toolCall = response.choices[0]?.message?.tool_calls?.[0]
  if (toolCall && toolCall.type === "function" && "function" in toolCall) {
    try {
      const args = JSON.parse(toolCall.function.arguments) as { score: number; rationale: string }
      return { score: args.score, rationale: args.rationale }
    } catch {}
  }

  // Fallback: if the model didn't call the tool, fail closed (score 0).
  return { score: 0, rationale: "Judge did not return a structured verdict." }
}
