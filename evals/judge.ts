import OpenAI from "openai"
import type { Persona } from "../server/zai.js"
import { withRetry } from "../server/retry.js"

// The judge uses the same Z.ai endpoint + key as the translator under test.
// This is a known trade-off (a model judging itself may share blind spots),
// chosen for cost/simplicity. To swap in a stronger judge later, change only
// this file — test cases stay untouched.
const BASE_URL = process.env.ZAI_BASE_URL || "https://api.z.ai/api/coding/paas/v4"
const MODEL = process.env.ZAI_JUDGE_MODEL || process.env.ZAI_MODEL || "glm-5.2"

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

  const prompt = `You are a strict, expert evaluator of ${opts.persona.targetLanguage} translations. You know the language's honorific and kinship systems natively.

CONTEXT:
- Source language: ${opts.persona.sourceLanguage}
- Target language: ${opts.persona.targetLanguage}
- Speaker: ${speaker}
- Listener: ${listener}
- Speaker↔Listener relationship: ${opts.persona.relationship}
- Reverse relationship: ${opts.persona.reverseRelationship}
- Address term configured by the user: ${opts.persona.addressTerm ?? "(none — derive from relationship)"}
- Extra persona context: ${opts.persona.context}

ORIGINAL (input): ${opts.input}
TRANSLATION (output under test): ${opts.output}

RUBRIC — score whether the translation satisfies THIS criterion:
${opts.rubric}

Score 1 only if the rubric is fully satisfied. Score 0.5 if it is ambiguous or partially satisfied. Score 0 if it is violated. Be strict — do not give credit for a correct-but-different choice if the rubric specifies a concrete requirement. Cite the exact term(s) from the translation in your rationale.`

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
