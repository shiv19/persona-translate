import OpenAI from "openai"

// Shared GLM/Z.ai client plumbing. Used by server/zai.ts (the translator under
// test) and evals/judge.ts (the LLM-as-judge) so the endpoint URL, key guard,
// and Z.ai-specific options never diverge between the two code paths.

// Server-only: the API key lives in process.env and is NEVER sent to the browser.
export const BASE_URL =
  process.env.ZAI_BASE_URL || "https://api.z.ai/api/coding/paas/v4"

// Z.ai-specific: disable GLM-5.x reasoning/"thinking" tokens on every call for
// speed. Spread into the chat.completions.create options. Typed loosely (as the
// SDK has no first-class field for this Z.ai extension) — matches the prior
// inline `...({ thinking: { type: "disabled" } } as object)` cast verbatim.
export const THINKING_DISABLED = { thinking: { type: "disabled" } } as object

// Lazily construct the OpenAI client so a missing ZAI_API_KEY doesn't crash
// the process on boot — it only fails if a request actually needs the key.
let _client: OpenAI | null = null
export function createClient(): OpenAI {
  if (!_client) {
    if (!process.env.ZAI_API_KEY) {
      throw new Error("Server is missing ZAI_API_KEY")
    }
    _client = new OpenAI({ apiKey: process.env.ZAI_API_KEY, baseURL: BASE_URL })
  }
  return _client
}

/**
 * Narrow a chat completion message's first tool call down to the function-tool
 * variant. The SDK's `tool_calls` union also has a "custom" variant we can't
 * parse, so this guards + narrows in one place. Returns undefined if there is
 * no tool call or it isn't a function call.
 */
export function firstFunctionToolCall(
  message: OpenAI.Chat.ChatCompletionMessage | undefined,
): OpenAI.Chat.ChatCompletionMessageFunctionToolCall | undefined {
  const toolCall = message?.tool_calls?.[0]
  if (toolCall && toolCall.type === "function" && "function" in toolCall) {
    return toolCall
  }
  return undefined
}
